/**
 * LAN Drop 聊天消息气泡 - VS Code 2026 深色 (Dark Modern) 主题
 * 支持：纯文本、图片内嵌、视频内嵌播放、音频内嵌播放、文件传输卡片（手动点击接收、离线检测、打开所在目录）
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileCode,
  FileText,
  FileVideo,
  FolderOpen,
  HardDrive,
  Music,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { ChatMessage, PeerDevice } from '../types';
import { formatBytes, formatSpeed, formatTime } from '../utils/format';

interface MessageBubbleProps {
  message: ChatMessage;
  isMe: boolean;
  peer: PeerDevice | undefined;
  isHighlighted?: boolean;
  onAcceptFile: (msg: ChatMessage) => void;
  onOpenInFolder: (savedPath?: string, fileName?: string) => void;
  onPreviewMedia: (type: 'image' | 'video', url: string, fileName: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMe,
  peer,
  isHighlighted = false,
  onAcceptFile,
  onOpenInFolder,
  onPreviewMedia,
}) => {
  const [offlineToast, setOfflineToast] = useState<string | null>(null);

  const file = message.fileAttachment;
  const isPeerOnline = peer?.status === 'online';

  // 接收按钮点击校验
  const handleAcceptClick = () => {
    // 关键要求：当发送方不在线时，无法接收文件
    if (!isPeerOnline && !isMe) {
      setOfflineToast(`发送方 [${message.senderName}] 当前不在线，无法启动文件数据流传输！`);
      setTimeout(() => setOfflineToast(null), 3500);
      return;
    }
    onAcceptFile(message);
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (['mp4', 'mkv', 'mov', 'webm'].includes(ext || '')) {
      return <FileVideo className="w-8 h-8 text-[#38bdf8]" />;
    }
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext || '')) {
      return <Music className="w-8 h-8 text-[#89d185]" />;
    }
    if (['iso', 'img', 'tar', 'gz', 'zip', 'rar'].includes(ext || '')) {
      return <HardDrive className="w-8 h-8 text-[#cca700]" />;
    }
    if (['rs', 'ts', 'js', 'py', 'json', 'c'].includes(ext || '')) {
      return <FileCode className="w-8 h-8 text-[#4ec9b0]" />;
    }
    return <FileText className="w-8 h-8 text-[#9cdcfe]" />;
  };

  // 空文本消息或系统消息不渲染无意义空白气泡
  if (message.msgType === 'system' || (!message.fileAttachment && (!message.content || !message.content.trim()))) {
    return null;
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={`flex flex-col mb-4 transition-all duration-300 ${
        isMe ? 'items-end' : 'items-start'
      } ${
        isHighlighted
          ? 'p-2 rounded-2xl bg-[#094771]/35 ring-2 ring-[#0078d4] shadow-lg shadow-[#0078d4]/15'
          : ''
      }`}
    >
      {/* 消息时间与发送人 */}
      <div className="flex items-center space-x-1.5 text-[11px] text-[#858585] mb-1 px-1">
        <span>{isMe ? '我' : message.senderName}</span>
        <span>•</span>
        <span>{formatTime(message.timestamp)}</span>
      </div>

      <div className={`max-w-[85%] sm:max-w-[70%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
        {/* 1. 纯文本消息 */}
        {message.msgType === 'text' && (
          <div
            className={`px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed break-words shadow-xs ${
              isMe
                ? 'bg-[#0e639c] text-white rounded-tr-xs border border-[#1177bb]' // VS Code 经典蓝
                : 'bg-[#252526] text-[#cccccc] rounded-tl-xs border border-[#3c3c3c]'
            }`}
          >
            {message.content}
          </div>
        )}

        {/* 2. 图片消息直接内嵌预览 */}
        {message.msgType === 'image' && file && (
          <div className="overflow-hidden rounded-2xl border border-[#3c3c3c] bg-[#252526] p-1 shadow-md">
            <div
              className="relative cursor-pointer group max-w-xs sm:max-w-sm max-h-72 overflow-hidden rounded-xl bg-[#1e1e1e]"
              onClick={() => onPreviewMedia('image', file.blobUrl || '', file.name)}
            >
              <img
                src={file.blobUrl}
                alt={file.name}
                className="w-full h-auto object-cover max-h-64 rounded-xl transition-transform group-hover:scale-102"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs gap-1">
                <Eye className="w-4 h-4" />
                <span>点击全屏预览</span>
              </div>
            </div>

            {/* 图片底部简短文件描述 */}
            <div className="px-2 py-1.5 flex items-center justify-between text-[11px] text-[#858585]">
              <span className="truncate max-w-[160px] text-[#cccccc]">{file.name}</span>
              <span>{formatBytes(file.size)}</span>
            </div>
          </div>
        )}

        {/* 3. 视频消息直接在消息中播放 */}
        {message.msgType === 'video' && file && (
          <div className="rounded-2xl border border-[#3c3c3c] bg-[#252526] p-2 shadow-md max-w-sm sm:max-w-md">
            <div className="relative rounded-xl overflow-hidden bg-black">
              <video
                src={file.blobUrl}
                controls
                className="w-full max-h-60 rounded-xl"
              />
            </div>
            <div className="mt-1.5 px-1 flex items-center justify-between text-[11px] text-[#858585]">
              <span className="font-semibold text-[#e0e0e0] truncate max-w-[200px]">{file.name}</span>
              <span>{formatBytes(file.size)}</span>
            </div>
          </div>
        )}

        {/* 4. 音频消息直接在消息中播放 */}
        {message.msgType === 'audio' && file && (
          <div className="rounded-2xl border border-[#3c3c3c] bg-[#252526] p-3 shadow-md w-72 sm:w-80">
            <div className="flex items-center space-x-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-[#094771] text-[#38bdf8] flex items-center justify-center">
                <Music className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[#e0e0e0] truncate">{file.name}</div>
                <div className="text-[10px] text-[#858585]">{formatBytes(file.size)}</div>
              </div>
            </div>
            <audio src={file.blobUrl} controls className="w-full h-8" />
          </div>
        )}

        {/* 5. 经典文件传输卡片 (需手动点击接收，即时流式写入本地) */}
        {message.msgType === 'file' && file && (
          <div className="w-72 sm:w-80 bg-[#252526] border border-[#3c3c3c] rounded-2xl p-3.5 shadow-md">
            {/* 卡片头部：文件名、图标、大小 */}
            <div className="flex items-start justify-between gap-3 mb-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-[#e0e0e0] leading-snug line-clamp-2 break-all">
                  {file.name}
                </div>
                <div className="text-[11px] text-[#858585] font-mono mt-1">
                  {formatBytes(file.size)}
                </div>
              </div>
              <div className="shrink-0">{getFileIcon(file.name)}</div>
            </div>

            {/* 传输进度条 (传输中状态) */}
            {file.state === 'transferring' && (
              <div className="my-2 space-y-1">
                <div className="w-full bg-[#1e1e1e] rounded-full h-1.5 overflow-hidden border border-[#333333]">
                  <div
                    className="bg-[#0078d4] h-full transition-all duration-100"
                    style={{ width: `${file.progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#858585] font-mono">
                  <span>{file.progress}%</span>
                  <span className="text-[#38bdf8]">{formatSpeed(file.speed)}</span>
                </div>
              </div>
            )}

            {/* 底部交互按钮条 */}
            <div className="mt-3 pt-2.5 border-t border-[#333333] flex items-center justify-between">
              {/* 发送方视角：去除左侧“已推送给对方”，状态直接以右侧提示为准 */}
              {isMe ? (
                <div className="flex items-center justify-end w-full text-[11px] text-[#858585]">
                  <span className="text-[#6e7681]">
                    {file.state === 'received' ? '对方已接收' : file.state === 'transferring' ? '对方正在接收...' : '等待对方接收'}
                  </span>
                </div>
              ) : (
                /* 接收方视角 */
                <div className="flex items-center justify-between w-full">
                  {file.state === 'waiting_accept' && (
                    <>
                      <span className="text-[11px] text-[#cca700] flex items-center gap-1">
                        <Clock className="w-3 h-3 text-[#cca700]" />
                        待接收
                      </span>

                      <button
                        onClick={handleAcceptClick}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs ${
                          isPeerOnline
                            ? 'bg-[#0078d4] hover:bg-[#0284c7] text-white shadow-[#0078d4]/20'
                            : 'bg-[#2d2d2d] hover:bg-[#383838] text-[#858585]'
                        }`}
                        title={isPeerOnline ? '立即接收文件并保存至指定目录' : '发送方不在线'}
                      >
                        {isPeerOnline ? (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            <span>接收文件</span>
                          </>
                        ) : (
                          <>
                            <WifiOff className="w-3.5 h-3.5 text-red-400" />
                            <span>发送方离线</span>
                          </>
                        )}
                      </button>
                    </>
                  )}

                  {file.state === 'transferring' && (
                    <div className="flex items-center justify-between w-full text-xs text-[#858585]">
                      <span>正在写入磁盘...</span>
                      <span className="text-[#38bdf8] font-mono">{file.progress}%</span>
                    </div>
                  )}

                  {file.state === 'received' && (
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs text-[#89d185] flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        已保存在本地
                      </span>

                      {/* 打开文件所在目录 */}
                      <button
                        onClick={() => onOpenInFolder(file.savedPath, file.name)}
                        className="px-2.5 py-1 rounded-lg bg-[#2d2d2d] hover:bg-[#383838] text-[#38bdf8] hover:text-[#7dd3fc] text-xs flex items-center gap-1 transition-colors border border-[#3c3c3c]"
                        title="打开保存目录并定位文件"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-[#38bdf8]" />
                        <span>打开所在目录</span>
                      </button>
                    </div>
                  )}

                  {file.state === 'rejected' && (
                    <span className="text-xs text-[#6e7681] flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5 text-[#6e7681]" />
                      已拒绝
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 离线拦截警告 Toast */}
        {offlineToast && (
          <div className="mt-1.5 p-2 bg-[#3c1f1f] border border-[#6b2c2c] text-[#fca5a5] text-xs rounded-xl flex items-start gap-1.5 max-w-sm animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{offlineToast}</span>
          </div>
        )}
      </div>
    </div>
  );
};
