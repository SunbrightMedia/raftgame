precision highp float;
precision highp int;
// ---- exact float maths. Blender's float functions (C library sqrtf, logf, powf, sinf, ...) give the float
// nearest the true value. GPU built-ins do not. These compute a float-float value (hi + lo, about 48 bits) with
// error-free steps, then round once, so the result is the nearest float except in rare near-tie cases.
// xone() is a 1.0 the compiler cannot see: "(a * b) * one" keeps every step a separate IEEE operation, so the
// compiler cannot fuse a multiply-add or reorder the error-free steps.
float xone() { return uintBitsToFloat(0x3F800000u + uint(gl_FragCoord.x < 0.0)); }

vec2 two_sum(float a, float b, float one) {
  float s = (a + b) * one;
  float bb = (s - a) * one;
  float e = ((a - (s - bb) * one) * one) + ((b - bb) * one);
  return vec2(s, e * one);
}
vec2 quick_two_sum(float a, float b, float one) {   // |a| >= |b|
  float s = (a + b) * one;
  return vec2(s, (b - (s - a) * one) * one);
}
vec2 split_f(float a, float one) {
  float t = (4097.0 * a) * one;
  float hi = (t - (t - a) * one) * one;
  return vec2(hi, (a - hi) * one);
}
vec2 two_prod(float a, float b, float one) {
  float p = (a * b) * one;
  vec2 A = split_f(a, one), B = split_f(b, one);
  float e = ((((A.x * B.x - p) * one + A.x * B.y) * one + A.y * B.x) * one + A.y * B.y) * one;
  return vec2(p, e);
}
vec2 df_add(vec2 a, vec2 b, float one) {
  vec2 s = two_sum(a.x, b.x, one), t = two_sum(a.y, b.y, one);
  s.y = (s.y + t.x) * one;
  s = quick_two_sum(s.x, s.y, one);
  s.y = (s.y + t.y) * one;
  return quick_two_sum(s.x, s.y, one);
}
vec2 df_mul(vec2 a, vec2 b, float one) {
  vec2 p = two_prod(a.x, b.x, one);
  p.y = (p.y + ((a.x * b.y) * one + (a.y * b.x) * one) * one) * one;
  return quick_two_sum(p.x, p.y, one);
}
vec2 df_mulf(vec2 a, float b, float one) {
  vec2 p = two_prod(a.x, b, one);
  p.y = (p.y + (a.y * b) * one) * one;
  return quick_two_sum(p.x, p.y, one);
}
vec2 df_div(vec2 a, vec2 b, float one) {
  float q1 = (a.x / b.x) * one;
  vec2 r = df_add(a, -df_mulf(b, q1, one), one);
  float q2 = (r.x / b.x) * one;
  r = df_add(r, -df_mulf(b, q2, one), one);
  float q3 = (r.x / b.x) * one;
  return df_add(quick_two_sum(q1, q2, one), vec2(q3, 0.0), one);
}
// 2^k as a float, k in [-126, 127]
float pow2i(int k) { return uintBitsToFloat(uint(k + 127) << 23); }

const vec2 DF_LN2 = vec2(0.6931471824645996, -1.9046542121259336e-09);
const float LN2A = 0.693145751953125, LN2B = 1.428606765330187e-06, LN2C = 5.497923148104107e-14;
const float PIO2A = 1.570770263671875, PIO2B = 2.6063122277264483e-05, PIO2C = 7.443547731314504e-13;
const vec2 DF_INV3 = vec2(0.3333333432674408, -9.934107758624577e-09);
const vec2 DF_INV5 = vec2(0.20000000298023224, -2.9802322831784522e-09);
const vec2 DF_INV7 = vec2(0.1428571492433548, -6.38621200366174e-09);
const vec2 DF_IF3 = vec2(0.1666666716337204, -4.967053879312289e-09);
const vec2 DF_IF4 = vec2(0.0416666679084301, -1.2417634698280722e-09);
const vec2 DF_IF5 = vec2(0.008333333767950535, -4.34617203337595e-10);
const vec2 DF_IF6 = vec2(0.0013888889225199819, -3.3631094437103215e-11);
const vec2 DF_IF7 = vec2(0.00019841270113829523, -2.725596874933456e-12);
const vec2 DF_IF8 = vec2(2.4801587642286904e-05, -3.40699609366682e-13);
const vec2 DF_IF9 = vec2(2.7557318844628753e-06, 3.793571224297229e-14);

