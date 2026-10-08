/** 全局截图入口和按联系人保存的待发送截图。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, isTauri } from "../services/ipc";
import { PeerDevice } from "../types";

export interface ScreenshotDraft {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

interface ScreenshotResult {
  cancelled: boolean;
  pngBase64: string | null;
  width: number;
  height: number;
  clipboardError: string | null;
}

export function useScreenshot({ selectedPeer, onSelectPeer, showToast }: {
  selectedPeer: PeerDevice | null;
  onSelectPeer: (peer: PeerDevice) => void;
  showToast: (message: string, duration?: number) => void;
}) {
  const supported = isTauri() && /Windows/i.test(navigator.userAgent);
  const [isCapturing, setIsCapturing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ScreenshotDraft[]>>({});
  const draftsRef = useRef(drafts);
  const capturingRef = useRef(false);
  const latest = useRef({ selectedPeer, onSelectPeer, showToast });
  latest.current = { selectedPeer, onSelectPeer, showToast };
  const mounted = useRef(true);

  const removeDraft = useCallback((peerId: string, id: string) => {
    const previous = draftsRef.current[peerId] ?? [];
    const removed = previous.find((draft) => draft.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    const next = { ...draftsRef.current, [peerId]: previous.filter((draft) => draft.id !== id) };
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const startScreenshot = useCallback(async () => {
    if (!supported) {
      latest.current.showToast("截图功能目前仅支持 Windows 桌面客户端");
      return;
    }
    if (capturingRef.current) return;
    capturingRef.current = true;
    setIsCapturing(true);
    const target = latest.current.selectedPeer;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<ScreenshotResult>("start_screenshot");
      if (result.cancelled || !result.pngBase64 || !mounted.current) return;
      if (target) {
        const decoded = atob(result.pngBase64);
        const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
        const file = new File([bytes], `截图-${Date.now()}.png`, { type: "image/png" });
        const draft: ScreenshotDraft = { id: crypto.randomUUID(), file,
          previewUrl: URL.createObjectURL(file), width: result.width, height: result.height };
        const next = { ...draftsRef.current, [target.id]: [...(draftsRef.current[target.id] ?? []), draft] };
        draftsRef.current = next;
        setDrafts(next);
        // 先唤醒，再恢复开始截图时的联系人，避免后台消息唤醒逻辑改变目标。
        await invoke("show_from_tray");
        latest.current.onSelectPeer(target);
        latest.current.showToast(result.clipboardError ?? "截图已复制，可预览后点击发送", result.clipboardError ? 6000 : 3000);
      } else {
        const message = result.clipboardError ?? "截图已复制到剪贴板，可粘贴到聊天或其他应用";
        latest.current.showToast(message, 5000);
        await invoke("show_system_notification", { title: "截图完成", body: message });
      }
    } catch (error) {
      if (mounted.current) latest.current.showToast(`截图未完成：${String(error)}`, 6000);
    } finally {
      capturingRef.current = false;
      if (mounted.current) setIsCapturing(false);
    }
  }, [supported]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (supported) {
      void (async () => {
        const { listen } = await import("@tauri-apps/api/event");
        const unsubscribe = await listen("screenshot://requested", () => { void startScreenshot(); });
        if (disposed) unsubscribe(); else unlisten = unsubscribe;
        if (!disposed) {
          const { invoke } = await import("@tauri-apps/api/core");
          const errors = await invoke<string[]>("get_hotkey_errors");
          if (errors.length && !disposed) latest.current.showToast(errors.join("\n"), 10000);
        }
      })().catch((error) => {
        if (!disposed) latest.current.showToast(`截图快捷键监听失败：${String(error)}`, 6000);
      });
    }
    return () => {
      disposed = true;
      mounted.current = false;
      unlisten?.();
      for (const list of Object.values(draftsRef.current)) {
        for (const draft of list) URL.revokeObjectURL(draft.previewUrl);
      }
    };
  }, [supported, startScreenshot]);

  return { supported, isCapturing, startScreenshot, drafts, removeDraft };
}
