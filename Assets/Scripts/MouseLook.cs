using UnityEngine;

/// <summary>
/// First-person look. Yaw turns the body, pitch tilts the camera only.
/// </summary>
public class MouseLook : MonoBehaviour
{
    [Tooltip("Body that yaws (usually the player root).")]
    public Transform body;
    public float sensitivity = 2f;
    public float minPitch = -85f;
    public float maxPitch = 85f;
    public bool lockCursor = true;

    float _pitch;

    void Start()
    {
        if (body == null && transform.parent != null) body = transform.parent;
        if (lockCursor)
        {
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.Escape))
        {
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }
        else if (Input.GetMouseButtonDown(0) && Cursor.lockState != CursorLockMode.Locked && lockCursor)
        {
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }

        if (lockCursor && Cursor.lockState != CursorLockMode.Locked) return;

        float mx = Input.GetAxisRaw("Mouse X") * sensitivity;
        float my = Input.GetAxisRaw("Mouse Y") * sensitivity;

        if (body != null) body.Rotate(Vector3.up, mx, Space.Self);

        _pitch = Mathf.Clamp(_pitch - my, minPitch, maxPitch);
        transform.localRotation = Quaternion.Euler(_pitch, 0f, 0f);
    }
}
