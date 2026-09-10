/**
 * 局域网动态提示与状态横幅组件
 * 提供轮播展示局域网使用技巧、传输安全提示与操作指引
 */

import { Info } from "lucide-react";
import React, { useEffect, useState } from "react";

export const APP_DYNAMIC_TIPS: string[] = [
  "同一局域网（Wi-Fi/热点/内网）设备自动发现，若未找到可点击“+”手动添加 IP",
  "局域网高速点对点直连传输，不经过任何外部服务器，保护数据隐私",
  "支持将文件或图片直接拖拽到聊天面板或输入框，快速发起免流投送",
  "接收普通文件需点击“接收”，多媒体文件（图片/音视频）支持即时在线大屏预览",
  "文件传输支持断点续传，若传输异常中断可随时点击“继续接收”恢复进度",
  "传输完成后点击“定位文件”，可一键在系统文件管理器中打开所在目录",
  "可在系统设置中修改文件默认存储目录、服务端口号及显示隐藏快捷键",
  "按下快捷键或关闭窗口可最小化至系统托盘，后台持续接收新消息与文件",
  "支持在左侧侧边栏通过设备名称或 IP 地址快速搜索过滤局域网联系人",
  "点击左上方本机头像可快速进入用户设置，修改设备昵称与专属头像",
];

interface DynamicTipsBannerProps {
  className?: string;
  variant?: "compact" | "card"; // 保持向下兼容参数，统一采用紧凑条形界面
}

export const DynamicTipsBanner: React.FC<DynamicTipsBannerProps> = ({
  className = "",
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // 自动轮播（每 5 秒平滑切换一次提示）
  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % APP_DYNAMIC_TIPS.length);
    }, 5000);

    return () => clearInterval(timer);
  }, [isPaused]);

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % APP_DYNAMIC_TIPS.length);
  };

  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#252526]/70 border border-[#333333] hover:border-[#444444] text-xs text-[#858585] hover:text-[#cccccc] shadow-xs select-none transition-all max-w-lg cursor-pointer ${className}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onClick={handleNext}
      title="点击切换下一条使用提示"
    >
      <Info className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
      <span
        key={currentIndex}
        className="animate-in fade-in slide-in-from-right-1 duration-200 flex-1 text-center"
      >
        {APP_DYNAMIC_TIPS[currentIndex]}
      </span>
    </div>
  );
};
