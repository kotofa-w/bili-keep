import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteVideoMarker,
  getLegacyLibraryBackup,
  getLibraryBackup,
  getLibraryExtras,
  getLibrarySnapshot,
  importLibrarySnapshot,
  parseLibraryBackup,
  saveVideoMarker,
  saveVideoTags,
} from "./library";
import type { VideoMarker } from "./markers";
import type { PlaybackSession } from "./preference";

const marker = (extra: Partial<VideoMarker> = {}): VideoMarker => ({
  markerId: "marker-1",
  bvid: "BV1xx411c7mD",
  cid: "123",
  part: 1,
  title: "视频",
  partTitle: "第一P",
  author: "UP",
  cover: "",
  duration: 100,
  position: 40,
  note: "说明",
  createdAt: 100,
  updatedAt: 200,
  ...extra,
});
const backup = (markers: VideoMarker[] = [], tags: unknown[] = []) => ({
  format: "bili-keep",
  version: 2,
  sessions: [],
  decisions: [],
  markers,
  tags,
});
const session: PlaybackSession = {
  sessionId: "old-session",
  bvid: marker().bvid,
  cid: "123",
  part: 1,
  title: "旧视频",
  partTitle: "第一P",
  author: "UP",
  cover: "",
  duration: 100,
  startedAt: 100,
  lastSeenAt: 200,
  position: 40,
  foregroundSeconds: 40,
  backgroundSeconds: 0,
  pipSeconds: 0,
  intervals: [[0, 40]],
  interactions: { observedAt: 200 },
};

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("biliKeepLibrary");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe("marker storage and v2 backup", () => {
  it("opens an empty library and keeps the v1 parser and snapshot shape", async () => {
    expect(await getLibrarySnapshot()).toEqual({ sessions: [], decisions: [] });
    expect(
      parseLibraryBackup({ format: "bili-keep", version: 1, sessions: [], decisions: [] }),
    ).toEqual({ sessions: [], decisions: [] });
    expect(await getLibraryExtras()).toEqual({ markers: [], tags: [] });
    expect(await getLegacyLibraryBackup()).toMatchObject({
      format: "bili-keep",
      version: 1,
      sessions: [],
      decisions: [],
    });
    expect(await getLibraryBackup()).toMatchObject(backup());
  });
  it("upgrades a real v1 database without moving or dropping old stores", async () => {
    const decision = { bvid: marker().bvid, status: "keep", updatedAt: 100, note: "保留" };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("biliKeepLibrary", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("sessions", { keyPath: "sessionId" }).put(session);
        request.result.createObjectStore("decisions", { keyPath: "bvid" }).put(decision);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    expect((await getLibrarySnapshot()).decisions).toEqual([decision]);
    expect((await getLibrarySnapshot()).sessions).toEqual([session]);
    await saveVideoMarker(marker(), 0);
    expect((await getLibraryExtras()).markers).toEqual([marker()]);
  });
  it("roundtrips the complete v2 and keeps deleted markers out of the active list", async () => {
    const deleted = marker({ markerId: "deleted", deletedAt: 200 });
    const tags = { bvid: marker().bvid, tags: ["科普"], updatedAt: 200 };
    const source = {
      ...backup([marker(), deleted], [tags]),
      sessions: [session],
      decisions: [{ bvid: marker().bvid, status: "keep", updatedAt: 200, note: "保留" }],
    };
    await importLibrarySnapshot(source);
    const exported = await getLibraryBackup();
    expect(exported).toMatchObject({ ...source, markers: [deleted, marker()] });
    expect(parseLibraryBackup(exported)).toEqual(exported);
    expect(await getLibraryExtras()).toEqual({ markers: [marker()], tags: [tags] });
    await importLibrarySnapshot(JSON.parse(JSON.stringify(exported)));
    expect((await getLibraryBackup()).markers).toHaveLength(2);
  });
  it("uses optimistic revisions for edits and creates monotonically increasing updates", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    try {
      await saveVideoMarker(marker(), 0);
      await expect(saveVideoMarker(marker({ note: "覆盖" }), 0)).rejects.toThrow();
      await expect(saveVideoMarker(marker({ note: "覆盖" }), 199)).rejects.toThrow();
      await saveVideoMarker(marker({ note: "编辑" }), 200);
      const saved = (await getLibraryExtras()).markers[0];
      expect(saved.note).toBe("编辑");
      expect(saved.updatedAt).toBeGreaterThan(200);
      await expect(deleteVideoMarker(saved.markerId, 200)).rejects.toThrow();
      await deleteVideoMarker(saved.markerId, saved.updatedAt);
      const deleted = (await getLibraryBackup()).markers[0];
      expect(deleted.note).toBe("编辑");
      expect(deleted.deletedAt).toBe(deleted.updatedAt);
      expect(deleted.updatedAt).toBeGreaterThan(saved.updatedAt);
      expect((await getLibraryExtras()).markers).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("serializes simultaneous revisions so only one writer wins", async () => {
    await saveVideoMarker(marker(), 0);
    const results = await Promise.allSettled([
      saveVideoMarker(marker({ note: "A", updatedAt: 300 }), 200),
      saveVideoMarker(marker({ note: "B", updatedAt: 300 }), 200),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("does not resurrect a deletion or cleared tags from an older backup", async () => {
    const source = backup([marker()], [{ bvid: marker().bvid, tags: ["旧"], updatedAt: 200 }]);
    await importLibrarySnapshot(source);
    await deleteVideoMarker(marker().markerId, 200);
    await saveVideoTags({ bvid: marker().bvid, tags: [], updatedAt: 201 }, 200);
    await expect(
      saveVideoTags({ bvid: marker().bvid, tags: ["错误"], updatedAt: 202 }, 200),
    ).rejects.toThrow();
    await importLibrarySnapshot(source);
    expect((await getLibraryExtras()).markers).toEqual([]);
    expect((await getLibraryExtras()).tags[0].tags).toEqual([]);
    const preserved = await getLibraryBackup();
    await importLibrarySnapshot(preserved);
    expect((await getLibraryExtras()).markers).toEqual([]);
    expect(preserved.markers[0].deletedAt).toBeDefined();
  });
  it("preserves conflicting marker bodies once per source revision", async () => {
    const local = marker({ note: "本地新版", updatedAt: 300 });
    const old = marker({ note: "备份原文" });
    await saveVideoMarker(local, 0);
    await importLibrarySnapshot(backup([old]));
    const first = await getLibraryBackup();
    expect(first.markers).toHaveLength(2);
    expect(first.markers.find((entry) => entry.markerId === local.markerId)).toEqual(local);
    expect(first.markers.map((entry) => entry.note).sort()).toEqual([old.note, local.note].sort());
    await importLibrarySnapshot(backup([old]));
    await importLibrarySnapshot(first);
    expect((await getLibraryBackup()).markers).toEqual(first.markers);
  });
  it("rejects unknown versions/fields, missing extras and mixed v1 extras before writing", async () => {
    for (const value of [
      { ...backup([marker()]), version: 3 },
      { ...backup([marker()]), unknown: true },
      { ...backup([marker()]), tags: undefined },
      { ...backup([marker()]), markers: undefined },
      { ...backup([marker()]), version: 1 },
      { sessions: [], decisions: [], markers: [] },
      backup([marker(), marker({ markerId: "bad", note: "x".repeat(1001) })]),
      backup([marker()], [{ bvid: marker().bvid, tags: ["x".repeat(33)], updatedAt: 200 }]),
    ])
      await expect(importLibrarySnapshot(value)).rejects.toThrow();
    expect(await getLibraryExtras()).toEqual({ markers: [], tags: [] });
  });
  it("rolls back all four stores if one extra record cannot be written", async () => {
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
    ) {
      return original.call(this, this.name === "videoTags" ? {} : value);
    });
    try {
      await expect(
        importLibrarySnapshot({
          ...backup([marker()], [{ bvid: marker().bvid, tags: [], updatedAt: 200 }]),
          sessions: [session],
          decisions: [{ bvid: marker().bvid, status: "keep", updatedAt: 200, note: "保留" }],
        }),
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(await getLibraryExtras()).toEqual({ markers: [], tags: [] });
    expect(await getLibrarySnapshot()).toEqual({ sessions: [], decisions: [] });
  });
  it("reports an actual blocked upgrade and recovers after the old connection closes", async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("biliKeepLibrary", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("sessions", { keyPath: "sessionId" });
        request.result.createObjectStore("decisions", { keyPath: "bvid" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await expect(getLibrarySnapshot()).rejects.toThrow("旧页面");
    } finally {
      old.close();
    }
    expect(await getLibraryExtras()).toEqual({ markers: [], tags: [] });
  });
  it("counts all four stores before allowing a new extra record", async () => {
    const original = IDBObjectStore.prototype.count;
    const spy = vi.spyOn(IDBObjectStore.prototype, "count").mockImplementation(function (
      this: IDBObjectStore,
    ) {
      const request = original.call(this);
      request.addEventListener("success", () =>
        Object.defineProperty(request, "result", { value: this.name === "sessions" ? 100000 : 0 }),
      );
      return request;
    });
    try {
      await expect(saveVideoMarker(marker(), 0)).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect((await getLibraryExtras()).markers).toEqual([]);
  });
  it("does not revive a deleted conflict copy when its source is imported again", async () => {
    await saveVideoMarker(marker({ note: "本地", updatedAt: 300 }), 0);
    const source = backup([marker()]);
    await importLibrarySnapshot(source);
    const copy = (await getLibraryExtras()).markers.find(
      (entry) => entry.markerId !== marker().markerId,
    )!;
    await deleteVideoMarker(copy.markerId, copy.updatedAt);
    await importLibrarySnapshot(source);
    expect((await getLibraryExtras()).markers.map((entry) => entry.note)).toEqual(["本地"]);
    expect((await getLibraryBackup()).markers).toHaveLength(2);
  });
});
