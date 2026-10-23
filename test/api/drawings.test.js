import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sessionCookieFor, sql, sealed } from "../helpers.js";
import { MAX_PER_ITEM } from "../../src/drawings/parse.js";

/**
 * A drawing's lines.
 * @param {string} [color]
 * @param {number[]} [points]
 */
const lines = (color = "red", points = [10, 20, 30, 40]) => ({ v: 1, strokes: [{ c: color, w: 2, p: points }] });

const newTie = () => create("/api/ties", { tie_type: "floor", tie_date: "2026-10-01", title: "Session" });
const newPlan = () => create("/api/plans", { title: "TK" });
const newWorkshop = () => create("/api/workshops", { title: "Intro", start_date: "2026-10-01" });

/** @param {Record<string, string>} item */
const listOf = async (item) => (await call(`/api/drawings?${new URLSearchParams(item)}`)).body;

describe("adding a drawing", () => {
  it("saves it last on its tie, plan or workshop, and lists it with its lines", async () => {
    const tie = await newTie();
    const first = await call("/api/drawings", { method: "POST", body: { tie_id: tie, data: lines("red"), caption: sealed("Front") } });
    const second = await call("/api/drawings", { method: "POST", body: { tie_id: tie, data: lines("blue") } });
    expect(first).toMatchObject({ status: 201, body: { position: 0 } });
    expect(second).toMatchObject({ status: 201, body: { position: 1 } });
    const list = await listOf({ tie_id: tie });
    expect(list.map((/** @type {any} */ d) => [d.id, d.data, d.caption, d.position])).toEqual([
      [first.body.id, lines("red"), sealed("Front"), 0],
      [second.body.id, lines("blue"), null, 1],
    ]);

    for (const item of /** @type {Record<string, string>[]} */ ([{ plan_id: await newPlan() }, { workshop_id: await newWorkshop() }])) {
      expect((await call("/api/drawings", { method: "POST", body: { ...item, data: lines() } })).status).toBe(201);
      expect(await listOf(item)).toHaveLength(1);
    }
  });

  it("stores only what the format has", async () => {
    const tie = await newTie();
    const data = { v: 1, extra: "x", strokes: [{ c: "red", w: 1, p: [1, 2], note: "secret" }] };
    await call("/api/drawings", { method: "POST", body: { tie_id: tie, data } });
    expect((await sql("SELECT data FROM drawings WHERE tie_id = ?", tie).first())?.data)
      .toBe('{"v":1,"strokes":[{"c":"red","w":1,"p":[1,2]}]}');
  });

  it("refuses lines that aren't in the format, and a caption that isn't encrypted", async () => {
    const tie = await newTie();
    const bad = [
      { strokes: [] },
      { v: 1, strokes: [] },
      { v: 1, strokes: [{ c: "gold", w: 1, p: [1, 1] }] },
      { v: 1, strokes: [{ c: "red", w: 1, p: [1, 1, 2] }] },
      { v: 1, strokes: [{ c: "red", w: 1, p: [901, 1] }] },
    ];
    for (const data of bad) {
      const res = await call("/api/drawings", { method: "POST", body: { tie_id: tie, data } });
      expect(res.status, JSON.stringify(data)).toBe(400);
    }
    const plain = await call("/api/drawings", { method: "POST", body: { tie_id: tie, data: lines(), caption: "Front" } });
    expect(plain.status).toBe(400);
    expect(await listOf({ tie_id: tie })).toEqual([]);
  });

  it(`allows ${MAX_PER_ITEM} on one item`, async () => {
    const tie = await newTie();
    for (let i = 0; i < MAX_PER_ITEM; i++) await create("/api/drawings", { tie_id: tie, data: lines() });
    const res = await call("/api/drawings", { method: "POST", body: { tie_id: tie, data: lines() } });
    expect(res).toMatchObject({ status: 400, body: { error: `There can be at most ${MAX_PER_ITEM} drawings on a tie, plan or workshop.` } });
  });

  it("can't add to, or list, someone else's tie", async () => {
    const them = await createOtherUser();
    const cookie = await sessionCookieFor(them);
    const theirs = (await call("/api/ties", { method: "POST", body: { tie_type: "floor", tie_date: "2026-10-01", title: "x" }, cookie })).body.id;
    expect((await call("/api/drawings", { method: "POST", body: { tie_id: theirs, data: lines() } })).status).toBe(404);
    expect((await call(`/api/drawings?tie_id=${theirs}`)).status).toBe(404);
    expect((await call("/api/drawings", { method: "POST", body: { data: lines() } })).status).toBe(400);
  });
});

