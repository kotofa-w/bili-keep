import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getVideoDetails,
  getVideoDetailsByCid,
  getVideoInteractions,
  isVideoPage,
} from "./captureApi";

afterEach(() => vi.unstubAllGlobals());
describe("只读采集接口", () => {
  it("accepts only genuine HTTPS Bilibili video-page origins", () => {
    expect(isVideoPage("https://www.bilibili.com/video/BV1xx411c7mD/?p=2")).toBe(true);
    for (const url of [
      "https://www.bilibili.com.evil.test/video/BV1xx411c7mD",
      "http://www.bilibili.com/video/BV1xx411c7mD",
      "https://www.bilibili.com/bangumi/play/ep1",
      undefined,
    ])
      expect(isVideoPage(url)).toBe(false);
  });
  it("resolves the requested part rather than the aggregate video duration", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          title: "合集",
          owner: { name: "UP" },
          pages: [
            { page: 1, cid: 12, duration: 90, part: "一" },
            { page: 2, cid: 13, duration: 120, part: "二" },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await getVideoDetails("BV1xx411c7mD", 2)).toMatchObject({
      cid: "13",
      part: 2,
      duration: 120,
      partTitle: "二",
    });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    await expect(getVideoDetails("bad", 1)).rejects.toThrow();
  });
  it("leaves failed interaction queries unknown and never sends write requests", async () => {
    const fetcher = vi.fn(async (url: URL, options: RequestInit) => {
      expect(options.method).toBeUndefined();
      return {
        ok: true,
        json: async () =>
          url.pathname.includes("coins")
            ? { code: 0, data: { multiply: 2 } }
            : { code: -101, message: "未登录" },
      };
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await getVideoInteractions("BV1xx411c7mD")).toMatchObject({ coins: 2 });
    expect((await getVideoInteractions("BV1xx411c7mD")).liked).toBeUndefined();
  });
  it("resolves a saved CID against the latest reordered part list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            title: "合集",
            pages: [
              { page: 1, cid: 13, duration: 120, part: "原第二P" },
              { page: 2, cid: 12, duration: 90, part: "原第一P" },
            ],
          },
        }),
      }),
    );
    expect(await getVideoDetailsByCid("BV1xx411c7mD", "13")).toMatchObject({
      cid: "13",
      part: 1,
      duration: 120,
    });
    await expect(getVideoDetailsByCid("BV1xx411c7mD", "999")).rejects.toThrow();
    await expect(getVideoDetailsByCid("BV1xx411c7mD", "bad")).rejects.toThrow();
  });
  it("refuses ambiguous or invalid CID metadata instead of opening a wrong part", async () => {
    for (const pages of [
      [
        { page: 1, cid: 13, duration: 120 },
        { page: 2, cid: 13, duration: 120 },
      ],
      [{ page: 0, cid: 13, duration: 120 }],
      [{ page: 1, cid: 13, duration: 0 }],
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { pages } }) }),
      );
      await expect(getVideoDetailsByCid("BV1xx411c7mD", "13")).rejects.toThrow();
    }
  });
});
