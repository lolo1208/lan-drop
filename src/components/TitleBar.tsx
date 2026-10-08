/** 与应用深色主题一致的自定义窗口标题栏。 */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { isTauri } from "../utils/tauri";

const appIcon = new URL("../../src-tauri/icons/32x32.png", import.meta.url).href;

interface TitleBarProps {
  onError: (message: string) => void;
}

export function TitleBar({ onError }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncMaximized = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (!disposed) setIsMaximized(maximized);
      } catch (error) {
        console.warn("读取窗口最大化状态失败：", error);
      }
    };

    // 系统快捷键、双击标题栏和拖动还原后也同步按钮状态。
    appWindow.onResized(syncMaximized).then((cleanup) => {
      if (disposed) cleanup();
      else {
        unlisten = cleanup;
        void syncMaximized();
      }
    }).catch((error) => console.warn("监听窗口尺寸变化失败：", error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop]);

  const handleAction = async (action: "minimize" | "maximize" | "close") => {
    if (!desktop) return;
    try {
      const appWindow = getCurrentWindow();
      if (action === "minimize") await appWindow.minimize();
      else if (action === "close") await appWindow.close();
      else {
        await appWindow.toggleMaximize();
        setIsMaximized(await appWindow.isMaximized());
      }
    } catch (error) {
      console.warn("窗口操作失败：", error);
      onError("窗口操作失败，请重试");
    }
  };

  const buttonClass = "flex h-full w-12 items-center justify-center text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white active:bg-[#37373d] focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-[#0078d4] disabled:opacity-40 disabled:pointer-events-none";
  const maximizeLabel = isMaximized ? "还原" : "最大化";

  return (
    <header className="flex h-9 shrink-0 items-center border-b border-[#2b2b2b] bg-[#181818] select-none">
      <div data-tauri-drag-region className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-3.5">
        <img src={appIcon} alt="" draggable={false} className="pointer-events-none h-4 w-4 shrink-0" />
        <span className="pointer-events-none truncate text-xs text-[#cccccc]">内网投送 (LAN Drop)</span>
      </div>
      <div role="group" aria-label="窗口控制" className="flex h-full shrink-0">
        <button type="button" aria-label="最小化" title="最小化" disabled={!desktop} className={buttonClass} onClick={() => void handleAction("minimize")}>
          <Minus size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button type="button" aria-label={maximizeLabel} title={maximizeLabel} disabled={!desktop} className={buttonClass} onClick={() => void handleAction("maximize")}>
          {isMaximized ? <Copy size={13} strokeWidth={1.5} aria-hidden="true" /> : <Square size={12} strokeWidth={1.5} aria-hidden="true" />}
        </button>
        <button type="button" aria-label="关闭" title="关闭（隐藏到托盘）" disabled={!desktop} className={`${buttonClass} hover:!bg-[#c42b1c] active:!bg-[#a92318]`} onClick={() => void handleAction("close")}>
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
