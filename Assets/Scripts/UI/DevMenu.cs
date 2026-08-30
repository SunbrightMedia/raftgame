using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>
/// Live tuning panel, toggled with P. Every control reads its starting value
/// from the thing it drives and writes straight back to it, so the panel never
/// holds its own copy of the truth and can't drift out of sync with the game.
/// Built from code like the rest of the UI, so scene rebuilds can't lose it.
/// </summary>
public class DevMenu : MonoBehaviour
{
    public static bool IsOpen { get; private set; }

    [Tooltip("Directional light driven by the time-of-day slider.")]
    public Light sun;

    GameObject _panel;
    readonly List<Action> _refreshers = new List<Action>();
    Font _font;

    float _timeOfDay = 12f;
    float _environmentDirtyAt = -1f;

    static readonly Color PanelBg = new Color(0.05f, 0.07f, 0.09f, 0.93f);
    static readonly Color TrackBg = new Color(0.16f, 0.19f, 0.23f, 1f);
    static readonly Color FillColor = new Color(0.85f, 0.75f, 0.35f, 1f);

    void Start()
    {
        _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        if (sun == null) sun = RenderSettings.sun;
        if (sun != null) _timeOfDay = SunRotationToHour(sun.transform.eulerAngles.x);

        EnsureEventSystem();
        Build();
        _panel.SetActive(false);

        // Apply once up front so lighting matches the slider from the start
        // rather than only after it is first dragged.
        ApplyTimeOfDay();
    }

