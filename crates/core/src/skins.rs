//! Map ADB product props → a visual device skin id for the desktop UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub brand: Option<String>,
    pub model: Option<String>,
    pub device: Option<String>,
    pub market_name: String,
    pub skin_id: String,
    /// width / height of the active display (e.g. 1080/2400)
    pub aspect_w: u32,
    pub aspect_h: u32,
}

impl Default for DeviceIdentity {
    fn default() -> Self {
        Self {
            brand: None,
            model: None,
            device: None,
            market_name: "Android phone".into(),
            skin_id: "generic".into(),
            aspect_w: 9,
            aspect_h: 19,
        }
    }
}

/// Resolve a skin from common ADB props (`ro.product.*`).
pub fn resolve_identity(
    brand: Option<&str>,
    model: Option<&str>,
    device: Option<&str>,
) -> DeviceIdentity {
    let brand_l = brand.unwrap_or("").to_lowercase();
    let model_l = model.unwrap_or("").to_lowercase().replace(' ', "");
    let device_l = device.unwrap_or("").to_lowercase();
    let hay = format!("{brand_l} {model_l} {device_l}");

    // OnePlus 8T (KB2001 / kebab / OnePlus8T)
    if hay.contains("kb2001")
        || hay.contains("kb2003")
        || hay.contains("kb2005")
        || hay.contains("oneplus8t")
        || device_l == "kebab"
        || (hay.contains("oneplus") && hay.contains("8t"))
    {
        return DeviceIdentity {
            brand: Some("OnePlus".into()),
            model: model.map(|s| s.to_string()),
            device: device.map(|s| s.to_string()),
            market_name: "OnePlus 8T".into(),
            skin_id: "oneplus-8t".into(),
            aspect_w: 1080,
            aspect_h: 2400,
        };
    }

    if hay.contains("oneplus") || brand_l == "oneplus" {
        return DeviceIdentity {
            brand: Some("OnePlus".into()),
            model: model.map(|s| s.to_string()),
            device: device.map(|s| s.to_string()),
            market_name: model
                .map(|m| format!("OnePlus {m}"))
                .unwrap_or_else(|| "OnePlus".into()),
            skin_id: "oneplus".into(),
            aspect_w: 9,
            aspect_h: 20,
        };
    }

    if hay.contains("pixel") || brand_l == "google" {
        return DeviceIdentity {
            brand: Some("Google".into()),
            model: model.map(|s| s.to_string()),
            device: device.map(|s| s.to_string()),
            market_name: model.unwrap_or("Pixel").to_string(),
            skin_id: "pixel".into(),
            aspect_w: 9,
            aspect_h: 20,
        };
    }

    if hay.contains("samsung") || brand_l == "samsung" || model_l.starts_with("sm-") {
        return DeviceIdentity {
            brand: Some("Samsung".into()),
            model: model.map(|s| s.to_string()),
            device: device.map(|s| s.to_string()),
            market_name: model.unwrap_or("Samsung").to_string(),
            skin_id: "samsung".into(),
            aspect_w: 9,
            aspect_h: 19,
        };
    }

    if hay.contains("xiaomi")
        || hay.contains("redmi")
        || hay.contains("poco")
        || brand_l == "xiaomi"
    {
        return DeviceIdentity {
            brand: Some("Xiaomi".into()),
            model: model.map(|s| s.to_string()),
            device: device.map(|s| s.to_string()),
            market_name: model.unwrap_or("Xiaomi").to_string(),
            skin_id: "xiaomi".into(),
            aspect_w: 9,
            aspect_h: 20,
        };
    }

    DeviceIdentity {
        brand: brand.map(|s| s.to_string()),
        model: model.map(|s| s.to_string()),
        device: device.map(|s| s.to_string()),
        market_name: model.unwrap_or("Android phone").to_string(),
        skin_id: "generic".into(),
        aspect_w: 9,
        aspect_h: 19,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oneplus_8t_kb2001() {
        let id = resolve_identity(Some("OnePlus"), Some("KB2001"), Some("kebab"));
        assert_eq!(id.skin_id, "oneplus-8t");
        assert_eq!(id.market_name, "OnePlus 8T");
    }
}
