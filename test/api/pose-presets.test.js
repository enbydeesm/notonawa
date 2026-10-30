import { describe, it, expect, beforeEach } from "vitest";
import { call, createOtherUser, sessionCookieFor, signedInUser, sql, sealed } from "../helpers.js";
import { MAX_PRESETS } from "../../src/pose-presets/parse.js";

/** A body preset: kneeling, tipped forward a little. */
const body = { joints: { l_knee: [155], r_knee: [155], l_hip: [65, 8, 0] }, body: [10, 0, 0], lift: 29 };
/** An arms preset: a box tie's arms. */
const arms = { joints: { l_shoulder: [-21, 5, -90], l_elbow: [105], r_shoulder: [-21, 5, -90], r_elbow: [90] } };

// Each test starts with none (the file's tests share one database).
beforeEach(async () => {
  await sql("DELETE FROM pose_presets").run();
});

/** @param {Record<string, any>} preset */
const save = (preset) => call("/api/pose-presets", { method: "POST", body: preset });
const list = async () => (await call("/api/pose-presets")).body;

describe("saving a preset", () => {
  it("keeps body and arms presets, oldest first, names sealed and every joint of its kind listed", async () => {
    const first = await save({ kind: "body", name: sealed("Seiza, leaning"), data: body });
    const second = await save({ kind: "arms", name: sealed("Sam's boxtie"), data: arms });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const presets = await list();
    expect(presets.map((/** @type {any} */ p) => [p.id, p.kind, p.name])).toEqual([
      [first.body.id, "body", sealed("Seiza, leaning")], [second.body.id, "arms", sealed("Sam's boxtie")],
    ]);
    const [b, a] = presets.map((/** @type {any} */ p) => p.data);
    expect(Object.keys(b.joints)).toEqual(["spine", "chest", "head", "l_hip", "l_knee", "l_ankle", "r_hip", "r_knee", "r_ankle"]);
    expect(b.joints.l_hip).toEqual([65, 8, 0]);
    expect(b.joints.spine).toEqual([0, 0, 0]);
    expect([b.body, b.lift]).toEqual([[10, 0, 0], 29]);
    expect(Object.keys(a.joints)).toEqual(["l_shoulder", "l_elbow", "l_wrist", "r_shoulder", "r_elbow", "r_wrist"]);
    expect(a).not.toHaveProperty("body");
    expect(a.joints.l_wrist).toEqual([0, 0]);
  });

  it("stores only what the format has", async () => {
    await save({ kind: "arms", name: sealed("x"), data: { ...arms, extra: "secret", body: [1, 2, 3] } });
    const stored = JSON.parse(/** @type {string} */ ((await sql("SELECT data FROM pose_presets").first())?.data));
    expect(Object.keys(stored)).toEqual(["joints"]);
  });

  it("refuses a name that isn't sealed or is missing, a joint of the other kind, and angles past a joint's limits", async () => {
    const refused = [
      { kind: "body", name: "plain text", data: body },
      { kind: "body", name: null, data: body },
      { kind: "legs", name: sealed("x"), data: body },
      { kind: "body", name: sealed("x"), data: { ...body, joints: { l_elbow: [10] } } },
      { kind: "arms", name: sealed("x"), data: { joints: { l_knee: [10] } } },
      { kind: "arms", name: sealed("x"), data: { joints: { l_elbow: [200] } } },
      { kind: "arms", name: sealed("x"), data: { joints: { l_elbow: [10.5] } } },
      { kind: "body", name: sealed("x"), data: { joints: {}, body: [0, 0], lift: 99 } },
      { kind: "body", name: sealed("x"), data: { joints: {}, body: [0, 0, 0], lift: 999 } },
      { kind: "arms", name: sealed("x"), data: null },
    ];
    for (const preset of refused) expect((await save(preset)).status, JSON.stringify(preset)).toBe(400);
    expect(await list()).toEqual([]);
  });

  it(`keeps up to ${MAX_PRESETS} an account`, async () => {
    const { id: userId } = await signedInUser();
    for (let i = 0; i < MAX_PRESETS; i++) {
      await sql("INSERT INTO pose_presets (id, owner_id, kind, name, data) VALUES (?, ?, 'arms', ?, ?)",
        crypto.randomUUID(), userId, sealed("x"), JSON.stringify(arms)).run();
    }
    const full = await save({ kind: "arms", name: sealed("One more"), data: arms });
    expect(full.status).toBe(400);
    expect(full.body.error).toMatch(/up to 50/);
  });
});

