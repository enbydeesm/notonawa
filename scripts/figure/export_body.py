# Builds the poser's body from Anny: the shape at every corner of the
# sliders (gender x muscle x weight x height), posed arms-down, in the
# poser's frame (cm, y up, facing +z, figure's left +x, hip centre at the
# origin), plus an extra "heavier" shape from Anny's local fat targets.
# Saves everything to body.npz for pack_body.py.
import sys, time, numpy as np, torch, anny
torch.set_grad_enabled(False)

AGE = 2 / 3  # Anny's "young" anchor: an adult, never younger
GRID = dict(gender=[0.0, 1.0], muscle=[0.0, 0.5, 1.0], weight=[0.0, 0.5, 1.0], height=[0.0, 1.0])
DEFAULT = dict(gender=0.5, muscle=0.5, weight=0.5, height=0.5)

# The "heavier" shape past weight 1: fat in the places it goes.
FAT = {
    "stomach-pregnant-incr": 0.55, "measure-waist-circ-incr": 0.6, "measure-hips-circ-incr": 0.45,
    "buttocks-volume-incr": 0.5, "neck-double-incr": 0.6, "head-fat-incr": 0.35,
    "l-upperarm-fat-incr": 0.8, "r-upperarm-fat-incr": 0.8, "l-lowerarm-fat-incr": 0.5, "r-lowerarm-fat-incr": 0.5,
    "l-upperleg-fat-incr": 0.8, "r-upperleg-fat-incr": 0.8, "l-lowerleg-fat-incr": 0.5, "r-lowerleg-fat-incr": 0.5,
    "measure-thigh-circ-incr": 0.4, "measure-upperarm-circ-incr": 0.35, "torso-scale-depth-incr": 0.35,
    "measure-bust-circ-incr": 0.3, "measure-underbust-circ-incr": 0.4,
}

t = time.time()
m = anny.Anny(rig="anny-blender", topology="anny-notongue", extrapolate_phenotypes=True,
              phenotype_blendshapes="original", local_changes="all")
print("loaded", round(time.time() - t), "s", file=sys.stderr)
L = list(m.bone_labels)
parents = list(m.bone_parents)
W = m.vertex_bone_weights.numpy()      # V x 9
I = m.vertex_bone_indices.numpy()      # V x 9
faces = m.faces.numpy()
missing = set(FAT) - set(m.local_change_labels)
assert not missing, missing


def rest(ph, local=None):
    out = m(phenotype_kwargs=dict(age=AGE, proportions=0.5) | ph, local_changes_kwargs=local, return_bone_ends=True)
    return out["rest_vertices"][0].numpy(), out["rest_bone_heads"][0].numpy(), out["rest_bone_tails"][0].numpy()


def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = np.dot(a, b)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


def descendants(name):
    i = L.index(name); out = {i}
    changed = True
    while changed:
        changed = False
        for j, p in enumerate(parents):
            if p in out and j not in out: out.add(j); changed = True
    return out


# Arms down: each arm's upper arm, then forearm, turned to point straight
# down (Anny's -z), from the default body's A-pose. Fixed rotations, so the
# posed shapes stay linear in the corners.
Vd, Hd, Td = rest(DEFAULT)
DOWN = np.array([0.0, 0.0, -1.0])
turns = []  # (pivot bone, rotation, bones it moves)
for side in "LR":
    up, lo, wr = L.index(f"upperarm01.{side}"), L.index(f"lowerarm01.{side}"), L.index(f"wrist.{side}")
    # Straight down, as the poser's joints are measured from (figure-rig.js).
    R1 = rot_between(Hd[lo] - Hd[up], DOWN)
    turns.append((up, R1, descendants(f"upperarm01.{side}")))
    elbow_to_wrist = R1 @ (Hd[wr] - Hd[lo])
    R2 = rot_between(elbow_to_wrist, DOWN)
    turns.append((lo, R2, descendants(f"lowerarm01.{side}")))


def arms_down(V, H, T):
    """LBS with each bone's world transform: the turns of its arm, about the heads of this shape."""
    G = np.tile(np.eye(4), (len(L), 1, 1))
    Hp = H.copy()
    for pivot, R, moved in turns:
        p = Hp[pivot].copy()
        A = np.eye(4); A[:3, :3] = R; A[:3, 3] = p - R @ p
        for j in moved: G[j] = A @ G[j]
        idx = sorted(moved)
        Hp[idx] = (Hp[idx] - p) @ R.T + p
    Vh = np.concatenate([V, np.ones((len(V), 1))], 1)
    out = np.zeros_like(V)
    for k in range(W.shape[1]):
        out += W[:, k:k + 1] * np.einsum("vij,vj->vi", G[I[:, k]], Vh)[:, :3]
    Th = np.einsum("bij,bj->bi", G, np.concatenate([T, np.ones((len(T), 1))], 1))[:, :3]
    return out, Hp, Th


HIP = L.index("spine05")


def to_poser(P, origin):
    """Anny metres (z up, facing -y) to the poser's cm (y up, facing +z), from origin."""
    P = P - origin
    return np.stack([P[..., 0], P[..., 2], -P[..., 1]], -1) * 100


def shape(ph, local=None):
    V, H, T = arms_down(*rest(ph, local))
    o = H[HIP].copy()
    return to_poser(V, o), to_poser(H, o), to_poser(T, o)


corners, keys = [], []
for g in GRID["gender"]:
    for mu in GRID["muscle"]:
        for w in GRID["weight"]:
            for h in GRID["height"]:
                keys.append((g, mu, w, h))
                corners.append(shape(dict(gender=g, muscle=mu, weight=w, height=h)))
print("corners", len(corners), round(time.time() - t), "s", file=sys.stderr)

Vb, Hb, Tb = shape(DEFAULT)
Vf, Hf, Tf = shape(DEFAULT, FAT)

# Waist ring, as Anny measures it.
A = anny.Anthropometry(m)
np.savez_compressed(
    "body.npz",
    keys=np.array(keys), V=np.stack([c[0] for c in corners]), H=np.stack([c[1] for c in corners]),
    T=np.stack([c[2] for c in corners]), Vbase=Vb, Hbase=Hb, Tbase=Tb, Vfat=Vf - Vb, Hfat=Hf - Hb,
    faces=faces, W=W, I=I, parents=np.array(parents), labels=np.array(L),
    waist=np.array(A.waist_vertex_indices), uv=m.texture_coordinates.numpy() if hasattr(m, "texture_coordinates") else np.zeros(0),
)
print("saved", round(time.time() - t), "s", file=sys.stderr)
