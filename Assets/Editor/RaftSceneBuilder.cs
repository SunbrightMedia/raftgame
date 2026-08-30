using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

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
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        CreateLighting();
        var water = CreateWater();
        var raft = CreateRaft();
        var player = CreatePlayer();
        water.GetComponent<WaterSurface>().followTarget = player.transform;

        Physics.gravity = new Vector3(0f, -9.81f, 0f);

        System.IO.Directory.CreateDirectory("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, ScenePath);

        var buildScenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        EditorBuildSettings.scenes = buildScenes;

        Debug.Log("Ocean scene built at " + ScenePath + ". Press Play.");
    }

    static Material MakeMaterial(string name, Color color, float smoothness, float metallic,
        bool transparent, string shaderName = "Standard")
    {
        System.IO.Directory.CreateDirectory(MaterialDir);
        string path = MaterialDir + "/" + name + ".mat";
        var shader = Shader.Find(shaderName) ?? Shader.Find("Standard");

        var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (mat == null)
        {
            mat = new Material(shader);
            AssetDatabase.CreateAsset(mat, path);
        }
        mat.shader = shader;

        mat.color = color;
        mat.SetFloat("_Glossiness", smoothness);
        mat.SetFloat("_Metallic", metallic);

        if (transparent && shader.name == "Standard")
        {
            mat.SetFloat("_Mode", 3f); // Transparent
            mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.One);
            mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            mat.SetInt("_ZWrite", 1);
            mat.DisableKeyword("_ALPHATEST_ON");
            mat.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            mat.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
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
        sky.SetFloat("_AtmosphereThickness", 1.1f);
        sky.SetColor("_SkyTint", new Color(0.45f, 0.66f, 0.9f));
        sky.SetColor("_GroundColor", new Color(0.19f, 0.32f, 0.42f));
        sky.SetFloat("_Exposure", 1.15f);
        EditorUtility.SetDirty(sky);

        RenderSettings.skybox = sky;
        RenderSettings.sun = sun;
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Skybox;
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = new Color(0.62f, 0.75f, 0.85f);
        RenderSettings.fogDensity = 0.0035f;
    }

    static GameObject CreateWater()
    {
        var go = new GameObject("Water", typeof(MeshFilter), typeof(MeshRenderer), typeof(WaterSurface));
        go.transform.position = Vector3.zero;
        var renderer = go.GetComponent<MeshRenderer>();
        renderer.sharedMaterial =
            MakeMaterial("Water", new Color(0.13f, 0.42f, 0.58f, 0.82f), 0.9f, 0.1f, true, "Raft/Water");

        // The surface is displaced on the GPU, so it cannot cast or receive
        // meaningful shadows - skipping them is a straight saving.
        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        return go;
    }

    static GameObject CreateRaft()
    {
        var raft = GameObject.CreatePrimitive(PrimitiveType.Cube);
        raft.name = "Raft";
        raft.transform.position = new Vector3(0f, 0.1f, 0f);
        raft.transform.localScale = new Vector3(6f, 0.35f, 6f);
        raft.GetComponent<MeshRenderer>().sharedMaterial =
            MakeMaterial("RaftWood", new Color(0.55f, 0.38f, 0.22f), 0.15f, 0f, false);

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

        var camGo = new GameObject("PlayerCamera");
        camGo.transform.SetParent(player.transform, false);
        camGo.transform.localPosition = new Vector3(0f, 1.65f, 0f);
        var cam = camGo.AddComponent<Camera>();
        cam.fieldOfView = 70f;
        cam.nearClipPlane = 0.05f;
        cam.farClipPlane = 1500f;
        camGo.AddComponent<AudioListener>();
        camGo.tag = "MainCamera";

        var look = camGo.AddComponent<MouseLook>();
        look.body = player.transform;

        return player;
    }
}
