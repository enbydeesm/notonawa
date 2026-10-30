# Run from the folder export_body.py saved body.npz in:
#   python pack_body.py <notonawa checkout>
# Packs body.npz (export_body.py) for the poser:
#   <out>/public/figure/body.bin       the mesh: base shape, shape components, faces, skin
#   <out>/public/js/figure-body-data.js the skeleton at every slider corner (small, pure)
import json, sys, struct, numpy as np

out = sys.argv[1]
# A changed body needs a new file name: /figure/* is cached for a week.
BIN = "body-2.bin"
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

# Four strongest bones per vertex (all three.js takes), as bytes summing
# to 255. A bone left out hands its pull to its nearest relative kept (up
# or down the skeleton), so the skin still follows the same part: spread
# over all four, the shoulder's skin sagged.
Wt, It = d["W"], d["I"]
order = np.argsort(-Wt, 1)
Ws = np.take_along_axis(Wt, order, 1); Is = np.take_along_axis(It, order, 1)
w4 = Ws[:, :4].copy(); i4 = Is[:, :4].copy()


def ancestors(b):
    out = []
    while b >= 0:
        out.append(b); b = parents[b]
    return out


def kinship(a, b):
    """How far apart two bones are in the skeleton (steps through their nearest shared parent)."""
    pa, pb = ancestors(a), ancestors(b)
    shared = next(x for x in pa if x in pb)
    return pa.index(shared) + pb.index(shared)


for v in np.nonzero(Ws[:, 4] > 0)[0]:
    for k in range(4, Ws.shape[1]):
        if Ws[v, k] <= 0: break
        near = min(range(4), key=lambda j: (kinship(int(Is[v, k]), int(i4[v, j])), -w4[v, j]))
        w4[v, near] += Ws[v, k]
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

# The skeleton: heads at the base shape, and their change at each corner,
# arms down and as the skin is bound (Anny's pose).
Hb2 = Hb.copy(); Hb2[ROOT] = 0
Hc = H.copy(); Hc[:, ROOT] = 0
HA, HAb = d["HA"], d["HAbase"].copy()
HAb[ROOT] = 0
HAc = HA.copy(); HAc[:, ROOT] = 0
turns = d["turns"]
turned = [i for i in range(len(labels)) if not np.allclose(turns[i], np.eye(3), atol=1e-9)]
r1 = lambda a: [round(float(x), 2) for x in np.asarray(a).reshape(-1)]
grid = sorted(set(keys[:, 0])), sorted(set(keys[:, 1])), sorted(set(keys[:, 2])), sorted(set(keys[:, 3]))
# The body as capsules, for keeping limbs out of it (pose-contact.js): each
# segment from one point to another (a bone's joint, or the middle of
# several), and how thick it is at each corner: most of its own skin
# (the median of its vertices' distance from the line, in Anny's
# pose, where the skin is). `from` starts a segment part-way along, so it
# doesn't overlap the one it hangs from at the shoulder or hip.
SEGMENTS = [
    {"name": "hips", "a": ["spine05"], "b": ["spine03"], "skin": ["root", "spine05", "pelvis.L", "pelvis.R", "spine04"]},
    {"name": "waist", "a": ["spine03"], "b": ["spine01"], "skin": ["spine03", "spine02"]},
    {"name": "chest", "a": ["spine01"], "b": ["neck01"], "skin": ["spine01"]},
    {"name": "head", "a": ["neck02"], "b": ["eye.L", "eye.R"], "skin": ["neck01", "neck02", "neck03", "head"]},
]
for S in "LR":
    s_ = S.lower()
    SEGMENTS += [
        {"name": f"{s_}_upperarm", "a": [f"upperarm01.{S}"], "b": [f"lowerarm01.{S}"], "skin": [f"upperarm01.{S}", f"upperarm02.{S}"], "from": 0.35},
        {"name": f"{s_}_forearm", "a": [f"lowerarm01.{S}"], "b": [f"wrist.{S}"], "skin": [f"lowerarm01.{S}", f"lowerarm02.{S}"]},
        {"name": f"{s_}_hand", "a": [f"wrist.{S}"], "b": [f"finger3-3.{S}"],
         "skin": [f"wrist.{S}"] + [f"finger{k}-{j}.{S}" for k in range(1, 6) for j in (1, 2, 3)] + [f"metacarpal{k}.{S}" for k in range(1, 5)]},
        {"name": f"{s_}_thigh", "a": [f"upperleg01.{S}"], "b": [f"lowerleg01.{S}"], "skin": [f"upperleg01.{S}", f"upperleg02.{S}"], "from": 0.35},
        {"name": f"{s_}_shin", "a": [f"lowerleg01.{S}"], "b": [f"foot.{S}"], "skin": [f"lowerleg01.{S}", f"lowerleg02.{S}"]},
        {"name": f"{s_}_foot", "a": [f"foot.{S}"], "b": [f"toe3-1.{S}"], "skin": [f"foot.{S}"] + [f"toe{k}-{j}.{S}" for k in range(1, 6) for j in (1, 2, 3) if f"toe{k}-{j}.{S}" in labels]},
    ]
