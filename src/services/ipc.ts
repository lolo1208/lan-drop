/**
 * Tauri v2 与 Web 预览双模 IPC 桥接层
 * 在 Tauri 环境下调用 Rust 后端核心；在 Web 预览环境下使用 BroadcastChannel + 虚拟局域网模拟引擎
 */

import { ChatMessage, LocalDeviceConfig, PeerDevice, TransferTask } from '../types';
import { detectLocalIPv4, storageService } from './storage';
import { PRESET_AVATARS, toCompactAvatarIdentifier, resolveAvatarUrl } from '../utils/avatars';
import { isTauri } from '../utils/tauri';

export { isTauri };

export type EventCallback<T> = (payload: T) => void;

class IPCService {
  private localConfig: LocalDeviceConfig;
  private listeners: Map<string, Set<EventCallback<any>>> = new Map();
  private broadcastChannel: BroadcastChannel | null = null;
  private virtualPeers: PeerDevice[] = [];
  private activeSimulations: Map<string, number> = new Map();
  private webHiddenToTray: boolean = false;

  private initPromise: Promise<void> | null = null;

  constructor() {
    this.localConfig = storageService.getSettings();
    this.init();
  }

  public async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = isTauri() ? this.initTauriBridge() : this.initWebBridge();
    return this.initPromise;
  }

  getLocalConfig(): LocalDeviceConfig {
    return this.localConfig;
  }

  async getSysInfo(): Promise<{ hostname: string; document_dir: string; local_ip?: string; port?: number } | null> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<{ hostname: string; document_dir: string; local_ip?: string; port?: number }>('get_sys_info');
      } catch (e) {
        console.warn('获取系统信息失败:', e);
        return null;
      }
    }
    return null;
  }

  async updateLocalConfig(config: Partial<LocalDeviceConfig>) {
    this.localConfig = { ...this.localConfig, ...config };
    storageService.saveSettings(this.localConfig);
    this.emit('config://updated', this.localConfig);

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_download_dir', { dir: this.localConfig.downloadDir });
        await invoke('set_auto_start', { enabled: !!this.localConfig.autoStart });
        const synced = await invoke<any>('sync_local_device', {
          device: {
            id: this.localConfig.id,
            name: this.localConfig.name,
            ip: this.localConfig.ip,
            port: this.localConfig.port || 57088,
            os: this.localConfig.os,
            avatarUrl: this.localConfig.avatarUrl || '',
          },
        });
        if (synced && synced.ip && synced.ip !== '127.0.0.1' && synced.ip !== '0.0.0.0') {
          if (this.localConfig.ip !== synced.ip) {
            this.localConfig.ip = synced.ip;
            storageService.saveSettings(this.localConfig);
            this.emit('config://updated', this.localConfig);
          }
        }
      } catch (e) {
        console.warn('同步配置至 Rust 后端失败:', e);
      }
    }
    this.broadcastLocalHeartbeat();
  }

  async setAutoStart(enabled: boolean): Promise<void> {
    this.localConfig.autoStart = enabled;
    storageService.saveSettings(this.localConfig);
    this.emit('config://updated', this.localConfig);

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_auto_start', { enabled });
      } catch (e) {
        console.warn('调用 set_auto_start 失败:', e);
      }
    }
  }

  async selectDirectory(): Promise<string | null> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const folder = await invoke<string | null>('select_directory');
        if (folder) return folder;
      } catch (e) {
        console.warn('调用 select_directory 失败:', e);
      }
    }
    return null;
  }

  async registerGlobalHotkey(hotkey: string): Promise<void> {
    this.localConfig.globalHotkey = hotkey;
    storageService.saveSettings(this.localConfig);
    this.emit('config://updated', this.localConfig);

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('register_global_hotkey', { hotkey });
      } catch (e) {
        console.warn('调用 register_global_hotkey 失败:', e);
      }
    }
  }

  async triggerDiscoveryScan() {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const found = await invoke<any[]>('trigger_discovery_scan');
        if (Array.isArray(found)) {
          found.forEach((dev) => {
            if (dev.id !== this.localConfig.id) {
              this.registerDiscoveredPeer(dev);
            }
          });
        }
      } catch (e) {
        console.warn('触发发现扫描异常:', e);
      }
    } else {
      this.broadcastLocalHeartbeat();
    }
  }

  // 注册或更新已发现的局域网对端（智能去重：优先按 ID，次优按 IP 合并）
  registerDiscoveredPeer(rawPeer: Partial<PeerDevice> & { id: string; name: string; ip?: string; port?: number }): PeerDevice {
    const peerIp = rawPeer.ip || '';
    
    // 生成确定的头像（优先使用对方广播的真实头像；如果是系统头像，仅传递 ID '0'~'10'）
    let avatarUrl = rawPeer.avatarUrl;
    if (!avatarUrl || avatarUrl.trim() === '') {
      let hash = 0;
      for (let i = 0; i < (rawPeer.id || rawPeer.name).length; i++) {
        hash = (hash << 5) - hash + (rawPeer.id || rawPeer.name).charCodeAt(i);
        hash |= 0;
      }
      const avatarIndex = Math.abs(hash) % 11;
      avatarUrl = String(avatarIndex);
    } else {
      avatarUrl = toCompactAvatarIdentifier(avatarUrl);
    }

    const finalPeer: PeerDevice = {
      id: rawPeer.id,
      name: rawPeer.name || '局域网设备',
      ip: peerIp,
      port: rawPeer.port || 57088,
      os: (rawPeer.os as any) || 'windows',
      avatarUrl,
      status: 'online',
      lastSeen: Date.now(),
      pingMs: rawPeer.pingMs || 1.0,
      version: rawPeer.version || '2.0.0',
    };

    // 查重：ID 相同，或者（非空 IP 相同）均视为同一台设备，避免出现重复两个联系人
    const idx = this.virtualPeers.findIndex(
      (p) => p.id === finalPeer.id || (peerIp && p.ip && p.ip === peerIp)
    );

    if (idx >= 0) {
      this.virtualPeers[idx] = {
        ...this.virtualPeers[idx],
        ...finalPeer,
        status: 'online',
        lastSeen: Date.now(),
      };
    } else {
      this.virtualPeers.push(finalPeer);
    }

    this.emit('peers://updated', [...this.virtualPeers]);
    return finalPeer;
  }

  async probePeerIp(ip: string, port = 57088): Promise<PeerDevice> {
    const cleanIp = ip.trim();
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const dev = await invoke<any>('probe_peer_ip', { ip: cleanIp, port });
      return this.registerDiscoveredPeer(dev);
    } else {
      // 浏览器演示模拟：直接创建或连接该 IP 虚拟设备
      const existing = this.virtualPeers.find((p) => p.ip === cleanIp);
      if (existing) {
        existing.status = 'online';
        existing.lastSeen = Date.now();
        this.emit('peers://updated', [...this.virtualPeers]);
        return existing;
      }
      const newPeer: PeerDevice = {
        id: `peer-${cleanIp.replace(/\./g, '-')}`,
        name: `设备 (${cleanIp})`,
        ip: cleanIp,
        port: port,
        os: 'windows',
        avatarUrl: PRESET_AVATARS[1].url,
        status: 'online',
        lastSeen: Date.now(),
        pingMs: 1.0,
        version: '2.0.0',
      };
      return this.registerDiscoveredPeer(newPeer);
    }
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
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`Error in listener for ${event}:`, err);
        }
      });
    }
  }

  // --- 初始化 Tauri 原生 Rust 核心绑定 ---
  private async initTauriBridge() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // 1. 立即优先注册所有 Tauri 原生事件监听器（确保第一时间捕获消息、信令与文件流）
      const safeListen = async (eventName: string, handler: (event: any) => void) => {
        try {
          return await listen(eventName, handler);
        } catch (err) {
          console.warn(`Tauri 监听事件 [${eventName}] 失败 (请确保 capabilities 已启用对应权限):`, err);
          return () => {};
        }
      };

      // 监听接收到的即时聊天消息与系统控制信令
      await safeListen('chat://received', async (event: any) => {
        const msg = event.payload as ChatMessage;
        if (!msg || !msg.id) return;

        const senderIp = msg.senderIp || msg.fileAttachment?.senderIp || (event.payload?.senderIp || '');
        const senderPort = msg.senderPort || msg.fileAttachment?.senderPort || 57088;

        // 若不是自己发出的，则将对端设备 ID 设为 peerId
        if (msg.senderId !== this.localConfig.id) {
          msg.peerId = msg.senderId;
        }
        msg.senderIp = senderIp;
        msg.senderPort = senderPort;
        if (!msg.peerIp && senderIp) {
          msg.peerIp = senderIp;
        }

        // 自动将发送方设备注册/更新为联系人并立即更新在线状态
        if (msg.senderId && msg.senderId !== this.localConfig.id) {
          this.registerDiscoveredPeer({
            id: msg.senderId,
            name: msg.senderName || '局域网设备',
            ip: senderIp,
            port: senderPort,
            avatarUrl: msg.senderAvatarUrl || '',
            status: 'online',
          });
        }

        // 拦截系统控制信令：如对方同意接收文件 或 对方请求断点续传文件
        if (msg.msgType === 'system' && msg.content) {
          if (msg.content.startsWith('file_accept:')) {
            const parts = msg.content.split(':');
            const fileMsgId = parts[1];
            const folder = parts[2] || undefined;
            const destName = parts[3] || undefined;
            this.emit('file://accepted', {
              fileId: fileMsgId,
              receiverId: msg.senderId,
              receiverName: msg.senderName,
              receiverIp: senderIp,
              receiverPort: senderPort,
              offset: 0,
              folder,
              destName,
            });
            return; // 系统信令不作为常规聊天气泡展示
          } else if (msg.content.startsWith('file_resume:')) {
            const parts = msg.content.split(':');
            const fileMsgId = parts[1];
            const offset = Number(parts[2]) || 0;
            const folder = parts[3] || undefined;
            const destName = parts[4] || undefined;
            this.emit('file://accepted', {
              fileId: fileMsgId,
              receiverId: msg.senderId,
              receiverName: msg.senderName,
              receiverIp: senderIp,
              receiverPort: senderPort,
              offset,
              folder,
              destName,
            });
            return;
          }
        }

        // 常规聊天消息：立即在前端广播消息，保证 UI 毫秒级零延迟即时刷新与展现
        this.emit('chat://received', msg);
        this.emit('chat://updated', msg);

        // 异步写入持久化存储（不阻塞当前主事件派发循环）
        storageService.saveChatMessage(msg).catch((err) => {
          console.warn('异步保存聊天记录失败:', err);
        });
      });

      // 监听发现的对端设备 (纯 HTTP 网段并发扫描 或 手动 IP 探测回报)
      await safeListen('peer://discovered', (event: any) => {
        const data = event.payload;
        if (data && data.peer) {
          if (data.peer.id === this.localConfig.id) return;
          this.registerDiscoveredPeer({
            ...data.peer,
            ip: data.remoteIp || data.peer.ip,
          });
        }
      });

      // 监听设备离线
      await safeListen('peer://offline', (event: any) => {
        const id = event.payload?.id;
        const ip = event.payload?.ip;
        let changed = false;
        this.virtualPeers.forEach((p) => {
          if ((id && p.id === id) || (ip && p.ip === ip)) {
            if (p.status !== 'offline') {
              p.status = 'offline';
              changed = true;
            }
          }
        });
        if (changed) {
          this.emit('peers://updated', [...this.virtualPeers]);
        }
      });

      // 监听收到的流式文件传输进度 (收件方)
      await safeListen('transfer://incoming_progress', (event: any) => {
        const payload = event.payload;
        if (!payload) return;

        const progress = Math.min(99, Number(((payload.transferred / payload.total) * 100).toFixed(1)));
        this.emit('transfer://incoming_progress', {
          taskId: payload.taskId,
          fileName: payload.fileName,
          transferred: payload.transferred,
          total: payload.total,
          progress,
          speed: payload.speed || 0,
        });
      });

      // 监听收到文件传输完成
      await safeListen('transfer://incoming_complete', async (event: any) => {
        const payload = event.payload;
        if (!payload) return;

        const allChats = await storageService.getAllChats();
        const fileMsg = allChats.find(
          (m) => m.fileAttachment?.id === payload.taskId || m.fileAttachment?.name === payload.fileName
        );
        if (fileMsg && fileMsg.fileAttachment) {
          fileMsg.fileAttachment.state = 'received';
          fileMsg.fileAttachment.progress = 100;
          fileMsg.fileAttachment.speed = 0;
          fileMsg.fileAttachment.savedPath = payload.savedPath;
          await storageService.saveChatMessage(fileMsg);
          this.emit('chat://updated', fileMsg);
          this.emit('file://received', fileMsg);
        }
      });

      // 监听发送端传输进度与报错
      await safeListen('transfer://progress', (event: any) => {
        const payload = event.payload;
        if (!payload) return;
        this.emit('transfer://progress', payload);
      });

      await safeListen('transfer://error', (event: any) => {
        this.emit('transfer://error', event.payload);
      });

      await safeListen('transfer://incoming_error', (event: any) => {
        this.emit('transfer://incoming_error', event.payload);
      });

      // 监听底层原生快捷键/系统托盘发来的窗口切换指令
      await safeListen('app://toggle_window', async () => {
        await this.toggleWindow();
      });

      // 2. 定期检测设备在线状态 (超过 25 秒未收到心跳则标记离线)
      setInterval(() => {
        const now = Date.now();
        let changed = false;
        this.virtualPeers.forEach((p) => {
          if (p.status === 'online' && now - (p.lastSeen || 0) > 25000) {
            p.status = 'offline';
            changed = true;
          }
        });
        if (changed) {
          this.emit('peers://updated', [...this.virtualPeers]);
        }
      }, 5000);

      // 3. 从 SQLite .db / localStorage 加载全部持久化配置
      const dbConfig = await storageService.loadSettingsFromDb();
      this.localConfig = { ...dbConfig };

      // 获取 Rust 端自动挑选的最优物理局域网 IP 与持久化 node_id
      const sysInfo = await invoke<any>('get_sys_info');
      if (sysInfo && sysInfo.node_id) {
        this.localConfig.id = sysInfo.node_id;
      }

      const localDevice = await invoke<any>('get_local_device');
      if (localDevice && localDevice.ip && localDevice.ip !== '127.0.0.1' && localDevice.ip !== '0.0.0.0') {
        this.localConfig.ip = localDevice.ip;
      }

      // 将持久化好的设备配置同步至 Rust 核心
      const syncedDevice = await invoke<any>('sync_local_device', {
        device: {
          id: this.localConfig.id,
          name: this.localConfig.name,
          ip: this.localConfig.ip,
          port: this.localConfig.port || 57088,
          os: this.localConfig.os,
          avatarUrl: toCompactAvatarIdentifier(this.localConfig.avatarUrl),
        },
      });

      if (syncedDevice && syncedDevice.ip && syncedDevice.ip !== '127.0.0.1' && syncedDevice.ip !== '0.0.0.0') {
        this.localConfig.ip = syncedDevice.ip;
      }

      // 同步设定的下载路径至 Rust 核心
      if (this.localConfig.downloadDir) {
        await invoke('set_download_dir', { dir: this.localConfig.downloadDir }).catch(() => {});
      }

      storageService.saveSettings(this.localConfig);
      this.emit('config://updated', this.localConfig);

    } catch (e) {
      console.error('Tauri bridge 初始化失败:', e);
    }
  }

  // --- 初始化 Web 模拟网络与多标签页真实互联 ---
  private async initWebBridge() {
    if (typeof window === 'undefined') return;

    // 浏览器环境动态探测真实局域网 IPv4
    detectLocalIPv4().then((realIp) => {
      if (realIp && realIp !== this.localConfig.ip) {
        this.localConfig.ip = realIp;
        storageService.saveSettings(this.localConfig);
        this.emit('config://updated', this.localConfig);
        this.broadcastLocalHeartbeat();
      }
    });

    this.virtualPeers = [
      {
        id: 'peer-mbp-m3',
        name: 'MacBook Pro M3 Max',
        avatarUrl: PRESET_AVATARS[1].url,
        os: 'macos',
        ip: '192.168.1.102',
        port: 57088,
        status: 'online',
        lastSeen: Date.now(),
        pingMs: 1.8,
        version: '2.0.0',
      },
      {
        id: 'peer-win11-pc',
        name: 'Alienware Gaming PC',
        avatarUrl: PRESET_AVATARS[3].url,
        os: 'windows',
        ip: '192.168.1.145',
        port: 57088,
        status: 'online',
        lastSeen: Date.now(),
        pingMs: 2.4,
        version: '2.0.0',
      },
    ];

    if ('BroadcastChannel' in window) {
      this.broadcastChannel = new BroadcastChannel('flashdrop_multicast_bus');
      this.broadcastChannel.onmessage = (event) => {
        const { type, data } = event.data || {};
        if (type === 'HEARTBEAT') {
          if (data.id !== this.localConfig.id) {
            this.handleIncomingPeerHeartbeat(data);
          }
        } else if (type === 'CHAT_MSG') {
          if (data.peerId === this.localConfig.id || data.peerId === data.senderId) {
            const incoming = { ...data, peerId: data.senderId };

            if (incoming.msgType === 'system' && incoming.content) {
              if (incoming.content.startsWith('file_accept:')) {
                const parts = incoming.content.split(':');
                const fileMsgId = parts[1];
                const folder = parts[2] || undefined;
                const destName = parts[3] || undefined;
                this.emit('file://accepted', {
                  fileId: fileMsgId,
                  receiverId: incoming.senderId,
                  receiverName: incoming.senderName,
                  receiverIp: incoming.senderIp,
                  receiverPort: incoming.senderPort || 57088,
                  offset: 0,
                  folder,
                  destName,
                });
                return;
              } else if (incoming.content.startsWith('file_resume:')) {
                const parts = incoming.content.split(':');
                const fileMsgId = parts[1];
                const offset = Number(parts[2]) || 0;
                const folder = parts[3] || undefined;
                const destName = parts[4] || undefined;
                this.emit('file://accepted', {
                  fileId: fileMsgId,
                  receiverId: incoming.senderId,
                  receiverName: incoming.senderName,
                  receiverIp: incoming.senderIp,
                  receiverPort: incoming.senderPort || 57088,
                  offset,
                  folder,
                  destName,
                });
                return;
              } else if (incoming.content.startsWith('read_receipt')) {
                this.emit('chat://received', incoming);
                return;
              }
            }

            this.emit('chat://received', incoming);
            this.emit('chat://updated', incoming);
            storageService.saveChatMessage(incoming);
          }
        }
      };

      setInterval(() => {
        this.broadcastLocalHeartbeat();
        this.checkPeersLiveness();
      }, 3000);

      this.broadcastLocalHeartbeat();
    }
  }

  private broadcastLocalHeartbeat() {
    if (!this.broadcastChannel) return;
    this.broadcastChannel.postMessage({
      type: 'HEARTBEAT',
      data: {
        id: this.localConfig.id,
        name: this.localConfig.name,
        ip: this.localConfig.ip,
        port: this.localConfig.port || 57088,
        os: this.localConfig.os,
        avatarUrl: this.localConfig.avatarUrl,
        status: 'online',
        lastSeen: Date.now(),
        pingMs: 1.0,
      },
    });
  }

  private handleIncomingPeerHeartbeat(peer: PeerDevice) {
    this.registerDiscoveredPeer(peer);
  }

  private checkPeersLiveness() {
    const now = Date.now();
    let changed = false;
    this.virtualPeers.forEach((p) => {
      if (p.id.startsWith('peer-') && p.status === 'online') {
        p.lastSeen = now;
        p.pingMs = Number((Math.random() * 2 + 1).toFixed(1));
        changed = true;
      } else if (now - p.lastSeen > 20000 && p.status === 'online') {
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

  // --- 发送即时聊天消息 ---
  async sendChatMessage(target: PeerDevice | string, payload: ChatMessage | string): Promise<ChatMessage> {
    let peer: PeerDevice | undefined;
    let peerId: string;
    let targetIp: string | undefined;
    let targetPort = 57088;

    if (typeof target === 'string') {
      peerId = target;
      peer = this.virtualPeers.find((p) => p.id === peerId || p.ip === peerId);
      targetIp = peer?.ip || (peerId.includes('.') ? peerId : undefined);
      targetPort = peer?.port || 57088;
    } else {
      peer = target;
      peerId = target.id;
      targetIp = target.ip;
      targetPort = target.port || 57088;
    }

    if (!targetIp && peerId) {
      const foundInPeers = this.virtualPeers.find((p) => p.id === peerId);
      if (foundInPeers && foundInPeers.ip) {
        targetIp = foundInPeers.ip;
        targetPort = foundInPeers.port || targetPort;
      }
    }

    let msg: ChatMessage;
    if (typeof payload === 'object' && payload.id) {
      msg = payload;
    } else {
      msg = {
        id: 'msg-' + Math.random().toString(36).substring(2, 10),
        peerId,
        senderId: this.localConfig.id,
        senderName: this.localConfig.name,
        senderAvatarUrl: toCompactAvatarIdentifier(this.localConfig.avatarUrl),
        content: String(payload),
        msgType: 'text',
        timestamp: Date.now(),
        status: 'delivered',
      };
    }

    // 确保携带自身头像与 IP/Port，供对端自动发现和回信
    msg.senderAvatarUrl = toCompactAvatarIdentifier(msg.senderAvatarUrl || this.localConfig.avatarUrl);
    if (!msg.senderIp) {
      msg.senderIp = this.localConfig.ip;
    }
    if (!msg.senderPort) {
      msg.senderPort = this.localConfig.port || 57088;
    }
    if (targetIp && !msg.peerIp) {
      msg.peerIp = targetIp;
    }

    // 保存到本地 SQLite/IndexedDB
    await storageService.saveChatMessage(msg);
    this.emit('chat://updated', msg);

    if (isTauri()) {
      if (targetIp) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('send_chat_message', {
            targetIp,
            targetPort,
            message: msg,
          });
        } catch (e) {
          console.error('通过 Tauri 发送消息失败:', e);
          msg.status = 'failed';
          await storageService.saveChatMessage(msg);
          this.emit('chat://updated', msg);
        }
      } else {
        console.warn('无法获取目标设备 IP 地址，消息发送未完成:', target);
      }
      return msg;
    }

    // Web 预览广播与模拟回复
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: 'CHAT_MSG',
        data: msg,
      });
    }

    if (peer && peer.status === 'online' && peer.id.startsWith('peer-')) {
      setTimeout(() => {
        this.simulatePeerReply(peer, msg.content);
      }, 1000 + Math.random() * 1500);
    }

    return msg;
  }

  // 模拟对方设备通过 Axum HTTP 发送回执消息 (Web 演示)
  private async simulatePeerReply(peer: PeerDevice, userText: string) {
    // 1. 模拟对方“已阅读”用户发出的消息：将用户发给该 peer 的所有未读消息标记为已读，并通知前端
    try {
      const allMessages = await storageService.getChatMessages(peer.id);
      let updatedRead = false;
      for (const m of allMessages) {
        if (m.senderId === this.localConfig.id && !m.isRead) {
          m.isRead = true;
          m.readTimestamp = Date.now();
          await storageService.saveChatMessage(m);
          this.emit('chat://updated', m);
          updatedRead = true;
        }
      }
      if (updatedRead) {
        this.emit('chat://read_status_changed', { peerId: peer.id });
      }
    } catch {
      // ignore
    }

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
      senderAvatarUrl: peer.avatarUrl,
      content: replyText,
      msgType: 'text',
      timestamp: Date.now(),
      status: 'delivered',
    };

    await storageService.saveChatMessage(replyMsg);
    this.emit('chat://updated', replyMsg);
  }

  // 检查目标文件在本地已落盘的字节大小（用于断点续传）
  async getPartialFileSize(fileName: string): Promise<number> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const size = await invoke<number>('get_partial_file_size', { fileName });
        return size || 0;
      } catch (err) {
        console.warn('获取已存在的部分文件大小失败:', err);
        return 0;
      }
    }
    return 0;
  }

  // 检查本地文件是否真实存在（用于聊天气泡精准检测“文件已丢失”状态）
  async checkFileExists(filePath?: string): Promise<boolean> {
    if (!filePath || filePath.trim() === '') return false;
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const exists = await invoke<boolean>('check_file_exists', { filePath });
        return Boolean(exists);
      } catch (err) {
        console.warn('检查本地文件状态失败:', err);
        return false;
      }
    }
    // Web 预览模式：若路径存在且未被标记清除，默认视为存在
    return !filePath.includes('__missing__');
  }

  // 读取本地媒体文件为 Data URL（用于 Tauri 或 Webview 直接显示）
  async readMediaDataUrl(filePath: string, mimeType?: string): Promise<string> {
    if (!filePath || filePath.trim() === '') return '';
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const dataUrl = await invoke<string>('read_media_data_url', {
          filePath,
          mimeType,
        });
        return dataUrl || '';
      } catch (err) {
        console.warn('读取本地媒体 Data URL 失败:', err);
        return '';
      }
    }
    return '';
  }

  // 获取可靠的本地媒体 URL（优先 convertFileSrc，必要时读取 Data URL）
  async getMediaUrl(filePath?: string, mimeType?: string): Promise<string> {
    if (!filePath || filePath.trim() === '') return '';
    if (isTauri()) {
      try {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const assetUrl = convertFileSrc(filePath);
        if (assetUrl) return assetUrl;
      } catch {
        // fallback to data url
      }
      return this.readMediaDataUrl(filePath, mimeType);
    }
    return '';
  }

  // 在操作系统文件管理器中定位并打开指定目录，选中该文件
  async openInFolder(filePath: string): Promise<void> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_in_folder', { path: filePath });
      } catch (err) {
        console.warn('调用原生 open_in_folder 失败:', err);
      }
    } else {
      console.log('[Web模拟] 打开所在目录并选中文件:', filePath);
    }
  }

  // 获取 [用户文档]/LAN Drop/Media 目录绝对路径
  async getMediaDir(): Promise<string> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const dir = await invoke<string>('get_media_dir');
        return dir;
      } catch {
        // fallback
      }
    }
    return '[用户文档]/LAN Drop/Media';
  }

  // 保存媒体文件到 [用户文档]/LAN Drop/Media 目录，名称为 md5 值
  async saveMediaFileToDisk(md5: string, ext: string, data: Uint8Array): Promise<string> {
    const cleanExt = ext.replace(/^\./, '');
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const savedPath = await invoke<string>('save_media_file_to_disk', {
          md5,
          ext: cleanExt,
          data: Array.from(data),
        });
        return savedPath;
      } catch (err) {
        console.error('Tauri 保存媒体文件失败:', err);
      }
    }
    const fileName = cleanExt ? `${md5}.${cleanExt}` : md5;
    return `[用户文档]/LAN Drop/Media/${fileName}`;
  }

  // 发送方从本地原路径快速保存/拷贝到 Media 目录（名称为 md5）
  async saveMediaFromPath(md5: string, ext: string, sourcePath: string): Promise<string> {
    const cleanExt = ext.replace(/^\./, '');
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const savedPath = await invoke<string>('save_media_from_path', {
          md5,
          ext: cleanExt,
          sourcePath,
        });
        return savedPath;
      } catch (err) {
        console.warn('Tauri 从原路径保存媒体失败，尝试读写保存:', err);
      }
    }
    const fileName = cleanExt ? `${md5}.${cleanExt}` : md5;
    return `[用户文档]/LAN Drop/Media/${fileName}`;
  }
  // 判断窗口当前是否处于激活/前台可见状态（如果被关闭隐藏至托盘或最小化则返回 false）
  async isWindowActive(): Promise<boolean> {
    if (this.webHiddenToTray) {
      return false;
    }
    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        const isVisible = await appWindow.isVisible();
        const isMinimized = await appWindow.isMinimized();
        return isVisible && !isMinimized;
      } catch {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const active = await invoke<boolean>('is_window_visible');
          return !!active;
        } catch {
          return !document.hidden;
        }
      }
    }
    return !this.webHiddenToTray && !document.hidden;
  }

  // 请求系统通知权限
  async requestNotificationPermission(): Promise<boolean> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('request_notification_permission');
        return true;
      } catch (err) {
        console.warn('Tauri 请求系统通知权限异常:', err);
        return true;
      }
    }
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        const res = await Notification.requestPermission();
        return res === 'granted';
      }
      return Notification.permission === 'granted';
    }
    return false;
  }

  // 发送系统原生通知
  async showNotification(title: string, body: string): Promise<void> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('show_system_notification', { title, body });
        return;
      } catch (err) {
        console.warn('Tauri 发送系统通知失败:', err);
      }
    }
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }

  // 退出整个应用程序（彻底完全退出）
  async exitApp(): Promise<void> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('exit_app');
      } catch (err) {
        console.error('退出应用失败:', err);
      }
    }
  }

  // 隐藏窗口到任务栏系统托盘（在任务栏程序条中不再显示，只保留系统托盘小图标）
  async hideToTray(): Promise<void> {
    this.webHiddenToTray = true;
    this.emit('app://window_hidden_to_tray', true);
    this.emit('app://window_state_changed', { visible: false });

    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        await appWindow.hide();
      } catch (err) {
        console.warn('Tauri appWindow.hide 异常:', err);
      }
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('hide_to_tray');
      } catch (err) {
        console.warn('Tauri invoke hide_to_tray 异常:', err);
      }
    }
  }

  // 从托盘唤醒并恢复窗口显示
  async showFromTray(): Promise<void> {
    this.webHiddenToTray = false;
    this.emit('app://window_hidden_to_tray', false);
    this.emit('app://window_state_changed', { visible: true });
    this.emit('app://restored_from_tray', null);

    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        await appWindow.show();
        await appWindow.unminimize();
        await appWindow.setFocus();
      } catch (err) {
        console.warn('Tauri appWindow.show 异常:', err);
      }
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('show_from_tray');
      } catch (err) {
        console.warn('Tauri invoke show_from_tray 异常:', err);
      }
    }
  }

  // 切换窗口激活/隐藏状态：前台激活状态下隐藏程序只保留托盘图标，非激活/隐藏状态下恢复显示到前台
  async toggleWindow(): Promise<void> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('toggle_window');
        return;
      } catch (err) {
        console.warn('invoke toggle_window 异常，回退到前端状态判断:', err);
      }
    }
    const isActive = await this.isWindowActive();
    if (isActive) {
      await this.hideToTray();
    } else {
      await this.showFromTray();
    }
  }

  // 检查局域网 Master 机器的新版本更新 (并执行自动下载与替换重启)
  async checkForUpdates(masterIp: string): Promise<{
    status: 'latest' | 'updating' | 'no_master' | 'error' | 'no_config';
    current_version: string;
    remote_version?: string;
    message: string;
  }> {
    const cleanIp = masterIp ? masterIp.trim() : '';
    if (!cleanIp) {
      return {
        status: 'no_config',
        current_version: '2.0.0',
        message: '请先输入局域网 Master 机器的 IP 地址',
      };
    }

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<any>('check_for_updates', { masterIp: cleanIp });
        return res;
      } catch (err: any) {
        console.warn('Tauri 检查更新失败:', err);
        return {
          status: 'error',
          current_version: '2.0.0',
          message: typeof err === 'string' ? err : err?.message || '检查更新失败，请确认 Master 机器在线',
        };
      }
    } else {
      // 浏览器 Web 演示环境：尝试 fetch 目标 IP 的 /api/update/version
      try {
        let targetHost = cleanIp;
        if (targetHost.startsWith('http://')) targetHost = targetHost.slice(7);
        if (targetHost.startsWith('https://')) targetHost = targetHost.slice(8);
        if (targetHost.includes('/')) targetHost = targetHost.split('/')[0];
        if (!targetHost.includes(':')) targetHost = `${targetHost}:57088`;

        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 3500);
        const resp = await fetch(`http://${targetHost}/api/update/version`, {
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(tid);

        if (resp && resp.ok) {
          const data = await resp.json();
          if (data.available && data.version) {
            if (data.version !== '2.0.0') {
              return {
                status: 'updating',
                current_version: '2.0.0',
                remote_version: data.version,
                message: `检测到 Master 新版本 (v${data.version})，已触发自动更新流程`,
              };
            }
            return {
              status: 'latest',
              current_version: '2.0.0',
              remote_version: data.version,
              message: `当前程序已是最新版本 (v2.0.0)`,
            };
          }
          return {
            status: 'no_master',
            current_version: '2.0.0',
            message: `Master 机器 (${cleanIp}) 尚未发布更新（[文档]/LAN Drop/Update 目录下未放置 version.cfg）`,
          };
        }
        return {
          status: 'error',
          current_version: '2.0.0',
          message: `无法连接到 Master 机器 (${cleanIp})，请确认网络连接与机器是否在线`,
        };
      } catch {
        return {
          status: 'error',
          current_version: '2.0.0',
          message: `连接 Master 机器 (${cleanIp}) 超时，请检查 IP 与防火墙`,
        };
      }
    }
  }
}

export const ipc = new IPCService();
