#!/usr/bin/env python3
"""
ue_lamps.py: our own code for The Complex's lamps (Unreal's deferred point/spot light, written from its published
formulas), run on the game's own G-buffer from the deep export, and compared with what the real graphics card
added for the lamps (scene light after the lamps minus before them).

    COMPLEX_DEEP=<deep>/deep python3 tools/complex/ue_lamps.py <first export frame dir> [--every N]

The model, per lamp (the frame's lamps: no source size, inverse-square falloff, no shadows, no contact shadows):
  d2 = |lamp - P|^2 (cm^2), l = unit vector to the lamp
  falloff = 1 / (d2 + 1) * saturate(1 - (d2 / R^2)^2)^2          (R = the lamp's reach)
  cone    = saturate((dot(l, D) - cos_outer) * k)^2                 (D: the light's axis, towards it; k = 1 / (cos_inner - cos_outer))
  light   = colour * falloff * cone * saturate(N.l) * (diffuse + specular)
  diffuse = base * (1 - metallic) / pi
  specular: GGX D(a2 = roughness^4) * Smith-joint visibility (approx.) * Schlick F, F0 = lerp(0.08 specular, base, metallic)
Written to be ported 1:1 to GLSL (src/engine/render/ueLight.ts).
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import check_lamps as CL  # noqa: E402
import deep  # noqa: E402

f32 = np.float32


def gbuffer(fr, dp, step=374):
    """Per pixel of the view: translated-world position (cm), unit normal, base colour (linear), metallic, specular,
    roughness, shading model, and the unit vector to the camera; from the frame's own buffers and view numbers."""
    st = fr.steps[step]
    c0 = fr.deep_constants(st, 'ps', draw=0)[0].view(np.float32).astype(np.float64)
    gb = max(t['step'] for t in dp.targets if t['step'] < step and 'BasePass' in ' / '.join(t['markers']))
    reads = {r['binding']: int(r['id'].split('::')[1]) for v in st['reads']['ps'].values() for r in v}
    depth = CL.by_id(dp, gb, reads['texture2'])[..., 0].astype(np.float64)
    A = CL.by_id(dp, gb, reads['texture3']).astype(np.float64)
    B = CL.by_id(dp, gb, reads['texture4']).astype(np.float64)
    C = CL.by_id(dp, gb, reads['texture5']).astype(np.float64)
    vw, vh = 1008, 756
    depth, A, B, C = depth[:vh, :vw], A[:vh, :vw], B[:vh, :vw], C[:vh, :vw]
    ys, xs = np.mgrid[0:vh, 0:vw]
    ndc = np.stack([(xs + 0.5) / vw * 2 - 1, 1 - (ys + 0.5) / vh * 2], -1)
    z = 1 / (depth * c0[71, 2] - c0[71, 3]) + depth * c0[71, 0] + c0[71, 1]
    xy = ndc * z[..., None]
    P = xy[..., 1:2] * c0[57, :3] + xy[..., 0:1] * c0[56, :3] + z[..., None] * c0[58, :3] + c0[59, :3]
    N = A[..., :3] * 2 - 1
    N /= np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-9)
    base = CL.srgb_to_linear(C[..., :3]).astype(np.float64)
    model = np.rint(B[..., 3] * 255).astype(int) & 15
    V = c0[74, :3] - P
    V /= np.maximum(np.linalg.norm(V, axis=-1, keepdims=True), 1e-9)
    return dict(P=P, N=N, base=base, metal=B[..., 0], spec=B[..., 1], rough=B[..., 2], model=model, V=V, pre=c0, z=z)


def lamp_params(fr, step=374):
    st = fr.steps[step]
    rec = fr._deep_steps()[step]
    out = []
    for j in range(len(rec['draws'])):
        c1 = fr.deep_constants(st, 'ps', draw=j)[1].view(np.float32).astype(np.float64)
        out.append(dict(pos=c1[3, :3], invR=c1[3, 3], color=c1[4, :3], falloffExp=c1[4, 3], axis=c1[5, :3], specScale=c1[5, 3],
                        spot=c1[7, :2]))
    return out


