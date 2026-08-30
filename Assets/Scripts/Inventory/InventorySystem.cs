using UnityEngine;

/// <summary>
/// Player inventory: an always-visible hotbar plus a backpack panel toggled
/// with E. Number keys 1-8 and the scroll wheel pick the active hotbar slot.
/// While the panel is open, clicking a slot picks the stack up onto the
/// cursor; clicking again places, merges or swaps it. Movement and mouse
/// look pause while the panel is open (via <see cref="IsOpen"/>).
/// </summary>
public class InventorySystem : MonoBehaviour
{
    public const int HotbarSize = 8;
    public const int BackpackRows = 3;
    public const int Size = HotbarSize + HotbarSize * BackpackRows;

    /// <summary>True while the backpack panel is open. Gameplay input checks this.</summary>
    public static bool IsOpen { get; private set; }

    public Inventory Inventory { get; private set; }
    public int SelectedSlot { get; private set; }

    /// <summary>Stack currently carried on the cursor while rearranging.</summary>
    public ItemStack Held;

    /// <summary>The stack in the active hotbar slot (for tools/building later).</summary>
    public ItemStack ActiveStack => Inventory.Slots[SelectedSlot];

    void Awake()
    {
        Inventory = new Inventory(Size);
        gameObject.AddComponent<InventoryUI>();
    }

    void Start()
    {
        // Starter kit so the UI has something to show. Remove once items
        // come from the world.
        Inventory.Add(Items.Wood, 24);
        Inventory.Add(Items.Plank, 8);
        Inventory.Add(Items.Rope, 5);
        Inventory.Add(Items.Scrap, 3);
    }

    void OnDestroy()
    {
        if (IsOpen) IsOpen = false;
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.E)) SetOpen(!IsOpen);
        else if (IsOpen && Input.GetKeyDown(KeyCode.Escape)) SetOpen(false);

        if (IsOpen) return;

        for (int i = 0; i < HotbarSize; i++)
        {
            if (Input.GetKeyDown(KeyCode.Alpha1 + i))
            {
                SelectedSlot = i;
                Inventory.NotifyChanged();
            }
        }

        float scroll = Input.GetAxis("Mouse ScrollWheel");
        if (Mathf.Abs(scroll) > 0.01f)
        {
            int step = scroll < 0f ? 1 : HotbarSize - 1;
            SelectedSlot = (SelectedSlot + step) % HotbarSize;
            Inventory.NotifyChanged();
        }
    }

    void SetOpen(bool open)
    {
        if (open == IsOpen) return;
        IsOpen = open;

        Cursor.lockState = open ? CursorLockMode.None : CursorLockMode.Locked;
        Cursor.visible = open;

        // Never let items vanish on the cursor when the panel closes.
        if (!open && !Held.IsEmpty)
        {
            Held.Count = Inventory.Add(Held.Def, Held.Count);
            if (Held.Count <= 0) Held = ItemStack.Empty;
        }

        Inventory.NotifyChanged();
    }

    /// <summary>Called by the UI when a slot is clicked while the panel is open.</summary>
    public void OnSlotClicked(int index)
    {
        ref ItemStack slot = ref Inventory.Slots[index];

        if (Held.IsEmpty)
        {
            if (!slot.IsEmpty)
            {
                Held = slot;
                slot = ItemStack.Empty;
            }
        }
        else if (slot.IsEmpty)
        {
            slot = Held;
            Held = ItemStack.Empty;
        }
        else if (slot.Def == Held.Def && slot.Count < slot.Def.MaxStack)
        {
            int take = Mathf.Min(slot.Def.MaxStack - slot.Count, Held.Count);
            slot.Count += take;
            Held.Count -= take;
            if (Held.Count <= 0) Held = ItemStack.Empty;
        }
        else
        {
            (slot, Held) = (Held, slot);
        }

        Inventory.NotifyChanged();
    }
}
