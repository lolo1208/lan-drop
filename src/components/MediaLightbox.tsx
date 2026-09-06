/**
 * LAN Drop 媒体灯箱（图片全屏预览、视频播放大屏查看器）
 */

import React from 'react';
import { Download, ExternalLink, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';

interface MediaLightboxProps {
  isOpen: boolean;
  type: 'image' | 'video' | null;
  url: string | null;
  fileName: string;
  onClose: () => void;
}

export const MediaLightbox: React.FC<MediaLightboxProps> = ({
  isOpen,
  type,
  url,
  fileName,
  onClose,
}) => {
  if (!isOpen || !url) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* 顶部控制条 */}
      <div
        className="absolute top-4 inset-x-4 max-w-5xl mx-auto flex items-center justify-between text-white z-10 px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center space-x-2">
          <span className="text-sm font-semibold truncate max-w-xs sm:max-w-md text-[#e0e0e0]">
            {fileName}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-[#252526] border border-[#3c3c3c] text-[#858585]">
            {type === 'image' ? '图片预览' : '视频回放'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <a
            href={url}
            download={fileName}
            className="p-2 rounded-lg bg-[#252526] hover:bg-[#2a2d2e] border border-[#3c3c3c] text-[#cccccc] hover:text-white transition-colors"
            title="保存到本地"
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-[#252526] hover:bg-[#2a2d2e] border border-[#3c3c3c] text-[#cccccc] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 预览主体内容 */}
      <div
        className="max-w-5xl max-h-[85vh] flex items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {type === 'image' && (
          <img
            src={url}
            alt={fileName}
            className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl transition-transform"
          />
        )}

        {type === 'video' && (
          <video
            src={url}
            controls
            autoPlay
            className="max-h-[80vh] max-w-full rounded-xl shadow-2xl bg-black"
          />
        )}
      </div>
    </div>
  );
};
