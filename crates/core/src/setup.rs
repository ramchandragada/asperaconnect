//! Setup doctor — actionable checks for Pro / Easy mode readiness.

use crate::tools::{detect_tools, ToolsReport};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    pub id: String,
    pub label: String,
    pub ok: bool,
    pub detail: String,
    pub fix_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReport {
    pub ready_for_pro_mode: bool,
    pub scrcpy_version_ok: bool,
    pub checks: Vec<SetupCheck>,
}

pub fn run_setup_doctor() -> SetupReport {
    let tools = detect_tools();
    let scrcpy_version_ok = scrcpy_version_at_least(&tools, 2, 0);
    let mut checks = Vec::new();

    checks.push(SetupCheck {
        id: "adb".into(),
        label: "adb installed".into(),
        ok: tools.adb.found,
        detail: tools
            .adb
            .version
            .clone()
            .unwrap_or_else(|| "not found".into()),
        fix_hint: if tools.adb.found {
            None
        } else {
            Some("sudo apt install adb".into())
        },
    });

    checks.push(SetupCheck {
        id: "scrcpy".into(),
        label: "scrcpy installed".into(),
        ok: tools.scrcpy.found,
        detail: tools
            .scrcpy
            .version
            .clone()
            .unwrap_or_else(|| "not found".into()),
        fix_hint: if tools.scrcpy.found {
            None
        } else {
            Some(tools.scrcpy.install_hint.clone())
        },
    });

    checks.push(SetupCheck {
        id: "scrcpy-version".into(),
        label: "scrcpy 2.0+ (audio forwarding)".into(),
        ok: scrcpy_version_ok,
        detail: if scrcpy_version_ok {
            "OK for Android 11+ audio".into()
        } else {
            "Upgrade scrcpy — apt 1.25 is too old for Android 14".into()
        },
        fix_hint: if scrcpy_version_ok {
            None
        } else {
            Some(
                "sudo snap install scrcpy && sudo snap connect scrcpy:gpu-2404 mesa-2404".into(),
            )
        },
    });

    checks.push(SetupCheck {
        id: "scrcpy-snap-gpu".into(),
        label: "Snap scrcpy GPU (if using snap)".into(),
        ok: !tools
            .scrcpy
            .path
            .as_deref()
            .is_some_and(|p| p.contains("/snap/"))
            || scrcpy_version_ok,
        detail: tools
            .scrcpy
            .path
            .clone()
            .unwrap_or_else(|| "n/a".into()),
        fix_hint: Some(
            "sudo snap connect scrcpy:gpu-2404 mesa-2404 && sudo snap connect scrcpy:audio-record".into(),
        ),
    });

    checks.push(SetupCheck {
        id: "kdeconnect".into(),
        label: "KDE Connect CLI (optional)".into(),
        ok: tools.kdeconnect.found,
        detail: if tools.kdeconnect.found {
            "Ping / share / SMS send available when paired".into()
        } else {
            "Optional — install for share + SMS send".into()
        },
        fix_hint: if tools.kdeconnect.found {
            None
        } else {
            Some("sudo apt install kdeconnect".into())
        },
    });

    let vd_ok = scrcpy_version_at_least(&tools, 3, 3);
    checks.push(SetupCheck {
        id: "scrcpy-virtual-display".into(),
        label: "scrcpy 3.3+ (app windows)".into(),
        ok: vd_ok,
        detail: if vd_ok {
            "Virtual display / Open app window supported".into()
        } else {
            "App windows need scrcpy 3.3+ (prefer Snap)".into()
        },
        fix_hint: if vd_ok {
            None
        } else {
            Some("sudo snap install scrcpy".into())
        },
    });

    SetupReport {
        ready_for_pro_mode: tools.ready_for_pro_mode && scrcpy_version_ok,
        scrcpy_version_ok,
        checks,
    }
}

fn scrcpy_version_at_least(tools: &ToolsReport, major: u32, minor: u32) -> bool {
    let Some(ver) = &tools.scrcpy.version else {
        return false;
    };
    parse_scrcpy_version(ver).is_some_and(|(m, n, _)| m > major || (m == major && n >= minor))
}

fn parse_scrcpy_version(text: &str) -> Option<(u32, u32, u32)> {
    // "scrcpy 3.3.4" or "3.3.4"
    let digits: String = text
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .collect();
    let mut parts = digits.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_scrcpy_version() {
        assert_eq!(parse_scrcpy_version("scrcpy 3.3.4"), Some((3, 3, 4)));
        assert_eq!(parse_scrcpy_version("1.25"), Some((1, 25, 0)));
    }
}
