import type { Interval, LibraryDecision, LibrarySnapshot, PlaybackSession } from "./preference";
import { parseVideoMarker, parseVideoTags, type VideoMarker, type VideoTagRecord } from "./markers";

const MAX_RECORDS = 100_000;
const MAX_BACKUP_CHARS = 50_000_000;
const MAX_TIME = 8_640_000_000_000_000;
const MAX_SECONDS = 31_536_000;

const invalid = (): never => {
  throw new Error("喜好库备份或记录格式无效，或超出大小限制");
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const text = (value: unknown, max: number, min = 0): string => {
  if (typeof value !== "string" || value.length < min || value.length > max) return invalid();
  return value;
};
const number = (value: unknown, max: number, min = 0): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    return invalid();
  return value;
};
const bvidValue = (value: unknown): string => {
  const bvid = text(value, 12, 12);
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return invalid();
  return bvid;
};

const parseSession = (value: unknown): PlaybackSession => {
  const item = record(value);
  const interactions = record(item.interactions);
  const duration = number(item.duration, MAX_SECONDS);
  const startedAt = number(item.startedAt, MAX_TIME, 1);
  const lastSeenAt = number(item.lastSeenAt, MAX_TIME, startedAt);
  const cid = text(item.cid, 30, 1);
  if (!/^\d+$/.test(cid)) return invalid();
  const part = number(item.part, 100_000, 1);
  if (!Number.isInteger(part)) return invalid();
  if (!Array.isArray(item.intervals) || item.intervals.length > 10_000) return invalid();
  const intervals = item.intervals.map((value): Interval => {
    if (!Array.isArray(value) || value.length !== 2) return invalid();
    const start = number(value[0], duration);
    const end = number(value[1], duration, start);
    if (end <= start) return invalid();
    return [start, end];
  });
  const parsedInteractions: PlaybackSession["interactions"] = {
    observedAt: number(interactions.observedAt, MAX_TIME),
  };
  for (const key of ["liked", "favorited"] as const) {
    if (interactions[key] !== undefined) {
      if (typeof interactions[key] !== "boolean") return invalid();
      parsedInteractions[key] = interactions[key];
    }
  }
  if (interactions.coins !== undefined) {
    const coins = number(interactions.coins, 2);
    if (!Number.isInteger(coins)) return invalid();
    parsedInteractions.coins = coins;
  }
  return {
    sessionId: text(item.sessionId, 200, 1),
    bvid: bvidValue(item.bvid),
    cid,
    part,
    title: text(item.title, 2000),
    partTitle: text(item.partTitle, 2000),
    author: text(item.author, 500),
    cover: text(item.cover, 4096),
    duration,
    startedAt,
    lastSeenAt,
    position: number(item.position, duration),
    foregroundSeconds: number(item.foregroundSeconds, MAX_SECONDS),
    backgroundSeconds: number(item.backgroundSeconds, MAX_SECONDS),
    pipSeconds: number(item.pipSeconds, MAX_SECONDS),
    intervals,
    interactions: parsedInteractions,
  };
};

const parseDecision = (value: unknown): LibraryDecision => {
  const item = record(value);
  if (item.status !== "keep" && item.status !== "exclude" && item.status !== "auto")
    return invalid();
  return {
    bvid: bvidValue(item.bvid),
    status: item.status,
    updatedAt: number(item.updatedAt, MAX_TIME, 1),
    note: text(item.note, 2000),
  };
};

export type LibraryExtras = { markers: VideoMarker[]; tags: VideoTagRecord[] };
export type LibraryBackupV2 = LibrarySnapshot &
  LibraryExtras & {
    format: "bili-keep";
    version: 2;
    exportedAt?: number;
  };

export const parseLibraryBackup = (value: unknown): LibrarySnapshot | LibraryBackupV2 => {
  const item = record(value);
  const isV2 = item.format === "bili-keep" && item.version === 2;
  if (item.format !== undefined || item.version !== undefined) {
    if (item.format !== "bili-keep" || (item.version !== 1 && !isV2)) return invalid();
  }
  if (!isV2 && ("markers" in item || "tags" in item)) return invalid();
  if (
    isV2 &&
    Object.keys(item).some(
      (key) =>
        !["format", "version", "exportedAt", "sessions", "decisions", "markers", "tags"].includes(
          key,
        ),
    )
  )
    return invalid();
  if (
    !Array.isArray(item.sessions) ||
    !Array.isArray(item.decisions) ||
    item.sessions.length + item.decisions.length > MAX_RECORDS
  )
    return invalid();
  if (JSON.stringify(value).length > MAX_BACKUP_CHARS) return invalid();
  const snapshot: LibrarySnapshot = {
    sessions: item.sessions.map(parseSession),
    decisions: item.decisions.map(parseDecision),
  };
  if (!isV2) return snapshot;
  if (
    !Array.isArray(item.markers) ||
    !Array.isArray(item.tags) ||
    item.sessions.length + item.decisions.length + item.markers.length + item.tags.length >
      MAX_RECORDS
  )
    return invalid();
  const parsed: LibraryBackupV2 = {
    format: "bili-keep",
    version: 2,
    ...snapshot,
    markers: item.markers.map(parseVideoMarker),
    tags: item.tags.map(parseVideoTags),
  };
  if (item.exportedAt !== undefined) parsed.exportedAt = number(item.exportedAt, MAX_TIME, 1);
  return parsed;
};

