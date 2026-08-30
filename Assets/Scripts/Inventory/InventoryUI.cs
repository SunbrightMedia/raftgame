using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>
/// Builds the whole inventory UI from code at runtime - hotbar, backpack
/// panel and the stack carried on the cursor - so nothing lives in the scene
/// file and Raft &gt; Build Ocean Scene can never wipe it. Item icons are flat
/// colour swatches until real sprites exist.
/// </summary>
[RequireComponent(typeof(InventorySystem))]
public class InventoryUI : MonoBehaviour
{
    const float SlotSize = 64f;
    const float SlotGap = 8f;

    static readonly Color SlotBg = new Color(0.08f, 0.10f, 0.13f, 0.82f);
    static readonly Color SlotBgSelected = new Color(0.85f, 0.75f, 0.35f, 0.95f);
    static readonly Color PanelBg = new Color(0.05f, 0.07f, 0.09f, 0.90f);

    InventorySystem _system;
    Font _font;

    GameObject _panel;
    SlotView[] _slots;
    Image _heldIcon;
    Text _heldCount;
    RectTransform _heldRect;

    class SlotView
    {
        public Image Background;
        public Image Icon;
        public Text Count;
    }

    void Start()
    {
        _system = GetComponent<InventorySystem>();
        _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

        EnsureEventSystem();
        BuildCanvas();
        _system.Inventory.Changed += Refresh;
        Refresh();
    }

    void OnDestroy()
    {
        if (_system != null && _system.Inventory != null)
            _system.Inventory.Changed -= Refresh;
    }

    void Update()
    {
        bool open = InventorySystem.IsOpen;
        if (_panel != null && _panel.activeSelf != open)
        {
            _panel.SetActive(open);
            Refresh();
        }

        if (open && _heldRect != null && !_system.Held.IsEmpty)
            _heldRect.position = Input.mousePosition;
    }

    static void EnsureEventSystem()
    {
        if (Object.FindObjectOfType<EventSystem>() != null) return;
        new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
    }

    void BuildCanvas()
    {
        var canvasGo = new GameObject("InventoryCanvas",
            typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvas = canvasGo.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 100;

        var scaler = canvasGo.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1920, 1080);
        scaler.matchWidthOrHeight = 0.5f;

        _slots = new SlotView[InventorySystem.Size];

        BuildHotbar(canvasGo.transform);
        BuildPanel(canvasGo.transform);
        BuildHeldStack(canvasGo.transform);
        _panel.SetActive(false);
    }

