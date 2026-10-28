import { describe, expect, it } from "vitest";
import { getCoverUrl } from "./cover";

describe("B站封面地址", () => {
  it("upgrades real API HTTP covers to HTTPS", () => {
    expect(getCoverUrl("http://i0.hdslb.com/bfs/archive/cover.jpg")).toBe(
      "https://i0.hdslb.com/bfs/archive/cover.jpg",
    );
  });
  it("supports protocol-relative CDN covers and keeps valid HTTPS URLs", () => {
    expect(getCoverUrl("//i1.hdslb.com/bfs/archive/cover.jpg")).toBe(
      "https://i1.hdslb.com/bfs/archive/cover.jpg",
    );
    expect(getCoverUrl("https://i2.hdslb.com/bfs/archive/cover.jpg@760w_428h_1c.avif")).toBe(
      "https://i2.hdslb.com/bfs/archive/cover.jpg@760w_428h_1c.avif",
    );
  });
  it("rejects external hosts, credentials, non-web protocols and invalid URLs", () => {
    for (const value of [
      "https://i0.hdslb.com.evil.test/x",
      "https://evil.test/x",
      "https://user:secret@i0.hdslb.com/x",
      "https://i0.hdslb.com:9999/x",
      "javascript:alert(1)",
      "data:image/png,x",
      "",
      "not a URL",
    ]) {
      expect(getCoverUrl(value)).toBeUndefined();
    }
  });
});