owner = np.argmax(d["W"], 1)
owner = d["I"][np.arange(len(owner)), owner]


TORSO = {"hips", "waist", "chest"}


def radii(verts, heads):
    """Each segment's radius, how far forward its line sits (z), and, for
    the torso, how far apart its three side-by-side capsules are (x): a
    torso is wider than it is deep, so one round capsule would stick out
    behind the back and in front of the chest."""
    out = []
    for seg in SEGMENTS:
        a = np.mean([heads[labels.index(n)] for n in seg["a"]], 0)
        b = np.mean([heads[labels.index(n)] for n in seg["b"]], 0)
        mine = np.isin(owner, [labels.index(n) for n in seg["skin"]])
        p = verts[mine]
        ab = b - a
        t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
        rel = p - (a + t[:, None] * ab)
        if seg["name"] in TORSO:
            front, back = np.percentile(rel[:, 2], 92), np.percentile(rel[:, 2], 8)
            r = (front - back) / 2
            half = (np.percentile(rel[:, 0], 92) - np.percentile(rel[:, 0], 8)) / 2
            out.append([float(r), float((front + back) / 2), float(max(0.0, half - r))])
        else:
            # The head is round: most of it, not the middle of it.
            pct = 80 if seg["name"] == "head" else 50
            out.append([float(np.percentile(np.linalg.norm(rel, axis=1), pct)), 0.0, 0.0])
    return np.array(out)


R_base = radii(Vb, d["HAbase"])
R_corner = np.stack([radii(V[c], HA[c]) for c in range(len(V))])
R_fat = radii(Vb + d["Vfat"].reshape(Vb.shape), d["HAbase"] + d["HAfat"]) - R_base
segments_js = [{k: v for k, v in seg.items() if k != "skin"} for seg in SEGMENTS]

js = f"""// The figure's skeleton, made from Anny (github.com/naver/anny, Apache 2.0;
// its body assets are MakeHuman's, CC0) by scripts/figure/ (pack_body.py).
// Don't edit: build it again. Centimetres, the hip centre at 0, standing
// with arms down, y up, facing +z, the figure's left +x.
//
// The body's shape is a blend of its shape at every corner of the sliders
// (CORNERS, in the order gender, muscle, weight, height); a bone's head is
// HEADS plus each corner's weight times its CORNER_HEADS, plus FAT_HEADS
// times how far past the heaviest corner the weight goes.
//
// The skin is bound in Anny's own pose, arms out: BIND_HEADS (and its
// corners') are the joints there, and TURNS each turned bone's turn from
// there to arms down (a 3 × 3, row by row; the rest don't turn).

export const BONES = {json.dumps(labels)};
export const PARENTS = {json.dumps(parents)};
export const CORNERS = {json.dumps([list(map(float, g)) for g in grid])};
export const CORNER_KEYS = {json.dumps(keys.tolist())};
export const HEADS = {json.dumps(r1(Hb2))};
export const CORNER_HEADS = {json.dumps([r1(h - Hb2) for h in Hc])};
export const FAT_HEADS = {json.dumps(r1(d['Hfat']))};
export const BIND_HEADS = {json.dumps(r1(HAb))};
export const CORNER_BIND_HEADS = {json.dumps([r1(h - HAb) for h in HAc])};
export const FAT_BIND_HEADS = {json.dumps(r1(d['HAfat']))};
export const TURNS = {json.dumps({labels[i]: [round(float(x), 6) for x in turns[i].reshape(-1)] for i in turned})};
// Each corner's height (top of the head to the soles) and how far its soles
// are below the hip centre, cm; the heavier shape's change to both.
export const CORNER_STATURE = {json.dumps(r1(V[:, :, 1].max(1) - V[:, :, 1].min(1)))};
export const CORNER_FLOOR = {json.dumps(r1(-V[:, :, 1].min(1)))};
export const FAT_STATURE = {round(float((Vb[:, 1] + d['Vfat'][:, 1]).max() - (Vb[:, 1] + d['Vfat'][:, 1]).min() - (Vb[:, 1].max() - Vb[:, 1].min())), 2)};
export const FAT_FLOOR = {round(float(-(Vb[:, 1] + d['Vfat'][:, 1]).min() + Vb[:, 1].min()), 2)};
// The body's segments as capsules (pose-contact.js): for each, its radius,
// how far forward of its line it sits, and how far out to each side a
// torso segment's side capsules are (cm, three numbers a segment).
export const SEGMENTS = {json.dumps(segments_js)};
export const RADII = {json.dumps(r1(R_base))};
export const CORNER_RADII = {json.dumps([r1(r - R_base) for r in R_corner])};
export const FAT_RADII = {json.dumps(r1(R_fat))};
/** The mesh (figure-body.js reads it). */
export const BODY_FILE = "/figure/{BIN}";
"""
open(f"{out}/public/js/figure-body-data.js", "w").write(js)
print("bin", len(blob) // 1024, "KB; js", len(js) // 1024, "KB", file=sys.stderr)
