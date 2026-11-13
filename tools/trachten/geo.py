"""Procedural Trachten character geometry (Blender axes: x = character's left, -y = forward, z = up).
Everything is numpy; build.py turns the result into Blender objects and the game's JSON."""
import numpy as np

PARTS = dict(skin=0, shirt=1, leather=2, socks=3, hair=4, apron=5, dirndl=6, mug=7, handle=8, felt=9,
             shoes=10, white=11, dark=12, trim=13, ldetail=14, lips=15, silver=16, gamsbart=17, hatband=18)


def nz(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


class Mesh:
    def __init__(self):
        self.V = []      # list of np arrays (n,3)
        self.F = []      # list of tuples (global indices)
        self.FP = []     # part per face
        self.W = []      # list of dict per vertex
        self.MH = []     # mug height 0..1 per vertex (0 for non-mug)
        self.n = 0

    def add(self, V, F, parts, weights, mh=None):
        V = np.asarray(V, float)
        base = self.n
        self.V.append(V)
        for f, p in zip(F, parts):
            self.F.append(tuple(base + i for i in f))
            self.FP.append(p)
        if callable(weights):
            self.W += [weights(v) for v in V]
        elif isinstance(weights, dict):
            self.W += [dict(weights) for _ in V]
        else:
            self.W += list(weights)
        self.MH += list(mh) if mh is not None else [0.0] * len(V)
        self.n += len(V)
        return base

    def verts(self):
        return np.concatenate(self.V) if self.V else np.zeros((0, 3))

    def transform(self, start, M):
        """apply 4x4 to vertices added since global index `start`"""
        allv = self.verts()
        pts = allv[start:]
        pts = pts @ M[:3, :3].T + M[:3, 3]
        allv[start:] = pts
        self.V = [allv]


def superring(a, ru, rvp, rvn, p=2.0, wob=None):
    c, s = np.cos(a), np.sin(a)
    e = 2.0 / p
    du = np.sign(c) * np.abs(c) ** e * ru
    dv = np.sign(s) * np.abs(s) ** e * np.where(s > 0, rvp, rvn)
    if wob is not None:
        k = wob(a)
        du, dv = du * k, dv * k
    return du, dv


def catmull(P, k):
    """resample a polyline of keyframes: k sub-steps per interval (Catmull-Rom). returns array and keyframe flags"""
    P = np.asarray(P, float)
    if k <= 1 or len(P) < 2:
        return P, np.arange(len(P))
    out = []
    idx = []
    n = len(P)
    for i in range(n - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, n - 1)]
        for j in range(k):
            t = j / k
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
            if j == 0:
                idx.append(len(out) - 1)
    out.append(P[-1])
    idx.append(len(out) - 1)
    return np.array(out), np.array(idx)


