/**
 * LAN Drop 媒体灯箱（图片全屏预览、视频播放大屏查看器、音频播放器）
 * 专为 VS Code 2026 Dark Modern 风格定制：
 * 已彻底移除“保存到本地”功能，保留“打开所在目录”功能，精准定位到 [用户文档]/LAN Drop/Media 目录并高亮选中文件
 */

import React from 'react';
import { FolderOpen, Music, X } from 'lucide-react';
import { isTauri, ipc } from '../services/ipc';

interface MediaLightboxProps {
  isOpen: boolean;
  type: 'image' | 'video' | 'audio' | null;
  url: string | null;
  fileName: string;
  filePath?: string;
  onClose: () => void;
  onOpenInFolder?: (savedPath?: string, fileName?: string) => void;
}

export const MediaLightbox: React.FC<MediaLightboxProps> = ({
  isOpen,
  type,
  url,
  fileName,
  filePath,
  onClose,
  onOpenInFolder,
}) => {
  const [activeUrl, setActiveUrl] = React.useState<string | null>(url);

  React.useEffect(() => {
    setActiveUrl(url);
  }, [url]);

  if (!isOpen || (!activeUrl && !filePath)) return null;

  const handleMediaError = async () => {
    if (filePath) {
      try {
        const dataUrl = await ipc.readMediaDataUrl(filePath);
        if (dataUrl) {
          setActiveUrl(dataUrl);
        }
      } catch {
        // ignore
      }
    }
  };

  // 点击“打开所在目录”按钮：打开 Media 文件夹并定位选中该文件
  const handleOpenFolder = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let targetPath = filePath;
    if (!targetPath) {
      try {
        const mediaDir = await ipc.getMediaDir();
        targetPath = fileName ? `${mediaDir}/${fileName}` : mediaDir;
      } catch {
        targetPath = fileName;
      }
    }

    if (onOpenInFolder) {
      onOpenInFolder(targetPath, fileName);
    } else if (isTauri() && targetPath) {
      ipc.openInFolder(targetPath).catch((err) => {
        console.error('打开所在目录失败:', err);
      });
    }
  };

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
            {type === 'image' ? '图片预览' : type === 'video' ? '视频回放' : '音频试听'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* 只保留“打开所在目录”按钮 */}
          <button
            onClick={handleOpenFolder}
            className="px-3 py-1.5 rounded-lg bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] text-[#38bdf8] text-xs font-medium flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
            title="在文件夹中显示并高亮选中该文件"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>打开所在目录</span>
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#252526] hover:bg-[#2a2d2e] border border-[#3c3c3c] text-[#cccccc] hover:text-white transition-colors cursor-pointer"
            title="关闭预览"
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
            src={activeUrl || url || ''}
            alt={fileName}
            onError={handleMediaError}
            className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl transition-transform"
          />
        )}

        {type === 'video' && (
          <video
            src={activeUrl || url || ''}
            controls
            autoPlay
            onError={handleMediaError}
            className="max-h-[80vh] max-w-full rounded-xl shadow-2xl bg-black"
          />
        )}

        {type === 'audio' && (
          <div className="bg-[#252526] border border-[#3c3c3c] rounded-2xl p-6 sm:p-8 shadow-2xl w-80 sm:w-96 flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-[#094771] text-[#38bdf8] flex items-center justify-center mb-4 ring-4 ring-[#0078d4]/30 animate-pulse">
              <Music className="w-10 h-10" />
            </div>
            <div className="text-sm font-bold text-[#e0e0e0] truncate max-w-full mb-1 text-center">
              {fileName}
            </div>
            <div className="text-xs text-[#858585] mb-6">音频文件播放器</div>
            <audio
              src={activeUrl || url || ''}
              controls
              autoPlay
              onError={handleMediaError}
              className="w-full h-10 rounded-lg"
            />
          </div>
        )}
      </div>
    </div>
  );
};
