//! Easy-mode companion protocol types (LAN-only).
//! Phase 2 desktop side: discovery + session metadata.
//! The Android APK implements the stream sender.

use serde::{Deserialize, Serialize};

pub const COMPANION_SERVICE_TYPE: &str = "_aspera-connect._tcp.local.";
pub const DEFAULT_COMPANION_PORT: u16 = 17891;
pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionDevice {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub protocol: u16,
    pub battery: Option<u8>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompanionMessage {
    Hello {
        protocol: u16,
        pin: Option<String>,
    },
    HelloAck {
        ok: bool,
        reason: Option<String>,
    },
    StartMirror,
    StopMirror,
    InputEvent {
        kind: InputKind,
        x: Option<f32>,
        y: Option<f32>,
        text: Option<String>,
    },
    Notification {
        id: String,
        app: String,
        title: String,
        body: String,
    },
    Battery {
        level: u8,
        charging: bool,
    },
    Media {
        title: Option<String>,
        playing: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InputKind {
    Tap,
    Swipe,
    LongPress,
    Key,
    Text,
    Back,
    Home,
    Recents,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompanionSessionState {
    pub connected: bool,
    pub device: Option<CompanionDevice>,
    pub mirroring: bool,
    pub last_error: Option<String>,
}
