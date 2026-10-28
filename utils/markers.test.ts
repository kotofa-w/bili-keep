import { describe, expect, it } from "vitest";
import { parseVideoMarker, parseVideoTags, type VideoMarker } from "./markers";

const marker: VideoMarker = {
  markerId: "marker-1",
  bvid: "BV1xx411c7mD",
  cid: "123",
  part: 1,
  title: "视频",
  partTitle: "第一P",
  author: "UP",
  cover: "",
  duration: 100,
  position: 42.5,
  note: "说明",
  createdAt: 100,
  updatedAt: 200,
};

describe("marker and tag validation", () => {
  it("roundtrips markers, including retained deleted content", () => {
    expect(parseVideoMarker(marker)).toEqual(marker);
    expect(parseVideoMarker({ ...marker, deletedAt: 200 })).toEqual({ ...marker, deletedAt: 200 });
  });
  it("rejects invalid identities, ranges, timestamps and oversize notes without truncation", () => {
    for (const extra of [
      { markerId: "" },
      { bvid: "bad" },
      { cid: "0" },
      { cid: "NaN" },
      { part: 1.5 },
      { duration: 0 },
      { position: 101 },
      { position: -1 },
      { duration: Infinity },
      { updatedAt: 99 },
      { createdAt: NaN },
      { deletedAt: 201 },
      { note: "x".repeat(1001) },
      { note: null },
    ])
      expect(() => parseVideoMarker({ ...marker, ...extra })).toThrow();
    expect(
      parseVideoMarker({ ...marker, note: "x".repeat(1000), position: 100 }).note,
    ).toHaveLength(1000);
  });
  it("normalizes tags and preserves an empty revision for removals", () => {
    expect(
      parseVideoTags({ bvid: marker.bvid, tags: [" ＡＩ ", "ai", " 科普 "], updatedAt: 200 }),
    ).toEqual({ bvid: marker.bvid, tags: ["AI", "科普"], updatedAt: 200 });
    expect(parseVideoTags({ bvid: marker.bvid, tags: [], updatedAt: 200 }).tags).toEqual([]);
  });
  it("rejects empty, excessive or oversize tags and invalid revisions", () => {
    for (const tags of [
      [" "],
      ["x".repeat(33)],
      Array.from({ length: 13 }, (_, i) => `tag${i}`),
      [1],
      null,
    ]) {
      expect(() => parseVideoTags({ bvid: marker.bvid, tags, updatedAt: 200 })).toThrow();
    }
    expect(() => parseVideoTags({ bvid: marker.bvid, tags: [], updatedAt: Infinity })).toThrow();
  });
});
