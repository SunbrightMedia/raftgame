// Water displaced on the GPU. The wave function here is kept identical to
// WaterSurface.SampleWaves on the CPU (the C# side pushes the same
// parameters and time into this material), so physics matches what you see
// without the CPU ever touching the mesh.
Shader "Raft/Water"
{
    Properties
    {
        _Color ("Color", Color) = (0.13, 0.42, 0.58, 0.82)
        _Glossiness ("Smoothness", Range(0,1)) = 0.9
        _Metallic ("Metallic", Range(0,1)) = 0.1
        _FresnelPower ("Fresnel Power", Range(0.5, 8)) = 4

        // Per wave: xy = normalized direction, z = amplitude, w = wavelength.
        _WaveA ("Wave A", Vector) = (1, 0.35, 0.45, 26)
        _WaveB ("Wave B", Vector) = (-0.6, 1, 0.28, 15)
        _WaveC ("Wave C", Vector) = (0.4, -1, 0.14, 7)
        _WaveD ("Wave D", Vector) = (-1, -0.2, 0.06, 3)
        _WaveSpeeds ("Wave Speeds", Vector) = (4.5, 3.2, 2.4, 1.6)
        _WaveTime ("Wave Time", Float) = 0
    }

    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "IgnoreProjector" = "True" }
        LOD 200

        CGPROGRAM
        #pragma surface surf Standard alpha:fade vertex:vert nolightmap
        #pragma target 3.0

        struct Input
        {
            float3 worldNormal;
            float3 viewDir;
            INTERNAL_DATA
        };

        fixed4 _Color;
        half _Glossiness;
        half _Metallic;
        half _FresnelPower;
        float4 _WaveA, _WaveB, _WaveC, _WaveD;
        float4 _WaveSpeeds;
        float _WaveTime;

        // Accumulates height and the two slope derivatives for one wave.
        void AddWave(float4 wave, float speed, float2 pos, inout float height, inout float2 slope)
        {
            if (wave.w < 0.0001) return;

            float2 dir = normalize(wave.xy);
            float k = 6.28318530718 / wave.w;
            float phase = (dir.x * pos.x + dir.y * pos.y) * k + _WaveTime * speed;

            height += wave.z * sin(phase);
            slope  += dir * (wave.z * k * cos(phase));
        }

        void vert(inout appdata_full v)
        {
            float3 worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;

            float height = 0;
            float2 slope = 0;
            AddWave(_WaveA, _WaveSpeeds.x, worldPos.xz, height, slope);
            AddWave(_WaveB, _WaveSpeeds.y, worldPos.xz, height, slope);
            AddWave(_WaveC, _WaveSpeeds.z, worldPos.xz, height, slope);
            AddWave(_WaveD, _WaveSpeeds.w, worldPos.xz, height, slope);

            // The mesh is flat and unrotated, so object-space Y is the offset.
            v.vertex.y = height;
            v.normal = normalize(float3(-slope.x, 1, -slope.y));
        }

        void surf(Input IN, inout SurfaceOutputStandard o)
        {
            // Grazing angles read brighter, which sells the surface as water.
            half fresnel = pow(1 - saturate(dot(normalize(IN.viewDir), o.Normal)), _FresnelPower);

            o.Albedo = _Color.rgb + fresnel * 0.35;
            o.Metallic = _Metallic;
            o.Smoothness = _Glossiness;
            o.Alpha = saturate(_Color.a + fresnel * 0.4);
        }
        ENDCG
    }

    FallBack "Transparent/Diffuse"
}
