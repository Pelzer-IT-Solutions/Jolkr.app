#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg(not(desktop))]
#[allow(unused_imports)]
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Jolkr.", name)
}

/// Check if the app was launched with --minimized (auto-start scenario).
#[cfg(desktop)]
fn should_start_minimized() -> bool {
    std::env::args().any(|arg| arg == "--minimized")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init());

    // Desktop-only plugins
    #[cfg(desktop)]
    let builder = builder
        // Single-instance: intercept second launches (e.g. deep-link clicks on Windows)
        // and forward args to the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            // Forward any jolkr:// URLs as deep-link events (safety net)
            let urls: Vec<&String> = argv
                .iter()
                .filter(|arg| arg.starts_with("jolkr://"))
                .collect();
            if !urls.is_empty() {
                let _ = app.emit("deep-link://new-url", &urls);
            }
        }))
        // Deep-link: registers jolkr:// scheme handler
        .plugin(tauri_plugin_deep_link::init())
        // Autostart: launch on system boot with --minimized flag
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ));

    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|#[allow(unused)] app| {
            // --- Stronghold (encrypted token storage, desktop only) ---
            #[cfg(desktop)]
            {
                let salt_path = app
                    .path()
                    .app_local_data_dir()
                    .expect("could not resolve app local data path")
                    .join("salt.txt");
                app.handle().plugin(
                    tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build(),
                )?;
            }

            // Register deep-link protocol at runtime (needed for dev mode)
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // --- System Tray (desktop only) ---
            #[cfg(desktop)]
            {
                let show_i = MenuItem::with_id(app, "show", "Show Jolkr", true, None::<&str>)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &separator, &quit_i])?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .tooltip("Jolkr")
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .build(app)?;

                // If launched with --minimized (auto-start), hide the main window
                if should_start_minimized() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
            }

            // --- Enable browser context menu on Windows (cut/copy/paste) ---
            #[cfg(target_os = "windows")]
            {
                if let Some(webview_window) = app.get_webview_window("main") {
                    let _ = webview_window.with_webview(|webview| unsafe {
                        let controller = webview.controller();
                        let core = controller.CoreWebView2().unwrap();
                        let settings = core.Settings().unwrap();
                        settings.SetAreDefaultContextMenusEnabled(true.into()).unwrap();
                    });
                }
            }

            Ok(())
        });

    // Close-to-tray only on desktop
    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| {
        // Close to tray instead of quitting
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    });

    builder
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
