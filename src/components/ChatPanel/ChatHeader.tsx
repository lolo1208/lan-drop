/**
 * 聊天主面板顶部联系人信息栏组件
 * 展示当前选中对端设备的昵称、IP 地址、网络往返延迟 (ping) 以及在线状态指示，提供批量管理与清空记录快捷入口
 */

import React, { useState } from "react";
import { ListFilter, Trash2 } from "lucide-react";
import { PeerDevice } from "../../types";
import { resolveAvatarUrl } from "../../utils/avatars";
import { ConfirmModal } from "../ConfirmModal";

interface ChatHeaderProps {
  peer: PeerDevice;
  messageCount?: number;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  onClearChat?: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  peer,
  messageCount = 0,
  isSelectionMode = false,
  onToggleSelectionMode,
  onClearChat,
}) => {
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  return (
    <>
      <div className="h-16 px-5 border-b border-[#2b2b2b] bg-[#181818] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          {/* 头像与在线状态指示点 */}
          <div className="relative">
            <div
              className={`w-9 h-9 rounded-xl overflow-hidden bg-[#252526] border border-[#3c3c3c] flex items-center justify-center text-xs font-bold text-[#cccccc] shrink-0 transition-all ${
                peer.status === "offline"
                  ? "opacity-70 grayscale-[30%]"
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
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#181818] ${
                peer.status === "online"
                  ? "bg-[#10b981] ring-1 ring-[#10b981]/40"
                  : "bg-[#6e7681]"
              }`}
              title={peer.status === "online" ? "当前在线" : "当前离线"}
            />
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-[#e0e0e0] leading-tight">
                {peer.name}
              </span>
              <span
                className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  peer.status === "online"
                    ? "text-[#10b981] bg-[#10b981]/10 border border-[#10b981]/25"
                    : "text-[#858585] bg-[#252526] border border-[#3c3c3c]"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full mr-1 ${
                    peer.status === "online" ? "bg-[#10b981]" : "bg-[#858585]"
                  }`}
                />
                {peer.status === "online" ? "在线" : "离线"}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#858585] leading-tight mt-0.5">
              {peer.ip || "局域网设备"}
            </div>
          </div>
        </div>

        {/* 右侧操作区：离线提示、多选批量管理及清空聊天记录 */}
        <div className="flex items-center space-x-2">
          {peer.status === "offline" && (
            <div className="text-[11px] text-[#858585] bg-[#252526] px-2.5 py-1 rounded-lg border border-[#333333] hidden md:flex items-center space-x-1.5 mr-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6e7681]" />
              <span>对方已离线</span>
            </div>
          )}

          {/* 切换多选模式按钮 */}
          {messageCount > 0 && onToggleSelectionMode && (
            <button
              onClick={onToggleSelectionMode}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors ${
                isSelectionMode
                  ? "bg-[#0078d4] text-white"
                  : "bg-[#252526] hover:bg-[#2d2d2d] text-[#a0a0a0] hover:text-[#e0e0e0] border border-[#3c3c3c]"
              }`}
              title={isSelectionMode ? "退出多选模式" : "批量选择删除"}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {isSelectionMode ? "完成" : "批量选择"}
              </span>
            </button>
          )}

          {/* 清空聊天记录按钮 */}
          {messageCount > 0 && onClearChat && (
            <button
              onClick={() => setIsClearModalOpen(true)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#252526] hover:bg-red-950/40 text-[#858585] hover:text-red-400 border border-[#3c3c3c] hover:border-red-800/60 transition-colors flex items-center space-x-1.5"
              title="清空与该联系人的全部聊天记录及关联文件"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">清空记录</span>
            </button>
          )}
        </div>
      </div>

      {/* 清空全部聊天记录确认模态窗 */}
      <ConfirmModal
        isOpen={isClearModalOpen}
        title="清空聊天记录并删除关联文件"
        description={`确定清空与 [${peer.name}] 的全部聊天记录吗？\n\n此操作将同时彻底物理删除此会话中已传输或缓存的所有文件、图片、音视频等，操作后无法恢复。`}
        confirmText="确认清空并删除"
        cancelText="取消"
        isDanger={true}
        onConfirm={() => {
          onClearChat?.();
        }}
        onClose={() => setIsClearModalOpen(false)}
      />
    </>
  );
};

