//! LAN discovery for Easy-mode companion devices.

use crate::companion::{CompanionDevice, COMPANION_SERVICE_TYPE, DEFAULT_COMPANION_PORT, PROTOCOL_VERSION};
use crate::error::AsperaError;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::collections::HashMap;
use std::time::Duration;

const BROWSE_TIMEOUT_MS: u64 = 2500;

/// Browse mDNS for `_aspera-connect._tcp.local.` services.
pub async fn discover_companions() -> Result<Vec<CompanionDevice>, AsperaError> {
    let mdns = ServiceDaemon::new()
        .map_err(|e| AsperaError::Message(format!("mdns init failed: {e}")))?;
    let service_type = if COMPANION_SERVICE_TYPE.ends_with(".local.") {
        COMPANION_SERVICE_TYPE.to_string()
    } else {
        format!("{COMPANION_SERVICE_TYPE}.local.")
    };

    let receiver = mdns
        .browse(&service_type)
        .map_err(|e| AsperaError::Message(format!("mdns browse failed: {e}")))?;

    let mut found: HashMap<String, CompanionDevice> = HashMap::new();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(BROWSE_TIMEOUT_MS);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, receiver.recv_async()).await {
            Ok(Ok(ServiceEvent::ServiceResolved(info))) => {
                let host = info
                    .get_addresses()
                    .iter()
                    .find(|a| a.is_ipv4())
                    .map(|a| a.to_string())
                    .or_else(|| info.get_hostname().split('.').next().map(|s| s.to_string()))
                    .unwrap_or_else(|| info.get_hostname().to_string());
                let port = info.get_port();
                let name = info.get_fullname().to_string();
                let id = format!("mdns-{host}-{port}");
                found.insert(
                    id.clone(),
                    CompanionDevice {
                        id,
                        name,
                        host,
                        port,
                        protocol: PROTOCOL_VERSION,
                        battery: None,
                        model: Some("Easy mode".into()),
                    },
                );
            }
            Ok(Ok(ServiceEvent::ServiceFound(_, _))) => {}
            Ok(Ok(_)) => {}
            Ok(Err(_)) => break,
            Err(_) => break,
        }
    }

    let _ = mdns.shutdown();

    if found.is_empty() {
        // Fallback: common LAN gateway subnet scan hint only — no aggressive port scan in core.
        return Ok(vec![]);
    }

    Ok(found.into_values().collect())
}

pub fn default_companion_port() -> u16 {
    DEFAULT_COMPANION_PORT
}
