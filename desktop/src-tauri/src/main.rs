use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const SIDECAR_SERVER_URL: &str = "http://127.0.0.1:18086";
const SIDECAR_LISTEN_ADDR: &str = "127.0.0.1:18086";
const DESKTOP_KUBE_CREDENTIAL_SERVICE: &str = "com.kuviewer.desktop.kubernetes";
const DESKTOP_CM_SSH_CREDENTIAL_SERVICE: &str = "com.kuviewer.desktop.cm-ssh";
const MAX_DESKTOP_KUBE_TOKEN_BYTES: u64 = 64 * 1024;
const MAX_DESKTOP_CM_PRIVATE_KEY_BYTES: u64 = 128 * 1024;
const DESKTOP_CM_DEFAULT_REMOTE_API_HOST: &str = "127.0.0.1";
const DESKTOP_CM_DEFAULT_REMOTE_API_PORT: u16 = 18085;
const DESKTOP_CM_RUNTIME_HEALTH_TIMEOUT_SECS: u64 = 10;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSidecarProfile {
    server_url: String,
    admin_token: String,
    source: String,
    kubernetes_profile_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopKubernetesProfileMetadata {
    id: String,
    display_name: String,
    api_server: String,
    auth_type: String,
    credential_store: String,
    credential_available: bool,
    selected: bool,
    status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCmSessionMetadata {
    id: String,
    name: String,
    host: String,
    port: u16,
    user: String,
    remote_api_host: String,
    remote_api_port: u16,
    auth_type: String,
    credential_store: String,
    credential_available: bool,
    status: String,
    runtime_status: String,
    updated_at: u64,
    selected: bool,
    description: Option<String>,
    last_check_status: String,
    last_check_at: Option<u64>,
    last_check_message: Option<String>,
    diagnostic_stage: Option<String>,
    diagnostic_severity: Option<String>,
    diagnostic_message: Option<String>,
    diagnostic_hint: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCmSessionInput {
    id: Option<String>,
    name: String,
    host: String,
    port: u16,
    user: String,
    remote_api_host: Option<String>,
    remote_api_port: Option<u16>,
    description: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCmSessionRuntimeProfile {
    session_id: String,
    session_name: String,
    server_url: String,
    remote_api_host: String,
    remote_api_port: u16,
    local_port: u16,
    status: String,
    started_at: u64,
    health_status: String,
    last_health_at: Option<u64>,
    last_health_message: Option<String>,
    last_error: Option<String>,
    diagnostic_stage: Option<String>,
    diagnostic_severity: Option<String>,
    diagnostic_message: Option<String>,
    diagnostic_hint: Option<String>,
}

#[derive(Default)]
struct DesktopSidecarState {
    child: Mutex<Option<CommandChild>>,
    profile: Mutex<Option<DesktopSidecarProfile>>,
    kubernetes_profiles: Mutex<Vec<DesktopKubernetesProfileMetadata>>,
    selected_kubernetes_profile_id: Mutex<Option<String>>,
    cm_sessions: Mutex<Vec<DesktopCmSessionMetadata>>,
    selected_cm_session_id: Mutex<Option<String>>,
    runtime_temp_files: Mutex<Vec<PathBuf>>,
    cm_runtime_child: Mutex<Option<Child>>,
    cm_runtime_profile: Mutex<Option<DesktopCmSessionRuntimeProfile>>,
    cm_runtime_temp_files: Mutex<Vec<PathBuf>>,
}

struct DesktopSidecarRuntimeConfig {
    source: String,
    kubernetes_profile_id: Option<String>,
    kube_api_server: Option<String>,
    kube_token_file: Option<PathBuf>,
}

struct DesktopCmSessionCheckOutcome {
    status: String,
    message: String,
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
    app: AppHandle,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopKubernetesProfileMetadata, String> {
    let profile_id = normalize_profile_id(&profile_id)?;

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
    if selected_profile.credential_available {
        restart_desktop_sidecar_for_kubernetes_profile(&app, &selected_profile)?;
        selected_profile.status = "sidecar-kubernetes-active".to_string();
    }

    update_selected_desktop_kubernetes_profile(&state, &selected_profile)?;
    Ok(selected_profile)
}

#[tauri::command]
fn desktop_delete_kubernetes_profile_credential(
    profile_id: String,
    app: AppHandle,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopKubernetesProfileMetadata, String> {
    let profile_id = normalize_profile_id(&profile_id)?;
    {
        let profiles = state
            .kubernetes_profiles
            .lock()
            .map_err(|_| "desktop_kubernetes_profiles_unavailable".to_string())?;
        if !profiles.iter().any(|profile| profile.id == profile_id) {
            return Err("desktop_kubernetes_profile_not_found".to_string());
        }
    }

    os_credential_store::delete_bearer_token(DESKTOP_KUBE_CREDENTIAL_SERVICE, &profile_id)?;
    let was_selected = state
        .selected_kubernetes_profile_id
        .lock()
        .ok()
        .and_then(|selected| selected.clone())
        .is_some_and(|selected| selected == profile_id);
    if was_selected {
        stop_desktop_sidecar(&app);
        let _ = start_desktop_sidecar(&app);
        if let Ok(mut selected_id) = state.selected_kubernetes_profile_id.lock() {
            *selected_id = None;
        }
    }

    let mut profiles = state
        .kubernetes_profiles
        .lock()
        .map_err(|_| "desktop_kubernetes_profiles_unavailable".to_string())?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "desktop_kubernetes_profile_not_found".to_string())?;
    profile.credential_available = false;
    profile.status = "credential-deleted".to_string();
    Ok(profile_with_selected(
        profile,
        state
            .selected_kubernetes_profile_id
            .lock()
            .ok()
            .and_then(|selected| selected.clone())
            .as_deref(),
    ))
}

#[tauri::command]
fn desktop_cm_sessions(state: State<'_, DesktopSidecarState>) -> Vec<DesktopCmSessionMetadata> {
    state.cm_sessions.lock().map(|sessions| sessions.clone()).unwrap_or_default()
}

#[tauri::command]
fn desktop_cm_session_runtime(
    state: State<'_, DesktopSidecarState>,
) -> Result<Option<DesktopCmSessionRuntimeProfile>, String> {
    check_cm_session_runtime_state(&state)
}

#[tauri::command]
fn desktop_start_cm_session_runtime(
    session_id: String,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopCmSessionRuntimeProfile, String> {
    let session_id = normalize_cm_session_id(&session_id)?;
    let session_snapshot = {
        let sessions = state
            .cm_sessions
            .lock()
            .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
        sessions
            .iter()
            .find(|session| session.id == session_id)
            .cloned()
            .ok_or_else(|| "desktop_cm_session_not_found".to_string())?
    };
    let private_key = os_credential_store::read_secret(DESKTOP_CM_SSH_CREDENTIAL_SERVICE, &session_id)
        .map_err(|_| "desktop_cm_runtime_credential_unavailable".to_string())?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "desktop_cm_runtime_credential_missing".to_string())?;

    stop_cm_session_runtime_state(&state);
    match start_cm_session_ssh_tunnel(&state, session_snapshot, &private_key) {
        Ok(profile) => Ok(profile),
        Err(error) => {
            mark_cm_session_runtime_start_failed(&state, &session_id, &error);
            Err(error)
        }
    }
}

#[tauri::command]
fn desktop_stop_cm_session_runtime(state: State<'_, DesktopSidecarState>) -> Result<Option<DesktopCmSessionRuntimeProfile>, String> {
    stop_cm_session_runtime_state(&state);
    Ok(None)
}

#[tauri::command]
fn desktop_check_cm_session_runtime(
    state: State<'_, DesktopSidecarState>,
) -> Result<Option<DesktopCmSessionRuntimeProfile>, String> {
    check_cm_session_runtime_state(&state)
}

#[tauri::command]
fn desktop_save_cm_session(
    session: DesktopCmSessionInput,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopCmSessionMetadata, String> {
    let mut next_session = normalize_cm_session_input(session)?;
    let selected_id = state
        .selected_cm_session_id
        .lock()
        .ok()
        .and_then(|selected| selected.clone());
    next_session.selected = selected_id.as_deref().is_some_and(|id| id == next_session.id);
    if is_active_cm_runtime_session(&state, &next_session.id) {
        stop_cm_session_runtime_state(&state);
    }

    let mut sessions = state
        .cm_sessions
        .lock()
        .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
    if let Some(existing) = sessions.iter_mut().find(|session| session.id == next_session.id) {
        *existing = next_session.clone();
    } else {
        sessions.insert(0, next_session.clone());
    }
    Ok(next_session)
}

#[tauri::command]
fn desktop_select_cm_session(
    session_id: String,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopCmSessionMetadata, String> {
    let session_id = normalize_cm_session_id(&session_id)?;
    let mut sessions = state
        .cm_sessions
        .lock()
        .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
    if !sessions.iter().any(|session| session.id == session_id) {
        return Err("desktop_cm_session_not_found".to_string());
    }
    if let Ok(mut selected_id) = state.selected_cm_session_id.lock() {
        *selected_id = Some(session_id.clone());
    }

    let mut selected_session = None;
    for session in sessions.iter_mut() {
        session.selected = session.id == session_id;
        if session.selected && is_active_cm_runtime_session(&state, &session.id) {
            session.status = "runtime-active".to_string();
            session.runtime_status = "runtime-active".to_string();
        } else {
            session.status = "metadata-only".to_string();
            session.runtime_status = "stopped".to_string();
        }
        if session.selected {
            selected_session = Some(session.clone());
        }
    }
    selected_session.ok_or_else(|| "desktop_cm_session_not_found".to_string())
}

#[tauri::command]
fn desktop_delete_cm_session(
    session_id: String,
    state: State<'_, DesktopSidecarState>,
) -> Result<Vec<DesktopCmSessionMetadata>, String> {
    let session_id = normalize_cm_session_id(&session_id)?;
    if is_active_cm_runtime_session(&state, &session_id) {
        stop_cm_session_runtime_state(&state);
    }
    let mut sessions = state
        .cm_sessions
        .lock()
        .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
    let original_count = sessions.len();
    let removed_session = sessions
        .iter()
        .find(|session| session.id == session_id)
        .cloned()
        .ok_or_else(|| "desktop_cm_session_not_found".to_string())?;
    if removed_session.credential_available {
        os_credential_store::delete_secret(DESKTOP_CM_SSH_CREDENTIAL_SERVICE, &session_id)?;
    } else {
        let _ = os_credential_store::delete_secret(DESKTOP_CM_SSH_CREDENTIAL_SERVICE, &session_id);
    }
    sessions.retain(|session| session.id != session_id);
    if sessions.len() == original_count {
        return Err("desktop_cm_session_not_found".to_string());
    }
    if let Ok(mut selected_id) = state.selected_cm_session_id.lock() {
        if selected_id.as_deref().is_some_and(|selected| selected == session_id) {
            *selected_id = None;
        }
    }
    Ok(sessions.clone())
}

#[tauri::command]
fn desktop_import_cm_session_private_key(
    session_id: String,
    key_file_path: String,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopCmSessionMetadata, String> {
    let session_id = normalize_cm_session_id(&session_id)?;
    let private_key = read_desktop_cm_private_key_file(&key_file_path)?;
    os_credential_store::write_secret(DESKTOP_CM_SSH_CREDENTIAL_SERVICE, &session_id, &private_key)?;

    let mut sessions = state
        .cm_sessions
        .lock()
        .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
    let session = find_cm_session_mut(&mut sessions, &session_id)?;
    session.credential_store = os_credential_store::store_name().to_string();
    session.credential_available = true;
    session.status = "credential-ready".to_string();
    session.updated_at = current_unix_millis();
    session.last_check_status = "credential-ready".to_string();
    session.last_check_at = Some(session.updated_at);
    session.last_check_message = Some("private-key-imported".to_string());
    apply_cm_session_diagnostic(session, cm_session_diagnostic("credential", "info", "private-key-imported", "Run connection check to verify SSH auth and reachability."));
    Ok(session.clone())
}

#[tauri::command]
fn desktop_delete_cm_session_credential(
    session_id: String,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopCmSessionMetadata, String> {
    let session_id = normalize_cm_session_id(&session_id)?;
    if is_active_cm_runtime_session(&state, &session_id) {
        stop_cm_session_runtime_state(&state);
    }
    os_credential_store::delete_secret(DESKTOP_CM_SSH_CREDENTIAL_SERVICE, &session_id)?;

    let mut sessions = state
        .cm_sessions
        .lock()
        .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
    let session = find_cm_session_mut(&mut sessions, &session_id)?;
    session.credential_store = os_credential_store::store_name().to_string();
    session.credential_available = false;
    session.status = "credential-deleted".to_string();
    session.runtime_status = "stopped".to_string();
    session.updated_at = current_unix_millis();
    session.last_check_status = "credential-deleted".to_string();
    session.last_check_at = Some(session.updated_at);
    session.last_check_message = Some("credential-deleted".to_string());
    apply_cm_session_diagnostic(session, cm_session_diagnostic("credential", "warning", "credential-deleted", "Import a private key credential before starting runtime."));
    Ok(session.clone())
}

#[tauri::command]
fn desktop_check_cm_session(
    session_id: String,
    state: State<'_, DesktopSidecarState>,
) -> Result<DesktopCmSessionMetadata, String> {
    let session_id = normalize_cm_session_id(&session_id)?;
    let session_snapshot = {
        let sessions = state
            .cm_sessions
            .lock()
            .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
        sessions
            .iter()
            .find(|session| session.id == session_id)
            .cloned()
            .ok_or_else(|| "desktop_cm_session_not_found".to_string())?
    };

    let stored_private_key = os_credential_store::read_secret(DESKTOP_CM_SSH_CREDENTIAL_SERVICE, &session_id)
        .map(|secret| secret.filter(|value| !value.trim().is_empty()));
    let (credential_available, outcome) = match stored_private_key {
        Ok(Some(private_key)) => (true, check_cm_session_with_private_key(&session_snapshot, &private_key)),
        Ok(None) => (false, check_cm_session_reachability(&session_snapshot)),
        Err(_) => (
            false,
            DesktopCmSessionCheckOutcome {
                status: "credential-missing".to_string(),
                message: "credential-store-unavailable".to_string(),
            },
        ),
    };

    let mut sessions = state
        .cm_sessions
        .lock()
        .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
    let session = find_cm_session_mut(&mut sessions, &session_id)?;
    session.credential_store = os_credential_store::store_name().to_string();
    session.credential_available = credential_available;
    session.status = outcome.status.clone();
    session.updated_at = current_unix_millis();
    let diagnostic = cm_session_diagnostic_for_check(&outcome.status, &outcome.message, credential_available);
    session.last_check_status = outcome.status;
    session.last_check_at = Some(session.updated_at);
    session.last_check_message = Some(outcome.message);
    apply_cm_session_diagnostic(session, diagnostic);
    Ok(session.clone())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DesktopSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_sidecar_profile,
            desktop_kubernetes_profiles,
            desktop_select_kubernetes_profile,
            desktop_delete_kubernetes_profile_credential,
            desktop_cm_sessions,
            desktop_cm_session_runtime,
            desktop_start_cm_session_runtime,
            desktop_stop_cm_session_runtime,
            desktop_check_cm_session_runtime,
            desktop_save_cm_session,
            desktop_select_cm_session,
            desktop_delete_cm_session,
            desktop_import_cm_session_private_key,
            desktop_delete_cm_session_credential,
            desktop_check_cm_session
        ])
        .setup(|app| {
            initialize_desktop_cm_sessions(app.handle());
            initialize_desktop_kubernetes_profiles(app.handle());
            if env_flag_enabled("KUVIEWER_DESKTOP_ENABLE_PROTOTYPE_SIDECAR") {
                if let Err(error) = start_desktop_sidecar(app.handle()) {
                    eprintln!("kuviewer desktop sidecar not started: {error}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                stop_cm_session_runtime(window.app_handle());
                stop_desktop_sidecar(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Kuviewer desktop shell");
}

fn start_desktop_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    start_desktop_sidecar_with_config(app, default_desktop_sidecar_runtime_config())
}

fn start_desktop_sidecar_with_config(
    app: &tauri::AppHandle,
    config: DesktopSidecarRuntimeConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    if env_flag_enabled("KUVIEWER_DESKTOP_DISABLE_SIDECAR") {
        return Ok(());
    }

    let admin_token = generate_admin_token().map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::Other, "desktop_admin_token_random_failed")
    })?;
    let runtime_token_file = config.kube_token_file.clone();
    let mut command = app
        .shell()
        .sidecar("kuviewer-sidecar")?
        .env("KUVIEWER_LISTEN_ADDR", SIDECAR_LISTEN_ADDR)
        .env("KUVIEWER_ADMIN_TOKEN", &admin_token)
        .env("KUVIEWER_SOURCE", &config.source);
    if let Some(api_server) = config.kube_api_server.as_deref() {
        command = command.env("KUVIEWER_KUBE_API_SERVER", api_server);
    }
    if let Some(token_file) = config.kube_token_file.as_ref() {
        command = command.env("KUVIEWER_KUBE_TOKEN_FILE", token_file.to_string_lossy().to_string());
    }
    let (mut receiver, child) = command.spawn()?;

    let state = app.state::<DesktopSidecarState>();
    if let Ok(mut profile) = state.profile.lock() {
        *profile = Some(DesktopSidecarProfile {
            server_url: SIDECAR_SERVER_URL.to_string(),
            admin_token,
            source: config.source,
            kubernetes_profile_id: config.kubernetes_profile_id,
        });
    }
    if let Ok(mut stored_child) = state.child.lock() {
        *stored_child = Some(child);
    }
    if let Some(token_file) = config.kube_token_file {
        if let Ok(mut runtime_files) = state.runtime_temp_files.lock() {
            runtime_files.push(token_file);
        }
    }

    let cleanup_token_file = runtime_token_file.clone();
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
                    if let Some(path) = cleanup_token_file.as_deref() {
                        remove_runtime_file(path);
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn default_desktop_sidecar_runtime_config() -> DesktopSidecarRuntimeConfig {
    let source = std::env::var("KUVIEWER_DESKTOP_SIDECAR_SOURCE")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "mock".to_string());
    DesktopSidecarRuntimeConfig {
        source,
        kubernetes_profile_id: None,
        kube_api_server: None,
        kube_token_file: None,
    }
}

fn restart_desktop_sidecar_for_kubernetes_profile(
    app: &tauri::AppHandle,
    profile: &DesktopKubernetesProfileMetadata,
) -> Result<(), String> {
    let token = os_credential_store::read_bearer_token(DESKTOP_KUBE_CREDENTIAL_SERVICE, &profile.id)?
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "desktop_kubernetes_credential_unavailable".to_string())?;
    let token_file = write_runtime_kubernetes_token_file(&profile.id, &token)?;
    stop_desktop_sidecar(app);
    let config = DesktopSidecarRuntimeConfig {
        source: "kubernetes".to_string(),
        kubernetes_profile_id: Some(profile.id.clone()),
        kube_api_server: Some(profile.api_server.clone()),
        kube_token_file: Some(token_file.clone()),
    };
    if let Err(error) = start_desktop_sidecar_with_config(app, config) {
        remove_runtime_file(&token_file);
        return Err(format!("desktop_kubernetes_sidecar_restart_failed:{error}"));
    }
    Ok(())
}

fn write_runtime_kubernetes_token_file(profile_id: &str, token: &str) -> Result<PathBuf, String> {
    let dir_name = format!(
        "kuviewer-desktop-{}-{}",
        profile_id,
        generate_admin_token().map_err(|_| "desktop_runtime_token_file_random_failed".to_string())?
    );
    let runtime_dir = std::env::temp_dir().join(dir_name);
    fs::create_dir_all(&runtime_dir).map_err(|_| "desktop_runtime_token_dir_unavailable".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&runtime_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "desktop_runtime_token_dir_permissions_failed".to_string())?;
    }

    let token_file = runtime_dir.join("kubernetes-token");
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&token_file)
            .map_err(|_| "desktop_runtime_token_file_unavailable".to_string())?
    };
    #[cfg(not(unix))]
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&token_file)
        .map_err(|_| "desktop_runtime_token_file_unavailable".to_string())?;

    file.write_all(token.as_bytes())
        .map_err(|_| "desktop_runtime_token_file_write_failed".to_string())?;
    Ok(token_file)
}

fn remove_runtime_file(path: &Path) {
    let _ = fs::remove_file(path);
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir(parent);
    }
}

fn cleanup_runtime_files(state: &DesktopSidecarState) {
    if let Ok(mut runtime_files) = state.runtime_temp_files.lock() {
        for path in runtime_files.drain(..) {
            remove_runtime_file(&path);
        }
    }
}

fn stop_cm_session_runtime(app: &tauri::AppHandle) {
    let state = app.state::<DesktopSidecarState>();
    stop_cm_session_runtime_state(&state);
}

fn stop_cm_session_runtime_state(state: &DesktopSidecarState) {
    let stopped_profile = state
        .cm_runtime_profile
        .lock()
        .ok()
        .and_then(|mut profile| profile.take());

    if let Ok(mut child) = state.cm_runtime_child.lock() {
        if let Some(mut child) = child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    cleanup_cm_runtime_files(state);

    if let Some(profile) = stopped_profile {
        mark_cm_session_runtime_stopped(state, &profile.session_id);
    }
}

fn cleanup_cm_runtime_files(state: &DesktopSidecarState) {
    if let Ok(mut runtime_files) = state.cm_runtime_temp_files.lock() {
        for path in runtime_files.drain(..) {
            remove_runtime_file(&path);
        }
    }
}

fn is_active_cm_runtime_session(state: &DesktopSidecarState, session_id: &str) -> bool {
    state
        .cm_runtime_profile
        .lock()
        .ok()
        .and_then(|profile| profile.clone())
        .is_some_and(|profile| profile.session_id == session_id)
}

fn mark_cm_session_runtime_stopped(state: &DesktopSidecarState, session_id: &str) {
    if let Ok(mut sessions) = state.cm_sessions.lock() {
        if let Some(session) = sessions.iter_mut().find(|session| session.id == session_id) {
            session.runtime_status = "stopped".to_string();
            session.status = if session.credential_available {
                "credential-ready".to_string()
            } else {
                "metadata-only".to_string()
            };
            session.updated_at = current_unix_millis();
            apply_cm_session_diagnostic(session, cm_session_diagnostic("runtime", "info", "runtime-stopped", "필요하면 runtime을 다시 시작하세요."));
        }
    }
}

fn mark_cm_session_runtime_lost(state: &DesktopSidecarState, session_id: &str) {
    if let Ok(mut sessions) = state.cm_sessions.lock() {
        if let Some(session) = sessions.iter_mut().find(|session| session.id == session_id) {
            session.runtime_status = "runtime-lost".to_string();
            session.status = "runtime-lost".to_string();
            session.updated_at = current_unix_millis();
            apply_cm_session_diagnostic(session, cm_session_diagnostic("runtime", "error", "runtime-lost", "SSH 터널 프로세스가 종료됐습니다. runtime을 다시 시작하세요."));
        }
    }
}

fn mark_cm_session_runtime_start_failed(state: &DesktopSidecarState, session_id: &str, error: &str) {
    if let Ok(mut sessions) = state.cm_sessions.lock() {
        if let Some(session) = sessions.iter_mut().find(|session| session.id == session_id) {
            session.runtime_status = "runtime-unhealthy".to_string();
            session.status = "runtime-unhealthy".to_string();
            session.updated_at = current_unix_millis();
            apply_cm_session_diagnostic(session, cm_runtime_diagnostic_for_start_error(error));
        }
    }
}

fn check_cm_session_runtime_state(
    state: &DesktopSidecarState,
) -> Result<Option<DesktopCmSessionRuntimeProfile>, String> {
    let profile_snapshot = state
        .cm_runtime_profile
        .lock()
        .map_err(|_| "desktop_cm_runtime_profile_state_unavailable".to_string())?
        .clone();
    let Some(profile_snapshot) = profile_snapshot else {
        return Ok(None);
    };

    let child_missing_or_exited = {
        let mut child_slot = state
            .cm_runtime_child
            .lock()
            .map_err(|_| "desktop_cm_runtime_child_state_unavailable".to_string())?;
        let should_clear_child = match child_slot.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => true,
                Ok(None) => false,
                Err(_) => true,
            },
            None => true,
        };
        if should_clear_child {
            if let Some(mut exited_child) = child_slot.take() {
                let _ = exited_child.kill();
                let _ = exited_child.wait();
            }
        }
        should_clear_child
    };

    if child_missing_or_exited {
        if let Ok(mut profile_slot) = state.cm_runtime_profile.lock() {
            *profile_slot = None;
        }
        cleanup_cm_runtime_files(state);
        mark_cm_session_runtime_lost(state, &profile_snapshot.session_id);
        return Ok(None);
    }

    let now = current_unix_millis();
    let health_ok = probe_cm_runtime_health(profile_snapshot.local_port);
    let mut updated_profile = profile_snapshot.clone();
    updated_profile.health_status = if health_ok {
        "healthy".to_string()
    } else {
        "unhealthy".to_string()
    };
    updated_profile.last_health_at = Some(now);
    updated_profile.last_health_message = Some(if health_ok {
        "healthz-ok".to_string()
    } else {
        "healthz-unavailable".to_string()
    });
    updated_profile.last_error = if health_ok {
        None
    } else {
        Some("desktop_cm_runtime_health_unavailable".to_string())
    };
    apply_cm_runtime_diagnostic(
        &mut updated_profile,
        cm_runtime_diagnostic_for_health(health_ok, updated_profile.last_health_message.as_deref().unwrap_or("healthz-unavailable")),
    );

    {
        let mut profile_slot = state
            .cm_runtime_profile
            .lock()
            .map_err(|_| "desktop_cm_runtime_profile_state_unavailable".to_string())?;
        *profile_slot = Some(updated_profile.clone());
    }
    if let Ok(mut sessions) = state.cm_sessions.lock() {
        if let Some(session) = sessions.iter_mut().find(|session| session.id == updated_profile.session_id) {
            session.runtime_status = if health_ok {
                "runtime-active".to_string()
            } else {
                "runtime-unhealthy".to_string()
            };
            session.status = session.runtime_status.clone();
            session.updated_at = now;
            apply_cm_session_diagnostic(
                session,
                cm_runtime_diagnostic_for_health(health_ok, updated_profile.last_health_message.as_deref().unwrap_or("healthz-unavailable")),
            );
        }
    }

    Ok(Some(updated_profile))
}

fn start_cm_session_ssh_tunnel(
    state: &DesktopSidecarState,
    session: DesktopCmSessionMetadata,
    private_key: &str,
) -> Result<DesktopCmSessionRuntimeProfile, String> {
    let key_file = write_runtime_cm_private_key_file(&session.id, private_key)?;
    let local_port = reserve_cm_runtime_local_port()?;
    let mut command = Command::new("ssh");
    command
        .arg("-i")
        .arg(&key_file)
        .arg("-p")
        .arg(session.port.to_string())
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-o")
        .arg("ConnectTimeout=6")
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg(format!("UserKnownHostsFile={}", platform_null_file()))
        .arg("-o")
        .arg("LogLevel=ERROR")
        .arg("-N")
        .arg("-L")
        .arg(format!(
            "127.0.0.1:{local_port}:{}:{}",
            session.remote_api_host, session.remote_api_port
        ))
        .arg(format!("{}@{}", session.user, session.host))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            remove_runtime_file(&key_file);
            return Err("desktop_cm_runtime_ssh_binary_missing".to_string());
        }
        Err(_) => {
            remove_runtime_file(&key_file);
            return Err("desktop_cm_runtime_process_start_failed".to_string());
        }
    };

    if let Err(error) = wait_for_cm_runtime_health(&mut child, local_port) {
        let _ = child.kill();
        let _ = child.wait();
        remove_runtime_file(&key_file);
        return Err(error);
    }

    let started_at = current_unix_millis();
    let mut profile = DesktopCmSessionRuntimeProfile {
        session_id: session.id.clone(),
        session_name: session.name.clone(),
        server_url: format!("http://127.0.0.1:{local_port}"),
        remote_api_host: session.remote_api_host.clone(),
        remote_api_port: session.remote_api_port,
        local_port,
        status: "runtime-active".to_string(),
        started_at,
        health_status: "healthy".to_string(),
        last_health_at: Some(started_at),
        last_health_message: Some("healthz-ok".to_string()),
        last_error: None,
        diagnostic_stage: None,
        diagnostic_severity: None,
        diagnostic_message: None,
        diagnostic_hint: None,
    };
    apply_cm_runtime_diagnostic(&mut profile, cm_runtime_diagnostic_for_health(true, "healthz-ok"));

    if let Ok(mut runtime_files) = state.cm_runtime_temp_files.lock() {
        runtime_files.push(key_file);
    } else {
        let _ = child.kill();
        let _ = child.wait();
        remove_runtime_file(&key_file);
        return Err("desktop_cm_runtime_temp_state_unavailable".to_string());
    }

    if let Ok(mut child_slot) = state.cm_runtime_child.lock() {
        *child_slot = Some(child);
    } else {
        let _ = child.kill();
        let _ = child.wait();
        cleanup_cm_runtime_files(state);
        return Err("desktop_cm_runtime_child_state_unavailable".to_string());
    }

    if let Ok(mut profile_slot) = state.cm_runtime_profile.lock() {
        *profile_slot = Some(profile.clone());
    } else {
        stop_cm_session_runtime_state(state);
        return Err("desktop_cm_runtime_profile_state_unavailable".to_string());
    }

    if let Ok(mut selected_id) = state.selected_cm_session_id.lock() {
        *selected_id = Some(session.id.clone());
    }
    if let Ok(mut sessions) = state.cm_sessions.lock() {
        for stored_session in sessions.iter_mut() {
            stored_session.selected = stored_session.id == session.id;
            if stored_session.id == session.id {
                stored_session.runtime_status = "runtime-active".to_string();
                stored_session.status = "runtime-active".to_string();
                stored_session.credential_available = true;
                stored_session.updated_at = profile.started_at;
                apply_cm_session_diagnostic(stored_session, cm_runtime_diagnostic_for_health(true, "healthz-ok"));
            } else if stored_session.runtime_status == "runtime-active" {
                stored_session.runtime_status = "stopped".to_string();
            }
        }
    }

    Ok(profile)
}

fn reserve_cm_runtime_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "desktop_cm_runtime_local_port_unavailable".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "desktop_cm_runtime_local_port_unavailable".to_string())?
        .port();
    drop(listener);
    Ok(port)
}

