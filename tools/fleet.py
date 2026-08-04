# The fleet, modelled parametrically in Blender.
#
#   G:\Blender\blender.exe -b --factory-startup -P tools/fleet.py -- --preview
#   G:\Blender\blender.exe -b --factory-startup -P tools/fleet.py -- --export
#
# Warships are hard-surface, bilaterally symmetric and read by their
# silhouette, which is exactly what building them from primitives is good at:
# every hull is mirrored down the centreline by construction, poly counts stay
# where we put them, and the whole fleet shares one visual language because
# it comes from one set of rules.
#
# Four classes, matching the fleet on the rules sheet:
#
#   patrol     1 cell    a hull, a cabin, one gun
#   destroyer  2 cells   + funnel, mast, twin turrets
#   cruiser    3 cells   + bridge tower, secondary guns
#   carrier    4 cells   flat deck, island to starboard, deck markings
#
# Export writes public/media/fleet/<class>.glb — glTF because it is the only
# 3D format browsers load natively, and these come out at a few tens of KB.

import bpy
import bmesh
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'media', 'fleet')
PREVIEW = os.path.join(ROOT, 'build-media')

# Naval greys, plus the deck and the accent the radar picks out.
PALETTE = {
    'hull': (0.055, 0.062, 0.075, 1),
    'deck': (0.105, 0.115, 0.130, 1),
    'trim': (0.020, 0.023, 0.030, 1),
    'accent': (0.55, 0.62, 0.85, 1),
}


# ------------------------------- scene helpers -------------------------------

def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials):
        for datum in list(block):
            if datum.users == 0:
                block.remove(datum)


def material(name, rgba, rough=0.55, metal=0.75):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return mat