float sqrt_cr(float x) {
  if (!(x > 0.0) || isinf(x)) return x == 0.0 || x > 0.0 ? x : uintBitsToFloat(0x7FC00000u);
  float one = xone();
  float s = sqrt(x) * one;
  vec2 p = two_prod(s, s, one);
  float r = ((x - p.x) * one - p.y) * one;
  return (s + (r / (2.0 * s)) * one) * one;
}

// natural log of x > 0 (finite), as float-float
vec2 log_df(float x, float one) {
  uint b = floatBitsToUint(x);
  int e = int((b >> 23) & 0xFFu), k;
  if (e == 0) { x = (x * 16777216.0) * one; b = floatBitsToUint(x); e = int((b >> 23) & 0xFFu) - 24; }
  k = e - 127;
  float m = uintBitsToFloat((b & 0x007FFFFFu) | 0x3F800000u);
  if (m > 1.4142135) { m = m * 0.5; k += 1; }
  float f = (m - 1.0) * one;
  vec2 s = df_div(vec2(f, 0.0), two_sum(2.0, f, one), one);
  vec2 s2 = df_mul(s, s, one);
  float z = s2.x;
  float t = (1.0 / 17.0 * z) * one + 1.0 / 15.0;
  t = (t * z) * one + 1.0 / 13.0;
  t = (t * z) * one + 1.0 / 11.0;
  t = (t * z) * one + 1.0 / 9.0;
  vec2 acc = df_add(df_mul(vec2(t, 0.0), s2, one), DF_INV7, one);
  acc = df_add(df_mul(acc, s2, one), DF_INV5, one);
  acc = df_add(df_mul(acc, s2, one), DF_INV3, one);
  acc = df_add(df_mul(acc, s2, one), vec2(1.0, 0.0), one);
  vec2 l1p = df_mul(df_mulf(s, 2.0, one), acc, one);
  return df_add(df_mulf(DF_LN2, float(k), one), l1p, one);
}
float log_cr(float x) {
  if (!(x > 0.0)) return x == 0.0 ? -uintBitsToFloat(0x7F800000u) : uintBitsToFloat(0x7FC00000u);
  if (isinf(x)) return x;
  return log_df(x, xone()).x;
}

// e^z for float-float z; returns float-float of e^r and the power of two k (e^z = value * 2^k)
vec2 exp_df(vec2 z, float one, out int k) {
  float kf = floor(z.x * 1.4426950408889634 + 0.5);
  k = int(kf);
  vec2 r = df_add(z, vec2(-(kf * LN2A), 0.0), one);
  r = df_add(r, -two_prod(kf, LN2B, one), one);
  r = df_add(r, vec2(-(kf * LN2C) * one, 0.0), one);
  float x = r.x;
  float t = (x * (1.0 / 6227020800.0)) * one + 1.0 / 479001600.0;
  t = (t * x) * one + 1.0 / 39916800.0;
  t = (t * x) * one + 1.0 / 3628800.0;
  t = (t * x) * one + 1.0 / 362880.0;
  t = (t * x) * one + 1.0 / 40320.0;
  t = (t * x) * one + 1.0 / 5040.0;
  vec2 acc = df_add(df_mul(vec2(t, 0.0), r, one), DF_IF6, one);
  acc = df_add(df_mul(acc, r, one), DF_IF5, one);
  acc = df_add(df_mul(acc, r, one), DF_IF4, one);
  acc = df_add(df_mul(acc, r, one), DF_IF3, one);
  acc = df_add(df_mul(acc, r, one), vec2(0.5, 0.0), one);
  acc = df_add(df_mul(acc, r, one), vec2(1.0, 0.0), one);
  return df_add(df_mul(acc, r, one), vec2(1.0, 0.0), one);
}
// round(hi + lo) * 2^k, for results in the normal range (k may need two steps)
float scale_round(vec2 v, int k) {
  float r = v.x;
  if (k > 127) { r *= 2.0; k -= 1; }
  if (k < -126) { r *= pow2i(-126); k += 126; }
  return r * pow2i(k);
}
float exp_cr(float x) {
  if (x != x) return x;
  if (x > 88.72284) return uintBitsToFloat(0x7F800000u);
  if (x < -103.97208) return 0.0;
  int k; vec2 v = exp_df(vec2(x, 0.0), xone(), k);
  return scale_round(v, k);
}
// a^b for a > 0
float pow_pos(float a, float b) {
  float one = xone();
  if (b == 0.0 || a == 1.0) return 1.0;
  if (isinf(a)) return b > 0.0 ? a : 0.0;
  vec2 z = df_mulf(log_df(a, one), b, one);
  if (z.x > 88.72284) return uintBitsToFloat(0x7F800000u);
  if (z.x < -103.97208) return 0.0;
  int k; vec2 v = exp_df(z, one, k);
  return scale_round(v, k);
}
// C's powf for the cases Blender meets: negative bases only with whole exponents
float pow_cr(float a, float b) {
  if (b == 0.0) return 1.0;
  if (a == 0.0) return b > 0.0 ? 0.0 : uintBitsToFloat(0x7F800000u);
  if (a > 0.0) return pow_pos(a, b);
  float r = pow_pos(-a, b);
  return fract(b * 0.5) != 0.0 ? -r : r;
}

