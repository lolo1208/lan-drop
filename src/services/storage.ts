/**
 * 本地持久化服务 (基于 IndexedDB 与 LocalStorage)
 * 用于持久化保存历史文件传输记录、局域网聊天记录和设备偏好设置
 */

import { ChatMessage, LocalDeviceConfig, TransferTask } from '../types';
import { PRESET_AVATARS } from '../utils/avatars';

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

export function getDefaultDocumentsPath(): string {
  if (typeof navigator === 'undefined') return '/Users/User/Documents/lan-drop';
  const ua = navigator.userAgent;
  if (ua.includes('Win')) {
    return 'C:\\Users\\User\\Documents\\lan-drop';
  }
  if (ua.includes('Mac')) {
    return '/Users/User/Documents/lan-drop';
  }
  return '/home/user/Documents/lan-drop';
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
    try {
      const db = await this.getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TRANSFERS, 'readwrite');
        const store = tx.objectStore(STORE_TRANSFERS);
        // 不保存过大的内存二进制以免占用过量 IndexedDB 配额
        const serialized = { ...task };
        store.put(serialized);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Fallback to localStorage
      this.fallbackSave('transfers', task);
    }
  }

  async getAllTransfers(): Promise<TransferTask[]> {
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
      const all = this.fallbackGetAll<ChatMessage>('chats');
      return all.filter((c) => c.peerId === peerId).sort((a, b) => a.timestamp - b.timestamp);
    }
  }

  async getAllChats(): Promise<ChatMessage[]> {
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

  async clearChats(peerId?: string): Promise<void> {
    try {
      const db = await this.getDb();
      if (!peerId) {
        const tx = db.transaction(STORE_CHATS, 'readwrite');
        tx.objectStore(STORE_CHATS).clear();
      } else {
        const tx = db.transaction(STORE_CHATS, 'readwrite');
        const store = tx.objectStore(STORE_CHATS);
        const index = store.index('peerId');
        const req = index.openCursor(peerId);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }
    } catch {
      if (!peerId) {
        localStorage.removeItem('flashdrop_chats');
      }
    }
  }

  // --- 设置配置 ---
  getSettings(): LocalDeviceConfig {
    const raw = localStorage.getItem('flashdrop_config');
    const machineName = getDefaultMachineName();
    const osType = navigator.userAgent.includes('Mac')
      ? 'macos'
      : navigator.userAgent.includes('Win')
      ? 'windows'
      : navigator.userAgent.includes('Linux')
      ? 'linux'
      : 'macos';

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed.name || parsed.name.includes('(dev-')) {
          parsed.name = machineName;
        }
        if (!parsed.avatarUrl) {
          parsed.avatarUrl = PRESET_AVATARS[0].url;
        }
        const defaultPath = getDefaultDocumentsPath();
        if (!parsed.downloadDir || parsed.downloadDir === '~/Downloads/FlashDrop' || parsed.downloadDir.includes('[用户文档]')) {
          parsed.downloadDir = defaultPath;
        }
        if (parsed.autoStart === undefined) {
          parsed.autoStart = true;
        }
        if (parsed.updateUrl === undefined) {
          parsed.updateUrl = '';
        }
        return parsed;
      } catch (e) {
        console.error('Failed to parse config:', e);
      }
    }

    const defaultId = 'dev-' + Math.random().toString(36).substring(2, 9);
    const defaultConfig: LocalDeviceConfig = {
      id: defaultId,
      name: machineName,
      avatarUrl: PRESET_AVATARS[0].url,
      os: osType,
      ip: '192.168.1.' + Math.floor(100 + Math.random() * 80),
      port: 7890,
      multicastGroup: '239.255.42.99:7432',
      autoAccept: true,
      downloadDir: getDefaultDocumentsPath(),
      heartbeatInterval: 3,
      updateUrl: '',
      autoStart: true,
    };
    this.saveSettings(defaultConfig);
    return defaultConfig;
  }

  saveSettings(config: LocalDeviceConfig): void {
    localStorage.setItem('flashdrop_config', JSON.stringify(config));
  }

  // LocalStorage Fallbacks
  private fallbackSave<T extends { id: string }>(key: string, item: T) {
    try {
      const raw = localStorage.getItem(`flashdrop_${key}`);
      const list: T[] = raw ? JSON.parse(raw) : [];
      const idx = list.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        list[idx] = item;
      } else {
        list.push(item);
      }
      localStorage.setItem(`flashdrop_${key}`, JSON.stringify(list));
    } catch (e) {
      console.warn('LocalStorage fallback quota full', e);
    }
  }

  private fallbackGetAll<T>(key: string): T[] {
    try {
      const raw = localStorage.getItem(`flashdrop_${key}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

export const storageService = new LocalStorageService();
