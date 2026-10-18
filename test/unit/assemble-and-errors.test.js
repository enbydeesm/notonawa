import { describe, it, expect, vi } from "vitest";
import { assembleTies } from "../../src/ties/db.js";
import { errorResponse } from "../../src/errors.js";
import { BadInput } from "../../src/http.js";

describe("assembleTies", () => {
  it("nests participants, plans and tag names under their ties, keeping tie order", () => {
    const ties = [{ id: "t2", title: "B" }, { id: "t1", title: "A" }];
    const participants = [
      { tie_id: "t1", person_id: "p1", person_name: "Sam", role: "bottom" },
      { tie_id: "t1", person_id: null, person_name: null, role: "top" },
    ];
    const plans = [{ tie_id: "t2", plan_id: "pl1", plan_title: "Hip harness", plan_version: 1 }];

    const tags = [{ tie_id: "t1", name: "floor" }, { tie_id: "t1", name: "kata" }];
    expect(assembleTies(ties, participants, plans, tags)).toEqual([
      { id: "t2", title: "B", participants: [], tags: [], plans: [{ plan_id: "pl1", plan_title: "Hip harness", plan_version: 1 }] },
      {
        id: "t1", title: "A", plans: [], tags: ["floor", "kata"],
        participants: [
          { person_id: "p1", person_name: "Sam", role: "bottom" },
          { person_id: null, person_name: null, role: "top" },
        ],
      },
    ]);
  });

  it("ignores rows for ties that aren't in the list", () => {
    expect(assembleTies([], [{ tie_id: "x", role: "bottom" }], [])).toEqual([]);
  });
});

describe("errorResponse", () => {
  /** @param {Response} res */
  const body = async (res) => [res.status, (await res.json()).error];

  it("turns BadInput into a 400 with its message", async () => {
    expect(await body(errorResponse(new BadInput("Nope.")))).toEqual([400, "Nope."]);
  });

  it("hides ownership and missing-link errors behind one message", async () => {
    expect(await body(errorResponse(new Error("ownership mismatch: location: SQLITE_CONSTRAINT")))).toEqual([400, "Linked item not found."]);
    expect(await body(errorResponse(new Error("FOREIGN KEY constraint failed")))).toEqual([400, "Linked item not found."]);
  });

  it("explains a second self profile", async () => {
    expect(await body(errorResponse(new Error("UNIQUE constraint failed: people.owner_id")))).toEqual([400, "You already have a profile marked as you."]);
  });

  it("logs anything else and returns a generic 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await body(errorResponse(new Error("disk on fire")))).toEqual([500, "Something went wrong"]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
