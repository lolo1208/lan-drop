/**
 * LAN Drop (内网投送) - 轻量级局域网极速文件传输与即时投送工具
 * 左侧用户列表，右侧聊天面板；发送任意文件与文字；手动接收；离线拦截；音视频与图片原生直接预览与播放
 */

import React, { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { MediaLightbox } from './components/MediaLightbox';
import { SettingsModal } from './components/SettingsModal';
import { ChatPanel } from './components/ChatPanel';
import { Sidebar } from './components/Sidebar';
import { conversationManager } from './services/conversationManager';
import { ipc } from './services/ipc';
import { storageService } from './services/storage';
import {
  ChatMessage,
  LocalDeviceConfig,
  PeerConversation,
  PeerDevice,
  TransferTask,
} from './types';

// 辅助函数：根据 id 插入或更新消息，防止 React 渲染时重复 key
function upsertMessage(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const updated = [...list];
    updated[idx] = msg;
    return updated;
  }
  return [...list, msg];
}

// 辅助函数：对消息数组按 id 去重并按时间戳排序
function deduplicateMessages(list: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (const m of list) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      result.push(m);
    }
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

export default function App() {
  const [config, setConfig] = useState<LocalDeviceConfig>(ipc.getLocalConfig());
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<PeerDevice | null>(null);

  // 聊天与历史消息
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [allChats, setAllChats] = useState<ChatMessage[]>([]);
  const [transfers, setTransfers] = useState<TransferTask[]>([]);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  // 弹窗状态
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'user' | 'system'>('user');

  // 媒体大屏灯箱预览状态
  const [lightbox, setLightbox] = useState<{
    isOpen: boolean;
    type: 'image' | 'video' | null;
    url: string | null;
    fileName: string;
  }>({
    isOpen: false,
    type: null,
    url: null,
    fileName: '',
  });

  // 目录提示 Toast
  const [folderToast, setFolderToast] = useState<string | null>(null);

  // 1. 初始化局域网节点与持久化记录
  useEffect(() => {
    // 首次启动同步真实的系统信息（修复主机名与文件保存路径）
    ipc.getSysInfo().then((sysInfo) => {
      if (sysInfo) {
        let changed = false;
        const currentConfig = ipc.getLocalConfig();
        const newConfig = { ...currentConfig };

        // 判断名称是否为默认未正确设置的状态
        if (
          !newConfig.name ||
          newConfig.name.startsWith('Personal Computer') ||
          newConfig.name.startsWith('Windows') ||
          newConfig.name.startsWith('Mac') ||
          newConfig.name.startsWith('iPhone')
        ) {
          newConfig.name = sysInfo.hostname;
          changed = true;
        }

        // 判断下载路径是否仍为旧的假路径
        if (!newConfig.downloadDir || newConfig.downloadDir.includes('[用户文档]') || newConfig.downloadDir === '~/Downloads/FlashDrop') {
          newConfig.downloadDir = sysInfo.document_dir;
          changed = true;
        }

        if (changed) {
          ipc.updateLocalConfig(newConfig);
          setConfig(newConfig);
        } else {
          // 哪怕没改，也向后端下发一次下载路径以作保险
          ipc.updateLocalConfig(newConfig);
        }
      } else {
        // web 环境下也确保向外发一次（在 ipc.ts 内部自动过滤 isTauri）
        ipc.updateLocalConfig(ipc.getLocalConfig());
      }
    });

    ipc.getDiscoveredPeers().then((list) => {
      setPeers(list);
      // 默认不自动选中用户，保持 selectedPeer 为 null
    });

    storageService.getAllTransfers().then((list) => setTransfers(list));
    storageService.getAllChats().then((list) => setAllChats(deduplicateMessages(list)));

    // 监听设备更新
    const unsubPeers = ipc.on<PeerDevice[]>('peers://updated', (updatedPeers) => {
      setPeers(updatedPeers);
      setSelectedPeer((curr) => {
        if (!curr) return null;
        const found = updatedPeers.find((p) => p.id === curr.id);
        return found || curr;
      });
    });

    // 监听聊天消息更新
    const unsubChat = ipc.on<ChatMessage>('chat://updated', (msg) => {
      setAllChats((prev) => upsertMessage(prev, msg));

      // 同步刷新当前打开的聊天
      setSelectedPeer((curr) => {
        if (curr && (msg.peerId === curr.id || msg.senderId === curr.id)) {
          setChatMessages((prev) => upsertMessage(prev, msg));
        }
        return curr;
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

    // 启动时检查局域网更新（若配置了 updateUrl）
    if (config.updateUrl && config.updateUrl.trim()) {
      const updateEndpoint = config.updateUrl.trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      fetch(updateEndpoint, { signal: controller.signal })
        .then((res) => {
          clearTimeout(timer);
          if (res.ok) {
            return res.json().catch(() => null);
          }
          return null;
        })
        .then((data) => {
          if (data && data.version && data.version !== '2.0.0') {
            setFolderToast(`发现局域网新版本 v${data.version}，已就绪自动更新`);
            setTimeout(() => setFolderToast(null), 5000);
          }
        })
        .catch(() => {
          clearTimeout(timer);
        });
    }

    return () => {
      unsubPeers();
      unsubChat();
      unsubRecv();
    };
  }, []);

  // 2. 当切换会话对端时，加载历史消息
  useEffect(() => {
    if (selectedPeer) {
      storageService.getChatMessages(selectedPeer.id).then((msgs) => {
        setChatMessages(deduplicateMessages(msgs));
      });
    }
  }, [selectedPeer]);

  // 3. 计算左侧会话列表及最近一条消息
  const conversations: PeerConversation[] = useMemo(() => {
    const peerMap = new Map<string, PeerDevice>();

    // 1. 先将有聊天历史的设备加入字典（以防设备已完全脱网且未被 IPC 捕获）
    allChats.forEach((msg) => {
      const targetId = msg.senderId === config.id ? msg.peerId : msg.senderId;
      if (!peerMap.has(targetId)) {
        peerMap.set(targetId, {
          id: targetId,
          name: msg.senderId === config.id ? '未知用户' : msg.senderName, // 简单还原
          ip: '',
          port: 0,
          os: 'windows', // 默认
          status: 'offline', // 默认离线
          lastSeen: msg.timestamp,
          pingMs: 0,
          version: '1.0',
        });
      }
    });

    // 2. 将当前活跃或 IPC 维护的 peers 覆盖合并进去
    peers.forEach((peer) => {
      if (peerMap.has(peer.id)) {
        peerMap.set(peer.id, { ...peerMap.get(peer.id)!, ...peer });
      } else {
        peerMap.set(peer.id, peer);
      }
    });

    return Array.from(peerMap.values())
      .filter((peer) => {
        // 核心规则：仅显示在线设备，或已离线但与本机产生过历史消息的设备
        const isOnline = peer.status === 'online';
        const hasHistory = allChats.some(
          (c) => c.peerId === peer.id || c.senderId === peer.id
        );
        return isOnline || hasHistory;
      })
      .map((peer) => {
        const peerMsgs = allChats.filter(
          (c) => c.peerId === peer.id || c.senderId === peer.id
        );
        const lastMessage =
          peerMsgs.length > 0 ? peerMsgs[peerMsgs.length - 1] : undefined;
        return {
          peer,
          lastMessage,
          unreadCount: 0,
          updatedAt: lastMessage ? lastMessage.timestamp : 0,
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
  }, [peers, allChats, config.id]);

  // 动作处理
  const handleSendMessage = async (targetPeer: PeerDevice, text: string) => {
    const msg = await conversationManager.sendTextMessage(targetPeer, text);
    setChatMessages((prev) => upsertMessage(prev, msg));
    setAllChats((prev) => upsertMessage(prev, msg));
  };

  const handleSendFile = async (
    targetPeer: PeerDevice,
    file: File | { name: string; size: number; type: string; blob: Blob }
  ) => {
    const msg = await conversationManager.sendFileMessage(targetPeer, file);
    setChatMessages((prev) => upsertMessage(prev, msg));
    setAllChats((prev) => upsertMessage(prev, msg));
  };

  const handleAcceptFile = async (msg: ChatMessage) => {
    // 校验发送方在线状态
    const senderPeer = peers.find((p) => p.id === msg.senderId);
    const res = await conversationManager.acceptFileTransfer(msg, senderPeer);
    if (!res.success && res.error) {
      setFolderToast(`无法接收：${res.error}`);
      setTimeout(() => setFolderToast(null), 4000);
    }
  };

  const handleOpenInFolder = (savedPath?: string, fileName?: string) => {
    const path = conversationManager.openInFolder(savedPath, fileName);
    setFolderToast(`已在文件管理器中定位到: ${path}`);
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
    } else {
      setHighlightMessageId(null);
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#1e1e1e] flex flex-col font-sans text-[#cccccc] selection:bg-[#264f78] selection:text-white">
      {/* 默认直角充满显示，窗口圆角由外层 Tauri 容器处理 */}
      <div className="flex-1 flex w-full h-full overflow-hidden bg-[#1e1e1e]">
        {/* 左侧：联系人/设备列表，支持文件名消息检索定位 */}
        <Sidebar
          conversations={conversations}
          allChats={allChats}
          activePeerId={selectedPeer?.id || null}
          onSelectPeer={handleSelectPeer}
          onOpenSettings={(tab = 'user') => {
            setSettingsTab(tab);
            setShowSettingsModal(true);
          }}
          localName={config.name}
          localIp={config.ip}
          localAvatarUrl={config.avatarUrl}
        />

        {/* 右侧：聊天与文件投送会话区 */}
        <ChatPanel
          peer={selectedPeer}
          messages={chatMessages}
          highlightMessageId={highlightMessageId}
          onSendMessage={handleSendMessage}
          onSendFile={handleSendFile}
          onAcceptFile={handleAcceptFile}
          onOpenInFolder={handleOpenInFolder}
          onPreviewMedia={handlePreviewMedia}
        />
      </div>

      {/* 全局打开目录/轻提示 Toast (VS Code 状态卡片质感) */}
      {folderToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#252526] border border-[#0078d4] text-[#d4d4d4] text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <span className="w-2 h-2 rounded-full bg-[#0078d4]"></span>
          <span>{folderToast}</span>
        </div>
      )}

      {/* 图片与视频大屏灯箱预览 */}
      <MediaLightbox
        isOpen={lightbox.isOpen}
        type={lightbox.type}
        url={lightbox.url}
        fileName={lightbox.fileName}
        onClose={() => setLightbox({ isOpen: false, type: null, url: null, fileName: '' })}
      />

      {/* 本地设置弹窗 */}
      <SettingsModal
        isOpen={showSettingsModal}
        defaultTab={settingsTab}
        onClose={() => setShowSettingsModal(false)}
        config={config}
        onSave={handleSaveConfig}
      />
    </div>
  );
}
