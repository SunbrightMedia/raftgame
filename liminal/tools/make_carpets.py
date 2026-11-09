"""
Carpet textures from photos of carpet samples the user supplied
(tools/carpet_sources/*.jpg). Run: python3 tools/make_carpets.py  (needs numpy + opencv)

Each sample is cropped inside its binding and its lighting flattened, then made
to tile without a visible seam:
  - repeating patterns (chevron, floral): the lattice is measured from the
    autocorrelation, the photo is turned square to it and scaled so a repeat
    is whole pixels; the tile is one exact repeat whose edges are joined to
    the photo's own next repeat along the least visible cut.
  - non-repeating patterns (camo, confetti): each edge is joined to the
    opposite one along the least visible path through an overlap band
    (minimum-error boundary cut, as in image quilting), never by fading.
Writes textures/carpet/<name>.png and the entries in textures/index.json.
"""
import json, os
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'tools', 'carpet_sources')
OUT = os.path.join(ROOT, 'textures', 'carpet')

CARPETS = [
    # name, source, crop (x0, y0, x1, y1) inside the binding, kind, world inches per tile (width)
    ('carpet/chevron_blue', 'chevron_blue.jpg', (50, 45, 725, 725), 'periodic', 8),
    ('carpet/camo_olive', 'camo_olive.jpg', (85, 90, 500, 680), 'free', 24),
    ('carpet/floral_navy', 'floral_navy.jpg', (105, 95, 690, 510), 'periodic', 12),
    ('carpet/confetti_blue', 'confetti_blue.jpg', (78, 70, 440, 700), 'free', 24),
]


def flatten(a):
    """Divide out the slow lighting gradient (keep the mean colour)."""
    lum = a.mean(axis=2)
    s = max(a.shape[:2]) / 6
    low = cv2.GaussianBlur(lum, (0, 0), s)
    return np.clip(a * (lum.mean() / np.maximum(low, 1))[..., None], 0, 255)


def peaks(a):
    g = a.mean(axis=2) - a.mean()
    h, w = g.shape
    F = np.fft.fft2(g, s=(2 * h, 2 * w))
    ac = np.fft.fftshift(np.fft.ifft2(F * np.conj(F)).real).astype(np.float32)
    ac /= ac.max()
    cy, cx = h, w
    mx = cv2.dilate(ac, np.ones((15, 15), np.uint8))
    out = []
    for y, x in np.argwhere((ac == mx) & (ac > 0.2)):
        dy, dx = y - cy, x - cx
        if dy * dy + dx * dx < 100 or abs(dy) > h * 0.6 or abs(dx) > w * 0.6:
            continue
        # sub-pixel refinement (parabola through neighbours)
        def sub(c, l, r): d = l - 2 * c + r; return 0.0 if d == 0 else 0.5 * (l - r) / d
        fy = dy + sub(ac[y, x], ac[y - 1, x], ac[y + 1, x]); fx = dx + sub(ac[y, x], ac[y, x - 1], ac[y, x + 1])
        out.append((float(ac[y, x]), fy, fx))
    return out


