use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::config::AppConfig;
use crate::error::AsperaError;

const MAX_HISTORY: usize = 80;
const MAX_FAVORITES: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CallOutcome {
    Dialed,
    Ended,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallHistoryEntry {
    pub id: String,
    pub name: String,
    pub number: String,
    pub at: String,
    pub outcome: CallOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallHistory {
    pub entries: Vec<CallHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteContact {
    pub id: String,
    pub name: String,
    pub number: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FavoritesStore {
    pub favorites: Vec<FavoriteContact>,
}

fn prefs_dir() -> PathBuf {
    AppConfig::config_path()
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn history_path() -> PathBuf {
    prefs_dir().join("call-history.json")
}

fn favorites_path() -> PathBuf {
    prefs_dir().join("favorites.json")
}

fn load_json<T: for<'de> Deserialize<'de> + Default>(path: &PathBuf) -> T {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => T::default(),
    }
}

fn save_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), AsperaError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AsperaError::Message(e.to_string()))?;
    }
    let raw =
        serde_json::to_string_pretty(value).map_err(|e| AsperaError::Message(e.to_string()))?;
    fs::write(path, raw).map_err(|e| AsperaError::Message(e.to_string()))?;
    Ok(())
}

impl CallHistory {
    pub fn load() -> Self {
        load_json(&history_path())
    }

    pub fn save(&self) -> Result<(), AsperaError> {
        save_json(&history_path(), self)
    }

    pub fn record(name: &str, number: &str, outcome: CallOutcome) -> Result<Self, AsperaError> {
        let mut hist = Self::load();
        let entry = CallHistoryEntry {
            id: format!(
                "{}-{}",
                chrono::Utc::now().timestamp_millis(),
                number.chars().filter(|c| c.is_ascii_digit()).take(8).collect::<String>()
            ),
            name: name.trim().to_string(),
            number: number.trim().to_string(),
            at: chrono::Utc::now().to_rfc3339(),
            outcome,
        };
        hist.entries.insert(0, entry);
        if hist.entries.len() > MAX_HISTORY {
            hist.entries.truncate(MAX_HISTORY);
        }
        hist.save()?;
        Ok(hist)
    }

    pub fn clear() -> Result<Self, AsperaError> {
        let hist = Self::default();
        hist.save()?;
        Ok(hist)
    }
}

impl FavoritesStore {
    pub fn load() -> Self {
        load_json(&favorites_path())
    }

    pub fn save(&self) -> Result<(), AsperaError> {
        save_json(&favorites_path(), self)
    }

    pub fn toggle(id: &str, name: &str, number: &str) -> Result<Self, AsperaError> {
        let mut store = Self::load();
        if let Some(idx) = store.favorites.iter().position(|f| f.id == id) {
            store.favorites.remove(idx);
        } else {
            if store.favorites.len() >= MAX_FAVORITES {
                return Err(AsperaError::Message(format!(
                    "Favorite limit reached ({MAX_FAVORITES}). Unstar one first."
                )));
            }
            store.favorites.insert(
                0,
                FavoriteContact {
                    id: id.to_string(),
                    name: name.trim().to_string(),
                    number: number.trim().to_string(),
                },
            );
        }
        store.save()?;
        Ok(store)
    }

    pub fn remove(id: &str) -> Result<Self, AsperaError> {
        let mut store = Self::load();
        store.favorites.retain(|f| f.id != id);
        store.save()?;
        Ok(store)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_serde() {
        let raw = serde_json::to_string(&CallOutcome::Dialed).unwrap();
        assert_eq!(raw, "\"dialed\"");
    }
}
