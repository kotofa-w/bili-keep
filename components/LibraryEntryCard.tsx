import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { getCoverUrl } from "../utils/cover";
import type { LibraryDecision, LibraryEntry } from "../utils/preference";
import { ScoreRing } from "./ScoreRing";

const button =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";
const labels = { keep: "已保留", candidate: "候选", observed: "已观察", exclude: "已排除" };
const time = (seconds: number) =>
  seconds < 60 ? `${Math.round(seconds)} 秒` : `${Math.round(seconds / 60)} 分钟`;

function safeResume(entry: LibraryEntry) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(entry.bvid)) return undefined;
  const url = new URL(`https://www.bilibili.com/video/${entry.bvid}/`);
  try {
    const resume = new URL(entry.resumeUrl);
    for (const key of ["p", "t"]) {
      const value = resume.searchParams.get(key);
      if (value && /^\d+(\.\d+)?$/.test(value) && Number(value) <= 1e8)
        url.searchParams.set(key, value);
    }
  } catch {
    // Keep the constructed BV link when an imported resume URL is malformed.
  }
  return url.href;
}

export function LibraryEntryCard({
  entry,
  onOpen,
}: {
  entry: LibraryEntry;
  onOpen: (entry: LibraryEntry, trigger: HTMLButtonElement) => void;
}) {
  const [failedCover, setFailedCover] = useState("");
  const cover = getCoverUrl(entry.cover);
  const href = safeResume(entry);
  const open = (event: MouseEvent<HTMLButtonElement>) => onOpen(entry, event.currentTarget);
  return (
    <article className="min-w-0 rounded-xl border border-gray-200 bg-white [container-type:inline-size] dark:border-neutral-800 dark:bg-neutral-900">
      <button
        onClick={open}
        aria-label={`查看详情：${entry.title || entry.bvid}`}
        className="relative block aspect-video w-full overflow-hidden rounded-t-xl bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:bg-neutral-800"
      >
        {cover && failedCover !== cover ? (
          <img
            src={cover}
            onError={() => setFailedCover(cover)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-opacity hover:opacity-90"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-neutral-500">
            暂无封面
          </span>
        )}
        <span className="absolute right-2 top-2 rounded bg-black/65 px-2 py-1 text-xs text-white">
          {labels[entry.status]}
        </span>
      </button>
      <div className="p-3">
        <button
          onClick={open}
          className="block h-10 w-full text-left text-sm font-medium leading-5 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <span className="line-clamp-2 break-words">{entry.title || entry.bvid}</span>
        </button>
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-neutral-400">
          {entry.author || "未知 UP 主"}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="min-w-0 text-xs leading-5 text-gray-500 dark:text-neutral-400">
            <p>
              前台 {time(entry.foregroundSeconds)} · 覆盖 {Math.round(entry.coverage * 100)}%
            </p>
            <p>{new Date(entry.lastSeenAt).toLocaleDateString("zh-CN")} 观看</p>
          </div>
          <ScoreRing entry={entry} />
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-xs dark:border-neutral-800">
          <button
            onClick={open}
            className="rounded py-1 text-gray-600 hover:text-blue-600 dark:text-neutral-300 dark:hover:text-blue-400"
          >
            查看详情
          </button>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded py-1 text-blue-600 dark:text-blue-400"
            >
              继续观看 ↗
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function LibraryEntryDialog({
  entry,
  busy,
  onSave,
  onClose,
}: {
  entry: LibraryEntry;
  busy: boolean;
  onSave: (decision: LibraryDecision) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [note, setNote] = useState(entry.decision?.note || "");
  const href = safeResume(entry);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
  }, []);
  const save = (status: LibraryDecision["status"]) =>
    onSave({ bvid: entry.bvid, status, note, updatedAt: Date.now() });
  const interaction = entry.breakdown.interactions;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl [container-type:inline-size] backdrop:bg-black/50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-5 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 id={titleId} className="break-words text-lg font-semibold">
            {entry.title || entry.bvid}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
            {entry.author || "未知 UP 主"} · {entry.bvid} · {labels[entry.status]}
          </p>
        </div>
        <button
          autoFocus
          aria-label="关闭详情"
          className={`${button} shrink-0`}
          onClick={() => dialog.current?.close()}
        >
          关闭
        </button>
      </div>
      <div className="space-y-5 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm leading-7">
            <p>
              前台投入 {time(entry.foregroundSeconds)} · 有效覆盖 {Math.round(entry.coverage * 100)}
              %
            </p>
            <p className="text-gray-500 dark:text-neutral-400">
              后台 {time(entry.backgroundSeconds)} · 画中画 {time(entry.pipSeconds)}
            </p>
            <p className="text-gray-500 dark:text-neutral-400">
              最近观看 {new Date(entry.lastSeenAt).toLocaleString("zh-CN")}
            </p>
          </div>
          <ScoreRing entry={entry} placement="bottom" />
        </div>
        <section aria-label="判断依据">
          <h3 className="mb-2 text-sm font-semibold">判断依据</h3>
          <ul className="list-inside list-disc space-y-1 text-sm leading-6 text-gray-600 dark:text-neutral-400">
            {entry.reasons.length ? (
              entry.reasons.map((reason, index) => <li key={index}>{reason}</li>)
            ) : (
              <li>观看证据仍在积累</li>
            )}
          </ul>
          <p className="mt-2 text-xs text-gray-500 dark:text-neutral-400">
            互动观察：点赞{" "}
            {interaction.liked === undefined ? "未知" : interaction.liked ? "是" : "否"} · 投币{" "}
            {interaction.coins === undefined ? "未知" : interaction.coins} · 收藏{" "}
            {interaction.favorited === undefined ? "未知" : interaction.favorited ? "是" : "否"}
            。规则分不代表喜好概率。
          </p>
        </section>
        <label className="block text-sm">
          <span className="mb-2 block font-semibold">我的备注</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={busy}
            placeholder="为什么想留下这个视频？"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={() => void save("keep")}>
            保留
          </button>
          <button className={button} disabled={busy} onClick={() => void save("exclude")}>
            排除
          </button>
          <button className={button} disabled={busy} onClick={() => void save("auto")}>
            恢复自动判断
          </button>
          <button
            className={button}
            disabled={busy}
            onClick={() => void save(entry.decision?.status || "auto")}
          >
            保存备注
          </button>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${button} text-blue-600 dark:text-blue-400`}
            >
              继续观看 ↗
            </a>
          )}
        </div>
        <section aria-label="观看会话">
          <h3 className="mb-2 text-sm font-semibold">观看会话 · {entry.sessions.length} 次</h3>
          <ul className="max-h-52 space-y-2 overflow-y-auto rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600 dark:bg-neutral-950 dark:text-neutral-400">
            {entry.sessions.map((session) => (
              <li key={session.sessionId}>
                {new Date(session.startedAt).toLocaleString("zh-CN")} —{" "}
                {new Date(session.lastSeenAt).toLocaleTimeString("zh-CN")}
                <br />P{session.part} {session.partTitle} · 位置 {time(session.position)} /{" "}
                {time(session.duration)} · 前台 {time(session.foregroundSeconds)} · 后台{" "}
                {time(session.backgroundSeconds)} · 画中画 {time(session.pipSeconds)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </dialog>
  );
}
