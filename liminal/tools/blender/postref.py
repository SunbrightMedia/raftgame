"""Reference (numpy) copy of the ShuttleworthL compositor chain, step by step, to check against Blender's own output
(tools/blender/bl_comp_ref.py) before the GLSL version. Images: float32 [H, W, 4], top row first, scene linear."""
import numpy as np

LO, HI = -12.473931188, 12.526068812

def lut3d(L, x):
    """Trilinear lookup in an N^3 RGB table over log2 of each channel from LO to HI ([b][g][r] order)."""
    N = L.shape[0]
    t = (np.log2(np.maximum(x, 2.0 ** LO)) - LO) / (HI - LO) * (N - 1)
    t = np.clip(t, 0, N - 1 - 1e-6)
    i = np.floor(t).astype(int); f = t - i
    r, g, b = i[..., 0], i[..., 1], i[..., 2]; fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]
    out = 0
    for db in (0, 1):
        for dg in (0, 1):
            for dr in (0, 1):
                w = (fr if dr else 1 - fr) * (fg if dg else 1 - fg) * (fb if db else 1 - fb)
                out = out + w * L[b + db, g + dg, r + dr]
    return out

def rgb_to_hsv(c):
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    cmax = np.maximum(r, np.maximum(g, b)); cmin = np.minimum(r, np.minimum(g, b)); d = cmax - cmin
    v = cmax
    s = np.where(cmax != 0, d / np.where(cmax != 0, cmax, 1), 0.0)
    dd = np.where(d != 0, d, 1)
    cr, cg, cb = (cmax - r) / dd, (cmax - g) / dd, (cmax - b) / dd
    h = np.where(r == cmax, cb - cg, np.where(g == cmax, 2 + cr - cb, 4 + cg - cr)) / 6.0
    h = np.where(h < 0, h + 1, h)
    h = np.where(s == 0, 0.0, h)
    return np.stack([h, s, v], -1)

def hsv_to_rgb(hsv):
    h, s, v = hsv[..., 0].copy(), hsv[..., 1], hsv[..., 2]
    h = np.where(h == 1.0, 0.0, h) * 6.0
    i = np.floor(h); f = h - i
    p = v * (1 - s); q = v * (1 - s * f); t = v * (1 - s * (1 - f))
    conds = [i == 0, i == 1, i == 2, i == 3, i == 4]
    r = np.select(conds, [v, q, p, p, t], v); g = np.select(conds, [t, v, v, q, p], p); b = np.select(conds, [p, p, t, v, v], q)
    out = np.stack([r, g, b], -1)
    return np.where((s == 0)[..., None], v[..., None], out)

def bright_contrast(x, brightness, contrast):
    """Blender's compositor Brightness/Contrast (Werner D. Streidt's algorithm; brightness and contrast in %)."""
    b = brightness / 100.0; delta = contrast / 200.0
    if contrast > 0:
        a = 1.0 / max(1.0 - delta * 2.0, 1.1920929e-07); off = a * (b - delta)
    else:
        delta = -delta; a = max(1.0 - delta * 2.0, 0.0); off = a * b + delta
    return x * a + off

def filmic_log_inv(y):
    return 2.0 ** (y * (4.026068812 - LO) + LO)

def tune_image(x, flog, contrast=0.05, boost=1.0):
    rgb, alpha = x[..., :3], x[..., 3:4]
    hsv = rgb_to_hsv(rgb)
    k = contrast * 5.0
    hsv[..., 2] = bright_contrast(hsv[..., 2], k * 0.25, k)
    c = hsv_to_rgb(hsv)
    y = lut3d(flog, c)                         # Linear -> Filmic Log
    hsv = rgb_to_hsv(y)
    hsv[..., 1] = np.clip(hsv[..., 1] * (boost + 1.0), 0, 1)
    c = filmic_log_inv(hsv_to_rgb(hsv))        # Filmic Log -> Linear
    c = filmic_log_inv(lut3d(flog, c))         # the clarity/detail/sharpen block (all 0): one more round trip
    return np.concatenate([c, alpha], -1)