fn wait_for_cm_runtime_health(child: &mut Child, local_port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(DESKTOP_CM_RUNTIME_HEALTH_TIMEOUT_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Err("desktop_cm_runtime_tunnel_failed".to_string()),
            Ok(None) => {
                if probe_cm_runtime_health(local_port) {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    return Err("desktop_cm_runtime_health_timeout".to_string());
                }
                thread::sleep(Duration::from_millis(150));
            }
            Err(_) => return Err("desktop_cm_runtime_tunnel_failed".to_string()),
        }
    }
}

fn probe_cm_runtime_health(local_port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], local_port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(700)));
    if stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buffer = [0u8; 4096];
    let Ok(count) = stream.read(&mut buffer) else {
        return false;
    };
    let response = String::from_utf8_lossy(&buffer[..count]);
    response.contains("200 OK") && response.contains("\"ok\":true")
}

fn initialize_desktop_cm_sessions(app: &tauri::AppHandle) {
    let sessions = load_desktop_cm_sessions_from_env();
    let selected_session_id = sessions.first().map(|session| session.id.clone());
    let state = app.state::<DesktopSidecarState>();
    if let Ok(mut stored_sessions) = state.cm_sessions.lock() {
        *stored_sessions = sessions;
    }
    if let Ok(mut selected) = state.selected_cm_session_id.lock() {
        *selected = selected_session_id;
    };
}

