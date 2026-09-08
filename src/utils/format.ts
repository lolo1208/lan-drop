/**
 * 格式化辅助工具函数
 */

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0.0 MB/s';
  const mbps = bytesPerSec / (1024 * 1024);
  if (mbps >= 1000) {
    return (mbps / 1024).toFixed(1) + ' GB/s';
  }
  if (mbps < 0.1) {
    const kbps = bytesPerSec / 1024;
    return kbps.toFixed(1) + ' KB/s';
  }
  return mbps.toFixed(1) + ' MB/s';
}

export function formatSpeedToBps(bytesPerSec: number): string {
  const bitsPerSec = bytesPerSec * 8;
  if (bitsPerSec >= 1_000_000_000) {
    return (bitsPerSec / 1_000_000_000).toFixed(2) + ' Gbps';
  }
  if (bitsPerSec >= 1_000_000) {
    return (bitsPerSec / 1_000_000).toFixed(1) + ' Mbps';
  }
  return (bitsPerSec / 1_000).toFixed(0) + ' Kbps';
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 5000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  return formatTime(timestamp);
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
