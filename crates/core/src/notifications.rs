use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const MAX_STORED: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneNotification {
    pub id: String,
    pub app: String,
    pub title: String,
    pub body: String,
    pub source: NotificationSource,
    pub received_at: DateTime<Utc>,
    pub read: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationSource {
    Companion,
    KdeConnect,
    Adb,
}

#[derive(Debug, Default)]
pub struct NotificationStore {
    items: VecDeque<PhoneNotification>,
}

impl NotificationStore {
    pub fn push(&mut self, n: PhoneNotification) {
        if self.items.iter().any(|x| x.id == n.id) {
            return;
        }
        self.items.push_front(n);
        while self.items.len() > MAX_STORED {
            self.items.pop_back();
        }
    }

    pub fn list(&self) -> Vec<PhoneNotification> {
        self.items.iter().cloned().collect()
    }

    pub fn mark_read(&mut self, id: &str) {
        if let Some(n) = self.items.iter_mut().find(|x| x.id == id) {
            n.read = true;
        }
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn unread_count(&self) -> usize {
        self.items.iter().filter(|n| !n.read).count()
    }
}

pub fn from_companion_json(value: &serde_json::Value) -> Option<PhoneNotification> {
    if value.get("type").and_then(|v| v.as_str()) != Some("notification") {
        return None;
    }
    let id = value.get("id").and_then(|v| v.as_str())?.to_string();
    Some(PhoneNotification {
        id: id.clone(),
        app: value
            .get("app")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        title: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        body: value
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        source: NotificationSource::Companion,
        received_at: Utc::now(),
        read: false,
    })
}
