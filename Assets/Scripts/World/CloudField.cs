using UnityEngine;

/// <summary>
/// A sky full of low-poly cloud meshes that drifts overhead and recentres on
/// the player, so the ocean never runs out of sky.
///
/// Meshes rather than a raymarched volume: an angular, flat-shaded style wants
/// a real polygon silhouette. Marching a density field and then hardening it
/// only exposes the sampling - the individual march planes show up as stacked
/// translucent slabs, which is exactly what went wrong before this.
/// </summary>
public class CloudField : MonoBehaviour
{
    public static CloudField Instance { get; private set; }

    [Header("Field")]
    [Tooltip("Transform the cloud field follows.")]
    public Transform followTarget;
    [Tooltip("Shared material for every cloud.")]
    public Material cloudMaterial;

    [Tooltip("How many clouds are in the sky.")]
    [Range(0, 120)] public int cloudCount = 34;
    [Tooltip("Radius of the field around the player.")]
    public float fieldRadius = 900f;
    [Tooltip("Lowest and highest cloud altitude.")]
    public Vector2 altitudeRange = new Vector2(180f, 420f);
    [Tooltip("Drift speed in metres per second.")]
    public float driftSpeed = 3.5f;
    [Tooltip("Direction the weather moves.")]
    public Vector2 driftDirection = new Vector2(1f, 0.35f);

    [Header("Shape")]
    [Tooltip("Overall width of a cloud.")]
    public Vector2 sizeRange = new Vector2(70f, 190f);
    [Tooltip("Lumps per cloud. More means a longer, more broken-up mass.")]
    public Vector2Int blobRange = new Vector2Int(4, 9);
    [Tooltip("0 gives 20 big facets per lump, 1 gives 80. Lower is harsher.")]
    [Range(0, 2)] public int subdivisions = 1;
    [Tooltip("How far vertices are pushed off the sphere. Facet visibility "
           + "comes from face SIZE, not from this - push it far and the "
           + "silhouette just goes spiky while the tris stay the same.")]
    [Range(0f, 0.8f)] public float bumpiness = 0.24f;
    [Tooltip("Vertical squash. Clouds are much wider than they are tall.")]
    [Range(0.05f, 1f)] public float flatness = 0.34f;
    [Tooltip("Number of distinct meshes built and reused across the field.")]
    [Range(1, 24)] public int meshVariants = 10;

    [Header("Appearance")]
    [Range(0f, 1f)] public float opacity = 1f;

    Transform _root;
    Transform[] _clouds;
    Vector3[] _basePositions;
    Vector2 _drift;
    Mesh[] _meshes;

    void OnEnable() => Instance = this;
    void OnDisable() { if (Instance == this) Instance = null; }

    void Start()
    {
        if (cloudMaterial == null)
        {
            var shader = Shader.Find("Raft/StylizedCloud");
            if (shader != null)
                cloudMaterial = new Material(shader) { name = "Cloud (runtime)" };
        }

        Build();
    }

    void Build()
    {
        if (_root != null) Destroy(_root.gameObject);

        _root = new GameObject("Clouds").transform;
        _root.SetParent(transform, false);

        BuildMeshes();

        _clouds = new Transform[cloudCount];
        _basePositions = new Vector3[cloudCount];

        var random = new System.Random(20260829);

        for (int i = 0; i < cloudCount; i++)
        {
            var go = new GameObject("Cloud " + i, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(_root, false);

            go.GetComponent<MeshFilter>().sharedMesh = _meshes[random.Next(_meshes.Length)];

            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = cloudMaterial;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            // Scatter over a disc. Square-rooting the radius keeps them evenly
            // spread instead of bunched around the centre.
            float angle = (float)random.NextDouble() * Mathf.PI * 2f;
            float radius = Mathf.Sqrt((float)random.NextDouble()) * fieldRadius;
            float altitude = Mathf.Lerp(altitudeRange.x, altitudeRange.y,
                                        (float)random.NextDouble());

            _basePositions[i] = new Vector3(Mathf.Cos(angle) * radius, altitude,
                                            Mathf.Sin(angle) * radius);

            float size = Mathf.Lerp(sizeRange.x, sizeRange.y, (float)random.NextDouble());
            go.transform.localScale = Vector3.one * size;
            go.transform.rotation = Quaternion.Euler(0f, (float)random.NextDouble() * 360f, 0f);

            _clouds[i] = go.transform;
        }
    }

    void BuildMeshes()
    {
        _meshes = new Mesh[Mathf.Max(1, meshVariants)];
        var random = new System.Random(4242);

        for (int i = 0; i < _meshes.Length; i++)
        {
            int blobs = random.Next(blobRange.x, blobRange.y + 1);
            _meshes[i] = CloudMeshBuilder.Build(
                seed: 1000 + i,
                blobs: blobs,
                subdivisions: subdivisions,
                bumpiness: bumpiness,
                // Lumps spread mostly sideways, so clouds grow long rather
                // than tall.
                spread: new Vector3(1.35f, 0.28f, 1.0f),
                blobScaleRange: new Vector2(0.58f, 0.95f),
                squash: new Vector3(1f, flatness, 1f));
        }
    }

    void Update()
    {
        if (_clouds == null) return;

        Vector2 direction = driftDirection.sqrMagnitude > 0.0001f
            ? driftDirection.normalized
            : Vector2.right;
        _drift += direction * (driftSpeed * Time.deltaTime);

        Vector3 centre = followTarget != null ? followTarget.position : transform.position;
        centre.y = 0f;

        float span = fieldRadius * 2f;

        for (int i = 0; i < _clouds.Length; i++)
        {
            if (_clouds[i] == null) continue;

            // Wrap the field around the player so clouds recycle rather than
            // running out, and so the sky never visibly ends.
            float x = Mathf.Repeat(_basePositions[i].x + _drift.x - centre.x + fieldRadius, span)
                      - fieldRadius + centre.x;
            float z = Mathf.Repeat(_basePositions[i].z + _drift.y - centre.z + fieldRadius, span)
                      - fieldRadius + centre.z;

            _clouds[i].position = new Vector3(x, _basePositions[i].y, z);
        }
    }

    /// <summary>Rebuilds the field after shape settings change.</summary>
    public void Rebuild() => Build();

    /// <summary>Sets how solid the clouds render.</summary>
    public void SetOpacity(float value)
    {
        opacity = Mathf.Clamp01(value);
        if (cloudMaterial != null) cloudMaterial.SetFloat("_Opacity", opacity);
    }

    /// <summary>Shows or hides part of the field, for a coverage control.</summary>
    public void SetCoverage(float coverage)
    {
        if (_clouds == null) return;

        int visible = Mathf.RoundToInt(Mathf.Clamp01(coverage) * _clouds.Length);
        for (int i = 0; i < _clouds.Length; i++)
        {
            if (_clouds[i] != null && _clouds[i].gameObject.activeSelf != (i < visible))
                _clouds[i].gameObject.SetActive(i < visible);
        }
    }
}
