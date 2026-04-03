//! Screenshot capture module

use image::imageops::FilterType;
use serde::Serialize;
use std::path::PathBuf;
use xcap::Monitor;

use crate::utils::{ensure_dir, generate_filename_with_id, AppResult};

/// Represents a captured monitor screenshot with geometry info
#[derive(Serialize, Clone, Debug)]
pub struct MonitorShot {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub path: String,
}

/// Capture screenshots of all available monitors
pub fn capture_all_monitors(save_dir: &str) -> AppResult<Vec<MonitorShot>> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors available".into());
    }

    let save_path = PathBuf::from(save_dir);
    ensure_dir(&save_path)?;

    let mut shots = Vec::with_capacity(monitors.len());

    for monitor in monitors {
        let shot = capture_single_monitor(&monitor, &save_path)?;
        shots.push(shot);
    }

    Ok(shots)
}

/// Capture a single monitor screenshot
fn capture_single_monitor(monitor: &Monitor, save_path: &PathBuf) -> AppResult<MonitorShot> {
    let monitor_id = monitor
        .id()
        .map_err(|e| format!("Failed to get monitor id: {}", e))?;

    // Get monitor geometry
    let x = monitor
        .x()
        .map_err(|e| format!("Failed to get monitor x: {}", e))?;
    let y = monitor
        .y()
        .map_err(|e| format!("Failed to get monitor y: {}", e))?;
    let width = monitor
        .width()
        .map_err(|e| format!("Failed to get monitor width: {}", e))?;
    let height = monitor
        .height()
        .map_err(|e| format!("Failed to get monitor height: {}", e))?;
    let scale_factor = monitor
        .scale_factor()
        .map_err(|e| format!("Failed to get monitor scale factor: {}", e))?;

    // Capture the screenshot at full physical resolution
    let image = monitor
        .capture_image()
        .map_err(|e| format!("Failed to capture monitor {}: {}", monitor_id, e))?;

    // Downsample to logical resolution so JPEG encoding is fast.
    // xcap width()/height() are logical pixels (CGDisplayBounds); capture_image() is
    // physical pixels (2× on Retina). Full Retina PNG encoding takes 2-3 s; JPEG at
    // logical resolution takes ~100 ms.
    let downsampled = if scale_factor > 1.0 {
        image::DynamicImage::ImageRgba8(image::imageops::resize(
            &image,
            width,
            height,
            FilterType::Triangle,
        ))
    } else {
        image::DynamicImage::ImageRgba8(image)
    };

    // Save as JPEG — ~10× faster to encode than PNG at equivalent resolution.
    let filename = generate_filename_with_id("monitor", monitor_id, "jpg")?;
    let screenshot_path = save_path.join(&filename);
    downsampled
        .save(&screenshot_path)
        .map_err(|e| format!("Failed to save screenshot: {}", e))?;

    Ok(MonitorShot {
        id: monitor_id,
        x,
        y,
        width,
        height,
        scale_factor,
        path: screenshot_path.to_string_lossy().into_owned(),
    })
}

/// Capture primary monitor using the screenshots plugin
pub async fn capture_primary_monitor(app_handle: tauri::AppHandle) -> AppResult<PathBuf> {
    use tauri_plugin_screenshots::{get_monitor_screenshot, get_screenshotable_monitors};

    let monitors = get_screenshotable_monitors()
        .await
        .map_err(|e| format!("Failed to get monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors available".into());
    }

    let primary_monitor = monitors.first().ok_or("No monitor found")?;

    let screenshot_path = get_monitor_screenshot(app_handle, primary_monitor.id)
        .await
        .map_err(|e| format!("Failed to capture screenshot: {}", e))?;

    Ok(screenshot_path)
}
