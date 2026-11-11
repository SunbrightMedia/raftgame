import * as THREE from 'three';
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js';
import type { Surface } from './surfaces';
import type { SourceMaterial } from './textures';
import { sourceUniforms } from './sourceMaterial';
import { fogUniforms, FOG_PARS } from './fog';
import { lightGridUniforms, LIGHT_GRID_PARS } from './lightGrid';

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
  ...fogUniforms,
  ...lightGridUniforms,
  tileBreakup: { value: 0 },
  lightmap: { value: null as THREE.Texture | null },
  /** Where the baked light comes from (lighting.ts / bake.ts dirPixels): xyz·0.5+0.5, directionality. */
  lightmapDir: { value: null as THREE.Texture | null },
  bakedRelief: { value: 1 },
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
  /** Each per-pixel light's shadow-mask channel (0..3) in lightmapMask. */
  dynChan: { value: new Array<number>(32).fill(0) },
  /** A downward light's glow in every direction, as a fraction of its peak (BakeLight.iso). */
  dynIso: { value: new Array<number>(32).fill(0) },
  lightmapMask: { value: null as THREE.Texture | null },
  lightScale: { value: 1 },
  // Reflections.
  specScale: { value: 1 },
  bumpScale: { value: 1 },
  roughnessAdd: { value: 0 },
  // Surface depth: parallax, crevice darkening, fibre sheen, close-up detail (all ×, 1 = as authored).
  parallaxScale: { value: 1 },
  cavityScale: { value: 1 },
  sheenScale: { value: 1 },
  detailScale: { value: 1 },
  ltc1: { value: (RectAreaLightTexturesLib as unknown as Record<string, THREE.Texture>).LTC_HALF_1 },
  ltc2: { value: (RectAreaLightTexturesLib as unknown as Record<string, THREE.Texture>).LTC_HALF_2 },
  // Light-emitting rectangles: 4 texels per row (centre, half-width, half-height, luminance rgb).
  rectTex: { value: new THREE.DataTexture(new Float32Array(4 * MAX_RECTS * 4), 4, MAX_RECTS, THREE.RGBAFormat, THREE.FloatType) },
  rectCount: { value: 0 },
  /** Seconds, for animated screens. */
  time: { value: 0 },
  /**
   * Radiance of a white surface at Source's light level 1.0 (what a lightmap
   * value of 1 or a self-illuminated texel shows), in this renderer's units.
   * Calibrated with the Source lighting model (docs/SOURCE_LIGHTING.md).
   */
  sourceUnit: { value: 300 / Math.PI },
  /** Source's non-HDR path: textures decode (and the camera encodes) with plain 2.2 gamma, not the sRGB curve. */
  gamma22: { value: 0 },
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
 * Relief: each texture has a height field built from its fine detail
 * (textures.ts makeHeightCanvas). It drives parallax occlusion mapping (the
 * texture shifts with the view as if grout and pile were sunk in: a ray march
 * through the height field), bends the normal for everything computed per
 * pixel, darkens crevices, and adds close-up detail. Per material
 * (textures/surfaces.json): depth, gloss (how much specular shows), fibre
 * sheen at grazing angles, crevice darkening.
 * Light sources output their own luminance instead (cd/m²).
 * The camera pass (digicam.ts) then exposes and encodes to sRGB.
 */
