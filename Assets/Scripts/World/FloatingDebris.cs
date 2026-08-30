using UnityEngine;

/// <summary>
/// A pickup floating on the swell. Deliberately has no Rigidbody: it rides
/// <see cref="WaterSurface"/> directly and drifts on a fixed heading, which
/// costs a few maths ops per item instead of a full physics body each. Its
/// collider is a trigger so the player walks through flotsam rather than
/// tripping over it.
/// </summary>
[RequireComponent(typeof(BoxCollider))]
public class FloatingDebris : MonoBehaviour
{
    public ItemDef Item { get; private set; }
    public int Count { get; private set; }

    [Tooltip("How far the item sits above the water line.")]
    public float floatOffset = 0.05f;
    [Tooltip("Drift speed in metres per second.")]
    public float driftSpeed = 0.35f;

    Vector3 _driftDirection;
    float _spinSpeed;
    float _bobPhase;

    /// <summary>
    /// Creates a piece of debris. <paramref name="material"/> is shared across
    /// every item; the per-item colour rides in a property block so no
    /// material instances leak.
    /// </summary>
    public static FloatingDebris Spawn(ItemDef item, int count, Vector3 position,
                                       Material material, Vector3 launchVelocity = default)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = "Debris_" + item.Id;
        go.transform.position = position;
        go.transform.localScale = item.DebrisSize;
        go.transform.rotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);

        var collider = go.GetComponent<BoxCollider>();
        collider.isTrigger = true;

        var renderer = go.GetComponent<MeshRenderer>();
        if (material != null) renderer.sharedMaterial = material;
        var block = new MaterialPropertyBlock();
        renderer.GetPropertyBlock(block);
        block.SetColor("_BaseColor", item.Color);
        block.SetColor("_Color", item.Color);
        renderer.SetPropertyBlock(block);

        var debris = go.AddComponent<FloatingDebris>();
        debris.Item = item;
        debris.Count = count;
        debris._driftDirection = launchVelocity.sqrMagnitude > 0.0001f
            ? new Vector3(launchVelocity.x, 0f, launchVelocity.z).normalized
            : new Vector3(Random.Range(-1f, 1f), 0f, Random.Range(-1f, 1f)).normalized;
        debris._spinSpeed = Random.Range(-14f, 14f);
        debris._bobPhase = Random.Range(0f, Mathf.PI * 2f);

        return debris;
    }

    void Update()
    {
        Vector3 position = transform.position;

        position += _driftDirection * (driftSpeed * Time.deltaTime);
        position.y = WaterSurface.GetHeight(position) + floatOffset
                     + Mathf.Sin(Time.time * 1.3f + _bobPhase) * 0.02f;
        transform.position = position;

        // Lie along the surface rather than staying stubbornly level.
        Vector3 normal = WaterSurface.GetNormal(position);
        Quaternion align = Quaternion.FromToRotation(Vector3.up, normal) * transform.rotation;
        transform.rotation = Quaternion.Slerp(transform.rotation, align, 4f * Time.deltaTime);
        transform.Rotate(Vector3.up, _spinSpeed * Time.deltaTime, Space.Self);
    }

    /// <summary>
    /// Removes up to <paramref name="amount"/> from this pile, destroying it
    /// when empty. Returns how many were taken.
    /// </summary>
    public int Take(int amount)
    {
        int taken = Mathf.Min(amount, Count);
        Count -= taken;
        if (Count <= 0) Destroy(gameObject);
        return taken;
    }
}
