/**
 * LAN Drop (内网投送) - 类型定义
 * 支持 Tauri v2 IPC 与 Web 双模式
 */

export type DeviceOS = 'macos' | 'windows' | 'linux' | 'android' | 'ios';

export interface PeerDevice {
  id: string; // 唯一设备ID (UUID)
  name: string; // 设备名 (例如: MacBook Pro 16)
  avatarUrl?: string; // 用户头像 (Base64 或图片 URL)
  os: DeviceOS; // 操作系统类型
  ip: string; // 局域网 IPv4 地址
  port: number; // Axum HTTP 服务接收端口 (默认 7890)
  status: 'online' | 'offline' | 'busy'; // 在线状态
  lastSeen: number; // 最后心跳时间戳 (毫秒)
  pingMs: number; // 局域网延迟 (毫秒)
  version: string; // 客户端版本
  isLocal?: boolean; // 是否为当前本机
}

export type TransferDirection = 'send' | 'receive';
export type TransferStatus = 'queued' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type FileTransferState = 
  | 'waiting_accept' // 等待接收方点击“接收”
  | 'transferring'   // 正在流式传输
  | 'received'       // 已接收完成
  | 'rejected'       // 已拒绝
  | 'expired'        // 发送方离线无法接收
  | 'failed';        // 传输失败

export interface TransferTask {
  localFilePath?: string;
  savedDir?: string;
  id: string; // 传输任务ID
  peerId: string; // 对方设备ID
  peerName: string; // 对方设备名
  peerIp: string; // 对方IP
  direction: TransferDirection; // 发送 或 接收
  fileName: string; // 文件名
  fileSize: number; // 文件大小 (字节)
  fileType: string; // MIME 类型
  transferredBytes: number; // 已传输字节数
  speed: number; // 当前实时传输速率 (字节/秒)
  avgSpeed: number; // 平均传输速率 (字节/秒)
  progress: number; // 进度百分比 0-100
  status: TransferStatus; // 任务状态
  startTime: number; // 开始时间戳
  endTime?: number; // 结束时间戳
  etaSeconds: number; // 预计剩余时间 (秒)
  error?: string; // 错误信息 (如有)
  fileBlobUrl?: string; // 浏览器预览或下载的 Blob URL
  checksum?: string; // SHA-256 校验和
  memoryUsageMb: number; // Tokio 流式 I/O 内存开销 (常驻在 2~6 MB)
}

export interface FileAttachmentMeta {
  id: string;
  name: string;
  size: number;
  type: string; // MIME 如 'image/png', 'video/mp4', 'audio/mp3', 'application/pdf'
  blobUrl?: string; // 内存预览 URL 或已接收下载 URL
  originalPath?: string; // (发送方) 本地真实路径
  state: FileTransferState; // 传输状态：等待接收 / 传输中 / 已接收
  progress: number; // 0 - 100
  speed: number; // 实时速率 bytes/s
  savedPath?: string; // 接收方磁盘绝对路径（如 [用户文档]/lan-drop/xxx）
  senderIp: string;
  senderPort: number;
}

export interface ChatMessage {
  id: string; // 消息ID
  peerId: string; // 会话对端设备ID
  senderId: string; // 发送方ID
  senderName: string; // 发送方名称
  content: string; // 文本内容（如果是纯文件消息则可为文件名或附加说明）
  msgType: 'text' | 'file' | 'image' | 'video' | 'audio' | 'system'; // 消息类型
  timestamp: number; // 发送时间
  status: 'sending' | 'sent' | 'delivered' | 'failed'; // 状态
  fileAttachment?: FileAttachmentMeta;
}

export interface PeerConversation {
  peer: PeerDevice;
  lastMessage?: ChatMessage;
  unreadCount: number;
  updatedAt: number;
  draft?: string;
}

export interface LocalDeviceConfig {
  id: string;
  name: string;
  avatarUrl?: string; // 用户展示头像
  os: DeviceOS;
  ip: string;
  port: number;
  multicastGroup: string; // 组播地址，如 239.255.42.99:7432
  autoAccept: boolean; // 自动接收信任设备的文件
  downloadDir: string; // 下载目录
  heartbeatInterval: number; // 心跳广播间隔 (秒)
  updateUrl?: string; // 系统更新地址（局域网 url，启动时检查，存在新版本时自动更新）
  autoStart?: boolean; // 开机启动（开关，默认开启）
}

export interface RustCodeSnippet {
  title: string;
  filename: string;
  language: string;
  description: string;
  code: string;
}
