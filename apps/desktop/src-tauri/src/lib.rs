use aspera_core::adb::{AdbClient, PhoneApp};
use aspera_core::companion::CompanionSessionState;
use aspera_core::config::{AppConfig, MirrorProfile, MirrorProfileId};
use aspera_core::device::Device;
use aspera_core::discovery::discover_companions;
use aspera_core::error::{translate_error, AsperaError, UserFacingError};
use aspera_core::kdeconnect;
use aspera_core::mirror::{MirrorHandle, MirrorManager, MirrorOptions};
use aspera_core::notifications::{NotificationStore, PhoneNotification};
use aspera_core::pairing::{self, ConnectRequest, PairRequest, PairResult, WirelessQrPayload};
use aspera_core::qr_pair::{self, QrPairHub, QrPairSession};
use aspera_core::relay_client::{self, CloudPairSession, RelayLink};
use aspera_core::setup::run_setup_doctor;
use aspera_core::tools::{detect_tools, ToolsReport};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_notification::NotificationExt;

pub struct AppState {
    pub mirrors: MirrorManager,
    pub companion: Mutex<CompanionSessionState>,
    pub notifications: Mutex<NotificationStore>,
    pub companion_reader: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub notification_fanout: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub pending_call: Mutex<Option<String>>,
    pub easy_mirror: std::sync::Mutex<Option<std::process::Child>>,
    pub qr_pair: Arc<QrPairHub>,
    pub qr_pair_server: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub relay_link: Mutex<Option<Arc<RelayLink>>>,
    pub relay_wait: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

/// Keep tray menu items alive on Linux — dropping them makes GTK labels blank.
struct TrayMenuState {
    _menu: Menu<tauri::Wry>,
    _show: MenuItem<tauri::Wry>,
    _call_clipboard: MenuItem<tauri::Wry>,
    _quit: MenuItem<tauri::Wry>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            mirrors: MirrorManager::new(),
            companion: Mutex::new(CompanionSessionState::default()),
            notifications: Mutex::new(NotificationStore::default()),
            companion_reader: Mutex::new(None),
            notification_fanout: Mutex::new(None),
            pending_call: Mutex::new(None),
            easy_mirror: std::sync::Mutex::new(None),
            qr_pair: Arc::new(QrPairHub::default()),
            qr_pair_server: Mutex::new(None),
            relay_link: Mutex::new(None),
            relay_wait: Mutex::new(None),
        }
    }
}

fn emit_call_request(app: &AppHandle, number: &str) {
    let _ = app.emit("aspera://call", number);
    show_main_window(app);
}

fn handle_cli_call_args(app: &AppHandle, state: &AppState, args: &[String]) {
    if let Some(number) = aspera_core::phone_from_argv(args) {
        if let Ok(mut slot) = state.pending_call.try_lock() {
            *slot = Some(number.clone());
        }
        emit_call_request(app, &number);
    }
}

fn map_err(err: AsperaError) -> UserFacingError {
    translate_error(&err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult<T: Serialize> {
    ok: bool,
    data: Option<T>,
    error: Option<UserFacingError>,
}

impl<T: Serialize> CommandResult<T> {
    fn ok(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }
    fn err(err: AsperaError) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(map_err(err)),
        }
    }
}

#[tauri::command]
fn get_tools() -> ToolsReport {
    detect_tools()
}

#[tauri::command]
fn get_config() -> AppConfig {
    AppConfig::load()
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    config.save().map_err(|e| e.to_string())
}

