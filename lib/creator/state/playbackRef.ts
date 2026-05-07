/**
 * Module-level playback frame ref — shared between DotLottiePlayback and Timeline.
 *
 * During ThorVG playback, the current frame is written here at 60fps WITHOUT touching
 * Zustand. Timeline scrubber reads this ref via requestAnimationFrame and updates the
 * needle DOM directly, giving smooth motion with zero React re-renders.
 *
 * Zustand currentTime is only synced at ~8fps during playback (for Inspector/keyframe
 * track updates) and once immediately on pause.
 */
export const playbackRef = {
  /** Current playback frame, updated at 60fps during ThorVG play */
  frame: 0,
  /** True while ThorVG is actively playing */
  active: false,
};
