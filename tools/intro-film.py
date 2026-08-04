# The studio opening, computed frame by frame in Blender.
#
#   G:\Blender\blender.exe -b --factory-startup -P tools/intro-film.py -- --stills 1.4,3.0,4.2,5.5,7.2
#   G:\Blender\blender.exe -b --factory-startup -P tools/intro-film.py -- --film
#
# One continuous take: our guy is standing with his coffee when a flying saucer
# slides in overhead and switches on the beam. He floats up — unbothered —
# takes a sip halfway, and the beam cuts out. He falls, tumbling in a single
# unbroken motion into the exact pose of the studio logo. Hypnic, as in the
# hypnic jerk: that falling feeling right before sleep.
#
# The character is one parametric skeleton whose pose is a pure function of
# time — nothing is ever swapped, so there is no seam anywhere. The dot eyes
# spiral open, the smile falls into the O, the feet grow into the blobs, the
# streaks are born mid-fall and settle where the logo has them.
#
# Style: black ink on white, matching the logo image exactly.
# Frames land in build-media/, plus public/media/intro-poster.png.

import bpy
import math
import os
import sys

# ------------------------------- configuration -------------------------------

FPS = 30
DURATION = 7.8
SIZE = 1080
# The stage uses the whole frame: ground low, saucer high, and the abduction
# happens through the centre — the way an ident holds its middle.
GROUND_Z = -3.5

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Frames stay out of public/ — only the encoded mp4 and the poster ship.
BUILD = os.path.join(ROOT, 'build-media')
POSTER = os.path.join(ROOT, 'public', 'media', 'intro-poster.png')
POSTER_TIME = 7.2

# The beats, in seconds. The web score in public/js/intro.js mirrors these.
UFO_IN = (0.9, 1.75)
BEAM_ON = 1.85
LIFT = (2.2, 3.6)
GRAB = 3.55            # the floating mug reaches his hand
DRINK = (3.85, 4.6)    # raise, hold at the mouth, lower a little
BEAM_CUT = (4.72, 4.88)
FALL = 5.05
IMPACT = FALL + 1.15   # the logo locks in — ring, flash, camera shake

# ---------------------------------- easing -----------------------------------

def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))

def lerp(a, b, t):
    return a + (b - a) * t

def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)

def ease_in(t):
    t = clamp(t)
    return t * t

def ease_out(t):
    t = clamp(t)
    return 1 - (1 - t) * (1 - t)

def span(t, t0, t1):
    """0 before t0, 1 after t1, linear between."""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp((t - t0) / (t1 - t0))

