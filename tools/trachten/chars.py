"""Bursch, Madl and Kellnerin built around their rigs. J: joint positions from the rig (Blender axes)."""
import numpy as np
from geo import *

P = PARTS
LOD = {
    'hi': dict(limb=14, torso=22, sub=2, head=(26, 18), hand=10, mug=16, detail=2),
    'mid': dict(limb=8, torso=12, sub=1, head=(14, 10), hand=6, mug=9, detail=1),
    'lo': dict(limb=5, torso=8, sub=1, head=(8, 6), hand=4, mug=6, detail=0),
}
# grip geometry in the hand's canonical frame: f = hand direction, n = palm normal (toward the body), up
BAR = dict(f=0.074, n=0.027)          # handle bar through the fist
MUG = dict(n=0.096, r=0.056, base=-0.135, top=0.085)   # body centre offset from the bar, radius, base/top heights


def lerp(a, b, t):
    return np.asarray(a, float) * (1 - t) + np.asarray(b, float) * t


def wmix(*pairs):
    w = {}
    for b, x in pairs:
        if x > 1e-4:
            w[b] = w.get(b, 0) + x
    return w


# ------------------------------------------------------------------ torso
def torso_rings(spec, part_fn_z):
    rings = []
    for z, rx, yf, yb, yc, p, w in spec:
        rings.append(dict(c=[0, yc, z], u=[1, 0, 0], v=[0, -1, 0], ru=rx, rvp=yf, rvn=yb, p=p, w=w, part=part_fn_z(z)))
    return rings


def torso_surface(spec, z, a, off=0.0):
    """point on the torso surface at height z and angle a (a=pi/2 is the front)"""
    zs = [s[0] for s in spec]
    it = lambda k: np.interp(z, zs, [s[k] for s in spec])
    rx, yf, yb, yc, p = it(1), it(2), it(3), it(4), it(5)
    du, dv = superring(np.array([a]), rx + off, yf + off, yb + off, p)
    return np.array([du[0], yc - dv[0], z])


def torso_normal(spec, z, a):
    p0 = torso_surface(spec, z, a)
    pa = torso_surface(spec, z, a + 0.01)
    pz = torso_surface(spec, z + 0.005, a)
    n = np.cross(pa - p0, pz - p0)
    n = nz(n)
    zs = [s_[0] for s_ in spec]
    c = np.array([0, np.interp(z, zs, [s_[4] for s_ in spec]), z])
    if np.dot(n, p0 - c) < 0:
        n = -n
    return n


def strap(M, spec, pts_za, width, thick, part, wfn, lift=0.004):
    pts = np.array([torso_surface(spec, z, a, lift) for z, a in pts_za])
    nrm = np.array([torso_normal(spec, z, a) for z, a in pts_za])
    return strip_on_surface(M, pts, nrm, width, thick, part, wfn)


# ------------------------------------------------------------------ head
class Head:
    def __init__(s, c, ax, ayf, ayb, azu, azd, jaw=0.32, fem=False):
        s.c = np.asarray(c, float)
        s.ax, s.ayf, s.ayb, s.azu, s.azd, s.jaw, s.fem = ax, ayf, ayb, azu, azd, jaw, fem

    def dir(s, th, ph):
        # ph = 0 is the front (-y), +90 deg is the character's left (+x)
        return np.array([np.sin(th) * np.sin(ph), -np.sin(th) * np.cos(ph), np.cos(th)])

    def surf(s, th, ph, off=0.0):
        d = s.dir(th, ph)
        x = d[0] * s.ax
        y = d[1] * (s.ayf if d[1] < 0 else s.ayb)
        z = d[2] * (s.azu if d[2] > 0 else s.azd)
        dz, dy, dx = d[2], d[1], d[0]
        # jaw narrows towards the chin, the cheeks stay full
        if dz < 0:
            x *= 1 - s.jaw * smooth(0.05, 0.95, -dz)
        # under the jaw and the nape blend into the neck
        if dz < -0.15 and dy > -0.2:
            k = smooth(-0.15, -0.85, dz) * smooth(-0.2, 0.7, dy)
            y *= 1 - 0.38 * k
        # flatter face, slightly forward chin
        if dy < 0:
            y *= 1 - 0.06 * smooth(-0.4, -0.95, dy) * smooth(0.5, -0.2, dz)
            if dz < -0.55:
                y *= 1 + 0.06 * smooth(-0.55, -0.9, dz)
        # skull back is rounder
        if dy > 0 and dz > -0.2:
            y *= 1 + 0.03 * smooth(-0.2, 0.4, dz)
        p = np.array([x, y, z])
        r = np.linalg.norm(p)
        # small relief: brow ridge, eye sockets, cheekbones, temples
        g = lambda ph0, th0, sp: np.exp(-(((ph - ph0) / sp) ** 2 + ((th - th0) / sp) ** 2))
        d0 = np.radians
        rel = 0.0
        rel += 0.0035 * (g(d0(-20), d0(72), 0.22) + g(d0(20), d0(72), 0.22))
        rel -= 0.0045 * (g(d0(-24), d0(84), 0.13) + g(d0(24), d0(84), 0.13))
        rel += 0.003 * (g(d0(-42), d0(98), 0.2) + g(d0(42), d0(98), 0.2))
        rel -= 0.002 * (g(d0(-70), d0(70), 0.25) + g(d0(70), d0(70), 0.25))
        if dy >= 0 or abs(np.degrees(ph)) > 100:
            rel *= 0
        return s.c + p / r * (r + rel + off)

    def frame(s, th, ph):
        """outward normal, lateral (+x-ish) and up tangent at a surface point"""
        e = 0.004
        p = s.surf(th, ph)
        a = s.surf(th, ph + e) - s.surf(th, ph - e)
        b = s.surf(th - e, ph) - s.surf(th + e, ph)
        n = nz(np.cross(a, b))
        if np.dot(n, p - s.c) < 0:
            n = -n
        return p, n, nz(a), nz(b)

    def mesh(s, M, nth, nph, part, w, region=None, off_fn=None, part_fn=None):
        V = [s.surf(0, 0, off_fn(0, 0) if off_fn else 0)]
        for i in range(1, nth):
            th = np.pi * i / nth
            for j in range(nph):
                ph = 2 * np.pi * j / nph - np.pi
                V.append(s.surf(th, ph, off_fn(th, ph) if off_fn else 0))
        V.append(s.surf(np.pi, 0))
        F = []
        for j in range(nph):
            F.append((0, 1 + (j + 1) % nph, 1 + j))
        for i in range(nth - 2):
            for j in range(nph):
                a = 1 + i * nph + j
                b = 1 + i * nph + (j + 1) % nph
                F.append((a, b, b + nph, a + nph))
        last = len(V) - 1
        o = 1 + (nth - 2) * nph
        for j in range(nph):
            F.append((last, o + j, o + (j + 1) % nph))
        V = np.array(V)
        F = [tuple(reversed(f)) for f in F]   # outward winding
        parts = [part_fn(V[list(f)].mean(0)) if part_fn else part for f in F]
        return M.add(V, F, parts, w)

    def cap(s, M, nth, nph, hairline, off, part, w, inner=0.0):
        """hair shell: rows go from the crown down to hairline(ph) (theta), offset outward by off(th,ph); the last row tucks in"""
        rows = []
        for i in range(nth + 1):
            t = i / nth
            row = []
            for j in range(nph):
                ph = 2 * np.pi * j / nph - np.pi
                thm = hairline(ph)
                th = max(t * thm, 1e-3)
                o = off(th, ph) if i < nth else inner
                row.append(s.surf(th, ph, o))
            rows.append(row)
        # tuck: an extra row just inside the last one
        V = [s.surf(0, 0, off(0, 0))]
        for row in rows[1:]:
            V += row
        V = np.array(V)
        F = []
        for j in range(nph):
            F.append((0, 1 + (j + 1) % nph, 1 + j))
        for i in range(nth - 1):
            for j in range(nph):
                a = 1 + i * nph + j
                b = 1 + i * nph + (j + 1) % nph
                F.append((a, b, b + nph, a + nph))
        F = [tuple(reversed(f)) for f in F]   # outward winding
        return M.add(V, F, [part] * len(F), w)


