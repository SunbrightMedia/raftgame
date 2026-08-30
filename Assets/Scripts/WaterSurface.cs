using UnityEngine;

/// <summary>
/// Procedural ocean. The mesh is a flat grid built once; all wave motion
/// happens in the vertex shader (Raft/Water), so the per-frame CPU cost is
/// a handful of material properties rather than tens of thousands of
/// vertices. <see cref="SampleWaves"/> mirrors the shader's wave function so
/// gameplay code samples exactly the surface that gets drawn.
/// </summary>
[ExecuteAlways]
[RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
public class WaterSurface : MonoBehaviour
{
    public static WaterSurface Instance { get; private set; }

    [System.Serializable]
    public struct Wave
    {
        public Vector2 direction;
        public float amplitude;
        public float wavelength;
        public float speed;
    }

    [Header("Mesh")]
    [Tooltip("Size of the water plane in world units.")]
    public float size = 400f;
    [Tooltip("Vertices per side. The mesh is static, so this is cheap.")]
    [Range(8, 250)] public int resolution = 250;
    [Tooltip("Transform the water recenters on (usually the player).")]
    public Transform followTarget;

    [Header("Wave tuning")]
    [Tooltip("Global multiplier on how fast the waves travel.")]
    [Range(0f, 3f)] public float waveSpeed = 1f;
    [Tooltip("Global multiplier on wave height.")]
    [Range(0f, 3f)] public float waveHeight = 1f;
    [Tooltip("Global multiplier on the distance between peaks.")]
    [Range(0.25f, 4f)] public float waveSpacing = 1f;

    [Header("Waves")]
    [Tooltip("Exactly four waves are sent to the shader; extras are CPU-only.")]
    public Wave[] waves =
    {
        new Wave { direction = new Vector2( 1f,  0.35f), amplitude = 0.45f, wavelength = 26f, speed = 4.5f },
        new Wave { direction = new Vector2(-0.6f, 1f),   amplitude = 0.28f, wavelength = 15f, speed = 3.2f },
        new Wave { direction = new Vector2( 0.4f, -1f),  amplitude = 0.14f, wavelength =  7f, speed = 2.4f },
        // Keep the shortest wavelength above roughly twice the grid cell size
        // (400 / 249 = 1.6m here). Below that it is under-sampled and only
        // aliases; the shader's per-pixel ripples carry finer detail.
        new Wave { direction = new Vector2(-1f, -0.2f),  amplitude = 0.02f, wavelength = 5.5f, speed = 1.6f },
    };

    static readonly int[] WaveIds =
    {
        Shader.PropertyToID("_WaveA"), Shader.PropertyToID("_WaveB"),
        Shader.PropertyToID("_WaveC"), Shader.PropertyToID("_WaveD"),
    };
    static readonly int SpeedsId = Shader.PropertyToID("_WaveSpeeds");
    static readonly int TimeId = Shader.PropertyToID("_WaveTime");

    Mesh _mesh;
    MeshRenderer _renderer;
    MaterialPropertyBlock _block;
    float _cellSize;
    int _builtResolution;
    float _builtSize;

    void OnEnable()
    {
        Instance = this;
        _renderer = GetComponent<MeshRenderer>();
        _block = new MaterialPropertyBlock();
        BuildMesh();
    }

    void OnDisable()
    {
        if (Instance == this) Instance = null;
    }

    void BuildMesh()
    {
        int n = Mathf.Max(2, resolution);
        _cellSize = size / (n - 1);
        _builtResolution = n;
        _builtSize = size;

        if (_mesh == null)
            _mesh = new Mesh { name = "Water", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
        _mesh.Clear();

        var verts = new Vector3[n * n];
        var uvs = new Vector2[n * n];
        var tris = new int[(n - 1) * (n - 1) * 6];

        for (int z = 0, i = 0; z < n; z++)
        {
            for (int x = 0; x < n; x++, i++)
            {
                verts[i] = new Vector3(x * _cellSize - size * 0.5f, 0f, z * _cellSize - size * 0.5f);
                uvs[i] = new Vector2((float)x / (n - 1), (float)z / (n - 1));
            }
        }

        for (int z = 0, t = 0; z < n - 1; z++)
        {
            for (int x = 0; x < n - 1; x++)
            {
                int i = z * n + x;
                tris[t++] = i;     tris[t++] = i + n; tris[t++] = i + 1;
                tris[t++] = i + 1; tris[t++] = i + n; tris[t++] = i + n + 1;
            }
        }

        _mesh.vertices = verts;
        _mesh.uv = uvs;
        _mesh.triangles = tris;
        _mesh.normals = null;

        // Vertices move in the shader, so pad the bounds or the mesh gets
        // culled at grazing angles.
        _mesh.bounds = new Bounds(Vector3.zero, new Vector3(size, 20f, size));

        GetComponent<MeshFilter>().sharedMesh = _mesh;
    }

    void LateUpdate()
    {
        if (_mesh == null || _builtResolution != Mathf.Max(2, resolution) || !Mathf.Approximately(_builtSize, size))
            BuildMesh();

        // Keep the grid under the player, snapped to whole cells so the
        // world-space wave pattern never visibly slides.
        if (followTarget != null)
        {
            Vector3 p = followTarget.position;
            transform.position = new Vector3(
                Mathf.Round(p.x / _cellSize) * _cellSize,
                transform.position.y,
                Mathf.Round(p.z / _cellSize) * _cellSize);
        }

        PushToShader();
    }

    void PushToShader()
    {
        if (_renderer == null) return;

        _renderer.GetPropertyBlock(_block);

        var speeds = Vector4.zero;
        for (int i = 0; i < WaveIds.Length; i++)
        {
            Wave w = i < waves.Length ? waves[i] : default;
            Vector2 d = w.direction.sqrMagnitude > 0.0001f ? w.direction.normalized : Vector2.right;
            _block.SetVector(WaveIds[i],
                new Vector4(d.x, d.y, w.amplitude * waveHeight, w.wavelength * waveSpacing));
            speeds[i] = w.speed * waveSpeed;
        }

        _block.SetVector(SpeedsId, speeds);
        _block.SetFloat(TimeId, WaveTime);
        _renderer.SetPropertyBlock(_block);
    }

    /// <summary>Clock the shader and the physics sampling share.</summary>
    public static float WaveTime =>
        Application.isPlaying ? Time.time : (float)Time.realtimeSinceStartupAsDouble;

    /// <summary>World-space water height at (x, z). Mirrors the shader.</summary>
    public float SampleWaves(float x, float z, float time)
    {
        float y = transform.position.y;
        if (waves == null) return y;

        for (int i = 0; i < waves.Length; i++)
        {
            Wave w = waves[i];
            float wavelength = w.wavelength * waveSpacing;
            if (wavelength <= 0.0001f) continue;
            Vector2 d = w.direction.sqrMagnitude > 0.0001f ? w.direction.normalized : Vector2.right;
            float k = 2f * Mathf.PI / wavelength;
            y += w.amplitude * waveHeight
                 * Mathf.Sin((d.x * x + d.y * z) * k + time * w.speed * waveSpeed);
        }
        return y;
    }

    /// <summary>Current water height at a world position.</summary>
    public static float GetHeight(Vector3 worldPos)
    {
        if (Instance == null) return 0f;
        return Instance.SampleWaves(worldPos.x, worldPos.z, WaveTime);
    }

    /// <summary>Surface normal at a world position, from finite differences.</summary>
    public static Vector3 GetNormal(Vector3 worldPos)
    {
        if (Instance == null) return Vector3.up;

        const float e = 0.5f;
        float t = WaveTime;
        var w = Instance;
        float hL = w.SampleWaves(worldPos.x - e, worldPos.z, t);
        float hR = w.SampleWaves(worldPos.x + e, worldPos.z, t);
        float hD = w.SampleWaves(worldPos.x, worldPos.z - e, t);
        float hU = w.SampleWaves(worldPos.x, worldPos.z + e, t);
        return new Vector3(hL - hR, 2f * e, hD - hU).normalized;
    }
}
