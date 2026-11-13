#!/usr/bin/env python3
"""Checks of dxbc.py's semantics on small hand-written programs (python3 tools/complex/test_dxbc.py)."""
import sys
import os
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dxbc  # noqa: E402

FAILS = []


def check(name, got, want, tol=0.0):
    got, want = np.asarray(got), np.asarray(want)
    ok = got.shape == want.shape and (np.array_equal(got, want) if tol == 0 else np.allclose(got, want, atol=tol, rtol=0))
    print(('ok   ' if ok else 'FAIL ') + name)
    if not ok:
        FAILS.append(name)
        print('   got ', got.ravel()[:12])
        print('   want', want.ravel()[:12])


def prog(body, decl='', stage='ps_5_0'):
    lines = [stage, decl] + ['%3d: %s' % (k, ln) for k, ln in enumerate([x.strip() for x in body.strip().split('\n')])]
    return dxbc.Program('\n'.join(lines))


def run_ps(p, W=4, H=2, cbs=None, **kw):
    return dxbc.run_pixels(p, W, H, cbs or {}, position_slot=0, **kw)


def outf(m, k=0):
    return dxbc.u2f(m.O[k])


# 1. float maths, swizzles, masks, modifiers, saturate
p = prog('''
mul r0.xy, v0.xyxx, l(0.500000, 0.250000, 0.000000, 0.000000)
add r0.z, -r0.x, r0.y
mad_sat r0.w, r0.x, l(0.100000), l(0.500000)
mov o0.xyzw, r0.wzyx
''')
m = run_ps(p)
x = (np.arange(8) % 4 + 0.5).astype(np.float32)
y = (np.arange(8) // 4 + 0.5).astype(np.float32)
r0x, r0y = (x * np.float32(0.5)).astype(np.float32), (y * np.float32(0.25)).astype(np.float32)
want = np.stack([np.clip((r0x.astype(np.float64) * np.float32(0.1) + 0.5).astype(np.float32), 0, 1), (r0y - r0x).astype(np.float32), r0y, r0x], 1)
check('float ops, swizzle, mask, neg, mad_sat', outf(m), want)

# 2. fused multiply-add rounds once
p = prog('''
mad r0.x, l(1.000000), l(1.000000), l(0.000000)
mov r1.x, l(0x3f800001)
mov r1.y, l(0x3f7ffffe)
mad r0.y, r1.x, r1.y, l(-1.000000)
mul r0.z, r1.x, r1.y
add r0.z, r0.z, l(-1.000000)
mov o0.xyzw, r0.xyzz
''')
m = run_ps(p, 2, 2)
a, b = np.float32(np.uint32(0x3f800001).view(np.float32)), np.float32(np.uint32(0x3f7ffffe).view(np.float32))
fused = np.float32(np.float64(a) * np.float64(b) - 1.0)
unfused = np.float32(np.float32(a * b) - np.float32(1))
check('mad fused, mul+add not', outf(m)[0, 1:3], [fused, unfused])
print('     (fused %r vs unfused %r)' % (fused, unfused))

# 3. integer ops: the LCG step in ps_19325, shifts, compare, movc
p = prog('''
ftoi r0.xy, v0.xyxx
imad r0.xy, r0.xyxx, l(0x0019660d, 0x0019660d, 0, 0), l(0x3c6ef35f, 0x3c6ef35f, 0, 0)
ushr r0.zw, r0.xxxy, l(0, 0, 16, 16)
ilt r1.x, r0.x, l(0)
movc r1.y, r1.x, l(7), l(9)
iadd r1.z, -r0.z, l(5)
mov o0.xyzw, r0.xyzw
mov o1.xyzw, r1.xyzw
''')
m = run_ps(p, 4, 2)
xi = (np.arange(8) % 4).astype(np.int64)
yi = (np.arange(8) // 4).astype(np.int64)
lx = (xi * 1664525 + 1013904223) & 0xFFFFFFFF
ly = (yi * 1664525 + 1013904223) & 0xFFFFFFFF
check('imad (LCG) and ushr', m.O[0][:, :4].astype(np.int64), np.stack([lx, ly, lx >> 16, ly >> 16], 1))
neg = lx >= 2 ** 31
check('ilt / movc / iadd with int negate', m.O[1][:, :3].astype(np.int64),
      np.stack([np.where(neg, 0xFFFFFFFF, 0), np.where(neg, 7, 9), (5 - (lx >> 16)) & 0xFFFFFFFF], 1))

# 4. flow: if/else, loop with breakc, continue
p = prog('''
ftoi r0.x, v0.x
mov r1.x, l(0)
mov r1.y, l(0)
if_nz r0.x
  mov r1.z, l(1.000000)
else
  mov r1.z, l(2.000000)
endif
loop
  ige r2.x, r1.y, r0.x
  breakc_nz r2.x
  iadd r1.y, r1.y, l(1)
  and r2.y, r1.y, l(1)
  continuec_nz r2.y
  iadd r1.x, r1.x, l(10)
endloop
mov o0.x, r1.x
mov o0.y, r1.y
mov o0.z, r1.z
mov o0.w, l(0)
''')
m = run_ps(p, 6, 2)
k = (np.arange(12) % 6)
check('if/else', dxbc.u2f(m.O[0][:, 2]), np.where(k != 0, 1.0, 2.0).astype(np.float32))
check('loop, breakc_nz, continuec_nz', m.O[0][:, :2].astype(np.int64), np.stack([10 * (k // 2), k], 1))

# 5. switch with fallthrough and default, ret inside if
p = prog('''
ftoi r0.x, v0.x
mov r1.x, l(0)
switch r0.x
  case l(0)
  case l(1)
  mov r1.x, l(100)
  break
  case l(2)
  mov r1.x, l(200)
  break
  default
  mov r1.x, l(300)
  break
endswitch
mov o0.x, r1.x
ige r2.x, r0.x, l(3)
if_nz r2.x
  mov o0.y, l(1)
  ret
endif
mov o0.y, l(2)
ret
''')
m = run_ps(p, 4, 2)
k = (np.arange(8) % 4)
check('switch / case fallthrough / default', m.O[0][:, 0], np.array([100, 100, 200, 300] * 2, np.uint32))
check('ret inside if', m.O[0][:, 1], np.array([2, 2, 2, 1] * 2, np.uint32))

# 6. indexable temps and dynamic constant-buffer index
p = prog('''
ftoi r0.x, v0.x
mov x0[0].x, l(5.000000)
mov x0[1].x, l(6.000000)
mov x0[2].x, l(7.000000)
mov x0[3].x, l(8.000000)
mov r1.x, x0[r0.x + 0].x
mov r1.y, cb0[r0.x + 1].y
mov o0.xyzw, r1.xyxy
''', 'dcl_indexableTemp x0[4], 4\ndcl_constantbuffer cb0[5], dynamicIndexed')
cb = dxbc.cb_from_floats([[0, k * 10 + 0.5, 0, 0] for k in range(5)])
m = run_ps(p, 4, 2, cbs={0: cb})
check('indexable temp x0[r + 0]', outf(m)[:4, 0], np.array([5, 6, 7, 8], np.float32))
check('cb0[r + 1] dynamic index', outf(m)[:4, 1], np.array([10.5, 20.5, 30.5, 40.5], np.float32))

# 7. structured buffer read, bilinear sample with clamp, 3D sample
p = prog('''
ld_structured_indexable(structured_buffer, stride=16)(mixed,mixed,mixed,mixed) r0.xyzw, l(1), l(0), t0.xyzw
mul r1.xy, v0.xyxx, l(0.250000, 0.500000, 0.000000, 0.000000)
sample_indexable(texture2d)(float,float,float,float) r2.xyzw, r1.xyxx, t1.xyzw, s0
sample_l_indexable(texture3d)(float,float,float,float) r3.xyzw, l(0.500000, 0.500000, 0.500000, 0.000000), t2.xyzw, s0, l(0.000000)
mov o0.xyzw, r0.xyzw
mov o1.xyzw, r2.xyzw
mov o2.xyzw, r3.xyzw
''', 'dcl_resource_structured t0, 16\ndcl_resource_texture2d (float,float,float,float) t1\ndcl_resource_texture3d (float,float,float,float) t2\ndcl_sampler s0, mode_default')
buf = dxbc.Buffer(np.array([[0, 0, 0, 0], [1.5, 2.5, 3.5, 4.5]], np.float32).view(np.uint32), stride=16)
img = np.zeros((2, 4, 4), np.float32)
img[..., 0] = np.arange(4)[None, :]
img[..., 1] = np.arange(2)[:, None] * 10
vol = np.random.RandomState(1).rand(2, 2, 2, 4).astype(np.float32)
m = run_ps(p, 4, 2, textures={0: buf, 1: dxbc.Texture(img), 2: dxbc.Texture(vol, dim=3)}, samplers={0: dxbc.Sampler()})
check('ld_structured element 1', outf(m)[0], np.array([1.5, 2.5, 3.5, 4.5], np.float32))
check('bilinear at texel centres = texels', outf(m, 1)[:, :2], img.reshape(-1, 4)[:, :2])
check('trilinear 3D centre = mean of 8', outf(m, 2)[0], vol.reshape(-1, 4).mean(0), 1e-6)

# 8. compute: group shared memory, barrier, reduction, store_uav_typed
p = prog('''
store_structured g0.x, vThreadIDInGroupFlattened.x, l(0), vThreadIDInGroupFlattened.x
sync_g_t
ult r0.x, vThreadIDInGroupFlattened.x, l(4)
if_nz r0.x
  iadd r0.y, vThreadIDInGroupFlattened.x, l(4)
  ld_structured r0.z, r0.y, l(0), g0.xxxx
  ld_structured r0.w, vThreadIDInGroupFlattened.x, l(0), g0.xxxx
  iadd r0.z, r0.z, r0.w
  store_structured g0.x, vThreadIDInGroupFlattened.x, l(0), r0.z
endif
sync_g_t
ld_structured r1.x, l(0), l(0), g0.xxxx
utof r1.x, r1.x
mov r2.xy, vThreadID.xyxx
store_uav_typed u0.xyzw, r2.xyyy, r1.xxxx
''', 'dcl_uav_typed_texture2d (float,float,float,float) u0\ndcl_tgsm_structured g0, 4, 8\ndcl_thread_group 8, 1, 1', 'cs_5_0')
out = dxbc.Texture(np.zeros((2, 16, 4), np.float32))
m = dxbc.run_compute(p, (2, 2, 1), {}, uavs={0: out})
# thread 0 of each group ends with g0[0] = 0 + 4 = 4 (one pairwise step)
check('compute: tgsm, barrier, uav store', out.levels[0][:, :, 0], np.full((2, 16), 4.0, np.float32))

# 9. formats: R11G11B10 and 10-bit unorm rounding
v = np.array([[0.123456, 1.0e-5, 70000.0, 0.5]], np.float32)
q = dxbc.quantize(v, 'R11G11B10_FLOAT')
check('R11G11B10: 6-bit mantissa', q[0, 0], np.float32(0.123046875))
check('R11G11B10: blue (5-bit) clamps to 64512', q[0, 2], np.float32(64512.0))
check('R10G10B10A2_UNORM', dxbc.quantize(np.array([[0.5, 1 / 1023.0 * 0.49, 1.2, 0.4]], np.float32), 'R10G10B10A2_UNORM')[0],
      np.array([512 / 1023.0, 0, 1, 1 / 3.0], np.float32), 1e-7)

# 10. snapping of 6-decimal immediates
for txt, want in (('0.003906', 1 / 256), ('-0.001953', -1 / 512), ('0.071429', 1 / 14), ('0.041667', 1 / 24),
                  ('543.309998', np.float32(543.31)), ('0.002668', np.float32(0.002668))):
    check('snap %s' % txt, dxbc._snap(txt), np.float32(want))

print('\n%d failed' % len(FAILS) if FAILS else '\nall passed')
sys.exit(1 if FAILS else 0)
