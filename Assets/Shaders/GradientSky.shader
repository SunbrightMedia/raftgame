// Three-stop gradient skybox with a soft sun and raymarched clouds.
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

        [Header(Clouds)]
        _CloudColor ("Cloud Lit Colour", Color) = (1, 0.98, 0.95, 1)
        _CloudShadowColor ("Cloud Shadow Colour", Color) = (0.42, 0.47, 0.60, 1)
        _CloudOpacity ("Cloud Opacity", Range(0, 1)) = 0.85
        _CloudCoverage ("Coverage Threshold", Range(0, 1)) = 0.50
        _CloudSoftness ("Edge Softness", Range(0.01, 0.6)) = 0.32
        _CloudScale ("Horizontal Size", Range(0.05, 3)) = 0.55
        _CloudVerticalScale ("Vertical Squash", Range(0.2, 6)) = 1.1
        _CloudWarp ("Shape Warp", Range(0, 3)) = 1.1
        _CloudBottom ("Layer Bottom", Range(10, 600)) = 80
        _CloudTop ("Layer Top", Range(20, 1200)) = 520
        _CloudHeightVariation ("Height Variation", Range(0, 1)) = 0.75
        _CloudMinThickness ("Min Thickness", Range(0.05, 1)) = 0.18
        _CloudProfileScale ("Height Variation Scale", Range(0.1, 4)) = 0.8
        _CloudTowering ("Towering", Range(0, 0.6)) = 0.26
        _CloudDensity ("Density", Range(0.1, 12)) = 3.5
        _CloudSpeed ("Drift Speed", Range(0, 20)) = 2.2
        _CloudSteps ("March Steps", Range(4, 24)) = 12
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

                float4 _CloudColor;
                float4 _CloudShadowColor;
                float _CloudOpacity;
                float _CloudCoverage;
                float _CloudSoftness;
                float _CloudScale;
                float _CloudVerticalScale;
                float _CloudWarp;
                float _CloudBottom;
                float _CloudTop;
                float _CloudHeightVariation;
                float _CloudMinThickness;
                float _CloudProfileScale;
                float _CloudTowering;
                float _CloudDensity;
                float _CloudSpeed;
                float _CloudSteps;
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

            float Hash3(float3 p)
            {
                p = frac(p * 0.3183099 + float3(0.11, 0.17, 0.23));
                p *= 17.0;
                return frac(p.x * p.y * p.z * (p.x + p.y + p.z));
            }

            float Noise3(float3 p)
            {
                float3 i = floor(p);
                float3 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);

                return lerp(
                    lerp(lerp(Hash3(i + float3(0, 0, 0)), Hash3(i + float3(1, 0, 0)), f.x),
                         lerp(Hash3(i + float3(0, 1, 0)), Hash3(i + float3(1, 1, 0)), f.x), f.y),
                    lerp(lerp(Hash3(i + float3(0, 0, 1)), Hash3(i + float3(1, 0, 1)), f.x),
                         lerp(Hash3(i + float3(0, 1, 1)), Hash3(i + float3(1, 1, 1)), f.x), f.y),
                    f.z);
            }

            // Three octaves is about the floor for something that reads as
            // cloud rather than as blobs: the coarse octave carries the mass,
            // the finer ones give the fuzz along its edge.
            float Fbm(float3 p)
            {
                float sum = 0.0;
                float amplitude = 0.5;

                [unroll]
                for (int i = 0; i < 3; i++)
                {
                    sum += amplitude * Noise3(p);
                    p *= 2.03;
                    amplitude *= 0.5;
                }
                return sum;
            }

            // Interleaved gradient noise. Cheap, and unlike a hash it has no
            // visible clumping.
            float InterleavedGradientNoise(float2 pixel)
            {
                return frac(52.9829189 * frac(dot(pixel, float2(0.06711056, 0.00583715))));
            }

            // ---- clouds ------------------------------------------------

            // Where the clouds above this patch of sky start and stop, as
            // fractions of the slab.
            //
            // This is what stops the layer reading as one flat sheet. With a
            // single fixed vertical envelope every cloud occupies exactly the
            // same slice of the slab, so however varied their outlines are they
            // all share a top and a bottom - which is precisely what a sheet
            // is. Letting the base and thickness wander per column gives tall
            // towers in one place and thin wisps in another.
            void CloudProfile(float2 xz, out float baseHeight, out float topHeight)
            {
                float2 w = xz * (_CloudScale * 0.01) * _CloudProfileScale;
                w += _Time.y * _CloudSpeed * 0.01;

                float where = Noise3(float3(w, 3.7));
                float howTall = Noise3(float3(w * 1.7 + 11.3, 8.1));

                // Thickness ranges from a wisp to nearly the whole slab.
                float thickness = lerp(_CloudMinThickness, 1.0,
                                       howTall * _CloudHeightVariation);
                baseHeight = lerp(0.0, 1.0 - thickness, where * _CloudHeightVariation);
                topHeight = baseHeight + thickness;
            }

            float CloudDensity(float3 p)
            {
                // Squashing the vertical axis before sampling biases the shapes
                // toward layered forms rather than spheres.
                float3 q = p * (_CloudScale * 0.01);
                q.y *= _CloudVerticalScale;
                q.xz += _Time.y * _CloudSpeed * 0.01;

                // Domain warp. Plain FBM is uniform mush; pushing the sample
                // point around with more noise is what gives clouds their
                // billowed, non-repeating shapes.
                float3 warp = float3(Fbm(q * 0.55),
                                     Fbm(q * 0.55 + 13.7),
                                     Fbm(q * 0.55 + 27.3)) - 0.5;
                q += warp * _CloudWarp;

                float raw = Fbm(q);

                // Position within THIS column's cloud, not within the slab.
                float slab = saturate((p.y - _CloudBottom) / max(_CloudTop - _CloudBottom, 0.001));
                float baseHeight, topHeight;
                CloudProfile(p.xz, baseHeight, topHeight);
                float local = (slab - baseHeight) / max(topHeight - baseHeight, 0.001);
                if (local < 0.0 || local > 1.0) return 0.0;

                // Raising the coverage threshold with height erodes the upper
                // part of each cloud, so they sit wide at the base and round
                // off toward the top instead of ending in a flat lid.
                float threshold = _CloudCoverage + local * _CloudTowering;
                float density = smoothstep(threshold, threshold + _CloudSoftness, raw);

                // Feather both ends of the column so nothing is cut square.
                density *= smoothstep(0.0, 0.22, local) * (1.0 - smoothstep(0.55, 1.0, local));
                return density;
            }

            // Returns premultiplied colour in rgb and coverage in a.
            float4 MarchClouds(float3 dir, float3 sunDir, float3 litColor, float3 shadowColor)
            {
                // Rays near the horizon cross enormous distances of the layer
                // and smear into streaks, so fade them out.
                float horizon = smoothstep(0.02, 0.22, dir.y);
                if (horizon <= 0.001) return (float4)0;

                float tBottom = _CloudBottom / dir.y;
                float tTop = _CloudTop / dir.y;

                int steps = (int)_CloudSteps;
                float dt = (tTop - tBottom) / steps;

                float3 accum = 0;
                float transmittance = 1;

                [loop]
                for (int i = 0; i < steps; i++)
                {
                    float3 p = dir * (tBottom + dt * (i + 0.5));
                    float density = CloudDensity(p);
                    if (density <= 0.001) continue;

                    // A single sample toward the sun approximates
                    // self-shadowing: the bright rim and darker underside are
                    // what make a cloud look solid rather than painted on.
                    float toward = CloudDensity(p + sunDir * (dt * 0.75));
                    float light = exp(-toward * 3.0);

                    float alpha = 1.0 - exp(-density * dt * _CloudDensity * 0.01);
                    float3 shade = lerp(shadowColor, litColor, light);

                    accum += transmittance * alpha * shade;
                    transmittance *= (1.0 - alpha);

                    if (transmittance < 0.01) break;
                }

                float coverage = (1.0 - transmittance) * horizon * _CloudOpacity;
                return float4(accum * horizon * _CloudOpacity, coverage);
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

                // Clouds sit in front of the sky but behind the sun's glow, so
                // a low sun still burns through them.
                float4 clouds = MarchClouds(dir, sunDir, _CloudColor.rgb, _CloudShadowColor.rgb);
                sky = sky * (1.0 - clouds.a) + clouds.rgb;

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
