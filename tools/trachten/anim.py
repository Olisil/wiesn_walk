"""Procedural animation for the Trachten rigs: forward kinematics in rest axes plus two-bone IK for arms and legs.
A pose is {bone: Quaternion (rotation about the bone head, in the armature's rest axes)} plus a root offset.
Skin transform S_b = S_parent @ T(h_b) Q_b T(-h_b); that is what the game's bone texture stores."""
import math
import numpy as np
from mathutils import Matrix, Vector, Quaternion
import chars

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
ORDER = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder.L', 'upperarm.L', 'forearm.L', 'hand.L', 'shoulder.R', 'upperarm.R',
         'forearm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R']
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'shoulder.L': 'chest', 'upperarm.L': 'shoulder.L',
          'forearm.L': 'upperarm.L', 'hand.L': 'forearm.L', 'shoulder.R': 'chest', 'upperarm.R': 'shoulder.R', 'forearm.R': 'upperarm.R',
          'hand.R': 'forearm.R', 'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L', 'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R'}


def R(axis, deg):
    return Quaternion(axis, math.radians(deg))


def qmul(*qs):
    q = Quaternion()
    for x in qs:
        q = q @ x
    return q


def sm(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def cyc(t, n, k=1, ph=0.0):
    return math.sin(2 * math.pi * (k * t / n + ph))


class Rig:
    def __init__(self, J, kind):
        self.J = J
        self.kind = kind
        self.h = {b: Vector(J[b][0]) for b in ORDER}
        self.t = {b: Vector(J[b][1]) for b in ORDER}
        self.lips = Vector(chars.lips_point(J, kind))
        fem = kind != 'Bursch'
        self.stride = 1.05 if fem else 1.15

    def solve(self, Q, off=Vector()):
        S = {}
        for b in ORDER:
            q = Q.get(b, Quaternion())
            h = self.h[b]
            L = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h)
            p = PARENT[b]
            S[b] = (S[p] if p else Matrix.Translation(off)) @ L
        return S

    def pos(self, S, b, tail=False):
        return S[b] @ (self.t[b] if tail else self.h[b])


class Pose:
    def __init__(self, rig):
        self.rig = rig
        self.Q = {}
        self.off = Vector()

    def rot(self, b, *qs):
        self.Q[b] = qmul(self.Q.get(b, Quaternion()), *qs)
        return self

    def S(self):
        return self.rig.solve(self.Q, self.off)

    # ---- two bone IK: places the end joint of (a, b) at world target W, bending towards pole
    def ik(self, a, b, W, pole, end_rot=None, end=None, twist_share=0.5):
        rig = self.rig
        self.Q[a] = Quaternion()
        self.Q[b] = Quaternion()
        S = self.S()
        Ps = rig.pos(S, a)
        L1 = (rig.t[a] - rig.h[a]).length
        L2 = (rig.t[b] - rig.h[b]).length
        D = Vector(W) - Ps
        d = max(min(D.length, L1 + L2 - 1e-4), abs(L1 - L2) + 1e-4)
        w = D.normalized()
        pd = Vector(pole) - Ps
        p = pd - w * pd.dot(w)
        if p.length < 1e-6:
            p = w.orthogonal()
        p.normalize()
        ca = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
        al = math.acos(max(-1, min(1, ca)))
        E = Ps + (w * math.cos(al) + p * math.sin(al)) * L1
        Wc = Ps + w * d
        par = PARENT[a]
        Rp = S[par].to_3x3() if par else Matrix.Identity(3)
        a0 = rig.t[a] - rig.h[a]
        self.Q[a] = a0.rotation_difference(Rp.inverted() @ (E - Ps))
        S = self.S()
        Ra = S[a].to_3x3()
        b0 = rig.t[b] - rig.h[b]
        self.Q[b] = b0.rotation_difference(Ra.inverted() @ (Wc - E))
        if end_rot is not None and end is not None:
            S = self.S()
            Rb = S[b].to_3x3()
            qe = (Rb.inverted() @ end_rot).to_quaternion()
            # move part of the end bone's twist into b, so the wrist does not candy-wrap
            ax = b0.normalized()
            sw, tw_ang = swing_twist(qe, ax)
            if twist_share:
                tq = Quaternion(ax, tw_ang * twist_share)
                self.Q[b] = self.Q[b] @ tq
                S = self.S()
                Rb = S[b].to_3x3()
                qe = (Rb.inverted() @ end_rot).to_quaternion()
            self.Q[end] = qe
        return E

    def set_world_rot(self, b, Rw):
        """set bone b so that its skin rotation equals Rw (3x3)"""
        S = self.S()
        par = PARENT[b]
        Rp = S[par].to_3x3() if par else Matrix.Identity(3)
        self.Q[b] = (Rp.inverted() @ Rw).to_quaternion()


