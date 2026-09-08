/**
 * LAN Drop (内网投送) 设备与联系人侧边栏 - VS Code 2026 深色 (Dark Modern) 主题
 * 包含：
 * 1. 顶部当前用户信息与设置按钮
 * 2. 搜索框：支持根据文件名称、消息内容以及联系人名称搜索，点击直接定位并高亮该消息
 * 3. 用户会话列表：严格按照上次聊天时间从新到旧排序
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileCode,
  FileText,
  FileVideo,
  Globe,
  HardDrive,
  Music,
  Plus,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { ChatMessage, PeerConversation, PeerDevice } from '../types';
import { formatBytes, formatRelativeTime } from '../utils/format';
import { ipc } from '../services/ipc';

interface SidebarProps {
  conversations: PeerConversation[];
  allChats: ChatMessage[];
  activePeerId: string | null;
  onSelectPeer: (peer: PeerDevice, targetMessageId?: string) => void;
  onOpenSettings: (defaultTab?: 'user' | 'system') => void;
  localName: string;
  localIp: string;
  localAvatarUrl?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  allChats,
  activePeerId,
  onSelectPeer,
  onOpenSettings,
  localName,
  localIp,
  localAvatarUrl,
}) => {
  const [search, setSearch] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [showAddIpModal, setShowAddIpModal] = useState(false);
  const [targetIpInput, setTargetIpInput] = useState('');
  const [targetPortInput, setTargetPortInput] = useState('57088');
  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    peer: PeerDevice;
  } | null>(null);

  // 全局点击自动关闭联系人右键操作菜单
  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleRefreshScan = () => {
    setIsScanning(true);
    ipc.triggerDiscoveryScan();
    setTimeout(() => {
      setIsScanning(false);
    }, 1200);
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetIpInput.trim()) return;
    setIsProbing(true);
    setProbeError('');
    try {
      const port = parseInt(targetPortInput.trim(), 10) || 57088;
      const peer = await ipc.probePeerIp(targetIpInput.trim(), port);
      setShowAddIpModal(false);
      setTargetIpInput('');
      onSelectPeer(peer);
    } catch (err: any) {
      setProbeError(err?.message || err?.toString() || '连接失败，请检查 IP 与应用是否已启动');
    } finally {
      setIsProbing(false);
    }
  };

  // 1. 过滤联系人列表并严格按上次聊天时间降序排序
  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations
      .filter((c) => {
        if (!q) return true;
        // 匹配联系人名称、IP或最后一条消息
        return (
          c.peer.name.toLowerCase().includes(q) ||
          c.peer.ip.includes(q) ||
          (c.lastMessage?.content || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const timeA = a.lastMessage?.timestamp || 0;
        const timeB = b.lastMessage?.timestamp || 0;
        if (timeB !== timeA) {
          return timeB - timeA; // 聊天时间越近越靠前
        }
        return (b.peer.lastSeen || 0) - (a.peer.lastSeen || 0);
      });
  }, [conversations, search]);

  // 2. 根据文件名称检索所有历史聊天消息中的文件
  const matchedFileMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];

    return allChats
      .filter((msg) => {
        if (!msg.fileAttachment) return false;
        const fileName = msg.fileAttachment.name.toLowerCase();
        return fileName.includes(q);
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [allChats, search]);

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (['mp4', 'mkv', 'mov', 'webm'].includes(ext || '')) {
      return <FileVideo className="w-4 h-4 text-[#38bdf8]" />;
    }
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext || '')) {
      return <Music className="w-4 h-4 text-[#89d185]" />;
    }
    if (['iso', 'img', 'tar', 'gz', 'zip', 'rar'].includes(ext || '')) {
      return <HardDrive className="w-4 h-4 text-[#cca700]" />;
    }
    if (['rs', 'ts', 'js', 'py', 'json', 'c'].includes(ext || '')) {
      return <FileCode className="w-4 h-4 text-[#4ec9b0]" />;
    }
    return <FileText className="w-4 h-4 text-[#9cdcfe]" />;
  };

  const handleSelectFileMatch = (msg: ChatMessage) => {
    // 寻找该消息所属的对方设备
    const targetPeerId = msg.peerId;
    const conversation = conversations.find(
      (c) => c.peer.id === targetPeerId || c.peer.id === msg.senderId
    );

    if (conversation) {
      onSelectPeer(conversation.peer, msg.id);
    }
  };

  return (
    <div className="w-72 sm:w-80 flex flex-col h-full bg-[#181818] border-r border-[#2b2b2b] select-none shrink-0 text-[#cccccc]">
      {/* 顶部当前用户信息与设置按钮 (高度设为 h-16 与右侧完全对齐) */}
      <div className="h-16 px-3.5 border-b border-[#2b2b2b] bg-[#1f1f1f] flex items-center justify-between gap-3 shrink-0">
        {/* 用户头像与信息 (点击打开用户设置) */}
        <div
          className="flex items-center space-x-2.5 min-w-0 flex-1 cursor-pointer group"
          onClick={() => onOpenSettings('user')}
          title="点击打开用户设置"
        >
          <div className="relative shrink-0">
            <div className="w-9 h-9 rounded-xl overflow-hidden bg-[#252526] border border-[#3c3c3c] flex items-center justify-center text-white font-bold text-sm shadow-xs group-hover:border-[#555555] transition-all">
              {localAvatarUrl ? (
                <img
                  src={localAvatarUrl}
                  alt={localName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-[#cccccc]">{localName ? localName.slice(0, 1).toUpperCase() : 'U'}</span>
              )}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-[#e0e0e0] truncate group-hover:text-white transition-colors">
              {localName}
            </div>
            <div className="text-[11px] font-mono text-[#858585] truncate" title={localIp ? `局域网IP: ${localIp}` : '正在探测当前局域网 IP'}>
              {localIp || '局域网在线'}
            </div>
          </div>
        </div>

        {/* 顶部右侧：手动添加IP、刷新扫描与齿轮设置按钮 */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              setProbeError('');
              setShowAddIpModal(true);
            }}
            className="p-2 rounded-lg text-[#858585] hover:text-[#38bdf8] hover:bg-[#2a2d2e] transition-colors"
            title="手动输入对端 IP 连接"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefreshScan}
            className="p-2 rounded-lg text-[#858585] hover:text-[#38bdf8] hover:bg-[#2a2d2e] transition-colors"
            title="重新扫描当前 /24 网段设备"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-[#38bdf8]' : ''}`} />
          </button>
          <button
            onClick={() => onOpenSettings('system')}
            className="p-2 rounded-lg text-[#858585] hover:text-[#e0e0e0] hover:bg-[#2a2d2e] transition-colors"
            title="打开系统设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 搜索栏：支持按文件名或消息快速搜索 */}
      <div className="p-3 border-b border-[#2b2b2b] bg-[#181818]">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-[#858585] absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索文件名称或联系人..."
            className="w-full pl-8 pr-7 py-1.5 bg-[#252526] border border-[#3c3c3c] focus:border-[#0078d4] rounded-lg text-xs text-[#cccccc] placeholder-[#6e7681] focus:outline-none transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-2 text-[#858585] hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 列表区域：含文件名搜索结果和会话列表 */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#2b2b2b]/60 custom-scrollbar">
        {/* 若有按文件名检索到的消息，优先在顶部显示文件匹配列表 */}
        {search.trim() && matchedFileMessages.length > 0 && (
          <div className="p-2 bg-[#1f1f1f]">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase text-[#38bdf8] flex items-center justify-between">
              <span>匹配的文件消息 ({matchedFileMessages.length})</span>
              <span className="text-[9px] text-[#858585] lowercase">点击直达定位</span>
            </div>
            <div className="space-y-1 mt-1">
              {matchedFileMessages.map((msg, index) => {
                const file = msg.fileAttachment!;
                return (
                  <div
                    key={`${msg.id}-${index}`}
                    onClick={() => handleSelectFileMatch(msg)}
                    className="p-2 rounded-xl bg-[#252526] hover:bg-[#2a2d2e] border border-[#333333] cursor-pointer transition-colors flex items-center space-x-2.5 group"
                    title={`点击定位该文件消息: ${file.name}`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-[#1e1e1e] flex items-center justify-center shrink-0 border border-[#333333]">
                      {getFileIcon(file.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#e0e0e0] font-medium truncate group-hover:text-[#38bdf8] transition-colors">
                        {file.name}
                      </div>
                      <div className="text-[10px] text-[#858585] flex items-center space-x-2 mt-0.5">
                        <span>{formatBytes(file.size)}</span>
                        <span>•</span>
                        <span>{msg.senderName}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(msg.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 联系人会话列表 */}
        {filteredConversations.length === 0 && matchedFileMessages.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#858585]">
            <p className="font-medium text-[#cccccc]">
              {search ? '未找到匹配的文件或联系人' : '正在自动探测局域网设备...'}
            </p>
            {!search && (
              <div className="mt-3 flex flex-col items-center">
                <p className="text-[11px] text-[#6e7681] leading-relaxed max-w-[200px]">
                  基于 HTTP 扫描当前 /24 网段。如两台电脑处于不同网段或防火墙拦截，可直接手动直连：
                </p>
                <button
                  onClick={() => {
                    setProbeError('');
                    setShowAddIpModal(true);
                  }}
                  className="mt-3 px-3 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] text-white rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>手动输入 IP 连接</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          filteredConversations.map(({ peer, lastMessage }) => {
            const isSelected = activePeerId === peer.id;

            return (
              <div
                key={peer.id}
                onClick={() => onSelectPeer(peer)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    peer,
                  });
                }}
                className={`group relative px-3.5 py-3 flex items-start space-x-3 cursor-pointer transition-colors border-l-[3px] ${
                  isSelected
                    ? 'bg-[#0078d4]/15 border-l-[#0078d4] text-white'
                    : 'hover:bg-[#2a2d2e] border-transparent text-[#cccccc]'
                }`}
              >
                {/* 用户头像 + 在线/离线状态指示器 */}
                <div className="relative shrink-0 mt-0.5">
                  <div
                    className={`w-10 h-10 rounded-xl overflow-hidden bg-[#252526] border border-[#3c3c3c] flex items-center justify-center text-[#cccccc] font-bold text-xs shadow-xs transition-all ${
                      peer.status === 'offline' ? 'opacity-65 grayscale-[35%]' : 'opacity-100'
                    }`}
                  >
                    {peer.avatarUrl ? (
                      <img
                        src={peer.avatarUrl}
                        alt={peer.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{peer.name.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>

                  {/* 在线 / 离线状态圆点 */}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#181818] shadow-xs transition-colors ${
                      peer.status === 'online'
                        ? 'bg-[#10b981] ring-1 ring-[#10b981]/40'
                        : 'bg-[#6e7681]'
                    }`}
                    title={peer.status === 'online' ? '当前在线' : '当前离线'}
                  />
                </div>

                {/* 用户信息：名称 + 离线徽章 + 最近消息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 min-w-0 pr-1">
                      <span
                        className={`text-xs font-semibold truncate ${
                          isSelected
                            ? 'text-white'
                            : peer.status === 'offline'
                            ? 'text-[#a0a0a0]'
                            : 'text-[#e0e0e0]'
                        }`}
                      >
                        {peer.name}
                      </span>
                      {peer.status === 'offline' && (
                        <span className="text-[9px] text-[#858585] bg-[#252526] px-1 py-0.2 rounded border border-[#3c3c3c] shrink-0 font-normal select-none">
                          离线
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#858585] font-mono shrink-0 ml-1">
                      {lastMessage ? formatRelativeTime(lastMessage.timestamp) : ''}
                    </span>
                  </div>

                  <div className="mt-1 text-[11px]">
                    <span className="text-[#858585] truncate block group-hover:text-[#a0a0a0]">
                      {lastMessage
                        ? lastMessage.msgType === 'file'
                          ? `[文件] ${lastMessage.content}`
                          : lastMessage.msgType === 'image'
                          ? `[图片] ${lastMessage.content}`
                          : lastMessage.msgType === 'video'
                          ? `[视频] ${lastMessage.content}`
                          : lastMessage.msgType === 'audio'
                          ? `[音频] ${lastMessage.content}`
                          : lastMessage.content
                        : peer.ip}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 手动输入对端 IP 连接模态框 */}
      {showAddIpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#2b2b2b]">
              <div className="flex items-center space-x-2">
                <Globe className="w-4 h-4 text-[#38bdf8]" />
                <h3 className="text-sm font-semibold text-white">手动输入对端 IP 连接</h3>
              </div>
              <button
                onClick={() => setShowAddIpModal(false)}
                className="text-[#858585] hover:text-white p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleManualConnect} className="space-y-3">
              <div>
                <label className="block text-xs text-[#858585] mb-1">对端电脑 IP 地址</label>
                <input
                  type="text"
                  required
                  placeholder="例如: 192.168.1.108"
                  value={targetIpInput}
                  onChange={(e) => setTargetIpInput(e.target.value)}
                  className="w-full px-3 py-2 bg-[#252526] border border-[#3c3c3c] focus:border-[#0078d4] rounded-lg text-xs text-white placeholder-[#6e7681] focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs text-[#858585] mb-1">服务端口 (默认 57088)</label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    placeholder="57088"
                    value={targetPortInput}
                    onChange={(e) => setTargetPortInput(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 bg-[#252526] border border-[#3c3c3c] focus:border-[#0078d4] rounded-lg text-xs text-white placeholder-[#6e7681] focus:outline-none font-mono"
                  />
                  <div className="absolute right-1 top-1 bottom-1 flex flex-col justify-between w-6 py-0.5 border-l border-[#333333]">
                    <button
                      type="button"
                      onClick={() => {
                        const cur = parseInt(targetPortInput.trim(), 10) || 57088;
                        const next = Math.min(65535, cur + 1);
                        setTargetPortInput(String(next));
                      }}
                      className="flex-1 flex items-center justify-center rounded-tr hover:bg-[#333333] active:bg-[#3c3c3c] text-[#858585] hover:text-[#38bdf8] transition-colors"
                      title="端口号 +1"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <div className="h-[1px] bg-[#333333] mx-0.5" />
                    <button
                      type="button"
                      onClick={() => {
                        const cur = parseInt(targetPortInput.trim(), 10) || 57088;
                        const next = Math.max(1024, cur - 1);
                        setTargetPortInput(String(next));
                      }}
                      className="flex-1 flex items-center justify-center rounded-br hover:bg-[#333333] active:bg-[#3c3c3c] text-[#858585] hover:text-[#38bdf8] transition-colors"
                      title="端口号 -1"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {probeError && (
                <div className="p-2 bg-red-950/40 border border-red-800/60 rounded-lg text-[11px] text-red-300">
                  {probeError}
                </div>
              )}

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddIpModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[#cccccc] hover:bg-[#2a2d2e]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isProbing || !targetIpInput.trim()}
                  className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5"
                >
                  {isProbing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>正在探测...</span>
                    </>
                  ) : (
                    <span>立即连接</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 联系人右键操作菜单 (支持快捷复制IP、模拟在线/离线切换状态进行逻辑验收) */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-2xl py-1 text-xs text-[#cccccc] w-52 select-none"
          style={{
            top: Math.min(window.innerHeight - 130, contextMenu.y),
            left: Math.min(window.innerWidth - 220, contextMenu.x),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 border-b border-[#333333] text-[11px] text-[#858585] truncate font-medium">
            {contextMenu.peer.name}
          </div>
          <button
            type="button"
            onClick={() => {
              ipc.togglePeerStatus(contextMenu.peer.id);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-[#0078d4] hover:text-white flex items-center justify-between transition-colors cursor-pointer"
          >
            <span>模拟切换在线/离线</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                contextMenu.peer.status === 'online'
                  ? 'text-red-300 bg-red-950/60'
                  : 'text-emerald-300 bg-emerald-950/60'
              }`}
            >
              {contextMenu.peer.status === 'online' ? '设为离线' : '设为在线'}
            </span>
          </button>
          {contextMenu.peer.ip && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(contextMenu.peer.ip);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-[#0078d4] hover:text-white flex items-center justify-between transition-colors cursor-pointer"
            >
              <span>复制设备 IP</span>
              <span className="text-[10px] text-[#858585] font-mono group-hover:text-white">
                {contextMenu.peer.ip}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
