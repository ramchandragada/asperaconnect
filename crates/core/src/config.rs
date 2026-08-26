use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MirrorProfileId {
    Quality,
    Balanced,
    Battery,
    LowLatency,
    Meetings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorProfile {
    pub id: MirrorProfileId,
    pub label: String,
    pub max_size: Option<u32>,
    pub bit_rate: Option<String>,
    pub max_fps: Option<u32>,
}

impl MirrorProfile {
    pub fn quality() -> Self {
        Self {
            id: MirrorProfileId::Quality,
            label: "Quality".into(),
            max_size: Some(1920),
            bit_rate: Some("8M".into()),
            max_fps: Some(60),
        }
    }

    pub fn balanced() -> Self {
        Self {
            id: MirrorProfileId::Balanced,
            label: "Balanced".into(),
            max_size: Some(1280),
            bit_rate: Some("4M".into()),
            max_fps: Some(60),
        }
    }

    pub fn battery() -> Self {
        Self {
            id: MirrorProfileId::Battery,
            label: "Battery".into(),
            max_size: Some(1024),
            bit_rate: Some("2M".into()),
            max_fps: Some(30),
        }
    }

    pub fn low_latency() -> Self {
        Self {
            id: MirrorProfileId::LowLatency,
            label: "Low latency".into(),
            max_size: Some(1024),
            bit_rate: Some("3M".into()),
            max_fps: Some(120),
        }
    }

    /// Business meetings: moderate video, audio on PC, screen-off recommended in UI.
    pub fn meetings() -> Self {
        Self {
            id: MirrorProfileId::Meetings,
            label: "Meetings".into(),
            max_size: Some(1280),
            bit_rate: Some("4M".into()),
            max_fps: Some(30),
        }
    }

    pub fn all() -> Vec<Self> {
        vec![
            Self::quality(),
            Self::balanced(),
            Self::battery(),
            Self::low_latency(),
            Self::meetings(),
        ]
    }

    pub fn by_id(id: &MirrorProfileId) -> Self {
        match id {
            MirrorProfileId::Quality => Self::quality(),
            MirrorProfileId::Balanced => Self::balanced(),
            MirrorProfileId::Battery => Self::battery(),
            MirrorProfileId::LowLatency => Self::low_latency(),
            MirrorProfileId::Meetings => Self::meetings(),
        }
    }
}

/// Common business app packages — shown as favorites when installed.
pub fn default_favorite_packages() -> Vec<String> {
    vec![
        "com.whatsapp".into(),
        "com.whatsapp.w4b".into(),
        "com.google.android.gm".into(),
        "com.android.chrome".into(),
        "com.microsoft.teams".into(),
        "com.slack".into(),
        "com.google.android.apps.meetings".into(),
        "com.zoom.videomeetings".into(),
        "com.android.settings".into(),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub first_run_completed: bool,
    pub last_device_serial: Option<String>,
    pub preferred_profile: MirrorProfileId,
    pub turn_screen_off: bool,
    pub stay_awake: bool,
    pub show_touches: bool,
    pub start_with_tray: bool,
    pub locale: String,
    pub known_wireless_endpoints: Vec<String>,
    pub companion_pin: Option<String>,
    /// Last Easy-mode companion host (phone LAN IP).
    #[serde(default)]
    pub companion_host: Option<String>,
    /// Friendly name for the last companion.
    #[serde(default)]
    pub companion_name: Option<String>,
    pub kdeconnect_enabled: bool,
    /// Forward phone audio to PC while mirroring (scrcpy 2+, Android 11+).
    #[serde(default = "default_true")]
    pub forward_audio: bool,
    /// Save mirror sessions to MP4 in the recordings folder.
    #[serde(default)]
    pub record_mirror: bool,
    /// Sync clipboard with phone when mirroring (scrcpy built-in).
    #[serde(default = "default_true")]
    pub clipboard_sync: bool,
    /// Custom names per device serial.
    #[serde(default)]
    pub device_nicknames: HashMap<String, String>,
    /// Package names muted in the notification center.
    #[serde(default)]
    pub notification_muted_apps: Vec<String>,
    /// Favorite packages for one-click app windows.
    #[serde(default)]
    pub favorite_apps: Vec<String>,
}

fn default_true() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            first_run_completed: false,
            last_device_serial: None,
            preferred_profile: MirrorProfileId::Balanced,
            turn_screen_off: false,
            stay_awake: true,
            show_touches: false,
            start_with_tray: true,
            locale: "en".into(),
            known_wireless_endpoints: vec![],
            companion_pin: None,
            companion_host: None,
            companion_name: None,
            kdeconnect_enabled: true,
            forward_audio: true,
            record_mirror: false,
            clipboard_sync: true,
            device_nicknames: HashMap::new(),
            notification_muted_apps: vec![],
            favorite_apps: default_favorite_packages(),
        }
    }
}

impl AppConfig {
    pub fn recordings_dir() -> PathBuf {
        dirs::video_dir()
            .or_else(dirs::download_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("aspera-connect-recordings")
    }

    pub fn device_display_name(&self, serial: &str, fallback: &str) -> String {
        self.device_nicknames
            .get(serial)
            .cloned()
            .unwrap_or_else(|| fallback.to_string())
    }
    pub fn config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("aspera-connect")
            .join("config.json")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        match fs::read_to_string(&path) {
            Ok(text) => {
                let mut cfg: Self = serde_json::from_str(&text).unwrap_or_default();
                if cfg.favorite_apps.is_empty() {
                    cfg.favorite_apps = default_favorite_packages();
                }
                cfg
            }
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> std::io::Result<()> {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_string_pretty(self).unwrap())
    }
}
