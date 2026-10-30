import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sessionCookieFor, sql, sealed } from "../helpers.js";
import { MAX_PER_ITEM, JOINTS } from "../../src/poses/parse.js";

/**
 * A pose: the figure at rest with one elbow bent, and one rope from the
 * chest to the ring.
 * @param {number} [elbow]
 * @param {string} [color]
 */
const pose = (elbow = 90, color = "red") => ({
  v: 1,
  joints: { ...Object.fromEntries(Object.entries(JOINTS).map(([name, r]) => [name, r.map(() => 0)])), l_elbow: [elbow, 0] },
  body: [0, 0, 0], lift: 99, shift: [15, -40], camera: [20, 10, 300, 110, 0, 0], ring: [0, 280, 0], bamboo: null, hashira: null,
  ropes: [{ c: color, w: 2, p: [["chest", 0, 120, 110], ["ring", 0, 0, 0]] }],
});

const newTie = () => create("/api/ties", { tie_type: "suspension", tie_date: "2026-10-01", title: "Session" });
const newPlan = () => create("/api/plans", { title: "Side suspension", plan_type: "sequence" });
const newWorkshop = () => create("/api/workshops", { title: "Intro", start_date: "2026-10-01" });

/** @param {Record<string, string>} item */
const listOf = async (item) => (await call(`/api/poses?${new URLSearchParams(item)}`)).body;

