// Three-stop gradient skybox with a soft sun.
//
// Clouds are NOT here: they are real low-poly meshes (see CloudField), because
// an angular flat-shaded style wants a polygon silhouette. Raymarching a
// density field and then hardening its edges only exposes the sampling - the
// individual march planes show through as stacked translucent slabs.
//
// Unity's built-in Skybox/Procedural is a scattering model, and it will not
// give a good sunset here: pushing its atmosphere thickness up to redden a low
// sun turns the horizon yellow, and any blue-ish sky tint over that yellow
// reads as GREEN. That is a property of the model, not a tuning mistake, so
// the colour is driven directly instead.
//
// Real skies at sunset are three bands, not two: warm at the horizon, magenta
// through the middle, deep blue overhead. That middle stop is what makes a
// sunset look like a sunset, so it is a first-class control here.
Shader "Raft/GradientSky"
{
    Properties
    {
        [Header(Gradient)]
        _HorizonColor ("Horizon Colour", Color) = (0.72, 0.85, 0.95, 1)
        _MidColor ("Mid Colour", Color) = (0.42, 0.66, 0.92, 1)
        _ZenithColor ("Zenith Colour", Color) = (0.16, 0.40, 0.78, 1)
        _GroundColor ("Below Horizon", Color) = (0.10, 0.13, 0.18, 1)

        _MidHeight ("Mid Stop Height", Range(0.01, 0.9)) = 0.16
        _HorizonSoftness ("Horizon Softness", Range(0.001, 0.4)) = 0.03
        _Exposure ("Exposure", Range(0, 3)) = 1
        _Dither ("Dither Strength", Range(0, 4)) = 1.5

        [Header(Sun)]
        _SunColor ("Sun Colour", Color) = (1, 0.95, 0.85, 1)
        _SunDirection ("Sun Direction", Vector) = (0.3, 0.6, -0.7, 0)
        _SunSize ("Sun Size (radians)", Range(0.002, 0.3)) = 0.038
        _SunIntensity ("Sun Intensity", Range(0, 30)) = 7
        _SunHaloSize ("Halo Size (radians)", Range(0.01, 1.5)) = 0.24
        _SunHaloStrength ("Halo Strength", Range(0, 4)) = 0.9
        _SunGlowColor ("Glow Colour", Color) = (1, 0.6, 0.3, 1)
        _SunGlowFalloff ("Glow Falloff", Range(1, 400)) = 60
        _SunGlowStrength ("Glow Strength", Range(0, 4)) = 0.7

    }

    SubShader
    {
        Tags
        {
            "Queue" = "Background"
            "RenderType" = "Background"
            "PreviewType" = "Skybox"
            "RenderPipeline" = "UniversalPipeline"
        }

        Cull Off
        ZWrite Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _HorizonColor;
                float4 _MidColor;
                float4 _ZenithColor;
                float4 _GroundColor;
                float _MidHeight;
                float _HorizonSoftness;
                float _Exposure;
                float _Dither;

                float4 _SunColor;
                float4 _SunDirection;
                float _SunSize;
                float _SunIntensity;
                float _SunHaloSize;
                float _SunHaloStrength;
                float4 _SunGlowColor;
                float _SunGlowFalloff;
                float _SunGlowStrength;

            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 direction : TEXCOORD0;
            };

            // ---- noise -------------------------------------------------

            // Interleaved gradient noise. Cheap, and unlike a hash it has no
            // visible clumping.
            float InterleavedGradientNoise(float2 pixel)
            {
                return frac(52.9829189 * frac(dot(pixel, float2(0.06711056, 0.00583715))));
            }

            // ---- passes ------------------------------------------------

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                // The skybox mesh is drawn centred on the camera, so its object
                // space position is the view direction.
                output.direction = input.positionOS.xyz;
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                float3 dir = normalize(input.direction);
                float height = dir.y;

                // Horizon -> mid -> zenith going up.
                float up = saturate(height);
                float3 sky = lerp(_HorizonColor.rgb, _MidColor.rgb,
                                  smoothstep(0.0, _MidHeight, up));
                sky = lerp(sky, _ZenithColor.rgb, smoothstep(_MidHeight, 1.0, up));

                // Below the horizon, settle into the ground tone. Softened so
                // the waterline does not get a hard seam behind it.
                float belowHorizon = smoothstep(0.0, -_HorizonSoftness, height);
                sky = lerp(sky, _GroundColor.rgb, belowHorizon);

                float3 sunDir = normalize(_SunDirection.xyz);
                float alignment = dot(dir, sunDir);
                float angle = acos(clamp(alignment, -1.0, 1.0));

                // Three nested falloffs rather than a disc with an edge. The
                // core is a Gaussian, which has no boundary to see - a
                // smoothstep disc always leaves a visible rim however soft the
                // step is made.
                float core = exp(-(angle * angle) / max(_SunSize * _SunSize, 1e-6));
                float halo = exp(-angle / max(_SunHaloSize, 1e-4));
                float wash = pow(saturate(alignment), _SunGlowFalloff);

                // Sink the sun out of view smoothly rather than clipping it at
                // the horizon line.
                float visible = saturate(0.35 + sunDir.y * 5.0);

                sky += _SunColor.rgb * (core * _SunIntensity * visible);
                sky += _SunGlowColor.rgb * (halo * _SunHaloStrength * visible);
                sky += _SunGlowColor.rgb * (wash * _SunGlowStrength);

                sky *= _Exposure;

                // A smooth gradient across a large area steps visibly once
                // quantised to 8 bits. Adding well under one code value of
                // noise breaks the steps into dither the eye reads as smooth.
                float dither = InterleavedGradientNoise(input.positionCS.xy) - 0.5;
                sky += dither * (_Dither / 255.0);

                return half4(sky, 1);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
