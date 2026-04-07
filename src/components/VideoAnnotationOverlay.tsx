import { useEffect, useRef } from "react";
import { Rnd } from "react-rnd";
import { drawAnnotationOnCanvas } from "@/lib/annotation-utils";
import { getActiveAnnotations, type VideoAnnotation } from "@/types/videoAnnotations";
import type { Annotation, ArrowAnnotation, LineAnnotation } from "@/types/annotations";

interface VideoAnnotationOverlayProps {
  annotations: VideoAnnotation[];
  currentTimeMs: number;
  width: number;
  height: number;
  onUpdate?: (id: string, dx: number, dy: number) => void;
  className?: string;
}

/** Returns the bounding box used for the drag handle of a given annotation. */
function getBounds(ann: Annotation): { x: number; y: number; w: number; h: number } {
  switch (ann.type) {
    case "circle":
    case "number": {
      const r = ann.type === "circle" ? ann.radius : ann.radius;
      return { x: ann.x - r, y: ann.y - r, w: r * 2, h: r * 2 };
    }
    case "rectangle":
    case "blur":
      return { x: ann.x, y: ann.y, w: ann.width, h: ann.height };
    case "text":
      return { x: ann.x, y: ann.y, w: ann.width, h: ann.height || ann.fontSize + 8 };
    case "arrow":
    case "line": {
      const a = ann as ArrowAnnotation | LineAnnotation;
      const pad = 16;
      const minX = Math.min(a.x, a.endX) - pad;
      const minY = Math.min(a.y, a.endY) - pad;
      const maxX = Math.max(a.x, a.endX) + pad;
      const maxY = Math.max(a.y, a.endY) + pad;
      return { x: minX, y: minY, w: Math.max(maxX - minX, 24), h: Math.max(maxY - minY, 24) };
    }
  }
}

/**
 * Canvas overlay that draws time-pinned annotations, plus transparent Rnd drag handles
 * so annotations can be repositioned by dragging.
 */
export function VideoAnnotationOverlay({
  annotations,
  currentTimeMs,
  width,
  height,
  onUpdate,
  className,
}: VideoAnnotationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const active = getActiveAnnotations(annotations, currentTimeMs);
    for (const va of active) {
      drawAnnotationOnCanvas(ctx, va.annotation);
    }
  }, [annotations, currentTimeMs]);

  const active = getActiveAnnotations(annotations, currentTimeMs);

  return (
    <div className={className} style={{ width, height, position: "absolute", top: 0, left: 0 }}>
      {/* Canvas renders the annotation shapes */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      />
      {/* Transparent Rnd drag handles for each active annotation */}
      {onUpdate &&
        active.map((va) => {
          const bounds = getBounds(va.annotation);
          return (
            <Rnd
              key={va.id}
              bounds="parent"
              position={{ x: bounds.x, y: bounds.y }}
              size={{ width: bounds.w, height: bounds.h }}
              disableDragging={false}
              enableResizing={false}
              onDragStop={(_e, data) => {
                const dx = data.x - bounds.x;
                const dy = data.y - bounds.y;
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                  onUpdate(va.id, dx, dy);
                }
              }}
              style={{
                background: "transparent",
                border: "1px dashed rgba(255,255,255,0.3)",
                borderRadius: 4,
                cursor: "move",
                zIndex: va.zIndex + 1,
              }}
            />
          );
        })}
    </div>
  );
}
