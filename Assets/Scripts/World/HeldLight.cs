using UnityEngine;

/// <summary>
/// Lights the way when the selected hotbar item is something that burns. The
/// light lives on the camera rather than on a held model, so it tracks where
/// the player is looking - which is what a torch is actually for.
/// </summary>
[RequireComponent(typeof(InventorySystem))]
public class HeldLight : MonoBehaviour
{
    [Tooltip("How much the flame wavers.")]
    [Range(0f, 0.5f)] public float flicker = 0.12f;

    InventorySystem _inventory;
    Light _light;
    float _baseIntensity;
    float _seed;

    void Start()
    {
        _inventory = GetComponent<InventorySystem>();
        _seed = Random.Range(0f, 100f);

        var camera = GetComponentInChildren<Camera>();
        Transform parent = camera != null ? camera.transform : transform;

        var go = new GameObject("Held Light");
        go.transform.SetParent(parent, false);
        go.transform.localPosition = new Vector3(0.25f, -0.15f, 0.35f);

        _light = go.AddComponent<Light>();
        _light.type = LightType.Point;
        _light.shadows = LightShadows.None;
        _light.enabled = false;
    }

    void Update()
    {
        if (_inventory == null || _light == null) return;

        ItemDef item = _inventory.ActiveStack.Def;
        bool lit = item != null && item.EmitsLight;

        if (lit && !_light.enabled)
        {
            _light.color = item.LightColor;
            _light.range = item.LightRange;
            _baseIntensity = item.LightIntensity;
        }

        _light.enabled = lit;
        if (!lit) return;

        // Two out-of-step sines read as a flame without needing noise.
        float wobble = Mathf.Sin(Time.time * 11f + _seed) * 0.6f
                     + Mathf.Sin(Time.time * 4.3f + _seed * 2f) * 0.4f;
        _light.intensity = _baseIntensity * (1f + wobble * flicker);
    }
}
