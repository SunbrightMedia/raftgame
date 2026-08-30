using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

/// <summary>
/// Batchmode entry point that forces a script + shader compile and dumps every
/// error it finds to Logs/compile-errors.log. Run via:
///   Unity.exe -batchmode -quit -projectPath . -executeMethod CompileCheck.RunBatch
/// </summary>
public static class CompileCheck
{
    const string LogPath = "Logs/compile-errors.log";

    public static void RunBatch()
    {
        var lines = new List<string>();
        int errors = 0;

        try
        {
            errors += CheckScripts(lines);
            errors += CheckShaders(lines);
        }
        catch (Exception e)
        {
            errors++;
            lines.Add("EXCEPTION in CompileCheck: " + e);
        }

        lines.Insert(0, errors == 0
            ? "COMPILE OK: no script or shader errors."
            : "COMPILE FAILED: " + errors + " error(s).");

        Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
        File.WriteAllLines(LogPath, lines);
        Console.WriteLine(string.Join(Environment.NewLine, lines));

        EditorApplication.Exit(errors == 0 ? 0 : 1);
    }

    static int CheckScripts(List<string> lines)
    {
        lines.Add("=== C# ===");
        int errors = 0;

        // Unity compiles all scripts before -executeMethod runs, so reaching
        // this point already means the C# compiled. A hard failure is caught by
        // compile.ps1, which scans the Unity log for CS errors when this method
        // never runs at all.
        if (EditorUtility.scriptCompilationFailed)
        {
            errors++;
            lines.Add("EditorUtility.scriptCompilationFailed == true (see Unity log for CS errors)");
        }

        foreach (var asm in CompilationPipeline.GetAssemblies(AssembliesType.Editor))
        {
            if (asm.sourceFiles.Length > 0 && !File.Exists(asm.outputPath))
            {
                errors++;
                lines.Add("Assembly failed to build: " + asm.name);
            }
        }

        if (errors == 0)
            lines.Add("(no C# errors)");
        return errors;
    }

    static int CheckShaders(List<string> lines)
    {
        lines.Add("=== Shaders ===");
        int errors = 0;

        var guids = AssetDatabase.FindAssets("t:Shader")
            .Concat(AssetDatabase.FindAssets("t:ComputeShader"))
            .Distinct();

        foreach (var guid in guids)
        {
            var path = AssetDatabase.GUIDToAssetPath(guid);
            if (!path.StartsWith("Assets/", StringComparison.Ordinal))
                continue;

            var shader = AssetDatabase.LoadAssetAtPath<Shader>(path);
            if (shader == null)
                continue;

            // Re-import so the compiler runs even if the shader is cached.
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);

            int count = ShaderUtil.GetShaderMessageCount(shader);
            if (count == 0)
                continue;

            foreach (var msg in ShaderUtil.GetShaderMessages(shader))
            {
                bool isError = msg.severity == UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error;
                if (isError)
                    errors++;
                lines.Add(string.Format("{0}({1}): {2}: {3} {4} [{5}]",
                    string.IsNullOrEmpty(msg.file) ? path : msg.file,
                    msg.line,
                    isError ? "error" : "warning",
                    msg.message,
                    msg.messageDetails,
                    msg.platform));
            }
        }

        if (errors == 0)
            lines.Add("(no shader errors)");
        return errors;
    }
}
