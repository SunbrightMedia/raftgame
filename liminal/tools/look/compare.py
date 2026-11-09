"""
Compare a render against a reference image, in numbers.

    .venv-look/bin/python tools/look/compare.py REF.png RENDER.png \
        [--regions "ceiling,floor,wall,light fixture,door"] [--out report.png] [--json out.json] [--fast]

Reports, for each image and the difference between them:
  - levels: L* percentiles (CIELAB lightness, 0-100), clipped/crushed %,
    contrast (std of L*), colour cast (mean a*, b*), saturation (mean chroma);
  - regions: text-prompted masks (Grounding DINO boxes refined by SAM 2.1),
    per region: area %, mean L*, a*, b*, chroma;
  - similarity: DINOv2 global cosine and a per-patch map of where the images
    differ (same framing assumed).
The summary lists the biggest differences first, as plain statements.
--fast skips the models (levels only). Models download on first use.
"""
import argparse, json, sys
import numpy as np
from PIL import Image, ImageDraw

DINO_ID = 'facebook/dinov2-small'
GDINO_ID = 'IDEA-Research/grounding-dino-tiny'
SAM_ID = 'facebook/sam2.1-hiera-small'
MAXW = 768


# ---------------------------------------------------------------- colour
def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """rgb uint8 HxWx3 -> Lab float HxWx3 (D65)."""
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


def levels(lab: np.ndarray, mask: np.ndarray | None = None) -> dict:
    L, a, b = (lab[..., i] if mask is None else lab[..., i][mask] for i in range(3))
    if L.size == 0:
        return {}
    pct = np.percentile(L, [1, 5, 25, 50, 75, 95, 99])
    return {
        'L_p1': pct[0], 'L_p5': pct[1], 'L_p25': pct[2], 'L_median': pct[3], 'L_p75': pct[4], 'L_p95': pct[5], 'L_p99': pct[6],
        'L_mean': float(L.mean()), 'contrast': float(L.std()),
        'clipped_pct': float((L > 98).mean() * 100), 'crushed_pct': float((L < 3).mean() * 100),
        'a_mean': float(a.mean()), 'b_mean': float(b.mean()), 'chroma': float(np.hypot(a, b).mean()),
    }


def load(path: str, aspect: float | None = None) -> Image.Image:
    im = Image.open(path).convert('RGB')
    if aspect:  # centre-crop to the reference's aspect
        w, h = im.size
        if w / h > aspect:
            nw = int(h * aspect); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = int(w / aspect); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    if im.width > MAXW:
        im = im.resize((MAXW, round(im.height * MAXW / im.width)), Image.LANCZOS)
    return im


# ---------------------------------------------------------------- models
_cache = {}


def model(kind: str):
    if kind in _cache:
        return _cache[kind]
    import torch
    torch.set_num_threads(max(1, torch.get_num_threads()))
    from transformers import AutoImageProcessor, AutoModel, AutoProcessor, GroundingDinoForObjectDetection, Sam2Model, Sam2Processor
    if kind == 'dino':
        _cache[kind] = (AutoImageProcessor.from_pretrained(DINO_ID), AutoModel.from_pretrained(DINO_ID).eval())
    elif kind == 'gdino':
        _cache[kind] = (AutoProcessor.from_pretrained(GDINO_ID), GroundingDinoForObjectDetection.from_pretrained(GDINO_ID).eval())
    elif kind == 'sam':
        _cache[kind] = (Sam2Processor.from_pretrained(SAM_ID), Sam2Model.from_pretrained(SAM_ID).eval())
    return _cache[kind]