def rot(px, pz, deg):
    """Clockwise rotation, as seen by the camera."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return (px * c + pz * s, -px * s + pz * c)

def catmull(points, samples=10):
    """Smooth polyline through control points."""
    if len(points) < 3:
        return list(points)
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        for j in range(samples):
            t = j / samples
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            z = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, z))
    out.append(points[-1])
    return out

# ------------------------------- scene plumbing -------------------------------

# Studio idents live on dark: a luminous mark on a deep field. Warm ivory ink
# on charcoal keeps the hand-drawn identity while sitting right beside every
# other studio card someone has ever seen — and beside our own dark theme.
BG_LINEAR = (0.007, 0.006, 0.009)      # renders as ~#141218 in sRGB
INK_LINEAR = (0.896, 0.815, 0.716)     # renders as ~#f3e9dc

CAM = None

def build_stage():
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    global CAM
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 10
    CAM = bpy.data.objects.new('cam', cam_data)
    CAM.location = (0, -10, 0)
    CAM.rotation_euler = (math.radians(90), 0, 0)
    scene.collection.objects.link(CAM)
    scene.camera = CAM

    world = bpy.data.worlds.new('night')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (*BG_LINEAR, 1)
    bg.inputs[1].default_value = 1.0
    scene.world = world

    def emission(name, color, strength):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        tree = mat.node_tree
        tree.nodes.clear()
        emit = tree.nodes.new('ShaderNodeEmission')
        emit.inputs[0].default_value = (color[0] * strength, color[1] * strength, color[2] * strength, 1)
        out = tree.nodes.new('ShaderNodeOutputMaterial')
        tree.links.new(emit.outputs[0], out.inputs[0])
        return mat

    # Colour script: the character and the type are warm ivory; everything
    # alien — beam, saucer lights, stars, moon — is cool blue-white. Warm
    # subject under cool light is the oldest trick in cinematography, and it
    # is what makes a two-colour film read as lit rather than tinted.
    COOL = (0.30, 0.38, 0.78)
    mats = {
        'ink': emission('ink', INK_LINEAR, 1.0),
        'glow': emission('glow', INK_LINEAR, 0.10),
        'faint': emission('faint', INK_LINEAR, 0.42),
        'cool': emission('cool', COOL, 1.0),
        'coolglow': emission('coolglow', COOL, 0.12),
    }

    # The luminous body of the beam: layered translucent fills.
    beam_fill = bpy.data.materials.new('beam_fill')
    beam_fill.use_nodes = True
    tree = beam_fill.node_tree
    tree.nodes.clear()
    trans = tree.nodes.new('ShaderNodeBsdfTransparent')
    emit = tree.nodes.new('ShaderNodeEmission')
    emit.inputs[0].default_value = (0.45, 0.55, 0.95, 1)
    mix = tree.nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = 0.055
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    tree.links.new(trans.outputs[0], mix.inputs[1])
    tree.links.new(emit.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], out.inputs[0])
    for attr, value in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED')):
        try:
            setattr(beam_fill, attr, value)
        except (AttributeError, TypeError):
            pass
    mats['beam_fill'] = beam_fill

    # A moonlit radial gradient behind everything. It fades to the base colour
    # well before the frame edge, so the film's border stays exactly #141218
    # and dissolves into the page around it.
    sky_mat = bpy.data.materials.new('sky')
    sky_mat.use_nodes = True
    tree = sky_mat.node_tree
    tree.nodes.clear()
    tex = tree.nodes.new('ShaderNodeTexCoord')
    sub = tree.nodes.new('ShaderNodeVectorMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (0.0, 3.2, 0.0)
    length = tree.nodes.new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    rng = tree.nodes.new('ShaderNodeMapRange')
    rng.inputs[1].default_value = 0.0
    rng.inputs[2].default_value = 5.4
    ramp = tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.0130, 0.0097, 0.0343, 1)  # deep indigo
    ramp.color_ramp.elements[1].color = (*BG_LINEAR, 1)
    emit = tree.nodes.new('ShaderNodeEmission')
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    tree.links.new(tex.outputs['Object'], sub.inputs[0])
    tree.links.new(sub.outputs[0], length.inputs[0])
    tree.links.new(length.outputs['Value'], rng.inputs[0])
    tree.links.new(rng.outputs[0], ramp.inputs[0])
    tree.links.new(ramp.outputs['Color'], emit.inputs[0])
    tree.links.new(emit.outputs[0], out.inputs[0])

    import bmesh
    sky_mesh = bpy.data.meshes.new('sky')
    bm = bmesh.new()
    verts = [bm.verts.new(v) for v in ((-7, 0, -7), (7, 0, -7), (7, 0, 7), (-7, 0, 7))]
    bm.faces.new(verts)
    bm.to_mesh(sky_mesh)
    bm.free()
    sky = bpy.data.objects.new('sky', sky_mesh)
    sky.location = (0, 3, 0)
    sky.data.materials.append(sky_mat)
    scene.collection.objects.link(sky)  # persistent — never cleared per frame

    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    try:
        scene.eevee.taa_render_samples = 8
    except AttributeError:
        pass
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'PNG'
    return mats


FRAME_OBJECTS = []

def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    FRAME_OBJECTS.append(obj)

def clear_frame():
    for obj in FRAME_OBJECTS:
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except ReferenceError:
            pass
    FRAME_OBJECTS.clear()
    for block in (bpy.data.curves, bpy.data.meshes):
        for datum in list(block):
            if datum.users == 0:
                block.remove(datum)

# ------------------------------ draw primitives ------------------------------

MATS = None

def stroke(points, width, caps=True, mat='ink'):
    """A thick round-capped ink line through the given (x, z) points."""
    if len(points) < 2:
        return
    curve = bpy.data.curves.new('stroke', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = width / 2
    curve.bevel_resolution = 6
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for i, (x, z) in enumerate(points):
        spline.points[i].co = (x, 0, z, 1)
    obj = bpy.data.objects.new('stroke', curve)
    obj.data.materials.append(MATS[mat])
    _link(obj)
    if caps:
        blob(points[0][0], points[0][1], width / 2, mat=mat)
        blob(points[-1][0], points[-1][1], width / 2, mat=mat)

def glow_stroke(points, width, core='ink', halo='glow'):
    """A lit line: dim halo underneath, bright core on top."""
    stroke(points, width * 3.0, caps=False, mat=halo)
    stroke(points, width, caps=True, mat=core)

def quad(pts4, mat):
    """A filled four-corner face — the beam's translucent body."""
    import bmesh
    mesh = bpy.data.meshes.new('quad')
    bm = bmesh.new()
    verts = [bm.verts.new((x, 0, z)) for x, z in pts4]
    bm.faces.new(verts)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('quad', mesh)
    obj.data.materials.append(MATS[mat])
    _link(obj)

def blob(x, z, r, rx=None, tilt=0, mat='ink'):
    """A filled ink dot — also serves as ellipse fills when squashed."""
    if r <= 0.004:
        return
    mesh = bpy.data.meshes.new('blob')
    obj = bpy.data.objects.new('blob', mesh)
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1)
    bm.to_mesh(mesh)
    bm.free()
    obj.scale = (rx if rx is not None else r, 0.02, r)
    obj.rotation_euler = (0, math.radians(tilt), 0)
    obj.location = (x, 0, z)
    obj.data.materials.append(MATS[mat])
    _link(obj)

