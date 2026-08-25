use crate::device::{Device, DeviceState};
use crate::error::AsperaError;
use crate::tools::require_adb;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneApp {
    pub package: String,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct AdbClient {
    adb_path: PathBuf,
}

impl AdbClient {
    pub fn new() -> Result<Self, AsperaError> {
        Ok(Self {
            adb_path: require_adb()?,
        })
    }

    pub fn from_path(path: PathBuf) -> Self {
        Self { adb_path: path }
    }

    pub async fn devices(&self) -> Result<Vec<Device>, AsperaError> {
        let output = self.run(&["devices", "-l"]).await?;
        let mut devices = Vec::new();
        for line in output.lines().skip(1) {
            if let Some(mut d) = Device::from_adb_line(line) {
                if d.state.is_ready() || d.state == DeviceState::Unauthorized {
                    if let Ok(brand) = self.getprop(&d.serial, "ro.product.brand").await {
                        if !brand.is_empty() {
                            d.brand = Some(brand);
                        }
                    }
                    if let Ok(model) = self.getprop(&d.serial, "ro.product.model").await {
                        if !model.is_empty() {
                            d.model = Some(model);
                        }
                    }
                    if let Ok(codename) = self.getprop(&d.serial, "ro.product.device").await {
                        if !codename.is_empty() {
                            d.device_codename = Some(codename);
                        }
                    }
                    d.refresh_identity();
                }
                if d.state.is_ready() {
                    d.android_version = self
                        .getprop(&d.serial, "ro.build.version.release")
                        .await
                        .ok();
                    d.battery = self.battery_level(&d.serial).await.ok();
                }
                devices.push(d);
            }
        }
        Ok(devices)
    }

    pub async fn ensure_ready(&self, serial: Option<&str>) -> Result<Device, AsperaError> {
        let devices = self.devices().await?;
        if devices.is_empty() {
            return Err(AsperaError::NoDevice);
        }

        if let Some(serial) = serial {
            let d = devices
                .into_iter()
                .find(|d| d.serial == serial)
                .ok_or(AsperaError::NoDevice)?;
            return match d.state {
                DeviceState::Device => Ok(d),
                DeviceState::Unauthorized => Err(AsperaError::Unauthorized),
                DeviceState::Offline => Err(AsperaError::Offline),
                DeviceState::Unknown => Err(AsperaError::Adb(format!("unknown state for {serial}"))),
            };
        }

        if let Some(d) = devices.iter().find(|d| d.state == DeviceState::Device) {
            return Ok(d.clone());
        }
        if devices.iter().any(|d| d.state == DeviceState::Unauthorized) {
            return Err(AsperaError::Unauthorized);
        }
        if devices.iter().any(|d| d.state == DeviceState::Offline) {
            return Err(AsperaError::Offline);
        }
        Err(AsperaError::NoDevice)
    }

    pub async fn getprop(&self, serial: &str, key: &str) -> Result<String, AsperaError> {
        let out = self.run(&["-s", serial, "shell", "getprop", key]).await?;
        Ok(out.trim().to_string())
    }

    pub async fn battery_level(&self, serial: &str) -> Result<u8, AsperaError> {
        let out = self
            .run(&["-s", serial, "shell", "dumpsys", "battery"])
            .await?;
        for line in out.lines() {
            if let Some(rest) = line.trim().strip_prefix("level:") {
                if let Ok(v) = rest.trim().parse::<u8>() {
                    return Ok(v);
                }
            }
        }
        Err(AsperaError::Message("battery level unavailable".into()))
    }

    pub async fn pair(&self, host_port: &str, code: &str) -> Result<String, AsperaError> {
        let out = self.run(&["pair", host_port, code]).await?;
        if out.to_lowercase().contains("successfully") || out.to_lowercase().contains("success") {
            Ok(out.trim().to_string())
        } else if out.trim().is_empty() {
            Ok("Paired".into())
        } else {
            // adb pair writes success to stdout; failures often non-zero already handled
            Ok(out.trim().to_string())
        }
    }

    pub async fn connect(&self, host_port: &str) -> Result<String, AsperaError> {
        let out = self.run(&["connect", host_port]).await?;
        let lower = out.to_lowercase();
        if lower.contains("connected") || lower.contains("already connected") {
            Ok(out.trim().to_string())
        } else {
            Err(AsperaError::Pairing(out.trim().to_string()))
        }
    }

    pub async fn disconnect(&self, host_port: Option<&str>) -> Result<String, AsperaError> {
        match host_port {
            Some(hp) => self.run(&["disconnect", hp]).await,
            None => self.run(&["disconnect"]).await,
        }
    }

    pub async fn kill_server(&self) -> Result<(), AsperaError> {
        let _ = self.run(&["kill-server"]).await?;
        Ok(())
    }

    pub async fn start_server(&self) -> Result<(), AsperaError> {
        let _ = self.run(&["start-server"]).await?;
        Ok(())
    }

    pub async fn push(&self, serial: &str, local: &str, remote: &str) -> Result<String, AsperaError> {
        self.run(&["-s", serial, "push", local, remote]).await
    }

    pub async fn install_apk(&self, serial: &str, local: &str) -> Result<String, AsperaError> {
        self.run(&["-s", serial, "install", "-r", local]).await
    }

    pub async fn pull(&self, serial: &str, remote: &str, local: &str) -> Result<String, AsperaError> {
        self.run(&["-s", serial, "pull", remote, local]).await
    }

    /// Read a remote file as bytes via `adb exec-out` (binary-safe).
    pub async fn read_file_bytes(
        &self,
        serial: &str,
        remote: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, AsperaError> {
        if !remote.starts_with('/') || remote.contains('\0') || remote.contains('\n') {
            return Err(AsperaError::Message("invalid remote path".into()));
        }
        let output = Command::new(&self.adb_path)
            .args(["-s", serial, "exec-out", "cat", "--", remote])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| AsperaError::Adb(e.to_string()))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(AsperaError::Adb(if err.trim().is_empty() {
                format!("failed to read {remote}")
            } else {
                err.trim().to_string()
            }));
        }
        if output.stdout.len() > max_bytes {
            return Err(AsperaError::Message(format!(
                "file too large ({} MB). Save to disk instead of preview/copy.",
                output.stdout.len() / (1024 * 1024)
            )));
        }
        if output.stdout.is_empty() {
            return Err(AsperaError::Message("empty file".into()));
        }
        Ok(output.stdout)
    }

    pub async fn shell(&self, serial: &str, args: &[&str]) -> Result<String, AsperaError> {
        let mut cmd = vec!["-s", serial, "shell"];
        cmd.extend_from_slice(args);
        self.run(&cmd).await
    }

    /// List recent image files under common gallery folders.
    /// Returns remote absolute paths (not bare filenames).
    pub async fn list_photos(&self, serial: &str) -> Result<Vec<String>, AsperaError> {
        // Prefer storage/emulated (OnePlus / modern Android); /sdcard is often a symlink.
        // Filter to image extensions so we never show root dirs if ls falls back badly.
        let script = r#"
for d in \
  /storage/emulated/0/DCIM/Camera \
  /storage/emulated/0/DCIM/Screenshots \
  /storage/emulated/0/Pictures \
  /storage/emulated/0/Download \
  /sdcard/DCIM/Camera \
  /sdcard/DCIM/Screenshots \
  /sdcard/Pictures \
  /sdcard/Download
do
  [ -d "$d" ] || continue
  ls -1 "$d" 2>/dev/null | while IFS= read -r f; do
    case "$f" in
      *.jpg|*.JPG|*.jpeg|*.JPEG|*.png|*.PNG|*.webp|*.WEBP|*.heic|*.HEIC|*.gif|*.GIF)
        echo "$d/$f"
        ;;
    esac
  done
done | head -n 300
"#;
        let out = self.shell(serial, &["sh", "-c", script]).await?;
        let mut paths: Vec<String> = out
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| is_remote_image_path(l))
            .collect();
        paths.sort();
        paths.reverse(); // newer names often sort last with IMG_ timestamps
        Ok(paths)
    }

    pub async fn get_clipboard(&self, serial: &str) -> Result<String, AsperaError> {
        // Android 10+ / many OEMs block shell clipboard read. Treat known failure
        // strings as errors so the UI can guide users to scrcpy sync instead.
        let candidates: &[&[&str]] = &[
            &["cmd", "clipboard", "get-clip", "text"],
            &["cmd", "clipboard", "get"],
        ];
        for args in candidates {
            if let Ok(raw) = self.shell(serial, args).await {
                if let Some(text) = sanitize_clipboard_output(&raw) {
                    return Ok(text);
                }
            }
        }
        Err(AsperaError::Message(
            "This phone blocks ADB clipboard read. Start Mirror (clipboard sync on), copy on the phone, then paste on the PC (Ctrl+V)."
                .into(),
        ))
    }

    pub async fn set_clipboard(&self, serial: &str, text: &str) -> Result<(), AsperaError> {
        // Prefer cmd clipboard when available; Clipper broadcast is a best-effort fallback.
        let escaped = text.replace('\'', "'\\''");
        if let Ok(out) = self
            .shell(
                serial,
                &["cmd", "clipboard", "set-clip", "text", &escaped],
            )
            .await
        {
            if !looks_like_clipboard_error(&out) {
                return Ok(());
            }
        }
        if let Ok(out) = self
            .shell(serial, &["cmd", "clipboard", "set", &escaped])
            .await
        {
            if !looks_like_clipboard_error(&out) {
                return Ok(());
            }
        }
        let _ = self
            .shell(
                serial,
                &[
                    "am",
                    "broadcast",
                    "-a",
                    "clipper.set",
                    "-e",
                    "text",
                    &escaped,
                ],
            )
            .await;
        Err(AsperaError::Message(
            "Could not set phone clipboard via ADB. Start Mirror with clipboard sync, copy on the PC, then paste in the scrcpy window."
                .into(),
        ))
    }

    pub async fn send_sms_intent(
        &self,
        serial: &str,
        number: &str,
        body: &str,
    ) -> Result<(), AsperaError> {
        let body = body.replace('\'', "'\\''");
        self.shell(
            serial,
            &[
                "am",
                "start",
                "-a",
                "android.intent.action.SENDTO",
                "-d",
                &format!("sms:{number}"),
                "--es",
                "sms_body",
                &body,
            ],
        )
        .await?;
        Ok(())
    }

    /// Place or prepare a phone call on the device.
    /// `direct` uses ACTION_CALL (needs USB debugging security settings on many OEMs);
    /// otherwise ACTION_DIAL opens the keypad with the number filled in.
    pub async fn place_call(
        &self,
        serial: &str,
        number: &str,
        direct: bool,
    ) -> Result<String, AsperaError> {
        let number = crate::telephony::normalize_phone_number(number)?;
        let action = if direct {
            "android.intent.action.CALL"
        } else {
            "android.intent.action.DIAL"
        };
        let uri = format!("tel:{number}");
        match self
            .shell(
                serial,
                &["am", "start", "-a", action, "-d", &uri],
            )
            .await
        {
            Ok(_) => Ok(if direct {
                format!("Calling {number} — audio uses the phone / Bluetooth headset")
            } else {
                format!("Dialer opened for {number} — tap Call on the phone")
            }),
            Err(e) if direct => {
                self.shell(
                    serial,
                    &[
                        "am",
                        "start",
                        "-a",
                        "android.intent.action.DIAL",
                        "-d",
                        &uri,
                    ],
                )
                .await
                .map_err(|_| e)?;
                Ok(format!(
                    "Direct call blocked — opened dialer for {number}. Tap Call on the phone."
                ))
            }
            Err(e) => Err(e),
        }
    }

    pub async fn open_phone_app(&self, serial: &str) -> Result<String, AsperaError> {
        // Try common dialer packages
        for pkg in [
            "com.android.dialer",
            "com.google.android.dialer",
            "com.oneplus.dialer",
            "com.samsung.android.dialer",
        ] {
            if self
                .shell(serial, &["pm", "path", pkg])
                .await
                .map(|s| s.contains("package:"))
                .unwrap_or(false)
            {
                let _ = self
                    .shell(
                        serial,
                        &[
                            "monkey",
                            "-p",
                            pkg,
                            "-c",
                            "android.intent.category.LAUNCHER",
                            "1",
                        ],
                    )
                    .await;
                return Ok(format!("Opened {pkg}"));
            }
        }
        self.shell(
            serial,
            &[
                "am",
                "start",
                "-a",
                "android.intent.action.DIAL",
            ],
        )
        .await?;
        Ok("Opened dialer".into())
    }

    pub async fn share_text(&self, serial: &str, text: &str) -> Result<(), AsperaError> {
        let text = text.replace('\'', "'\\''");
        self.shell(
            serial,
            &[
                "am",
                "start",
                "-a",
                "android.intent.action.SEND",
                "-t",
                "text/plain",
                "--es",
                "android.intent.extra.TEXT",
                &text,
            ],
        )
        .await?;
        Ok(())
    }

    /// List third-party packages (plus a few system apps useful for business).
    pub async fn list_packages(&self, serial: &str) -> Result<Vec<PhoneApp>, AsperaError> {
        let out = self
            .shell(serial, &["pm", "list", "packages", "-3"])
            .await?;
        let mut apps: Vec<PhoneApp> = out
            .lines()
            .filter_map(|line| {
                let pkg = line.trim().strip_prefix("package:")?.to_string();
                if pkg.is_empty() {
                    return None;
                }
                let label = humanize_package(&pkg);
                Some(PhoneApp {
                    package: pkg,
                    label,
                })
            })
            .collect();

        // Always include Settings if present
        let settings = self
            .shell(serial, &["pm", "path", "com.android.settings"])
            .await;
        if settings.map(|s| s.contains("package:")).unwrap_or(false)
            && !apps.iter().any(|a| a.package == "com.android.settings")
        {
            apps.push(PhoneApp {
                package: "com.android.settings".into(),
                label: "Settings".into(),
            });
        }

        apps.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
        Ok(apps)
    }

    async fn run(&self, args: &[&str]) -> Result<String, AsperaError> {
        let output = Command::new(&self.adb_path)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| AsperaError::Adb(e.to_string()))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            let msg = if !stderr.trim().is_empty() {
                stderr
            } else {
                stdout
            };
            return Err(AsperaError::Adb(msg.trim().to_string()));
        }
        if !stderr.trim().is_empty() && stdout.trim().is_empty() {
            // some adb commands put useful info on stderr with exit 0
            return Ok(stderr);
        }
        Ok(stdout)
    }
}

