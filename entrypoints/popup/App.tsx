import { useEffect, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import "./App.css";
import { TIME_ZONE } from "../../utils/constants";
import { getStorageValue } from "../../utils/storage";
import { formatDateTime, TimeZonePreference } from "../../utils/timezone";

function App() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState("");
  const [isFullSync, setIsFullSync] = useState(false);
  const [markerNote, setMarkerNote] = useState("");
  const [markerStatus, setMarkerStatus] = useState("");
  const [savingMarker, setSavingMarker] = useState(false);
  const markerLock = useRef(false);

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
    if (markerLock.current) return;
    markerLock.current = true;
    setSavingMarker(true);
    setMarkerStatus("正在读取当前视频时间点…");
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
      const position = await browser.tabs.sendMessage(tab.id, { action: "marker.position" });
      if (!position?.success || !position.data)
        throw new Error(position?.error || "未能读取视频位置，请刷新视频页面后重试");
      const now = Date.now();
      const response = await browser.runtime.sendMessage({
        action: "marker.save",
        marker: {
          ...position.data,
          markerId: crypto.randomUUID(),
          note: markerNote,
          createdAt: now,
          updatedAt: now,
        },
      });
      if (!response?.success) throw new Error(response?.error || "后台未确认保存，请重试");
      setMarkerNote("");
      setMarkerStatus("时间标记已保存，可在喜好资料库查看。");
    } catch (error) {
      setMarkerStatus(
        `保存失败：${error instanceof Error ? error.message : "未知原因"}。说明已保留。`,
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
          <label className="block text-xs leading-5">
            时间点说明（可选）
            <textarea
              aria-label="时间点说明"
              rows={2}
              maxLength={1000}
              value={markerNote}
              disabled={savingMarker}
              onChange={(event) => setMarkerNote(event.target.value)}
              placeholder="这个时间点有什么值得回看？"
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            className="w-full rounded bg-[#00a1d6] px-2 py-2 text-sm text-white hover:bg-[#0091c2] disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={savingMarker}
            onClick={() => void saveCurrentMarker()}
          >
            {savingMarker ? "正在保存时间点…" : "保存当前时间点"}
          </button>
          <p className="text-xs leading-5 text-gray-500">
            在当前普通视频页面保存，暂停自动记录时也可使用。
          </p>
          {markerStatus && (
            <p role="status" className="text-xs leading-5 text-gray-600">
              {markerStatus}
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
