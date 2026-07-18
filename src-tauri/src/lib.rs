use std::{
    fmt::Write as _,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    time::{SystemTime, UNIX_EPOCH},
};

struct RuntimeState {
    instance_id: String,
    sidecar_token: String,
    sidecar_port: u16,
}

impl RuntimeState {
    fn new() -> std::io::Result<Self> {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
        let sidecar_port = listener.local_addr()?.port();
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut token_bytes = [0_u8; 32];
        getrandom::fill(&mut token_bytes)
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        let sidecar_token = token_bytes.iter().fold(
            String::with_capacity(token_bytes.len() * 2),
            |mut token, byte| {
                write!(token, "{byte:02x}").expect("writing to a String cannot fail");
                token
            },
        );

        Ok(Self {
            instance_id: format!(
                "{:x}-{:x}-{:x}",
                std::process::id(),
                started_at,
                sidecar_port
            ),
            sidecar_token,
            sidecar_port,
        })
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendDiagnostics {
    debug_build: bool,
    os: String,
    arch: String,
    executable: String,
    current_directory: String,
    instance_id: String,
    sidecar_token: String,
    sidecar_port: u16,
}

#[tauri::command]
fn backend_diagnostics(runtime: tauri::State<'_, RuntimeState>) -> BackendDiagnostics {
    let diagnostics = BackendDiagnostics {
        debug_build: cfg!(debug_assertions),
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        executable: std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|error| format!("<unavailable: {error}>")),
        current_directory: std::env::current_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|error| format!("<unavailable: {error}>")),
        instance_id: runtime.instance_id.clone(),
        sidecar_token: runtime.sidecar_token.clone(),
        sidecar_port: runtime.sidecar_port,
    };

    #[cfg(debug_assertions)]
    eprintln!(
        "[tauri] backend diagnostics requested: os={} arch={} instance_id={} sidecar_port={}",
        diagnostics.os, diagnostics.arch, diagnostics.instance_id, diagnostics.sidecar_port,
    );
    diagnostics
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = RuntimeState::new().expect("failed to allocate sidecar identity and port");

    tauri::Builder::default()
        .manage(runtime)
        .plugin(tauri_plugin_shell::init())
        .setup(|_| {
            #[cfg(debug_assertions)]
            eprintln!(
                "[tauri] application setup completed: debug_build={} os={} arch={}",
                cfg!(debug_assertions),
                std::env::consts::OS,
                std::env::consts::ARCH,
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_diagnostics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
