//! Desktop shell for Shotbeam.
//!
//! The UI is apps/web; everything else lives in the engine (packages/engine), a local Node server.
//! This shell opens the window, starts the engine when none answers yet, and stops the one it
//! started when the app quits. Rust holds no domain logic.
//!
//! An installed app carries its own runtime in its resources (Node, the engine and the MCP
//! server bundled into one file each, see apps/desktop/scripts/bundle.mjs), so it needs no
//! checkout. Without those resources (`tauri dev`) the engine runs from this repository.

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

/// How to run Node, the engine and the MCP server: from the app's resources, or the checkout.
pub struct Runtime {
    pub node: PathBuf,
    /// The bundled engine (main.mjs); None runs the checkout's sources with tsx.
    pub engine: Option<PathBuf>,
    pub mcp_entry: PathBuf,
}

fn runtime(app: &tauri::AppHandle) -> Runtime {
    if let Ok(res) = app.path().resource_dir() {
        let node = res
            .join("node")
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        let engine = res.join("engine").join("dist").join("main.mjs");
        let mcp_entry = res.join("mcp").join("shotbeam-mcp.mjs");
        if node.is_file() && engine.is_file() && mcp_entry.is_file() {
            return Runtime {
                node: plain(node),
                engine: Some(plain(engine)),
                mcp_entry: plain(mcp_entry),
            };
        }
    }
    Runtime {
        node: PathBuf::from("node"),
        engine: None,
        mcp_entry: repo_root().join("apps").join("mcp").join("bin").join("shotbeam-mcp.mjs"),
    }
}

/// Windows paths without the `\\?\` prefix: Node cannot load a script given that way, and other
/// programs get these paths in MCP configs.
fn plain(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => path,
    }
}

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

fn start_engine(rt: &Runtime) -> Option<Child> {
    if engine_alive() {
        return None;
    }
    let (mut cmd, engine_dir) = match &rt.engine {
        Some(main) => {
            let dir = main.parent().map(PathBuf::from).unwrap_or_default();
            let mut cmd = Command::new(&rt.node);
            cmd.arg(main);
            (cmd, dir)
        }
        None => {
            let dir = repo_root().join("packages").join("engine");
            let mut cmd = Command::new("node");
            cmd.args(["--import", "tsx", "src/main.ts"]);
            (cmd, dir)
        }
    };
    // The engine hands these to MCP clients ("connect Claude") and to the MCP server it starts.
    cmd.current_dir(&engine_dir)
        .env("SHOTBEAM_NODE", &rt.node)
        .env("SHOTBEAM_MCP_ENTRY", &rt.mcp_entry);
    // What the engine prints goes to <library>/logs/engine.log: a window has no console, and an
    // engine that dies at start should say why somewhere.
    let logs = library_root().join("logs");
    if std::fs::create_dir_all(&logs).is_ok() {
        if let Ok(file) = std::fs::File::create(logs.join("engine.log")) {
            if let Ok(err) = file.try_clone() {
                cmd.stdout(file).stderr(err);
            }
        }
    }
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
            let rt = runtime(app.handle());
            app.manage(EngineProcess(Mutex::new(start_engine(&rt))));
            app.manage(rt);
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
