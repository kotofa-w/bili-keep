import { describe, expect, it } from "vitest";
import {
  createDraftQueue,
  draftKey,
  readPopupDraft,
  freezePosition,
  POPUP_DRAFT_TTL,
} from "./popupDraft";

const position = {
  bvid: "BV1xx411c7mD",
  cid: "123",
  part: 1,
  title: "视频",
  partTitle: "P1",
  author: "UP",
  cover: "",
  duration: 100,
  position: 12.345,
};

describe("popup temporary drafts", () => {
  it("freezes a validated copy of the captured instant", () => {
    const source = { ...position };
    const frozen = freezePosition(source);
    source.position = 50;
    expect(frozen.position).toBe(12.345);
    expect(() => freezePosition({ ...position, position: 101 })).toThrow();
  });
  it("restores only matching video and CID with unexpired fixed time", () => {
    const draft = { snapshot: position, note: "尚未保存", updatedAt: 100 };
    expect(readPopupDraft(draft, position, 101)?.snapshot.position).toBe(12.345);
    expect(readPopupDraft(draft, { ...position, cid: "456" }, 101)).toBeNull();
    expect(draftKey(position)).not.toBe(draftKey({ ...position, cid: "456" }));
    expect(readPopupDraft(draft, position, 100 + POPUP_DRAFT_TTL)).toBeNull();
    expect(readPopupDraft({ ...draft, note: "x".repeat(1001) }, position, 101)).toBeNull();
  });
  it("serializes writes and removal so an old write cannot revive a saved draft", async () => {
    const queue = createDraftQueue();
    const calls: string[] = [];
    let release!: () => void;
    const first = queue(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      calls.push("old");
    });
    await Promise.resolve();
    const second = queue(async () => {
      calls.push("new");
    });
    const remove = queue(async () => {
      calls.push("remove");
    });
    release();
    await Promise.all([first, second, remove]);
    expect(calls).toEqual(["old", "new", "remove"]);
  });
  it("allows retry after a failed storage operation", async () => {
    const queue = createDraftQueue();
    await expect(
      queue(async () => {
        throw new Error("quota");
      }),
    ).rejects.toThrow("quota");
    await expect(queue(async () => "saved")).resolves.toBe("saved");
  });
});
