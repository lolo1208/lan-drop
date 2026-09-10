/**
 * 系统设置模态窗主入口组件
 * 整合用户信息配置面板与系统底层环境参数配置面板
 */

import {
  Check,
  RotateCcw,
  Save,
  Settings,
  Sliders,
  User,
  X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { ipc } from "../../services/ipc";
import {
  getDefaultDocumentsPath,
  getDefaultMachineName,
} from "../../services/storage";
import { LocalDeviceConfig } from "../../types";
import {
  getRandomAvatarId,
  PRESET_AVATARS,
  processAvatarImageFile,
  toCompactAvatarIdentifier,
} from "../../utils/avatars";
import { SystemTab } from "./SystemTab";
import { UserTab } from "./UserTab";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: LocalDeviceConfig;
  onSave: (newConfig: LocalDeviceConfig) => void;
  defaultTab?: "user" | "system";
}

type TabType = "user" | "system";

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
  defaultTab = "user",
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);
  const defaultRealPath = getDefaultDocumentsPath();

  const [sysInfo, setSysInfo] = useState<{
    hostname: string;
    document_dir: string;
  } | null>(null);

  useEffect(() => {
    ipc.getSysInfo().then((info) => setSysInfo(info));
  }, []);

  const [formData, setFormData] = useState<LocalDeviceConfig>(() => {
    const rawDir = config.downloadDir;
    const realDir =
      !rawDir ||
      rawDir === "~/Downloads/FlashDrop" ||
      rawDir.includes("[用户文档]")
        ? defaultRealPath
        : rawDir;

    return {
      ...config,
      avatarUrl: config.avatarUrl
        ? toCompactAvatarIdentifier(config.avatarUrl)
        : getRandomAvatarId(),
      name: config.name || getDefaultMachineName(),
      downloadDir: realDir,
      updateUrl: config.updateUrl || "",
      autoStart: config.autoStart !== undefined ? config.autoStart : false,
      port: config.port || 57088,
    };
  });

  const [savedToast, setSavedToast] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [portError, setPortError] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRecordingHotkey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setIsRecordingHotkey(false);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");

      let keyName = e.key;
      if (keyName === " ") keyName = "Space";
      if (["Control", "Alt", "Shift", "Meta"].includes(keyName)) {
        return;
      }

      parts.push(keyName.length === 1 ? keyName.toUpperCase() : keyName);
      const combined = parts.join("+");

      setFormData((prev) => ({ ...prev, globalHotkey: combined }));
      setIsRecordingHotkey(false);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isRecordingHotkey]);

  const prevIsOpenRef = useRef(false);

  // 当打开弹窗时，激活指定的初始选项卡并同步当前真实路径
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setActiveTab(defaultTab);
      const rawDir = config.downloadDir;
      const realDir =
        !rawDir ||
        rawDir === "~/Downloads/FlashDrop" ||
        rawDir.includes("[用户文档]")
          ? sysInfo?.document_dir || defaultRealPath
          : rawDir;

      setFormData({
        ...config,
        avatarUrl: config.avatarUrl
          ? toCompactAvatarIdentifier(config.avatarUrl)
          : getRandomAvatarId(),
        name: config.name || sysInfo?.hostname || getDefaultMachineName(),
        downloadDir: realDir,
        updateUrl: config.updateUrl || "",
        autoStart: config.autoStart !== undefined ? config.autoStart : false,
        port: config.port || 57088,
      });
      setUpdateStatus(null);
      setPortError(null);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, defaultTab, config, defaultRealPath, sysInfo]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = Number(formData.port);
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setPortError("端口号必须在 1024 ~ 65535 范围内");
      setTimeout(() => setPortError(null), 3000);
      return;
    }
    if (formData.globalHotkey !== undefined) {
      ipc.registerGlobalHotkey(formData.globalHotkey);
    }
    onSave({
      ...formData,
      port: portNum,
    });
    setSavedToast(true);
    setTimeout(() => {
      setSavedToast(false);
    }, 1800);
  };

  const handleResetDefaults = () => {
    const machineName = sysInfo?.hostname || getDefaultMachineName();
    setFormData({
      ...config,
      name: machineName,
      avatarUrl: PRESET_AVATARS[0].url,
      downloadDir: sysInfo?.document_dir || defaultRealPath,
      updateUrl: "",
      autoStart: false,
      port: 57088,
    });
    setUpdateStatus(null);
    setPortError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setImageError("请选择有效的图片文件（JPG/PNG/WebP/SVG）");
      setTimeout(() => setImageError(null), 3000);
      return;
    }

    try {
      const base64Avatar = await processAvatarImageFile(file);
      setFormData((prev) => ({
        ...prev,
        avatarUrl: base64Avatar,
      }));
      setImageError(null);
    } catch (err) {
      console.error("Avatar processing failed:", err);
      setImageError("图片处理失败，请重试");
      setTimeout(() => setImageError(null), 3000);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // 选择本地真实目录（支持 C/D/E/F 盘等任意磁盘目录）
  const handleSelectDirectory = async () => {
    // 1. 优先调用 Tauri 原生 IPC 命令：唤起系统文件夹选择器，可自由选择 D盘、E盘、F盘等任意绝对路径
    const selectedPath = await ipc.selectDirectory();
    if (selectedPath) {
      setFormData((prev) => ({ ...prev, downloadDir: selectedPath }));
      return;
    }

    // 2. Web 环境 showDirectoryPicker 支持
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();
        if (dirHandle && dirHandle.name) {
          const isWin =
            typeof navigator !== "undefined" &&
            navigator.userAgent.includes("Win");
          const currentDir = formData.downloadDir || defaultRealPath;
          const driveMatch = currentDir.match(/^[A-Za-z]:/);
          const base = driveMatch ? driveMatch[0] : isWin ? "D:" : "";
          const suggested = base
            ? `${base}\\${dirHandle.name}`
            : dirHandle.name;
          const confirmed = prompt(
            "选择的文件夹名称已获取，请输入或确认绝对保存路径：",
            suggested,
          );
          if (confirmed) {
            setFormData((prev) => ({ ...prev, downloadDir: confirmed.trim() }));
          }
          return;
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }
    }

    // 3. 降级提示用户手动输入任意盘符绝对路径
    const fallbackPath = prompt(
      "请输入本机文件保存目录绝对路径（例如 D:\\LAN Drop\\Files 或 E:\\Downloads）：",
      formData.downloadDir || defaultRealPath,
    );
    if (fallbackPath) {
      setFormData((prev) => ({ ...prev, downloadDir: fallbackPath.trim() }));
    }
  };

  // 检查局域网 Master 更新源
  const handleCheckUpdateNow = async () => {
    const rawIp = formData.updateUrl?.trim() || "";
    if (!rawIp) {
      setUpdateStatus("请先输入局域网 Master 机器的 IP 地址");
      setTimeout(() => setUpdateStatus(null), 3500);
      return;
    }

    setCheckingUpdate(true);
    setUpdateStatus(null);

    try {
      const res = await ipc.checkForUpdates(rawIp);
      setUpdateStatus(res.message || "检查完成");
    } catch (e: any) {
      setUpdateStatus(typeof e === "string" ? e : "检查更新遇到异常，请重试");
    } finally {
      setCheckingUpdate(false);
      setTimeout(() => setUpdateStatus(null), 6000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 text-[#cccccc]">
      <div className="bg-[#1f1f1f] border border-[#3c3c3c] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* 顶部标题栏 */}
        <div className="px-5 py-3.5 border-b border-[#2b2b2b] flex items-center justify-between bg-[#181818]">
          <div className="flex items-center space-x-2.5">
            <Settings className="w-5 h-5 text-[#38bdf8]" />
            <span className="text-sm font-semibold text-[#e0e0e0]">
              偏好设置
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#858585] hover:text-white hover:bg-[#2a2d2e] transition-colors"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 顶部标签页导航切换：用户设置 vs 系统设置 */}
        <div className="px-5 pt-3 bg-[#181818] border-b border-[#2b2b2b]">
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setActiveTab("user")}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-xl transition-all border-b-2 cursor-pointer ${
                activeTab === "user"
                  ? "bg-[#1f1f1f] text-white border-[#0078d4] font-semibold"
                  : "text-[#9d9d9d] hover:text-[#cccccc] hover:bg-[#252526] border-transparent"
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>用户设置</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("system")}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-xl transition-all border-b-2 cursor-pointer ${
                activeTab === "system"
                  ? "bg-[#1f1f1f] text-white border-[#0078d4] font-semibold"
                  : "text-[#9d9d9d] hover:text-[#cccccc] hover:bg-[#252526] border-transparent"
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>系统设置</span>
            </button>
          </div>
        </div>

        {/* 表单内容 */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          {/* 可滚动的设置项内容区域 */}
          <div className="p-5 space-y-5 text-xs overflow-y-auto custom-scrollbar bg-[#1f1f1f] flex-1">
            {/* ======================= 分区 1：用户设置 ======================= */}
            {activeTab === "user" && (
              <UserTab
                formData={formData}
                setFormData={setFormData}
                imageError={imageError}
                setImageError={setImageError}
                sysInfo={sysInfo}
                handleFileChange={handleFileChange}
                fileInputRef={fileInputRef}
              />
            )}

            {/* ======================= 分区 2：系统设置 ======================= */}
            {activeTab === "system" && (
              <SystemTab
                formData={formData}
                setFormData={setFormData}
                portError={portError}
                setPortError={setPortError}
                checkingUpdate={checkingUpdate}
                updateStatus={updateStatus}
                isRecordingHotkey={isRecordingHotkey}
                setIsRecordingHotkey={setIsRecordingHotkey}
                handleSelectDirectory={handleSelectDirectory}
                handleCheckUpdate={handleCheckUpdateNow}
                sysInfo={sysInfo}
              />
            )}
          </div>

          {/* 底部固定操作栏（恢复默认与保存设置） */}
          <div className="px-5 py-3.5 border-t border-[#2b2b2b] bg-[#181818] flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3.5 py-2 rounded-xl text-[#cccccc] hover:text-white bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>恢复默认</span>
            </button>

            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#0078d4] hover:bg-[#0284c7] active:bg-[#006cc1] text-white font-medium text-xs flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              {savedToast ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>已保存设置</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>保存设置</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
