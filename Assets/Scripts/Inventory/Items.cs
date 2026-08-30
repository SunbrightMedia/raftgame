using System;
using UnityEngine;

/// <summary>An item type. Icons are flat colours until real sprites exist.</summary>
public class ItemDef
{
    public readonly string Id;
    public readonly string DisplayName;
    public readonly Color Color;
    public readonly int MaxStack;
    /// <summary>Size of the floating box this item drops as.</summary>
    public readonly Vector3 DebrisSize;

    /// <summary>Light this item casts, in the world and in the player's hand.</summary>
    public readonly Color LightColor;
    public readonly float LightRange;
    public readonly float LightIntensity;

    public bool EmitsLight => LightRange > 0f;

    public ItemDef(string id, string displayName, Color color, int maxStack = 20,
                   Vector3 debrisSize = default, Color lightColor = default,
                   float lightRange = 0f, float lightIntensity = 0f)
    {
        Id = id;
        DisplayName = displayName;
        Color = color;
        MaxStack = maxStack;
        DebrisSize = debrisSize == default ? new Vector3(0.5f, 0.3f, 0.5f) : debrisSize;
        LightColor = lightColor == default ? new Color(1f, 0.72f, 0.38f) : lightColor;
        LightRange = lightRange;
        LightIntensity = lightIntensity;
    }
}

/// <summary>The item types that exist. Add new ones here.</summary>
public static class Items
{
    public static readonly ItemDef Wood = new ItemDef("wood", "Wood",
        new Color(0.55f, 0.38f, 0.22f), 20, new Vector3(0.45f, 0.40f, 0.95f));
    public static readonly ItemDef Plank = new ItemDef("plank", "Plank",
        new Color(0.76f, 0.60f, 0.42f), 20, new Vector3(1.30f, 0.12f, 0.32f));
    public static readonly ItemDef Rope = new ItemDef("rope", "Rope",
        new Color(0.82f, 0.71f, 0.55f), 20, new Vector3(0.35f, 0.22f, 0.35f));
    public static readonly ItemDef Scrap = new ItemDef("scrap", "Scrap",
        new Color(0.55f, 0.57f, 0.60f), 20, new Vector3(0.42f, 0.10f, 0.30f));

    public static readonly ItemDef Torch = new ItemDef("torch", "Torch",
        new Color(0.85f, 0.55f, 0.25f), 8, new Vector3(0.12f, 0.12f, 0.75f),
        new Color(1f, 0.70f, 0.34f), 11f, 2.6f);

    /// <summary>Everything that can wash up as debris, with relative weights.</summary>
    public static readonly ItemDef[] Flotsam = { Wood, Wood, Plank, Plank, Rope, Scrap, Torch };
}

public struct ItemStack
{
    public ItemDef Def;
    public int Count;

    public bool IsEmpty => Def == null || Count <= 0;
    public static readonly ItemStack Empty = default;

    public ItemStack(ItemDef def, int count)
    {
        Def = def;
        Count = count;
    }
}

/// <summary>Slot array with stacking rules. Fires Changed for the UI.</summary>
public class Inventory
{
    public readonly ItemStack[] Slots;
    public event Action Changed;

    public Inventory(int size)
    {
        Slots = new ItemStack[size];
    }

    public void NotifyChanged() => Changed?.Invoke();

    /// <summary>Adds items, merging into existing stacks first. Returns the
    /// count that did not fit.</summary>
    public int Add(ItemDef def, int count)
    {
        for (int i = 0; i < Slots.Length && count > 0; i++)
        {
            if (!Slots[i].IsEmpty && Slots[i].Def == def && Slots[i].Count < def.MaxStack)
            {
                int take = Mathf.Min(def.MaxStack - Slots[i].Count, count);
                Slots[i].Count += take;
                count -= take;
            }
        }

        for (int i = 0; i < Slots.Length && count > 0; i++)
        {
            if (Slots[i].IsEmpty)
            {
                int take = Mathf.Min(def.MaxStack, count);
                Slots[i] = new ItemStack(def, take);
                count -= take;
            }
        }

        NotifyChanged();
        return count;
    }

    /// <summary>Takes up to <paramref name="count"/> from one slot. Returns how
    /// many were actually removed.</summary>
    public int RemoveFromSlot(int index, int count)
    {
        if (index < 0 || index >= Slots.Length || Slots[index].IsEmpty) return 0;

        int taken = Mathf.Min(count, Slots[index].Count);
        Slots[index].Count -= taken;
        if (Slots[index].Count <= 0) Slots[index] = ItemStack.Empty;

        NotifyChanged();
        return taken;
    }
}
