// The v2 settings and export store (store/v2/settings.js, data.js): the
// record's settings and the server's as one, each saved where it lives;
// the export's account part from the server, its journal from the records.
import { describe, it, expect, vi, beforeEach } from "vitest";

/** @type {Map<string, any>} */
const journal = new Map();
/** @type {any[]} */
const saved = [];
/** @type {any[]} */
const apiCalls = [];
let server = { theme: "dark", seen_release: null, hide_welcome: false, top_label: null, bottom_label: null, default_shape: null };
vi.mock("../../public/js/store/v2/journal.js", () => ({
  records: (/** @type {string} */ kind) => [...journal.values()].filter((r) => r.kind === kind && r.body),
  unreadableCount: () => 2,
  save: async (/** @type {any} */ batch) => {
    saved.push(batch);
    for (const w of batch.writes ?? []) journal.set(w.id, { kind: w.kind, id: w.id, version: 1, body: w.body });
  },
}));
vi.mock("../../public/js/vault.js", () => ({ recordIds: async () => ({ settings: "settings-id" }) }));
vi.mock("../../public/js/api.js", () => ({
  api: async (/** @type {string} */ path, /** @type {any} */ options) => {
    apiCalls.push([path, options?.method ?? "GET", options?.body]);
    if (path === "/api/data/export") {
      return { format: "notonawa-export", exported_at: "2026-11-14T12:00:00Z", account: { settings: { ...server }, passkeys: [{ name: "Phone" }] },
        people: [], locations: [], plans: [], tags: [], ties: [], workshops: [] };
    }
    if (options?.method === "PUT") server = { ...server, ...options.body };
    return { ...server };
  },
}));
// By a path in a variable: they load page modules the Node type check can't follow.
const SETTINGS = "../../public/js/store/v2/settings.js";
const DATA = "../../public/js/store/v2/data.js";
/** @type {Record<string, (...args: any[]) => Promise<any>>} */
const settings = await import(SETTINGS);
/** @type {Record<string, (...args: any[]) => Promise<any>>} */
const data = await import(DATA);

beforeEach(() => {
  journal.clear();
  saved.length = 0;
  apiCalls.length = 0;
});

describe("v2 settings", () => {
  it("saves role names and the default body in the record, the mode on the server, and gives them as one", async () => {
    journal.set("settings-id", { kind: "settings", id: "settings-id", version: 1, body: { created_at: "2026-01-01T00:00:00Z" } });
    const result = await settings.saveSettings({ top_label: "Rigger", theme: "light" });
    expect(saved[0].writes[0]).toMatchObject({ kind: "settings", id: "settings-id", body: { top_label: "Rigger" } });
    expect(apiCalls).toEqual([["/api/account/settings", "PUT", { theme: "light" }]]);
    expect(result).toMatchObject({ top_label: "Rigger", bottom_label: null, theme: "light" });
    expect(await settings.getSettings()).toMatchObject({ top_label: "Rigger", theme: "light" });
  });

  it("makes the record at its worked-out id if it isn't here yet", async () => {
    await settings.saveSettings({ default_shape: [50, 50, 50, 170] });
    expect(saved[0].writes[0]).toMatchObject({ id: "settings-id", body: { default_shape: [50, 50, 50, 170] } });
    await expect(settings.saveSettings({ top_label: "Bottom" })).rejects.toThrow(/different names/);
  });
});

describe("v2 export", () => {
  it("takes the account part from the server and the journal from the records, counting what won't open", async () => {
    journal.set("p", { kind: "person", id: "p", body: { name: "Me", is_self: true } });
    journal.set("s", { kind: "settings", id: "s", body: { top_label: "Rigger" } });
    const { doc, unreadable } = await data.exportJournal();
    expect([doc.people.map((/** @type {any} */ p) => p.name), doc.account.passkeys, doc.account.settings.top_label, doc.account.settings.theme === server.theme, unreadable])
      .toEqual([["Me"], [{ name: "Phone" }], "Rigger", true, 2]);
  });
});

describe("v2 connections", () => {
  it("has none, and connecting waits for contacts", async () => {
    const CONNECTIONS = "../../public/js/store/v2/connections.js";
    /** @type {Record<string, (...args: any[]) => Promise<any>>} */
    const connections = await import(CONNECTIONS);
    expect(await connections.listConnections()).toEqual([]);
    await expect(connections.acceptConnection({ offer: "o", personId: "p", name: "n" })).rejects.toThrow(/isn't ready/);
  });
});
