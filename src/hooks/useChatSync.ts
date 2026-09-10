/**
 * 聊天消息与文件流事件监听、排重持久化与状态更新 Hook
 * 监听底层聊天消息与实时传输进度，实现消息去重、已读标记同步以及历史记录本地加载
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import confetti from "canvas-confetti";
import { ipc, isTauri } from "../services/ipc";
import { storageService } from "../services/storage";
import { chatManager } from "../services/chat";
import {
  ChatMessage,
  LocalDeviceConfig,
  PeerDevice,
  TransferTask,
} from "../types";

// 校验是否为展示型消息（过滤握手/文件同意等纯信令消息）
export const isDisplayableMessage = (m: ChatMessage): boolean => {
  if (!m) return false;
  if (m.msgType === "system") return false;
  if (m.content && m.content.startsWith("file_accept:")) return false;
  if (!m.fileAttachment && (!m.content || !m.content.trim())) return false;
  return true;
};

// 消息排重辅助函数
export const deduplicateMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const map = new Map<string, ChatMessage>();
  for (const m of messages) {
    if (m && m.id && isDisplayableMessage(m)) {
      map.set(m.id, m);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
};

// 插入或更新单条消息
export const upsertMessage = (
  list: ChatMessage[],
  newMsg: ChatMessage,
): ChatMessage[] => {
  if (!isDisplayableMessage(newMsg)) return list;
  const index = list.findIndex((m) => m.id === newMsg.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = { ...next[index], ...newMsg };
    return next;
  }
  return [...list, newMsg].sort((a, b) => a.timestamp - b.timestamp);
};

interface UseChatSyncProps {
  config: LocalDeviceConfig;
  peers: PeerDevice[];
  selectedPeer: PeerDevice | null;
  setSelectedPeer: (peer: PeerDevice | null) => void;
  onIncomingBackgroundMessage?: (msg: ChatMessage) => void;
  onToast?: (msg: string, duration?: number) => void;
}

export function useChatSync({
  config,
  peers,
  selectedPeer,
  setSelectedPeer,
  onIncomingBackgroundMessage,
  onToast,
}: UseChatSyncProps) {
  const [allChats, setAllChats] = useState<ChatMessage[]>([]);
  const [, setTransfers] = useState<TransferTask[]>([]);

  // 维护引用，防止由于闭包依赖导致监听器反复卸载与重挂，从而杜绝无限微任务死循环
  const peersRef = useRef(peers);
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  const selectedPeerRef = useRef(selectedPeer);
  useEffect(() => {
    selectedPeerRef.current = selectedPeer;
  }, [selectedPeer]);

  const onIncomingBackgroundMessageRef = useRef(onIncomingBackgroundMessage);
  useEffect(() => {
    onIncomingBackgroundMessageRef.current = onIncomingBackgroundMessage;
  }, [onIncomingBackgroundMessage]);

  // 标记单个联系人的消息为已读并发送局域网已读回执
  const handleMarkPeerRead = useCallback(
    async (peerId: string) => {
      if (!peerId) return;

      let hasStateUnread = false;
      setAllChats((prev) => {
        hasStateUnread = prev.some(
          (m) =>
            (m.peerId === peerId || m.senderId === peerId) &&
            m.senderId !== config.id &&
            !m.isRead,
        );
        if (!hasStateUnread) return prev;
        return prev.map((m) => {
          if (
            (m.peerId === peerId || m.senderId === peerId) &&
            m.senderId !== config.id &&
            !m.isRead
          ) {
            return { ...m, isRead: true, readTimestamp: Date.now() };
          }
          return m;
        });
      });

      const updatedDbCount = await storageService.markPeerMessagesAsRead(
        peerId,
        config.id,
      );

      // 仅当确实存在未读消息被标记为已读时，才触发局域网已读回执网络请求
      if (hasStateUnread || updatedDbCount > 0) {
        const currentPeers = peersRef.current;
        const targetPeer = currentPeers.find((p) => p.id === peerId) || peerId;
        chatManager.sendReadReceipt(targetPeer);
      }
    },
    [config.id],
  );

  const handleMarkPeerReadRef = useRef(handleMarkPeerRead);
  useEffect(() => {
    handleMarkPeerReadRef.current = handleMarkPeerRead;
  }, [handleMarkPeerRead]);

  // 核心初始化与事件监听（仅在组件初始化或本地设备 ID 变更时挂载一次，绝对禁止频繁重绑）
  useEffect(() => {
    let isCancelled = false;

    storageService.getAllTransfers().then((list) => {
      if (!isCancelled) setTransfers(list);
    });

    storageService.getAllChats().then(async (list) => {
      if (isCancelled) return;
      const deduped = deduplicateMessages(list);
      setAllChats(deduped);

      // 应用冷启动时，针对中断的传输任务校对本地已落盘的部分临时文件大小
      if (isTauri()) {
        for (const m of deduped) {
          if (
            m.fileAttachment &&
            (m.fileAttachment.state === "failed" ||
              m.fileAttachment.state === "transferring")
          ) {
            try {
              const diskSize = await ipc.getPartialFileSize(
                m.fileAttachment.name,
              );
              if (diskSize > 0 && diskSize < m.fileAttachment.size) {
                m.fileAttachment.state = "failed";
                m.fileAttachment.transferredBytes = diskSize;
                m.fileAttachment.progress = Number(
                  ((diskSize / m.fileAttachment.size) * 100).toFixed(1),
                );
                setAllChats((prev) => upsertMessage(prev, m));
                storageService.saveChatMessage(m).catch(() => {});
              }
            } catch {
              // ignore
            }
          }
        }
      }
    });

    // 监听聊天消息更新与接收
    const unsubChat = ipc.on<ChatMessage>("chat://updated", (msg) => {
      setAllChats((prev) => upsertMessage(prev, msg));
      onIncomingBackgroundMessageRef.current?.(msg);

      if (
        msg &&
        msg.msgType !== "system" &&
        isDisplayableMessage(msg) &&
        msg.senderId &&
        msg.senderId !== config.id
      ) {
        const curr = selectedPeerRef.current;
        if (!curr) {
          const newPeer: PeerDevice = {
            id: msg.senderId,
            name: msg.senderName || "局域网设备",
            ip: (msg as any).senderIp || msg.fileAttachment?.senderIp || "",
            port:
              (msg as any).senderPort ||
              msg.fileAttachment?.senderPort ||
              57088,
            os: "windows",
            avatarUrl: (msg as any).senderAvatarUrl || "",
            status: "online",
            lastSeen: Date.now(),
            pingMs: 1.0,
            version: "2.0.0",
          };
          setSelectedPeer(newPeer);
          handleMarkPeerReadRef.current(msg.senderId);
        } else if (
          curr.id === msg.senderId ||
          ((msg as any).senderIp && curr.ip === (msg as any).senderIp)
        ) {
          handleMarkPeerReadRef.current(msg.senderId);
        }
      }
    });

    // 监听接收端流式接收实时进度 (收件方)
    const unsubIncomingProgress = ipc.on<{
      taskId: string;
      fileName: string;
      transferred: number;
      total: number;
      progress: number;
      speed: number;
    }>("transfer://incoming_progress", (data) => {
      setAllChats((prev) => {
        const idx = prev.findIndex(
          (m) =>
            m.fileAttachment?.id === data.taskId ||
            m.fileAttachment?.name === data.fileName,
        );
        if (idx >= 0) {
          const next = [...prev];
          const target = { ...next[idx] };
          if (target.fileAttachment) {
            target.fileAttachment = {
              ...target.fileAttachment,
              state: "transferring",
              progress: data.progress,
              speed: data.speed,
            };
            next[idx] = target;
            return next;
          }
        }
        return prev;
      });
    });

    // 监听发送端流式推流实时进度 (发件方)
    const unsubProgress = ipc.on<{
      taskId: string;
      transferred: number;
      total: number;
      speed: number;
    }>("transfer://progress", (data) => {
      setAllChats((prev) => {
        const idx = prev.findIndex((m) => m.fileAttachment?.id === data.taskId);
        if (idx >= 0) {
          const next = [...prev];
          const target = { ...next[idx] };
          if (target.fileAttachment) {
            const progress = Math.min(
              99.9,
              Number(((data.transferred / data.total) * 100).toFixed(1)),
            );
            target.fileAttachment = {
              ...target.fileAttachment,
              state: progress >= 99 ? "received" : "transferring",
              progress: progress >= 99 ? 100 : progress,
              speed: data.speed,
            };
            next[idx] = target;
            return next;
          }
        }
        return prev;
      });
    });

    // 监听传输失败
    const unsubError = ipc.on<{ taskId: string; error: string }>(
      "transfer://error",
      (data) => {
        setAllChats((prev) => {
          const idx = prev.findIndex(
            (m) => m.fileAttachment?.id === data.taskId,
          );
          if (idx >= 0) {
            const next = [...prev];
            const target = { ...next[idx] };
            if (target.fileAttachment) {
              target.fileAttachment = {
                ...target.fileAttachment,
                state: "failed",
              };
              next[idx] = target;
              return next;
            }
          }
          return prev;
        });
      },
    );

    // 监听文件接收完成
    const unsubRecv = ipc.on<ChatMessage>("file://received", () => {
      storageService.getAllTransfers().then((list) => {
        if (!isCancelled) setTransfers(list);
      });
      try {
        confetti({
          particleCount: 60,
          spread: 60,
          origin: { y: 0.8 },
          colors: ["#07c160", "#10b981", "#06b6d4"],
        });
      } catch {
        // ignore
      }
    });

    // 监听聊天消息单条/批量删除事件
    const unsubDeleted = ipc.on<{ msgIds: string[]; peerId?: string }>(
      "chat://deleted",
      (data) => {
        if (data && Array.isArray(data.msgIds) && data.msgIds.length > 0) {
          const idSet = new Set(data.msgIds);
          setAllChats((prev) => prev.filter((m) => !idSet.has(m.id)));
        }
      },
    );

    // 监听某个联系人的聊天记录全部清空事件
    const unsubCleared = ipc.on<{ peerId: string }>("chat://cleared", (data) => {
      if (data && data.peerId) {
        setAllChats((prev) =>
          prev.filter(
            (m) =>
              m.peerId !== data.peerId &&
              m.senderId !== data.peerId &&
              (m as any).peerIp !== data.peerId,
          ),
        );
      }
    });

    return () => {
      isCancelled = true;
      unsubChat();
      unsubIncomingProgress();
      unsubProgress();
      unsubError();
      unsubRecv();
      unsubDeleted();
      unsubCleared();
    };
  }, [config.id, setSelectedPeer]);

  // 当前选中联系人的即时聊天消息派生
  const chatMessages = useMemo(() => {
    if (!selectedPeer) return [];
    return allChats.filter((m) => {
      const isSentByMe =
        m.senderId === config.id ||
        (config.ip && config.ip !== "" && m.senderIp === config.ip);

      if (isSentByMe) {
        if (m.peerId === selectedPeer.id) return true;
        if (
          selectedPeer.ip &&
          (m.peerIp === selectedPeer.ip || m.peerId === selectedPeer.ip)
        )
          return true;
        return false;
      } else {
        if (m.senderId === selectedPeer.id) return true;
        if (
          selectedPeer.ip &&
          (m.senderIp === selectedPeer.ip ||
            m.fileAttachment?.senderIp === selectedPeer.ip)
        ) {
          return true;
        }
        return false;
      }
    });
  }, [selectedPeer, allChats, config.id, config.ip]);

  // 发送动作处理
  const handleSendMessage = async (targetPeer: PeerDevice, text: string) => {
    const msg = await chatManager.sendTextMessage(targetPeer, text);
    setAllChats((prev) => upsertMessage(prev, msg));
  };

  const handleSendFile = async (
    targetPeer: PeerDevice,
    file: File | { name: string; size: number; type: string; blob: Blob },
  ) => {
    const msg = await chatManager.sendFileMessage(targetPeer, file);
    setAllChats((prev) => upsertMessage(prev, msg));
  };

  const handleAcceptFile = async (msg: ChatMessage) => {
    const currentPeers = peersRef.current;
    const senderPeer = currentPeers.find(
      (p) =>
        p.id === msg.senderId ||
        (msg.fileAttachment?.senderIp &&
          p.ip === msg.fileAttachment.senderIp) ||
        (msg.senderIp && p.ip === msg.senderIp) ||
        (msg.peerIp && p.ip === msg.peerIp),
    );
    const res = await chatManager.acceptFileTransfer(msg, senderPeer);
    if (!res.success && res.error && onToast) {
      onToast(`无法接收：${res.error}`);
    }
  };

  const handleResumeFile = async (msg: ChatMessage) => {
    const currentPeers = peersRef.current;
    const senderPeer = currentPeers.find(
      (p) =>
        p.id === msg.senderId ||
        (msg.fileAttachment?.senderIp &&
          p.ip === msg.fileAttachment.senderIp) ||
        (msg.senderIp && p.ip === msg.senderIp) ||
        (msg.peerIp && p.ip === msg.peerIp),
    );
    const res = await chatManager.resumeFileTransfer(msg, senderPeer);
    if (!res.success && res.error && onToast) {
      onToast(`无法断点续传：${res.error}`);
    }
  };

  // 删除单条消息及其关联文件
  const handleDeleteMessage = async (msg: ChatMessage) => {
    setAllChats((prev) => prev.filter((m) => m.id !== msg.id));
    await chatManager.deleteMessage(msg);
    if (onToast) {
      onToast(
        msg.fileAttachment
          ? "已删除消息及关联文件"
          : "已删除该条消息",
        2000,
      );
    }
  };

  // 批量删除选中的多条消息及其关联文件
  const handleDeleteMessages = async (msgs: ChatMessage[]) => {
    if (!msgs || msgs.length === 0) return;
    const idSet = new Set(msgs.map((m) => m.id));
    setAllChats((prev) => prev.filter((m) => !idSet.has(m.id)));
    await chatManager.deleteMessages(msgs);
    if (onToast) {
      const fileCount = msgs.filter((m) => !!m.fileAttachment).length;
      onToast(
        fileCount > 0
          ? `已删除 ${msgs.length} 条消息（含 ${fileCount} 个文件）`
          : `已删除 ${msgs.length} 条消息`,
        2500,
      );
    }
  };

  // 清空指定联系人的所有聊天记录及关联文件
  const handleClearPeerChat = async (peerId: string) => {
    if (!peerId) return;
    const peerMsgs = allChats.filter(
      (m) =>
        m.peerId === peerId ||
        m.senderId === peerId ||
        (m as any).peerIp === peerId,
    );
    const fileCount = peerMsgs.filter((m) => !!m.fileAttachment).length;

    setAllChats((prev) =>
      prev.filter(
        (m) =>
          m.peerId !== peerId &&
          m.senderId !== peerId &&
          (m as any).peerIp !== peerId,
      ),
    );

    await chatManager.clearPeerChat(peerId, peerMsgs);
    if (onToast) {
      onToast(
        fileCount > 0
          ? `已清空聊天记录，并清理 ${fileCount} 个关联文件`
          : "已清空与该联系人的全部聊天记录",
        2500,
      );
    }
  };

  return {
    allChats,
    setAllChats,
    chatMessages,
    handleMarkPeerRead,
    handleSendMessage,
    handleSendFile,
    handleAcceptFile,
    handleResumeFile,
    handleDeleteMessage,
    handleDeleteMessages,
    handleClearPeerChat,
  };
}