def curve_eval(cv, k, x):
    """Curve k of a sampled curve set (tools/blender/bl_curves.py) at x, with Blender's linear extension outside."""
    ys = np.asarray(cv['curves'][k]); x0, x1, n = cv['x0'], cv['x1'], cv['n']
    t = (x - x0) / (x1 - x0) * (n - 1)
    tc = np.clip(t, 0, n - 1 - 1e-9); i = np.floor(tc).astype(int); f = tc - i
    y = ys[i] * (1 - f) + ys[np.minimum(i + 1, n - 1)] * f
    y = np.where(x < x0, ys[0] + (x - x0) * cv['slope_lo'][k], y)
    y = np.where(x > x1, ys[-1] + (x - x1) * cv['slope_hi'][k], y)
    return y

def rgb_curves(x, cv, factor=1.0):
    """RGB Curves (standard tone, default black/white levels): the combined curve (index 3), then each channel's."""
    c = x[..., :3]
    comb = np.stack([curve_eval(cv, 3, c[..., i]) for i in range(3)], -1)
    out = np.stack([curve_eval(cv, i, comb[..., i]) for i in range(3)], -1)
    out = c + (out - c) * factor
    return np.concatenate([out, x[..., 3:4]], -1)

def sample_bilinear(img, u, v, border='extend'):
    """Blender's compositor bilinear sampling at normalized coordinates (pixel centres at (i + 0.5) / size).
    img [H, W, C] with row 0 = the BOTTOM row (Blender's y up); u, v arrays. border: 'extend' or 'zero'."""
    H, W = img.shape[:2]
    x = u * W - 0.5; y = v * H - 0.5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    def tap(xi, yi):
        if border == 'extend':
            return img[np.clip(yi, 0, H - 1), np.clip(xi, 0, W - 1)]
        ok = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
        return np.where(ok[..., None], img[np.clip(yi, 0, H - 1), np.clip(xi, 0, W - 1)], 0.0)
    return (tap(x0, y0) * (1 - fx) * (1 - fy) + tap(x0 + 1, y0) * fx * (1 - fy) +
            tap(x0, y0 + 1) * (1 - fx) * fy + tap(x0 + 1, y0 + 1) * fx * fy)

def grid(W, H):
    """Normalized pixel-centre coordinates of a W x H image (u right, v up from the bottom row)."""
    xs = (np.arange(W) + 0.5) / W; ys = (np.arange(H) + 0.5) / H
    return np.meshgrid(xs, ys)

def smooth_min(a, b, k):
    if k == 0.0: return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25

