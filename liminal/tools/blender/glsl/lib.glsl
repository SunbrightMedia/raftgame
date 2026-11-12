// Shared GLSL for the Blender compositor port (generated passes include this). Our own code, written to match
// tools/blender/compeval.py (which matches Blender 5.3). Images: row 0 at the bottom, texel (x, y).
precision highp float;
precision highp int;
precision highp sampler2D;

// ---- wrap modes: 0 clip (zero outside), 1 extend, 2 repeat (Blender's wrap_coord)
int wrapc(float u, int size, int mode) {
  if (u >= 0.0) {
    if (u < float(size)) return int(u);
    if (mode == 1) return size - 1;
    if (mode == 2) return int(uint(u) % uint(size));
    return -1;
  }
  if (mode == 1) return 0;
  if (mode == 2) { int x = int(uint(-floor(u)) % uint(size)); return x != 0 ? size - x : 0; }
  return -1;
}
vec4 fetchz(sampler2D t, int x, int y) { return (x < 0 || y < 0) ? vec4(0.0) : texelFetch(t, ivec2(x, y), 0); }
vec4 fetchx(sampler2D t, ivec2 size, ivec2 p) { return texelFetch(t, clamp(p, ivec2(0), size - 1), 0); }

// Result::sample at texel-space coordinates tc (normalized * size); interp 0 nearest, 1 bilinear, 2 bicubic
vec4 sample_t(sampler2D t, ivec2 size, vec2 tc, int interp, int mx, int my, bool four) {
  if (interp == 0) return fetchz(t, wrapc(tc.x, size.x, mx), wrapc(tc.y, size.y, my));
  float u = tc.x - 0.5, v = tc.y - 0.5;
  if (interp == 1) {
    int x1 = wrapc(u, size.x, mx), x2 = wrapc(u + 1.0, size.x, mx);
    int y1 = wrapc(v, size.y, my), y2 = wrapc(v + 1.0, size.y, my);
    float a = u - floor(u), b = v - floor(v);
    float a_b = a * b, ma_b = (1.0 - a) * b, a_mb = a * (1.0 - b), ma_mb = (1.0 - a) * (1.0 - b);
    vec4 r1 = fetchz(t, x1, y1), r2 = fetchz(t, x1, y2), r3 = fetchz(t, x2, y1), r4 = fetchz(t, x2, y2);
    if (four) return (ma_mb * r1 + a_mb * r3) + (ma_b * r2 + a_b * r4);
    return ((ma_mb * r1 + a_mb * r3) + ma_b * r2) + a_b * r4;
  }
  float fu = u - floor(u), fv = v - floor(v);
  vec4 wx, wy;
  {
    float t2 = fu * fu, t3 = t2 * fu, w3 = t3 * (1.0 / 6.0);
    float w0 = ((-w3 + t2 * 0.5) - fu * 0.5) + (1.0 / 6.0), w1 = (t3 * 0.5 - t2 * 1.0) + (2.0 / 3.0);
    wx = vec4(w0, w1, ((1.0 - w0) - w1) - w3, w3);
  }
  {
    float t2 = fv * fv, t3 = t2 * fv, w3 = t3 * (1.0 / 6.0);
    float w0 = ((-w3 + t2 * 0.5) - fv * 0.5) + (1.0 / 6.0), w1 = (t3 * 0.5 - t2 * 1.0) + (2.0 / 3.0);
    wy = vec4(w0, w1, ((1.0 - w0) - w1) - w3, w3);
  }
  vec4 o = vec4(0.0);
  for (int n = 0; n < 4; n++) {
    int y1 = wrapc(v - 1.0 + float(n), size.y, my);
    if (y1 < 0) continue;
    for (int m = 0; m < 4; m++) {
      int x1 = wrapc(u - 1.0 + float(m), size.x, mx);
      if (x1 < 0) continue;
      o += texelFetch(t, ivec2(x1, y1), 0) * (wx[m] * wy[n]);
    }
  }
  return o;
}

// ---- implicit conversions
float lum(vec4 c) { return (c.r * 0.2126 + c.g * 0.7152) + c.b * 0.0722; }

// ---- HSV (BLI rgb_to_hsv / hsv_to_rgb)
vec3 rgb2hsv(vec3 c) {
  float r = c.r, g = c.g, b = c.b, k = 0.0;
  if (g < b) { float s = g; g = b; b = s; k = -1.0; }
  float min_gb = b;
  if (r < g) { float s = r; r = g; g = s; k = -2.0 / 6.0 - k; min_gb = min(g, b); }
  float chroma = r - min_gb;
  return vec3(abs(k + (g - b) / (6.0 * chroma + 1e-20)), chroma / (r + 1e-20), r);
}
vec3 hsv2rgb(vec3 hsv) {
  float h = hsv.x * 6.0;
  float nr = clamp(abs(h - 3.0) - 1.0, 0.0, 1.0), ng = clamp(2.0 - abs(h - 2.0), 0.0, 1.0), nb = clamp(2.0 - abs(h - 4.0), 0.0, 1.0);
  return vec3(((nr - 1.0) * hsv.y + 1.0) * hsv.z, ((ng - 1.0) * hsv.y + 1.0) * hsv.z, ((nb - 1.0) * hsv.y + 1.0) * hsv.z);
}

// ---- safe math (BLI)
float sdiv(float a, float b) { return b != 0.0 ? a / b : 0.0; }
float spow(float a, float b) { return (a < 0.0 && b != trunc(b)) ? 0.0 : pow_cr(a, b); }
float slog(float a, float b) { return (a <= 0.0 || b <= 0.0) ? 0.0 : sdiv(log_cr(a), log_cr(b)); }
float ssqrt(float a) { return sqrt_cr(max(a, 0.0)); }
float sfmod(float a, float b) { return b != 0.0 ? a - b * trunc(a / b) : 0.0; }
float sflmod(float a, float b) { return b != 0.0 ? a - floor(a / b) * b : 0.0; }

