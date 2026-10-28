/** Accept Bilibili image CDN URLs and upgrade legacy API HTTP covers. */
export function getCoverUrl(value: string): string | undefined {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname.endsWith(".hdslb.com") ||
      url.username ||
      url.password ||
      url.port
    )
      return undefined;
    url.protocol = "https:";
    return url.href;
  } catch {
    return undefined;
  }
}
