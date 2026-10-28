export interface VideoDetails {
  bvid: string;
  cid: string;
  part: number;
  title: string;
  partTitle: string;
  author: string;
  cover: string;
  duration: number;
}

const isBvid = (value: unknown): value is string =>
  typeof value === "string" && /^BV[0-9A-Za-z]{10}$/.test(value);

async function readApi(path: string, parameters: Record<string, string>) {
  const url = new URL(path, "https://api.bilibili.com");
  url.search = new URLSearchParams(parameters).toString();
  const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`B站读取失败 (${response.status})`);
  const body = await response.json();
  if (body.code !== 0)
    throw new Error(
      typeof body.message === "string" ? body.message.slice(0, 200) : "B站接口读取失败",
    );
  return body.data;
}

export async function getVideoDetails(bvid: unknown, part: unknown): Promise<VideoDetails> {
  if (!isBvid(bvid) || !Number.isInteger(part) || Number(part) < 1 || Number(part) > 10000)
    throw new Error("无效视频标识");
  const data = await readApi("/x/web-interface/view", { bvid });
  const page = data.pages?.find((value: { page: number }) => value.page === part);
  if (!page || !Number.isFinite(page.duration) || page.duration <= 0 || !page.cid)
    throw new Error("无法确认分P信息");
  return {
    bvid,
    cid: String(page.cid),
    part: Number(part),
    title: String(data.title || "").slice(0, 500),
    partTitle: String(page.part || "").slice(0, 500),
    author: String(data.owner?.name || "").slice(0, 200),
    cover: String(data.pic || ""),
    duration: page.duration,
  };
}

export async function getVideoDetailsByCid(bvid: unknown, cid: unknown): Promise<VideoDetails> {
  if (!isBvid(bvid) || typeof cid !== "string" || !/^\d{1,30}$/.test(cid))
    throw new Error("无效视频或分P标识");
  const data = await readApi("/x/web-interface/view", { bvid });
  const matches = Array.isArray(data.pages)
    ? data.pages.filter((page: { cid: unknown }) => String(page.cid) === cid)
    : [];
  const page = matches[0];
  if (
    matches.length !== 1 ||
    !page ||
    !Number.isInteger(page.page) ||
    page.page < 1 ||
    page.page > 100_000 ||
    !Number.isFinite(page.duration) ||
    page.duration <= 0
  )
    throw new Error("标记来源已变化或无法确认该分P，请打开视频检查");
  return {
    bvid,
    cid,
    part: page.page,
    title: String(data.title || "").slice(0, 500),
    partTitle: String(page.part || "").slice(0, 500),
    author: String(data.owner?.name || "").slice(0, 200),
    cover: String(data.pic || ""),
    duration: page.duration,
  };
}

export async function getVideoInteractions(bvid: unknown) {
  if (!isBvid(bvid)) throw new Error("无效视频标识");
  const results = await Promise.allSettled([
    readApi("/x/web-interface/archive/has/like", { bvid }),
    readApi("/x/web-interface/archive/coins", { bvid }),
    readApi("/x/v2/fav/video/favoured", { aid: bvid }),
  ]);
  const interactions: { liked?: boolean; coins?: number; favorited?: boolean; observedAt: number } =
    { observedAt: Date.now() };
  const [like, coin, favorite] = results;
  if (like.status === "fulfilled" && (like.value === 0 || like.value === 1))
    interactions.liked = like.value === 1;
  if (
    coin.status === "fulfilled" &&
    Number.isInteger(coin.value?.multiply) &&
    coin.value.multiply >= 0 &&
    coin.value.multiply <= 2
  )
    interactions.coins = coin.value.multiply;
  if (favorite.status === "fulfilled" && typeof favorite.value?.favoured === "boolean")
    interactions.favorited = favorite.value.favoured;
  return interactions;
}

export function isVideoPage(url: string | undefined) {
  try {
    const value = new URL(url || "");
    return (
      value.origin === "https://www.bilibili.com" &&
      /^\/video\/BV[0-9A-Za-z]{10}(?:\/|$)/.test(value.pathname)
    );
  } catch {
    return false;
  }
}
