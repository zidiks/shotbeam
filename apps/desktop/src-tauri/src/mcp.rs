//! Installs the local stdio server in a selected client's config, preserving other settings.
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

fn home() -> Result<PathBuf, String> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .ok_or_else(|| "Не найдена домашняя папка".into())
}

fn config_path(client: &str) -> Result<PathBuf, String> {
    match client {
        "claude" => {
            let base = if cfg!(windows) {
                std::env::var_os("APPDATA")
                    .map(PathBuf::from)
                    .ok_or("Не найдена APPDATA")?
            } else if cfg!(target_os = "macos") {
                home()?.join("Library/Application Support")
            } else {
                home()?.join(".config")
            };
            Ok(base.join("Claude/claude_desktop_config.json"))
        }
        "cursor" => Ok(home()?.join(".cursor/mcp.json")),
        "codex" => Ok(std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or(home()?.join(".codex"))
            .join("config.toml")),
        _ => Err(format!("Неизвестное приложение: {client}")),
    }
}

fn with_server(
    existing: &str,
    client: &str,
    command: &str,
    entry: &str,
    library: &str,
) -> Result<String, String> {
    if client == "codex" {
        let mut doc: toml_edit::DocumentMut = existing
            .parse()
            .map_err(|e: toml_edit::TomlError| e.to_string())?;
        let servers = doc
            .entry("mcp_servers")
            .or_insert_with(|| {
                let mut table = toml_edit::Table::new();
                table.set_implicit(true);
                toml_edit::Item::Table(table)
            })
            .as_table_mut()
            .ok_or("mcp_servers должен быть таблицей")?;
        let mut server = toml_edit::Table::new();
        let mut args = toml_edit::Array::new();
        args.push(entry);
        server.insert("command", toml_edit::value(command));
        server.insert("args", toml_edit::value(args));
        let mut env = toml_edit::Table::new();
        env.insert("SHOTBEAM_HOME", toml_edit::value(library));
        server.insert("env", toml_edit::Item::Table(env));
        servers.insert("shotbeam", toml_edit::Item::Table(server));
        Ok(doc.to_string())
    } else {
        let mut root: Value = if existing.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(existing).map_err(|e| e.to_string())?
        };
        let obj = root
            .as_object_mut()
            .ok_or("Настройки должны быть JSON-объектом")?;
        let servers = obj
            .entry("mcpServers")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or("mcpServers должен быть объектом")?;
        servers.insert(
            "shotbeam".into(),
            json!({ "command": command, "args": [entry],
            "env": { "SHOTBEAM_HOME": library } }),
        );
        Ok(format!(
            "{}\n",
            serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?
        ))
    }
}

fn install(
    path: &Path,
    client: &str,
    command: &str,
    entry: &str,
    library: &str,
) -> Result<(), String> {
    let existing = match std::fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    let text = with_server(existing.as_deref().unwrap_or(""), client, command, entry, library)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // A backup is created before touching an existing client configuration.
    if existing.is_some() {
        std::fs::copy(path, path.with_extension("shotbeam-backup")).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("shotbeam-tmp");
    std::fs::write(&temp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mcp_connect(client: String, rt: tauri::State<super::Runtime>) -> Result<String, String> {
    let path = config_path(&client)?;
    // The installed app's own Node and MCP bundle, or the checkout's when running from it.
    let entry = &rt.mcp_entry;
    if !entry.is_file() {
        return Err("Не найден сервер Shotbeam MCP. Проверь расположение проекта.".into());
    }
    install(
        &path,
        &client,
        &rt.node.to_string_lossy(),
        &entry.to_string_lossy(),
        &super::library_root().to_string_lossy(),
    )
    .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_json_settings_and_reconnects() {
        let before = r#"{"theme":"dark","mcpServers":{"other":{"command":"x"}}}"#;
        let after =
            with_server(before, "claude", "node", "C:\\Shot beam\\server.mjs", "D:\\Library").unwrap();
        let value: Value = serde_json::from_str(&after).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["command"], "x");
        assert_eq!(
            value["mcpServers"]["shotbeam"]["args"][0],
            "C:\\Shot beam\\server.mjs"
        );
        assert_eq!(
            with_server(&after, "claude", "node", "C:\\Shot beam\\server.mjs", "D:\\Library").unwrap(),
            after
        );
        assert!(with_server("[]", "cursor", "node", "x", "y").is_err());
        assert!(with_server(r#"{"mcpServers":1}"#, "cursor", "node", "x", "y").is_err());
    }
    #[test]
    fn preserves_toml_comments_settings_and_reconnects() {
        let before = "# settings\nmodel = \"example\"\n[mcp_servers.other]\ncommand = \"x\"\n";
        let after =
            with_server(before, "codex", "node", "C:\\Shot beam\\server.mjs", "D:\\Library").unwrap();
        assert!(after.starts_with(before));
        let doc: toml_edit::DocumentMut = after.parse().unwrap();
        assert_eq!(doc["mcp_servers"]["other"]["command"].as_str(), Some("x"));
        assert_eq!(
            doc["mcp_servers"]["shotbeam"]["env"]["SHOTBEAM_HOME"].as_str(),
            Some("D:\\Library")
        );
        assert_eq!(
            with_server(&after, "codex", "node", "C:\\Shot beam\\server.mjs", "D:\\Library").unwrap(),
            after
        );
        assert!(with_server("mcp_servers = 1", "codex", "node", "x", "y").is_err());
        assert!(with_server("not toml [", "codex", "node", "x", "y").is_err());
    }
    #[test]
    fn installs_with_backup_and_leaves_invalid_configs_untouched() {
        let dir = std::env::temp_dir().join(format!("shotbeam-mcp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mcp.json");
        std::fs::write(&path, "{}").unwrap();
        install(&path, "cursor", "node", "server.mjs", "library").unwrap();
        assert_eq!(
            std::fs::read_to_string(path.with_extension("shotbeam-backup")).unwrap(),
            "{}"
        );
        std::fs::write(&path, "invalid").unwrap();
        assert!(install(&path, "cursor", "node", "x", "y").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
