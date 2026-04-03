//! Screen recording — ScreenCaptureKit capture (via scap) + ffmpeg H.264 encoding
//!
//! Flow:
//!   start_recording()  → scap capturer + ffmpeg pipe per segment, optional cpal mic audio
//!   pause_recording()  → signal capture thread, wait for ffmpeg to flush current segment
//!   resume_recording() → start next segment
//!   stop_recording()   → finalise, concat segments, optional audio mux, return MP4 path

use std::io::Write as IoWrite;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Instant;

use scap::{
    capturer::{Area, Capturer, Options, Point, Resolution, Size},
    frame::{Frame, FrameType},
};

use crate::clipboard::copy_file_to_clipboard;
use crate::utils::{generate_filename, AppResult};

// ─── Public types ─────────────────────────────────────────────────────────────

/// Logical-coordinate region for cropped recording.
/// RegionSelector in the frontend produces logical pixels; scap / ScreenCaptureKit also
/// accepts logical (point) coordinates, so no DPI scaling needed here.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RecordRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

// ─── Internal types ───────────────────────────────────────────────────────────

/// cpal::Stream is not Send on macOS (CoreAudio uses raw pointers internally).
/// We only hold the stream to keep it alive and eventually drop it — we never
/// send it across threads after construction, so this is safe.
struct AudioStreamHandle(cpal::Stream);
unsafe impl Send for AudioStreamHandle {}

struct SegmentInfo {
    video_path: String,
    audio_path: Option<String>,
    audio_sample_rate: Option<u32>,
    audio_channels: Option<u16>,
}

struct ActiveRecording {
    stop_flag: Arc<AtomicBool>,
    capture_thread: Option<thread::JoinHandle<()>>,
    /// Dropping this stops the cpal stream and flushes the PCM file.
    audio_stream: Option<AudioStreamHandle>,
    finished_segments: Vec<SegmentInfo>,
    current_segment: SegmentInfo,
    save_dir: String,
    region: Option<RecordRegion>,
    started_at: Instant,
    elapsed_before_pause: f64,
}

// SAFETY: all fields are Send; see AudioStreamHandle above.
unsafe impl Send for ActiveRecording {}

enum RecordingState {
    Idle,
    Recording(Box<ActiveRecording>),
    Paused {
        finished_segments: Vec<SegmentInfo>,
        save_dir: String,
        region: Option<RecordRegion>,
        elapsed_before_pause: f64,
    },
}

// SAFETY: RecordingState only ever lives behind a Mutex on the main thread.
unsafe impl Send for RecordingState {}

static STATE: Mutex<RecordingState> = Mutex::new(RecordingState::Idle);

// ─── Permission / capability checks ──────────────────────────────────────────

pub fn check_recording_support() -> AppResult<()> {
    if !scap::is_supported() {
        return Err(
            "Screen recording requires macOS 12.3 or later (ScreenCaptureKit).".to_string(),
        );
    }

    // NOTE: We intentionally skip scap::has_permission() / scap::request_permission() here.
    // On macOS 15+, CGPreflightScreenCaptureAccess() returns false even when the user has
    // already granted permission, causing a system prompt on every launch. Instead we let
    // Capturer::build() attempt the capture — ScreenCaptureKit will fail with a clear error
    // if permission is truly missing.

    Ok(())
}

// ─── Private helpers ──────────────────────────────────────────────────────────

fn build_capturer_options(fps: u32, region: &Option<RecordRegion>) -> Options {
    let crop_area = region.as_ref().map(|r| Area {
        origin: Point { x: r.x as f64, y: r.y as f64 },
        size: Size { width: r.width as f64, height: r.height as f64 },
    });

    Options {
        fps,
        target: None,
        show_cursor: true,
        show_highlight: false,
        crop_area,
        output_type: FrameType::BGRAFrame,
        output_resolution: Resolution::Captured,
        excluded_targets: None,
    }
}

fn spawn_ffmpeg_encoder(width: u32, height: u32, fps: u32, output: &str) -> AppResult<Child> {
    ffmpeg_cmd()
        .args([
            "-y",
            "-f", "rawvideo",
            "-pix_fmt", "bgra",
            "-video_size", &format!("{}x{}", width, height),
            "-framerate", &fps.to_string(),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            output,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}. Install via `brew install ffmpeg`.", e))
}

/// Start microphone capture, writing raw f32-le samples to `audio_path`.
/// Returns `(stream-handle, sample_rate, channels)` or None if no mic available.
fn start_audio_capture(audio_path: &str) -> Option<(AudioStreamHandle, u32, u16)> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host.default_input_device()?;
    let config = device.default_input_config().ok()?;

    let rate = config.sample_rate().0;
    let channels = config.channels();

    let file = Arc::new(Mutex::new(std::fs::File::create(audio_path).ok()?));
    let file_w = file.clone();

    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut f = file_w.lock().unwrap();
                for s in data {
                    let _ = f.write_all(&s.to_le_bytes());
                }
            },
            |err| eprintln!("Mic capture error: {:?}", err),
            None,
        )
        .ok()?;

    stream.play().ok()?;
    Some((AudioStreamHandle(stream), rate, channels))
}

