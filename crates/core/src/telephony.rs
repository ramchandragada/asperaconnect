//! Phone dialing helpers — tel:/callto: parsing and ADB call intents.

use crate::error::AsperaError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallRequest {
    pub number: String,
    /// If true, attempt ACTION_CALL (places call). If false, ACTION_DIAL (opens keypad).
    pub direct: bool,
}

/// Pull a dialable number from CLI args / deep-link URLs.
pub fn phone_from_argv(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if let Some(n) = parse_phone_uri(arg) {
            return Some(n);
        }
        // Bare number pasted as sole arg
        if arg.chars().all(|c| c.is_ascii_digit() || matches!(c, '+' | ' ' | '-' | '(' | ')'))
            && arg.chars().filter(|c| c.is_ascii_digit()).count() >= 7
        {
            if let Ok(n) = normalize_phone_number(arg) {
                return Some(n);
            }
        }
    }
    None
}

/// Parse `tel:`, `callto:`, or a raw number string into a normalized dial string.
pub fn parse_phone_uri(raw: &str) -> Option<String> {
    let s = raw.trim();
    let after_scheme = if let Some(rest) = s.strip_prefix("tel:") {
        rest
    } else if let Some(rest) = s.strip_prefix("TEL:") {
        rest
    } else if let Some(rest) = s.strip_prefix("callto:") {
        rest
    } else if let Some(rest) = s.strip_prefix("CALLTO:") {
        rest
    } else if s.contains("://") {
        return None;
    } else {
        s
    };

    // URL-decode common forms (%2B → +, %20 → space)
    let decoded = percent_decode(after_scheme);
    // Strip params: tel:+91...;ext=123 or ?body=
    let main = decoded
        .split(['?', ';', '#'])
        .next()
        .unwrap_or(&decoded)
        .trim();
    normalize_phone_number(main).ok()
}

pub fn normalize_phone_number(raw: &str) -> Result<String, AsperaError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AsperaError::Message("empty phone number".into()));
    }
    let mut out = String::new();
    for (i, c) in trimmed.chars().enumerate() {
        match c {
            '+' if i == 0 || out.is_empty() => out.push('+'),
            d if d.is_ascii_digit() => out.push(d),
            ' ' | '-' | '(' | ')' | '.' | '/' => {}
            _ => {}
        }
    }
    let digits = out.chars().filter(|c| c.is_ascii_digit()).count();
    if digits < 3 {
        return Err(AsperaError::Message(format!(
            "not a valid phone number: {raw}"
        )));
    }
    Ok(out)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            // in query strings + is space; in tel bodies keep as +
            out.push(b'+');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tel_uri() {
        assert_eq!(
            parse_phone_uri("tel:+91-98765-43210").as_deref(),
            Some("+919876543210")
        );
        assert_eq!(
            parse_phone_uri("tel:%2B919876543210").as_deref(),
            Some("+919876543210")
        );
        assert_eq!(
            parse_phone_uri("callto:02212345678").as_deref(),
            Some("02212345678")
        );
    }
}
