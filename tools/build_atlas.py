#!/usr/bin/env python3
"""
build_atlas.py - pack the frames listed in atlas.json into one normalised sprite atlas.

    python3 tools/build_atlas.py            # writes assets/atlas.png + assets/atlas.json

Each frame is scaled so a standing character is `target_h` px tall (so frames from different
sheets match), then shelf-packed. The anchor (ax, ay) is the point on the ground between the
feet: bottom of the frame, horizontal centre of mass. The engine pins that point to the pet's
(x, y) so walk cycles do not jitter.
"""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = json.load(open(os.path.join(ROOT, "atlas.json")))
T = spec["target_h"]
PAD = 2
MAX_W = 1024

items = []
for name, (sheet, idx) in spec["frames"].items():
    p = os.path.join(ROOT, "frames", sheet, f"{idx:03d}.png")
    if not os.path.exists(p):
        sys.exit(f"missing {p} (for {name}) - run tools/segment.py on {sheet} first")
    im = Image.open(p).convert("RGBA")
    s = T / spec["sheets"][sheet]["ref_h"]
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    im = im.resize((w, h), Image.LANCZOS)
    a = np.array(im)[:, :, 3].astype(float)
    # drop faint fringe left by resampling
    a[a < 40] = 0
    arr = np.array(im)
    arr[:, :, 3] = a.astype(np.uint8)
    arr[arr[:, :, 3] == 0] = 0
    im = Image.fromarray(arr, "RGBA")
    cols = a.sum(axis=0)
    ax = float((cols * np.arange(w)).sum() / max(cols.sum(), 1))
    items.append((name, im, ax))

# shelf packing, tallest first
items.sort(key=lambda t: -t[1].height)
x = y = rowh = 0
placed = {}
for name, im, ax in items:
    if x + im.width + PAD > MAX_W:
        x, y, rowh = 0, y + rowh + PAD, 0
    placed[name] = (x, y, im, ax)
    x += im.width + PAD
    rowh = max(rowh, im.height)
H = y + rowh
atlas = Image.new("RGBA", (MAX_W, H), (0, 0, 0, 0))
meta = {}
for name, (x, y, im, ax) in placed.items():
    atlas.alpha_composite(im, (x, y))
    meta[name] = {"x": x, "y": y, "w": im.width, "h": im.height, "ax": round(ax, 1), "ay": im.height}

os.makedirs(os.path.join(ROOT, "assets"), exist_ok=True)
# palette-quantise (pixel art loves it) to keep the single-file build small
q = atlas.quantize(colors=128, method=Image.FASTOCTREE, dither=Image.NONE)
q.save(os.path.join(ROOT, "assets", "atlas.png"), optimize=True)
atlas.save(os.path.join(ROOT, "assets", "atlas_full.png"), optimize=True)
json.dump({"w": MAX_W, "h": H, "target_h": T, "frames": meta},
          open(os.path.join(ROOT, "assets", "atlas.json"), "w"), indent=1)
print(f"{len(meta)} frames -> assets/atlas.png ({MAX_W}x{H}), {os.path.getsize(os.path.join(ROOT,'assets','atlas.png'))//1024} KB")
