/**
 * 手动添加目标局域网 IP 对端设备的输入弹窗组件
 * 允许用户手动输入对端设备的 IP 地址和端口号，进行单播探测与发起握手连接
 */

import React from "react";
import { ChevronDown, ChevronUp, Globe, RefreshCw, X } from "lucide-react";

interface AddIpModalProps {
  targetIpInput: string;
  setTargetIpInput: (val: string) => void;
  targetPortInput: string;
  setTargetPortInput: (val: string) => void;
  isProbing: boolean;
  probeError: string;
  onManualConnect: (e: React.FormEvent) => Promise<void>;
  onClose: () => void;
}

export const AddIpModal: React.FC<AddIpModalProps> = ({
  targetIpInput,
  setTargetIpInput,
  targetPortInput,
  setTargetPortInput,
  isProbing,
  probeError,
  onManualConnect,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-[#2b2b2b]">
          <div className="flex items-center space-x-2">
            <Globe className="w-4 h-4 text-[#38bdf8]" />
            <h3 className="text-sm font-semibold text-white">
              手动输入对端 IP 连接
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#858585] hover:text-white p-1 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={onManualConnect} className="space-y-3">
          <div>
            <label className="block text-xs text-[#858585] mb-1">
              对端电脑 IP 地址
            </label>
            <input
              type="text"
              required
              placeholder="例如: 192.168.1.108"
              value={targetIpInput}
              onChange={(e) => setTargetIpInput(e.target.value)}
              className="w-full px-3 py-2 bg-[#252526] border border-[#3c3c3c] focus:border-[#0078d4] rounded-lg text-xs text-white placeholder-[#6e7681] focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-[#858585] mb-1">
              服务端口 (默认 57088)
            </label>
            <div className="relative flex items-center">
              <input
                type="number"
                min={1024}
                max={65535}
                placeholder="57088"
                value={targetPortInput}
                onChange={(e) => setTargetPortInput(e.target.value)}
                className="w-full pl-3 pr-10 py-2 bg-[#252526] border border-[#3c3c3c] focus:border-[#0078d4] rounded-lg text-xs text-white placeholder-[#6e7681] focus:outline-none font-mono"
              />
              <div className="absolute right-1 top-1 bottom-1 flex flex-col justify-between w-6 py-0.5 border-l border-[#333333]">
                <button
                  type="button"
                  onClick={() => {
                    const cur = parseInt(targetPortInput.trim(), 10) || 57088;
                    const next = Math.min(65535, cur + 1);
                    setTargetPortInput(String(next));
                  }}
                  className="flex-1 flex items-center justify-center rounded-tr hover:bg-[#333333] active:bg-[#3c3c3c] text-[#858585] hover:text-[#38bdf8] transition-colors"
                  title="端口号 +1"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <div className="h-[1px] bg-[#333333] mx-0.5" />
                <button
                  type="button"
                  onClick={() => {
                    const cur = parseInt(targetPortInput.trim(), 10) || 57088;
                    const next = Math.max(1024, cur - 1);
                    setTargetPortInput(String(next));
                  }}
                  className="flex-1 flex items-center justify-center rounded-br hover:bg-[#333333] active:bg-[#3c3c3c] text-[#858585] hover:text-[#38bdf8] transition-colors"
                  title="端口号 -1"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

          {probeError && (
            <div className="p-2 bg-red-950/40 border border-red-800/60 rounded-lg text-[11px] text-red-300">
              {probeError}
            </div>
          )}

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs text-[#cccccc] hover:bg-[#2a2d2e]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isProbing || !targetIpInput.trim()}
              className="px-4 py-1.5 bg-[#0078d4] hover:bg-[#106ebe] disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5"
            >
              {isProbing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在探测...</span>
                </>
              ) : (
                <span>立即连接</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
