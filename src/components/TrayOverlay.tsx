/**
 * 系统托盘后台挂起状态提示蒙层组件
 * 在窗口最小化到系统托盘或后台运行时展示交互状态指示
 */

import React from "react";
import { Activity, Eye } from "lucide-react";
import { ipc } from "../services/ipc";

interface TrayOverlayProps {
  globalHotkey: string;
}

export const TrayOverlay: React.FC<TrayOverlayProps> = ({ globalHotkey }) => {
  return (
    <div className="fixed inset-0 z-[100] bg-[#121212]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-200">
      <div className="bg-[#252526] border border-[#3c3c3c] rounded-2xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center text-center">
        <div className="relative mb-3.5">
          <div className="w-14 h-14 rounded-2xl bg-[#1e1e1e] border border-[#0078d4]/40 flex items-center justify-center text-[#0078d4] shadow-inner">
            <Activity className="w-7 h-7 text-[#0078d4]" />
          </div>
          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#252526]" />
        </div>
        <h3 className="text-base font-semibold text-[#f0f0f0]">
          LAN Drop 已隐藏至系统托盘
        </h3>
        <p className="text-xs text-[#858585] mt-1.5 leading-relaxed">
          程序正在后台静默运行中，随时可接收局域网文件与通知。
        </p>
        <div className="mt-4 px-3 py-1.5 bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg text-xs text-[#9cdcfe] font-mono flex items-center space-x-1.5">
          <span>按</span>
          <kbd className="px-1.5 py-0.5 bg-[#2d2d2d] rounded text-[11px] text-white font-bold">
            {globalHotkey}
          </kbd>
          <span>可重新呼出主窗口</span>
        </div>
        <div className="mt-5 flex items-center space-x-3 w-full">
          <button
            type="button"
            onClick={() => ipc.showFromTray()}
            className="flex-1 py-2 px-3 bg-[#0078d4] hover:bg-[#006cbd] active:scale-98 text-white text-xs font-medium rounded-lg transition-all shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
          >
            <Eye className="w-3.5 h-3.5 mr-1" />
            <span>恢复显示主界面</span>
          </button>
        </div>
      </div>

      <div
        onClick={() => ipc.showFromTray()}
        title="点击唤醒 LAN Drop 主界面"
        className="fixed bottom-4 right-4 bg-[#252526] hover:bg-[#2d2d2d] border border-[#0078d4] rounded-xl px-3.5 py-2 shadow-2xl flex items-center space-x-2.5 cursor-pointer transition-all hover:scale-105 active:scale-95 group"
      >
        <div className="w-6 h-6 rounded-lg bg-[#0078d4]/20 flex items-center justify-center text-[#0078d4]">
          <Activity className="w-3.5 h-3.5" />
        </div>
        <div className="text-left">
          <div className="text-xs font-medium text-[#e0e0e0] flex items-center space-x-1.5">
            <span>LAN Drop</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="text-[10px] text-[#858585] group-hover:text-[#9cdcfe]">
            已常驻后台 · 点击恢复
          </div>
        </div>
      </div>
    </div>
  );
};
