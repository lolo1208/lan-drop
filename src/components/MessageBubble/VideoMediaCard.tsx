/**
 * 视频类型消息卡片组件
 * 提供内嵌视频播放控件、全屏大屏高清回放与在系统目录中定位文件的快捷入口
 */

import React from "react";
import { Maximize2 } from "lucide-react";
import { FileAttachmentMeta } from "../../types";
import { MediaCardActions } from "./MediaCardActions";

interface VideoMediaCardProps {
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

export const VideoMediaCard: React.FC<VideoMediaCardProps> = ({
  file,
  currentMediaUrl,
  resolvedPath,
  onMediaLoadError,
  onPreviewMedia,
  onOpenInFolder,
}) => {
  return (
    <div className="rounded-2xl border border-[#3c3c3c] bg-[#252526] p-2 shadow-md max-w-sm sm:max-w-md">
      <div className="relative rounded-xl overflow-hidden bg-black group">
        <video
          src={currentMediaUrl || file.blobUrl}
          controls
          onError={onMediaLoadError}
          className="w-full max-h-60 rounded-xl"
        />
        <button
          onClick={() =>
            onPreviewMedia(
              "video",
              currentMediaUrl || file.blobUrl || "",
              file.name,
              resolvedPath,
            )
          }
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-black/90 text-white text-xs backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer shadow-md"
          title="大屏高清回放"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="mt-2 px-1 py-1 flex items-center justify-between text-[11px] text-[#858585] border-t border-[#333]">
        <span
          className="font-semibold text-[#e0e0e0] truncate max-w-[140px]"
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