describe("changing a drawing", () => {
  it("saves new lines and a new caption separately, and changes updated_at", async () => {
    const tie = await newTie();
    const id = await create("/api/drawings", { tie_id: tie, data: lines("red"), caption: sealed("Front") });
    await sql("UPDATE drawings SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ?", id).run();

    expect((await call(`/api/drawings/${id}`, { method: "PUT", body: { data: lines("blue") } })).status).toBe(204);
    let [drawing] = await listOf({ tie_id: tie });
    expect([drawing.data, drawing.caption]).toEqual([lines("blue"), sealed("Front")]);
    expect(drawing.updated_at > "2026-01-01T00:00:00Z").toBe(true);

    expect((await call(`/api/drawings/${id}`, { method: "PUT", body: { caption: null } })).status).toBe(204);
    [drawing] = await listOf({ tie_id: tie });
    expect([drawing.data, drawing.caption]).toEqual([lines("blue"), null]);

    expect((await call(`/api/drawings/${id}`, { method: "PUT", body: {} })).status).toBe(400);
  });

  it("puts an item's drawings in a new order, only with every one of them", async () => {
    const plan = await newPlan();
    const ids = [];
    for (const c of ["red", "green", "blue"]) ids.push(await create("/api/drawings", { plan_id: plan, data: lines(c) }));
    const order = [ids[2], ids[0], ids[1]];
    expect((await call("/api/drawings/order", { method: "PUT", body: { plan_id: plan, ids: order } })).status).toBe(204);
    expect((await listOf({ plan_id: plan })).map((/** @type {any} */ d) => d.id)).toEqual(order);
    const partial = await call("/api/drawings/order", { method: "PUT", body: { plan_id: plan, ids: [ids[0], ids[1]] } });
    expect(partial.status).toBe(400);
    expect((await listOf({ plan_id: plan })).map((/** @type {any} */ d) => d.id)).toEqual(order);
  });

  it("deletes one, leaving its copies", async () => {
    const tie = await newTie();
    const other = await newTie();
    const id = await create("/api/drawings", { tie_id: tie, data: lines() });
    const copy = await create("/api/drawings", { tie_id: other, data: lines() });
    expect((await call(`/api/drawings/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await listOf({ tie_id: tie })).toEqual([]);
    expect((await listOf({ tie_id: other })).map((/** @type {any} */ d) => d.id)).toEqual([copy]);
    expect((await call(`/api/drawings/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("can't change or delete someone else's", async () => {
    const them = await createOtherUser();
    const cookie = await sessionCookieFor(them);
    const tie = (await call("/api/ties", { method: "POST", body: { tie_type: "floor", tie_date: "2026-10-01", title: "x" }, cookie })).body.id;
    const id = (await call("/api/drawings", { method: "POST", body: { tie_id: tie, data: lines() }, cookie })).body.id;
    expect((await call(`/api/drawings/${id}`, { method: "PUT", body: { data: lines("blue") } })).status).toBe(404);
    expect((await call(`/api/drawings/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await call(`/api/drawings/${id}`, { method: "PUT", body: { data: lines("blue") }, cookie })).status).toBe(204);
  });
});

describe("deleting what a drawing is on", () => {
  it("deletes its drawings with a tie, a plan or a workshop", async () => {
    const tie = await newTie();
    const plan = await newPlan();
    const workshop = await newWorkshop();
    await create("/api/drawings", { tie_id: tie, data: lines() });
    await create("/api/drawings", { plan_id: plan, data: lines() });
    await create("/api/drawings", { workshop_id: workshop, data: lines() });
    await call(`/api/ties/${tie}`, { method: "DELETE" });
    await call(`/api/plans/${plan}?linked_ties=keep`, { method: "DELETE" });
    await call(`/api/workshops/${workshop}`, { method: "DELETE" });
    const count = await sql("SELECT count(*) AS n FROM drawings WHERE tie_id = ? OR plan_id = ? OR workshop_id = ?", tie, plan, workshop).first();
    expect(count?.n).toBe(0);
  });
});

describe("exporting drawings", () => {
  it("lists each item's drawings, with their lines and sealed captions", async () => {
    const tie = await newTie();
    await create("/api/drawings", { tie_id: tie, data: lines("purple"), caption: sealed("Back") });
    const doc = (await call("/api/data/export")).body;
    const exported = doc.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(exported.drawings).toMatchObject([{ data: lines("purple"), caption: sealed("Back"), position: 0 }]);
    expect(exported.drawings[0].file).toBe(`drawings/${exported.drawings[0].id}.svg`);
  });
});

describe("a new key", () => {
  it("is in the encrypted columns, so a new key empties its captions but keeps its lines", async () => {
    const { emptyEncryptedStatements } = await import("../../src/encryption/db.js");
    const { env } = await import("cloudflare:test");
    const tie = await newTie();
    await create("/api/drawings", { tie_id: tie, data: lines(), caption: sealed("Front") });
    const owner = /** @type {string} */ ((await sql("SELECT owner_id FROM ties WHERE id = ?", tie).first())?.owner_id);
    await env.DB.batch(emptyEncryptedStatements(env.DB, owner));
    const [drawing] = await listOf({ tie_id: tie });
    expect([drawing.data, drawing.caption]).toEqual([lines(), null]);
  });
});
