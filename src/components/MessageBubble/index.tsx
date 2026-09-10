/**
 * 单条聊天消息气泡主组件
 * 根据消息类型（纯文本、图片、视频、音频、普通文件传输）调度对应子卡片渲染，并展示已读/未读状态
 */

import React, { useState, useEffect } from "react";
import {
  Check,
  CheckCheck,
  Copy,
  Trash2,
  WifiOff,
} from "lucide-react";
import { ChatMessage, PeerDevice } from "../../types";
import { formatTime } from "../../utils/format";
import { useMediaResolver } from "./useMediaResolver";
import { MediaLostCard } from "./MediaLostCard";
import { ImageMediaCard } from "./ImageMediaCard";
import { VideoMediaCard } from "./VideoMediaCard";
import { AudioMediaCard } from "./AudioMediaCard";
import { FileTransferCard } from "./FileTransferCard";
import { ConfirmModal } from "../ConfirmModal";

export interface MessageBubbleProps {
  message: ChatMessage;
  isMe: boolean;
  peer: PeerDevice | undefined;
  isHighlighted?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (msgId: string) => void;
  onEnterSelectMode?: (msgId: string) => void;
  onDeleteMessage?: (msg: ChatMessage) => void;
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

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMe,
  peer,
  isHighlighted = false,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
  onEnterSelectMode,
  onDeleteMessage,
  onAcceptFile,
  onResumeFile,
  onOpenInFolder,
  onPreviewMedia,
}) => {
  const [offlineToast, setOfflineToast] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const file = message.fileAttachment;
  const isPeerOnline = peer?.status === "online";

  const isMedia =
    message.msgType === "image" ||
    message.msgType === "video" ||
    message.msgType === "audio" ||
    !!file?.isMedia;

  const { isLost, resolvedPath, currentMediaUrl, handleMediaLoadError } =
    useMediaResolver({
      file,
      isMedia,
    });

  // 当文件状态发生变化时（例如失败、完成、拒绝），重置本地动作过渡状态
  useEffect(() => {
    if (
      file?.state === "failed" ||
      file?.state === "received" ||
      file?.state === "rejected"
    ) {
      setIsActionPending(false);
    }
  }, [file?.state]);

  // 接收按钮点击校验
  const handleAcceptClick = () => {
    if (!isPeerOnline && !isMe) {
      setOfflineToast(
        `发送方 [${message.senderName}] 当前不在线，无法启动文件数据流传输！`,
      );
      setTimeout(() => setOfflineToast(null), 3500);
      return;
    }
    setIsActionPending(true);
    onAcceptFile(message);
  };

  // 继续接收（断点续传）按钮点击
  const handleResumeClick = () => {
    setIsActionPending(true);
    onResumeFile?.(message);
  };

  const handleCopyText = () => {
    if (message.content) {
      navigator.clipboard?.writeText(message.content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  if (
    message.msgType === "system" ||
    (!message.fileAttachment && (!message.content || !message.content.trim()))
  ) {
    return null;
  }

  const deleteDialogDesc = file
    ? `确定删除此条文件消息吗？\n\n该操作将同时将关联文件（${file.name}）从磁盘或缓存中永久彻底删除，不可恢复。`
    : "确定删除此条聊天记录吗？删除后将无法恢复。";

  return (
    <>
      <div
        id={`msg-${message.id}`}
        onClick={() => {
          if (isSelectionMode) {
            onToggleSelect?.(message.id);
          }
        }}
        className={`group/bubble relative flex items-start space-x-2.5 mb-4 transition-all duration-300 rounded-2xl ${
          isMe ? "flex-row-reverse space-x-reverse" : "flex-row"
        } ${
          isHighlighted
            ? "p-2 bg-[#094771]/35 ring-2 ring-[#0078d4] shadow-lg shadow-[#0078d4]/20"
            : "p-0 ring-0 bg-transparent shadow-none"
        } ${isSelectionMode ? "cursor-pointer hover:bg-[#252526]/50 p-1.5" : ""}`}
      >
        {/* 多选模式自定义现代复选框 */}
        {isSelectionMode && (
          <div
            className="pt-1.5 shrink-0 select-none cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.(message.id);
            }}
          >
            <div
              className={`w-5 h-5 rounded-lg flex items-center justify-center transition-all duration-200 border ${
                isSelected
                  ? "bg-[#0078d4] border-[#0078d4] text-white shadow-sm shadow-[#0078d4]/30 scale-105"
                  : "bg-[#202020] border-[#3c3c3c] hover:border-[#555555] text-transparent"
              }`}
            >
              <Check className={`w-3.5 h-3.5 stroke-[2.8] transition-transform duration-150 ${isSelected ? "scale-100" : "scale-50 opacity-0"}`} />
            </div>
          </div>
        )}

        <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} max-w-full`}>
          {/* 消息时间与发送人、已读/未读状态 */}
          <div className="flex items-center space-x-1.5 text-[11px] text-[#858585] mb-1 px-1">
            <span>{isMe ? "我" : message.senderName}</span>
            <span>•</span>
            <span>{formatTime(message.timestamp)}</span>
            {isMe && (
              <>
                <span>•</span>
                {message.isRead ? (
                  <span
                    className="text-[10px] text-[#38bdf8] font-medium flex items-center gap-0.5"
                    title="对方已阅读"
                  >
                    <CheckCheck className="w-3 h-3 text-[#38bdf8]" />
                    已读
                  </span>
                ) : (
                  <span
                    className="text-[10px] text-[#858585] font-medium flex items-center gap-0.5"
                    title="对方未阅读"
                  >
                    <Check className="w-3 h-3 text-[#858585]" />
                    未读
                  </span>
                )}
              </>
            )}
          </div>

          {/* 离线警告 Toast */}
          {offlineToast && (
            <div className="mb-2 px-3 py-1.5 bg-red-950/80 border border-red-800 text-red-200 text-xs rounded-xl flex items-center space-x-1.5 shadow-lg animate-in fade-in slide-in-from-top duration-150">
              <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span>{offlineToast}</span>
            </div>
          )}

          {/* 消息主体容器及悬停操作工具栏 */}
          <div className="relative group max-w-[85vw] sm:max-w-[75vw] lg:max-w-[650px]">
            {/* 气泡悬浮操作菜单 (非多选模式下显示) */}
            {!isSelectionMode && (
              <div
                className={`absolute -top-3.5 z-30 opacity-0 group-hover/bubble:opacity-100 transition-all duration-200 flex items-center space-x-0.5 px-1 py-0.5 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-lg ${
                  isMe ? "right-2" : "left-2"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {/* 文本复制按钮 */}
                {message.content && message.msgType === "text" && (
                  <button
                    onClick={handleCopyText}
                    className="p-1 text-[#858585] hover:text-[#cccccc] hover:bg-[#333333] rounded transition-colors"
                    title={isCopied ? "已复制" : "复制文本"}
                  >
                    {isCopied ? (
                      <Check className="w-3.5 h-3.5 text-[#10b981]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                {/* 删除按钮 */}
                <button
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="p-1 text-[#858585] hover:text-red-400 hover:bg-red-950/40 rounded transition-colors"
                  title={file ? "删除消息及关联文件" : "删除消息"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* 1. 文本消息 */}
            {message.content && message.msgType === "text" && (
              <div
                className={`px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
                  isMe
                    ? "bg-[#0078d4] text-white rounded-tr-xs"
                    : "bg-[#252526] border border-[#3c3c3c] text-[#cccccc] rounded-tl-xs"
                }`}
              >
                {message.content}
              </div>
            )}

            {/* 媒体文件已丢失占位卡片 */}
            {isMedia && file && isLost && (
              <MediaLostCard
                file={file}
                resolvedPath={resolvedPath}
                onOpenInFolder={onOpenInFolder}
              />
            )}

            {/* 2. 图片消息预览（未丢失时渲染） */}
            {message.msgType === "image" && file && !isLost && (
              <ImageMediaCard
                file={file}
                currentMediaUrl={currentMediaUrl}
                resolvedPath={resolvedPath}
                onMediaLoadError={handleMediaLoadError}
                onPreviewMedia={onPreviewMedia}
                onOpenInFolder={onOpenInFolder}
              />
            )}

            {/* 3. 视频消息直接在消息中播放（未丢失时渲染） */}
            {message.msgType === "video" && file && !isLost && (
              <VideoMediaCard
                file={file}
                currentMediaUrl={currentMediaUrl}
                resolvedPath={resolvedPath}
                onMediaLoadError={handleMediaLoadError}
                onPreviewMedia={onPreviewMedia}
                onOpenInFolder={onOpenInFolder}
              />
            )}

            {/* 4. 音频消息直接在消息中播放（未丢失时渲染） */}
            {message.msgType === "audio" && file && !isLost && (
              <AudioMediaCard
                file={file}
                currentMediaUrl={currentMediaUrl}
                resolvedPath={resolvedPath}
                onMediaLoadError={handleMediaLoadError}
                onPreviewMedia={onPreviewMedia}
                onOpenInFolder={onOpenInFolder}
              />
            )}

            {/* 5. 经典文件传输卡片 */}
            {message.msgType === "file" && file && (
              <FileTransferCard
                message={message}
                file={file}
                isMe={isMe}
                isActionPending={isActionPending}
                onAcceptClick={handleAcceptClick}
                onResumeClick={handleResumeClick}
                onOpenInFolder={onOpenInFolder}
              />
            )}
          </div>
        </div>
      </div>

      {/* 单条删除确认模态框 */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        title={file ? "删除消息及关联文件" : "删除聊天记录"}
        description={deleteDialogDesc}
        confirmText="确认删除"
        cancelText="取消"
        isDanger={true}
        onConfirm={() => {
          onDeleteMessage?.(message);
        }}
        onClose={() => setIsDeleteModalOpen(false)}
      />
    </>
  );
};
