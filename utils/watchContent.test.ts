import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("resumes an already-ready player and permits markers without another metadata event", async () => {
  const details = {
    bvid: "BV1xx411c7mD",
    cid: "123",
    part: 1,
    title: "已就绪视频",
    partTitle: "第一P",
    author: "UP",
    cover: "",
    duration: 100,
  };
  const player = Object.assign(new EventTarget(), {
    currentTime: 20,
    duration: 100,
    readyState: 4,
    currentSrc: "blob:already-ready",
    playbackRate: 1,
    paused: false,
    ended: false,
    seeking: false,
  });
  const saved: { sessionId: string }[] = [];
  let storageChanged!: (changes: Record<string, { newValue: boolean }>, area: string) => void;
  let markerMessage!: (
    message: unknown,
    sender: unknown,
    respond: (value: unknown) => void,
  ) => boolean;
  let tick!: () => void;
  let invalidate!: () => void;
  const browserMock = {
    runtime: {
      id: "test-extension",
      getURL: (path: string) => `chrome-extension://test-extension${path}`,
      onMessage: {
        addListener: (listener: typeof markerMessage) => {
          markerMessage = listener;
        },
        removeListener: vi.fn(),
      },
      sendMessage: async (message: { action: string; session?: { sessionId: string } }) => {
        if (message.action === "capture.video" || message.action === "marker.video")
          return { success: true, data: details };
        if (message.action === "capture.interactions")
          return { success: true, data: { observedAt: 1 } };
        if (message.action === "capture.save" && message.session) saved.push(message.session);
        return { success: true };
      },
    },
    storage: {
      local: { get: async () => ({ biliKeepTrackingEnabled: true }), set: async () => undefined },
      onChanged: {
        addListener: (listener: typeof storageChanged) => {
          storageChanged = listener;
        },
        removeListener: vi.fn(),
      },
    },
  };
  vi.stubGlobal("browser", browserMock);
  vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
  vi.stubGlobal("location", new URL(`https://www.bilibili.com/video/${details.bvid}/`));
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      querySelector: () => player,
      visibilityState: "visible",
      hasFocus: () => true,
      pictureInPictureElement: null,
    }),
  );
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      setInterval: (callback: () => void) => {
        tick = callback;
        return 1;
      },
      clearInterval: vi.fn(),
      setTimeout: vi.fn(),
    }),
  );
  const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const content = await import("../entrypoints/watch.content");
  content.default.main({
    onInvalidated: (callback: () => void) => {
      invalidate = callback;
    },
  } as never);
  try {
    await settle();
    expect(new Set(saved.map(({ sessionId }) => sessionId)).size).toBe(1);
    storageChanged({ biliKeepTrackingEnabled: { newValue: false } }, "local");
    await settle();
    storageChanged({ biliKeepTrackingEnabled: { newValue: true } }, "local");
    await settle();
    tick();
    await settle();
    // The video was ready before document_idle; no loadedmetadata event is dispatched.
    const response = await new Promise((resolve) =>
      markerMessage(
        { action: "marker.position" },
        { id: browserMock.runtime.id, url: browserMock.runtime.getURL("/popup.html") },
        resolve,
      ),
    );
    expect(response).toMatchObject({
      success: true,
      data: { bvid: details.bvid, cid: "123", position: 20 },
    });
    expect(new Set(saved.map(({ sessionId }) => sessionId)).size).toBe(2);
  } finally {
    invalidate();
  }
});
