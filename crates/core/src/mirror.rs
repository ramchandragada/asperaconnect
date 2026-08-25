use crate::config::MirrorProfile;
use crate::error::AsperaError;
use crate::tools::require_scrcpy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorOptions {
    pub serial: String,
    pub profile: MirrorProfile,
    pub turn_screen_off: bool,
    pub stay_awake: bool,
    pub show_touches: bool,
    pub fullscreen: bool,
    pub window_title: Option<String>,
    pub forward_audio: bool,
    pub record_path: Option<PathBuf>,
    /// When false, pass `--no-clipboard` to scrcpy.
    #[serde(default = "default_true")]
    pub clipboard_sync: bool,
    /// Create a virtual display (scrcpy 3.3+ `--new-display`).
    #[serde(default)]
    pub new_display: bool,
    /// Optional size for virtual display, e.g. `1280x720` or `1280x720/240`.
    #[serde(default)]
    pub new_display_size: Option<String>,
    /// Package to start (`--start-app=+pkg` force-stops first).
    #[serde(default)]
    pub start_app: Option<String>,
    /// Continuously resize virtual display to the window (`--flex-display`).
    #[serde(default)]
    pub flex_display: bool,
}

fn default_true() -> bool {
    true
}

impl Default for MirrorOptions {
    fn default() -> Self {
        Self {
            serial: String::new(),
            profile: MirrorProfile::balanced(),
            turn_screen_off: false,
            stay_awake: true,
            show_touches: false,
            fullscreen: false,
            window_title: Some("Aspera Connect".into()),
            forward_audio: true,
            record_path: None,
            clipboard_sync: true,
            new_display: false,
            new_display_size: None,
            start_app: None,
            flex_display: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorHandle {
    pub id: String,
    pub serial: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub recording: bool,
    #[serde(default)]
    pub app_window: bool,
    #[serde(default)]
    pub start_app: Option<String>,
}

struct LiveMirror {
    serial: String,
    child: Child,
    recording: bool,
    app_window: bool,
    start_app: Option<String>,
}

#[derive(Clone, Default)]
pub struct MirrorManager {
    inner: Arc<Mutex<HashMap<String, LiveMirror>>>,
}

impl MirrorManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn start(&self, options: MirrorOptions) -> Result<MirrorHandle, AsperaError> {
        let scrcpy = require_scrcpy()?;
        let id = Uuid::new_v4().to_string();
        let recording = options.record_path.is_some();
        let app_window = options.new_display;
        let start_app = options.start_app.clone();

        let mut cmd = Command::new(&scrcpy);
        cmd.arg("-s").arg(&options.serial);
        cmd.arg("--window-title")
            .arg(options.window_title.as_deref().unwrap_or("Aspera Connect"));

        if !options.forward_audio {
            cmd.arg("--no-audio");
        } else {
            cmd.arg("--audio-source=output");
        }

        if !options.clipboard_sync {
            cmd.arg("--no-clipboard");
        }

        if let Some(path) = &options.record_path {
            cmd.arg("--record").arg(path);
        }

        if options.new_display {
            if let Some(size) = &options.new_display_size {
                cmd.arg(format!("--new-display={size}"));
            } else {
                cmd.arg("--new-display");
            }
            if options.flex_display {
                cmd.arg("--flex-display");
            }
        }

        if let Some(pkg) = &options.start_app {
            let pkg = pkg.trim();
            if !pkg.is_empty() {
                let arg = if pkg.starts_with('+') || pkg.starts_with('?') {
                    format!("--start-app={pkg}")
                } else {
                    format!("--start-app=+{pkg}")
                };
                cmd.arg(arg);
            }
        }

        // Profile sizing still applies to app windows / full mirrors.
        if let Some(max_size) = options.profile.max_size {
            cmd.arg("-m").arg(max_size.to_string());
        }
        if let Some(bitrate) = &options.profile.bit_rate {
            cmd.arg("-b").arg(bitrate);
        }
        if let Some(max_fps) = options.profile.max_fps {
            cmd.arg("--max-fps").arg(max_fps.to_string());
        }
        if options.turn_screen_off {
            cmd.arg("--turn-screen-off");
        }
        if options.stay_awake {
            cmd.arg("--stay-awake");
        }
        if options.show_touches {
            cmd.arg("--show-touches");
        }
        if options.fullscreen {
            cmd.arg("--fullscreen");
        }

        cmd.stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let child = cmd
            .spawn()
            .map_err(|e| AsperaError::Scrcpy(e.to_string()))?;
        let pid = child.id();

        self.inner.lock().await.insert(
            id.clone(),
            LiveMirror {
                serial: options.serial.clone(),
                child,
                recording,
                app_window,
                start_app: start_app.clone(),
            },
        );

        Ok(MirrorHandle {
            id,
            serial: options.serial,
            running: true,
            pid,
            recording,
            app_window,
            start_app,
        })
    }

    pub async fn stop(&self, id: &str) -> Result<(), AsperaError> {
        let mut child = {
            let mut map = self.inner.lock().await;
            map.remove(id).map(|live| live.child)
        };
        if let Some(ref mut child) = child {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        Ok(())
    }

    pub async fn stop_all(&self) -> Result<(), AsperaError> {
        let mut children: Vec<Child> = {
            let mut map = self.inner.lock().await;
            map.drain().map(|(_, live)| live.child).collect()
        };
        for mut child in children.drain(..) {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        Ok(())
    }

    pub async fn list(&self) -> Vec<MirrorHandle> {
        let map = self.inner.lock().await;
        map.iter()
            .map(|(id, live)| MirrorHandle {
                id: id.clone(),
                serial: live.serial.clone(),
                running: true,
                pid: live.child.id(),
                recording: live.recording,
                app_window: live.app_window,
                start_app: live.start_app.clone(),
            })
            .collect()
    }

    pub async fn reap_exited(&self) {
        let mut map = self.inner.lock().await;
        let mut dead = Vec::new();
        for (id, live) in map.iter_mut() {
            if let Ok(Some(_)) = live.child.try_wait() {
                dead.push(id.clone());
            }
        }
        for id in dead {
            map.remove(&id);
        }
    }
}
