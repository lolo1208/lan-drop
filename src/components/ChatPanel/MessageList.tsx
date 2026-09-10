/**
 * 聊天主面板消息滚动列表组件
 * 渲染按时间排序的消息流气泡，并处理首次加载与新消息到达时的自动平滑滚动
 */

import { ChevronDown, Radio } from "lucide-react";
import React, { RefObject } from "react";
import { ChatMessage, PeerDevice } from "../../types";
import { DynamicTipsBanner } from "../DynamicTipsBanner";
import { MessageBubble } from "../MessageBubble/index";

interface MessageListProps {
  peer: PeerDevice;
  visibleMessages: ChatMessage[];
  currentUserId?: string;
  currentUserIp?: string;
  highlightMessageId?: string | null;
  showScrollBottomBtn: boolean;
  unreadNewCount: number;
  isSelectionMode?: boolean;
  selectedMessageIds?: Set<string>;
  onToggleSelect?: (msgId: string) => void;
  onEnterSelectMode?: (msgId: string) => void;
  onDeleteMessage?: (msg: ChatMessage) => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  scrollToBottom: (smooth: boolean) => void;
  onAcceptFile: (msg: ChatMessage) => void;
  onResumeFile?: (msg: ChatMessage) => void;
  onOpenInFolder: (
    savedPath?: string,
    fileName?: string,
    isMedia?: boolean,
  ) => void;
  onPreviewMedia: (
    type: "image" | "video" | "audio",
    url: string,
    fileName: string,
    filePath?: string,
  ) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  peer,
  visibleMessages,
  currentUserId,
  currentUserIp,
  highlightMessageId,
  showScrollBottomBtn,
  unreadNewCount,
  isSelectionMode = false,
  selectedMessageIds,
  onToggleSelect,
  onEnterSelectMode,
  onDeleteMessage,
  scrollContainerRef,
  messagesEndRef,
  handleScroll,
  scrollToBottom,
  onAcceptFile,
  onResumeFile,
  onOpenInFolder,
  onPreviewMedia,
}) => {
  return (
    <div className="flex-1 relative flex flex-col min-h-0 overflow-hidden bg-[#1e1e1e]">
      {showScrollBottomBtn && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 animate-in fade-in zoom-in-95 duration-200">
          <button
            onClick={() => scrollToBottom(true)}
            className={`px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-2 transition-all cursor-pointer border active:scale-95 ${unreadNewCount > 0
                ? "bg-[#0078d4] hover:bg-[#0284c7] active:bg-[#006cc1] text-white border-[#38bdf8]/50 ring-2 ring-[#0078d4]/30 animate-bounce"
                : "bg-[#252526]/90 hover:bg-[#2a2d2e] text-[#cccccc] hover:text-white border-[#3c3c3c] backdrop-blur-md"
              }`}
            title="点击跳转至最新消息"
          >
            <ChevronDown
              className={`w-4 h-4 ${unreadNewCount > 0 ? "text-white" : "text-[#38bdf8]"}`}
            />
            <span>
              {unreadNewCount > 0
                ? `收到 ${unreadNewCount} 条新消息`
                : "回到底部"}
            </span>
          </button>
        </div>
      )}

      <div
        ref={scrollContainerRef as any}
        onScroll={handleScroll}
        className="flex-1 p-4 sm:p-5 overflow-y-auto custom-scrollbar bg-[#1e1e1e]"
      >
        {visibleMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <Radio className="w-14 h-14 text-[#0078d4] mb-2" />
            <div className="mb-3 text-xs text-[#858585]">
              与 <span className="text-[#e0e0e0] font-medium">{peer.name}</span>{" "}
              暂无聊天记录
            </div>
            <DynamicTipsBanner />
          </div>
        ) : (
          visibleMessages.map((msg, index) => {
            const isMe =
              (currentUserId && msg.senderId === currentUserId) ||
              (currentUserIp &&
                currentUserIp !== "" &&
                msg.senderIp === currentUserIp);

            return (
              <MessageBubble
                key={`${msg.id}-${index}`}
                message={msg}
                isMe={!!isMe}
                peer={peer}
                isHighlighted={msg.id === highlightMessageId}
                isSelectionMode={isSelectionMode}
                isSelected={selectedMessageIds?.has(msg.id)}
                onToggleSelect={onToggleSelect}
                onEnterSelectMode={onEnterSelectMode}
                onDeleteMessage={onDeleteMessage}
                onAcceptFile={onAcceptFile}
                onResumeFile={onResumeFile}
                onOpenInFolder={onOpenInFolder}
                onPreviewMedia={onPreviewMedia}
              />
            );
          })
        )}
        <div ref={messagesEndRef as any} />
      </div>
    </div>
  );
};
