using System.Text;
using UnityEngine;

/// <summary>
/// Dev-only hitch detector. Any frame longer than spikeThresholdMs is logged
/// with whether a GC collection happened that frame - the single most common
/// cause of periodic spikes. Toggle the overlay with F3. Zero allocations on
/// the happy path, so the probe can't cause what it measures.
/// </summary>
public class PerfProbe : MonoBehaviour
{
    [Tooltip("Frames longer than this (ms) are recorded as spikes.")]
    public float spikeThresholdMs = 40f;

    float _worstMs;
    float _avgMs = 16f;
    int _spikeCount;
    int _lastGcCount;
    string _lastSpike = "none yet";
    readonly StringBuilder _sb = new StringBuilder(256);
    bool _show = true;

    void Update()
    {
        float ms = Time.unscaledDeltaTime * 1000f;
        _avgMs = Mathf.Lerp(_avgMs, ms, 0.03f);

        int gc = System.GC.CollectionCount(0);
        bool gcThisFrame = gc != _lastGcCount;
        _lastGcCount = gc;

        if (ms > spikeThresholdMs && Time.frameCount > 10)
        {
            _spikeCount++;
            _worstMs = Mathf.Max(_worstMs, ms);
            _lastSpike = string.Format("{0:F0}ms at t={1:F1}s frame {2}{3}",
                ms, Time.time, Time.frameCount, gcThisFrame ? " [GC RAN]" : " [no GC]");
            Debug.Log("PerfProbe spike: " + _lastSpike);
        }

        if (Input.GetKeyDown(KeyCode.F3)) _show = !_show;
    }

    void OnGUI()
    {
        if (!_show) return;
        _sb.Length = 0;
        _sb.Append("avg ").Append(_avgMs.ToString("F1")).Append("ms (")
           .Append((1000f / Mathf.Max(_avgMs, 0.01f)).ToString("F0")).Append(" fps)\n")
           .Append("spikes >").Append(spikeThresholdMs.ToString("F0")).Append("ms: ")
           .Append(_spikeCount).Append("  worst ").Append(_worstMs.ToString("F0")).Append("ms\n")
           .Append("last: ").Append(_lastSpike).Append("\nF3 to hide");
        GUI.Label(new Rect(8, 8, 460, 90), _sb.ToString());
    }
}
