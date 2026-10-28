import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { LibraryEntryCard, LibraryEntryDialog } from "../components/LibraryEntryCard";
import { getLibrarySnapshot, importLibrarySnapshot, saveLibraryDecision } from "../utils/library";
import {
  buildLibraryEntries,
  type LibraryDecision,
  type LibraryEntry,
  type LibrarySnapshot,
} from "../utils/preference";

const button =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";
const input =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";
export default function Library() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>({ sessions: [], decisions: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("interesting");
  const [captureError, setCaptureError] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const lock = useRef(false);
  const refreshSequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<LibraryEntry | null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const [next, settings] = await Promise.all([
      getLibrarySnapshot(),
      browser.storage.local.get(["biliKeepTrackingEnabled", "biliKeepCaptureError"]),
    ]);
    if (sequence !== refreshSequence.current) return;
    setSnapshot(next);
    setTracking(settings.biliKeepTrackingEnabled !== false);
    setCaptureError(
      typeof settings.biliKeepCaptureError === "string" ? settings.biliKeepCaptureError : "",
    );
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    // Invalidate any pending poll before a mutation can change the stored snapshot.
    refreshSequence.current += 1;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败，请重试", {
        id: "library-error",
      });
    } finally {
      lock.current = false;
      setBusy(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(refresh);
    const timer = window.setInterval(() => {
      if (!document.hidden && !lock.current) {
        void refresh().catch((error) =>
          toast.error(error instanceof Error ? error.message : "刷新失败，请重试", {
            id: "library-error",
          }),
        );
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, run]);

  const entries = useMemo(() => buildLibraryEntries(snapshot), [snapshot]);
  const detailEntry = selected
    ? entries.find((entry) => entry.bvid === selected.bvid) || selected
    : null;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return entries
      .filter(
        (entry) =>
          (filter === "all" ||
            entry.status === filter ||
            (filter === "interesting" &&
              (entry.status === "candidate" || entry.status === "keep"))) &&
          (!term ||
            [entry.title, entry.author, entry.bvid, entry.decision?.note || ""].some((text) =>
              text.toLocaleLowerCase().includes(term),
            )),
      )
      .sort((a, b) =>
        sort === "score"
          ? b.score - a.score || b.lastSeenAt - a.lastSeenAt
          : b.lastSeenAt - a.lastSeenAt,
      );
  }, [entries, query, filter, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 40, currentPage * 40);
  useEffect(() => setPage(1), [query, filter, sort]);

  const save = async (decision: LibraryDecision) =>
    run(async () => {
      await saveLibraryDecision(decision);
      await refresh();
      toast.success("已保存", { id: "library-save" });
    });

  const exportBackup = () =>
    run(async () => {
      const fresh = await getLibrarySnapshot();
      const blob = new Blob(
        [
          JSON.stringify(
            { format: "bili-keep", version: 1, exportedAt: new Date().toISOString(), ...fresh },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `bili-keep-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("已导出本地备份");
    });

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold">Bili Keep · 喜好归档</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-neutral-400">
          根据实际观看投入积累候选，再由你决定保留。数据存放在本机，未下载视频；首版无需 API key。
        </p>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-neutral-400">
          历史同步数据不能推断有效观看。自动判断只是整理线索，不代表喜好概率。此页每 5
          秒更新，切到后台时暂停刷新。
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void run(refresh)}>
          {busy ? "处理中…" : "刷新"}
        </button>
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await browser.storage.local.set({ biliKeepTrackingEnabled: !tracking });
              setTracking(!tracking);
              toast.success(
                tracking ? "已暂停自动记录" : "已开启自动记录，请刷新已打开的 B 站页面",
              );
            })
          }
        >
          {tracking ? "暂停自动记录" : "开启自动记录"}
        </button>
        <button className={button} disabled={busy} onClick={() => void exportBackup()}>
          导出备份
        </button>
        <button className={button} disabled={busy} onClick={() => fileInput.current?.click()}>
          合并恢复备份
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="选择喜好归档备份"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void run(async () => {
              if (file.size > 200 * 1024 * 1024)
                throw new Error("备份超过 200 MB，请使用较小的备份文件");
              await importLibrarySnapshot(JSON.parse(await file.text()));
              await refresh();
              toast.success("备份已合并，原有记录已保留");
            });
          }}
        />
      </div>
      {!tracking && (
        <p
          role="status"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          自动记录已暂停，已有资料仍可整理和备份。
        </p>
      )}
      {captureError && (
        <p
          role="alert"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          最近一次采集提示：{captureError}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <input
          ref={searchInput}
          aria-label="搜索资料库"
          placeholder="搜索标题、UP 主、BV 或备注"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={`${input} min-w-48 flex-1`}
        />
        <select
          aria-label="筛选状态"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className={input}
        >
          <option value="interesting">候选与保留</option>
          <option value="candidate">候选</option>
          <option value="keep">保留</option>
          <option value="all">全部</option>
          <option value="exclude">排除</option>
        </select>
        <select
          aria-label="排序"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          className={input}
        >
          <option value="recent">最近观看</option>
          <option value="score">喜好分数</option>
        </select>
      </div>
      <p className="text-sm text-gray-500 dark:text-neutral-400" role="status">
        共 {entries.length} 条视频，符合筛选 {filtered.length} 条；本页 {visible.length} 条（每页 40
        条）。
      </p>
      {loading ? (
        <p className="py-12 text-center">正在读取本地资料…</p>
      ) : visible.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((entry) => (
            <LibraryEntryCard
              key={entry.bvid}
              entry={entry}
              onOpen={(value, trigger) => {
                detailTrigger.current = trigger;
                setSelected(value);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm leading-7 text-gray-500 dark:border-neutral-700 dark:text-neutral-400">
          {entries.length
            ? "当前筛选没有匹配视频，试试切换“全部”或调整关键词。"
            : "还没有观看记录。开启自动记录后，在 B 站普通视频页面播放视频，资料会自动积累；开启或安装扩展后请刷新已打开的 B 站页面。"}
        </div>
      )}
      {detailEntry && (
        <LibraryEntryDialog
          key={detailEntry.bvid}
          entry={detailEntry}
          busy={busy}
          onSave={save}
          onClose={() => {
            setSelected(null);
            window.requestAnimationFrame(() => {
              if (detailTrigger.current?.isConnected) detailTrigger.current.focus();
              else searchInput.current?.focus();
            });
          }}
        />
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <button
            className={button}
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            上一页
          </button>
          <span className="text-sm">
            {currentPage} / {pages}
          </span>
          <button
            className={button}
            disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