describe("changing and deleting a preset", () => {
  it("renames one, sealed, and deletes it", async () => {
    const { id } = (await save({ kind: "arms", name: sealed("Boxtie"), data: arms })).body;
    expect((await call(`/api/pose-presets/${id}`, { method: "PUT", body: { name: sealed("TK") } })).status).toBe(204);
    expect((await list())[0].name).toBe(sealed("TK"));
    expect((await sql("SELECT updated_at > created_at OR updated_at = created_at AS ok FROM pose_presets").first())?.ok).toBe(1);
    expect((await call(`/api/pose-presets/${id}`, { method: "PUT", body: { name: "TK" } })).status).toBe(400);
    expect((await call(`/api/pose-presets/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await call(`/api/pose-presets/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await call("/api/pose-presets/not-an-id", { method: "DELETE" })).status).toBe(400);
  });

  it("saves new angles over one's own, checked as its kind's, keeping its name", async () => {
    const { id } = (await save({ kind: "arms", name: sealed("Boxtie"), data: arms })).body;
    const put = (/** @type {Record<string, any>} */ body) => call(`/api/pose-presets/${id}`, { method: "PUT", body });
    const higher = { joints: { ...arms.joints, l_elbow: [120] } };
    expect((await put({ data: higher })).status).toBe(204);
    const [preset] = await list();
    expect(preset.name).toBe(sealed("Boxtie"));
    expect(preset.data.joints.l_elbow).toEqual([120, 0]);
    // Both at once, too.
    expect((await put({ name: sealed("TK"), data: arms })).status).toBe(204);
    expect((await list())[0]).toMatchObject({ name: sealed("TK"), data: { joints: { l_elbow: [105, 0] } } });
    // A body's angles on an arms preset, past a limit, or nothing to change: refused, nothing saved.
    for (const body of [{ data: { joints: { l_knee: [10] } } }, { data: { joints: { l_elbow: [200] } } }, {}, { data: null }]) {
      expect((await put(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await list())[0].data.joints.l_elbow).toEqual([105, 0]);
    expect((await call(`/api/pose-presets/${crypto.randomUUID()}`, { method: "PUT", body: { data: arms } })).status).toBe(404);
  });

  it("keeps someone else's presets out of reach", async () => {
    const them = await createOtherUser();
    const cookie = await sessionCookieFor(them);
    const theirs = (await call("/api/pose-presets", { method: "POST", body: { kind: "arms", name: sealed("Theirs"), data: arms }, cookie })).body.id;
    expect(await list()).toEqual([]);
    expect((await call(`/api/pose-presets/${theirs}`, { method: "PUT", body: { name: sealed("Mine now") } })).status).toBe(404);
    expect((await call(`/api/pose-presets/${theirs}`, { method: "PUT", body: { data: arms } })).status).toBe(404);
    expect((await call(`/api/pose-presets/${theirs}`, { method: "DELETE" })).status).toBe(404);
    expect((await call("/api/pose-presets", { cookie })).body).toHaveLength(1);
    // And the database won't move one to another owner.
    const { id: userId } = await signedInUser();
    await expect(sql("UPDATE pose_presets SET owner_id = ? WHERE id = ?", userId, theirs).run()).rejects.toThrow(/ownership mismatch/);
  });
});
