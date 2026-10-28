import { useId } from "react";
import type { LibraryEntry } from "../utils/preference";

const number = (value: number) => Number(value.toFixed(1));

export function ScoreRing({
  entry,
  placement = "top",
}: {
  entry: LibraryEntry;
  placement?: "top" | "bottom";
}) {
  const tooltipId = useId();
  const data = entry.breakdown;
  const parts = [
    { label: "覆盖", value: data.coverageScore, color: "#3b82f6" },
    { label: "投入", value: data.engagementScore, color: "#14b8a6" },
    { label: "互动", value: data.interactionScore, color: "#f59e0b" },
    { label: "重访", value: data.revisitScore, color: "#a855f7" },
  ];
  const denominator = Math.max(100, data.rawScore);
  const circumference = 2 * Math.PI * 22;
  let offset = 0;

  return (
    <div
      className="group relative shrink-0"
      role="img"
      tabIndex={0}
      aria-describedby={tooltipId}
      aria-label={`喜好规则分 ${entry.score}，查看评分构成`}
    >
      <svg viewBox="0 0 56 56" className="h-14 w-14" aria-hidden="true">
        <circle
          cx="28"
          cy="28"
          r="22"
          fill="none"
          strokeWidth="5"
          className="stroke-gray-200 dark:stroke-neutral-700"
        />
        {parts.map((part) => {
          const length = (part.value / denominator) * circumference;
          const start = offset;
          offset += length;
          return (
            <circle
              key={part.label}
              cx="28"
              cy="28"
              r="22"
              fill="none"
              stroke={part.color}
              strokeWidth="5"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-start}
              transform="rotate(-90 28 28)"
            />
          );
        })}
        <text
          x="28"
          y="31"
          textAnchor="middle"
          className="fill-gray-900 text-[14px] font-semibold dark:fill-neutral-100"
        >
          {entry.score}
        </text>
      </svg>
      <div
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute right-0 z-30 hidden w-64 max-w-[calc(100cqw-1.5rem)] rounded-xl border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-700 shadow-xl group-hover:block group-focus-within:block dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 ${placement === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}
      >
        <p className="mb-1 font-semibold">评分构成 · 规则分，非概率</p>
        <dl>
          {parts.map((part) => (
            <div key={part.label} className="flex justify-between">
              <dt>
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: part.color }}
                />
                {part.label}
              </dt>
              <dd>{number(part.value)} 分</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 dark:border-neutral-600">
            <dt>覆盖 / 投入权重</dt>
            <dd>
              {number(data.coverageWeight * 100)}% / {number(data.engagementWeight * 100)}%
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>有效覆盖率</dt>
            <dd>{number(entry.coverage * 100)}%</dd>
          </div>
          <div className="flex justify-between">
            <dt>投入目标</dt>
            <dd>{number(data.engagementTargetSeconds)} 秒</dd>
          </div>
        </dl>
        {data.rawScore > 100 && (
          <p className="mt-1">
            原始合计 {number(data.rawScore)} 分，显示封顶为 100；环图按原始合计展示构成。
          </p>
        )}
      </div>
    </div>
  );
}
