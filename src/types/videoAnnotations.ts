import type { Annotation } from "@/types/annotations";

export interface VideoAnnotation {
  id: string;
  annotation: Annotation;
  /** Time in ms when this annotation appears */
  startMs: number;
  /**
   * Time in ms when this annotation disappears.
   * null = visible until end of video.
   */
  endMs: number | null;
  zIndex: number;
}

/** Returns annotations that should be visible at the given timestamp */
export function getActiveAnnotations(
  annotations: VideoAnnotation[],
  timeMs: number
): VideoAnnotation[] {
  return annotations
    .filter(
      (va) =>
        timeMs >= va.startMs &&
        (va.endMs === null || timeMs <= va.endMs)
    )
    .sort((a, b) => a.zIndex - b.zIndex);
}
