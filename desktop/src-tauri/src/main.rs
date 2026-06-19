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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopKubernetesProfileMetadata {
    id: String,
    display_name: String,
    api_server: String,
    auth_type: String,
    credential_store: String,
    selected: bool,
    status: String,
}

#[derive(Default)]
struct DesktopSidecarState {
    child: Mutex<Option<CommandChild>>,
    profile: Mutex<Option<DesktopSidecarProfile>>,
    kubernetes_profiles: Mutex<Vec<DesktopKubernetesProfileMetadata>>,
    selected_kubernetes_profile_id: Mutex<Option<String>>,
}

#[tauri::command]
fn desktop_sidecar_profile(state: State<'_, DesktopSidecarState>) -> Option<DesktopSidecarProfile> {
    state.profile.lock().ok().and_then(|profile| profile.clone())
}

#[tauri::command]
fn desktop_kubernetes_profiles(state: State<'_, DesktopSidecarState>) -> Vec<DesktopKubernetesProfileMetadata> {
    let selected_id = state
        .selected_kubernetes_profile_id
        .lock()
        .ok()
        .and_then(|selected| selected.clone());

    state
        .kubernetes_profiles
        .lock()
        .map(|profiles| {
            profiles
                .iter()
                .map(|profile| profile_with_selected(profile, selected_id.as_deref()))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
fn desktop_select_kubernetes_profile(
    profile_id: String,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopKubernetesProfileMetadata, String> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty() {
        return Err("desktop_kubernetes_profile_required".to_string());
    }

    let profile = {
        let profiles = state
            .kubernetes_profiles
            .lock()
            .map_err(|_| "desktop_kubernetes_profiles_unavailable".to_string())?;
        profiles.iter().find(|profile| profile.id == profile_id).cloned()
    }
    .ok_or_else(|| "desktop_kubernetes_profile_not_found".to_string())?;

    let mut selected_profile = profile.clone();
    selected_profile.selected = true;
    if let Ok(mut selected_id) = state.selected_kubernetes_profile_id.lock() {
        *selected_id = Some(profile.id);
    }
    Ok(selected_profile)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DesktopSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_sidecar_profile,
            desktop_kubernetes_profiles,
            desktop_select_kubernetes_profile
        ])
        .setup(|app| {
            initialize_desktop_kubernetes_profiles(app.handle());
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

fn initialize_desktop_kubernetes_profiles(app: &tauri::AppHandle) {
    let profiles = load_desktop_kubernetes_profiles_from_env();
    let selected_profile_id = profiles.first().map(|profile| profile.id.clone());
    let state = app.state::<DesktopSidecarState>();
    if let Ok(mut stored_profiles) = state.kubernetes_profiles.lock() {
        *stored_profiles = profiles;
    }
    if let Ok(mut selected) = state.selected_kubernetes_profile_id.lock() {
        *selected = selected_profile_id;
    }
}

fn load_desktop_kubernetes_profiles_from_env() -> Vec<DesktopKubernetesProfileMetadata> {
    let Some(api_server) = read_safe_env("KUVIEWER_DESKTOP_KUBE_API_SERVER") else {
        return Vec::new();
    };

    let id =
        read_safe_env("KUVIEWER_DESKTOP_KUBE_PROFILE_ID").unwrap_or_else(|| "env-bearer-profile".to_string());
    let display_name = read_safe_env("KUVIEWER_DESKTOP_KUBE_PROFILE_NAME")
        .unwrap_or_else(|| "Environment bearer profile".to_string());
    vec![DesktopKubernetesProfileMetadata {
        id,
        display_name,
        api_server,
        auth_type: "bearer-token".to_string(),
        credential_store: "runtime-env-metadata-fixture".to_string(),
        selected: true,
        status: "metadata-only".to_string(),
    }]
}

fn read_safe_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn profile_with_selected(
    profile: &DesktopKubernetesProfileMetadata,
    selected_id: Option<&str>,
) -> DesktopKubernetesProfileMetadata {
    let mut next_profile = profile.clone();
    next_profile.selected = selected_id.is_some_and(|id| id == profile.id);
    next_profile
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
