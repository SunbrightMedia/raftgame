using UnityEngine;

/// <summary>
/// A pickup that lives in two states.
///
/// Dropped items start as a real Rigidbody so they arc out of the player's
/// hands, bounce off the deck and land where you'd expect. Once they touch the
/// water they switch to floating: the Rigidbody is removed and the item rides
/// <see cref="WaterSurface"/> directly, which costs a few maths ops instead of
/// a physics body each and keeps a sea full of flotsam cheap. Ambient debris
/// spawns straight into the floating state and never pays for physics at all.
/// </summary>
[RequireComponent(typeof(BoxCollider))]
public class FloatingDebris : MonoBehaviour
{
    public enum State { Falling, Floating }

    public ItemDef Item { get; private set; }
    public int Count { get; private set; }
    public State Mode { get; private set; }

    [Tooltip("How far the item sits above the water line once floating.")]
    public float floatOffset = 0.05f;
    [Tooltip("Drift speed in metres per second.")]
    public float driftSpeed = 0.35f;

    // Dropped items want to feel like waterlogged timber, not polystyrene:
    // heavy enough to shove things, and enough angular drag that they stop
    // tumbling shortly after they land.
    const float DropMass = 12f;
    const float DropAngularDrag = 2.5f;
    const float DropDrag = 0.15f;

    Vector3 _driftDirection;
    float _spinSpeed;
    float _bobPhase;
    BoxCollider _collider;
    Rigidbody _body;

    /// <summary>Ambient flotsam: floats immediately, no physics body.</summary>
    public static FloatingDebris SpawnFloating(ItemDef item, int count, Vector3 position,
                                               Material material)
    {
        var debris = Create(item, count, position, material);
        debris.EnterFloating(RandomHeading());
        return debris;
    }

    /// <summary>
    /// A dropped item: falls under gravity with the given velocity until it
    /// meets the water, then floats.
    /// </summary>
    public static FloatingDebris SpawnDropped(ItemDef item, int count, Vector3 position,
                                              Material material, Vector3 velocity)
    {
        var debris = Create(item, count, position, material);

        debris.Mode = State.Falling;
        debris._collider.isTrigger = false;

        var body = debris.gameObject.AddComponent<Rigidbody>();
        body.mass = DropMass;
        body.drag = DropDrag;
        body.angularDrag = DropAngularDrag;
        body.interpolation = RigidbodyInterpolation.Interpolate;
        body.velocity = velocity;
        body.angularVelocity = Random.insideUnitSphere * 1.2f;
        debris._body = body;

        return debris;
    }

