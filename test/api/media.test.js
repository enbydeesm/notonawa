import { describe, it, expect } from "vitest";
import { SELF, env, createScheduledController } from "cloudflare:test";
import worker from "../../src/index.js";
import { ORIGIN, call, create, createOtherUser, sessionCookieFor, signedInUser, sql, sealed, fakeWrap } from "../helpers.js";
import { MAX_ACCOUNT_BYTES } from "../../src/media/parse.js";
import { JOINTS } from "../../src/poses/parse.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * A sealed photo as the browser sends it (the server can't tell real
 * ciphertext from these bytes): a thumbnail of `thumb` bytes, then the rest.
 * @param {number} thumb
 * @param {number} full
 */
function photoBytes(thumb, full) {
  const bytes = new Uint8Array(thumb + full);
  bytes.fill(1, 0, thumb);
  bytes.fill(2, thumb);
  return bytes;
}

/**
 * Uploads a photo to a tie or plan.
 * @param {{ tie_id?: string, plan_id?: string }} item
 * @param {{ id?: string, cookie?: string, thumb?: number, full?: number, origin?: string, params?: Record<string, string> }} [options]
 */
async function upload(item, { id = crypto.randomUUID(), cookie, thumb = 10, full = 30, origin = ORIGIN, params = {} } = {}) {
  const query = new URLSearchParams({
    .../** @type {Record<string, string>} */ (item), kind: "photo", mime: "image/jpeg", thumb_bytes: String(thumb), ...params,
  });
  const res = await SELF.fetch(`${ORIGIN}/api/media/${id}?${query}`, {
    method: "PUT",
    headers: { cookie: cookie ?? (await signedInUser()).cookie, origin },
    body: photoBytes(thumb, full),
  });
  const text = await res.text();
  return { id, status: res.status, body: text ? JSON.parse(text) : null };
}

/**
 * Fetches a sealed part of a photo.
 * @param {string} id
 * @param {"thumb" | "full"} part
 * @param {string} [cookie]
 */
