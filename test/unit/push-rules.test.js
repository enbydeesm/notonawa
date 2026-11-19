// Push notifications on this device: what to show (public/js/push-rules.js).
import { describe, it, expect } from "vitest";
import { pushState, wantsBanner, installFirstText, blockedText, BANNER_TEXT } from "../../public/js/push-rules.js";

const base = { canPush: true, configured: true, platform: /** @type {const} */ ("other"), installed: false, permission: /** @type {"default" | "granted" | "denied"} */ ("default"), subscribed: false };

describe("pushState", () => {
  it("is off until subscribed with permission, then on", () => {
    expect(pushState(base)).toBe("off");
    expect(pushState({ ...base, permission: "granted" })).toBe("off");
    expect(pushState({ ...base, permission: "granted", subscribed: true })).toBe("on");
    // Subscribed on the server, but permission taken away since: off.
    expect(pushState({ ...base, permission: "default", subscribed: true })).toBe("off");
  });
  it("is blocked once refused", () => {
    expect(pushState({ ...base, permission: "denied" })).toBe("blocked");
  });
  it("needs the app installed on an iPhone or iPad", () => {
    expect(pushState({ ...base, platform: "ios", canPush: false })).toBe("install-first");
    expect(pushState({ ...base, platform: "ios", installed: true })).toBe("off");
  });
  it("is unsupported where the browser can't, or the server sends none", () => {
    expect(pushState({ ...base, canPush: false })).toBe("unsupported");
    expect(pushState({ ...base, configured: false, platform: "ios" })).toBe("unsupported");
  });
});

describe("wantsBanner", () => {
  it("asks once, where it can be turned on (or once installed), not over the install banner", () => {
    expect(wantsBanner({ state: "off", asked: false, installOfferShown: false })).toBe(true);
    expect(wantsBanner({ state: "install-first", asked: false, installOfferShown: false })).toBe(true);
    expect(wantsBanner({ state: "off", asked: true, installOfferShown: false })).toBe(false);
    expect(wantsBanner({ state: "off", asked: false, installOfferShown: true })).toBe(false);
    for (const state of /** @type {const} */ (["on", "blocked", "unsupported"])) {
      expect(wantsBanner({ state, asked: false, installOfferShown: false })).toBe(false);
    }
  });
});

describe("words", () => {
  it("says what was asked for", () => {
    expect(BANNER_TEXT).toBe("nōtonawa can now send you push notifications when a connection sends you something or announcements are made. "
      + "Would you like to allow notifications?");
    expect(installFirstText()).toBe("On iPhone and iPad, notifications need the app installed. To install it: tap the Share button "
      + "(in some browsers it's under ⋯), then Add to Home Screen. Then open it from your home screen and allow notifications there.");
  });
  it("says where to allow them again, by browser", () => {
    expect(blockedText({ platform: "ios", installed: true, userAgent: "" })).toContain("open the Settings app, then Notifications");
    expect(blockedText({ platform: "mac-safari", installed: false, userAgent: "" })).toContain("Safari's Settings, then Websites");
    expect(blockedText({ platform: "other", installed: false, userAgent: "Mozilla/5.0 Firefox/140.0" })).toContain("clear the blocked");
    expect(blockedText({ platform: "other", installed: false, userAgent: "Chrome/140" })).toContain("set Notifications to Allow");
  });
});
