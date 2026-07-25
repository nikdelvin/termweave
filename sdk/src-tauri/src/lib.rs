use std::{
    fmt::Write as _,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    time::{SystemTime, UNIX_EPOCH},
};

struct SidecarRuntime {
    instance_id: String,
    sidecar_token: String,
    sidecar_port: u16,
}

impl SidecarRuntime {
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
struct FrontendRuntime {
    instance_id: String,
    sidecar_token: String,
    sidecar_port: u16,
}

#[tauri::command]
fn frontend_runtime(runtime: tauri::State<'_, SidecarRuntime>) -> FrontendRuntime {
    FrontendRuntime {
        instance_id: runtime.instance_id.clone(),
        sidecar_token: runtime.sidecar_token.clone(),
        sidecar_port: runtime.sidecar_port,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = SidecarRuntime::new().expect("failed to allocate sidecar identity and port");

    tauri::Builder::default()
        .manage(runtime)
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![frontend_runtime])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
