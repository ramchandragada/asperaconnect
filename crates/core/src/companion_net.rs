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
    let stream = complete_hello(stream, pin, Some(name_hint)).await?;
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

async fn complete_hello(
    stream: TcpStream,
    pin: Option<&str>,
    client_name: Option<&str>,
) -> Result<TcpStream, AsperaError> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);

    let hello = json!({
        "type": "hello",
        "protocol": PROTOCOL_VERSION,
        "pin": pin.unwrap_or(""),
        "name": client_name.unwrap_or("PC"),
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

/// One-shot: hello + placeCall on the companion (no Developer Options / ADB).
pub async fn companion_place_call(
    host: &str,
    port: u16,
    pin: Option<&str>,
    number: &str,
    direct: bool,
) -> Result<String, AsperaError> {
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| AsperaError::Message(format!(
            "companion unreachable at {addr}: {e}. On the phone open Aspera Connect → Listen for PC."
        )))?;
    let stream = complete_hello(stream, pin, Some("Hub / click-to-call")).await?;
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);

    let req = json!({
        "type": "placeCall",
        "number": number,
        "direct": direct,
    });
    writer
        .write_all(format!("{req}\n").as_bytes())
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;

    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    let ack: serde_json::Value = serde_json::from_str(line.trim())
        .map_err(|e| AsperaError::Message(format!("bad placeCallAck: {e}")))?;
    if ack.get("type").and_then(|v| v.as_str()) != Some("placeCallAck") {
        return Err(AsperaError::Message(format!(
            "unexpected companion reply: {}",
            line.trim()
        )));
    }
    let ok = ack.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    let message = ack
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or(if ok { "Call requested" } else { "Call failed" })
        .to_string();
    if ok {
        Ok(format!("{message} (via Easy mode companion)"))
    } else {
        Err(AsperaError::Message(message))
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EasyMirrorReady {
    pub host: String,
    pub port: u16,
    pub width: u32,
    pub height: u32,
    pub codec: String,
}

/// One-shot: hello + startMirror. Phone must already have granted screen capture.
pub async fn companion_start_mirror(
    host: &str,
    port: u16,
    pin: Option<&str>,
) -> Result<EasyMirrorReady, AsperaError> {
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| AsperaError::Message(format!(
            "companion unreachable at {addr}: {e}. On the phone tap Listen for PC."
        )))?;
    let stream = complete_hello(stream, pin, Some("Easy mirror")).await?;
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);

    let req = json!({ "type": "startMirror" });
    writer
        .write_all(format!("{req}\n").as_bytes())
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;

    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    let ack: serde_json::Value = serde_json::from_str(line.trim())
        .map_err(|e| AsperaError::Message(format!("bad mirrorReady: {e}")))?;
    if ack.get("type").and_then(|v| v.as_str()) != Some("mirrorReady") {
        return Err(AsperaError::Message(format!(
            "unexpected companion reply: {}",
            line.trim()
        )));
    }
    let ok = ack.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        let reason = ack
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("mirror_failed");
        let hint = match reason {
            "need_screen_capture" => {
                "On the phone: tap “3. Allow screen capture”, accept the Android cast dialog, wait until it says Screen capture: ON, then try again."
            }
            "stream_start_failed" => {
                "Phone got capture permission but could not start the video stream. Stop on phone, tap step 3 again, then retry."
            }
            _ => "Could not start Easy mirror on the phone.",
        };
        return Err(AsperaError::Message(format!("{hint} ({reason})")));
    }
    Ok(EasyMirrorReady {
        host: host.to_string(),
        port: ack
            .get("port")
            .and_then(|v| v.as_u64())
            .unwrap_or(17892) as u16,
        width: ack.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        height: ack.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        codec: ack
            .get("codec")
            .and_then(|v| v.as_str())
            .unwrap_or("h264")
            .to_string(),
    })
}

pub async fn companion_stop_mirror(
    host: &str,
    port: u16,
    pin: Option<&str>,
) -> Result<(), AsperaError> {
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    let stream = complete_hello(stream, pin, Some("Easy mirror")).await?;
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    writer
        .write_all(b"{\"type\":\"stopMirror\"}\n")
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    let mut line = String::new();
    let _ = reader.read_line(&mut line).await;
    Ok(())
}

/// Send a nav / tap input event (requires Accessibility on the phone for gestures).
pub async fn companion_input(
    host: &str,
    port: u16,
    pin: Option<&str>,
    kind: &str,
    x: Option<f32>,
    y: Option<f32>,
) -> Result<(), AsperaError> {
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    let stream = complete_hello(stream, pin, Some("Easy input")).await?;
    let (_reader, mut writer) = stream.into_split();
    let mut req = json!({ "type": "input", "kind": kind });
    if let Some(xv) = x {
        req["x"] = json!(xv);
    }
    if let Some(yv) = y {
        req["y"] = json!(yv);
    }
    writer
        .write_all(format!("{req}\n").as_bytes())
        .await
        .map_err(|e| AsperaError::Message(e.to_string()))?;
    Ok(())
}

/// Spawn ffplay/mpv to show the Easy-mode H.264 TCP stream.
pub fn spawn_easy_mirror_player(host: &str, port: u16) -> Result<std::process::Child, AsperaError> {
    let url = format!("tcp://{host}:{port}");
    if let Ok(ffplay) = which::which("ffplay") {
        return std::process::Command::new(ffplay)
            .args([
                "-fflags",
                "nobuffer",
                "-flags",
                "low_delay",
                "-framedrop",
                "-probesize",
                "32",
                "-analyzeduration",
                "0",
                "-sync",
                "ext",
                "-window_title",
                "Aspera Connect — Easy mirror",
                "-f",
                "h264",
                &url,
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| AsperaError::Message(format!("ffplay failed: {e}")));
    }
    if let Ok(mpv) = which::which("mpv") {
        return std::process::Command::new(mpv)
            .args([
                "--no-cache",
                "--untimed",
                "--profile=low-latency",
                "--title=Aspera Connect — Easy mirror",
                &format!("--demuxer-lavf-format=h264"),
                &url,
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| AsperaError::Message(format!("mpv failed: {e}")));
    }
    Err(AsperaError::Message(
        "Install ffplay (sudo apt install ffmpeg) or mpv to view Easy mode mirror.".into(),
    ))
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
