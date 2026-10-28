import { matchesLibraryTag } from "../utils/libraryQuery";

export function TagChips({
  tags,
  selectedTag,
  onSelectTag,
}: {
  tags: readonly string[];
  selectedTag: string;
  onSelectTag: (tag: string) => void;
}) {
  if (!tags.length) return null;
  return (
    <div role="group" aria-label="标签快捷筛选" className="mt-2 flex flex-wrap gap-1.5">
      {tags.slice(0, 3).map((tag) => {
        const selected = !!selectedTag && matchesLibraryTag([tag], selectedTag);
        return (
          <button
            key={tag.normalize("NFKC").toLowerCase()}
            type="button"
            aria-label={`按标签筛选：${tag}`}
            aria-pressed={selected}
            title={tag}
            onClick={() => onSelectTag(tag)}
            className={`max-w-[9rem] truncate rounded-full border px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${selected ? "border-blue-400 bg-blue-100 text-blue-800 dark:border-blue-600 dark:bg-blue-950 dark:text-blue-200" : "border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-400 hover:text-blue-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"}`}
          >
            {tag}
          </button>
        );
      })}
      {tags.length > 3 && (
        <span
          tabIndex={0}
          title={tags.slice(3).join("、")}
          aria-label={`另有${tags.length - 3}个标签：${tags.slice(3).join("、")}`}
          className="group relative self-center rounded px-1 text-xs text-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-neutral-400"
        >
          +{tags.length - 3}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden w-max max-w-64 whitespace-normal break-words rounded bg-gray-900 px-2 py-1 text-white group-hover:block group-focus:block"
          >
            {tags.slice(3).join("、")}
          </span>
        </span>
      )}
    </div>
  );
}