def periodic_tile(a):
    pk = peaks(a)
    # the most horizontal and most vertical lattice vectors
    # (sums of two peaks too: on a centred lattice the square period is the sum of the diagonals)
    vecs = [(c, y, x) for c, y, x in pk] + [(min(c1, c2), y1 + y2, x1 + x2) for i, (c1, y1, x1) in enumerate(pk) for (c2, y2, x2) in pk[i + 1:]]
    near = lambda v, dx, dy: abs(dy) < np.tan(np.radians(5)) * abs(dx) and abs(dx) > 50
    hv = min((v for v in vecs if near(v, v[2], v[1])), key=lambda v: np.hypot(v[1], v[2]))
    vv = min((v for v in vecs if near(v, v[1], v[2])), key=lambda v: np.hypot(v[1], v[2]))
    hx, hy = (hv[2], hv[1]) if hv[2] > 0 else (-hv[2], -hv[1])
    vx, vy = (vv[2], vv[1]) if vv[1] > 0 else (-vv[2], -vv[1])
    ang = np.degrees(np.arctan2(hy, hx))
    px, py = float(np.hypot(hx, hy)), float(np.hypot(vx, vy))
    h, w = a.shape[:2]
    R = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
    r = cv2.warpAffine(a.astype(np.float32), R, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    # resample so one period is a whole number of pixels
    Px, Py = int(round(px)), int(round(py))
    r = cv2.resize(r, (int(round(w * Px / px)), int(round(h * Py / py))), interpolation=cv2.INTER_CUBIC)
    # One repeat plus an overlap band from the middle of the photo: the band is the start of the next
    # repeat, so cutting it into the first one closes the tile with the photo's own continuation.
    # (A median of every repeat looked blurry: hand-tufted motifs drift a few pixels between repeats.)
    ox, oy = int(Px * 0.3), int(Py * 0.3)
    cx, cy = (r.shape[1] - Px - ox) // 2, (r.shape[0] - Py - oy) // 2
    cell = r[cy:cy + Py + oy, cx:cx + Px + ox]
    print(f'  lattice {px:.1f} x {py:.1f} px, turned {ang:.2f}°')
    t = wrap_x(cell, ox)
    return wrap_x(t.transpose(1, 0, 2), oy).transpose(1, 0, 2)


def min_cut(err):
    """Vertical minimum-error path through err (rows x cols), one column per row. The path ends in
    the column it starts in, so the cut itself wraps: tiles stay continuous where seams cross."""
    h, w = err.shape
    best = None
    for s0 in np.argsort(err[0])[:24]:
        cost = np.full(w, np.inf); cost[s0] = err[0, s0]
        back = np.zeros((h, w), int)
        for y in range(1, h):
            cand = np.stack([np.r_[np.inf, cost[:-1]], cost, np.r_[cost[1:], np.inf]])
            k = np.argmin(cand, axis=0)
            back[y] = np.arange(w) + k - 1
            cost = cand[k, np.arange(w)] + err[y]
        if best is None or cost[s0] < best[0]:
            path = np.zeros(h, int); path[-1] = s0
            for y in range(h - 1, 0, -1): path[y - 1] = back[y, path[y]]
            best = (cost[s0], path)
    return best[1]


def wrap_x(a, ov):
    """Make a tile horizontally: its right overlap band continues into its left one along a cut."""
    h, w = a.shape[:2]
    left, right = a[:, :ov], a[:, w - ov:]
    err = ((left - right) ** 2).sum(axis=2)
    path = min_cut(err)
    out = a[:, :w - ov].copy()
    for y in range(h):
        out[y, :path[y]] = right[y, :path[y]]
    return out


def free_tile(a):
    h, w = a.shape[:2]
    a = wrap_x(a, int(w * 0.33))
    a = wrap_x(a.transpose(1, 0, 2), int(h * 0.25)).transpose(1, 0, 2)
    return a


def main():
    os.makedirs(OUT, exist_ok=True)
    entries = []
    for name, src, crop, kind, world in CARPETS:
        print(name)
        im = cv2.imread(os.path.join(SRC, src))[:, :, ::-1].astype(np.float32)
        x0, y0, x1, y1 = crop
        a = flatten(im[y0:y1, x0:x1])
        t = periodic_tile(a) if kind == 'periodic' else free_tile(a)
        t = np.clip(t, 0, 255).astype(np.uint8)
        h, w = t.shape[:2]
        s = 512 / max(h, w)
        if s < 1: t = cv2.resize(t, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        h, w = t.shape[:2]
        fname = name.split('/')[1] + '.png'
        cv2.imwrite(os.path.join(OUT, fname), t[:, :, ::-1])
        entries.append({'name': name, 'file': 'carpet/' + fname, 'size': [world, round(world * h / w, 2)], 'material': 'carpet',
                        'credit': 'Photo of a carpet sample, supplied by the user', 'url': '', 'license': 'user-supplied'})
        print(f'  -> {w}x{h} px, {world}" wide')
    idx_path = os.path.join(ROOT, 'textures', 'index.json')
    idx = json.load(open(idx_path))
    names = {e['name'] for e in entries}
    idx['textures'] = [t for t in idx['textures'] if t['name'] not in names] + entries
    json.dump(idx, open(idx_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