fn load_desktop_cm_sessions_from_env() -> Vec<DesktopCmSessionMetadata> {
    let Some(host) = read_safe_env("KUVIEWER_DESKTOP_CM_SESSION_HOST") else {
        return Vec::new();
    };

    let input = DesktopCmSessionInput {
        id: read_safe_env("KUVIEWER_DESKTOP_CM_SESSION_ID"),
        name: read_safe_env("KUVIEWER_DESKTOP_CM_SESSION_NAME").unwrap_or_else(|| "Environment CM session".to_string()),
        host,
        port: read_safe_env("KUVIEWER_DESKTOP_CM_SESSION_PORT")
            .and_then(|port| port.parse::<u16>().ok())
            .unwrap_or(22),
        user: read_safe_env("KUVIEWER_DESKTOP_CM_SESSION_USER").unwrap_or_else(|| "ubuntu".to_string()),
        remote_api_host: read_safe_env("KUVIEWER_DESKTOP_CM_SESSION_REMOTE_API_HOST"),
        remote_api_port: read_safe_env("KUVIEWER_DESKTOP_CM_SESSION_REMOTE_API_PORT")
            .and_then(|port| port.parse::<u16>().ok()),
        description: read_safe_env("KUVIEWER_DESKTOP_CM_SESSION_DESCRIPTION"),
    };

    normalize_cm_session_input(input)
        .map(|mut session| {
            session.selected = true;
            session
        })
        .into_iter()
        .collect()
}

