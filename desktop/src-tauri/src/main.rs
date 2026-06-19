use serde::Serialize;
use std::fs;
use std::sync::Mutex;
use tauri::{Manager, State};
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
    if let Ok(mut selected_id) = state.selected_kubernetes_profile_id.lock() {
        *selected_id = Some(profile.id);
    }
    Ok(selected_profile)
}

#[tauri::command]
fn desktop_delete_kubernetes_profile_credential(
    profile_id: String,
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DesktopSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_sidecar_profile,
            desktop_kubernetes_profiles,
            desktop_select_kubernetes_profile,
            desktop_delete_kubernetes_profile_credential
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

    fn read_bearer_token(service: &str, account: &str) -> Result<Option<String>, String> {
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

    fn read_bearer_token(service: &str, account: &str) -> Result<Option<String>, String> {
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

    pub fn delete_bearer_token(_service: &str, _account: &str) -> Result<(), String> {
        Err("desktop_credential_store_unsupported".to_string())
    }
}
