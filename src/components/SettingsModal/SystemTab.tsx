/**
 * 设置模态窗 - 系统环境与核心参数配置面板
 * 负责配置文件默认保存路径、HTTP 文件传输端口、局域网广播端口及全局唤醒快捷键
 */

import {
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  HardDrive,
  Keyboard,
  Power,
  Radio,
  RefreshCw,
} from "lucide-react";
import React from "react";
import { getDefaultDocumentsPath } from "../../services/storage";
import { LocalDeviceConfig } from "../../types";

interface SystemTabProps {
  formData: LocalDeviceConfig;
  setFormData: React.Dispatch<React.SetStateAction<LocalDeviceConfig>>;
  portError: string | null;
  setPortError: React.Dispatch<React.SetStateAction<string | null>>;
  checkingUpdate: boolean;
  updateStatus: string | null;
  isRecordingHotkey: boolean;
  setIsRecordingHotkey: React.Dispatch<React.SetStateAction<boolean>>;
  handleSelectDirectory: () => Promise<void>;
  handleCheckUpdate: () => Promise<void>;
  sysInfo: any;
}

export const SystemTab: React.FC<SystemTabProps> = ({
  formData,
  setFormData,
  portError,
  setPortError,
  checkingUpdate,
  updateStatus,
  isRecordingHotkey,
  setIsRecordingHotkey,
  handleSelectDirectory,
  handleCheckUpdate,
  sysInfo,
}) => {
  const defaultRealPath = getDefaultDocumentsPath();
  return (
    <>
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
                onChange={(e) =>
                  setFormData({ ...formData, downloadDir: e.target.value })
                }
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
            <span>接收文件时的默认存储目录</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setFormData({
                    ...formData,
                    downloadDir: sysInfo?.document_dir || defaultRealPath,
                  })
                }
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
                服务端口号
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
              恢复默认端口
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
            <span>监听并向局域网提供服务的端口号（默认 57088）</span>
            <span className="font-mono text-[#6e7681]">1024 ~ 65535</span>
          </div>

          {portError && (
            <p className="text-[11px] text-rose-400 mt-2 font-medium">
              {portError}
            </p>
          )}
        </div>

        {/* 3. 局域网更新源 (Master IP) */}
        <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#38bdf8]" />
              <label className="font-semibold text-[#e0e0e0] text-sm">
                局域网更新源 (Master IP)
              </label>
            </div>

            <button
              type="button"
              onClick={handleCheckUpdate}
              disabled={checkingUpdate}
              className="text-[11px] text-[#38bdf8] hover:text-[#7dd3fc] font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`w-3 h-3 ${checkingUpdate ? "animate-spin" : ""}`}
              />
              <span>{checkingUpdate ? "正在检查..." : "检查更新"}</span>
            </button>
          </div>

          <input
            type="text"
            value={formData.updateUrl || ""}
            onChange={(e) =>
              setFormData({ ...formData, updateUrl: e.target.value })
            }
            placeholder="例如: 192.168.1.100"
            className="w-full px-3.5 py-2 bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#0078d4] rounded-xl text-[#cccccc] font-mono focus:outline-none transition-colors text-xs"
          />

          <p className="text-[11px] text-[#858585] mt-1.5 leading-relaxed">
            设置后程序将会在启动时，或每30分钟自动检查升级。
          </p>

          {updateStatus && (
            <div className="mt-2.5 p-2 bg-[#1e1e1e] border border-[#38bdf8]/40 rounded-lg text-[11px] text-[#7dd3fc] flex items-center gap-1.5 animate-in fade-in duration-150">
              <Check className="w-3.5 h-3.5 shrink-0 text-[#38bdf8]" />
              <span>{updateStatus}</span>
            </div>
          )}
        </div>

        {/* 4. 全局呼出快捷键 */}
        <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-[#38bdf8]" />
              <label className="font-semibold text-[#e0e0e0] text-sm">
                显示（隐藏）快捷键
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setFormData({ ...formData, globalHotkey: "Ctrl+Alt+Shift+S" })
                }
                className="text-[11px] text-[#38bdf8] hover:text-[#7dd3fc] font-medium transition-colors cursor-pointer"
              >
                默认 (Ctrl+Alt+Shift+S)
              </button>
              {formData.globalHotkey && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, globalHotkey: "" })}
                  className="text-[11px] text-[#858585] hover:text-rose-400 transition-colors cursor-pointer"
                >
                  禁用
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                readOnly
                value={
                  isRecordingHotkey
                    ? "请在键盘上按下快捷键组合（Esc 取消）..."
                    : formData.globalHotkey || "未设置 (已禁用)"
                }
                onClick={() => setIsRecordingHotkey(true)}
                className={`w-full px-3.5 py-2 border rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
                  isRecordingHotkey
                    ? "bg-[#1a2e3b] border-[#0078d4] text-[#38bdf8] animate-pulse ring-2 ring-[#0078d4]/40"
                    : formData.globalHotkey
                      ? "bg-[#1e1e1e] border-[#3c3c3c] text-[#cccccc]"
                      : "bg-[#1e1e1e] border-[#3c3c3c] text-[#6e7681]"
                }`}
              />
            </div>

            <button
              type="button"
              onClick={() => setIsRecordingHotkey(!isRecordingHotkey)}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer ${
                isRecordingHotkey
                  ? "bg-rose-600 hover:bg-rose-500 text-white"
                  : "bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] hover:border-[#0078d4] text-[#cccccc] hover:text-white"
              }`}
            >
              <span>{isRecordingHotkey ? "取消" : "更改快捷键"}</span>
            </button>
          </div>

          <p className="text-[11px] text-[#858585] mt-1.5 leading-relaxed">
            激活（呼出）程序，或将程序隐藏至托盘。
          </p>
        </div>

        {/* 5. 开机启动 */}
        <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Power className="w-4 h-4 text-[#38bdf8]" />
            <span className="font-semibold text-[#e0e0e0] text-sm">
              开机启动
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
                autoStart:
                  prev.autoStart !== undefined ? !prev.autoStart : false,
              }))
            }
            className={`w-12 h-6.5 rounded-full transition-colors relative cursor-pointer shrink-0 focus:outline-none border ${
              formData.autoStart
                ? "bg-[#0078d4] border-[#0078d4]"
                : "bg-[#2a2d2e] border-[#3c3c3c]"
            }`}
            title={formData.autoStart ? "已开启开机启动" : "已关闭开机启动"}
          >
            <span
              className={`block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 mt-0.5 ${
                formData.autoStart ? "translate-x-6" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </>
  );
};
