import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pause, Play, Square } from "lucide-react";

type RecState = "recording" | "paused";

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function RecordingControls() {
  const [state, setState] = useState<RecState>("recording");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll elapsed time from backend
  useEffect(() => {
    const tick = () => {
      invoke<number>("get_recording_elapsed")
        .then(setElapsed)
        .catch(() => {});
    };
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Listen for hide signal from main window
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("hide-recording-controls", () => {
      getCurrentWindow().hide().catch(() => {});
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handlePauseResume = useCallback(async () => {
    try {
      if (state === "recording") {
        await invoke("pause_video_recording");
        setState("paused");
      } else if (state === "paused") {
        await invoke("resume_video_recording");
        setState("recording");
      }
    } catch (err) {
      console.error("Pause/resume failed:", err);
    }
  }, [state]);

  const handleStop = useCallback(async () => {
    try {
      // Tell the main window to handle the stop + trimmer flow
      await emitTo("main", "recording-stop-requested");
    } catch (err) {
      console.error("Stop emit failed:", err);
    }
  }, []);

  // Make window draggable
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    getCurrentWindow().startDragging().catch(() => {});
  }, []);

  return (
    <div
      className="min-h-dvh flex items-center justify-center bg-transparent"
      onMouseDown={handleMouseDown}
    >
      <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-zinc-900 border border-zinc-700 shadow-2xl select-none cursor-move">
        {/* Recording indicator */}
        <span className="relative flex size-3">
          {state === "recording" && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full size-3 ${
              state === "recording" ? "bg-red-500" : "bg-yellow-500"
            }`}
          />
        </span>

        {/* Timer */}
        <span className="text-white font-mono text-sm tabular-nums min-w-[48px]">
          {formatElapsed(elapsed)}
        </span>

        {/* Pause / Resume */}
        <button
          onClick={handlePauseResume}
          className="flex items-center justify-center size-8 rounded-full bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-500 text-white transition-colors"
          title={state === "recording" ? "Pause" : "Resume"}
        >
          {state === "recording" ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
        </button>

        {/* Stop */}
        <button
          onClick={handleStop}
          className="flex items-center justify-center size-8 rounded-full bg-red-600 hover:bg-red-500 active:bg-red-400 text-white transition-colors"
          title="Stop recording"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      </div>
    </div>
  );
}