    static FloatingDebris Create(ItemDef item, int count, Vector3 position, Material material)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = "Debris_" + item.Id;
        go.transform.position = position;
        go.transform.localScale = item.DebrisSize;
        go.transform.rotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);

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
        debris._collider = go.GetComponent<BoxCollider>();
        debris._spinSpeed = Random.Range(-14f, 14f);
        debris._bobPhase = Random.Range(0f, Mathf.PI * 2f);
        return debris;
    }

    static Vector3 RandomHeading()
    {
        return new Vector3(Random.Range(-1f, 1f), 0f, Random.Range(-1f, 1f)).normalized;
    }

    void Update()
    {
        if (Mode == State.Falling) CheckSplashdown();
        else FloatOnWaves();
    }

    /// <summary>
    /// A falling item becomes flotsam the moment it reaches the surface. If it
    /// lands on the raft instead it simply stays a physics object and rests on
    /// the deck, which is what you'd expect from dropping something at your feet.
    /// </summary>
    void CheckSplashdown()
    {
        Vector3 position = transform.position;
        if (position.y > WaterSurface.GetHeight(position) + floatOffset) return;

        // Waves wash straight over the deck (the raft only follows part of the
        // wave height), so "the water reached me" is not the same as "I am in
        // open water". An item resting on something solid stays a physics
        // object; without this it turned into flotsam and got dragged under the
        // raft, which read as items randomly vanishing.
        if (Physics.Raycast(position, Vector3.down,
                            transform.localScale.y * 0.5f + 0.2f,
                            ~0, QueryTriggerInteraction.Ignore))
            return;

        Vector3 heading = _body != null
            ? new Vector3(_body.velocity.x, 0f, _body.velocity.z)
            : Vector3.zero;

        if (_body != null)
        {
            Destroy(_body);
            _body = null;
        }

        EnterFloating(heading.sqrMagnitude > 0.01f ? heading.normalized : RandomHeading());
    }

    void EnterFloating(Vector3 heading)
    {
        Mode = State.Floating;
        _driftDirection = heading;
        // Flotsam should be walked through, not tripped over.
        if (_collider != null) _collider.isTrigger = true;
    }

    void FloatOnWaves()
    {
        Vector3 position = transform.position;

        // Deflect off solid geometry rather than drifting through the raft.
        float step = driftSpeed * Time.deltaTime;
        float radius = Mathf.Max(transform.localScale.x, transform.localScale.z) * 0.5f;

        if (Physics.SphereCast(position, radius, _driftDirection, out RaycastHit hit,
                               step + 0.1f, ~0, QueryTriggerInteraction.Ignore))
        {
            Vector3 wall = new Vector3(hit.normal.x, 0f, hit.normal.z);
            _driftDirection = wall.sqrMagnitude > 0.001f
                ? Vector3.Reflect(_driftDirection, wall.normalized).normalized
                : RandomHeading();
        }
        else
        {
            position += _driftDirection * step;
        }

        Vector3 candidate = position;
        candidate.y = WaterSurface.GetHeight(position) + floatOffset
                      + Mathf.Sin(Time.time * 1.3f + _bobPhase) * 0.02f;

        // The raft only follows part of the wave height, so crests genuinely
        // pass through the deck. An item pinned to the surface would ride that
        // crest straight through the raft, so when the swell would push it into
        // something solid, hold its height and steer out instead.
        if (IsBlocked(candidate))
        {
            // Prefer riding up onto whatever is in the way - an item washed
            // over the raft should end up ON the deck, never trapped beneath
            // it where it looks like it disappeared.
            Vector3 above = new Vector3(candidate.x, candidate.y + 3f, candidate.z);
            if (Physics.Raycast(above, Vector3.down, out RaycastHit top, 6f,
                                ~0, QueryTriggerInteraction.Ignore))
            {
                candidate.y = top.point.y + transform.localScale.y * 0.5f + 0.02f;
            }

            if (IsBlocked(candidate))
            {
                candidate.y = position.y;
                SteerAwayFrom(candidate);
            }
            if (IsBlocked(candidate)) candidate = position;
        }

        position = candidate;
        transform.position = position;

        // Lie along the surface rather than staying stubbornly level.
        Vector3 normal = WaterSurface.GetNormal(position);
        Quaternion align = Quaternion.FromToRotation(Vector3.up, normal) * transform.rotation;
        transform.rotation = Quaternion.Slerp(transform.rotation, align, 4f * Time.deltaTime);
        transform.Rotate(Vector3.up, _spinSpeed * Time.deltaTime, Space.Self);
    }

    /// <summary>True if this item would intersect solid geometry there.</summary>
    bool IsBlocked(Vector3 position)
    {
        return Physics.CheckBox(position, transform.localScale * 0.45f, transform.rotation,
                                ~0, QueryTriggerInteraction.Ignore);
    }

    /// <summary>Points the drift away from whatever is crowding this position.</summary>
    void SteerAwayFrom(Vector3 position)
    {
        var hits = Physics.OverlapBox(position, transform.localScale * 0.5f, transform.rotation,
                                      ~0, QueryTriggerInteraction.Ignore);
        if (hits.Length == 0) return;

        Vector3 away = position - hits[0].ClosestPoint(position);
        away.y = 0f;
        _driftDirection = away.sqrMagnitude > 0.0001f ? away.normalized : RandomHeading();
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
