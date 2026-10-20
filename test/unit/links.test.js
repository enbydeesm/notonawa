import { describe, it, expect } from "vitest";
import { webLinkOrNull, isWebLink, WEB_LINK_PATTERN } from "../../public/js/links.js";

describe("album links", () => {
  it("accepts any http or https link, trimmed, and nothing for empty", () => {
    expect(webLinkOrNull(" https://photos.app.goo.gl/abc ")).toBe("https://photos.app.goo.gl/abc");
    expect(webLinkOrNull("http://www.icloud.com/sharedalbum/#B0")).toBe("http://www.icloud.com/sharedalbum/#B0");
    expect(webLinkOrNull("https://example.com/my/album?x=1")).toBe("https://example.com/my/album?x=1");
    expect(webLinkOrNull("")).toBeNull();
    expect(webLinkOrNull("   ")).toBeNull();
    expect(webLinkOrNull(undefined)).toBeNull();
  });

  it("refuses anything that isn't a web link", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "photos.app.goo.gl/abc", "my album", "https://", "ftp://x.example"]) {
      expect(() => webLinkOrNull(bad), bad).toThrow("starting with https://");
      expect(isWebLink(bad), bad).toBe(false);
    }
  });

  it("only makes web links clickable", () => {
    expect(isWebLink("https://photos.google.com/share/x")).toBe(true);
    expect(isWebLink("HTTPS://PHOTOS.GOOGLE.COM/x")).toBe(true);
    expect(isWebLink(null)).toBe(false);
    expect(isWebLink("https://a b")).toBe(false);
  });

  it("gives the form fields the same rule, so the browser checks it first", () => {
    const pattern = new RegExp(`^(?:${WEB_LINK_PATTERN})$`, "v");
    expect(pattern.test(" https://photos.app.goo.gl/abc ")).toBe(true);
    expect(pattern.test("javascript:alert(1)")).toBe(false);
  });
});
