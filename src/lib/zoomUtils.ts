import { ZOOM_SCALE, ZOOM_TRANSITION_MS, ZOOM_HOLD_MS, type ZoomKeyframe } from "@/types/zoom";

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface ZoomTransform {
  scale: number;
  focusX: number;
  focusY: number;
}

/**
 * Computes the zoom transform at a given timestamp by interpolating between
 * the surrounding keyframes with eased transitions.
 */
export function computeZoomTransform(
  timeMs: number,
  keyframes: ZoomKeyframe[]
): ZoomTransform {
  if (keyframes.length === 0) {
    return { scale: 1, focusX: 0.5, focusY: 0.5 };
  }

  const sorted = [...keyframes].sort((a, b) => a.timeMs - b.timeMs);

  let prevKf: ZoomKeyframe | null = null;
  let nextKf: ZoomKeyframe | null = null;

  for (const kf of sorted) {
    if (kf.timeMs <= timeMs) prevKf = kf;
    else if (!nextKf) nextKf = kf;
  }

  // Before first keyframe: ease in starting ZOOM_TRANSITION_MS before the keyframe
  if (!prevKf && nextKf) {
    const rawT = 1 - (nextKf.timeMs - timeMs) / ZOOM_TRANSITION_MS;
    const t = easeInOutCubic(Math.max(0, Math.min(1, rawT)));
    return {
      scale: lerp(1, ZOOM_SCALE[nextKf.level], t),
      focusX: lerp(0.5, nextKf.focusX, t),
      focusY: lerp(0.5, nextKf.focusY, t),
    };
  }

  // After last keyframe: hold at zoom level for ZOOM_HOLD_MS, then ease out over ZOOM_TRANSITION_MS
  if (prevKf && !nextKf) {
    const elapsed = timeMs - prevKf.timeMs;
    if (elapsed <= ZOOM_HOLD_MS) {
      // Holding at full zoom
      return {
        scale: ZOOM_SCALE[prevKf.level],
        focusX: prevKf.focusX,
        focusY: prevKf.focusY,
      };
    }
    const easeOutElapsed = elapsed - ZOOM_HOLD_MS;
    const rawT = 1 - easeOutElapsed / ZOOM_TRANSITION_MS;
    const t = easeInOutCubic(Math.max(0, Math.min(1, rawT)));
    return {
      scale: lerp(1, ZOOM_SCALE[prevKf.level], t),
      focusX: lerp(0.5, prevKf.focusX, t),
      focusY: lerp(0.5, prevKf.focusY, t),
    };
  }

  // Between two keyframes
  if (prevKf && nextKf) {
    const duration = nextKf.timeMs - prevKf.timeMs;
    const elapsed = timeMs - prevKf.timeMs;
    const rawT = duration > 0 ? elapsed / duration : 1;
    const t = easeInOutCubic(Math.max(0, Math.min(1, rawT)));
    return {
      scale: lerp(ZOOM_SCALE[prevKf.level], ZOOM_SCALE[nextKf.level], t),
      focusX: lerp(prevKf.focusX, nextKf.focusX, t),
      focusY: lerp(prevKf.focusY, nextKf.focusY, t),
    };
  }

  return { scale: 1, focusX: 0.5, focusY: 0.5 };
}

/**
 * Applies a zoom transform to an OffscreenCanvas context.
 * Draws `source` (VideoSample.draw or drawImage) centered on focusX/Y with the given scale.
 */
export function applyZoomToCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  drawFn: (ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void,
  sourceWidth: number,
  sourceHeight: number,
  transform: ZoomTransform
): void {
  const { scale, focusX, focusY } = transform;
  const outW = ctx.canvas.width;
  const outH = ctx.canvas.height;

  ctx.clearRect(0, 0, outW, outH);
  ctx.save();
  // Translate so that the focus point lands at the center of the output
  ctx.translate(outW / 2, outH / 2);
  ctx.scale(scale, scale);
  ctx.translate(-focusX * sourceWidth, -focusY * sourceHeight);
  drawFn(ctx, 0, 0, sourceWidth, sourceHeight);
  ctx.restore();
}