def swing_twist(q, axis):
    v = Vector((q.x, q.y, q.z))
    proj = axis * v.dot(axis)
    t = Quaternion((q.w, proj.x, proj.y, proj.z))
    if t.magnitude < 1e-9:
        return q, 0.0
    t.normalize()
    ang = 2 * math.atan2(Vector((t.x, t.y, t.z)).dot(axis), t.w)
    return q, ang


# ------------------------------------------------------------------ hand orientation and mug placement
def hand_rest_to_canon(rig, side):
    Rm, Wp, f, n = chars.hand_frame(rig.J, side)
    return Matrix([list(r) for r in Rm]).transposed()   # rest -> canonical


def hand_rot(rig, side, G):
    """world skin rotation for the hand: canonical (hand forward, palm to the body, mug upright) then G"""
    return G @ hand_rest_to_canon(rig, side)


def mug_point(rig, side, local):
    """point in the canonical hand frame (f, n, up components) -> offset from the wrist (unrotated canonical axes)"""
    s = 1 if side == 'L' else -1
    f, n, u = local
    return Vector((0, -1, 0)) * f + Vector((-s, 0, 0)) * n + Z * u


def rim_local(side, toward=Vector((0, 1, 0))):
    """rim point of the gripped mug nearest `toward` (canonical axes), as an offset from the wrist"""
    s = 1 if side == 'L' else -1
    B = Vector((0, -1, 0)) * chars.BAR['f'] + Vector((-s, 0, 0)) * chars.BAR['n']
    C = B + Vector((-s, 0, 0)) * chars.MUG['n'] + Z * chars.MUG['top']
    return C + toward.normalized() * chars.MUG['r'] * 0.92


def chest_frame(S):
    return S['chest']


def yaw_of(M3):
    f = M3 @ Vector((0, -1, 0))
    return math.atan2(f.x, -f.y)


# ------------------------------------------------------------------ building blocks
def legs_planted(P, feet, knee_pole=Vector((0, -1, 0.1)), foot_rot=None):
    for side, A in feet.items():
        Rw = foot_rot[side] if foot_rot and side in foot_rot else Matrix.Identity(3)
        P.ik('thigh.' + side, 'shin.' + side, A, P.rig.h['thigh.' + side] + knee_pole * 1.0 + Vector((0, -0.3, 0)), Rw, 'foot.' + side, twist_share=0)


def arm_to(P, side, W, G, pole=None, twist=0.5):
    s = 1 if side == 'L' else -1
    pole = pole if pole is not None else Vector((s * 0.6, 0.5, -0.6))
    P.ik('upperarm.' + side, 'forearm.' + side, W, P.rig.pos(P.S(), 'upperarm.' + side) + Vector(pole), hand_rot(P.rig, side, G), 'hand.' + side, twist)


def arm_relaxed(P, side, swing=0.0, bend=12.0, out=4.0):
    s = 1 if side == 'L' else -1
    P.Q['upperarm.' + side] = qmul(R(Y, -out * s), R(X, swing))
    P.Q['forearm.' + side] = R(X, -bend)
    P.Q['hand.' + side] = R(X, -8)


