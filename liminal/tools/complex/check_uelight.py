#!/usr/bin/env python3
"""
Our Unreal lamp GLSL (src/engine/render/ueLight.ts, as the world shader uses it) vs our Python model of it
(ue_lamps.py, which matches the game's own lamp step), on the game's own G-buffer: every lamp of the frame, run in
headless Chromium (SwiftShader).

    COMPLEX_DEEP=<deep>/deep python3 tools/complex/check_uelight.py <first export frame dir> [--every N]
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import check_camera as C  # noqa: E402
import deep  # noqa: E402
import ue_lamps as U  # noqa: E402

FRAG = """#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D t_P, t_N, t_base, t_mat, t_V, t_lamps;
uniform float u_count;
out vec4 o;
%UE_LIGHT%
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 P = texelFetch(t_P, p, 0).xyz, N = texelFetch(t_N, p, 0).xyz, base = texelFetch(t_base, p, 0).xyz;
  vec3 mat = texelFetch(t_mat, p, 0).xyz, V = texelFetch(t_V, p, 0).xyz;
  float metal = mat.x, rough = max(mat.z, 0.02);
  vec3 F0 = mix(vec3(0.08 * mat.y), base, metal);
  vec3 diffuseColor = base * (1.0 - metal);
  vec3 Eue = vec3(0.0), specUe = vec3(0.0);
  for (int i = 0; i < 128; i++) {
    if (float(i) >= u_count) break;
    vec3 pos = texelFetch(t_lamps, ivec2(0, i), 0).xyz, col = texelFetch(t_lamps, ivec2(1, i), 0).xyz;
    vec4 ue = texelFetch(t_lamps, ivec2(2, i), 0);
    vec3 axis = texelFetch(t_lamps, ivec2(3, i), 0).xyz;
    vec3 toL = pos - P;
    float fu = ueFalloff(toL, ue, axis);
    if (fu <= 0.0) continue;
    vec3 u = normalize(toL);
    vec3 Ei = col * fu;
    float NoL = clamp(dot(N, u), 0.0, 1.0);
    Eue += Ei * NoL;
    specUe += Ei * ueSpecular(N, V, u, NoL, F0, rough);
  }
  o = vec4(Eue / 3.14159265 * diffuseColor + specUe, 1.0);
}
"""


def main():
    fr = capture.Frame(sys.argv[1])
    dp = deep.Deep(fr.deep)
    every = int(sys.argv[sys.argv.index('--every') + 1]) if '--every' in sys.argv else 1
    g = U.gbuffer(fr, dp)
    sel = (slice(0, None, every), slice(0, None, every))
    g = {k: (v[sel] if isinstance(v, np.ndarray) and v.ndim >= 2 else v) for k, v in g.items()}
    lamps = U.lamp_params(fr)
    ours_py = U.ue_light(g, lamps, 1.0)
    H, W = g['P'].shape[:2]
    rgba = lambda a: np.concatenate([np.asarray(a, np.float32), np.ones(a.shape[:2] + (1,), np.float32)], -1)  # noqa: E731
    mat = np.stack([g['metal'], g['spec'], g['rough']], -1)
    lt = np.zeros((len(lamps), 4, 4), np.float32)
    for i, L in enumerate(lamps):
        lt[i, 0, :3] = L['pos'] / 2.54                       # inches
        lt[i, 1, :3] = L['color'] / 1e4                      # candela per channel
        lt[i, 2] = [L['invR'] * 2.54, L['spot'][0], L['spot'][1], 1]
        lt[i, 3, :3] = L['axis']
    out = C.gpu('lens', W, H, {'t_P': (rgba(g['P'] / 2.54), 'clamp'), 't_N': (rgba(g['N']), 'clamp'), 't_base': (rgba(g['base']), 'clamp'),
                              't_mat': (rgba(mat), 'clamp'), 't_V': (rgba(g['V']), 'clamp'), 't_lamps': (lt, 'clamp')},
                {'u_count': len(lamps)}, frag=FRAG)[..., :3]
    lit = g['model'] != 0
    rel = np.abs(out - ours_py).sum(-1) / np.maximum(np.abs(ours_py).sum(-1), 1e-6)
    print(f'{len(lamps)} lamps, {int(lit.sum())} pixels; mean GLSL {np.round(out[lit].mean(0), 6)}  Python {np.round(ours_py[lit].mean(0), 6)}')
    print(f'per pixel |GLSL - Python| / Python: median {np.median(rel[lit]):.2e}  p99 {np.percentile(rel[lit], 99):.2e}  max {rel[lit].max():.2e}')


if __name__ == '__main__':
    main()