fn humanize_package(pkg: &str) -> String {
    let short = pkg.rsplit('.').next().unwrap_or(pkg);
    let mut out = String::new();
    for (i, ch) in short.chars().enumerate() {
        if i > 0 && ch.is_uppercase() {
            out.push(' ');
        }
        if i == 0 {
            out.extend(ch.to_uppercase());
        } else {
            out.push(ch);
        }
    }
    if out.is_empty() {
        pkg.to_string()
    } else {
        out
    }
}

fn looks_like_clipboard_error(raw: &str) -> bool {
    let t = raw.trim().to_lowercase();
    t.is_empty()
        || t.contains("no shell command")
        || t.contains("unknown command")
        || t.contains("permission denial")
        || t.contains("security exception")
        || t.contains("does not exist")
        || t.starts_with("error")
        || t.contains("usage:")
}

fn sanitize_clipboard_output(raw: &str) -> Option<String> {
    let text = raw.trim().to_string();
    if looks_like_clipboard_error(&text) {
        None
    } else {
        Some(text)
    }
}

fn is_remote_image_path(path: &str) -> bool {
    if !path.starts_with('/') || path.contains('\0') {
        return false;
    }
    // Reject root-fs noise (bin, data, cache, …) if a broken ls ever leaks through.
    let lower = path.to_lowercase();
    lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".webp")
        || lower.ends_with(".heic")
        || lower.ends_with(".gif")
}
