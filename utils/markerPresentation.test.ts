import { describe, expect, it } from "vitest";
import { formatMarkerPosition, markersToMarkdown } from "./markerPresentation";
import type { VideoMarker } from "./markers";

describe("marker presentation", () => {
  it("preserves subsecond positions", () => {
    expect(formatMarkerPosition(3670.125)).toBe("01:01:10.125");
    expect(formatMarkerPosition(0)).toBe("00:00:00.000");
  });

  it("escapes notes and titles as text and identifies saved part links", () => {
    const marker = {
      markerId: "a",
      bvid: "BV1xx411c7mD",
      cid: "9",
      part: 2,
      title: "[标题](https://evil.test)",
      partTitle: "<script>x</script>",
      author: "UP",
      cover: "",
      duration: 100,
      position: 10.125,
      note: "# 说明\n<img src=x> **强调**",
      createdAt: 1,
      updatedAt: 1,
    } satisfies VideoMarker;
    const text = markersToMarkdown([marker]);
    expect(text).toContain("\\[标题\\]\\(https://evil\\.test\\)");
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<img");
    expect(text).toContain("&lt;img src=x&gt;");
    expect(text).toContain("保存时的分P序号");
    expect(text).toContain("https://www.bilibili.com/video/BV1xx411c7mD/?p=2&t=10.125");
    expect(text).toContain("CID 9");
  });
});
