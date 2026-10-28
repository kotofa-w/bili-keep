import { useEffect, useRef, useState } from "react";
import {
  clearLibraryDraft,
  readLibraryDraft,
  writeLibraryDraft,
  type LibraryDraft,
} from "../utils/libraryDraft";

export function useLibraryDraft(key: string, baseValue: string, baseRevision: number) {
  const [initialState] = useState(() => {
    try {
      return { draft: readLibraryDraft(key), error: "" };
    } catch (reason) {
      return {
        draft: undefined,
        error: reason instanceof Error ? reason.message : "草稿读取失败，请重试",
      };
    }
  });
  const initial = initialState.draft;
  const [value, setValue] = useState(initial?.value ?? baseValue);
  const [draft, setDraft] = useState<LibraryDraft | undefined>(initial);
  const [restored, setRestored] = useState(!!initial);
  const [error, setError] = useState(initialState.error);
  const [blocked, setBlocked] = useState(!!initialState.error);
  const current = useRef(draft);
  const base = useRef({
    value: initial?.baseValue ?? baseValue,
    revision: initial?.baseRevision ?? baseRevision,
  });
  useEffect(() => {
    if (!current.current) {
      setValue(baseValue);
      base.current = { value: baseValue, revision: baseRevision };
    }
  }, [baseValue, baseRevision]);
  const edit = (next: string) => {
    if (blocked) return;
    setValue(next);
    setError("");
    try {
      const saved = writeLibraryDraft(
        key,
        { value: next, baseValue: base.current.value, baseRevision: base.current.revision },
        current.current?.savedAt,
      );
      current.current = saved;
      setDraft(saved);
    } catch (reason) {
      // Reject this keystroke rather than overwriting another editor's newer draft.
      setValue(current.current?.value ?? base.current.value);
      setError(`${reason instanceof Error ? reason.message : "草稿暂存失败"}；本次输入未应用。`);
      setBlocked(true);
    }
  };
  const reset = () => {
    try {
      clearLibraryDraft(key, current.current?.savedAt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿读取失败，请重试");
      setBlocked(true);
      return;
    }
    current.current = undefined;
    setDraft(undefined);
    setValue(baseValue);
    base.current = { value: baseValue, revision: baseRevision };
    setRestored(false);
    setError("");
    setBlocked(false);
  };
  const reload = () => {
    let latest: LibraryDraft | undefined;
    try {
      latest = readLibraryDraft(key);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿读取失败，请重试");
      setBlocked(true);
      return;
    }
    current.current = latest;
    setDraft(latest);
    setValue(latest?.value ?? baseValue);
    base.current = {
      value: latest?.baseValue ?? baseValue,
      revision: latest?.baseRevision ?? baseRevision,
    };
    setRestored(!!latest);
    setError("");
    setBlocked(false);
  };
  const markSaved = (savedValue: string, savedRevision: number) => {
    try {
      clearLibraryDraft(key, current.current?.savedAt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿读取失败，请重试");
      setBlocked(true);
      return;
    }
    current.current = undefined;
    setDraft(undefined);
    setValue(savedValue);
    base.current = { value: savedValue, revision: savedRevision };
    setRestored(false);
    setError("");
    setBlocked(false);
  };
  const dirty = !!draft;
  const conflict = dirty && base.current.revision !== baseRevision;
  const status = dirty
    ? `${restored ? "已恢复草稿 · " : ""}未保存${draft.persisted ? "（本标签页暂存24小时）" : "（仅在本页内存保留，刷新可能丢失）"}`
    : "";
  return {
    value,
    edit,
    dirty,
    status,
    error,
    blocked,
    conflict,
    revision: base.current.revision,
    reset,
    reload,
    markSaved,
  };
}
