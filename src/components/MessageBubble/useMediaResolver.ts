/**
 * 媒体文件本地磁盘存在性检测与 URL 解析 Hook
 * 检查媒体文件是否已被本地落盘，将文件系统绝对路径转换为可被 WebView 安全加载的本地协议 URL
 */

import { useState, useEffect } from "react";
import { FileAttachmentMeta } from "../../types";
import { ipc } from "../../services/ipc";

interface UseMediaResolverProps {
  file?: FileAttachmentMeta;
  isMedia: boolean;
}

export function useMediaResolver({ file, isMedia }: UseMediaResolverProps) {
  const [isLost, setIsLost] = useState(false);
  const [resolvedPath, setResolvedPath] = useState<string | undefined>(
    file?.savedPath,
  );
  const [currentMediaUrl, setCurrentMediaUrl] = useState<string>(
    file?.blobUrl || "",
  );
  const [isFallbackLoading, setIsFallbackLoading] = useState(false);

  // 1. 同步初始 blobUrl
  useEffect(() => {
    if (file?.blobUrl) {
      setCurrentMediaUrl(file.blobUrl);
    }
  }, [file?.blobUrl]);

  // 2. 校验本地文件是否存在及解析媒体可播放 URL
  useEffect(() => {
    if (!isMedia || !file) return;

    let isMounted = true;

    const checkAndResolveMedia = async () => {
      try {
        let filePath = file.savedPath;
        const mediaDir = await ipc.getMediaDir();
        const dotIndex = file.name.lastIndexOf(".");
        const ext = dotIndex !== -1 ? file.name.substring(dotIndex + 1) : "";
        const mediaName = file.md5
          ? ext
            ? `${file.md5}.${ext}`
            : file.md5
          : file.name;

        if (!filePath) {
          filePath = `${mediaDir}/${mediaName}`;
        }

        if (isMounted) {
          setResolvedPath(filePath);
        }

        // 若尚未接收或仍在传输中，暂不标记为丢失
        if (file.state === "waiting_accept" || file.state === "transferring") {
          return;
        }

        // 检查文件在磁盘上是否存在
        const exists = await ipc.checkFileExists(filePath);
        if (isMounted) {
          setIsLost(!exists);
        }

        // 如果文件真实存在，且当前没有有效 mediaUrl 或当前的 blobUrl 失效，获取本地资源协议或 Data URL
        if (exists && isMounted) {
          if (!currentMediaUrl || currentMediaUrl.trim() === "") {
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

  // 媒体元素加载失败时的自动回退处理：直接读取 Data URL
  const handleMediaLoadError = async () => {
    if (isFallbackLoading || !resolvedPath) return;
    setIsFallbackLoading(true);
    try {
      const dataUrl = await ipc.readMediaDataUrl(resolvedPath, file?.type);
      if (dataUrl) {
        setCurrentMediaUrl(dataUrl);
      }
    } catch {
      // ignore
    } finally {
      setIsFallbackLoading(false);
    }
  };

  return {
    isLost,
    resolvedPath,
    currentMediaUrl,
    handleMediaLoadError,
  };
}
