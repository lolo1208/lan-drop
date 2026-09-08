import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { ChatPanel } from './components/ChatPanel';
import { MediaLightbox } from './components/MediaLightbox';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { conversationManager } from './services/conversationManager';
import { ipc, isTauri } from './services/ipc';
import { storageService } from './services/storage';
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

  // 媒体大图/视频预览弹窗
  const [lightbox, setLightbox] = useState<{
    isOpen: boolean;
    type: 'image' | 'video';
    url: string;
    fileName: string;
  }>({
    isOpen: false,
    type: 'image',
    url: '',
    fileName: '',
  });

  // 1. 初始化 IPC 监听与配置读取
  useEffect(() => {
    // 立即初始化底层的 Tauri IPC 原生事件监听（聊天消息、文件传输进度、设备发现等）
    ipc.init().catch((err) => {
      console.warn('初始化 IPC 事件监听失败:', err);
    });

    // 首次进入时，优先从 SQLite .db 加载配置（若 .db 被重置/删除则恢复干净默认状态）
    storageService.loadSettingsFromDb().then((loadedConfig) => {
      setConfig(loadedConfig);
    });

    // 在 Tauri 环境下读取真实的系统文档路径与主机名与 IP
    ipc.getSysInfo().then((sysInfo) => {
      if (sysInfo) {
        const current = ipc.getLocalConfig();
        const newConfig = { ...current };
        let changed = false;
        if (!newConfig.name || newConfig.name.includes('(dev-')) {
          newConfig.name = sysInfo.hostname;
          changed = true;
        }
        if (
          !newConfig.downloadDir ||
          newConfig.downloadDir.includes('[用户文档]') ||
          newConfig.downloadDir === '~/Downloads/FlashDrop' ||
          newConfig.downloadDir.endsWith('LAN Drop')
        ) {
          newConfig.downloadDir = sysInfo.document_dir;
          changed = true;
        }
        if (sysInfo.local_ip && sysInfo.local_ip !== '127.0.0.1' && sysInfo.local_ip !== '0.0.0.0') {
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
    storageService.getAllChats().then((list) => setAllChats(deduplicateMessages(list)));

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

    // 监听聊天消息更新与接收
    const unsubChat = ipc.on<ChatMessage>('chat://updated', (msg) => {
      setAllChats((prev) => upsertMessage(prev, msg));

      // 若当前未选中任何联系人，且收到来自对端的消息，自动聚焦至该联系人
      setSelectedPeer((curr) => {
        if (!curr && msg.senderId !== config.id) {
          return {
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
        }
        return curr;
      });
    });

    const unsubChatRecv = ipc.on<ChatMessage>('chat://received', (msg) => {
      setAllChats((prev) => upsertMessage(prev, msg));

      setSelectedPeer((curr) => {
        if (!curr && msg.senderId !== config.id) {
          return {
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
        }
        return curr;
      });
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
            const progress = Math.min(99, Math.round((data.transferred / data.total) * 100));
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

    return () => {
      unsubConfig();
      unsubPeers();
      unsubChat();
      unsubChatRecv();
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
        return (b.peer.lastSeen || 0) - (a.peer.lastSeen || 0);
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
      (p) => p.id === msg.senderId || (msg.fileAttachment?.senderIp && p.ip === msg.fileAttachment.senderIp)
    );
    const res = await conversationManager.acceptFileTransfer(msg, senderPeer);
    if (!res.success && res.error) {
      setFolderToast(`无法接收：${res.error}`);
      setTimeout(() => setFolderToast(null), 4000);
    }
  };

  const handleOpenInFolder = (savedPath?: string, fileName?: string) => {
    const defaultDir = config.downloadDir;
    const targetPath = savedPath || `${defaultDir}/${fileName || ''}`;

    if (isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('open_in_folder', { path: targetPath }).catch((err) => {
          console.warn('调用打开文件夹指令失败:', err);
        });
      });
    }
    setFolderToast(`已在文件管理器中定位到: ${targetPath}`);
    setTimeout(() => setFolderToast(null), 3000);
  };

  const handlePreviewMedia = (type: 'image' | 'video', url: string, fileName: string) => {
    setLightbox({
      isOpen: true,
      type,
      url,
      fileName,
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
          onOpenInFolder={handleOpenInFolder}
          onPreviewMedia={handlePreviewMedia}
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
        onClose={() => setLightbox((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}

export default App;