fn normalize_cm_session_input(input: DesktopCmSessionInput) -> Result<DesktopCmSessionMetadata, String> {
    let name = normalize_bounded_text(&input.name, 60, "desktop_cm_session_name")?;
    let host = normalize_cm_session_host(&input.host)?;
    let user = normalize_cm_session_user(&input.user)?;
    let remote_api_host = input
        .remote_api_host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(normalize_cm_session_remote_api_host)
        .transpose()?
        .unwrap_or_else(|| DESKTOP_CM_DEFAULT_REMOTE_API_HOST.to_string());
    let remote_api_port = input.remote_api_port.unwrap_or(DESKTOP_CM_DEFAULT_REMOTE_API_PORT);
    if input.port == 0 {
        return Err("desktop_cm_session_port_invalid".to_string());
    }
    if remote_api_port == 0 {
        return Err("desktop_cm_session_remote_api_port_invalid".to_string());
    }
    let description = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| normalize_bounded_text(value, 160, "desktop_cm_session_description"))
        .transpose()?;
    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(normalize_cm_session_id)
        .transpose()?
        .unwrap_or_else(|| generated_cm_session_id(&name, &host, &user));

    let mut session = DesktopCmSessionMetadata {
        id,
        name,
        host,
        port: input.port,
        user,
        remote_api_host,
        remote_api_port,
        auth_type: "os-credential-store".to_string(),
        credential_store: os_credential_store::store_name().to_string(),
        credential_available: false,
        status: "metadata-only".to_string(),
        runtime_status: "stopped".to_string(),
        updated_at: current_unix_millis(),
        selected: false,
        description,
        last_check_status: "not-checked".to_string(),
        last_check_at: None,
        last_check_message: None,
        diagnostic_stage: Some("metadata".to_string()),
        diagnostic_severity: Some("info".to_string()),
        diagnostic_message: Some("not-checked".to_string()),
        diagnostic_hint: Some("Run connection check to verify SSH reachability.".to_string()),
    };
    refresh_cm_session_credential_state(&mut session);
    Ok(session)
}

