/**
 * 侧边栏联系人与会话关键字搜索过滤栏组件
 * 支持按设备名称或 IP 地址对联系人列表进行即时实时过滤
 */

import React from "react";
import { Search, X } from "lucide-react";

interface SidebarSearchProps {
  search: string;
  setSearch: (val: string) => void;
}

export const SidebarSearch: React.FC<SidebarSearchProps> = ({
  search,
  setSearch,
}) => {
  return (
    <div className="p-3 border-b border-[#2b2b2b] bg-[#181818]">
      <div className="relative flex-1">
        <Search className="w-3.5 h-3.5 text-[#858585] absolute left-2.5 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索文件名称或联系人..."
          className="w-full pl-8 pr-7 py-1.5 bg-[#252526] border border-[#3c3c3c] focus:border-[#0078d4] rounded-lg text-xs text-[#cccccc] placeholder-[#6e7681] focus:outline-none transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-2 text-[#858585] hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
