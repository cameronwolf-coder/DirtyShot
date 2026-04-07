import {
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WEBM,
  type VideoSample,
} from "mediabunny";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useCallback, useRef, useState } from "react";
import { computeZoomTransform, applyZoomToCanvas } from "@/lib/zoomUtils";
import { drawAnnotationOnCanvas } from "@/lib/annotation-utils";
import { getActiveAnnotations } from "@/types/videoAnnotations";
import type { RecordRegion } from "./useScreenRecorder";
import type { ZoomKeyframe } from "@/types/zoom";
import type { VideoAnnotation } from "@/types/videoAnnotations";

export interface ExportOptions {
  blob: Blob;
  saveDir: string;
  filename?: string;
  trimStartMs?: number;
  trimEndMs?: number;
  region?: RecordRegion;
  zoomKeyframes?: ZoomKeyframe[];
  annotations?: VideoAnnotation[];
  /** CSS pixel dimensions of the video preview element — used to scale annotation coords to intrinsic resolution */
  videoDisplaySize?: { w: number; h: number };
}

export interface UseExportPipelineReturn {
  exportMp4: (opts: ExportOptions) => Promise<string>;
  progress: number;
  isExporting: boolean;
  cancel: () => void;
}

export function useExportPipeline(): UseExportPipelineReturn {
  const [progress, setProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const conversionRef = useRef<Conversion | null>(null);

  const cancel = useCallback(() => {
    conversionRef.current?.cancel();
  }, []);

  const exportMp4 = useCallback(async (opts: ExportOptions): Promise<string> => {
    const {
      blob,
      saveDir,
      filename = `recording_${Date.now()}.mp4`,
      trimStartMs,
      trimEndMs,
      region,
      zoomKeyframes,
      annotations,
      videoDisplaySize,
    } = opts;

    setIsExporting(true);
    setProgress(0);

    if (blob.size === 0) {
      setIsExporting(false);
      throw new Error("Recording produced no data — try recording for longer than 1 second.");
    }

    try {
      const input = new Input({ source: new BlobSource(blob), formats: [WEBM] });
      const bufferTarget = new BufferTarget();
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: bufferTarget,
      });

      const trim =
        trimStartMs !== undefined || trimEndMs !== undefined
          ? {
              start: trimStartMs !== undefined ? trimStartMs / 1000 : undefined,
              end: trimEndMs !== undefined ? trimEndMs / 1000 : undefined,
            }
          : undefined;

      const hasZoom = zoomKeyframes && zoomKeyframes.length > 0;
      const hasAnnotations = annotations && annotations.length > 0;
      const needsProcess = hasZoom || hasAnnotations;

      const videoOptions = {
        ...(region
          ? {
              crop: {
                // region coords are logical (CSS) pixels — multiply by scaleFactor for physical pixels
                left: Math.round(region.x * (region.scaleFactor ?? 1)),
                top: Math.round(region.y * (region.scaleFactor ?? 1)),
                width: Math.round(region.width * (region.scaleFactor ?? 1)),
                height: Math.round(region.height * (region.scaleFactor ?? 1)),
              },
            }
          : {}),
        ...(needsProcess
          ? {
              process: (sample: VideoSample): CanvasImageSource => {
                const timeMs = sample.timestamp * 1000;
                const canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
                const ctx = canvas.getContext("2d")!;

                if (hasZoom) {
                  const transform = computeZoomTransform(timeMs, zoomKeyframes!);
                  applyZoomToCanvas(
                    ctx,
                    (c, x, y, w, h) => sample.draw(c, x, y, w, h),
                    sample.displayWidth,
                    sample.displayHeight,
                    transform
                  );
                } else {
                  sample.draw(ctx, 0, 0, sample.displayWidth, sample.displayHeight);
                }

                // Draw annotations on top, scaling from CSS preview coords to intrinsic resolution
                if (hasAnnotations) {
                  const active = getActiveAnnotations(annotations!, timeMs);
                  const scaleX = videoDisplaySize ? sample.displayWidth / videoDisplaySize.w : 1;
                  const scaleY = videoDisplaySize ? sample.displayHeight / videoDisplaySize.h : 1;
                  if (scaleX !== 1 || scaleY !== 1) {
                    ctx.save();
                    ctx.scale(scaleX, scaleY);
                  }
                  for (const va of active) {
                    drawAnnotationOnCanvas(ctx as unknown as CanvasRenderingContext2D, va.annotation);
                  }
                  if (scaleX !== 1 || scaleY !== 1) {
                    ctx.restore();
                  }
                }

                return canvas;
              },
            }
          : {}),
      };

      const conversion = await Conversion.init({
        input,
        output,
        trim,
        video: videoOptions,
        audio: {},
        showWarnings: false,
      });

      conversionRef.current = conversion;
      conversion.onProgress = (p) => setProgress(p);

      if (!conversion.isValid) {
        throw new Error("Conversion setup is invalid — check input format");
      }

      await conversion.execute();
      conversionRef.current = null;

      const mp4Buffer = bufferTarget.buffer;
      if (!mp4Buffer) throw new Error("Export produced no output");

      const fullPath = `${saveDir}/${filename}`;
      await writeFile(fullPath, new Uint8Array(mp4Buffer));

      setProgress(1);
      return fullPath;
    } finally {
      setIsExporting(false);
      conversionRef.current = null;
    }
  }, []);

  return { exportMp4, progress, isExporting, cancel };
}
