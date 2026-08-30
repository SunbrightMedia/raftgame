using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// Builds the whole playable scene from code so the project has no
/// hand-edited scene file to merge: Raft &gt; Build Ocean Scene.
/// </summary>
public static class RaftSceneBuilder
{
    const string ScenePath = "Assets/Scenes/Ocean.unity";
    const string MaterialDir = "Assets/Materials";

    [MenuItem("Raft/Build Ocean Scene")]
    public static void BuildScene()
    {
        RenderSetup.Setup();

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        CreateLighting();
        CreatePostProcessing();
        var water = CreateWater();
        var raft = CreateRaft();
        var player = CreatePlayer();
        water.GetComponent<WaterSurface>().followTarget = player.transform;
        CreateDebris(player.transform);
        CreateDevMenu();

        Physics.gravity = new Vector3(0f, -9.81f, 0f);

        // Dev overlay: frame time + hitch log (F3 toggles). Remove for release.
        new GameObject("Perf Probe", typeof(PerfProbe));

        System.IO.Directory.CreateDirectory("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, ScenePath);

        var buildScenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        EditorBuildSettings.scenes = buildScenes;

        Debug.Log("Ocean scene built at " + ScenePath + ". Press Play.");
    }

    static Material MakeMaterial(string name, Color color, float smoothness, float metallic,
        bool transparent, string shaderName = "Universal Render Pipeline/Lit")
    {
        System.IO.Directory.CreateDirectory(MaterialDir);
        string path = MaterialDir + "/" + name + ".mat";
        var shader = Shader.Find(shaderName)
            ?? Shader.Find("Universal Render Pipeline/Lit")
            ?? Shader.Find("Standard");

        var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (mat == null)
        {
            mat = new Material(shader);
            AssetDatabase.CreateAsset(mat, path);
        }
        mat.shader = shader;

        if (mat.HasProperty("_Color")) mat.SetColor("_Color", color);
        if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", color);
        if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", smoothness);
        if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", smoothness);
        if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", metallic);

        if (transparent && mat.HasProperty("_Surface"))
        {
            mat.SetFloat("_Surface", 1f); // URP Lit: transparent
            mat.SetFloat("_Blend", 0f);   // alpha
            mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            mat.SetInt("_ZWrite", 0);
            mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            mat.renderQueue = (int)RenderQueue.Transparent;
        }

        EditorUtility.SetDirty(mat);
        return mat;
    }

    static void CreateLighting()
    {
        var sunGo = new GameObject("Sun");
        var sun = sunGo.AddComponent<Light>();
        sun.type = LightType.Directional;
        sun.color = new Color(1f, 0.96f, 0.86f);
        sun.intensity = 1.25f;
        sun.shadows = LightShadows.Soft;
        sunGo.transform.rotation = Quaternion.Euler(42f, 145f, 0f);

        System.IO.Directory.CreateDirectory(MaterialDir);
        string skyPath = MaterialDir + "/Sky.mat";
        var sky = AssetDatabase.LoadAssetAtPath<Material>(skyPath);
        if (sky == null)
        {
            sky = new Material(Shader.Find("Skybox/Procedural"));
            AssetDatabase.CreateAsset(sky, skyPath);
        }
        sky.SetFloat("_SunSize", 0.04f);
        // Thickness drives how much the procedural skybox yellows toward the
        // horizon. Above ~1 it paints a sunset band, which under this 42-degree
        // midday sun just looks wrong - and green, once the blue tint is over it.
        sky.SetFloat("_AtmosphereThickness", 0.62f);
        sky.SetColor("_SkyTint", new Color(0.45f, 0.66f, 0.9f));
        sky.SetColor("_GroundColor", new Color(0.19f, 0.32f, 0.42f));
        sky.SetFloat("_Exposure", 1.05f);
        EditorUtility.SetDirty(sky);

        RenderSettings.skybox = sky;
        RenderSettings.sun = sun;
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Skybox;
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = new Color(0.62f, 0.75f, 0.85f);
        RenderSettings.fogDensity = 0.0035f;
    }

    static void CreatePostProcessing()
    {
        var go = new GameObject("Post Processing");
        var volume = go.AddComponent<Volume>();
        volume.isGlobal = true;
        volume.priority = 0f;
        volume.sharedProfile = RenderSetup.GetPostProfile();
    }

    static GameObject CreateWater()
    {
        var go = new GameObject("Water", typeof(MeshFilter), typeof(MeshRenderer), typeof(WaterSurface));
        go.transform.position = Vector3.zero;
        var renderer = go.GetComponent<MeshRenderer>();
        var water =
            MakeMaterial("Water", new Color(0.13f, 0.42f, 0.58f, 0.82f), 0.94f, 0.05f, true, "Raft/WaterURP");

        if (water.HasProperty("_ShallowColor"))
            water.SetColor("_ShallowColor", new Color(0.22f, 0.62f, 0.68f, 0.55f));
        if (water.HasProperty("_DeepColor"))
            water.SetColor("_DeepColor", new Color(0.02f, 0.16f, 0.30f, 0.95f));

        // Foam and reflection tuning. Set explicitly rather than left to the
        // shader defaults so rebuilding over an existing Water.mat re-applies
        // them instead of keeping whatever was there.
        if (water.HasProperty("_FoamDepth")) water.SetFloat("_FoamDepth", 0.15f);
        if (water.HasProperty("_FoamCrest")) water.SetFloat("_FoamCrest", 0.55f);
        if (water.HasProperty("_FoamCrestSharpness")) water.SetFloat("_FoamCrestSharpness", 0.45f);
        if (water.HasProperty("_SkyReflection")) water.SetFloat("_SkyReflection", 0.65f);
        if (water.HasProperty("_SunGlint")) water.SetFloat("_SunGlint", 0.6f);
        if (water.HasProperty("_DebugView")) water.SetFloat("_DebugView", 0f);

        renderer.sharedMaterial = water;

        // The surface is displaced on the GPU, so it cannot cast or receive
        // meaningful shadows - skipping them is a straight saving.
        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        return go;
    }

    static void CreateDebris(Transform player)
    {
        var go = new GameObject("Debris Spawner");
        var spawner = go.AddComponent<DebrisSpawner>();
        spawner.followTarget = player;
        // Colour comes from a per-item property block, so one material serves
        // every piece of flotsam.
        spawner.debrisMaterial =
            MakeMaterial("Debris", Color.white, 0.15f, 0f, false, "Raft/FacetedWood");
    }

    static void CreateDevMenu()
    {
        var go = new GameObject("Dev Menu");
        go.AddComponent<DevMenu>().sun = RenderSettings.sun;
    }

    static GameObject CreateRaft()
    {
        var raft = GameObject.CreatePrimitive(PrimitiveType.Cube);
        raft.name = "Raft";
        raft.transform.position = new Vector3(0f, 0.1f, 0f);
        raft.transform.localScale = new Vector3(6f, 0.35f, 6f);
        raft.GetComponent<MeshRenderer>().sharedMaterial =
            MakeMaterial("RaftWood", new Color(0.55f, 0.38f, 0.22f), 0.15f, 0f, false,
                "Raft/FacetedWood");

        var rb = raft.AddComponent<Rigidbody>();
        rb.mass = 400f;
        rb.isKinematic = true;
        rb.interpolation = RigidbodyInterpolation.Interpolate;

        // Anchored: the raft rides the swell but never drifts or spins.
        // Swap this for Buoyancy if you want a free-floating raft.
        raft.AddComponent<RaftPlatform>();
        return raft;
    }

    static GameObject CreatePlayer()
    {
        var player = new GameObject("Player");
        player.transform.position = new Vector3(0f, 1.5f, 0f);

        var capsule = player.AddComponent<CapsuleCollider>();
        capsule.height = 1.8f;
        capsule.radius = 0.3f;
        capsule.center = new Vector3(0f, 0.9f, 0f);

        System.IO.Directory.CreateDirectory(MaterialDir);
        string physPath = MaterialDir + "/PlayerNoFriction.physicMaterial";
        var mat = AssetDatabase.LoadAssetAtPath<PhysicMaterial>(physPath);
        if (mat == null)
        {
            mat = new PhysicMaterial("PlayerNoFriction");
            AssetDatabase.CreateAsset(mat, physPath);
        }
        mat.dynamicFriction = 0f;
        mat.staticFriction = 0f;
        mat.frictionCombine = PhysicMaterialCombine.Minimum;
        mat.bounciness = 0f;
        EditorUtility.SetDirty(mat);
        capsule.material = mat;

        var rb = player.AddComponent<Rigidbody>();
        rb.mass = 75f;
        rb.freezeRotation = true;

        player.AddComponent<FirstPersonController>();
        player.AddComponent<InventorySystem>();   // hotbar + backpack (E)
        player.AddComponent<PickupInteractor>();  // F to pick up, Q to drop

        var camGo = new GameObject("PlayerCamera");
        camGo.transform.SetParent(player.transform, false);
        camGo.transform.localPosition = new Vector3(0f, 1.65f, 0f);
        var cam = camGo.AddComponent<Camera>();
        cam.fieldOfView = 70f;
        cam.nearClipPlane = 0.05f;
        cam.farClipPlane = 1500f;
        camGo.AddComponent<AudioListener>();
        camGo.tag = "MainCamera";

        var camData = camGo.AddComponent<UniversalAdditionalCameraData>();
        camData.renderPostProcessing = true;
        camData.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
        camData.antialiasingQuality = AntialiasingQuality.High;
        camData.renderShadows = true;

        var look = camGo.AddComponent<MouseLook>();
        look.body = player.transform;

        return player;
    }
}
