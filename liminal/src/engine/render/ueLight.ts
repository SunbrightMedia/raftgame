/**
 * Unreal's deferred point/spot light, as The Complex's lamps use it (our own code, written from Unreal's published
 * formulas; checked against the game's own lamp step on its own G-buffer: tools/complex/ue_lamps.py, which this
 * GLSL mirrors line for line, and tools/complex/check_uelight.py, which runs this GLSL against it).
 *
 * Per lamp (no source size, inverse-square falloff, no shadows):
 *   falloff = saturate(1 - (d / R)^4)^2 / (d^2 + 1 cm^2)        R = the lamp's reach
 *   cone    = saturate((dot(l, A) - cosOuter) * k)^2             A = the lamp's axis, pointing back towards it
 *   light   = colour * falloff * cone * saturate(N.l) * (diffuse / pi + GGX specular)
 * GGX specular: D(a^2 = roughness^4) * Smith-joint visibility (Unreal's approximation) * Schlick F with Unreal's
 * saturate(50 F0.g) term, times N.l.
 *
 * Units: positions in inches, colour in candela (light = lux per steradian-ish as the rest of the shader); the
 * +1 cm^2 of Unreal's falloff is 1e-4 m^2.
 */
export const UE_LIGHT_GLSL = /* glsl */ `
  // ue: x = 1 / reach (1/inch), y = cos of the outer cone angle, z = 1 / (cos inner - cos outer); axis: towards the lamp.
  // Returns the lamp's irradiance on a surface facing it (lux), 0 outside its reach or cone.
  float ueFalloff(vec3 toL, vec4 ue, vec3 axis) {
    float d2 = dot(toL, toL);
    float r2 = d2 * ue.x * ue.x;
    float win = clamp(1.0 - r2 * r2, 0.0, 1.0);
    win *= win;
    vec3 l = toL * inversesqrt(max(d2, 1e-12));
    float cone = clamp((dot(l, axis) - ue.y) * ue.z, 0.0, 1.0);
    cone *= cone;
    return win * cone / (d2 * 0.00064516 + 1.0e-4);
  }
  // Unreal's GGX specular for a point light, times N.l (multiply by the irradiance above).
  vec3 ueSpecular(vec3 N, vec3 V, vec3 l, float NoL, vec3 F0, float rough) {
    if (NoL <= 0.0) return vec3(0.0);
    float a = rough * rough;
    float a2 = a * a;
    vec3 H = normalize(V + l);
    float NoH = clamp(dot(N, H), 0.0, 1.0);
    float VoH = clamp(dot(V, H), 0.0, 1.0);
    float NoV = clamp(dot(N, V), 1.0e-5, 1.0);
    float dd = (NoH * a2 - NoH) * NoH + 1.0;
    float D = a2 / (3.14159265 * dd * dd);
    float Vis = 0.5 / (NoL * (NoV * (1.0 - a) + a) + NoV * (NoL * (1.0 - a) + a));
    float Fc = 1.0 - VoH;
    float Fc2 = Fc * Fc;
    Fc = Fc2 * Fc2 * Fc;
    vec3 F = clamp(50.0 * F0.g, 0.0, 1.0) * Fc + (1.0 - Fc) * F0;
    return D * Vis * F * NoL;
  }
`;
