import { useCallback, useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pause, Play, Square } from "lucide-react";

type RecState = "recording" | "paused";

function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function RecordingControls() {
  const [recState, setRecState] = useState<RecState>("recording");
  const [elapsedMs, setElapsedMs] = useState(0);
  const unlistenRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    const setup = async () => {
      const unlistenTimer = await listen<{ elapsedMs: number; state: string }>(
        "recording-timer-update",
        ({ payload }) => {
          setElapsedMs(payload.elapsedMs);
          setRecState(payload.state === "paused" ? "paused" : "recording");
        }
      );

      const unlistenHide = await listen("hide-recording-controls", () => {
        getCurrentWindow().hide().catch(() => {});
      });

      unlistenRef.current = [unlistenTimer, unlistenHide];
    };

    setup();

    return () => {
      unlistenRef.current.forEach((fn) => fn());
    };
  }, []);

  const handlePauseResume = useCallback(async () => {
    if (recState === "recording") {
      await emitTo("main", "recording-pause-request").catch(console.error);
    } else {
      await emitTo("main", "recording-resume-request").catch(console.error);
    }
  }, [recState]);

  const handleStop = useCallback(async () => {
    await emitTo("main", "recording-stop-requested").catch(console.error);
  }, []);

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
          {recState === "recording" && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full size-3 ${
              recState === "recording" ? "bg-red-500" : "bg-yellow-500"
            }`}
          />
        </span>

        {/* Timer */}
        <span className="text-white font-mono text-sm tabular-nums min-w-[48px]">
          {formatElapsed(elapsedMs)}
        </span>

        {/* Pause / Resume */}
        <button
          onClick={handlePauseResume}
          className="flex items-center justify-center size-8 rounded-full bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-500 text-white transition-colors"
          title={recState === "recording" ? "Pause" : "Resume"}
        >
          {recState === "recording" ? (
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
