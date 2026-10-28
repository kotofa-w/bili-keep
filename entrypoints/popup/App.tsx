import { useEffect, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import "./App.css";
import { TIME_ZONE } from "../../utils/constants";
import { getStorageValue } from "../../utils/storage";
import { formatDateTime, TimeZonePreference } from "../../utils/timezone";
import { formatMarkerPosition } from "../../utils/markerPresentation";
import {
  createDraftQueue,
  draftKey,
  freezePosition,
  readPopupDraft,
  POPUP_DRAFT_PREFIX,
  POPUP_DRAFT_TTL,
  type MarkerSnapshot,
} from "../../utils/popupDraft";

function App() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState("");
  const [isFullSync, setIsFullSync] = useState(false);
  const [markerNote, setMarkerNote] = useState("");
  const [markerStatus, setMarkerStatus] = useState("");
  const [savingMarker, setSavingMarker] = useState(false);
  const [readingMarker, setReadingMarker] = useState(true);
  const [snapshot, setSnapshot] = useState<MarkerSnapshot | null>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const markerLock = useRef(false);
  const requestSequence = useRef(0);
  const draftSequence = useRef(0);
  const draftQueue = useRef(createDraftQueue());
  const currentDraft = useRef<{ snapshot: MarkerSnapshot; note: string } | null>(null);

  const persistDraft = (value: { snapshot: MarkerSnapshot; note: string }) => {
    const sequence = ++draftSequence.current;
    const draft = { ...value, updatedAt: Date.now() };
    setDraftStatus("正在暂存草稿…");
    return draftQueue
      .current(async () => {
        const all = await browser.storage.session.get(null);
        const expired = Object.entries(all)
          .filter(
            ([key, item]) =>
              key.startsWith(POPUP_DRAFT_PREFIX) &&
              (!item ||
                Date.now() - Number((item as { updatedAt?: number }).updatedAt) >= POPUP_DRAFT_TTL),
          )
          .map(([key]) => key);
        if (expired.length) await browser.storage.session.remove(expired);
        const key = draftKey(value.snapshot);
        const count = Object.keys(all).filter(
          (item) => item.startsWith(POPUP_DRAFT_PREFIX) && !expired.includes(item),
        ).length;
        if (!(key in all) && count >= 30)
          throw new Error("临时草稿已达30条，请先保存已有草稿或等待过期");
        await browser.storage.session.set({ [key]: draft });
      })
      .then(() => {
        if (sequence === draftSequence.current)
          setDraftStatus("草稿已暂存（24小时内有效，本次浏览器会话内恢复，不进入完整备份）。");
      })
      .catch((error) => {
        if (sequence === draftSequence.current)
          setDraftStatus(
            `草稿暂存失败：${error instanceof Error ? error.message : "未知原因"}。请保持弹窗打开并保存。`,
          );
      });
  };

  const captureMarker = async (restore = true) => {
    if (markerLock.current) return;
    const sequence = ++requestSequence.current;
    const previous = currentDraft.current;
    setReadingMarker(true);
    setSnapshot(null);
    setMarkerStatus("正在固定当前视频时间点…");
    setDraftStatus("");
    ++draftSequence.current;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      let valid = false;
      try {
        const url = new URL(tab?.url || "");
        valid =
          url.protocol === "https:" &&
          url.host === "www.bilibili.com" &&
          !url.username &&
          !url.password &&
          /^\/video\/BV[0-9A-Za-z]{10}\/?$/.test(url.pathname);
      } catch {
        /* Only an ordinary Bilibili video tab can provide a position. */
      }
      if (!valid || tab?.id === undefined)
        throw new Error("请先切到 https://www.bilibili.com/video/BV… 普通视频页面");
      const response = await browser.tabs.sendMessage(tab.id, { action: "marker.position" });
      if (!response?.success || !response.data)
        throw new Error(response?.error || "未能读取视频位置，请刷新视频页面后重试");
      const captured = freezePosition(response.data);
      // Also reject a stale content-script response from a different video.
      if (new URL(tab.url!).pathname.split("/")[2] !== captured.bvid)
        throw new Error("视频已变化，请重新取当前时间");
      if (sequence !== requestSequence.current) return;
      let selected = {
        snapshot: captured,
        note: previous && draftKey(previous.snapshot) === draftKey(captured) ? previous.note : "",
      };
      if (restore || !previous || draftKey(previous.snapshot) !== draftKey(captured)) {
        try {
          const stored = await draftQueue.current(() =>
            browser.storage.session.get(draftKey(captured)),
          );
          const draft = readPopupDraft(stored[draftKey(captured)], captured);
          if (draft) selected = draft;
        } catch (error) {
          throw new Error(
            `读取临时草稿失败：${error instanceof Error ? error.message : "未知原因"}。旧草稿状态未知，暂不能编辑或保存，以免覆盖；请重试`,
          );
        }
      }
      if (sequence !== requestSequence.current) return;
      currentDraft.current = selected;
      setSnapshot(selected.snapshot);
      setMarkerNote(selected.note);
      setMarkerStatus("已固定下方时间；填写说明期间视频继续播放也不会改变它。");
      void persistDraft(selected);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      currentDraft.current = previous;
      setMarkerNote(previous?.note || "");
      if (previous)
        setDraftStatus(
          "此前说明仍在弹窗中；当前未固定位置，不能保存。关闭前请确认此前草稿已成功暂存。",
        );
      setMarkerStatus(
        `读取失败：${error instanceof Error ? error.message : "未知原因"}。请点击“重新取当前时间”重试。`,
      );
    } finally {
      if (sequence === requestSequence.current) setReadingMarker(false);
    }
  };

  useEffect(() => {
    void captureMarker();
    return () => {
      ++requestSequence.current;
    };
  }, []);

  useEffect(() => {
    const checkSyncStatus = async () => {
      const [result, timeZone] = await Promise.all([
        browser.storage.local.get("lastSync"),
        getStorageValue<TimeZonePreference>(TIME_ZONE, "system"),
      ]);
      if (result.lastSync) {
        setStatus(`上次保存：${formatDateTime(Number(result.lastSync), timeZone)}`);
      } else {
        setStatus("还没有保存过历史记录。请先在这个浏览器登录哔哩哔哩网页版。");
      }
    };

    void checkSyncStatus().catch((error) =>
      setStatus(`读取状态失败：${error instanceof Error ? error.message : "未知原因"}`),
    );
  }, []);

  const saveCurrentMarker = async () => {
    if (markerLock.current || readingMarker || !snapshot) return;
    markerLock.current = true;
    setSavingMarker(true);
    setMarkerStatus("正在保存已固定的时间点…");
    try {
      const now = Date.now();
      const response = await browser.runtime.sendMessage({
        action: "marker.save",
        marker: {
          ...snapshot,
          markerId: crypto.randomUUID(),
          note: markerNote,
          createdAt: now,
          updatedAt: now,
        },
      });
      if (!response?.success) throw new Error(response?.error || "后台未确认保存，请重试");
      ++draftSequence.current;
      setMarkerNote("");
      currentDraft.current = { snapshot, note: "" };
      setMarkerStatus("时间标记已保存，可在喜好资料库查看。");
      try {
        await draftQueue.current(() => browser.storage.session.remove(draftKey(snapshot)));
        setDraftStatus("");
      } catch (error) {
        setDraftStatus(
          `时间点已保存，但临时草稿清理失败：${error instanceof Error ? error.message : "未知原因"}。重新打开时可能恢复旧说明。`,
        );
      }
    } catch (error) {
      setMarkerStatus(
        `保存失败：${error instanceof Error ? error.message : "未知原因"}。当前说明仍在弹窗中；关闭前请检查草稿暂存状态。`,
      );
    } finally {
      markerLock.current = false;
      setSavingMarker(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setStatus("正在把哔哩哔哩历史记录保存到这台电脑...");

    try {
      const response = await browser.runtime.sendMessage({
        action: "syncHistory",
        isFullSync,
      });

      if (response?.success) {
        setStatus(response.message);
      } else if (!response) {
        setStatus("保存失败：扩展没有响应。请在 Safari 的扩展设置里点 Reload 后再试。");
      } else {
        setStatus(`保存失败：${response?.error || "未知原因"}`);
      }
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : "未知原因"}`);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <>
      <Toaster position="top-center" />
      <div className="flex w-72 flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold leading-tight">Bili Keep · 喜好归档</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            自动记录普通视频的观看投入，在本机整理喜好；未下载视频，无需 API
            key。原有历史同步和分析仍可使用。
          </p>
        </div>
        <button
          className="w-full rounded bg-[#00a1d6] px-2 py-2 text-white hover:bg-[#0091c2] disabled:cursor-not-allowed disabled:bg-gray-300"
          onClick={() =>
            void browser.tabs
              .create({ url: "/my-history.html" })
              .catch((error) =>
                setStatus(`打开失败：${error instanceof Error ? error.message : "未知原因"}`),
              )
          }
          disabled={isSyncing}
        >
          打开喜好资料库
        </button>
        <section className="space-y-2 rounded border border-gray-200 p-3">
          {snapshot && (
            <p aria-label="将保存的时间点" className="break-words text-xs leading-5 text-gray-700">
              {snapshot.title || snapshot.bvid}
              <br />P{snapshot.part} · {snapshot.partTitle} · CID {snapshot.cid}
              <br />
              固定时间：{formatMarkerPosition(snapshot.position)}
            </p>
          )}
          <button
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
            disabled={readingMarker || savingMarker}
            onClick={() => void captureMarker(false)}
          >
            {readingMarker ? "正在读取时间点…" : "重新取当前时间"}
          </button>
          <label className="block text-xs leading-5">
            时间点说明（可选）
            <textarea
              aria-label="时间点说明"
              rows={2}
              maxLength={1000}
              value={markerNote}
              disabled={savingMarker || readingMarker || !snapshot}
              onChange={(event) => {
                const note = event.target.value;
                setMarkerNote(note);
                if (snapshot) {
                  currentDraft.current = { snapshot, note };
                  void persistDraft(currentDraft.current);
                }
              }}
              placeholder="这个时间点有什么值得回看？"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            className="w-full rounded bg-[#00a1d6] px-2 py-2 text-sm text-white hover:bg-[#0091c2] disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={savingMarker || readingMarker || !snapshot}
            onClick={() => void saveCurrentMarker()}
          >
            {savingMarker ? "正在保存时间点…" : "保存当前时间点"}
          </button>
          <p className="text-xs leading-5 text-gray-500">
            保存上方固定时间；要改为视频此刻位置，请重新取当前时间。暂停自动记录时也可使用。
          </p>
          {markerStatus && (
            <p role="status" className="text-xs leading-5 text-gray-600">
              {markerStatus}
            </p>
          )}
          {draftStatus && (
            <p role="status" className="text-xs leading-5 text-gray-600">
              {draftStatus}
            </p>
          )}
        </section>
        <button
          className="w-full rounded bg-[#00a1d6] px-2 py-2 text-white hover:bg-[#0091c2] disabled:cursor-not-allowed disabled:bg-gray-300"
          onClick={handleSync}
          disabled={isSyncing}
        >
          {isSyncing ? "正在保存..." : "保存历史记录"}
        </button>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            id="fullSync"
            checked={isFullSync}
            onChange={(event) => setIsFullSync(event.target.checked)}
            disabled={isSyncing}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 bg-gray-100 text-[#00a1d6] focus:ring-2 focus:ring-[#00a1d6]"
          />
          <span
            className={`cursor-pointer select-none text-sm leading-5 ${
              isSyncing ? "text-gray-400" : "text-gray-700"
            }`}
          >
            重新保存全部历史
            <span className="block text-xs text-gray-500">
              普通保存会重新检查最近 7
              天，扩展每周还会自动完整校验一次。勾选后会立刻从头检查，适合第一次使用、换电脑或修复缺失记录。
            </span>
          </span>
        </label>
        {status && (
          <div className="rounded bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
            {status}
          </div>
        )}
      </div>
    </>
  );
}

export default App;
