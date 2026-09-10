/**
 * 系统托盘状态管理、全局快捷键唤醒与系统通知弹窗 Hook
 * 管理窗口最小化到系统托盘状态、注册全局热键唤醒主界面以及在后台静默时分发桌面系统通知
 */

import { useState, useEffect, useRef } from "react";
import { ipc, isTauri } from "../services/ipc";
import { ChatMessage, LocalDeviceConfig } from "../types";
import { isDisplayableMessage } from "./useChatSync";

interface UseSystemTrayProps {
  config: LocalDeviceConfig;
  onFocusPeerAndMessage?: (msg: ChatMessage) => void;
}

export function useSystemTray({
  config,
  onFocusPeerAndMessage,
}: UseSystemTrayProps) {
  const [isHiddenToTray, setIsHiddenToTray] = useState(false);
  const latestBackgroundMsgRef = useRef<ChatMessage | null>(null);
  const notifiedMsgIdsRef = useRef<Set<string>>(new Set());

  // 保持最新的 config 引用避免快捷键闭包陷阱
  const configRef = useRef<LocalDeviceConfig>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const onFocusPeerAndMessageRef = useRef(onFocusPeerAndMessage);
  useEffect(() => {
    onFocusPeerAndMessageRef.current = onFocusPeerAndMessage;
  }, [onFocusPeerAndMessage]);

  // 全局阻止浏览器拖拽本地文件的默认打开/导航行为
  useEffect(() => {
    const handleGlobalDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const handleGlobalDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    window.addEventListener("dragover", handleGlobalDragOver);
    window.addEventListener("drop", handleGlobalDrop);

    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
      window.removeEventListener("drop", handleGlobalDrop);
    };
  }, []);

  // 监听窗口与托盘事件（单次挂载）
  useEffect(() => {
    // 监听窗口从托盘唤醒恢复事件，自动定位至最新发信联系人与消息
    const unsubRestore = ipc.on("app://restored_from_tray", () => {
      setIsHiddenToTray(false);
      if (latestBackgroundMsgRef.current && onFocusPeerAndMessageRef.current) {
        onFocusPeerAndMessageRef.current(latestBackgroundMsgRef.current);
        latestBackgroundMsgRef.current = null;
      }
    });

    // 监听底层与 Web 模拟托盘状态变化
    const unsubTrayState = ipc.on<boolean>(
      "app://window_hidden_to_tray",
      (hidden) => {
        setIsHiddenToTray(!!hidden);
      },
    );

    // 全局组合热键监听呼出/隐藏前台窗口
    const handleGlobalHotkeyPress = async (e: KeyboardEvent) => {
      const activeHotkey =
        configRef.current?.globalHotkey ||
        ipc.getLocalConfig().globalHotkey ||
        "Ctrl+Alt+Shift+S";
      if (!activeHotkey) return;

      const parts = activeHotkey.split("+").map((s) => s.trim().toLowerCase());
      const needsCtrlOrCmd =
        parts.includes("ctrl") ||
        parts.includes("cmd") ||
        parts.includes("meta") ||
        parts.includes("control");
      const needsAlt = parts.includes("alt") || parts.includes("option");
      const needsShift = parts.includes("shift");

      const targetKey = parts.find(
        (p) =>
          ![
            "ctrl",
            "cmd",
            "meta",
            "control",
            "alt",
            "option",
            "shift",
          ].includes(p),
      );

      if (!targetKey) return;

      let keyMatch = false;
      const pressedKey = e.key.toLowerCase();
      const pressedCode = e.code ? e.code.toLowerCase() : "";

      if (
        targetKey === "space" &&
        (pressedCode === "space" || e.key === " " || pressedKey === "space")
      ) {
        keyMatch = true;
      } else if (
        targetKey === "s" &&
        (pressedKey === "s" || pressedCode === "keys")
      ) {
        keyMatch = true;
      } else if (
        pressedKey === targetKey ||
        pressedCode === `key${targetKey}` ||
        pressedCode === `digit${targetKey}` ||
        pressedCode === targetKey
      ) {
        keyMatch = true;
      }

      const hasCtrlOrCmd = e.ctrlKey || e.metaKey;
      const ctrlMatch = needsCtrlOrCmd ? hasCtrlOrCmd : !hasCtrlOrCmd;
      const altMatch = needsAlt ? e.altKey : !e.altKey;
      const shiftMatch = needsShift ? e.shiftKey : !e.shiftKey;

      if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
        e.preventDefault();
        e.stopPropagation();
        await ipc.toggleWindow();
      }
    };

    const handleWindowFocus = () => {
      if (latestBackgroundMsgRef.current && onFocusPeerAndMessageRef.current) {
        onFocusPeerAndMessageRef.current(latestBackgroundMsgRef.current);
        latestBackgroundMsgRef.current = null;
      }
    };

    window.addEventListener("keydown", handleGlobalHotkeyPress, true);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      window.removeEventListener("keydown", handleGlobalHotkeyPress, true);
      window.removeEventListener("focus", handleWindowFocus);
      unsubRestore();
      unsubTrayState();
    };
  }, []);

  // 后台通知处理
  const notifyIncomingMessage = async (msg: ChatMessage) => {
    if (!msg || msg.senderId === config.id || !isDisplayableMessage(msg))
      return;

    const now = Date.now();
    const isFresh = !msg.timestamp || Math.abs(now - msg.timestamp) < 45000;
    if (!isFresh) return;

    if (notifiedMsgIdsRef.current.has(msg.id)) return;
    notifiedMsgIdsRef.current.add(msg.id);
    if (notifiedMsgIdsRef.current.size > 500) {
      notifiedMsgIdsRef.current.clear();
    }

    const isActive = await ipc.isWindowActive();
    if (!isActive) {
      latestBackgroundMsgRef.current = msg;

      if (
        !isTauri() &&
        typeof window !== "undefined" &&
        "Notification" in window
      ) {
        const senderName = msg.senderName || "局域网设备";
        let bodyText = "";
        if (msg.fileAttachment) {
          if (msg.fileAttachment.isMedia || msg.msgType === "image") {
            bodyText = `[图片] ${msg.fileAttachment.name}`;
          } else if (msg.msgType === "video") {
            bodyText = `[视频] ${msg.fileAttachment.name}`;
          } else if (msg.msgType === "audio") {
            bodyText = `[语音/音频] ${msg.fileAttachment.name}`;
          } else {
            bodyText = `[文件] ${msg.fileAttachment.name}`;
          }
        } else {
          bodyText = msg.content || "发来一条新消息";
        }

        const handleNotificationClick = async () => {
          await ipc.showFromTray();
          if (onFocusPeerAndMessageRef.current) {
            onFocusPeerAndMessageRef.current(msg);
          }
          latestBackgroundMsgRef.current = null;
          try {
            window.focus();
          } catch {
            // ignore
          }
        };

        if (Notification.permission === "granted") {
          const notif = new Notification(senderName, {
            body: bodyText,
            icon: msg.senderAvatarUrl || "/icon.png",
            tag: `msg-${msg.senderId}`,
          });
          notif.onclick = () => {
            handleNotificationClick();
            notif.close();
          };
        }
      }
    }
  };

  return {
    isHiddenToTray,
    notifyIncomingMessage,
  };
}
