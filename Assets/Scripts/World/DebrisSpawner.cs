using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Keeps a population of flotsam drifting around the player: spawns new pieces
/// in a ring just outside comfortable view, and reclaims anything that drifts
/// too far away, so the count stays flat however long you play.
/// </summary>
public class DebrisSpawner : MonoBehaviour
{
    public static DebrisSpawner Instance { get; private set; }

    [Tooltip("Player the debris field follows.")]
    public Transform followTarget;
    [Tooltip("Shared material for every piece of debris.")]
    public Material debrisMaterial;

    [Header("Population")]
    [Tooltip("How many pieces to keep floating at once.")]
    [Range(0, 120)] public int maxDebris = 28;
    [Tooltip("Seconds between spawn attempts.")]
    public float spawnInterval = 1.5f;

    [Header("Distances")]
    [Tooltip("Nearest a new piece will appear.")]
    public float spawnRadiusMin = 14f;
    [Tooltip("Furthest a new piece will appear.")]
    public float spawnRadiusMax = 45f;
    [Tooltip("Pieces beyond this are recycled.")]
    public float despawnRadius = 70f;

    readonly List<FloatingDebris> _live = new List<FloatingDebris>();
    float _nextSpawn;

    void OnEnable() => Instance = this;
    void OnDisable() { if (Instance == this) Instance = null; }

    void Start()
    {
        // Start with a populated ocean instead of waiting a minute for one.
        for (int i = 0; i < maxDebris / 2; i++) SpawnOne();
    }

    void Update()
    {
        _live.RemoveAll(d => d == null);

        if (followTarget != null)
        {
            Vector3 centre = followTarget.position;
            for (int i = _live.Count - 1; i >= 0; i--)
            {
                Vector3 offset = _live[i].transform.position - centre;
                offset.y = 0f;
                if (offset.sqrMagnitude > despawnRadius * despawnRadius)
                {
                    Destroy(_live[i].gameObject);
                    _live.RemoveAt(i);
                }
            }
        }

        if (Time.time >= _nextSpawn)
        {
            _nextSpawn = Time.time + spawnInterval;
            if (_live.Count < maxDebris) SpawnOne();
        }
    }

    void SpawnOne()
    {
        Vector3 centre = followTarget != null ? followTarget.position : transform.position;

        float angle = Random.Range(0f, Mathf.PI * 2f);
        float radius = Random.Range(spawnRadiusMin, spawnRadiusMax);
        Vector3 position = centre + new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)) * radius;
        position.y = WaterSurface.GetHeight(position);

        ItemDef item = Items.Flotsam[Random.Range(0, Items.Flotsam.Length)];
        var debris = FloatingDebris.SpawnFloating(item, Random.Range(1, 4), position, debrisMaterial);
        _live.Add(debris);
    }

    /// <summary>
    /// Drops an item into the world with real physics - it arcs, bounces off
    /// the deck and floats once it hits the water.
    /// </summary>
    public FloatingDebris Drop(ItemDef item, int count, Vector3 position, Vector3 velocity)
    {
        var debris = FloatingDebris.SpawnDropped(item, count, position, debrisMaterial, velocity);
        _live.Add(debris);
        return debris;
    }
}
