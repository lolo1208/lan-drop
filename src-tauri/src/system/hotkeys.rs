// 独立管理窗口唤醒和截图热键；更新失败时恢复原来的注册集合。
use crate::{db::Database, default_global_hotkey, default_screenshot_hotkey, parse_shortcut_str};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum HotkeyAction {
    Window,
    Screenshot,
}

#[derive(Default)]
pub struct HotkeyState {
    pub shortcuts: Mutex<HashMap<HotkeyAction, Shortcut>>,
    pub startup_errors: Mutex<Vec<String>>,
    pub recording: AtomicBool,
}

fn parse(value: &str) -> Result<Option<Shortcut>, String> {
    let normalized = parse_shortcut_str(value);
    if normalized.is_empty() {
        return Ok(None);
    }
    if !normalized
        .split('+')
        .any(|p| matches!(p, "ctrl" | "alt" | "super"))
    {
        return Err("全局快捷键必须包含 Ctrl、Alt 或 Win 修饰键".into());
    }
    normalized
        .parse::<Shortcut>()
        .map(Some)
        .map_err(|e| format!("快捷键格式无效：{}", e))
}

/// 先注册新增组合，再移除旧组合；两项功能交换组合时不需要重新注册。
fn transition<T: Copy + Eq + std::hash::Hash>(
    old: &HashSet<T>,
    new: &HashSet<T>,
    mut register: impl FnMut(T) -> Result<(), String>,
    mut unregister: impl FnMut(T) -> Result<(), String>,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let result = (|| {
        for key in new.difference(old) {
            register(*key)?;
            added.push(*key);
        }
        for key in old.difference(new) {
            unregister(*key)?;
            removed.push(*key);
        }
        persist()
    })();
    if let Err(error) = result {
        let mut rollback_errors = Vec::new();
        for key in removed {
            if let Err(e) = register(key) {
                rollback_errors.push(e);
            }
        }
        for key in added {
            if let Err(e) = unregister(key) {
                rollback_errors.push(e);
            }
        }
        return if rollback_errors.is_empty() {
            Err(error)
        } else {
            Err(format!(
                "{}；恢复旧热键失败，请重启应用：{}",
                error,
                rollback_errors.join("；")
            ))
        };
    }
    Ok(())
}

pub fn update_hotkeys(
    app: &AppHandle,
    db: &Database,
    window: &str,
    screenshot: &str,
) -> Result<(), String> {
    let mut desired = HashMap::new();
    if let Some(key) = parse(window)? {
        desired.insert(HotkeyAction::Window, key);
    }
    #[cfg(target_os = "windows")]
    if let Some(key) = parse(screenshot)? {
        desired.insert(HotkeyAction::Screenshot, key);
    }
    // 所有平台均校验配置，避免跨平台保存无法解析的热键。
    let screenshot_key = parse(screenshot)?;
    if screenshot_key.is_some() && screenshot_key == parse(window)? {
        return Err("截图与显示（隐藏）窗口不能使用同一个快捷键".into());
    }
    let state = app.state::<HotkeyState>();
    let mut current = state.shortcuts.lock().map_err(|_| "热键状态不可用")?;
    let old = current.values().copied().collect();
    let new = desired.values().copied().collect();
    transition(
        &old,
        &new,
        |key| {
            app.global_shortcut()
                .register(key)
                .map_err(|e| format!("全局快捷键注册失败，可能被其他程序占用：{}", e))
        },
        |key| {
            app.global_shortcut()
                .unregister(key)
                .map_err(|e| format!("注销旧快捷键失败：{}", e))
        },
        || {
            db.set_kv_batch(&[("global_hotkey", window), ("screenshot_hotkey", screenshot)])
                .map_err(|e| format!("保存快捷键失败：{}", e))
        },
    )?;
    *current = desired;
    Ok(())
}

