use std::{
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    time::{SystemTime, UNIX_EPOCH},
};

struct RuntimeState {
    instance_id: String,
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

        Ok(Self {
            instance_id: format!(
                "{:x}-{:x}-{:x}",
                std::process::id(),
                started_at,
                sidecar_port
            ),
            sidecar_port,
        })
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendDiagnostics {
    debug_build: bool,
    os: String,
    arch: String,
    executable: String,
    current_directory: String,
    instance_id: String,
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
        sidecar_port: runtime.sidecar_port,
    };

    eprintln!("[tauri] backend diagnostics requested: {diagnostics:?}");
    diagnostics
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = RuntimeState::new().expect("failed to allocate sidecar identity and port");

    tauri::Builder::default()
        .manage(runtime)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_| {
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