async function fetchPart(id, part, cookie) {
  const res = await SELF.fetch(`${ORIGIN}/api/media/${id}/${part}`, {
    headers: { cookie: cookie ?? (await signedInUser()).cookie },
  });
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** @param {string} ownerId @param {string} id */
const stored = (ownerId, id) => env.PHOTOS.head(`${ownerId}/${id}`);

const newTie = () => create("/api/ties", { tie_type: "floor", tie_date: "2026-10-01", title: "Session" });
const newPlan = () => create("/api/plans", { title: "TK" });

describe("uploading a photo", () => {
  it("stores it in R2, last on its tie, and lists it", async () => {
    const me = await signedInUser();
    const tie = await newTie();
    const first = await upload({ tie_id: tie });
    const second = await upload({ tie_id: tie }, { thumb: 5, full: 50 });
    expect(first).toMatchObject({ status: 201, body: { id: first.id, position: 0 } });
    expect(second).toMatchObject({ status: 201, body: { position: 1 } });
    expect((await stored(me.id, first.id))?.size).toBe(40);

    const list = await call(`/api/media?tie_id=${tie}`);
    expect(list.status).toBe(200);
    expect(list.body.map((/** @type {any} */ m) => [m.id, m.position, m.bytes, m.kind, m.mime, m.caption]))
      .toEqual([[first.id, 0, 40, "photo", "image/jpeg", null], [second.id, 1, 55, "photo", "image/jpeg", null]]);
  });

  it("hands back the thumbnail and the full size separately", async () => {
    const { id } = await upload({ tie_id: await newTie() }, { thumb: 10, full: 30 });
    const thumb = await fetchPart(id, "thumb");
    const full = await fetchPart(id, "full");
    expect(thumb.status).toBe(200);
    expect([...thumb.bytes]).toEqual(Array(10).fill(1));
    expect([...full.bytes]).toEqual(Array(30).fill(2));
  });

  it("is counted on the tie in the ties list", async () => {
    const tie = await newTie();
    await upload({ tie_id: tie });
    await upload({ tie_id: tie });
    const res = await call("/api/ties/search", { method: "POST", body: {} });
    const found = res.body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(found.photo_count).toBe(2);
    expect((await call(`/api/ties/${tie}`)).body.photo_count).toBe(2);
  });

  it("is counted with the drawings and poses as visuals, on ties, plans and workshops", async () => {
    const pose = {
      v: 1, joints: Object.fromEntries(Object.entries(JOINTS).map(([name, r]) => [name, r.map(() => 0)])),
      body: [0, 0, 0], lift: 99, camera: [20, 10, 300, 110, 0, 0], ring: null, bamboo: null, hashira: null, ropes: [],
    };
    const drawing = { v: 1, strokes: [{ c: "red", w: 2, p: [10, 20, 30, 40] }] };
    const tie = await newTie();
    const plan = await newPlan();
    const workshop = await create("/api/workshops", { title: "Intro", start_date: "2026-10-01" });
    for (const item of [{ tie_id: tie }, { plan_id: plan }, { workshop_id: workshop }]) {
      await upload(item);
      expect((await call("/api/drawings", { method: "POST", body: { ...item, data: drawing } })).status).toBe(201);
      expect((await call("/api/poses", { method: "POST", body: { ...item, data: pose } })).status).toBe(201);
    }
    const ties = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties;
    expect(ties.find((/** @type {any} */ t) => t.id === tie)).toMatchObject({ photo_count: 1, visual_count: 3 });
    const plans = (await call("/api/plans?archived=false")).body;
    expect(plans.find((/** @type {any} */ p) => p.id === plan)).toMatchObject({ photo_count: 1, visual_count: 3 });
    const workshops = (await call("/api/workshops")).body;
    expect(workshops.find((/** @type {any} */ w) => w.id === workshop)).toMatchObject({ photo_count: 1, visual_count: 3 });
  });

  it("works on plans too", async () => {
    const plan = await newPlan();
    expect((await upload({ plan_id: plan })).status).toBe(201);
    expect((await call(`/api/media?plan_id=${plan}`)).body).toHaveLength(1);
    const plans = (await call("/api/plans?archived=false")).body;
    expect(plans.find((/** @type {any} */ p) => p.id === plan).photo_count).toBe(1);
  });

  it("won't add to another user's tie, or one that doesn't exist, and stores nothing", async () => {
    const other = await createOtherUser();
    const theirs = crypto.randomUUID();
    await sql("INSERT INTO ties (id, owner_id, tie_date, tie_type) VALUES (?, ?, '2026-10-01', 'floor')", theirs, other).run();
    const me = await signedInUser();
    for (const tie of [theirs, "nope"]) {
      const res = await upload({ tie_id: tie });
      expect(res.status, tie).toBe(404);
      expect(await stored(me.id, res.id)).toBeNull();
    }
    expect((await call(`/api/media?tie_id=${theirs}`)).status).toBe(404);
  });

  it("won't reuse an id", async () => {
    const tie = await newTie();
    const { id } = await upload({ tie_id: tie });
    expect((await upload({ tie_id: tie }, { id })).status).toBe(409);
  });

  it("refuses a bad request before storing anything", async () => {
    const tie = await newTie();
    const me = await signedInUser();
    const bad = await upload({ tie_id: tie }, { params: { kind: "video" } });
    expect(bad.status).toBe(400);
    expect(await stored(me.id, bad.id)).toBeNull();
    expect((await upload({ tie_id: tie }, { thumb: 10, full: 0 })).status).toBe(400);
  });

  it("stops at 30 photos a tie", async () => {
    const tie = await newTie();
    const me = await signedInUser();
    for (let i = 0; i < 30; i++) {
      await sql(`INSERT INTO media (id, owner_id, tie_id, kind, mime, position, thumb_bytes, bytes)
                 VALUES (?, ?, ?, 'photo', 'image/jpeg', ?, 1, 2)`, crypto.randomUUID(), me.id, tie, i).run();
    }
    const res = await upload({ tie_id: tie });
    expect(res).toMatchObject({ status: 400, body: { error: "There can be at most 30 photos and videos on a tie or plan." } });
    expect(await stored(me.id, res.id)).toBeNull();
  });

  it("stops at 1 GB an account", async () => {
    const id = await createOtherUser();
    const cookie = await sessionCookieFor(id);
    const tie = (await call("/api/ties", { method: "POST", cookie, body: { tie_type: "floor", tie_date: "2026-10-01" } })).body.id;
    await sql(`INSERT INTO media (id, owner_id, tie_id, kind, mime, position, thumb_bytes, bytes)
               VALUES (?, ?, ?, 'photo', 'image/jpeg', 0, 1, ?)`, crypto.randomUUID(), id, tie, MAX_ACCOUNT_BYTES - 30).run();
    const res = await upload({ tie_id: tie }, { cookie, thumb: 10, full: 30 });
    expect(res).toMatchObject({ status: 400, body: { error: "Your photos, videos and shares have filled your 1 GB. Delete some to make room." } });
    expect(await stored(id, res.id)).toBeNull();
    expect((await upload({ tie_id: tie }, { cookie, thumb: 10, full: 20 })).status).toBe(201);
  });

  it("stores a video too, up to 5 a tie (with photos still allowed after)", async () => {
    const tie = await newTie();
    const me = await signedInUser();
    const video = { params: { kind: "video", mime: "video/mp4" } };
    for (let i = 0; i < 5; i++) expect((await upload({ tie_id: tie }, video)).status, `video ${i + 1}`).toBe(201);
    const listed = await call(`/api/media?tie_id=${tie}`);
    expect(listed.body.map((/** @type {any} */ m) => [m.kind, m.mime])).toEqual(Array(5).fill(["video", "video/mp4"]));
    const sixth = await upload({ tie_id: tie }, video);
    expect(sixth).toMatchObject({ status: 400, body: { error: "There can be at most 5 videos on a tie or plan." } });
    expect(await stored(me.id, sixth.id)).toBeNull();
    expect((await upload({ tie_id: tie })).status).toBe(201);
  });

  it("checks the video limit again as it saves the row", async () => {
    // As if four uploads had passed the first check at once, and two
    // finished first: the row's own check stops the rest.
    const tie = await newTie();
    const me = await signedInUser();
    for (let i = 0; i < 5; i++) {
      await sql(`INSERT INTO media (id, owner_id, tie_id, kind, mime, position, thumb_bytes, bytes)
                 VALUES (?, ?, ?, 'video', 'video/mp4', ?, 1, 2)`, crypto.randomUUID(), me.id, tie, i).run();
    }
    const { insertMedia } = await import("../../src/media/db.js");
    const upload = {
      id: crypto.randomUUID(), item: /** @type {const} */ ({ column: "tie_id", table: "ties", id: tie }),
      kind: /** @type {const} */ ("video"), mime: "video/mp4", thumbBytes: 1, bytes: 2,
    };
    expect(await insertMedia(env.DB, me.id, upload)).toBeNull();
    expect(await insertMedia(env.DB, me.id, { ...upload, kind: "photo", mime: "image/jpeg" })).toBe(5);
  });

  it("is refused from another site, and in a recovery session", async () => {
    const tie = await newTie();
    expect((await upload({ tie_id: tie }, { origin: "https://evil.example" })).status).toBe(403);
    const me = await signedInUser();
    const recovery = await sessionCookieFor(me.id, { kind: "recovery" });
    expect((await upload({ tie_id: tie }, { cookie: recovery })).status).toBe(403);
  });
});

describe("a photo's caption, order and deletion", () => {
  it("sets and clears a sealed caption, and refuses plain text", async () => {
    const tie = await newTie();
    const { id } = await upload({ tie_id: tie });
    expect((await call(`/api/media/${id}`, { method: "PATCH", body: { caption: sealed("Front") } })).status).toBe(204);
    expect((await call(`/api/media?tie_id=${tie}`)).body[0].caption).toBe(sealed("Front"));
    expect((await call(`/api/media/${id}`, { method: "PATCH", body: { caption: "Front" } })).status).toBe(400);
    expect((await call(`/api/media/${id}`, { method: "PATCH", body: { caption: null } })).status).toBe(204);
    expect((await call(`/api/media?tie_id=${tie}`)).body[0].caption).toBeNull();
  });

  it("deletes a photo and its file", async () => {
    const me = await signedInUser();
    const { id } = await upload({ tie_id: await newTie() });
    expect((await call(`/api/media/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await stored(me.id, id)).toBeNull();
    expect((await fetchPart(id, "thumb")).status).toBe(404);
    expect((await call(`/api/media/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("keeps another user away from my photos", async () => {
    const me = await signedInUser();
    const tie = await newTie();
    const { id } = await upload({ tie_id: tie });
    const cookie = await sessionCookieFor(await createOtherUser());
    expect((await fetchPart(id, "thumb", cookie)).status).toBe(404);
    expect((await fetchPart(id, "full", cookie)).status).toBe(404);
    expect((await call(`/api/media?tie_id=${tie}`, { cookie })).status).toBe(404);
    expect((await call(`/api/media/${id}`, { method: "PATCH", cookie, body: { caption: sealed("x") } })).status).toBe(404);
    expect((await call(`/api/media/${id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect(await stored(me.id, id)).not.toBeNull();
  });

  it("can't be put on another user's tie or plan, even directly in the database", async () => {
    const me = await signedInUser();
    const other = await createOtherUser();
    const tie = crypto.randomUUID();
    const plan = crypto.randomUUID();
    await sql("INSERT INTO ties (id, owner_id, tie_date, tie_type) VALUES (?, ?, '2026-10-01', 'floor')", tie, other).run();
    await sql("INSERT INTO plans (id, owner_id, title) VALUES (?, ?, 'Theirs')", plan, other).run();
    for (const [column, id] of [["tie_id", tie], ["plan_id", plan]]) {
      await expect(sql(`INSERT INTO media (id, owner_id, ${column}, kind, mime, position, thumb_bytes, bytes)
                        VALUES (?, ?, ?, 'photo', 'image/jpeg', 0, 1, 2)`, crypto.randomUUID(), me.id, id).run(), column)
        .rejects.toThrow("ownership mismatch");
    }
  });

  it("can't be moved to another tie, even directly in the database", async () => {
    const { id } = await upload({ tie_id: await newTie() });
    const other = await newTie();
    await expect(sql("UPDATE media SET tie_id = ? WHERE id = ?", other, id).run()).rejects.toThrow("ownership mismatch");
  });
});

describe("deleting what photos are on deletes their files", () => {
  it("a tie", async () => {
    const me = await signedInUser();
    const tie = await newTie();
    const { id } = await upload({ tie_id: tie });
    const kept = await upload({ tie_id: await newTie() });
    expect((await call(`/api/ties/${tie}`, { method: "DELETE" })).status).toBe(204);
    expect(await sql("SELECT 1 FROM media WHERE id = ?", id).first()).toBeNull();
    expect(await stored(me.id, id)).toBeNull();
    expect(await stored(me.id, kept.id)).not.toBeNull();
  });

  it("a plan, whether its ties keep it or not", async () => {
    const me = await signedInUser();
    for (const linked of ["keep", "remove"]) {
      const plan = await newPlan();
      const { id } = await upload({ plan_id: plan });
      expect((await call(`/api/plans/${plan}?linked_ties=${linked}`, { method: "DELETE" })).status, linked).toBe(204);
      expect(await stored(me.id, id), linked).toBeNull();
    }
  });

  it("the account", async () => {
    const id = await createOtherUser();
    const cookie = await sessionCookieFor(id);
    const tie = (await call("/api/ties", { method: "POST", cookie, body: { tie_type: "floor", tie_date: "2026-10-01" } })).body.id;
    const plan = (await call("/api/plans", { method: "POST", cookie, body: { title: "TK" } })).body.id;
    await upload({ tie_id: tie }, { cookie });
    await upload({ plan_id: plan }, { cookie });
    const mine = await upload({ tie_id: await newTie() });

    expect((await call("/api/account", { method: "DELETE", cookie })).status).toBe(200);
    expect((await env.PHOTOS.list({ prefix: `${id}/` })).objects).toEqual([]);
    expect(await stored((await signedInUser()).id, mine.id)).not.toBeNull();
  });

  it("starting a new key (the old one can't open them)", async () => {
    const id = await createOtherUser();
    const cookie = await sessionCookieFor(id);
    const tie = (await call("/api/ties", { method: "POST", cookie, body: { tie_type: "floor", tie_date: "2026-10-01" } })).body.id;
    await upload({ tie_id: tie }, { cookie });
    const { loginSecret, newRecoveryCode, readRecoveryCode } = await import("../../public/js/recovery.js");
    const secret = await loginSecret(/** @type {string} */ (readRecoveryCode(newRecoveryCode())));
    const res = await call("/api/keys/setup", {
      method: "POST", cookie, body: { recovery_secret: secret, recovery_wrap: fakeWrap("recovery"), replace: true },
    });
    expect(res.status).toBe(204);
    expect(await sql("SELECT count(*) AS n FROM media WHERE owner_id = ?", id).first()).toEqual({ n: 0 });
    expect((await env.PHOTOS.list({ prefix: `${id}/` })).objects).toEqual([]);
  });
});

describe("the daily clean-up", () => {
  it("deletes files left without a row once they're a day old", async () => {
    const me = await signedInUser();
    const { id } = await upload({ tie_id: await newTie() });
    const orphan = `${me.id}/${crypto.randomUUID()}`;
    await env.PHOTOS.put(orphan, new Uint8Array([1, 2, 3]));

    // Today: too new to tell from an upload still finishing.
    await worker.scheduled(createScheduledController(), env);
    expect(await env.PHOTOS.head(orphan)).not.toBeNull();

    const { sweepOrphans } = await import("../../src/media/storage.js");
    expect(await sweepOrphans(env.DB, env.PHOTOS, Date.now() + 2 * DAY)).toBe(1);
    expect(await env.PHOTOS.head(orphan)).toBeNull();
    expect(await stored(me.id, id)).not.toBeNull();
  });
});
