/**
 * 图片类型消息预览卡片组件
 * 提供图片缩略图渐进式加载渲染、点击展开全屏大图预览与在文件管理器中定位操作
 */

import React from "react";
import { Eye } from "lucide-react";
import { FileAttachmentMeta } from "../../types";
import { MediaCardActions } from "./MediaCardActions";

interface ImageMediaCardProps {
  file: FileAttachmentMeta;
  currentMediaUrl: string;
  resolvedPath?: string;
  onMediaLoadError: () => void;
  onPreviewMedia: (
    type: "image" | "video" | "audio",
    url: string,
    fileName: string,
    filePath?: string,
  ) => void;
  onOpenInFolder: (
    savedPath?: string,
    fileName?: string,
    isMedia?: boolean,
  ) => void;
}

export const ImageMediaCard: React.FC<ImageMediaCardProps> = ({
  file,
  currentMediaUrl,
  resolvedPath,
  onMediaLoadError,
  onPreviewMedia,
  onOpenInFolder,
}) => {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#3c3c3c] bg-[#252526] p-1.5 shadow-md max-w-xs sm:max-w-sm">
      <div
        className="relative cursor-pointer group max-h-72 overflow-hidden rounded-xl bg-[#1e1e1e]"
        onClick={() =>
          onPreviewMedia(
            "image",
            currentMediaUrl || file.blobUrl || "",
            file.name,
            resolvedPath,
          )
        }
      >
        <img
          src={currentMediaUrl || file.blobUrl}
          alt={file.name}
          onError={onMediaLoadError}
          className="w-full h-auto object-cover max-h-64 rounded-xl transition-transform group-hover:scale-102"
        />
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs gap-1">
          <Eye className="w-4 h-4" />
          <span>点击全屏预览</span>
        </div>
      </div>

      <div className="mt-1.5 px-1.5 py-1 flex items-center justify-between text-[11px] text-[#858585] border-t border-[#333]">
        <span
          className="truncate max-w-[130px] text-[#cccccc] font-medium"
          title={file.name}
        >
          {file.name}
        </span>
        <MediaCardActions
          file={file}
          savedPath={resolvedPath}
          onOpenInFolder={onOpenInFolder}
        />
      </div>
    </div>
  );
};
