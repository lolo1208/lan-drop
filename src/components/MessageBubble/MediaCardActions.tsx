/**
 * 媒体卡片快捷操作栏组件
 * 提供在系统文件管理器中直接定位并高亮显示本地文件的操作按钮
 */

import React from "react";
import { FolderOpen } from "lucide-react";
import { FileAttachmentMeta } from "../../types";

interface MediaCardActionsProps {
  file: FileAttachmentMeta;
  savedPath?: string;
  isLost?: boolean;
  onOpenInFolder?: (
    savedPath?: string,
    fileName?: string,
    isMedia?: boolean,
  ) => void;
}

// 媒体卡片操作栏组件：仅保留“打开所在目录”功能，精准定位选中文件
export const MediaCardActions: React.FC<MediaCardActionsProps> = ({
  file,
  savedPath,
  onOpenInFolder,
}) => {
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
