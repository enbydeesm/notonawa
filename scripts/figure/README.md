# The poser's body

The poser's figure is built from [Anny](https://github.com/naver/anny)
(NAVER, Apache 2.0). Its body is MakeHuman's, which is CC0. These two
scripts make `public/figure/body-*.bin` (the mesh) and
`public/js/figure-body-data.js` (the skeleton). Only someone changing the
body runs them. The app just reads their output.

They need Python with Anny and PyTorch. Keep those in their own virtual
environment outside this repo: they're large, and the app never uses them.

    python3 -m venv ~/anny-env && . ~/anny-env/bin/activate
    pip install torch anny
    mkdir -p ~/anny-work && cd ~/anny-work
    python ~/notonawa/scripts/figure/export_body.py   # writes body.npz here
    python ~/notonawa/scripts/figure/pack_body.py ~/notonawa

What they do:

- `export_body.py` takes Anny's body at every corner of the sliders:
  gender, muscle and weight at 0, 0.5 and 1 (gender at 0 and 1), and height
  at 0 and 1. That's 36 shapes. Each is posed arms straight down, as the
  poser's joints are measured from that pose. Each is then turned into the
  poser's frame: centimetres, y up, facing +z, with the hip centre at 0.
  Age is fixed at Anny's young-adult setting, so the figure is always an
  adult. It also makes the "heavier" shape used past Anny's heaviest
  weight, from Anny's local fat targets (`FAT`).
- `pack_body.py` finds the few components every shape is made of (23,
  exact) and writes them with the triangles and the four strongest bones
  per vertex. It also writes each corner's joints, height and floor
  for the pure code (`figure-body.js`).

A changed body needs a new file name (`BIN` in `pack_body.py`), because
`/figure/*` is cached for a week (`public/_headers`). The old file should
then be deleted.
