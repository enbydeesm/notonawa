// Sealing and opening shares (public/js/crypto/share.js).
import { describe, it, expect } from "vitest";
import {
  newShareId, newShareKey, sealSnapshot, openSnapshot, shareFragment, readShareFragment, SHARE_KINDS,
} from "../../public/js/crypto/share.js";
import { CantOpen } from "../../public/js/crypto/fields.js";
import { SHARE_KINDS as SERVER_KINDS } from "../../src/shares/parse.js";

const DATA = { title: "Floor session", notes: "Slow and steady", people: [{ name: "Sam", role: "bottom" }] };

describe("share ids and keys", () => {
  it("makes 22-character ids the server takes, and 32-byte keys", () => {
    const id = newShareId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newShareId()).not.toBe(id);
    expect(newShareKey()).toHaveLength(32);
  });

  it("knows the same kinds as the server", () => {
    expect(SHARE_KINDS).toEqual(SERVER_KINDS);
  });
});

describe("sealSnapshot and openSnapshot", () => {
  it("opens with the same key, id and kind", async () => {
    const id = newShareId();
    const key = newShareKey();
    const sealed = await sealSnapshot({ id, kind: "tie", key, data: DATA });
    expect(new TextDecoder().decode(sealed)).not.toContain("Floor session");
    expect(await openSnapshot({ id, kind: "tie", key, sealed })).toEqual(DATA);
  });

  it("won't open with another key, for another share or kind, or changed", async () => {
    const id = newShareId();
    const key = newShareKey();
    const sealed = await sealSnapshot({ id, kind: "plan", key, data: DATA });
    await expect(openSnapshot({ id, kind: "plan", key: newShareKey(), sealed })).rejects.toThrow(CantOpen);
    await expect(openSnapshot({ id: newShareId(), kind: "plan", key, sealed })).rejects.toThrow(CantOpen);
    await expect(openSnapshot({ id, kind: "tie", key, sealed })).rejects.toThrow(CantOpen);
    const changed = sealed.slice();
    changed[changed.length - 1] ^= 1;
    await expect(openSnapshot({ id, kind: "plan", key, sealed: changed })).rejects.toThrow(CantOpen);
    await expect(openSnapshot({ id, kind: "plan", key, sealed: sealed.slice(0, 20) })).rejects.toThrow(CantOpen);
  });

  it("seals each time with a new IV", async () => {
    const id = newShareId();
    const key = newShareKey();
    const a = await sealSnapshot({ id, kind: "tie", key, data: DATA });
    const b = await sealSnapshot({ id, kind: "tie", key, data: DATA });
    expect(a).not.toEqual(b);
  });

  it("refuses a kind that isn't one", async () => {
    await expect(sealSnapshot({ id: newShareId(), kind: /** @type {any} */ ("location"), key: newShareKey(), data: DATA }))
      .rejects.toThrow("Not a kind of share");
  });
});

describe("the link's fragment", () => {
  it("carries the id and key, and reads back with or without the #", () => {
    const id = newShareId();
    const key = newShareKey();
    const fragment = shareFragment(id, key);
    expect(fragment).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(readShareFragment(fragment)).toEqual({ id, key });
    expect(readShareFragment(`#${fragment}`)).toEqual({ id, key });
  });

  it("reads nothing from a fragment that isn't exactly one", () => {
    const fragment = shareFragment(newShareId(), newShareKey());
    for (const bad of ["", "#", `${fragment}x`, `x${fragment}`, fragment.replace(".", ""), `${fragment}#more`, "#/ties"]) {
      expect(readShareFragment(bad), bad).toBeNull();
    }
  });
});
