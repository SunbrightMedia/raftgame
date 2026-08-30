using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// Adds any missing runtime systems as soon as a scene loads.
///
/// Without this, everything depends on Raft &gt; Build Ocean Scene having been
/// run since the code was last changed - an already-saved scene simply has no
/// Dev Menu or PickupInteractor in it, and the keys silently do nothing with
/// no error to explain why. Anything a scene should never be missing gets
/// created here instead, so pulling new code is enough to get the new
/// behaviour.
///
/// Every check is "is it already there?", so this never duplicates what the
/// scene builder placed.
/// </summary>
public static class GameBootstrap
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void EnsureSystems()
    {
        EnsureGraphicsQuality();
        EnsureGlobal<DevMenu>("Dev Menu");
        EnsureGlobal<UnderwaterEffect>("Underwater Effect");
        EnsureCloudField();
        EnsurePlayerSystems();
        EnsureDebrisSpawner();
    }

    /// <summary>
    /// Forces the antialiasing settings at runtime.
    ///
    /// These are normally set by Raft &gt; Setup Rendering, but they live on the
    /// pipeline asset and the camera, so a scene or asset saved before those
    /// values changed simply keeps the old ones with nothing to indicate it.
    /// Applying them here means pulling new code is enough.
    /// </summary>
    static void EnsureGraphicsQuality()
    {
        var pipeline = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        if (pipeline != null)
        {
            if (pipeline.msaaSampleCount < 4) pipeline.msaaSampleCount = 4;
        }

        var camera = Camera.main;
        if (camera == null) return;

        var data = camera.GetComponent<UniversalAdditionalCameraData>();
        if (data == null) data = camera.gameObject.AddComponent<UniversalAdditionalCameraData>();

        // Post-process AA is the only thing that touches the stylised band
        // edges MSAA cannot see, so it must actually be on.
        data.renderPostProcessing = true;
        data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
        data.antialiasingQuality = AntialiasingQuality.High;
    }

    static T EnsureGlobal<T>(string name) where T : Component
    {
        var existing = Object.FindObjectOfType<T>();
        if (existing != null) return existing;
        return new GameObject(name).AddComponent<T>();
    }

    static void EnsurePlayerSystems()
    {
        var player = Object.FindObjectOfType<FirstPersonController>();
        if (player == null) return;

        if (player.GetComponent<InventorySystem>() == null)
            player.gameObject.AddComponent<InventorySystem>();

        if (player.GetComponent<PickupInteractor>() == null)
            player.gameObject.AddComponent<PickupInteractor>();

        if (player.GetComponent<HeldLight>() == null)
            player.gameObject.AddComponent<HeldLight>();
    }

    static void EnsureCloudField()
    {
        if (Object.FindObjectOfType<CloudField>() != null) return;

        var field = new GameObject("Cloud Field").AddComponent<CloudField>();

        var player = Object.FindObjectOfType<FirstPersonController>();
        if (player != null) field.followTarget = player.transform;
    }

    static void EnsureDebrisSpawner()
    {
        if (Object.FindObjectOfType<DebrisSpawner>() != null) return;

        var spawner = new GameObject("Debris Spawner").AddComponent<DebrisSpawner>();

        var player = Object.FindObjectOfType<FirstPersonController>();
        if (player != null) spawner.followTarget = player.transform;

        // The scene builder assigns a shared asset; this runtime fallback keeps
        // debris working in a scene that predates it.
        var shader = Shader.Find("Raft/FacetedWood") ?? Shader.Find("Universal Render Pipeline/Lit");
        if (shader != null)
            spawner.debrisMaterial = new Material(shader) { name = "Debris (runtime)" };
    }
}
