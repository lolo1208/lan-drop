/**
 * LAN Drop 聊天消息气泡 - VS Code 2026 深色 (Dark Modern) 主题
 * 支持：
 * 1. 纯文本
 * 2. 多媒体（图片、视频、音频）：
 *    - 发送与接收自动静默存入 [用户文档]/LAN Drop/Media 目录，以 MD5 命名去重
 *    - 播放与展示本地保存的文件
 *    - 本地文件已被移除或不存在时，气泡呈现“文件已丢失”
 *    - 移除所有“保存到本地”按钮，只保留“打开所在目录”功能，精准定位到 Media 文件夹并高亮选中该文件
 * 3. 普通文件传输卡片：
 *    - 确认接收与继续接收（断点续传），无多余按钮闪烁
 *    - 传输完成后提供“打开所在目录”
 */

import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileCode,
  FileText,
  FileVideo,
  FolderOpen,
  HardDrive,
  Maximize2,
  Music,
  Play,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { ChatMessage, FileAttachmentMeta, PeerDevice } from '../types';
import { formatBytes, formatSpeed, formatTime } from '../utils/format';
import { ipc } from '../services/ipc';

interface MessageBubbleProps {
  message: ChatMessage;
  isMe: boolean;
  peer: PeerDevice | undefined;
  isHighlighted?: boolean;
  onAcceptFile: (msg: ChatMessage) => void;
  onResumeFile?: (msg: ChatMessage) => void;
  onOpenInFolder: (savedPath?: string, fileName?: string, isMedia?: boolean) => void;
  onPreviewMedia: (type: 'image' | 'video' | 'audio', url: string, fileName: string, filePath?: string) => void;
}

