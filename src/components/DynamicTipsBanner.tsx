/**
 * 动态提示文字轮播组件 (DynamicTipsBanner)
 * 
 * 用于在未选中用户时、或与选中用户未产生过聊天时，动态轮播展示局域网安全与使用提示。
 * 遵循 VS Code 2026 深色现代 (Dark Modern) 设计语言。
 */

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, ShieldCheck, Sparkles } from 'lucide-react';

export const APP_DYNAMIC_TIPS: string[] = [
  '发送的文件不会自动下载，接收方需点击“接收”方可写入本地磁盘',
  '局域网高速点对点直连传输，不经过任何外部服务器，保护数据隐私',
  '支持将文件或文件夹直接拖拽到聊天区域中，快速发起免流投送',
  '接收到的图片、音频、视频与文本文件支持即时在线大屏预览',
  '同一局域网（Wi-Fi/热点/内网网段）设备自动发现，无需配置 IP',
  '大文件高速内网传输，接收完成后可一键在文件管理器中定位打开',
];

interface DynamicTipsBannerProps {
  className?: string;
  variant?: 'compact' | 'card';
}

export const DynamicTipsBanner: React.FC<DynamicTipsBannerProps> = ({
  className = '',
  variant = 'compact',
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // 自动轮播（每 4.5 秒平滑切换一次）
  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % APP_DYNAMIC_TIPS.length);
    }, 4500);

    return () => clearInterval(timer);
  }, [isPaused]);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + APP_DYNAMIC_TIPS.length) % APP_DYNAMIC_TIPS.length);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % APP_DYNAMIC_TIPS.length);
  };

  if (variant === 'card') {
    return (
      <div
        className={`w-full max-w-md bg-[#252526]/80 border border-[#333333] hover:border-[#444444] rounded-2xl p-4 shadow-lg transition-all select-none ${className}`}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-lg bg-[#0078d4]/15 text-[#38bdf8]">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-semibold text-[#cccccc]">安全与使用提示</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-[#858585]">
              {currentIndex + 1} / {APP_DYNAMIC_TIPS.length}
            </span>
            <div className="flex items-center space-x-0.5">
              <button
                type="button"
                onClick={handlePrev}
                className="p-1 rounded-md text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] transition-colors cursor-pointer"
                title="上一条提示"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="p-1 rounded-md text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] transition-colors cursor-pointer"
                title="下一条提示"
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* 提示文案内容（切换淡入动画） */}
        <div
          key={currentIndex}
          onClick={handleNext}
          className="min-h-[38px] flex items-center text-xs text-[#9d9d9d] leading-relaxed cursor-pointer animate-in fade-in slide-in-from-right-1 duration-200 hover:text-[#cccccc]"
          title="点击切换下一条提示"
        >
          <p>{APP_DYNAMIC_TIPS[currentIndex]}</p>
        </div>

        {/* 底部点状指示器 */}
        <div className="flex items-center justify-center gap-1.5 mt-3 pt-2.5 border-t border-[#2b2b2b]">
          {APP_DYNAMIC_TIPS.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${
                idx === currentIndex ? 'w-5 bg-[#0078d4]' : 'w-1.5 bg-[#3c3c3c] hover:bg-[#555555]'
              }`}
              title={`提示 ${idx + 1}`}
            />
          ))}
        </div>
      </div>
    );
  }

  // compact 紧凑条形提示（用于聊天空白区）
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
      <div className="flex items-center gap-0.5 shrink-0 text-[#666666]">
        <button
          type="button"
          onClick={handlePrev}
          className="p-0.5 rounded hover:text-white hover:bg-[#2a2d2e] transition-colors"
          title="上一条"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="p-0.5 rounded hover:text-white hover:bg-[#2a2d2e] transition-colors"
          title="下一条"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
