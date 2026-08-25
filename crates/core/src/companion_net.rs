use crate::companion::{
    CompanionDevice, CompanionSessionState, DEFAULT_COMPANION_PORT, PROTOCOL_VERSION,
};
use crate::error::AsperaError;
use crate::notifications::{from_companion_json, PhoneNotification};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

type NotificationSender = mpsc::UnboundedSender<PhoneNotification>;

/// Connect to the Easy-mode companion control plane and complete Hello.
pub async fn connect_companion(
    host: &str,
    port: u16,
    pin: Option<&str>,
    name_hint: &str,
) -> Result<(CompanionSessionState, TcpStream), AsperaError> {
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| AsperaError::Message(format!("companion connect failed: {e}")))?;
    let stream = complete_hello(stream, pin).await?;
    let session = CompanionSessionState {
        connected: true,
        device: Some(CompanionDevice {
            id: format!("easy-{host}-{port}"),
            name: name_hint.to_string(),
            host: host.to_string(),
            port,
            protocol: PROTOCOL_VERSION,
            battery: None,
            model: Some("Easy mode".into()),
        }),
        mirroring: false,
        last_error: None,
    };
    Ok((session, stream))
}

async fn complete_hello(stream: TcpStream, pin: Option<&str>) -> Result<TcpStream, AsperaError> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);

    let hello = json!({
        "type": "hello",
        "protocol": PROTOCOL_VERSION,
        "pin": pin.unwrap_or(""),
    });
    writer
        .write_all(format!("{hello}\n").as_bytes())
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;

    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    let ack: serde_json::Value = serde_json::from_str(line.trim())
        .map_err(|e| AsperaError::Message(format!("bad helloAck: {e}")))?;
    if ack.get("type").and_then(|v| v.as_str()) != Some("helloAck")
        || ack.get("ok").and_then(|v| v.as_bool()) != Some(true)
    {
        let reason = ack
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("rejected");
        return Err(AsperaError::Message(format!(
            "companion hello failed: {reason}"
        )));
    }

    let stream = reader.into_inner().reunite(writer).map_err(|_| {
        AsperaError::Message("companion stream reunite failed".into())
    })?;
    Ok(stream)
}

/// Background reader for companion push messages (notifications, battery, etc.).
pub fn spawn_companion_reader(
    stream: TcpStream,
    tx: NotificationSender,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let (reader, _writer) = stream.into_split();
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                        if let Some(n) = from_companion_json(&value) {
                            let _ = tx.send(n);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    })
}

pub fn default_port() -> u16 {
    DEFAULT_COMPANION_PORT
}
