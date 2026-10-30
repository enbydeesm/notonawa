# Run from the folder export_body.py saved body.npz in:
#   python pack_body.py <notonawa checkout>
# Packs body.npz (export_body.py) for the poser:
#   <out>/public/figure/body.bin       the mesh: base shape, shape components, faces, skin
#   <out>/public/js/figure-body-data.js the skeleton at every slider corner (small, pure)
import json, sys, struct, numpy as np

out = sys.argv[1]
# A changed body needs a new file name: /figure/* is cached for a week.
BIN = "body-1.bin"
d = np.load("body.npz")
keys, V, H, Vb, Hb = d["keys"], d["V"], d["H"], d["Vbase"], d["Hbase"]
labels = [str(x) for x in d["labels"]]
parents = d["parents"].tolist()
ROOT = labels.index("root")

# Components of the corner shapes (exact at rank 24).
D = (V - Vb).reshape(len(V), -1)
U, S, Vt = np.linalg.svd(D, full_matrices=False)
R = int(np.sum(S > S[0] * 1e-6))
coeff = (U[:, :R] * S[:R]).astype(np.float32)          # corner x component (cm)
basis = Vt[:R]                                          # component x 3V, unit
scales = np.abs(basis).max(1) / 32767
q = np.round(basis / scales[:, None]).astype(np.int16)
err = np.abs((q * scales[:, None]) @ np.zeros(0) if False else (coeff @ (q * scales[:, None])) - D).max()
print("components", R, "max quantization error cm", round(float(err), 4), file=sys.stderr)

fat = d["Vfat"].reshape(-1)
fat_scale = np.abs(fat).max() / 32767
fat_q = np.round(fat / fat_scale).astype(np.int16)

# Four strongest bones per vertex, as bytes summing to 255.
Wt, It = d["W"], d["I"]
order = np.argsort(-Wt, 1)[:, :4]
w4 = np.take_along_axis(Wt, order, 1); i4 = np.take_along_axis(It, order, 1)
w4 = w4 / w4.sum(1, keepdims=True)
wb = np.floor(w4 * 255).astype(np.int32)
wb[:, 0] += 255 - wb.sum(1)
i4[wb == 0] = 0

faces = d["faces"].astype(np.uint16)
assert len(Vb) < 65536
waist = d["waist"].astype(np.uint16)

sections = [
    ("base", Vb.astype(np.float32).reshape(-1)),
    ("basis", q.reshape(-1)), ("scales", scales.astype(np.float32)), ("coeff", coeff.reshape(-1)),
    ("fat", fat_q), ("fatScale", np.array([fat_scale], np.float32)),
    ("faces", faces.reshape(-1)), ("joints", i4.astype(np.uint8).reshape(-1)), ("weights", wb.astype(np.uint8).reshape(-1)),
    ("waist", waist),
]
header = {"vertices": len(Vb), "faces": len(faces), "components": R, "corners": len(keys), "sections": []}
blob = b""
for name, arr in sections:
    while len(blob) % 4: blob += b"\0"
    header["sections"].append({"name": name, "type": arr.dtype.name, "offset": len(blob), "length": int(arr.size)})
    blob += arr.tobytes()
hj = json.dumps(header, separators=(",", ":")).encode()
hj += b" " * ((4 - len(hj) % 4) % 4)
with open(f"{out}/public/figure/{BIN}", "wb") as f:
    f.write(b"NOTOBODY" + struct.pack("<I", len(hj)) + hj + blob)

# The skeleton: heads at the base shape, and their change at each corner.
Hb2 = Hb.copy(); Hb2[ROOT] = 0
Hc = H.copy(); Hc[:, ROOT] = 0
r1 = lambda a: [round(float(x), 2) for x in np.asarray(a).reshape(-1)]
grid = sorted(set(keys[:, 0])), sorted(set(keys[:, 1])), sorted(set(keys[:, 2])), sorted(set(keys[:, 3]))
js = f"""// The figure's skeleton, made from Anny (github.com/naver/anny, Apache 2.0;
// its body assets are MakeHuman's, CC0) by scripts/figure/ (pack_body.py).
// Don't edit: build it again. Centimetres, the hip centre at 0, standing
// with arms down, y up, facing +z, the figure's left +x.
//
// The body's shape is a blend of its shape at every corner of the sliders
// (CORNERS, in the order gender, muscle, weight, height); a bone's head is
// HEADS plus each corner's weight times its CORNER_HEADS, plus FAT_HEADS
// times how far past the heaviest corner the weight goes.

export const BONES = {json.dumps(labels)};
export const PARENTS = {json.dumps(parents)};
export const CORNERS = {json.dumps([list(map(float, g)) for g in grid])};
export const CORNER_KEYS = {json.dumps(keys.tolist())};
export const HEADS = {json.dumps(r1(Hb2))};
export const CORNER_HEADS = {json.dumps([r1(h - Hb2) for h in Hc])};
export const FAT_HEADS = {json.dumps(r1(d['Hfat']))};
// Each corner's height (top of the head to the soles) and how far its soles
// are below the hip centre, cm; the heavier shape's change to both.
export const CORNER_STATURE = {json.dumps(r1(V[:, :, 1].max(1) - V[:, :, 1].min(1)))};
export const CORNER_FLOOR = {json.dumps(r1(-V[:, :, 1].min(1)))};
export const FAT_STATURE = {round(float((Vb[:, 1] + d['Vfat'][:, 1]).max() - (Vb[:, 1] + d['Vfat'][:, 1]).min() - (Vb[:, 1].max() - Vb[:, 1].min())), 2)};
export const FAT_FLOOR = {round(float(-(Vb[:, 1] + d['Vfat'][:, 1]).min() + Vb[:, 1].min()), 2)};
/** The mesh (figure-body.js reads it). */
export const BODY_FILE = "/figure/{BIN}";
"""
open(f"{out}/public/js/figure-body-data.js", "w").write(js)
print("bin", len(blob) // 1024, "KB; js", len(js) // 1024, "KB", file=sys.stderr)
