import { describe, expect, it } from "vitest";
import { getPlaybackDelta, type PlaybackSample } from "./playback";

const sample = (changes: Partial<PlaybackSample> = {}): PlaybackSample => ({
  at: 1000,
  position: 10,
  duration: 120,
  rate: 1,
  playing: true,
  seeking: false,
  mode: "foreground",
  ...changes,
});

describe("真实播放采样", () => {
  it("counts played content and real wall time separately at 2x", () => {
    expect(
      getPlaybackDelta(sample({ rate: 2 }), sample({ at: 2000, position: 12, rate: 2 })),
    ).toEqual({ foregroundSeconds: 1, backgroundSeconds: 0, pipSeconds: 0, intervals: [[10, 12]] });
  });
  it("does not count paused, stalled, seeked or long-gap samples", () => {
    for (const next of [
      sample({ at: 2000 }),
      sample({ at: 2000, position: 90 }),
      sample({ at: 2000, position: 11, seeking: true }),
      sample({ at: 10000, position: 19 }),
    ]) {
      expect(getPlaybackDelta(sample(), next).intervals).toEqual([]);
      expect(getPlaybackDelta(sample(), next).foregroundSeconds).toBe(0);
    }
    expect(
      getPlaybackDelta(sample({ playing: false }), sample({ at: 2000, position: 11 }))
        .foregroundSeconds,
    ).toBe(0);
  });
  it("separates background audio and excludes it from qualified coverage", () => {
    const result = getPlaybackDelta(
      sample({ mode: "background" }),
      sample({ at: 2000, position: 11, mode: "background" }),
    );
    expect(result.backgroundSeconds).toBe(1);
    expect(result.intervals).toEqual([]);
  });
  it("includes PiP and discards visibility/rate transition samples", () => {
    expect(
      getPlaybackDelta(sample({ mode: "pip" }), sample({ at: 2000, position: 11, mode: "pip" }))
        .pipSeconds,
    ).toBe(1);
    expect(
      getPlaybackDelta(sample(), sample({ at: 2000, position: 11, mode: "background" }))
        .foregroundSeconds,
    ).toBe(0);
    expect(
      getPlaybackDelta(sample(), sample({ at: 2000, position: 12, rate: 2 })).foregroundSeconds,
    ).toBe(0);
  });
  it("rejects non-finite values and reverse playback", () => {
    expect(getPlaybackDelta(sample(), sample({ at: NaN, position: 11 })).intervals).toEqual([]);
    expect(getPlaybackDelta(sample(), sample({ at: 2000, position: 9 })).intervals).toEqual([]);
  });
});
