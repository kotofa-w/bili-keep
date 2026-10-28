export type PlaybackMode = "foreground" | "background" | "pip";
export interface PlaybackSample {
  at: number;
  position: number;
  duration: number;
  rate: number;
  playing: boolean;
  seeking: boolean;
  mode: PlaybackMode;
}

export function getPlaybackDelta(previous: PlaybackSample, current: PlaybackSample) {
  const result = {
    foregroundSeconds: 0,
    backgroundSeconds: 0,
    pipSeconds: 0,
    intervals: [] as [number, number][],
  };
  const elapsed = (current.at - previous.at) / 1000;
  const advance = current.position - previous.position;
  if (
    ![elapsed, advance, previous.rate, previous.position, current.position, current.duration].every(
      Number.isFinite,
    ) ||
    elapsed <= 0 ||
    elapsed > 3 ||
    advance <= 0 ||
    !previous.playing ||
    previous.seeking ||
    current.seeking ||
    previous.rate <= 0 ||
    previous.rate > 16 ||
    current.rate !== previous.rate ||
    current.mode !== previous.mode ||
    previous.position < 0 ||
    current.position > current.duration + 0.1 ||
    advance > elapsed * previous.rate + 0.75
  )
    return result;

  const seconds = Math.min(elapsed, advance / previous.rate);
  if (current.mode === "foreground") result.foregroundSeconds = seconds;
  else if (current.mode === "pip") result.pipSeconds = seconds;
  else result.backgroundSeconds = seconds;
  if (current.mode !== "background")
    result.intervals.push([previous.position, Math.min(current.position, current.duration)]);
  return result;
}
