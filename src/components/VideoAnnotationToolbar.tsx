import { useCallback, useState } from "react";
import { ArrowRight, Square, Type, Trash2 } from "lucide-react";
import type { VideoAnnotation } from "@/types/videoAnnotations";
import type { ArrowAnnotation, RectangleAnnotation, TextAnnotation } from "@/types/annotations";

interface VideoAnnotationToolbarProps {
  annotations: VideoAnnotation[];
  currentTimeMs: number;
  durationMs: number;
  onChange: (annotations: VideoAnnotation[]) => void;
}

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10);
}

function formatMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const DEFAULT_COLOR = { hex: "#FF3B30", opacity: 100 };
const DEFAULT_BORDER = { width: 3, color: DEFAULT_COLOR };
const DEFAULT_ALIGN = { horizontal: "left" as const, vertical: "top" as const };

/** Offset new annotations of the same type so they don't stack at (100,100) */
function stackOffset(annotations: VideoAnnotation[], type: string): number {
  return annotations.filter((a) => a.annotation.type === type).length * 20;
}

export function VideoAnnotationToolbar({
  annotations,
  currentTimeMs,
  onChange,
}: VideoAnnotationToolbarProps) {
  const [visibleDurationMs, setVisibleDurationMs] = useState(3000);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const addText = useCallback(() => {
    const off = stackOffset(annotations, "text");
    const text: TextAnnotation = {
      id: uid(),
      type: "text",
      x: 100 + off,
      y: 100 + off,
      text: "Label",
      fontSize: 24,
      fontFamily: "sans-serif",
      width: 200,
      height: 40,
      fill: DEFAULT_COLOR,
      border: DEFAULT_BORDER,
      alignment: DEFAULT_ALIGN,
    };
    const va: VideoAnnotation = {
      id: uid(),
      annotation: text,
      startMs: currentTimeMs,
      endMs: currentTimeMs + visibleDurationMs,
      zIndex: annotations.length,
    };
    onChange([...annotations, va]);
  }, [annotations, currentTimeMs, visibleDurationMs, onChange]);

  const addArrow = useCallback(() => {
    const off = stackOffset(annotations, "arrow");
    const arrow: ArrowAnnotation = {
      id: uid(),
      type: "arrow",
      x: 150 + off,
      y: 150 + off,
      endX: 250 + off,
      endY: 200 + off,
      lineType: "straight",
      arrowType: "thick",
      fill: DEFAULT_COLOR,
      border: { ...DEFAULT_BORDER, width: 4 },
      alignment: DEFAULT_ALIGN,
    };
    const va: VideoAnnotation = {
      id: uid(),
      annotation: arrow,
      startMs: currentTimeMs,
      endMs: currentTimeMs + visibleDurationMs,
      zIndex: annotations.length,
    };
    onChange([...annotations, va]);
  }, [annotations, currentTimeMs, visibleDurationMs, onChange]);

  const addRect = useCallback(() => {
    const off = stackOffset(annotations, "rectangle");
    const rect: RectangleAnnotation = {
      id: uid(),
      type: "rectangle",
      x: 150 + off,
      y: 150 + off,
      width: 200,
      height: 120,
      fill: { hex: "#FF3B30", opacity: 0 },
      border: { width: 3, color: DEFAULT_COLOR },
      alignment: DEFAULT_ALIGN,
    };
    const va: VideoAnnotation = {
      id: uid(),
      annotation: rect,
      startMs: currentTimeMs,
      endMs: currentTimeMs + visibleDurationMs,
      zIndex: annotations.length,
    };
    onChange([...annotations, va]);
  }, [annotations, currentTimeMs, visibleDurationMs, onChange]);

  const handleRemove = useCallback(
    (id: string) => {
      onChange(annotations.filter((va) => va.id !== id));
    },
    [annotations, onChange]
  );

  const handleStartEdit = useCallback((va: VideoAnnotation) => {
    if (va.annotation.type !== "text") return;
    setEditingId(va.id);
    setEditText((va.annotation as TextAnnotation).text);
  }, []);

  const handleCommitEdit = useCallback(
    (id: string) => {
      onChange(
        annotations.map((va) => {
          if (va.id !== id || va.annotation.type !== "text") return va;
          return {
            ...va,
            annotation: { ...(va.annotation as TextAnnotation), text: editText },
          };
        })
      );
      setEditingId(null);
    },
    [annotations, editText, onChange]
  );

  return (
    <div className="space-y-3">
      {/* Header + add buttons */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Annotations
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show for</span>
          <select
            value={visibleDurationMs}
            onChange={(e) => setVisibleDurationMs(Number(e.target.value))}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-foreground focus:outline-none"
          >
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
            <option value={3000}>3s</option>
            <option value={5000}>5s</option>
            <option value={0}>until end</option>
          </select>
        </div>
      </div>

      {/* Tool buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={addText}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition-colors"
          title="Add text at current time"
        >
          <Type className="size-3" /> Text
        </button>
        <button
          onClick={addArrow}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition-colors"
          title="Add arrow at current time"
        >
          <ArrowRight className="size-3" /> Arrow
        </button>
        <button
          onClick={addRect}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition-colors"
          title="Add rectangle at current time"
        >
          <Square className="size-3" /> Box
        </button>
        <span className="text-xs text-muted-foreground ml-1">@ {formatMs(currentTimeMs)}</span>
      </div>

      {/* Annotation list */}
      {annotations.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          No annotations. Use the buttons above to add annotations at the current time.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
          {[...annotations]
            .sort((a, b) => a.startMs - b.startMs)
            .map((va) => (
              <div
                key={va.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs"
              >
                <span className="capitalize text-muted-foreground w-12 shrink-0">
                  {va.annotation.type}
                </span>

                {/* Inline text edit for text annotations */}
                {editingId === va.id ? (
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => handleCommitEdit(va.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCommitEdit(va.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none"
                  />
                ) : (
                  <span
                    className={`flex-1 text-muted-foreground tabular-nums ${va.annotation.type === "text" ? "cursor-text hover:text-foreground" : ""}`}
                    onClick={() => handleStartEdit(va)}
                    title={va.annotation.type === "text" ? "Click to edit text" : undefined}
                  >
                    {va.annotation.type === "text"
                      ? `"${(va.annotation as TextAnnotation).text}" — `
                      : ""}
                    {formatMs(va.startMs)} → {va.endMs !== null ? formatMs(va.endMs) : "end"}
                  </span>
                )}

                <button
                  onClick={() => handleRemove(va.id)}
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
