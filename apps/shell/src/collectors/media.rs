use crate::state::Host;
use serde_json::json;
use std::{sync::atomic::Ordering, time::Duration};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    },
    Storage::Streams::DataReader,
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

fn palette(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Vec<String> {
    let fallback = vec!["#f2b35b".into(), "#73dbcc".into(), "#9e86df".into()];
    let read = || -> windows::core::Result<Vec<u8>> {
        let stream = properties.Thumbnail()?.OpenReadAsync()?.join()?;
        let size = stream.Size()?.min(2 * 1024 * 1024) as u32;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size)?.join()?;
        let mut bytes = vec![0; size as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(bytes)
    };
    let Some(image) = read().ok().and_then(|b| image::load_from_memory(&b).ok()) else {
        return fallback;
    };
    let pixels = image
        .resize_exact(32, 32, image::imageops::FilterType::Triangle)
        .to_rgb8();
    let mut bins = std::collections::HashMap::<u16, (u32, u32, u32, u32)>::new();
    for pixel in pixels.pixels() {
        let [r, g, b] = pixel.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        if max < 40 || max - min < 12 {
            continue;
        }
        let k = ((r as u16 >> 5) << 6) | ((g as u16 >> 5) << 3) | (b as u16 >> 5);
        let v = bins.entry(k).or_default();
        v.0 += 1;
        v.1 += r as u32;
        v.2 += g as u32;
        v.3 += b as u32;
    }
    let mut bins: Vec<_> = bins.into_values().collect();
    bins.sort_by_key(|v| std::cmp::Reverse(v.0));
    let mut colors: Vec<String> = bins
        .into_iter()
        .take(3)
        .map(|(n, r, g, b)| format!("#{:02x}{:02x}{:02x}", r / n, g / n, b / n))
        .collect();
    if colors.is_empty() {
        return fallback;
    }
    while colors.len() < 2 {
        colors.push(fallback[colors.len()].clone());
    }
    colors
}

pub fn run(host: Host) {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let mut last = String::new();
    let mut last_playing = None;
    let mut last_privacy = false;
    while host.0.running.load(Ordering::Relaxed) {
        if !host.enabled("media") {
            host.0.media_session.store(false, Ordering::Relaxed);
            host.status("media", "已关闭");
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        let mut result = || -> windows::core::Result<()> {
            let manager =
                GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()?;
            let session = match manager.GetCurrentSession() {
                Ok(s) => s,
                Err(_) => {
                    host.0.media_session.store(false, Ordering::Relaxed);
                    host.status("media", "等待播放器");
                    return Ok(());
                }
            };
            host.0.media_session.store(true, Ordering::Relaxed);
            host.status("media", "已连接");
            let playing = session.GetPlaybackInfo()?.PlaybackStatus()?
                == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
            if last_playing != Some(playing) {
                last_playing = Some(playing);
                host.emit("media", "media.state", None, json!({"playing":playing}));
            }
            let properties = session.TryGetMediaPropertiesAsync()?.join()?;
            let privacy = host.0.config.lock().unwrap().privacy;
            let title = if privacy {
                "正在播放".to_owned()
            } else {
                properties.Title()?.to_string().chars().take(128).collect()
            };
            let artist = if privacy {
                String::new()
            } else {
                properties.Artist()?.to_string().chars().take(128).collect()
            };
            let key = format!("{}|{}|{}", session.SourceAppUserModelId()?, title, artist);
            if key != last || privacy != last_privacy {
                last = key;
                last_privacy = privacy;
                host.emit(
                    "media",
                    "media.track",
                    None,
                    json!({"title":title,"artist":artist,"palette":palette(&properties)}),
                );
            }
            Ok(())
        };
        if let Err(e) = result() {
            host.status("media", "媒体接口暂不可用");
            host.log(&format!("Media: {e}"));
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}