def ue_light(g, lamps, pre_exposure):
    P, N, V = g['P'], g['N'], g['V']
    base, metal, spec, rough = g['base'], g['metal'][..., None], g['spec'][..., None], g['rough']
    diffuse_c = base * (1 - metal)
    F0 = 0.08 * spec * (1 - metal) + base * metal
    a = np.maximum(rough, 0.02) ** 2           # alpha = roughness^2 (clamped like the engine's minimum roughness)
    a2 = a * a
    NoV = np.clip(np.sum(N * V, -1), 1e-5, 1)
    total = np.zeros(P.shape, np.float64)
    for L in lamps:
        Lv = L['pos'] - P
        d2 = np.sum(Lv * Lv, -1)
        l = Lv / np.sqrt(np.maximum(d2, 1e-12))[..., None]
        window = np.clip(1 - (d2 * L['invR'] ** 2) ** 2, 0, 1) ** 2
        fall = window / (d2 + 1) if L['falloffExp'] == 0 else np.clip(1 - np.minimum(d2 * L['invR'] ** 2, 1), 0, 1) ** L['falloffExp']
        cone = np.clip((np.sum(l * L['axis'], -1) - L['spot'][0]) * L['spot'][1], 0, 1) ** 2
        NoL = np.clip(np.sum(N * l, -1), 0, 1)
        H = V + l
        H /= np.maximum(np.linalg.norm(H, axis=-1, keepdims=True), 1e-9)
        NoH = np.clip(np.sum(N * H, -1), 0, 1)
        VoH = np.clip(np.sum(V * H, -1), 0, 1)
        dd = (NoH * a2 - NoH) * NoH + 1
        D = a2 / (np.pi * dd * dd)
        sa = np.sqrt(a2)
        vis = 0.5 / (NoL * (NoV * (1 - sa) + sa) + NoV * (NoL * (1 - sa) + sa) + 1e-12)
        Fc = (1 - VoH) ** 5
        F = np.clip(50 * F0[..., 1:2], 0, 1) * Fc[..., None] + (1 - Fc[..., None]) * F0
        brdf = diffuse_c / np.pi + (D * vis)[..., None] * F * L['specScale']
        total += L['color'] * (fall * cone * NoL)[..., None] * brdf
    return total * pre_exposure


def main():
    fr = capture.Frame(sys.argv[1])
    dp = deep.Deep(fr.deep)
    g = gbuffer(fr, dp)
    lamps = lamp_params(fr)
    every = int(sys.argv[sys.argv.index('--every') + 1]) if '--every' in sys.argv else 1
    eye = np.frombuffer(dp.buffer(8180), np.float32)
    pre = float(eye[0])
    sel = (slice(0, None, every), slice(0, None, every))
    gs = {k: (v[sel] if isinstance(v, np.ndarray) and v.ndim >= 2 else v) for k, v in g.items()}
    ours = ue_light(gs, lamps, pre)
    before = CL.by_id(dp, 370, 47190)[..., :3][:756, :1008][sel]
    after = CL.by_id(dp, 374, 47190)[..., :3][:756, :1008][sel]
    real = after - before
    lit = gs['model'] != 0
    rel = np.abs(ours - real).sum(-1) / np.maximum(np.abs(real).sum(-1), 1e-3)
    print(f'{len(lamps)} lamps, pre-exposure {pre:.4f}; mean ours {np.round(ours[lit].mean(0), 5)}  real {np.round(real[lit].mean(0), 5)}')
    print(f'per pixel |ours - real| / real: median {np.median(rel[lit]):.4f}  p90 {np.percentile(rel[lit], 90):.4f}  p99 {np.percentile(rel[lit], 99):.4f}')
    print('shading models present:', dict(zip(*np.unique(gs['model'], return_counts=True))))


if __name__ == '__main__':
    main()
