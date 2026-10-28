export type Interval = [number, number];
export type PlaybackSession = {
  sessionId: string;
  bvid: string;
  cid: string;
  part: number;
  title: string;
  partTitle: string;
  author: string;
  cover: string;
  duration: number;
  startedAt: number;
  lastSeenAt: number;
  position: number;
  foregroundSeconds: number;
  backgroundSeconds: number;
  pipSeconds: number;
  intervals: Interval[];
  interactions: { liked?: boolean; coins?: number; favorited?: boolean; observedAt: number };
};
export type LibraryDecision = {
  bvid: string;
  status: "keep" | "exclude" | "auto";
  updatedAt: number;
  note: string;
};
export type LibrarySnapshot = { sessions: PlaybackSession[]; decisions: LibraryDecision[] };
export type ScoreBreakdown = {
  duration: number;
  coverageWeight: number;
  engagementWeight: number;
  engagementTargetSeconds: number;
  coverageScore: number;
  engagementScore: number;
  interactionScore: number;
  revisitScore: number;
  rawScore: number;
  interactions: PlaybackSession["interactions"];
};
export type LibraryEntry = {
  bvid: string;
  title: string;
  author: string;
  cover: string;
  lastSeenAt: number;
  foregroundSeconds: number;
  backgroundSeconds: number;
  pipSeconds: number;
  coverage: number;
  score: number;
  breakdown: ScoreBreakdown;
  status: "keep" | "candidate" | "observed" | "exclude";
  reasons: string[];
  sessions: PlaybackSession[];
  decision?: LibraryDecision;
  resumeUrl: string;
};

export const mergeIntervals = (intervals: Interval[], duration: number): Interval[] => {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .map(([start, end]): Interval => [Math.max(0, start), Math.min(duration, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const result: Interval[] = [];
  for (const interval of sorted) {
    const previous = result[result.length - 1];
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else result.push([...interval]);
  }
  return result;
};

export const buildLibraryEntries = (snapshot: LibrarySnapshot): LibraryEntry[] => {
  const grouped = new Map<string, PlaybackSession[]>();
  for (const session of snapshot.sessions) {
    const sessions = grouped.get(session.bvid) || [];
    sessions.push(session);
    grouped.set(session.bvid, sessions);
  }
  const decisions = new Map<string, LibraryDecision>();
  for (const decision of snapshot.decisions) {
    const previous = decisions.get(decision.bvid);
    if (!previous || decision.updatedAt > previous.updatedAt)
      decisions.set(decision.bvid, decision);
  }
  return Array.from(grouped, ([bvid, source]): LibraryEntry => {
    const sessions = [...source].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    const latest = sessions[sessions.length - 1];
    const parts = new Map<string, { duration: number; intervals: Interval[] }>();
    let foregroundSeconds = 0;
    let backgroundSeconds = 0;
    let pipSeconds = 0;
    for (const session of sessions) {
      foregroundSeconds += session.foregroundSeconds;
      backgroundSeconds += session.backgroundSeconds;
      pipSeconds += session.pipSeconds;
      const part = parts.get(session.cid) || { duration: 0, intervals: [] };
      if (session.duration > 0) part.duration = session.duration;
      part.intervals.push(...session.intervals);
      parts.set(session.cid, part);
    }
    let duration = 0;
    let covered = 0;
    for (const part of parts.values()) {
      duration += part.duration;
      covered += mergeIntervals(part.intervals, part.duration).reduce(
        (total, [start, end]) => total + end - start,
        0,
      );
    }
    const coverage = duration > 0 ? Math.min(1, covered / duration) : 0;
    const coverageWeight = duration <= 180 ? 0.8 : duration <= 1200 ? 0.6 : 0.35;
    const target = Math.min(duration, duration <= 180 ? 60 : duration <= 1200 ? 300 : 1200);
    const engagement = target > 0 ? Math.min(1, (foregroundSeconds + pipSeconds) / target) : 0;
    const coverageScore = 60 * coverageWeight * coverage;
    const engagementScore = 60 * (1 - coverageWeight) * engagement;
    const interactions: PlaybackSession["interactions"] = { observedAt: 0 };
    for (const session of [...sessions].sort(
      (a, b) => a.interactions.observedAt - b.interactions.observedAt,
    )) {
      interactions.observedAt = Math.max(interactions.observedAt, session.interactions.observedAt);
      for (const key of ["liked", "coins", "favorited"] as const) {
        if (session.interactions[key] !== undefined)
          Object.assign(interactions, { [key]: session.interactions[key] });
      }
    }
    const interactionScore = Math.max(
      interactions.liked ? 15 : 0,
      interactions.coins ? 30 : 0,
      interactions.favorited ? 40 : 0,
    );
    const effectiveVisits = sessions
      .filter((session) => session.foregroundSeconds >= 10)
      .sort((a, b) => a.startedAt - b.startedAt);
    const revisit =
      effectiveVisits.length >= 2 &&
      effectiveVisits[effectiveVisits.length - 1].startedAt - effectiveVisits[0].startedAt >=
        30 * 60 * 1000;
    const revisitScore = revisit ? 10 : 0;
    const rawScore = coverageScore + engagementScore + interactionScore + revisitScore;
    const score = Math.min(100, Math.round(rawScore));
    const breakdown: ScoreBreakdown = {
      duration,
      coverageWeight,
      engagementWeight: 1 - coverageWeight,
      engagementTargetSeconds: target,
      coverageScore,
      engagementScore,
      interactionScore,
      revisitScore,
      rawScore,
      interactions,
    };
    const decision = decisions.get(bvid);
    const status =
      decision?.status === "exclude"
        ? "exclude"
        : decision?.status === "keep" || interactions.favorited === true
          ? "keep"
          : score >= 50 && foregroundSeconds + pipSeconds >= Math.min(10, duration) && duration > 0
            ? "candidate"
            : "observed";
    const reasons = [
      `启发式分数 ${score}/100，不是喜欢概率`,
      `有效区间覆盖 ${Math.round(coverage * 100)}%，按 CID 合并重复区间`,
      `观看分占 60 分：覆盖权重 ${Math.round(coverageWeight * 100)}%，持续投入权重 ${Math.round((1 - coverageWeight) * 100)}%；投入目标 ${Math.round(target)} 秒（前台及画中画，后台不计分）`,
    ];
    if (interactionScore)
      reasons.push(
        `互动取最强证据：${interactions.favorited ? "已收藏 +40" : interactions.coins ? "已投币 +30" : "已点赞 +15"}`,
      );
    if (revisit) reasons.push("至少两次前台观看各满 10 秒，间隔至少 30 分钟：+10");
    if (decision?.status === "keep") reasons.push("手动保留");
    if (decision?.status === "exclude") reasons.push("手动排除，优先于自动判断");
    if (!duration || foregroundSeconds + pipSeconds < 10)
      reasons.push("有效观看证据不足，继续观察");
    return {
      bvid,
      title: latest.title,
      author: latest.author,
      cover: latest.cover,
      lastSeenAt: latest.lastSeenAt,
      foregroundSeconds,
      backgroundSeconds,
      pipSeconds,
      coverage,
      score,
      breakdown,
      status,
      reasons,
      sessions,
      decision,
      resumeUrl: `https://www.bilibili.com/video/${bvid}/?p=${latest.part}&t=${Math.floor(latest.position)}`,
    };
  }).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
};
