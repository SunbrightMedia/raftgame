// Opaque URP shader that draws a darker inset border around every face of a
// box, giving flat-coloured props a hand-built, plank-like read without any
// textures.
//
// The border is found in object space: for a unit cube mesh (Unity's built-in
// Cube, spanning -0.5..0.5) the distance to each pair of opposite faces is
// 0.5 - |position|. On any given face one of those three distances is ~0 - the
// face you are standing on - so the SECOND smallest is the distance to that
// face's nearest edge. Scaling by the object's lossy scale first keeps the
// border a constant width in world units, so the raft's thin sides and its
// big deck get the same weight of line.
//
// Assumes a unit-cube mesh. Other meshes still render, but the border will
// only make sense for box-ish shapes.
Shader "Raft/FacetedWood"
{
    Properties
    {
        _BaseColor ("Base Colour", Color) = (0.55, 0.38, 0.22, 1)
        _OutlineDarken ("Outline Darkening", Range(0, 1)) = 0.45
        _OutlineWidth ("Outline Width (world units)", Range(0, 0.5)) = 0.05
        _Smoothness ("Smoothness", Range(0, 1)) = 0.15
        _Metallic ("Metallic", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "Queue" = "Geometry"
            "RenderPipeline" = "UniversalPipeline"
        }
        LOD 200

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

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

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float _OutlineDarken;
                float _OutlineWidth;
                float _Smoothness;
                float _Metallic;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 positionOS : TEXCOORD2;
                float fogFactor : TEXCOORD3;
            };

            // Lengths of the object-to-world basis vectors, i.e. lossy scale.
            float3 ObjectScale()
            {
                float3x3 m = (float3x3)UNITY_MATRIX_M;
                return float3(length(m._m00_m10_m20),
                              length(m._m01_m11_m21),
                              length(m._m02_m12_m22));
            }

            Varyings vert(Attributes input)
            {
                Varyings output = (Varyings)0;
                output.positionOS = input.positionOS.xyz;
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                // World-space distance from this pixel to each pair of faces.
                float3 d = (0.5 - abs(input.positionOS)) * ObjectScale();

                // Second smallest = distance to the nearest edge of the face
                // this pixel sits on. (The smallest is that face itself.)
                float lo = min(min(d.x, d.y), d.z);
                float hi = max(max(d.x, d.y), d.z);
                float mid = d.x + d.y + d.z - lo - hi;

                // fwidth keeps the line one pixel soft instead of stair-stepped.
                float aa = max(fwidth(mid), 1e-5);
                float outline = 1.0 - smoothstep(_OutlineWidth - aa, _OutlineWidth + aa, mid);

                float3 albedo = _BaseColor.rgb * lerp(1.0, 1.0 - _OutlineDarken, outline);

                float3 normalWS = normalize(input.normalWS);

                InputData inputData = (InputData)0;
                inputData.positionWS = input.positionWS;
                inputData.normalWS = normalWS;
                inputData.viewDirectionWS = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                inputData.shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                inputData.fogCoord = input.fogFactor;
                inputData.bakedGI = SampleSH(normalWS);
                inputData.shadowMask = half4(1, 1, 1, 1);

                SurfaceData surfaceData = (SurfaceData)0;
                surfaceData.albedo = albedo;
                surfaceData.metallic = _Metallic;
                // The border reads as a shadowed groove, so take the sheen off it.
                surfaceData.smoothness = _Smoothness * lerp(1.0, 0.4, outline);
                surfaceData.occlusion = 1;
                surfaceData.alpha = 1;

                half4 color = UniversalFragmentPBR(inputData, surfaceData);
                color.rgb = MixFog(color.rgb, input.fogFactor);
                return color;
            }
            ENDHLSL
        }

        // Without these the props cast no shadows and are missing from the
        // depth texture the water shader reads for its shoreline foam.
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }

            ZWrite On
            ZTest LEqual
            ColorMask 0
            Cull Back

            HLSLPROGRAM
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag
            #pragma target 3.0

            // Lighting.hlsl rather than Shadows.hlsl alone: Shadows.hlsl uses
            // helpers (LerpWhiteTo) it does not itself pull in.
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            // Written self-contained rather than including URP's
            // ShadowCasterPass.hlsl, which expects the Lit shader's _BaseMap /
            // _Cutoff inputs to be declared.
            float3 _LightDirection;

            struct ShadowAttributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct ShadowVaryings
            {
                float4 positionCS : SV_POSITION;
            };

            ShadowVaryings ShadowVert(ShadowAttributes input)
            {
                ShadowVaryings output;
                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);

                float4 positionCS =
                    TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, _LightDirection));

                #if UNITY_REVERSED_Z
                    positionCS.z = min(positionCS.z, positionCS.w * UNITY_NEAR_CLIP_VALUE);
                #else
                    positionCS.z = max(positionCS.z, positionCS.w * UNITY_NEAR_CLIP_VALUE);
                #endif

                output.positionCS = positionCS;
                return output;
            }

            half4 ShadowFrag(ShadowVaryings input) : SV_Target
            {
                return 0;
            }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }

            ZWrite On
            ColorMask 0
            Cull Back

            HLSLPROGRAM
            #pragma vertex DepthVert
            #pragma fragment DepthFrag
            #pragma target 3.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct DepthAttributes
            {
                float4 positionOS : POSITION;
            };

            struct DepthVaryings
            {
                float4 positionCS : SV_POSITION;
            };

            DepthVaryings DepthVert(DepthAttributes input)
            {
                DepthVaryings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                return output;
            }

            half4 DepthFrag(DepthVaryings input) : SV_Target
            {
                return 0;
            }
            ENDHLSL
        }
    }

    FallBack "Universal Render Pipeline/Lit"
}
