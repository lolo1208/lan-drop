// 本地文件系统、媒体读写与目录选择 Tauri IPC 指令
use crate::state::AppState;
use tauri::{AppHandle, State};

#[derive(serde::Serialize)]
pub struct SysInfo {
    pub node_id: String,
    pub hostname: String,
    pub document_dir: String,
    pub media_dir: String,
    pub local_ip: String,
    pub port: u16,
    pub db_path: String,
}

#[tauri::command]
pub async fn get_sys_info(state: State<'_, AppState>) -> Result<SysInfo, String> {
    let hostname = whoami::fallible::hostname().unwrap_or_else(|_| "Desktop".into());
    let lan_drop_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop");
    let doc_dir = lan_drop_dir
        .join("Files")
        .to_string_lossy()
        .to_string();
    let media_dir = lan_drop_dir
        .join("Media")
        .to_string_lossy()
        .to_string();
    let db_path = lan_drop_dir
        .join("data.db")
        .to_string_lossy()
        .to_string();
    let dev = state.local_device.read().await;
    Ok(SysInfo {
        node_id: dev.id.clone(),
        hostname,
        document_dir: doc_dir,
        media_dir,
        local_ip: dev.ip.clone(),
        port: dev.port,
        db_path,
    })
}

#[tauri::command]
pub fn check_file_exists(file_path: String) -> Result<bool, String> {
    if file_path.trim().is_empty() {
        return Ok(false);
    }
    let p = std::path::Path::new(&file_path);
    if p.exists() && p.is_file() {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        let clean_path = file_path.replace("/", "\\");
        let p_clean = std::path::Path::new(&clean_path);
        if p_clean.exists() && p_clean.is_file() {
            return Ok(true);
        }
    }

    // 若传入的是相对路径或仅文件名，自动到 Media 和 Files 目录中探测
    let doc_dir = dirs::document_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let media_dir = doc_dir.join("LAN Drop").join("Media");
    let files_dir = doc_dir.join("LAN Drop").join("Files");

    if let Some(file_name) = p.file_name() {
        let in_media = media_dir.join(file_name);
        if in_media.exists() && in_media.is_file() {
            return Ok(true);
        }
        let in_files = files_dir.join(file_name);
        if in_files.exists() && in_files.is_file() {
            return Ok(true);
        }
    }

    Ok(false)
}

