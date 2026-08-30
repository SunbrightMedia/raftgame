using System;
using UnityEngine;

/// <summary>An item type. Icons are flat colours until real sprites exist.</summary>
public class ItemDef
{
    public readonly string Id;
    public readonly string DisplayName;
    public readonly Color Color;
    public readonly int MaxStack;

    public ItemDef(string id, string displayName, Color color, int maxStack = 20)
    {
        Id = id;
        DisplayName = displayName;
        Color = color;
        MaxStack = maxStack;
    }
}

/// <summary>The item types that exist. Add new ones here.</summary>
public static class Items
{
    public static readonly ItemDef Wood = new ItemDef("wood", "Wood", new Color(0.55f, 0.38f, 0.22f));
    public static readonly ItemDef Plank = new ItemDef("plank", "Plank", new Color(0.76f, 0.60f, 0.42f));
    public static readonly ItemDef Rope = new ItemDef("rope", "Rope", new Color(0.82f, 0.71f, 0.55f));
    public static readonly ItemDef Scrap = new ItemDef("scrap", "Scrap", new Color(0.55f, 0.57f, 0.60f));
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
}