def spine_chain(P, lean=0.0, roll=0.0, yaw=0.0, head_pitch=0.0, head_yaw=0.0, head_roll=0.0, keep_head=True):
    P.rot('spine', R(X, lean * 0.55), R(Y, roll * 0.5), R(Z, yaw * 0.5))
    P.rot('chest', R(X, lean * 0.45), R(Y, roll * 0.5), R(Z, yaw * 0.5))
    hy = (-yaw if keep_head else 0) + head_yaw
    hp = (-lean * 0.7 if keep_head else 0) + head_pitch
    hr = (-roll * 0.6 if keep_head else 0) + head_roll
    P.rot('neck', R(X, hp * 0.4), R(Z, hy * 0.4), R(Y, hr * 0.4))
    P.rot('head', R(X, hp * 0.6), R(Z, hy * 0.6), R(Y, hr * 0.6))


# ------------------------------------------------------------------ gait
class Gait:
    def __init__(self, rig):
        self.rig = rig
        fem = rig.kind != 'Bursch'
        self.S = rig.stride
        self.stance = 0.6
        self.front = -self.S * 0.27
        self.ax = {'L': rig.h['foot.L'], 'R': rig.h['foot.R']}
        self.heel = 0.05 if not fem else 0.045
        self.ball = -0.1 if not fem else -0.085
        self.bob = 0.045 if not fem else 0.04

    def stance_ankle(self, side, q):
        A0 = self.ax[side]
        g = self.front + self.S * q
        x = A0.x * 0.86
        if q < 0.08:
            pitch = -14 * (1 - sm(q / 0.08))
            pivot = Vector((x, A0.y + self.heel, 0))
        elif q < 0.36:
            pitch = 0.0
            pivot = Vector((x, A0.y, 0))
        else:
            pitch = 34 * sm((q - 0.36) / (self.stance - 0.36)) ** 1.2
            pivot = Vector((x, A0.y + self.ball, 0))
        rel = Vector((0, A0.y - pivot.y, A0.z))
        Rm = R(X, pitch).to_matrix()
        ank = Vector((x, pivot.y + g, 0)) + Rm @ rel
        return ank, pitch

    def foot(self, side, q):
        q = q % 1.0
        if q <= self.stance:
            return self.stance_ankle(side, q)
        s = (q - self.stance) / (1 - self.stance)
        a0, p0 = self.stance_ankle(side, self.stance)
        a1, p1 = self.stance_ankle(side, 1.0 + 1e-6 - 1.0)
        e = 0.5 - 0.5 * math.cos(math.pi * s)
        ank = a0.lerp(a1, e)
        ank.z += 0.075 * math.sin(math.pi * min(1, s * 1.15)) ** 0.9
        pitch = p0 + (p1 - p0) * sm(s * 1.1)
        # toe clears the ground mid-swing
        if 0.15 < s < 0.7:
            pitch -= 10 * math.sin(math.pi * (s - 0.15) / 0.55)
        return ank, pitch

    def apply(self, P, p, arms=True, sway=1.0, lean=4.0):
        fem = self.rig.kind != 'Bursch'
        P.off = Vector((0.016 * math.sin(2 * math.pi * p) * sway, 0, -0.034 - 0.016 * math.cos(4 * math.pi * p)))
        yaw = -5 * math.cos(2 * math.pi * p)
        roll = -3 * math.sin(2 * math.pi * p) * (1.4 if fem else 1)
        P.rot('hips', R(Z, yaw), R(Y, roll))
        spine_chain(P, lean=lean + 1.2 * math.cos(4 * math.pi * p), roll=-roll * 0.7, yaw=-yaw * 1.5)
        feet, frot = {}, {}
        for side, ph in (('L', 0.0), ('R', 0.5)):
            a, pitch = self.foot(side, p + ph)
            feet[side] = a
            frot[side] = R(X, pitch).to_matrix() @ R(Z, (8 if side == 'L' else -8)).to_matrix()
        legs_planted(P, feet, foot_rot=frot)
        if arms:
            c = math.cos(2 * math.pi * p)
            arm_relaxed(P, 'L', swing=15 * c, bend=14 + 10 * max(0, -c), out=5)
            arm_relaxed(P, 'R', swing=-15 * c, bend=14 + 10 * max(0, c), out=5)


