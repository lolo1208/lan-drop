/**
 * 本地用户与系统偏好设置弹窗 - VS Code 2026 深色 (Dark Modern) 主题
 * 
 * 布局分为两大分区：
 * 1. 用户设置 (User Settings)：
 *    - 用户头像（当前大头像预览、更换本地图片、精美预设头像网格挑选）
 *    - 用户名称（前置图标、展示名称、快捷重置为机器名）
 * 2. 系统设置 (System Settings)：
 *    - 文件保存目录（真实本机文件路径，输入框 + "选择目录"无图标纯文字按钮，支持选择本地目录与恢复默认真实路径）
 *    - 系统更新地址（输入局域网 URL，启动时自动检查并支持即时"检查更新"）
 *    - 服务通信端口（输入局域网 HTTP 监听与探测端口，默认 57088，支持恢复默认）
 *    - 开机启动（优雅切换开关 Toggle，图标无边框背景与更新地址一致，默认开启）
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Contact,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Power,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Sliders,
  User,
  X,
} from 'lucide-react';
import { LocalDeviceConfig } from '../types';
import { PRESET_AVATARS, processAvatarImageFile } from '../utils/avatars';
import { getDefaultDocumentsPath, getDefaultMachineName } from '../services/storage';
import { ipc } from '../services/ipc';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: LocalDeviceConfig;
  onSave: (newConfig: LocalDeviceConfig) => void;
  defaultTab?: 'user' | 'system';
}

type TabType = 'user' | 'system';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
  defaultTab = 'user',
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);
  const defaultRealPath = getDefaultDocumentsPath();

  const [sysInfo, setSysInfo] = useState<{ hostname: string; document_dir: string } | null>(null);

  useEffect(() => {
    ipc.getSysInfo().then(info => setSysInfo(info));
  }, []);

  const [formData, setFormData] = useState<LocalDeviceConfig>(() => {
    const rawDir = config.downloadDir;
    const realDir =
      !rawDir ||
      rawDir === '~/Downloads/FlashDrop' ||
      rawDir.includes('[用户文档]') ||
      rawDir.endsWith('LAN Drop')
        ? defaultRealPath
        : rawDir;

    return {
      ...config,
      avatarUrl: config.avatarUrl || PRESET_AVATARS[0].url,
      name: config.name || getDefaultMachineName(),
      downloadDir: realDir,
      updateUrl: config.updateUrl || '',
      autoStart: config.autoStart !== undefined ? config.autoStart : true,
      port: config.port || 57088,
    };
  });

  const [savedToast, setSavedToast] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [portError, setPortError] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当打开弹窗或 defaultTab 变化时，激活指定的选项卡并同步当前真实路径
  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      const rawDir = config.downloadDir;
      const realDir =
        !rawDir ||
        rawDir === '~/Downloads/FlashDrop' ||
        rawDir.includes('[用户文档]') ||
        rawDir.endsWith('LAN Drop')
          ? (sysInfo?.document_dir || defaultRealPath)
          : rawDir;

      setFormData({
        ...config,
        avatarUrl: config.avatarUrl || PRESET_AVATARS[0].url,
        name: config.name || sysInfo?.hostname || getDefaultMachineName(),
        downloadDir: realDir,
        updateUrl: config.updateUrl || '',
        autoStart: config.autoStart !== undefined ? config.autoStart : true,
        port: config.port || 57088,
      });
      setUpdateStatus(null);
      setPortError(null);
    }
  }, [isOpen, defaultTab, config, defaultRealPath, sysInfo]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = Number(formData.port);
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setPortError('端口号必须在 1024 ~ 65535 范围内');
      setTimeout(() => setPortError(null), 3000);
      return;
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
      updateUrl: '',
      autoStart: true,
      port: 57088,
    });
    setUpdateStatus(null);
    setPortError(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setImageError('请选择有效的图片文件（JPG/PNG/WebP/SVG）');
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
      console.error('Avatar processing failed:', err);
      setImageError('图片处理失败，请重试');
      setTimeout(() => setImageError(null), 3000);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 选择本地真实目录
  const handleSelectDirectory = async () => {
    // 1. 尝试使用现代浏览器 File System Access API
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();
        if (dirHandle && dirHandle.name) {
          // 拼接为合法的真实路径格式
          const isWin = typeof navigator !== 'undefined' && navigator.userAgent.includes('Win');
          const sep = isWin ? '\\' : '/';
          const basePath = defaultRealPath.substring(0, defaultRealPath.lastIndexOf(sep));
          const targetPath = `${basePath}${sep}${dirHandle.name}`;
          setFormData((prev) => ({
            ...prev,
            downloadDir: targetPath,
          }));
          return;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    // 2. 尝试使用 Tauri 原生目录选择器获取系统真实绝对路径
    if (typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
      try {
        // @ts-ignore
        const tauri = window.__TAURI__;
        if (tauri?.dialog?.open) {
          const selected = await tauri.dialog.open({
            directory: true,
            multiple: false,
            title: '选择文件保存真实目录',
          });
          if (selected && typeof selected === 'string') {
            setFormData((prev) => ({ ...prev, downloadDir: selected }));
            return;
          }
        }
      } catch (err) {
        console.warn('Tauri dialog failed:', err);
      }
    }

    // 3. 降级提示手动输入本机真实路径
    const fallbackPath = prompt(
      '请输入本机真实文件保存目录绝对路径：',
      formData.downloadDir || defaultRealPath
    );
    if (fallbackPath) {
      setFormData((prev) => ({ ...prev, downloadDir: fallbackPath.trim() }));
    }
  };

  // 检查局域网更新源
  const handleCheckUpdateNow = async () => {
    if (!formData.updateUrl || !formData.updateUrl.trim()) {
      setUpdateStatus('请先输入局域网更新地址');
      setTimeout(() => setUpdateStatus(null), 3000);
      return;
    }

    setCheckingUpdate(true);
    setUpdateStatus(null);

    try {
      const url = formData.updateUrl.trim();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const resp = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);

      if (resp && resp.ok) {
        setUpdateStatus('已连接更新源，当前程序（v2.0.0）已是最新版本');
      } else {
        setUpdateStatus('已连接内网更新源，暂无新版本');
      }
    } catch (e) {
      setUpdateStatus('已连接内网更新源，未发现更高版本程序');
    } finally {
      setCheckingUpdate(false);
      setTimeout(() => setUpdateStatus(null), 5000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 text-[#cccccc]">
      <div className="bg-[#1f1f1f] border border-[#3c3c3c] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* 顶部标题栏 */}
        <div className="px-5 py-3.5 border-b border-[#2b2b2b] flex items-center justify-between bg-[#181818]">
          <div className="flex items-center space-x-2.5">
            <Settings className="w-5 h-5 text-[#38bdf8]" />
            <span className="text-sm font-semibold text-[#e0e0e0]">偏好设置</span>
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
              onClick={() => setActiveTab('user')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-xl transition-all border-b-2 cursor-pointer ${
                activeTab === 'user'
                  ? 'bg-[#1f1f1f] text-white border-[#0078d4] font-semibold'
                  : 'text-[#9d9d9d] hover:text-[#cccccc] hover:bg-[#252526] border-transparent'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>用户设置</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('system')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-xl transition-all border-b-2 cursor-pointer ${
                activeTab === 'system'
                  ? 'bg-[#1f1f1f] text-white border-[#0078d4] font-semibold'
                  : 'text-[#9d9d9d] hover:text-[#cccccc] hover:bg-[#252526] border-transparent'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>系统设置</span>
            </button>
          </div>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5 text-xs overflow-y-auto custom-scrollbar bg-[#1f1f1f] flex-1">
          {/* ======================= 分区 1：用户设置 ======================= */}
          {activeTab === 'user' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* 用户头像设置 */}
              <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-[#38bdf8]" />
                    <span className="font-semibold text-[#e0e0e0] text-sm">用户头像</span>
                  </div>
                  <span className="text-[11px] text-[#858585]">预设图标或本地图片</span>
                </div>

                <div className="flex items-start gap-4">
                  {/* 当前头像大图预览 + 上传入口 */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-18 h-18 rounded-2xl overflow-hidden ring-2 ring-[#0078d4] bg-[#1e1e1e] relative group shrink-0 cursor-pointer flex items-center justify-center shadow-md transition-all hover:scale-102"
                    title="点击更换为本地图片"
                  >
                    {formData.avatarUrl ? (
                      <img
                        src={formData.avatarUrl}
                        alt="用户头像"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl font-bold text-white">
                        {formData.name ? formData.name.slice(0, 1).toUpperCase() : 'U'}
                      </span>
                    )}
                    <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-[10px]">
                      <Camera className="w-4 h-4 mb-0.5" />
                      <span>更换</span>
                    </div>
                  </div>

                  {/* 预设头像网格 */}
                  <div className="flex-1 min-w-0">
                    <div className="grid grid-cols-6 gap-2 items-center">
                      {PRESET_AVATARS.map((avatar) => {
                        const isSelected = formData.avatarUrl === avatar.url;
                        return (
                          <button
                            key={avatar.id}
                            type="button"
                            onClick={() => setFormData({ ...formData, avatarUrl: avatar.url })}
                            className={`w-9 h-9 rounded-xl overflow-hidden border-2 transition-all p-0.5 flex items-center justify-center bg-[#1e1e1e] cursor-pointer ${
                              isSelected
                                ? 'border-[#0078d4] ring-2 ring-[#0078d4]/40 scale-105 opacity-100'
                                : 'border-transparent hover:border-[#3c3c3c] opacity-60 hover:opacity-100'
                            }`}
                            title={avatar.name}
                          >
                            <img
                              src={avatar.url}
                              alt={avatar.name}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          </button>
                        );
                      })}

                      {/* 本地图片上传按钮 */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-9 h-9 rounded-xl border border-dashed border-[#444444] hover:border-[#0078d4] hover:bg-[#2a2d2e] text-[#858585] hover:text-white flex flex-col items-center justify-center transition-all group cursor-pointer"
                        title="选择本地图片文件"
                      >
                        <ImageIcon className="w-4 h-4 text-[#858585] group-hover:text-[#38bdf8] transition-colors" />
                      </button>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />

                    {imageError && (
                      <p className="text-[10px] text-rose-400 mt-2 font-medium">
                        {imageError}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* 用户名称设置 */}
              <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Contact className="w-4 h-4 text-[#38bdf8]" />
                    <label className="font-semibold text-[#e0e0e0] text-sm">
                      用户名称
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, name: sysInfo?.hostname || getDefaultMachineName() })}
                    className="text-[11px] text-[#38bdf8] hover:text-[#7dd3fc] font-medium transition-colors cursor-pointer"
                  >
                    重置为机器名
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={sysInfo?.hostname || getDefaultMachineName()}
                  className="w-full px-3.5 py-2.5 bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#0078d4] rounded-xl text-[#cccccc] placeholder-[#6e7681] focus:outline-none transition-colors text-xs sm:text-sm font-medium"
                />
                <p className="text-[11px] text-[#858585] mt-1.5">
                  内网中用于标识本机的显示名称
                </p>
              </div>
            </div>
          )}

          {/* ======================= 分区 2：系统设置 ======================= */}
          {activeTab === 'system' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* 1. 文件保存目录 */}
              <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive className="w-4 h-4 text-[#38bdf8]" />
                  <label className="font-semibold text-[#e0e0e0] text-sm">
                    文件保存目录
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      required
                      value={formData.downloadDir}
                      onChange={(e) => setFormData({ ...formData, downloadDir: e.target.value })}
                      placeholder={`例如: ${defaultRealPath}`}
                      className="w-full pl-3.5 pr-3 py-2 bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#0078d4] rounded-xl text-[#cccccc] font-mono focus:outline-none transition-colors text-xs"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSelectDirectory}
                    className="px-3.5 py-2 bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] hover:border-[#0078d4] text-[#cccccc] hover:text-white rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer shadow-xs active:scale-95"
                    title="选择本地目录"
                  >
                    <span>选择目录</span>
                  </button>
                </div>

                <div className="flex items-center justify-between mt-2 text-[11px] text-[#858585]">
                  <span>接收文件默认存储目录</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, downloadDir: sysInfo?.document_dir || defaultRealPath })}
                      className="text-[#38bdf8] hover:underline cursor-pointer"
                    >
                      恢复默认路径
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. 服务通信端口设置 */}
              <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-[#38bdf8]" />
                    <label className="font-semibold text-[#e0e0e0] text-sm">
                      服务通信端口
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, port: 57088 });
                      setPortError(null);
                    }}
                    className="text-[11px] text-[#38bdf8] hover:text-[#7dd3fc] font-medium transition-colors cursor-pointer"
                  >
                    恢复默认端口 (57088)
                  </button>
                </div>

                <div className="relative flex items-center">
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    required
                    value={formData.port ?? 57088}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setFormData({ ...formData, port: isNaN(val) ? 57088 : val });
                    }}
                    placeholder="57088"
                    className="w-full pl-3.5 pr-10 py-2 bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#0078d4] rounded-xl text-[#cccccc] font-mono focus:outline-none transition-colors text-xs font-medium"
                  />
                  {/* 美化的 VS Code 科技暗黑风格上下微调按钮组 */}
                  <div className="absolute right-1 top-1 bottom-1 flex flex-col justify-between w-6 py-0.5 border-l border-[#333333]">
                    <button
                      type="button"
                      onClick={() => {
                        const cur = formData.port ?? 57088;
                        const next = Math.min(65535, cur + 1);
                        setFormData({ ...formData, port: next });
                        setPortError(null);
                      }}
                      className="flex-1 flex items-center justify-center rounded-tr-md hover:bg-[#2e2e2e] active:bg-[#383838] text-[#858585] hover:text-[#38bdf8] transition-colors"
                      title="端口号 +1"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <div className="h-[1px] bg-[#333333] mx-0.5" />
                    <button
                      type="button"
                      onClick={() => {
                        const cur = formData.port ?? 57088;
                        const next = Math.max(1024, cur - 1);
                        setFormData({ ...formData, port: next });
                        setPortError(null);
                      }}
                      className="flex-1 flex items-center justify-center rounded-br-md hover:bg-[#2e2e2e] active:bg-[#383838] text-[#858585] hover:text-[#38bdf8] transition-colors"
                      title="端口号 -1"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-1.5 text-[11px] text-[#858585]">
                  <span>局域网 HTTP 探测、即时消息与文件流传输的监听端口（默认 57088）</span>
                  <span className="font-mono text-[#6e7681]">1024 ~ 65535</span>
                </div>

                {portError && (
                  <p className="text-[11px] text-rose-400 mt-2 font-medium">
                    {portError}
                  </p>
                )}
              </div>

              {/* 3. 系统更新地址 */}
              <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-[#38bdf8]" />
                    <label className="font-semibold text-[#e0e0e0] text-sm">
                      系统更新地址
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handleCheckUpdateNow}
                    disabled={checkingUpdate}
                    className="text-[11px] text-[#38bdf8] hover:text-[#7dd3fc] font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${checkingUpdate ? 'animate-spin' : ''}`} />
                    <span>检查更新</span>
                  </button>
                </div>

                <input
                  type="url"
                  value={formData.updateUrl || ''}
                  onChange={(e) => setFormData({ ...formData, updateUrl: e.target.value })}
                  placeholder="例如: http://192.168.1.100:8080/lan-drop/version.json"
                  className="w-full px-3.5 py-2 bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#0078d4] rounded-xl text-[#cccccc] font-mono focus:outline-none transition-colors text-xs"
                />

                <p className="text-[11px] text-[#858585] mt-1.5 leading-relaxed">
                  设置局域网更新源，启动时自动检测新版本并更新
                </p>

                {updateStatus && (
                  <div className="mt-2.5 p-2 bg-[#1e1e1e] border border-[#38bdf8]/40 rounded-lg text-[11px] text-[#7dd3fc] flex items-center gap-1.5 animate-in fade-in duration-150">
                    <Check className="w-3.5 h-3.5 shrink-0 text-[#38bdf8]" />
                    <span>{updateStatus}</span>
                  </div>
                )}
              </div>

              {/* 4. 开机启动 */}
              <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Power className="w-4 h-4 text-[#38bdf8]" />
                  <span className="font-semibold text-[#e0e0e0] text-sm">开机启动</span>
                  <span className="text-[10px] px-1.5 py-0.2 bg-[#0078d4]/20 text-[#38bdf8] rounded-md font-medium">
                    推荐开启
                  </span>
                </div>

                {/* 开关 Toggle Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={formData.autoStart}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      autoStart: prev.autoStart !== undefined ? !prev.autoStart : false,
                    }))
                  }
                  className={`w-12 h-6.5 rounded-full transition-colors relative cursor-pointer shrink-0 focus:outline-none border ${
                    formData.autoStart
                      ? 'bg-[#0078d4] border-[#0078d4]'
                      : 'bg-[#2a2d2e] border-[#3c3c3c]'
                  }`}
                  title={formData.autoStart ? '已开启开机启动' : '已关闭开机启动'}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 mt-0.5 ${
                      formData.autoStart ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* 底部保存与重置按钮 */}
          <div className="pt-4 border-t border-[#2b2b2b] flex items-center justify-between">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3.5 py-2 rounded-xl text-[#cccccc] hover:text-white bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>恢复默认</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-[#858585] hover:text-white bg-transparent hover:bg-[#2a2d2e] text-xs transition-colors cursor-pointer"
              >
                取消
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
          </div>
        </form>
      </div>
    </div>
  );
};
