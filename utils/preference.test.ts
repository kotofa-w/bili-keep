import { describe, expect, it } from "vitest";
import { buildLibraryEntries, mergeIntervals, type PlaybackSession } from "./preference";

const sampleSession = (extra: Partial<PlaybackSession> = {}): PlaybackSession => ({
  sessionId: "session-1",
  bvid: "BV1xx411c7mD",
  cid: "123",
  part: 1,
  title: "视频",
  partTitle: "第一P",
  author: "UP",
  cover: "",
  duration: 100,
  startedAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_100_000,
  position: 90,
  foregroundSeconds: 90,
  backgroundSeconds: 0,
  pipSeconds: 0,
  intervals: [[0, 90]],
  interactions: { observedAt: 1_700_000_100_000 },
  ...extra,
});

describe("preference evidence", () => {
  it.each([
    { duration: 100, coverageWeight: 0.8, target: 60 },
    { duration: 600, coverageWeight: 0.6, target: 300 },
    { duration: 3600, coverageWeight: 0.35, target: 1200 },
  ])(
    "exposes reusable score contributions for duration $duration",
    ({ duration, coverageWeight, target }) => {
      const entry = buildLibraryEntries({
        sessions: [sampleSession({ duration, foregroundSeconds: 37, intervals: [[0, 33]] })],
        decisions: [],
      })[0];
      const breakdown = entry.breakdown;
      expect(breakdown.duration).toBe(duration);
      expect(breakdown.coverageWeight).toBe(coverageWeight);
      expect(breakdown.coverageWeight + breakdown.engagementWeight).toBe(1);
      expect(breakdown.engagementTargetSeconds).toBe(target);
      expect(breakdown.coverageScore).toBeCloseTo((60 * coverageWeight * 33) / duration);
      expect(breakdown.engagementScore).toBeCloseTo((60 * (1 - coverageWeight) * 37) / target);
      expect(
        breakdown.coverageScore +
          breakdown.engagementScore +
          breakdown.interactionScore +
          breakdown.revisitScore,
      ).toBe(breakdown.rawScore);
      expect(entry.score).toBe(Math.min(100, Math.round(breakdown.rawScore)));
    },
  );
  it("exposes a raw 110 while preserving the 100 cap and strongest interaction only", () => {
    const interactions = { liked: true, coins: 2, favorited: true, observedAt: 1_700_000_100_000 };
    const entry = buildLibraryEntries({
      sessions: [
        sampleSession({ foregroundSeconds: 100, intervals: [[0, 100]], interactions }),
        sampleSession({
          sessionId: "revisit",
          startedAt: 1_700_001_800_000,
          lastSeenAt: 1_700_001_900_000,
          interactions,
        }),
      ],
      decisions: [],
    })[0];
    const breakdown = entry.breakdown;
    expect(breakdown.interactionScore).toBe(40);
    expect(breakdown.revisitScore).toBe(10);
    expect(breakdown.rawScore).toBe(110);
    expect(entry.score).toBe(100);
    expect(breakdown.interactions).toMatchObject({ liked: true, coins: 2, favorited: true });
    expect(breakdown.interactions.observedAt).toBe(interactions.observedAt);
  });
  it("surfaces a completed video even without a like or coin", () => {
    const entry = buildLibraryEntries({
      sessions: [sampleSession({ foregroundSeconds: 100, intervals: [[0, 100]] })],
      decisions: [],
    })[0];
    expect(entry.status).toBe("candidate");
  });
  it("clips and unions intervals without counting jumps or duplicate coverage", () => {
    expect(
      mergeIntervals(
        [
          [-3, 10],
          [5, 20],
          [90, 110],
          [40, 30],
          [NaN, 5],
        ],
        100,
      ),
    ).toEqual([
      [0, 20],
      [90, 100],
    ]);
  });
  it("deduplicates coverage by CID and sums the duration of distinct parts", () => {
    const result = buildLibraryEntries({
      sessions: [
        sampleSession(),
        sampleSession({ sessionId: "2" }),
        sampleSession({ sessionId: "3", cid: "456", part: 2, duration: 200, intervals: [[0, 60]] }),
      ],
      decisions: [],
    })[0];
    expect(result.coverage).toBeCloseTo(0.5);
    expect(result.resumeUrl).toBe("https://www.bilibili.com/video/BV1xx411c7mD/?p=2&t=90");
  });
  it("does not infer liking from background playback or a seek to the end", () => {
    const result = buildLibraryEntries({
      sessions: [
        sampleSession({
          foregroundSeconds: 0,
          backgroundSeconds: 100,
          intervals: [],
          position: 100,
        }),
      ],
      decisions: [],
    })[0];
    expect(result.score).toBe(0);
    expect(result.status).toBe("observed");
  });
  it("uses the strongest interaction, while manual exclusion wins", () => {
    const session = sampleSession({
      interactions: { liked: true, coins: 2, favorited: true, observedAt: 1_700_000_100_000 },
    });
    const auto = buildLibraryEntries({ sessions: [session], decisions: [] })[0];
    expect(auto.score).toBeLessThanOrEqual(100);
    expect(auto.status).toBe("keep");
    expect(
      buildLibraryEntries({
        sessions: [session],
        decisions: [
          { bvid: session.bvid, status: "exclude", updatedAt: session.lastSeenAt, note: "" },
        ],
      })[0].status,
    ).toBe("exclude");
  });
  it("does not award revisit points for refreshes", () => {
    const single = buildLibraryEntries({ sessions: [sampleSession()], decisions: [] })[0];
    const refreshed = buildLibraryEntries({
      sessions: [sampleSession(), sampleSession({ sessionId: "2" })],
      decisions: [],
    })[0];
    expect(refreshed.score).toBe(single.score);
    const revisited = buildLibraryEntries({
      sessions: [
        sampleSession(),
        sampleSession({
          sessionId: "3",
          startedAt: 1_700_001_800_000,
          lastSeenAt: 1_700_001_900_000,
        }),
      ],
      decisions: [],
    })[0];
    expect(revisited.score).toBe(single.score + 10);
  });
  it("uses the latest observed interaction status rather than retaining a cancelled favorite", () => {
    const sessions = [
      sampleSession({ interactions: { favorited: true, observedAt: 1000 } }),
      sampleSession({ sessionId: "later", interactions: { favorited: false, observedAt: 2000 } }),
    ];
    expect(buildLibraryEntries({ sessions, decisions: [] })[0].status).not.toBe("keep");
  });
  it("gives a long video meaningful credit for sustained attention", () => {
    const short = buildLibraryEntries({
      sessions: [sampleSession({ duration: 100, foregroundSeconds: 60, intervals: [[0, 10]] })],
      decisions: [],
    })[0];
    const long = buildLibraryEntries({
      sessions: [
        sampleSession({ duration: 3600, foregroundSeconds: 1200, intervals: [[0, 1200]] }),
      ],
      decisions: [],
    })[0];
    expect(long.score).toBeGreaterThan(short.score);
    expect(long.reasons.join(" ")).toContain("1200 秒");
  });
});
