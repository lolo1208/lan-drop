/**
 * 本地持久化服务 (Tauri SQLite 原生持久化 + 浏览器 IndexedDB/LocalStorage 双模)
 * 优先使用 SQLite 本地数据库文件 (data.db，存储于 [用户文档]/LAN Drop/data.db) 存储历史文件传输记录、局域网聊天记录和设备偏好设置
 */

import { ChatMessage, LocalDeviceConfig, TransferTask } from '../types';
import { PRESET_AVATARS } from '../utils/avatars';
import { isTauri } from '../utils/tauri';

export function getDefaultMachineName(): string {
  if (typeof navigator === 'undefined') return 'My Computer';
  const ua = navigator.userAgent;
  if (ua.includes('Mac')) return 'MacBook Pro';
  if (ua.includes('Win')) return 'Windows PC';
  if (ua.includes('Linux')) return 'Linux Workstation';
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('iPad')) return 'iPad';
  if (ua.includes('Android')) return 'Android Phone';
  return 'Personal Computer';
}

let cachedRealDocDir: string = '';

export function getDefaultDocumentsPath(): string {
  if (cachedRealDocDir) return cachedRealDocDir;
  if (typeof navigator === 'undefined') return '[用户文档]/LAN Drop/Files';
  const ua = navigator.userAgent;
  if (ua.includes('Win')) {
    return 'C:\\LAN Drop\\Files';
  }
  if (ua.includes('Mac')) {
    return '/Users/Shared/LAN Drop/Files';
  }
  return '/tmp/LAN Drop/Files';
}

/**
 * 浏览器端基于 WebRTC ICE Candidate 轻量嗅探真实局域网 IPv4
 */
export async function detectLocalIPv4(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.RTCPeerConnection) return null;
  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('detect-lan-ip');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => resolve(null));

      const timer = setTimeout(() => {
        try {
          pc.close();
        } catch {
          // ignore
        }
        resolve(null);
      }, 1200);

      pc.onicecandidate = (event) => {
        if (!event || !event.candidate || !event.candidate.candidate) return;
        const candidateStr = event.candidate.candidate;
        const match = candidateStr.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
        if (match) {
          const ip = match[1];
          if (!ip.startsWith('127.') && !ip.startsWith('0.') && !ip.startsWith('169.254.')) {
            clearTimeout(timer);
            try {
              pc.close();
            } catch {
              // ignore
            }
            resolve(ip);
          }
        }
      };
    } catch {
      resolve(null);
    }
  });
}

const DB_NAME = 'flashdrop_p2p_db';
const DB_VERSION = 1;
const STORE_TRANSFERS = 'transfers';
const STORE_CHATS = 'chats';
const STORE_SETTINGS = 'settings';

class LocalStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_TRANSFERS)) {
          const transferStore = db.createObjectStore(STORE_TRANSFERS, { keyPath: 'id' });
          transferStore.createIndex('peerId', 'peerId', { unique: false });
          transferStore.createIndex('status', 'status', { unique: false });
          transferStore.createIndex('startTime', 'startTime', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_CHATS)) {
          const chatStore = db.createObjectStore(STORE_CHATS, { keyPath: 'id' });
          chatStore.createIndex('peerId', 'peerId', { unique: false });
          chatStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  // --- 传输历史记录 ---
  async saveTransfer(task: TransferTask): Promise<void> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('db_save_transfer', { transferJson: JSON.stringify(task) });
        return;
      } catch (e) {
        console.warn('Tauri SQLite 保存传输记录失败:', e);
      }
    }

    try {
      const db = await this.getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRANSFERS, 'readwrite');
        const store = tx.objectStore(STORE_TRANSFERS);
        const serialized = { ...task };
        store.put(serialized);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      this.fallbackSave('transfers', task);
    }
  }

  async getAllTransfers(): Promise<TransferTask[]> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke<TransferTask[]>('db_get_all_transfers');
        if (Array.isArray(list)) {
          return list;
        }
      } catch (e) {
        console.warn('Tauri SQLite 读取传输记录失败:', e);
      }
    }

    try {
      const db = await this.getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRANSFERS, 'readonly');
        const store = tx.objectStore(STORE_TRANSFERS);
        const request = store.getAll();
        request.onsuccess = () => {
          const list: TransferTask[] = request.result || [];
          list.sort((a, b) => b.startTime - a.startTime);
          resolve(list);
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return this.fallbackGetAll<TransferTask>('transfers');
    }
  }

  async clearTransfers(): Promise<void> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('db_clear_all_history');
        return;
      } catch (e) {
        console.warn('Tauri SQLite 清空历史失败:', e);
      }
    }

    try {
      const db = await this.getDb();
      const tx = db.transaction(STORE_TRANSFERS, 'readwrite');
      tx.objectStore(STORE_TRANSFERS).clear();
    } catch {
      localStorage.removeItem('flashdrop_transfers');
    }
  }

  // --- 聊天记录 ---
  async saveChatMessage(msg: ChatMessage): Promise<void> {
    // 忽略握手/文件同意等系统信令，不落库生成无气泡的空消息
    if (msg.msgType === 'system' || (msg.content && msg.content.startsWith('file_accept:'))) {
      return;
    }

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('db_save_chat_message', { msgJson: JSON.stringify(msg) });
        return;
      } catch (e) {
        console.warn('Tauri SQLite 保存聊天记录失败:', e);
      }
    }

    try {
      const db = await this.getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CHATS, 'readwrite');
        const store = tx.objectStore(STORE_CHATS);
        store.put(msg);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      this.fallbackSave('chats', msg);
    }
  }

  async getChatMessages(peerId: string): Promise<ChatMessage[]> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke<ChatMessage[]>('db_get_chat_messages_by_peer', { peerId });
        if (Array.isArray(list)) {
          return list;
        }
      } catch (e) {
        console.warn('Tauri SQLite 按联系人读取聊天记录失败:', e);
      }
    }

    try {
      const db = await this.getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CHATS, 'readonly');
        const store = tx.objectStore(STORE_CHATS);
        const index = store.index('peerId');
        const request = index.getAll(peerId);
        request.onsuccess = () => {
          const list: ChatMessage[] = request.result || [];
          list.sort((a, b) => a.timestamp - b.timestamp);
          resolve(list);
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return this.fallbackGetAll<ChatMessage>('chats').then((all) =>
        all.filter((m) => m.peerId === peerId || m.senderId === peerId).sort((a, b) => a.timestamp - b.timestamp)
      );
    }
  }

  async getAllChats(): Promise<ChatMessage[]> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke<ChatMessage[]>('db_get_all_chat_messages');
        if (Array.isArray(list)) {
          return list;
        }
      } catch (e) {
        console.warn('Tauri SQLite 读取全部聊天记录失败:', e);
      }
    }

    try {
      const db = await this.getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_CHATS, 'readonly');
        const store = tx.objectStore(STORE_CHATS);
        const request = store.getAll();
        request.onsuccess = () => {
          const list: ChatMessage[] = request.result || [];
          list.sort((a, b) => a.timestamp - b.timestamp);
          resolve(list);
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return this.fallbackGetAll<ChatMessage>('chats');
    }
  }

  async clearChat(peerId: string): Promise<void> {
    try {
      const db = await this.getDb();
      const tx = db.transaction(STORE_CHATS, 'readwrite');
      const store = tx.objectStore(STORE_CHATS);
      const index = store.index('peerId');
      const request = index.openCursor(peerId);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    } catch {
      const all = await this.fallbackGetAll<ChatMessage>('chats');
      const filtered = all.filter((m) => m.peerId !== peerId && m.senderId !== peerId);
      localStorage.setItem('flashdrop_chats', JSON.stringify(filtered));
    }
  }

  // --- 设备设置持久化 (SQLite .db 为第一真值来源) ---
  private cachedSettings: LocalDeviceConfig | null = null;

  async loadSettingsFromDb(): Promise<LocalDeviceConfig> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const dbSettings = await invoke<LocalDeviceConfig>('db_get_all_settings');
        if (dbSettings && dbSettings.id) {
          if (dbSettings.downloadDir && !dbSettings.downloadDir.includes('\\Users\\User\\') && !dbSettings.downloadDir.includes('/Users/User/')) {
            cachedRealDocDir = dbSettings.downloadDir;
          }

          // 如果 SQLite .db 中没有存储自定义头像（例如 .db 文件被用户手动删除并重建），必须重置为预设头像，不能使用 localStorage 中的旧头像
          const avatarUrl = dbSettings.avatarUrl && dbSettings.avatarUrl.trim() !== ''
            ? dbSettings.avatarUrl
            : PRESET_AVATARS[0].url;

          const formatted: LocalDeviceConfig = {
            id: dbSettings.id,
            name: dbSettings.name || getDefaultMachineName(),
            avatarUrl,
            os: dbSettings.os || 'windows',
            ip: dbSettings.ip || '',
            port: dbSettings.port || 57088,
            downloadDir: dbSettings.downloadDir || getDefaultDocumentsPath(),
            autoStart: dbSettings.autoStart !== undefined ? dbSettings.autoStart : true,
            updateUrl: dbSettings.updateUrl || '',
            multicastGroup: '239.255.42.99:7432',
            autoAccept: false,
            heartbeatInterval: 10,
          };
          this.cachedSettings = formatted;
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('flashdrop_settings', JSON.stringify(formatted));
          }
          return formatted;
        }
      } catch (e) {
        console.warn('从 SQLite 读取设置失败，使用本地兜底:', e);
      }
    }

    return this.getSettings();
  }

  getSettings(): LocalDeviceConfig {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    const defaultName = getDefaultMachineName();
    const defaultPath = getDefaultDocumentsPath();

    if (typeof localStorage === 'undefined') {
      const init: LocalDeviceConfig = {
        id: 'node-' + Math.random().toString(36).substring(2, 10),
        name: defaultName,
        ip: '',
        port: 57088,
        os: 'windows',
        avatarUrl: PRESET_AVATARS[0].url,
        downloadDir: defaultPath,
        autoStart: true,
        updateUrl: '',
        multicastGroup: '239.255.42.99:7432',
        autoAccept: false,
        heartbeatInterval: 10,
      };
      this.cachedSettings = init;
      return init;
    }

    const saved = localStorage.getItem('flashdrop_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (
          !parsed.downloadDir ||
          parsed.downloadDir === '~/Downloads/FlashDrop' ||
          parsed.downloadDir.includes('[用户文档]') ||
          parsed.downloadDir.includes('\\Users\\User\\') ||
          parsed.downloadDir.includes('/Users/User/') ||
          parsed.downloadDir.endsWith('LAN Drop')
        ) {
          parsed.downloadDir = defaultPath;
        }
        if (!parsed.port || parsed.port === 7890) {
          parsed.port = 57088;
        }
        if (parsed.ip === '192.168.1.100') {
          parsed.ip = '';
        }
        const full: LocalDeviceConfig = {
          multicastGroup: '239.255.42.99:7432',
          autoAccept: false,
          heartbeatInterval: 10,
          ...parsed,
        };
        this.cachedSettings = full;
        return full;
      } catch (e) {
        console.error('Failed to parse settings:', e);
      }
    }

    const initial: LocalDeviceConfig = {
      id: 'node-' + Math.random().toString(36).substring(2, 10),
      name: defaultName,
      ip: '',
      port: 57088,
      os: 'windows',
      avatarUrl: PRESET_AVATARS[0].url,
      downloadDir: defaultPath,
      autoStart: true,
      updateUrl: '',
      multicastGroup: '239.255.42.99:7432',
      autoAccept: false,
      heartbeatInterval: 10,
    };
    this.cachedSettings = initial;
    this.saveSettings(initial);
    return initial;
  }

  saveSettings(config: LocalDeviceConfig): void {
    this.cachedSettings = { ...config };
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('flashdrop_settings', JSON.stringify(config));
    }
    if (isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('db_save_all_settings', {
          settings: {
            id: config.id,
            name: config.name,
            avatarUrl: config.avatarUrl || '',
            os: config.os,
            ip: config.ip,
            port: config.port || 57088,
            multicastGroup: config.multicastGroup || '239.255.42.99:7432',
            autoAccept: !!config.autoAccept,
            downloadDir: config.downloadDir,
            heartbeatInterval: config.heartbeatInterval || 10,
            updateUrl: config.updateUrl || '',
            autoStart: config.autoStart !== undefined ? config.autoStart : true,
          },
        }).catch((err) => {
          console.warn('保存设置到 SQLite .db 失败:', err);
        });
      });
    }
  }

  // --- LocalStorage Fallbacks ---
  private fallbackSave(key: string, item: any): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(`flashdrop_${key}`);
      const list = raw ? JSON.parse(raw) : [];
      const idx = list.findIndex((i: any) => i.id === item.id);
      if (idx >= 0) {
        list[idx] = item;
      } else {
        list.push(item);
      }
      localStorage.setItem(`flashdrop_${key}`, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  private async fallbackGetAll<T>(key: string): Promise<T[]> {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(`flashdrop_${key}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

export const storageService = new LocalStorageService();
