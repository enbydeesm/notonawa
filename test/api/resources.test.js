import { describe, it, expect } from "vitest";
import { call, create, createOtherUser, sql, sealed, sessionCookieFor } from "../helpers.js";

describe("plans, people and locations", () => {
  it("adds, lists and edits", async () => {
    const id = await create("/api/plans", { title: "Hip harness", stage: "ready", est_difficulty: "3" });

    const list = await call("/api/plans?archived=false");
    expect(list.status).toBe(200);
    expect(list.body).toContainEqual(expect.objectContaining({
      id, title: "Hip harness", stage: "ready", est_difficulty: 3, version: 1, archived_at: null,
    }));

    const edit = await call(`/api/plans/${id}`, { method: "PUT", body: { title: "Hip harness v2", stage: "ready" } });
    expect(edit.status).toBe(200);
    const plan = await sql("SELECT title, created_at, updated_at FROM plans WHERE id = ?", id).first();
    expect(plan?.title).toBe("Hip harness v2");
    // Timestamps are ISO: 2026-10-12T21:02:58Z
    expect(plan?.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("keeps a person's educator flag, and their sealed city and other names", async () => {
    const id = await create("/api/people", {
      name: "Kit", is_educator: true, based_in: sealed("Seattle, WA"), aliases: sealed('[{"platform":"scene","alias":"kit"}]'),
    });
    const found = (await call("/api/people?archived=false")).body.find((/** @type {any} */ p) => p.id === id);
    expect(found).toEqual(expect.objectContaining({
      is_educator: 1, based_in: sealed("Seattle, WA"), aliases: sealed('[{"platform":"scene","alias":"kit"}]'),
    }));
    expect((await call(`/api/people/${id}`, { method: "PUT", body: { name: "Kit" } })).status).toBe(200);
    expect(await sql("SELECT is_educator, based_in, aliases FROM people WHERE id = ?", id).first())
      .toEqual({ is_educator: 0, based_in: null, aliases: null });
    expect((await call("/api/people", { method: "POST", body: { name: "Plain", based_in: "Seattle, WA" } })).status).toBe(400);
    expect((await call("/api/people", { method: "POST", body: { name: "Plain", aliases: "[]" } })).status).toBe(400);
  });

  it("rejects bad input with a friendly message", async () => {
    expect(await call("/api/people", { method: "POST", body: { pronouns: "they/them" } }))
      .toEqual({ status: 400, body: { error: "Give the person a name." } });
    expect(await call("/api/people", { method: "POST", body: "not json" }))
      .toEqual({ status: 400, body: { error: "Expected a JSON object." } });
    expect((await call("/api/locations", { method: "POST", body: { name: "x", maps_url: "javascript:alert(1)" } })).status)
      .toBe(400);
  });

  it("allows only one 'this is me' profile", async () => {
    await create("/api/people", { name: "Me", is_self: true });
    expect(await call("/api/people", { method: "POST", body: { name: "Me again", is_self: true } }))
      .toEqual({ status: 400, body: { error: "You already have a profile marked as you." } });
  });

  it("gives plans a type, idea by default, and edits leave the old stage alone", async () => {
    const plan = await create("/api/plans", { title: "Box tie", stage: "ready", plan_type: "harness" });
    /** @returns {Promise<any>} */
    const get = async () => (await call("/api/plans?archived=all")).body.find((/** @type {any} */ p) => p.id === plan);
    expect(await get()).toMatchObject({ plan_type: "harness", stage: "ready" });
    expect((await call(`/api/plans/${plan}`, { method: "PUT", body: { title: "Box tie", plan_type: "sequence" } })).status).toBe(200);
    expect(await get()).toMatchObject({ plan_type: "sequence", stage: "ready" });
    expect((await get()).plan_type).toBe("sequence");
    const plain = await create("/api/plans", { title: "Idea" });
    expect((await call("/api/plans?archived=all")).body.find((/** @type {any} */ p) => p.id === plain).plan_type).toBe("idea");
    expect((await call("/api/plans", { method: "POST", body: { title: "x", plan_type: "stage" } })).status).toBe(400);
  });

  it("keeps one default location: setting another moves it, archiving clears it", async () => {
    /** @returns {Promise<string[]>} */
    const defaults = async () => (await call("/api/locations?archived=all")).body
      .filter((/** @type {any} */ l) => l.is_default).map((/** @type {any} */ l) => l.name);
    const studio = await create("/api/locations", { name: "Default Studio", is_default: true });
    expect(await defaults()).toEqual(["Default Studio"]);
    const park = await create("/api/locations", { name: "Default Park" });
    expect((await call(`/api/locations/${park}`, { method: "PUT", body: { name: "Default Park", is_default: true } })).status).toBe(200);
    expect(await defaults()).toEqual(["Default Park"]);
    // A new one made the default takes over too.
    const home = await create("/api/locations", { name: "Default Home", is_default: true });
    expect(await defaults()).toEqual(["Default Home"]);
    // Saving the default without the flag unsets it.
    expect((await call(`/api/locations/${home}`, { method: "PUT", body: { name: "Default Home" } })).status).toBe(200);
    expect(await defaults()).toEqual([]);
    // Archiving the default clears it, and an archived one can't be made the default.
    await call(`/api/locations/${studio}`, { method: "PUT", body: { name: "Default Studio", is_default: true } });
    expect((await call(`/api/locations/${studio}/archive`, { method: "POST" })).status).toBe(200);
    expect(await defaults()).toEqual([]);
    expect(await call(`/api/locations/${studio}`, { method: "PUT", body: { name: "Default Studio", is_default: true } }))
      .toEqual({ status: 400, body: { error: "An archived location can't be the default. Restore it first." } });
    // Nor can one archived as it's added.
    await create("/api/locations", { name: "Default Hotel", is_default: true, archive_now: true });
    expect(await defaults()).toEqual([]);
  });

  it("keeps my own profile: edits can't change who is me, and it can't be archived or deleted", async () => {
    const mine = (await call("/api/people?archived=all")).body.find((/** @type {any} */ p) => p.is_self);
    const me = mine ? mine.id : await create("/api/people", { name: "Me", is_self: true });
    const sam = await create("/api/people", { name: "Sam" });
    /** @param {string} id */
    const isSelf = async (id) => (await call("/api/people?archived=all")).body.find((/** @type {any} */ p) => p.id === id).is_self;

    // Renaming works; is_self in an edit is ignored either way.
    expect((await call(`/api/people/${me}`, { method: "PUT", body: { name: "Me (renamed)", is_self: false } })).status).toBe(200);
    expect(await isSelf(me)).toBe(1);
    expect((await call(`/api/people/${sam}`, { method: "PUT", body: { name: "Sam", is_self: true } })).status).toBe(200);
    expect(await isSelf(sam)).toBe(0);

    const kept = { status: 400, body: { error: "Your own profile can't be deleted or archived. You can rename it." } };
    expect(await call(`/api/people/${me}`, { method: "DELETE" })).toEqual(kept);
    expect(await call(`/api/people/${me}/archive`, { method: "POST" })).toEqual(kept);
    expect((await call("/api/people?archived=false")).body.map((/** @type {any} */ p) => p.id)).toContain(me);
    // Anyone else still can be.
    expect((await call(`/api/people/${sam}/archive`, { method: "POST" })).status).toBe(200);
    expect((await call(`/api/people/${sam}`, { method: "DELETE" })).status).toBe(204);
  });

  it("archives (hidden from the default list) and restores", async () => {
    const id = await create("/api/people", { name: "Alex" });

    const archived = await call(`/api/people/${id}/archive`, { method: "POST" });
    expect(archived.body.archived_at).toMatch(/Z$/);
    // Archiving again keeps the original date.
    expect((await call(`/api/people/${id}/archive`, { method: "POST" })).body.archived_at).toBe(archived.body.archived_at);

    expect((await call("/api/people?archived=false")).body.map((/** @type {any} */ p) => p.id)).not.toContain(id);
    expect((await call("/api/people?archived=true")).body.map((/** @type {any} */ p) => p.id)).toContain(id);

    expect((await call(`/api/people/${id}/restore`, { method: "POST" })).status).toBe(200);
    expect((await call("/api/people?archived=false")).body.map((/** @type {any} */ p) => p.id)).toContain(id);
    // Restoring something that isn't archived is a 404.
    expect((await call(`/api/people/${id}/restore`, { method: "POST" })).status).toBe(404);
  });

  it("lists active, archived or all items, and requires saying which", async () => {
    const active = await create("/api/locations", { name: "Studio" });
    const archived = await create("/api/locations", { name: "Hotel", archive_now: true });
    /** @param {string} query */
    const ids = async (query) => (await call(`/api/locations${query}`)).body.map((/** @type {any} */ l) => l.id);

    expect(await ids("?archived=false")).toContain(active);
    expect(await ids("?archived=false")).not.toContain(archived);
    // Other tests archive locations too, so only these two are checked.
    expect(await ids("?archived=true")).toContain(archived);
    expect(await ids("?archived=true")).not.toContain(active);
    expect(await ids("?archived=all")).toEqual(expect.arrayContaining([active, archived]));

    // Forgetting it is an error, not a quiet default.
    for (const query of ["", "?archived=", "?archived=1", "?archived=null"]) {
      const res = await call(`/api/locations${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("archived=false");
    }
  });

  it("restoring a plan keeps its stage", async () => {
    const id = await create("/api/plans", { title: "Futomomo", stage: "developing" });
    await call(`/api/plans/${id}/archive`, { method: "POST" });
    await call(`/api/plans/${id}/restore`, { method: "POST" });
    expect((await sql("SELECT stage FROM plans WHERE id = ?", id).first())?.stage).toBe("developing");
  });

  it("saves a person's default role, which must be one of the roles", async () => {
    const id = await create("/api/people", { name: "Sam", default_role: "bottom" });
    expect((await call("/api/people?archived=false")).body.find((/** @type {any} */ p) => p.id === id).default_role).toBe("bottom");
    const bad = await call("/api/people", { method: "POST", body: { name: "Kit", default_role: "chef" } });
    expect(bad.status).toBe(400);
    await call(`/api/people/${id}`, { method: "PUT", body: { name: "Sam", default_role: "" } });
    expect((await call("/api/people?archived=false")).body.find((/** @type {any} */ p) => p.id === id).default_role).toBeNull();
  });

  it("can add a location, person or plan already archived (a one-off)", async () => {
    for (const [type, body] of /** @type {const} */ ([
      ["locations", { name: "Hotel" }], ["people", { name: "Once" }], ["plans", { title: "Tried once" }],
    ])) {
      const id = await create(`/api/${type}`, { ...body, archive_now: true });
      expect((await call(`/api/${type}?archived=true`)).body.map((/** @type {any} */ l) => l.id)).toContain(id);
      expect((await call(`/api/${type}?archived=false`)).body.map((/** @type {any} */ l) => l.id)).not.toContain(id);
    }
  });

  it("stops a plan being a variation of itself", async () => {
    const id = await create("/api/plans", { title: "Loop" });
    const res = await call(`/api/plans/${id}`, { method: "PUT", body: { title: "Loop", variation_of: id } });
    expect(res).toEqual({ status: 400, body: { error: "A plan can't be a variation of itself." } });
  });
});

describe("a plan's tie type, album link and tags", () => {
  it("saves an optional tie type and a sealed album link", async () => {
    const album = sealed("https://photos.app.goo.gl/plan");
    const id = await create("/api/plans", { title: "Typed plan", tie_type: "partial suspension", album_url: album });
    const plain = await create("/api/plans", { title: "Untyped plan" });
    const plans = (await call("/api/plans?archived=false")).body;
    expect(plans.find((/** @type {any} */ p) => p.id === id)).toMatchObject({ tie_type: "partial suspension", album_url: album });
    expect(plans.find((/** @type {any} */ p) => p.id === plain)).toMatchObject({ tie_type: null, album_url: null });

    await call(`/api/plans/${id}`, { method: "PUT", body: { title: "Typed plan" } });
    expect((await call("/api/plans?archived=false")).body.find((/** @type {any} */ p) => p.id === id))
      .toMatchObject({ tie_type: null, album_url: null });

    expect((await call("/api/plans", { method: "POST", body: { title: "x", tie_type: "hanging" } })).status).toBe(400);
    expect((await call("/api/plans", { method: "POST", body: { title: "x", album_url: "https://plain.example" } })).status).toBe(400);
  });

  it("saves tags with a plan, creating new ones and sharing them with ties", async () => {
    await create("/api/ties", { title: "x", tie_date: "2026-01-01", tie_type: "floor", tags: ["Shared"] });
    const id = await create("/api/plans", { title: "Tagged plan", tags: ["shared", "Plan-only", "plan-only"] });
    const listed = async () => (await call("/api/plans?archived=all")).body.find((/** @type {any} */ p) => p.id === id).tags;
    // "shared" matched my "Shared"; the repeat was kept once.
    expect(await listed()).toEqual(["Plan-only", "Shared"]);
    const tags = (await call("/api/tags")).body;
    expect(tags.filter((/** @type {any} */ t) => ["Shared", "Plan-only"].includes(t.name)).map((/** @type {any} */ t) => [t.name, t.tie_count, t.plan_count]))
      .toEqual([["Shared", 1, 1], ["Plan-only", 0, 1]]);

    // An edit replaces them; archiving keeps them.
    await call(`/api/plans/${id}`, { method: "PUT", body: { title: "Tagged plan", tags: ["Edited"] } });
    expect(await listed()).toEqual(["Edited"]);
    await call(`/api/plans/${id}/archive`, { method: "POST" });
    expect(await listed()).toEqual(["Edited"]);
    await call(`/api/plans/${id}`, { method: "PUT", body: { title: "Tagged plan" } });
    expect(await listed()).toEqual([]);
  });

  it("saves nothing when the tags are bad, and new plans list none", async () => {
    expect((await call("/api/plans", { method: "POST", body: { title: "Bad tags", tags: "floor" } })).status).toBe(400);
    expect(await sql("SELECT id FROM plans WHERE title = 'Bad tags'").first()).toBeNull();
    const id = await create("/api/plans", { title: "No tags" });
    expect((await call("/api/plans?archived=false")).body.find((/** @type {any} */ p) => p.id === id).tags).toEqual([]);
  });

  it("lists the ties each plan is on, newest first, with their titles and ratings", async () => {
    const plan = await create("/api/plans", { title: "Linked plan" });
    const unused = await create("/api/plans", { title: "Unused plan" });
    const older = await create("/api/ties", { title: "First go", tie_date: "2026-03-01", tie_type: "floor", success_rating: 2, plan_ids: [plan] });
    const newer = await create("/api/ties", { title: "Second go", tie_date: "2026-04-01", tie_type: "floor", plan_ids: [plan, unused] });
    await create("/api/ties", { title: "Not linked", tie_date: "2026-05-01", tie_type: "floor" });
    const linked = async (/** @type {string} */ id) =>
      (await call("/api/plans?archived=all")).body.find((/** @type {any} */ p) => p.id === id).linked_ties;
    expect(await linked(plan)).toEqual([
      { id: newer, title: "Second go", tie_date: "2026-04-01", success_rating: null },
      { id: older, title: "First go", tie_date: "2026-03-01", success_rating: 2 },
    ]);
    expect((await linked(unused)).map((/** @type {any} */ t) => t.id)).toEqual([newer]);
    // A deleted tie drops off; a new plan has none.
    await call(`/api/ties/${newer}`, { method: "DELETE" });
    expect(await linked(unused)).toEqual([]);
  });
});

describe("other users' data", () => {
  it("can't be seen, edited, archived or deleted", async () => {
    const otherId = await createOtherUser();
    await sql("INSERT INTO people (id, owner_id, name) VALUES ('theirs', ?, 'Their person')", otherId).run();

    expect((await call("/api/people?archived=false")).body.map((/** @type {any} */ p) => p.id)).not.toContain("theirs");
    expect((await call("/api/people/theirs", { method: "PUT", body: { name: "Mine now" } })).status).toBe(404);
    expect((await call("/api/people/theirs/archive", { method: "POST" })).status).toBe(404);
    expect((await call("/api/people/theirs", { method: "DELETE" })).status).toBe(404);
    expect((await sql("SELECT name FROM people WHERE id = 'theirs'").first())?.name).toBe("Their person");
  });

  it("can't be linked to a tie", async () => {
    const otherId = await createOtherUser();
    await sql("INSERT INTO locations (id, owner_id, name) VALUES ('their-loc', ?, 'Their place')", otherId).run();
    expect(await call("/api/ties", { method: "POST", body: { title: "x", tie_type: "floor", tie_date: "2026-01-01", location_id: "their-loc" } }))
      .toEqual({ status: 400, body: { error: "Linked item not found." } });
  });

  it("their plans can't be edited or tagged, and their tags aren't linked to mine", async () => {
    const otherId = await createOtherUser();
    const theirCookie = await sessionCookieFor(otherId);
    const theirs = (await call("/api/plans", { method: "POST", body: { title: "Their plan", tags: ["their-tag"] }, cookie: theirCookie })).body.id;
    expect((await call(`/api/plans/${theirs}`, { method: "PUT", body: { title: "Mine now", tags: ["mine"] } })).status).toBe(404);
    const { results } = await sql("SELECT t.name, t.owner_id FROM plan_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.plan_id = ?", theirs).all();
    expect(results).toEqual([{ name: "their-tag", owner_id: otherId }]);
    expect((await sql("SELECT title FROM plans WHERE id = ?", theirs).first())?.title).toBe("Their plan");
    // The same name on my plan makes a tag of my own.
    const mine = await create("/api/plans", { title: "My plan", tags: ["their-tag"] });
    const linked = await sql("SELECT t.owner_id FROM plan_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.plan_id = ?", mine).first();
    expect(linked?.owner_id).not.toBe(otherId);
  });
});

describe("deleting", () => {
  it("a person keeps their place in ties, shown as deleted", async () => {
    const person = await create("/api/people", { name: "Sam" });
    const tie = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "Floor", participants: [{ person_id: person, role: "bottom" }] });

    expect((await call(`/api/people/${person}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/people/${person}`, { method: "DELETE" })).status).toBe(404);

    const listed = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(listed.participants).toEqual([{ id: expect.any(String), person_id: null, person_name: null, role: "bottom" }]);
  });

  it("a location marks its ties as '(location deleted)'", async () => {
    const loc = await create("/api/locations", { name: "Studio" });
    const tie = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "Suspension", location_id: loc });

    expect((await call(`/api/locations/${loc}`, { method: "DELETE" })).status).toBe(204);
    const listed = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(listed).toMatchObject({ location_id: null, location_name: null, location_deleted: 1 });
  });

  it("a plan needs a choice about linked ties", async () => {
    const plan = await create("/api/plans", { title: "Hip harness" });
    expect((await call(`/api/plans/${plan}`, { method: "DELETE" })).status).toBe(400);
    expect((await call(`/api/plans/${plan}?linked_ties=maybe`, { method: "DELETE" })).status).toBe(400);
    expect((await sql("SELECT id FROM plans WHERE id = ?", plan).first())).not.toBeNull();
  });

  it("a plan with linked_ties=keep leaves '(plan deleted)' on its ties", async () => {
    const plan = await create("/api/plans", { title: "Hip harness" });
    const tie = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "Attempt", plan_ids: [plan] });

    expect((await call(`/api/plans/${plan}?linked_ties=keep`, { method: "DELETE" })).status).toBe(204);
    const listed = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(listed.plans).toEqual([{ id: expect.any(String), plan_id: null, plan_title: null, plan_version: 1 }]);
  });

  it("a plan with linked_ties=remove drops it from its ties", async () => {
    const plan = await create("/api/plans", { title: "Hip harness" });
    const tie = await create("/api/ties", { tie_type: "floor", tie_date: "2026-01-01", title: "Attempt", plan_ids: [plan] });

    expect((await call(`/api/plans/${plan}?linked_ties=remove`, { method: "DELETE" })).status).toBe(204);
    const listed = (await call("/api/ties/search", { method: "POST", body: {} })).body.ties.find((/** @type {any} */ t) => t.id === tie);
    expect(listed.plans).toEqual([]);
    expect((await call(`/api/plans/${plan}?linked_ties=remove`, { method: "DELETE" })).status).toBe(404);
  });

  it("reads coordinates from a Google Maps link", async () => {
    const coords = (/** @type {unknown} */ url) => call("/api/locations/coords", { method: "POST", body: { url } });
    expect(await coords("https://www.google.com/maps/place/Studio/@51.5,-0.12,17z/data=!3m1!4b1!4m2!3m1!8m2!3d51.51!4d-0.13"))
      .toEqual({ status: 200, body: { latitude: 51.51, longitude: -0.13 } });
    expect(await coords("https://www.google.com/maps?q=Studio"))
      .toEqual({ status: 200, body: { latitude: null, longitude: null } });
    expect(await coords("https://example.com/maps/@51.5,-0.12"))
      .toEqual({ status: 400, body: { error: "That isn't a Google Maps link." } });
    expect(await coords("")).toEqual({ status: 400, body: { error: "Paste a Google Maps link." } });
  });
});
