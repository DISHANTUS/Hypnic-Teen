# Encodes the rendered frames into public/media/intro.mp4 using Blender's own
# sequencer — no ffmpeg install needed.
#
#   G:\Blender\blender.exe -b --factory-startup -P tools/intro-encode.py

import bpy
import os

FPS = 30
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build-media')
OUT = os.path.join(ROOT, 'public', 'media', 'intro.mp4')

frames = sorted(f for f in os.listdir(BUILD) if f.startswith('f') and f.endswith('.png'))
if not frames:
    raise SystemExit('no frames in ' + BUILD)

scene = bpy.context.scene
scene.render.resolution_x = 1080
scene.render.resolution_y = 1080
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = len(frames)

editor = scene.sequence_editor_create()
# 4.x calls the collection `sequences`; newer Blenders rename it `strips`.
strips = getattr(editor, 'sequences', None) or getattr(editor, 'strips', None)
strip = strips.new_image('film', os.path.join(BUILD, frames[0]), 1, 1)
for name in frames[1:]:
    strip.elements.append(name)
strip.frame_final_duration = len(frames)

scene.render.image_settings.file_format = 'FFMPEG'
scene.render.ffmpeg.format = 'MPEG4'
scene.render.ffmpeg.codec = 'H264'
scene.render.ffmpeg.constant_rate_factor = 'HIGH'
scene.render.ffmpeg.gopsize = 15
scene.render.filepath = OUT

bpy.ops.render.render(animation=True)
print('encoded', OUT, os.path.getsize(OUT), 'bytes')
