// Drawings: the server's checks (src/drawings/parse.js) and the page's pure
// parts (drawing-format.js, drawing-edit.js, import-drawings.js).
import { describe, it, expect } from "vitest";
import * as server from "../../src/drawings/parse.js";
import * as page from "../../public/js/drawing-format.js";
import { startHistory, change, undo, redo, strokeAt, MAX_UNDO } from "../../public/js/drawing-edit.js";
import { takeDrawings } from "../../public/js/import-drawings.js";

/** @typedef {import("../../public/js/drawing-format.js").Stroke} Stroke */

/** @param {number[]} p @param {any} [c] @param {any} [w] @returns {Stroke} */
const stroke = (p, c = "red", w = 2) => ({ c, w, p });

describe("the page and the server", () => {
  it("agree on the format", () => {
    expect(page.FORMAT_VERSION).toBe(server.FORMAT_VERSION);
    expect([page.WIDTH, page.HEIGHT]).toEqual([server.WIDTH, server.HEIGHT]);
    expect(page.COLORS).toEqual(server.COLORS);
    expect(Object.keys(page.LINE_UNITS).map(Number)).toEqual(server.WIDTHS);
    expect([page.MAX_DRAWINGS, page.MAX_STROKES, page.MAX_LINE_NUMBERS])
      .toEqual([server.MAX_PER_ITEM, server.MAX_STROKES, server.MAX_LINE_NUMBERS]);
  });
});

describe("parseDrawing", () => {
  const ok = { v: 1, strokes: [stroke([0, 0, 900, 1200]), stroke([5, 5], "black", 1)] };

  it("accepts a drawing, keeping only its format's fields", () => {
    expect(server.parseDrawing(ok)).toEqual(ok);
    expect(server.parseDrawing({ ...ok, x: 1, strokes: [{ ...ok.strokes[0], y: 2 }] })).toEqual({ v: 1, strokes: [ok.strokes[0]] });
  });

  it("refuses anything else, saying why", () => {
    const bad = (/** @type {unknown} */ value, /** @type {RegExp} */ why) => expect(() => server.parseDrawing(value)).toThrow(why);
    bad(null, /missing/);
    bad({ v: 2, strokes: ok.strokes }, /newer version/);
    bad({ v: 1 }, /no lines/);
    bad({ v: 1, strokes: [] }, /draw something/);
    bad({ v: 1, strokes: [stroke([1, 1], "gold")] }, /format/);
    bad({ v: 1, strokes: [stroke([1, 1], "red", 4)] }, /format/);
    bad({ v: 1, strokes: [stroke([])] }, /points/);
    bad({ v: 1, strokes: [stroke([1, 2, 3])] }, /points/);
    bad({ v: 1, strokes: [stroke([1.5, 2])] }, /off the page/);
    bad({ v: 1, strokes: [stroke([-1, 2])] }, /off the page/);
    bad({ v: 1, strokes: [stroke([1, 1201])] }, /off the page/);
    bad({ v: 1, strokes: [stroke(Array(server.MAX_LINE_NUMBERS + 2).fill(1))] }, /points/);
    bad({ v: 1, strokes: Array(server.MAX_STROKES + 1).fill(stroke([1, 1])) }, /lines/);
    bad({ v: 1, strokes: Array(30).fill(stroke(Array(4000).fill(1))) }, /too detailed/);
  });
});

describe("parseEdit, parseOrder and parseDrawingId", () => {
  const id = "3f1c2a9e-1d2b-4c3d-8e4f-5a6b7c8d9e0f";

  it("take new lines, a caption, or both", () => {
    const data = { v: 1, strokes: [stroke([1, 1])] };
    expect(server.parseEdit({ data })).toEqual({ data });
    expect(server.parseEdit({ caption: null })).toEqual({ caption: null });
    expect(() => server.parseEdit({})).toThrow(/Nothing to change/);
    expect(() => server.parseEdit({ caption: "plain" })).toThrow(/encrypted/);
  });

  it("take each id once", () => {
    expect(server.parseOrder([id])).toEqual([id]);
    expect(() => server.parseOrder([id, id])).toThrow(/once/);
    expect(() => server.parseOrder("x")).toThrow();
    expect(() => server.parseDrawingId("../x")).toThrow(/drawing id/);
  });
});

