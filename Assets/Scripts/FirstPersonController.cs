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
    public float swimBuoyancy = 12f;

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

        Vector2 input = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
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
                var platform = hit.rigidbody;
                if (platform != null && !platform.isKinematic)
                    _platformVelocity = platform.GetPointVelocity(hit.point);
            }
        }
    }

    void CheckWater()
    {
        float chestY = transform.position.y + _capsule.height * 0.75f;
        IsSwimming = WaterSurface.GetHeight(transform.position) > chestY;
    }

    void Walk(Vector2 input)
    {
        float speed = Input.GetKey(KeyCode.LeftShift) ? sprintSpeed : walkSpeed;
        Vector3 wish = (transform.forward * input.y + transform.right * input.x) * speed;
        Vector3 target = _platformVelocity + wish;

        Vector3 velocity = _rb.velocity;
        Vector3 horizontal = new Vector3(velocity.x, 0f, velocity.z);
        Vector3 targetHorizontal = new Vector3(target.x, 0f, target.z);
        Vector3 delta = targetHorizontal - horizontal;

        float control = IsGrounded ? acceleration : acceleration * 0.25f;
        _rb.AddForce(delta * control, ForceMode.Acceleration);

        if (IsGrounded && Input.GetKey(KeyCode.Space))
        {
            float jumpVelocity = Mathf.Sqrt(2f * Mathf.Abs(Physics.gravity.y) * jumpHeight);
            _rb.velocity = new Vector3(velocity.x, _platformVelocity.y + jumpVelocity, velocity.z);
        }
    }

    void Swim(Vector2 input)
    {
        Vector3 wish = (_camera.forward * input.y + _camera.right * input.x) * swimSpeed;
        _rb.AddForce((wish - _rb.velocity) * 4f, ForceMode.Acceleration);

        // Push back up to the surface, damped so the player bobs instead of popping out.
        float surface = WaterSurface.GetHeight(transform.position);
        float submersion = Mathf.Clamp01((surface - transform.position.y) / 2f);
        _rb.AddForce(Vector3.up * (swimBuoyancy * submersion), ForceMode.Acceleration);
        _rb.AddForce(-_rb.velocity * 1.5f, ForceMode.Acceleration);

        if (Input.GetKey(KeyCode.Space))
            _rb.AddForce(Vector3.up * swimSpeed * 2f, ForceMode.Acceleration);
    }
}
