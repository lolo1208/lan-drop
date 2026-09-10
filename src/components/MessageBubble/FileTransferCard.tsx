/**
 * 普通文件传输卡片组件
 * 呈现文件图标、文件大小、传输百分比进度条、瞬时速率，并支持接收确认、断点续传与定位文件
 */

import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileCode,
  FileText,
  FileVideo,
  FolderOpen,
  HardDrive,
  Music,
  Play,
  XCircle,
} from "lucide-react";
import { ChatMessage, FileAttachmentMeta } from "../../types";
import { formatBytes, formatSpeed } from "../../utils/format";

interface FileTransferCardProps {
  message: ChatMessage;
  file: FileAttachmentMeta;
  isMe: boolean;
  isActionPending: boolean;
  onAcceptClick: () => void;
  onResumeClick: () => void;
  onOpenInFolder: (
    savedPath?: string,
    fileName?: string,
    isMedia?: boolean,
  ) => void;
}

export const FileTransferCard: React.FC<FileTransferCardProps> = ({
  message,
  file,
  isMe,
  isActionPending,
  onAcceptClick,
  onResumeClick,
  onOpenInFolder,
}) => {
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (["mp4", "mkv", "mov", "webm"].includes(ext || "")) {
      return <FileVideo className="w-8 h-8 text-[#38bdf8]" />;
    }
    if (["mp3", "wav", "ogg", "flac"].includes(ext || "")) {
      return <Music className="w-8 h-8 text-[#89d185]" />;
    }
    if (["iso", "img", "tar", "gz", "zip", "rar"].includes(ext || "")) {
      return <HardDrive className="w-8 h-8 text-[#cca700]" />;
    }
    if (["rs", "ts", "js", "py", "json", "c"].includes(ext || "")) {
      return <FileCode className="w-8 h-8 text-[#4ec9b0]" />;
    }
    return <FileText className="w-8 h-8 text-[#9cdcfe]" />;
  };

  // 1. 传输完成
  const isFileReceived =
    file?.state === "received" || (file as any)?.status === "completed";
  // 2. 被拒绝
  const isFileRejected =
    file?.state === "rejected" || (file as any)?.status === "rejected";

  // 3. 正在传输中
  const isTransferring =
    !isFileReceived &&
    !isFileRejected &&
    (isActionPending ||
      file?.state === "transferring" ||
      (file as any)?.status === "transferring");

  // 4. 等待确认接收
  const isFileWaiting =
    !isTransferring &&
    !isFileReceived &&
    !isFileRejected &&
    (file?.state === "waiting_accept" || (file as any)?.status === "pending");

  // 5. 传输中断状态
  const isTransferInterrupted =
    !isTransferring &&
    !isFileReceived &&
    !isFileWaiting &&
    !isFileRejected &&
    (file?.state === "failed" || (file as any)?.status === "error");

  // 6. 接收方断点续传（继续接收）按钮判断
  const canResume = !isMe && isTransferInterrupted && !isTransferring;

  return (
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
                <span className="text-[#38bdf8] font-mono">
                  {formatSpeed(file.speed)}
                </span>
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
              isTransferInterrupted ? "bg-[#eab308]" : "bg-[#0078d4]"
            }`}
            style={{
              width: `${Math.min(100, Math.max(0, file.progress || 0))}%`,
            }}
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
                  : "传输中断"}
              </span>
            </span>
          )}
        </div>

        {/* 操作按钮区 */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {/* 接收方且处于 pending/waiting_accept 状态：显示“确认接收”按钮 */}
          {!isMe && isFileWaiting && (
            <button
              onClick={onAcceptClick}
              className="px-3 py-1 bg-[#0078d4] hover:bg-[#0284c7] active:bg-[#006cc1] text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center space-x-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>确认接收</span>
            </button>
          )}

          {/* 接收方且处于传输中断/未完成状态：显示“继续接收”断点续传按钮 */}
          {canResume && (
            <button
              onClick={onResumeClick}
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
  );
};