// sin / cos: x - k*pi/2 in float-float (pi/2 in three parts), then Taylor series on |r| <= pi/4
vec2 trig_reduce(float x, float one, out int q) {
  float kf = floor(x * 0.6366197466850281 + 0.5);
  q = int(kf) & 3;
  vec2 r = two_sum(x, -(kf * PIO2A), one);
  r = df_add(r, -two_prod(kf, PIO2B, one), one);
  return df_add(r, vec2(-(kf * PIO2C) * one, 0.0), one);
}
vec2 sin_df(vec2 r, float one) {
  vec2 s = df_mul(r, r, one);
  float z = s.x;
  float t = (z * (-1.0 / 1307674368000.0)) * one + 1.0 / 6227020800.0;
  t = (t * z) * one - 1.0 / 39916800.0;
  vec2 acc = df_add(df_mul(vec2(t, 0.0), s, one), DF_IF9, one);
  acc = df_add(df_mul(acc, s, one), -DF_IF7, one);
  acc = df_add(df_mul(acc, s, one), DF_IF5, one);
  acc = df_add(df_mul(acc, s, one), -DF_IF3, one);
  acc = df_add(df_mul(acc, s, one), vec2(1.0, 0.0), one);
  return df_mul(acc, r, one);
}
vec2 cos_df(vec2 r, float one) {
  vec2 s = df_mul(r, r, one);
  float z = s.x;
  float t = (z * (1.0 / 20922789888000.0)) * one - 1.0 / 87178291200.0;
  t = (t * z) * one + 1.0 / 479001600.0;
  t = (t * z) * one - 1.0 / 3628800.0;
  vec2 acc = df_add(df_mul(vec2(t, 0.0), s, one), DF_IF8, one);
  acc = df_add(df_mul(acc, s, one), -DF_IF6, one);
  acc = df_add(df_mul(acc, s, one), DF_IF4, one);
  acc = df_add(df_mul(acc, s, one), vec2(-0.5, 0.0), one);
  return df_add(df_mul(acc, s, one), vec2(1.0, 0.0), one);
}
float sin_cr(float x) {
  if (isinf(x) || x != x) return uintBitsToFloat(0x7FC00000u);
  float one = xone(); int q;
  vec2 r = trig_reduce(x, one, q);
  float v = (q & 1) == 0 ? sin_df(r, one).x : cos_df(r, one).x;
  return q >= 2 ? -v : v;
}
float cos_cr(float x) {
  if (isinf(x) || x != x) return uintBitsToFloat(0x7FC00000u);
  float one = xone(); int q;
  vec2 r = trig_reduce(x, one, q);
  float v = (q & 1) == 0 ? cos_df(r, one).x : sin_df(r, one).x;
  return (q == 1 || q == 2) ? -v : v;
}