def regions(im: Image.Image, labels: list[str], box_thr=0.25, text_thr=0.2) -> dict[str, np.ndarray]:
    """Text prompt -> boxes (Grounding DINO) -> masks (SAM 2.1). One boolean mask per label (union of its boxes);
    where labels overlap, the more confident box wins."""
    import torch
    proc, gd = model('gdino')
    text = '. '.join(labels) + '.'
    inp = proc(images=im, text=text, return_tensors='pt')
    with torch.no_grad():
        out = gd(**inp)
    res = proc.post_process_grounded_object_detection(out, inp.input_ids, threshold=box_thr, text_threshold=text_thr, target_sizes=[im.size[::-1]])[0]
    boxes = res['boxes'].tolist()
    names = res.get('text_labels', res.get('labels'))
    scores = res['scores'].tolist()
    H, W = im.height, im.width
    masks = {l: np.zeros((H, W), bool) for l in labels}
    best = np.zeros((H, W))
    if not boxes:
        return masks
    sproc, sam = model('sam')
    sin = sproc(images=im, input_boxes=[boxes], return_tensors='pt')
    with torch.no_grad():
        sout = sam(**sin, multimask_output=False)
    ms = sproc.post_process_masks(sout.pred_masks, sin['original_sizes'])[0][:, 0].numpy() > 0
    for m, n, s in zip(ms, names, scores):
        lab = next((l for l in labels if l in str(n)), None)
        if lab is None:
            continue
        take = m & (s > best)
        for l in labels:
            masks[l][take] = False
        masks[lab][take] = True
        best[take] = s
    return masks


def dino_similarity(a: Image.Image, b: Image.Image):
    import torch
    proc, dm = model('dino')
    size = 448
    ims = [x.resize((size, round(size * x.height / x.width / 14) * 14)) for x in (a, b)]
    feats = []
    for x in ims:
        t = proc(images=x, return_tensors='pt', do_resize=False, do_center_crop=False)
        with torch.no_grad():
            h = dm(**t).last_hidden_state[0]
        feats.append(h)
    cls = torch.nn.functional.cosine_similarity(feats[0][0], feats[1][0], dim=0).item()
    n = min(feats[0].shape[0], feats[1].shape[0]) - 1
    pa, pb = feats[0][1:n + 1], feats[1][1:n + 1]
    sim = torch.nn.functional.cosine_similarity(pa, pb, dim=1).numpy()
    gw = size // 14
    gh = n // gw
    return cls, sim[: gw * gh].reshape(gh, gw)


# ---------------------------------------------------------------- report
def summary(ref: dict, ren: dict, reg: dict) -> list[str]:
    out = []
    def d(key, name, unit='', thr=2.0):
        if key in ref and key in ren:
            v = ren[key] - ref[key]
            if abs(v) >= thr:
                out.append((abs(v), f"{name}: render {v:+.1f}{unit} vs reference ({ren[key]:.1f} vs {ref[key]:.1f})"))
    d('L_median', 'midtones (median L*)'); d('L_p95', 'highlights (L* p95)'); d('L_p5', 'shadows (L* p5)')
    d('contrast', 'contrast (L* std)'); d('b_mean', 'yellow(+)/blue(-) cast b*'); d('a_mean', 'magenta(+)/green(-) cast a*')
    d('chroma', 'saturation (chroma)'); d('clipped_pct', 'blown highlights', '%', 1.0); d('crushed_pct', 'crushed blacks', '%', 1.0)
    for l, (r, n) in reg.items():
        if not r or not n:
            continue
        for key, name in [('L_mean', 'brightness'), ('b_mean', 'yellow/blue'), ('a_mean', 'magenta/green'), ('chroma', 'saturation')]:
            v = n[key] - r[key]
            if abs(v) >= 3:
                out.append((abs(v) * 0.8, f"{l} {name}: render {v:+.1f} ({n[key]:.1f} vs {r[key]:.1f})"))
    return [s for _, s in sorted(out, reverse=True)]


