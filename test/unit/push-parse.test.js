// Push notifications: the server's parsing and words (src/push/parse.js).
import { describe, it, expect } from "vitest";
import { parseEndpoint, parseSubscription, connectionMessage, noticeMessage } from "../../src/push/parse.js";
import { BadInput } from "../../src/http.js";

const KEYS = { p256dh: "B" + "A".repeat(86), auth: "A".repeat(22) };

describe("parseEndpoint", () => {
  it("takes the push services' addresses", () => {
    for (const url of ["https://fcm.googleapis.com/fcm/send/abc:def", "https://web.push.apple.com/QGx", "https://api.push.apple.com/x",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
      expect(parseEndpoint(url)).toBe(url);
    }
  });
  it("refuses any other address, so the Worker never posts anywhere else", () => {
    for (const url of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "https://evil.example/push.apple.com",
      "https://notpush.apple.com.evil/x", "https://fcm.googleapis.com:8443/x", "https://user@fcm.googleapis.com/x",
      "https://localhost/x", "not a url", 42, "https://fcm.googleapis.com/" + "x".repeat(2100)]) {
      expect(() => parseEndpoint(url), String(url)).toThrow(BadInput);
    }
  });
});

describe("parseSubscription", () => {
  it("takes the browser's subscription and the kinds wanted", () => {
    expect(parseSubscription({ endpoint: "https://web.push.apple.com/x", keys: KEYS, connections: true, announcements: false }))
      .toEqual({ endpoint: "https://web.push.apple.com/x", ...KEYS, connections: true, announcements: false });
  });
  it("refuses wrong keys or kinds", () => {
    const good = { endpoint: "https://web.push.apple.com/x", keys: KEYS, connections: true, announcements: true };
    expect(() => parseSubscription({ ...good, keys: { ...KEYS, auth: "short" } })).toThrow(BadInput);
    expect(() => parseSubscription({ ...good, keys: undefined })).toThrow(BadInput);
    expect(() => parseSubscription({ ...good, connections: "yes" })).toThrow(BadInput);
  });
});

describe("messages", () => {
  it("says only what the server can know of a connection's message", () => {
    expect(connectionMessage()).toEqual({ title: "NōtoNawa", body: "You have something new from a connection. Open NōtoNawa to see it.",
      tag: "connections", url: "/" });
  });
  it("sends a notice's words, a long one cut short", () => {
    expect(noticeMessage({ id: "n1", message: "Back up" })).toEqual({ title: "NōtoNawa", body: "Back up", tag: "notice-n1", url: "/" });
    const long = noticeMessage({ id: "n1", message: "word ".repeat(100) }).body;
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith("…")).toBe(true);
  });
});
