import type { VideoDetails } from "./captureApi";
import { parseVideoMarker } from "./markers";

export type MarkerSnapshot = VideoDetails & { position: number };
export type PopupDraft = { snapshot: MarkerSnapshot; note: string; updatedAt: number };
export const POPUP_DRAFT_PREFIX = "biliKeepPopupDraft:";
export const POPUP_DRAFT_TTL = 24 * 60 * 60 * 1000;
export const draftKey = (snapshot: Pick<MarkerSnapshot, "bvid" | "cid">) =>
  `${POPUP_DRAFT_PREFIX}${snapshot.bvid}:${snapshot.cid}`;

export function freezePosition(value: unknown): MarkerSnapshot {
  const marker = parseVideoMarker({
    ...(value as object),
    markerId: "snapshot",
    note: "",
    createdAt: 1,
    updatedAt: 1,
  });
  const {
    markerId: _id,
    note: _note,
    createdAt: _created,
    updatedAt: _updated,
    ...snapshot
  } = marker;
  return Object.freeze(snapshot);
}

export function readPopupDraft(
  value: unknown,
  identity: MarkerSnapshot,
  now = Date.now(),
): PopupDraft | null {
  try {
    const draft = value as PopupDraft;
    if (
      !draft ||
      !Number.isFinite(draft.updatedAt) ||
      draft.updatedAt > now ||
      now - draft.updatedAt >= POPUP_DRAFT_TTL ||
      typeof draft.note !== "string" ||
      draft.note.length > 1000
    )
      return null;
    const snapshot = freezePosition(draft.snapshot);
    return draftKey(snapshot) === draftKey(identity)
      ? { snapshot, note: draft.note, updatedAt: draft.updatedAt }
      : null;
  } catch {
    return null;
  }
}

export function createDraftQueue() {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  };
}
