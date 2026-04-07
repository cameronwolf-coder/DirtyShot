import { emitTo } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

export interface RecordRegion {
  /** Left edge in logical (CSS) pixels */
  x: number;
  /** Top edge in logical (CSS) pixels */
  y: number;
  /** Width in logical (CSS) pixels */
  width: number;
  /** Height in logical (CSS) pixels */
  height: number;
  /** Device pixel ratio of the monitor this region was drawn on */
  scaleFactor: number;
}

export type RecorderState = "idle" | "recording" | "paused";

export interface UseScreenRecorderOptions {
  onStop: (blob: Blob, durationMs: number, region?: RecordRegion) => void;
  onError: (message: string) => void;
}

const MIME_PRIORITY = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function pickMimeType(): string {
  return MIME_PRIORITY.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

export function useScreenRecorder({ onStop, onError }: UseScreenRecorderOptions) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("video/webm");

  // Elapsed time tracking
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);

  const regionRef = useRef<RecordRegion | undefined>(undefined);

  // Stable callbacks via refs to avoid stale closure issues in onstop handler
  const onStopRef = useRef(onStop);
  const onErrorRef = useRef(onError);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    startTimeRef.current = performance.now();
    timerRef.current = setInterval(() => {
      const ms = elapsedBeforePauseRef.current + (performance.now() - startTimeRef.current);
      setElapsedMs(ms);
      emitTo("recording-controls", "recording-timer-update", {
        elapsedMs: ms,
        state: "recording",
      }).catch(() => {});
    }, 250);
  }, [stopTimer]);

  const start = useCallback(async (region?: RecordRegion) => {
    try {
      regionRef.current = region;
      chunksRef.current = [];
      elapsedBeforePauseRef.current = 0;
      setElapsedMs(0);

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30 },
          displaySurface: "monitor",
        } as MediaTrackConstraints,
        audio: false,
      });

      streamRef.current = displayStream;
      mimeTypeRef.current = pickMimeType();

      // Try to capture microphone audio and mix with display stream
      let combinedStream = displayStream;
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        micStreamRef.current = micStream;

        // Mix mic audio into the display stream via AudioContext
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const micSource = audioCtx.createMediaStreamSource(micStream);
        const dest = audioCtx.createMediaStreamDestination();
        micSource.connect(dest);

        combinedStream = new MediaStream([
          ...displayStream.getVideoTracks(),
          ...dest.stream.getAudioTracks(),
        ]);
      } catch {
        // Mic not available or permission denied — record without audio
      }

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: mimeTypeRef.current,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopTimer();
        const finalMs = elapsedBeforePauseRef.current;

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        audioCtxRef.current?.close();
        audioCtxRef.current = null;

        const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        chunksRef.current = [];

        try {
          const { default: fixWebmDuration } = await import("fix-webm-duration");
          const fixedBlob = await fixWebmDuration(rawBlob, finalMs);
          onStopRef.current(fixedBlob, finalMs, regionRef.current);
        } catch {
          onStopRef.current(rawBlob, finalMs, regionRef.current);
        }

        setState("idle");
        setElapsedMs(0);
        elapsedBeforePauseRef.current = 0;
      };

      // Handle user dismissing the OS share picker mid-recording
      displayStream.getVideoTracks()[0].onended = () => {
        const rec = mediaRecorderRef.current;
        if (rec && rec.state !== "inactive") rec.stop();
      };

      recorder.start(1000); // collect chunks every 1 s
      setState("recording");
      startTimer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onErrorRef.current(msg);
    }
  }, [startTimer, stopTimer]);

  const stop = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") return;

    // Snapshot elapsed time before stopping
    if (rec.state === "recording") {
      elapsedBeforePauseRef.current += performance.now() - startTimeRef.current;
    }

    stopTimer();
    rec.stop();
    emitTo("recording-controls", "hide-recording-controls").catch(() => {});
    setState("idle");
  }, [stopTimer]);

  const pause = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "recording") return;

    elapsedBeforePauseRef.current += performance.now() - startTimeRef.current;
    rec.pause();
    stopTimer();
    setState("paused");

    emitTo("recording-controls", "recording-timer-update", {
      elapsedMs: elapsedBeforePauseRef.current,
      state: "paused",
    }).catch(() => {});
  }, [stopTimer]);

  const resume = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state !== "paused") return;

    rec.resume();
    setState("recording");
    startTimer();
  }, [startTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, [stopTimer]);

  return { start, stop, pause, resume, state, elapsedMs };
}
