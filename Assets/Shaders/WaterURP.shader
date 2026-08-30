// URP water. Wave displacement happens in the vertex stage from four summed
// directional sine waves - the same function WaterSurface.SampleWaves runs on
// the CPU, fed the same parameters and clock, so physics matches the visuals.
//
// The fragment stage adds what actually sells water: high-frequency ripple
// normals (procedural, no textures), depth-based colour from shallow to deep,
// foam at wave crests and where the surface meets geometry, and a Fresnel
// term feeding both brightness and opacity. Lighting goes through URP's PBR
// so the sun glints off the ripples and the sky reflects in the surface.
Shader "Raft/WaterURP"
{
    Properties
    {
        [Header(Colour)]
        _ShallowColor ("Shallow Colour", Color) = (0.22, 0.62, 0.68, 0.55)
        _DeepColor ("Deep Colour", Color) = (0.02, 0.16, 0.30, 0.95)
        _DepthFade ("Depth Fade Distance", Range(0.1, 30)) = 6
        _Smoothness ("Smoothness", Range(0, 1)) = 0.94
        _Metallic ("Metallic", Range(0, 1)) = 0.05
        _FresnelPower ("Fresnel Power", Range(0.5, 8)) = 5
        _SkyReflection ("Sky Reflection", Range(0, 1)) = 0.65

        [Header(Stylisation)]
        _Stylize ("Stylise (0 realistic, 1 toon)", Range(0, 1)) = 1
        _ShadeBands ("Lighting Bands", Range(1, 12)) = 4
        _DepthBands ("Depth Colour Bands", Range(1, 12)) = 4
        _FoamHardness ("Foam Edge Hardness", Range(0, 1)) = 0.85
        _SunGlint ("Sun Glint", Range(0, 8)) = 0.6
        _DebugView ("Debug View", Float) = 0

        [Header(Foam)]
        _FoamColor ("Foam Colour", Color) = (1, 1, 1, 1)
        _FoamDepth ("Shoreline Foam Width", Range(0, 3)) = 0.15
        _FoamCrest ("Crest Foam Threshold", Range(0, 1)) = 0.55
        _FoamCrestSharpness ("Crest Foam Softness", Range(0.02, 1)) = 0.45

        [Header(Ripples)]
        _RippleStrength ("Ripple Strength", Range(0, 2)) = 0.35
        _RippleScale ("Ripple Scale", Range(0.05, 4)) = 0.9
        _RippleSpeed ("Ripple Speed", Range(0, 4)) = 1.1

        [Header(Waves)]
        // Per wave: xy = direction, z = amplitude, w = wavelength.
        _WaveA ("Wave A", Vector) = (1, 0.35, 0.45, 26)
        _WaveB ("Wave B", Vector) = (-0.6, 1, 0.28, 15)
        _WaveC ("Wave C", Vector) = (0.4, -1, 0.14, 7)
        _WaveD ("Wave D", Vector) = (-1, -0.2, 0.06, 3)
        _WaveSpeeds ("Wave Speeds", Vector) = (4.5, 3.2, 2.4, 1.6)
        _WaveTime ("Wave Time", Float) = 0
        _WaveWarp ("Wave Variation", Range(0, 1)) = 0.6
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "Queue" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "IgnoreProjector" = "True"
        }
        LOD 300

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            Blend SrcAlpha OneMinusSrcAlpha
            // ZWrite stays Off. Turning it On does fix the surface blending
            // with itself, but it also made the whole ocean render as solid
            // white foam: the shoreline-foam term reads _CameraDepthTexture,
            // and once the water writes depth that sample can come back as the
            // water's own surface, so waterDepth collapses to ~0 and edgeFoam
            // saturates everywhere. Needs a render to confirm and fix properly.
            ZWrite Off
            Cull Back

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _ShallowColor;
                float4 _DeepColor;
                float _DepthFade;
                float _Smoothness;
                float _Metallic;
                float _FresnelPower;
                float _SkyReflection;
                float _Stylize;
                float _ShadeBands;
                float _DepthBands;
                float _FoamHardness;
                float _SunGlint;
                float _DebugView;

                float4 _FoamColor;
                float _FoamDepth;
                float _FoamCrest;
                float _FoamCrestSharpness;

                float _RippleStrength;
                float _RippleScale;
                float _RippleSpeed;

                float4 _WaveA, _WaveB, _WaveC, _WaveD;
                float4 _WaveSpeeds;
                float _WaveTime;
                float _WaveWarp;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                // Displaced world position. Only y is displaced, so xz still
                // holds the original grid coordinate and the fragment stage can
                // re-evaluate the waves here exactly.
                float3 positionWS : TEXCOORD0;
                float4 screenPos : TEXCOORD1;
                float fogFactor : TEXCOORD2;
            };

            // Quantise with a one-pixel-soft seam.
            //
            // A plain floor() step is a hard edge in the middle of a triangle,
            // which MSAA cannot see (it only samples geometry silhouettes) and
            // which post-process AA can only guess at after the fact. fwidth
            // gives how fast the value changes per pixel, so the seam can be
            // blended across exactly one pixel while the flat plateaus either
            // side of it stay perfectly flat.
            float BandedAA(float value, float bands)
            {
                float scaled = value * max(bands, 1.0);
                float width = clamp(fwidth(scaled), 1e-5, 1.0);
                float stepped = floor(scaled) + smoothstep(1.0 - width, 1.0, frac(scaled));
                return saturate(stepped / max(bands - 1.0, 1.0));
            }

            // Accumulates height and the two slope derivatives for one wave.
            void AddWave(float4 wave, float speed, float2 pos, inout float height,
                         inout float2 slope, inout float amplitude)
            {
                if (wave.w < 0.0001) return;

                float2 dir = normalize(wave.xy);
                float k = 6.28318530718 / wave.w;
                float phase = (dir.x * pos.x + dir.y * pos.y) * k + _WaveTime * speed;

                height += wave.z * sin(phase);
                slope += dir * (wave.z * k * cos(phase));
                amplitude += wave.z;
            }

            // Cheap value noise. Everything below exists to break up
            // periodicity: four summed sines are perfectly regular, and the
            // eye locks onto the repeating glint grid and foam rings instantly.
            float Hash(float2 p)
            {
                return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
            }

            float ValueNoise(float2 p)
            {
                float2 i = floor(p);
                float2 f = frac(p);
                float2 u = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(Hash(i), Hash(i + float2(1, 0)), u.x),
                            lerp(Hash(i + float2(0, 1)), Hash(i + float2(1, 1)), u.x), u.y);
            }

            // Two octaves drifting in different directions, so foam patches
            // form and dissolve instead of scrolling as one sheet.
            float FoamNoise(float2 p, float t)
            {
                float n = ValueNoise(p * 0.35 + float2(t * 0.13, t * 0.07));
                n += 0.5 * ValueNoise(p * 1.1 + float2(-t * 0.09, t * 0.16));
                return n / 1.5;
            }

            // Small crossed ripples layered on top of the displaced surface.
            // Cheaper and sharper than displacing geometry this finely.
            float3 RippleNormal(float2 pos, float3 baseNormal)
            {
                float t = _WaveTime * _RippleSpeed;
                float2 slope = 0;

                float2 dirs[4] =
                {
                    float2(0.94, 0.34), float2(-0.51, 0.86),
                    float2(0.28, -0.96), float2(-0.87, -0.49)
                };
                float freqs[4] = { 1.7, 2.9, 4.7, 8.3 };
                float amps[4] = { 0.055, 0.032, 0.018, 0.009 };

                [unroll]
                for (int i = 0; i < 4; i++)
                {
                    float k = freqs[i] * _RippleScale;
                    float phase = dot(dirs[i], pos) * k + t * (1.0 + i * 0.37);
                    // Fade each ripple train in and out across the surface so
                    // the glint pattern never repeats on a visible grid.
                    float gust = 0.45 + 1.1 * ValueNoise(pos * 0.13 + i * 7.31 + t * 0.05);
                    slope += dirs[i] * (amps[i] * k * gust * cos(phase));
                }

                float3 perturbed = normalize(float3(-slope.x, 1, -slope.y));
                return normalize(lerp(baseNormal, baseNormal + perturbed - float3(0, 1, 0),
                                      _RippleStrength));
            }

            // Four summed sines repeat on an obvious grid. Bending the sample
            // position first with a very low-frequency distortion (features
            // ~200m across) makes the same waves read as an irregular sea
            // without adding any octaves. Deliberately built from plain sines
            // rather than hash noise so WaterSurface.SampleWaves can reproduce
            // it exactly on the CPU and buoyancy still matches the visuals.
            float2 WarpPosition(float2 pos, float warp)
            {
                if (warp <= 0.0001) return pos;

                float2 offset;
                offset.x = sin(pos.y * 0.031 + 1.7) * 6.0 + sin(pos.y * 0.0117 - 0.6) * 3.5;
                offset.y = sin(pos.x * 0.026 + 4.2) * 6.0 + sin(pos.x * 0.0143 + 2.1) * 3.5;
                return pos + offset * warp;
            }

            void EvaluateWaves(float2 rawPos, out float height, out float2 slope,
                               out float amplitude)
            {
                float2 pos = WarpPosition(rawPos, _WaveWarp);
                height = 0;
                slope = 0;
                amplitude = 0;
                AddWave(_WaveA, _WaveSpeeds.x, pos, height, slope, amplitude);
                AddWave(_WaveB, _WaveSpeeds.y, pos, height, slope, amplitude);
                AddWave(_WaveC, _WaveSpeeds.z, pos, height, slope, amplitude);
                AddWave(_WaveD, _WaveSpeeds.w, pos, height, slope, amplitude);
                amplitude = max(amplitude, 0.0001);
            }

            Varyings vert(Attributes input)
            {
                Varyings output = (Varyings)0;

                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);

                float height, amplitude;
                float2 slope;
                EvaluateWaves(positionWS.xz, height, slope, amplitude);

                positionWS.y += height;

                output.positionWS = positionWS;
                output.positionCS = TransformWorldToHClip(positionWS);
                output.screenPos = ComputeScreenPos(output.positionCS);
                output.fogFactor = ComputeFogFactor(output.positionCS.z);

                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                float2 screenUV = input.screenPos.xy / max(input.screenPos.w, 0.0001);

                // Re-evaluate the waves per pixel. The vertex stage only moves
                // y, so xz here is still the exact grid coordinate. Doing it
                // again costs four sin/cos and buys smooth normals and foam
                // instead of values lerped across 2.5m triangles - that
                // interpolation is what turned crest foam into flat white
                // polygons and gave the horizon its stair-stepped look.
                float height, amplitude;
                float2 slope;
                EvaluateWaves(input.positionWS.xz, height, slope, amplitude);
                float3 waveNormal = normalize(float3(-slope.x, 1, -slope.y));

                // Thickness of water between this surface and whatever is behind it.
                float rawDepth = SampleSceneDepth(screenUV);
                float sceneEye = LinearEyeDepth(rawDepth, _ZBufferParams);
                float surfaceEye = input.screenPos.w;
                float waterDepth = max(sceneEye - surfaceEye, 0);

                float depthBlend = saturate(waterDepth / _DepthFade);

                // Quantise the shallow-to-deep ramp into flat steps. This is
                // the single biggest thing that makes stylised water read as
                // stylised: depth becomes a few bands of solid colour, like
                // contour lines on a chart, rather than a smooth gradient.
                depthBlend = lerp(depthBlend, BandedAA(depthBlend, _DepthBands), _Stylize);

                float4 water = lerp(_ShallowColor, _DeepColor, depthBlend);

                float3 normalWS = RippleNormal(input.positionWS.xz, waveNormal);
                float3 viewDirWS = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                float fresnel = pow(1 - saturate(dot(viewDirWS, normalWS)), _FresnelPower);

                // Foam where the surface nearly touches geometry, plus a little
                // on the highest wave crests. The crest term is a smooth band,
                // not a hard step, so it can't snap to triangle edges.
                float edgeFoam = 1 - saturate(waterDepth / max(_FoamDepth, 0.0001));
                float crest = saturate(height / amplitude);
                float softness = max(_FoamCrestSharpness, 0.02);
                float crestFoam = smoothstep(_FoamCrest, _FoamCrest + softness, crest);

                // Only the steep faces of a crest actually break into foam;
                // gating on slope keeps it off flat water.
                crestFoam *= saturate(length(slope) * 1.5);

                // Break the analytic band into drifting patches - without this
                // the foam is a soft ring around every crest.
                float foamN = FoamNoise(input.positionWS.xz, _WaveTime);
                crestFoam *= smoothstep(0.35, 0.72, foamN);
                edgeFoam *= 0.55 + 0.45 * foamN;

                float foam = saturate(max(edgeFoam * edgeFoam, crestFoam));

                // Snap foam to a hard edge. Soft foam reads as airbrushed;
                // the style wants crisp shapes with a definite boundary.
                // Widen the threshold by at least one pixel so a hard foam
                // edge still resolves cleanly instead of crawling.
                float foamEdge = max((1.0 - _FoamHardness) * 0.5, fwidth(foam));
                float hardFoam = smoothstep(0.5 - foamEdge, 0.5 + foamEdge, foam);
                foam = lerp(foam, hardFoam, _Stylize);

                float3 albedo = lerp(water.rgb, _FoamColor.rgb, foam);
                float alpha = lerp(saturate(water.a + fresnel * 0.35), 1, foam);

                InputData inputData = (InputData)0;
                inputData.positionWS = input.positionWS;
                inputData.normalWS = normalWS;
                inputData.viewDirectionWS = viewDirWS;
                inputData.shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                inputData.fogCoord = input.fogFactor;
                inputData.bakedGI = SampleSH(normalWS);
                inputData.normalizedScreenSpaceUV = screenUV;
                inputData.shadowMask = half4(1, 1, 1, 1);

                SurfaceData surfaceData = (SurfaceData)0;
                surfaceData.albedo = albedo;
                surfaceData.metallic = _Metallic;
                surfaceData.smoothness = lerp(_Smoothness, 0.25, foam);
                surfaceData.occlusion = 1;
                surfaceData.alpha = alpha;

                half4 color = UniversalFragmentPBR(inputData, surfaceData);

                // Step the lit result into flat tones, matching how the clouds
                // are shaded. Quantising luminance rather than N.L keeps the
                // sky reflection and shadows inside the same set of bands, so
                // the whole surface stays in one palette.
                if (_Stylize > 0.001)
                {
                    float luma = dot(color.rgb, float3(0.299, 0.587, 0.114));
                    float stepped = BandedAA(luma, _ShadeBands);
                    float scale = luma > 1e-4 ? stepped / luma : 1.0;
                    color.rgb = lerp(color.rgb, color.rgb * scale, _Stylize);
                }

                // The scene has no reflection probe, so URP's environment
                // specular has nothing to sample and the water reads as matte
                // paint. Reflect the view vector against the ambient probe
                // instead: it carries the skybox, so the surface picks up sky
                // at grazing angles the way water should.
                float3 reflectDir = reflect(-viewDirWS, normalWS);
                float3 skyColor = SampleSH(reflectDir);
                color.rgb = lerp(color.rgb, skyColor,
                                 fresnel * _SkyReflection * (1 - foam));

                // An explicit wide sun glint. At smoothness 0.94 the PBR
                // highlight is nearly a point and vanishes between pixels.
                Light sun = GetMainLight(inputData.shadowCoord);
                float3 halfDir = SafeNormalize(sun.direction + viewDirWS);
                float glint = pow(saturate(dot(normalWS, halfDir)), 220.0);
                // A hard-edged glint shape rather than a soft bloom.
                float glintEdge = max(fwidth(glint), 1e-5);
                glint = lerp(glint, smoothstep(0.25 - glintEdge, 0.25 + glintEdge, glint), _Stylize);
                color.rgb += sun.color * glint * _SunGlint * sun.shadowAttenuation
                             * (1 - foam);

                color.rgb = MixFog(color.rgb, input.fogFactor);
                color.a = alpha;

                if (_DebugView > 0.5)
                {
                    // r = edge foam, g = crest foam, b = water depth / 10
                    return half4(edgeFoam, crestFoam, saturate(waterDepth / 10.0), 1);
                }

                return color;
            }

            ENDHLSL
        }
    }

    FallBack "Universal Render Pipeline/Lit"
}