describe("drawing-format", () => {
  it("keeps points on the canvas, in whole units", () => {
    expect(page.toCanvas({ x: 10.4, y: 20.6 })).toEqual([10, 21]);
    expect(page.toCanvas({ x: -5, y: 5000 })).toEqual([0, 1200]);
  });

  it("simplifies a line, keeping its ends and its corners", () => {
    const straight = [0, 0, 10, 0, 20, 0, 30, 0, 40, 1, 50, 0];
    expect(page.simplify(straight)).toEqual([0, 0, 50, 0]);
    const corner = [0, 0, 10, 0, 20, 0, 20, 10, 20, 20];
    expect(page.simplify(corner)).toEqual([0, 0, 20, 0, 20, 20]);
    expect(page.simplify([5, 5])).toEqual([5, 5]);
  });

  it("draws a line as a smoothed path, and one point as a dot", () => {
    expect(page.strokePath([5, 6])).toBe("M5 6L5 6");
    expect(page.strokePath([0, 0, 10, 10])).toBe("M0 0L10 10");
    expect(page.strokePath([0, 0, 10, 0, 20, 10])).toBe("M0 0Q10 0 15 5L20 10");
  });

  it("makes an SVG file with the colors given", () => {
    const colors = { paper: "#fff", black: "#000", grey: "#888", red: "#f00", orange: "#f80", green: "#0f0", blue: "#00f", purple: "#808", pink: "#f8c" };
    const file = page.svgFile(page.drawing([stroke([0, 0, 10, 10], "blue", 3)]), colors);
    expect(file).toContain('viewBox="0 0 900 1200"');
    expect(file).toContain('<rect width="900" height="1200" fill="#fff"/>');
    expect(file).toContain('<path d="M0 0L10 10" stroke="#00f" stroke-width="24"/>');
  });
});

describe("drawing-edit", () => {
  const a = stroke([0, 0, 100, 0]);
  const b = stroke([0, 50, 100, 50], "blue");

  it("undoes and redoes changes, and a new change ends redo", () => {
    let h = startHistory([]);
    h = change(h, [a]);
    h = change(h, [a, b]);
    h = undo(h);
    expect(h.strokes).toEqual([a]);
    h = redo(h);
    expect(h.strokes).toEqual([a, b]);
    h = undo(undo(h));
    expect(h.strokes).toEqual([]);
    expect(undo(h)).toBe(h);
    h = change(h, [b]);
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it("keeps a limited history", () => {
    let h = startHistory([]);
    for (let i = 0; i < MAX_UNDO + 5; i++) h = change(h, [stroke([i, i])]);
    expect(h.past).toHaveLength(MAX_UNDO);
  });

  it("finds the top line near a point, allowing for its width", () => {
    expect(strokeAt([a, b], [50, 3], 0)).toBe(0);
    expect(strokeAt([a, b], [50, 30], 5)).toBe(-1);
    expect(strokeAt([a, stroke([0, 0, 100, 0], "blue")], [50, 0], 0)).toBe(1);
    expect(strokeAt([stroke([10, 10], "red", 3)], [20, 10], 0)).toBe(0);
  });
});

describe("takeDrawings", () => {
  const data = { v: 1, strokes: [stroke([1, 1])] };

  it("takes the drawing lists off ties, plans and workshops, so their captions are never sent", () => {
    const result = takeDrawings({
      plans: [{ id: "p1", title: "TK", drawings: [{ data, caption: "Back", position: 1 }, { data, caption: " ", position: 0 }] }],
      ties: [{ title: "One" }, { title: "Two", drawings: [{ data, caption: "Front", position: 0 }] }],
      workshops: [{ title: "Intro", drawings: [{ data, position: 0 }] }],
    });
    expect(JSON.stringify(result.doc)).not.toMatch(/drawings|Front|Back/);
    expect(result.count).toBe(4);
    expect([...result.ties]).toEqual([[1, [{ data, caption: "Front", position: 0 }]]]);
    expect(result.plans.get("p1")).toEqual([{ data, caption: null, position: 0 }, { data, caption: "Back", position: 1 }]);
    expect([...result.workshops]).toEqual([[0, [{ data, caption: null, position: 0 }]]]);
  });

  it("leaves out entries without lines", () => {
    const result = takeDrawings({ plans: [], ties: [{ drawings: [{ data: null }, { data: { v: 1 } }, "junk"] }] });
    expect(result.count).toBe(0);
  });
});