def face(M, H, lod, fem, W):
    d = np.radians
    det = LOD[lod]['detail']
    # nose: bridge to tip to nostrils
    prot = 0.0145 if fem else 0.0175
    wid = 0.0105 if fem else 0.012
    rings = []
    for th, ru, pr in ((80, 0.0055, 0.002), (88, 0.0068, 0.35), (96, 0.0085, 0.75), (101.5, wid, 1.0), (105.5, wid * 0.92, 0.62)):
        p, n, a, b = H.frame(d(th), 0.0)
        rings.append(dict(c=p - n * 0.003, u=[1, 0, 0], v=n, ru=ru, rvp=0.003 + prot * pr if pr > 0.01 else 0.003, rvn=0.003, p=2.2, part=P['skin'], w=W))
    segs = 10 if det == 2 else (6 if det == 1 else 4)
    loft(M, rings, segs, 2 if det == 2 else 1, cap0=0.001, cap1=0.003)
    if det >= 1:
        # eyes: white almond + dark iris; brows
        for sgn in (-1, 1):
            p, n, a, b = H.frame(d(85), d(23) * sgn)
            lat = nz(np.cross(b, n)) * (1 if np.dot(np.cross(b, n), [1, 0, 0]) > 0 else -1)
            if det == 2:
                ellipsoid(M, p + n * 0.0006, [lat, n, b], [0.0135 if not fem else 0.013, 0.0045, 0.0068 if not fem else 0.0075], P['white'], W, 8, 5)
                ellipsoid(M, p + n * 0.0038, [lat, n, b], [0.0062, 0.0024, 0.0062], P['dark'], W, 8, 5)
            else:
                ellipsoid(M, p, [lat, n, b], [0.009, 0.004, 0.005], P['dark'], W, 5, 3)
            pb, nb, ab, bb = H.frame(d(75.5), d(23) * sgn)
            latb = nz(lat - bb * 0.16 * sgn)
            ellipsoid(M, pb + nb * 0.001, [latb, nb, nz(np.cross(nb, latb)) * (1 if sgn > 0 else -1)], [0.0155, 0.003, 0.0032 if not fem else 0.0024], P['hair'], W, 6 if det == 2 else 4, 3)
        # lips
        p, n, a, b = H.frame(d(114), 0.0)
        ellipsoid(M, p - n * 0.001, [[1, 0, 0], n, b], [0.0205 if not fem else 0.019, 0.0055, 0.0048 if not fem else 0.0062], P['lips'], W, 10 if det == 2 else 6, 4)
        # ears
        for sgn in (-1, 1):
            p, n, a, b = H.frame(d(94), d(92) * sgn)
            ellipsoid(M, p + n * 0.002 + np.array([0, 0.008, 0]), [n, [0, 1, 0], [0, 0, 1]], [0.008, 0.014, 0.027 if not fem else 0.024], P['skin'], W, 8 if det == 2 else 5, 5 if det == 2 else 3)


# ------------------------------------------------------------------ hands and mugs
def hand_frame(J, side):
    """rotation (3x3) mapping canonical hand axes (f, n, g=f x n) to rest axes, plus the wrist position"""
    s = 1 if side == 'L' else -1
    Wp = np.asarray(J['hand.' + side][0], float)
    d = nz(np.asarray(J['hand.' + side][1], float) - Wp)
    nr = np.array([-s, 0.0, 0.0])
    nr = nz(nr - d * np.dot(nr, d))
    f = np.array([0, -1.0, 0])
    n = np.array([-s, 0.0, 0])
    Rr = np.stack([d, nr, np.cross(d, nr)], 1)
    Rc = np.stack([f, n, np.cross(f, n)], 1)
    return Rr @ Rc.T, Wp, f, n


def to_rest(R, Wp, pts):
    return np.asarray(pts, float) @ R.T + Wp


