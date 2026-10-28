import type { LibraryEntry } from "./preference";
import type { VideoTagRecord } from "./markers";

export type LibraryViewFilter =
  "all" | "interesting" | "keep" | "candidate" | "observed" | "exclude" | "noted";
export type LibrarySort = "recent" | "score" | "title";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase();

const searchKeyword = (keyword: string): string => {
  const trimmed = keyword.trim();
  if (/\s/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      ["www.bilibili.com", "bilibili.com"].includes(url.host) &&
      !url.username &&
      !url.password
    ) {
      const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
      if (match) return match[1];
    }
  } catch {
    // Ordinary search text does not need to be a URL.
  }
  return trimmed;
};

export const getLibrarySearchTerms = (keyword: string): string[] =>
  normalize(searchKeyword(keyword)).split(/\s+/).filter(Boolean);

export const matchesLibrarySearch = (
  keyword: string | readonly string[],
  fields: string[],
): boolean => {
  const normalizedFields = fields.map(normalize);
  return (typeof keyword === "string" ? getLibrarySearchTerms(keyword) : keyword).every((word) =>
    normalizedFields.some((field) => field.includes(word)),
  );
};

export const matchesLibraryTag = (tags: string[], tag = ""): boolean =>
  !tag || tags.some((value) => normalize(value) === normalize(tag));

export const queryLibraryEntries = (
  entries: LibraryEntry[],
  query: {
    keyword: string;
    status: LibraryViewFilter;
    sort: LibrarySort;
    tags?: VideoTagRecord[];
    tag?: string;
  },
): LibraryEntry[] => {
  const words = getLibrarySearchTerms(query.keyword);
  const tagsByVideo = new Map(query.tags?.map((record) => [record.bvid, record.tags]));
  return entries
    .filter((entry) => {
      const matchesStatus =
        query.status === "all" ||
        (query.status === "interesting"
          ? entry.status === "keep" || entry.status === "candidate"
          : query.status === "noted"
            ? Boolean(entry.decision?.note.trim())
            : entry.status === query.status);
      if (!matchesStatus) return false;
      const tags = tagsByVideo.get(entry.bvid) || [];
      if (!matchesLibraryTag(tags, query.tag)) return false;
      const fields = [
        entry.title,
        entry.author,
        entry.bvid,
        entry.decision?.note ?? "",
        ...entry.sessions.map((session) => session.partTitle),
        ...tags,
      ];
      return matchesLibrarySearch(words, fields);
    })
    .sort((a, b) => {
      const primary =
        query.sort === "title"
          ? a.title.localeCompare(b.title, "zh-CN")
          : query.sort === "score"
            ? b.score - a.score || b.lastSeenAt - a.lastSeenAt
            : b.lastSeenAt - a.lastSeenAt;
      return primary || a.bvid.localeCompare(b.bvid);
    });
};