fn concat_pcm_files(inputs: &[&str], output: &str) -> AppResult<()> {
    let mut out =
        std::fs::File::create(output).map_err(|e| format!("PCM concat create: {}", e))?;
    for p in inputs {
        let data = std::fs::read(p).map_err(|e| format!("PCM read {}: {}", p, e))?;
        out.write_all(&data).map_err(|e| format!("PCM write: {}", e))?;
    }
    Ok(())
}

// ─── Segment lifecycle ────────────────────────────────────────────────────────

fn start_segment(
    save_dir: &str,
    index: u32,
    region: &Option<RecordRegion>,
) -> AppResult<(thread::JoinHandle<()>, Arc<AtomicBool>, Option<AudioStreamHandle>, SegmentInfo)>
{
    check_recording_support()?;

    let video_path = PathBuf::from(save_dir)
        .join(format!("bs_seg{}_video.mp4", index))
        .to_string_lossy()
        .to_string();

    let audio_path = PathBuf::from(save_dir)
        .join(format!("bs_seg{}_audio.pcm", index))
        .to_string_lossy()
        .to_string();

    let options = build_capturer_options(30, region);
    let mut capturer = Capturer::build(options).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("permission") || msg.contains("denied") || msg.contains("access") {
            "Screen Recording permission is required. \
             Please grant it in System Settings › Privacy & Security › Screen Recording, \
             then try again."
                .to_string()
        } else {
            format!("ScreenCaptureKit init failed: {}", e)
        }
    })?;

    // Must call before start_capture
    let [width, height] = capturer.get_output_frame_size();

    let mut ffmpeg = spawn_ffmpeg_encoder(width, height, 30, &video_path)?;
    let mut ffmpeg_stdin = ffmpeg.stdin.take().ok_or("No ffmpeg stdin")?;

    let audio = start_audio_capture(&audio_path);
    let (audio_handle, audio_sample_rate, audio_channels) = match audio {
        Some((h, r, c)) => (Some(h), Some(r), Some(c)),
        None => (None, None, None),
    };

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();

    let capture_thread = thread::spawn(move || {
        capturer.start_capture();

        loop {
            match capturer.get_next_frame() {
                Ok(Frame::BGRA(f)) => {
                    if ffmpeg_stdin.write_all(&f.data).is_err() {
                        break;
                    }
                }
                Ok(_) => {} // ignore other pixel formats
                Err(_) => break, // capturer stopped
            }

            if stop_clone.load(Ordering::Relaxed) {
                break;
            }
        }

        capturer.stop_capture();
        drop(ffmpeg_stdin); // EOF → ffmpeg flushes and writes MP4
        let _ = ffmpeg.wait();
    });

    let segment = SegmentInfo {
        video_path,
        audio_path: if audio_sample_rate.is_some() { Some(audio_path) } else { None },
        audio_sample_rate,
        audio_channels,
    };

    Ok((capture_thread, stop_flag, audio_handle, segment))
}

/// Signal the capture thread to stop, drop the audio stream, join, collect segments.
fn finalise_active(recording: Box<ActiveRecording>) -> Vec<SegmentInfo> {
    recording.stop_flag.store(true, Ordering::Relaxed);
    drop(recording.audio_stream); // stops cpal, flushes PCM file
    if let Some(t) = recording.capture_thread {
        let _ = t.join();
    }
    let mut all = recording.finished_segments;
    all.push(recording.current_segment);
    all
}

// ─── Public API ───────────────────────────────────────────────────────────────

pub fn start_recording(save_dir: &str, region: Option<RecordRegion>) -> AppResult<()> {
    let mut state = STATE.lock().map_err(|e| format!("Lock: {}", e))?;
    if !matches!(*state, RecordingState::Idle) {
        return Err("Recording already in progress".to_string());
    }

    let (thread, stop_flag, audio, segment) = start_segment(save_dir, 0, &region)?;

    *state = RecordingState::Recording(Box::new(ActiveRecording {
        stop_flag,
        capture_thread: Some(thread),
        audio_stream: audio,
        finished_segments: Vec::new(),
        current_segment: segment,
        save_dir: save_dir.to_string(),
        region,
        started_at: Instant::now(),
        elapsed_before_pause: 0.0,
    }));
    Ok(())
}

