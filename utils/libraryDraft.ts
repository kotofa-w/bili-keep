const prefix = "biliKeepDraft:";
const ttl = 24 * 60 * 60 * 1000;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type LibraryDraft = {
  value: string;
  baseValue: string;
  baseRevision: number;
  savedAt: number;
  persisted: boolean;
};
const memory = new Map<string, LibraryDraft>();
const cleared = new Set<string>();
function session(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
export function readLibraryDraft(
  key: string,
  storage: DraftStorage | undefined = session(),
  now = Date.now(),
): LibraryDraft | undefined {
  let draft = memory.get(key);
  if (!cleared.has(key)) {
    try {
      if (!storage) throw new Error("sessionStorage unavailable");
      const raw = storage.getItem(prefix + key);
      const parsed = raw === null ? undefined : JSON.parse(raw);
      if (
        raw !== null &&
        !(
          parsed &&
          typeof parsed.value === "string" &&
          typeof parsed.baseValue === "string" &&
          Number.isFinite(parsed.baseRevision) &&
          Number.isFinite(parsed.savedAt)
        )
      )
        throw new Error("invalid draft");
      if (parsed && (!draft || parsed.savedAt >= draft.savedAt)) {
        draft = { ...parsed, persisted: true };
        memory.set(key, draft!);
      }
    } catch {
      if (!draft || now - draft.savedAt > ttl)
        throw new Error("草稿读取失败，已有草稿状态未知；请重试读取后再编辑");
      draft = { ...draft, persisted: false };
    }
  }
  return draft && now - draft.savedAt <= ttl ? draft : undefined;
}
export function writeLibraryDraft(
  key: string,
  value: Pick<LibraryDraft, "value" | "baseValue" | "baseRevision">,
  expected: number | undefined,
  storage: DraftStorage | undefined = session(),
  now = Date.now(),
): LibraryDraft {
  const current = readLibraryDraft(key, storage, now);
  if (current?.savedAt !== expected) throw new Error("此处已有较新的草稿，请先载入最新草稿");
  const draft = { ...value, savedAt: Math.max(now, (current?.savedAt || 0) + 1), persisted: false };
  try {
    if (storage) {
      storage.setItem(prefix + key, JSON.stringify(draft));
      draft.persisted = true;
    }
  } catch {
    /* Keep edits through component unmounts even when storage is unavailable. */
  }
  memory.set(key, draft);
  cleared.delete(key);
  return draft;
}
export function clearLibraryDraft(
  key: string,
  expected: number | undefined,
  storage: DraftStorage | undefined = session(),
  now = Date.now(),
): boolean {
  const current = readLibraryDraft(key, storage, now);
  if (current?.savedAt !== expected) return false;
  if (!current) return true;
  memory.delete(key);
  cleared.add(key);
  try {
    storage?.removeItem(prefix + key);
  } catch {
    /* The tab-local tombstone prevents restoration. */
  }
  return true;
}
export function hasUnsavedLibraryDrafts(): boolean {
  const keys = new Set(memory.keys());
  try {
    const storage = session();
    for (let index = 0; storage && index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.add(key.slice(prefix.length));
    }
  } catch {
    /* Fall back to the tab-local drafts. */
  }
  return [...keys].some((key) => {
    try {
      return !!readLibraryDraft(key);
    } catch {
      return true;
    }
  });
}
