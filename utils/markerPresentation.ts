import type { VideoMarker } from "./markers";

export const formatMarkerPosition = (seconds: number): string => {
  const milliseconds = Math.round(Math.max(0, seconds) * 1000);
  const whole = Math.floor(milliseconds / 1000);
  return (
    [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
      .map((value) => String(value).padStart(2, "0"))
      .join(":") + `.${String(milliseconds % 1000).padStart(3, "0")}`
  );
};

const markdownText = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+\-.!|~]/g, "\\$&");

export const markersToMarkdown = (markers: VideoMarker[]): string =>
  [
    "# Bili Keep 时间标记",
    "",
    "导出链接使用保存时的分P序号；视频调整分P后可能变化。应用内回跳会重新核实CID。",
    "",
    ...markers.flatMap((marker) => [
      `## ${markdownText(marker.title || marker.bvid)}`,
      `- UP主：${markdownText(marker.author)}`,
      `- P${marker.part} ${markdownText(marker.partTitle)} · CID ${marker.cid}`,
      `- 时间：${formatMarkerPosition(marker.position)} / ${formatMarkerPosition(marker.duration)}`,
      `- [打开保存时的位置](https://www.bilibili.com/video/${marker.bvid}/?p=${marker.part}&t=${marker.position})`,
      ...marker.note.split(/\r?\n/).map((line) => `> ${markdownText(line)}`),
      "",
    ]),
  ].join("\n");
