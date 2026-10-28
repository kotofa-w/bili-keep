import { describe, expect, it } from "vitest";
import { buildLibraryEntries, type LibraryEntry, type PlaybackSession } from "./preference";
import { matchesLibrarySearch, queryLibraryEntries } from "./libraryQuery";

const entry = (bvid: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  ...buildLibraryEntries({
    sessions: [
      {
        sessionId: bvid,
        bvid,
        cid: "1",
        part: 1,
        title: "默认标题",
        partTitle: "",
        author: "",
        cover: "",
        duration: 100,
        startedAt: 1,
        lastSeenAt: 1,
        position: 10,
        foregroundSeconds: 10,
        backgroundSeconds: 0,
        pipSeconds: 0,
        intervals: [[0, 10]],
        interactions: { observedAt: 1 },
      },
    ],
    decisions: [],
  })[0],
  ...overrides,
});
const ids = (entries: LibraryEntry[]) => entries.map(({ bvid }) => bvid);
const query = { keyword: "", status: "all", sort: "recent" } as const;

describe("queryLibraryEntries", () => {
  it("searches tags and filters tags with normalized exact matching", () => {
    const entries = [entry("BV1"), entry("BV2")];
    const tags = [{ bvid: "BV1", tags: ["ＡＩ", "入门"], updatedAt: 1 }];
    expect(ids(queryLibraryEntries(entries, { ...query, tags, keyword: "ai 入门" }))).toEqual([
      "BV1",
    ]);
    expect(ids(queryLibraryEntries(entries, { ...query, tags, tag: "ａｉ" }))).toEqual(["BV1"]);
    expect(queryLibraryEntries(entries, { ...query, tags, tag: "A" })).toEqual([]);
    expect(tags[0].tags).toEqual(["ＡＩ", "入门"]);
  });

  it("shares URL and multi-field search with marker lists", () => {
    expect(
      matchesLibrarySearch("https://www.bilibili.com/video/BV1xx411c7mD/?p=2", ["BV1xx411c7mD"]),
    ).toBe(true);
    expect(matchesLibrarySearch("ＡＩ 复习", ["AI入门", "复习资料"])).toBe(true);
    expect(matchesLibrarySearch("AI 缺少", ["AI入门", "复习资料"])).toBe(false);
  });
  it("requires every word and allows words to match different fields", () => {
    const match = entry("BV1xx411c7mD", {
      title: "模型原理",
      author: "张老师",
      decision: {
        bvid: "BV1xx411c7mD",
        status: "auto",
        updatedAt: 1,
        note: "复习资料",
      },
    });
    expect(
      ids(
        queryLibraryEntries([match, entry("BV2")], {
          ...query,
          keyword: "模型 张老师 复习 BV1xx",
        }),
      ),
    ).toEqual([match.bvid]);
    expect(queryLibraryEntries([match], { ...query, keyword: "模型 不存在" })).toEqual([]);
  });

  it("searches all session part titles", () => {
    const match = entry("BV1", {
      sessions: [
        { partTitle: "第一讲 入门" } as PlaybackSession,
        { partTitle: "第二讲 进阶" } as PlaybackSession,
      ],
    });
    expect(ids(queryLibraryEntries([match], { ...query, keyword: "入门 进阶" }))).toEqual(["BV1"]);
  });

  it("normalizes whitespace, case and full-width characters", () => {
    const match = entry("BV1", { title: "ＡＩ 入门", author: "Teacher" });
    expect(
      ids(
        queryLibraryEntries([match], {
          ...query,
          keyword: "  ai　\tＴＥＡＣＨＥＲ \n",
        }),
      ),
    ).toEqual(["BV1"]);
    expect(ids(queryLibraryEntries([match], { ...query, keyword: "　 \t" }))).toEqual(["BV1"]);
  });

  it("extracts the BV from a complete ordinary Bilibili video URL", () => {
    const match = entry("BV1xx411c7mD");
    for (const keyword of [
      "https://www.bilibili.com/video/BV1xx411c7mD/?p=2&t=30#reply",
      " http://bilibili.com/video/BV1xx411c7mD?from=search ",
    ]) {
      expect(ids(queryLibraryEntries([match], { ...query, keyword }))).toEqual([match.bvid]);
    }
  });

  it("does not extract BV identifiers from short links, other domains or mixed text", () => {
    const match = entry("BV1xx411c7mD");
    for (const keyword of [
      "https://b23.tv/BV1xx411c7mD",
      "https://example.com/video/BV1xx411c7mD",
      "https://www.bilibili.com.evil.com/video/BV1xx411c7mD",
      "https://www.bilibili.com/video/BV1xx411c7mD extra",
      "https://www.bilibili.com/video/BV1xx411c7mD/extra",
    ]) {
      expect(queryLibraryEntries([match], { ...query, keyword })).toEqual([]);
    }
  });

  it("filters exact statuses, interesting entries and nonblank notes", () => {
    const entries = [
      entry("BVkeep", { status: "keep" }),
      entry("BVcandidate", { status: "candidate" }),
      entry("BVobserved", {
        status: "observed",
        decision: {
          bvid: "BVobserved",
          status: "auto",
          updatedAt: 1,
          note: "有用",
        },
      }),
      entry("BVexclude", {
        status: "exclude",
        decision: {
          bvid: "BVexclude",
          status: "exclude",
          updatedAt: 1,
          note: " \t",
        },
      }),
    ];
    for (const status of ["keep", "candidate", "observed", "exclude"] as const) {
      expect(ids(queryLibraryEntries(entries, { ...query, status }))).toEqual([`BV${status}`]);
    }
    expect(ids(queryLibraryEntries(entries, { ...query, status: "interesting" }))).toEqual([
      "BVcandidate",
      "BVkeep",
    ]);
    expect(ids(queryLibraryEntries(entries, { ...query, status: "noted" }))).toEqual([
      "BVobserved",
    ]);
    expect(queryLibraryEntries(entries, query)).toHaveLength(4);
  });

  it("sorts by recent, score then recent, or Chinese title with BV tie breakers", () => {
    const entries = [
      entry("BVc", { lastSeenAt: 3, score: 10, title: "苹果" }),
      entry("BVb", { lastSeenAt: 1, score: 90, title: "香蕉" }),
      entry("BVa", { lastSeenAt: 1, score: 90, title: "香蕉" }),
      entry("BVd", { lastSeenAt: 2, score: 90, title: "苹果" }),
    ];
    expect(ids(queryLibraryEntries(entries, query))).toEqual(["BVc", "BVd", "BVa", "BVb"]);
    expect(ids(queryLibraryEntries(entries, { ...query, sort: "score" }))).toEqual([
      "BVd",
      "BVa",
      "BVb",
      "BVc",
    ]);
    expect(ids(queryLibraryEntries(entries, { ...query, sort: "title" }))).toEqual([
      "BVc",
      "BVd",
      "BVa",
      "BVb",
    ]);
  });

  it("leaves the original entries and their nested data unchanged", () => {
    const entries = [entry("BVb"), entry("BVa")];
    const before = structuredClone(entries);
    const result = queryLibraryEntries(entries, query);
    expect(entries).toEqual(before);
    expect(result).not.toBe(entries);
    expect(result[0]).toBe(entries[1]);
  });
});