def fist(M, J, side, lod, scale, w_hand, w_wrist):
    R, Wp, f, n = hand_frame(J, side)
    up = np.array([0, 0, 1.0])
    k = scale
    hs = LOD[lod]['hand']
    C = lambda F, N, U: (F * f + N * n + U * up) * k
    start = M.n
    if lod == 'lo':
        ellipsoid(M, C(0.05, 0.008, 0), [f, n, up], [0.055 * k, 0.022 * k, 0.042 * k], P['skin'], w_hand, 5, 4)
    else:
        rings = []
        for F_, ru, rv, w in ((-0.012, 0.026, 0.019, w_wrist), (0.03, 0.037, 0.018, w_hand), (0.062, 0.041, 0.017, w_hand), (0.082, 0.039, 0.0155, w_hand)):
            rings.append(dict(c=C(F_, 0.0, 0.0), u=up, v=n, ru=ru * k, rvp=rv * k, rvn=rv * k * 1.05, p=2.6, part=P['skin'], w=w))
        loft(M, rings, hs, 1, cap0=0.006 * k, cap1=0.006 * k)
        # curled fingers around the bar
        B = np.array([BAR['f'], BAR['n']])
        rad = 0.0195
        rings = []
        angs = np.radians(np.linspace(-62, 205, 7 if lod == 'hi' else 4))
        for i, a in enumerate(angs):
            cpt = C(B[0] + rad * np.cos(a), B[1] + rad * np.sin(a), -0.002)
            tdir = -np.sin(a) * f + np.cos(a) * n
            radial = np.cos(a) * f + np.sin(a) * n
            taper = 1 - 0.18 * i / (len(angs) - 1)
            rings.append(dict(c=cpt, u=up, v=radial, ru=0.037 * k * taper, rvp=0.0098 * k, rvn=0.0092 * k, p=3.2, part=P['skin'], w=w_hand))
        loft(M, rings, hs, 1, cap0=0.004 * k, cap1=0.006 * k)
        # thumb resting on top of the grip
        tp = [C(0.022, 0.012, 0.028), C(0.052, 0.022, 0.044), C(0.08, 0.028, 0.047)]
        tube(M, tp, np.array([0.0125, 0.0108, 0.0092]) * k, max(4, hs - 2), P['skin'], w_hand, up=n)
    M.transform(start, np.block([[R, Wp[:, None]], [np.zeros((1, 3)), np.ones((1, 1))]]))


def mug(M, J, side, lod, scale, w, place=None):
    """a Maß gripped by the hand of `side`; place: optional (angle, radius) to stand next to the gripped one (Kellnerin)"""
    R, Wp, f, n = hand_frame(J, side)
    up = np.array([0, 0, 1.0])
    k = scale
    seg = LOD[lod]['mug']
    Bc = BAR['f'] * f + BAR['n'] * n
    if place is None:
        cdir = n
        cen = Bc + n * MUG['n']
    else:
        ang, rr = place
        cdir = np.cos(ang) * n + np.sin(ang) * f
        cen = Bc + cdir * rr
    start = M.n
    r = MUG['r']
    b0, t0 = MUG['base'], MUG['top']
    H = t0 - b0
    mh = lambda z: (z - b0) / H
    u = nz(np.cross(up, cdir))
    rings = []
    for z, rr_ in ((b0, r * 0.94), (b0 + 0.006, r), (b0 + 0.06, r * 1.0), (t0 - 0.03, r * 0.985), (t0, r * 0.97)):
        rings.append(dict(c=cen + up * z, u=u, v=-cdir, ru=rr_, rvp=rr_, rvn=rr_, part=P['mug'], w=w))
    i0 = M.n
    loft(M, rings, seg, 1, cap0=None, cap1=None)
    # flat top and bottom as separate discs, so they shade with a hard edge
    for z, rr_, nrm in ((b0, r * 0.94, -1), (t0, r * 0.97, 1)):
        ang = np.arange(seg) / seg * 2 * np.pi
        ring = [cen + up * z + (np.cos(a) * u + np.sin(a) * cdir) * rr_ for a in ang]
        Vd = np.array([cen + up * z] + ring)
        Fd = [(0, 1 + (j + 1) % seg, 1 + j) if nrm > 0 else (0, 1 + j, 1 + (j + 1) % seg) for j in range(seg)]
        tst = np.cross(Vd[Fd[0][1]] - Vd[0], Vd[Fd[0][2]] - Vd[0])
        if np.dot(tst, up * nrm) < 0:
            Fd = [(a_, c_, b_) for a_, b_, c_ in Fd]
        M.add(Vd, Fd, [P['mug']] * seg, w)
    V = M.verts()
    for vi in range(i0, M.n):
        M.MH[vi] = float(np.clip(mh(np.dot(V[vi] - cen, up)), 0, 1))
    if lod != 'lo':
        # handle: bar through the fist, arms to the glass
        hb, ht = -0.07, 0.052
        near = cen - cdir * r * 0.92
        bar = [Bc + up * hb, Bc + up * (hb * 0.4), Bc + up * (ht * 0.4), Bc + up * ht]
        top = [Bc + up * ht, lerp(Bc + up * (ht + 0.012), near + up * (ht + 0.012), 0.5), near + up * (ht + 0.006)]
        bot = [Bc + up * hb, lerp(Bc + up * (hb - 0.012), near + up * (hb - 0.02), 0.5), near + up * (hb - 0.02)]
        hs = 6 if lod == 'hi' else 4
        for pts in (bar, top, bot):
            tube(M, pts, 0.0088, hs, P['handle'], w, up=cdir if pts is bar else up)
    M.transform(start, np.block([[R * k, Wp[:, None]], [np.zeros((1, 3)), np.ones((1, 1))]]))


def mug_info(J, side, scale):
    """base point and axis of the gripped mug in rest space (for checks)"""
    R, Wp, f, n = hand_frame(J, side)
    cen = (BAR['f'] * f + BAR['n'] * n + n * MUG['n']) * scale
    return R @ (cen + np.array([0, 0, MUG['base'] * scale])) + Wp, R @ np.array([0, 0, 1.0])


# ------------------------------------------------------------------ limbs
def bone_pt(J, b, t):
    h, tl = J[b]
    return lerp(h, tl, t)


