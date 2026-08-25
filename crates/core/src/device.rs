use crate::skins::{resolve_identity, DeviceIdentity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeviceState {
    Device,
    Unauthorized,
    Offline,
    Unknown,
}

impl DeviceState {
    pub fn parse(s: &str) -> Self {
        match s.trim() {
            "device" => Self::Device,
            "unauthorized" => Self::Unauthorized,
            "offline" => Self::Offline,
            _ => Self::Unknown,
        }
    }

    pub fn is_ready(&self) -> bool {
        matches!(self, Self::Device)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub serial: String,
    pub state: DeviceState,
    pub model: Option<String>,
    pub product: Option<String>,
    pub transport_id: Option<String>,
    pub connection: ConnectionKind,
    pub battery: Option<u8>,
    pub android_version: Option<String>,
    pub brand: Option<String>,
    pub device_codename: Option<String>,
    pub identity: DeviceIdentity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionKind {
    Usb,
    Wireless,
    Unknown,
}

impl Device {
    pub fn from_adb_line(line: &str) -> Option<Self> {
        let line = line.trim();
        if line.is_empty() || line.starts_with("List of devices") {
            return None;
        }
        let mut parts = line.split_whitespace();
        let serial = parts.next()?.to_string();
        let state = DeviceState::parse(parts.next().unwrap_or("unknown"));

        let mut model = None;
        let mut product = None;
        let mut transport_id = None;
        for part in parts {
            if let Some(v) = part.strip_prefix("model:") {
                model = Some(v.replace('_', " "));
            } else if let Some(v) = part.strip_prefix("product:") {
                product = Some(v.to_string());
            } else if let Some(v) = part.strip_prefix("transport_id:") {
                transport_id = Some(v.to_string());
            }
        }

        let connection = if serial.contains('.') && serial.contains(':') {
            ConnectionKind::Wireless
        } else {
            ConnectionKind::Usb
        };

        let identity = resolve_identity(None, model.as_deref(), product.as_deref());

        Some(Self {
            serial,
            state,
            model,
            product,
            transport_id,
            connection,
            battery: None,
            android_version: None,
            brand: None,
            device_codename: None,
            identity,
        })
    }

    pub fn refresh_identity(&mut self) {
        self.identity = resolve_identity(
            self.brand.as_deref(),
            self.model.as_deref(),
            self.device_codename
                .as_deref()
                .or(self.product.as_deref()),
        );
    }

    pub fn display_name(&self) -> String {
        if self.identity.market_name != "Android phone" {
            self.identity.market_name.clone()
        } else {
            self.model
                .clone()
                .unwrap_or_else(|| self.serial.clone())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usb_device() {
        let d = Device::from_adb_line(
            "emulator-5554          device product:sdk_gphone model:sdk_gphone_x86 transport_id:1",
        )
        .unwrap();
        assert_eq!(d.serial, "emulator-5554");
        assert_eq!(d.state, DeviceState::Device);
        assert_eq!(d.connection, ConnectionKind::Usb);
        assert_eq!(d.model.as_deref(), Some("sdk gphone x86"));
    }

    #[test]
    fn parses_wireless() {
        let d = Device::from_adb_line("192.168.1.8:5555    device").unwrap();
        assert_eq!(d.connection, ConnectionKind::Wireless);
    }
}