def loft(M, rings, segs, sub=1, cap0=0.0, cap1=0.0, weights=None, part_fn=None, closed=True, a0=0.0, inner=False):
    """rings: list of dicts with keys c (center), u, v (axes), ru, rvp, rvn, p, part (part of the segment that follows),
    w (weights dict), optional 'wob' callable. sub: subdivisions between rings (smooth resample).
    weights: optional callable(point, ringparam)->dict overriding ring weights."""
    keys = ['ru', 'rvp', 'rvn', 'p']
    C = np.array([r['c'] for r in rings], float)
    U = np.array([r['u'] for r in rings], float)
    Vv = np.array([r['v'] for r in rings], float)
    S = np.array([[r[k] if k in r else (2.0 if k == 'p' else r['ru']) for k in keys] for r in rings], float)
    Cr, kidx = catmull(C, sub)
    Ur, _ = catmull(U, sub)
    Vr, _ = catmull(Vv, sub)
    Sr, _ = catmull(S, sub)
    Sr[:, :3] = np.maximum(Sr[:, :3], 1e-4)
    N = len(Cr)
    # ring index -> key ring index (for parts) and fractional param (for weights)
    seg_part = []
    tpar = np.zeros(N)
    for i in range(N):
        kk = np.searchsorted(kidx, i, side='right') - 1
        kk = min(kk, len(rings) - 1)
        nxt = min(kk + 1, len(rings) - 1)
        span = max(kidx[nxt] - kidx[kk], 1)
        tpar[i] = kk + (i - kidx[kk]) / span if nxt != kk else kk
        seg_part.append(rings[kk].get('part', 0))
    if closed:
        ang = a0 + np.arange(segs) / segs * 2 * np.pi
    else:
        ang = a0 + np.linspace(0, 1, segs)  # caller passes a0..a1 via ring 'arc'
    T = np.zeros((N, 3))
    for i in range(N):
        T[i] = Cr[min(i + 1, N - 1)] - Cr[max(i - 1, 0)]
    T = nz(T)
    verts = []
    for i in range(N):
        u = nz(Ur[i] - T[i] * np.dot(Ur[i], T[i]))
        v = Vr[i] - T[i] * np.dot(Vr[i], T[i]) - u * np.dot(Vr[i], u)
        if np.linalg.norm(v) < 1e-9:
            v = np.cross(T[i], u)
        v = nz(v)
        ru, rvp, rvn, p = Sr[i]
        wob = rings[int(np.floor(tpar[i]))].get('wob')
        aa = ang if np.dot(np.cross(u, v), T[i]) > 0 else -ang
        du, dv = superring(aa, ru, rvp, rvn, p, wob)
        ring = Cr[i] + np.outer(du, u) + np.outer(dv, v)
        verts.append(ring)
    V = np.concatenate(verts)
    F, P = [], []
    for i in range(N - 1):
        for j in range(segs):
            j1 = (j + 1) % segs
            a, b, c, d = i * segs + j, i * segs + j1, (i + 1) * segs + j1, (i + 1) * segs + j
            q = (a, b, c, d) if not inner else (a, d, c, b)
            F.append(q)
            P.append(part_fn(i, j, V[[a, b, c, d]].mean(0)) if part_fn else seg_part[i])
    extra = []
    if cap0 is not None and cap0 is not False:
        cidx = len(V) + len(extra)
        extra.append(Cr[0] - T[0] * cap0)
        for j in range(segs):
            j1 = (j + 1) % segs
            F.append((cidx, j1, j) if not inner else (cidx, j, j1))
            P.append(rings[0].get('cap_part', seg_part[0]))
    if cap1 is not None and cap1 is not False:
        cidx = len(V) + len(extra)
        extra.append(Cr[-1] + T[-1] * cap1)
        o = (N - 1) * segs
        for j in range(segs):
            j1 = (j + 1) % segs
            F.append((cidx, o + j, o + j1) if not inner else (cidx, o + j1, o + j))
            P.append(rings[-1].get('cap_part', seg_part[-2] if N > 1 else seg_part[0]))
    if extra:
        V = np.concatenate([V, np.array(extra)])
    # weights
    hc0 = cap0 is not None and cap0 is not False
    hc1 = cap1 is not None and cap1 is not False
    tp = np.concatenate([np.repeat(tpar, segs), [0.0] * int(hc0) + [len(rings) - 1.0] * int(hc1)])
    W = []
    for vi, pt in enumerate(V):
        t = tp[vi]
        k0 = int(np.floor(t))
        k1 = min(k0 + 1, len(rings) - 1)
        f = t - k0
        w = {}
        for k, ww in ((k0, 1 - f), (k1, f)):
            for b, x in rings[k]['w'].items():
                w[b] = w.get(b, 0) + x * ww
        if weights:
            w = weights(pt, t, w)
        W.append(w)
    return M.add(V, F, P, W)


