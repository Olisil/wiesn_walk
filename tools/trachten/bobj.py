"""Blender helpers: rig joints, mesh objects with weights and materials, preview rendering."""
import bpy
import numpy as np
from mathutils import Matrix, Vector
from geo import PARTS
from chars import norm_weights

PCOL = {0: (0.9, 0.7, 0.56), 1: (0.65, 0.23, 0.25), 2: (0.29, 0.2, 0.12), 3: (0.85, 0.81, 0.72), 4: (0.33, 0.21, 0.12), 5: (0.85, 0.83, 0.75),
        6: (0.45, 0.1, 0.15), 7: (0.78, 0.45, 0.06), 8: (0.85, 0.88, 0.86), 9: (0.12, 0.16, 0.1), 10: (0.08, 0.05, 0.03), 11: (0.9, 0.88, 0.83),
        12: (0.03, 0.025, 0.03), 13: (0.6, 0.12, 0.15), 14: (0.4, 0.3, 0.18), 15: (0.75, 0.42, 0.4), 16: (0.78, 0.77, 0.72), 17: (0.34, 0.29, 0.24),
        18: (0.12, 0.24, 0.13)}
PNAME = {v: k for k, v in PARTS.items()}


def joints(rig):
    return {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in rig.data.bones}


def materials():
    mats = []
    for i in range(19):
        name = 'P%02d_%s' % (i, PNAME[i])
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        c = PCOL[i]
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1)
            bsdf.inputs['Roughness'].default_value = 0.2 if i in (7, 8, 16) else 0.7
        m.diffuse_color = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1)
        mats.append(m)
    return mats


def make_object(name, M, rig, bones):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new(name)
    V = M.verts()
    me.from_pydata(V.tolist(), [], [list(f) for f in M.F])
    me.update()
    mats = materials()
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', [int(p) for p in M.FP])
    me.polygons.foreach_set('use_smooth', [True] * len(M.F))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for b in bones:
        ob.vertex_groups.new(name=b)
    for vi, w in enumerate(M.W):
        for b, x in norm_weights(w):
            ob.vertex_groups[b].add([vi], x, 'REPLACE')
    if rig:
        ob.parent = rig
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig
    a = me.attributes.new('mug_h', 'FLOAT', 'POINT')
    a.data.foreach_set('value', [float(x) for x in M.MH])
    return ob


def setup_render(res=(900, 900), samples=12):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    return sc


def camera(loc, look, lens=50, ortho=None):
    sc = bpy.context.scene
    cam = sc.camera
    cam.location = Vector(loc)
    d = Vector(look) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = 'PERSP'


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
