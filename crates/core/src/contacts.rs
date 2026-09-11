use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::config::AppConfig;
use crate::error::AsperaError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneContact {
    pub id: String,
    pub name: String,
    pub phones: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContactsCache {
    pub synced_at: Option<String>,
    pub host: Option<String>,
    pub contacts: Vec<PhoneContact>,
}

fn contacts_path() -> PathBuf {
    AppConfig::config_path()
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("contacts.json")
}

impl ContactsCache {
    pub fn load() -> Self {
        let path = contacts_path();
        match fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> Result<(), AsperaError> {
        let path = contacts_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| AsperaError::Message(e.to_string()))?;
        }
        let raw = serde_json::to_string_pretty(self)
            .map_err(|e| AsperaError::Message(e.to_string()))?;
        fs::write(path, raw).map_err(|e| AsperaError::Message(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contact_json_roundtrip() {
        let c = PhoneContact {
            id: "42".into(),
            name: "Ada".into(),
            phones: vec!["+911234567890".into(), "9876543210".into()],
        };
        let raw = serde_json::to_string(&c).unwrap();
        let back: PhoneContact = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.name, "Ada");
        assert_eq!(back.phones.len(), 2);
    }
}