pub fn pause_recording() -> AppResult<()> {
    let recording = {
        let mut state = STATE.lock().map_err(|e| format!("Lock: {}", e))?;
        match std::mem::replace(&mut *state, RecordingState::Idle) {
            RecordingState::Recording(r) => r,
            other => { *state = other; return Err("Not recording".to_string()); }
        }
    };

    let save_dir = recording.save_dir.clone();
    let region = recording.region.clone();
    let total = recording.elapsed_before_pause + recording.started_at.elapsed().as_secs_f64();
    let segs = finalise_active(recording);

    let mut state = STATE.lock().map_err(|e| format!("Lock post-pause: {}", e))?;
    *state = RecordingState::Paused {
        finished_segments: segs,
        save_dir,
        region,
        elapsed_before_pause: total,
    };
    Ok(())
}

pub fn resume_recording() -> AppResult<()> {
    let (mut segs, save_dir, region, elapsed) = {
        let mut state = STATE.lock().map_err(|e| format!("Lock: {}", e))?;
        match std::mem::replace(&mut *state, RecordingState::Idle) {
            RecordingState::Paused { finished_segments, save_dir, region, elapsed_before_pause } => {
                (finished_segments, save_dir, region, elapsed_before_pause)
            }
            other => { *state = other; return Err("Not paused".to_string()); }
        }
    };

    let idx = segs.len() as u32;
    let (thread, stop_flag, audio, segment) = start_segment(&save_dir, idx, &region)?;
    segs.push(segment);
    let current = segs.pop().unwrap();

    let mut state = STATE.lock().map_err(|e| format!("Lock post-resume: {}", e))?;
    *state = RecordingState::Recording(Box::new(ActiveRecording {
        stop_flag,
        capture_thread: Some(thread),
        audio_stream: audio,
        finished_segments: segs,
        current_segment: current,
        save_dir,
        region,
        started_at: Instant::now(),
        elapsed_before_pause: elapsed,
    }));
    Ok(())
}

pub fn stop_recording(output_dir: &str) -> AppResult<String> {
    let result = {
        let mut state = STATE.lock().map_err(|e| format!("Lock: {}", e))?;
        match std::mem::replace(&mut *state, RecordingState::Idle) {
            RecordingState::Recording(r) => Ok(r),
            RecordingState::Paused { finished_segments, .. } => Err(finished_segments),
            RecordingState::Idle => return Err("No recording in progress".to_string()),
        }
    };

    let all_segs = match result {
        Ok(r) => finalise_active(r),
        Err(segs) => segs,
    };

    let valid: Vec<&SegmentInfo> = all_segs
        .iter()
        .filter(|s| PathBuf::from(&s.video_path).exists())
        .collect();

    if valid.is_empty() {
        return Err("No recording output found — was it too short?".to_string());
    }

    let output_filename = generate_filename("recording", "mp4")?;
    let final_path = PathBuf::from(output_dir).join(&output_filename);
    let final_str = final_path.to_string_lossy().to_string();

    // ── Concatenate video segments ────────────────────────────────────────────
    if valid.len() == 1 {
        std::fs::rename(&valid[0].video_path, &final_path)
            .or_else(|_| std::fs::copy(&valid[0].video_path, &final_path).map(|_| ()))
            .map_err(|e| format!("Failed to move recording: {}", e))?;
    } else {
        let list = PathBuf::from(output_dir).join("bs_concat.txt");
        {
            let mut f = std::fs::File::create(&list)
                .map_err(|e| format!("concat list: {}", e))?;
            for s in &valid {
                writeln!(f, "file '{}'", s.video_path)
                    .map_err(|e| format!("concat write: {}", e))?;
            }
        }
        let ok = ffmpeg_cmd()
            .args(["-y", "-f", "concat", "-safe", "0",
                   "-i", &list.to_string_lossy(), "-c", "copy", &final_str])
            .stdout(Stdio::null()).stderr(Stdio::null())
            .status().map_err(|e| format!("ffmpeg concat: {}", e))?
            .success();
        let _ = std::fs::remove_file(&list);
        for s in &valid { let _ = std::fs::remove_file(&s.video_path); }
        if !ok { return Err("Failed to concatenate segments".to_string()); }
    }

    // ── Mux microphone audio if captured ─────────────────────────────────────
    let audio_segs: Vec<&SegmentInfo> = valid.iter().copied()
        .filter(|s| s.audio_path.is_some()).collect();

    if !audio_segs.is_empty() {
        let rate = audio_segs[0].audio_sample_rate.unwrap_or(44100);
        let ch   = audio_segs[0].audio_channels.unwrap_or(1);

        let combined = PathBuf::from(output_dir).join("bs_audio.pcm")
            .to_string_lossy().to_string();
        let pcm_paths: Vec<&str> = audio_segs.iter()
            .map(|s| s.audio_path.as_deref().unwrap()).collect();

        if concat_pcm_files(&pcm_paths, &combined).is_ok() {
            let muxed = PathBuf::from(output_dir)
                .join(format!("muxed_{}", output_filename))
                .to_string_lossy().to_string();

            let ok = ffmpeg_cmd()
                .args(["-y", "-i", &final_str,
                       "-f", "f32le", "-ar", &rate.to_string(), "-ac", &ch.to_string(),
                       "-i", &combined,
                       "-c:v", "copy", "-c:a", "aac", "-shortest", &muxed])
                .stdout(Stdio::null()).stderr(Stdio::null())
                .status().ok().map(|s| s.success()).unwrap_or(false);

            if ok {
                let _ = std::fs::remove_file(&final_str);
                let _ = std::fs::rename(&muxed, &final_path);
            } else {
                let _ = std::fs::remove_file(&muxed);
            }
            let _ = std::fs::remove_file(&combined);
        }

        for s in &audio_segs {
            if let Some(p) = &s.audio_path { let _ = std::fs::remove_file(p); }
        }
    }

    Ok(final_str)
}