# ------------------------------------------------------------------ animations (each returns a list of skin dicts)
def stand_feet(rig, wide=0.02, back=0.0):
    a = {}
    for side, s in (('L', 1), ('R', -1)):
        A0 = rig.h['foot.' + side]
        a[side] = Vector((A0.x + s * wide, A0.y + (back if side == 'R' else 0), A0.z))
    return a


def carry_target(rig, S, side='R', high=0.0):
    """wrist for carrying the Maß in front of the belly, attached to the chest"""
    fem = rig.kind != 'Bursch'
    z = rig.h['forearm.R'].z - (0.1 if not fem else 0.09) + high
    W0 = Vector((-0.19 if not fem else -0.165, -0.2 if not fem else -0.18, z))
    if side == 'L':
        W0.x = -W0.x
    C = S['chest']
    return C @ W0, yaw_of(C.to_3x3())


def frames_walk(rig, beer):
    g = Gait(rig)
    out = []
    for f in range(24):
        p = f / 24
        P = Pose(rig)
        g.apply(P, p, arms=True)
        if beer:
            S = P.S()
            W, cy = carry_target(rig, S)
            W += Vector((0, 0, 0.006 * math.cos(4 * math.pi * p + 0.6)))
            arm_to(P, 'R', W, R(Z, math.degrees(cy) + 16).to_matrix())
        out.append(P.S())
    return out


def frames_idle(rig, n=48):
    out = []
    fem = rig.kind != 'Bursch'
    for f in range(n):
        P = Pose(rig)
        sx = 0.014 * cyc(f, n)
        P.off = Vector((sx, 0, -0.012 + 0.003 * cyc(f, n, 2)))
        P.rot('hips', R(Y, 1.8 * cyc(f, n)), R(Z, 3 * cyc(f, n, 1, 0.25)))
        spine_chain(P, lean=1.5 + 0.8 * cyc(f, n, 2), roll=-1.5 * cyc(f, n), yaw=-3 * cyc(f, n, 1, 0.25), head_yaw=9 * cyc(f, n, 1, 0.1),
                    head_pitch=-2 + 2 * cyc(f, n, 2, 0.3))
        feet = stand_feet(rig, 0.025 if not fem else 0.012, 0.03)
        legs_planted(P, feet, foot_rot={'L': R(Z, 9).to_matrix(), 'R': R(Z, -9).to_matrix()})
        S = P.S()
        W, cy = carry_target(rig, S, high=0.07)
        arm_to(P, 'R', W, R(Z, math.degrees(cy) + 18).to_matrix())
        if fem:
            arm_relaxed(P, 'L', swing=-4 + 2 * cyc(f, n), bend=18, out=6)
        else:
            # thumb in the waistband
            S = P.S()
            W2 = S['hips'] @ Vector((0.17, -0.06, rig.h['hips'].z + 0.04))
            arm_to(P, 'L', W2, qmul(R(Z, -60), R(X, 80)).to_matrix(), pole=Vector((0.6, 0.6, 0.0)))
        out.append(P.S())
    return out


def seat_offset(rig):
    fem = rig.kind != 'Bursch'
    return Vector((0, 0.03, (0.535 if fem else 0.55) - rig.h['hips'].z))


