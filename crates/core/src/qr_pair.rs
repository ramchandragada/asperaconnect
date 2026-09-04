//! QR LAN pairing for Easy mode: PC shows QR → phone scans → PC learns phone IP.

use crate::error::AsperaError;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};
use uuid::Uuid;

pub const DEFAULT_QR_PAIR_PORT: u16 = 17892;
pub const QR_PAIR_TTL_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPairOffer {
    /// Protocol version for QR payload.
    pub v: u16,
    /// One-time token the phone must present.
    pub t: String,
    /// Pairing TCP port on the PC.
    pub p: u16,
    /// Candidate PC IPv4 addresses on this LAN.
    pub h: Vec<String>,
    /// Friendly PC name.
    pub n: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPairSession {
    pub offer: QrPairOffer,
    /// Compact QR payload string.
    pub qr_payload: String,
    pub expires_at_ms: u64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPairedPhone {
    pub phone_ip: String,
    pub phone_port: u16,
    pub name: String,
}

struct QrPairInner {
    token: String,
    started: Instant,
    result: Option<QrPairedPhone>,
}

pub struct QrPairHub {
    inner: Mutex<Option<QrPairInner>>,
    notify: Notify,
    stop: AtomicBool,
}

impl Default for QrPairHub {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            notify: Notify::new(),
            stop: AtomicBool::new(false),
        }
    }
}

impl QrPairHub {
    pub async fn start(&self, pc_name: &str) -> Result<QrPairSession, AsperaError> {
        self.stop.store(false, Ordering::SeqCst);
        let token = Uuid::new_v4().to_string().replace('-', "");
        let hosts = list_lan_ipv4();
        if hosts.is_empty() {
            return Err(AsperaError::Message(
                "No LAN IP found on this PC. Connect Ethernet/Wi‑Fi, then try Show QR again.".into(),
            ));
        }
        let offer = QrPairOffer {
            v: 1,
            t: token.clone(),
            p: DEFAULT_QR_PAIR_PORT,
            h: hosts,
            n: pc_name.to_string(),
        };
        let qr_payload = format!(
            "aspera1:{}",
            serde_json::to_string(&offer).map_err(|e| AsperaError::Message(e.to_string()))?
        );
        {
            let mut guard = self.inner.lock().await;
            *guard = Some(QrPairInner {
                token,
                started: Instant::now(),
                result: None,
            });
        }
        let expires_at_ms =
            chrono::Utc::now().timestamp_millis() as u64 + QR_PAIR_TTL_SECS * 1000;
        Ok(QrPairSession {
            offer,
            qr_payload,
            expires_at_ms,
            active: true,
        })
    }

    pub async fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let mut guard = self.inner.lock().await;
        *guard = None;
        self.notify.notify_waiters();
    }

    pub async fn take_result(&self) -> Option<QrPairedPhone> {
        let mut guard = self.inner.lock().await;
        guard.as_mut().and_then(|s| s.result.take())
    }

    pub async fn wait_result(&self, timeout: Duration) -> Option<QrPairedPhone> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(p) = self.take_result().await {
                return Some(p);
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(left) => {
                    return self.take_result().await;
                }
            }
        }
    }

    pub fn should_stop(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    async fn accept_pair(&self, phone: QrPairedPhone, token: &str) -> Result<(), AsperaError> {
        let mut guard = self.inner.lock().await;
        let Some(session) = guard.as_mut() else {
            return Err(AsperaError::Message("Pairing is not active on PC".into()));
        };
        if session.started.elapsed() > Duration::from_secs(QR_PAIR_TTL_SECS) {
            return Err(AsperaError::Message(
                "QR expired — tap Show QR again on PC".into(),
            ));
        }
        if session.token != token {
            return Err(AsperaError::Message("Invalid pairing code".into()));
        }
        session.result = Some(phone);
        drop(guard);
        self.notify.notify_waiters();
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct PhonePairRequest {
    #[serde(rename = "type")]
    kind: String,
    token: String,
    #[serde(rename = "phoneIp")]
    phone_ip: String,
    #[serde(rename = "phonePort")]
    phone_port: Option<u16>,
    name: Option<String>,
}

/// Run pairing TCP server until stop or one successful pair.
pub async fn run_qr_pair_server(hub: Arc<QrPairHub>) -> Result<(), AsperaError> {
    let listener = TcpListener::bind(("0.0.0.0", DEFAULT_QR_PAIR_PORT))
        .await
        .map_err(|e| {
            AsperaError::Message(format!(
                "Could not open pairing port {DEFAULT_QR_PAIR_PORT}: {e}"
            ))
        })?;
    loop {
        if hub.should_stop() {
            break;
        }
        let accept = tokio::time::timeout(Duration::from_millis(500), listener.accept()).await;
        let Ok(Ok((stream, _))) = accept else {
            continue;
        };
        let hub2 = hub.clone();
        let handle = tokio::spawn(async move {
            let mut stream = stream;
            let (reader, mut writer) = stream.split();
            let mut lines = BufReader::new(reader).lines();
            let Ok(Some(line)) = lines.next_line().await else {
                return false;
            };
            let req: PhonePairRequest = match serde_json::from_str(&line) {
                Ok(r) => r,
                Err(_) => {
                    let _ = writer
                        .write_all(
                            b"{\"type\":\"pairAck\",\"ok\":false,\"reason\":\"bad_json\"}\n",
                        )
                        .await;
                    return false;
                }
            };
            if req.kind != "pair" {
                let _ = writer
                    .write_all(b"{\"type\":\"pairAck\",\"ok\":false,\"reason\":\"bad_type\"}\n")
                    .await;
                return false;
            }
            let phone = QrPairedPhone {
                phone_ip: req.phone_ip,
                phone_port: req.phone_port.unwrap_or(17891),
                name: req.name.unwrap_or_else(|| "Phone".into()),
            };
            match hub2.accept_pair(phone, &req.token).await {
                Ok(()) => {
                    let _ = writer
                        .write_all(b"{\"type\":\"pairAck\",\"ok\":true}\n")
                        .await;
                    true
                }
                Err(e) => {
                    let msg = format!("{e}").replace('"', "'");
                    let body =
                        format!("{{\"type\":\"pairAck\",\"ok\":false,\"reason\":\"{msg}\"}}\n");
                    let _ = writer.write_all(body.as_bytes()).await;
                    false
                }
            }
        });
        if let Ok(true) = handle.await {
            break;
        }
    }
    Ok(())
}

pub fn list_lan_ipv4() -> Vec<String> {
    let mut set = HashSet::new();
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                if let IpAddr::V4(v4) = addr.ip() {
                    if !v4.is_loopback() {
                        set.insert(v4.to_string());
                    }
                }
            }
        }
    }
    if let Ok(output) = std::process::Command::new("hostname").arg("-I").output() {
        if output.status.success() {
            for part in String::from_utf8_lossy(&output.stdout).split_whitespace() {
                if let Ok(IpAddr::V4(v4)) = part.parse::<IpAddr>() {
                    if !v4.is_loopback() && !is_link_local(v4) {
                        set.insert(v4.to_string());
                    }
                }
            }
        }
    }
    let mut ips: Vec<String> = set.into_iter().collect();
    ips.sort();
    ips
}

fn is_link_local(ip: Ipv4Addr) -> bool {
    ip.octets()[0] == 169 && ip.octets()[1] == 254
}