const ALL_STORES = ["sessions", "decisions", "markers", "videoTags"];

const openLibrary = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("biliKeepLibrary", 2);
    let blocked = false;
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore("sessions", { keyPath: "sessionId" });
        db.createObjectStore("decisions", { keyPath: "bvid" });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore("markers", { keyPath: "markerId" });
        db.createObjectStore("videoTags", { keyPath: "bvid" });
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error("喜好库升级被旧页面占用，请关闭旧版扩展页面后重试"));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });

const completion = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("喜好库读写失败"));
    tx.onabort = () => reject(tx.error || new Error("喜好库事务已取消"));
  });

export const getLibrarySnapshot = async (): Promise<LibrarySnapshot> => {
  const db = await openLibrary();
  try {
    const tx = db.transaction(["sessions", "decisions"], "readonly");
    const done = completion(tx);
    const sessions = tx.objectStore("sessions").getAll();
    const decisions = tx.objectStore("decisions").getAll();
    await done;
    return { sessions: sessions.result, decisions: decisions.result };
  } finally {
    db.close();
  }
};

export const getLibraryExtras = async (): Promise<LibraryExtras> => {
  const db = await openLibrary();
  try {
    const tx = db.transaction(["markers", "videoTags"], "readonly");
    const done = completion(tx);
    const markers = tx.objectStore("markers").getAll();
    const tags = tx.objectStore("videoTags").getAll();
    await done;
    return {
      markers: (markers.result as VideoMarker[]).filter((marker) => marker.deletedAt === undefined),
      tags: tags.result,
    };
  } finally {
    db.close();
  }
};

export const getLibraryBackup = async (): Promise<LibraryBackupV2> => {
  const db = await openLibrary();
  try {
    const tx = db.transaction(ALL_STORES, "readonly");
    const done = completion(tx);
    const sessions = tx.objectStore("sessions").getAll();
    const decisions = tx.objectStore("decisions").getAll();
    const markers = tx.objectStore("markers").getAll();
    const tags = tx.objectStore("videoTags").getAll();
    await done;
    return {
      format: "bili-keep",
      version: 2,
      exportedAt: Date.now(),
      sessions: sessions.result,
      decisions: decisions.result,
      markers: markers.result,
      tags: tags.result,
    };
  } finally {
    db.close();
  }
};

export const getLegacyLibraryBackup = async () => ({
  format: "bili-keep" as const,
  version: 1 as const,
  exportedAt: Date.now(),
  ...(await getLibrarySnapshot()),
});

