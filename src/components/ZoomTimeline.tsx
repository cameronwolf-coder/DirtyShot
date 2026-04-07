import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ZOOM_LEVEL_LABELS, type ZoomKeyframe } from "@/types/zoom";

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

interface ZoomTimelineProps {
  keyframes: ZoomKeyframe[];
  currentTimeMs: number;
  durationMs: number;
  onChange: (keyframes: ZoomKeyframe[]) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

/** Small canvas thumbnail that lets the user click to set focusX/focusY */
function FocusPicker({
  kf,
  videoRef,
  onFocusChange,
}: {
  kf: ZoomKeyframe;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onFocusChange: (id: string, focusX: number, focusY: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const THUMB_W = 120;
  const THUMB_H = 68;

  // Draw current video frame into the thumbnail canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const video = videoRef?.current;
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    } else {
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, THUMB_W, THUMB_H);
    }

    // Draw reticle at current focus point
    const cx = kf.focusX * THUMB_W;
    const cy = kf.focusY * THUMB_H;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy);
    ctx.lineTo(cx + 11, cy);
    ctx.moveTo(cx, cy - 11);
    ctx.lineTo(cx, cy + 11);
    ctx.stroke();
  }, [kf.focusX, kf.focusY, videoRef]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      onFocusChange(kf.id, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
    },
    [kf.id, onFocusChange]
  );

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_W}
      height={THUMB_H}
      onClick={handleClick}
      title="Click to set zoom focus point"
      className="rounded border border-zinc-700 cursor-crosshair shrink-0"
      style={{ width: THUMB_W, height: THUMB_H }}
    />
  );
}

export function ZoomTimeline({
  keyframes,
  currentTimeMs,
  durationMs,
  onChange,
  videoRef,
}: ZoomTimelineProps) {
  const sorted = [...keyframes].sort((a, b) => a.timeMs - b.timeMs);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleAdd = useCallback(() => {
    const existing = keyframes.find((kf) => Math.abs(kf.timeMs - currentTimeMs) < 200);
    if (existing) return;
    const newKf: ZoomKeyframe = {
      id: uid(),
      timeMs: currentTimeMs,
      level: 3,
      focusX: 0.5,
      focusY: 0.5,
    };
    const updated = [...keyframes, newKf];
    onChange(updated);
    setExpandedId(newKf.id);
  }, [keyframes, currentTimeMs, onChange]);

  const handleRemove = useCallback(
    (id: string) => {
      onChange(keyframes.filter((kf) => kf.id !== id));
      if (expandedId === id) setExpandedId(null);
    },
    [keyframes, onChange, expandedId]
  );

  const handleLevelChange = useCallback(
    (id: string, level: number) => {
      onChange(keyframes.map((kf) => (kf.id === id ? { ...kf, level } : kf)));
    },
    [keyframes, onChange]
  );

  const handleFocusChange = useCallback(
    (id: string, focusX: number, focusY: number) => {
      onChange(keyframes.map((kf) => (kf.id === id ? { ...kf, focusX, focusY } : kf)));
    },
    [keyframes, onChange]
  );

  const scrubberPercent = durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0;
  const hasDuplicate = keyframes.some((kf) => Math.abs(kf.timeMs - currentTimeMs) < 200);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Zoom Keyframes
        </span>
        <button
          onClick={handleAdd}
          disabled={hasDuplicate}
          title={hasDuplicate ? "Keyframe already exists at this time" : undefined}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="size-3" />
          Add at {formatMs(currentTimeMs)}
        </button>
      </div>

      {/* Scrubber bar with keyframe diamonds */}
      <div className="relative h-6 rounded bg-zinc-900 overflow-visible">
        <div className="absolute inset-y-0 left-0 right-0 flex items-center">
          <div className="w-full h-1 bg-zinc-700 rounded-full" />
        </div>
        <div
          className="absolute top-0 bottom-0 w-px bg-white/60 pointer-events-none"
          style={{ left: `${scrubberPercent}%` }}
        />
        {sorted.map((kf) => {
          const pct = durationMs > 0 ? (kf.timeMs / durationMs) * 100 : 0;
          return (
            <div
              key={kf.id}
              onClick={() => setExpandedId(expandedId === kf.id ? null : kf.id)}
              className="absolute top-1/2 -translate-y-1/2 size-3 rotate-45 bg-yellow-400 border border-yellow-600 rounded-sm cursor-pointer hover:bg-yellow-300 transition-colors"
              style={{ left: `calc(${pct}% - 6px)` }}
              title={`Zoom ${kf.level}× at ${formatMs(kf.timeMs)}`}
            />
          );
        })}
      </div>

      {/* Keyframe list */}
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          No zoom keyframes. Click "Add" to zoom in at the current time.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {sorted.map((kf) => (
            <div
              key={kf.id}
              className="rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden"
            >
              {/* Row header */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                onClick={() => setExpandedId(expandedId === kf.id ? null : kf.id)}
              >
                <span className="text-xs font-mono text-muted-foreground w-10 shrink-0">
                  {formatMs(kf.timeMs)}
                </span>
                <select
                  value={kf.level}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleLevelChange(kf.id, Number(e.target.value))}
                  className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-foreground focus:outline-none"
                >
                  {Object.entries(ZOOM_LEVEL_LABELS).map(([lvl, label]) => (
                    <option key={lvl} value={Number(lvl)}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground shrink-0">
                  {Math.round(kf.focusX * 100)}%,{Math.round(kf.focusY * 100)}%
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(kf.id);
                  }}
                  className="text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {/* Expanded: focus picker */}
              {expandedId === kf.id && (
                <div className="px-3 pb-3 flex items-center gap-3">
                  <FocusPicker
                    kf={kf}
                    videoRef={videoRef}
                    onFocusChange={handleFocusChange}
                  />
                  <p className="text-xs text-muted-foreground leading-snug">
                    Click the preview to set the zoom focus point. The reticle shows where the camera will center.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
