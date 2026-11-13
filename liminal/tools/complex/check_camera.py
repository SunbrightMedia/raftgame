#!/usr/bin/env python3
"""
The Complex camera passes: ours (src/engine/render/complexCamera.ts, run in headless Chromium) vs the game's own
compiled steps (run by dxbc.py with the capture's constants), on the same inputs.

    python3 tools/complex/check_camera.py <capture frame dir> [pass ...]     (passes: tonemap sharpen posterize
                                                                             grain tape lens; default all)

Inputs are made from seeds: random pictures already rounded to their storage (10-bit, R11G11B10 float), our own
noise and dirt images (the game's are not copied), our tone table. Both sides get the same inputs and the same
sampling (bilinear; clamp, or repeat for noise). Reported per pass: how many stored 10-bit values are equal, and
the largest difference in 10-bit steps.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import dxbc  # noqa: E402

W, H = 1440, 1080
CLAMP = dxbc.Sampler('linear', ('clamp', 'clamp', 'clamp'))
WRAP = dxbc.Sampler('linear', ('wrap', 'wrap', 'wrap'))
# the post-process materials read their input picture by nearest pixel (checked against the real output)
POINT = dxbc.Sampler('point', ('clamp', 'clamp', 'clamp'))


def q10(a):
    return np.rint(np.clip(np.nan_to_num(a), 0, 1) * 1023)


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a, np.float32).tobytes()).decode()


def rgba(a):
    a = np.asarray(a, np.float32)
    if a.shape[-1] == 4:
        return a
    out = np.zeros(a.shape[:-1] + (4,), np.float32)
    out[..., :a.shape[-1]] = a
    return out


def gpu(pass_name, w, h, textures, uniforms, frag=None):
    """textures: {uniform name: (array (H, W, 4) or (D, H, W, 4), 'clamp'|'repeat')}"""
    job = {'pass': pass_name, 'frag': frag, 'w': w, 'h': h, 'uniforms': {k: [float(x) for x in np.atleast_1d(v)] for k, v in uniforms.items()},
           'textures': {}}
    for name, (arr, wrap) in textures.items():
        arr = rgba(arr)
        t = {'w': arr.shape[-2], 'h': arr.shape[-3], 'wrap': wrap, 'data': b64(arr)}
        if arr.ndim == 4:
            t['d'] = arr.shape[0]
        job['textures'][name] = t
    with tempfile.TemporaryDirectory() as td:
        jf, of = os.path.join(td, 'job.json'), os.path.join(td, 'out.json')
        json.dump(job, open(jf, 'w'))
        r = subprocess.run(['node', os.path.join(HERE, 'run_camera.cjs'), jf, of], cwd=ROOT, capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stdout + r.stderr)
        res = json.load(open(of))
    return np.frombuffer(base64.b64decode(res['data']), np.float32).reshape(h, w, 4)


def emu(prog, w, h, cbs, textures, samplers, inputs=None, exact_math=False):
    m = dxbc.run_pixels(prog, w, h, cbs, textures=textures, samplers=samplers, inputs=inputs, position_slot=0, exact_math=exact_math)
    return dxbc.u2f(m.O[0]).reshape(h, w, 4)


def report(name, game, ours, note=''):
    g, o = q10(game[..., :3]), q10(ours[..., :3])
    d = np.abs(g - o)
    eq = (d == 0).mean() * 100
    hist = {int(k): int(v) for k, v in zip(*np.unique(d, return_counts=True)) if k > 0}
    print(f'{name:10s} stored 10-bit values equal {eq:9.5f} %   largest difference {int(d.max())} steps   others {hist}  {note}')
    return d


def vals(cb, row):
    return cb.view(np.float32)[row]


def view_uniforms(cb0):
    v37 = cb0[37]   # uint
    return {'u_view': [float(v37[0]), float(v37[1])], 'u_inv': vals(cb0, 38)[2:4], 'u_map': np.concatenate([vals(cb0, 5)[:2], vals(cb0, 4)[:2]]),
            'u_clampP': vals(cb0, 6)}


# ---------------------------------------------------------------- inputs
rs = np.random.RandomState(7)


def ldr_picture(w=W, h=H):
    """A 10-bit picture: smooth gradients, flat areas and fine noise (row 0 = top)."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    a = np.stack([0.5 + 0.45 * np.sin(x / 37.0 + y / 91.0), 0.5 + 0.45 * np.sin(x / 53.0 - y / 29.0), (x + y) / (w + h)], -1)
    a += rs.normal(0, 0.03, a.shape)
    a[: h // 8] = 0.7                       # a flat band
    a[h // 8: h // 4, : w // 3] = rs.rand(h // 8, w // 3, 3)   # pure noise
    return q10(a) / 1023


def noise_picture(w, h, sparse=False):
    a = rs.rand(h, w, 3).astype(np.float32)
    if sparse:
        a = np.where(rs.rand(h, w, 1) < 0.05, a, a * 0.05)
    return np.round(a * 255) / 255


# ---------------------------------------------------------------- passes
def check_posterize(fr):
    st = fr.find('ps_19321')
    cbs = fr.constants(st, 'ps')
    src = ldr_picture()
    game = emu(fr.program('ps_19321'), W, H, cbs, {0: dxbc.Texture(rgba(src))}, {0: POINT})
    cb1 = vals(cbs[1], 1)
    ours = gpu('posterize', W, H, {'t_src': (src, 'clamp')}, {**view_uniforms(cbs[0]), 'u_blend': cb1[0], 'u_blendColor': cb1[1:4]})
    return report('posterize', game, ours)


def check_sharpen(fr):
    st = fr.find('ps_8881')
    cbs = fr.constants(st, 'ps')
    src = ldr_picture()
    game = emu(fr.program('ps_8881'), W, H, cbs, {0: dxbc.Texture(rgba(src))}, {0: POINT})
    cb1 = cbs[1].view(np.float32)
    ours = gpu('sharpen', W, H, {'t_src': (src, 'clamp')}, {**view_uniforms(cbs[0]), 'u_amount': cb1[1, 0], 'u_blend': cb1[1, 1], 'u_blendColor': cb1[2, :3]})
    return report('sharpen', game, ours)


def check_grain(fr, clock=None):
    st = fr.find('ps_19323')
    cbs = fr.constants(st, 'ps')
    if clock is not None:      # the game clock moves the noise by time x (9, 4); a large offset costs float precision
        c1 = cbs[1].view(np.float32).copy()
        c1[143, 1] = clock
        cbs[1] = c1.view(np.uint32)
    src, noise = ldr_picture(), noise_picture(350, 262, sparse=True)
    game = emu(fr.program('ps_19323'), W, H, cbs, {0: dxbc.Texture(rgba(noise)), 1: dxbc.Texture(rgba(src))}, {0: WRAP, 1: POINT})
    c1, c2 = cbs[1].view(np.float32), cbs[2].view(np.float32)
    ours = gpu('grain', W, H, {'t_noise': (noise, 'repeat'), 't_src': (src, 'clamp')},
               {**view_uniforms(cbs[0]), 'u_time': c1[143, 1], 'u_tile': c2[1, 0], 'u_keep': c2[1, 3], 'u_lift': c2[2, 1],
                'u_hi': c2[2, 3], 'u_lo': c2[2, 2], 'u_blend': c2[3, 0], 'u_blendColor': c2[3, 1:4]})
    return report('grain', game, ours, '' if clock is None else f'(clock {clock} s)')


TAPE_EXACT = {}   # filled from the shader's bytes when the deep export has them


def tape_program(fr):
    """ps_19325 with two numbers the disassembly prints too coarsely set to what they stand for: Unreal's PCG
    hash constant 1013904223 (printed as the float 0.014584) and the hash's 16-bit scale (printed 0.000015,
    taken as 1/65536). Our code uses the same; the shader's bytes (deep export) will settle the second."""
    p = fr.program('ps_19325')
    if getattr(p, 'exact', False):      # from the shader's bytes: nothing to set
        return p
    for ins in p.code:
        for a in ins.args:
            if a.file != 'l':
                continue
            parts = [x.strip() for x in a.text[2:-1].split(',')]
            if '0.014584' in parts:
                v = [1013904223 if x == '0.014584' else 0 for x in parts]
                a.imm = np.array(v * 4 if len(v) == 1 else v, np.uint32)
            elif parts[0] == '0.000015':
                a.imm = np.full(4, np.float32(1 / 65536).view(np.uint32), np.uint32)
    return p


def check_tape(fr):
    st = fr.find('ps_19325')
    cbs = fr.constants(st, 'ps')
    src, noise, band = ldr_picture(), noise_picture(128, 128), noise_picture(236, 315)
    game = emu(tape_program(fr), W, H, cbs, {0: dxbc.Texture(rgba(noise)), 1: dxbc.Texture(rgba(band)), 2: dxbc.Texture(rgba(src))}, {0: WRAP, 1: WRAP, 2: POINT})
    c1, c2 = cbs[1].view(np.float32), cbs[2].view(np.float32)
    ours = gpu('tape', W, H, {'t_noise': (noise, 'repeat'), 't_band': (band, 'repeat'), 't_src': (src, 'clamp')},
               {**view_uniforms(cbs[0]), 'u_time': c1[143, 1], 'u_rows': c1[129, 1], 'u_rate': c2[4, 3], 'u_tile': c2[1, 0],
                'u_keep': c2[1, 3], 'u_liftK': c2[2, 2], 'u_lift2': c2[2, 1], 'u_mix': c2[5, 3], 'u_blend': c2[6, 0],
                'u_colA': c2[4, :3], 'u_colB': c2[5, :3], 'u_blendColor': c2[6, 1:4]})
    return report('tape', game, ours)


def lens_constants(fov, W_, H_):
    """complexCamera.ts lensConstants, the same float32 steps (checked against the TS by tests/complex.test.ts)."""
    f = np.float32
    a = f(f(fov) * f(0.7))
    a2 = f(f(fov) * f(0.70000005))      # the step's tangent uses this one (its bytes say so)
    tn = f(f(np.sin(np.float64(a2))) / f(np.cos(np.float64(a2))))
    fpx = f(f(W_) / tn)
    diag = f(np.sqrt(np.float64(f(f(f(W_) * f(W_)) + f(f(H_) * f(H_))))))
    x = f(diag / fpx)
    ax = abs(x)
    m = f(f(1 / max(ax, f(1))) * min(ax, f(1)))
    m2 = f(m * m)
    p = f(np.float64(m2) * f(0.0208351) + f(-0.085133))
    p = f(np.float64(m2) * p + f(0.180141))
    p = f(np.float64(m2) * p + f(-0.3302995))
    p = f(np.float64(m2) * p + f(0.999866))
    corr = f(np.float64(f(m * p)) * -2 + f(1.5707964)) if 1 < ax else f(0)
    r = f(np.float64(m) * p + corr)
    r = -r if min(x, 1) < -min(x, 1) else r
    k = f(np.sin(np.float64(f(r * f(1.0000001)))))
    return {'a': a, 'k': k, 'diagW': f(diag / f(W_)), 'hw': [1.0, f(f(H_) / f(W_))]}


def check_lens(fr):
    st = fr.find('ps_19327')
    cbs = fr.constants(st, 'ps')
    src = ldr_picture()
    game = emu(fr.program('ps_19327'), W, H, cbs, {0: dxbc.Texture(rgba(src))}, {0: POINT})
    c1, c2 = cbs[1].view(np.float32), cbs[2].view(np.float32)
    L = lens_constants(c1[127, 0], c1[129, 0], c1[129, 1])
    ours = gpu('lens', W, H, {'t_src': (src, 'clamp')}, {**view_uniforms(cbs[0]), 'u_a': L['a'], 'u_k': L['k'], 'u_diagW': L['diagW'],
                                                        'u_hw': L['hw'], 'u_blend': c2[1, 0], 'u_blendColor': c2[1, 1:4]})
    return report('lens', game, ours)


def tonemap_inputs():
    """Scene (1440 x 1080) and glow (1020 x 764) in pre-exposed units, rounded to R11G11B10; our dirt; our table."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    lin = np.exp(np.stack([np.sin(x / 61.0) * 4 - 2, np.sin(y / 47.0 + x / 90.0) * 4 - 2, np.cos(x / 33.0 - y / 77.0) * 4 - 3], -1))
    lin *= np.exp(rs.normal(0, 0.3, lin.shape))
    pre = np.float32(34.1333275)
    scene = dxbc.quantize(rgba(lin * pre), 'R11G11B10_FLOAT')
    by, bx = np.mgrid[0:764, 0:1020].astype(np.float32)
    bloom = dxbc.quantize(rgba(np.stack([np.exp(np.sin(bx / 40.0) * 2 - 3)] * 3, -1) * pre), 'R11G11B10_FLOAT')
    dirt = np.round(rs.rand(288, 432, 3) * 0.06 * 255) / 255
    return scene, bloom, dirt


def our_tone_table():
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, 'ours.f32')
        subprocess.run(['npx', 'vite-node', 'tools/complex/dump_tone.ts', '--', out], cwd=ROOT, check=True, capture_output=True)
        t = np.fromfile(out, np.float32).reshape(32, 32, 32, 4)
    return dxbc.quantize(t, 'R10G10B10A2_UNORM')


def check_tonemap(fr):
    st = fr.find('ps_8878')
    cbs = fr.constants(st, 'ps')
    c0, c1 = cbs[0].view(np.float32), cbs[1].view(np.float32)
    scene, bloom, dirt = tonemap_inputs()
    lut = our_tone_table()
    exposure, apply_ = np.float32(34.1333275), np.array([0.8, 0.8, 0.8, 1], np.float32)   # the game's (deep export)
    vig_scale = np.array([1, 0.75], np.float32) * np.float32(np.sqrt(2) / np.sqrt(1 + 0.75 ** 2))
    dither_off = np.array([0.123, 0.456], np.float32)
    # the vertex step's interpolants, computed as our shader computes them from gl_FragCoord
    ys, xs = np.mgrid[0:H, 0:W]
    fc = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1).astype(np.float32)
    uv = (fc * c0[9, 2:4]).astype(np.float32)
    cpos = (uv.astype(np.float64) * [2, -2] + [-1, 1]).astype(np.float32)
    v0 = np.concatenate([uv, (cpos * vig_scale).astype(np.float32)], 1)
    v1 = np.concatenate([np.zeros_like(uv), (uv + dither_off).astype(np.float32)], 1)
    v2 = np.concatenate([cpos, np.zeros_like(cpos)], 1)

    def run(lut_):
        tex = {0: dxbc.Buffer(np.array([exposure, 0, 0, 0], np.float32).view(np.uint32), stride=16), 1: dxbc.Texture(scene),
               2: dxbc.Texture(bloom), 3: dxbc.Buffer(apply_.view(np.uint32), stride=16), 4: dxbc.Texture(rgba(dirt)), 5: dxbc.Texture(lut_, dim=3)}
        game = emu(fr.program('ps_8878'), W, H, cbs, tex, {0: CLAMP, 1: CLAMP, 2: CLAMP, 3: CLAMP}, inputs={0: v0, 1: v1, 2: v2})
        ours = gpu('tonemap', W, H, {'t_scene': (scene, 'clamp'), 't_bloom': (bloom, 'clamp'), 't_dirt': (dirt, 'clamp'), 't_lut': (lut_, 'clamp')},
                   {'u_pos': c0[45], 'u_ca': c0[43], 'u_caMap': c0[46], 'u_vp': c0[10], 'u_size': c0[9], 'u_clamp': c0[15],
                    'u_bloomUV': c0[33], 'u_bloomClamp': c0[34], 'u_tint': c0[41, :3], 'u_dirtK': c0[42, :3], 'u_apply': apply_[:3],
                    'u_lut': c0[47, 2:4], 'u_vigScale': vig_scale, 'u_dither': dither_off, 'u_vig': c0[44, 0], 'u_invPre': c1[136, 2],
                    'u_exposure': exposure})
        return game, ours
    g_full, o_full = run(lut)
    g_d, o_d = run(np.zeros_like(lut))          # all-zero table: the output is the dither alone
    report('tonemap', g_full - g_d, o_full - o_d, '(without the dither)')
    for name, d in (('game', g_d), ('ours', o_d)):
        v = d[..., 0]
        print(f'           dither {name}: mean {v.mean() * 1023:+.4f} steps, range {v.min() * 512:+.3f} .. {v.max() * 512:+.3f} (x 1/512), std {v.std() * 1023:.4f} steps')
    return report('tonemap', g_full, o_full, '(with each side\'s own dither)')


CHECKS = {'tonemap': check_tonemap, 'grain0': lambda fr: check_grain(fr, 0.0), 'posterize': check_posterize, 'sharpen': check_sharpen, 'grain': check_grain, 'tape': check_tape, 'lens': check_lens}


def main():
    fr = capture.Frame(sys.argv[1])
    names = sys.argv[2:] or list(CHECKS)
    for n in names:
        CHECKS[n](fr)


if __name__ == '__main__':
    main()
