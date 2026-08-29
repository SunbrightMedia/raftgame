using UnityEngine;

/// <summary>
/// Procedural ocean: builds a grid mesh and animates it with a sum of
/// directional sine waves. The same wave function is exposed statically so
/// gameplay code (buoyancy, VFX) samples exactly what the player sees.
/// </summary>
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
    [Tooltip("Vertices per side. Higher = smoother waves, heavier mesh.")]
    [Range(8, 250)] public int resolution = 160;
    [Tooltip("Transform the water recenters on (usually the player).")]
    public Transform followTarget;

    [Header("Waves")]
    public Wave[] waves = new[]
    {
        new Wave { direction = new Vector2( 1f,  0.35f), amplitude = 0.45f, wavelength = 26f, speed = 4.5f },
        new Wave { direction = new Vector2(-0.6f, 1f),   amplitude = 0.28f, wavelength = 15f, speed = 3.2f },
        new Wave { direction = new Vector2( 0.4f, -1f),  amplitude = 0.14f, wavelength =  7f, speed = 2.4f },
        new Wave { direction = new Vector2(-1f, -0.2f),  amplitude = 0.06f, wavelength =  3f, speed = 1.6f },
    };

    Mesh _mesh;
    Vector3[] _baseVerts;
    Vector3[] _verts;
    Vector3[] _normals;
    float _cellSize;

    void OnEnable()
    {
        Instance = this;
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

        _mesh = new Mesh { name = "Water", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };

        _baseVerts = new Vector3[n * n];
        _verts = new Vector3[n * n];
        _normals = new Vector3[n * n];
        var uvs = new Vector2[n * n];
        var tris = new int[(n - 1) * (n - 1) * 6];

        for (int z = 0, i = 0; z < n; z++)
        {
            for (int x = 0; x < n; x++, i++)
            {
                _baseVerts[i] = new Vector3(x * _cellSize - size * 0.5f, 0f, z * _cellSize - size * 0.5f);
                uvs[i] = new Vector2((float)x / (n - 1), (float)z / (n - 1));
                _normals[i] = Vector3.up;
            }
        }

        for (int z = 0, t = 0; z < n - 1; z++)
        {
            for (int x = 0; x < n - 1; x++)
            {
                int i = z * n + x;
                tris[t++] = i;         tris[t++] = i + n;     tris[t++] = i + 1;
                tris[t++] = i + 1;     tris[t++] = i + n;     tris[t++] = i + n + 1;
            }
        }

        _mesh.vertices = _baseVerts;
        _mesh.uv = uvs;
        _mesh.triangles = tris;
        _mesh.normals = _normals;
        GetComponent<MeshFilter>().sharedMesh = _mesh;
    }

    void LateUpdate()
    {
        if (_mesh == null) BuildMesh();

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

        float t = Time.time;
        Vector3 origin = transform.position;

        for (int i = 0; i < _baseVerts.Length; i++)
        {
            Vector3 v = _baseVerts[i];
            float wx = v.x + origin.x;
            float wz = v.z + origin.z;
            v.y = SampleWaves(wx, wz, t) - origin.y;
            _verts[i] = v;
            _normals[i] = SampleNormal(wx, wz, t);
        }

        _mesh.vertices = _verts;
        _mesh.normals = _normals;
        _mesh.RecalculateBounds();
    }

    /// <summary>World-space water height at (x, z) for the given time.</summary>
    public float SampleWaves(float x, float z, float time)
    {
        float y = transform.position.y;
        if (waves == null) return y;

        for (int i = 0; i < waves.Length; i++)
        {
            Wave w = waves[i];
            if (w.wavelength <= 0.0001f) continue;
            Vector2 d = w.direction.sqrMagnitude > 0.0001f ? w.direction.normalized : Vector2.right;
            float k = 2f * Mathf.PI / w.wavelength;
            y += w.amplitude * Mathf.Sin((d.x * x + d.y * z) * k + time * w.speed);
        }
        return y;
    }

    Vector3 SampleNormal(float x, float z, float time)
    {
        const float e = 0.35f;
        float hL = SampleWaves(x - e, z, time);
        float hR = SampleWaves(x + e, z, time);
        float hD = SampleWaves(x, z - e, time);
        float hU = SampleWaves(x, z + e, time);
        return new Vector3(hL - hR, 2f * e, hD - hU).normalized;
    }

    /// <summary>Convenience: current water height at a world position.</summary>
    public static float GetHeight(Vector3 worldPos)
    {
        if (Instance == null) return 0f;
        return Instance.SampleWaves(worldPos.x, worldPos.z, Time.time);
    }
}