def ellipsoid(M, c, axes, radii, part, w, nu=12, nv=8, shape=None, mh=None):
    """axes: 3 unit vectors (a, b, up); radii 3 values. shape(theta,phi)->scale"""
    c = np.asarray(c, float)
    A = np.array(axes, float)
    if np.linalg.det(A) < 0:
        A[2] = -A[2]
    V = [c + A[2] * radii[2]]
    for i in range(1, nv):
        th = np.pi * i / nv
        for j in range(nu):
            ph = 2 * np.pi * j / nu
            s = shape(th, ph) if shape else 1.0
            d = np.array([np.sin(th) * np.cos(ph) * radii[0], np.sin(th) * np.sin(ph) * radii[1], np.cos(th) * radii[2]]) * s
            V.append(c + A.T @ d)
    V.append(c - A[2] * radii[2])
    F = []
    for j in range(nu):
        F.append((0, 1 + j, 1 + (j + 1) % nu))
    for i in range(nv - 2):
        for j in range(nu):
            a = 1 + i * nu + j
            b = 1 + i * nu + (j + 1) % nu
            F.append((a, a + nu, b + nu, b))
    last = len(V) - 1
    o = 1 + (nv - 2) * nu
    for j in range(nu):
        F.append((last, o + (j + 1) % nu, o + j))
    parts = [part] * len(F) if not callable(part) else [part(np.mean([V[i] for i in f], 0)) for f in F]
    return M.add(V, F, parts, w, mh)


def tube(M, pts, r, segs, part, w, cap=True, up=None, rv=None, p=2.0):
    """simple tube through points with radius r (scalar or per point)"""
    pts = np.asarray(pts, float)
    n = len(pts)
    r = np.broadcast_to(np.asarray(r, float), (n,))
    rv = r if rv is None else np.broadcast_to(np.asarray(rv, float), (n,))
    T = nz(np.gradient(pts, axis=0))
    up = np.array([0, 0, 1.0]) if up is None else np.asarray(up, float)
    rings = []
    for i in range(n):
        u = np.cross(T[i], up)
        if np.linalg.norm(u) < 1e-6:
            u = np.cross(T[i], [1, 0, 0])
        u = nz(u)
        v = nz(np.cross(u, T[i]))
        rings.append(dict(c=pts[i], u=u, v=v, ru=r[i], rvp=rv[i], rvn=rv[i], p=p, part=part, w=w if isinstance(w, dict) else w[i]))
    return loft(M, rings, segs, 1, cap0=r[0] * .5 if cap else None, cap1=r[-1] * .5 if cap else None)


def box(M, c, axes, half, part, w, bevel=0.0):
    c = np.asarray(c, float)
    A = np.asarray(axes, float)
    s = np.array([[x, y, z] for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)], float) * half
    V = c + s @ A
    F = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return M.add(V, F, [part] * 6, w)


def strip_on_surface(M, pts, normals, width, thick, part, wfn, segs_w=1):
    """flat ribbon following pts (n,3) lying on a surface with given normals; width across, thickness outward"""
    pts = np.asarray(pts, float)
    N = nz(normals)
    T = nz(np.gradient(pts, axis=0))
    B = nz(np.cross(N, T))
    V = []
    for i in range(len(pts)):
        for s in (-1, 1):
            for t in (0, 1):
                V.append(pts[i] + B[i] * s * width / 2 + N[i] * (thick * t))
    F = []
    for i in range(len(pts) - 1):
        a = i * 4
        b = a + 4
        # vertex order per i: (-w,0) (-w,1) (+w,0) (+w,1)
        F += [(a + 1, b + 1, b + 3, a + 3), (a + 0, a + 2, b + 2, b + 0), (a + 0, b + 0, b + 1, a + 1), (a + 2, a + 3, b + 3, b + 2)]
    F += [(0, 1, 3, 2)]
    e = (len(pts) - 1) * 4
    F += [(e, e + 2, e + 3, e + 1)]
    W = [wfn(v) for v in V]
    return M.add(V, F, [part] * len(F), W)
