// The words for connections (public/js/connection-text.js).
import { describe, it, expect } from "vitest";
import {
  connectionTitle, connectionDetail, bannerText, unanswered, linksDroppedText, CONNECT_DISCLOSURE, ACCEPT_DISCLOSURE,
} from "../../public/js/connection-text.js";

/** @param {Partial<import("../../public/js/connection-text.js").Connection>} change */
const connection = (change) => ({
  id: "c1", invited: 0, label: null, answered: 1, created_at: "2026-11-02T10:00:00Z", person_id: null, ...change,
});

describe("a connection in Shared by me", () => {
  it("says who it's on, or that it's on no one", () => {
    expect(connectionTitle("Sam")).toBe("Linked to Sam");
    expect(connectionTitle(null)).toBe("Not on any Person");
  });

  it("says how it was made, by the side's own name for it, and when", () => {
    expect(connectionDetail(connection({ invited: 1, label: "Munch invite" }), "en-GB")).toBe('through "Munch invite" · 2 Nov 2026');
    expect(connectionDetail(connection({ invited: 1 }), "en-GB")).toBe("through your profile invite · 2 Nov 2026");
    expect(connectionDetail(connection({ label: "Rin" }), "en-GB")).toBe('shared as "Rin" · 2 Nov 2026');
    expect(connectionDetail(connection({}), "en-GB")).toBe("2 Nov 2026");
  });
});

describe("the inviter's banner", () => {
  it("says someone, not who (anyone with the code might have), and what connecting means", () => {
    expect(bannerText("Class QR")).toMatch(/^Someone accepted your invite "Class QR"/);
    expect(bannerText(null)).toMatch(/^Someone accepted your profile invite/);
    expect(bannerText(null)).toMatch("never what's in either journal");
  });

  it("is for invited connections not yet answered", () => {
    const waiting = connection({ id: "a", invited: 1, answered: 0 });
    expect(unanswered([waiting, connection({ id: "b", invited: 1, answered: 1 }), connection({ id: "c", invited: 0, answered: 0 })]))
      .toEqual([waiting]);
  });
});

describe("the disclosures", () => {
  it("say the server sees the connection, not the journals, and that it can be removed", () => {
    for (const text of [CONNECT_DISCLOSURE, ACCEPT_DISCLOSURE]) {
      expect(text).toMatch("server");
      expect(text).toMatch(/can't read|never what's in/);
      expect(text).toMatch(/remove/);
    }
  });
});

describe("an import's dropped links", () => {
  it("are counted in words, or not mentioned", () => {
    expect(linksDroppedText(0)).toBeNull();
    expect(linksDroppedText(undefined)).toBeNull();
    expect(linksDroppedText(1)).toMatch(/^1 person won't be linked/);
    expect(linksDroppedText(3)).toMatch(/^3 people won't be linked/);
  });
});
