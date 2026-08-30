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

        [Header(Foam)]
        _FoamColor ("Foam Colour", Color) = (1, 1, 1, 1)
        _FoamDepth ("Shoreline Foam Width", Range(0, 3)) = 0.5
        _FoamCrest ("Crest Foam Threshold", Range(0, 1)) = 0.72
        _FoamCrestSharpness ("Crest Foam Sharpness", Range(1, 20)) = 6

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
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float4 screenPos : TEXCOORD2;
                float2 crest : TEXCOORD3; // x = height, y = total amplitude
                float fogFactor : TEXCOORD4;
            };

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
                    slope += dirs[i] * (amps[i] * k * cos(phase));
                }

                float3 perturbed = normalize(float3(-slope.x, 1, -slope.y));
                return normalize(lerp(baseNormal, baseNormal + perturbed - float3(0, 1, 0),
                                      _RippleStrength));
            }

            Varyings vert(Attributes input)
            {
                Varyings output = (Varyings)0;

                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);

                float height = 0;
                float2 slope = 0;
                float amplitude = 0;
                AddWave(_WaveA, _WaveSpeeds.x, positionWS.xz, height, slope, amplitude);
                AddWave(_WaveB, _WaveSpeeds.y, positionWS.xz, height, slope, amplitude);
                AddWave(_WaveC, _WaveSpeeds.z, positionWS.xz, height, slope, amplitude);
                AddWave(_WaveD, _WaveSpeeds.w, positionWS.xz, height, slope, amplitude);

                positionWS.y += height;

                output.positionWS = positionWS;
                output.positionCS = TransformWorldToHClip(positionWS);
                output.normalWS = normalize(float3(-slope.x, 1, -slope.y));
                output.screenPos = ComputeScreenPos(output.positionCS);
                output.crest = float2(height, max(amplitude, 0.0001));
                output.fogFactor = ComputeFogFactor(output.positionCS.z);

                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                float2 screenUV = input.screenPos.xy / max(input.screenPos.w, 0.0001);

                // Thickness of water between this surface and whatever is behind it.
                float rawDepth = SampleSceneDepth(screenUV);
                float sceneEye = LinearEyeDepth(rawDepth, _ZBufferParams);
                float surfaceEye = input.screenPos.w;
                float waterDepth = max(sceneEye - surfaceEye, 0);

                float depthBlend = saturate(waterDepth / _DepthFade);
                float4 water = lerp(_ShallowColor, _DeepColor, depthBlend);

                float3 normalWS = RippleNormal(input.positionWS.xz, normalize(input.normalWS));
                float3 viewDirWS = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                float fresnel = pow(1 - saturate(dot(viewDirWS, normalWS)), _FresnelPower);

                // Foam where the surface nearly touches geometry, plus a little
                // on the highest wave crests.
                float edgeFoam = 1 - saturate(waterDepth / max(_FoamDepth, 0.0001));
                float crest = saturate(input.crest.x / input.crest.y);
                float crestFoam = saturate((crest - _FoamCrest) * _FoamCrestSharpness);
                float foam = saturate(max(edgeFoam * edgeFoam, crestFoam));

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
                color.rgb = MixFog(color.rgb, input.fogFactor);
                color.a = alpha;

                return color;
            }
            ENDHLSL
        }
    }

    FallBack "Universal Render Pipeline/Lit"
}