// ---- Blender's Jenkins hash (lookup3) on float bits
uint rotu(uint x, uint k) { return (x << k) | (x >> (32u - k)); }
uint hfinal(uint a, uint b, uint c) {
  c ^= b; c -= rotu(b, 14u); a ^= c; a -= rotu(c, 11u); b ^= a; b -= rotu(a, 25u);
  c ^= b; c -= rotu(b, 16u); a ^= c; a -= rotu(c, 4u); b ^= a; b -= rotu(a, 14u);
  c ^= b; c -= rotu(b, 24u);
  return c;
}
uint hash1u(uint kx) { uint a = 0xdeadbeefu + (1u << 2u) + 13u; uint b = a, c = a; a += kx; return hfinal(a, b, c); }
uint hash2u(uint kx, uint ky) { uint a = 0xdeadbeefu + (2u << 2u) + 13u; uint b = a, c = a; b += ky; a += kx; return hfinal(a, b, c); }
uint hash3u(uint kx, uint ky, uint kz) { uint a = 0xdeadbeefu + (3u << 2u) + 13u; uint b = a, c = a; c += kz; b += ky; a += kx; return hfinal(a, b, c); }
// float(uint) on some GPUs rounds twice for values >= 2^31 (SwiftShader: 16% of them wrong); this rounds once.
float u2f(uint h) { return (float(h >> 8u) * 256.0) * xone() + float(h & 255u); }
float u01(uint h) { return u2f(h) * (1.0 / 4294967296.0); }
float hashf1(float x) { return u01(hash1u(floatBitsToUint(x))); }
float hashf2(float x, float y) { return u01(hash2u(floatBitsToUint(x), floatBitsToUint(y))); }
float hashf3(float x, float y, float z) { return u01(hash3u(floatBitsToUint(x), floatBitsToUint(y), floatBitsToUint(z))); }

// ---- PCG hashes for Voronoi
ivec2 pcg2d(ivec2 v) {
  v = v * 1664525 + 1013904223;
  v.x += v.y * 1664525; v.y += v.x * 1664525;
  v = v ^ (v >> 16);
  v.x += v.y * 1664525; v.y += v.x * 1664525;
  return v;
}
ivec3 pcg3d(ivec3 v) {
  v = v * 1664525 + 1013904223;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> 16);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float i01(int k) { return float(k & 0x7fffffff) * (1.0 / 2147483648.0); }

// Voronoi F1 2D Euclidean, randomness r: x distance, yzw colour
vec4 voronoi_f1(vec2 coord, float r, out vec2 pos) {
  vec2 cf = floor(coord), lp = coord - cf;
  ivec2 cp = ivec2(cf);
  float best = 3.4028234663852886e38;
  ivec2 to = ivec2(0); vec2 tp = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 h = pcg2d(cp + ivec2(i, j));
    vec2 pp = vec2(float(i), float(j)) + vec2(i01(h.x), i01(h.y)) * r;
    vec2 d = pp - lp;
    float dd = d.x * d.x + d.y * d.y;
    if (dd < best) { best = dd; to = ivec2(i, j); tp = pp; }
  }
  vec2 d = tp - lp;
  ivec3 hc = pcg3d(ivec3(cp + to, 0));
  pos = tp + cf;
  return vec4(sqrt_cr(d.x * d.x + d.y * d.y), i01(hc.x), i01(hc.y), i01(hc.z));
}

// Perlin noise 2D (BLI noise), fBM with optional distortion
// Blender: t*t*t in float, the rest in double: (t*t*t) * (t * (t * 6.0 - 15.0) + 10.0)
float fade_(float t) {
  float one = xone();
  float left = (((t * t) * one) * t) * one;
  vec2 right = df_add(df_mulf(df_add(two_prod(t, 6.0, one), vec2(-15.0, 0.0), one), t, one), vec2(10.0, 0.0), one);
  return df_mulf(right, left, one).x;
}
float grad2(uint h, float x, float y) {
  h = h & 7u;
  float u = h < 4u ? x : y, v = 2.0 * (h < 4u ? y : x);
  return ((h & 1u) != 0u ? -u : u) + ((h & 2u) != 0u ? -v : v);
}
float perlin2(vec2 p) {
  vec2 F_ = floor(p); vec2 f = p - F_;
  uint X = uint(int(F_.x)), Y = uint(int(F_.y));
  float u = fade_(f.x), v = fade_(f.y);
  float v0 = grad2(hash2u(X, Y), f.x, f.y), v1 = grad2(hash2u(X + 1u, Y), f.x - 1.0, f.y);
  float v2 = grad2(hash2u(X, Y + 1u), f.x, f.y - 1.0), v3 = grad2(hash2u(X + 1u, Y + 1u), f.x - 1.0, f.y - 1.0);
  float one = xone();
  float x1 = 1.0 - u;
  float a = (v0 * x1) * one + (v1 * u) * one, b = (v2 * x1) * one + (v3 * u) * one;
  // Blender: (1.0 - v) * a + v * b, the outer mix in double
  return df_add(df_mulf(two_sum(1.0, -v, one), a, one), vec2((v * b) * one, 0.0), one).x;
}
float perlin_signed2(vec2 p) {
  vec2 corr = 0.5 * vec2(abs(p.x) >= 1000000.0 ? 1.0 : 0.0, abs(p.y) >= 1000000.0 ? 1.0 : 0.0);
  p = vec2(sfmod(p.x, 100000.0), sfmod(p.y, 100000.0)) + corr;
  return perlin2(p) * 0.6616;
}
