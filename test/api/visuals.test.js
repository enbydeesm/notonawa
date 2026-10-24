import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { ORIGIN, call, create, createOtherUser, sessionCookieFor, signedInUser } from "../helpers.js";

// An item's photos, drawings and poses share one order (src/visuals/).

const drawing = { v: 1, strokes: [{ c: "red", w: 2, p: [10, 20, 30, 40] }] };
const pose = { v: 1, joints: {}, body: [0, 0, 0], lift: 99, camera: [0, 8, 330, 100, 0, 0], ring: null, ropes: [] };

/** @param {Record<string, string>} item @param {string} [cookie] */
async function upload(item, cookie) {
  const id = crypto.randomUUID();
  const query = new URLSearchParams({ ...item, kind: "photo", mime: "image/jpeg", thumb_bytes: "10" });
  const res = await SELF.fetch(`${ORIGIN}/api/media/${id}?${query}`, {
    method: "PUT", headers: { cookie: cookie ?? (await signedInUser()).cookie, origin: ORIGIN }, body: new Uint8Array(40),
  });
  expect(res.status).toBe(201);
  return id;
}

/** @param {Record<string, string>} item */
async function positions(item) {
  const query = new URLSearchParams(item);
  const [media, drawings, poses] = await Promise.all(["media", "drawings", "poses"].map((k) => call(`/api/${k}?${query}`)));
  return [
    ...media.body.map((/** @type {any} */ r) => ["media", r.id, r.position]),
    ...drawings.body.map((/** @type {any} */ r) => ["drawing", r.id, r.position]),
    ...poses.body.map((/** @type {any} */ r) => ["pose", r.id, r.position]),
  ].sort((a, b) => a[2] - b[2]).map(([kind, id]) => ({ kind, id }));
}

/** A plan with a photo, a drawing and a pose, added in that order. */
async function planWithVisuals() {
  const plan = await create("/api/plans", { title: "Visuals" });
  const item = { plan_id: plan };
  const photo = await upload(item);
  const drawn = await create("/api/drawings", { ...item, data: drawing });
  const posed = await create("/api/poses", { ...item, data: pose });
  return { item, photo, drawn, posed };
}

describe("an item's visuals", () => {
  it("go last after every kind as they're added", async () => {
    const { item, photo, drawn, posed } = await planWithVisuals();
    const another = await upload(item);
    expect(await positions(item)).toEqual([
      { kind: "media", id: photo }, { kind: "drawing", id: drawn }, { kind: "pose", id: posed }, { kind: "media", id: another },
    ]);
  });

  it("can be put in any order together", async () => {
    const { item, photo, drawn, posed } = await planWithVisuals();
    const order = [{ kind: "pose", id: posed }, { kind: "media", id: photo }, { kind: "drawing", id: drawn }];
    expect((await call("/api/visuals/order", { method: "PUT", body: { ...item, order } })).status).toBe(204);
    expect(await positions(item)).toEqual(order);
  });

  it("are only reordered with every one of them, each under its own kind", async () => {
    const { item, photo, drawn, posed } = await planWithVisuals();
    const before = await positions(item);
    const tries = [
      [{ kind: "pose", id: posed }, { kind: "media", id: photo }],
      [{ kind: "pose", id: posed }, { kind: "media", id: drawn }, { kind: "drawing", id: photo }],
      [{ kind: "pose", id: posed }, { kind: "media", id: photo }, { kind: "drawing", id: drawn }, { kind: "drawing", id: crypto.randomUUID() }],
    ];
    for (const order of tries) {
      const res = await call("/api/visuals/order", { method: "PUT", body: { ...item, order } });
      expect(res).toEqual({ status: 400, body: { error: "The photos, drawings or poses have changed. Reload and try again." } });
    }
    expect(await positions(item)).toEqual(before);
    const twice = [{ kind: "pose", id: posed }, { kind: "pose", id: posed }];
    expect((await call("/api/visuals/order", { method: "PUT", body: { ...item, order: twice } })).status).toBe(400);
    expect((await call("/api/visuals/order", { method: "PUT", body: { ...item, order: [{ kind: "video", id: photo }] } })).status).toBe(400);
  });

  it("can't be reordered by another user", async () => {
    const { item, photo, drawn, posed } = await planWithVisuals();
    const before = await positions(item);
    const cookie = await sessionCookieFor(await createOtherUser());
    const order = [{ kind: "drawing", id: drawn }, { kind: "pose", id: posed }, { kind: "media", id: photo }];
    expect((await call("/api/visuals/order", { method: "PUT", cookie, body: { ...item, order } })).status).toBe(400);
    expect(await positions(item)).toEqual(before);
  });
});
