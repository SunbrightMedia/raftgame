precision highp float;
precision highp int;
// ---- fast float maths, for play (comp2glsl.py --fast). The same names and signatures as exactmath.glsl, on the
// GPU's own functions. The exact build is too heavy for some GPU drivers to compile in reasonable time (Chrome on
// Windows froze), so the game runs this one. It is not bit-exact with Blender: sqrt, log, exp, pow, sin and cos
// may differ in the last bit or two, and the float-float steps keep only their high part.
float xone() { return 1.0; }

vec2 two_sum(float a, float b, float one) { return vec2(a + b, 0.0); }
vec2 quick_two_sum(float a, float b, float one) { return vec2(a + b, 0.0); }
vec2 split_f(float a, float one) { return vec2(a, 0.0); }
vec2 two_prod(float a, float b, float one) { return vec2(a * b, 0.0); }
vec2 df_add(vec2 a, vec2 b, float one) { return vec2(a.x + b.x, 0.0); }
vec2 df_mul(vec2 a, vec2 b, float one) { return vec2(a.x * b.x, 0.0); }
vec2 df_mulf(vec2 a, float b, float one) { return vec2(a.x * b, 0.0); }
vec2 df_div(vec2 a, vec2 b, float one) { return vec2(a.x / b.x, 0.0); }
// 2^k as a float, k in [-126, 127]
float pow2i(int k) { return uintBitsToFloat(uint(k + 127) << 23); }

const vec2 DF_LN2 = vec2(0.6931471824645996, -1.9046542121259336e-09);

float sqrt_cr(float x) { return x > 0.0 ? sqrt(x) : (x == 0.0 ? x : uintBitsToFloat(0x7FC00000u)); }

vec2 log_df(float x, float one) { return vec2(log(x), 0.0); }
float log_cr(float x) {
  if (!(x > 0.0)) return x == 0.0 ? -uintBitsToFloat(0x7F800000u) : uintBitsToFloat(0x7FC00000u);
  return log(x);
}
vec2 exp_df(vec2 z, float one, out int k) { k = 0; return vec2(exp(z.x), 0.0); }
float scale_round(vec2 v, int k) { return v.x * pow2i(k); }
float exp_cr(float x) { return exp(x); }
float pow_pos(float a, float b) { return (b == 0.0 || a == 1.0) ? 1.0 : pow(a, b); }
// C's powf for the cases Blender meets: negative bases only with whole exponents
float pow_cr(float a, float b) {
  if (b == 0.0) return 1.0;
  if (a == 0.0) return b > 0.0 ? 0.0 : uintBitsToFloat(0x7F800000u);
  float r = pow_pos(abs(a), b);
  return (a < 0.0 && fract(b * 0.5) != 0.0) ? -r : r;
}

vec2 trig_reduce(float x, float one, out int q) { q = 0; return vec2(x, 0.0); }
vec2 sin_df(vec2 r, float one) { return vec2(sin(r.x), 0.0); }
vec2 cos_df(vec2 r, float one) { return vec2(cos(r.x), 0.0); }
float sin_cr(float x) { return sin(x); }
float cos_cr(float x) { return cos(x); }