def arm(M, J, side, lod, kind, sc):
    s = 1 if side == 'L' else -1
    q = LOD[lod]
    ua, fa = 'upperarm.' + side, 'forearm.' + side
    sh, hd = 'shoulder.' + side, 'hand.' + side
    lat = np.array([s, 0, 0.0])
    fwd = np.array([0, -1.0, 0])
    keys = []
    dU = nz(np.asarray(J[ua][1]) - np.asarray(J[ua][0]))
    top = np.asarray(J[ua][0]) - dU * 0.005 * sc + np.array([s * 0.0, 0, 0])
    # (point, rx, front, back, weights, part)
    sleeve = P['shirt'] if kind == 'Bursch' else P['skin']
    keys.append((top, 0.044, 0.046, 0.048, wmix((sh, 0.55), (ua, 0.45)), sleeve))
    keys.append((bone_pt(J, ua, 0.1), 0.056, 0.054, 0.056, wmix((sh, 0.3), (ua, 0.7)), sleeve))
    keys.append((bone_pt(J, ua, 0.32), 0.053, 0.05, 0.05, {ua: 1}, sleeve))
    keys.append((bone_pt(J, ua, 0.58), 0.047, 0.053, 0.046, {ua: 1}, sleeve))
    keys.append((bone_pt(J, ua, 0.86), 0.042, 0.043, 0.042, {ua: 1}, sleeve))
    if kind == 'Bursch':
        # rolled-up sleeve just below the elbow
        keys.append((bone_pt(J, fa, -0.02), 0.046, 0.047, 0.046, wmix((ua, 0.5), (fa, 0.5)), P['shirt']))
        keys.append((bone_pt(J, fa, 0.1), 0.05, 0.05, 0.05, {fa: 1}, P['shirt']))
        keys.append((bone_pt(J, fa, 0.16), 0.049, 0.049, 0.049, {fa: 1}, P['skin']))
        keys.append((bone_pt(J, fa, 0.17), 0.042, 0.043, 0.042, {fa: 1}, P['skin']))
    else:
        keys.append((bone_pt(J, fa, 0.0), 0.037, 0.037, 0.038, wmix((ua, 0.5), (fa, 0.5)), P['skin']))
        keys.append((bone_pt(J, fa, 0.17), 0.041, 0.042, 0.04, {fa: 1}, P['skin']))
    keys.append((bone_pt(J, fa, 0.45), 0.036, 0.035, 0.034, {fa: 1}, P['skin']))
    keys.append((bone_pt(J, fa, 0.8), 0.029, 0.026, 0.026, {fa: 1}, P['skin']))
    keys.append((bone_pt(J, fa, 1.03), 0.026, 0.02, 0.02, wmix((fa, 0.45), (hd, 0.55)), P['skin']))
    if lod == 'lo':
        keys = [keys[i] for i in (0, 1, 3, 5 if kind == 'Bursch' else 4, -3, -1)]
    rings = [dict(c=p, u=lat, v=fwd, ru=rx * sc, rvp=f * sc, rvn=b * sc, p=2.0, w=w, part=pt) for p, rx, f, b, w, pt in keys]
    loft(M, rings, q['limb'], q['sub'], cap0=0.014 * sc, cap1=0.004)


def leg(M, J, side, lod, kind, sc):
    s = 1 if side == 'L' else -1
    q = LOD[lod]
    th, sn, ft = 'thigh.' + side, 'shin.' + side, 'foot.' + side
    lat = np.array([s, 0, 0.0])
    fwd = np.array([0, -1.0, 0])
    if kind == 'Bursch':
        L, LD, SK, SO = P['leather'], P['ldetail'], P['skin'], P['socks']
        k = [(-0.14, .088, .084, .092, wmix(('hips', .6), (th, .4)), L), (0.06, .092, .088, .095, wmix(('hips', .25), (th, .75)), L),
             (0.4, .081, .08, .08, {th: 1}, L), (0.74, .071, .07, .068, {th: 1}, L), (0.8, .074, .073, .071, {th: 1}, LD),
             (0.87, .074, .073, .071, {th: 1}, SK), (0.875, .06, .058, .056, {th: 1}, SK),
             (1.0, .054, .056, .052, wmix((th, .5), (sn, .5)), SK)]
        k2 = [(0.08, .056, .054, .06, {sn: 1}, SK), (0.15, .061, .056, .066, {sn: 1}, SO), (0.2, .062, .056, .072, {sn: 1}, SO),
              (0.36, .059, .052, .074, {sn: 1}, SO), (0.6, .047, .044, .052, {sn: 1}, SO), (0.86, .036, .035, .037, {sn: 1}, SO),
              (1.03, .035, .036, .036, wmix((sn, .5), (ft, .5)), SO)]
    else:
        ST = P['white']
        k = [(-0.14, .09, .08, .1, wmix(('hips', .6), (th, .4)), ST), (0.06, .088, .08, .095, wmix(('hips', .25), (th, .75)), ST),
             (0.4, .074, .072, .074, {th: 1}, ST), (0.8, .058, .058, .056, {th: 1}, ST), (1.0, .05, .052, .048, wmix((th, .5), (sn, .5)), ST)]
        k2 = [(0.12, .052, .05, .056, {sn: 1}, ST), (0.33, .054, .048, .066, {sn: 1}, ST), (0.6, .043, .04, .046, {sn: 1}, ST),
              (0.86, .032, .031, .032, {sn: 1}, ST), (1.03, .031, .032, .032, wmix((sn, .5), (ft, .5)), ST)]
    keys = [(bone_pt(J, th, t),) + r[1:] for r in k for t in [r[0]]] + [(bone_pt(J, sn, t),) + r[1:] for r in k2 for t in [r[0]]]
    if lod == 'lo':
        keep = [0, 2, 4, 7, 9, 11, 14] if kind == 'Bursch' else [0, 2, 4, 6, 7, 9]
        keys = [keys[i] for i in keep if i < len(keys)]
    rings = [dict(c=p, u=lat, v=fwd, ru=rx * sc, rvp=f * sc, rvn=b * sc, p=2.0, w=w, part=pt) for p, rx, f, b, w, pt in keys]

    def wfn(pt, t, w):
        # inner thigh near the crotch also follows the pelvis
        return w
    loft(M, rings, q['limb'], q['sub'], cap0=0.03 * sc, cap1=None, weights=wfn)


