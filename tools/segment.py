#!/usr/bin/env python3
"""
segment.py - cut a sprite sheet into individual frames.

Usage:
    python3 tools/segment.py sheets/sheet01.png            # writes frames/sheet01/NNN.png + contact sheet
    python3 tools/segment.py sheets/new.png --min-h 30

Output:
    frames/<sheet>/<NNN>.png        transparent-background crops (reading order: top->bottom, left->right)
    frames/<sheet>/_contact.png     numbered overview so you can see which index is which
    frames/<sheet>/_index.json      bbox + size for every frame
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi


def estimate_bg(rgb):
    # sheets use a flat-ish beige. use the mode of a coarse-quantised histogram.
    q = (rgb // 8).reshape(-1, 3)
    keys, counts = np.unique(q, axis=0, return_counts=True)
    return keys[counts.argmax()] * 8 + 4


def foreground_mask(rgb, bg, thr):
    d = np.abs(rgb.astype(int) - bg.astype(int)).sum(axis=2)
    return d > thr


def segment(path, thr=60, min_h=22, min_area=120, gap=5, row_tol=0.6):
    img = Image.open(path).convert("RGB")
    rgb = np.array(img)
    bg = estimate_bg(rgb)
    mask = foreground_mask(rgb, bg, thr)
    mask = ndi.binary_opening(mask, iterations=1)
    # merge parts of the same sprite (arms, shoes, bubbles) but not neighbouring sprites
    merged = ndi.binary_dilation(mask, structure=np.ones((3, 3)), iterations=gap)
    lab, n = ndi.label(merged)
    objs = ndi.find_objects(lab)
    boxes = []
    for i, sl in enumerate(objs):
        ys, xs = sl
        comp = (lab[sl] == i + 1) & mask[sl]
        area = int(comp.sum())
        h, w = ys.stop - ys.start, xs.stop - xs.start
        if area < min_area or h < min_h:
            continue
        boxes.append([xs.start, ys.start, xs.stop, ys.stop, area])
    return img, rgb, bg, mask, boxes


def sort_reading_order(boxes, row_tol=0.55):
    boxes = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    rows = []
    for b in boxes:
        cy = (b[1] + b[3]) / 2
        for r in rows:
            ry = np.mean([(q[1] + q[3]) / 2 for q in r])
            rh = np.mean([q[3] - q[1] for q in r])
            if abs(cy - ry) < rh * row_tol:
                r.append(b)
                break
        else:
            rows.append([b])
    out = []
    for r in rows:
        out.extend(sorted(r, key=lambda b: b[0]))
    return out


def cutout(rgb, mask_full, box, bg, pad=2):
    x0, y0, x1, y1 = box[:4]
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(rgb.shape[1], x1 + pad); y1 = min(rgb.shape[0], y1 + pad)
    crop = rgb[y0:y1, x0:x1].astype(int)
    # soft alpha from distance to background colour -> clean edges, no beige halo
    d = np.abs(crop - bg.astype(int)).sum(axis=2)
    # pixels well inside the sprite are fully opaque; fill holes so light shoes/eyes stay solid
    solid = d > 45
    solid = ndi.binary_closing(solid, iterations=2)
    solid = ndi.binary_fill_holes(solid)
    # keep only the biggest blob (+ bits within 6px of it) to drop stray label text
    lab, n = ndi.label(ndi.binary_dilation(solid, iterations=4))
    if n > 1:
        sizes = ndi.sum(solid, lab, range(1, n + 1))
        keep = lab == (1 + int(np.argmax(sizes)))
        solid &= keep
    alpha = np.where(solid, 255, 0).astype(np.uint8)
    # feather 1px on the boundary only
    edge = solid & ~ndi.binary_erosion(solid)
    alpha[edge] = np.minimum(255, (d[edge] * 3)).astype(np.uint8).clip(120, 255)
    out = np.dstack([crop.astype(np.uint8), alpha])
    ys, xs = np.where(alpha > 0)
    if len(ys) == 0:
        return None, None
    out = out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return Image.fromarray(out, "RGBA"), (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("--out", default="frames")
    ap.add_argument("--thr", type=int, default=60)
    ap.add_argument("--min-h", type=int, default=22)
    ap.add_argument("--min-area", type=int, default=120)
    ap.add_argument("--gap", type=int, default=5, help="px of dilation used to glue sprite parts together")
    a = ap.parse_args()

    name = os.path.splitext(os.path.basename(a.sheet))[0]
    outdir = os.path.join(a.out, name)
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        os.remove(os.path.join(outdir, f))

    img, rgb, bg, mask, boxes = segment(a.sheet, a.thr, a.min_h, a.min_area, a.gap)
    boxes = sort_reading_order(boxes)

    index = []
    frames = []
    for i, b in enumerate(boxes):
        im, bb = cutout(rgb, mask, b, bg)
        if im is None:
            continue
        fn = f"{len(frames):03d}.png"
        im.save(os.path.join(outdir, fn))
        index.append({"id": len(frames), "file": fn, "bbox": [int(v) for v in bb], "w": im.width, "h": im.height})
        frames.append((im, bb))

    json.dump({"sheet": os.path.basename(a.sheet), "bg": [int(v) for v in bg], "frames": index},
              open(os.path.join(outdir, "_index.json"), "w"), indent=1)

    # contact overlay: original sheet with box + index
    ov = img.copy()
    dr = ImageDraw.Draw(ov)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
    for e in index:
        x0, y0, x1, y1 = e["bbox"]
        dr.rectangle([x0, y0, x1, y1], outline=(0, 160, 255), width=1)
        dr.rectangle([x0, y0, x0 + 8 * len(str(e["id"])) + 6, y0 + 15], fill=(0, 100, 220))
        dr.text((x0 + 3, y0 + 0), str(e["id"]), fill="white", font=font)
    ov = ov.resize((ov.width * 2, ov.height * 2), Image.NEAREST) if ov.width < 1200 else ov
    ov.save(os.path.join(outdir, "_contact.png"))
    print(f"{name}: {len(index)} frames -> {outdir}/")


if __name__ == "__main__":
    main()