export function makeWorldMaterial(map: THREE.Texture, surf: Surface, source?: { luminance: number; color: [number, number, number]; anim?: 'static' }, height?: THREE.Texture, imported?: SourceMaterial): THREE.ShaderMaterial {
  const src = source ? new THREE.Vector3(...source.color).multiplyScalar(source.luminance) : new THREE.Vector3();
  const img = map.image as { width?: number; height?: number } | undefined;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...worldUniforms,
      map: { value: map },
      texSize: { value: new THREE.Vector2(img?.width ?? 64, img?.height ?? 64) },
      surf: { value: new THREE.Vector4(surf.roughness, surf.f0, surf.metal, height ? surf.bump : 0) },
      surf2: { value: new THREE.Vector4(surf.gloss, surf.sheen, surf.cavity, 0) },
      hmap: { value: height ?? map },
      isSource: { value: source ? 1 : 0 },
      isStatic: { value: source?.anim === 'static' ? 1 : 0 },
      sourceLum: { value: src },
      ...sourceUniforms(imported),
    },
    vertexShader: /* glsl */ `
      attribute float shade;
      attribute vec2 lmuv;
      attribute vec3 gu;
      attribute vec3 gv;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vShade;
      varying vec3 vViewPos;   // exact per pixel: a distance interpolated across a huge face is far off
      #define vDepth length(vViewPos)
      #define vFogZ (cameraPosition.z + dot(viewMatrix[2].xyz, vViewPos))
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
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      #define PI 3.14159265
      uniform sampler2D map;
      uniform vec2 texSize;
      uniform vec4 surf;
      uniform vec4 surf2;
      uniform sampler2D hmap;
      uniform float parallaxScale;
      uniform float cavityScale;
      uniform float sheenScale;
      uniform float detailScale;
      uniform sampler2D lightmap;
      uniform sampler2D lightmapDir;
      uniform float bakedRelief;
      uniform float lightmapOn;
      uniform float faceShade;
      uniform float brightness;
      ${FOG_PARS}
      ${LIGHT_GRID_PARS}
      uniform float tileBreakup;
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
      uniform float dynChan[32];
      uniform float dynIso[32];
      uniform sampler2D lightmapMask;
      uniform float lightScale;
      uniform float specScale;
      uniform float bumpScale;
      uniform float roughnessAdd;
      uniform sampler2D ltc1;
      uniform sampler2D ltc2;
      uniform sampler2D rectTex;
      uniform int rectCount;
      uniform float isSource;
      uniform float isStatic;
      uniform float time;
      uniform vec3 sourceLum;
      uniform float sourceUnit;
      uniform int alphaMode;
      uniform float alphaRef;
      uniform float alphaMul;
      uniform float selfIllum;
      uniform vec3 selfIllumTint;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vGu;
      varying vec3 vGv;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vShade;
      varying vec3 vViewPos;   // exact per pixel: a distance interpolated across a huge face is far off
      #define vDepth length(vViewPos)
      #define vFogZ (cameraPosition.z + dot(viewMatrix[2].xyz, vViewPos))
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
        float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453), d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      float height(vec2 uv) { return texture2D(hmap, uv).r; }

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
        vec3 n0 = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec2 uv = vUv;
        vec2 gx = dFdx(vUv), gy = dFdy(vUv);
        float depth = surf.w * bumpScale;
        float nearF = 1.0 - smoothstep(240.0, 900.0, vDepth);   // parallax and detail fade out with distance
        // Parallax occlusion mapping: march the view ray down through the height
        // field (1 = top surface) until it goes under it, then interpolate.
        if (isSource < 0.5 && depth > 0.0 && parallaxScale > 0.0 && nearF > 0.0) {
          float ndv0 = max(dot(n0, V), 0.25);
          vec3 Vt = V - n0 * dot(V, n0);
          vec2 shift = vec2(dot(Vt, vGu), dot(Vt, vGv)) / ndv0 * depth * parallaxScale * nearF;
          const int STEPS = 20;
          float t = 0.0, prevT = 0.0;
          float prevD = -(1.0 - textureGrad(hmap, uv, gx, gy).r);
          if (prevD < 0.0) {
            for (int i = 1; i <= STEPS; i++) {
              t = float(i) / float(STEPS);
              float d = t - (1.0 - textureGrad(hmap, uv - shift * t, gx, gy).r);
              if (d >= 0.0) { t = mix(prevT, t, prevD / (prevD - d)); break; }
              prevT = t; prevD = d;
            }
          } else t = 0.0;
          uv -= shift * t;
        }
        vec4 tx = textureGrad(map, uv, gx, gy);
        if (alphaMode == 1 && tx.a < alphaRef) discard;
        vec3 rho = toLinear(tx.rgb);
        float hgt = textureGrad(hmap, uv, gx, gy).r;
        // Close up, the texture's own grain again at a finer scale, so near surfaces aren't a stretched photo.
        if (isSource < 0.5 && detailScale > 0.0 && surf.w > 0.0) {
          float dn = 1.0 - smoothstep(48.0, 200.0, vDepth);
          if (dn > 0.0) rho *= 1.0 + detailScale * dn * 0.35 * (texture2D(hmap, uv * 3.71 + 0.37).r - 0.5);
        }
        // Large-scale variation in world space, so a texture's repeats don't line up into a visible grid.
        if (tileBreakup > 0.0) {
          vec2 wp = vWorld.xy + vWorld.z * 0.7;
          float v = vnoise(wp / 900.0) * 0.6 + vnoise(wp / 3100.0 + 17.0) * 0.4;
          rho *= 1.0 + tileBreakup * (v - 0.5) * 2.0;
        }
        vec3 L;
        if (isSource > 0.5) {
          // Keep below the half-float frame buffer's max (65504): a 2700 K lens's
          // red channel overflowed into Inf/NaN and turned the glow cyan. Still
          // thousands of times past white, so it blows out exactly the same.
          // Scale, don't clip per channel: clipping red and green at the same cap
          // turns an amber bulb yellow, and white balance then pushes it green.
          if (isStatic > 0.5) {
            // An untuned CRT: grey snow, new every frame, with a faint rolling band.
            vec2 cell = floor(vUv * vec2(96.0, 72.0));
            float fr = floor(time * 30.0);
            float n = fract(sin(dot(cell + fr * vec2(17.13, 31.71), vec2(12.9898, 78.233))) * 43758.5453);
            float band = 0.85 + 0.15 * sin((vUv.y + time * 0.35) * 6.2831);
            rho = vec3(0.15 + 0.85 * n * n) * band;
          }
          L = rho * sourceLum;
          L *= min(1.0, 30000.0 / max(1e-6, max(L.r, max(L.g, L.b))));
        } else {
          // Relief from the height field: its gradient in texture space → world.
          vec3 N = n0;
          float bump = depth;
          if (bump > 0.0) {
            vec2 d = 1.0 / texSize;
            float dhu = (height(uv + vec2(d.x, 0.0)) - height(uv - vec2(d.x, 0.0))) / (2.0 * d.x);
            float dhv = (height(uv + vec2(0.0, d.y)) - height(uv - vec2(0.0, d.y))) / (2.0 * d.y);
            N = normalize(n0 - bump * (dhu * vGu + dhv * vGv));
          }
          // Crevices (grout, between tufts) get less light, tops a little more: average kept.
          float occl = surf.w > 0.0 ? max(0.05, 1.0 + surf2.z * cavityScale * (0.33 - (1.0 - hgt) * (1.0 - hgt))) : 1.0;
          float gloss = surf2.x * specScale;
          float rough = clamp(surf.x + roughnessAdd, 0.04, 1.0);
          float metal = surf.z;
          vec3 F0 = mix(vec3(surf.y), rho, metal);
          // With reflections off, metals fall back to their albedo as a matte colour (else they'd be black).
          vec3 diffuseColor = rho * (1.0 - metal * min(1.0, gloss));
          float ndv = max(dot(N, V), 1e-4);
          // Fibre sheen (carpet, fabric): pile seen edge-on catches light: soft, view-dependent brightening.
          float sheenK = 1.0 + surf2.y * sheenScale * 0.8 * pow(1.0 - ndv, 4.0);
          diffuseColor *= occl * sheenK;

          vec4 lm = texture2D(lightmap, vLm);
          // No bake: the map's lamps worked out here (lightGrid.ts), or, with none, an even light with direction shading.
          vec3 E = lightmapOn > 0.5 ? lm.rgb : lgOn > 0.5 ? gridLight(vWorld, N) : vec3(300.0 * mix(1.0, vShade, faceShade));
          // The baked light shaded with this pixel's bumped normal: Lambert's ratio
          // for the directional part (towards where the light comes from), the
          // even part unchanged. So relief shows under baked lamps and panels too.
          if (lightmapOn > 0.5 && bump > 0.0 && bakedRelief > 0.0) {
            vec4 ld = texture2D(lightmapDir, vLm);
            vec3 dd = ld.xyz * 2.0 - 1.0;
            float dl = length(dd);
            if (dl > 0.1) {
              dd /= dl;
              float ratio = clamp(max(dot(N, dd), 0.0) / max(dot(n0, dd), 0.2), 0.0, 2.5);
              E *= mix(1.0, ratio, ld.w * bakedRelief);
            }
          }
          vec3 spec = vec3(0.0);
          vec3 env = envBRDF(F0, rough, ndv) * gloss;
          // Baked light reflected: diffuse loses what the surface reflects specularly.
          vec3 Lbaked = E / PI * (diffuseColor * (1.0 - env) + env);
          vec3 Edyn = vec3(0.0);
          if (lightmapOn > 0.5) {
            // Direct light from cans/bulbs, exact per pixel, times its own channel of the baked shadow mask.
            vec4 mk = texture2D(lightmapMask, vLm);
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
                float iso = dynIso[i];
                if (c <= 0.0) { if (iso <= 0.0) continue; I = iso; }   // above the light: only its glow (a dome's glass lights the ceiling)
                else {
                  float spill = -bm.x - 1.0;
                  I = pow(c, bm.y) * (spill + (1.0 - spill) * smoothstep(bm.w, bm.z, c)) + iso;
                }
              }
              float dm = d * 0.0254;
              float ch = dynChan[i];
              float sh = ch < 0.5 ? mk.r : ch < 1.5 ? mk.g : ch < 2.5 ? mk.b : mk.a;
              vec3 Ei = dynColor[i] * I * sh / max(dm * dm, 0.0025);
              Edyn += Ei * ndl;
              spec += Ei * specPoint(N, V, u, ndl, F0, rough, 2.0 / max(d, 1.0));
            }
            Edyn *= lightScale;
            spec *= lightScale;
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
          L = (Lbaked + Edyn / PI * diffuseColor * (1.0 - env) + spec * gloss * occl) * brightness;
          if (selfIllum > 0.5) L = mix(L, rho * selfIllumTint * sourceUnit, tx.a);
        }
        // Alpha marks light sources (lamp lenses, panels) for the camera pass:
        // only they get the lamp-edge line and fringe, not overexposed surfaces.
        // (Translucent surfaces blend with their own alpha and keep the frame's: see applySourceBlend.)
        float a = alphaMode == 2 ? tx.a * alphaMul : alphaMode == 3 ? alphaMul : isSource * (1.0 - isStatic); // screens aren't lamps
        gl_FragColor = vec4(applyFog(L, vDepth, vFogZ), a);
      }`,
  });
}
