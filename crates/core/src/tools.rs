use crate::error::AsperaError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use which::which;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub install_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsReport {
    pub adb: ToolInfo,
    pub scrcpy: ToolInfo,
    pub kdeconnect: ToolInfo,
    pub ready_for_pro_mode: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolStatus {
    Ready,
    MissingAdb,
    MissingScrcpy,
    MissingBoth,
}

const SCRCPY_HINT: &str = "Prefer Snap for Android 14+: sudo snap install scrcpy && sudo snap connect scrcpy:gpu-2404 mesa-2404  (apt scrcpy 1.25 is often too old)";

pub fn detect_tools() -> ToolsReport {
    let adb = probe_named("adb", &["adb"], "sudo apt install adb");
    let scrcpy = probe_named(
        "scrcpy",
        &["/snap/bin/scrcpy", "scrcpy"],
        SCRCPY_HINT,
    );
    let kdeconnect = probe_named(
        "kdeconnect-cli",
        &["kdeconnect-cli"],
        "sudo apt install kdeconnect  # optional",
    );
    let ready_for_pro_mode = adb.found && scrcpy.found;
    ToolsReport {
        adb,
        scrcpy,
        kdeconnect,
        ready_for_pro_mode,
    }
}

fn probe_named(name: &str, candidates: &[&str], install_hint: &str) -> ToolInfo {
    if let Some(path) = resolve_binary(candidates) {
        let version = read_version(name, &path);
        ToolInfo {
            name: name.into(),
            found: true,
            path: Some(path.display().to_string()),
            version,
            install_hint: install_hint.into(),
        }
    } else {
        ToolInfo {
            name: name.into(),
            found: false,
            path: None,
            version: None,
            install_hint: install_hint.into(),
        }
    }
}

fn resolve_binary(candidates: &[&str]) -> Option<PathBuf> {
    for c in candidates {
        let p = Path::new(c);
        if p.is_absolute() {
            if p.exists() {
                return Some(p.to_path_buf());
            }
        } else if let Ok(found) = which(c) {
            return Some(found);
        }
    }
    None
}

fn read_version(name: &str, path: &PathBuf) -> Option<String> {
    let output = std::process::Command::new(path)
        .arg("--version")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        let err = String::from_utf8_lossy(&output.stderr);
        let line = err.lines().next().unwrap_or("").trim();
        if line.is_empty() {
            Some(name.to_string())
        } else {
            Some(line.to_string())
        }
    } else {
        Some(line.to_string())
    }
}

pub fn require_adb() -> Result<PathBuf, AsperaError> {
    resolve_binary(&["adb"]).ok_or_else(|| AsperaError::ToolMissing("adb".into()))
}

pub fn require_scrcpy() -> Result<PathBuf, AsperaError> {
    // Prefer Snap build (newer; works better on Android 14 / OnePlus)
    resolve_binary(&["/snap/bin/scrcpy", "scrcpy"])
        .ok_or_else(|| AsperaError::ToolMissing("scrcpy".into()))
}
