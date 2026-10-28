import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLibrarySnapshot,
  importLibrarySnapshot,
  parseLibraryBackup,
  saveLibraryDecision,
  savePlaybackSession,
} from "./library";
import type { PlaybackSession } from "./preference";

const sampleSession = (extra: Partial<PlaybackSession> = {}): PlaybackSession => ({
  sessionId: "session-1",
  bvid: "BV1xx411c7mD",
  cid: "123",
  part: 1,
  title: "视频",
  partTitle: "第一P",
  author: "UP",
  cover: "",
  duration: 100,
  startedAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_100_000,
  position: 90,
  foregroundSeconds: 90,
  backgroundSeconds: 0,
  pipSeconds: 0,
  intervals: [[0, 90]],
  interactions: { observedAt: 1_700_000_100_000 },
  ...extra,
});

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("biliKeepLibrary");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe("library persistence", () => {
  it("is idempotent and rejects older accumulated snapshots", async () => {
    const session = sampleSession();
    await Promise.all([savePlaybackSession(session), savePlaybackSession(session)]);
    await savePlaybackSession({
      ...session,
      lastSeenAt: session.lastSeenAt - 100,
      foregroundSeconds: 2,
    });
    expect((await getLibrarySnapshot()).sessions).toEqual([session]);
    const newer = {
      ...session,
      lastSeenAt: session.lastSeenAt + 1000,
      foregroundSeconds: 95,
      intervals: [[0, 95] as [number, number]],
    };
    await savePlaybackSession(newer);
    expect((await getLibrarySnapshot()).sessions).toEqual([newer]);
  });
  it("roundtrips JSON backups and preserves newer local records during import", async () => {
    const session = sampleSession();
    const backup = { format: "bili-keep", version: 1, sessions: [session], decisions: [] };
    await importLibrarySnapshot(JSON.parse(JSON.stringify(backup)));
    expect(await getLibrarySnapshot()).toEqual(parseLibraryBackup(backup));
    await importLibrarySnapshot({
      ...backup,
      sessions: [{ ...session, lastSeenAt: session.lastSeenAt - 100 }],
    });
    expect((await getLibrarySnapshot()).sessions[0].lastSeenAt).toBe(session.lastSeenAt);
  });
  it("validates the entire import before any write", async () => {
    await expect(
      importLibrarySnapshot({
        sessions: [sampleSession(), sampleSession({ bvid: "bad" })],
        decisions: [],
      }),
    ).rejects.toThrow();
    expect((await getLibrarySnapshot()).sessions).toHaveLength(0);
    expect(() =>
      parseLibraryBackup({ format: "bili-keep", version: 2, sessions: [], decisions: [] }),
    ).toThrow();
    expect(() =>
      parseLibraryBackup({
        sessions: [sampleSession({ intervals: [[0, Infinity]] })],
        decisions: [],
      }),
    ).toThrow();
  });
  it("retains the newest duplicate within one import and the latest manual decision", async () => {
    const session = sampleSession();
    const decision = {
      bvid: session.bvid,
      status: "exclude" as const,
      updatedAt: session.lastSeenAt,
      note: "选择",
    };
    await importLibrarySnapshot({
      sessions: [session, { ...session, lastSeenAt: session.lastSeenAt - 10 }],
      decisions: [decision],
    });
    await saveLibraryDecision({ ...decision, status: "keep", updatedAt: decision.updatedAt - 1 });
    expect(await getLibrarySnapshot()).toEqual({ sessions: [session], decisions: [decision] });
  });
  it("rejects a transaction failure without partially committing the other store", async () => {
    const originalPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
    ) {
      return originalPut.call(this, this.name === "decisions" ? {} : value);
    });
    try {
      await expect(
        importLibrarySnapshot({
          sessions: [sampleSession()],
          decisions: [
            { bvid: "BV1xx411c7mD", status: "keep", updatedAt: 1_700_000_100_000, note: "" },
          ],
        }),
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect(await getLibrarySnapshot()).toEqual({ sessions: [], decisions: [] });
  });
  it("rejects oversize records, counters and unsupported formats", () => {
    for (const extra of [
      { title: "a".repeat(2001) },
      { position: 101 },
      { foregroundSeconds: NaN },
      { cid: "wrong" },
      { part: 1.2 },
    ]) {
      expect(() =>
        parseLibraryBackup({ sessions: [sampleSession(extra)], decisions: [] }),
      ).toThrow();
    }
    expect(() =>
      parseLibraryBackup({ format: "other", version: 1, sessions: [], decisions: [] }),
    ).toThrow();
    expect(() =>
      parseLibraryBackup({ sessions: Array(100001).fill(sampleSession()), decisions: [] }),
    ).toThrow();
  });
  it("enforces the total database record cap when merging into existing data", async () => {
    const originalCount = IDBObjectStore.prototype.count;
    const countSpy = vi.spyOn(IDBObjectStore.prototype, "count").mockImplementation(function (
      this: IDBObjectStore,
    ) {
      const request = originalCount.call(this);
      request.addEventListener("success", () => {
        Object.defineProperty(request, "result", { value: this.name === "sessions" ? 100000 : 0 });
      });
      return request;
    });
    try {
      await expect(savePlaybackSession(sampleSession())).rejects.toThrow();
    } finally {
      countSpy.mockRestore();
    }
    expect((await getLibrarySnapshot()).sessions).toHaveLength(0);
  });
});
