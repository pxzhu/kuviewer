use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const SIDECAR_SERVER_URL: &str = "http://127.0.0.1:18086";
const SIDECAR_LISTEN_ADDR: &str = "127.0.0.1:18086";
const DESKTOP_KUBE_CREDENTIAL_SERVICE: &str = "com.kuviewer.desktop.kubernetes";
const MAX_DESKTOP_KUBE_TOKEN_BYTES: u64 = 64 * 1024;

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
    auth_type: String,
    status: String,
    updated_at: u64,
    selected: bool,
    description: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCmSessionInput {
    id: Option<String>,
    name: String,
    host: String,
    port: u16,
    user: String,
    description: Option<String>,
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
}

struct DesktopSidecarRuntimeConfig {
    source: String,
    kubernetes_profile_id: Option<String>,
    kube_api_server: Option<String>,
    kube_token_file: Option<PathBuf>,
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
        session.status = "metadata-only".to_string();
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
    let mut sessions = state
        .cm_sessions
        .lock()
        .map_err(|_| "desktop_cm_sessions_unavailable".to_string())?;
    let original_count = sessions.len();
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
            desktop_save_cm_session,
            desktop_select_cm_session,
            desktop_delete_cm_session
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

fn initialize_desktop_cm_sessions(app: &tauri::AppHandle) {
    let sessions = load_desktop_cm_sessions_from_env();
    let selected_session_id = sessions.first().map(|session| session.id.clone());
    let state = app.state::<DesktopSidecarState>();
    if let Ok(mut stored_sessions) = state.cm_sessions.lock() {
        *stored_sessions = sessions;
    }
    if let Ok(mut selected) = state.selected_cm_session_id.lock() {
        *selected = selected_session_id;
    }
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
    if input.port == 0 {
        return Err("desktop_cm_session_port_invalid".to_string());
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

    Ok(DesktopCmSessionMetadata {
        id,
        name,
        host,
        port: input.port,
        user,
        auth_type: "os-credential-store".to_string(),
        status: "metadata-only".to_string(),
        updated_at: current_unix_millis(),
        selected: false,
        description,
    })
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
        let _ = delete_bearer_token(service, account);
        let service = c_string(service, "desktop_kubernetes_credential_service_invalid")?;
        let account = c_string(account, "desktop_kubernetes_profile_invalid")?;
        let token_bytes = token.as_bytes();
        let status = unsafe {
            SecKeychainAddGenericPassword(
                ptr::null_mut(),
                service.as_bytes().len() as u32,
                service.as_ptr(),
                account.as_bytes().len() as u32,
                account.as_ptr(),
                token_bytes.len() as u32,
                token_bytes.as_ptr() as *const c_void,
                ptr::null_mut(),
            )
        };
        if status == ERR_SEC_SUCCESS {
            Ok(())
        } else {
            Err(format!("desktop_macos_keychain_write_failed:{status}"))
        }
    }

    pub fn has_bearer_token(service: &str, account: &str) -> Result<bool, String> {
        read_bearer_token(service, account).map(|token| token.is_some())
    }

    pub fn delete_bearer_token(service: &str, account: &str) -> Result<(), String> {
        let service = c_string(service, "desktop_kubernetes_credential_service_invalid")?;
        let account = c_string(account, "desktop_kubernetes_profile_invalid")?;
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

    pub fn read_bearer_token(service: &str, account: &str) -> Result<Option<String>, String> {
        let service = c_string(service, "desktop_kubernetes_credential_service_invalid")?;
        let account = c_string(account, "desktop_kubernetes_profile_invalid")?;
        let mut password_length: u32 = 0;
        let mut password_data: *mut c_void = ptr::null_mut();
        let status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null_mut(),
                service.as_bytes().len() as u32,
                service.as_ptr(),
                account.as_bytes().len() as u32,
                account.as_ptr(),
                &mut password_length,
                &mut password_data,
                ptr::null_mut(),
            )
        };
        if status == ERR_SEC_ITEM_NOT_FOUND {
            return Ok(None);
        }
        if status != ERR_SEC_SUCCESS {
            return Err(format!("desktop_macos_keychain_read_failed:{status}"));
        }
        let token = if password_data.is_null() || password_length == 0 {
            String::new()
        } else {
            let bytes = unsafe { slice::from_raw_parts(password_data as *const u8, password_length as usize) };
            String::from_utf8_lossy(bytes).to_string()
        };
        if !password_data.is_null() {
            let _ = unsafe { SecKeychainItemFreeContent(ptr::null_mut(), password_data) };
        }
        Ok(Some(token))
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
        let mut target_name = wide_null(&target_name(service, account));
        let mut user_name = wide_null("kuviewer");
        let token_bytes = token.as_bytes();
        let credential = CredentialW {
            flags: 0,
            credential_type: CRED_TYPE_GENERIC,
            target_name: target_name.as_mut_ptr(),
            comment: ptr::null_mut(),
            last_written: FileTime {
                low_date_time: 0,
                high_date_time: 0,
            },
            credential_blob_size: token_bytes.len() as u32,
            credential_blob: token_bytes.as_ptr() as *mut u8,
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

    pub fn has_bearer_token(service: &str, account: &str) -> Result<bool, String> {
        read_bearer_token(service, account).map(|token| token.is_some())
    }

    pub fn delete_bearer_token(service: &str, account: &str) -> Result<(), String> {
        let target_name = wide_null(&target_name(service, account));
        let ok = unsafe { CredDeleteW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok != 0 || last_error() == ERROR_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("desktop_windows_credential_delete_failed:{}", last_error()))
        }
    }

    pub fn read_bearer_token(service: &str, account: &str) -> Result<Option<String>, String> {
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

        let token = unsafe {
            let credential_ref = &*credential;
            let bytes = slice::from_raw_parts(
                credential_ref.credential_blob as *const u8,
                credential_ref.credential_blob_size as usize,
            );
            String::from_utf8_lossy(bytes).to_string()
        };
        unsafe { CredFree(credential as *mut c_void) };
        Ok(Some(token))
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
}
