"""Photograph -> depth map with Apple Depth Pro 2.

  python depthpro2_plate.py MODEL MAX_LONG photo.jpg out_prefix [photo.jpg out_prefix ...]

MODEL is depthpro2-s | -b | -l | -h. MAX_LONG caps the long side fed to the network: memory
grows with the square of the pixel count (L at 1536 px peaks near 5 GB, about 18 s on 8 cores).

Writes out_prefix.depth.png: how near each part of the photograph is, white = nearest, stored
as near / distance in 8 bits at 1024 px on the long side. And out_prefix.json: the photo size,
the focal length the model settled on, and the near / middle / far distances in metres.
"""
import json, sys, time, faulthandler
import numpy as np, torch
from PIL import Image
faulthandler.enable()

# oneDNN crashes on some 1x1 convolutions on this Xen VM (see sharp_cpu.py); route them around it.
_forward = torch.nn.Conv2d._conv_forward
def _conv_forward(self, x, weight, bias):
    if self.kernel_size == (1, 1):
        with torch.backends.mkldnn.flags(enabled=False):
            return _forward(self, x, weight, bias)
    return _forward(self, x, weight, bias)
torch.nn.Conv2d._conv_forward = _conv_forward

from depth_pro_2 import create_model_and_transforms, load_rgb

name, max_long = sys.argv[1], int(sys.argv[2])
pairs = sys.argv[3:]
model, transform = create_model_and_transforms(name, device="cpu")
model.eval()
for photo_path, out in zip(pairs[0::2], pairs[1::2]):
    t0 = time.time()
    image, f_px = load_rgb(photo_path)
    pil = Image.fromarray(np.asarray(image)) if not isinstance(image, Image.Image) else image
    W, H = pil.size
    k = min(1.0, max_long / max(W, H))
    small = pil.resize((round(W * k), round(H * k)), Image.LANCZOS) if k < 1 else pil
    with torch.no_grad():
        pred = model.infer(transform(np.ascontiguousarray(np.asarray(small.convert("RGB"), dtype=np.uint8))), f_px=(f_px * k if f_px else None))
    depth = pred["depth"].squeeze().float().cpu().numpy().astype(np.float64)
    f_used = float(pred["focallength_px"]) / k
    s = 1024 / max(W, H)
    d = np.asarray(Image.fromarray(depth.astype(np.float32), "F").resize((round(W * s), round(H * s)), Image.NEAREST), dtype=np.float64)
    d = np.where(np.isfinite(d), d, 1e9)   # sky comes back as infinitely far
    near = float(np.quantile(d, 0.004))
    nearness = np.clip(near / d, 0, 1)
    Image.fromarray(np.round(nearness * 255).astype(np.uint8), "L").save(out + ".depth.png", optimize=True)
    q = np.minimum(np.quantile(d, [0.03, 0.5, 0.97]), near * 500)
    meta = {"w": W, "h": H, "f": f_used, "near": round(near, 5), "depth": [round(float(a), 4) for a in q], "model": name, "seconds": round(time.time() - t0, 1)}
    json.dump(meta, open(out + ".json", "w"))
    print(out, meta, flush=True)
