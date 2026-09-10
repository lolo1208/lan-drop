/**
 * 音频/语音类型消息卡片组件
 * 提供紧凑内联音频播放器、时长展示、全屏弹窗播放与本地目录定位操作
 */

import React from "react";
import { Maximize2, Music } from "lucide-react";
import { FileAttachmentMeta } from "../../types";
import { formatBytes } from "../../utils/format";
import { MediaCardActions } from "./MediaCardActions";

interface AudioMediaCardProps {
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

export const AudioMediaCard: React.FC<AudioMediaCardProps> = ({
  file,
  currentMediaUrl,
  resolvedPath,
  onMediaLoadError,
  onPreviewMedia,
  onOpenInFolder,
}) => {
  return (
    <div className="rounded-2xl border border-[#3c3c3c] bg-[#252526] p-3 shadow-md w-72 sm:w-80">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-[#094771] text-[#38bdf8] flex items-center justify-center shrink-0">
            <Music className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-xs font-semibold text-[#e0e0e0] truncate"
              title={file.name}
            >
              {file.name}
            </div>
            <div className="text-[10px] text-[#858585]">
              {formatBytes(file.size)}
            </div>
          </div>
        </div>
        <button
          onClick={() =>
            onPreviewMedia(
              "audio",
              currentMediaUrl || file.blobUrl || "",
              file.name,
              resolvedPath,
            )
          }
          className="p-1.5 rounded-lg text-[#858585] hover:text-[#cccccc] hover:bg-[#333333] transition-colors shrink-0 ml-1 cursor-pointer"
          title="大屏试听"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <audio
        src={currentMediaUrl || file.blobUrl}
        controls
        onError={onMediaLoadError}
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
  );
};