def seated_base(rig, P, f, n, lean=6.0, roll=0.0, yaw=0.0, head_yaw=0.0, head_pitch=-4.0):
    fem = rig.kind != 'Bursch'
    P.off = seat_offset(rig)
    P.rot('hips', R(X, -4), R(Y, roll * 0.3))
    spine_chain(P, lean=lean, roll=roll, yaw=yaw, head_yaw=head_yaw, head_pitch=head_pitch)
    feet = {}
    for side, s in (('L', 1), ('R', -1)):
        x = 0.085 * s if not fem else 0.07 * s
        feet[side] = Vector((x, -0.37 if not fem else -0.355, rig.h['foot.' + side].z))
    legs_planted(P, feet, knee_pole=Vector((0, -1, 1.2)), foot_rot={'L': R(Z, 6).to_matrix(), 'R': R(Z, -6).to_matrix()})


def mug_on_table(rig, side='R'):
    """wrist so that the gripped Maß stands on the table top"""
    fem = rig.kind != 'Bursch'
    base_z = 0.765
    return Vector((-0.2 if not fem else -0.18, -0.27 if not fem else -0.255, base_z - chars.MUG['base']))


def frames_sit(rig, n=48):
    out = []
    fem = rig.kind != 'Bursch'
    for f in range(n):
        P = Pose(rig)
        seated_base(rig, P, f, n, lean=7 + 1.0 * cyc(f, n, 2), yaw=2 * cyc(f, n), head_yaw=14 * cyc(f, n, 1, 0.2), head_pitch=-5 + 3 * cyc(f, n, 2, 0.4))
        W = mug_on_table(rig)
        arm_to(P, 'R', W + Vector((0, 0, 0.004 * cyc(f, n, 2))), R(Z, 22).to_matrix(), pole=Vector((-0.35, 0.3, -1.0)))
        WL = Vector((0.16 if not fem else 0.14, -0.31 if not fem else -0.29, 0.815))
        arm_to(P, 'L', WL, qmul(R(Z, -35), R(Y, 80)).to_matrix(), pole=Vector((0.4, 0.3, -1.0)))
        out.append(P.S())
    return out


def frames_schunkeln(rig, n=52):
    out = []
    fem = rig.kind != 'Bursch'
    for f in range(n):
        P = Pose(rig)
        sw = cyc(f, n)
        seated_base(rig, P, f, n, lean=5, roll=11 * sw, head_pitch=-2, head_yaw=4 * sw)
        S = P.S()
        C = S['chest']
        # left arm hooked into the neighbour's, right hand holds the Maß up a little
        WL = C @ Vector((0.36 if not fem else 0.32, -0.14, rig.h['chest'].z - 0.12))
        arm_to(P, 'L', WL, qmul(R(Z, -80), R(Y, 70)).to_matrix(), pole=Vector((0.4, 0.4, -0.8)))
        WR = C @ Vector((-0.21 if not fem else -0.18, -0.3, rig.h['chest'].z - 0.13))
        arm_to(P, 'R', WR, R(Z, math.degrees(yaw_of(C.to_3x3())) + 20).to_matrix(), pole=Vector((-0.6, 0.5, -0.6)))
        out.append(P.S())
    return out


def frames_cheer(rig, n=24):
    out = []
    fem = rig.kind != 'Bursch'
    for f in range(n):
        P = Pose(rig)
        b = 0.5 - 0.5 * math.cos(4 * math.pi * f / n)
        P.off = Vector((0, 0, -0.035 * b))
        spine_chain(P, lean=-4, head_pitch=-14, keep_head=False)
        feet = stand_feet(rig, 0.04)
        legs_planted(P, feet, foot_rot={'L': R(Z, 10).to_matrix(), 'R': R(Z, -10).to_matrix()})
        S = P.S()
        top = rig.h['head'].z + 0.32
        W = S['chest'] @ Vector((-0.2 if not fem else -0.18, -0.1, top + 0.02 * b))
        arm_to(P, 'R', W, qmul(R(X, -15 - 8 * b)).to_matrix(), pole=Vector((-0.8, 0.3, 0.2)))
        WL = S['chest'] @ Vector((0.24 if not fem else 0.21, -0.06, top - 0.06 + 0.04 * b))
        arm_to(P, 'L', WL, qmul(R(X, -90)).to_matrix(), pole=Vector((0.8, 0.3, 0.2)))
        out.append(P.S())
    return out


