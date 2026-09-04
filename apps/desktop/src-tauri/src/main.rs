#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    init_linux_tray_theme();
    aspera_connect_lib::run();
}

/// GTK renders the system-tray context menu. Without a theme, KDE/dark panels often
/// get label text the same colour as the menu background (invisible but clickable).
#[cfg(target_os = "linux")]
fn init_linux_tray_theme() {
    use std::env;
    if env::var("GTK_THEME").is_err() {
        env::set_var("GTK_THEME", "Adwaita:dark");
    }
}
