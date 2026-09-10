/**
 * 侧边栏会话与局域网联系人列表组件
 * 渲染在线与离线设备卡片、未读消息计数徽标、最新消息摘要及高亮选中效果
 */

import React from "react";
import {
  FileCode,
  FileText,
  FileVideo,
  HardDrive,
  Music,
  Plus,
} from "lucide-react";
import { ChatMessage, PeerConversation, PeerDevice } from "../../types";
import { formatBytes, formatRelativeTime } from "../../utils/format";
import { resolveAvatarUrl } from "../../utils/avatars";

interface SidebarListProps {
  filteredConversations: PeerConversation[];
  matchedFileMessages: ChatMessage[];
  search: string;
  activePeerId: string | null;
  currentUserId?: string;
  allChats: ChatMessage[];
  onSelectPeer: (peer: PeerDevice, targetMessageId?: string) => void;
  onShowAddIpModal: () => void;
  onSelectFileMatch: (msg: ChatMessage) => void;
}

export const SidebarList: React.FC<SidebarListProps> = ({
  filteredConversations,
  matchedFileMessages,
  search,
  activePeerId,
  currentUserId,
  allChats,
  onSelectPeer,
  onShowAddIpModal,
  onSelectFileMatch,
}) => {
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (["mp4", "mkv", "mov", "webm"].includes(ext || "")) {
      return <FileVideo className="w-4 h-4 text-[#38bdf8]" />;
    }
    if (["mp3", "wav", "ogg", "flac"].includes(ext || "")) {
      return <Music className="w-4 h-4 text-[#89d185]" />;
    }
    if (["iso", "img", "tar", "gz", "zip", "rar"].includes(ext || "")) {
      return <HardDrive className="w-4 h-4 text-[#cca700]" />;
    }
    if (["rs", "ts", "js", "py", "json", "c"].includes(ext || "")) {
      return <FileCode className="w-4 h-4 text-[#4ec9b0]" />;
    }
    return <FileText className="w-4 h-4 text-[#9cdcfe]" />;
  };

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-[#2b2b2b]/60 custom-scrollbar">
      {search.trim() && matchedFileMessages.length > 0 && (
        <div className="p-2 bg-[#1f1f1f]">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase text-[#38bdf8] flex items-center justify-between">
            <span>匹配的文件消息 ({matchedFileMessages.length})</span>
            <span className="text-[9px] text-[#858585] lowercase">
              点击直达定位
            </span>
          </div>
          <div className="space-y-1 mt-1">
            {matchedFileMessages.map((msg, index) => {
              const file = msg.fileAttachment!;
              return (
                <div
                  key={`${msg.id}-${index}`}
                  onClick={() => onSelectFileMatch(msg)}
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

      {filteredConversations.length === 0 &&
      matchedFileMessages.length === 0 ? (
        <div className="p-8 text-center text-xs text-[#858585]">
          <p className="font-medium text-[#cccccc]">
            {search ? "未找到匹配的文件或联系人" : "正在自动探测局域网设备..."}
          </p>
          {!search && (
            <div className="mt-3 flex flex-col items-center">
              <p className="text-[11px] text-[#6e7681] leading-relaxed max-w-[200px]">
                基于 HTTP 扫描当前 /24
                网段。如两台电脑处于不同网段或防火墙拦截，可直接手动直连：
              </p>
              <button
                onClick={onShowAddIpModal}
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

          const unreadCount = allChats.filter(
            (m) =>
              (m.peerId === peer.id || m.senderId === peer.id) &&
              m.senderId !== currentUserId &&
              !m.isRead,
          ).length;

          return (
            <div
              key={peer.id}
              onClick={() => onSelectPeer(peer)}
              onContextMenu={(e) => e.preventDefault()}
              className={`group relative px-3.5 py-3 flex items-start space-x-3 cursor-pointer transition-colors border-l-[3px] ${
                isSelected
                  ? "bg-[#0078d4]/15 border-l-[#0078d4] text-white"
                  : "hover:bg-[#2a2d2e] border-transparent text-[#cccccc]"
              }`}
            >
              <div className="relative shrink-0 mt-0.5">
                <div
                  className={`w-10 h-10 rounded-xl overflow-hidden bg-[#252526] border border-[#3c3c3c] flex items-center justify-center text-[#cccccc] font-bold text-xs shadow-xs transition-all ${
                    peer.status === "offline"
                      ? "opacity-65 grayscale-[35%]"
                      : "opacity-100"
                  }`}
                >
                  {peer.avatarUrl ? (
                    <img
                      src={resolveAvatarUrl(peer.avatarUrl)}
                      alt={peer.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{peer.name.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>

                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#181818] shadow-xs transition-colors ${
                    peer.status === "online"
                      ? "bg-[#10b981] ring-1 ring-[#10b981]/40"
                      : "bg-[#6e7681]"
                  }`}
                  title={peer.status === "online" ? "当前在线" : "当前离线"}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 min-w-0 pr-1">
                    <span
                      className={`text-xs font-semibold truncate ${
                        isSelected
                          ? "text-white"
                          : peer.status === "offline"
                            ? "text-[#a0a0a0]"
                            : "text-[#e0e0e0]"
                      }`}
                    >
                      {peer.name}
                    </span>
                    {peer.status === "offline" && (
                      <span className="text-[9px] text-[#858585] bg-[#252526] px-1 py-0.2 rounded border border-[#3c3c3c] shrink-0 font-normal select-none">
                        离线
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#858585] font-mono shrink-0 ml-1">
                    {lastMessage
                      ? formatRelativeTime(lastMessage.timestamp)
                      : ""}
                  </span>
                </div>

                <div className="mt-1 text-[11px] flex items-center justify-between">
                  <span className="text-[#858585] truncate block group-hover:text-[#a0a0a0] flex-1 mr-1">
                    {lastMessage
                      ? lastMessage.msgType === "file"
                        ? `[文件] ${lastMessage.content}`
                        : lastMessage.msgType === "image"
                          ? `[图片] ${lastMessage.content}`
                          : lastMessage.msgType === "video"
                            ? `[视频] ${lastMessage.content}`
                            : lastMessage.msgType === "audio"
                              ? `[音频] ${lastMessage.content}`
                              : lastMessage.content
                      : peer.ip}
                  </span>

                  {unreadCount > 0 && (
                    <span className="shrink-0 px-1.5 py-0.2 text-[10px] font-bold bg-[#0078d4] text-white rounded-full min-w-[18px] text-center shadow-xs animate-pulse">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
