//! Desktop shell for Shotbeam.
//!
//! The UI is apps/web; everything else lives in the engine (packages/engine), a local Node server.
//! This shell opens the window, starts the engine when none answers yet, and stops the one it
//! started when the app quits. Rust holds no domain logic.

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewWindowBuilder};

mod mcp;

const ENGINE_PORT: u16 = 47811;

/// The engine process this app started (None when one was already running).
struct EngineProcess(Mutex<Option<Child>>);

fn engine_alive() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], ENGINE_PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// The repository checkout this app was built from: the engine runs from its sources with tsx.
/// SHOTBEAM_REPO points elsewhere.
fn repo_root() -> PathBuf {
    std::env::var_os("SHOTBEAM_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("..")
                .join("..")
        })
}

/// The library folder, found the way the engine finds it: SHOTBEAM_HOME, else `home` in
/// ~/.shotbeam.json, else ~/Shotbeam.
fn library_root() -> PathBuf {
    if let Some(home) = std::env::var_os("SHOTBEAM_HOME") {
        return PathBuf::from(home);
    }
    let user = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default();
    let pointer = std::fs::read_to_string(user.join(".shotbeam.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("home").and_then(|h| h.as_str()).map(PathBuf::from));
    pointer.unwrap_or_else(|| user.join("Shotbeam"))
}

fn start_engine() -> Option<Child> {
    if engine_alive() {
        return None;
    }
    let engine_dir = repo_root().join("packages").join("engine");
    let mut cmd = Command::new("node");
    cmd.args(["--import", "tsx", "src/main.ts"])
        .current_dir(&engine_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window for the engine.
        cmd.creation_flags(0x0800_0000);
    }
    match cmd.spawn() {
        Ok(child) => Some(child),
        Err(err) => {
            eprintln!(
                "Could not start the Shotbeam engine in {}: {err}",
                engine_dir.display()
            );
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![mcp::mcp_connect])
        .setup(|app| {
            app.manage(EngineProcess(Mutex::new(start_engine())));
            // WebView2 keeps its cache and storage in the library too, not on the (small)
            // system drive, where a full disk shows up as ERR_CACHE_READ_FAILURE and a blank window.
            let config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .expect("tauri.conf.json defines the main window");
            let builder = WebviewWindowBuilder::from_config(app.handle(), &config)?
                .data_directory(library_root().join("webview"));
            #[cfg(windows)]
            let builder = builder.decorations(false).shadow(true);
            builder.build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Shotbeam");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<EngineProcess>() {
                if let Ok(mut child) = state.0.lock() {
                    if let Some(mut c) = child.take() {
                        let _ = c.kill();
                    }
                }
            }
        }
    });
}
