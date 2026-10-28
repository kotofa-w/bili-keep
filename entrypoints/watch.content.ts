import { getPlaybackDelta, type PlaybackSample } from "../utils/playback";
import { mergeIntervals, type PlaybackSession } from "../utils/preference";
import type { VideoDetails } from "../utils/captureApi";

export default defineContentScript({
  matches: ["https://www.bilibili.com/video/*"],
  runAt: "document_idle",
  main(ctx) {
    let enabled = true;
    let disposed = false;
    let key = "";
    let generation = 0;
    let details: VideoDetails | null = null;
    let loading = false;
    let attempts = 0;
    let video: HTMLVideoElement | null = null;
    let session: PlaybackSession | null = null;
    let previous: PlaybackSample | null = null;
    let lastSaved = 0;
    let lastInteractions = 0;
    let interactionLoading = false;
    let stalled = false;
    let boundSource = "";
    let navigationPlayer: HTMLVideoElement | null = null;
    let navigationSource = "";
    let awaitingNewMedia = false;
    let loadedPlayer: EventTarget | null = null;
    let loadedKey = "";

    const currentRouteKey = () => {
      const bvid = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1];
      const part = Number(new URL(location.href).searchParams.get("p") || 1);
      return bvid && Number.isInteger(part) && part > 0 ? `${bvid}:${part}` : "";
    };
    const onMetadata = (event: Event) => {
      loadedPlayer = event.target;
      loadedKey = currentRouteKey();
      if (video && loadedKey === key && video === event.target) boundSource = video.currentSrc;
    };

    async function status(error: string) {
      try {
        await browser.storage.local.set({ biliKeepCaptureError: error });
      } catch {
        /* extension may be reloading */
      }
    }

    function save() {
      if (!session) return;
      const snapshot = structuredClone(session);
      lastSaved = performance.now();
      void browser.runtime
        .sendMessage({ action: "capture.save", session: snapshot })
        .then((reply) => {
          if (!reply?.success) void status(reply?.error || "记录未写入，请刷新B站页面");
        })
        .catch(() => void status("扩展连接中断，请刷新B站页面"));
    }

    function sample() {
      if (!video || !session || !enabled) return;
      const currentBvid = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1];
      const currentPart = Number(new URL(location.href).searchParams.get("p") || 1);
      if (currentBvid !== session.bvid || currentPart !== session.part) {
        previous = null;
        return;
      }
      const current: PlaybackSample = {
        at: performance.now(),
        position: video.currentTime,
        duration: session.duration,
        rate: video.playbackRate,
        playing: !video.paused && !video.ended && !stalled && video.readyState >= 2,
        seeking: video.seeking,
        mode:
          document.pictureInPictureElement === video
            ? "pip"
            : document.visibilityState === "visible" && document.hasFocus()
              ? "foreground"
              : "background",
      };
      if (previous) {
        const delta = getPlaybackDelta(previous, current);
        session.foregroundSeconds += delta.foregroundSeconds;
        session.backgroundSeconds += delta.backgroundSeconds;
        session.pipSeconds += delta.pipSeconds;
        session.intervals = mergeIntervals(
          [...session.intervals, ...delta.intervals],
          session.duration,
        );
      }
      previous = current;
      session.position = Math.min(
        session.duration,
        Math.max(0, Number.isFinite(video.currentTime) ? video.currentTime : 0),
      );
      session.lastSeenAt = Math.max(Date.now(), session.lastSeenAt + 1);
    }

    const onMedia = (event: Event) => {
      sample();
      if (["seeking", "seeked", "ratechange", "emptied", "loadedmetadata"].includes(event.type))
        previous = null;
      if (["waiting", "stalled", "emptied"].includes(event.type)) stalled = true;
      if (["playing", "canplay"].includes(event.type)) {
        stalled = false;
        previous = null;
      }
      if (["pause", "ended", "seeking"].includes(event.type)) save();
    };
    const mediaEvents = [
      "pause",
      "playing",
      "waiting",
      "stalled",
      "seeking",
      "seeked",
      "ratechange",
      "ended",
      "emptied",
      "loadedmetadata",
      "canplay",
    ];

    function detach() {
      sample();
      save();
      if (video) mediaEvents.forEach((name) => video!.removeEventListener(name, onMedia));
      video = null;
      session = null;
      previous = null;
      stalled = false;
    }

    async function refreshInteractions() {
      if (!session || interactionLoading) return;
      const target = session;
      interactionLoading = true;
      lastInteractions = performance.now();
      try {
        const reply = await browser.runtime.sendMessage({
          action: "capture.interactions",
          bvid: target.bvid,
        });
        if (reply?.success && session === target) {
          target.interactions = { ...target.interactions, ...reply.data };
          target.lastSeenAt = Math.max(Date.now(), target.lastSeenAt + 1);
          save();
        }
      } catch {
        /* Missing login or network state is unknown, never a negative preference. */
      } finally {
        interactionLoading = false;
      }
    }

    async function tick(manual = false) {
      if (disposed) return;
      const bvid = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1];
      const part = Number(new URL(location.href).searchParams.get("p") || 1);
      const nextKey = bvid && Number.isInteger(part) && part > 0 ? `${bvid}:${part}` : "";
      if (nextKey !== key) {
        if (video) {
          navigationPlayer = video;
          navigationSource = boundSource;
          awaitingNewMedia = true;
        }
        detach();
        key = nextKey;
        generation++;
        details = null;
        loading = false;
        attempts = 0;
      }
      if (!nextKey || (!enabled && !manual)) return;
      if (!details && !loading && attempts < 2) {
        loading = true;
        attempts++;
        const token = generation;
        try {
          const reply = await browser.runtime.sendMessage({
            action: manual ? "marker.video" : "capture.video",
            bvid,
            part,
          });
          if (token !== generation || disposed || (!enabled && !manual)) return;
          if (!reply?.success) throw new Error(reply?.error || "视频信息读取失败");
          details = reply.data;
          void status("");
        } catch (error) {
          if (token === generation)
            void status(
              `${error instanceof Error ? error.message : "视频信息读取失败"}；刷新视频页面可重试`,
            );
        } finally {
          if (token === generation) loading = false;
        }
      }
      if (!details || disposed || (!enabled && !manual)) return;
      const player = document.querySelector<HTMLVideoElement>(
        ".bpx-player-video-wrap video, video",
      );
      if (video && (player !== video || Math.abs(video.duration - details.duration) > 1.5))
        detach();
      if (
        !player ||
        player.readyState < 1 ||
        !Number.isFinite(player.duration) ||
        Math.abs(player.duration - details.duration) > 1.5
      )
        return;
      // Equal-length parts must still wait for a new media source or metadata event.
      if (
        awaitingNewMedia &&
        player === navigationPlayer &&
        player.currentSrc === navigationSource &&
        !(loadedPlayer === player && loadedKey === key)
      )
        return;
      if (!video) {
        awaitingNewMedia = false;
        video = player;
        boundSource = player.currentSrc;
      }
      if (!enabled) return;
      if (!session) {
        session = {
          ...details,
          sessionId: crypto.randomUUID(),
          startedAt: Date.now(),
          lastSeenAt: Date.now(),
          position: player.currentTime,
          foregroundSeconds: 0,
          backgroundSeconds: 0,
          pipSeconds: 0,
          intervals: [],
          interactions: { observedAt: 0 },
        };
        mediaEvents.forEach((name) => video!.addEventListener(name, onMedia));
        lastInteractions = 0;
      }
      sample();
      if (performance.now() - lastSaved >= 5000) save();
      if (lastInteractions === 0 || performance.now() - lastInteractions >= 60000)
        void refreshInteractions();
    }

    const onVisibility = () => {
      sample();
      previous = null;
      save();
    };
    const onExit = () => {
      sample();
      save();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (
        target?.closest(".video-toolbar-left, .video-toolbar, .video-coin, .video-like, .video-fav")
      ) {
        window.setTimeout(() => {
          if (!disposed && enabled) void refreshInteractions();
        }, 1500);
      }
    };
    const onStorage = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes.biliKeepTrackingEnabled) return;
      const next = changes.biliKeepTrackingEnabled.newValue !== false;
      if (!next) {
        const passivePlayer = video;
        const passiveSource = boundSource;
        detach();
        enabled = false;
        video = passivePlayer;
        boundSource = passiveSource;
      } else {
        enabled = true;
        void tick();
      }
    };

    const onMarkerMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
      message,
      sender,
      sendResponse,
    ) => {
      if (message?.action !== "marker.position") return false;
      if (
        sender.id !== browser.runtime.id ||
        sender.url !== browser.runtime.getURL("/popup.html")
      ) {
        sendResponse({ success: false, error: "标记请求来源无效" });
        return false;
      }
      const readPosition = async () => {
        await trackingReady;
        await tick(true);
        if (
          disposed ||
          loading ||
          !video ||
          !details ||
          currentRouteKey() !== key ||
          awaitingNewMedia ||
          video.seeking ||
          video.readyState < 2 ||
          !video.currentSrc ||
          video.currentSrc !== boundSource ||
          !Number.isFinite(video.currentTime) ||
          video.currentTime < 0 ||
          Math.abs(video.duration - details.duration) > 1.5 ||
          video.currentTime > details.duration + 1.5
        )
          throw new Error("播放器正在切换或尚未就绪，请稍后重试");
        return { ...details, position: Math.min(details.duration, video.currentTime) };
      };
      readPosition()
        .then((data) => sendResponse({ success: true, data }))
        .catch((error) =>
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : "无法读取当前时间点",
          }),
        );
      return true;
    };
    browser.runtime.onMessage.addListener(onMarkerMessage);

    const trackingReady = browser.storage.local.get("biliKeepTrackingEnabled").then((value) => {
      enabled = value.biliKeepTrackingEnabled !== false;
      void tick();
    });
    const timer = window.setInterval(() => void tick(), 1000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("blur", onVisibility);
    window.addEventListener("pagehide", onExit);
    document.addEventListener("click", onClick);
    document.addEventListener("loadedmetadata", onMetadata, true);
    browser.storage.onChanged.addListener(onStorage);
    ctx.onInvalidated(() => {
      disposed = true;
      detach();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("blur", onVisibility);
      window.removeEventListener("pagehide", onExit);
      document.removeEventListener("click", onClick);
      document.removeEventListener("loadedmetadata", onMetadata, true);
      browser.storage.onChanged.removeListener(onStorage);
      browser.runtime.onMessage.removeListener(onMarkerMessage);
    });
  },
});
