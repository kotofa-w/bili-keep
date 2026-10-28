import type { Interval, LibraryDecision, LibrarySnapshot, PlaybackSession } from "./preference";

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

export const parseLibraryBackup = (value: unknown): LibrarySnapshot => {
  const item = record(value);
  if (item.format !== undefined || item.version !== undefined) {
    if (item.format !== "bili-keep" || item.version !== 1) return invalid();
  }
  if (
    !Array.isArray(item.sessions) ||
    !Array.isArray(item.decisions) ||
    item.sessions.length + item.decisions.length > MAX_RECORDS
  )
    return invalid();
  if (JSON.stringify(value).length > MAX_BACKUP_CHARS) return invalid();
  return {
    sessions: item.sessions.map(parseSession),
    decisions: item.decisions.map(parseDecision),
  };
};

const openLibrary = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("biliKeepLibrary", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("sessions", { keyPath: "sessionId" });
      db.createObjectStore("decisions", { keyPath: "bvid" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
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

// Every read-and-compare happens inside the same readwrite transaction as its put.
// IndexedDB serializes overlapping writes across tabs and service-worker restarts.
const mergeSnapshot = async (snapshot: LibrarySnapshot): Promise<void> => {
  const db = await openLibrary();
  try {
    const tx = db.transaction(["sessions", "decisions"], "readwrite");
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
    const sessionCount = sessionStore.count();
    const decisionCount = decisionStore.count();
    sessionCount.onsuccess = () => {
      totalRecords += sessionCount.result;
    };
    decisionCount.onsuccess = () => {
      totalRecords += decisionCount.result;
    };
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
        const previous = request.result as LibraryDecision | undefined;
        if (!previous && ++totalRecords > MAX_RECORDS) {
          tx.abort();
          return;
        }
        if (!previous || decision.updatedAt > previous.updatedAt) decisionStore.put(decision);
      };
    }
    await done;
  } finally {
    db.close();
  }
};

export const savePlaybackSession = async (session: PlaybackSession): Promise<void> => {
  await mergeSnapshot({ sessions: [parseSession(session)], decisions: [] });
};
export const saveLibraryDecision = async (decision: LibraryDecision): Promise<void> => {
  await mergeSnapshot({ sessions: [], decisions: [parseDecision(decision)] });
};
export const importLibrarySnapshot = async (value: unknown): Promise<void> => {
  await mergeSnapshot(parseLibraryBackup(value));
};