    void BuildHotbar(Transform canvas)
    {
        float width = InventorySystem.HotbarSize * SlotSize
                    + (InventorySystem.HotbarSize - 1) * SlotGap;

        var bar = NewRect("Hotbar", canvas);
        bar.anchorMin = bar.anchorMax = new Vector2(0.5f, 0f);
        bar.pivot = new Vector2(0.5f, 0f);
        bar.anchoredPosition = new Vector2(0f, 16f);
        bar.sizeDelta = new Vector2(width, SlotSize);

        for (int i = 0; i < InventorySystem.HotbarSize; i++)
        {
            var rect = BuildSlot(bar, i, "HotbarSlot" + i);
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 0.5f);
            rect.pivot = new Vector2(0f, 0.5f);
            rect.anchoredPosition = new Vector2(i * (SlotSize + SlotGap), 0f);
        }
    }

    void BuildPanel(Transform canvas)
    {
        // Dimmer that also swallows clicks on the world behind the panel.
        var dim = NewRect("InventoryPanel", canvas);
        dim.anchorMin = Vector2.zero;
        dim.anchorMax = Vector2.one;
        dim.sizeDelta = Vector2.zero;
        var dimImage = dim.gameObject.AddComponent<Image>();
        dimImage.color = new Color(0f, 0f, 0f, 0.45f);
        _panel = dim.gameObject;

        int cols = InventorySystem.HotbarSize;
        int rows = InventorySystem.BackpackRows;
        float pad = 16f;
        float width = cols * SlotSize + (cols - 1) * SlotGap + pad * 2f;
        float height = rows * SlotSize + (rows - 1) * SlotGap + pad * 2f + 40f;

        var panel = NewRect("Backpack", dim);
        panel.anchorMin = panel.anchorMax = new Vector2(0.5f, 0.5f);
        panel.pivot = new Vector2(0.5f, 0.5f);
        panel.anchoredPosition = new Vector2(0f, 40f);
        panel.sizeDelta = new Vector2(width, height);
        panel.gameObject.AddComponent<Image>().color = PanelBg;

        var title = NewRect("Title", panel);
        title.anchorMin = new Vector2(0f, 1f);
        title.anchorMax = new Vector2(1f, 1f);
        title.pivot = new Vector2(0.5f, 1f);
        title.anchoredPosition = new Vector2(0f, -8f);
        title.sizeDelta = new Vector2(0f, 28f);
        var titleText = title.gameObject.AddComponent<Text>();
        titleText.font = _font;
        titleText.fontSize = 20;
        titleText.alignment = TextAnchor.MiddleCenter;
        titleText.color = new Color(0.9f, 0.9f, 0.9f);
        titleText.text = "Inventory";
        titleText.raycastTarget = false;

        for (int row = 0; row < rows; row++)
        {
            for (int col = 0; col < cols; col++)
            {
                int index = InventorySystem.HotbarSize + row * cols + col;
                var rect = BuildSlot(panel, index, "Slot" + index);
                rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
                rect.pivot = new Vector2(0f, 1f);
                rect.anchoredPosition = new Vector2(
                    pad + col * (SlotSize + SlotGap),
                    -(pad + 32f + row * (SlotSize + SlotGap)));
            }
        }
    }

    RectTransform BuildSlot(Transform parent, int index, string name)
    {
        var rect = NewRect(name, parent);
        rect.sizeDelta = new Vector2(SlotSize, SlotSize);

        var bg = rect.gameObject.AddComponent<Image>();
        bg.color = SlotBg;

        var click = rect.gameObject.AddComponent<SlotClick>();
        click.Index = index;
        click.System = _system;

        var iconRect = NewRect("Icon", rect);
        iconRect.anchorMin = Vector2.zero;
        iconRect.anchorMax = Vector2.one;
        iconRect.sizeDelta = new Vector2(-14f, -14f);
        var icon = iconRect.gameObject.AddComponent<Image>();
        icon.raycastTarget = false;

        var countRect = NewRect("Count", rect);
        countRect.anchorMin = Vector2.zero;
        countRect.anchorMax = Vector2.one;
        countRect.sizeDelta = new Vector2(-8f, -4f);
        var count = countRect.gameObject.AddComponent<Text>();
        count.font = _font;
        count.fontSize = 18;
        count.fontStyle = FontStyle.Bold;
        count.alignment = TextAnchor.LowerRight;
        count.color = Color.white;
        count.raycastTarget = false;

        _slots[index] = new SlotView { Background = bg, Icon = icon, Count = count };
        return rect;
    }

    void BuildHeldStack(Transform canvas)
    {
        _heldRect = NewRect("HeldStack", canvas);
        _heldRect.sizeDelta = new Vector2(SlotSize - 14f, SlotSize - 14f);
        _heldIcon = _heldRect.gameObject.AddComponent<Image>();
        _heldIcon.raycastTarget = false;

        var countRect = NewRect("Count", _heldRect);
        countRect.anchorMin = Vector2.zero;
        countRect.anchorMax = Vector2.one;
        countRect.sizeDelta = Vector2.zero;
        _heldCount = countRect.gameObject.AddComponent<Text>();
        _heldCount.font = _font;
        _heldCount.fontSize = 18;
        _heldCount.fontStyle = FontStyle.Bold;
        _heldCount.alignment = TextAnchor.LowerRight;
        _heldCount.color = Color.white;
        _heldCount.raycastTarget = false;
    }

    static RectTransform NewRect(string name, Transform parent)
    {
        var go = new GameObject(name, typeof(RectTransform));
        var rect = go.GetComponent<RectTransform>();
        rect.SetParent(parent, false);
        return rect;
    }

    void Refresh()
    {
        if (_slots == null) return;

        for (int i = 0; i < _slots.Length; i++)
        {
            var view = _slots[i];
            if (view == null) continue;

            ItemStack stack = _system.Inventory.Slots[i];
            bool selected = i == _system.SelectedSlot && i < InventorySystem.HotbarSize;
            view.Background.color = selected ? SlotBgSelected : SlotBg;
            view.Icon.enabled = !stack.IsEmpty;
            view.Count.enabled = !stack.IsEmpty && stack.Count > 1;
            if (!stack.IsEmpty)
            {
                view.Icon.color = stack.Def.Color;
                view.Count.text = stack.Count.ToString();
            }
        }

        bool holding = InventorySystem.IsOpen && !_system.Held.IsEmpty;
        _heldIcon.enabled = holding;
        _heldCount.enabled = holding && _system.Held.Count > 1;
        if (holding)
        {
            _heldIcon.color = _system.Held.Def.Color;
            _heldCount.text = _system.Held.Count.ToString();
            _heldRect.position = Input.mousePosition;
        }
    }

    /// <summary>Forwards slot clicks to the system while the panel is open.</summary>
    class SlotClick : MonoBehaviour, IPointerClickHandler
    {
        public int Index;
        public InventorySystem System;

        public void OnPointerClick(PointerEventData eventData)
        {
            if (InventorySystem.IsOpen)
                System.OnSlotClicked(Index);
        }
    }
}
