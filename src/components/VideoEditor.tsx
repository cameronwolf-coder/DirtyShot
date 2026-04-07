import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { computeZoomTransform } from "@/lib/zoomUtils";
import * as Slider from "@radix-ui/react-slider";
import { useExportPipeline } from "@/hooks/useExportPipeline";
import { ZoomTimeline } from "@/components/ZoomTimeline";
import { VideoAnnotationToolbar } from "@/components/VideoAnnotationToolbar";
import { VideoAnnotationOverlay } from "@/components/VideoAnnotationOverlay";
import type { RecordRegion } from "@/hooks/useScreenRecorder";
import type { ZoomKeyframe } from "@/types/zoom";
import type { VideoAnnotation } from "@/types/videoAnnotations";

export interface VideoEditorProps {
  blob: Blob;
  durationMs: number;
  region?: RecordRegion;
  saveDir: string;
  copyToClipboard: boolean;
  onSave: (savedPath: string) => void;
  onCancel: () => void;
}

function formatMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function VideoEditor({
  blob,
  durationMs,
  region,
  saveDir,
  copyToClipboard,
  onSave,
  onCancel,
}: VideoEditorProps) {
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(durationMs);
  const [isTrimmed, setIsTrimmed] = useState(false);
  const [zoomKeyframes, setZoomKeyframes] = useState<ZoomKeyframe[]>([]);
  const [videoAnnotations, setVideoAnnotations] = useState<VideoAnnotation[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [videoDisplaySize, setVideoDisplaySize] = useState({ w: 0, h: 0 });
  const [filename, setFilename] = useState(`recording_${Date.now()}`);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string>("");
  const zoomCanvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRafRef = useRef<number>(0);

  const { exportMp4, progress, isExporting, cancel } = useExportPipeline();

  // Create object URL once
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    videoUrlRef.current = url;
    if (videoRef.current) videoRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // Keep trimEnd in sync if durationMs changes
  useEffect(() => {
    setTrimEndMs(durationMs);
  }, [durationMs]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoDisplaySize({ w: video.clientWidth, h: video.clientHeight });
  }, []);

  const handleLoadedData = useCallback(() => {
    setVideoReady(true);
    // Re-capture display size after video is rendered at final dimensions
    const video = videoRef.current;
    if (!video) return;
    setVideoDisplaySize({ w: video.clientWidth, h: video.clientHeight });
  }, []);

  // Zoom canvas preview — renders video frames with zoom transform applied
  useEffect(() => {
    if (!videoReady || zoomKeyframes.length === 0) return;

    const canvas = zoomCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const timeMs = video.currentTime * 1000;
      const transform = computeZoomTransform(timeMs, zoomKeyframes);
      const { scale, focusX, focusY } = transform;

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(scale, scale);
      ctx.translate(-focusX * w, -focusY * h);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();

      zoomRafRef.current = requestAnimationFrame(draw);
    };

    zoomRafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(zoomRafRef.current);
  }, [videoReady, zoomKeyframes]);

  const handleTrimChange = useCallback(([start, end]: number[]) => {
    const s = Math.min(start, end - 500);
    const e = Math.max(end, start + 500);
    setTrimStartMs(s);
    setTrimEndMs(e);
    setIsTrimmed(true);
    if (videoRef.current) videoRef.current.currentTime = s / 1000;
  }, []);

  const handleSave = useCallback(async () => {
    const sanitized = filename.replace(/[/\\.]+/g, "_").trim() || `recording_${Date.now()}`;
    const fullFilename = sanitized.endsWith(".mp4") ? sanitized : `${sanitized}.mp4`;

    try {
      const savedPath = await exportMp4({
        blob,
        saveDir,
        filename: fullFilename,
        trimStartMs: isTrimmed ? trimStartMs : undefined,
        trimEndMs: isTrimmed ? trimEndMs : undefined,
        region,
        zoomKeyframes: zoomKeyframes.length > 0 ? zoomKeyframes : undefined,
        annotations: videoAnnotations.length > 0 ? videoAnnotations : undefined,
        videoDisplaySize: videoDisplaySize.w > 0 ? videoDisplaySize : undefined,
      });

      if (copyToClipboard) {
        await invoke("copy_image_file_to_clipboard", { path: savedPath }).catch(() => {});
      }

      onSave(savedPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Failed to save recording", { description: msg, duration: 5000 });
    }
  }, [blob, saveDir, filename, region, isTrimmed, trimStartMs, trimEndMs, zoomKeyframes, videoAnnotations, videoDisplaySize, copyToClipboard, exportMp4, onSave]);

  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Recording Preview</h2>
          <span className="text-sm text-muted-foreground">{formatMs(durationMs)}</span>
          {region && (
            <span className="text-xs text-muted-foreground border border-border rounded px-2 py-0.5">
              {Math.round(region.width)}×{Math.round(region.height)}
            </span>
          )}
        </div>
      </div>

      {/* Video preview */}
      <div className="flex-1 flex items-center justify-center p-6 bg-zinc-950">
        <div className="relative">
          {!videoReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 rounded-xl z-10">
              <svg className="animate-spin size-8 text-zinc-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}
          <video
            ref={videoRef}
            controls
            className="max-w-full max-h-[65vh] rounded-xl shadow-2xl"
            onLoadedMetadata={handleLoadedMetadata}
            onLoadedData={handleLoadedData}
            onTimeUpdate={(e) =>
              setCurrentTimeMs((e.target as HTMLVideoElement).currentTime * 1000)
            }
          />
          {/* Zoom preview canvas — sits on top of video, shows zoom-transformed output */}
          {videoReady && zoomKeyframes.length > 0 && videoDisplaySize.w > 0 && (
            <canvas
              ref={zoomCanvasRef}
              width={videoDisplaySize.w}
              height={videoDisplaySize.h}
              className="absolute inset-0 rounded-xl pointer-events-none"
            />
          )}
          {videoReady && videoDisplaySize.w > 0 && (
            <VideoAnnotationOverlay
              annotations={videoAnnotations}
              currentTimeMs={currentTimeMs}
              width={videoDisplaySize.w}
              height={videoDisplaySize.h}
              onUpdate={(id, dx, dy) =>
                setVideoAnnotations((prev) =>
                  prev.map((va) => {
                    if (va.id !== id) return va;
                    const ann = va.annotation;
                    const base = { x: ann.x + dx, y: ann.y + dy };
                    if (ann.type === "arrow" || ann.type === "line") {
                      return {
                        ...va,
                        annotation: {
                          ...ann,
                          ...base,
                          endX: ann.endX + dx,
                          endY: ann.endY + dy,
                        },
                      };
                    }
                    return { ...va, annotation: { ...ann, ...base } };
                  })
                )
              }
              className="absolute inset-0 rounded-xl"
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="px-6 py-4 border-t border-border bg-card/50 space-y-3">
        {/* Trim */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>Trim</span>
          <span className="tabular-nums">{formatMs(trimStartMs)} — {formatMs(trimEndMs)}</span>
        </div>

        <Slider.Root
          min={0}
          max={durationMs}
          step={100}
          minStepsBetweenThumbs={5}
          value={[trimStartMs, trimEndMs]}
          onValueChange={handleTrimChange}
          className="relative flex items-center w-full h-5 select-none touch-none"
        >
          <Slider.Track className="relative flex-1 h-1.5 rounded-full bg-zinc-700">
            <Slider.Range className="absolute h-full rounded-full bg-primary" />
          </Slider.Track>
          <Slider.Thumb
            aria-label="Trim start"
            className="block size-4 rounded-full bg-white border-2 border-primary shadow-md hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background transition-transform cursor-grab active:cursor-grabbing"
          />
          <Slider.Thumb
            aria-label="Trim end"
            className="block size-4 rounded-full bg-white border-2 border-primary shadow-md hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background transition-transform cursor-grab active:cursor-grabbing"
          /></Slider.Root>

        {/* Zoom keyframes */}
        <div className="pt-2 border-t border-border">
          <ZoomTimeline
            keyframes={zoomKeyframes}
            currentTimeMs={currentTimeMs}
            durationMs={durationMs}
            onChange={setZoomKeyframes}
            videoRef={videoRef}
          />
        </div>

        {/* Annotations */}
        <div className="pt-2 border-t border-border">
          <VideoAnnotationToolbar
            annotations={videoAnnotations}
            currentTimeMs={currentTimeMs}
            durationMs={durationMs}
            onChange={setVideoAnnotations}
          />
        </div>

        {/* Export progress */}
        {isExporting && (
          <div className="space-y-1">
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Exporting… {Math.round(progress * 100)}%
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-card">
        <button
          onClick={onCancel}
          disabled={isExporting}
          className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          Discard
        </button>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            disabled={isExporting}
            placeholder="recording"
            className="text-sm bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48 disabled:opacity-40"
          />
          <span className="text-xs text-muted-foreground">.mp4</span>
          {isExporting && (
            <button
              onClick={cancel}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isExporting}
            className="px-6 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isExporting ? "Exporting…" : "Save as MP4"}
          </button>
        </div>
      </div>
    </div>
  );
}