def shoe(M, J, side, lod, kind, sc):
    q = LOD[lod]
    ft, sn = 'foot.' + side, 'shin.' + side
    a = np.asarray(J[ft][0], float)
    x = a[0]
    L = sc
    # (y offset from the ankle, half width, height above, depth below, centre z)
    if kind == 'Bursch':
        spec = [(0.065, .026, .03, .035, .045), (0.05, .04, .05, .04, .05), (0.012, .046, .07, .045, .052), (-0.04, .049, .05, .045, .048),
                (-0.095, .051, .034, .04, .04), (-0.145, .043, .026, .034, .035), (-0.172, .022, .016, .022, .032)]
    else:
        spec = [(0.058, .022, .026, .03, .038), (0.045, .034, .04, .035, .042), (0.01, .038, .05, .038, .045), (-0.035, .041, .035, .036, .038),
                (-0.085, .043, .025, .033, .033), (-0.128, .036, .02, .028, .03), (-0.152, .018, .013, .018, .028)]
    if lod == 'lo':
        spec = [spec[i] for i in (0, 2, 4, 6)]
    rings = []
    for dy, hw, hu, hd, zc in spec:
        rings.append(dict(c=[x, a[1] + dy * L, zc * L], u=[1, 0, 0], v=[0, 0, 1], ru=hw * L, rvp=hu * L, rvn=hd * L, p=2.8, part=P['shoes'], w={ft: 1}))

    def wfn(pt, t, w):
        k = smooth(0.08 * L, 0.12 * L, pt[2])
        return wmix((ft, 1 - 0.6 * k), (sn, 0.6 * k))
    loft(M, rings, max(6, q['limb']), q['sub'], cap0=0.01, cap1=0.006, weights=wfn)


# ------------------------------------------------------------------ characters
def head_for(J, kind):
    zHd = J['head'][0][2]
    if kind == 'Bursch':
        return Head([0, 0.006, zHd + 0.116], 0.081, 0.098, 0.105, 0.124, 0.127, jaw=0.22)
    return Head([0, 0.006, zHd + 0.108], 0.074, 0.091, 0.097, 0.114, 0.117, jaw=0.27, fem=True)


def lips_point(J, kind):
    H = head_for(J, kind)
    p, n, a, b = H.frame(np.radians(113), 0.0)
    return p + n * 0.006


