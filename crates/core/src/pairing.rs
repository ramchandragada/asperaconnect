use crate::adb::AdbClient;
use crate::error::AsperaError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    /// host:pairing_port from Wireless debugging UI
    pub host_port: String,
    pub pairing_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    /// host:connection_port (often different from pairing port)
    pub host_port: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairResult {
    pub paired: bool,
    pub message: String,
}

pub async fn pair_wireless(req: PairRequest) -> Result<PairResult, AsperaError> {
    let adb = AdbClient::new()?;
    if req.pairing_code.trim().len() < 6 {
        return Err(AsperaError::Pairing(
            "Enter the 6-digit pairing code from Wireless debugging.".into(),
        ));
    }
    let message = adb
        .pair(req.host_port.trim(), req.pairing_code.trim())
        .await
        .map_err(|e| AsperaError::Pairing(e.to_string()))?;
    Ok(PairResult {
        paired: true,
        message,
    })
}

pub async fn connect_wireless(req: ConnectRequest) -> Result<PairResult, AsperaError> {
    let adb = AdbClient::new()?;
    let message = adb.connect(req.host_port.trim()).await?;
    Ok(PairResult {
        paired: true,
        message,
    })
}

/// Build a QR payload string Android Wireless Debugging expects for pairing apps.
/// Format used by many tools: WIFI pairing info is OEM-specific; we expose a
/// structured JSON payload our UI can also show as fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WirelessQrPayload {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub pairing_code: Option<String>,
}

pub fn encode_qr_payload(payload: &WirelessQrPayload) -> String {
    serde_json::to_string(payload).unwrap_or_default()
}
