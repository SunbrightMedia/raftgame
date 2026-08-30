using UnityEngine;

/// <summary>
/// Looking at floating debris offers it for pickup (F); Q drops from the
/// active hotbar slot. A spherecast rather than a thin ray does the aiming, so
/// small items bobbing on the swell don't have to be hit dead centre.
/// </summary>
public class PickupInteractor : MonoBehaviour
{
    [Tooltip("How far the player can reach.")]
    public float reach = 4.5f;
    [Tooltip("Aim forgiveness. 0 = a pinpoint ray.")]
    public float aimRadius = 0.35f;

    [Header("Dropping")]
    [Tooltip("How far below the eyes items are released from.")]
    public float dropHeightBelowEyes = 0.45f;
    [Tooltip("Forward toss speed.")]
    public float dropForwardSpeed = 2.6f;
    [Tooltip("Upward lob added to the toss.")]
    public float dropUpwardSpeed = 1.1f;

    public KeyCode pickupKey = KeyCode.F;
    public KeyCode dropKey = KeyCode.Q;

    InventorySystem _inventory;
    InventoryUI _ui;
    Camera _camera;
    Rigidbody _body;

    void Start()
    {
        _inventory = GetComponent<InventorySystem>();
        _ui = GetComponent<InventoryUI>();
        _camera = GetComponentInChildren<Camera>();
        _body = GetComponent<Rigidbody>();
    }

    void Update()
    {
        if (_inventory == null || _camera == null) return;

        if (GameUI.BlocksGameplay)
        {
            SetPrompt(string.Empty);
            return;
        }

        FloatingDebris target = FindTarget();

        if (target != null)
        {
            SetPrompt(string.Format("[{0}] Pick up {1}{2}",
                pickupKey, target.Item.DisplayName,
                target.Count > 1 ? " x" + target.Count : string.Empty));

            if (Input.GetKeyDown(pickupKey)) Pickup(target);
        }
        else
        {
            SetPrompt(string.Empty);
        }

        if (Input.GetKeyDown(dropKey)) Drop();
    }

    FloatingDebris FindTarget()
    {
        Ray ray = new Ray(_camera.transform.position, _camera.transform.forward);

        if (Physics.SphereCast(ray, aimRadius, out RaycastHit hit, reach,
                               ~0, QueryTriggerInteraction.Collide))
        {
            return hit.collider.GetComponentInParent<FloatingDebris>();
        }
        return null;
    }

    void Pickup(FloatingDebris debris)
    {
        int wanted = debris.Count;
        int leftOver = _inventory.Inventory.Add(debris.Item, wanted);
        int accepted = wanted - leftOver;

        if (accepted > 0) debris.Take(accepted);
        else SetPrompt("Inventory full");
    }

    void Drop()
    {
        ItemStack stack = _inventory.ActiveStack;
        if (stack.IsEmpty) return;

        // Shift drops the whole stack, otherwise a single item.
        bool wholeStack = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
        int count = wholeStack ? stack.Count : 1;

        int removed = _inventory.Inventory.RemoveFromSlot(_inventory.SelectedSlot, count);
        if (removed <= 0) return;

        var spawner = DebrisSpawner.Instance;
        Transform eye = _camera.transform;

        // Release from roughly torso height, just in front of the chest.
        Vector3 position = eye.position
                           - Vector3.up * dropHeightBelowEyes
                           + eye.forward * 0.45f;

        // Inherit the player's motion so dropping while running throws forward
        // rather than dropping something that hangs in the air behind you.
        Vector3 inherited = _body != null ? _body.velocity : Vector3.zero;
        Vector3 velocity = inherited
                           + eye.forward * dropForwardSpeed
                           + Vector3.up * dropUpwardSpeed;

        if (spawner != null)
        {
            spawner.Drop(stack.Def, removed, position, velocity);
        }
        else
        {
            // No spawner in the scene: don't silently eat the items.
            _inventory.Inventory.Add(stack.Def, removed);
        }
    }

    void SetPrompt(string text)
    {
        if (_ui != null) _ui.SetPrompt(text);
    }
}
