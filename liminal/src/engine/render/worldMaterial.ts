import * as THREE from 'three';

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
  // On-camera flash: a point light riding just above the lens (candela, linear colour).
  flashOn: { value: 0 },
  flashPos: { value: new THREE.Vector3() },
  flashColor: { value: new THREE.Vector3(1, 1, 1) },
  flashCandela: { value: 25 },
  // Per-pixel lights (cans, bulbs): position, colour × peak candela, and beam
  // (dir.z: -1 down / 0 bare bulb; cos-power n; cutoff and soft edge in cos).
  dynCount: { value: 0 },
  dynPos: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
  dynColor: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
  dynBeam: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
  lightScale: { value: 1 },
};

/**
 * The world shader, in linear light and physical units:
 *   texture (sRGB) → linear albedo ρ
 *   irradiance E (lux) = baked lightmap + the camera flash (I·cosθ/d²)
 *   outgoing radiance L = ρ·E/π  (cd/m², a matte surface)
 * Light sources output their own luminance instead (cd/m²), so lamp lenses
 * and fluorescent panels are as bright as real ones relative to the room.
 * The camera pass (digicam.ts) then exposes and encodes to sRGB.
 */
export function makeWorldMaterial(map: THREE.Texture, source?: { luminance: number; color: [number, number, number] }): THREE.ShaderMaterial {
  const src = source ? new THREE.Vector3(...source.color).multiplyScalar(source.luminance) : new THREE.Vector3();
  return new THREE.ShaderMaterial({
    uniforms: { ...worldUniforms, map: { value: map }, isSource: { value: source ? 1 : 0 }, sourceLum: { value: src } },
    vertexShader: /* glsl */ `
      attribute float shade;
      attribute vec2 lmuv;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vShade;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normal;
        vLm = lmuv;
        vShade = shade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
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
      uniform int dynCount;
      uniform vec3 dynPos[32];
      uniform vec3 dynColor[32];
      uniform vec4 dynBeam[32];
      uniform float lightScale;
      uniform float isSource;
      uniform vec3 sourceLum;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vShade;
      varying float vDepth;
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
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
          // Irradiance in lux.
          vec4 lm = texture2D(lightmap, vLm);
          vec3 E = lightmapOn > 0.5 ? lm.rgb : vec3(300.0 * mix(1.0, vShade, faceShade));
          if (lightmapOn > 0.5) {
            // Direct light from cans/bulbs, exact per pixel, times the baked shadow fraction.
            vec3 n = normalize(vNormal);
            vec3 dyn = vec3(0.0);
            for (int i = 0; i < 32; i++) {
              if (i >= dynCount) break;
              vec3 toL = dynPos[i] - vWorld;
              float d = length(toL);
              vec3 u = toL / max(d, 0.001);
              float ndl = dot(n, u);
              if (ndl <= 0.0) continue;
              vec4 bm = dynBeam[i];
              float I = 1.0;
              if (bm.x < -0.5) {
                float c = u.z; // cosine between the downward beam and the direction to this point
                if (c <= 0.0) continue;
                float spill = -bm.x - 1.0;
                I = pow(c, bm.y) * (spill + (1.0 - spill) * smoothstep(bm.w, bm.z, c));
              }
              float dm = d * 0.0254;
              dyn += dynColor[i] * I * ndl / max(dm * dm, 0.0025);
            }
            E += dyn * lightScale * lm.a;
          }
          if (flashOn > 0.5) {
            vec3 toL = flashPos - vWorld;
            float d = length(toL);
            float dm = d * 0.0254;
            E += flashColor * flashCandela * max(0.0, dot(normalize(vNormal), toL / max(d, 0.001))) / max(dm * dm, 0.01);
          }
          L = rho * E / 3.14159265 * brightness;
        }
        float f = fogOn * clamp((vDepth - fogNear) / max(1.0, fogFar - fogNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(L, toLinear(fogColor) * fogLuminance, f), 1.0);
      }`,
  });
}
