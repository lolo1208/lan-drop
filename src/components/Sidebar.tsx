/**
 * LAN Drop (内网投送) 设备与联系人侧边栏 - VS Code 2026 深色 (Dark Modern) 主题
 * 包含：
 * 1. 顶部当前用户信息与设置按钮
 * 2. 搜索框：支持根据文件名称、消息内容以及联系人名称搜索，点击直接定位并高亮该消息
 * 3. 用户会话列表：严格按照上次聊天时间从新到旧排序
 */

import React, { useMemo, useState } from 'react';
import {
  FileCode,
  FileText,
  FileVideo,
  HardDrive,
  Music,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { ChatMessage, PeerConversation, PeerDevice } from '../types';
import { formatBytes, formatRelativeTime } from '../utils/format';

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
            <div className="text-[11px] font-mono text-[#858585] truncate">
              {localIp}
            </div>
          </div>
        </div>

        {/* 顶部右侧：齿轮按钮 (点击打开系统设置) */}
        <div className="flex items-center shrink-0">
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
          <div className="p-8 text-center text-xs text-[#6e7681]">
            未找到匹配的文件或用户
          </div>
        ) : (
          filteredConversations.map(({ peer, lastMessage }) => {
            const isSelected = activePeerId === peer.id;

            return (
              <div
                key={peer.id}
                onClick={() => onSelectPeer(peer)}
                className={`group relative px-3.5 py-3 flex items-start space-x-3 cursor-pointer transition-colors border-l-[3px] ${
                  isSelected
                    ? 'bg-[#0078d4]/15 border-l-[#0078d4] text-white'
                    : 'hover:bg-[#2a2d2e] border-transparent text-[#cccccc]'
                }`}
              >
                {/* 用户头像 */}
                <div className="relative shrink-0 mt-0.5">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#252526] border border-[#3c3c3c] flex items-center justify-center text-[#cccccc] font-bold text-xs shadow-xs">
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
                </div>

                {/* 用户信息：名称 + 最近消息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-[#e0e0e0]'}`}>
                      {peer.name}
                    </span>
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
    </div>
  );
};
