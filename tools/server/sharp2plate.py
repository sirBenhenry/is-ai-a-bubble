"""SHARP .ply + source photograph -> a plate for the web page.

  python sharp2plate.py scene.ply photo.jpg out_prefix [--long 2048] [--depth-long 1024]

Writes
  out_prefix.jpg        the photograph in black and white
  out_prefix.depth.png  how near each part of the photograph is (white = nearest), read off
                        the front surface of SHARP's gaussians
  out_prefix.json       camera facts: photo size, focal length, near / middle / far depth
"""
import json, sys
import numpy as np
from PIL import Image
from plyfile import PlyData
from scipy import ndimage

args = sys.argv[1:]
ply_path, photo_path, out = args[0], args[1], args[2]
opt = lambda k, d: type(d)(args[args.index(k) + 1]) if k in args else d
LONG = opt("--long", 2048)
DLONG = opt("--depth-long", 1024)

ply = PlyData.read(ply_path)
v = ply["vertex"].data
W, H = [int(x) for x in ply["image_size"].data["image_size"]]
f = float(ply["intrinsic"].data["intrinsic"][0])
x, y, z = (v[k].astype(np.float64) for k in "xyz")
op = 1 / (1 + np.exp(-v["opacity"].astype(np.float64)))
sc = np.sort(np.exp(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], 1).astype(np.float64)), 1)

s = DLONG / max(W, H)
dw, dh = round(W * s), round(H * s)
u = (f * x / z + W / 2) * s
w = (f * y / z + H / 2) * s
rpx = np.sqrt(sc[:, 1] * sc[:, 2]) * f / z * s            # footprint in depth-map pixels
ok = (op > 0.35) & (z > 1e-3)

# Front surface: nearest opaque gaussian over each pixel, stamped over its footprint.
zbuf = np.full(dh * dw, np.inf)
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        reach = np.hypot(dx, dy)
        m = ok & (rpx * 1.5 + 0.5 >= reach)
        px = np.floor(u[m]).astype(np.int64) + dx
        py = np.floor(w[m]).astype(np.int64) + dy
        inb = (px >= 0) & (px < dw) & (py >= 0) & (py < dh)
        np.minimum.at(zbuf, py[inb] * dw + px[inb], z[m][inb])
zbuf = zbuf.reshape(dh, dw)
hole = ~np.isfinite(zbuf)
if hole.any():
    idx = ndimage.distance_transform_edt(hole, return_distances=False, return_indices=True)
    zbuf = zbuf[tuple(idx)]
# Stray gaussians hanging in front of a surface would cut holes in it: a small median removes them.
zbuf = ndimage.median_filter(zbuf, size=3)

near = float(np.quantile(zbuf, 0.004))
nearness = np.clip(near / zbuf, 0, 1)
Image.fromarray(np.round(nearness * 255).astype(np.uint8), "L").save(out + ".depth.png", optimize=True)

photo = Image.open(photo_path).convert("L")
assert photo.size == (W, H), (photo.size, (W, H))
k = min(1.0, LONG / max(W, H))
photo.resize((round(W * k), round(H * k)), Image.LANCZOS).save(out + ".jpg", quality=88, optimize=True)

q = np.quantile(zbuf, [0.03, 0.5, 0.97])
meta = {"w": W, "h": H, "f": f, "near": round(near, 5), "depth": [round(float(a), 4) for a in q], "holes": float(hole.mean())}
json.dump(meta, open(out + ".json", "w"))
print(out, meta)
