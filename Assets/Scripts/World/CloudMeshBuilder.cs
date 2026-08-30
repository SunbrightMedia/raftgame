using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Builds chunky low-poly cloud meshes.
///
/// A cloud is a handful of overlapping icosphere blobs, each squashed wide and
/// flat and pushed around per-vertex, then welded into one mesh with flat
/// normals. Flat normals are the whole point: every triangle gets its own
/// normal, so each facet shades as a single plane and the silhouette reads as
/// straight-edged polygons rather than a smooth curve.
///
/// Subdivision level controls how angular the result is - 0 gives 20 large
/// facets per blob, 1 gives 80. Lower is harsher.
/// </summary>
public static class CloudMeshBuilder
{
    /// <summary>
    /// Builds one cloud. <paramref name="seed"/> makes the shape repeatable.
    /// </summary>
    public static Mesh Build(int seed, int blobs, int subdivisions, float bumpiness,
                             Vector3 spread, Vector2 blobScaleRange, Vector3 squash)
    {
        var random = new System.Random(seed);

        var vertices = new List<Vector3>();
        var triangles = new List<int>();

        for (int i = 0; i < blobs; i++)
        {
            // Blobs cluster near the middle so a cloud reads as one mass with
            // lumps, rather than as scattered separate balls.
            Vector3 offset = new Vector3(
                ((float)random.NextDouble() - 0.5f) * spread.x,
                ((float)random.NextDouble() - 0.5f) * spread.y,
                ((float)random.NextDouble() - 0.5f) * spread.z);

            float scale = Mathf.Lerp(blobScaleRange.x, blobScaleRange.y,
                                     (float)random.NextDouble());

            AppendBlob(vertices, triangles, random, offset, scale, subdivisions,
                       bumpiness, squash);
        }

        var mesh = new Mesh { name = "Cloud" };
        if (vertices.Count > 65000)
            mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;

        mesh.SetVertices(vertices);
        mesh.SetTriangles(triangles, 0);
        // Flat facets, so normals must be per-face. Vertices are already
        // duplicated per triangle below, which makes RecalculateNormals give
        // exactly that.
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();
        return mesh;
    }

    static void AppendBlob(List<Vector3> vertices, List<int> triangles, System.Random random,
                           Vector3 offset, float scale, int subdivisions, float bumpiness,
                           Vector3 squash)
    {
        BuildIcosphere(subdivisions, out List<Vector3> points, out List<int> faces);

        // Push each direction in or out a little so no two blobs are the same
        // shape and none of them read as a sphere.
        var displaced = new Vector3[points.Count];
        for (int i = 0; i < points.Count; i++)
        {
            float wobble = 1f + ((float)random.NextDouble() - 0.5f) * 2f * bumpiness;
            Vector3 p = points[i].normalized * wobble;
            p = Vector3.Scale(p, squash);
            displaced[i] = p * scale + offset;
        }

        // Duplicate every vertex per triangle: shared vertices would average
        // their normals and round the facets off.
        for (int i = 0; i < faces.Count; i += 3)
        {
            int baseIndex = vertices.Count;
            vertices.Add(displaced[faces[i]]);
            vertices.Add(displaced[faces[i + 1]]);
            vertices.Add(displaced[faces[i + 2]]);
            triangles.Add(baseIndex);
            triangles.Add(baseIndex + 1);
            triangles.Add(baseIndex + 2);
        }
    }

    static void BuildIcosphere(int subdivisions, out List<Vector3> points, out List<int> faces)
    {
        float t = (1f + Mathf.Sqrt(5f)) / 2f;

        points = new List<Vector3>
        {
            new Vector3(-1,  t,  0), new Vector3( 1,  t,  0),
            new Vector3(-1, -t,  0), new Vector3( 1, -t,  0),
            new Vector3( 0, -1,  t), new Vector3( 0,  1,  t),
            new Vector3( 0, -1, -t), new Vector3( 0,  1, -t),
            new Vector3( t,  0, -1), new Vector3( t,  0,  1),
            new Vector3(-t,  0, -1), new Vector3(-t,  0,  1),
        };

        faces = new List<int>
        {
            0, 11, 5,  0, 5, 1,   0, 1, 7,   0, 7, 10,  0, 10, 11,
            1, 5, 9,   5, 11, 4,  11, 10, 2, 10, 7, 6,  7, 1, 8,
            3, 9, 4,   3, 4, 2,   3, 2, 6,   3, 6, 8,   3, 8, 9,
            4, 9, 5,   2, 4, 11,  6, 2, 10,  8, 6, 7,   9, 8, 1,
        };

        for (int s = 0; s < subdivisions; s++)
        {
            var split = new List<int>(faces.Count * 4);
            var cache = new Dictionary<long, int>();

            for (int i = 0; i < faces.Count; i += 3)
            {
                int a = faces[i], b = faces[i + 1], c = faces[i + 2];
                int ab = Midpoint(points, cache, a, b);
                int bc = Midpoint(points, cache, b, c);
                int ca = Midpoint(points, cache, c, a);

                split.AddRange(new[] { a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca });
            }
            faces = split;
        }
    }

    static int Midpoint(List<Vector3> points, Dictionary<long, int> cache, int a, int b)
    {
        long key = a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
        if (cache.TryGetValue(key, out int existing)) return existing;

        Vector3 middle = ((points[a] + points[b]) * 0.5f).normalized;
        points.Add(middle);
        int index = points.Count - 1;
        cache[key] = index;
        return index;
    }
}