describe("adding a pose", () => {
  it("saves it last on its tie, plan or workshop, and lists it with its figure and ropes", async () => {
    const tie = await newTie();
    const first = await call("/api/poses", { method: "POST", body: { tie_id: tie, data: pose(90), caption: sealed("Step 1") } });
    const second = await call("/api/poses", { method: "POST", body: { tie_id: tie, data: pose(45) } });
    expect(first).toMatchObject({ status: 201, body: { position: 0 } });
    expect(second).toMatchObject({ status: 201, body: { position: 1 } });
    const list = await listOf({ tie_id: tie });
    expect(list.map((/** @type {any} */ d) => [d.id, d.data, d.caption, d.position])).toEqual([
      [first.body.id, pose(90), sealed("Step 1"), 0],
      [second.body.id, pose(45), null, 1],
    ]);

    for (const item of /** @type {Record<string, string>[]} */ ([{ plan_id: await newPlan() }, { workshop_id: await newWorkshop() }])) {
      expect((await call("/api/poses", { method: "POST", body: { ...item, data: pose() } })).status).toBe(201);
      expect(await listOf(item)).toHaveLength(1);
    }
  });

  it("stores only what the format has, with joints left out at rest", async () => {
    const tie = await newTie();
    const data = {
      v: 1, extra: "x", joints: { l_knee: [30] }, body: [90, 0, 0], lift: 120, camera: [0, 0, 300, 100], ring: null,
      ropes: [{ c: "blue", w: 1, p: [["pelvis", 1, 2, 3], ["l_knee", 4, 5, 6]], note: "secret" }],
    };
    await call("/api/poses", { method: "POST", body: { tie_id: tie, data } });
    const stored = JSON.parse(/** @type {string} */ ((await sql("SELECT data FROM poses WHERE tie_id = ?", tie).first())?.data));
    expect(stored).not.toHaveProperty("extra");
    // From before the figure could be moved: stored as not moved.
    expect(stored.shift).toEqual([0, 0]);
    expect(stored.ropes).toEqual([{ c: "blue", w: 1, p: [["pelvis", 1, 2, 3], ["l_knee", 4, 5, 6]] }]);
    // One number, from before the knee twisted: its twist at rest.
    expect(stored.joints.l_knee).toEqual([30, 0]);
    expect(stored.joints.spine).toEqual([0, 0, 0]);
    expect(Object.keys(stored.joints)).toEqual(Object.keys(JOINTS));
  });

  it("keeps a bamboo's length and inset, a cinch and a see-saw, and an older bamboo as long as it was", async () => {
    const tie = await newTie();
    const data = {
      ...pose(), ring: null, bamboo: [0, 195, 0, 10, 120, 25],
      ropes: [
        { c: "red", w: 2, p: [["l_wrist", 0, 0, 0], ["bamboo", -400, 0, 0], ["r_wrist", 0, 0, 0]], s: true },
        { c: "blue", w: 2, p: [["chest", 0, 0, 0], ["bamboo", 300, 0, 0]] },
        { c: "green", w: 1, p: [["rope", 0, 0, 500], ["rope", 1, 0, 400]], l: 30 },
      ],
    };
    expect((await call("/api/poses", { method: "POST", body: { tie_id: tie, data } })).status).toBe(201);
    const older = { ...pose(), ring: null, bamboo: [0, 195, 0, 10], ropes: [] };
    expect((await call("/api/poses", { method: "POST", body: { tie_id: tie, data: older } })).status).toBe(201);
    expect((await listOf({ tie_id: tie })).map((/** @type {any} */ d) => d.data)).toEqual([data, { ...older, bamboo: [0, 195, 0, 10, 150, 8] }]);
    const twice = { ...data, ropes: [...data.ropes, data.ropes[2]] };
    expect((await call("/api/poses", { method: "POST", body: { tie_id: tie, data: twice } })).status).toBe(400);
  });

  it("refuses poses that aren't in the format, and a caption that isn't encrypted", async () => {
    const tie = await newTie();
    const bad = [
      { ...pose(), v: 2 },
      { ...pose(), joints: { tail: [1] } },
      { ...pose(), joints: { l_elbow: [-10] } },
      { ...pose(), lift: 900 },
      { ...pose(), shift: [0, 500] },
      { ...pose(), ring: null },
      { ...pose(), ropes: [{ c: "red", w: 2, p: [["chest", 0, 0, 0]] }] },
      { ...pose(), ropes: [{ c: "red", w: 2, p: [["wing", 0, 0, 0], ["chest", 0, 0, 0]] }] },
    ];
    for (const data of bad) {
      const res = await call("/api/poses", { method: "POST", body: { tie_id: tie, data } });
      expect(res.status, JSON.stringify(data)).toBe(400);
    }
    const plain = await call("/api/poses", { method: "POST", body: { tie_id: tie, data: pose(), caption: "Step 1" } });
    expect(plain.status).toBe(400);
    expect(await listOf({ tie_id: tie })).toEqual([]);
  });

  it(`allows ${MAX_PER_ITEM} on one item`, async () => {
    const tie = await newTie();
    for (let i = 0; i < MAX_PER_ITEM; i++) await create("/api/poses", { tie_id: tie, data: pose() });
    const res = await call("/api/poses", { method: "POST", body: { tie_id: tie, data: pose() } });
    expect(res).toMatchObject({ status: 400, body: { error: `There can be at most ${MAX_PER_ITEM} poses on a tie, plan or workshop.` } });
  });

  it("can't add to, or list, someone else's tie", async () => {
    const them = await createOtherUser();
    const cookie = await sessionCookieFor(them);
    const theirs = (await call("/api/ties", { method: "POST", body: { tie_type: "floor", tie_date: "2026-10-01", title: "x" }, cookie })).body.id;
    expect((await call("/api/poses", { method: "POST", body: { tie_id: theirs, data: pose() } })).status).toBe(404);
    expect((await call(`/api/poses?tie_id=${theirs}`)).status).toBe(404);
    expect((await call("/api/poses", { method: "POST", body: { data: pose() } })).status).toBe(400);
  });
});

