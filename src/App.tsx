import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Eye, Monitor } from 'lucide-react';
import confetti from 'canvas-confetti';
import { ChatPanel } from './components/ChatPanel';
import { MediaLightbox } from './components/MediaLightbox';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { conversationManager } from './services/conversationManager';
import { ipc, isTauri } from './services/ipc';
import { getDefaultDocumentsPath, getDefaultMachineName, setDefaultDocumentsCache, storageService } from './services/storage';
import {
  ChatMessage,
  LocalDeviceConfig,
  PeerConversation,
  PeerDevice,
  TransferTask,
} from './types';
import { PRESET_AVATARS } from './utils/avatars';

// 校验是否为展示型消息（过滤握手/文件同意等纯信令消息）
const isDisplayableMessage = (m: ChatMessage): boolean => {
  if (!m) return false;
  if (m.msgType === 'system') return false;
  if (m.content && m.content.startsWith('file_accept:')) return false;
  if (!m.fileAttachment && (!m.content || !m.content.trim())) return false;
  return true;
};

// 消息排重辅助函数
const deduplicateMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const map = new Map<string, ChatMessage>();
  for (const m of messages) {
    if (m && m.id && isDisplayableMessage(m)) {
      map.set(m.id, m);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
};

// 插入或更新单条消息
const upsertMessage = (list: ChatMessage[], newMsg: ChatMessage): ChatMessage[] => {
  if (!isDisplayableMessage(newMsg)) return list;
  const index = list.findIndex((m) => m.id === newMsg.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = { ...next[index], ...newMsg };
    return next;
  }
  return [...list, newMsg].sort((a, b) => a.timestamp - b.timestamp);
};

export function App() {
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<PeerDevice | null>(null);
  const [allChats, setAllChats] = useState<ChatMessage[]>([]);
  const [, setTransfers] = useState<TransferTask[]>([]);
  const [config, setConfig] = useState<LocalDeviceConfig>(() =>
    storageService.getSettings()
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<'user' | 'system'>('user');
  const [folderToast, setFolderToast] = useState<string | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [isHiddenToTray, setIsHiddenToTray] = useState(false);

  // 始终维护最新的 config 引用，避免 keydown 闭包陷阱
  const configRef = useRef<LocalDeviceConfig>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // 媒体大图/视频/音频预览弹窗
  const [lightbox, setLightbox] = useState<{
    isOpen: boolean;
    type: 'image' | 'video' | 'audio';
    url: string;
    fileName: string;
    filePath?: string;
  }>({
    isOpen: false,
    type: 'image',
    url: '',
    fileName: '',
    filePath: undefined,
  });

  // 最新未读后台消息引用（用于从系统托盘唤醒时快速定位至该消息及联系人）
  const latestBackgroundMsgRef = useRef<ChatMessage | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifiedMsgIdsRef = useRef<Set<string>>(new Set());

  const selectedPeerRef = useRef<PeerDevice | null>(selectedPeer);
  useEffect(() => {
    selectedPeerRef.current = selectedPeer;
  }, [selectedPeer]);

  // 标记单个联系人的消息为已读并发送局域网已读回执
  const handleMarkPeerRead = useCallback(async (peerId: string) => {
    if (!peerId) return;

    let hasStateUnread = false;
    setAllChats((prev) => {
      hasStateUnread = prev.some(
        (m) => (m.peerId === peerId || m.senderId === peerId) && m.senderId !== config.id && !m.isRead
      );
      if (!hasStateUnread) return prev;
      return prev.map((m) => {
        if ((m.peerId === peerId || m.senderId === peerId) && m.senderId !== config.id && !m.isRead) {
          return { ...m, isRead: true, readTimestamp: Date.now() };
        }
        return m;
      });
    });

    const updatedDbCount = await storageService.markPeerMessagesAsRead(peerId, config.id);

    // 仅当确实存在未读消息被标记为已读时，才触发局域网已读回执网络请求
    if (hasStateUnread || updatedDbCount > 0) {
      const targetPeer = peers.find((p) => p.id === peerId) || peerId;
      conversationManager.sendReadReceipt(targetPeer);
    }
  }, [config.id, peers]);

  // 辅助函数：触发消息临时高亮框并在2.5秒后自动淡出消失
  const triggerMessageHighlight = (msgId: string) => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    setHighlightMessageId(msgId);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightMessageId((curr) => (curr === msgId ? null : curr));
    }, 2500);
  };

  // 全局阻止浏览器拖拽本地文件的默认打开/导航行为
  useEffect(() => {
    const handleGlobalDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const handleGlobalDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    window.addEventListener('dragover', handleGlobalDragOver);
    window.addEventListener('drop', handleGlobalDrop);

    return () => {
      window.removeEventListener('dragover', handleGlobalDragOver);
      window.removeEventListener('drop', handleGlobalDrop);
    };
  }, []);

  // 1. 初始化 IPC 监听与配置读取
  useEffect(() => {
    // 请求系统通知权限
    ipc.requestNotificationPermission().catch(() => {});

    // 立即初始化底层的 Tauri IPC 原生事件监听（聊天消息、文件传输进度、设备发现等）
    ipc.init().catch((err) => {
      console.warn('初始化 IPC 事件监听失败:', err);
    });

    // 首次进入时，优先从 SQLite .db 加载配置（若 .db 被重置/删除则恢复干净默认状态）
    storageService.loadSettingsFromDb().then((loadedConfig) => {
      setConfig(loadedConfig);
      if (loadedConfig.updateUrl && loadedConfig.updateUrl.trim()) {
        // 启动时若配置了 Master IP，静默检查内网更新
        ipc.checkForUpdates(loadedConfig.updateUrl).catch(() => {});
      }
    });

    // 在 Tauri 环境下读取真实的系统文档路径与计算机名，同步与修正配置
    ipc.getSysInfo().then((sysInfo) => {
      if (sysInfo) {
        if (sysInfo.document_dir) {
          setDefaultDocumentsCache(sysInfo.document_dir);
        }
        const current = ipc.getLocalConfig();
        const newConfig = { ...current };
        let changed = false;

        // 若当前名称为通用默认名称（Windows PC / My Computer / LAN Drop Device 或空），自动更新修正为真实的 sysInfo.hostname
        if (!newConfig.name || newConfig.name === 'Windows PC' || newConfig.name === 'My Computer' || newConfig.name === 'LAN Drop Device') {
          if (sysInfo.hostname) {
            newConfig.name = sysInfo.hostname;
            changed = true;
          }
        }

        // 若路径包含占位符或为硬编码 C 盘默认，自动更新修正为真实 [用户文档]\LAN Drop\Files
        if (
          !newConfig.downloadDir ||
          newConfig.downloadDir.includes('[用户文档]') ||
          newConfig.downloadDir === 'C:\\LAN Drop\\Files' ||
          newConfig.downloadDir === '~/Downloads/FlashDrop'
        ) {
          if (sysInfo.document_dir) {
            newConfig.downloadDir = sysInfo.document_dir;
            changed = true;
          }
        }

        if (sysInfo.local_ip && sysInfo.local_ip !== '127.0.0.1' && sysInfo.local_ip !== '0.0.0.0' && !newConfig.ip) {
          newConfig.ip = sysInfo.local_ip;
          changed = true;
        }

        if (changed) {
          ipc.updateLocalConfig(newConfig);
          setConfig(newConfig);
        }
      }
    });

    // 立即触发一次局域网发现扫描
    ipc.triggerDiscoveryScan();

    ipc.getDiscoveredPeers().then((list) => {
      setPeers(list);
    });

    storageService.getAllTransfers().then((list) => setTransfers(list));
    storageService.getAllChats().then(async (list) => {
      const deduped = deduplicateMessages(list);
      setAllChats(deduped);
      // 应用冷启动时，针对中断的传输任务精确校对本地已落盘的部分临时文件大小
      if (isTauri()) {
        for (const m of deduped) {
          if (m.fileAttachment && (m.fileAttachment.state === 'failed' || m.fileAttachment.state === 'transferring')) {
            try {
              const diskSize = await ipc.getPartialFileSize(m.fileAttachment.name);
              if (diskSize > 0 && diskSize < m.fileAttachment.size) {
                m.fileAttachment.state = 'failed';
                m.fileAttachment.transferredBytes = diskSize;
                m.fileAttachment.progress = Number(((diskSize / m.fileAttachment.size) * 100).toFixed(1));
                setAllChats((prev) => upsertMessage(prev, m));
                storageService.saveChatMessage(m).catch(() => {});
              }
            } catch {
              // ignore
            }
          }
        }
      }
    });

    // 监听本地配置实时更新
    const unsubConfig = ipc.on<LocalDeviceConfig>('config://updated', (updatedConfig) => {
      setConfig({ ...updatedConfig });
    });

    // 监听设备更新
    const unsubPeers = ipc.on<PeerDevice[]>('peers://updated', (updatedPeers) => {
      setPeers(updatedPeers);
      setSelectedPeer((curr) => {
        if (!curr) return null;
        const found = updatedPeers.find((p) => p.id === curr.id || (curr.ip && p.ip === curr.ip));
        return found || curr;
      });
    });

    // 辅助函数：定位到特定联系人并高亮消息
    const focusPeerAndMessage = (msg: ChatMessage) => {
      if (!msg || msg.senderId === config.id) return;
      setPeers((currPeers) => {
        const found = currPeers.find(
          (p) =>
            p.id === msg.senderId ||
            (msg.fileAttachment?.senderIp && p.ip === msg.fileAttachment.senderIp) ||
            ((msg as any).senderIp && p.ip === (msg as any).senderIp)
        );
        if (found) {
          setSelectedPeer(found);
        } else {
          const newPeer: PeerDevice = {
            id: msg.senderId,
            name: msg.senderName || '局域网设备',
            ip: (msg as any).senderIp || msg.fileAttachment?.senderIp || '',
            port: (msg as any).senderPort || msg.fileAttachment?.senderPort || 57088,
            os: 'windows',
            avatarUrl: (msg as any).senderAvatarUrl || '',
            status: 'online',
            lastSeen: Date.now(),
            pingMs: 1.0,
            version: '2.0.0',
          };
          setSelectedPeer(newPeer);
        }
        return currPeers;
      });
      triggerMessageHighlight(msg.id);
    };

    // 辅助函数：当程序在托盘或后台运行时收到新消息，处理未读定位与网页端通知（严格去重）
    const notifyIncomingMessage = async (msg: ChatMessage) => {
      if (!msg || msg.senderId === config.id || !isDisplayableMessage(msg)) return;

      const now = Date.now();
      const isFresh = !msg.timestamp || Math.abs(now - msg.timestamp) < 45000;
      if (!isFresh) return;

      if (notifiedMsgIdsRef.current.has(msg.id)) return;
      notifiedMsgIdsRef.current.add(msg.id);
      if (notifiedMsgIdsRef.current.size > 500) {
        notifiedMsgIdsRef.current.clear();
      }

      const isActive = await ipc.isWindowActive();
      // 当程序在任务栏托盘中（窗口隐藏/最小化/未激活）时记录最新消息
      if (!isActive) {
        latestBackgroundMsgRef.current = msg;

        // 在非 Tauri（纯浏览器演示）环境下，触发标准 Web Notification 弹窗
        if (!isTauri() && typeof window !== 'undefined' && 'Notification' in window) {
          const senderName = msg.senderName || '局域网设备';
          let bodyText = '';
          if (msg.fileAttachment) {
            if (msg.fileAttachment.isMedia || msg.msgType === 'image') {
              bodyText = `[图片] ${msg.fileAttachment.name}`;
            } else if (msg.msgType === 'video') {
              bodyText = `[视频] ${msg.fileAttachment.name}`;
            } else if (msg.msgType === 'audio') {
              bodyText = `[语音/音频] ${msg.fileAttachment.name}`;
            } else {
              bodyText = `[文件] ${msg.fileAttachment.name}`;
            }
          } else {
            bodyText = msg.content || '发来一条新消息';
          }

          const handleNotificationClick = async () => {
            await ipc.showFromTray();
            focusPeerAndMessage(msg);
            latestBackgroundMsgRef.current = null;
            try {
              window.focus();
            } catch {
              // ignore
            }
          };

          if (Notification.permission === 'granted') {
            const notif = new Notification(senderName, {
              body: bodyText,
              icon: msg.senderAvatarUrl || '/icon.png',
              tag: `msg-${msg.senderId}`,
            });
            notif.onclick = () => {
              handleNotificationClick();
              notif.close();
            };
          }
        }
      }
    };

    // 监听聊天消息更新与接收
    const unsubChat = ipc.on<ChatMessage>('chat://updated', (msg) => {
      setAllChats((prev) => upsertMessage(prev, msg));
      notifyIncomingMessage(msg);

      // 仅当为对端发来的普通消息（非系统信令），且用户当前处于与该联系人的聊天窗口中，才尝试自动标记已读
      if (msg && msg.msgType !== 'system' && isDisplayableMessage(msg) && msg.senderId && msg.senderId !== config.id) {
        const curr = selectedPeerRef.current;
        if (!curr) {
          const newPeer: PeerDevice = {
            id: msg.senderId,
            name: msg.senderName || '局域网设备',
            ip: (msg as any).senderIp || msg.fileAttachment?.senderIp || '',
            port: (msg as any).senderPort || msg.fileAttachment?.senderPort || 57088,
            os: 'windows',
            avatarUrl: (msg as any).senderAvatarUrl || '',
            status: 'online',
            lastSeen: Date.now(),
            pingMs: 1.0,
            version: '2.0.0',
          };
          setSelectedPeer(newPeer);
          handleMarkPeerRead(msg.senderId);
        } else if (curr.id === msg.senderId || ((msg as any).senderIp && curr.ip === (msg as any).senderIp)) {
          handleMarkPeerRead(msg.senderId);
        }
      }
    });

    // 监听接收端流式接收实时进度 (收件方)
    const unsubIncomingProgress = ipc.on<{
      taskId: string;
      fileName: string;
      transferred: number;
      total: number;
      progress: number;
      speed: number;
    }>('transfer://incoming_progress', (data) => {
      setAllChats((prev) => {
        const idx = prev.findIndex(
          (m) => m.fileAttachment?.id === data.taskId || m.fileAttachment?.name === data.fileName
        );
        if (idx >= 0) {
          const next = [...prev];
          const target = { ...next[idx] };
          if (target.fileAttachment) {
            target.fileAttachment = {
              ...target.fileAttachment,
              state: 'transferring',
              progress: data.progress,
              speed: data.speed,
            };
            next[idx] = target;
            return next;
          }
        }
        return prev;
      });
    });

    // 监听发送端流式推流实时进度 (发件方)
    const unsubProgress = ipc.on<{
      taskId: string;
      transferred: number;
      total: number;
      speed: number;
    }>('transfer://progress', (data) => {
      setAllChats((prev) => {
        const idx = prev.findIndex((m) => m.fileAttachment?.id === data.taskId);
        if (idx >= 0) {
          const next = [...prev];
          const target = { ...next[idx] };
          if (target.fileAttachment) {
            const progress = Math.min(99.9, Number(((data.transferred / data.total) * 100).toFixed(1)));
            target.fileAttachment = {
              ...target.fileAttachment,
              state: progress >= 99 ? 'received' : 'transferring',
              progress: progress >= 99 ? 100 : progress,
              speed: data.speed,
            };
            next[idx] = target;
            return next;
          }
        }
        return prev;
      });
    });

    // 监听传输失败
    const unsubError = ipc.on<{ taskId: string; error: string }>('transfer://error', (data) => {
      setAllChats((prev) => {
        const idx = prev.findIndex((m) => m.fileAttachment?.id === data.taskId);
        if (idx >= 0) {
          const next = [...prev];
          const target = { ...next[idx] };
          if (target.fileAttachment) {
            target.fileAttachment = {
              ...target.fileAttachment,
              state: 'failed',
            };
            next[idx] = target;
            return next;
          }
        }
        return prev;
      });
    });

    // 监听文件接收完成
    const unsubRecv = ipc.on<ChatMessage>('file://received', () => {
      storageService.getAllTransfers().then((list) => setTransfers(list));
      try {
        confetti({
          particleCount: 60,
          spread: 60,
          origin: { y: 0.8 },
          colors: ['#07c160', '#10b981', '#06b6d4'],
        });
      } catch {
        // ignore
      }
    });

    // 监听窗口从托盘唤醒恢复事件，自动定位至最新发信联系人与消息
    const unsubRestore = ipc.on('app://restored_from_tray', () => {
      setIsHiddenToTray(false);
      if (latestBackgroundMsgRef.current) {
        focusPeerAndMessage(latestBackgroundMsgRef.current);
        latestBackgroundMsgRef.current = null;
      }
    });

    // 监听底层与 Web 模拟托盘状态变化
    const unsubTrayState = ipc.on<boolean>('app://window_hidden_to_tray', (hidden) => {
      setIsHiddenToTray(!!hidden);
    });

    // 全局组合热键监听（如 Ctrl+Alt+Shift+S / Cmd+Alt+Shift+S / Alt+Space）呼出/隐藏前台窗口
    const handleGlobalHotkeyPress = async (e: KeyboardEvent) => {
      const activeHotkey = configRef.current?.globalHotkey || ipc.getLocalConfig().globalHotkey || 'Ctrl+Alt+Shift+S';
      if (!activeHotkey) return;

      const parts = activeHotkey.split('+').map((s) => s.trim().toLowerCase());
      const needsCtrlOrCmd = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta') || parts.includes('control');
      const needsAlt = parts.includes('alt') || parts.includes('option');
      const needsShift = parts.includes('shift');

      const targetKey = parts.find(
        (p) => !['ctrl', 'cmd', 'meta', 'control', 'alt', 'option', 'shift'].includes(p)
      );

      if (!targetKey) return;

      let keyMatch = false;
      const pressedKey = e.key.toLowerCase();
      const pressedCode = e.code ? e.code.toLowerCase() : '';

      if (targetKey === 'space' && (pressedCode === 'space' || e.key === ' ' || pressedKey === 'space')) {
        keyMatch = true;
      } else if (targetKey === 's' && (pressedKey === 's' || pressedCode === 'keys')) {
        keyMatch = true;
      } else if (
        pressedKey === targetKey ||
        pressedCode === `key${targetKey}` ||
        pressedCode === `digit${targetKey}` ||
        pressedCode === targetKey
      ) {
        keyMatch = true;
      }

      const hasCtrlOrCmd = e.ctrlKey || e.metaKey;
      const ctrlMatch = needsCtrlOrCmd ? hasCtrlOrCmd : !hasCtrlOrCmd;
      const altMatch = needsAlt ? e.altKey : !e.altKey;
      const shiftMatch = needsShift ? e.shiftKey : !e.shiftKey;

      if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
        e.preventDefault();
        e.stopPropagation();
        // 在程序已经是激活（前台显示）状态下，快捷键的功能变为：隐藏程序，只保留任务栏的小图标（托盘）
        await ipc.toggleWindow();
      }
    };

    const handleWindowFocus = () => {
      if (latestBackgroundMsgRef.current) {
        focusPeerAndMessage(latestBackgroundMsgRef.current);
        latestBackgroundMsgRef.current = null;
      }
    };
    window.addEventListener('keydown', handleGlobalHotkeyPress, true);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      window.removeEventListener('keydown', handleGlobalHotkeyPress, true);
      window.removeEventListener('focus', handleWindowFocus);
      unsubRestore();
      unsubTrayState();
      unsubConfig();
      unsubPeers();
      unsubChat();
      unsubIncomingProgress();
      unsubProgress();
      unsubError();
      unsubRecv();
    };
  }, [config.id]);

  // 2. 当前选中联系人的即时聊天消息（由 allChats 与 selectedPeer 纯函数派生，杜绝状态撕裂与延迟）
  const chatMessages = useMemo(() => {
    if (!selectedPeer) return [];
    return allChats.filter((m) => {
      // 判断消息是否是由当前本地设备发出的
      const isSentByMe =
        m.senderId === config.id ||
        (config.ip && config.ip !== '' && m.senderIp === config.ip);

      if (isSentByMe) {
        // 我发给对端的消息：匹配对端的 ID 或对端的 IP
        if (m.peerId === selectedPeer.id) return true;
        if (selectedPeer.ip && (m.peerIp === selectedPeer.ip || m.peerId === selectedPeer.ip)) return true;
        return false;
      } else {
        // 对端发给我的消息：匹配发送者的 ID 或发送者的 IP
        if (m.senderId === selectedPeer.id) return true;
        if (
          selectedPeer.ip &&
          (m.senderIp === selectedPeer.ip || m.fileAttachment?.senderIp === selectedPeer.ip)
        ) {
          return true;
        }
        return false;
      }
    });
  }, [selectedPeer, allChats, config.id, config.ip]);

  // 3. 计算左侧会话列表及最近一条消息（智能合并与去重，严禁出现本机“发送方”自聊联系人）
  const conversations: PeerConversation[] = useMemo(() => {
    const peerMap = new Map<string, PeerDevice>();
    const ipToIdMap = new Map<string, string>();

    // 先将当前在线/已发现的 peers 放入 map（排除本机）
    peers.forEach((peer) => {
      if (peer.id === config.id || (config.ip && peer.ip === config.ip)) return;
      peerMap.set(peer.id, { ...peer });
      if (peer.ip) {
        ipToIdMap.set(peer.ip, peer.id);
      }
    });

    // 将历史聊天中的联系人合并进去（严禁把“自己/发送方”作为对端联系人）
    allChats.forEach((msg) => {
      const isSentByMe =
        msg.senderId === config.id ||
        (config.ip && config.ip !== '' && msg.senderIp === config.ip);

      // 如果是我发出的，对端是 msg.peerId；如果是对方发来的，对端是 msg.senderId
      const targetId = isSentByMe ? msg.peerId : msg.senderId;
      const targetIp = isSentByMe ? msg.peerIp : (msg.senderIp || msg.fileAttachment?.senderIp);

      if (!targetId || targetId === config.id) return;
      if (targetIp && config.ip && targetIp === config.ip) return;
      if (isSentByMe && msg.senderName === config.name && targetId === msg.senderId) return;

      // 检查是否已有对应 IP 或 ID 的联系人
      if (peerMap.has(targetId)) return;
      if (targetIp && ipToIdMap.has(targetIp)) return;

      // 检查是否有名称完全相同或 IP 相同的设备
      const existing = Array.from(peerMap.values()).find(
        (p) => (targetIp && p.ip === targetIp) || (p.name === msg.senderName && msg.senderName !== '未知用户' && msg.senderName !== config.name)
      );
      if (existing) return;

      // 生成稳定的预设头像
      let hash = 0;
      for (let i = 0; i < (targetId + (msg.senderName || '')).length; i++) {
        hash = (hash << 5) - hash + (targetId + (msg.senderName || '')).charCodeAt(i);
        hash |= 0;
      }
      const avatarIndex = Math.abs(hash) % PRESET_AVATARS.length;
      const stableAvatar = (!isSentByMe && msg.senderAvatarUrl) ? msg.senderAvatarUrl : PRESET_AVATARS[avatarIndex].url;

      peerMap.set(targetId, {
        id: targetId,
        name: isSentByMe ? ((msg as any).peerName || '局域网设备') : (msg.senderName || '未知用户'),
        avatarUrl: stableAvatar,
        ip: targetIp || '',
        port: isSentByMe ? ((msg as any).peerPort || 57088) : (msg.senderPort || msg.fileAttachment?.senderPort || 57088),
        os: 'windows',
        status: 'offline',
        lastSeen: msg.timestamp,
        pingMs: 0,
        version: '2.0.0',
      });
    });

    return Array.from(peerMap.values())
      .filter((peer) => {
        // 排除本机自己
        if (peer.id === config.id || (config.ip && peer.ip === config.ip)) return false;
        // 判定设备当前是否在线
        const isOnline = peer.status === 'online';

        // 检查我与该联系人是否产生过任何聊天消息或文件传输
        const hasHistory = allChats.some((c) => {
          const isFromMe = c.senderId === config.id || (config.ip && c.senderIp === config.ip);
          const counterpartId = isFromMe ? c.peerId : c.senderId;
          const counterpartIp = isFromMe ? c.peerIp : (c.senderIp || c.fileAttachment?.senderIp);
          if (counterpartId === peer.id) return true;
          if (peer.ip && counterpartIp === peer.ip) return true;
          return false;
        });

        // 核心规则：
        // 1. 当我与某个人发送过消息或文件后 (hasHistory === true)，这个人离线时，依旧会保留在我的联系人列表中，显示离线状态。
        // 2. 如果我与他没有产生过消息 (hasHistory === false)，他离线后，我的联系人中将不再显示他，直到他下次上线。
        if (hasHistory) {
          return true; // 有历史记录：离线也依旧保留
        }
        return isOnline; // 无历史记录：只有在线时才展示，离线则自动隐藏直至下次上线
      })
      .map((peer) => {
        const peerMsgs = allChats.filter((c) => {
          const isFromMe = c.senderId === config.id || (config.ip && c.senderIp === config.ip);
          const counterpartId = isFromMe ? c.peerId : c.senderId;
          const counterpartIp = isFromMe ? c.peerIp : (c.senderIp || c.fileAttachment?.senderIp);
          if (counterpartId === peer.id) return true;
          if (peer.ip && counterpartIp === peer.ip) return true;
          return false;
        });
        const lastMessage =
          peerMsgs.length > 0 ? peerMsgs[peerMsgs.length - 1] : undefined;
        return {
          peer,
          lastMessage,
          unreadCount: 0,
          updatedAt: lastMessage ? lastMessage.timestamp : peer.lastSeen || 0,
        };
      })
      .sort((a, b) => {
        // 联系人列表按照上次聊天时间进行排序，越接近现在，越靠上
        const timeA = a.lastMessage?.timestamp || 0;
        const timeB = b.lastMessage?.timestamp || 0;
        if (timeB !== timeA) {
          return timeB - timeA;
        }
        // 在线状态优先（在线在前，离线在后）
        if (a.peer.status !== b.peer.status) {
          return a.peer.status === 'online' ? -1 : 1;
        }
        // 未联系过的联系人使用名称/ID固定排序，避免心跳包刷新 lastSeen 导致列表上下跳动
        const nameCompare = a.peer.name.localeCompare(b.peer.name, 'zh-CN');
        if (nameCompare !== 0) return nameCompare;
        return a.peer.id.localeCompare(b.peer.id);
      });
  }, [peers, allChats, config.id, config.ip, config.name]);

  // 动作处理
  const handleSendMessage = async (targetPeer: PeerDevice, text: string) => {
    const msg = await conversationManager.sendTextMessage(targetPeer, text);
    setAllChats((prev) => upsertMessage(prev, msg));
  };

  const handleSendFile = async (
    targetPeer: PeerDevice,
    file: File | { name: string; size: number; type: string; blob: Blob }
  ) => {
    const msg = await conversationManager.sendFileMessage(targetPeer, file);
    setAllChats((prev) => upsertMessage(prev, msg));
  };

  const handleAcceptFile = async (msg: ChatMessage) => {
    const senderPeer = peers.find(
      (p) =>
        p.id === msg.senderId ||
        (msg.fileAttachment?.senderIp && p.ip === msg.fileAttachment.senderIp) ||
        (msg.senderIp && p.ip === msg.senderIp) ||
        (msg.peerIp && p.ip === msg.peerIp)
    );
    const res = await conversationManager.acceptFileTransfer(msg, senderPeer);
    if (!res.success && res.error) {
      setFolderToast(`无法接收：${res.error}`);
      setTimeout(() => setFolderToast(null), 4000);
    }
  };

  const handleResumeFile = async (msg: ChatMessage) => {
    const senderPeer = peers.find(
      (p) =>
        p.id === msg.senderId ||
        (msg.fileAttachment?.senderIp && p.ip === msg.fileAttachment.senderIp) ||
        (msg.senderIp && p.ip === msg.senderIp) ||
        (msg.peerIp && p.ip === msg.peerIp)
    );
    const res = await conversationManager.resumeFileTransfer(msg, senderPeer);
    if (!res.success && res.error) {
      setFolderToast(`无法断点续传：${res.error}`);
      setTimeout(() => setFolderToast(null), 4000);
    }
  };

  const handleOpenInFolder = async (savedPath?: string, fileName?: string, isMedia?: boolean) => {
    let targetPath = savedPath;
    if (!targetPath) {
      if (isMedia) {
        try {
          const mediaDir = await ipc.getMediaDir();
          targetPath = fileName ? `${mediaDir}/${fileName}` : mediaDir;
        } catch {
          targetPath = fileName;
        }
      } else {
        const defaultDir = config.downloadDir;
        targetPath = fileName ? `${defaultDir}/${fileName}` : defaultDir;
      }
    }

    if (isTauri() && targetPath) {
      ipc.openInFolder(targetPath).catch((err) => {
        console.warn('调用打开文件夹指令失败:', err);
      });
    }
    setFolderToast(`已在文件管理器中定位: ${targetPath}`);
    setTimeout(() => setFolderToast(null), 3000);
  };

  const handlePreviewMedia = (
    type: 'image' | 'video' | 'audio',
    url: string,
    fileName: string,
    filePath?: string
  ) => {
    setLightbox({
      isOpen: true,
      type,
      url,
      fileName,
      filePath,
    });
  };

  const handleSaveConfig = (newConfig: LocalDeviceConfig) => {
    setConfig(newConfig);
    ipc.updateLocalConfig(newConfig);
    setFolderToast('设置已保存');
    setTimeout(() => setFolderToast(null), 2000);
  };

  const handleSelectPeer = (peer: PeerDevice, targetMessageId?: string) => {
    setSelectedPeer(peer);
    if (targetMessageId) {
      setHighlightMessageId(targetMessageId);
      setTimeout(() => setHighlightMessageId(null), 3000);
    }
  };

  const handleOpenSettingsModal = (defaultTab: 'user' | 'system' = 'user') => {
    setSettingsDefaultTab(defaultTab);
    setIsSettingsOpen(true);
  };

  return (
    <div className="flex h-screen w-screen bg-[#1e1e1e] text-[#cccccc] font-sans antialiased overflow-hidden select-none">
      {/* 顶部全局提示 Toast */}
      {folderToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#252526] border border-[#0078d4] text-white text-xs rounded-xl shadow-2xl flex items-center space-x-2 animate-in fade-in slide-in-from-top duration-200">
          <span className="w-2 h-2 rounded-full bg-[#0078d4] animate-ping" />
          <span>{folderToast}</span>
        </div>
      )}

      {/* 左侧设备与联系人会话列表 */}
      <Sidebar
        conversations={conversations}
        allChats={allChats}
        activePeerId={selectedPeer?.id || null}
        currentUserId={config.id}
        onSelectPeer={handleSelectPeer}
        onOpenSettings={handleOpenSettingsModal}
        localName={config.name}
        localIp={config.ip}
        localAvatarUrl={config.avatarUrl}
      />

      {/* 右侧聊天与文件传输主面板 */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-[#1e1e1e]">
        <ChatPanel
          peer={selectedPeer}
          messages={chatMessages}
          currentUserId={config.id}
          currentUserIp={config.ip}
          currentUserAvatarUrl={config.avatarUrl}
          highlightMessageId={highlightMessageId}
          onSendMessage={handleSendMessage}
          onSendFile={handleSendFile}
          onAcceptFile={handleAcceptFile}
          onResumeFile={handleResumeFile}
          onOpenInFolder={handleOpenInFolder}
          onPreviewMedia={handlePreviewMedia}
          onMarkPeerRead={handleMarkPeerRead}
        />
      </div>

      {/* 设置模态框 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSave={handleSaveConfig}
        defaultTab={settingsDefaultTab}
      />

      {/* 媒体全屏大图/视频预览模态窗 */}
      <MediaLightbox
        isOpen={lightbox.isOpen}
        type={lightbox.type}
        url={lightbox.url}
        fileName={lightbox.fileName}
        filePath={lightbox.filePath}
        onOpenInFolder={handleOpenInFolder}
        onClose={() => setLightbox((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* 托盘后台挂起状态蒙层（Web预览与无缝唤出指示） */}
      {isHiddenToTray && (
        <div className="fixed inset-0 z-[100] bg-[#121212]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-200">
          <div className="bg-[#252526] border border-[#3c3c3c] rounded-2xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center">
            <div className="relative mb-3.5">
              <div className="w-14 h-14 rounded-2xl bg-[#1e1e1e] border border-[#0078d4]/40 flex items-center justify-center text-[#0078d4] shadow-inner">
                <Activity className="w-7 h-7 text-[#0078d4]" />
              </div>
              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#252526]" />
            </div>
            <h3 className="text-base font-semibold text-[#f0f0f0]">LAN Drop 已隐藏至系统托盘</h3>
            <p className="text-xs text-[#858585] mt-1.5 leading-relaxed">
              程序正在后台静默运行中，随时可接收局域网文件与通知。
            </p>
            <div className="mt-4 px-3 py-1.5 bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg text-xs text-[#9cdcfe] font-mono flex items-center space-x-1.5">
              <span>按</span>
              <kbd className="px-1.5 py-0.5 bg-[#2d2d2d] rounded text-[11px] text-white font-bold">{configRef.current?.globalHotkey || 'Ctrl+Alt+Shift+S'}</kbd>
              <span>可重新呼出主窗口</span>
            </div>
            <div className="mt-5 flex items-center space-x-3 w-full">
              <button
                type="button"
                onClick={() => ipc.showFromTray()}
                className="flex-1 py-2 px-3 bg-[#0078d4] hover:bg-[#006cbd] active:scale-98 text-white text-xs font-medium rounded-lg transition-all shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <Eye className="w-3.5 h-3.5 mr-1" />
                <span>恢复显示主界面</span>
              </button>
            </div>
          </div>

          {/* 任务栏系统托盘角标 */}
          <div
            onClick={() => ipc.showFromTray()}
            title="点击唤醒 LAN Drop 主界面"
            className="fixed bottom-4 right-4 bg-[#252526] hover:bg-[#2d2d2d] border border-[#0078d4] rounded-xl px-3.5 py-2 shadow-2xl flex items-center space-x-2.5 cursor-pointer transition-all hover:scale-105 active:scale-95 group"
          >
            <div className="w-6 h-6 rounded-lg bg-[#0078d4]/20 flex items-center justify-center text-[#0078d4]">
              <Activity className="w-3.5 h-3.5" />
            </div>
            <div className="text-left">
              <div className="text-xs font-medium text-[#e0e0e0] flex items-center space-x-1.5">
                <span>LAN Drop</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div className="text-[10px] text-[#858585] group-hover:text-[#9cdcfe]">
                已常驻后台 · 点击恢复
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
