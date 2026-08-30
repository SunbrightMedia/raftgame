using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// Creates the URP pipeline asset, renderer and post-processing profile, and
/// switches the project over to them. Run once via Raft &gt; Setup Rendering
/// (or let Raft &gt; Build Ocean Scene do it).
/// </summary>
public static class RenderSetup
{
    const string SettingsDir = "Assets/Settings";
    const string PipelinePath = SettingsDir + "/RaftPipeline.asset";
    const string RendererPath = SettingsDir + "/RaftRenderer.asset";
    const string ProfilePath = SettingsDir + "/PostProcessing.asset";

    [MenuItem("Raft/Setup Rendering")]
    public static void Setup()
    {
        Directory.CreateDirectory(SettingsDir);

        // Linear is what makes lighting and tonemapping behave; gamma space
        // washes everything out no matter how good the shaders are.
        if (PlayerSettings.colorSpace != ColorSpace.Linear)
        {
            PlayerSettings.colorSpace = ColorSpace.Linear;
            Debug.Log("Switched colour space to Linear.");
        }

        var pipeline = CreatePipeline();
        if (pipeline != null)
        {
            GraphicsSettings.defaultRenderPipeline = pipeline;
            QualitySettings.renderPipeline = pipeline;
        }

        CreatePostProfile();

        // Soft shadows and a sane shadow distance for an open seascape.
        QualitySettings.shadows = ShadowQuality.All;
        QualitySettings.shadowResolution = ShadowResolution.High;
        QualitySettings.anisotropicFiltering = AnisotropicFiltering.ForceEnable;

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
    }

    static UniversalRenderPipelineAsset CreatePipeline()
    {
        var existing = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelinePath);
        if (existing != null) return Configure(existing);

        try
        {
            var rendererData = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererPath);
            if (rendererData == null)
            {
                rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(rendererData, RendererPath);
            }

            var pipeline = UniversalRenderPipelineAsset.Create(rendererData);
            AssetDatabase.CreateAsset(pipeline, PipelinePath);
            return Configure(pipeline);
        }
        catch (System.Exception e)
        {
            Debug.LogWarning(
                "Could not create the URP asset automatically (" + e.Message + "). Create one by hand " +
                "via Assets > Create > Rendering > URP Asset (with Universal Renderer), then assign it in " +
                "Project Settings > Graphics.");
            return null;
        }
    }

    static UniversalRenderPipelineAsset Configure(UniversalRenderPipelineAsset pipeline)
    {
        // The water shader reads scene depth for its colour gradient and foam.
        pipeline.supportsCameraDepthTexture = true;
        pipeline.supportsCameraOpaqueTexture = true;

        // Long geometric edges against a bright sky: exactly what MSAA fixes.
        pipeline.msaaSampleCount = 4;

        pipeline.shadowDistance = 150f;
        pipeline.shadowCascadeCount = 4;
        pipeline.supportsSoftShadows = true;
        pipeline.supportsHDR = true;

        EditorUtility.SetDirty(pipeline);
        return pipeline;
    }

    static VolumeProfile CreatePostProfile()
    {
        var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(ProfilePath);
        if (profile == null)
        {
            profile = ScriptableObject.CreateInstance<VolumeProfile>();
            AssetDatabase.CreateAsset(profile, ProfilePath);
        }

        // ACES tonemapping is the single biggest step from "Unity default
        // render" to something that reads as a game.
        var tonemapping = GetOrAdd<Tonemapping>(profile);
        tonemapping.mode.overrideState = true;
        tonemapping.mode.value = TonemappingMode.ACES;

        var bloom = GetOrAdd<Bloom>(profile);
        bloom.threshold.overrideState = true;
        bloom.threshold.value = 1.05f;
        bloom.intensity.overrideState = true;
        bloom.intensity.value = 0.55f;
        bloom.scatter.overrideState = true;
        bloom.scatter.value = 0.65f;

        var colorAdjustments = GetOrAdd<ColorAdjustments>(profile);
        colorAdjustments.postExposure.overrideState = true;
        colorAdjustments.postExposure.value = 0.15f;
        colorAdjustments.contrast.overrideState = true;
        colorAdjustments.contrast.value = 12f;
        colorAdjustments.saturation.overrideState = true;
        colorAdjustments.saturation.value = 8f;

        var vignette = GetOrAdd<Vignette>(profile);
        vignette.intensity.overrideState = true;
        vignette.intensity.value = 0.22f;
        vignette.smoothness.overrideState = true;
        vignette.smoothness.value = 0.4f;

        EditorUtility.SetDirty(profile);
        return profile;
    }

    static T GetOrAdd<T>(VolumeProfile profile) where T : VolumeComponent
    {
        return profile.TryGet(out T component) ? component : profile.Add<T>(true);
    }

    /// <summary>Loads the post-processing profile, creating it if needed.</summary>
    public static VolumeProfile GetPostProfile()
    {
        return AssetDatabase.LoadAssetAtPath<VolumeProfile>(ProfilePath) ?? CreatePostProfile();
    }
}
