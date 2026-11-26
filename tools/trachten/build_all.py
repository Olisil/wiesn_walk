"""Rebuild the Wiesn Walk characters: meshes (3 LODs), baked animations, Blender actions, game JSON, preview renders.
run: python3 build_all.py [--render] [--save]"""
import sys, json, base64, math, time
sys.path.insert(0, '/home/claude/wwblend')
import bpy, numpy as np
from mathutils import Matrix, Vector, Quaternion
import geo, chars, anim, bobj

ARGS = sys.argv[1:]
SRC = '/home/claude/wwblend/WiesnWalk_Trachten.blend'
OUT_JSON = '/home/claude/wiesn_walk/public/data/trachten.json'
OUT_BLEND = '/home/claude/wwblend/WiesnWalk_Trachten_v2.blend'
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
Ci = C.inverted()

bpy.ops.wm.open_mainfile(filepath=SRC)
for n in ('Bursch', 'Madl'):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

RIGS = {'Bursch': bpy.data.objects['Bursch_rig'], 'Madl': bpy.data.objects['Madl_rig']}
KINDS = [('Bursch', 'Bursch'), ('Madl', 'Madl'), ('Kellnerin', 'Madl')]


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def export_mesh(M, bones):
    V = M.verts()
    F = M.F
    tris, tpart = [], []
    for f, p in zip(F, M.FP):
        for k in range(1, len(f) - 1):
            tris.append((f[0], f[k], f[k + 1]))
            tpart.append(p)
    tris = np.array(tris)
    fn = np.cross(V[tris[:, 1]] - V[tris[:, 0]], V[tris[:, 2]] - V[tris[:, 0]])
    VN = np.zeros_like(V)
    for k in range(3):
        np.add.at(VN, tris[:, k], fn)
    VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12)
    remap = {}
    pos, nor, part, ji, jw, mh, idx = [], [], [], [], [], [], []
    bi = {b: i for i, b in enumerate(bones)}
    for t, p in zip(tris, tpart):
        for v in t:
            key = (int(v), int(p))
            if key not in remap:
                remap[key] = len(pos)
                x, y, z = V[v]
                pos.append((x, z, -y))
                nx, ny, nz_ = VN[v]
                nor.append((nx, nz_, -ny))
                part.append(p)
                ws = chars.norm_weights(M.W[v])
                q = [int(round(x_ * 255)) for _, x_ in ws]
                q[0] += 255 - sum(q)
                js = [bi[b] for b, _ in ws]
                while len(js) < 4:
                    js.append(js[0] if js else 0)
                    q.append(0)
                ji.append(js[:4])
                jw.append(q[:4])
                mh.append(int(round(np.clip(M.MH[v], 0, 1) * 255)))
            idx.append(remap[key])
    assert len(pos) < 65536
    return dict(count=len(pos), tris=len(tris), pos=b64(np.array(pos, np.float32)), nor=b64(np.array(nor, np.float32)),
                part=b64(np.array(part, np.uint8)), ji=b64(np.array(ji, np.uint8)), jw=b64(np.array(jw, np.uint8)),
                mh=b64(np.array(mh, np.uint8)), idx=b64(np.array(idx, np.uint16)))


def write_action(rig, name, frames):
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
    curves = {}
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    for fi, S in enumerate(frames):
        for b in anim.ORDER:
            par = anim.PARENT[b]
            Sp = S[par] if par else Matrix.Identity(4)
            B = rest[b].inverted() @ (Sp.inverted() @ S[b]) @ rest[b]
            loc, rot, sca = B.decompose()
            for path, vals in (('location', loc), ('rotation_quaternion', rot)):
                if path == 'location' and b != 'hips':
                    continue
                for i, v in enumerate(vals):
                    key = (b, path, i)
                    curves.setdefault(key, []).append((fi + 1, v))
    for (b, path, i), pts in curves.items():
        dp = 'pose.bones["%s"].%s' % (b, path)
        fc = act.fcurve_ensure_for_datablock(rig, dp, index=i, group_name=b)
        fc.keyframe_points.add(len(pts))
        fc.keyframe_points.foreach_set('co', [c for p in pts for c in p])
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
        fc.update()
    act.frame_range = (1, len(frames))
    act.use_fake_user = True
    return act


t0 = time.time()
data = {'bones': anim.ORDER, 'anims': None, 'chars': {}}
FR = {}
for rn, rig in RIGS.items():
    J = bobj.joints(rig)
    R = anim.Rig(J, rn)
    fr, meta = anim.all_frames(R)
    FR[rn] = (R, fr)
    data['anims'] = meta
    mats = []
    for name, n in anim.ANIMS:
        for S in fr[name]:
            for b in anim.ORDER:
                M3 = C @ S[b] @ Ci
                mats += [M3[r][c] for r in range(3) for c in range(4)]
    data['chars'][rn] = {'mats': b64(np.array(mats, np.float32)), 'frames': sum(n for _, n in anim.ANIMS), 'stride': R.stride}
    Sl = fr['Prone'][-1]
    wc = (Sl['hand.L'] @ R.h['hand.L'] + Sl['hand.R'] @ R.h['hand.R']) / 2
    data['chars'][rn]['proneWrist'] = [round(wc.x, 3), round(wc.z, 3), round(-wc.y, 3)]
    for name, n in anim.ANIMS:
        write_action(rig, rn + '_' + name, fr[name])
    print(rn, 'anims', time.time() - t0)

for kind, rn in KINDS:
    rig = RIGS[rn]
    J = bobj.joints(rig)
    ch = data['chars'].setdefault(kind, {'matsFrom': rn, 'frames': data['chars'][rn]['frames'], 'stride': data['chars'][rn]['stride']})
    for lod in ('hi', 'mid', 'lo'):
        M = chars.build(J, kind, lod)
        ch[lod] = export_mesh(M, anim.ORDER)
        if lod == 'hi':
            ob = bobj.make_object(kind, M, rig, anim.ORDER)
        print(kind, lod, ch[lod]['count'], ch[lod]['tris'])

with open(OUT_JSON, 'w') as fh:
    json.dump(data, fh, separators=(',', ':'))
print('json', round(len(json.dumps(data)) / 1e6, 2), 'MB', time.time() - t0)

# check: Blender's own evaluation of the action matches the baked skin matrices
rig = RIGS['Bursch']
rig.animation_data.action = bpy.data.actions['Bursch_Sip']
bpy.context.scene.frame_set(14)
R_, fr = FR['Bursch']
err = 0
for b in anim.ORDER:
    pb = rig.pose.bones[b]
    Sb = pb.matrix @ pb.bone.matrix_local.inverted()
    err = max(err, max(abs(Sb[i][j] - fr['Sip'][13][b][i][j]) for i in range(3) for j in range(4)))
print('action check max err', err)

if '--save' in ARGS:
    # the waitress gets her own copy of the Madl rig, so all three stand side by side in the file
    mr = RIGS['Madl']
    kr = mr.copy()
    kr.name = 'Kellnerin_rig'
    kr.animation_data_create()
    kr.animation_data.action = bpy.data.actions['Madl_ServeIdle']
    bpy.context.scene.collection.objects.link(kr)
    kr.location = mr.location + Vector((0.8, 0, 0))
    k = bpy.data.objects['Kellnerin']
    k.parent = kr
    k.modifiers['Armature'].object = kr
    RIGS['Bursch'].animation_data.action = bpy.data.actions['Bursch_Idle']
    mr.animation_data.action = bpy.data.actions['Madl_Idle']
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 48
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    print('saved', OUT_BLEND)