def draw_report(ref_im, ren_im, masks_ref, masks_ren, simmap, ref_lab, ren_lab, lines, path):
    W, H = ref_im.size
    pal = [(255, 80, 80), (80, 200, 255), (120, 255, 120), (255, 220, 60), (230, 120, 255), (255, 160, 60), (60, 255, 220)]
    def overlay(im, masks):
        a = np.asarray(im).astype(float).copy()
        for k, (l, m) in enumerate(masks.items()):
            a[m] = a[m] * 0.45 + np.array(pal[k % len(pal)]) * 0.55
        return Image.fromarray(a.astype(np.uint8))
    tiles = [ref_im, ren_im]
    if simmap is not None:
        s = np.clip((simmap - 0.2) / 0.8, 0, 1)
        heat = np.stack([1 - s, s * 0.9, 0.2 + 0 * s], -1)
        tiles.append(Image.fromarray((heat * 255).astype(np.uint8)).resize((W, H), Image.NEAREST))
    rows = [tiles]
    if masks_ref:
        rows.append([overlay(ref_im, masks_ref), overlay(ren_im, masks_ren)])
    # L* histograms
    hist = Image.new('RGB', (W, H), (20, 20, 20)); g = ImageDraw.Draw(hist)
    for lab, col in [(ref_lab, (230, 230, 230)), (ren_lab, (255, 120, 60))]:
        h, _ = np.histogram(lab[..., 0], bins=100, range=(0, 100)); h = h / max(1, h.max())
        pts = [(int(i / 100 * W), int(H - 20 - v * (H - 40))) for i, v in enumerate(h)]
        g.line(pts, fill=col, width=2)
    g.text((6, 6), 'L* histogram: white = reference, orange = render', fill=(230, 230, 230))
    rows[-1].append(hist)
    cols = max(len(r) for r in rows)
    txt_h = 16 * (len(lines) + 2)
    canvas = Image.new('RGB', (W * cols, H * len(rows) + txt_h), (12, 12, 12))
    d = ImageDraw.Draw(canvas)
    for y, r in enumerate(rows):
        for x, t in enumerate(r):
            canvas.paste(t.resize((W, H)), (x * W, y * H))
    labels = ['reference', 'render', 'similarity (green = same)'] if simmap is not None else ['reference', 'render']
    for x, l in enumerate(labels):
        d.text((x * W + 6, 6), l, fill=(255, 255, 0))
    if masks_ref:
        d.text((6, H + 6), '  '.join(f'{l}' for l in masks_ref), fill=(255, 255, 0))
    for i, l in enumerate(lines):
        d.text((8, H * len(rows) + 8 + 16 * i), l, fill=(230, 230, 230))
    canvas.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('ref'); ap.add_argument('render')
    ap.add_argument('--regions', default='ceiling,floor,wall,light fixture,door')
    ap.add_argument('--out', default='look_report.png'); ap.add_argument('--json', default=None)
    ap.add_argument('--fast', action='store_true', help='levels only, no models')
    a = ap.parse_args()
    ref_im = load(a.ref)
    ren_im = load(a.render, ref_im.width / ref_im.height).resize(ref_im.size, Image.LANCZOS)
    ref_lab, ren_lab = srgb_to_lab(np.asarray(ref_im)), srgb_to_lab(np.asarray(ren_im))
    result = {'reference': levels(ref_lab), 'render': levels(ren_lab), 'regions': {}}
    masks_ref = masks_ren = None
    simmap = None
    if not a.fast:
        labels = [s.strip() for s in a.regions.split(',') if s.strip()]
        masks_ref, masks_ren = regions(ref_im, labels), regions(ren_im, labels)
        for l in labels:
            result['regions'][l] = [
                {**levels(ref_lab, masks_ref[l]), 'area_pct': float(masks_ref[l].mean() * 100)} if masks_ref[l].any() else {},
                {**levels(ren_lab, masks_ren[l]), 'area_pct': float(masks_ren[l].mean() * 100)} if masks_ren[l].any() else {},
            ]
        cls, simmap = dino_similarity(ref_im, ren_im)
        result['similarity'] = {'global': cls, 'patch_mean': float(simmap.mean()), 'patch_worst10pct': float(np.percentile(simmap, 10))}
    lines = summary(result['reference'], result['render'], result['regions'])
    if 'similarity' in result:
        s = result['similarity']
        lines.insert(0, f"similarity: global {s['global']:.3f}, patches mean {s['patch_mean']:.3f}, worst 10% {s['patch_worst10pct']:.3f}")
    for l, (r, n) in result['regions'].items():
        if not r and not n:
            continue
        lines.append(f"region {l}: area ref {r.get('area_pct', 0):.0f}% / render {n.get('area_pct', 0):.0f}%")
    result['summary'] = lines
    draw_report(ref_im, ren_im, masks_ref, masks_ren, simmap, ref_lab, ren_lab, lines[:24], a.out)
    if a.json:
        json.dump(result, open(a.json, 'w'), indent=1, default=float)
    print('\n'.join(lines) if lines else 'no notable differences')
    print(f'report: {a.out}')


if __name__ == '__main__':
    main()
