import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Pause, Play, Save, Scissors, Film } from "lucide-react";
import { toast } from "sonner";

interface VideoTrimmerProps {
  videoPath: string;
  saveDir: string;
  copyToClipboard: boolean;
  onSave: (savedPath: string) => void;
  onCancel: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms}`;
}

export function VideoTrimmer({
  videoPath,
  saveDir,
  copyToClipboard,
  onSave,
  onCancel,
}: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isTrimming, setIsTrimming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasFfmpeg, setHasFfmpeg] = useState(true);

  const videoSrc = convertFileSrc(videoPath);

  // Check ffmpeg availability on mount
  useEffect(() => {
    invoke<boolean>("check_ffmpeg").then(setHasFfmpeg).catch(() => setHasFfmpeg(false));
  }, []);

  // Get duration from ffprobe for accuracy (HTML5 video duration can be imprecise for .mov)
  useEffect(() => {
    invoke<number>("get_video_duration", { path: videoPath })
      .then((d) => {
        setDuration(d);
        setTrimEnd(d);
      })
      .catch(() => {
        // Fallback to HTML5 video duration
      });
  }, [videoPath]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video && duration === 0) {
      setDuration(video.duration);
      setTrimEnd(video.duration);
    }
  }, [duration]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);

    // Stop at trim end during playback
    if (video.currentTime >= trimEnd) {
      video.pause();
      setIsPlaying(false);
    }
  }, [trimEnd]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      // If at or past trim end, restart from trim start
      if (video.currentTime >= trimEnd || video.currentTime < trimStart) {
        video.currentTime = trimStart;
      }
      video.play();
      setIsPlaying(true);
    }
  }, [isPlaying, trimStart, trimEnd]);

  const handlePlaybackScrub = useCallback(
    (value: number[]) => {
      const video = videoRef.current;
      if (!video) return;
      const time = value[0];
      video.currentTime = time;
      setCurrentTime(time);
    },
    []
  );

  const handleTrimStartChange = useCallback(
    (value: number[]) => {
      const newStart = Math.min(value[0], trimEnd - 0.1);
      setTrimStart(newStart);
      const video = videoRef.current;
      if (video) {
        video.currentTime = newStart;
        setCurrentTime(newStart);
      }
    },
    [trimEnd]
  );

  const handleTrimEndChange = useCallback(
    (value: number[]) => {
      const newEnd = Math.max(value[0], trimStart + 0.1);
      setTrimEnd(newEnd);
      const video = videoRef.current;
      if (video) {
        video.currentTime = newEnd;
        setCurrentTime(newEnd);
      }
    },
    [trimStart]
  );

  const handleTrimAndSave = useCallback(async () => {
    if (!hasFfmpeg) {
      toast.error("ffmpeg required", {
        description: "Install with: brew install ffmpeg",
        duration: 5000,
      });
      return;
    }

    setIsTrimming(true);
    try {
      const trimmedPath = await invoke<string>("trim_video", {
        inputPath: videoPath,
        outputDir: saveDir,
        startSecs: trimStart,
        endSecs: trimEnd,
      });

      const savedPath = await invoke<string>("save_recording", {
        recordingPath: trimmedPath,
        saveDir,
        copyToClip: copyToClipboard,
      });

      toast.success("Trimmed video saved", {
        description: savedPath,
        duration: 4000,
      });

      onSave(savedPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Trim failed", { description: msg, duration: 5000 });
    } finally {
      setIsTrimming(false);
    }
  }, [videoPath, saveDir, trimStart, trimEnd, copyToClipboard, hasFfmpeg, onSave]);

  const handleSaveOriginal = useCallback(async () => {
    setIsSaving(true);
    try {
      const savedPath = await invoke<string>("save_recording", {
        recordingPath: videoPath,
        saveDir,
        copyToClip: copyToClipboard,
      });

      toast.success("Recording saved", {
        description: savedPath,
        duration: 4000,
      });

      onSave(savedPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Save failed", { description: msg, duration: 5000 });
    } finally {
      setIsSaving(false);
    }
  }, [videoPath, saveDir, copyToClipboard, onSave]);

  const trimmedDuration = trimEnd - trimStart;
  const hasTrimmed = trimStart > 0.05 || (duration > 0 && trimEnd < duration - 0.05);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-4 pb-2 border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary"
            aria-label="Cancel"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Button>
          <div className="flex items-center gap-2">
            <Film className="size-5 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-xl font-bold text-foreground">Trim Recording</h1>
          </div>
        </div>

        {/* Video Preview */}
        <Card className="bg-card border-border overflow-hidden">
          <CardContent className="p-0">
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full max-h-[50vh] bg-black"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              preload="auto"
            />
          </CardContent>
        </Card>

        {/* Playback Controls */}
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-4">
            {/* Play/Pause + Time */}
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePlayPause}
                className="text-foreground hover:bg-secondary"
              >
                {isPlaying ? (
                  <Pause className="size-5" aria-hidden="true" />
                ) : (
                  <Play className="size-5" aria-hidden="true" />
                )}
              </Button>
              <span className="text-sm font-mono tabular-nums text-foreground min-w-[80px]">
                {formatTime(currentTime)}
              </span>
              <div className="flex-1">
                <Slider
                  value={[currentTime]}
                  min={0}
                  max={duration || 1}
                  step={0.01}
                  onValueChange={handlePlaybackScrub}
                />
              </div>
              <span className="text-sm font-mono tabular-nums text-muted-foreground min-w-[80px] text-right">
                {formatTime(duration)}
              </span>
            </div>

            {/* Trim Controls */}
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Scissors className="size-4" aria-hidden="true" />
                  Trim Range
                </span>
                <span className="text-xs text-muted-foreground font-mono tabular-nums">
                  {formatTime(trimStart)} — {formatTime(trimEnd)} ({formatTime(trimmedDuration)})
                </span>
              </div>

              {/* Trim Start */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-10">Start</span>
                <div className="flex-1">
                  <Slider
                    value={[trimStart]}
                    min={0}
                    max={duration || 1}
                    step={0.01}
                    onValueChange={handleTrimStartChange}
                    className="[&::-webkit-slider-thumb]:bg-green-400"
                  />
                </div>
                <span className="text-xs font-mono tabular-nums text-muted-foreground min-w-[60px] text-right">
                  {formatTime(trimStart)}
                </span>
              </div>

              {/* Trim End */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-10">End</span>
                <div className="flex-1">
                  <Slider
                    value={[trimEnd]}
                    min={0}
                    max={duration || 1}
                    step={0.01}
                    onValueChange={handleTrimEndChange}
                    className="[&::-webkit-slider-thumb]:bg-red-400"
                  />
                </div>
                <span className="text-xs font-mono tabular-nums text-muted-foreground min-w-[60px] text-right">
                  {formatTime(trimEnd)}
                </span>
              </div>

              {!hasFfmpeg && (
                <div className="p-3 bg-yellow-950/30 border border-yellow-800/50 rounded-lg">
                  <p className="text-yellow-400 text-xs">
                    ffmpeg not found. Install it for trimming: <code className="bg-yellow-900/50 px-1 rounded">brew install ffmpeg</code>
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button
            variant="cta"
            size="lg"
            className="flex-1"
            onClick={handleTrimAndSave}
            disabled={isTrimming || isSaving || !hasFfmpeg || !hasTrimmed}
          >
            <Scissors className="size-4" aria-hidden="true" />
            {isTrimming ? "Trimming..." : "Trim & Save"}
          </Button>
          <Button
            variant="cta"
            size="lg"
            className="flex-1"
            onClick={handleSaveOriginal}
            disabled={isTrimming || isSaving}
          >
            <Save className="size-4" aria-hidden="true" />
            {isSaving ? "Saving..." : "Save Original"}
          </Button>
        </div>
      </div>
    </main>
  );
}
