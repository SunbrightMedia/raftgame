using UnityEngine;

/// <summary>
/// A raft that stays where you put it. It rides the wave height (and
/// optionally tilts to the surface) but never drifts, spins or wanders, so
/// the world moves around the player instead of the player chasing the raft.
/// Exposes the velocity of any point on it so riders can be carried along.
/// </summary>
[RequireComponent(typeof(Rigidbody))]
public class RaftPlatform : MonoBehaviour
{
    [Tooltip("Ride the wave height. Turn off for a completely static raft.")]
    public bool followWaves = true;
    [Tooltip("How much of the wave height the raft takes on. 0 = dead flat.")]
    [Range(0f, 1f)] public float bobAmount = 0.6f;
    [Tooltip("Tilt to match the wave slope. Off keeps the deck level.")]
    public bool tiltWithWaves = false;
    [Tooltip("Maximum tilt in degrees when tilting is enabled.")]
    [Range(0f, 30f)] public float maxTilt = 8f;
    [Tooltip("Smoothing on the vertical motion. Higher = stiffer.")]
    public float followSharpness = 4f;

    /// <summary>Velocity of the deck this physics step (for riders).</summary>
    public Vector3 Velocity { get; private set; }

    Rigidbody _rb;
    Vector3 _anchor;
    Quaternion _anchorRotation;
    float _currentY;

    void Awake()
    {
        _rb = GetComponent<Rigidbody>();
        _rb.isKinematic = true;
        _rb.interpolation = RigidbodyInterpolation.Interpolate;
        _anchor = transform.position;
        _anchorRotation = Quaternion.Euler(0f, transform.eulerAngles.y, 0f);
        _currentY = _anchor.y;
    }

    void FixedUpdate()
    {
        Vector3 previous = _rb.position;

        float targetY = _anchor.y;
        if (followWaves)
        {
            float waveY = WaterSurface.GetHeight(_anchor);
            targetY = _anchor.y + (waveY - WaterLevel()) * bobAmount;
        }

        // Exponential smoothing, framerate independent.
        _currentY = Mathf.Lerp(_currentY, targetY, 1f - Mathf.Exp(-followSharpness * Time.fixedDeltaTime));

        Vector3 target = new Vector3(_anchor.x, _currentY, _anchor.z);
        _rb.MovePosition(target);

        Quaternion targetRotation = _anchorRotation;
        if (tiltWithWaves)
        {
            Vector3 normal = Vector3.Slerp(Vector3.up, WaterSurface.GetNormal(_anchor),
                Mathf.Clamp01(maxTilt / 30f));
            targetRotation = Quaternion.FromToRotation(Vector3.up, normal) * targetRotation;
        }
        _rb.MoveRotation(targetRotation);

        Velocity = (target - previous) / Time.fixedDeltaTime;
    }

    float WaterLevel()
    {
        return WaterSurface.Instance != null ? WaterSurface.Instance.transform.position.y : 0f;
    }

    /// <summary>Velocity at a world point (matches Rigidbody.GetPointVelocity).</summary>
    public Vector3 GetPointVelocity(Vector3 worldPoint)
    {
        return Velocity;
    }

    /// <summary>Move the raft's anchor, e.g. to reposition it at runtime.</summary>
    public void SetAnchor(Vector3 position)
    {
        _anchor = position;
    }
}
