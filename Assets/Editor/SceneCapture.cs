using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// Renders the ocean scene to a PNG from batchmode so the look can be checked
/// without opening the editor. Run via:
///   Unity.exe -batchmode -quit -projectPath . -executeMethod SceneCapture.RunBatch
/// Note: this needs a GPU, so it must run WITHOUT -nographics.
/// </summary>
public static class SceneCapture
{
    const string ScenePath = "Assets/Scenes/Ocean.unity";
    const string OutDir = "Logs/shots";

    public static void RunBatch()
    {
        try
        {
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);

            // Let [ExecuteAlways] components (WaterSurface) build their mesh and
            // push wave parameters before we render.
            for (int i = 0; i < 5; i++)
                EditorApplication.QueuePlayerLoopUpdate();

            // Build the skybox ambient + reflection probe. Without this the
            // probe is black in batchmode, every surface facing away from the
            // sun renders pure black, and the water has no environment
            // specular to reflect.
            DynamicGI.UpdateEnvironment();

            Directory.CreateDirectory(OutDir);

            var cam = UnityEngine.Object.FindObjectOfType<Camera>();
            if (cam == null)
                throw new Exception("No camera in " + ScenePath);

            // A low eye-level shot looking along the water, and a higher one
            // looking down at it - the two angles where water shading breaks
            // differently (grazing fresnel vs. wave shape).
            Shoot(cam, "eye-level", new Vector3(0f, 2.0f, -6f), new Vector3(2f, 15f, 0f));
            Shoot(cam, "grazing",   new Vector3(0f, 1.2f, -6f), new Vector3(-1f, 55f, 0f));
            Shoot(cam, "high",      new Vector3(0f, 14f, -22f), new Vector3(28f, 10f, 0f));

            Debug.Log("SceneCapture: wrote shots to " + OutDir);
            EditorApplication.Exit(0);
        }
        catch (Exception e)
        {
            Debug.LogError("SceneCapture failed: " + e);
            EditorApplication.Exit(1);
        }
    }

    static void Shoot(Camera cam, string name, Vector3 pos, Vector3 euler)
    {
        cam.transform.position = pos;
        cam.transform.eulerAngles = euler;

        const int w = 1280, h = 720;
        var rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32,
                                   RenderTextureReadWrite.sRGB) { antiAliasing = 1 };

        var prevTarget = cam.targetTexture;
        var prevActive = RenderTexture.active;

        cam.targetTexture = rt;

        // Render twice and keep the second. _CameraDepthTexture is produced by
        // the previous render, so the first pass after a camera move shades the
        // water against the old view's depth - which shows up as a large bogus
        // foam patch. Discarding one render settles it.
        cam.Render();
        cam.Render();

        RenderTexture.active = rt;
        var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
        tex.Apply();

        cam.targetTexture = prevTarget;
        RenderTexture.active = prevActive;

        File.WriteAllBytes(Path.Combine(OutDir, name + ".png"), tex.EncodeToPNG());

        UnityEngine.Object.DestroyImmediate(tex);
        rt.Release();
        UnityEngine.Object.DestroyImmediate(rt);
    }
}