fn normalize_cm_session_host(value: &str) -> Result<String, String> {
    let host = normalize_bounded_text(value, 180, "desktop_cm_session_host")?.to_ascii_lowercase();
    if host.contains("://")
        || host.contains('/')
        || host.contains('?')
        || host.contains('#')
        || host.contains('@')
        || host.contains(':')
    {
        return Err("desktop_cm_session_host_invalid".to_string());
    }
    if !host
        .chars()
        .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || matches!(character, '-' | '.'))
        || !host
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
    {
        return Err("desktop_cm_session_host_invalid".to_string());
    }
    Ok(host)
}

fn normalize_cm_session_remote_api_host(value: &str) -> Result<String, String> {
    let host = normalize_bounded_text(value, 180, "desktop_cm_session_remote_api_host")?.to_ascii_lowercase();
    if host.contains("://")
        || host.contains('/')
        || host.contains('?')
        || host.contains('#')
        || host.contains('@')
        || host.contains(':')
    {
        return Err("desktop_cm_session_remote_api_host_invalid".to_string());
    }
    if !host
        .chars()
        .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || matches!(character, '-' | '.'))
        || !host
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
    {
        return Err("desktop_cm_session_remote_api_host_invalid".to_string());
    }
    Ok(host)
}

fn normalize_cm_session_user(value: &str) -> Result<String, String> {
    let user = normalize_bounded_text(value, 80, "desktop_cm_session_user")?;
    if !user
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err("desktop_cm_session_user_invalid".to_string());
    }
    Ok(user)
}

fn normalize_cm_session_id(value: &str) -> Result<String, String> {
    let session_id = value.trim();
    if session_id.is_empty()
        || session_id.len() > 80
        || !session_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err("desktop_cm_session_id_invalid".to_string());
    }
    Ok(session_id.to_string())
}

fn normalize_bounded_text(value: &str, max_len: usize, error_prefix: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{error_prefix}_required"));
    }
    if trimmed.len() > max_len {
        return Err(format!("{error_prefix}_too_long"));
    }
    Ok(trimmed.to_string())
}

fn generated_cm_session_id(name: &str, host: &str, user: &str) -> String {
    let base = format!("{name}-{user}-{host}");
    let slug: String = base
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    format!("{}-{}", trimmed.chars().take(52).collect::<String>(), current_unix_millis())
}

fn find_cm_session_mut<'a>(
    sessions: &'a mut [DesktopCmSessionMetadata],
    session_id: &str,
) -> Result<&'a mut DesktopCmSessionMetadata, String> {
    sessions
        .iter_mut()
        .find(|session| session.id == session_id)
        .ok_or_else(|| "desktop_cm_session_not_found".to_string())
}

fn refresh_cm_session_credential_state(session: &mut DesktopCmSessionMetadata) {
    session.credential_store = os_credential_store::store_name().to_string();
    match os_credential_store::has_secret(DESKTOP_CM_SSH_CREDENTIAL_SERVICE, &session.id) {
        Ok(true) => {
            session.credential_available = true;
            if matches!(session.status.as_str(), "metadata-only" | "credential-deleted") {
                session.status = "credential-ready".to_string();
            }
        }
        Ok(false) => {
            session.credential_available = false;
        }
        Err(_) => {
            session.credential_available = false;
            if session.status == "credential-ready" {
                session.status = "credential-store-unavailable".to_string();
            }
        }
    }
}

#[derive(Clone)]
struct DesktopCmDiagnostic {
    stage: &'static str,
    severity: &'static str,
    message: String,
    hint: &'static str,
}

fn cm_session_diagnostic(stage: &'static str, severity: &'static str, message: &str, hint: &'static str) -> DesktopCmDiagnostic {
    DesktopCmDiagnostic {
        stage,
        severity,
        message: message.to_string(),
        hint,
    }
}

fn apply_cm_session_diagnostic(session: &mut DesktopCmSessionMetadata, diagnostic: DesktopCmDiagnostic) {
    session.diagnostic_stage = Some(diagnostic.stage.to_string());
    session.diagnostic_severity = Some(diagnostic.severity.to_string());
    session.diagnostic_message = Some(diagnostic.message);
    session.diagnostic_hint = Some(diagnostic.hint.to_string());
}

fn apply_cm_runtime_diagnostic(profile: &mut DesktopCmSessionRuntimeProfile, diagnostic: DesktopCmDiagnostic) {
    profile.diagnostic_stage = Some(diagnostic.stage.to_string());
    profile.diagnostic_severity = Some(diagnostic.severity.to_string());
    profile.diagnostic_message = Some(diagnostic.message);
    profile.diagnostic_hint = Some(diagnostic.hint.to_string());
}

