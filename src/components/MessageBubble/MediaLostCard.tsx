/**
 * 媒体文件在本地磁盘中丢失或被删除时的占位引导卡片组件
 * 当文件在磁盘上被移动或删除时提供友好的丢失警告与重新下载引导
 */

import React from "react";
import { AlertCircle } from "lucide-react";
import { FileAttachmentMeta } from "../../types";
import { MediaCardActions } from "./MediaCardActions";

interface MediaLostCardProps {
  file: FileAttachmentMeta;
  resolvedPath?: string;
  onOpenInFolder?: (
    savedPath?: string,
    fileName?: string,
    isMedia?: boolean,
  ) => void;
}

export const MediaLostCard: React.FC<MediaLostCardProps> = ({
  file,
  resolvedPath,
  onOpenInFolder,
}) => {
  return (
    <div className="rounded-2xl border border-[#f87171]/40 bg-[#252526] p-3 shadow-md w-72 sm:w-80">
      <div className="flex items-center space-x-3 mb-2.5">
        <div className="w-9 h-9 rounded-xl bg-red-950/60 border border-red-800/80 flex items-center justify-center shrink-0">
          <AlertCircle className="w-5 h-5 text-[#f87171]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-[#f87171] leading-tight">
            文件已丢失
          </div>
          <div
            className="text-[11px] text-[#858585] truncate mt-0.5"
            title={file.name}
          >
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
  );
};
