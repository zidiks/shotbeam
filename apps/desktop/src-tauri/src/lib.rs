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

use tauri::{Manager, RunEvent};

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
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join(".."))
}

fn start_engine() -> Option<Child> {
    if engine_alive() {
        return None;
    }
    let engine_dir = repo_root().join("packages").join("engine");
    let mut cmd = Command::new("node");
    cmd.args(["--import", "tsx", "src/main.ts"]).current_dir(&engine_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window for the engine.
        cmd.creation_flags(0x0800_0000);
    }
    match cmd.spawn() {
        Ok(child) => Some(child),
        Err(err) => {
            eprintln!("Could not start the Shotbeam engine in {}: {err}", engine_dir.display());
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(EngineProcess(Mutex::new(start_engine())));
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
