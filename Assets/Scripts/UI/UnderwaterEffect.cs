using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Tints the screen while the camera is below the water line. Implemented as a
/// full-screen overlay rather than a render feature: it needs no changes to the
/// renderer asset, costs one transparent quad, and exposes exactly the four
/// knobs the dev menu drives.
/// </summary>
public class UnderwaterEffect : MonoBehaviour
{
    [Tooltip("How strongly the tint covers the screen.")]
    [Range(0f, 100f)] public float opacity = 55f;

    [Tooltip("Tint hue in degrees.")]
    [Range(0f, 360f)] public float hue = 196f;

    [Tooltip("0 = black, 50 = the hue at full strength, 100 = white.")]
    [Range(0f, 100f)] public float brightness = 42f;

    [Tooltip("0 = grey, 100 = fully saturated hue.")]
    [Range(0f, 100f)] public float saturation = 62f;

    [Tooltip("Exponential-squared fog density while submerged. Higher closes "
           + "visibility in faster.")]
    [Range(0f, 0.5f)] public float fogDensity = 0.08f;

    /// <summary>True while the camera is below the surface.</summary>
    public bool IsSubmerged { get; private set; }

    Camera _camera;
    Image _overlay;

    bool _wasSubmerged;
    bool _fogCaptured;
    bool _surfaceFogEnabled;
    FogMode _surfaceFogMode;
    Color _surfaceFogColor;
    float _surfaceFogDensity;

    void Start()
    {
        Build();
    }

    void Build()
    {
        var canvasGo = new GameObject("UnderwaterCanvas", typeof(Canvas), typeof(CanvasScaler));
        var canvas = canvasGo.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        // Above the world, below the inventory (100) and dev menu (200) so the
        // UI stays readable while submerged.
        canvas.sortingOrder = 50;

        var go = new GameObject("Tint", typeof(RectTransform));
        var rect = go.GetComponent<RectTransform>();
        rect.SetParent(canvasGo.transform, false);
        rect.anchorMin = Vector2.zero;
        rect.anchorMax = Vector2.one;
        rect.sizeDelta = Vector2.zero;
        rect.anchoredPosition = Vector2.zero;

        _overlay = go.AddComponent<Image>();
        _overlay.raycastTarget = false;
        _overlay.enabled = false;
    }

    void LateUpdate()
    {
        if (_overlay == null) return;

        if (_camera == null) _camera = Camera.main;
        if (_camera == null)
        {
            _overlay.enabled = false;
            return;
        }

        Vector3 eye = _camera.transform.position;
        IsSubmerged = eye.y < WaterSurface.GetHeight(eye);

        _overlay.enabled = IsSubmerged;
        if (IsSubmerged) _overlay.color = TintColor();

        ApplyFog();
    }

    /// <summary>
    /// The flat overlay gives the screen its colour, but distance underwater
    /// should close in exponentially - that is what scene fog already does, per
    /// pixel and depth-correct, so drive it rather than faking a gradient.
    /// </summary>
    void ApplyFog()
    {
        if (!IsSubmerged)
        {
            // Re-read the above-water settings every frame while surfaced, so
            // changes made elsewhere (the dev menu's time-of-day slider drives
            // fog colour) are what we restore to, not a stale snapshot.
            _surfaceFogEnabled = RenderSettings.fog;
            _surfaceFogMode = RenderSettings.fogMode;
            _surfaceFogColor = RenderSettings.fogColor;
            _surfaceFogDensity = RenderSettings.fogDensity;
            _fogCaptured = true;

            if (_wasSubmerged) _wasSubmerged = false;
            return;
        }

        if (!_fogCaptured) return;

        _wasSubmerged = true;
        Color tint = TintColor();

        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = new Color(tint.r, tint.g, tint.b, 1f);
        RenderSettings.fogDensity = fogDensity;
    }

    void OnDisable()
    {
        RestoreSurfaceFog();
    }

    void RestoreSurfaceFog()
    {
        if (!_fogCaptured || !_wasSubmerged) return;

        RenderSettings.fog = _surfaceFogEnabled;
        RenderSettings.fogMode = _surfaceFogMode;
        RenderSettings.fogColor = _surfaceFogColor;
        RenderSettings.fogDensity = _surfaceFogDensity;
        _wasSubmerged = false;
    }

    /// <summary>
    /// Brightness runs black -> hue -> white through the midpoint, so 50 gives
    /// the chosen hue untouched and either end washes it out.
    /// </summary>
    public Color TintColor()
    {
        Color hueColor = Color.HSVToRGB(Mathf.Repeat(hue, 360f) / 360f,
                                        Mathf.Clamp01(saturation / 100f), 1f);

        Color rgb = brightness <= 50f
            ? Color.Lerp(Color.black, hueColor, brightness / 50f)
            : Color.Lerp(hueColor, Color.white, (brightness - 50f) / 50f);

        rgb.a = Mathf.Clamp01(opacity / 100f);
        return rgb;
    }
}
