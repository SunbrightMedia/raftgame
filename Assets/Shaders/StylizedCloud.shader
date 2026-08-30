// Opaque flat-shaded cloud shader for low-poly cloud meshes.
//
// Built to match how stylised clouds are actually done rather than by guessing.
// The reference implementation (AlexStrook/UnlitClouds) is OPAQUE, in the
// geometry queue, with ZWrite on, and drives its colour from painted vertex
// colours plus a fresnel rim - not from transparency and not from a lighting
// model.
//
// That matters here because both earlier attempts failed at opposite ends of
// the same axis. Alpha-blended facets made every cloud a pile of overlapping
// ghost outlines; fully opaque with only face-normal lighting made every cloud
// one flat silhouette. The answer is opaque geometry whose form comes from a
// baked vertical gradient, with facet lighting layered on top for the sun
// direction and a rim to lift the edges.
Shader "Raft/StylizedCloud"
{
    Properties
    {
        _LitColor ("Lit Colour", Color) = (1, 0.99, 0.96, 1)
        _ShadowColor ("Shadow Colour", Color) = (0.42, 0.44, 0.58, 1)
        _Opacity ("Opacity", Range(0, 1)) = 1

        _FormWeight ("Form vs Sun", Range(0, 1)) = 0.55
        _Bands ("Shading Bands", Range(1, 12)) = 4
        _LightWrap ("Light Wrap", Range(0, 1)) = 0.30
        _AmbientLift ("Ambient Lift", Range(0, 1)) = 0.12

        _RimColor ("Rim Colour", Color) = (1, 0.95, 0.88, 1)
        _RimStrength ("Rim Strength", Range(0, 2)) = 0.35
        _RimPower ("Rim Tightness", Range(0.5, 8)) = 3
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "Queue" = "Geometry+10"
            "RenderPipeline" = "UniversalPipeline"
            "IgnoreProjector" = "True"
        }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            // Opaque, following the reference. Alpha blending is what turned
            // these into overlapping ghosts: every interior facet showed
            // through every other one, so a cloud read as a pile of outlines
            // rather than as a solid object.
            Blend One Zero
            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _LitColor;
                float4 _ShadowColor;
                float _Opacity;
                float _FormWeight;
                float _Bands;
                float _LightWrap;
                float _AmbientLift;
                float4 _RimColor;
                float _RimStrength;
                float _RimPower;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float4 color : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 normalWS : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                float fogFactor : TEXCOORD2;
                float gradient : TEXCOORD3;
            };

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                // Baked bright-top / dark-underside ramp from the mesh builder.
                output.gradient = input.color.r;
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                float3 normalWS = normalize(input.normalWS);
                Light sun = GetMainLight();

                // Wrapped lambert. Clouds scatter light right through
                // themselves, so a hard terminator looks wrong on them.
                float ndl = dot(normalWS, sun.direction);
                ndl = saturate((ndl + _LightWrap) / (1.0 + _LightWrap));

                // The baked ramp carries the cloud's overall form; the facet
                // term says where the sun is. Blending them means every cloud
                // reads as a lit shape AND you can still see the individual
                // triangles catching light differently.
                float shade = lerp(ndl, input.gradient, _FormWeight);
                shade = saturate(shade + _AmbientLift);

                // Quantise last, so both contributions land in the same set of
                // flat tones.
                float bands = max(_Bands, 1.0);
                float stepped = saturate(floor(shade * bands) / max(bands - 1.0, 1.0));

                float3 color = lerp(_ShadowColor.rgb, _LitColor.rgb, stepped);

                // Rim keeps silhouettes from sinking into the sky behind them,
                // and is the one soft element in an otherwise hard-edged look.
                float3 viewDir = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                float rim = pow(1.0 - saturate(dot(viewDir, normalWS)), _RimPower);
                color += _RimColor.rgb * (rim * _RimStrength);

                color = MixFog(color, input.fogFactor);
                return half4(color, _Opacity);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