def glare_highlights(img_bu, threshold=1.0, smoothness=0.1, maximum=None, quality=1):
    """img_bu: [H, W, 4] bottom row first. Medium quality (1): half size, each pixel the bilinear centre of a 2x2 block."""
    H, W = img_bu.shape[:2]; q = 1 << quality
    h, w = -(-H // q), -(-W // q)
    if quality == 0:
        c = img_bu[..., :3].copy()
    else:
        xs = (np.arange(w) * q + q / 2) / W; ys = (np.arange(h) * q + q / 2) / H
        U, V = np.meshgrid(xs, ys)
        if quality == 1:
            c = sample_bilinear(img_bu[..., :3], U, V, 'extend')
        else:
            raise NotImplementedError
    hsv = rgb_to_hsv(c)
    mx = np.float32(3.4028235e38) if maximum is None else threshold + maximum
    # adaptive smooth clamp of the value between threshold and max
    rng = abs(mx - threshold); smin = min(smoothness, min(abs(threshold), rng)); smax = min(smoothness, min(abs(mx), rng))
    v = hsv[..., 2]
    sm = -smooth_min(-threshold, -v, smin)          # smooth_max(threshold, v)
    v = smooth_min(mx, sm, smax)
    hsv[..., 2] = v - threshold
    return hsv_to_rgb(hsv)

def glare_streaks(hl, streaks=2, angle=0.0, iterations=3, fade=0.9, cmod=0.25):
    H, W = hl.shape[:2]
    U, V = grid(W, H)
    acc = np.zeros_like(hl)
    att = 1.0 / (5 + 1 - iterations)
    for s in range(streaks):
        a = angle + (s / streaks) * (np.pi * 2.0)
        d = np.array([np.cos(a), np.sin(a)], np.float32)
        inp = hl.copy()
        for it in range(iterations):
            cm = 1.0 - cmod ** (it + 1)
            mag = 4.0 ** it
            f1 = fade ** mag; ff = (f1, f1 ** 2, f1 ** 3)
            vx, vy = d[0] * mag / W, d[1] * mag / H
            n0 = sample_bilinear(inp, U + vx, V + vy, 'zero') * np.array([1, cm, cm])
            n1 = sample_bilinear(inp, U + 2 * vx, V + 2 * vy, 'zero') * np.array([cm, cm, 1])
            n2 = sample_bilinear(inp, U + 3 * vx, V + 3 * vy, 'zero') * np.array([cm, 1, cm])
            centre = sample_bilinear(inp, U, V, 'zero')
            inp = (centre + ff[0] * n0 + ff[1] * n1 + ff[2] * n2) / 2.0
        acc = acc + inp * att
    return acc

def bloom_chain_length(h, w, size):
    return int(np.log2(max(1.0, min(h, w) * size)))

def glare_bloom(hl, size=0.5):
    H, W = hl.shape[:2]
    n = bloom_chain_length(H, W, size)
    if n < 2: return hl.copy(), max(1, n)
    chain = [hl]
    for i in range(n - 1):
        src = chain[-1]; sh, sw = src.shape[:2]; h, w = sh // 2, sw // 2
        U, V = grid(w, h); px, py = 1.0 / sw, 1.0 / sh
        S = lambda dx, dy: sample_bilinear(src, U + px * dx, V + py * dy, 'extend')
        c = S(0, 0); uln, urn, lln, lrn = S(-1, 1), S(1, 1), S(-1, -1), S(1, -1)
        lf, rf, uf, lof = S(-2, 0), S(2, 0), S(0, 2), S(0, -2)
        ulf, urf, llf, lrf = S(-2, 2), S(2, 2), S(-2, -2), S(2, -2)
        if i == 0:
            def kw(*cs):
                w_ = [1.0 / (x.max(-1, keepdims=True) + 1.0) for x in cs]
                return sum(x * ww for x, ww in zip(cs, w_)) / sum(w_)
            cw = kw(uln, urn, lrn, lln)
            out = 0.5 * cw + 0.125 * (kw(ulf, uf, c, lf) + kw(uf, urf, rf, c) + kw(c, rf, lrf, lof) + kw(lf, c, lof, llf))
        else:
            out = (4 / 32) * c + (4 / 32) * (uln + urn + lln + lrn) + (2 / 32) * (lf + rf + uf + lof) + (1 / 32) * (ulf + urf + llf + lrf)
        chain.append(out)
    for i in range(n - 1):
        src = chain[n - 1 - i]; dst = chain[n - 2 - i]
        h, w = dst.shape[:2]; U, V = grid(w, h); px, py = 1.0 / w, 1.0 / h
        S = lambda dx, dy: sample_bilinear(src, U + px * dx, V + py * dy, 'extend')
        up = (4 / 16) * S(0, 0) + (2 / 16) * (S(-1, 0) + S(0, 1) + S(1, 0) + S(0, -1)) + (1 / 16) * (S(-1, -1) + S(-1, 1) + S(1, -1) + S(1, 1))
        chain[n - 2 - i] = dst + up
    return chain[0], max(1, n)

def glare(img_td, kind, strength, threshold=1.0, smoothness=0.1, size=0.5, saturation=1.0, tint=(1, 1, 1), **kw):
    """Glare node on a top-down image. Returns the mixed image (top-down)."""
    img = img_td[::-1]
    hl = glare_highlights(img, threshold, smoothness)
    if kind == 'streaks':
        g, norm = glare_streaks(hl, **kw), 1.0
    else:
        g, norm = glare_bloom(hl, size)
    H, W = img.shape[:2]; U, V = grid(W, H)
    gg = sample_bilinear(g, U, V, 'extend')
    hsv = rgb_to_hsv(gg); hsv[..., 1] = np.clip(hsv[..., 1] * saturation, 0, 1); gg = hsv_to_rgb(hsv)
    out = np.maximum(img[..., :3], 0.0) + gg * (np.array(tint) * strength / norm)
    res = np.concatenate([out, np.maximum(img[..., 3:4], 0.0)], -1)
    return res[::-1]

# ---- Blender's hash (Jenkins lookup3 on float bit patterns), bit exact
M32 = np.uint32(0xFFFFFFFF)
def _rot(x, k): return ((x << np.uint32(k)) | (x >> np.uint32(32 - k))).astype(np.uint32)
def _final(a, b, c):
    with np.errstate(over='ignore'):
        c ^= b; c -= _rot(b, 14); a ^= c; a -= _rot(c, 11); b ^= a; b -= _rot(a, 25)
        c ^= b; c -= _rot(b, 16); a ^= c; a -= _rot(c, 4); b ^= a; b -= _rot(a, 14)
        c ^= b; c -= _rot(b, 24)
    return a, b, c
def _hash(*ks):
    n = len(ks)
    with np.errstate(over='ignore'):
        init = np.uint32((0xdeadbeef + (n << 2) + 13) & 0xFFFFFFFF)
        shape = np.broadcast(*ks).shape
        a = np.full(shape, init, np.uint32); b = a.copy(); c = a.copy()
        if n == 1: a += ks[0]
        elif n == 2: b += ks[1]; a += ks[0]
        elif n == 3: c += ks[2]; b += ks[1]; a += ks[0]
        else: raise NotImplementedError
        a, b, c = _final(a, b, c)
    return c
def _bits(x): return np.asarray(x, np.float32).view(np.uint32)
def hash_f(*fs):
    """hash_float_to_float(float / float2 / float3): [0, 1]."""
    h = _hash(*[_bits(f) for f in fs])
    return (h.astype(np.float32) / np.float32(4294967295.0)).astype(np.float32)

def uniform_coords(W, H):
    """Image Coordinates 'Uniform' (bottom row first), float32 as Blender computes it."""
    m = np.float32(max(W, H))
    xs = (np.arange(W, dtype=np.float32) + np.float32(0.5) - np.float32(W) / np.float32(2.0)) / m * np.float32(2.0)
    ys = (np.arange(H, dtype=np.float32) + np.float32(0.5) - np.float32(H) / np.float32(2.0)) / m * np.float32(2.0)
    return np.meshgrid(xs, ys)

def overlay(a, b, fac):
    facm = 1.0 - fac
    return np.where(a < 0.5, a * (facm + 2.0 * fac * b), 1.0 - (facm + 2.0 * fac * (1.0 - b)) * (1.0 - a))

def sensor_noise(img_td, frame=1.0, luma=0.05, chroma=0.16):
    img = img_td[::-1]
    H, W = img.shape[:2]
    hsv = rgb_to_hsv(img[..., :3])
    ux, uy = uniform_coords(W, H)
    wn1 = hash_f(np.float32(frame))
    vx = (ux + np.float32(0.0)).astype(np.float32); vy = (uy + wn1).astype(np.float32)
    val = hash_f(vx, vy)
    col = np.stack([hash_f(vx, vy), hash_f(vx, vy, np.float32(1.0)), hash_f(vx, vy, np.float32(2.0))], -1)
    shift = (col - 0.5).sum(-1) / 3.0 * chroma
    h = hsv[..., 0] + shift
    h = h - np.floor(h / 1.0) * 1.0
    v = overlay(hsv[..., 2], val, luma)
    out = hsv_to_rgb(np.stack([h, hsv[..., 1], v], -1))
    return np.concatenate([out, img[..., 3:4]], -1)[::-1]

# ---- Blender's interpolation with wrap modes ('border' = Clip, 'extend', 'repeat'); images bottom row first
def _wrap(i, size, mode):
    """Integer index for a float coordinate as BLI wrap_coord does (truncation for in-range values); -1 = zero."""
    i = np.asarray(i, np.float64)
    out = np.where((i >= 0) & (i < size), np.trunc(i), 0)
    if mode == 'extend':
        out = np.where(i >= size, size - 1, np.where(i < 0, 0, out))
    elif mode == 'repeat':
        pos = np.mod(np.trunc(np.where(i >= 0, i, 0)), size)
        neg = np.mod(-np.floor(np.where(i < 0, i, 0)), size); neg = np.where(neg != 0, size - neg, 0)
        out = np.where(i >= size, pos, np.where(i < 0, neg, out))
    else:
        out = np.where((i >= size) | (i < 0), -1, out)
    return out.astype(int)

def sample_wrap(img, u, v, interp='bilinear', wx='border', wy='border'):
    """Sample at texel-space coordinates u, v (pixel centre of texel i at i + 0.5), as Result::sample."""
    H, W = img.shape[:2]
    C = img.shape[2]
    def fetch(xi, yi):
        ok = (xi >= 0) & (yi >= 0)
        return np.where(ok[..., None], img[np.clip(yi, 0, H - 1), np.clip(xi, 0, W - 1)], 0.0)
    if interp == 'nearest':
        return fetch(_wrap(u, W, wx), _wrap(v, H, wy))
    x = u - 0.5; y = v - 0.5
    if interp == 'bilinear':
        xf = np.floor(x); yf = np.floor(y); a = (x - xf)[..., None]; b = (y - yf)[..., None]
        x1, x2 = _wrap(xf, W, wx), _wrap(xf + 1, W, wx); y1, y2 = _wrap(yf, H, wy), _wrap(yf + 1, H, wy)
        return (fetch(x1, y1) * (1 - a) * (1 - b) + fetch(x2, y1) * a * (1 - b) + fetch(x1, y2) * (1 - a) * b + fetch(x2, y2) * a * b)
    # bicubic B-spline
    def coef(f):
        f2 = f * f; f3 = f2 * f
        w3 = f3 / 6.0; w0 = -w3 + f2 * 0.5 - f * 0.5 + 1.0 / 6.0; w1 = f3 * 0.5 - f2 + 2.0 / 3.0; w2 = 1.0 - w0 - w1 - w3
        return (w0, w1, w2, w3)
    wxs = coef(x - np.floor(x)); wys = coef(y - np.floor(y))
    out = 0.0
    for n in range(4):
        yi = _wrap(y - 1 + n, H, wy)
        for m in range(4):
            xi = _wrap(x - 1 + m, W, wx)
            out = out + fetch(xi, yi) * (wxs[m] * wys[n])[..., None]
    return out

def realize_scaled(img, sx, sy, interp='bilinear', wx='border', wy='border', out_size=None):
    """An image whose domain was scaled by (sx, sy) about its centre (Scale node, relative), realized onto a target
    domain of out_size (default: its own size) centred the same way."""
    H, W = img.shape[:2]
    oH, oW = out_size if out_size else (H, W)
    corr_x = -0.5 if ((W ^ oW) & 1) else 0.0; corr_y = -0.5 if ((H ^ oH) & 1) else 0.0
    px = np.arange(oW) + 0.5 - oW / 2.0; py = np.arange(oH) + 0.5 - oH / 2.0
    PX, PY = np.meshgrid(px, py)
    u = PX / sx + W / 2.0 - corr_x; v = PY / sy + H / 2.0 - corr_y
    return sample_wrap(img, u, v, interp, wx, wy)

def chromatic_aberration_scale(img_td, factor=0.1):
    """Chromatic Aberration group, Scale type: green x(1 + 0.05 factor), blue x(1 + 0.1 factor) about the centre."""
    img = img_td[::-1]
    g = realize_scaled(img[..., 1:2], 1 + 0.05 * factor, 1 + 0.05 * factor, 'bilinear', 'border', 'border')
    b = realize_scaled(img[..., 2:3], 1 + 0.1 * factor, 1 + 0.1 * factor, 'bilinear', 'border', 'border')
    out = np.concatenate([img[..., 0:1], g, b, img[..., 3:4]], -1)
    return out[::-1]
