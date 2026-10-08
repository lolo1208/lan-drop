/**
 * 媒体文件全屏预览模态窗组件
 * 支持图片大图缩放查看、音视频高清内联播放与本地文件管理器定位
 */

import React from "react";
import { Copy, FolderOpen, Music, X } from "lucide-react";
import { isTauri, ipc } from "../services/ipc";

interface MediaLightboxProps {
  isOpen: boolean;
  type: "image" | "video" | "audio" | null;
  url: string | null;
  fileName: string;
  filePath?: string;
  showOpenInFolder?: boolean;
  onClose: () => void;
  onOpenInFolder?: (savedPath?: string, fileName?: string) => void;
}

export const MediaLightbox: React.FC<MediaLightboxProps> = ({
  isOpen,
  type,
  url,
  fileName,
  filePath,
  showOpenInFolder = true,
  onClose,
  onOpenInFolder,
}) => {
  const [activeUrl, setActiveUrl] = React.useState<string | null>(url);
  const [isCopying, setIsCopying] = React.useState(false);
  const [copyNotice, setCopyNotice] = React.useState<string | null>(null);
  const copyInProgress = React.useRef(false);
  const previewVersion = React.useRef(0);

  React.useEffect(() => {
    setActiveUrl(url);
  }, [url]);

  React.useEffect(() => {
    previewVersion.current += 1;
    setCopyNotice(null);
  }, [isOpen, url, filePath]);

  React.useEffect(() => {
    if (!copyNotice) return;
    const timer = setTimeout(() => setCopyNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  if (!isOpen || (!activeUrl && !filePath)) return null;

  const handleCopyImage = async () => {
    if (copyInProgress.current) return;
    copyInProgress.current = true;
    setIsCopying(true);
    setCopyNotice(null);
    const version = previewVersion.current;
    try {
      await ipc.copyImage(activeUrl || url || "", filePath);
      if (version === previewVersion.current) setCopyNotice("图片已复制");
    } catch (err) {
      console.warn("复制图片失败:", err);
      if (version === previewVersion.current) {
        setCopyNotice("复制图片失败，请重试");
      }
    } finally {
      copyInProgress.current = false;
      setIsCopying(false);
    }
  };

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
        console.error("打开所在目录失败:", err);
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
            {type === "image"
              ? "图片预览"
              : type === "video"
                ? "视频回放"
                : "音频试听"}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {type === "image" && <button
            type="button"
            onClick={handleCopyImage}
            disabled={isCopying}
            aria-busy={isCopying}
            className="px-3 py-1.5 rounded-lg bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] text-[#38bdf8] text-xs font-medium flex items-center gap-1.5 transition-colors motion-reduce:transition-none shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
            title="复制图片到系统剪贴板"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{isCopying ? "复制中…" : "复制图片"}</span>
          </button>}
          {showOpenInFolder && <button
            onClick={handleOpenFolder}
            className="px-3 py-1.5 rounded-lg bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] text-[#38bdf8] text-xs font-medium flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
            title="在文件夹中显示并高亮选中该文件"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>打开所在目录</span>
          </button>}

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#252526] hover:bg-[#2a2d2e] border border-[#3c3c3c] text-[#cccccc] hover:text-white transition-colors cursor-pointer"
            title="关闭预览"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {copyNotice && (
        <div role="status" aria-live="polite"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none whitespace-nowrap rounded-lg border border-[#3c3c3c] bg-[#252526] px-3 py-1.5 text-xs text-[#e0e0e0] shadow-sm">
          {copyNotice}
        </div>
      )}

      {/* 预览主体内容 */}
      <div
        className="max-w-5xl max-h-[85vh] flex items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {type === "image" && (
          <img
            src={activeUrl || url || ""}
            alt={fileName}
            onError={handleMediaError}
            className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl transition-transform"
          />
        )}

        {type === "video" && (
          <video
            src={activeUrl || url || ""}
            controls
            autoPlay
            onError={handleMediaError}
            className="max-h-[80vh] max-w-full rounded-xl shadow-2xl bg-black"
          />
        )}

        {type === "audio" && (
          <div className="bg-[#252526] border border-[#3c3c3c] rounded-2xl p-6 sm:p-8 shadow-2xl w-80 sm:w-96 flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-[#094771] text-[#38bdf8] flex items-center justify-center mb-4 ring-4 ring-[#0078d4]/30 animate-pulse">
              <Music className="w-10 h-10" />
            </div>
            <div className="text-sm font-bold text-[#e0e0e0] truncate max-w-full mb-1 text-center">
              {fileName}
            </div>
            <div className="text-xs text-[#858585] mb-6">音频文件播放器</div>
            <audio
              src={activeUrl || url || ""}
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