#[tauri::command]
pub async fn read_media_data_url(file_path: String, mime_type: Option<String>) -> Result<String, String> {
    use base64::Engine;
    let mut target_path = std::path::PathBuf::from(&file_path);
    if !target_path.exists() {
        #[cfg(target_os = "windows")]
        {
            let clean = file_path.replace("/", "\\");
            target_path = std::path::PathBuf::from(clean);
        }
    }

    if !target_path.exists() {
        if let Some(name) = std::path::Path::new(&file_path).file_name() {
            let doc_dir = dirs::document_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
            let in_media = doc_dir.join("LAN Drop").join("Media").join(name);
            if in_media.exists() {
                target_path = in_media;
            }
        }
    }

    if !target_path.exists() || !target_path.is_file() {
        return Err(format!("文件不存在: {}", file_path));
    }

    let bytes = std::fs::read(&target_path).map_err(|e| format!("读取文件失败: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let mime = mime_type.unwrap_or_else(|| {
        let ext = target_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "mkv" => "video/x-matroska",
            "mov" => "video/quicktime",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" => "audio/ogg",
            "flac" => "audio/flac",
            "aac" => "audio/aac",
            _ => "application/octet-stream",
        }
        .to_string()
    });

    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub fn get_media_dir() -> Result<String, String> {
    let media_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Media");
    if !media_dir.exists() {
        let _ = std::fs::create_dir_all(&media_dir);
    }
    Ok(media_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_media_file_to_disk(
    md5: String,
    ext: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let media_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Media");
    if !media_dir.exists() {
        let _ = std::fs::create_dir_all(&media_dir);
    }
    let clean_ext = ext.trim_start_matches('.');
    let file_name = if clean_ext.is_empty() {
        md5.clone()
    } else {
        format!("{}.{}", md5, clean_ext)
    };
    let file_path = media_dir.join(&file_name);
    // 避免相同文件重复保存：若已存在且大小一致则直接复用
    if file_path.exists() {
        if let Ok(meta) = std::fs::metadata(&file_path) {
            if meta.len() == data.len() as u64 || data.is_empty() {
                return Ok(file_path.to_string_lossy().to_string());
            }
        }
    }
    std::fs::write(&file_path, data).map_err(|e| format!("保存媒体文件失败: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_media_from_path(
    md5: String,
    ext: String,
    source_path: String,
) -> Result<String, String> {
    let media_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Media");
    if !media_dir.exists() {
        let _ = std::fs::create_dir_all(&media_dir);
    }
    let clean_ext = ext.trim_start_matches('.');
    let file_name = if clean_ext.is_empty() {
        md5.clone()
    } else {
        format!("{}.{}", md5, clean_ext)
    };
    let file_path = media_dir.join(&file_name);
    if file_path.exists() {
        return Ok(file_path.to_string_lossy().to_string());
    }
    let src = std::path::Path::new(&source_path);
    if src.exists() {
        let _ = std::fs::copy(src, &file_path);
    }
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_file_from_disk(file_path: String) -> Result<bool, String> {
    if file_path.trim().is_empty() {
        return Ok(false);
    }
    let p = std::path::PathBuf::from(&file_path);
    if p.exists() && p.is_file() {
        let _ = std::fs::remove_file(&p);
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        let clean = file_path.replace("/", "\\");
        let p_clean = std::path::PathBuf::from(&clean);
        if p_clean.exists() && p_clean.is_file() {
            let _ = std::fs::remove_file(&p_clean);
            return Ok(true);
        }
    }

    // 尝试在 LAN Drop 默认目录（Media 和 Files）中查找并删除
    let doc_dir = dirs::document_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let media_dir = doc_dir.join("LAN Drop").join("Media");
    let files_dir = doc_dir.join("LAN Drop").join("Files");

    if let Some(file_name) = std::path::Path::new(&file_path).file_name() {
        let in_media = media_dir.join(file_name);
        if in_media.exists() && in_media.is_file() {
            let _ = std::fs::remove_file(&in_media);
            return Ok(true);
        }
        let in_files = files_dir.join(file_name);
        if in_files.exists() && in_files.is_file() {
            let _ = std::fs::remove_file(&in_files);
            return Ok(true);
        }
    }

    Ok(false)
}

#[tauri::command]
pub fn delete_files_from_disk(file_paths: Vec<String>) -> Result<usize, String> {
    let mut deleted_count = 0;
    for fp in file_paths {
        if let Ok(true) = delete_file_from_disk(fp) {
            deleted_count += 1;
        }
    }
    Ok(deleted_count)
}

#[tauri::command]
pub fn open_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);

    #[cfg(target_os = "windows")]
    let res = {
        let clean_path = path.replace("/", "\\");
        if p.exists() {
            if p.is_file() {
                std::process::Command::new("explorer")
                    .arg("/select,")
                    .arg(&clean_path)
                    .spawn()
            } else {
                std::process::Command::new("explorer")
                    .arg(&clean_path)
                    .spawn()
            }
        } else if let Some(parent) = p.parent() {
            let parent_str = parent.to_string_lossy().replace("/", "\\");
            std::process::Command::new("explorer")
                .arg(&parent_str)
                .spawn()
        } else {
            std::process::Command::new("explorer")
                .arg(&clean_path)
                .spawn()
        }
    };

    #[cfg(target_os = "macos")]
    let res = {
        if p.exists() && p.is_file() {
            std::process::Command::new("open")
                .args(["-R", &path])
                .spawn()
        } else if let Some(parent) = p.parent() {
            std::process::Command::new("open")
                .arg(parent.to_string_lossy().as_ref())
                .spawn()
        } else {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
        }
    };

    #[cfg(target_os = "linux")]
    let res = {
        let target = if p.is_file() {
            p.parent().unwrap_or(p).to_string_lossy().to_string()
        } else {
            path
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
    };

    res.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn select_directory(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder_path| {
        let res = folder_path.map(|p| p.to_string());
        let _ = tx.send(res);
    });
    match rx.await {
        Ok(path) => Ok(path),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn save_file_to_disk(file_name: String, base64_data: String, state: State<'_, AppState>) -> Result<String, String> {
    use base64::Engine;

    let dir = state.download_dir.read().await.clone();

    // 与文件传输保存目录绝对统一：保证落地在 [用户文档]/LAN Drop/Files 目录下
    let save_dir = if dir.trim().is_empty() || dir.contains("\\Users\\User\\") || dir.contains("/Users/User/") {
        dirs::document_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("LAN Drop")
            .join("Files")
    } else {
        let p = std::path::PathBuf::from(&dir);
        if p.ends_with("Files") {
            p
        } else if p.ends_with("LAN Drop") {
            p.join("Files")
        } else {
            p
        }
    };

    if !save_dir.exists() {
        let _ = std::fs::create_dir_all(&save_dir);
    }

    let file_path = save_dir.join(&file_name);

    let raw_b64 = if let Some(pos) = base64_data.find(',') {
        &base64_data[pos + 1..]
    } else {
        &base64_data
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw_b64)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    std::fs::write(&file_path, bytes).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

