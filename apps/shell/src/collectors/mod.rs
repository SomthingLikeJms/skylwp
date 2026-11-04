pub mod agents;
pub mod audio;
pub mod browser;
pub mod desktop;
pub mod media;
mod process_cpu;
pub mod system;
pub mod system_location;
pub mod weather;

pub fn start(host: crate::state::Host) {
    for collector in [
        system::run,
        audio::run,
        media::run,
        agents::run,
        browser::run,
        weather::run,
        desktop::run,
    ] {
        let cloned = host.clone();
        std::thread::spawn(move || collector(cloned));
    }
}
