using UnityEngine;

/// <summary>
/// First-person look. Yaw turns the body, pitch tilts the camera only.
/// When the body has a Rigidbody, yaw is written to Rigidbody.rotation in
/// FixedUpdate. Writing transform.rotation from Update on an interpolated
/// rigidbody gets overwritten by the interpolator every physics step, which
/// feels like the view is dragging itself back on a spring. (MoveRotation is
/// not used because the player freezes rotation, and constraints suppress it.)
/// </summary>
public class MouseLook : MonoBehaviour
{
    [Tooltip("Body that yaws (usually the player root).")]
    public Transform body;
    public float sensitivity = 2f;
    public float minPitch = -85f;
    public float maxPitch = 85f;
    public bool lockCursor = true;

    /// <summary>Current yaw in degrees.</summary>
    public float Yaw { get; private set; }

    float _pitch;
    Rigidbody _bodyRigidbody;

    void Start()
    {
        if (body == null && transform.parent != null) body = transform.parent;
        if (body != null)
        {
            Yaw = body.eulerAngles.y;
            _bodyRigidbody = body.GetComponent<Rigidbody>();
        }

        if (lockCursor) CaptureCursor(true);
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.Escape)) CaptureCursor(false);
        else if (Input.GetMouseButtonDown(0) && lockCursor && Cursor.lockState != CursorLockMode.Locked)
            CaptureCursor(true);

        if (lockCursor && Cursor.lockState != CursorLockMode.Locked) return;

        Yaw += Input.GetAxisRaw("Mouse X") * sensitivity;
        _pitch = Mathf.Clamp(_pitch - Input.GetAxisRaw("Mouse Y") * sensitivity, minPitch, maxPitch);

        transform.localRotation = Quaternion.Euler(_pitch, 0f, 0f);

        // No rigidbody: nothing else owns the transform, so write it here.
        if (body != null && _bodyRigidbody == null)
            body.rotation = Quaternion.Euler(0f, Yaw, 0f);
    }

    void FixedUpdate()
    {
        if (_bodyRigidbody != null)
        {
            _bodyRigidbody.rotation = Quaternion.Euler(0f, Yaw, 0f);
            _bodyRigidbody.angularVelocity = Vector3.zero;
        }
    }

    void CaptureCursor(bool capture)
    {
        Cursor.lockState = capture ? CursorLockMode.Locked : CursorLockMode.None;
        Cursor.visible = !capture;
    }
}