describe("changing a pose", () => {
  it("saves a new pose and a new caption separately, and changes updated_at", async () => {
    const tie = await newTie();
    const id = await create("/api/poses", { tie_id: tie, data: pose(90), caption: sealed("Step 1") });
    await sql("UPDATE poses SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ?", id).run();

    expect((await call(`/api/poses/${id}`, { method: "PUT", body: { data: pose(10) } })).status).toBe(204);
    let [saved] = await listOf({ tie_id: tie });
    expect([saved.data, saved.caption]).toEqual([pose(10), sealed("Step 1")]);
    expect(saved.updated_at > "2026-01-01T00:00:00Z").toBe(true);

    expect((await call(`/api/poses/${id}`, { method: "PUT", body: { caption: null } })).status).toBe(204);
    [saved] = await listOf({ tie_id: tie });
    expect([saved.data, saved.caption]).toEqual([pose(10), null]);

    expect((await call(`/api/poses/${id}`, { method: "PUT", body: {} })).status).toBe(400);
  });

  it("deletes one, leaving its copies", async () => {
    const tie = await newTie();
    const other = await newTie();
    const id = await create("/api/poses", { tie_id: tie, data: pose() });
    const copy = await create("/api/poses", { tie_id: other, data: pose() });
    expect((await call(`/api/poses/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await listOf({ tie_id: tie })).toEqual([]);
    expect((await listOf({ tie_id: other })).map((/** @type {any} */ d) => d.id)).toEqual([copy]);
    expect((await call(`/api/poses/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("can't change or delete someone else's", async () => {
    const them = await createOtherUser();
    const cookie = await sessionCookieFor(them);
    const tie = (await call("/api/ties", { method: "POST", body: { tie_type: "floor", tie_date: "2026-10-01", title: "x" }, cookie })).body.id;
    const id = (await call("/api/poses", { method: "POST", body: { tie_id: tie, data: pose() }, cookie })).body.id;
    expect((await call(`/api/poses/${id}`, { method: "PUT", body: { data: pose(5) } })).status).toBe(404);
    expect((await call(`/api/poses/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/api/poses/${id}`, { method: "PUT", body: { data: pose(5) }, cookie })).status).toBe(204);
  });
});

describe("deleting what a pose is on", () => {
  it("deletes its poses with a tie, a plan or a workshop", async () => {
    const tie = await newTie();
    const plan = await newPlan();
    const workshop = await newWorkshop();
    await create("/api/poses", { tie_id: tie, data: pose() });
    await create("/api/poses", { plan_id: plan, data: pose() });
    await create("/api/poses", { workshop_id: workshop, data: pose() });
    await call(`/api/ties/${tie}`, { method: "DELETE" });
    await call(`/api/plans/${plan}?linked_ties=keep`, { method: "DELETE" });
    await call(`/api/workshops/${workshop}`, { method: "DELETE" });
    const count = await sql("SELECT count(*) AS n FROM poses WHERE tie_id = ? OR plan_id = ? OR workshop_id = ?", tie, plan, workshop).first();
    expect(count?.n).toBe(0);
  });
});

describe("exporting poses", () => {
  it("lists each item's poses, with their data and sealed captions", async () => {
    const tie = await newTie();
    await create("/api/poses", { tie_id: tie, data: pose(70, "purple"), caption: sealed("Lift") });
    const doc = (await call("/api/data/export")).body;
    const exported = doc.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(exported.poses).toMatchObject([{ data: pose(70, "purple"), caption: sealed("Lift"), position: 0 }]);
  });
});

describe("a new key", () => {
  it("is in the encrypted columns, so a new key empties its captions but keeps the pose", async () => {
    const { emptyEncryptedStatements } = await import("../../src/encryption/db.js");
    const { env } = await import("cloudflare:test");
    const tie = await newTie();
    await create("/api/poses", { tie_id: tie, data: pose(), caption: sealed("Step 1") });
    const owner = /** @type {string} */ ((await sql("SELECT owner_id FROM ties WHERE id = ?", tie).first())?.owner_id);
    await env.DB.batch(emptyEncryptedStatements(env.DB, owner));
    const [saved] = await listOf({ tie_id: tie });
    expect([saved.data, saved.caption]).toEqual([pose(), null]);
  });
});
