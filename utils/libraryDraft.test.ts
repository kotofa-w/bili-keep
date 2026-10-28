import { beforeEach, describe, expect, it } from "vitest";
import { clearLibraryDraft, readLibraryDraft, writeLibraryDraft } from "./libraryDraft";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
};
describe("tab library drafts", () => {
  beforeEach(() => values.clear());
  it("restores the value and original revision for only its entity", () => {
    writeLibraryDraft(
      "note:BV1",
      { value: "draft", baseValue: "original", baseRevision: 7 },
      undefined,
      storage,
      100,
    );
    expect(readLibraryDraft("note:BV1", storage, 101)?.baseRevision).toBe(7);
    expect(readLibraryDraft("note:BV2", storage, 101)).toBeUndefined();
  });
  it("expires a draft after 24 hours", () => {
    writeLibraryDraft(
      "marker:a",
      { value: "draft", baseValue: "", baseRevision: 1 },
      undefined,
      storage,
      100,
    );
    expect(readLibraryDraft("marker:a", storage, 100 + 86400001)).toBeUndefined();
  });
  it("refuses a stale editor overwrite and keeps the newer draft", () => {
    const first = writeLibraryDraft(
      "tags:BV1",
      { value: "a", baseValue: "", baseRevision: 7 },
      undefined,
      storage,
      100,
    );
    writeLibraryDraft("tags:BV1", { ...first, value: "b" }, first.savedAt, storage, 101);
    expect(() =>
      writeLibraryDraft("tags:BV1", { ...first, value: "stale" }, first.savedAt, storage, 102),
    ).toThrow();
    expect(readLibraryDraft("tags:BV1", storage, 103)?.value).toBe("b");
  });
  it("clears only the saved draft revision", () => {
    const first = writeLibraryDraft(
      "note:BV3",
      { value: "a", baseValue: "", baseRevision: 7 },
      undefined,
      storage,
      100,
    );
    expect(clearLibraryDraft("note:BV3", first.savedAt, storage, 101)).toBe(true);
    expect(readLibraryDraft("note:BV3", storage, 102)).toBeUndefined();
  });
  it("reports memory fallback and restores it when session storage fails", () => {
    let readable = true;
    const unavailable = {
      getItem: () => {
        if (readable) return null;
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const draft = writeLibraryDraft(
      "note:memory",
      { value: "still here", baseValue: "base", baseRevision: 9 },
      undefined,
      unavailable,
      100,
    );
    expect(draft.persisted).toBe(false);
    readable = false;
    expect(readLibraryDraft("note:memory", unavailable, 101)?.value).toBe("still here");
    clearLibraryDraft("note:memory", draft.savedAt, unavailable, 102);
    expect(readLibraryDraft("note:memory", unavailable, 103)).toBeUndefined();
  });
  it("does not overwrite or clear an unknown draft after a read failure, and can retry", () => {
    let readable = false;
    const key = "note:unknown";
    const saved = JSON.stringify({
      value: "previous",
      baseValue: "base",
      baseRevision: 8,
      savedAt: 100,
    });
    values.set(`biliKeepDraft:${key}`, saved);
    const flaky = {
      ...storage,
      getItem: (name: string) => {
        if (!readable) throw new Error("blocked");
        return storage.getItem(name);
      },
    };
    expect(() => readLibraryDraft(key, flaky, 101)).toThrow();
    expect(() =>
      writeLibraryDraft(
        key,
        { value: "replacement", baseValue: "", baseRevision: 9 },
        undefined,
        flaky,
        102,
      ),
    ).toThrow();
    expect(() => clearLibraryDraft(key, undefined, flaky, 103)).toThrow();
    expect(values.get(`biliKeepDraft:${key}`)).toBe(saved);
    readable = true;
    expect(readLibraryDraft(key, flaky, 104)?.value).toBe("previous");
  });
  it("does not treat corrupt storage as an absent draft", () => {
    values.set("biliKeepDraft:note:corrupt", "not-json");
    expect(() =>
      writeLibraryDraft(
        "note:corrupt",
        { value: "new", baseValue: "", baseRevision: 0 },
        undefined,
        storage,
      ),
    ).toThrow();
    expect(() => clearLibraryDraft("note:corrupt", undefined, storage)).toThrow();
    expect(values.get("biliKeepDraft:note:corrupt")).toBe("not-json");
  });
});
