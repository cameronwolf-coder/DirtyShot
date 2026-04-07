export interface ZoomKeyframe {
  id: string;
  timeMs: number;
  /** 1 = no zoom, 6 = maximum zoom */
  level: number;
  /** Normalized horizontal focus point (0 = left, 1 = right) */
  focusX: number;
  /** Normalized vertical focus point (0 = top, 1 = bottom) */
  focusY: number;
}

/** Scale factors for each zoom level */
export const ZOOM_SCALE: Record<number, number> = {
  1: 1.0,
  2: 1.3,
  3: 1.6,
  4: 2.0,
  5: 2.5,
  6: 3.0,
};

export const ZOOM_LEVEL_LABELS: Record<number, string> = {
  1: "1× (none)",
  2: "1.3×",
  3: "1.6×",
  4: "2×",
  5: "2.5×",
  6: "3×",
};

/** Duration of the ease-in and ease-out transition around each keyframe, in ms */
export const ZOOM_TRANSITION_MS = 500;

/** How long to hold at the zoom level after a keyframe before easing out, in ms */
export const ZOOM_HOLD_MS = 2000;
