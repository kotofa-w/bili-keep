import { useEffect, useMemo, useRef, useState } from "react";
import { deleteVideoMarker, saveVideoMarker, saveVideoTags } from "../utils/library";
import {
  getLibrarySearchTerms,
  matchesLibrarySearch,
  matchesLibraryTag,
} from "../utils/libraryQuery";
import { formatMarkerPosition, markersToMarkdown } from "../utils/markerPresentation";
import { parseVideoTags, type VideoMarker, type VideoTagRecord } from "../utils/markers";

const button =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800";
const input =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950";
const errorText = (error: unknown) => (error instanceof Error ? error.message : "操作失败，请重试");

export function VideoTagsEditor({
  bvid,
  record,
  onChanged,
}: {
  bvid: string;
  record?: VideoTagRecord;
  onChanged: () => Promise<void>;
}) {
  const [text, setText] = useState(() => (record?.tags || []).join(", "));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const revision = useRef(record?.updatedAt || 0);
  const lock = useRef(false);
  useEffect(() => {
    if (!dirty) {
      setText((record?.tags || []).join(", "));
      revision.current = record?.updatedAt || 0;
    }
  }, [record, dirty]);
  const change = (value: string) => {
    setText(value);
    setDirty(true);
    setMessage("");
  };
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const next = parseVideoTags({
        bvid,
        tags: text
          .split(/[,，\r\n]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        updatedAt: Math.max(Date.now(), revision.current + 1),
      });
      await saveVideoTags(next, revision.current);
      revision.current = next.updatedAt;
      await onChanged();
      setText(next.tags.join(", "));
      setDirty(false);
      setMessage("标签已保存");
    } catch (error) {
      setMessage(`保存失败：${errorText(error)}。输入内容已保留。`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const draftTags = text
    .split(/[,，\r\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return (
    <section aria-label={`视频标签 ${bvid}`} className="space-y-2">
      <label className="block text-sm">
        <span className="mb-2 block font-semibold">视频标签</span>
        <textarea
          aria-label={`编辑标签 ${bvid}`}
          value={text}
          onChange={(event) => change(event.target.value)}
          disabled={busy}
          rows={2}
          className={input}
          placeholder="逗号或换行分隔；最多12个，每个32字"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {draftTags.map((tag, index) => (
          <button
            key={`${tag}-${index}`}
            disabled={busy}
            className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-200"
            aria-label={`移除标签 ${tag}`}
            onClick={() => change(draftTags.filter((_, i) => i !== index).join(", "))}
          >
            {tag} ×
          </button>
        ))}
      </div>
      <button className={button} disabled={busy || !dirty} onClick={() => void save()}>
        {busy ? "保存中…" : "保存标签"}
      </button>
      <p className="text-xs text-gray-500 dark:text-neutral-400">
        移除后点保存；清空可删除全部标签。标签属于整个视频。
      </p>
      {message && (
        <p role={message.startsWith("保存失败") ? "alert" : "status"} className="text-xs leading-5">
          {message}
        </p>
      )}
    </section>
  );
}

function MarkerRow({
  marker,
  tagRecord,
  onChanged,
}: {
  marker: VideoMarker;
  tagRecord?: VideoTagRecord;
  onChanged: () => Promise<void>;
}) {
  const [note, setNote] = useState(marker.note);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const revision = useRef(marker.updatedAt);
  const lock = useRef(false);
  useEffect(() => {
    if (!dirty) {
      setNote(marker.note);
      revision.current = marker.updatedAt;
    }
  }, [marker, dirty]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(`${errorText(error)}。未保存的说明仍保留在输入框中。`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <article className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-neutral-800">
      <div>
        <h3 className="break-words font-semibold">{marker.title || marker.bvid}</h3>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-neutral-400">
          {marker.author || "未知 UP 主"} · {marker.bvid}
          <br />P{marker.part} {marker.partTitle} · {formatMarkerPosition(marker.position)} /{" "}
          {formatMarkerPosition(marker.duration)}
          <br />
          保存于 {new Date(marker.createdAt).toLocaleString("zh-CN")}
        </p>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block">时间点说明</span>
        <textarea
          aria-label={`时间点说明 ${marker.markerId}`}
          value={note}
          maxLength={1000}
          rows={2}
          disabled={busy}
          className={input}
          placeholder="记下这个时间点值得回看的原因"
          onChange={(event) => {
            setNote(event.target.value);
            setDirty(true);
            setMessage("");
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const response = await browser.runtime.sendMessage({
                action: "marker.open",
                markerId: marker.markerId,
              });
              if (!response?.success)
                throw new Error(`回跳失败：${response?.error || "无法核实这个时间点"}。未打开视频`);
              setMessage("已核实分P并打开时间点");
            })
          }
        >
          回到时间点 ↗
        </button>
        <button
          className={button}
          disabled={busy || !dirty}
          onClick={() =>
            void run(async () => {
              const next = {
                ...marker,
                note,
                updatedAt: Math.max(Date.now(), revision.current + 1),
              };
              await saveVideoMarker(next, revision.current);
              revision.current = next.updatedAt;
              await onChanged();
              setDirty(false);
              setMessage("说明已保存");
            })
          }
        >
          保存说明
        </button>
        <button
          className={button}
          disabled={busy}
          onClick={() => {
            if (!window.confirm("删除这个时间标记？视频的喜好判断和观看记录会保留。")) return;
            void run(async () => {
              await deleteVideoMarker(marker.markerId, revision.current);
              await onChanged();
            });
          }}
        >
          删除标记
        </button>
      </div>
      {message && (
        <p role="status" className="text-xs leading-5">
          {message}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-blue-600 dark:text-blue-400">
          编辑这个视频的标签
        </summary>
        <div className="mt-3">
          <VideoTagsEditor bvid={marker.bvid} record={tagRecord} onChanged={onChanged} />
        </div>
      </details>
    </article>
  );
}

export function MarkerPanel({
  markers,
  tags,
  keyword,
  tag,
  onChanged,
}: {
  markers: VideoMarker[];
  tags: VideoTagRecord[];
  keyword: string;
  tag: string;
  onChanged: () => Promise<void>;
}) {
  const [limit, setLimit] = useState(50);
  const tagMap = useMemo(() => new Map(tags.map((record) => [record.bvid, record])), [tags]);
  const terms = useMemo(() => getLibrarySearchTerms(keyword), [keyword]);
  const filtered = useMemo(
    () =>
      markers
        .filter((marker) => {
          const videoTags = tagMap.get(marker.bvid)?.tags || [];
          return (
            matchesLibraryTag(videoTags, tag) &&
            matchesLibrarySearch(terms, [
              marker.bvid,
              marker.title,
              marker.partTitle,
              marker.author,
              marker.note,
              ...videoTags,
            ])
          );
        })
        .sort((a, b) => b.createdAt - a.createdAt || a.markerId.localeCompare(b.markerId)),
    [markers, tagMap, terms, tag],
  );
  useEffect(() => setLimit(50), [keyword, tag]);
  const exportMarkdown = () => {
    const url = URL.createObjectURL(
      new Blob([markersToMarkdown(filtered)], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bili-keep-markers-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      aria-label="时间标记"
      className="space-y-3 border-t border-gray-200 pt-5 dark:border-neutral-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          时间标记 · {filtered.length} / {markers.length}
        </h2>
        <button className={button} disabled={!filtered.length} onClick={exportMarkdown}>
          导出当前标记 Markdown
        </button>
      </div>
      <p className="text-xs leading-5 text-gray-500 dark:text-neutral-400">
        在视频页打开扩展，点“保存当前时间点”。这里独立保留标记，即使没有观看记录也能找到；关键词和标签筛选生效，喜好状态仅筛选上方的视频。
      </p>
      {filtered.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.slice(0, limit).map((marker) => (
            <MarkerRow
              key={marker.markerId}
              marker={marker}
              tagRecord={tagMap.get(marker.bvid)}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500 dark:bg-neutral-900 dark:text-neutral-400">
          {markers.length ? "当前条件没有匹配的时间标记。" : "还没有时间标记。"}
        </p>
      )}
      {filtered.length > limit && (
        <button className={button} onClick={() => setLimit(limit + 50)}>
          再显示50条
        </button>
      )}
    </section>
  );
}