// 媒体卡片操作栏组件：仅保留“打开所在目录”功能，彻底移除保存按钮
const MediaCardActions: React.FC<{
  file: FileAttachmentMeta;
  savedPath?: string;
  isLost?: boolean;
  onOpenInFolder?: (savedPath?: string, fileName?: string, isMedia?: boolean) => void;
}> = ({ file, savedPath, isLost, onOpenInFolder }) => {
  const handleOpenFolder = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenInFolder?.(savedPath || file.savedPath, file.name, true);
  };

  return (
    <div className="flex items-center space-x-1.5">
      <button
        onClick={handleOpenFolder}
        className="px-2 py-0.5 rounded bg-[#2a2d2e] hover:bg-[#383838] border border-[#3c3c3c] text-[#38bdf8] text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-xs"
        title="打开 Media 文件夹并定位选中该文件"
      >
        <FolderOpen className="w-3 h-3" />
        <span>打开所在目录</span>
      </button>
    </div>
  );
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMe,
  peer,
  isHighlighted = false,
  onAcceptFile,
  onResumeFile,
  onOpenInFolder,
  onPreviewMedia,
}) => {
  const [offlineToast, setOfflineToast] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const [isLost, setIsLost] = useState(false);
  const [resolvedPath, setResolvedPath] = useState<string | undefined>(message.fileAttachment?.savedPath);
  const [currentMediaUrl, setCurrentMediaUrl] = useState<string>(message.fileAttachment?.blobUrl || '');
  const [isFallbackLoading, setIsFallbackLoading] = useState(false);

  const file = message.fileAttachment;
  const isPeerOnline = peer?.status === 'online';

  const isMedia =
    message.msgType === 'image' ||
    message.msgType === 'video' ||
    message.msgType === 'audio' ||
    !!file?.isMedia;

  // 1. 同步初始 blobUrl
  useEffect(() => {
    if (file?.blobUrl) {
      setCurrentMediaUrl(file.blobUrl);
    }
  }, [file?.blobUrl]);

  // 2. 校验本地文件是否存在及解析媒体可播放 URL：绝不误判
  useEffect(() => {
    if (!isMedia || !file) return;

    let isMounted = true;

    const checkAndResolveMedia = async () => {
      try {
        let filePath = file.savedPath;
        const mediaDir = await ipc.getMediaDir();
        const dotIndex = file.name.lastIndexOf('.');
        const ext = dotIndex !== -1 ? file.name.substring(dotIndex + 1) : '';
        const mediaName = file.md5 ? (ext ? `${file.md5}.${ext}` : file.md5) : file.name;

        if (!filePath) {
          filePath = `${mediaDir}/${mediaName}`;
        }

        if (isMounted) {
          setResolvedPath(filePath);
        }

        // 若尚未接收或仍在传输中，暂不标记为丢失
        if (file.state === 'waiting_accept' || file.state === 'transferring') {
          return;
        }

        // 精准检查文件在磁盘上是否存在
        const exists = await ipc.checkFileExists(filePath);
        if (isMounted) {
          setIsLost(!exists);
        }

        // 如果文件真实存在，且当前没有有效 mediaUrl 或当前的 blobUrl 失效，获取本地资源协议或 Data URL
        if (exists && isMounted) {
          if (!currentMediaUrl || currentMediaUrl.trim() === '') {
            const url = await ipc.getMediaUrl(filePath, file.type);
            if (isMounted && url) {
              setCurrentMediaUrl(url);
            }
          }
        }
      } catch {
        // ignore
      }
    };

    checkAndResolveMedia();

    return () => {
      isMounted = false;
    };
  }, [file?.savedPath, file?.state, file?.md5, file?.name, isMedia]);

  // 当文件状态发生变化时（例如失败、完成、拒绝），重置本地动作过渡状态
  useEffect(() => {
    if (file?.state === 'failed' || file?.state === 'received' || file?.state === 'rejected') {
      setIsActionPending(false);
    }
  }, [file?.state]);

  // 媒体元素加载失败时的自动回退处理：调用 Rust 直接读取 Data URL，不影响真实存在性
  const handleMediaLoadError = async () => {
    if (isFallbackLoading || !resolvedPath) return;
    setIsFallbackLoading(true);
    try {
      const dataUrl = await ipc.readMediaDataUrl(resolvedPath, file?.type);
      if (dataUrl) {
        setCurrentMediaUrl(dataUrl);
      }
    } catch {
      // 仅在真实读取失败时保持现状，由 checkFileExists 决定 isLost
    } finally {
      setIsFallbackLoading(false);
    }
  };

  // 接收按钮点击校验
  const handleAcceptClick = () => {
    if (!isPeerOnline && !isMe) {
      setOfflineToast(`发送方 [${message.senderName}] 当前不在线，无法启动文件数据流传输！`);
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

  if (message.msgType === 'system' || (!message.fileAttachment && (!message.content || !message.content.trim()))) {
    return null;
  }

  // 1. 传输完成
  const isFileReceived = file?.state === 'received' || (file as any)?.status === 'completed';
  // 2. 被拒绝
  const isFileRejected = file?.state === 'rejected' || (file as any)?.status === 'rejected';

  // 3. 正在传输中（包含点击确认接收/继续接收后的启动连接期、推流中，无论此时瞬时流速是否为0）
  const isTransferring =
    !isFileReceived &&
    !isFileRejected &&
    (isActionPending || file?.state === 'transferring' || (file as any)?.status === 'transferring');

  // 4. 等待确认接收（初始未确认状态，未处于传输中）
  const isFileWaiting =
    !isTransferring &&
    !isFileReceived &&
    !isFileRejected &&
    (file?.state === 'waiting_accept' || (file as any)?.status === 'pending');

  // 5. 传输中断状态（明确为 failed/error，且绝不处于传输中）
  const isTransferInterrupted =
    !isTransferring &&
    !isFileReceived &&
    !isFileWaiting &&
    !isFileRejected &&
    (file?.state === 'failed' || (file as any)?.status === 'error');

  // 6. 接收方断点续传（继续接收）按钮判断：
  // 仅在明确传输中断且未处于传输中状态时才允许显示，一旦点击或开始传输立即隐藏
  const canResume = !isMe && isTransferInterrupted && !isTransferring;

  return (
    <div
      id={`msg-${message.id}`}
      className={`flex flex-col mb-4 transition-all duration-500 rounded-2xl ${
        isMe ? 'items-end' : 'items-start'
      } ${
        isHighlighted
          ? 'p-2 bg-[#094771]/35 ring-2 ring-[#0078d4] shadow-lg shadow-[#0078d4]/20'
          : 'p-0 ring-0 bg-transparent shadow-none'
      }`}
    >
      {/* 消息时间与发送人 */}
      <div className="flex items-center space-x-1.5 text-[11px] text-[#858585] mb-1 px-1">
        <span>{isMe ? '我' : message.senderName}</span>
        <span>•</span>
        <span>{formatTime(message.timestamp)}</span>
      </div>

      {/* 离线警告 Toast */}
      {offlineToast && (
        <div className="mb-2 px-3 py-1.5 bg-red-950/80 border border-red-800 text-red-200 text-xs rounded-xl flex items-center space-x-1.5 shadow-lg animate-in fade-in slide-in-from-top duration-150">
          <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span>{offlineToast}</span>
        </div>
      )}

      {/* 消息主体容器 */}
      <div className="relative group max-w-[85%] sm:max-w-[75%]">
        {/* 1. 文本消息 */}
        {message.content && message.msgType === 'text' && (
          <div
            className={`px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
              isMe
                ? 'bg-[#0078d4] text-white rounded-tr-xs'
                : 'bg-[#252526] border border-[#3c3c3c] text-[#cccccc] rounded-tl-xs'
            }`}
          >
            {message.content}
          </div>
        )}

        {/* 媒体文件已丢失占位卡片 */}
        {isMedia && file && isLost && (
          <div className="rounded-2xl border border-[#f87171]/40 bg-[#252526] p-3 shadow-md w-72 sm:w-80">
            <div className="flex items-center space-x-3 mb-2.5">
              <div className="w-9 h-9 rounded-xl bg-red-950/60 border border-red-800/80 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-[#f87171]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-[#f87171] leading-tight">文件已丢失</div>
                <div className="text-[11px] text-[#858585] truncate mt-0.5" title={file.name}>
                  {file.name}
                </div>
              </div>
            </div>
            <div className="text-[11px] text-[#6e7681] bg-[#181818] p-2 rounded-lg border border-[#333333] mb-2">
              本地 Media 目录中的原始文件不存在或已被删除
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-[#333333]">
              <span className="text-[10px] text-[#6e7681]">LAN Drop Media</span>
              <MediaCardActions
                file={file}
                savedPath={resolvedPath}
                isLost={true}
                onOpenInFolder={onOpenInFolder}
              />
            </div>
          </div>
        )}

        {/* 2. 图片消息预览（未丢失时渲染） */}
        {message.msgType === 'image' && file && !isLost && (
          <div className="overflow-hidden rounded-2xl border border-[#3c3c3c] bg-[#252526] p-1.5 shadow-md max-w-xs sm:max-w-sm">
            <div
              className="relative cursor-pointer group max-h-72 overflow-hidden rounded-xl bg-[#1e1e1e]"
              onClick={() => onPreviewMedia?.('image', currentMediaUrl || file.blobUrl || '', file.name, resolvedPath)}
            >
              <img
                src={currentMediaUrl || file.blobUrl}
                alt={file.name}
                onError={handleMediaLoadError}
                className="w-full h-auto object-cover max-h-64 rounded-xl transition-transform group-hover:scale-102"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs gap-1">
                <Eye className="w-4 h-4" />
                <span>点击全屏预览</span>
              </div>
            </div>

            <div className="mt-1.5 px-1.5 py-1 flex items-center justify-between text-[11px] text-[#858585] border-t border-[#333]">
              <span className="truncate max-w-[130px] text-[#cccccc] font-medium" title={file.name}>
                {file.name}
              </span>
              <MediaCardActions
                file={file}
                savedPath={resolvedPath}
                onOpenInFolder={onOpenInFolder}
              />
            </div>
          </div>
        )}

        {/* 3. 视频消息直接在消息中播放（未丢失时渲染） */}
        {message.msgType === 'video' && file && !isLost && (
          <div className="rounded-2xl border border-[#3c3c3c] bg-[#252526] p-2 shadow-md max-w-sm sm:max-w-md">
            <div className="relative rounded-xl overflow-hidden bg-black group">
              <video
                src={currentMediaUrl || file.blobUrl}
                controls
                onError={handleMediaLoadError}
                className="w-full max-h-60 rounded-xl"
              />
              <button
                onClick={() => onPreviewMedia?.('video', currentMediaUrl || file.blobUrl || '', file.name, resolvedPath)}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-white text-xs backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer shadow-md"
                title="大屏高清回放"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-2 px-1 py-1 flex items-center justify-between text-[11px] text-[#858585] border-t border-[#333]">
              <span className="font-semibold text-[#e0e0e0] truncate max-w-[140px]" title={file.name}>
                {file.name}
              </span>
              <MediaCardActions
                file={file}
                savedPath={resolvedPath}
                onOpenInFolder={onOpenInFolder}
              />
            </div>
          </div>
        )}

        {/* 4. 音频消息直接在消息中播放（未丢失时渲染） */}
        {message.msgType === 'audio' && file && !isLost && (
          <div className="rounded-2xl border border-[#3c3c3c] bg-[#252526] p-3 shadow-md w-72 sm:w-80">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-lg bg-[#094771] text-[#38bdf8] flex items-center justify-center shrink-0">
                  <Music className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[#e0e0e0] truncate" title={file.name}>
                    {file.name}
                  </div>
                  <div className="text-[10px] text-[#858585]">{formatBytes(file.size)}</div>
                </div>
              </div>
              <button
                onClick={() => onPreviewMedia?.('audio', currentMediaUrl || file.blobUrl || '', file.name, resolvedPath)}
                className="p-1.5 rounded-lg text-[#858585] hover:text-[#cccccc] hover:bg-[#333333] transition-colors shrink-0 ml-1 cursor-pointer"
                title="大屏试听"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <audio
              src={currentMediaUrl || file.blobUrl}
              controls
              onError={handleMediaLoadError}
              className="w-full h-8 mb-2"
            />

            <div className="flex items-center justify-between text-[11px] text-[#858585] border-t border-[#333] pt-1.5">
              <span className="text-[10px] text-[#858585]">媒体已自动就绪</span>
              <MediaCardActions
                file={file}
                savedPath={resolvedPath}
                onOpenInFolder={onOpenInFolder}
              />
            </div>
          </div>
        )}

        {/* 5. 经典文件传输卡片 (需手动点击接收，即时流式写入本地) */}
        {message.msgType === 'file' && file && (
          <div className="w-72 sm:w-80 bg-[#252526] border border-[#3c3c3c] rounded-2xl p-3.5 shadow-md">
            <div className="flex items-start justify-between gap-3 mb-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-[#e0e0e0] leading-snug line-clamp-2 break-all">
                  {file.name}
                </div>
                <div className="text-[11px] text-[#858585] mt-1 flex items-center space-x-2">
                  <span>{formatBytes(file.size)}</span>
                  {file.speed !== undefined && file.speed > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-[#38bdf8] font-mono">{formatSpeed(file.speed)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-[#1e1e1e] border border-[#3c3c3c] shrink-0">
                {getFileIcon(file.name)}
              </div>
            </div>

            {/* 传输中或中断时的进度条 */}
            {(isTransferring || isTransferInterrupted) && (
              <div className="w-full bg-[#181818] rounded-full h-1.5 mt-2 overflow-hidden border border-[#333]">
                <div
                  className={`h-full transition-all duration-300 ${
                    isTransferInterrupted ? 'bg-[#eab308]' : 'bg-[#0078d4]'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, file.progress || 0))}%` }}
                />
              </div>
            )}

            {/* 状态与进度提示条 */}
            <div className="mt-2 pt-2 border-t border-[#333333] flex items-center justify-between text-xs">
              <div className="flex items-center space-x-1.5 min-w-0">
                {isFileReceived && (
                  <span className="flex items-center space-x-1 text-[#34d399] font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>传输已完成</span>
                  </span>
                )}
                {isTransferring && (
                  <span className="flex items-center space-x-1.5 text-[#38bdf8]">
                    <span className="w-2 h-2 rounded-full bg-[#38bdf8] animate-ping" />
                    <span>
                      {isMe
                        ? `正在发送文件... ${file.progress?.toFixed(1) || 0}%`
                        : (file.speed || 0) > 0
                          ? `正在接收文件... ${file.progress?.toFixed(1) || 0}%`
                          : (file.progress || 0) > 0
                            ? `准备继续传输... ${file.progress?.toFixed(1)}%`
                            : `准备接收数据...`}
                    </span>
                  </span>
                )}
                {isFileWaiting && (
                  <span className="flex items-center space-x-1 text-[#eab308]">
                    <Clock className="w-3.5 h-3.5" />
                    <span>等待确认接收</span>
                  </span>
                )}
                {isFileRejected && (
                  <span className="flex items-center space-x-1 text-[#f87171]">
                    <XCircle className="w-3.5 h-3.5" />
                    <span>对方已拒绝</span>
                  </span>
                )}
                {isTransferInterrupted && (
                  <span className="flex items-center space-x-1 text-[#f87171]">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>
                      {(file.progress || 0) > 0
                        ? `传输中断 (已传 ${file.progress?.toFixed(1)}%)`
                        : '传输中断'}
                    </span>
                  </span>
                )}
              </div>

              {/* 操作按钮区 */}
              <div className="flex items-center space-x-1.5 shrink-0">
                {/* 接收方且处于 pending/waiting_accept 状态：显示“确认接收”按钮 */}
                {!isMe && isFileWaiting && (
                  <button
                    onClick={handleAcceptClick}
                    className="px-3 py-1 bg-[#0078d4] hover:bg-[#0284c7] active:bg-[#006cc1] text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center space-x-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>确认接收</span>
                  </button>
                )}

                {/* 接收方且处于传输中断/未完成状态：显示“继续接收”断点续传按钮 */}
                {canResume && (
                  <button
                    onClick={handleResumeClick}
                    className="px-3 py-1 bg-[#10b981] hover:bg-[#059669] active:bg-[#047857] text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center space-x-1 cursor-pointer"
                    title="从中断进度处断点续传"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>继续接收</span>
                  </button>
                )}

                {/* 传输完成：显示“打开所在目录” */}
                {isFileReceived && (
                  <button
                    onClick={() => onOpenInFolder(file.savedPath, file.name, false)}
                    className="px-2.5 py-1 bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] text-[#38bdf8] text-xs font-medium rounded-lg transition-all flex items-center space-x-1 cursor-pointer"
                    title="在系统文件管理器中查看"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>打开所在目录</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