def box(name, size, location, mat, taper=None, bevel=0.012):
    """A bevelled box. `taper` shrinks the +X end, which is how every hull,
    funnel and turret here gets its shape."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    if taper:
        front_x = max(v.co.x for v in bm.verts)
        for v in bm.verts:
            if abs(v.co.x - front_x) < 1e-5:
                v.co.y *= taper
                v.co.z *= taper
    if bevel:
        bmesh.ops.bevel(
            bm,
            geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
            offset=bevel,
            segments=2,
            affect='EDGES',
        )
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cylinder(name, radius, depth, location, mat, rot=(0, 0, 0), verts=12):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=radius, radius2=radius * 0.86, depth=depth)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = rot
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def hull(length, beam, mats):
    """The shared hull: a full-bodied midships that tapers into a knife bow.

    The taper is gentle and the bow wedge overlaps the hull it grows out of —
    a sharper taper leaves the hull ending in a needle with the bow floating
    in front of it, which is what a first pass at this looked like.
    """
    # `box` sizes are full extents, so a hull of `length` spans ±length/2 —
    # passing length*0.5 here built every ship at half size and left the bow
    # and turrets sitting in the water beside it.
    parts = []
    parts.append(box('hull', (length, beam, 0.11), (0, 0, 0), mats['hull'], taper=0.52))
    # deck sits a hair proud of the hull so the two colours read apart
    parts.append(box('deck', (length * 0.94, beam * 0.9, 0.014), (0, 0, 0.112), mats['deck'], taper=0.54))
    # the bow starts inside the hull and runs past it to a point
    parts.append(box('bow', (length * 0.26, beam * 0.5, 0.095), (length * 0.44, 0, 0.004), mats['hull'], taper=0.16))
    return parts


def turret(x, scale, mats, z=0.13):
    base = box('turret', (0.055 * scale, 0.055 * scale, 0.028 * scale), (x, 0, z), mats['trim'])
    barrel = cylinder(
        'barrel', 0.010 * scale, 0.13 * scale, (x + 0.085 * scale, 0, z + 0.012 * scale),
        mats['trim'], rot=(0, math.radians(90), 0), verts=8,
    )
    return [base, barrel]


def mast(x, height, mats):
    return [
        cylinder('mast', 0.008, height, (x, 0, 0.13 + height / 2), mats['trim'], verts=6),
        box('yard', (0.006, 0.05, 0.004), (x, 0, 0.13 + height * 0.78), mats['trim'], bevel=0),
    ]


# --------------------------------- the classes --------------------------------

def build_patrol(mats):
    parts = hull(0.62, 0.20, mats)
    parts.append(box('cabin', (0.09, 0.062, 0.038), (-0.03, 0, 0.145), mats['deck'], taper=0.72))
    parts += turret(0.16, 0.85, mats)
    parts += mast(-0.10, 0.11, mats)
    return parts


def build_destroyer(mats):
    parts = hull(1.05, 0.24, mats)
    parts.append(box('bridge', (0.12, 0.078, 0.055), (0.06, 0, 0.155), mats['deck'], taper=0.66))
    parts.append(box('house', (0.20, 0.070, 0.030), (-0.18, 0, 0.14), mats['deck'], taper=0.85))
    parts.append(box('funnel', (0.035, 0.040, 0.055), (-0.06, 0, 0.165), mats['trim'], taper=0.70))
    parts += turret(0.34, 1.0, mats)
    parts += turret(-0.40, 1.0, mats)
    parts += mast(0.0, 0.16, mats)
    return parts


def build_cruiser(mats):
    parts = hull(1.45, 0.30, mats)
    parts.append(box('tower', (0.10, 0.085, 0.10), (0.10, 0, 0.20), mats['deck'], taper=0.55))
    parts.append(box('bridge', (0.17, 0.098, 0.055), (0.06, 0, 0.155), mats['deck'], taper=0.72))
    parts.append(box('house', (0.30, 0.088, 0.034), (-0.26, 0, 0.145), mats['deck'], taper=0.88))
    for fx in (-0.02, -0.16):
        parts.append(box('funnel', (0.040, 0.050, 0.062), (fx, 0, 0.175), mats['trim'], taper=0.68))
    parts += turret(0.50, 1.15, mats)
    parts += turret(0.34, 1.15, mats)
    parts += turret(-0.52, 1.15, mats)
    # secondaries down both flanks, mirrored by construction
    for sx in (0.16, -0.06):
        for sy in (0.10, -0.10):
            parts.append(box('secondary', (0.028, 0.022, 0.020), (sx, sy, 0.145), mats['trim']))
    parts += mast(0.20, 0.20, mats)
    return parts


def build_carrier(mats):
    parts = hull(1.90, 0.42, mats)
    # the flight deck: longer and wider than the hull, overhanging to port
    parts.append(box('flightdeck', (1.78, 0.52, 0.016), (0, -0.04, 0.125), mats['deck']))
    # centreline stripe, the thing that says "carrier" instantly
    parts.append(box('stripe', (1.34, 0.020, 0.004), (-0.04, -0.04, 0.136), mats['accent'], bevel=0))
    for mx in (-0.62, -0.30, 0.30, 0.62):
        parts.append(box('mark', (0.055, 0.016, 0.004), (mx, -0.04, 0.136), mats['accent'], bevel=0))
    # Island to starboard, as on every real carrier — sitting ON the deck,
    # inboard of its edge, not hovering off the side of it.
    ISLAND_Y = 0.185
    parts.append(box('island', (0.11, 0.048, 0.070), (0.10, ISLAND_Y, 0.175), mats['trim'], taper=0.70))
    parts.append(box('islandtop', (0.055, 0.036, 0.028), (0.10, ISLAND_Y, 0.238), mats['trim'], taper=0.65))
    for part in mast(0.02, 0.15, mats):
        part.location.y = ISLAND_Y
        parts.append(part)
    return parts


CLASSES = {
    'patrol': (build_patrol, 1),
    'destroyer': (build_destroyer, 2),
    'cruiser': (build_cruiser, 3),
    'carrier': (build_carrier, 4),
}


# ---------------------------------- output -----------------------------------

def make(name):
    clear()
    mats = {k: material(k, v) for k, v in PALETTE.items()}
    parts = CLASSES[name][0](mats)

    # One object per ship: cheaper to load, cheaper to draw, and a single
    # thing for the renderer to move around.
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ship = bpy.context.view_layer.objects.active
    ship.name = name
    # Flat shading keeps the panel edges crisp, which is what makes a hull read
    # as steel. (Blender 4.1 removed use_auto_smooth, so this is not a
    # shade_smooth + auto-smooth pair any more.)
    bpy.ops.object.shade_flat()
    return ship


def setup_render(size=900):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 55
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = (2.1, -2.4, 1.5)
    cam.rotation_euler = (math.radians(60), 0, math.radians(41))
    scene.collection.objects.link(cam)
    scene.camera = cam

    key = bpy.data.lights.new('key', 'AREA')
    key.energy = 900
    key.size = 4
    key_obj = bpy.data.objects.new('key', key)
    key_obj.location = (2.4, -2.0, 3.4)
    key_obj.rotation_euler = (math.radians(35), 0, math.radians(40))
    scene.collection.objects.link(key_obj)

    rim = bpy.data.lights.new('rim', 'AREA')
    rim.energy = 420
    rim.size = 3
    rim.color = (0.55, 0.68, 1.0)
    rim_obj = bpy.data.objects.new('rim', rim)
    rim_obj.location = (-2.6, 1.8, 1.6)
    rim_obj.rotation_euler = (math.radians(72), 0, math.radians(-125))
    scene.collection.objects.link(rim_obj)

    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes.get('Background').inputs[0].default_value = (0.012, 0.014, 0.020, 1)
    scene.world = world

    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Standard'


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    mode = argv[0] if argv else '--preview'

    if mode == '--export':
        os.makedirs(OUT, exist_ok=True)
        for name in CLASSES:
            ship = make(name)
            tris = sum(len(p.vertices) - 2 for p in ship.data.polygons)
            bpy.ops.object.select_all(action='DESELECT')
            ship.select_set(True)
            path = os.path.join(OUT, f'{name}.glb')
            bpy.ops.export_scene.gltf(
                filepath=path,
                export_format='GLB',
                use_selection=True,
                export_apply=True,
            )
            kb = os.path.getsize(path) / 1024
            print(f'  {name:<10} {tris:>5} tris   {kb:6.1f} KB', flush=True)
        return

    # preview: the whole fleet in one shot, so the family resemblance is visible
    clear()
    mats = {k: material(k, v) for k, v in PALETTE.items()}
    y = 0.0
    for name, (builder, cells) in CLASSES.items():
        parts = builder(mats)
        for obj in parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        ship = bpy.context.view_layer.objects.active
        ship.name = name
        ship.location = (0, y, 0)
        y += 0.95
        bpy.ops.object.select_all(action='DESELECT')

    setup_render()
    # Framed on the fleet itself: the previous framing left them as models on
    # a table rather than ships you could judge.
    bpy.context.scene.camera.location = (2.9, -0.55, 2.35)
    bpy.context.scene.camera.rotation_euler = (math.radians(62), 0, math.radians(58))
    bpy.context.scene.camera.data.lens = 34
    os.makedirs(PREVIEW, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(PREVIEW, 'fleet.png')
    bpy.ops.render.render(write_still=True)
    print('  preview written', flush=True)


main()
