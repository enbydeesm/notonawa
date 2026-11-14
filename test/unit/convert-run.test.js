// The conversion's steps (public/js/store/convert.js), with the crypto
// Worker and the server in memory: a run that stops part-way picks up
// where it got to (records saved skipped; a file uploaded without its
// record made again), nothing's finished until everything is read back,
// and the finish is last. The walkthrough's convert chunk runs it for real.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportDocument } from "../../src/data/shape.js";
import { rows } from "../journal-rows.js";

const NOW = "2026-11-14T12:00:00Z";

/** The server and the Worker, in memory. */
const server = {
  /** @type {Map<string, any>} */ records: new Map(),
  /** @type {Set<string>} */ files: new Set(),
  identity: false,
  converting: false,
  finished: false,
  /** @type {string[]} */ calls: [],
};

vi.mock("../../public/js/store/v1/data.js", () => ({ exportJournal: async () => ({ doc: exportDocument(/** @type {any} */ (rows), NOW), unreadable: 1 }) }));
vi.mock("../../public/js/store/v1/presets.js", () => ({ listPosePresets: async () => [{ id: "preset-1" }] }));
vi.mock("../../public/js/api.js", () => {
  class ApiError extends Error {
    /** @param {string} m @param {number} status */
    constructor(m, status) { super(m); this.status = status; }
  }
  return {
    ApiError,
    api: async (/** @type {string} */ path, /** @type {any} */ options = {}) => {
      const method = options.method ?? "GET";
      server.calls.push(`${method} ${path.split("?")[0]}`);
      if (path === "/api/convert/start") { server.converting = true; return {}; }
      if (path === "/api/convert/finish") { server.finished = true; return { ok: true }; }
      if (path === "/api/identity" && method === "GET") { if (!server.identity) throw new ApiError("Not found", 404); return {}; }
      if (path === "/api/identity") { server.identity = true; return {}; }
      if (path === "/api/files") return [...server.files].map((id) => ({ id }));
      if (path === "/api/files/delete") { for (const id of options.body.ids) server.files.delete(id); return { deleted: options.body.ids }; }
      if (path.startsWith("/api/files/")) { server.files.add(decodeURIComponent(path.split("/")[3].split("?")[0])); return {}; }
      throw new Error(`Unexpected ${method} ${path}`);
    },
  };
});
vi.mock("../../public/js/vault.js", () => ({
  recordIds: async ({ converted }) => ({
    converted: converted.map((/** @type {any} */ r) => `${r.table}-${r.oldId}`.replace(/[^A-Za-z0-9_-]/g, "-")), self: "SELF", settings: "SETTINGS",
  }),
  makeIdentity: async () => ({ publicKey: "pk", sealedSeed: "i1.x.y" }),
  openCache: async () => null,
  syncCache: async () => ({ records: [], removed: [], refused: [] }),
  readCache: async () => [...server.records.values()],
  saveRecords: async ({ writes }) => {
    for (const w of writes) server.records.set(w.id, { kind: w.kind, id: w.id, version: 1, body: w.body });
    return { saved: writes.map((/** @type {any} */ w) => ({ kind: w.kind, id: w.id, version: 1 })) };
  },
  convertMedia: async ({ newFileId }) => ({ key: `key-${newFileId}`.padEnd(43, "x").slice(0, 43), body: new ArrayBuffer(10), thumbBytes: 4 }),
  openFile: async ({ fileId, key }) => {
    if (!server.files.has(fileId) || !key) throw new Error("Can't open");
    return new ArrayBuffer(4);
  },
}));
// By a path in a variable: it loads page modules the Node type check can't follow.
const RUN = "../../public/js/store/convert.js";
/** @type {{ convertJournal: (o?: any) => Promise<any>, Stopped: any }} */
const run = await import(RUN);

beforeEach(() => {
  server.records.clear();
  server.files.clear();
  Object.assign(server, { identity: false, converting: false, finished: false, calls: [] });
});

describe("converting", () => {
  it("starts, saves the files then every record, reads them back, and finishes last", async () => {
    const result = await run.convertJournal();
    expect(result).toMatchObject({ files: 1, unreadable: 1, unconverted: 0 });
    expect(server.records.size).toBe(result.records);
    expect([server.converting, server.finished, server.identity]).toEqual([true, true, true]);
    expect(server.calls[0]).toBe("POST /api/convert/start");
    expect(server.calls.at(-1)).toBe("POST /api/convert/finish");
    const tie = [...server.records.values()].find((r) => r.kind === "tie");
    expect(tie.body.visuals[0]).toMatchObject({ kind: "file", key: expect.stringMatching(/^key-/), bytes: 10 });
  });

  it("stopped after its files, then run again: makes the file again (its key went with the run), then the rest", async () => {
    await expect(run.convertJournal({ stopAt: "files" })).rejects.toBeInstanceOf(run.Stopped);
    expect([server.files.size, server.records.size, server.finished]).toEqual([1, 0, false]);
    server.calls = [];
    await run.convertJournal();
    expect(server.calls.filter((c) => c.startsWith("POST /api/files/delete"))).toHaveLength(1);
    expect([server.files.size, server.finished]).toEqual([1, true]);
  });

  it("stopped half-way through the records, then run again: skips the ones saved and the file they list", async () => {
    await expect(run.convertJournal({ stopAt: "half-records" })).rejects.toBeInstanceOf(run.Stopped);
    const savedFirst = new Map(server.records);
    server.calls = [];
    await run.convertJournal();
    // Nothing saved before was saved again (the same body, version 1).
    for (const [id, r] of savedFirst) expect(server.records.get(id)).toBe(r);
    expect(server.finished).toBe(true);
  });

  it("stopped just before the finish: everything's there, nothing old touched; run again, it only finishes", async () => {
    await expect(run.convertJournal({ stopAt: "finish" })).rejects.toBeInstanceOf(run.Stopped);
    expect(server.finished).toBe(false);
    const count = server.records.size;
    server.calls = [];
    await run.convertJournal();
    expect([server.records.size, server.finished]).toEqual([count, true]);
    expect(server.calls.filter((c) => c.startsWith("PUT /api/files/"))).toEqual([]);
  });
});