def frames_prosit(rig, seated, n=24):
    out = []
    fem = rig.kind != 'Bursch'
    for f in range(n):
        P = Pose(rig)
        sw = cyc(f, n)
        if seated:
            seated_base(rig, P, f, n, lean=3, roll=6 * sw, head_pitch=-8, head_yaw=3 * sw)
        else:
            P.off = Vector((0.012 * sw, 0, -0.012))
            P.rot('hips', R(Y, 2 * sw))
            spine_chain(P, lean=-1, roll=-5 * sw, head_pitch=-8)
            legs_planted(P, stand_feet(rig, 0.03), foot_rot={'L': R(Z, 9).to_matrix(), 'R': R(Z, -9).to_matrix()})
        S = P.S()
        C = S['chest']
        hz = rig.h['head'].z + (0.06 if not seated else 0.04)
        W = C @ Vector((-0.17 if not fem else -0.15, -0.36, hz - 0.05))
        arm_to(P, 'R', W, R(X, -10).to_matrix() @ R(Z, math.degrees(yaw_of(C.to_3x3())) + 30).to_matrix(), pole=Vector((-0.8, 0.4, -0.3)))
        if seated:
            WL = Vector((0.16 if not fem else 0.14, -0.31 if not fem else -0.29, 0.815))
            arm_to(P, 'L', WL, qmul(R(Z, -35), R(Y, 80)).to_matrix(), pole=Vector((0.4, 0.3, -1.0)))
        else:
            arm_relaxed(P, 'L', swing=-6, bend=20, out=8)
        out.append(P.S())
    return out


def drink_arm(P, rig, tilt, side='R', yaw=0.0):
    """put the rim of the Maß on the lips, tilted by `tilt` degrees towards the face"""
    S = P.S()
    Hm = S['head']
    lips = Hm @ rig.lips
    face_dir = (Hm.to_3x3() @ Vector((0, -1, 0)))
    fy = math.degrees(math.atan2(face_dir.x, -face_dir.y))
    G = R(Z, fy + yaw).to_matrix() @ R(X, -tilt).to_matrix()
    rim = rim_local(side, Vector((0, 1, 0)))
    W = lips + face_dir * 0.004 - G @ rim
    arm_to(P, side, W, G, pole=Vector((-0.9, 0.3, -0.5)), twist=0.4)


def frames_drink(rig, seated, n=24):
    out = []
    fem = rig.kind != 'Bursch'
    for f in range(n):
        P = Pose(rig)
        gulp = math.sin(2 * math.pi * 2 * f / n)
        if seated:
            seated_base(rig, P, f, n, lean=-4, head_pitch=-20 - 2 * gulp)
            WL = Vector((0.16 if not fem else 0.14, -0.31 if not fem else -0.29, 0.815))
        else:
            P.off = Vector((0, 0.008, -0.012))
            spine_chain(P, lean=-6, head_pitch=-20 - 2 * gulp, keep_head=False)
            legs_planted(P, stand_feet(rig, 0.03), foot_rot={'L': R(Z, 9).to_matrix(), 'R': R(Z, -9).to_matrix()})
        drink_arm(P, rig, 58 + 3 * gulp)
        if seated:
            arm_to(P, 'L', WL, qmul(R(Z, -35), R(Y, 80)).to_matrix(), pole=Vector((0.4, 0.3, -1.0)))
        else:
            arm_relaxed(P, 'L', swing=-4, bend=16, out=7)
        out.append(P.S())
    return out


