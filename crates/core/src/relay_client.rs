//! Cloud relay client — WhatsApp-style cross-network pairing over WebSocket.

use crate::error::AsperaError;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Default public relay (override in Settings / ASPERA_RELAY_URL / config).
/// Deploy `apps/relay` (Render/Fly/Docker) and point clients at your `wss://` URL.
pub const DEFAULT_RELAY_URL: &str = "wss://aspera-relay.onrender.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPairOffer {
    pub v: u16,
    /// Relay WebSocket URL
    pub r: String,
    pub s: String,
    pub k: String,
    pub n: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPairSession {
    pub offer: CloudPairOffer,
    pub qr_payload: String,
    pub expires_at_ms: u64,
    pub relay_url: String,
}

pub struct RelayLink {
    tx: mpsc::UnboundedSender<Value>,
    rx: Mutex<mpsc::UnboundedReceiver<Value>>,
    pub session_id: String,
}

impl RelayLink {
    pub async fn send_json(&self, msg: Value) -> Result<(), AsperaError> {
        self.tx
            .send(msg)
            .map_err(|_| AsperaError::Message("Relay disconnected".into()))
    }

    pub async fn recv_json(&self) -> Result<Value, AsperaError> {
        let mut rx = self.rx.lock().await;
        rx.recv()
            .await
            .ok_or_else(|| AsperaError::Message("Relay closed".into()))
    }

    pub async fn request(&self, msg: Value, expect_type: &str) -> Result<Value, AsperaError> {
        self.send_json(msg).await?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(45);
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            if left.is_zero() {
                return Err(AsperaError::Message(format!(
                    "Timed out waiting for {expect_type} from phone"
                )));
            }
            let reply = tokio::time::timeout(left, self.recv_json())
                .await
                .map_err(|_| AsperaError::Message(format!("Timed out waiting for {expect_type}")))??;
            let t = reply.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if t == expect_type {
                return Ok(reply);
            }
            if t == "error" {
                let reason = reply
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("error");
                return Err(AsperaError::Message(format!("Relay/phone error: {reason}")));
            }
        }
    }
}

async fn open_socket(
    relay_url: &str,
) -> Result<(mpsc::UnboundedSender<Value>, mpsc::UnboundedReceiver<Value>), AsperaError> {
    let url = normalize_relay_url(relay_url);
    let (ws, _) = connect_async(&url).await.map_err(|e| {
        AsperaError::Message(format!(
            "Could not reach pairing relay ({url}): {e}. Deploy apps/relay or set relay URL."
        ))
    })?;
    let (mut sink, mut stream) = ws.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    let (in_tx, in_rx) = mpsc::unbounded_channel::<Value>();

    tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if sink
                .send(Message::Text(msg.to_string().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            if let Message::Text(t) = msg {
                if let Ok(v) = serde_json::from_str::<Value>(&t) {
                    if in_tx.send(v).is_err() {
                        break;
                    }
                }
            } else if matches!(msg, Message::Close(_)) {
                break;
            }
        }
    });

    Ok((out_tx, in_rx))
}

/// PC: create a cloud pairing session and return QR payload + live link.
pub async fn pc_create_session(
    relay_url: &str,
    pc_name: &str,
) -> Result<(CloudPairSession, Arc<RelayLink>), AsperaError> {
    let (out_tx, mut in_rx) = open_socket(relay_url).await?;
    out_tx
        .send(json!({
            "type": "create",
            "role": "pc",
            "name": pc_name,
        }))
        .map_err(|_| AsperaError::Message("Relay send failed".into()))?;

    let created = wait_for(&mut in_rx, "created", Duration::from_secs(20)).await?;
    let session_id = created
        .get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AsperaError::Message("Relay missing sessionId".into()))?
        .to_string();
    let secret = created
        .get("secret")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AsperaError::Message("Relay missing secret".into()))?
        .to_string();
    let expires = created
        .get("expiresInSec")
        .and_then(|v| v.as_u64())
        .unwrap_or(600);

    let offer = CloudPairOffer {
        v: 2,
        r: normalize_relay_url(relay_url),
        s: session_id.clone(),
        k: secret,
        n: pc_name.to_string(),
    };
    let qr_payload = format!(
        "aspera2:{}",
        serde_json::to_string(&offer).map_err(|e| AsperaError::Message(e.to_string()))?
    );
    let session = CloudPairSession {
        offer: offer.clone(),
        qr_payload,
        expires_at_ms: chrono::Utc::now().timestamp_millis() as u64 + expires * 1000,
        relay_url: offer.r.clone(),
    };

    Ok((
        session,
        Arc::new(RelayLink {
            tx: out_tx,
            rx: Mutex::new(in_rx),
            session_id,
        }),
    ))
}