    void OnDestroy()
    {
        if (IsOpen) IsOpen = false;
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.P)) SetOpen(!IsOpen);
        else if (IsOpen && Input.GetKeyDown(KeyCode.Escape)) SetOpen(false);

        // Rebuilding the ambient probe is expensive, so coalesce a burst of
        // slider drags into one update shortly after the last change.
        if (_environmentDirtyAt > 0f && Time.unscaledTime >= _environmentDirtyAt)
        {
            _environmentDirtyAt = -1f;
            DynamicGI.UpdateEnvironment();
        }
    }

    void SetOpen(bool open)
    {
        if (open == IsOpen) return;
        IsOpen = open;
        _panel.SetActive(open);

        if (open)
            foreach (var refresh in _refreshers) refresh();

        // The inventory may also want the cursor; only take it back if nothing
        // else still needs it.
        if (open || !GameUI.BlocksGameplay)
        {
            Cursor.lockState = open ? CursorLockMode.None : CursorLockMode.Locked;
            Cursor.visible = open;
        }
    }

    static void EnsureEventSystem()
    {
        if (UnityEngine.Object.FindObjectOfType<EventSystem>() != null) return;
        new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
    }

    void Build()
    {
        var canvasGo = new GameObject("DevMenuCanvas",
            typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvas = canvasGo.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 200; // above the inventory

        var scaler = canvasGo.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1920, 1080);
        scaler.matchWidthOrHeight = 0.5f;

        var panel = NewRect("DevMenu", canvasGo.transform);
        panel.anchorMin = new Vector2(0f, 1f);
        panel.anchorMax = new Vector2(0f, 1f);
        panel.pivot = new Vector2(0f, 1f);
        panel.anchoredPosition = new Vector2(24f, -24f);
        panel.sizeDelta = new Vector2(420f, 470f);
        panel.gameObject.AddComponent<Image>().color = PanelBg;
        _panel = panel.gameObject;

        float y = -14f;
        AddHeader(panel, "Dev Menu  (P to close)", ref y);

        AddHeader(panel, "Water", ref y);
        AddSlider(panel, "Wave speed", 0f, 3f, ref y,
            () => Water() != null ? Water().waveSpeed : 1f,
            v => { if (Water() != null) Water().waveSpeed = v; });
        AddSlider(panel, "Wave height", 0f, 3f, ref y,
            () => Water() != null ? Water().waveHeight : 1f,
            v => { if (Water() != null) Water().waveHeight = v; });
        AddSlider(panel, "Peak spacing", 0.25f, 4f, ref y,
            () => Water() != null ? Water().waveSpacing : 1f,
            v => { if (Water() != null) Water().waveSpacing = v; });
        AddSlider(panel, "Variation", 0f, 1f, ref y,
            () => Water() != null ? Water().waveVariation : 0f,
            v => { if (Water() != null) Water().waveVariation = v; });

        AddHeader(panel, "World", ref y);
        AddSlider(panel, "Time of day", 0f, 24f, ref y,
            () => _timeOfDay,
            v => { _timeOfDay = v; ApplyTimeOfDay(); },
            v => string.Format("{0:00}:{1:00}", Mathf.FloorToInt(v), Mathf.FloorToInt(v % 1f * 60f)));
        AddSlider(panel, "Gravity", 0f, 30f, ref y,
            () => Mathf.Abs(Physics.gravity.y),
            v => Physics.gravity = new Vector3(0f, -v, 0f));

        AddHeader(panel, "Player", ref y);
        AddSlider(panel, "Walk speed", 1f, 12f, ref y,
            () => Player() != null ? Player().walkSpeed : 4f,
            v => { if (Player() != null) Player().walkSpeed = v; });
        AddSlider(panel, "Sprint speed", 1f, 20f, ref y,
            () => Player() != null ? Player().sprintSpeed : 7f,
            v => { if (Player() != null) Player().sprintSpeed = v; });

        AddHeader(panel, "Raft", ref y);
        // How much of the wave height the deck actually follows. At less than
        // 100% crests pass straight through the deck, which is the root cause
        // behind items being washed about on the raft.
        AddSlider(panel, "Follow waves", 0f, 100f, ref y,
            () => Raft() != null ? Raft().bobAmount * 100f : 0f,
            v => { if (Raft() != null) Raft().bobAmount = v / 100f; },
            v => v.ToString("0") + "%");
        AddSlider(panel, "Tilt with waves", 0f, 100f, ref y,
            () => Raft() != null && Raft().tiltWithWaves
                  ? Raft().maxTilt / MaxTiltDegrees * 100f
                  : 0f,
            v =>
            {
                if (Raft() == null) return;
                Raft().maxTilt = v / 100f * MaxTiltDegrees;
                Raft().tiltWithWaves = v > 0.5f;
            },
            v => v.ToString("0") + "%");

        AddHeader(panel, "Underwater", ref y);
        AddSlider(panel, "Opacity", 0f, 100f, ref y,
            () => Underwater() != null ? Underwater().opacity : 0f,
            v => { if (Underwater() != null) Underwater().opacity = v; },
            v => v.ToString("0") + "%");
        AddSlider(panel, "Hue", 0f, 360f, ref y,
            () => Underwater() != null ? Underwater().hue : 0f,
            v => { if (Underwater() != null) Underwater().hue = v; },
            v => v.ToString("0") + " deg");
        AddSlider(panel, "Brightness", 0f, 100f, ref y,
            () => Underwater() != null ? Underwater().brightness : 50f,
            v => { if (Underwater() != null) Underwater().brightness = v; },
            v => v.ToString("0") + "  (0 black / 50 hue / 100 white)");
        AddSlider(panel, "Saturation", 0f, 100f, ref y,
            () => Underwater() != null ? Underwater().saturation : 0f,
            v => { if (Underwater() != null) Underwater().saturation = v; },
            v => v.ToString("0") + "%");
        AddSlider(panel, "Fog density", 0f, 0.5f, ref y,
            () => Underwater() != null ? Underwater().fogDensity : 0f,
            v => { if (Underwater() != null) Underwater().fogDensity = v; },
            v => v.ToString("0.000"));

        // Size the panel to whatever was added rather than a magic number, so
        // adding a slider never silently clips the bottom of the list.
        panel.sizeDelta = new Vector2(panel.sizeDelta.x, -y + 14f);
    }

    // RaftPlatform blends the surface normal by maxTilt/30, so 30 is "full".
    const float MaxTiltDegrees = 30f;

    static WaterSurface Water() => WaterSurface.Instance;

    FirstPersonController _player;
    FirstPersonController Player()
    {
        if (_player == null) _player = UnityEngine.Object.FindObjectOfType<FirstPersonController>();
        return _player;
    }

    RaftPlatform _raft;
    RaftPlatform Raft()
    {
        if (_raft == null) _raft = UnityEngine.Object.FindObjectOfType<RaftPlatform>();
        return _raft;
    }

    UnderwaterEffect _underwater;
    UnderwaterEffect Underwater()
    {
        if (_underwater == null) _underwater = UnityEngine.Object.FindObjectOfType<UnderwaterEffect>();
        return _underwater;
    }

    void ApplyTimeOfDay()
    {
        if (sun == null) sun = RenderSettings.sun;
        if (sun == null) return;

        // 06:00 puts the sun on the horizon, 12:00 overhead, 18:00 setting.
        float rotation = (_timeOfDay - 6f) / 12f * 180f;
        sun.transform.rotation = Quaternion.Euler(rotation, 145f, 0f);

        // True solar altitude in degrees, -90 (midnight) to +90 (noon). Going
        // through asin(sin()) folds the 0-360 rotation back into a real angle,
        // so 18:00 reads as 0 degrees rather than 180.
        float altitude = Mathf.Asin(Mathf.Sin(rotation * Mathf.Deg2Rad)) * Mathf.Rad2Deg;

        // Bands taken from how photographers actually describe the light:
        //   golden hour   sun between -4 and +6 degrees   warm, 3000-4000K
        //   blue hour     sun between -4 and -6 degrees   deep blue, no direct sun
        //   civil dusk    sun at -6 degrees               daylight effectively gone
        // Brightness saturates by ~8 degrees. The previous version drove
        // brightness straight off sin(altitude), which dimmed an ordinary
        // 42-degree midday sun to 67% and washed the whole day out.
        float day = Mathf.Clamp01(Mathf.InverseLerp(-6f, 8f, altitude));
        float golden = Band(altitude, -8f, -3f, 5f, 13f);
        float blue = Band(altitude, -14f, -8f, -5f, 1f);

        sun.color = Color.Lerp(Daylight, GoldenLight, golden);
        sun.intensity = Mathf.Lerp(0f, 1.25f, day);

        // Dimming the sun alone is not enough: the water takes most of its
        // brightness from the ambient probe and the sky reflection, so it kept
        // glowing under a black sun.
        // Blue hour is dim but far from black - there is still plenty of
        // skylight with the sun just under the horizon, so lift the floor
        // rather than letting it fall straight to night.
        float ambient = Mathf.Lerp(0.04f, 1f, day) + blue * 0.14f;
        RenderSettings.ambientIntensity = ambient;
        RenderSettings.reflectionIntensity = ambient;

        var sky = SkyboxInstance();
        if (sky != null)
        {
            if (sky.HasProperty(SkyExposure))
                sky.SetFloat(SkyExposure, Mathf.Lerp(0.10f, 1.05f, day) + blue * 0.18f);

            // A low sun's light travels through far more atmosphere, which is
            // what scatters out the blue and leaves the reds. The procedural
            // skybox models exactly that, so thicken the air through golden
            // hour instead of painting an orange tint over the top.
            if (sky.HasProperty(SkyAtmosphere))
                sky.SetFloat(SkyAtmosphere, Mathf.Lerp(0.62f, 1.65f, golden));

            if (sky.HasProperty(SkyTint))
            {
                Color tint = Color.Lerp(DaySkyTint, SunsetSkyTint, golden);
                tint = Color.Lerp(tint, BlueHourSkyTint, blue);
                sky.SetColor(SkyTint, tint);
            }
        }

        Color fog = Color.Lerp(NightFog, DayFog, day);
        fog = Color.Lerp(fog, EmberFog, golden);
        fog = Color.Lerp(fog, BlueHourFog, blue);
        RenderSettings.fogColor = fog;

        _environmentDirtyAt = Time.unscaledTime + 0.15f;
    }

    /// <summary>
    /// Trapezoid: ramps in over [inStart, inEnd], holds at 1, ramps out over
    /// [outStart, outEnd]. Keeps the light bands readable as the angles they
    /// actually are.
    /// </summary>
    static float Band(float x, float inStart, float inEnd, float outStart, float outEnd)
    {
        return Mathf.Clamp01(Mathf.InverseLerp(inStart, inEnd, x))
             * (1f - Mathf.Clamp01(Mathf.InverseLerp(outStart, outEnd, x)));
    }

    // Sun colour by rough colour temperature: ~5500K at midday, ~3200K through
    // golden hour.
    static readonly Color Daylight = new Color(1f, 0.96f, 0.90f);
    static readonly Color GoldenLight = new Color(1f, 0.66f, 0.34f);

    static readonly Color DaySkyTint = new Color(0.45f, 0.66f, 0.90f);
    static readonly Color SunsetSkyTint = new Color(0.86f, 0.42f, 0.55f);
    static readonly Color BlueHourSkyTint = new Color(0.26f, 0.32f, 0.70f);

    static readonly Color DayFog = new Color(0.62f, 0.75f, 0.85f);
    static readonly Color EmberFog = new Color(0.88f, 0.50f, 0.36f);
    static readonly Color BlueHourFog = new Color(0.20f, 0.25f, 0.45f);
    static readonly Color NightFog = new Color(0.03f, 0.04f, 0.09f);

    static readonly int SkyAtmosphere = Shader.PropertyToID("_AtmosphereThickness");
    static readonly int SkyTint = Shader.PropertyToID("_SkyTint");

    static readonly int SkyExposure = Shader.PropertyToID("_Exposure");
    Material _skyInstance;

    /// <summary>
    /// A private copy of the skybox material. Editing RenderSettings.skybox
    /// directly would write through to the shared Sky.mat asset and those edits
    /// survive leaving play mode - the slider would permanently darken the
    /// project's sky.
    /// </summary>
    Material SkyboxInstance()
    {
        if (_skyInstance != null) return _skyInstance;
        if (RenderSettings.skybox == null) return null;

        _skyInstance = new Material(RenderSettings.skybox) { name = "Sky (runtime)" };
        RenderSettings.skybox = _skyInstance;
        return _skyInstance;
    }

    static float SunRotationToHour(float eulerX)
    {
        if (eulerX > 180f) eulerX -= 360f;
        return Mathf.Clamp(eulerX / 180f * 12f + 6f, 0f, 24f);
    }

    // ---- UI construction ------------------------------------------------

    void AddHeader(RectTransform parent, string text, ref float y)
    {
        var rect = NewRect("Header", parent);
        rect.anchorMin = new Vector2(0f, 1f);
        rect.anchorMax = new Vector2(1f, 1f);
        rect.pivot = new Vector2(0.5f, 1f);
        rect.anchoredPosition = new Vector2(0f, y);
        rect.sizeDelta = new Vector2(-28f, 24f);

        var label = rect.gameObject.AddComponent<Text>();
        label.font = _font;
        label.fontSize = 17;
        label.fontStyle = FontStyle.Bold;
        label.color = new Color(0.85f, 0.75f, 0.35f);
        label.alignment = TextAnchor.MiddleLeft;
        label.text = text;
        label.raycastTarget = false;

        y -= 28f;
    }

    void AddSlider(RectTransform parent, string label, float min, float max, ref float y,
                   Func<float> read, Action<float> write, Func<float, string> format = null)
    {
        var row = NewRect(label, parent);
        row.anchorMin = new Vector2(0f, 1f);
        row.anchorMax = new Vector2(1f, 1f);
        row.pivot = new Vector2(0.5f, 1f);
        row.anchoredPosition = new Vector2(0f, y);
        row.sizeDelta = new Vector2(-28f, 44f);

        var caption = NewRect("Label", row);
        caption.anchorMin = new Vector2(0f, 1f);
        caption.anchorMax = new Vector2(1f, 1f);
        caption.pivot = new Vector2(0.5f, 1f);
        caption.anchoredPosition = Vector2.zero;
        caption.sizeDelta = new Vector2(0f, 20f);
        var captionText = caption.gameObject.AddComponent<Text>();
        captionText.font = _font;
        captionText.fontSize = 15;
        captionText.color = new Color(0.86f, 0.88f, 0.90f);
        captionText.alignment = TextAnchor.MiddleLeft;
        captionText.raycastTarget = false;

        var track = NewRect("Track", row);
        track.anchorMin = new Vector2(0f, 0f);
        track.anchorMax = new Vector2(1f, 0f);
        track.pivot = new Vector2(0.5f, 0f);
        track.anchoredPosition = new Vector2(0f, 2f);
        track.sizeDelta = new Vector2(0f, 16f);
        var trackImage = track.gameObject.AddComponent<Image>();
        trackImage.color = TrackBg;

        var fill = NewRect("Fill", track);
        fill.anchorMin = Vector2.zero;
        fill.anchorMax = Vector2.one;
        fill.sizeDelta = Vector2.zero;
        fill.anchoredPosition = Vector2.zero;
        var fillImage = fill.gameObject.AddComponent<Image>();
        fillImage.color = FillColor;
        fillImage.raycastTarget = false;

        var slider = track.gameObject.AddComponent<Slider>();
        slider.transition = Selectable.Transition.None;
        slider.direction = Slider.Direction.LeftToRight;
        slider.fillRect = fill;
        slider.targetGraphic = trackImage;
        slider.minValue = min;
        slider.maxValue = max;
        slider.SetValueWithoutNotify(Mathf.Clamp(read(), min, max));

        Func<float, string> fmt = format ?? (v => v.ToString("0.00"));
        Action<float> paint = v => captionText.text = label + ":  " + fmt(v);
        paint(slider.value);

        slider.onValueChanged.AddListener(v => { write(v); paint(v); });

        // Reopening the menu re-reads live values, in case something else moved them.
        _refreshers.Add(() =>
        {
            float current = Mathf.Clamp(read(), min, max);
            slider.SetValueWithoutNotify(current);
            paint(current);
        });

        y -= 50f;
    }

    static RectTransform NewRect(string name, Transform parent)
    {
        var go = new GameObject(name, typeof(RectTransform));
        var rect = go.GetComponent<RectTransform>();
        rect.SetParent(parent, false);
        return rect;
    }
}
