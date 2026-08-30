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

    public KeyCode pickupKey = KeyCode.F;
    public KeyCode dropKey = KeyCode.Q;

    InventorySystem _inventory;
    InventoryUI _ui;
    Camera _camera;

    void Start()
    {
        _inventory = GetComponent<InventorySystem>();
        _ui = GetComponent<InventoryUI>();
        _camera = GetComponentInChildren<Camera>();
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
        Vector3 forward = _camera.transform.forward;
        Vector3 position = _camera.transform.position + forward * 1.4f;

        if (spawner != null)
        {
            spawner.Drop(stack.Def, removed, position, forward);
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