def ring(x, z, r, width, mat='ink'):
    """A circle outline — the head."""
    n = 48
    pts = [(x + r * math.cos(2 * math.pi * i / n), z + r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
    stroke(pts, width, caps=False, mat=mat)

def ellipse_ring(x, z, rx, rz, width, tilt=0, mat='ink'):
    """An ellipse outline — the saucer body and the beam's ground pool."""
    n = 44
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        px, pz = rot(rx * math.cos(a), rz * math.sin(a), tilt)
        pts.append((x + px, z + pz))
    stroke(pts, width, caps=False, mat=mat)

def arc_ring(x, z, r, a0, a1, width, tilt=0, squash=1.0, mat='ink'):
    """A partial circle — the saucer dome, the crescent moon."""
    n = 22
    pts = []
    for i in range(n + 1):
        a = math.radians(lerp(a0, a1, i / n))
        px, pz = rot(r * math.cos(a), r * math.sin(a) * squash, tilt)
        pts.append((x + px, z + pz))
    stroke(pts, width, caps=False, mat=mat)

def spiral(x, z, turns, r_outer, width, phase=0):
    """A dizzy eye: radius grows with angle. turns→0 collapses it to a dot."""
    if turns < 0.12:
        blob(x, z, max(r_outer * 0.45, 0.032))
        return
    n = max(int(turns * 16), 6)
    pts = []
    for i in range(n + 1):
        f = i / n
        a = phase + f * turns * 2 * math.pi
        r = 0.05 * r_outer + f * r_outer * 0.95
        pts.append((x + r * math.cos(a), z + r * math.sin(a)))
    stroke(pts, width)

def squiggle(x, z_top, length, width, grown=1.0, wob=0.16, mat='ink'):
    """One of the logo's fall streaks, drawn to `grown` of its full length."""
    if grown <= 0.02:
        return
    n = 14
    pts = []
    for i in range(n + 1):
        f = i / n
        pts.append((x + wob * math.sin(f * math.pi * 2.2), z_top - length * grown * f))
    stroke(pts, width, mat=mat)

def cup(x, z, size, tilt, steam=0.0, handle_deg=0.0):
    """The coffee mug. `handle_deg` walks the handle around the body — 0 puts
    it on the right like the logo, 180 puts it on the left, into a grip."""
    w, h = size, size * 0.82
    corners = [(-w / 2, h / 2), (w / 2, h / 2), (w / 2, -h / 2), (-w / 2, -h / 2), (-w / 2, h / 2)]
    pts = [(x + rot(px, pz, tilt)[0], z + rot(px, pz, tilt)[1]) for px, pz in corners]
    stroke(pts, size * 0.30, caps=False)
    n = 10
    arc = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        px, pz = rot(w / 2 + size * 0.2 * (1 + math.cos(a)) / 2 * 1.4, size * 0.28 * math.sin(a), tilt + handle_deg)
        arc.append((x + px, z + pz))
    stroke(arc, size * 0.16, caps=False)
    if steam > 0.02:
        sx, sz = rot(0, h / 2 + size * 0.3, tilt)
        blob(x + sx, z + sz + steam * 0.22, 0.045 * steam)
        blob(x + sx + 0.12, z + sz + 0.16 + steam * 0.3, 0.035 * steam)

def saucer(x, z, tilt):
    """The visitor: warm hull, cool glowing under-lights."""
    ellipse_ring(x, z, 1.35, 0.40, 0.15, tilt)
    arc_ring(x, z + 0.16, 0.66, 12, 168, 0.13, tilt, squash=1.25)
    for ox in (-0.62, 0.0, 0.62):
        px, pz = rot(ox, -0.30, tilt)
        blob(x + px, z + pz, 0.13, mat='coolglow')
        blob(x + px, z + pz, 0.075, mat='cool')

def beam(ship_x, ship_z, grown, t, gz):
    """A volume of light, not an outline: nested translucent fills give the
    cone a luminous body, crisp cool edges keep it graphic. `gz` is wherever
    the ground currently is — as it recedes, the cone stretches after it."""
    if grown <= 0.02:
        return
    ez = lerp(ship_z, gz + 0.02, grown)
    for inner in (1.0, 0.78, 0.55, 0.32):
        tl, tr = ship_x - 0.52 * inner, ship_x + 0.52 * inner
        bl = lerp(tl, ship_x - 1.95 * inner, grown)
        br = lerp(tr, ship_x + 1.95 * inner, grown)
        quad([(tl, ship_z), (tr, ship_z), (br, ez), (bl, ez)], 'beam_fill')
    for tx, bx in ((ship_x - 0.52, ship_x - 1.95), (ship_x + 0.52, ship_x + 1.95)):
        glow_stroke([(tx, ship_z), (lerp(tx, bx, grown), ez)], 0.09, core='cool', halo='coolglow')
    if grown > 0.9:
        if gz > -5.2:
            ellipse_ring(ship_x, gz + 0.02, 1.72, 0.2, 0.28, mat='coolglow')
            ellipse_ring(ship_x, gz + 0.02, 1.72, 0.2, 0.09, mat='cool')
        # weightless dust drifting up the column
        low = max(gz + 0.4, -4.4)
        for i, ox in enumerate((-0.55, 0.05, 0.6)):
            phase = (t * 0.45 + i * 0.37) % 1.0
            dzp = lerp(low, ship_z - 0.5, phase)
            fade = math.sin(phase * math.pi)
            stroke([(ship_x + ox, dzp), (ship_x + ox, dzp + 0.22 * fade + 0.03)], 0.05, mat='coolglow')

# A fixed night sky. Parallax pulls it away slower than the ground during the
# fall — the depth cue that makes the drop feel real — and it is gone before
# the logo settles, so the final frame stays exactly the logo.
# Placed clear of the saucer's hover spot and the beam column, so nothing
# twinkles through the hull or the character.
STARS = [
    (-4.55, 4.35, 0.030), (-3.7, 2.6, 0.022), (-2.9, 3.55, 0.026), (-2.2, 1.75, 0.020),
    (-1.5, 4.45, 0.024), (-2.6, 2.05, 0.020), (-0.35, 4.62, 0.028), (2.2, 1.35, 0.020),
    (1.9, 3.3, 0.024), (2.75, 2.2, 0.021), (3.5, 4.5, 0.030), (4.3, 3.1, 0.024),
    (4.65, 1.6, 0.020), (-4.1, 1.3, 0.019), (2.3, 4.6, 0.021), (-1.9, 3.95, 0.018),
    # the low sky, now that the ground sits near the bottom of frame
    (-4.35, -0.7, 0.022), (4.5, -1.3, 0.020), (-3.4, -2.2, 0.018), (3.9, -2.6, 0.019),
]
TWINKLERS = {2: 1.7, 6: 2.3, 10: 1.3, 12: 2.9, 17: 2.1}

def night_sky(t, dz, drop=0.0):
    # The sky bows out during the fall — parallax first, then a clean fade so
    # the final frame holds nothing but the logo.
    fade = 1 - smooth(span(dz, 1.2, 4.6))
    if fade <= 0.02:
        return
    # Distant, so it moves less than the world: down a little as he ascends,
    # up a little as he falls.
    lift = dz * 0.55 - drop * 0.9
    for i, (sx, sz, r) in enumerate(STARS):
        z = sz + lift
        if z > 5.3:
            continue
        tw = 1.0 + 0.5 * math.sin(t * TWINKLERS[i] * 2 + i) if i in TWINKLERS else 1.0
        blob(sx, z, r * tw * fade, mat='cool')
        if i in TWINKLERS and fade > 0.5:
            stroke([(sx - 0.09 * tw, z), (sx + 0.09 * tw, z)], 0.018, caps=False, mat='coolglow')
            stroke([(sx, z - 0.09 * tw), (sx, z + 0.09 * tw)], 0.018, caps=False, mat='coolglow')
    # a thin crescent, high right, clear of the saucer's path — the most
    # distant thing in frame, so it barely moves at all
    mz = 4.35 + dz * 0.35 - drop * 0.45
    if mz < 5.6 and fade > 0.4:
        arc_ring(4.05, mz, 0.42, -55, 125, 0.055, mat='cool')
        arc_ring(4.17, mz + 0.075, 0.33, -40, 115, 0.045, mat='cool')

# --------------------------------- the pose ----------------------------------

THIGH, SHIN = 0.50, 0.55
UPPER, FORE = 0.40, 0.36
NECK_Z = 0.90
HEAD_OFF = (0.05, 1.36)
HEAD_R = 0.46
SHOULDER_Z = 0.76
STROKE_W = 0.155

STAND_X = -0.1
STAND_HIP_Z = GROUND_Z + THIGH + SHIN - 0.02
UFO_HOME = (0.15, 3.75)
# Mid-air, centre frame: over two units of empty night below his feet, over a
# unit of night above his hair — unmistakably floating.
FLOAT_HIP = (0.12, -0.2)
# And he never stops rising: the abduction is still happening while he sips.
FLOAT_DRIFT = 0.35

def float_z(t):
    rise_done = clamp(t - LIFT[1], 0, BEAM_CUT[0] - LIFT[1])
    return FLOAT_HIP[1] + FLOAT_DRIFT * rise_done + 0.11 * math.sin(t * 1.6)

# Where the fall must land: the logo. Solved against the logo's world-space
# directions and tuned by render-and-compare — do not nudge casually.
FINAL = {
    'scale': 2.45,
    'theta': 250.0,
    'hip': (0.82, 0.35),
    'legA': (35, -20),
    'legB': (-11, -22),
    'armCup': (55, 18),
    'armB': (-128, 15),
    'foot_r': 0.34,
    'eye_turns': 2.1,
    'eye_r': 0.14,
    'head_tilt': 100.0,
    'belly': -0.28,
}

def beam_amount(t):
    """1 while the beam holds him; a dying flicker at the cut."""
    if t < BEAM_ON:
        return 0.0
    if t < BEAM_CUT[0]:
        return smooth(span(t, BEAM_ON, BEAM_ON + 0.28))
    if t < BEAM_CUT[1]:
        # three hard blinks, then dark
        return 1.0 if int((t - BEAM_CUT[0]) / 0.053) % 2 == 0 else 0.0
    return 0.0

def wrist_world(p):
    """Where the mug will sit once gripped — handle at the hand, body to the
    right of it. The same arithmetic draw() uses, so the floating mug steers
    itself exactly into the grip with no jump at the moment of the catch."""
    c1, c2 = p['armCup']
    elb = (UPPER * math.sin(math.radians(c1)), SHOULDER_Z - UPPER * math.cos(math.radians(c1)))
    wr = (elb[0] + FORE * math.sin(math.radians(c1 + c2)), elb[1] - FORE * math.cos(math.radians(c1 + c2)))
    rx, rz = rot(wr[0], wr[1], p['theta'])
    return (p['hip'][0] + rx * p['scale'] + 0.26 * p['scale'],
            p['hip'][1] + rz * p['scale'])

def pose(t):
    p = {}
    idle = math.sin(t * 2.1)

    # --- standing in the night, hands empty, coffee on the ground beside him
    p['scale'] = 1.0
    p['theta'] = 1.5 * idle * (1 - span(t, 2.0, 2.4))
    p['hip'] = (STAND_X, STAND_HIP_Z + 0.015 * idle)
    p['legA'] = (-7, -8)
    p['legB'] = (9, -10)
    p['armB'] = (10 + 3 * idle, 14)
    p['armCup'] = (8 + 2 * idle, 6)   # just an arm, hanging like one
    p['foot_r'] = 0.075
    p['eye_turns'] = 0.0
    p['eye_r'] = 0.05
    p['mouth'] = (0.15, 0.025)
    p['head_tilt'] = 0.0
    p['belly'] = 0.06
    p['steam'] = 0.6 + 0.4 * math.sin(t * 3.0)
    p['ground_dz'] = 0.0
    # Once he has his coffee, the saucer climbs: the camera stays with him and
    # the ground sinks out of frame — by the time the beam cuts he is hanging
    # in open sky, and the fall is a fall from altitude.
    p['ground_drop'] = ease_in(span(t, 3.6, 4.55))
    p['streaks'] = 0.0
    p['drops'] = 0.0
    p['dream'] = []
    p['bang'] = 0.0

    # --- the visitor --------------------------------------------------------
    arrive = smooth(span(t, *UFO_IN))
    if t < FALL + 0.05:
        ux = lerp(-6.4, UFO_HOME[0], arrive)
        uz = lerp(4.6, UFO_HOME[1], arrive) + 0.07 * math.sin(t * 2.3) * arrive
        ut = lerp(-9, 0, arrive) + 2.0 * math.sin(t * 1.7) * arrive
    else:
        # startled exit, stage right, gone before the logo settles
        flee = ease_in(span(t, FALL + 0.05, FALL + 0.5))
        ux = lerp(UFO_HOME[0], 7.6, flee)
        uz = lerp(UFO_HOME[1], 5.0, flee)
        ut = lerp(0, 16, flee)
    p['ufo'] = (ux, uz, ut) if t >= UFO_IN[0] and t < FALL + 0.55 else None
    p['beam'] = beam_amount(t)

    # he notices the beam
    p['bang'] = smooth(span(t, BEAM_ON, BEAM_ON + 0.15)) * (1 - smooth(span(t, BEAM_ON + 0.5, BEAM_ON + 0.8)))
    if BEAM_ON - 0.3 < t < LIFT[0] + 0.4:
        p['head_tilt'] = -14 * smooth(span(t, BEAM_ON - 0.2, BEAM_ON + 0.2))

    # --- lifted: weightless, dangling, entirely unbothered ------------------
    if t >= LIFT[0]:
        rise = smooth(span(t, *LIFT))
        sway = math.sin((t - LIFT[0]) * 1.3)
        p['hip'] = (lerp(STAND_X, FLOAT_HIP[0], rise),
                    lerp(STAND_HIP_Z, float_z(t), rise))
        p['theta'] = lerp(p['theta'], 7 * sway, rise)
        dangle = rise
        # limp legs, toes pointed — hanging, not standing
        p['legA'] = (lerp(-7, 12 + 5 * math.sin(t * 1.5), dangle), lerp(-8, -34 - 7 * math.sin(t * 1.2), dangle))
        p['legB'] = (lerp(9, -7 + 5 * math.sin(t * 1.5 + 1.1), dangle), lerp(-10, -30 - 7 * math.sin(t * 1.4 + 0.7), dangle))
        p['armB'] = (lerp(p['armB'][0], -58 + 7 * sway, dangle), lerp(22, 12, dangle))
        p['head_tilt'] = lerp(p['head_tilt'], 3 * sway, rise)

    # --- reach, grab, drink: real elbows only -------------------------------
    # Reaching: upper arm swings forward-down toward the incoming mug.
    reach = smooth(span(t, GRAB - 0.15, GRAB + 0.1))
    if reach > 0:
        a1, a2 = p['armCup']
        p['armCup'] = (lerp(a1, 42, reach), lerp(a2, 14, reach))
    # Drinking, in three readable acts. Raise: the elbow flexes and brings the
    # mug to the lips. Tip: the CUP rotates toward him while the head tilts
    # back to meet it — the beat that actually says "drinking" — and the mouth
    # hides behind the mug. Lower: cup comes away, and a little "ahh".
    p['cup_tip'] = 0.0
    if t >= DRINK[0]:
        raise_f = smooth(span(t, DRINK[0], DRINK[0] + 0.25))
        tip = smooth(span(t, DRINK[0] + 0.25, DRINK[0] + 0.5)) * (1 - smooth(span(t, DRINK[1] - 0.22, DRINK[1] - 0.05)))
        lower = smooth(span(t, DRINK[1] - 0.12, DRINK[1]))
        a1, a2 = p['armCup']
        p['armCup'] = (lerp(lerp(a1, 24, raise_f), 30, lower), lerp(lerp(a2, 138, raise_f), 96, lower))
        p['armB'] = (lerp(p['armB'][0], -72, raise_f * (1 - lower)), lerp(p['armB'][1], 10, raise_f))
        p['head_tilt'] += 16 * tip
        p['cup_tip'] = tip
        # mouth vanishes behind the tipped mug, then a small round "ahh" after
        mrx, mry = p['mouth']
        ahh = smooth(span(t, DRINK[1], DRINK[1] + 0.1)) * (1 - smooth(span(t, DRINK[1] + 0.32, DRINK[1] + 0.42)))
        p['mouth'] = (lerp(lerp(mrx, 0.05, tip), 0.06, ahh), lerp(mry * (1 - 0.92 * tip), 0.062, ahh))

    for born in (4.0, 4.25, 4.5):
        life = t - born
        if 0 < life < 1.0:
            grow = smooth(span(life, 0, 0.18)) * (1 - smooth(span(life, 0.6, 1.0)))
            p['dream'].append((0.55 + life * 0.3, 2.1 + life * 0.6, 0.05 + 0.035 * life, grow))

    # --- the mug itself ------------------------------------------------------
    # It sits steaming on the ground, gets caught in the beam a beat after he
    # does, wobbles up through the air, and steers into his waiting hand.
    if t < GRAB:
        ground_pos = (STAND_X + 0.85, GROUND_Z + 0.19)
        rise = smooth(span(t, LIFT[0] + 0.3, GRAB))
        wob = math.sin(t * 2.6) * 9 * rise
        target = wrist_world(p)
        pos = (lerp(ground_pos[0], target[0], rise),
               lerp(ground_pos[1], target[1], rise) + 0.10 * math.sin(t * 2.1) * rise * (1 - rise) * 4)
        p['cup'] = {'held': False, 'pos': pos, 'tilt': wob, 'steam': 0.5 + 0.3 * math.sin(t * 2.8)}
    else:
        p['cup'] = {'held': True}

    # a small startle as the beam dies — then the held breath before the drop:
    # he glances down, pulls his legs in, sags a hand-width. Anticipation is
    # what makes the fall land; without it the drop just happens.
    if BEAM_CUT[0] <= t < FALL:
        p['bang'] = smooth(span(t, BEAM_CUT[0], BEAM_CUT[0] + 0.1))
        p['theta'] += -5 * smooth(span(t, BEAM_CUT[0], BEAM_CUT[1]))
        tuck = smooth(span(t, BEAM_CUT[1] - 0.02, FALL))
        p['legA'] = (p['legA'][0] + 16 * tuck, p['legA'][1] - 12 * tuck)
        p['legB'] = (p['legB'][0] + 12 * tuck, p['legB'][1] - 10 * tuck)
        p['head_tilt'] += 12 * tuck
        p['hip'] = (p['hip'][0], p['hip'][1] - 0.09 * tuck)

    # --- the fall: one long morph into the logo -----------------------------
    if t >= FALL:
        f_move = smooth(span(t, FALL, FALL + 1.15))
        f_spin = span(t, FALL, FALL + 1.05)
        f_limbs = smooth(span(t, FALL + 0.05, FALL + 0.85))
        f_face = smooth(span(t, FALL + 0.15, FALL + 0.65))

        start_theta = 7 * math.sin((FALL - LIFT[0]) * 1.3) - 5
        theta = lerp(start_theta, FINAL['theta'], smooth(f_spin))
        if t > FALL + 1.15:
            theta += 7 * math.exp(-4.5 * (t - FALL - 1.15)) * math.sin((t - FALL - 1.15) * 2 * math.pi * 1.6)
        p['theta'] = theta

        start_hip = (FLOAT_HIP[0], float_z(FALL) - 0.09)
        p['hip'] = (lerp(start_hip[0], FINAL['hip'][0], ease_out(f_move)),
                    lerp(start_hip[1], FINAL['hip'][1], f_move))
        p['scale'] = lerp(1.0, FINAL['scale'], smooth(span(t, FALL + 0.05, FALL + 1.2)))

        p['legA'] = (lerp(p['legA'][0], FINAL['legA'][0], f_limbs), lerp(p['legA'][1], FINAL['legA'][1], f_limbs))
        p['legB'] = (lerp(p['legB'][0], FINAL['legB'][0], f_limbs), lerp(p['legB'][1], FINAL['legB'][1], f_limbs))
        armlag = smooth(span(t, FALL + 0.15, FALL + 0.95))
        p['armB'] = (lerp(p['armB'][0], FINAL['armB'][0], armlag), lerp(p['armB'][1], FINAL['armB'][1], armlag))
        p['armCup'] = (lerp(p['armCup'][0], FINAL['armCup'][0], armlag), lerp(p['armCup'][1], FINAL['armCup'][1], armlag))

        p['foot_r'] = lerp(0.075, FINAL['foot_r'], f_limbs)
        p['eye_turns'] = FINAL['eye_turns'] * f_face
        p['eye_r'] = lerp(0.05, FINAL['eye_r'], f_face)
        p['mouth'] = (lerp(0.15, 0.115, f_face), lerp(0.025, 0.185, f_face))
        # The face counter-rotates as the body tumbles, landing upright the
        # way the logo holds it.
        p['head_tilt'] = lerp(p['head_tilt'], FINAL['head_tilt'], smooth(f_spin))
        p['belly'] = lerp(0.06, FINAL['belly'], f_limbs)
        p['steam'] = 0.0
        p['ground_dz'] = 9.6 * smooth(span(t, FALL + 0.05, FALL + 0.55))
        p['streaks'] = span(t, FALL + 0.1, FALL + 0.7)
        p['drops'] = span(t, FALL + 0.2, FALL + 1.1)
        p['dream'] = []
        p['bang'] = 0.0
        p['beam'] = 0.0

    return p

# --------------------------------- drawing -----------------------------------

def draw_ghost(p):
    """A dim silhouette of the character — limbs, spine, head — nothing else.
    Drawn beneath the real frame as a smear of where he just was."""
    s, theta, hip = p['scale'], p['theta'], p['hip']

    def W(lx, lz):
        rx, rz = rot(lx, lz, theta)
        return (hip[0] + rx * s, hip[1] + rz * s)

    w = STROKE_W * s
    for key in ('legA', 'legB'):
        a_thigh, a_shin = p[key]
        knee = (THIGH * math.sin(math.radians(a_thigh)), -THIGH * math.cos(math.radians(a_thigh)))
        foot_a = a_thigh + a_shin
        foot = (knee[0] + SHIN * math.sin(math.radians(foot_a)), knee[1] - SHIN * math.cos(math.radians(foot_a)))
        stroke([W(0, 0), W(*knee), W(*foot)], w, mat='glow')
    spine = catmull([(0, 0), (p['belly'], NECK_Z * 0.5), (0.02, NECK_Z)], 6)
    stroke([W(px, pz) for px, pz in spine], w * 1.1, mat='glow')
    hx, hz = W(*HEAD_OFF)
    ring(hx, hz, HEAD_R * s, w, mat='glow')

def draw(p, t):
    s, theta = p['scale'], p['theta']
    hip = p['hip']

    def W(lx, lz):
        rx, rz = rot(lx, lz, theta)
        return (hip[0] + rx * s, hip[1] + rz * s)

    w = STROKE_W * s

    # the night behind everything: distant, so it drifts down gently during
    # the ascent and up gently during the fall — parallax both ways
    drop = p.get('ground_drop', 0.0)
    dz = p['ground_dz']
    night_sky(t, dz, drop)

    # solid ground: sinks away as the saucer climbs, and never comes back
    gz_eff = GROUND_Z - 3.4 * drop
    if drop < 0.999:
        stroke([(-5.6, gz_eff), (5.6, gz_eff)], 0.17)

    # the visitor and its beam — the cone stretches after the receding ground
    if p['beam'] > 0 and p['ufo']:
        beam(p['ufo'][0], p['ufo'][1] - 0.42, p['beam'], t, gz_eff)
    if p['ufo']:
        ux, uz, ut = p['ufo']
        saucer(ux, uz + dz, ut)

    # fall streaks, born mid-air, settling into the logo's five — they flash
    # for a breath at the moment the logo locks in
    if p['streaks'] > 0:
        drift = (1 - smooth(p['streaks'])) * 0.9
        flashing = IMPACT <= t <= IMPACT + 0.2
        for i, (sx, sz, ln) in enumerate([(-2.9, 4.5, 2.0), (-1.0, 4.75, 1.9), (1.05, 4.6, 2.1), (3.0, 3.9, 1.7), (3.75, -0.2, 1.6)]):
            g = smooth(span(p['streaks'], 0.12 * i, 0.12 * i + 0.5))
            top = sz + drift * (1 + i * 0.2)
            if flashing:
                squiggle(sx, top, ln, 0.42, grown=g, mat='glow')
            squiggle(sx, top, ln, 0.16, grown=g)

    # the shockwave of the landing: one ring, expanding and thinning
    ripple = span(t, IMPACT, IMPACT + 0.42)
    if 0 < ripple < 1:
        rr = 0.7 + 3.4 * ease_out(ripple)
        ellipse_ring(hip[0], hip[1], rr, rr * 0.36, 0.12 * (1 - ripple) + 0.015, mat='coolglow')

    # smear echoes through the fastest part of the tumble — the 2D animator's
    # motion blur, two fading silhouettes a few frames behind
    if FALL + 0.12 <= t <= FALL + 0.8:
        for dt in (0.07, 0.035):
            draw_ghost(pose(t - dt))

    # legs
    for key in ('legA', 'legB'):
        a_thigh, a_shin = p[key]
        knee = (THIGH * math.sin(math.radians(a_thigh)), -THIGH * math.cos(math.radians(a_thigh)))
        foot_a = a_thigh + a_shin
        foot = (knee[0] + SHIN * math.sin(math.radians(foot_a)), knee[1] - SHIN * math.cos(math.radians(foot_a)))
        stroke([W(0, 0), W(*knee), W(*foot)], w)
        fx, fz = W(*foot)
        blob(fx, fz, p['foot_r'] * s)

    # spine — a living curve; the tumble swings it out into the logo's sag
    spine = catmull([(0, 0), (p['belly'], NECK_Z * 0.5), (0.02, NECK_Z)], 8)
    stroke([W(px, pz) for px, pz in spine], w * 1.1)

    # back arm
    b1, b2 = p['armB']
    elb = (UPPER * math.sin(math.radians(b1)), SHOULDER_Z - UPPER * math.cos(math.radians(b1)))
    hnd = (elb[0] + FORE * math.sin(math.radians(b1 + b2)), elb[1] - FORE * math.cos(math.radians(b1 + b2)))
    stroke([W(0, SHOULDER_Z), W(*elb), W(*hnd)], w * 0.92)

    # cup arm — and the mug, wherever it currently is: on the ground, floating
    # up the beam, or in his hand
    c1, c2 = p['armCup']
    elb = (UPPER * math.sin(math.radians(c1)), SHOULDER_Z - UPPER * math.cos(math.radians(c1)))
    wrist = (elb[0] + FORE * math.sin(math.radians(c1 + c2)), elb[1] - FORE * math.cos(math.radians(c1 + c2)))
    stroke([W(0, SHOULDER_Z), W(*elb), W(*wrist)], w * 0.92)
    cx, cz = W(*wrist)
    cx += 0.05 * s
    cz += 0.20 * s
    held = p['cup']['held'] if 'cup' in p else True
    if held:
        size = 0.42 * s
        tip = p.get('cup_tip', 0.0)
        base_tilt = -theta * 0.15 if theta < 80 else lerp(-12, -16, span(theta, 80, 250))
        total_tilt = base_tilt - 56 * tip
        # A real grip: the handle faces his hand, the fist wraps it, and when
        # the mug tips it pivots around the grip — not around thin air. Under
        # the tumble the handle walks back to the logo's right-hand side and
        # the hold eases into the logo's palm-under-cup arrangement.
        logo_blend = smooth(span(theta, 90, 200))
        hd = 180 * (1 - logo_blend)
        wx, wz = W(*wrist)
        gripx = wx - rot(0.62 * size, 0, hd + total_tilt)[0]
        gripz = wz - rot(0.62 * size, 0, hd + total_tilt)[1]
        ccx = lerp(gripx, wx + 0.05 * s, logo_blend)
        ccz = lerp(gripz, wz + 0.20 * s, logo_blend)
        blob(wx, wz, 0.095 * s)  # the fist on the handle
        cup(ccx, ccz, size, total_tilt, steam=p['steam'] + 0.4 * tip, handle_deg=hd)
        cx, cz = ccx, ccz  # droplets anchor to the mug, wherever it is
    else:
        info = p['cup']
        cup(info['pos'][0], info['pos'][1], 0.42, info['tilt'], steam=info['steam'])

    # droplets escaping the cup during the fall, floating up into the logo's
    if p['drops'] > 0:
        rise = smooth(p['drops'])
        for i, (ox, oz, r) in enumerate([(-0.02, 0.30, 0.05), (0.13, 0.45, 0.065), (-0.13, 0.48, 0.045), (0.03, 0.62, 0.05)]):
            g = smooth(span(p['drops'], 0.14 * i, 0.14 * i + 0.4))
            blob(cx + ox * s, cz + (0.22 + oz * rise) * s, r * s * g)

    # head
    hx, hz = W(*HEAD_OFF)
    tilt = theta + p['head_tilt']
    ring(hx, hz, HEAD_R * s, w)

    def on_head(lx, lz):
        rx, rz = rot(lx, lz, tilt)
        return (hx + rx * s, hz + rz * s)

    for a in (118, 92, 66, 40):
        bx, bz = on_head(HEAD_R * math.cos(math.radians(a)), HEAD_R * math.sin(math.radians(a)))
        tx, tz = on_head((HEAD_R + 0.20) * math.cos(math.radians(a)), (HEAD_R + 0.20) * math.sin(math.radians(a)))
        stroke([(bx, bz), (tx, tz)], w * 0.55)

    for side in (-1, 1):
        ex, ez = on_head(side * 0.19 + 0.03, 0.08)
        spiral(ex, ez, p['eye_turns'], p['eye_r'] * s, w * 0.34, phase=0 if side < 0 else math.pi)

    mrx, mry = p['mouth']
    mx, mz = on_head(0.04, -0.21)
    blob(mx, mz, mry * s, rx=mrx * s, tilt=tilt)

    # transient thoughts
    for dx, dz_, r, grow in p['dream']:
        wx, wz = W(dx, dz_)
        blob(wx, wz, r * s * grow)
    if p['bang'] > 0.02:
        bx, bz = W(0.55, 1.95)
        stroke([(bx, bz), (bx + 0.06, bz + 0.34 * p['bang'])], w * 0.5)
        blob(bx - 0.02, bz - 0.14, 0.045 * p['bang'] * s)

# ---------------------------------- render -----------------------------------

def render_time(t, filepath):
    clear_frame()
    # A slow push-in across the whole film — the cinematic drift every ident
    # has, subtle enough that you feel it rather than see it.
    CAM.data.ortho_scale = 10.35 - 0.55 * smooth(t / DURATION)
    # The landing kicks the camera: a sharp decaying tremor, two axes out of
    # phase so it reads as a jolt rather than a wobble.
    if t >= IMPACT:
        amp = 0.055 * math.exp(-(t - IMPACT) * 6.5)
        CAM.location = (amp * math.sin(t * 87), -10, 0.6 * amp * math.cos(t * 71))
    else:
        CAM.location = (0, -10, 0)
    draw(pose(t), t)
    bpy.context.scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)

def main():
    global MATS
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    MATS = build_stage()
    os.makedirs(BUILD, exist_ok=True)

    if argv and argv[0] == '--stills':
        for t in [float(x) for x in argv[1].split(',')]:
            render_time(t, os.path.join(BUILD, f'still_{t:.2f}.png'))
        return

    total = int(DURATION * FPS)
    for i in range(total):
        t = i / FPS
        render_time(t, os.path.join(BUILD, f'f{i:04d}.png'))
        if i % 30 == 0:
            print(f'  frame {i}/{total}', flush=True)
    render_time(POSTER_TIME, POSTER)
    print('frames done', flush=True)

main()
