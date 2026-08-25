//! Optional bridge to kdeconnect-cli when installed.

use crate::error::AsperaError;
use crate::notifications::{NotificationSource, PhoneNotification};
use crate::tools::detect_tools;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdeDevice {
    pub id: String,
    pub name: String,
    pub paired: bool,
    pub reachable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdeStatus {
    pub available: bool,
    pub devices: Vec<KdeDevice>,
    pub hint: Option<String>,
}

fn kde_enabled() -> bool {
    crate::config::AppConfig::load().kdeconnect_enabled
}

fn require_enabled() -> Result<(), AsperaError> {
    if kde_enabled() {
        Ok(())
    } else {
        Err(AsperaError::Message(
            "KDE Connect bridge is disabled in Settings".into(),
        ))
    }
}

pub async fn status() -> KdeStatus {
    if !kde_enabled() {
        return KdeStatus {
            available: false,
            devices: vec![],
            hint: Some("KDE Connect bridge disabled in Settings".into()),
        };
    }
    let tools = detect_tools();
    if !tools.kdeconnect.found {
        return KdeStatus {
            available: false,
            devices: vec![],
            hint: Some(tools.kdeconnect.install_hint),
        };
    }
    match list_devices().await {
        Ok(devices) => KdeStatus {
            available: true,
            devices,
            hint: None,
        },
        Err(e) => KdeStatus {
            available: true,
            devices: vec![],
            hint: Some(e.to_string()),
        },
    }
}

pub async fn list_devices() -> Result<Vec<KdeDevice>, AsperaError> {
    require_enabled()?;
    let output = Command::new("kdeconnect-cli")
        .args(["-l"])
        .output()
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut devices = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Formats vary: "- id: Name" or "id Name (paired and reachable)"
        let cleaned = line.trim_start_matches('-').trim();
        let lower = cleaned.to_lowercase();
        let reachable = !lower.contains("unreachable");
        let paired = lower.contains("paired") || !lower.contains("unpaired");

        if let Some((id, rest)) = cleaned.split_once(':') {
            let name = rest
                .split('(')
                .next()
                .unwrap_or(rest)
                .trim()
                .to_string();
            devices.push(KdeDevice {
                id: id.trim().to_string(),
                name: if name.is_empty() {
                    id.trim().to_string()
                } else {
                    name
                },
                paired,
                reachable,
            });
            continue;
        }

        let mut parts = cleaned.split_whitespace();
        if let Some(id) = parts.next() {
            let name = parts
                .take_while(|p| !p.starts_with('('))
                .collect::<Vec<_>>()
                .join(" ");
            devices.push(KdeDevice {
                id: id.to_string(),
                name: if name.is_empty() {
                    id.to_string()
                } else {
                    name
                },
                paired,
                reachable,
            });
        }
    }
    Ok(devices)
}

pub async fn share_file(device_id: &str, path: &str) -> Result<(), AsperaError> {
    require_enabled()?;
    let status = Command::new("kdeconnect-cli")
        .args(["-d", device_id, "--share", path])
        .status()
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(AsperaError::Message(
            "kdeconnect share failed — is the phone paired?".into(),
        ))
    }
}

pub async fn share_text(device_id: &str, text: &str) -> Result<(), AsperaError> {
    require_enabled()?;
    // Prefer --share-text when available; fall back to sharing a temp approach via ping-msg
    let status = Command::new("kdeconnect-cli")
        .args(["-d", device_id, "--share-text", text])
        .status()
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    if status.success() {
        return Ok(());
    }
    // Older CLIs: share a data URL is not great; try ping with message
    let status = Command::new("kdeconnect-cli")
        .args(["-d", device_id, "--ping-msg", text])
        .status()
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(AsperaError::Message(
            "kdeconnect share-text failed — update kdeconnect or pair the phone".into(),
        ))
    }
}

pub async fn ping(device_id: &str) -> Result<(), AsperaError> {
    require_enabled()?;
    let status = Command::new("kdeconnect-cli")
        .args(["-d", device_id, "--ping"])
        .status()
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(AsperaError::Message("kdeconnect ping failed".into()))
    }
}

pub async fn ring(device_id: &str) -> Result<(), AsperaError> {
    require_enabled()?;
    let status = Command::new("kdeconnect-cli")
        .args(["-d", device_id, "--ring"])
        .status()
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(AsperaError::Message("kdeconnect ring failed".into()))
    }
}

pub async fn send_sms(device_id: &str, number: &str, body: &str) -> Result<(), AsperaError> {
    require_enabled()?;
    let status = Command::new("kdeconnect-cli")
        .args([
            "-d",
            device_id,
            "--send-sms",
            body,
            "--destination",
            number,
        ])
        .status()
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(AsperaError::Message(
            "kdeconnect SMS send failed — enable SMS plugin on phone and pair over Wi‑Fi".into(),
        ))
    }
}

/// Pull current notifications from a KDE Connect device into PhoneNotification structs.
pub async fn fetch_notifications(device_id: &str) -> Result<Vec<PhoneNotification>, AsperaError> {
    require_enabled()?;
    let output = Command::new("kdeconnect-cli")
        .args(["-d", device_id, "--list-notifications"])
        .output()
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(AsperaError::Message(if err.trim().is_empty() {
            "kdeconnect list-notifications failed".into()
        } else {
            err.trim().to_string()
        }));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut items = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Typical: "id: AppName: title" or free-form lines
        let (app, title, body) = parse_notification_line(line);
        items.push(PhoneNotification {
            id: format!("kde-{}-{}", device_id, Uuid::new_v4()),
            app,
            title,
            body,
            source: NotificationSource::KdeConnect,
            received_at: Utc::now(),
            read: false,
        });
    }
    Ok(items)
}

fn parse_notification_line(line: &str) -> (String, String, String) {
    // Try "App — Title: body" or "App: Title"
    if let Some((left, right)) = line.split_once(':') {
        let left = left.trim();
        let right = right.trim();
        if let Some((title, body)) = right.split_once(':') {
            return (
                left.to_string(),
                title.trim().to_string(),
                body.trim().to_string(),
            );
        }
        return (left.to_string(), right.to_string(), String::new());
    }
    (
        "kdeconnect".into(),
        line.to_string(),
        String::new(),
    )
}
