#!/usr/bin/env python3
"""build.py - bake engine + atlas + animations into ONE self-contained file: dist/arijit.js

    python3 tools/build_atlas.py   # (only when sprites changed)
    python3 build.py
"""
import base64, json, os
R = os.path.dirname(os.path.abspath(__file__))
src = open(f"{R}/src/engine.js").read()
atlas = json.load(open(f"{R}/assets/atlas.json"))
anims = json.load(open(f"{R}/src/animations.json"))
anims = {k: v for k, v in anims.items() if not k.startswith("_")}
for k, v in anims.items():
    missing = [f for f in v["frames"] if f not in atlas["frames"]]
    if missing:
        raise SystemExit(f"animation '{k}' uses unknown frames: {missing}")
png = base64.b64encode(open(f"{R}/assets/atlas.png", "rb").read()).decode()
out = (src.replace("__ATLAS__", json.dumps(atlas, separators=(",", ":")))
          .replace("__ATLAS_URL__", json.dumps("data:image/png;base64," + png))
          .replace("__ANIMS__", json.dumps(anims, separators=(",", ":"))))

open(f"{R}/arijit.js", "w").write(out)
print("arijit.js", len(out) // 1024, "KB")
