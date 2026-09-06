/**
 * Tauri v2 与 Web 预览双模 IPC 桥接层
 * 在 Tauri 环境下调用 Rust 后端核心；在 Web 预览环境下使用 BroadcastChannel + 虚拟局域网模拟引擎
 */

import { ChatMessage, LocalDeviceConfig, PeerDevice, TransferTask } from '../types';
import { storageService } from './storage';
import { PRESET_AVATARS } from '../utils/avatars';

// 检查是否在 Tauri v2 桌面客户端运行时中
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

export type EventCallback<T> = (payload: T) => void;

class IPCService {
  private localConfig: LocalDeviceConfig;
  private listeners: Map<string, Set<EventCallback<any>>> = new Map();
  private broadcastChannel: BroadcastChannel | null = null;
  private virtualPeers: PeerDevice[] = [];
  private activeSimulations: Map<string, number> = new Map();

  constructor() {
    this.localConfig = storageService.getSettings();
    if (isTauri()) {
      this.initTauriBridge();
    } else {
      this.initWebBridge();
    }
  }

  getLocalConfig(): LocalDeviceConfig {
    return this.localConfig;
  }

  async getSysInfo(): Promise<{ hostname: string; document_dir: string } | null> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<{ hostname: string; document_dir: string }>('get_sys_info');
      } catch (e) {
        console.warn('Failed to get sys info:', e);
        return null;
      }
    }
    return null;
  }

  async updateLocalConfig(config: LocalDeviceConfig) {
    this.localConfig = config;
    storageService.saveSettings(config);
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_download_dir', { dir: config.downloadDir });
      } catch (e) {
        console.warn('Failed to set download dir:', e);
      }
    }
    this.broadcastLocalHeartbeat();
  }

  // --- 事件订阅与发布机制 ---
  on<T>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit<T>(event: string, payload: T) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(payload);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      });
    }
  }

  // --- 初始化 Tauri 真实网络桥接 ---
  private async initTauriBridge() {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');

      // 更新本机的真实设备信息（Tauri 从 rust 层获取）
      const localDevice = await invoke<any>('get_local_device');
      this.localConfig = { ...this.localConfig, ...localDevice };
      storageService.saveSettings(this.localConfig);

      // 监听发现的设备
      await listen('peer://discovered', (event: any) => {
        const data = event.payload;
        const peer = data.peer as PeerDevice;
        // 如果后端传回的 peer 没有默认的头像等数据，在这里进行补全
        const finalPeer: PeerDevice = {
          ...peer,
          avatarUrl: peer.avatarUrl || PRESET_AVATARS[Math.floor(Math.random() * PRESET_AVATARS.length)].url,
          status: 'online',
          lastSeen: Date.now(),
          pingMs: 1.0,
          version: '2.0.0'
        };

        const idx = this.virtualPeers.findIndex((p) => p.id === finalPeer.id);
        if (idx >= 0) {
          this.virtualPeers[idx] = { ...this.virtualPeers[idx], ...finalPeer, status: 'online', lastSeen: Date.now() };
        } else {
          this.virtualPeers.push(finalPeer);
        }
        this.emit('peers://updated', [...this.virtualPeers]);
      });

      // 监听设备离线
      await listen('peer://offline', (event: any) => {
        const id = event.payload.id;
        const idx = this.virtualPeers.findIndex((p) => p.id === id);
        if (idx >= 0) {
          this.virtualPeers[idx].status = 'offline';
          this.emit('peers://updated', [...this.virtualPeers]);
        }
      });

      // 监听接收到的聊天消息
      await listen('chat://received', async (event: any) => {
        const msg = event.payload as ChatMessage;
        // 拦截系统控制信令：如对方同意接收文件
        if (msg.msgType === 'system' && msg.content.startsWith('file_accept:')) {
          const fileMsgId = msg.content.split(':')[1];
          const allChats = await storageService.getAllChats();
          const fileMsg = allChats.find(m => m.id === fileMsgId);
          if (fileMsg && fileMsg.fileAttachment && fileMsg.fileAttachment.originalPath) {
            const peer = this.virtualPeers.find(p => p.id === msg.senderId);
            if (peer && peer.ip) {
              await invoke('start_file_transfer', {
                targetIp: peer.ip,
                targetPort: peer.port || 7890,
                filePath: fileMsg.fileAttachment.originalPath,
                taskId: fileMsg.fileAttachment.id
              });
            }
          }
          return; // 不将此类消息抛给 UI 显示
        }

        // 当自己是接收者时，对方作为 peerId
        msg.peerId = msg.senderId;
        this.emit('chat://received', msg);
        storageService.saveChatMessage(msg);
      });

      // 监听发送传输进度 (发件方)
      await listen('transfer://progress', (event: any) => {
        const payload = event.payload;
        this.emit('transfer://progress', {
          id: payload.taskId,
          progress: Math.min(100, Number(((payload.transferred / payload.total) * 100).toFixed(1))),
          speed: payload.speed,
        });
      });

      // 监听发送传输失败
      await listen('transfer://error', (event: any) => {
        this.emit('transfer://error', event.payload);
      });

      // 监听收到的文件传输进度 (收件方)
      await listen('transfer://incoming_progress', (event: any) => {
        const payload = event.payload;
        this.emit('transfer://progress', {
          id: 'recv-' + payload.taskId, // 配合前端历史记录规则
          progress: Math.min(99, Number(((payload.transferred / payload.total) * 100).toFixed(1))),
          speed: payload.speed,
        });
      });

      // 监听收到文件传输完成
      await listen('transfer://incoming_complete', (event: any) => {
        const payload = event.payload;
        const id = 'recv-' + payload.taskId;
        
        // 我们只触发进度更新到100，剩余的 `saveTransfer` 由 conversationManager 自己判断
        this.emit('transfer://progress', {
          id: id,
          progress: 100,
          speed: 0,
        });
        
        // 在这也可顺便发一个 file://received
        // 因为 msgId = payload.taskId (如果约定一致的话)
      });
      
    } catch (e) {
      console.error('Tauri bridge init failed:', e);
    }
  }

  // --- 初始化 Web 模拟网络与多标签页真实互联 ---
  private initWebBridge() {
    if (typeof window === 'undefined') return;

    // 1. 初始化预设的局域网设备 (模拟无中心 UDP 组播发现)
    this.virtualPeers = [
      {
        id: 'peer-mbp-m3',
        name: 'MacBook Pro M3 Max',
        avatarUrl: PRESET_AVATARS[1].url,
        os: 'macos',
        ip: '192.168.1.102',
        port: 7890,
        status: 'online',
        lastSeen: Date.now(),
        pingMs: 1.8,
        version: '2.0.0',
      },
      {
        id: 'peer-ubuntu-srv',
        name: 'Ubuntu HomeServer (NAS)',
        avatarUrl: PRESET_AVATARS[2].url,
        os: 'linux',
        ip: '192.168.1.188',
        port: 7890,
        status: 'online',
        lastSeen: Date.now(),
        pingMs: 0.9,
        version: '2.0.0',
      },
      {
        id: 'peer-win11-pc',
        name: 'Alienware Gaming PC',
        avatarUrl: PRESET_AVATARS[3].url,
        os: 'windows',
        ip: '192.168.1.145',
        port: 7890,
        status: 'online',
        lastSeen: Date.now(),
        pingMs: 2.4,
        version: '2.0.0',
      },
      {
        id: 'peer-ipad-pro',
        name: 'iPad Pro 12.9',
        avatarUrl: PRESET_AVATARS[4].url,
        os: 'ios',
        ip: '192.168.1.119',
        port: 7890,
        status: 'offline',
        lastSeen: Date.now() - 1000 * 60 * 12, // 12分钟前离线
        pingMs: 4.2,
        version: '2.0.0',
      },
    ];

    // 2. BroadcastChannel: 如果用户在两个浏览器标签页或窗口打开，互相作为真正的独立节点发现
    if ('BroadcastChannel' in window) {
      this.broadcastChannel = new BroadcastChannel('flashdrop_multicast_bus');
      this.broadcastChannel.onmessage = (event) => {
        const { type, data } = event.data || {};
        if (type === 'HEARTBEAT') {
          if (data.id !== this.localConfig.id) {
            this.handleIncomingPeerHeartbeat(data);
          }
        } else if (type === 'CHAT_MSG') {
          if (data.peerId === this.localConfig.id) {
            this.emit('chat://received', data);
            storageService.saveChatMessage({
              ...data,
              peerId: data.senderId, // 对方视角
            });
          }
        } else if (type === 'START_TRANSFER') {
          if (data.targetPeerId === this.localConfig.id) {
            this.handleIncomingTransferRequest(data);
          }
        }
      };

      // 周期性发送广播心跳 (模拟 UDP 组播 239.255.42.99:7432)
      setInterval(() => {
        this.broadcastLocalHeartbeat();
        this.checkPeersLiveness();
      }, 3000);

      // 初次广播
      this.broadcastLocalHeartbeat();
    }
  }

  private broadcastLocalHeartbeat() {
    if (!this.broadcastChannel) return;
    const packet: PeerDevice = {
      id: this.localConfig.id,
      name: this.localConfig.name,
      avatarUrl: this.localConfig.avatarUrl,
      os: this.localConfig.os,
      ip: this.localConfig.ip,
      port: this.localConfig.port,
      status: 'online',
      lastSeen: Date.now(),
      pingMs: 1.2,
      version: '2.0.0',
    };
    this.broadcastChannel.postMessage({ type: 'HEARTBEAT', data: packet });
  }

  private handleIncomingPeerHeartbeat(peer: PeerDevice) {
    const idx = this.virtualPeers.findIndex((p) => p.id === peer.id);
    if (idx >= 0) {
      this.virtualPeers[idx] = {
        ...peer,
        status: 'online',
        lastSeen: Date.now(),
      };
    } else {
      this.virtualPeers.push({
        ...peer,
        status: 'online',
        lastSeen: Date.now(),
      });
    }
    this.emit('peers://updated', [...this.virtualPeers]);
  }

  // 检测设备心跳超时 (超过 9 秒未收到心跳则标记离线)
  private checkPeersLiveness() {
    const now = Date.now();
    let changed = false;
    this.virtualPeers.forEach((p) => {
      // 保持部分模拟设备活跃
      if (p.id.startsWith('peer-') && p.status === 'online') {
        p.lastSeen = now;
        p.pingMs = Number((Math.random() * 2 + 1).toFixed(1));
        changed = true;
      } else if (now - p.lastSeen > 9000 && p.status === 'online') {
        p.status = 'offline';
        changed = true;
      }
    });

    if (changed) {
      this.emit('peers://updated', [...this.virtualPeers]);
    }
  }

  // --- 对外接口：获取已发现对端列表 ---
  async getDiscoveredPeers(): Promise<PeerDevice[]> {
    return [...this.virtualPeers];
  }

  // 切换对端在线/离线 (方便用户测试离线与心跳状态切换)
  togglePeerStatus(peerId: string) {
    const peer = this.virtualPeers.find((p) => p.id === peerId);
    if (peer) {
      peer.status = peer.status === 'online' ? 'offline' : 'online';
      peer.lastSeen = peer.status === 'online' ? Date.now() : Date.now() - 60000;
      this.emit('peers://updated', [...this.virtualPeers]);
    }
  }

  // 添加自定义测试对端设备
  addCustomPeer(peer: Omit<PeerDevice, 'id' | 'lastSeen' | 'pingMs' | 'version'>): PeerDevice {
    const newPeer: PeerDevice = {
      ...peer,
      id: 'peer-custom-' + Math.random().toString(36).substring(2, 7),
      lastSeen: Date.now(),
      pingMs: Number((Math.random() * 3 + 0.8).toFixed(1)),
      version: '2.0.0',
    };
    this.virtualPeers.unshift(newPeer);
    this.emit('peers://updated', [...this.virtualPeers]);
    return newPeer;
  }

  // --- 发送即时聊天消息 ---
  async sendChatMessage(peerId: string, content: string): Promise<ChatMessage> {
    const peer = this.virtualPeers.find((p) => p.id === peerId);
    
    // 我们在此直接支持解析可能传过来的序列化 ChatMessage，兼容文件握手
    let msg: ChatMessage;
    try {
      const parsed = JSON.parse(content);
      if (parsed.id && parsed.msgType) {
        msg = parsed; // 这是外部传进来的已包装好的消息（如 file_offer）
      } else {
        throw new Error('Not a message object');
      }
    } catch {
      msg = {
        id: 'msg-' + Math.random().toString(36).substring(2, 10),
        peerId,
        senderId: this.localConfig.id,
        senderName: this.localConfig.name,
        content,
        msgType: 'text',
        timestamp: Date.now(),
        status: peer?.status === 'online' ? 'delivered' : 'sent',
      };
    }

    // 保存到本地数据库
    await storageService.saveChatMessage(msg);

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        if (peer && peer.ip) {
          await invoke('send_chat_message', {
            targetIp: peer.ip,
            targetPort: peer.port || 7890,
            message: msg // 交给后端 serde_json::Value 直接传输
          });
        }
      } catch (e) {
        console.error('Failed to send chat message via Tauri:', e);
        msg.status = 'failed';
        this.emit('chat://updated', msg);
      }
      return msg;
    }

    // 广播或模拟回复 (Web 环境)
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: 'CHAT_MSG',
        data: msg,
      });
    }

    // 如果对方在线并且是内置模拟设备，模拟真实的局域网自动回复
    if (peer && peer.status === 'online' && peer.id.startsWith('peer-')) {
      setTimeout(() => {
        this.simulatePeerReply(peer, content);
      }, 1000 + Math.random() * 1500);
    }

    return msg;
  }

  // 模拟对方设备通过 Axum HTTP 发送回执消息
  private async simulatePeerReply(peer: PeerDevice, userText: string) {
    const replies: Record<string, string[]> = {
      default: [
        `[${peer.name} 已通过 Axum HTTP 接收]: 收到你的消息，局域网连接通畅！`,
        `[${peer.name}]: 文件流通道已就绪，随时可以推送。`,
        `[${peer.name}]: 当前千兆局域网测速正常，延迟 ${peer.pingMs}ms。`,
      ],
      speed: [`[${peer.name}]: 测试信道速率良好，Tokio 异步 I/O 准备就绪，跑满带宽无瓶颈。`],
    };

    const textList = userText.includes('速') || userText.includes('文件') ? replies.speed : replies.default;
    const replyText = textList[Math.floor(Math.random() * textList.length)];

    const replyMsg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: peer.id,
      senderId: peer.id,
      senderName: peer.name,
      content: replyText,
      msgType: 'text',
      timestamp: Date.now(),
      status: 'delivered',
    };

    await storageService.saveChatMessage(replyMsg);
    this.emit('chat://received', replyMsg);
  }

  // --- 发起文件极速流式传输任务 ---
  async startFileTransfer(peer: PeerDevice, file: File): Promise<TransferTask> {
    const taskId = 'task-' + Math.random().toString(36).substring(2, 11);
    const initialTask: TransferTask = {
      id: taskId,
      peerId: peer.id,
      peerName: peer.name,
      peerIp: peer.ip,
      direction: 'send',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      transferredBytes: 0,
      speed: 0,
      avgSpeed: 0,
      progress: 0,
      status: 'transferring',
      startTime: Date.now(),
      etaSeconds: 0,
      memoryUsageMb: 3.4, // Tokio streaming 极低固定内存
      fileBlobUrl: URL.createObjectURL(file),
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };

    this.emit('transfer://created', initialTask);

    // 启动流式传输仿真 (模拟 Tokio ReaderStream + Reqwest 流式写入 Axum，速度 85~115 MB/s)
    this.runStreamingSimulation(initialTask, file);

    return initialTask;
  }

  private handleIncomingTransferRequest(data: any) {
    // 模拟接收端接收到的流式任务
    const incomingTask: TransferTask = {
      ...data,
      direction: 'receive',
      status: 'transferring',
      startTime: Date.now(),
    };
    this.emit('transfer://created', incomingTask);
  }

  // 模拟 Tokio 异步流式传输：低内存占用、平滑的实时速率与进度计算
  private runStreamingSimulation(task: TransferTask, originalFile?: File) {
    const totalBytes = task.fileSize;
    let transferred = 0;
    const startTime = Date.now();
    let lastTime = startTime;
    let lastBytes = 0;

    // 根据文件大小调整流式模拟步长：千兆局域网典型速率 90 ~ 118 MB/s
    const targetSpeed = 95 * 1024 * 1024; // 95 MB/s
    const intervalMs = 80; // 80ms 高频进度更新 (类似 Tokio Stream Chunk 汇报)
    const bytesPerTick = Math.max(64 * 1024, Math.floor((targetSpeed * intervalMs) / 1000));

    const timerId = window.setInterval(() => {
      // 检查是否暂停或取消
      if (task.status === 'paused') {
        return;
      }
      if (task.status === 'cancelled') {
        clearInterval(timerId);
        this.activeSimulations.delete(task.id);
        return;
      }

      const now = Date.now();
      // 加入轻微网络抖动 (85MB/s ~ 112MB/s)
      const jitter = (Math.random() * 0.2 + 0.9);
      const chunk = Math.min(Math.floor(bytesPerTick * jitter), totalBytes - transferred);
      transferred += chunk;

      const elapsedSec = (now - lastTime) / 1000;
      const currentSpeed = elapsedSec > 0 ? (transferred - lastBytes) / elapsedSec : targetSpeed;
      lastBytes = transferred;
      lastTime = now;

      const totalElapsedSec = (now - startTime) / 1000;
      const avgSpeed = totalElapsedSec > 0 ? transferred / totalElapsedSec : currentSpeed;
      const remainingBytes = Math.max(0, totalBytes - transferred);
      const etaSeconds = currentSpeed > 0 ? Math.ceil(remainingBytes / currentSpeed) : 0;
      const progress = Math.min(100, Number(((transferred / totalBytes) * 100).toFixed(1)));

      // 模拟 Tokio 流式常驻内存微弱波动 (3.2MB ~ 4.6MB)
      const memoryUsageMb = Number((3.2 + Math.random() * 1.2).toFixed(2));

      task.transferredBytes = transferred;
      task.speed = currentSpeed;
      task.avgSpeed = avgSpeed;
      task.progress = progress;
      task.etaSeconds = etaSeconds;
      task.memoryUsageMb = memoryUsageMb;

      this.emit('transfer://progress', { ...task });

      if (transferred >= totalBytes) {
        clearInterval(timerId);
        this.activeSimulations.delete(task.id);

        task.status = 'completed';
        task.endTime = Date.now();
        task.progress = 100;
        task.speed = 0;
        task.etaSeconds = 0;

        // 保存历史记录
        storageService.saveTransfer(task);
        this.emit('transfer://completed', { ...task });

        // 提示音频或者回音
        this.playSuccessSound();
      }
    }, intervalMs);

    this.activeSimulations.set(task.id, timerId);
  }

  pauseTransfer(task: TransferTask) {
    task.status = 'paused';
    task.speed = 0;
    this.emit('transfer://progress', { ...task });
  }

  resumeTransfer(task: TransferTask) {
    task.status = 'transferring';
    this.emit('transfer://progress', { ...task });
  }

  cancelTransfer(task: TransferTask) {
    task.status = 'cancelled';
    const timer = this.activeSimulations.get(task.id);
    if (timer) {
      clearInterval(timer);
      this.activeSimulations.delete(task.id);
    }
    storageService.saveTransfer(task);
    this.emit('transfer://progress', { ...task });
  }

  private playSuccessSound() {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch {
      // Audio context might be restricted before user interaction
    }
  }
}

export const ipc = new IPCService();
