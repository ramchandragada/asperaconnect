use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AsperaError {
    #[error("{0}")]
    Message(String),
    #[error("tool missing: {0}")]
    ToolMissing(String),
    #[error("no device connected")]
    NoDevice,
    #[error("device unauthorized — unlock phone and tap Allow")]
    Unauthorized,
    #[error("device offline")]
    Offline,
    #[error("adb failed: {0}")]
    Adb(String),
    #[error("scrcpy failed: {0}")]
    Scrcpy(String),
    #[error("pairing failed: {0}")]
    Pairing(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFacingError {
    pub code: String,
    pub title: String,
    pub message: String,
    pub hint: Option<String>,
}

impl From<&AsperaError> for UserFacingError {
    fn from(err: &AsperaError) -> Self {
        translate_error(err)
    }
}

pub fn translate_error(err: &AsperaError) -> UserFacingError {
    match err {
        AsperaError::ToolMissing(tool) => UserFacingError {
            code: "tool_missing".into(),
            title: format!("{tool} not found"),
            message: format!(
                "Aspera Connect needs {tool} on your PATH. Install it with your package manager."
            ),
            hint: Some(match tool.as_str() {
                "adb" => "Ubuntu/Mint/Zorin: sudo apt install adb".into(),
                "scrcpy" => "Prefer: sudo snap install scrcpy && sudo snap connect scrcpy:gpu-2404 mesa-2404  (apt 1.25 is often too old for Android 14)".into(),
                _ => format!("Install {tool}, then restart Aspera Connect."),
            }),
        },
        AsperaError::NoDevice => UserFacingError {
            code: "no_device".into(),
            title: "No phone detected".into(),
            message: "Plug in USB or finish wireless pairing, then refresh devices.".into(),
            hint: Some("Enable USB debugging in Developer options.".into()),
        },
        AsperaError::Unauthorized => UserFacingError {
            code: "unauthorized".into(),
            title: "Phone not trusted yet".into(),
            message: "Unlock your phone and tap Allow on the USB debugging prompt.".into(),
            hint: Some("Check “Always allow from this computer”, then tap Allow.".into()),
        },
        AsperaError::Offline => UserFacingError {
            code: "offline".into(),
            title: "Phone went offline".into(),
            message: "The connection dropped. Reconnect USB or wireless debugging.".into(),
            hint: Some("Keep the phone unlocked while pairing.".into()),
        },
        AsperaError::Pairing(msg) => UserFacingError {
            code: "pairing".into(),
            title: "Wireless pairing failed".into(),
            message: msg.clone(),
            hint: Some("Use the pairing port and 6-digit code from Wireless debugging.".into()),
        },
        AsperaError::Adb(msg) => {
            let lower = msg.to_lowercase();
            if lower.contains("unauthorized") {
                return translate_error(&AsperaError::Unauthorized);
            }
            if lower.contains("no devices") || lower.contains("not found") {
                return translate_error(&AsperaError::NoDevice);
            }
            UserFacingError {
                code: "adb".into(),
                title: "ADB error".into(),
                message: humanize_adb(msg),
                hint: Some("Try: reconnect USB cable, or run adb kill-server.".into()),
            }
        }
        AsperaError::Scrcpy(msg) => UserFacingError {
            code: "scrcpy".into(),
            title: "Could not start mirror".into(),
            message: msg.clone(),
            hint: Some("Close other mirroring apps and try again.".into()),
        },
        AsperaError::Io(e) => UserFacingError {
            code: "io".into(),
            title: "System error".into(),
            message: e.to_string(),
            hint: None,
        },
        AsperaError::Message(msg) => UserFacingError {
            code: "generic".into(),
            title: "Something went wrong".into(),
            message: msg.clone(),
            hint: None,
        },
    }
}

fn humanize_adb(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "ADB reported an unknown error.".into()
    } else {
        trimmed.lines().next().unwrap_or(trimmed).to_string()
    }
}