fn cm_session_diagnostic_for_check(status: &str, message: &str, credential_available: bool) -> DesktopCmDiagnostic {
    match status {
        "reachable" if credential_available => cm_session_diagnostic("ssh-auth", "info", message, "SSH auth check completed. Runtime can be started."),
        "reachable" => cm_session_diagnostic("reachability", "info", message, "TCP/SSH banner responded. Import a private key to verify SSH auth."),
        "auth-failed" => cm_session_diagnostic("ssh-auth", "error", message, "Check private key, user, and authorized_keys on the CM server."),
        "timeout" => cm_session_diagnostic("reachability", "error", message, "Check firewall, security group, port, and bastion route."),
        "not-ssh" => cm_session_diagnostic("reachability", "error", message, "Check that the host and port point to an SSH endpoint."),
        "ssh-binary-missing" => cm_session_diagnostic("reachability", "error", message, "Make the local ssh executable available to the desktop runtime."),
        "credential-missing" => cm_session_diagnostic("credential", "warning", message, "Import the private key credential again."),
        _ => cm_session_diagnostic("reachability", "error", message, "Check host, port, DNS, and network route before retrying."),
    }
}

fn cm_runtime_diagnostic_for_health(healthy: bool, message: &str) -> DesktopCmDiagnostic {
    if healthy {
        cm_session_diagnostic("health", "info", message, "Localhost tunnel and remote Kuviewer API health are healthy.")
    } else {
        cm_session_diagnostic("health", "error", message, "Check remote Kuviewer API /healthz, SSH tunnel, and CM network.")
    }
}

fn cm_runtime_diagnostic_for_start_error(error: &str) -> DesktopCmDiagnostic {
    if error.contains("ssh_binary") {
        cm_session_diagnostic("tunnel", "error", "ssh-binary-missing", "Make the local ssh executable available to the desktop runtime.")
    } else if error.contains("credential") {
        cm_session_diagnostic("credential", "warning", error, "Import a private key credential before starting runtime.")
    } else if error.contains("health") {
        cm_session_diagnostic("health", "error", error, "SSH tunnel started, but remote Kuviewer API /healthz did not respond.")
    } else {
        cm_session_diagnostic("tunnel", "error", error, "Check SSH tunnel options, CM server reachability, and remote API host/port.")
    }
}

fn read_desktop_cm_private_key_file(key_file_path: &str) -> Result<String, String> {
    let path = expand_user_path(key_file_path)?;
    let canonical_path = fs::canonicalize(&path).map_err(|_| "desktop_cm_private_key_file_unavailable".to_string())?;
    reject_disallowed_private_key_path(&canonical_path)?;
    let metadata = fs::metadata(&canonical_path).map_err(|_| "desktop_cm_private_key_file_unavailable".to_string())?;
    if !metadata.is_file() {
        return Err("desktop_cm_private_key_file_invalid".to_string());
    }
    if metadata.len() == 0 || metadata.len() > MAX_DESKTOP_CM_PRIVATE_KEY_BYTES {
        return Err("desktop_cm_private_key_file_size".to_string());
    }

    let private_key = fs::read_to_string(&canonical_path)
        .map_err(|_| "desktop_cm_private_key_file_unreadable".to_string())?;
    validate_desktop_cm_private_key(&private_key)?;
    Ok(format!("{}\n", private_key.trim_end()))
}

fn expand_user_path(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 1024 || trimmed.contains('\0') {
        return Err("desktop_cm_private_key_path_invalid".to_string());
    }
    if trimmed == "~" || trimmed.starts_with("~/") {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map_err(|_| "desktop_cm_private_key_path_invalid".to_string())?;
        if trimmed == "~" {
            return Ok(PathBuf::from(home));
        }
        return Ok(PathBuf::from(home).join(&trimmed[2..]));
    }
    Ok(PathBuf::from(trimmed))
}

fn reject_disallowed_private_key_path(path: &Path) -> Result<(), String> {
    if let Ok(current_dir) = std::env::current_dir().and_then(fs::canonicalize) {
        if path.starts_with(current_dir) {
            return Err("desktop_cm_private_key_repo_path_rejected".to_string());
        }
    }
    let normalized = path.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
    for marker in [
        "/.git/",
        "/website/dist/",
        "/website/artifacts/",
        "/desktop/src-tauri/binaries/",
    ] {
        if normalized.contains(marker) {
            return Err("desktop_cm_private_key_repo_path_rejected".to_string());
        }
    }
    Ok(())
}

fn validate_desktop_cm_private_key(private_key: &str) -> Result<(), String> {
    if private_key.contains('\0') {
        return Err("desktop_cm_private_key_invalid".to_string());
    }
    let markers = [
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----",
        "-----BEGIN DSA PRIVATE KEY-----",
    ];
    if !markers.iter().any(|marker| private_key.contains(marker)) {
        return Err("desktop_cm_private_key_marker_missing".to_string());
    }
    Ok(())
}

fn check_cm_session_with_private_key(
    session: &DesktopCmSessionMetadata,
    private_key: &str,
) -> DesktopCmSessionCheckOutcome {
    match write_runtime_cm_private_key_file(&session.id, private_key) {
        Ok(key_file) => {
            let outcome = run_ssh_noop_check(session, &key_file);
            remove_runtime_file(&key_file);
            outcome
        }
        Err(error) => DesktopCmSessionCheckOutcome {
            status: "credential-missing".to_string(),
            message: error,
        },
    }
}

fn run_ssh_noop_check(session: &DesktopCmSessionMetadata, key_file: &Path) -> DesktopCmSessionCheckOutcome {
    let mut command = Command::new("ssh");
    command
        .arg("-i")
        .arg(key_file)
        .arg("-p")
        .arg(session.port.to_string())
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=6")
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg(format!("UserKnownHostsFile={}", platform_null_file()))
        .arg("-o")
        .arg("LogLevel=ERROR")
        .arg("-T")
        .arg(format!("{}@{}", session.user, session.host))
        .arg("true")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return DesktopCmSessionCheckOutcome {
                status: "ssh-binary-missing".to_string(),
                message: "ssh-binary-missing".to_string(),
            };
        }
        Err(_) => {
            return DesktopCmSessionCheckOutcome {
                status: "unreachable".to_string(),
                message: "ssh-process-start-failed".to_string(),
            };
        }
    };

    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                return classify_ssh_check_result(status.success(), &stderr);
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return DesktopCmSessionCheckOutcome {
                    status: "timeout".to_string(),
                    message: "ssh-check-timeout".to_string(),
                };
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                return DesktopCmSessionCheckOutcome {
                    status: "unreachable".to_string(),
                    message: "ssh-check-failed".to_string(),
                };
            }
        }
    }
}

fn classify_ssh_check_result(success: bool, stderr: &str) -> DesktopCmSessionCheckOutcome {
    if success {
        return DesktopCmSessionCheckOutcome {
            status: "reachable".to_string(),
            message: "ssh-check-succeeded".to_string(),
        };
    }
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("permission denied") || lower.contains("publickey") || lower.contains("authentication failed") {
        return DesktopCmSessionCheckOutcome {
            status: "auth-failed".to_string(),
            message: "ssh-auth-failed".to_string(),
        };
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return DesktopCmSessionCheckOutcome {
            status: "timeout".to_string(),
            message: "ssh-check-timeout".to_string(),
        };
    }
    if lower.contains("protocol mismatch") || lower.contains("banner") || lower.contains("kex_exchange_identification") {
        return DesktopCmSessionCheckOutcome {
            status: "not-ssh".to_string(),
            message: "ssh-banner-invalid".to_string(),
        };
    }
    if lower.contains("connection refused")
        || lower.contains("could not resolve hostname")
        || lower.contains("name or service not known")
        || lower.contains("no route to host")
        || lower.contains("network is unreachable")
    {
        return DesktopCmSessionCheckOutcome {
            status: "unreachable".to_string(),
            message: "ssh-target-unreachable".to_string(),
        };
    }
    DesktopCmSessionCheckOutcome {
        status: "unreachable".to_string(),
        message: "ssh-check-failed".to_string(),
    }
}

