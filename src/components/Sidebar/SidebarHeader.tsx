/**
 * 侧边栏头部组件
 * 展示本机设备名称、IP 地址、头像、网络重新扫描按钮及系统设置打开入口
 */

import { Plus, RefreshCw, Settings } from "lucide-react";
import React from "react";
import { resolveAvatarUrl } from "../../utils/avatars";

interface SidebarHeaderProps {
  localName: string;
  localIp: string;
  localAvatarUrl?: string;
  isScanning: boolean;
  onOpenSettings: (defaultTab?: "user" | "system") => void;
  onRefreshScan: () => void;
  onShowAddIpModal: () => void;
}

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({
  localName,
  localIp,
  localAvatarUrl,
  isScanning,
  onOpenSettings,
  onRefreshScan,
  onShowAddIpModal,
}) => {
  return (
    <div className="h-16 px-3.5 border-b border-[#2b2b2b] bg-[#1f1f1f] flex items-center justify-between gap-3 shrink-0">
      <div
        className="flex items-center space-x-2.5 min-w-0 flex-1 cursor-pointer group"
        onClick={() => onOpenSettings("user")}
        title="点击打开用户设置"
      >
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-[#252526] border border-[#3c3c3c] flex items-center justify-center text-white font-bold text-sm shadow-xs group-hover:border-[#555555] transition-all">
            {localAvatarUrl ? (
              <img
                src={resolveAvatarUrl(localAvatarUrl)}
                alt={localName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-[#cccccc]">
                {localName ? localName.slice(0, 1).toUpperCase() : "U"}
              </span>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[#e0e0e0] truncate group-hover:text-white transition-colors">
            {localName}
          </div>
          <div
            className="text-[11px] font-mono text-[#858585] truncate"
            title={localIp ? `局域网IP: ${localIp}` : "正在探测当前局域网 IP"}
          >
            {localIp || "局域网在线"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onShowAddIpModal}
          className="p-2 rounded-lg text-[#858585] hover:text-[#38bdf8] hover:bg-[#2a2d2e] transition-colors"
          title="手动添加局域网用户"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={onRefreshScan}
          className="p-2 rounded-lg text-[#858585] hover:text-[#38bdf8] hover:bg-[#2a2d2e] transition-colors"
          title="重新扫描局域网用户"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isScanning ? "animate-spin text-[#38bdf8]" : ""}`}
          />
        </button>
        <button
          onClick={() => onOpenSettings("system")}
          className="p-2 rounded-lg text-[#858585] hover:text-[#e0e0e0] hover:bg-[#2a2d2e] transition-colors"
          title="打开系统设置"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
