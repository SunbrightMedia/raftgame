import * as THREE from 'three';
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js';
import type { Surface } from './surfaces';

/** Most light-emitting rectangles (troffers) whose reflections are drawn at once. */
export const MAX_RECTS = 64;

RectAreaLightTexturesLib.init();

/**
 * Shared uniforms for every world surface, so a slider in the panel updates
 * all materials at once without rebuilding anything.
 */
export const worldUniforms = {
  faceShade: { value: 0.6 },
  brightness: { value: 1 },
  fogColor: { value: new THREE.Color('#16181c') },
  fogLuminance: { value: 2 },
  fogNear: { value: 400 },
  fogFar: { value: 5000 },
  fogOn: { value: 1 },
  lightmap: { value: null as THREE.Texture | null },
  lightmapOn: { value: 0 },
  // On-camera light riding just above the lens (candela, linear colour).
  flashOn: { value: 0 },
  flashPos: { value: new THREE.Vector3() },
  flashColor: { value: new THREE.Vector3(1, 1, 1) },
  flashCandela: { value: 25 },
  flashDir: { value: new THREE.Vector3(1, 0, 0) },
  flashBeamN: { value: 0 },
  // Per-pixel lights (cans, bulbs): position, colour × peak candela, and beam
  // (dir.z: -1 down / 0 bare bulb; cos-power n; cutoff and soft edge in cos).
  dynCount: { value: 0 },
  dynPos: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
  dynColor: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
  dynBeam: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
  lightScale: { value: 1 },
  // Reflections.
  specScale: { value: 1 },
  bumpScale: { value: 1 },
  roughnessAdd: { value: 0 },
  ltc1: { value: (RectAreaLightTexturesLib as unknown as Record<string, THREE.Texture>).LTC_HALF_1 },
  ltc2: { value: (RectAreaLightTexturesLib as unknown as Record<string, THREE.Texture>).LTC_HALF_2 },
  // Light-emitting rectangles: 4 texels per row (centre, half-width, half-height, luminance rgb).
  rectTex: { value: new THREE.DataTexture(new Float32Array(4 * MAX_RECTS * 4), 4, MAX_RECTS, THREE.RGBAFormat, THREE.FloatType) },
  rectCount: { value: 0 },
};

/**
 * The world shader, in linear light and physical units:
 *   texture (sRGB) → linear albedo ρ
 *   irradiance E (lux) = baked lightmap + per-pixel lights + the camera light
 *   diffuse radiance = ρ·E/π
 *   specular radiance (GGX microfacets, Walter 2007 / Karis 2013):
 *     - point lights and the camera light: f_spec · E,
 *     - light-emitting rectangles: Linearly Transformed Cosines (Heitz et al.
 *       2016, the code three.js ships), luminance × form factor,
 *     - everything else: the baked irradiance reflected with Karis's 2014
 *       analytic environment BRDF, so grazing views pick up Fresnel sheen.
 *   Shadowing of reflections uses the lightmap's alpha (how much of the
 *   per-pixel and rectangle lights' direct light reaches this spot).
 * Relief: the texture's own luminance is read as a height field and bends
 * the normal (bump mapping) for everything computed per pixel.
 * Light sources output their own luminance instead (cd/m²).
 * The camera pass (digicam.ts) then exposes and encodes to sRGB.
 */