fn check_cm_session_reachability(session: &DesktopCmSessionMetadata) -> DesktopCmSessionCheckOutcome {
    let addresses = match (session.host.as_str(), session.port).to_socket_addrs() {
        Ok(addresses) => addresses.collect::<Vec<_>>(),
        Err(_) => {
            return DesktopCmSessionCheckOutcome {
                status: "unreachable".to_string(),
                message: "host-resolve-failed".to_string(),
            };
        }
    };
    for address in addresses {
        match TcpStream::connect_timeout(&address, Duration::from_secs(5)) {
            Ok(mut stream) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                let mut buffer = [0u8; 4];
                match stream.read(&mut buffer) {
                    Ok(count) if count >= 4 && &buffer == b"SSH-" => {
                        return DesktopCmSessionCheckOutcome {
                            status: "reachable".to_string(),
                            message: "ssh-banner-reachable".to_string(),
                        };
                    }
                    Ok(count) if count > 0 => {
                        return DesktopCmSessionCheckOutcome {
                            status: "not-ssh".to_string(),
                            message: "ssh-banner-invalid".to_string(),
                        };
                    }
                    _ => {
                        return DesktopCmSessionCheckOutcome {
                            status: "reachable".to_string(),
                            message: "tcp-reachable".to_string(),
                        };
                    }
                }
            }
            Err(_) => continue,
        }
    }
    DesktopCmSessionCheckOutcome {
        status: "unreachable".to_string(),
        message: "tcp-unreachable".to_string(),
    }
}

fn write_runtime_cm_private_key_file(session_id: &str, private_key: &str) -> Result<PathBuf, String> {
    let dir_name = format!(
        "kuviewer-desktop-cm-{}-{}",
        session_id,
        generate_admin_token().map_err(|_| "desktop_cm_private_key_temp_random_failed".to_string())?
    );
    let runtime_dir = std::env::temp_dir().join(dir_name);
    fs::create_dir_all(&runtime_dir).map_err(|_| "desktop_cm_private_key_temp_dir_unavailable".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&runtime_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "desktop_cm_private_key_temp_dir_permissions_failed".to_string())?;
    }

    let key_file = runtime_dir.join("identity");
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&key_file)
            .map_err(|_| "desktop_cm_private_key_temp_file_unavailable".to_string())?
    };
    #[cfg(not(unix))]
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&key_file)
        .map_err(|_| "desktop_cm_private_key_temp_file_unavailable".to_string())?;

    file.write_all(private_key.as_bytes())
        .map_err(|_| "desktop_cm_private_key_temp_file_write_failed".to_string())?;
    Ok(key_file)
}

fn platform_null_file() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

fn current_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
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
    };
}

fn load_desktop_kubernetes_profiles_from_env() -> Vec<DesktopKubernetesProfileMetadata> {
    let Some(api_server) = read_safe_env("KUVIEWER_DESKTOP_KUBE_API_SERVER") else {
        return Vec::new();
    };

    let id = read_safe_env("KUVIEWER_DESKTOP_KUBE_PROFILE_ID")
        .and_then(|value| normalize_profile_id(&value).ok())
        .unwrap_or_else(|| "env-bearer-profile".to_string());
    let display_name = read_safe_env("KUVIEWER_DESKTOP_KUBE_PROFILE_NAME")
        .unwrap_or_else(|| "Environment bearer profile".to_string());
    let (credential_store, credential_available, status) = resolve_desktop_kubernetes_credential_state(&id);
    vec![DesktopKubernetesProfileMetadata {
        id,
        display_name,
        api_server,
        auth_type: "bearer-token".to_string(),
        credential_store,
        credential_available,
        selected: true,
        status,
    }]
}

fn resolve_desktop_kubernetes_credential_state(profile_id: &str) -> (String, bool, String) {
    let store_name = os_credential_store::store_name().to_string();
    if env_flag_enabled("KUVIEWER_DESKTOP_KUBE_IMPORT_TOKEN_FILE") {
        return match read_safe_env("KUVIEWER_DESKTOP_KUBE_TOKEN_FILE")
            .ok_or_else(|| "desktop_kubernetes_token_file_required".to_string())
            .and_then(|path| read_desktop_kubernetes_token_file(&path))
            .and_then(|token| os_credential_store::write_bearer_token(DESKTOP_KUBE_CREDENTIAL_SERVICE, profile_id, &token))
        {
            Ok(()) => (store_name, true, "stored-secret-available".to_string()),
            Err(_) => (store_name, false, "credential-store-write-failed".to_string()),
        };
    }

    match os_credential_store::has_bearer_token(DESKTOP_KUBE_CREDENTIAL_SERVICE, profile_id) {
        Ok(true) => (store_name, true, "stored-secret-available".to_string()),
        Ok(false) => (
            "runtime-env-metadata-fixture".to_string(),
            false,
            "metadata-only".to_string(),
        ),
        Err(_) => (store_name, false, "credential-store-unavailable".to_string()),
    }
}

fn read_desktop_kubernetes_token_file(path: &str) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|_| "desktop_kubernetes_token_file_unavailable".to_string())?;
    if !metadata.is_file() {
        return Err("desktop_kubernetes_token_file_invalid".to_string());
    }
    if metadata.len() == 0 || metadata.len() > MAX_DESKTOP_KUBE_TOKEN_BYTES {
        return Err("desktop_kubernetes_token_file_size".to_string());
    }

    let token = fs::read_to_string(path)
        .map_err(|_| "desktop_kubernetes_token_file_unreadable".to_string())?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err("desktop_kubernetes_token_file_empty".to_string());
    }
    Ok(token)
}

fn read_safe_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_profile_id(value: &str) -> Result<String, String> {
    let profile_id = value.trim();
    if profile_id.is_empty() {
        return Err("desktop_kubernetes_profile_required".to_string());
    }
    if profile_id.len() > 80
        || !profile_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err("desktop_kubernetes_profile_invalid".to_string());
    }
    Ok(profile_id.to_string())
}

fn profile_with_selected(
    profile: &DesktopKubernetesProfileMetadata,
    selected_id: Option<&str>,
) -> DesktopKubernetesProfileMetadata {
    let mut next_profile = profile.clone();
    next_profile.selected = selected_id.is_some_and(|id| id == profile.id);
    next_profile
}

fn update_selected_desktop_kubernetes_profile(
    state: &State<'_, DesktopSidecarState>,
    selected_profile: &DesktopKubernetesProfileMetadata,
) -> Result<(), String> {
    if let Ok(mut selected_id) = state.selected_kubernetes_profile_id.lock() {
        *selected_id = Some(selected_profile.id.clone());
    }
    let mut profiles = state
        .kubernetes_profiles
        .lock()
        .map_err(|_| "desktop_kubernetes_profiles_unavailable".to_string())?;
    for profile in profiles.iter_mut() {
        profile.selected = profile.id == selected_profile.id;
        if profile.id == selected_profile.id {
            profile.status = selected_profile.status.clone();
            profile.credential_available = selected_profile.credential_available;
            profile.credential_store = selected_profile.credential_store.clone();
        }
    }
    Ok(())
}

fn stop_desktop_sidecar(app: &tauri::AppHandle) {
    let state = app.state::<DesktopSidecarState>();
    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut profile) = state.profile.lock() {
        *profile = None;
    }
    cleanup_runtime_files(&*state);
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

