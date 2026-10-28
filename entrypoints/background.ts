import {
  HAS_FULL_SYNC,
  IS_SYNCING,
  LAST_FULL_SYNC,
  SYNC_INTERVAL,
  SYNC_LOCK_STARTED_AT,
  SYNC_PROGRESS_HISTORY,
  SYNC_TIME_REMAIN,
} from "../utils/constants";
import { openDB, putHistoryAndWatchEvent } from "../utils/db";
import { getStorageValue, setStorageValue } from "../utils/storage";
import { HistoryItem } from "../utils/types";
import { getVideoDetails, getVideoInteractions, isVideoPage } from "../utils/captureApi";
import { savePlaybackSession } from "../utils/library";
import {
  getIncrementalCutoff,
  isFullReconcileDue,
  isSyncLockActive,
  shouldStopIncrementalScan,
} from "../utils/historySync";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; name?: unknown };
    const message = typeof record.message === "string" ? record.message : "";
    const name = typeof record.name === "string" ? record.name : "";
    if (message && name) return `${name}: ${message}`;
    if (message) return message;
    if (name) return name;

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return "未知原因";
};

const getSessdataCookie = async () => {
  const queries: Browser.cookies.GetAllDetails[] = [
    { url: "https://www.bilibili.com/" },
    { url: "https://api.bilibili.com/" },
    { domain: "bilibili.com" },
    { domain: ".bilibili.com" },
  ];

  for (const query of queries) {
    try {
      const cookies = await browser.cookies.getAll(query);
      const sessdata = cookies.find((cookie) => cookie.name === "SESSDATA")?.value;
      if (sessdata) return sessdata;
    } catch (error) {
      console.warn("读取哔哩哔哩登录信息失败:", query, error);
    }
  }

  return "";
};

