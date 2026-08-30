// Flat-shaded banded cloud shader for low-poly cloud meshes.
//
// The clouds are real geometry rather than a raymarched density field. That is
// the standard choice for a toon or low-poly style, and it is what DREDGE's
// angular clouds need: a polygon silhouette is crisp by construction, whereas
// marching a volume and then hardening it just makes the sample planes visible
// as stacked slabs.
//
// Lighting is quantised into a few flat tones so each facet reads as one plane
// of colour - the broad palette-knife look, rather than a smooth gradient
// across a curved surface.
Shader "Raft/StylizedCloud"
{
    Properties
    {
        _LitColor ("Lit Colour", Color) = (1, 0.99, 0.96, 1)
        _ShadowColor ("Shadow Colour", Color) = (0.55, 0.60, 0.72, 1)
        _Opacity ("Per-face Opacity", Range(0, 1)) = 0.45
        _Bands ("Shading Bands", Range(1, 8)) = 5
        _LightWrap ("Light Wrap", Range(0, 1)) = 0.22
        _RimStrength ("Rim Light", Range(0, 1)) = 0.15
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "Queue" = "Transparent-100"
            "RenderPipeline" = "UniversalPipeline"
            "IgnoreProjector" = "True"
        }

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            Blend SrcAlpha OneMinusSrcAlpha
            // ZWrite Off, deliberately - the opposite of the call made for the
            // ocean, for the opposite reason.
            //
            // With depth writes on, only the frontmost facet of a cloud
            // survives, so every cloud renders as one flat silhouette at a
            // single alpha whether it is a thin wisp or a deep mass. Letting
            // the facets blend instead means density accumulates where the
            // cloud is thick: one overlap at 0.45 alpha reads as 0.45, three
            // reads as 0.83. Thin edges stay translucent, cores go solid, and
            // the internal triangles stay visible - which is what makes these
            // read as volume rather than as cut-outs.
            ZWrite Off
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
                float _Bands;
                float _LightWrap;
                float _RimStrength;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 normalWS : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                float fogFactor : TEXCOORD2;
            };

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionWS = TransformObjectToWorld(input.positionOS.xyz);
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                float3 normalWS = normalize(input.normalWS);
                Light sun = GetMainLight();

                // Wrapped lambert: clouds are translucent enough that their
                // shadow side is never truly black, and wrapping keeps the
                // banding from collapsing to a single hard terminator.
                float ndl = dot(normalWS, sun.direction);
                ndl = saturate((ndl + _LightWrap) / (1.0 + _LightWrap));

                // Quantise to flat tones. This is what gives each facet a
                // single plane of colour instead of a gradient.
                float bands = max(_Bands, 1.0);
                float stepped = floor(ndl * bands) / max(bands - 1.0, 1.0);
                stepped = saturate(stepped);

                float3 color = lerp(_ShadowColor.rgb, _LitColor.rgb, stepped);

                // A touch of rim keeps silhouettes from flattening into the sky
                // behind them.
                float3 viewDir = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                float rim = pow(1.0 - saturate(dot(viewDir, normalWS)), 3.0);
                color += _LitColor.rgb * (rim * _RimStrength);

                color = MixFog(color, input.fogFactor);
                return half4(color, _Opacity * _LitColor.a);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
