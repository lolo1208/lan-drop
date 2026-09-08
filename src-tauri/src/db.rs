// LAN Drop (内网投送) - SQLite 真实持久化模块
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbChatMessage {
    pub id: String,
    pub peer_id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub content: String,
    pub timestamp: i64,
    pub status: String,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbTransfer {
    pub id: String,
    pub peer_id: String,
    pub peer_name: String,
    pub peer_ip: String,
    pub direction: String,
    pub file_name: String,
    pub file_size: u64,
    pub status: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub raw_json: String,
}

impl Database {
    pub fn init(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;

        // 初始化数据表：传输历史记录与即时聊天消息
        conn.execute(
            "CREATE TABLE IF NOT EXISTS transfers (
                id TEXT PRIMARY KEY,
                peer_id TEXT NOT NULL,
                peer_name TEXT NOT NULL,
                peer_ip TEXT NOT NULL,
                direction TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                status TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                raw_json TEXT NOT NULL DEFAULT ''
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                peer_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                status TEXT NOT NULL,
                raw_json TEXT NOT NULL DEFAULT ''
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn get_kv(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM kv_store WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_kv(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO kv_store (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_all_kv(&self) -> Result<std::collections::HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM kv_store")?;
        let rows = stmt.query_map([], |row| {
            let k: String = row.get(0)?;
            let v: String = row.get(1)?;
            Ok((k, v))
        })?;

        let mut map = std::collections::HashMap::new();
        for r in rows.flatten() {
            map.insert(r.0, r.1);
        }
        Ok(map)
    }

    pub fn save_chat_message(&self, msg_json: &str) -> Result<()> {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(msg_json) {
            let msg_type = v.get("msgType").and_then(|s| s.as_str()).unwrap_or("");
            let content = v.get("content").and_then(|s| s.as_str()).unwrap_or("").to_string();
            // 忽略握手/文件同意信令与空文本系统消息，不落库生成无气泡消息
            if msg_type == "system" || content.starts_with("file_accept:") {
                return Ok(());
            }

            let id = v.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let peer_id = v.get("peerId").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let sender_id = v.get("senderId").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let sender_name = v.get("senderName").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let timestamp = v.get("timestamp").and_then(|s| s.as_i64()).unwrap_or(0);
            let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("delivered").to_string();

            if !id.is_empty() {
                let conn = self.conn.lock().unwrap();
                conn.execute(
                    "INSERT OR REPLACE INTO chat_messages (id, peer_id, sender_id, sender_name, content, timestamp, status, raw_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![id, peer_id, sender_id, sender_name, content, timestamp, status, msg_json],
                )?;
            }
        }
        Ok(())
    }

    pub fn get_all_chat_messages(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT raw_json FROM chat_messages ORDER BY timestamp ASC")?;
        let rows = stmt.query_map([], |row| {
            let json_str: String = row.get(0)?;
            Ok(json_str)
        })?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&r) {
                results.push(val);
            }
        }
        Ok(results)
    }

    pub fn get_chat_messages_by_peer(&self, peer_id: &str) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT raw_json FROM chat_messages WHERE peer_id = ?1 OR sender_id = ?1 ORDER BY timestamp ASC"
        )?;
        let rows = stmt.query_map([peer_id], |row| {
            let json_str: String = row.get(0)?;
            Ok(json_str)
        })?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&r) {
                results.push(val);
            }
        }
        Ok(results)
    }

    pub fn save_transfer(&self, transfer_json: &str) -> Result<()> {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(transfer_json) {
            let id = v.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let peer_id = v.get("peerId").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let peer_name = v.get("peerName").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let peer_ip = v.get("peerIp").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let direction = v.get("direction").and_then(|s| s.as_str()).unwrap_or("upload").to_string();
            let file_name = v.get("fileName").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let file_size = v.get("fileSize").and_then(|s| s.as_u64()).unwrap_or(0);
            let status = v.get("status").and_then(|s| s.as_str()).unwrap_or("completed").to_string();
            let start_time = v.get("startTime").and_then(|s| s.as_i64()).unwrap_or(0);
            let end_time = v.get("endTime").and_then(|s| s.as_i64());

            if !id.is_empty() {
                let conn = self.conn.lock().unwrap();
                conn.execute(
                    "INSERT OR REPLACE INTO transfers (id, peer_id, peer_name, peer_ip, direction, file_name, file_size, status, start_time, end_time, raw_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![id, peer_id, peer_name, peer_ip, direction, file_name, file_size, status, start_time, end_time, transfer_json],
                )?;
            }
        }
        Ok(())
    }

    pub fn get_all_transfers(&self) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT raw_json FROM transfers ORDER BY start_time DESC")?;
        let rows = stmt.query_map([], |row| {
            let json_str: String = row.get(0)?;
            Ok(json_str)
        })?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&r) {
                results.push(val);
            }
        }
        Ok(results)
    }

    pub fn clear_all_history(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM chat_messages", [])?;
        conn.execute("DELETE FROM transfers", [])?;
        Ok(())
    }
}