export default defineBackground(() => {
  const ensureSyncAlarm = async () => {
    const alarm = await browser.alarms.get("syncHistory");
    if (!alarm) browser.alarms.create("syncHistory", { periodInMinutes: 1 });
  };

  void ensureSyncAlarm();

  browser.runtime.onInstalled.addListener(async (details) => {
    await ensureSyncAlarm();

    if (details.reason === "install") {
      browser.tabs.create({ url: browser.runtime.getURL("/my-history.html") });
      await setStorageValue(SYNC_PROGRESS_HISTORY, {
        current: 0,
        message: "请先登录哔哩哔哩网页版，然后在扩展弹窗里保存历史记录",
      });
    }
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== "syncHistory") return;

    const syncInterval = await getStorageValue(SYNC_INTERVAL, 1);
    const syncRemain = await getStorageValue(SYNC_TIME_REMAIN, syncInterval);
    const currentSyncRemain = syncRemain - 1;

    if (currentSyncRemain > 0) {
      await setStorageValue(SYNC_TIME_REMAIN, currentSyncRemain);
      return;
    }

    await intervalSync(syncInterval);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message?.action === "string" && message.action.startsWith("capture.")) {
      if (sender.id !== browser.runtime.id || !isVideoPage(sender.url)) {
        sendResponse({ success: false, error: "采集来源无效" });
        return false;
      }
      const action = async () => {
        // A pause must still commit the cumulative snapshot collected before the toggle.
        if (message.action === "capture.save") {
          await savePlaybackSession(message.session);
          return null;
        }
        if (
          (await browser.storage.local.get("biliKeepTrackingEnabled")).biliKeepTrackingEnabled ===
          false
        ) {
          throw new Error("自动记录已暂停");
        }
        if (message.action === "capture.video") return getVideoDetails(message.bvid, message.part);
        if (message.action === "capture.interactions") return getVideoInteractions(message.bvid);
        throw new Error("未知采集操作");
      };
      action()
        .then((data) => sendResponse({ success: true, data }))
        .catch((error) => sendResponse({ success: false, error: getErrorMessage(error) }));
      return true;
    }
    if (message.action === "syncHistory") {
      handleSyncHistory(message)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ success: false, error: getErrorMessage(error) });
        });
      return true;
    }

    return false;
  });

  const intervalSync = async (syncInterval: number) => {
    let lockAcquired = false;
    try {
      const now = Date.now();
      const [isSyncing, lockStartedAt] = await Promise.all([
        getStorageValue(IS_SYNCING, false),
        getStorageValue(SYNC_LOCK_STARTED_AT, 0),
      ]);
      if (isSyncLockActive(isSyncing, lockStartedAt, now)) return;

      const hasFullSync = await getStorageValue(HAS_FULL_SYNC, false);
      if (!hasFullSync) {
        await setStorageValue(SYNC_TIME_REMAIN, syncInterval);
        return;
      }

      await setStorageValue(IS_SYNCING, true);
      await setStorageValue(SYNC_LOCK_STARTED_AT, now);
      lockAcquired = true;
      await setStorageValue(SYNC_PROGRESS_HISTORY, {
        current: 0,
        message: "正在检查有没有新的历史记录...",
      });
      const lastFullSyncAt = await getStorageValue(LAST_FULL_SYNC, 0);
      const runFullSync = isFullReconcileDue(lastFullSyncAt, now);
      await syncHistory(runFullSync);
      if (runFullSync) await setStorageValue(LAST_FULL_SYNC, now);
    } catch (error) {
      console.error("定时读取失败:", error);
    } finally {
      if (lockAcquired) {
        await setStorageValue(IS_SYNCING, false);
        await setStorageValue(SYNC_LOCK_STARTED_AT, 0);
      }
      await setStorageValue(SYNC_PROGRESS_HISTORY, { current: 0, message: "检查完成" });
      await setStorageValue(SYNC_TIME_REMAIN, syncInterval);
    }
  };

  const handleSyncHistory = async (message: any) => {
    let lockAcquired = false;
    try {
      const now = Date.now();
      const [isSyncing, lockStartedAt] = await Promise.all([
        getStorageValue(IS_SYNCING, false),
        getStorageValue(SYNC_LOCK_STARTED_AT, 0),
      ]);
      if (isSyncLockActive(isSyncing, lockStartedAt, now)) {
        return { success: false, error: "正在保存，请等这次结束后再试" };
      }

      await setStorageValue(IS_SYNCING, true);
      await setStorageValue(SYNC_LOCK_STARTED_AT, now);
      lockAcquired = true;
      await setStorageValue(SYNC_PROGRESS_HISTORY, {
        current: 0,
        message: "正在连接哔哩哔哩，并保存历史记录...",
      });

      const forceFullSync = message.isFullSync || false;
      const hasFullSync = await getStorageValue(HAS_FULL_SYNC, false);

      if (forceFullSync || !hasFullSync) {
        await syncHistory(true);
        await setStorageValue(HAS_FULL_SYNC, true);
        await setStorageValue(LAST_FULL_SYNC, now);
        return {
          success: true,
          message: hasFullSync ? "全部历史记录已保存，可以打开记录页面查看" : "第一次保存完成",
        };
      }

      await syncHistory(false);
      return { success: true, message: "更新完成，最近 7 天的历史记录已重新检查" };
    } catch (error) {
      console.error("保存失败:", error);
      return { success: false, error: getErrorMessage(error) };
    } finally {
      if (lockAcquired) {
        await setStorageValue(IS_SYNCING, false);
        await setStorageValue(SYNC_LOCK_STARTED_AT, 0);
      }
      await setStorageValue(SYNC_PROGRESS_HISTORY, { current: 0, message: "保存完成" });
    }
  };

  async function syncHistory(isFullSync = false): Promise<boolean> {
    try {
      const SESSDATA = await getSessdataCookie();

      if (!SESSDATA) {
        throw new Error(
          "没有检测到登录状态。请先在这个浏览器打开哔哩哔哩网页版并登录，然后再回来保存历史记录。",
        );
      }

      let hasMore = true;
      let max = 0;
      let view_at = 0;
      const type = "all";
      const ps = 30;
      let totalSynced = 0;
      const syncStartedAt = Date.now();
      const previousSync = await browser.storage.local.get("lastSync");
      const previousSyncAt = Number(previousSync.lastSync) || 0;
      const recentRescanCutoff = getIncrementalCutoff(previousSyncAt, syncStartedAt);
      const visitedCursors = new Set<string>();

      while (hasMore) {
        const cursorKey = `${max}:${view_at}`;
        if (visitedCursors.has(cursorKey)) {
          throw new Error("哔哩哔哩返回了重复的历史记录页面，请稍后再试");
        }
        visitedCursors.add(cursorKey);

        const response = await fetch(
          `https://api.bilibili.com/x/web-interface/history/cursor?max=${max}&view_at=${view_at}&type=${type}&ps=${ps}`,
          {
            credentials: "include",
          },
        );

        if (!response.ok) {
          throw new Error("保存历史记录失败，请稍后再试");
        }

        const data = await response.json();
        if (data.code !== 0) {
          throw new Error(data.message || "保存历史记录失败，请稍后再试");
        }

        hasMore = data.data.list.length > 0;
        max = data.data.cursor.max;
        view_at = data.data.cursor.view_at;

        if (data.data.list.length > 0) {
          const db = await openDB();

          const tx = db.transaction(["history", "watchEvents"], "readwrite");
          const completed = new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
          const historyStore = tx.objectStore("history");
          const watchEventStore = tx.objectStore("watchEvents");

          for (const item of data.data.list) {
            const historyItem: HistoryItem = {
              id: item.history.oid,
              business: item.history.business,
              bvid: item.history.bvid,
              cid: item.history.cid,
              title: item.title,
              tag_name: item.tag_name,
              cover: item.cover || (item.covers && item.covers[0]),
              view_at: item.view_at,
              uri: item.uri,
              author_name: item.author_name || "",
              author_mid: item.author_mid || "",
              progress: item.progress,
              duration: item.duration,
              is_fav: item.is_fav === 1,
              timestamp: Date.now(),
            };

            putHistoryAndWatchEvent(historyStore, watchEventStore, historyItem);
          }

          totalSynced += data.data.list.length;
          await setStorageValue(SYNC_PROGRESS_HISTORY, {
            current: totalSynced,
            message: `正在检查并更新，已经检查 ${totalSynced} 条记录`,
          });

          await completed;

          await new Promise((resolve) => setTimeout(resolve, 1000));

          if (
            shouldStopIncrementalScan(
              data.data.list.map((item: { view_at: number }) => Number(item.view_at)),
              recentRescanCutoff,
              isFullSync,
            )
          ) {
            hasMore = false;
          }
        }
      }

      await browser.storage.local.set({ lastSync: syncStartedAt });
      await setStorageValue(SYNC_PROGRESS_HISTORY, {
        current: totalSynced,
        message:
          totalSynced > 0
            ? isFullSync
              ? `保存完成，本次检查并保存了 ${totalSynced} 条记录`
              : `保存完成，已重新检查最近 7 天的 ${totalSynced} 条记录`
            : "保存完成，没有发现新的历史记录",
      });

      return true;
    } catch (error) {
      console.error("保存历史记录失败:", error);
      const message = getErrorMessage(error);
      await setStorageValue(SYNC_PROGRESS_HISTORY, {
        current: 0,
        message: `保存失败：${message}`,
      });
      throw error;
    }
  }
});
