using UnityEngine;

/// <summary>
/// Rigidbody first-person movement that stays put on a moving platform
/// (the raft): the platform's velocity at the player's feet is added to the
/// player's own input velocity, so a drifting raft carries them along.
/// Swimming kicks in once the player's chest drops below the water line.
/// </summary>
[RequireComponent(typeof(Rigidbody), typeof(CapsuleCollider))]
public class FirstPersonController : MonoBehaviour
{
    [Header("Movement")]
    public float walkSpeed = 4f;
    public float sprintSpeed = 7f;
    public float acceleration = 12f;
    public float jumpHeight = 1.1f;

    [Header("Swimming")]
    public float swimSpeed = 2.5f;
    [Tooltip("Upward pull toward the surface when submerged.")]
    public float swimBuoyancy = 12f;
    [Tooltip("Extra climb rate while holding jump underwater.")]
    public float swimAscend = 9f;
    [Tooltip("Dive rate while holding crouch.")]
    public float swimDescend = 11f;
    [Tooltip("Water resistance. Higher stops you faster.")]
    public float swimDrag = 1.5f;
    [Tooltip("Water depth over the feet at or below which jump breaches instead "
           + "of paddling - this is what lets you hop back onto the raft. Must "
           + "exceed swimEnterDepth or the player can never be both swimming "
           + "and shallow enough to use it. Treading water settles around "
           + "1.6m, so this wants to be near the player's full height.")]
    public float breachDepth = 1.95f;
    [Tooltip("How high a breach jump goes, relative to a normal jump.")]
    public float breachJumpScale = 1.15f;
    [Tooltip("Seconds between breach jumps.")]
    public float breachCooldown = 0.45f;
    [Tooltip("Water depth over the feet before swimming starts.")]
    public float swimEnterDepth = 1.1f;

    [Header("Ground check")]
    public LayerMask groundMask = ~0;
    public float groundCheckDistance = 0.35f;

    public bool IsGrounded { get; private set; }
    public bool IsSwimming { get; private set; }

    Rigidbody _rb;
    CapsuleCollider _capsule;
    Transform _camera;
    Vector3 _platformVelocity;

    void Awake()
    {
        _rb = GetComponent<Rigidbody>();
        _capsule = GetComponent<CapsuleCollider>();
        _rb.freezeRotation = true;
        _rb.interpolation = RigidbodyInterpolation.Interpolate;
        _rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
        var cam = GetComponentInChildren<Camera>();
        _camera = cam != null ? cam.transform : transform;
    }

    void FixedUpdate()
    {
        CheckGround();
        CheckWater();

        Vector2 input = GameUI.BlocksGameplay
            ? Vector2.zero
            : new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
        if (input.sqrMagnitude > 1f) input.Normalize();

        if (IsSwimming) Swim(input);
        else Walk(input);
    }

    void CheckGround()
    {
        float radius = _capsule.radius * 0.9f;
        Vector3 origin = transform.position + Vector3.up * (_capsule.radius + 0.05f);
        IsGrounded = false;
        _platformVelocity = Vector3.zero;

        if (Physics.SphereCast(origin, radius, Vector3.down, out RaycastHit hit,
                groundCheckDistance + 0.05f, groundMask, QueryTriggerInteraction.Ignore))
        {
            if (hit.collider.transform.root != transform)
            {
                IsGrounded = true;

                // Anchored platforms (the raft) are kinematic, so their
                // rigidbody reports no velocity - ask the component instead.
                var raft = hit.collider.GetComponentInParent<RaftPlatform>();
                if (raft != null)
                    _platformVelocity = raft.GetPointVelocity(hit.point);
                else if (hit.rigidbody != null && !hit.rigidbody.isKinematic)
                    _platformVelocity = hit.rigidbody.GetPointVelocity(hit.point);
            }
        }
    }

    void CheckWater()
    {
        // Depth of water over the player's feet.
        WaterDepth = WaterSurface.GetHeight(transform.position) - transform.position.y;
        IsSwimming = WaterDepth > swimEnterDepth;
    }

    /// <summary>Metres of water over the player's feet. Negative when clear of it.</summary>
    public float WaterDepth { get; private set; }

    void Walk(Vector2 input)
    {
        bool sprinting = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
        float speed = sprinting ? sprintSpeed : walkSpeed;
        Vector3 wish = (transform.forward * input.y + transform.right * input.x) * speed;
        Vector3 target = _platformVelocity + wish;

        Vector3 velocity = _rb.velocity;
        Vector3 horizontal = new Vector3(velocity.x, 0f, velocity.z);
        Vector3 targetHorizontal = new Vector3(target.x, 0f, target.z);
        Vector3 delta = targetHorizontal - horizontal;

        float control = IsGrounded ? acceleration : acceleration * 0.25f;
        _rb.AddForce(delta * control, ForceMode.Acceleration);

        if (IsGrounded && !GameUI.BlocksGameplay && Input.GetKey(KeyCode.Space))
        {
            float jumpVelocity = Mathf.Sqrt(2f * Mathf.Abs(Physics.gravity.y) * jumpHeight);
            _rb.velocity = new Vector3(velocity.x, _platformVelocity.y + jumpVelocity, velocity.z);
        }
    }

    void Swim(Vector2 input)
    {
        bool wantUp = Input.GetKey(KeyCode.Space);
        bool wantDown = Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.RightControl);

        Vector3 wish = (_camera.forward * input.y + _camera.right * input.x) * swimSpeed;
        _rb.AddForce((wish - _rb.velocity) * 4f, ForceMode.Acceleration);

        // Near the surface, jump breaches the water instead of paddling - this
        // is what gets the player back onto the raft. Deeper down the same key
        // just swims upward.
        //
        // The threshold has to sit ABOVE swimEnterDepth: below it the player
        // is not swimming at all and never reaches this code. Guarding here
        // rather than trusting the inspector value, because when these two
        // cross over the feature simply goes dead with nothing to show for it.
        float breach = Mathf.Max(breachDepth, swimEnterDepth + 0.2f);

        if (wantUp && WaterDepth <= breach && Time.time >= _nextBreachTime)
        {
            _nextBreachTime = Time.time + breachCooldown;
            // Briefly stop damping so the launch is not immediately eaten by
            // water drag while the body is still submerged.
            _breachUntil = Time.time + 0.35f;

            float jumpVelocity = Mathf.Sqrt(
                2f * Mathf.Abs(Physics.gravity.y) * jumpHeight * breachJumpScale);
            _rb.velocity = new Vector3(_rb.velocity.x, jumpVelocity, _rb.velocity.z);
            return;
        }

        // Buoyancy pulls toward the surface, but stop fighting the player when
        // they are deliberately diving or there is nothing left to fight.
        float submersion = Mathf.Clamp01(WaterDepth / 2f);
        float buoyancy = wantDown ? swimBuoyancy * 0.1f : swimBuoyancy;
        _rb.AddForce(Vector3.up * (buoyancy * submersion), ForceMode.Acceleration);

        if (wantUp) _rb.AddForce(Vector3.up * swimAscend, ForceMode.Acceleration);
        if (wantDown) _rb.AddForce(Vector3.down * swimDescend, ForceMode.Acceleration);

        if (Time.time >= _breachUntil)
            _rb.AddForce(-_rb.velocity * swimDrag, ForceMode.Acceleration);
    }

    float _nextBreachTime;
    float _breachUntil;
}