def frames_sip(rig, n=36):
    """raise the Maß, drink, lower it again (played once, standing)"""
    out = []
    fem = rig.kind != 'Bursch'
    for f in range(n):
        if f < 10:
            k = sm(f / 9)
        elif f < 26:
            k = 1.0
        else:
            k = 1 - sm((f - 26) / 9)
        gul = math.sin(math.pi * 2 * max(0, f - 10) / 16) if 10 <= f < 26 else 0
        P = Pose(rig)
        P.off = Vector((0, 0.006 * k, -0.012))
        spine_chain(P, lean=1.5 - 7 * k, head_pitch=-2 - 19 * k - 2 * gul, keep_head=False)
        legs_planted(P, stand_feet(rig, 0.025 if not fem else 0.012, 0.03), foot_rot={'L': R(Z, 9).to_matrix(), 'R': R(Z, -9).to_matrix()})
        # blend between carry and drink by blending wrist targets and hand rotations
        S = P.S()
        Wc, cy = carry_target(rig, S, high=0.07)
        Gc = R(Z, math.degrees(cy) + 18).to_matrix()
        Hm = S['head']
        lips = Hm @ rig.lips
        face_dir = (Hm.to_3x3() @ Vector((0, -1, 0)))
        fy = math.degrees(math.atan2(face_dir.x, -face_dir.y))
        tilt = (40 + 20 * min(1, max(0, (f - 10) / 14))) if f >= 10 else 40
        tilt += 2 * gul
        Gd = R(Z, fy).to_matrix() @ R(X, -tilt).to_matrix()
        Wd = lips + face_dir * 0.004 - Gd @ rim_local('R', Vector((0, 1, 0)))
        qc, qd = Gc.to_quaternion(), Gd.to_quaternion()
        G = qc.slerp(qd, k).to_matrix()
        # arc the wrist forward on the way up so the Maß does not pass through the chin
        W = Wc.lerp(Wd, k) + (S['chest'].to_3x3() @ Vector((0, -0.09, 0.02))) * math.sin(math.pi * k)
        arm_to(P, 'R', W, G, pole=Vector((-0.9, 0.3, -0.5)), twist=0.4)
        arm_relaxed(P, 'L', swing=-4, bend=16, out=7)
        out.append(P.S())
    return out


def serve_arms(P, rig, bounce=0.0):
    S = P.S()
    C = S['chest']
    cy = math.degrees(yaw_of(C.to_3x3()))
    zc = rig.h['forearm.L'].z - 0.12 + bounce
    for side, s in (('L', 1), ('R', -1)):
        W = C @ Vector((0.205 * s, -0.25, zc))
        arm_to(P, side, W, R(Z, cy - 8 * s).to_matrix(), pole=Vector((0.7 * s, 0.6, -0.4)), twist=0.5)


def frames_serve_walk(rig):
    g = Gait(rig)
    out = []
    for f in range(24):
        p = f / 24
        P = Pose(rig)
        g.apply(P, p, arms=False, lean=-2)
        serve_arms(P, rig, 0.004 * math.cos(4 * math.pi * p + 0.5))
        out.append(P.S())
    return out


def frames_serve_idle(rig, n=48):
    out = []
    for f in range(n):
        P = Pose(rig)
        P.off = Vector((0.01 * cyc(f, n), 0, -0.012))
        P.rot('hips', R(Y, 1.5 * cyc(f, n)))
        spine_chain(P, lean=-2, roll=-1.2 * cyc(f, n), head_yaw=6 * cyc(f, n, 1, 0.2), head_pitch=-3)
        legs_planted(P, stand_feet(rig, 0.01, 0.03), foot_rot={'L': R(Z, 9).to_matrix(), 'R': R(Z, -9).to_matrix()})
        serve_arms(P, rig, 0.003 * cyc(f, n, 2))
        out.append(P.S())
    return out


