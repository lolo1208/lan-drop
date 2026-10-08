// 应用日志只保留 INFO 及以上事件，并限制文件大小。
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tracing_subscriber::fmt::{format::Writer, time::FormatTime};

struct LocalTime;

impl FormatTime for LocalTime {
    fn format_time(&self, writer: &mut Writer<'_>) -> std::fmt::Result {
        write!(writer, "{}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f%:z"))
    }
}

struct LogFile {
    path: PathBuf,
    file: Option<File>,
    size: u64,
    limit: u64,
}

impl LogFile {
    fn open(path: PathBuf, limit: u64) -> io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata()?.len();
        Ok(Self { path, file: Some(file), size, limit })
    }

    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.size > 0 && self.size + bytes.len() as u64 > self.limit {
            // 先关闭句柄，Windows 才能重命名；只保留上一份日志。
            self.file.take();
            let backup = self.path.with_file_name("app.previous.log");
            let rotation = (|| {
                if backup.exists() { std::fs::remove_file(&backup)?; }
                std::fs::rename(&self.path, &backup)
            })();
            let file = OpenOptions::new().create(true).append(true).open(&self.path)?;
            self.size = file.metadata()?.len();
            self.file = Some(file);
            rotation?;
        }
        let count = self.file.as_mut().ok_or_else(|| io::Error::other("日志文件未打开"))?.write(bytes)?;
        self.size += count as u64;
        Ok(count)
    }
}

#[derive(Clone)]
struct LogWriter(Arc<Mutex<LogFile>>);

impl Write for LogWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().map_err(|_| io::Error::other("日志锁不可用"))?.write(bytes)
    }

    fn flush(&mut self) -> io::Result<()> {
        let mut log = self.0.lock().map_err(|_| io::Error::other("日志锁不可用"))?;
        log.file.as_mut().ok_or_else(|| io::Error::other("日志文件未打开"))?.flush()
    }
}

pub fn init_logging() {
    let directory = dirs::document_dir().or_else(dirs::data_local_dir)
        .unwrap_or_else(std::env::temp_dir).join("LAN Drop").join("logs");
    let file = std::fs::create_dir_all(&directory)
        .and_then(|_| LogFile::open(directory.join("app.log"), 2 * 1024 * 1024));
    let writer = match file {
        Ok(file) => Some(LogWriter(Arc::new(Mutex::new(file)))),
        Err(error) => {
            eprintln!("无法创建应用日志 {}：{}", directory.display(), error);
            None
        }
    };
    tracing_subscriber::fmt()
        .with_ansi(false).with_target(false).with_timer(LocalTime)
        .with_max_level(tracing::Level::INFO)
        .with_writer(move || -> Box<dyn Write + Send> {
            match &writer {
                Some(writer) => Box::new(writer.clone()),
                None => Box::new(io::stderr()),
            }
        }).init();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotates_and_keeps_only_latest_backup() {
        let directory = std::env::temp_dir().join(format!("lan-drop-log-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("app.log");
        let mut log = LogFile::open(path.clone(), 8).unwrap();
        log.write(b"first\n").unwrap();
        log.write(b"second\n").unwrap();
        log.write(b"third\n").unwrap();
        drop(log);
        assert_eq!(std::fs::read(&path).unwrap(), b"third\n");
        assert_eq!(std::fs::read(directory.join("app.previous.log")).unwrap(), b"second\n");
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(directory.join("app.previous.log")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