#[cfg(target_os = "macos")]
mod os_credential_store {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_void};
    use std::ptr;
    use std::slice;

    const ERR_SEC_SUCCESS: i32 = 0;
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainAddGenericPassword(
            keychain: *mut c_void,
            service_name_length: u32,
            service_name: *const c_char,
            account_name_length: u32,
            account_name: *const c_char,
            password_length: u32,
            password_data: *const c_void,
            item_ref: *mut *mut c_void,
        ) -> i32;
        fn SecKeychainFindGenericPassword(
            keychain_or_array: *mut c_void,
            service_name_length: u32,
            service_name: *const c_char,
            account_name_length: u32,
            account_name: *const c_char,
            password_length: *mut u32,
            password_data: *mut *mut c_void,
            item_ref: *mut *mut c_void,
        ) -> i32;
        fn SecKeychainItemDelete(item_ref: *mut c_void) -> i32;
        fn SecKeychainItemFreeContent(attr_list: *mut c_void, data: *mut c_void) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *mut c_void);
    }

    pub fn store_name() -> &'static str {
        "macos-keychain"
    }

    pub fn write_bearer_token(service: &str, account: &str, token: &str) -> Result<(), String> {
        write_secret(service, account, token)
    }

    pub fn has_bearer_token(service: &str, account: &str) -> Result<bool, String> {
        has_secret(service, account)
    }

    pub fn delete_bearer_token(service: &str, account: &str) -> Result<(), String> {
        delete_secret(service, account)
    }

    pub fn read_bearer_token(service: &str, account: &str) -> Result<Option<String>, String> {
        read_secret(service, account)
    }

    pub fn write_secret(service: &str, account: &str, secret: &str) -> Result<(), String> {
        let _ = delete_secret(service, account);
        let service = c_string(service, "desktop_credential_service_invalid")?;
        let account = c_string(account, "desktop_credential_account_invalid")?;
        let secret_bytes = secret.as_bytes();
        let status = unsafe {
            SecKeychainAddGenericPassword(
                ptr::null_mut(),
                service.as_bytes().len() as u32,
                service.as_ptr(),
                account.as_bytes().len() as u32,
                account.as_ptr(),
                secret_bytes.len() as u32,
                secret_bytes.as_ptr() as *const c_void,
                ptr::null_mut(),
            )
        };
        if status == ERR_SEC_SUCCESS {
            Ok(())
        } else {
            Err(format!("desktop_macos_keychain_write_failed:{status}"))
        }
    }

    pub fn has_secret(service: &str, account: &str) -> Result<bool, String> {
        read_secret(service, account).map(|secret| secret.is_some())
    }

    pub fn delete_secret(service: &str, account: &str) -> Result<(), String> {
        let service = c_string(service, "desktop_credential_service_invalid")?;
        let account = c_string(account, "desktop_credential_account_invalid")?;
        let mut item_ref: *mut c_void = ptr::null_mut();
        let status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null_mut(),
                service.as_bytes().len() as u32,
                service.as_ptr(),
                account.as_bytes().len() as u32,
                account.as_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                &mut item_ref,
            )
        };
        if status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(());
        }
        if status != ERR_SEC_SUCCESS {
            return Err(format!("desktop_macos_keychain_lookup_failed:{status}"));
        }

        let delete_status = unsafe { SecKeychainItemDelete(item_ref) };
        if !item_ref.is_null() {
            unsafe { CFRelease(item_ref) };
        }
        if delete_status == ERR_SEC_SUCCESS || delete_status == ERR_SEC_ITEM_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("desktop_macos_keychain_delete_failed:{delete_status}"))
        }
    }

    pub fn read_secret(service: &str, account: &str) -> Result<Option<String>, String> {
        let service = c_string(service, "desktop_credential_service_invalid")?;
        let account = c_string(account, "desktop_credential_account_invalid")?;
        let mut secret_length: u32 = 0;
        let mut secret_data: *mut c_void = ptr::null_mut();
        let status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null_mut(),
                service.as_bytes().len() as u32,
                service.as_ptr(),
                account.as_bytes().len() as u32,
                account.as_ptr(),
                &mut secret_length,
                &mut secret_data,
                ptr::null_mut(),
            )
        };
        if status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(None);
        }
        if status != ERR_SEC_SUCCESS {
            return Err(format!("desktop_macos_keychain_read_failed:{status}"));
        }
        let secret = if secret_data.is_null() || secret_length == 0 {
            String::new()
        } else {
            let bytes = unsafe { slice::from_raw_parts(secret_data as *const u8, secret_length as usize) };
            String::from_utf8_lossy(bytes).to_string()
        };
        if !secret_data.is_null() {
            let _ = unsafe { SecKeychainItemFreeContent(ptr::null_mut(), secret_data) };
        }
        Ok(Some(secret))
    }

    fn c_string(value: &str, error: &str) -> Result<CString, String> {
        CString::new(value).map_err(|_| error.to_string())
    }
}

#[cfg(windows)]
mod os_credential_store {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use std::slice;

    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
    const ERROR_NOT_FOUND: i32 = 1168;

    #[repr(C)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        credential_type: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        credential_blob_size: u32,
        credential_blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "Advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(target_name: *const u16, credential_type: u32, flags: u32, credential: *mut *mut CredentialW) -> i32;
        fn CredDeleteW(target_name: *const u16, credential_type: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    pub fn store_name() -> &'static str {
        "windows-credential-manager"
    }

    pub fn write_bearer_token(service: &str, account: &str, token: &str) -> Result<(), String> {
        write_secret(service, account, token)
    }

    pub fn has_bearer_token(service: &str, account: &str) -> Result<bool, String> {
        has_secret(service, account)
    }

    pub fn delete_bearer_token(service: &str, account: &str) -> Result<(), String> {
        delete_secret(service, account)
    }

    pub fn read_bearer_token(service: &str, account: &str) -> Result<Option<String>, String> {
        read_secret(service, account)
    }

    pub fn write_secret(service: &str, account: &str, secret: &str) -> Result<(), String> {
        let mut target_name = wide_null(&target_name(service, account));
        let mut user_name = wide_null("kuviewer");
        let secret_bytes = secret.as_bytes();
        let credential = CredentialW {
            flags: 0,
            credential_type: CRED_TYPE_GENERIC,
            target_name: target_name.as_mut_ptr(),
            comment: ptr::null_mut(),
            last_written: FileTime {
                low_date_time: 0,
                high_date_time: 0,
            },
            credential_blob_size: secret_bytes.len() as u32,
            credential_blob: secret_bytes.as_ptr() as *mut u8,
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: ptr::null_mut(),
            target_alias: ptr::null_mut(),
            user_name: user_name.as_mut_ptr(),
        };
        let ok = unsafe { CredWriteW(&credential, 0) };
        if ok != 0 {
            Ok(())
        } else {
            Err(format!("desktop_windows_credential_write_failed:{}", last_error()))
        }
    }

    pub fn has_secret(service: &str, account: &str) -> Result<bool, String> {
        read_secret(service, account).map(|secret| secret.is_some())
    }

    pub fn delete_secret(service: &str, account: &str) -> Result<(), String> {
        let target_name = wide_null(&target_name(service, account));
        let ok = unsafe { CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok != 0 || last_error() == ERROR_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("desktop_windows_credential_delete_failed:{}", last_error()))
        }
    }

    pub fn read_secret(service: &str, account: &str) -> Result<Option<String>, String> {
        let target_name = wide_null(&target_name(service, account));
        let mut credential: *mut CredentialW = ptr::null_mut();
        let ok = unsafe { CredReadW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
        if ok == 0 {
            let error = last_error();
            if error == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(format!("desktop_windows_credential_read_failed:{error}"));
        }
        if credential.is_null() {
            return Ok(None);
        }

        let secret = unsafe {
            let credential_ref = &*credential;
            let bytes = slice::from_raw_parts(
                credential_ref.credential_blob as *const u8,
                credential_ref.credential_blob_size as usize,
            );
            String::from_utf8_lossy(bytes).to_string()
        };
        unsafe { CredFree(credential as *mut c_void) };
        Ok(Some(secret))
    }

    fn target_name(service: &str, account: &str) -> String {
        format!("{service}/{account}")
    }

    fn wide_null(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
    }

    fn last_error() -> i32 {
        std::io::Error::last_os_error().raw_os_error().unwrap_or_default()
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod os_credential_store {
    pub fn store_name() -> &'static str {
        "unsupported-os-credential-store"
    }

    pub fn write_bearer_token(_service: &str, _account: &str, _token: &str) -> Result<(), String> {
        Err("desktop_credential_store_unsupported".to_string())
    }

    pub fn has_bearer_token(_service: &str, _account: &str) -> Result<bool, String> {
        Err("desktop_credential_store_unsupported".to_string())
    }

    pub fn read_bearer_token(_service: &str, _account: &str) -> Result<Option<String>, String> {
        Err("desktop_credential_store_unsupported".to_string())
    }

    pub fn delete_bearer_token(_service: &str, _account: &str) -> Result<(), String> {
        Err("desktop_credential_store_unsupported".to_string())
    }

    pub fn write_secret(_service: &str, _account: &str, _secret: &str) -> Result<(), String> {
        Err("desktop_credential_store_unsupported".to_string())
    }

    pub fn has_secret(_service: &str, _account: &str) -> Result<bool, String> {
        Err("desktop_credential_store_unsupported".to_string())
    }

    pub fn read_secret(_service: &str, _account: &str) -> Result<Option<String>, String> {
        Err("desktop_credential_store_unsupported".to_string())
    }

    pub fn delete_secret(_service: &str, _account: &str) -> Result<(), String> {
        Err("desktop_credential_store_unsupported".to_string())
    }
}
