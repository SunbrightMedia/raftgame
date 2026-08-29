using UnityEngine;

/// <summary>
/// Floats a rigidbody by applying an upward force at each probe point
/// proportional to how deep that point is under the water surface.
/// Several probes spread over the body give free pitch/roll bobbing.
/// </summary>
[RequireComponent(typeof(Rigidbody))]
public class Buoyancy : MonoBehaviour
{
    [Tooltip("Points where flotation is sampled. Empty = corners of the collider bounds.")]
    public Transform[] probes;

    [Tooltip("Depth (in metres) at which a probe generates full buoyancy.")]
    public float depthBeforeSubmerged = 0.4f;
    [Tooltip("Upward force per probe, as a multiple of gravity.")]
    public float buoyancyStrength = 2.2f;
    [Tooltip("Linear damping applied while submerged.")]
    public float waterDrag = 1.2f;
    [Tooltip("Angular damping applied while submerged.")]
    public float waterAngularDrag = 1.5f;

    Rigidbody _rb;
    Vector3[] _localProbes;
    float _baseDrag, _baseAngularDrag;

    void Awake()
    {
        _rb = GetComponent<Rigidbody>();
        _baseDrag = _rb.drag;
        _baseAngularDrag = _rb.angularDrag;

        if (probes != null && probes.Length > 0)
        {
            _localProbes = new Vector3[probes.Length];
            for (int i = 0; i < probes.Length; i++)
                _localProbes[i] = transform.InverseTransformPoint(probes[i].position);
        }
        else
        {
            // Default: the four bottom corners of the collider bounds.
            var col = GetComponent<Collider>();
            Vector3 e = col != null ? col.bounds.extents : Vector3.one * 0.5f;
            Vector3 local = col != null ? transform.InverseTransformVector(e) : e;
            float x = Mathf.Abs(local.x) * 0.8f;
            float z = Mathf.Abs(local.z) * 0.8f;
            float y = -Mathf.Abs(local.y);
            _localProbes = new[]
            {
                new Vector3(-x, y, -z), new Vector3(x, y, -z),
                new Vector3(-x, y,  z), new Vector3(x, y,  z),
            };
        }
    }

    void FixedUpdate()
    {
        bool anySubmerged = false;
        float perProbe = Mathf.Abs(Physics.gravity.y) * _rb.mass / _localProbes.Length;

        for (int i = 0; i < _localProbes.Length; i++)
        {
            Vector3 worldPoint = transform.TransformPoint(_localProbes[i]);
            float waterY = WaterSurface.GetHeight(worldPoint);
            float depth = waterY - worldPoint.y;
            if (depth <= 0f) continue;

            anySubmerged = true;
            float submersion = Mathf.Clamp01(depth / depthBeforeSubmerged);
            Vector3 force = Vector3.up * (perProbe * buoyancyStrength * submersion);
            _rb.AddForceAtPosition(force, worldPoint, ForceMode.Force);
        }

        _rb.drag = anySubmerged ? waterDrag : _baseDrag;
        _rb.angularDrag = anySubmerged ? waterAngularDrag : _baseAngularDrag;
    }

    void OnDrawGizmosSelected()
    {
        if (_localProbes == null) return;
        Gizmos.color = Color.cyan;
        foreach (var p in _localProbes)
            Gizmos.DrawWireSphere(transform.TransformPoint(p), 0.12f);
    }
}
