use crate::state::Host;
use rustfft::{num_complex::Complex, FftPlanner};
use serde_json::json;
use std::{
    collections::VecDeque,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use wasapi::*;

pub struct Spectrum {
    fft: std::sync::Arc<dyn rustfft::Fft<f32>>,
    samples: [f32; 1024],
    cursor: usize,
    input: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    window: [f32; 1024],
    previous: [f32; 512],
    history: [[f32; 300]; 3],
    history_head: usize,
    normal: [f32; 3],
    flux_mean: f32,
    frame: usize,
}
impl Spectrum {
    pub fn new() -> Self {
        let fft = FftPlanner::new().plan_fft_forward(1024);
        let scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
        Self {
            fft,
            samples: [0.; 1024],
            cursor: 0,
            input: vec![Complex::default(); 1024],
            scratch,
            window: std::array::from_fn(|i| {
                0.5 - 0.5 * (2. * std::f32::consts::PI * i as f32 / 1023.).cos()
            }),
            previous: [0.; 512],
            history: [[0.; 300]; 3],
            history_head: 0,
            normal: [0.01; 3],
            flux_mean: 0.,
            frame: 0,
        }
    }
    pub fn push(&mut self, sample: f32) {
        self.samples[self.cursor] = if sample.is_finite() { sample } else { 0. };
        self.cursor = (self.cursor + 1) % 1024;
    }
    pub fn analyze(&mut self) -> ([f32; 3], bool, [f32; 7]) {
        for i in 0..1024 {
            self.input[i] =
                Complex::new(self.samples[(self.cursor + i) % 1024] * self.window[i], 0.);
        }
        self.fft
            .process_with_scratch(&mut self.input, &mut self.scratch);
        let mut sums = [0.0f32; 3];
        let mut count = [0u32; 3];
        let mut flux = 0.;
        let mut spectrum = [0f32; 7];
        let mut spectrum_count = [0u32; 7];
        for i in 1..279 {
            let mag = self.input[i].norm() / 512.;
            let freq = i as f32 * 44100. / 1024.;
            let band = if freq < 150. {
                0
            } else if freq < 2000. {
                1
            } else {
                2
            };
            sums[band] += mag * mag;
            count[band] += 1;
            flux += (mag - self.previous[i]).max(0.);
            self.previous[i] = mag;
            let bin = ((freq / 43.0).ln() / (12000.0f32 / 43.0).ln() * 7.)
                .floor()
                .clamp(0., 6.) as usize;
            spectrum[bin] += mag * mag;
            spectrum_count[bin] += 1;
        }
        flux /= 278.;
        let onset = flux > self.flux_mean.max(0.00001) * 1.6;
        self.flux_mean = self.flux_mean * 0.94 + flux * 0.06;
        let raw: [f32; 3] = std::array::from_fn(|i| (sums[i] / count[i].max(1) as f32).sqrt());
        for i in 0..3 {
            self.history[i][self.history_head] = raw[i];
        }
        self.history_head = (self.history_head + 1) % 300;
        self.frame += 1;
        if self.frame % 30 == 0 {
            for i in 0..3 {
                let mut values = self.history[i];
                values.sort_by(f32::total_cmp);
                self.normal[i] = values[285].max(0.003);
            }
        }
        let bins = std::array::from_fn(|i| {
            let band = if i < 2 {
                0
            } else if i < 5 {
                1
            } else {
                2
            };
            ((spectrum[i] / spectrum_count[i].max(1) as f32).sqrt() / self.normal[band])
                .clamp(0., 1.)
        });
        (
            std::array::from_fn(|i| (raw[i] / self.normal[i]).clamp(0., 1.)),
            onset,
            bins,
        )
    }
}

pub fn run(host: Host) {
    if initialize_mta().is_err() {
        host.status("audio", "音频接口初始化失败");
        return;
    }
    while host.0.running.load(Ordering::Relaxed) {
        if !host.enabled("audio") {
            host.status("audio", "已关闭");
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }
        if let Err(e) = capture(&host) {
            host.status("audio", "等待可用的音频输出");
            host.log(&format!("Audio: {e}"));
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

fn capture(host: &Host) -> Result<(), Box<dyn std::error::Error>> {
    let enumerator = DeviceEnumerator::new()?;
    let device = enumerator.get_default_device(&Direction::Render)?;
    let mut client = device.get_iaudioclient()?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, 44100, 1, None);
    client.initialize_client(
        &format,
        &Direction::Capture,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: 1_000_000,
        },
    )?;
    let event = client.set_get_eventhandle()?;
    let reader = client.get_audiocaptureclient()?;
    client.start_stream()?;
    host.status("audio", "已连接，系统输出回环");
    let mut queue = VecDeque::with_capacity(65536);
    let mut spectrum = Spectrum::new();
    let mut last_frame = Instant::now();
    let mut last_sound = Instant::now() - Duration::from_secs(60);
    let mut last_onset = Instant::now();
    let mut periods = VecDeque::<f64>::with_capacity(8);
    let mut energy = [0f32; 240];
    let mut energy_head = 0;
    let mut energy_at = Instant::now();
    let mut last_playing = false;
    let mut last_packet = Instant::now();
    let mut pending_peak = 0f32;
    let mut last_emit = Instant::now() - Duration::from_secs(2);
    while host.0.running.load(Ordering::Relaxed) && host.enabled("audio") {
        // WASAPI wakes us when packets arrive; an idle output needs no 8 ms poll.
        let _ = event.wait_for_event(250);
        reader.read_from_device_to_deque(&mut queue)?;
        if queue.len() > 65536 {
            queue.clear();
        }
        let mut peak = 0f32;
        while queue.len() >= 4 {
            let bytes = [
                queue.pop_front().unwrap(),
                queue.pop_front().unwrap(),
                queue.pop_front().unwrap(),
                queue.pop_front().unwrap(),
            ];
            let sample = f32::from_le_bytes(bytes);
            peak = peak.max(sample.abs());
            spectrum.push(sample);
            last_packet = Instant::now();
        }
        if last_packet.elapsed() > Duration::from_millis(80) {
            for _ in 0..1470 {
                spectrum.push(0.);
            }
        }
        pending_peak = pending_peak.max(peak);
        let analyze = pending_peak > 0.000001 || last_sound.elapsed() < Duration::from_millis(500);
        if last_frame.elapsed() >= Duration::from_micros(33333) {
            last_frame = Instant::now();
            let (bands, onset, bins) = if analyze {
                spectrum.analyze()
            } else {
                ([0.; 3], false, [0.; 7])
            };
            if pending_peak > 0.001 || bands.iter().any(|v| *v > 0.025) {
                last_sound = Instant::now();
            }
            let active = last_sound.elapsed() < Duration::from_millis(500);
            pending_peak = 0.;
            let playing = last_sound.elapsed() < Duration::from_secs(10);
            if !host.0.media_session.load(Ordering::Relaxed) && playing != last_playing {
                host.emit("media", "media.state", None, json!({"playing":playing}));
                last_playing = playing;
            }
            let buckets = (energy_at.elapsed().as_micros() / 33333) as usize;
            for i in 0..buckets.min(240) {
                energy[energy_head] = if i + 1 == buckets.min(240) {
                    (bands[0] + bands[1] + bands[2]) / 3.
                } else {
                    0.
                };
                energy_head = (energy_head + 1) % 240;
            }
            energy_at += Duration::from_micros(33333 * buckets as u64);
            if active || last_emit.elapsed() >= Duration::from_secs(1) {
                host.emit("audio","audio.frame",None,json!({"bass":bands[0],"mid":bands[1],"high":bands[2],"onset":onset,"energy8s":energy.iter().sum::<f32>()/240.,"spectrum":bins}));
                last_emit = Instant::now();
            }
            if onset && last_onset.elapsed() > Duration::from_millis(200) {
                let interval = last_onset.elapsed().as_secs_f64();
                last_onset = Instant::now();
                if (0.3..1.5).contains(&interval) {
                    periods.push_back(interval);
                    if periods.len() > 8 {
                        periods.pop_front();
                    }
                }
                if periods.len() >= 4 {
                    let mean = periods.iter().sum::<f64>() / periods.len() as f64;
                    let variation = (periods.iter().map(|p| (p - mean).powi(2)).sum::<f64>()
                        / periods.len() as f64)
                        .sqrt()
                        / mean;
                    if variation < 0.3 {
                        host.emit(
                            "audio",
                            "audio.beat",
                            None,
                            json!({"bpm":(60./mean).clamp(40.,200.),"phase":0.}),
                        );
                    }
                }
            }
        }
    }
    client.stop_stream()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fft_separates_bass_mid_and_treble() {
        for (frequency, band) in [(86.0, 0), (861.3, 1), (5168., 2)] {
            let mut s = Spectrum::new();
            for i in 0..1024 {
                s.push((i as f32 * frequency / 44100. * std::f32::consts::TAU).sin() * 0.1);
            }
            let (bands, _, _) = s.analyze();
            assert!(bands[band] > 0.1);
            for j in 0..3 {
                if j != band {
                    assert!(bands[j] < 0.05);
                }
            }
        }
    }
}
