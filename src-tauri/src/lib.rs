use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use std::path::PathBuf;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use sha2::{Sha256, Digest};

/// Save raw image bytes to {documents}/RememberMe/images/{uuid}.{ext}
/// Returns the absolute file path as a string.
#[tauri::command]
fn save_image(app: tauri::AppHandle, image_base64: String, ext: String) -> Result<String, String> {
    // Decode base64
    let image_data = BASE64.decode(image_base64).map_err(|e| format!("Invalid base64: {e}"))?;

    // Resolve the documents directory
    let docs_dir = app
        .path()
        .document_dir()
        .map_err(|e| format!("Cannot resolve documents dir: {e}"))?;

    let images_dir: PathBuf = docs_dir.join("RememberMe").join("images");

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Cannot create images dir: {e}"))?;

    // Generate SHA-256 hash of the image
    let mut hasher = Sha256::new();
    hasher.update(&image_data);
    let hash = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect::<String>();

    // Generate filename using hash
    let filename = format!("{}.{}", hash, ext);
    let file_path = images_dir.join(&filename);

    // Only write if file doesn't already exist
    if !file_path.exists() {
        std::fs::write(&file_path, &image_data)
            .map_err(|e| format!("Cannot write image: {e}"))?;
    }

    file_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid file path encoding".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let _window = app.get_webview_window("main").unwrap();

            // No OS-level window vibrancy needed as per user request

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;


            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            let ctrl_shift_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            let _ = app.global_shortcut().on_shortcut(ctrl_shift_space, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            });

            Ok(())
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![save_image, delete_image, delete_image_by_name])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn delete_image(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("Cannot delete image: {e}"))
}

#[tauri::command]
fn delete_image_by_name(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let docs_dir = app
        .path()
        .document_dir()
        .map_err(|e| format!("Cannot resolve documents dir: {e}"))?;

    let file_path = docs_dir.join("RememberMe").join("images").join(name);
    if file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| format!("Cannot delete image: {e}"))?;
    }
    Ok(())
}