/// Wait until phone joins (paired event).
pub async fn pc_wait_paired(link: &RelayLink) -> Result<(), AsperaError> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        if left.is_zero() {
            return Err(AsperaError::Message(
                "QR expired — phone did not scan in time".into(),
            ));
        }
        let msg = tokio::time::timeout(left, link.recv_json())
            .await
            .map_err(|_| AsperaError::Message("QR expired — phone did not scan in time".into()))??;
        match msg.get("type").and_then(|v| v.as_str()) {
            Some("paired") => return Ok(()),
            Some("error") => {
                let reason = msg
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("error");
                return Err(AsperaError::Message(format!("Relay error: {reason}")));
            }
            _ => {}
        }
    }
}

pub async fn relay_place_call(
    link: &RelayLink,
    number: &str,
    direct: bool,
) -> Result<String, AsperaError> {
    let ack = link
        .request(
            json!({
                "type": "placeCall",
                "number": number,
                "direct": direct,
            }),
            "placeCallAck",
        )
        .await?;
    if ack.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Ok(ack
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Calling")
            .to_string())
    } else {
        Err(AsperaError::Message(
            ack.get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Call failed")
                .to_string(),
        ))
    }
}

pub async fn relay_end_call(link: &RelayLink) -> Result<String, AsperaError> {
    let ack = link.request(json!({ "type": "endCall" }), "endCallAck").await?;
    if ack.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Ok(ack
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Call ended")
            .to_string())
    } else {
        Err(AsperaError::Message(
            ack.get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Hang up failed")
                .to_string(),
        ))
    }
}

pub async fn relay_list_contacts(link: &RelayLink) -> Result<Value, AsperaError> {
    let ack = link
        .request(json!({ "type": "listContacts" }), "contacts")
        .await?;
    if ack.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(AsperaError::Message(
            "Allow Contacts on the phone companion app, then sync again.".into(),
        ));
    }
    Ok(ack)
}

async fn wait_for(
    rx: &mut mpsc::UnboundedReceiver<Value>,
    expect: &str,
    timeout: Duration,
) -> Result<Value, AsperaError> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        if left.is_zero() {
            return Err(AsperaError::Message(format!(
                "Timed out waiting for {expect} from relay"
            )));
        }
        let msg = tokio::time::timeout(left, rx.recv())
            .await
            .map_err(|_| AsperaError::Message(format!("Timed out waiting for {expect}")))?
            .ok_or_else(|| AsperaError::Message("Relay closed".into()))?;
        if msg.get("type").and_then(|v| v.as_str()) == Some(expect) {
            return Ok(msg);
        }
        if msg.get("type").and_then(|v| v.as_str()) == Some("error") {
            let reason = msg
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("error");
            return Err(AsperaError::Message(format!("Relay error: {reason}")));
        }
    }
}

pub fn normalize_relay_url(url: &str) -> String {
    let u = url.trim().trim_end_matches('/');
    if u.starts_with("ws://") || u.starts_with("wss://") {
        u.to_string()
    } else if let Some(rest) = u.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = u.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("wss://{u}")
    }
}

pub fn parse_cloud_qr(raw: &str) -> Result<CloudPairOffer, AsperaError> {
    let text = raw.trim();
    let json = if let Some(rest) = text.strip_prefix("aspera2:") {
        rest
    } else if text.starts_with('{') {
        text
    } else {
        return Err(AsperaError::Message("Not an Aspera internet QR".into()));
    };
    let offer: CloudPairOffer = serde_json::from_str(json)
        .map_err(|_| AsperaError::Message("Invalid Aspera internet QR".into()))?;
    if offer.v != 2 || offer.s.is_empty() || offer.k.is_empty() || offer.r.is_empty() {
        return Err(AsperaError::Message("Incomplete Aspera internet QR".into()));
    }
    Ok(offer)
}