#[tauri::command]
fn complete_first_run() -> Result<AppConfig, String> {
    let mut cfg = AppConfig::load();
    cfg.first_run_completed = true;
    cfg.save().map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
fn list_profiles() -> Vec<MirrorProfile> {
    MirrorProfile::all()
}

#[tauri::command]
async fn list_devices() -> CommandResult<Vec<Device>> {
    match AdbClient::new() {
        Ok(adb) => match adb.devices().await {
            Ok(d) => CommandResult::ok(d),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn refresh_and_select(serial: Option<String>) -> CommandResult<Device> {
    match AdbClient::new() {
        Ok(adb) => match adb.ensure_ready(serial.as_deref()).await {
            Ok(d) => {
                let mut cfg = AppConfig::load();
                cfg.last_device_serial = Some(d.serial.clone());
                let _ = cfg.save();
                CommandResult::ok(d)
            }
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn start_mirror(
    state: State<'_, Arc<AppState>>,
    serial: String,
    profile_id: MirrorProfileId,
    turn_screen_off: bool,
    stay_awake: bool,
    show_touches: bool,
    fullscreen: bool,
) -> Result<CommandResult<MirrorHandle>, ()> {
    let state = state.clone();
    let adb = match AdbClient::new() {
        Ok(a) => a,
        Err(e) => return Ok(CommandResult::err(e)),
    };
    let ready = match adb.ensure_ready(Some(&serial)).await {
        Ok(d) => d,
        Err(e) => return Ok(CommandResult::err(e)),
    };

    let cfg = AppConfig::load();
    let record_path = if cfg.record_mirror {
        let dir = AppConfig::recordings_dir();
        let _ = std::fs::create_dir_all(&dir);
        Some(
            dir.join(format!(
                "{}_{}.mp4",
                serial,
                chrono::Utc::now().format("%Y%m%d_%H%M%S")
            )),
        )
    } else {
        None
    };

    let options = MirrorOptions {
        serial: serial.clone(),
        profile: MirrorProfile::by_id(&profile_id),
        turn_screen_off,
        stay_awake,
        show_touches,
        fullscreen,
        window_title: Some(format!("Aspera Connect — {}", ready.display_name())),
        forward_audio: cfg.forward_audio,
        record_path,
        clipboard_sync: cfg.clipboard_sync,
        new_display: false,
        new_display_size: None,
        start_app: None,
        flex_display: false,
    };

    Ok(match state.mirrors.start(options).await {
        Ok(handle) => {
            let mut cfg = AppConfig::load();
            cfg.last_device_serial = Some(serial);
            cfg.preferred_profile = profile_id;
            cfg.turn_screen_off = turn_screen_off;
            cfg.stay_awake = stay_awake;
            cfg.show_touches = show_touches;
            let _ = cfg.save();
            CommandResult::ok(handle)
        }
        Err(e) => CommandResult::err(e),
    })
}

#[tauri::command]
async fn start_app_window(
    state: State<'_, Arc<AppState>>,
    serial: String,
    package: String,
    flex_display: Option<bool>,
) -> Result<CommandResult<MirrorHandle>, ()> {
    let state = state.clone();
    let adb = match AdbClient::new() {
        Ok(a) => a,
        Err(e) => return Ok(CommandResult::err(e)),
    };
    let ready = match adb.ensure_ready(Some(&serial)).await {
        Ok(d) => d,
        Err(e) => return Ok(CommandResult::err(e)),
    };

    let cfg = AppConfig::load();
    let pkg = package.trim().to_string();
    if pkg.is_empty() {
        return Ok(CommandResult::err(AsperaError::Message(
            "package name required".into(),
        )));
    }

    let short = pkg.rsplit('.').next().unwrap_or(pkg.as_str());
    let options = MirrorOptions {
        serial: serial.clone(),
        profile: MirrorProfile::by_id(&cfg.preferred_profile),
        turn_screen_off: false,
        stay_awake: true,
        show_touches: cfg.show_touches,
        fullscreen: false,
        window_title: Some(format!(
            "Aspera · {} — {}",
            short,
            ready.display_name()
        )),
        forward_audio: cfg.forward_audio,
        record_path: None,
        clipboard_sync: cfg.clipboard_sync,
        new_display: true,
        new_display_size: None,
        start_app: Some(pkg.clone()),
        flex_display: flex_display.unwrap_or(true),
    };

    Ok(match state.mirrors.start(options).await {
        Ok(handle) => {
            let mut cfg = AppConfig::load();
            cfg.last_device_serial = Some(serial);
            if !cfg.favorite_apps.contains(&pkg) {
                // keep favorites list; don't auto-add every launch
            }
            let _ = cfg.save();
            CommandResult::ok(handle)
        }
        Err(e) => CommandResult::err(e),
    })
}

#[tauri::command]
async fn list_phone_apps(serial: String) -> CommandResult<Vec<PhoneApp>> {
    match AdbClient::new() {
        Ok(adb) => match adb.list_packages(&serial).await {
            Ok(apps) => CommandResult::ok(apps),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn stop_mirror(state: State<'_, Arc<AppState>>, id: String) -> Result<CommandResult<()>, ()> {
    let state = state.clone();
    Ok(match state.mirrors.stop(&id).await {
        Ok(()) => CommandResult::ok(()),
        Err(e) => CommandResult::err(e),
    })
}

#[tauri::command]
async fn stop_all_mirrors(state: State<'_, Arc<AppState>>) -> Result<CommandResult<()>, ()> {
    let state = state.clone();
    Ok(match state.mirrors.stop_all().await {
        Ok(()) => CommandResult::ok(()),
        Err(e) => CommandResult::err(e),
    })
}

#[tauri::command]
async fn list_mirrors(state: State<'_, Arc<AppState>>) -> Result<Vec<MirrorHandle>, ()> {
    let state = state.clone();
    state.mirrors.reap_exited().await;
    Ok(state.mirrors.list().await)
}

#[tauri::command]
async fn pair_wireless(host_port: String, pairing_code: String) -> CommandResult<PairResult> {
    match pairing::pair_wireless(PairRequest {
        host_port,
        pairing_code,
    })
    .await
    {
        Ok(r) => CommandResult::ok(r),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn connect_wireless(host_port: String) -> CommandResult<PairResult> {
    match pairing::connect_wireless(ConnectRequest { host_port: host_port.clone() }).await {
        Ok(r) => {
            let mut cfg = AppConfig::load();
            if !cfg.known_wireless_endpoints.contains(&host_port) {
                cfg.known_wireless_endpoints.push(host_port);
                let _ = cfg.save();
            }
            CommandResult::ok(r)
        }
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
fn build_wireless_qr(host: String, port: u16, pairing_code: Option<String>) -> String {
    pairing::encode_qr_payload(&WirelessQrPayload {
        name: "Aspera Connect".into(),
        host,
        port,
        pairing_code,
    })
}

#[tauri::command]
async fn push_file(serial: String, local: String, remote: Option<String>) -> CommandResult<String> {
    let remote = remote.unwrap_or_else(|| {
        let name = std::path::Path::new(&local)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        format!("/sdcard/Download/{name}")
    });
    match AdbClient::new() {
        Ok(adb) => match adb.push(&serial, &local, &remote).await {
            Ok(s) => CommandResult::ok(s),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn pull_file(serial: String, remote: String, local: String) -> CommandResult<String> {
    match AdbClient::new() {
        Ok(adb) => match adb.pull(&serial, &remote, &local).await {
            Ok(s) => CommandResult::ok(s),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn list_photos(serial: String) -> CommandResult<Vec<String>> {
    match AdbClient::new() {
        Ok(adb) => match adb.list_photos(&serial).await {
            Ok(s) => CommandResult::ok(s),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoData {
    path: String,
    mime: String,
    base64: String,
    size: usize,
}

fn mime_for_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".heic") {
        "image/heic"
    } else {
        "image/jpeg"
    }
}

#[tauri::command]
async fn read_photo(serial: String, remote: String) -> CommandResult<PhotoData> {
    // ~8MB — enough for phone photos; larger files should use Save.
    const MAX: usize = 8 * 1024 * 1024;
    match AdbClient::new() {
        Ok(adb) => match adb.read_file_bytes(&serial, &remote, MAX).await {
            Ok(bytes) => {
                use base64::Engine;
                let engine = base64::engine::general_purpose::STANDARD;
                CommandResult::ok(PhotoData {
                    path: remote.clone(),
                    mime: mime_for_path(&remote).to_string(),
                    size: bytes.len(),
                    base64: engine.encode(&bytes),
                })
            }
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

/// Pull image and place on the Linux clipboard (wl-copy / xclip).
#[tauri::command]
async fn copy_photo_to_clipboard(serial: String, remote: String) -> CommandResult<String> {
    const MAX: usize = 12 * 1024 * 1024;
    let adb = match AdbClient::new() {
        Ok(a) => a,
        Err(e) => return CommandResult::err(e),
    };
    let bytes = match adb.read_file_bytes(&serial, &remote, MAX).await {
        Ok(b) => b,
        Err(e) => return CommandResult::err(e),
    };
    let mime = mime_for_path(&remote);
    let tmp = std::env::temp_dir().join(format!(
        "aspera-clip-{}",
        std::path::Path::new(&remote)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("photo.jpg")
    ));
    if let Err(e) = std::fs::write(&tmp, &bytes) {
        return CommandResult::err(AsperaError::Message(e.to_string()));
    }

    // Prefer Wayland wl-copy, then xclip, then xsel.
    let copied = copy_image_file_to_clipboard(&tmp, mime).await;
    let _ = std::fs::remove_file(&tmp);
    match copied {
        Ok(()) => CommandResult::ok("Photo copied — paste with Ctrl+V in any app".into()),
        Err(e) => CommandResult::err(e),
    }
}

async fn copy_image_file_to_clipboard(
    path: &std::path::Path,
    mime: &str,
) -> Result<(), AsperaError> {
    use tokio::io::AsyncWriteExt;
    use tokio::process::Command;

    let bytes = std::fs::read(path).map_err(|e| AsperaError::Message(e.to_string()))?;

    if which::which("wl-copy").is_ok() {
        let mut child = Command::new("wl-copy")
            .args(["-t", mime])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| AsperaError::Message(e.to_string()))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(&bytes)
                .await
                .map_err(|e| AsperaError::Message(e.to_string()))?;
        }
        let status = child
            .wait()
            .await
            .map_err(|e| AsperaError::Message(e.to_string()))?;
        if status.success() {
            return Ok(());
        }
    }

    if which::which("xclip").is_ok() {
        let mut child = Command::new("xclip")
            .args(["-selection", "clipboard", "-t", mime, "-i"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| AsperaError::Message(e.to_string()))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(&bytes)
                .await
                .map_err(|e| AsperaError::Message(e.to_string()))?;
        }
        let status = child
            .wait()
            .await
            .map_err(|e| AsperaError::Message(e.to_string()))?;
        if status.success() {
            return Ok(());
        }
    }

    Err(AsperaError::Message(
        "Could not set image clipboard. Install: sudo apt install wl-clipboard   (or xclip)".into(),
    ))
}

/// Read plain text from the desktop clipboard (wl-paste / xclip / xsel).
async fn read_system_clipboard_text() -> Result<String, AsperaError> {
    use tokio::process::Command;

    if which::which("wl-paste").is_ok() {
        let out = Command::new("wl-paste")
            .arg("-n")
            .output()
            .await
            .map_err(|e| AsperaError::Message(e.to_string()))?;
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() {
                return Ok(text);
            }
        }
    }

    if which::which("xclip").is_ok() {
        let out = Command::new("xclip")
            .args(["-selection", "clipboard", "-o"])
            .output()
            .await
            .map_err(|e| AsperaError::Message(e.to_string()))?;
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() {
                return Ok(text);
            }
        }
    }

    if which::which("xsel").is_ok() {
        let out = Command::new("xsel")
            .args(["--clipboard", "--output"])
            .output()
            .await
            .map_err(|e| AsperaError::Message(e.to_string()))?;
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() {
                return Ok(text);
            }
        }
    }

    Err(AsperaError::Message(
        "Could not read clipboard. Copy a phone number first, then try again. \
         If needed: sudo apt install wl-clipboard (Wayland) or xclip (X11)."
            .into(),
    ))
}

#[tauri::command]
async fn read_system_clipboard() -> CommandResult<String> {
    match read_system_clipboard_text().await {
        Ok(s) => CommandResult::ok(s),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn get_device_clipboard(serial: String) -> CommandResult<String> {
    match AdbClient::new() {
        Ok(adb) => match adb.get_clipboard(&serial).await {
            Ok(s) => CommandResult::ok(s),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn set_device_clipboard(serial: String, text: String) -> CommandResult<()> {
    match AdbClient::new() {
        Ok(adb) => match adb.set_clipboard(&serial, &text).await {
            Ok(()) => CommandResult::ok(()),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn share_text_to_phone(serial: String, text: String) -> CommandResult<()> {
    match AdbClient::new() {
        Ok(adb) => match adb.share_text(&serial, &text).await {
            Ok(()) => CommandResult::ok(()),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn compose_sms(serial: String, number: String, body: String) -> CommandResult<()> {
    match AdbClient::new() {
        Ok(adb) => match adb.send_sms_intent(&serial, &number, &body).await {
            Ok(()) => CommandResult::ok(()),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn place_call(
    state: State<'_, Arc<AppState>>,
    serial: Option<String>,
    number: String,
    direct: Option<bool>,
) -> Result<CommandResult<String>, ()> {
    let direct = direct.unwrap_or(true);
    let number = match aspera_core::normalize_phone_number(&number) {
        Ok(n) => n,
        Err(e) => return Ok(CommandResult::err(e)),
    };

    if let Ok(adb) = AdbClient::new() {
        if let Ok(device) = adb.ensure_ready(serial.as_deref()).await {
            if let Ok(msg) = adb.place_call(&device.serial, &number, direct).await {
                let mut cfg = AppConfig::load();
                cfg.last_device_serial = Some(device.serial);
                let _ = cfg.save();
                return Ok(CommandResult::ok(msg));
            }
        }
    }

    let link = state.relay_link.lock().await.clone();
    if let Some(link) = link {
        return Ok(match relay_client::relay_place_call(&link, &number, direct).await {
            Ok(msg) => CommandResult::ok(msg),
            Err(e) => CommandResult::err(e),
        });
    }

    let cfg = AppConfig::load();
    let Some(host) = cfg.companion_host.clone() else {
        return Ok(CommandResult::err(AsperaError::Message(
            "No phone linked. Tap Show QR to pair (works across networks), or Connect with a LAN IP."
                .into(),
        )));
    };
    Ok(
        match aspera_core::companion_net::companion_place_call(
            &host,
            aspera_core::companion::DEFAULT_COMPANION_PORT,
            cfg.companion_pin.as_deref(),
            &number,
            direct,
        )
        .await
        {
            Ok(msg) => CommandResult::ok(msg),
            Err(e) => CommandResult::err(e),
        },
    )
}

#[tauri::command]
async fn companion_place_call(
    state: State<'_, Arc<AppState>>,
    host: Option<String>,
    number: String,
    direct: Option<bool>,
) -> Result<CommandResult<String>, ()> {
    let direct = direct.unwrap_or(true);
    let number = match aspera_core::normalize_phone_number(&number) {
        Ok(n) => n,
        Err(e) => return Ok(CommandResult::err(e)),
    };
    let link = state.relay_link.lock().await.clone();
    if let Some(link) = link {
        return Ok(match relay_client::relay_place_call(&link, &number, direct).await {
            Ok(msg) => CommandResult::ok(msg),
            Err(e) => CommandResult::err(e),
        });
    }
    let cfg = AppConfig::load();
    let host = host.or(cfg.companion_host.clone()).unwrap_or_default();
    if host.is_empty() {
        return Ok(CommandResult::err(AsperaError::Message(
            "No phone linked — Show QR to pair first".into(),
        )));
    }
    Ok(
        match aspera_core::companion_net::companion_place_call(
            &host,
            aspera_core::companion::DEFAULT_COMPANION_PORT,
            cfg.companion_pin.as_deref(),
            &number,
            direct,
        )
        .await
        {
            Ok(msg) => CommandResult::ok(msg),
            Err(e) => CommandResult::err(e),
        },
    )
}

#[tauri::command]
async fn companion_end_call(
    state: State<'_, Arc<AppState>>,
    host: Option<String>,
) -> Result<CommandResult<String>, ()> {
    let link = state.relay_link.lock().await.clone();
    if let Some(link) = link {
        return Ok(match relay_client::relay_end_call(&link).await {
            Ok(msg) => CommandResult::ok(msg),
            Err(e) => CommandResult::err(e),
        });
    }
    let cfg = AppConfig::load();
    let host = host.or(cfg.companion_host.clone()).unwrap_or_default();
    if host.is_empty() {
        return Ok(CommandResult::err(AsperaError::Message(
            "No phone linked — Show QR to pair first".into(),
        )));
    }
    Ok(
        match aspera_core::companion_net::companion_end_call(
            &host,
            aspera_core::companion::DEFAULT_COMPANION_PORT,
            cfg.companion_pin.as_deref(),
        )
        .await
        {
            Ok(msg) => CommandResult::ok(msg),
            Err(e) => CommandResult::err(e),
        },
    )
}

#[tauri::command]
async fn sync_phone_contacts(
    state: State<'_, Arc<AppState>>,
    host: Option<String>,
) -> Result<CommandResult<aspera_core::ContactsCache>, ()> {
    let link = state.relay_link.lock().await.clone();
    if let Some(link) = link {
        return Ok(match relay_client::relay_list_contacts(&link).await {
            Ok(ack) => {
                let contacts: Vec<aspera_core::PhoneContact> = serde_json::from_value(
                    ack.get("contacts")
                        .cloned()
                        .unwrap_or(serde_json::json!([])),
                )
                .unwrap_or_default();
                let cache = aspera_core::ContactsCache {
                    synced_at: Some(chrono::Utc::now().to_rfc3339()),
                    host: Some(format!("relay:{}", link.session_id)),
                    contacts,
                };
                match cache.save() {
                    Ok(()) => CommandResult::ok(cache),
                    Err(e) => CommandResult::err(e),
                }
            }
            Err(e) => CommandResult::err(e),
        });
    }
    let cfg = AppConfig::load();
    let host = host.or(cfg.companion_host.clone()).unwrap_or_default();
    if host.is_empty() {
        return Ok(CommandResult::err(AsperaError::Message(
            "No phone linked — Show QR to pair first".into(),
        )));
    }
    Ok(
        match aspera_core::companion_net::companion_list_contacts(
            &host,
            aspera_core::companion::DEFAULT_COMPANION_PORT,
            cfg.companion_pin.as_deref(),
        )
        .await
        {
            Ok(contacts) => {
                let cache = aspera_core::ContactsCache {
                    synced_at: Some(chrono::Utc::now().to_rfc3339()),
                    host: Some(host),
                    contacts,
                };
                match cache.save() {
                    Ok(()) => CommandResult::ok(cache),
                    Err(e) => CommandResult::err(e),
                }
            }
            Err(e) => CommandResult::err(e),
        },
    )
}

#[tauri::command]
fn load_cached_contacts() -> aspera_core::ContactsCache {
    aspera_core::ContactsCache::load()
}

#[tauri::command]
fn load_call_history() -> aspera_core::CallHistory {
    aspera_core::CallHistory::load()
}

#[tauri::command]
fn record_call_history(
    name: String,
    number: String,
    outcome: String,
) -> CommandResult<aspera_core::CallHistory> {
    let outcome = match outcome.as_str() {
        "ended" => aspera_core::CallOutcome::Ended,
        "failed" => aspera_core::CallOutcome::Failed,
        _ => aspera_core::CallOutcome::Dialed,
    };
    match aspera_core::CallHistory::record(&name, &number, outcome) {
        Ok(h) => CommandResult::ok(h),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
fn clear_call_history() -> CommandResult<aspera_core::CallHistory> {
    match aspera_core::CallHistory::clear() {
        Ok(h) => CommandResult::ok(h),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
fn load_favorites() -> aspera_core::FavoritesStore {
    aspera_core::FavoritesStore::load()
}

#[tauri::command]
fn toggle_favorite(
    id: String,
    name: String,
    number: String,
) -> CommandResult<aspera_core::FavoritesStore> {
    match aspera_core::FavoritesStore::toggle(&id, &name, &number) {
        Ok(s) => CommandResult::ok(s),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn companion_start_mirror(
    state: State<'_, Arc<AppState>>,
    host: Option<String>,
) -> Result<CommandResult<aspera_core::companion_net::EasyMirrorReady>, ()> {
    let cfg = AppConfig::load();
    let host = host
        .or(cfg.companion_host.clone())
        .unwrap_or_default();
    if host.is_empty() {
        return Ok(CommandResult::err(AsperaError::Message(
            "Set companion IP in Easy mode first".into(),
        )));
    }
    // Stop previous Easy mirror player if any.
    {
        let mut slot = state.easy_mirror.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(
        match aspera_core::companion_net::companion_start_mirror(
            &host,
            aspera_core::companion::DEFAULT_COMPANION_PORT,
            cfg.companion_pin.as_deref(),
        )
        .await
        {
            Ok(info) => {
                // Brief pause so encoder has a keyframe ready.
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                match aspera_core::companion_net::spawn_easy_mirror_player(&info.host, info.port) {
                    Ok(child) => {
                        *state
                            .easy_mirror
                            .lock()
                            .unwrap_or_else(|e| e.into_inner()) = Some(child);
                        let mut session = state.companion.lock().await;
                        session.mirroring = true;
                        session.last_error = None;
                        CommandResult::ok(info)
                    }
                    Err(e) => CommandResult::err(e),
                }
            }
            Err(e) => CommandResult::err(e),
        },
    )
}

#[tauri::command]
async fn companion_stop_mirror(
    state: State<'_, Arc<AppState>>,
    host: Option<String>,
) -> Result<CommandResult<String>, ()> {
    let cfg = AppConfig::load();
    let host = host
        .or(cfg.companion_host.clone())
        .unwrap_or_default();
    {
        let mut slot = state.easy_mirror.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if !host.is_empty() {
        let _ = aspera_core::companion_net::companion_stop_mirror(
            &host,
            aspera_core::companion::DEFAULT_COMPANION_PORT,
            cfg.companion_pin.as_deref(),
        )
        .await;
    }
    let mut session = state.companion.lock().await;
    session.mirroring = false;
    Ok(CommandResult::ok("Easy mirror stopped".into()))
}

#[tauri::command]
async fn companion_input(
    host: Option<String>,
    kind: String,
    x: Option<f32>,
    y: Option<f32>,
) -> CommandResult<String> {
    let cfg = AppConfig::load();
    let host = host
        .or(cfg.companion_host.clone())
        .unwrap_or_default();
    if host.is_empty() {
        return CommandResult::err(AsperaError::Message(
            "Set companion IP in Easy mode first".into(),
        ));
    }
    match aspera_core::companion_net::companion_input(
        &host,
        aspera_core::companion::DEFAULT_COMPANION_PORT,
        cfg.companion_pin.as_deref(),
        &kind,
        x,
        y,
    )
    .await
    {
        Ok(()) => CommandResult::ok(format!("sent {kind}")),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn open_phone_app(serial: Option<String>) -> CommandResult<String> {
    let adb = match AdbClient::new() {
        Ok(a) => a,
        Err(e) => return CommandResult::err(e),
    };
    let device = match adb.ensure_ready(serial.as_deref()).await {
        Ok(d) => d,
        Err(e) => return CommandResult::err(e),
    };
    match adb.open_phone_app(&device.serial).await {
        Ok(msg) => CommandResult::ok(msg),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
fn parse_call_uri(uri: String) -> CommandResult<String> {
    match aspera_core::parse_phone_uri(&uri) {
        Some(n) => CommandResult::ok(n),
        None => match aspera_core::normalize_phone_number(&uri) {
            Ok(n) => CommandResult::ok(n),
            Err(e) => CommandResult::err(e),
        },
    }
}

#[tauri::command]
async fn take_pending_call(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, ()> {
    Ok(state.pending_call.lock().await.take())
}

/// Register Aspera as the default handler for tel: and callto: (Linux).
#[tauri::command]
fn register_tel_handler() -> CommandResult<String> {
    #[cfg(target_os = "linux")]
    {
        match register_tel_handler_linux() {
            Ok(msg) => CommandResult::ok(msg),
            Err(e) => CommandResult::err(e),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        CommandResult::err(AsperaError::Message(
            "tel: handler registration is only supported on Linux".into(),
        ))
    }
}

#[cfg(target_os = "linux")]
fn register_tel_handler_linux() -> Result<String, AsperaError> {
    // Prefer a small ADB dialer script — never register the current Tauri exe
    // (debug builds expect Vite on localhost and show "Connection refused").
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let bin_dir = home.join(".local/bin");
    let apps = home.join(".local/share/applications");
    std::fs::create_dir_all(&bin_dir).map_err(|e| AsperaError::Message(e.to_string()))?;
    std::fs::create_dir_all(&apps).map_err(|e| AsperaError::Message(e.to_string()))?;

    const SCRIPT: &str = include_str!("../../../../packaging/linux/aspera-tel");
    let script_path = bin_dir.join("aspera-tel");
    std::fs::write(&script_path, SCRIPT).map_err(|e| AsperaError::Message(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script_path)
            .map_err(|e| AsperaError::Message(e.to_string()))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms)
            .map_err(|e| AsperaError::Message(e.to_string()))?;
    }

    let script = script_path.to_string_lossy();
    let desktop_path = apps.join("aspera-connect-tel.desktop");
    let contents = format!(
        "[Desktop Entry]\n\
Name=Aspera Connect Call\n\
Comment=Place calls via connected Android phone\n\
Exec={script} %u\n\
Icon=phone\n\
Terminal=false\n\
Type=Application\n\
Categories=Network;Telephony;\n\
MimeType=x-scheme-handler/tel;x-scheme-handler/callto;\n\
StartupNotify=false\n"
    );
    std::fs::write(&desktop_path, contents).map_err(|e| AsperaError::Message(e.to_string()))?;

    let _ = std::process::Command::new("update-desktop-database")
        .arg(&apps)
        .status();
    for scheme in ["x-scheme-handler/tel", "x-scheme-handler/callto"] {
        let _ = std::process::Command::new("xdg-mime")
            .args(["default", "aspera-connect-tel.desktop", scheme])
            .status();
    }
    Ok(
        "Registered Aspera Connect Call for tel: / callto: links. Keep the desktop app connected, then click numbers in Zoho or your browser."
            .into(),
    )
}

#[tauri::command]
async fn adb_kill_server() -> CommandResult<()> {
    match AdbClient::new() {
        Ok(adb) => match adb.kill_server().await {
            Ok(()) => CommandResult::ok(()),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn adb_start_server() -> CommandResult<()> {
    match AdbClient::new() {
        Ok(adb) => match adb.start_server().await {
            Ok(()) => CommandResult::ok(()),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn kde_status() -> kdeconnect::KdeStatus {
    kdeconnect::status().await
}

#[tauri::command]
async fn kde_ping(device_id: String) -> CommandResult<()> {
    match kdeconnect::ping(&device_id).await {
        Ok(()) => CommandResult::ok(()),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn kde_ring(device_id: String) -> CommandResult<()> {
    match kdeconnect::ring(&device_id).await {
        Ok(()) => CommandResult::ok(()),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn kde_share(device_id: String, path: String) -> CommandResult<()> {
    match kdeconnect::share_file(&device_id, &path).await {
        Ok(()) => CommandResult::ok(()),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn kde_share_text(device_id: String, text: String) -> CommandResult<()> {
    match kdeconnect::share_text(&device_id, &text).await {
        Ok(()) => CommandResult::ok(()),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn kde_send_sms(device_id: String, number: String, body: String) -> CommandResult<()> {
    match kdeconnect::send_sms(&device_id, &number, &body).await {
        Ok(()) => CommandResult::ok(()),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn kde_pull_notifications(
    state: State<'_, Arc<AppState>>,
    device_id: String,
) -> Result<CommandResult<Vec<PhoneNotification>>, ()> {
    let state = state.clone();
    Ok(match kdeconnect::fetch_notifications(&device_id).await {
        Ok(items) => {
            let mut store = state.notifications.lock().await;
            for n in &items {
                store.push(n.clone());
            }
            CommandResult::ok(items)
        }
        Err(e) => CommandResult::err(e),
    })
}

#[tauri::command]
async fn send_sms_smart(
    number: String,
    body: String,
    serial: Option<String>,
    kde_device_id: Option<String>,
) -> CommandResult<String> {
    let cfg = AppConfig::load();
    if cfg.kdeconnect_enabled {
        let target = if let Some(id) = kde_device_id.filter(|s| !s.is_empty()) {
            Some(id)
        } else if let Ok(devices) = kdeconnect::list_devices().await {
            devices.into_iter().find(|d| d.reachable).map(|d| d.id)
        } else {
            None
        };

        if let Some(id) = target {
            if let Ok(()) = kdeconnect::send_sms(&id, &number, &body).await {
                return CommandResult::ok("Sent via KDE Connect".into());
            }
        }
    }

    let Some(serial) = serial.filter(|s| !s.is_empty()) else {
        return CommandResult::err(AsperaError::Message(
            "No KDE Connect device and no ADB serial for SMS composer".into(),
        ));
    };
    match AdbClient::new() {
        Ok(adb) => match adb.send_sms_intent(&serial, &number, &body).await {
            Ok(()) => CommandResult::ok("Opened SMS composer on phone".into()),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
fn set_favorite_apps(packages: Vec<String>) -> Result<AppConfig, String> {
    let mut cfg = AppConfig::load();
    cfg.favorite_apps = packages;
    cfg.save().map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
async fn get_companion_state(state: State<'_, Arc<AppState>>) -> Result<CompanionSessionState, ()> {
    let state = state.clone();
    let session = state.companion.lock().await.clone();
    Ok(session)
}

#[tauri::command]
fn set_companion_pin(pin: String) -> Result<AppConfig, String> {
    let mut cfg = AppConfig::load();
    cfg.companion_pin = if pin.is_empty() { None } else { Some(pin) };
    cfg.save().map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
fn get_setup_report() -> aspera_core::SetupReport {
    run_setup_doctor()
}

#[tauri::command]
async fn discover_companion_devices() -> CommandResult<Vec<aspera_core::companion::CompanionDevice>> {
    match discover_companions().await {
        Ok(d) => CommandResult::ok(d),
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn list_notifications(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<PhoneNotification>, ()> {
    Ok(state.notifications.lock().await.list())
}

#[tauri::command]
async fn mark_notification_read(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), ()> {
    state.notifications.lock().await.mark_read(&id);
    Ok(())
}

#[tauri::command]
async fn clear_notifications(state: State<'_, Arc<AppState>>) -> Result<(), ()> {
    state.notifications.lock().await.clear();
    Ok(())
}

#[tauri::command]
fn set_device_nickname(serial: String, nickname: String) -> Result<AppConfig, String> {
    let mut cfg = AppConfig::load();
    if nickname.trim().is_empty() {
        cfg.device_nicknames.remove(&serial);
    } else {
        cfg.device_nicknames.insert(serial, nickname.trim().to_string());
    }
    cfg.save().map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
async fn install_apk(serial: String, local: String) -> CommandResult<String> {
    match AdbClient::new() {
        Ok(adb) => match adb.install_apk(&serial, &local).await {
            Ok(s) => CommandResult::ok(s),
            Err(e) => CommandResult::err(e),
        },
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn push_files(serial: String, paths: Vec<String>) -> CommandResult<Vec<String>> {
    match AdbClient::new() {
        Ok(adb) => {
            let mut results = Vec::new();
            for path in paths {
                let name = std::path::Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file");
                let remote = format!("/sdcard/Download/{name}");
                match adb.push(&serial, &path, &remote).await {
                    Ok(r) => results.push(r),
                    Err(e) => return CommandResult::err(e),
                }
            }
            CommandResult::ok(results)
        }
        Err(e) => CommandResult::err(e),
    }
}

#[tauri::command]
async fn start_qr_pairing(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<CommandResult<CloudPairSession>, ()> {
    // Prefer WhatsApp-style cloud relay (works across networks).
    if let Some(h) = state.relay_wait.lock().await.take() {
        h.abort();
    }
    *state.relay_link.lock().await = None;

    let cfg = AppConfig::load();
    let relay_url = std::env::var("ASPERA_RELAY_URL").unwrap_or(cfg.relay_url.clone());
    let pc_name = hostname_fallback();
    let (session, link) = match relay_client::pc_create_session(&relay_url, &pc_name).await {
        Ok(v) => v,
        Err(e) => return Ok(CommandResult::err(e)),
    };
    *state.relay_link.lock().await = Some(link.clone());

    let app2 = app.clone();
    let state_link = state.inner().clone();
    let handle = tokio::spawn(async move {
        match relay_client::pc_wait_paired(&link).await {
            Ok(()) => {
                let mut cfg = AppConfig::load();
                cfg.relay_linked = true;
                cfg.companion_host = Some(format!("relay:{}", link.session_id));
                let _ = cfg.save();
                let mut session = CompanionSessionState::default();
                session.connected = true;
                session.device = Some(aspera_core::companion::CompanionDevice {
                    id: format!("relay-{}", link.session_id),
                    name: "Phone (internet)".into(),
                    host: format!("relay:{}", link.session_id),
                    port: 0,
                    protocol: aspera_core::companion::PROTOCOL_VERSION,
                    battery: None,
                    model: Some("Cloud QR".into()),
                });
                *state_link.companion.lock().await = session.clone();
                let _ = app2.emit("aspera://cloud-paired", session);
            }
            Err(e) => {
                let _ = app2.emit(
                    "aspera://cloud-pair-failed",
                    e.to_string(),
                );
            }
        }
    });
    *state.relay_wait.lock().await = Some(handle);
    Ok(CommandResult::ok(session))
}

#[tauri::command]
async fn start_lan_qr_pairing(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<CommandResult<QrPairSession>, ()> {
    let hub = state.qr_pair.clone();
    hub.stop().await;
    if let Some(h) = state.qr_pair_server.lock().await.take() {
        h.abort();
    }
    let pc_name = hostname_fallback();
    let session = match hub.start(&pc_name).await {
        Ok(s) => s,
        Err(e) => return Ok(CommandResult::err(e)),
    };

    let hub_server = hub.clone();
    let server = tokio::spawn(async move {
        let _ = qr_pair::run_qr_pair_server(hub_server).await;
    });
    *state.qr_pair_server.lock().await = Some(server);

    let hub_wait = hub.clone();
    tokio::spawn(async move {
        if let Some(phone) = hub_wait
            .wait_result(std::time::Duration::from_secs(qr_pair::QR_PAIR_TTL_SECS))
            .await
        {
            let _ = app.emit("aspera://qr-paired", phone);
        }
    });

    Ok(CommandResult::ok(session))
}

#[tauri::command]
async fn stop_qr_pairing(state: State<'_, Arc<AppState>>) -> Result<(), ()> {
    state.qr_pair.stop().await;
    if let Some(h) = state.qr_pair_server.lock().await.take() {
        h.abort();
    }
    if let Some(h) = state.relay_wait.lock().await.take() {
        h.abort();
    }
    // Keep relay_link if already paired; only clear when cancelling before pair.
    Ok(())
}

fn hostname_fallback() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        })
        .unwrap_or_else(|| "Aspera PC".into())
}

#[tauri::command]
async fn companion_hello(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    host: String,
    pin: Option<String>,
    name: String,
) -> Result<CommandResult<CompanionSessionState>, ()> {
    let app_state = state.inner().clone();

    if let Some(h) = app_state.companion_reader.lock().await.take() {
        h.abort();
    }
    if let Some(h) = app_state.notification_fanout.lock().await.take() {
        h.abort();
    }

    Ok(
        match aspera_core::companion_net::connect_companion(
            &host,
            aspera_core::companion::DEFAULT_COMPANION_PORT,
            pin.as_deref(),
            &name,
        )
        .await
        {
            Ok((session, stream)) => {
                *app_state.companion.lock().await = session.clone();
                let mut cfg = AppConfig::load();
                cfg.companion_host = Some(host.clone());
                cfg.companion_name = Some(name.clone());
                if let Some(p) = pin.clone() {
                    cfg.companion_pin = if p.is_empty() { None } else { Some(p) };
                }
                let _ = cfg.save();

                let (tx, mut rx) = mpsc::unbounded_channel::<PhoneNotification>();
                let state2 = app_state.clone();
                let app2 = app.clone();
                let fanout = tokio::spawn(async move {
                    while let Some(n) = rx.recv().await {
                        let cfg = AppConfig::load();
                        if cfg
                            .notification_muted_apps
                            .iter()
                            .any(|a| n.app.contains(a))
                        {
                            continue;
                        }
                        state2.notifications.lock().await.push(n.clone());
                        let _ = app2.emit("notifications://new", &n);
                        let _ = app2
                            .notification()
                            .builder()
                            .title(&n.title)
                            .body(&n.body)
                            .show();
                    }
                });
                *app_state.notification_fanout.lock().await = Some(fanout);

                let reader = aspera_core::companion_net::spawn_companion_reader(stream, tx);
                let drop_state = app_state.clone();
                let drop_app = app.clone();
                let watcher = tokio::spawn(async move {
                    let _ = reader.await;
                    *drop_state.companion.lock().await = CompanionSessionState {
                        connected: false,
                        device: None,
                        mirroring: false,
                        last_error: Some("Disconnected from phone".into()),
                    };
                    let _ = drop_app.emit("companion://status", false);
                });
                *app_state.companion_reader.lock().await = Some(watcher);

                let _ = app.emit("companion://status", true);
                CommandResult::ok(session)
            }
            Err(e) => CommandResult::err(e),
        },
    )
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Aspera Connect", true, None::<&str>)?;
    let call_clip =
        MenuItem::with_id(app, "call_clipboard", "Call from clipboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &call_clip, &quit])?;

    let tray = TrayIconBuilder::with_id("aspera-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Aspera Connect — click-to-call")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => show_main_window(app),
            "call_clipboard" => {
                show_main_window(app);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit("tray://call-clipboard", ());
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    // Must outlive setup() on Linux or tray menu text goes blank (DBUS menu labels dropped).
    app.manage(TrayMenuState {
        _menu: menu,
        _show: show,
        _call_clipboard: call_clip,
        _quit: quit,
    });
    app.manage(tray);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(AppState::default());
    let state_for_si = state.clone();

    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(move |app, argv, _cwd| {
            // Menu/icon launch while already running (tray) must raise the window.
            show_main_window(app);
            handle_cli_call_args(app, state_for_si.as_ref(), &argv);
        }));
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(state.clone())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            setup_tray(app.handle())?;
            let args: Vec<String> = std::env::args().collect();
            handle_cli_call_args(app.handle(), state.as_ref(), &args);
            Ok(())
        })
        // Closing the window only hides it — process + phone link stay alive in the tray.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_tools,
            get_config,
            save_config,
            complete_first_run,
            list_profiles,
            list_devices,
            refresh_and_select,
            start_mirror,
            start_app_window,
            list_phone_apps,
            stop_mirror,
            stop_all_mirrors,
            list_mirrors,
            pair_wireless,
            connect_wireless,
            build_wireless_qr,
            push_file,
            pull_file,
            list_photos,
            read_photo,
            copy_photo_to_clipboard,
            read_system_clipboard,
            get_device_clipboard,
            set_device_clipboard,
            share_text_to_phone,
            compose_sms,
            place_call,
            companion_place_call,
            companion_end_call,
            sync_phone_contacts,
            load_cached_contacts,
            load_call_history,
            record_call_history,
            clear_call_history,
            load_favorites,
            toggle_favorite,
            companion_start_mirror,
            companion_stop_mirror,
            companion_input,
            open_phone_app,
            parse_call_uri,
            take_pending_call,
            register_tel_handler,
            send_sms_smart,
            adb_kill_server,
            adb_start_server,
            kde_status,
            kde_ping,
            kde_ring,
            kde_share,
            kde_share_text,
            kde_send_sms,
            kde_pull_notifications,
            get_companion_state,
            set_companion_pin,
            companion_hello,
            start_qr_pairing,
            start_lan_qr_pairing,
            stop_qr_pairing,
            get_setup_report,
            discover_companion_devices,
            list_notifications,
            mark_notification_read,
            clear_notifications,
            set_device_nickname,
            set_favorite_apps,
            install_apk,
            push_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Aspera Connect")
        .run(|_app_handle, event| {
            // Don't quit when the last window is hidden; only Exit from the tray menu.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
