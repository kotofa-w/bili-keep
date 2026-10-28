export type VideoMarker = {
  markerId: string;
  bvid: string;
  cid: string;
  part: number;
  title: string;
  partTitle: string;
  author: string;
  cover: string;
  duration: number;
  position: number;
  note: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type VideoTagRecord = { bvid: string; tags: string[]; updatedAt: number };

const invalid = (): never => {
  throw new Error("标记或标签格式无效，或超出大小限制");
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const text = (value: unknown, max: number, min = 0): string => {
  if (typeof value !== "string" || value.length < min || value.length > max) return invalid();
  return value;
};
const number = (value: unknown, max: number, min = 0): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    return invalid();
  return value;
};
const bvid = (value: unknown): string => {
  if (typeof value !== "string" || !/^BV[0-9A-Za-z]{10}$/.test(value)) return invalid();
  return value;
};
const timestamp = (value: unknown, min = 1): number => number(value, 8_640_000_000_000_000, min);

export const parseVideoMarker = (value: unknown): VideoMarker => {
  const item = object(value);
  const cid = text(item.cid, 30, 1);
  if (!/^[1-9]\d*$/.test(cid)) return invalid();
  const part = number(item.part, 100_000, 1);
  if (!Number.isInteger(part)) return invalid();
  const duration = number(item.duration, 31_536_000, Number.MIN_VALUE);
  const createdAt = timestamp(item.createdAt);
  const updatedAt = timestamp(item.updatedAt, createdAt);
  const parsed: VideoMarker = {
    markerId: text(item.markerId, 200, 1),
    bvid: bvid(item.bvid),
    cid,
    part,
    title: text(item.title, 2000),
    partTitle: text(item.partTitle, 2000),
    author: text(item.author, 500),
    cover: text(item.cover, 4096),
    duration,
    position: number(item.position, duration),
    note: text(item.note, 1000),
    createdAt,
    updatedAt,
  };
  if (item.deletedAt !== undefined) parsed.deletedAt = number(item.deletedAt, updatedAt, createdAt);
  return parsed;
};

export const parseVideoTags = (value: unknown): VideoTagRecord => {
  const item = object(value);
  if (!Array.isArray(item.tags) || item.tags.length > 12) return invalid();
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of item.tags) {
    if (typeof value !== "string") return invalid();
    const tag = text(value.normalize("NFKC").trim(), 32, 1);
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      tags.push(tag);
      seen.add(key);
    }
  }
  return { bvid: bvid(item.bvid), tags, updatedAt: timestamp(item.updatedAt) };
};
