// The words for connections (public/js/connection-text.js).
import { describe, it, expect } from "vitest";
import {
  connectionVia, bannerText, unanswered, linksDroppedText, CONNECT_DISCLOSURE, ACCEPT_DISCLOSURE,
} from "../../public/js/connection-text.js";

/** @param {Partial<import("../../public/js/connection-text.js").Connection>} change */
const connection = (change) => ({
  id: "c1", invited: 0, label: null, answered: 1, created_at: "2026-11-02T10:00:00Z", person_id: null, ...change,
});

describe("a connection in Shared by me", () => {
  it("says whose invite it came through: mine, by its tag, or theirs", () => {
    expect(connectionVia(connection({ invited: 1, label: "Munch" }))).toBe('Your "Munch" invite');
    expect(connectionVia(connection({ invited: 1 }))).toBe("Your invite");
    expect(connectionVia(connection({ label: "Rin" }))).toBe("Their invite");
  });
});

describe("the inviter's banner", () => {
  it("says someone, not who (anyone with the code might have), unless they shared their profile back", () => {
    expect(bannerText("Class QR")).toBe('Someone accepted your invite "Class QR", and your accounts are now connected. Which of your People is it?');
    expect(bannerText(null)).toMatch(/^Someone accepted your profile invite/);
    // Format 2, shared back on accepting: their profile's name, from another account, as text.
    expect(bannerText("Munch", "Jude")).toBe('Your "Munch" share was accepted and Jude has connected and shared their profile. '
      + "Add them to your People, or to someone you have?");
    expect(bannerText(null, "Jude")).toMatch(/^Your profile invite was accepted and Jude has connected/);
  });

  it("is for invited connections not yet answered", () => {
    const waiting = connection({ id: "a", invited: 1, answered: 0 });
    expect(unanswered([waiting, connection({ id: "b", invited: 1, answered: 1 }), connection({ id: "c", invited: 0, answered: 0 })]))
      .toEqual([waiting]);
  });
});

describe("the disclosures", () => {
  it("say the server keeps no record of the connection, and accepting says it can be removed", () => {
    expect(CONNECT_DISCLOSURE).toBe("Profile connections are private. nōtonawa's server keeps no record that the two accounts are connected.");
    expect(ACCEPT_DISCLOSURE.startsWith(CONNECT_DISCLOSURE)).toBe(true);
    expect(ACCEPT_DISCLOSURE).toMatch(/remove it at any time/);
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