def build(J, kind, lod):
    fem = kind != 'Bursch'
    q = LOD[lod]
    det = q['detail']
    M = Mesh()
    zH = J['hips'][0][2]
    zC = J['chest'][0][2]
    zN = J['neck'][0][2]
    zHd = J['head'][0][2]
    zTop = J['head'][1][2]
    sc = (zTop - 0.0) / 1.80   # 1.0 for the Bursch

    def tw(z):  # torso weights by height
        if z < zH + 0.04:
            return {'hips': 1}
        if z < zH + 0.16:
            t = smooth(zH + 0.04, zH + 0.16, z)
            return wmix(('hips', 1 - t), ('spine', t))
        if z < zC - 0.02:
            return {'spine': 1}
        if z < zC + 0.07:
            t = smooth(zC - 0.02, zC + 0.07, z)
            return wmix(('spine', 1 - t), ('chest', t))
        if z < zN - 0.03:
            return {'chest': 1}
        t = smooth(zN - 0.03, zN + 0.02, z)
        return wmix(('chest', 1 - t), ('neck', t))

    shz = J['upperarm.L'][0][2]

    def tweights(pt, t, w):
        z = pt[2]
        w = tw(z)
        ax = abs(pt[0])
        k = smooth(shz - 0.09, shz - 0.01, z) * smooth(0.07, 0.15, ax) * 0.75
        if k > 0:
            side = 'L' if pt[0] > 0 else 'R'
            w = {b: x * (1 - k) for b, x in w.items()}
            w['shoulder.' + side] = w.get('shoulder.' + side, 0) + k
        # buttocks and crotch follow the thighs a little
        kl = smooth(zH - 0.03, zH - 0.12, z) * smooth(0.0, 0.07, ax) * 0.45
        if kl > 0:
            side = 'L' if pt[0] > 0 else 'R'
            w = {b: x * (1 - kl) for b, x in w.items()}
            w['thigh.' + side] = w.get('thigh.' + side, 0) + kl
        return w

    if kind == 'Bursch':
        spec = [  # z, rx, front, back, ycentre, p
            (zH - 0.135, .118, .07, .082, .01, 2.2), (zH - 0.07, .162, .088, .112, .008, 2.4), (zH, .171, .094, .115, .005, 2.4),
            (zH + 0.06, .162, .099, .1, .0, 2.4), (zH + 0.065, .158, .1, .098, .0, 2.4), (zH + 0.13, .152, .108, .09, .0, 2.4),
            (zH + 0.21, .155, .108, .09, .0, 2.4), (zC - 0.06, .163, .113, .094, .0, 2.4), (zC, .174, .118, .1, .0, 2.4),
            (zC + 0.06, .182, .112, .103, .002, 2.5), (shz, .178, .096, .096, .004, 2.6), (shz + 0.03, .158, .08, .084, .006, 2.5),
            (shz + 0.052, .11, .062, .068, .007, 2.3), (zN + 0.012, .07, .053, .058, .008, 2.0)]
        waist = zH + 0.0625

        def tpart(z):
            return P['leather'] if z < waist else P['shirt']
    else:
        spec = [
            (zH - 0.13, .125, .07, .09, .01, 2.2), (zH - 0.06, .168, .085, .115, .008, 2.4), (zH, .172, .09, .112, .005, 2.4),
            (zH + 0.07, .145, .085, .09, .0, 2.3), (zH + 0.11, .127, .08, .08, .0, 2.3), (zH + 0.17, .131, .088, .08, .0, 2.3),
            (zC - 0.08, .142, .1, .084, .0, 2.3), (zC - 0.03, .149, .124, .087, .0, 2.3), (zC + 0.02, .151, .126, .088, .0, 2.3),
            (zC + 0.065, .153, .1, .09, .002, 2.4), (shz, .15, .08, .084, .004, 2.5), (shz + 0.026, .13, .068, .072, .006, 2.4),
            (shz + 0.046, .092, .054, .06, .007, 2.2), (zN + 0.01, .057, .045, .05, .008, 2.0)]
        spec = [(z, rx, f, b, y, p) for z, rx, f, b, y, p in spec]
        neckline_front = zC + 0.035

        def tpart(z):
            return P['dirndl']
    spec = [(z, rx * sc if kind == 'Bursch' else rx, f, b, y, p) for z, rx, f, b, y, p in spec]
    rings = torso_rings([(z, rx, f, b, y, p, tw(z)) for z, rx, f, b, y, p in spec], tpart)
    if lod == 'lo':
        rings = rings[::2] + ([rings[-1]] if (len(rings) - 1) % 2 else [])
    if fem:
        def pfn(i, j, c):
            z = c[2]
            a = np.arctan2(-c[1], c[0])  # front = +pi/2
            da = abs(a - np.pi / 2)
            nl = neckline_front + (zC + 0.045 - neckline_front) * smooth(np.radians(30), np.radians(62), da)
            if da < np.radians(62):
                neck = nl
                if z < neck - 0.012:
                    return P['dirndl']
                if z < neck:
                    return P['trim']
                if da < np.radians(40) and z > neck + 0.012:
                    return P['skin']
                return P['shirt'] if z < zN - 0.012 else P['skin']
            if False:
                if z < neckline_front - 0.012:
                    return P['dirndl']
                if z < neckline_front:
                    return P['trim']
                if z < neckline_front + 0.012:
                    return P['shirt']
                return P['skin']
            if z < zC + 0.055:
                return P['dirndl'] if z < zC + 0.045 else P['trim']
            if z > zN - 0.012:
                return P['skin']
            return P['shirt']
    else:
        pfn = None
    loft(M, rings, q['torso'], q['sub'], cap0=0.02, cap1=None, weights=tweights, part_fn=pfn)

    # neck
    nb = np.array([0, 0.01, zN - 0.02])
    nt = np.array([0, 0.012, zHd + 0.05])
    nr = 0.054 if kind == 'Bursch' else 0.044
    rings = [dict(c=nb, u=[1, 0, 0], v=[0, -1, 0], ru=nr * 1.12, rvp=nr, rvn=nr * 1.05, w=wmix(('chest', .4), ('neck', .6)), part=P['skin']),
             dict(c=lerp(nb, nt, .5), u=[1, 0, 0], v=[0, -1, 0], ru=nr * 0.98, rvp=nr * .92, rvn=nr, w={'neck': 1}, part=P['skin']),
             dict(c=nt, u=[1, 0, 0], v=[0, -1, 0], ru=nr * 0.95, rvp=nr * .85, rvn=nr * .95, w=wmix(('neck', .4), ('head', .6)), part=P['skin'])]
    loft(M, rings, max(6, q['limb']), 1, cap0=None, cap1=None)
    if kind == 'Bursch' and det >= 1:
        # shirt collar
        cz = zN - 0.005
        rings = [dict(c=[0, 0.01, cz - 0.012], u=[1, 0, 0], v=[0, -1, 0], ru=nr * 1.3, rvp=nr * 1.2, rvn=nr * 1.2, w=wmix(('chest', .6), ('neck', .4)), part=P['shirt']),
                 dict(c=[0, 0.01, cz + 0.022], u=[1, 0, 0], v=[0, -1, 0], ru=nr * 1.18, rvp=nr * 1.12, rvn=nr * 1.1, w={'neck': 1}, part=P['shirt'])]
        loft(M, rings, q['torso'], 1, cap0=None, cap1=None)

    # head
    H = head_for(J, kind)
    WH = {'head': 1}
    H.mesh(M, q['head'][1], q['head'][0], P['skin'], WH)
    face(M, H, lod, fem, WH)
    d = np.radians
    if kind == 'Bursch':
        def hairline(ph):
            a = abs(np.degrees(ph))
            return d(np.interp(a, [0, 30, 60, 85, 110, 140, 180], [56, 58, 70, 84, 96, 112, 116]))
        H.cap(M, max(4, q['head'][1] // 2), q['head'][0], hairline, lambda th, ph: 0.007 + 0.006 * smooth(1.2, 0.2, th), P['hair'], WH, inner=0.0)
    else:
        def hairline(ph):
            a = abs(np.degrees(ph))
            return d(np.interp(a, [0, 25, 50, 80, 100, 130, 180], [54, 57, 72, 98, 104, 118, 124]))
        H.cap(M, max(4, q['head'][1] // 2), q['head'][0], hairline, lambda th, ph: 0.006 + 0.009 * smooth(1.3, 0.2, th), P['hair'], WH, inner=0.0)
        # bun and a braid wrapped around it
        bp = H.surf(d(62), d(180), 0.02)
        ellipsoid(M, bp, np.eye(3), [0.045, 0.04, 0.042], P['hair'], WH, max(6, q['head'][0] // 2), max(4, q['head'][1] // 3))
        if det >= 1:
            # flower pinned at the side
            fp = H.surf(d(52), d(55), 0.014)
            ellipsoid(M, fp, np.eye(3), [0.017, 0.017, 0.017], P['trim'], WH, 7, 4)
    if kind == 'Bursch':
        # Tirolerhut: crown, brim, band, Gamsbart (only drawn when the hat flag is on)
        hz = H.c[2] + H.azu * 0.5
        cy = H.c[1] + 0.002
        crown = [(hz - 0.006, .086, .1), (hz + 0.02, .085, .098), (hz + 0.06, .077, .089), (hz + 0.095, .06, .069), (hz + 0.103, .043, .052)]
        rings = [dict(c=[0, cy, z], u=[1, 0, 0], v=[0, -1, 0], ru=rx, rvp=ry, rvn=ry, p=2.3, w=WH, part=P['felt']) for z, rx, ry in crown]
        loft(M, rings, q['torso'], 1, cap0=None, cap1=0.006)
        brim = [(hz - 0.004, .085, .099), (hz - 0.01, .145, .16), (hz - 0.002, .15, .165), (hz + 0.002, .086, .1)]

        def bw(a):
            return 1.0
        rings = [dict(c=[0, cy, z], u=[1, 0, 0], v=[0, -1, 0], ru=rx, rvp=ry, rvn=ry, p=2.1, w=WH, part=P['felt']) for z, rx, ry in brim]
        i0 = M.n
        loft(M, rings, q['torso'], 1, cap0=None, cap1=None)
        V = M.verts()
        for vi in range(i0, M.n):  # brim turns up at the back and sides
            v = V[vi]
            r = np.hypot(v[0] / 0.145, (v[1] - cy) / 0.16)
            if r > 0.75:
                up = 0.022 * smooth(0.0, 1.0, (v[1] - cy) / 0.16 + 0.3) + 0.012 * abs(v[0]) / 0.145
                V[vi][2] += up * smooth(0.75, 1.0, r)
        M.V = [V]
        rings = [dict(c=[0, cy, z], u=[1, 0, 0], v=[0, -1, 0], ru=rx * 1.03, rvp=ry * 1.03, rvn=ry * 1.03, p=2.3, w=WH, part=P['hatband']) for z, rx, ry in crown[:2]]
        loft(M, rings, q['torso'], 1, cap0=None, cap1=None)
        if det >= 1:
            gp = np.array([0.071, cy + 0.052, hz + 0.03])
            ellipsoid(M, gp, np.eye(3), [0.018, 0.018, 0.045], P['gamsbart'], WH, 7, 5)
            ellipsoid(M, gp - np.array([0, 0, 0.035]), np.eye(3), [0.012, 0.012, 0.01], P['hatband'], WH, 6, 3)

    # arms and hands
    for side in ('L', 'R'):
        arm(M, J, side, lod, kind if kind == 'Bursch' else 'Madl', sc)
        leg(M, J, side, lod, kind if kind == 'Bursch' else 'Madl', sc)
        shoe(M, J, side, lod, kind if kind == 'Bursch' else 'Madl', sc)
        hd, fa = 'hand.' + side, 'forearm.' + side
        fist(M, J, side, lod, 0.98 * sc if kind == 'Bursch' else 0.9, {hd: 1}, wmix((fa, .5), (hd, .5)))
    mscale = 1.0
    if kind == 'Kellnerin':
        n = 5 if lod != 'lo' else 3
        angs = np.radians([-28, 30, 88, 146, 204]) if n == 5 else np.radians([0, 88, 176])
        for side in ('L', 'R'):
            for a in angs:
                mug(M, J, side, lod, mscale, {'hand.' + side: 1}, place=(a, 0.118))
    else:
        mug(M, J, 'R', lod, mscale, {'hand.R': 1})

    # clothing details
    WT = lambda pt: tweights(pt, 0, None)
    if kind == 'Bursch':
        # Hosenträger: two straps up the front, over the shoulders, crossing on the back
        if det >= 1:
            for s in (-1, 1):
                fr = [(zH + 0.055, np.pi / 2 - s * 0.55), (zH + 0.2, np.pi / 2 - s * 0.6), (zC, np.pi / 2 - s * 0.62), (zC + 0.08, np.pi / 2 - s * 0.66),
                      (shz + 0.03, np.pi / 2 - s * 0.9), (shz + 0.03, -np.pi / 2 + s * 0.85), (zC + 0.06, -np.pi / 2 + s * 0.45), (zC - 0.05, -np.pi / 2 - s * 0.12),
                      (zH + 0.15, -np.pi / 2 - s * 0.42), (zH + 0.055, -np.pi / 2 - s * 0.5)]
                if det == 1:
                    fr = fr[::2] + [fr[-1]]
                strap(M, spec, fr, 0.036, 0.005, P['leather'], WT)
            # Brustlatz between the straps
            zz = zC - 0.035
            pts = [(zz, a) for a in np.linspace(np.pi / 2 - 0.62, np.pi / 2 + 0.62, 7 if det == 2 else 3)]
            strap(M, spec, pts, 0.05, 0.007, P['ldetail'], WT, lift=0.007)
            # Hosentürl
            pts = [(z, np.pi / 2) for z in np.linspace(zH - 0.1, zH + 0.05, 4)]
            strap(M, spec, pts, 0.16, 0.004, P['ldetail'], WT, lift=0.002)
        if det == 2:
            for a in (np.pi / 2 - 0.5, np.pi / 2 + 0.5):
                p = torso_surface(spec, zC - 0.035, a, 0.014)
                ellipsoid(M, p, np.eye(3), [0.009, 0.009, 0.009], P['silver'], WT(p), 6, 4)
            for a in (np.pi / 2 - 0.35, np.pi / 2 + 0.35):
                p = torso_surface(spec, zH + 0.035, a, 0.008)
                ellipsoid(M, p, np.eye(3), [0.008, 0.008, 0.008], P['silver'], WT(p), 6, 4)
    else:
        # skirt (with an inner shell so it has thickness), apron, waistband with bow, buttons, Kropfband, puff sleeves
        hem = 0.4 if kind == 'Madl' else 0.36
        sk = [(zH + 0.075, .152, .092, .097), (zH + 0.03, .182, .11, .13), (zH - 0.06, .215, .16, .175), (zH - 0.2, .245, .205, .21),
              (zH - 0.36, .262, .225, .228), (hem + 0.03, .268, .232, .234), (hem, .27, .234, .236)]
        if lod == 'lo':
            sk = [sk[i] for i in (0, 2, 4, 6)]

        def skw(pt, t, w):
            z = pt[2]
            k = smooth(zH + 0.06, hem, z)
            f = min(1.0, max(0.0, -pt[1]) / 0.22) ** 0.8
            th = k * 0.28 * (1 - f) + f * smooth(0.0, 0.4, k) * (1 - 0.85 * smooth(0.5, 0.95, k))
            sh = f * 0.85 * smooth(0.5, 0.95, k)
            sL = smooth(-0.09, 0.09, pt[0])
            return wmix(('hips', 1 - th - sh), ('thigh.L', th * sL), ('thigh.R', th * (1 - sL)), ('shin.L', sh * sL), ('shin.R', sh * (1 - sL)))
        rings = [dict(c=[0, 0.005, z], u=[1, 0, 0], v=[0, -1, 0], ru=rx, rvp=f, rvn=b, p=2.1, w={'hips': 1},
                      part=P['trim'] if (i == len(sk) - 2) else P['dirndl']) for i, (z, rx, f, b) in enumerate(sk)]
        loft(M, rings, q['torso'] + 4 if lod != 'lo' else q['torso'], q['sub'], cap0=None, cap1=None, weights=skw)
        rings_in = [dict(r, ru=r['ru'] - 0.006, rvp=r['rvp'] - 0.006, rvn=r['rvn'] - 0.006, part=P['dirndl']) for r in rings]
        loft(M, rings_in, q['torso'] + 4 if lod != 'lo' else q['torso'], q['sub'], cap0=None, cap1=None, weights=skw, inner=True)
        if det >= 1:
            # apron: a panel over the front of the skirt
            na, nzz = (9, 7) if det == 2 else (4, 3)
            zs = np.linspace(zH + 0.06, hem + 0.05, nzz)
            angs = np.linspace(np.pi / 2 - 0.85, np.pi / 2 + 0.85, na)
            Vp = []
            for z in zs:
                for a in angs:
                    zi = [s[0] for s in sk][::-1]
                    it = lambda k: np.interp(z, zi, [s[k] for s in sk][::-1])
                    du, dv = superring(np.array([a]), it(1) + 0.007, it(2) + 0.007, it(3) + 0.007, 2.1)
                    Vp.append([du[0], 0.005 - dv[0], z])
            F = []
            for i in range(nzz - 1):
                for j in range(na - 1):
                    a_, b_ = i * na + j, i * na + j + 1
                    F.append((a_, a_ + na, b_ + na, b_))
            # winding: check outward
            Vp = np.array(Vp)
            f0 = F[0]
            nrm = np.cross(Vp[f0[1]] - Vp[f0[0]], Vp[f0[2]] - Vp[f0[0]])
            if np.dot(nrm, [0, -1, 0]) < 0:
                F = [tuple(reversed(f)) for f in F]
            M.add(Vp, F, [P['apron']] * len(F), [skw(v, 0, None) for v in Vp])
            # waistband
            rings = [dict(c=[0, 0.003, zH + z], u=[1, 0, 0], v=[0, -1, 0], ru=rx, rvp=f, rvn=b, p=2.3, w={'hips': 1}, part=P['apron'])
                     for z, rx, f, b in ((0.055, .153, .093, .095), (0.082, .14, .09, .09))]
            loft(M, rings, q['torso'], 1, cap0=None, cap1=None)
            # bow on the left (tied on the left)
            bp = np.array([0.075, -0.088, zH + 0.07])
            WB = {'hips': 1}
            ellipsoid(M, bp, np.eye(3), [0.014, 0.012, 0.012], P['apron'], WB, 6, 4)
            if det == 2:
                for s in (-1, 1):
                    ellipsoid(M, bp + np.array([s * 0.028, -0.004, 0.006]), np.eye(3), [0.026, 0.01, 0.016], P['apron'], WB, 7, 4)
                for s in (-1, 1):
                    tube(M, [bp, bp + np.array([s * 0.012, -0.006, -0.05]), bp + np.array([s * 0.02, -0.004, -0.12])], 0.009, 4, P['apron'], WB, up=[0, -1, 0], rv=0.003)
            # Kropfband
            kz = zN + 0.03
            rings = [dict(c=[0, 0.011, kz + dz], u=[1, 0, 0], v=[0, -1, 0], ru=nr * 0.98 + 0.003, rvp=nr * 0.9 + 0.003, rvn=nr * 0.98 + 0.003, w={'neck': 1}, part=P['dark'])
                     for dz in (-0.008, 0.008)]
            loft(M, rings, max(6, q['limb']), 1, cap0=None, cap1=None)
            ellipsoid(M, [0, 0.011 - nr * 0.9 - 0.006, kz - 0.016], np.eye(3), [0.009, 0.004, 0.012], P['silver'], {'neck': 1}, 6, 4)
            # puff sleeves
            for side in ('L', 'R'):
                s = 1 if side == 'L' else -1
                c = bone_pt(J, 'upperarm.' + side, 0.12) + np.array([s * 0.004, 0, 0.004])
                dU = nz(np.asarray(J['upperarm.' + side][1]) - np.asarray(J['upperarm.' + side][0]))
                lat = nz(np.cross(dU, [0, 1, 0])) * s
                ellipsoid(M, c, [lat, [0, -1, 0], -dU], [0.071, 0.07, 0.083], P['shirt'], wmix(('shoulder.' + side, .4), ('upperarm.' + side, .6)),
                          10 if det == 2 else 6, 7 if det == 2 else 4)
        if det == 2:
            for i in range(5):
                z = zH + 0.12 + i * 0.03
                p = torso_surface(spec, z, np.pi / 2, 0.004)
                ellipsoid(M, p, np.eye(3), [0.006, 0.006, 0.006], P['silver'], WT(p), 6, 4)
        if kind == 'Kellnerin' and det >= 1:
            # money pouch on the waistband
            bp = np.array([-0.15, -0.035, zH + 0.02])
            box(M, bp, np.eye(3), np.array([0.025, 0.045, 0.055]), P['leather'], {'hips': 1})
    return M


def norm_weights(w, maxinf=4):
    items = sorted(((b, x) for b, x in w.items() if x > 1e-4), key=lambda t: -t[1])[:maxinf]
    s = sum(x for _, x in items) or 1
    return [(b, x / s) for b, x in items]
