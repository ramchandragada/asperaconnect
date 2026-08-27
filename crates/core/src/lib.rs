//! Aspera Connect core — ADB, scrcpy, pairing, errors, and preferences.

pub mod adb;
pub mod call_prefs;
pub mod contacts;
pub mod companion;
pub mod companion_net;
pub mod config;
pub mod device;
pub mod discovery;
pub mod error;
pub mod kdeconnect;
pub mod mirror;
pub mod notifications;
pub mod pairing;
pub mod qr_pair;
pub mod setup;
pub mod skins;
pub mod telephony;
pub mod tools;

pub use adb::{AdbClient, PhoneApp};
pub use call_prefs::{
    CallHistory, CallHistoryEntry, CallOutcome, FavoriteContact, FavoritesStore,
};
pub use contacts::{ContactsCache, PhoneContact};
pub use config::{AppConfig, MirrorProfile, MirrorProfileId};
pub use device::{Device, DeviceState};
pub use error::{translate_error, AsperaError, UserFacingError};
pub use mirror::{MirrorHandle, MirrorManager, MirrorOptions};
pub use skins::DeviceIdentity;
pub use notifications::{NotificationSource, NotificationStore, PhoneNotification};
pub use setup::{run_setup_doctor, SetupCheck, SetupReport};
pub use discovery::discover_companions;
pub use qr_pair::{list_lan_ipv4, QrPairedPhone, QrPairHub, QrPairOffer, QrPairSession};
pub use telephony::{normalize_phone_number, parse_phone_uri, phone_from_argv};
pub use tools::{ToolInfo, ToolStatus, ToolsReport, detect_tools};