// Every read-and-compare happens inside the same readwrite transaction as its put.
// IndexedDB serializes overlapping writes across tabs and service-worker restarts.
const mergeSnapshot = async (
  snapshot: LibrarySnapshot,
  expectedDecisionUpdatedAt?: number,
): Promise<void> => {
  const db = await openLibrary();
  try {
    const tx = db.transaction(ALL_STORES, "readwrite");
    const done = completion(tx);
    const sessions = new Map<string, PlaybackSession>();
    const decisions = new Map<string, LibraryDecision>();
    for (const session of snapshot.sessions) {
      const previous = sessions.get(session.sessionId);
      if (!previous || session.lastSeenAt > previous.lastSeenAt)
        sessions.set(session.sessionId, session);
    }
    for (const decision of snapshot.decisions) {
      const previous = decisions.get(decision.bvid);
      if (!previous || decision.updatedAt > previous.updatedAt)
        decisions.set(decision.bvid, decision);
    }
    const sessionStore = tx.objectStore("sessions");
    const decisionStore = tx.objectStore("decisions");
    let totalRecords = 0;
    let failure: unknown;
    for (const name of ALL_STORES) {
      const count = tx.objectStore(name).count();
      count.onsuccess = () => {
        totalRecords += count.result;
      };
    }
    for (const session of sessions.values()) {
      const request = sessionStore.get(session.sessionId);
      request.onsuccess = () => {
        const previous = request.result as PlaybackSession | undefined;
        if (!previous && ++totalRecords > MAX_RECORDS) {
          tx.abort();
          return;
        }
        if (!previous || session.lastSeenAt > previous.lastSeenAt) sessionStore.put(session);
      };
    }
    for (const decision of decisions.values()) {
      const request = decisionStore.get(decision.bvid);
      request.onsuccess = () => {
        try {
          const previous = request.result as LibraryDecision | undefined;
          checkRevision(previous, expectedDecisionUpdatedAt);
          if (!previous && ++totalRecords > MAX_RECORDS) invalid();
          if (expectedDecisionUpdatedAt !== undefined) {
            decisionStore.put(
              parseDecision({
                ...decision,
                updatedAt: previous
                  ? Math.max(decision.updatedAt, previous.updatedAt + 1, Date.now())
                  : decision.updatedAt,
              }),
            );
          } else if (!previous || decision.updatedAt > previous.updatedAt)
            decisionStore.put(decision);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    }
    try {
      await done;
    } catch (error) {
      throw failure || error;
    }
  } finally {
    db.close();
  }
};

export const savePlaybackSession = async (session: PlaybackSession): Promise<void> => {
  await mergeSnapshot({ sessions: [parseSession(session)], decisions: [] });
};
export const saveLibraryDecision = async (
  decision: LibraryDecision,
  expectedUpdatedAt?: number,
): Promise<void> => {
  await mergeSnapshot({ sessions: [], decisions: [parseDecision(decision)] }, expectedUpdatedAt);
};
export const importLibrarySnapshot = async (value: unknown): Promise<void> => {
  const snapshot = parseLibraryBackup(value);
  const db = await openLibrary();
  try {
    const tx = db.transaction(ALL_STORES, "readwrite");
    const done = completion(tx);
    const reads = ALL_STORES.map((name) => tx.objectStore(name).getAll());
    let pending = reads.length;
    let failure: unknown;
    for (const read of reads)
      read.onsuccess = () => {
        if (--pending) return;
        try {
          const sessions = new Map<string, PlaybackSession>(
            reads[0].result.map((item: PlaybackSession) => [item.sessionId, item]),
          );
          const decisions = new Map<string, LibraryDecision>(
            reads[1].result.map((item: LibraryDecision) => [item.bvid, item]),
          );
          const markers = new Map<string, VideoMarker>(
            reads[2].result.map((item: VideoMarker) => [item.markerId, item]),
          );
          const tags = new Map<string, VideoTagRecord>(
            reads[3].result.map((item: VideoTagRecord) => [item.bvid, item]),
          );
          for (const session of snapshot.sessions) {
            const previous = sessions.get(session.sessionId);
            if (!previous || session.lastSeenAt > previous.lastSeenAt)
              sessions.set(session.sessionId, session);
          }
          for (const decision of snapshot.decisions) {
            const previous = decisions.get(decision.bvid);
            if (!previous || decision.updatedAt > previous.updatedAt)
              decisions.set(decision.bvid, decision);
          }
          if ("markers" in snapshot) {
            for (const marker of snapshot.markers) mergeMarker(markers, marker);
            for (const tag of snapshot.tags) {
              const previous = tags.get(tag.bvid);
              if (!previous || tag.updatedAt > previous.updatedAt) tags.set(tag.bvid, tag);
            }
          }
          const merged = {
            sessions: [...sessions.values()],
            decisions: [...decisions.values()],
            markers: [...markers.values()],
            tags: [...tags.values()],
          };
          if (
            sessions.size + decisions.size + markers.size + tags.size > MAX_RECORDS ||
            JSON.stringify(merged).length > MAX_BACKUP_CHARS
          )
            invalid();
          for (const [index, values] of [
            merged.sessions,
            merged.decisions,
            merged.markers,
            merged.tags,
          ].entries()) {
            const store = tx.objectStore(ALL_STORES[index]);
            for (const item of values) store.put(item);
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    try {
      await done;
    } catch (error) {
      throw failure || error;
    }
  } finally {
    db.close();
  }
};

const markerBody = (marker: VideoMarker): string =>
  JSON.stringify({
    bvid: marker.bvid,
    cid: marker.cid,
    part: marker.part,
    title: marker.title,
    partTitle: marker.partTitle,
    author: marker.author,
    cover: marker.cover,
    duration: marker.duration,
    position: marker.position,
    note: marker.note,
    createdAt: marker.createdAt,
  });

// The ID represents the source revision, so reimporting the same conflict is idempotent.
const conflictId = (marker: VideoMarker): string => {
  const source = JSON.stringify([marker.markerId, marker.updatedAt, markerBody(marker)]);
  let first = 2166136261;
  let second = 2246822507;
  for (let i = 0; i < source.length; i++) {
    first = Math.imul(first ^ source.charCodeAt(i), 16777619);
    second = Math.imul(second ^ source.charCodeAt(i), 3266489909);
  }
  return `import-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
};

const mergeMarker = (markers: Map<string, VideoMarker>, incoming: VideoMarker): void => {
  const previous = markers.get(incoming.markerId);
  if (!previous) {
    markers.set(incoming.markerId, incoming);
    return;
  }
  const newer =
    incoming.updatedAt > previous.updatedAt ||
    (incoming.updatedAt === previous.updatedAt &&
      incoming.deletedAt !== undefined &&
      previous.deletedAt === undefined);
  if (previous.deletedAt !== undefined && !newer) return;
  if (
    markerBody(previous) !== markerBody(incoming) &&
    previous.deletedAt === undefined &&
    incoming.deletedAt === undefined
  ) {
    const loser = newer ? previous : incoming;
    const id = conflictId(loser);
    const copy = markers.get(id);
    if (!copy || loser.updatedAt > copy.updatedAt) markers.set(id, { ...loser, markerId: id });
  }
  if (newer) markers.set(incoming.markerId, incoming);
};

const checkRevision = (
  previous: { updatedAt: number } | undefined,
  expected: number | undefined,
): void => {
  if (expected === undefined) return;
  number(expected, MAX_TIME);
  if ((expected === 0 && previous) || (expected !== 0 && previous?.updatedAt !== expected))
    throw new Error("记录已被其他页面修改，请刷新后重试");
};

const saveExtra = async <T extends VideoMarker | VideoTagRecord>(
  storeName: "markers" | "videoTags",
  key: string,
  expected: number | undefined,
  update: (previous: T | undefined) => T,
): Promise<void> => {
  const db = await openLibrary();
  try {
    const tx = db.transaction(ALL_STORES, "readwrite");
    const done = completion(tx);
    let total = 0;
    let failure: unknown;
    for (const name of ALL_STORES) {
      const count = tx.objectStore(name).count();
      count.onsuccess = () => {
        total += count.result;
      };
    }
    const store = tx.objectStore(storeName);
    const read = store.get(key);
    read.onsuccess = () => {
      try {
        const previous = read.result as T | undefined;
        checkRevision(previous, expected);
        if (!previous && total >= MAX_RECORDS) invalid();
        store.put(update(previous));
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure || error;
    }
  } finally {
    db.close();
  }
};

export const saveVideoMarker = async (
  value: VideoMarker,
  expectedUpdatedAt?: number,
): Promise<void> => {
  const marker = parseVideoMarker(value);
  await saveExtra<VideoMarker>("markers", marker.markerId, expectedUpdatedAt, (previous) => {
    if (previous?.deletedAt !== undefined) throw new Error("标记已删除，请新建标记");
    if (marker.deletedAt !== undefined) throw new Error("请使用删除标记操作");
    return previous
      ? parseVideoMarker({
          ...marker,
          createdAt: previous.createdAt,
          updatedAt: Math.max(marker.updatedAt, previous.updatedAt + 1, Date.now()),
        })
      : marker;
  });
};

export const deleteVideoMarker = async (id: string, expectedUpdatedAt: number): Promise<void> => {
  text(id, 200, 1);
  number(expectedUpdatedAt, MAX_TIME, 1);
  await saveExtra<VideoMarker>("markers", id, expectedUpdatedAt, (previous) => {
    if (!previous) throw new Error("标记不存在");
    const updatedAt = Math.max(Date.now(), previous.updatedAt + 1);
    return parseVideoMarker({ ...previous, updatedAt, deletedAt: updatedAt });
  });
};

export const saveVideoTags = async (
  value: VideoTagRecord,
  expectedUpdatedAt?: number,
): Promise<void> => {
  const tags = parseVideoTags(value);
  await saveExtra<VideoTagRecord>("videoTags", tags.bvid, expectedUpdatedAt, (previous) =>
    previous
      ? parseVideoTags({
          ...tags,
          updatedAt: Math.max(tags.updatedAt, previous.updatedAt + 1, Date.now()),
        })
      : tags,
  );
};
