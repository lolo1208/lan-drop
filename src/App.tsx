/**
 * 应用主窗口组件
 * 负责整体界面布局组装、全局状态编排（设备列表、聊天会话、系统托盘、模态窗及动态通知）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { TrayOverlay } from "./components/TrayOverlay";
import { MediaLightbox } from "./components/MediaLightbox";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { ipc, isTauri } from "./services/ipc";
import { setDefaultDocumentsCache, storageService } from "./services/storage";
import { LocalDeviceConfig, PeerDevice } from "./types";
import { buildConversations, usePeerSync } from "./hooks/usePeerSync";
import { useChatSync } from "./hooks/useChatSync";
import { useSystemTray } from "./hooks/useSystemTray";

export function App() {
  const [config, setConfig] = useState<LocalDeviceConfig>(() =>
    storageService.getSettings(),
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<
    "user" | "system"
  >("user");
  const [folderToast, setFolderToast] = useState<string | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(
    null,
  );
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // 始终维护最新的 config 引用
  const configRef = useRef<LocalDeviceConfig>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // 媒体大图/视频/音频全屏预览弹窗
  const [lightbox, setLightbox] = useState<{
    isOpen: boolean;
    type: "image" | "video" | "audio";
    url: string;
    fileName: string;
    filePath?: string;
  }>({
    isOpen: false,
    type: "image",
    url: "",
    fileName: "",
    filePath: undefined,
  });

  const showToast = useCallback((msg: string, duration = 3000) => {
    setFolderToast(msg);
    setTimeout(() => setFolderToast(null), duration);
  }, []);

  // 辅助函数：触发消息临时高亮框并在2.5秒后自动淡出消失
  const triggerMessageHighlight = useCallback((msgId: string) => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    setHighlightMessageId(msgId);
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightMessageId((curr) => (curr === msgId ? null : curr));
    }, 2500);
  }, []);

  // 1. 初始化 IPC 监听与配置读取
  useEffect(() => {
    ipc.requestNotificationPermission().catch(() => {});

    ipc.init().catch((err) => {
      console.warn("初始化 IPC 事件监听失败:", err);
    });

    storageService.loadSettingsFromDb().then((loadedConfig) => {
      setConfig(loadedConfig);
      if (loadedConfig.updateUrl && loadedConfig.updateUrl.trim()) {
        ipc.checkForUpdates(loadedConfig.updateUrl).catch(() => {});
      }
    });

    ipc.getSysInfo().then((sysInfo) => {
      if (sysInfo) {
        if (sysInfo.document_dir) {
          setDefaultDocumentsCache(sysInfo.document_dir);
        }
        const current = ipc.getLocalConfig();
        const newConfig = { ...current };
        let changed = false;

        if (
          !newConfig.name ||
          newConfig.name === "Windows PC" ||
          newConfig.name === "My Computer" ||
          newConfig.name === "LAN Drop Device"
        ) {
          if (sysInfo.hostname) {
            newConfig.name = sysInfo.hostname;
            changed = true;
          }
        }

        if (
          !newConfig.downloadDir ||
          newConfig.downloadDir.includes("[用户文档]") ||
          newConfig.downloadDir === "C:\\LAN Drop\\Files" ||
          newConfig.downloadDir === "~/Downloads/FlashDrop"
        ) {
          if (sysInfo.document_dir) {
            newConfig.downloadDir = sysInfo.document_dir;
            changed = true;
          }
        }

        if (
          sysInfo.local_ip &&
          sysInfo.local_ip !== "127.0.0.1" &&
          sysInfo.local_ip !== "0.0.0.0" &&
          !newConfig.ip
        ) {
          newConfig.ip = sysInfo.local_ip;
          changed = true;
        }

        if (changed) {
          ipc.updateLocalConfig(newConfig);
          setConfig(newConfig);
        }
      }
    });

    const unsubConfig = ipc.on<LocalDeviceConfig>(
      "config://updated",
      (updatedConfig) => {
        setConfig({ ...updatedConfig });
      },
    );

    return () => {
      unsubConfig();
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  // 2. 状态管理 Hooks
  // 设备在线状态与选择
  const {
    peers,
    selectedPeer,
    setSelectedPeer,
    handleSelectPeer,
    focusPeerAndMessage,
  } = usePeerSync({
    config,
    onTriggerHighlight: triggerMessageHighlight,
  });

  // 系统托盘与后台常驻
  const { isHiddenToTray, notifyIncomingMessage } = useSystemTray({
    config,
    onFocusPeerAndMessage: focusPeerAndMessage,
  });

  // 聊天流与文件传输
  const {
    allChats,
    chatMessages,
    handleMarkPeerRead,
    handleSendMessage,
    handleSendFile,
    handleAcceptFile,
    handleResumeFile,
    handleDeleteMessage,
    handleDeleteMessages,
    handleClearPeerChat,
  } = useChatSync({
    config,
    peers,
    selectedPeer,
    setSelectedPeer,
    onIncomingBackgroundMessage: notifyIncomingMessage,
    onToast: showToast,
  });

  // 纯函数实时构建会话列表
  const conversations = useMemo(
    () => buildConversations(peers, allChats, config),
    [peers, allChats, config],
  );

  // 动作处理：定位到系统文件管理器
  const handleOpenInFolder = async (
    savedPath?: string,
    fileName?: string,
    isMedia?: boolean,
  ) => {
    let targetPath = savedPath;
    if (!targetPath) {
      if (isMedia) {
        try {
          const mediaDir = await ipc.getMediaDir();
          targetPath = fileName ? `${mediaDir}/${fileName}` : mediaDir;
        } catch {
          targetPath = fileName;
        }
      } else {
        const defaultDir = config.downloadDir;
        targetPath = fileName ? `${defaultDir}/${fileName}` : defaultDir;
      }
    }

    if (isTauri() && targetPath) {
      ipc.openInFolder(targetPath).catch((err) => {
        console.warn("调用打开文件夹指令失败:", err);
      });
    }
    showToast(`已在文件管理器中定位: ${targetPath}`);
  };

  const handlePreviewMedia = (
    type: "image" | "video" | "audio",
    url: string,
    fileName: string,
    filePath?: string,
  ) => {
    setLightbox({
      isOpen: true,
      type,
      url,
      fileName,
      filePath,
    });
  };

  const handleSaveConfig = (newConfig: LocalDeviceConfig) => {
    setConfig(newConfig);
    ipc.updateLocalConfig(newConfig);
    showToast("设置已保存", 2000);
  };

  const handleOpenSettingsModal = (defaultTab: "user" | "system" = "user") => {
    setSettingsDefaultTab(defaultTab);
    setIsSettingsOpen(true);
  };

  return (
    <div className="flex h-screen w-screen bg-[#1e1e1e] text-[#cccccc] font-sans antialiased overflow-hidden select-none">
      {/* 顶部全局提示 Toast */}
      {folderToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#252526] border border-[#0078d4] text-white text-xs rounded-xl shadow-2xl flex items-center space-x-2 animate-in fade-in slide-in-from-top duration-200">
          <span className="w-2 h-2 rounded-full bg-[#0078d4] animate-ping" />
          <span>{folderToast}</span>
        </div>
      )}

      {/* 左侧设备与联系人会话列表 */}
      <Sidebar
        conversations={conversations}
        allChats={allChats}
        activePeerId={selectedPeer?.id || null}
        currentUserId={config.id}
        onSelectPeer={handleSelectPeer}
        onOpenSettings={handleOpenSettingsModal}
        localName={config.name}
        localIp={config.ip}
        localAvatarUrl={config.avatarUrl}
      />

      {/* 右侧聊天与文件传输主面板 */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-[#1e1e1e]">
        <ChatPanel
          peer={selectedPeer}
          messages={chatMessages}
          currentUserId={config.id}
          currentUserIp={config.ip}
          currentUserAvatarUrl={config.avatarUrl}
          highlightMessageId={highlightMessageId}
          onSendMessage={handleSendMessage}
          onSendFile={handleSendFile}
          onAcceptFile={handleAcceptFile}
          onResumeFile={handleResumeFile}
          onDeleteMessage={handleDeleteMessage}
          onDeleteMessages={handleDeleteMessages}
          onClearChat={handleClearPeerChat}
          onOpenInFolder={handleOpenInFolder}
          onPreviewMedia={handlePreviewMedia}
          onMarkPeerRead={handleMarkPeerRead}
        />
      </div>

      {/* 设置模态框 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSave={handleSaveConfig}
        defaultTab={settingsDefaultTab}
      />

      {/* 媒体全屏大图/视频预览模态窗 */}
      <MediaLightbox
        isOpen={lightbox.isOpen}
        type={lightbox.type}
        url={lightbox.url}
        fileName={lightbox.fileName}
        filePath={lightbox.filePath}
        onOpenInFolder={handleOpenInFolder}
        onClose={() => setLightbox((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* 托盘后台挂起状态蒙层（使用独立组件 TrayOverlay） */}
      {isHiddenToTray && (
        <TrayOverlay
          globalHotkey={configRef.current?.globalHotkey || "Ctrl+Alt+Shift+S"}
        />
      )}
    </div>
  );
}

export default App;