// ─── State queries ────────────────────────────────────────────────────────────

pub fn get_elapsed_seconds() -> f64 {
    let Ok(state) = STATE.lock() else { return 0.0 };
    match &*state {
        RecordingState::Recording(r) => r.elapsed_before_pause + r.started_at.elapsed().as_secs_f64(),
        RecordingState::Paused { elapsed_before_pause, .. } => *elapsed_before_pause,
        RecordingState::Idle => 0.0,
    }
}

pub fn get_state_name() -> &'static str {
    let Ok(state) = STATE.lock() else { return "idle" };
    match &*state {
        RecordingState::Recording(_) => "recording",
        RecordingState::Paused { .. } => "paused",
        RecordingState::Idle => "idle",
    }
}

/// Return a Command for ffmpeg, searching Homebrew paths before falling back to $PATH.
/// macOS GUI apps receive a stripped PATH that excludes /opt/homebrew/bin and /usr/local/bin,
/// so we check those explicitly first.
fn ffmpeg_cmd() -> Command {
    let candidates = [
        "/opt/homebrew/bin/ffmpeg",  // Homebrew on Apple Silicon
        "/usr/local/bin/ffmpeg",     // Homebrew on Intel
        "/usr/bin/ffmpeg",           // rare system install
        "ffmpeg",                    // last-resort PATH lookup
    ];
    for path in candidates {
        if path == "ffmpeg" || std::path::Path::new(path).exists() {
            return Command::new(path);
        }
    }
    ffmpeg_cmd()
}

pub fn is_ffmpeg_available() -> bool {
    ffmpeg_cmd()
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ─── Post-processing ──────────────────────────────────────────────────────────

pub fn get_duration(video_path: &str) -> AppResult<f64> {
    let out = Command::new("ffprobe")
        .args(["-v", "quiet", "-show_entries", "format=duration",
               "-of", "default=noprint_wrappers=1:nokey=1", video_path])
        .output().map_err(|e| format!("ffprobe: {}", e))?;

    if !out.status.success() {
        return Err(format!("ffprobe: {}", String::from_utf8_lossy(&out.stderr)));
    }
    String::from_utf8_lossy(&out.stdout).trim().parse::<f64>()
        .map_err(|e| format!("parse duration: {}", e))
}

pub fn trim_video(input: &str, output_dir: &str, start: f64, end: f64) -> AppResult<String> {
    let filename = generate_filename("recording_trimmed", "mp4")?;
    let out = PathBuf::from(output_dir).join(&filename).to_string_lossy().to_string();
    let ok = ffmpeg_cmd()
        .args(["-y", "-ss", &format!("{:.3}", start), "-to", &format!("{:.3}", end),
               "-i", input, "-c", "copy", "-avoid_negative_ts", "make_zero", &out])
        .stdout(Stdio::null()).stderr(Stdio::null())
        .status().map_err(|e| format!("ffmpeg trim: {}", e))?.success();
    if !ok { return Err("ffmpeg trim failed".to_string()); }
    Ok(out)
}

pub fn save_recording(recording_path: &str, save_dir: &str, copy_to_clip: bool) -> AppResult<String> {
    let src = PathBuf::from(recording_path);
    if !src.exists() { return Err("Recording file not found".to_string()); }
    let dest = PathBuf::from(save_dir)
        .join(src.file_name().ok_or("Invalid path")?)
        .to_string_lossy().to_string();
    if recording_path != dest {
        std::fs::copy(recording_path, &dest)
            .map_err(|e| format!("copy: {}", e))?;
    }
    if copy_to_clip { copy_file_to_clipboard(&dest)?; }
    Ok(dest)
}