export function makeWorldMaterial(map: THREE.Texture, surf: Surface, source?: { luminance: number; color: [number, number, number] }): THREE.ShaderMaterial {
  const src = source ? new THREE.Vector3(...source.color).multiplyScalar(source.luminance) : new THREE.Vector3();
  const img = map.image as { width?: number; height?: number } | undefined;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...worldUniforms,
      map: { value: map },
      texSize: { value: new THREE.Vector2(img?.width ?? 64, img?.height ?? 64) },
      surf: { value: new THREE.Vector4(surf.roughness, surf.f0, surf.metal, surf.bump) },
      isSource: { value: source ? 1 : 0 },
      sourceLum: { value: src },
    },
    vertexShader: /* glsl */ `
      attribute float shade;
      attribute vec2 lmuv;
      attribute vec3 gu;
      attribute vec3 gv;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vShade;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vGu;
      varying vec3 vGv;
      void main() {
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normal;
        vGu = gu;
        vGv = gv;
        vLm = lmuv;
        vShade = shade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      #define PI 3.14159265
      uniform sampler2D map;
      uniform vec2 texSize;
      uniform vec4 surf;
      uniform sampler2D lightmap;
      uniform float lightmapOn;
      uniform float faceShade;
      uniform float brightness;
      uniform vec3 fogColor;
      uniform float fogLuminance;
      uniform float fogNear;
      uniform float fogFar;
      uniform float fogOn;
      uniform float flashOn;
      uniform vec3 flashPos;
      uniform vec3 flashColor;
      uniform float flashCandela;
      uniform vec3 flashDir;
      uniform float flashBeamN;
      uniform int dynCount;
      uniform vec3 dynPos[32];
      uniform vec3 dynColor[32];
      uniform vec4 dynBeam[32];
      uniform float lightScale;
      uniform float specScale;
      uniform float bumpScale;
      uniform float roughnessAdd;
      uniform sampler2D ltc1;
      uniform sampler2D ltc2;
      uniform sampler2D rectTex;
      uniform int rectCount;
      uniform float isSource;
      uniform vec3 sourceLum;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vGu;
      varying vec3 vGv;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vShade;
      varying float vDepth;
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      float height(vec2 uv) { return dot(texture2D(map, uv).rgb, vec3(0.299, 0.587, 0.114)); }

      // ---- GGX (Walter et al. 2007; height-correlated Smith, Heitz 2014)
      float D_GGX(float a, float ndh) { float a2 = a * a; float d = ndh * ndh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
      float V_Smith(float a, float ndl, float ndv) {
        float a2 = a * a;
        float gv = ndl * sqrt(a2 + (1.0 - a2) * ndv * ndv);
        float gl = ndv * sqrt(a2 + (1.0 - a2) * ndl * ndl);
        return 0.5 / max(gv + gl, 1e-5);
      }
      // Specular BRDF × cosθ for a light of angular radius ~ size/d (Karis 2013:
      // widen the lobe by the light's size so tiny lights don't alias).
      vec3 specPoint(vec3 N, vec3 V, vec3 L, float ndl, vec3 F0, float rough, float sizeOverD) {
        float a = rough * rough;
        float a2 = clamp(a + 0.5 * sizeOverD, 0.002, 1.0);
        vec3 H = normalize(L + V);
        float ndh = max(dot(N, H), 0.0), ndv = max(dot(N, V), 1e-4), vdh = max(dot(V, H), 0.0);
        vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
        float norm = (a * a) / (a2 * a2);
        return F * D_GGX(a2, ndh) * V_Smith(a2, ndl, ndv) * norm * ndl;
      }
      // Environment BRDF, analytic fit (Karis 2014, "Physically Based Shading on Mobile").
      vec3 envBRDF(vec3 F0, float rough, float ndv) {
        const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
        const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
        vec4 r = rough * c0 + c1;
        float a004 = min(r.x * r.x, exp2(-9.28 * ndv)) * r.x + r.y;
        vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
        return F0 * AB.x + AB.y;
      }

      // ---- Rectangle lights: Linearly Transformed Cosines (Heitz, Dupuy, Hill,
      // Neubelt 2016), as implemented in three.js (MIT).
      vec3 LTC_EdgeVectorFormFactor(vec3 v1, vec3 v2) {
        float x = dot(v1, v2), y = abs(x);
        float a = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
        float b = 3.4175940 + (4.1616724 + y) * y;
        float v = a / b;
        float t = (x > 0.0) ? v : 0.5 * inversesqrt(max(1.0 - x * x, 1e-7)) - v;
        return cross(v1, v2) * t;
      }
      float LTC_Evaluate(vec3 N, vec3 V, vec3 P, mat3 mInv, vec3 p0, vec3 p1, vec3 p2, vec3 p3) {
        vec3 ln = cross(p1 - p0, p3 - p0);
        if (dot(ln, P - p0) < 0.0) return 0.0;
        vec3 T1 = normalize(V - N * dot(V, N));
        vec3 T2 = -cross(N, T1);
        mat3 m = mInv * transpose(mat3(T1, T2, N));
        vec3 c0 = normalize(m * (p0 - P)), c1 = normalize(m * (p1 - P)), c2 = normalize(m * (p2 - P)), c3 = normalize(m * (p3 - P));
        vec3 f = LTC_EdgeVectorFormFactor(c0, c1) + LTC_EdgeVectorFormFactor(c1, c2) + LTC_EdgeVectorFormFactor(c2, c3) + LTC_EdgeVectorFormFactor(c3, c0);
        float l = length(f);
        return max((l * l + f.z) / (l + 1.0), 0.0);
      }

      void main() {
        vec3 rho = toLinear(texture2D(map, vUv).rgb);
        vec3 L;
        if (isSource > 0.5) {
          // Keep below the half-float frame buffer's max (65504): a 2700 K lens's
          // red channel overflowed into Inf/NaN and turned the glow cyan. Still
          // thousands of times past white, so it blows out exactly the same.
          // Scale, don't clip per channel: clipping red and green at the same cap
          // turns an amber bulb yellow, and white balance then pushes it green.
          L = rho * sourceLum;
          L *= min(1.0, 30000.0 / max(1e-6, max(L.r, max(L.g, L.b))));
        } else {
          vec3 n0 = normalize(vNormal);
          // Relief from the texture: height gradient in texture space → world.
          vec3 N = n0;
          float bump = surf.w * bumpScale;
          if (bump > 0.0) {
            vec2 d = 1.0 / texSize;
            float dhu = (height(vUv + vec2(d.x, 0.0)) - height(vUv - vec2(d.x, 0.0))) / (2.0 * d.x);
            float dhv = (height(vUv + vec2(0.0, d.y)) - height(vUv - vec2(0.0, d.y))) / (2.0 * d.y);
            N = normalize(n0 - bump * (dhu * vGu + dhv * vGv));
          }
          float rough = clamp(surf.x + roughnessAdd, 0.04, 1.0);
          float metal = surf.z;
          vec3 F0 = mix(vec3(surf.y), rho, metal);
          vec3 diffuseColor = rho * (1.0 - metal);
          vec3 V = normalize(cameraPosition - vWorld);
          float ndv = max(dot(N, V), 1e-4);

          vec4 lm = texture2D(lightmap, vLm);
          vec3 E = lightmapOn > 0.5 ? lm.rgb : vec3(300.0 * mix(1.0, vShade, faceShade));
          vec3 spec = vec3(0.0);
          vec3 env = envBRDF(F0, rough, ndv) * specScale;
          // Baked light reflected: diffuse loses what the surface reflects specularly.
          vec3 Lbaked = E / PI * (diffuseColor * (1.0 - env) + env);
          vec3 Edyn = vec3(0.0);
          if (lightmapOn > 0.5) {
            // Direct light from cans/bulbs, exact per pixel, times the baked shadow fraction.
            for (int i = 0; i < 32; i++) {
              if (i >= dynCount) break;
              vec3 toL = dynPos[i] - vWorld;
              float d = length(toL);
              vec3 u = toL / max(d, 0.001);
              if (dot(n0, u) <= 0.0) continue;
              float ndl = max(dot(N, u), 0.0);
              vec4 bm = dynBeam[i];
              float I = 1.0;
              if (bm.x < -0.5) {
                float c = u.z; // cosine between the downward beam and the direction to this point
                if (c <= 0.0) continue;
                float spill = -bm.x - 1.0;
                I = pow(c, bm.y) * (spill + (1.0 - spill) * smoothstep(bm.w, bm.z, c));
              }
              float dm = d * 0.0254;
              vec3 Ei = dynColor[i] * I / max(dm * dm, 0.0025);
              Edyn += Ei * ndl;
              spec += Ei * specPoint(N, V, u, ndl, F0, rough, 2.0 / max(d, 1.0));
            }
            Edyn *= lightScale * lm.a;
            spec *= lightScale * lm.a;
            // Light-emitting rectangles (troffers): their diffuse light is baked;
            // here only their reflection.
            vec2 luv = vec2(rough, sqrt(1.0 - ndv)) * (63.0 / 64.0) + 0.5 / 64.0;
            vec4 t1 = texture2D(ltc1, luv), t2 = texture2D(ltc2, luv);
            mat3 mInv = mat3(vec3(t1.x, 0.0, t1.y), vec3(0.0, 1.0, 0.0), vec3(t1.z, 0.0, t1.w));
            vec3 fres = F0 * t2.x + (1.0 - F0) * t2.y;
            vec3 rs = vec3(0.0);
            for (int i = 0; i < ${MAX_RECTS}; i++) {
              if (i >= rectCount) break;
              vec3 c = texelFetch(rectTex, ivec2(0, i), 0).xyz;
              vec3 hw = texelFetch(rectTex, ivec2(1, i), 0).xyz;
              vec3 hh = texelFetch(rectTex, ivec2(2, i), 0).xyz;
              vec3 lum = texelFetch(rectTex, ivec2(3, i), 0).xyz;
              if (dot(c - vWorld, n0) <= 0.0) continue;
              rs += lum * LTC_Evaluate(N, V, vWorld, mInv, c + hw - hh, c - hw - hh, c - hw + hh, c + hw + hh);
            }
            spec += rs * fres * lightScale * lm.a;
          }
          if (flashOn > 0.5) {
            vec3 toL = flashPos - vWorld;
            float d = length(toL);
            vec3 u = toL / max(d, 0.001);
            float dm = d * 0.0254;
            float ndl = max(dot(N, u), 0.0) * step(0.0, dot(n0, u));
            // Beam: intensity ∝ cos^n of the angle off the lens axis (n = 0: bare bulb).
            float beam = flashBeamN > 0.0 ? pow(max(dot(-u, flashDir), 0.0), flashBeamN) : 1.0;
            vec3 Ef = flashColor * flashCandela * beam / max(dm * dm, 0.01);
            Edyn += Ef * ndl;
            spec += Ef * specPoint(N, V, u, ndl, F0, rough, 1.0 / max(d, 1.0));
          }
          L = (Lbaked + Edyn / PI * diffuseColor * (1.0 - env) + spec * specScale) * brightness;
        }
        float f = fogOn * clamp((vDepth - fogNear) / max(1.0, fogFar - fogNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(L, toLinear(fogColor) * fogLuminance, f), 1.0);
      }`,
  });
}