def frames_knockout(rig, n=48):
    """stagger, fall flat on the back and lie there belly up (played once, last frame held)"""
    out = []
    fem = rig.kind != 'Bursch'
    hz = rig.h['hips']
    piv = Vector((0, 0.07, 0.0))
    for f in range(n):
        P = Pose(rig)
        if f < 9:
            k = f / 8
            th = -9 * sm(k)
            buck = 0.06 * sm(k)
            lift = 0.0
        elif f < 22:
            k = (f - 9) / 12
            th = -9 - 81 * k * k
            buck = 0.06 * (1 - k)
            lift = 0.105 * k
        else:
            k = (f - 22) / 5
            th = -90 + (4 * math.sin(math.pi * min(1, k)) if f < 27 else 0)
            buck = 0.0
            lift = 0.105
        q = R(X, th)
        Qm = q.to_matrix()
        off = piv - hz + Qm @ (hz - piv) + Vector((0, 0, lift))
        # knees buckle while staggering
        P.off = off + Qm @ Vector((0, 0, -buck))
        P.Q['hips'] = q
        lie = sm((f - 14) / 10) if f > 14 else 0.0
        breathe = 0.6 * math.sin(2 * math.pi * f / 24) * (1 if f > 26 else 0)
        P.rot('spine', R(X, 6 * sm(f / 8) * (1 - lie) + breathe))
        P.rot('chest', R(X, 4 * sm(f / 8) * (1 - lie)))
        P.rot('neck', R(X, -14 * sm(f / 10) * (1 - lie) + 6 * lie))
        P.rot('head', R(Z, 28 * lie), R(X, -10 * sm(f / 10) * (1 - lie)))
        for side, s in (('L', 1), ('R', -1)):
            flail = sm(f / 10)
            out_ = 15 + 60 * lie + 25 * flail * (1 - lie)
            P.Q['shoulder.' + side] = R(Y, -6 * s * lie)
            P.Q['upperarm.' + side] = qmul(R(Y, -out_ * s), R(X, -45 * flail * (1 - lie) - 20 * lie))
            P.Q['forearm.' + side] = R(X, -(25 + 35 * flail * (1 - lie) + 25 * lie))
            P.Q['hand.' + side] = R(X, -10)
            P.Q['thigh.' + side] = qmul(R(Y, 9 * s * lie), R(X, -(8 + 14 * buck / 0.06) * (1 - lie) - 8 * lie))
            P.Q['shin.' + side] = R(X, (16 + 30 * buck / 0.06) * (1 - lie) + 12 * lie)
            P.Q['foot.' + side] = qmul(R(Z, 18 * s * lie), R(X, 25 * lie))
        out.append(P.S())
    return out


ANIMS = [('Walk', 24), ('Idle', 48), ('Sit', 48), ('Schunkeln', 52), ('Cheer', 24), ('PrositStand', 24), ('PrositSit', 24),
         ('WalkBeer', 24), ('DrinkStand', 24), ('DrinkSit', 24), ('Sip', 36), ('ServeWalk', 24), ('ServeIdle', 48), ('KnockOut', 48)]


def all_frames(rig):
    gen = {
        'Walk': lambda: frames_walk(rig, False), 'Idle': lambda: frames_idle(rig), 'Sit': lambda: frames_sit(rig),
        'Schunkeln': lambda: frames_schunkeln(rig), 'Cheer': lambda: frames_cheer(rig), 'PrositStand': lambda: frames_prosit(rig, False),
        'PrositSit': lambda: frames_prosit(rig, True), 'WalkBeer': lambda: frames_walk(rig, True), 'DrinkStand': lambda: frames_drink(rig, False),
        'DrinkSit': lambda: frames_drink(rig, True), 'Sip': lambda: frames_sip(rig), 'ServeWalk': lambda: frames_serve_walk(rig),
        'ServeIdle': lambda: frames_serve_idle(rig), 'KnockOut': lambda: frames_knockout(rig)}
    out, meta, start = {}, [], 0
    for name, n in ANIMS:
        fr = gen[name]()
        assert len(fr) == n, (name, len(fr))
        out[name] = fr
        meta.append(dict(name=name, start=start, frames=n))
        start += n
    return out, meta