pub fn initialize_hotkeys(app: &AppHandle, db: &Database) {
    let state = app.state::<HotkeyState>();
    for (action, name, value) in [
        (
            HotkeyAction::Window,
            "显示（隐藏）窗口",
            db.get_kv("global_hotkey")
                .ok()
                .flatten()
                .unwrap_or_else(default_global_hotkey),
        ),
        (
            HotkeyAction::Screenshot,
            "截图",
            db.get_kv("screenshot_hotkey")
                .ok()
                .flatten()
                .unwrap_or_else(default_screenshot_hotkey),
        ),
    ] {
        if action == HotkeyAction::Screenshot && !cfg!(target_os = "windows") {
            continue;
        }
        let result = parse(&value).and_then(|key| {
            if let Some(key) = key {
                let mut keys = state.shortcuts.lock().unwrap();
                if keys.values().any(|existing| *existing == key) {
                    return Err("与另一项功能的快捷键重复".into());
                }
                app.global_shortcut()
                    .register(key)
                    .map_err(|e| e.to_string())?;
                keys.insert(action, key);
            }
            Ok(())
        });
        if let Err(e) = result {
            let message = format!(
                "{}热键 {} 注册失败：{}。可在系统设置中更改。",
                name, value, e
            );
            log::warn!("{}", message);
            state.startup_errors.lock().unwrap().push(message);
        }
    }
}

pub fn dispatch_hotkey(app: &AppHandle, shortcut: &Shortcut) {
    let state = app.state::<HotkeyState>();
    if state.recording.load(Ordering::Acquire) {
        return;
    }
    // 注册操作等待主线程执行，回调不能在此等待注册方持有的锁。
    let action = state.shortcuts.try_lock().ok().and_then(|keys| {
        keys.iter()
            .find(|(_, key)| *key == shortcut)
            .map(|(action, _)| *action)
    });
    // 截图期间禁止唤醒主窗口遮挡框选界面。
    if crate::system::screenshot::is_capturing() {
        return;
    }
    match action {
        Some(HotkeyAction::Window) => crate::toggle_main_window(app),
        Some(HotkeyAction::Screenshot) => {
            let _ = app.emit("screenshot://requested", ());
        }
        None => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn occupied_key_preserves_old_registration() {
        let live = RefCell::new(HashSet::from([1, 2]));
        let result = transition(
            &HashSet::from([1, 2]),
            &HashSet::from([1, 3, 4]),
            |key| {
                if key == 4 {
                    return Err("已占用".into());
                }
                live.borrow_mut().insert(key);
                Ok(())
            },
            |key| {
                live.borrow_mut().remove(&key);
                Ok(())
            },
            || Ok(()),
        );
        assert!(result.is_err());
        assert_eq!(*live.borrow(), HashSet::from([1, 2]));
    }

    #[test]
    fn persistence_failure_restores_both_keys() {
        let live = RefCell::new(HashSet::from([1, 2]));
        let result = transition(
            &HashSet::from([1, 2]),
            &HashSet::from([2, 3]),
            |key| {
                live.borrow_mut().insert(key);
                Ok(())
            },
            |key| {
                live.borrow_mut().remove(&key);
                Ok(())
            },
            || Err("磁盘写入失败".into()),
        );
        assert!(result.is_err());
        assert_eq!(*live.borrow(), HashSet::from([1, 2]));
    }

    #[test]
    fn swapping_actions_does_not_unregister_keys() {
        transition(
            &HashSet::from([1, 2]),
            &HashSet::from([2, 1]),
            |_| panic!("交换功能不应注册热键"),
            |_| panic!("交换功能不应注销热键"),
            || Ok(()),
        )
        .unwrap();
    }

    #[test]
    fn empty_disables_and_aliases_are_equivalent() {
        assert!(parse("").unwrap().is_none());
        assert_eq!(
            parse("Control+Alt+Shift+A").unwrap(),
            parse("Ctrl+Shift+Alt+A").unwrap()
        );
        assert!(parse("A").is_err());
    }
}
