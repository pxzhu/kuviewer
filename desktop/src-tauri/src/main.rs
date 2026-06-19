use serde::Serialize;
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const SIDECAR_SERVER_URL: &str = "http://127.0.0.1:18086";
const SIDECAR_LISTEN_ADDR: &str = "127.0.0.1:18086";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSidecarProfile {
    server_url: String,
    admin_token: String,
    source: String,
}

#[derive(Default)]
struct DesktopSidecarState {
    child: Mutex<Option<CommandChild>>,
    profile: Mutex<Option<DesktopSidecarProfile>>,
}

#[tauri::command]
fn desktop_sidecar_profile(state: State<'_, DesktopSidecarState>) -> Option<DesktopSidecarProfile> {
    state.profile.lock().ok().and_then(|profile| profile.clone())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DesktopSidecarState::default())
        .invoke_handler(tauri::generate_handler![desktop_sidecar_profile])
        .setup(|app| {
            if let Err(error) = start_desktop_sidecar(app.handle()) {
                eprintln!("kuviewer desktop sidecar not started: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                stop_desktop_sidecar(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Kuviewer desktop shell");
}

fn start_desktop_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if env_flag_enabled("KUVIEWER_DESKTOP_DISABLE_SIDECAR") {
        return Ok(());
    }

    let admin_token = generate_admin_token()?;
    let source = std::env::var("KUVIEWER_DESKTOP_SIDECAR_SOURCE")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "mock".to_string());

    let command = app
        .shell()
        .sidecar("kuviewer-sidecar")?
        .env("KUVIEWER_LISTEN_ADDR", SIDECAR_LISTEN_ADDR)
        .env("KUVIEWER_ADMIN_TOKEN", &admin_token)
        .env("KUVIEWER_SOURCE", &source);
    let (mut receiver, child) = command.spawn()?;

    let state = app.state::<DesktopSidecarState>();
    if let Ok(mut profile) = state.profile.lock() {
        *profile = Some(DesktopSidecarProfile {
            server_url: SIDECAR_SERVER_URL.to_string(),
            admin_token,
            source,
        });
    }
    if let Ok(mut stored_child) = state.child.lock() {
        *stored_child = Some(child);
    }

    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    if !line.trim().is_empty() {
                        println!("kuviewer sidecar: {line}");
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    if !line.trim().is_empty() {
                        eprintln!("kuviewer sidecar: {line}");
                    }
                }
                CommandEvent::Error(error) => {
                    eprintln!("kuviewer sidecar error: {error}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("kuviewer sidecar terminated: {payload:?}");
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn stop_desktop_sidecar(app: &tauri::AppHandle) {
    let state = app.state::<DesktopSidecarState>();
    if let Ok(mut child) = state.child.lock() {
        if let Some(mut child) = child.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut profile) = state.profile.lock() {
        *profile = None;
    }
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn generate_admin_token() -> Result<String, getrandom::Error> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
