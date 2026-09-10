/**
 * 局域网对端设备自动发现、状态同步及会话列表实时构建 Hook
 * 维护在线对端设备列表、处理多设备发现事件，并智能聚合历史聊天记录生成左侧会话列表
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ipc } from "../services/ipc";
import {
  ChatMessage,
  LocalDeviceConfig,
  PeerConversation,
  PeerDevice,
} from "../types";
import { PRESET_AVATARS } from "../utils/avatars";

// 计算左侧会话列表及最近一条消息的纯函数（智能合并、去重、排序）
export function buildConversations(
  peers: PeerDevice[],
  allChats: ChatMessage[],
  config: LocalDeviceConfig,
): PeerConversation[] {
  const peerMap = new Map<string, PeerDevice>();
  const ipToIdMap = new Map<string, string>();

  // 先将当前在线/已发现的 peers 放入 map（排除本机）
  peers.forEach((peer) => {
    if (peer.id === config.id || (config.ip && peer.ip === config.ip)) return;
    peerMap.set(peer.id, { ...peer });
    if (peer.ip) {
      ipToIdMap.set(peer.ip, peer.id);
    }
  });

  // 将历史聊天中的联系人合并进去（排除自己作为对端）
  allChats.forEach((msg) => {
    const isSentByMe =
      msg.senderId === config.id ||
      (config.ip && config.ip !== "" && msg.senderIp === config.ip);

    const targetId = isSentByMe ? msg.peerId : msg.senderId;
    const targetIp = isSentByMe
      ? msg.peerIp
      : msg.senderIp || msg.fileAttachment?.senderIp;

    if (!targetId || targetId === config.id) return;
    if (targetIp && config.ip && targetIp === config.ip) return;
    if (
      isSentByMe &&
      msg.senderName === config.name &&
      targetId === msg.senderId
    )
      return;

    if (peerMap.has(targetId)) return;
    if (targetIp && ipToIdMap.has(targetIp)) return;

    const existing = Array.from(peerMap.values()).find(
      (p) =>
        (targetIp && p.ip === targetIp) ||
        (p.name === msg.senderName &&
          msg.senderName !== "未知用户" &&
          msg.senderName !== config.name),
    );
    if (existing) return;

    let hash = 0;
    for (let i = 0; i < (targetId + (msg.senderName || "")).length; i++) {
      hash =
        (hash << 5) - hash + (targetId + (msg.senderName || "")).charCodeAt(i);
      hash |= 0;
    }
    const avatarIndex = Math.abs(hash) % PRESET_AVATARS.length;
    const stableAvatar =
      !isSentByMe && msg.senderAvatarUrl
        ? msg.senderAvatarUrl
        : PRESET_AVATARS[avatarIndex].url;

    peerMap.set(targetId, {
      id: targetId,
      name: isSentByMe
        ? (msg as any).peerName || "局域网设备"
        : msg.senderName || "未知用户",
      avatarUrl: stableAvatar,
      ip: targetIp || "",
      port: isSentByMe
        ? (msg as any).peerPort || 57088
        : msg.senderPort || msg.fileAttachment?.senderPort || 57088,
      os: "windows",
      status: "offline",
      lastSeen: msg.timestamp,
      pingMs: 0,
      version: "2.0.0",
    });
  });

  return Array.from(peerMap.values())
    .filter((peer) => {
      if (peer.id === config.id || (config.ip && peer.ip === config.ip))
        return false;
      const isOnline = peer.status === "online";

      const hasHistory = allChats.some((c) => {
        const isFromMe =
          c.senderId === config.id || (config.ip && c.senderIp === config.ip);
        const counterpartId = isFromMe ? c.peerId : c.senderId;
        const counterpartIp = isFromMe
          ? c.peerIp
          : c.senderIp || c.fileAttachment?.senderIp;
        if (counterpartId === peer.id) return true;
        if (peer.ip && counterpartIp === peer.ip) return true;
        return false;
      });

      if (hasHistory) {
        return true;
      }
      return isOnline;
    })
    .map((peer) => {
      const peerMsgs = allChats.filter((c) => {
        const isFromMe =
          c.senderId === config.id || (config.ip && c.senderIp === config.ip);
        const counterpartId = isFromMe ? c.peerId : c.senderId;
        const counterpartIp = isFromMe
          ? c.peerIp
          : c.senderIp || c.fileAttachment?.senderIp;
        if (counterpartId === peer.id) return true;
        if (peer.ip && counterpartIp === peer.ip) return true;
        return false;
      });
      const lastMessage =
        peerMsgs.length > 0 ? peerMsgs[peerMsgs.length - 1] : undefined;
      return {
        peer,
        lastMessage,
        unreadCount: 0,
        updatedAt: lastMessage ? lastMessage.timestamp : peer.lastSeen || 0,
      };
    })
    .sort((a, b) => {
      const timeA = a.lastMessage?.timestamp || 0;
      const timeB = b.lastMessage?.timestamp || 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      if (a.peer.status !== b.peer.status) {
        return a.peer.status === "online" ? -1 : 1;
      }
      const nameCompare = a.peer.name.localeCompare(b.peer.name, "zh-CN");
      if (nameCompare !== 0) return nameCompare;
      return a.peer.id.localeCompare(b.peer.id);
    });
}

interface UsePeerSyncProps {
  config: LocalDeviceConfig;
  onTriggerHighlight?: (msgId: string) => void;
}

export function usePeerSync({ config, onTriggerHighlight }: UsePeerSyncProps) {
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<PeerDevice | null>(null);

  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const onTriggerHighlightRef = useRef(onTriggerHighlight);
  useEffect(() => {
    onTriggerHighlightRef.current = onTriggerHighlight;
  }, [onTriggerHighlight]);

  useEffect(() => {
    ipc.triggerDiscoveryScan();

    ipc.getDiscoveredPeers().then((list) => {
      setPeers(list);
    });

    const unsubPeers = ipc.on<PeerDevice[]>(
      "peers://updated",
      (updatedPeers) => {
        setPeers(updatedPeers);
        setSelectedPeer((curr) => {
          if (!curr) return null;
          const found = updatedPeers.find(
            (p) => p.id === curr.id || (curr.ip && p.ip === curr.ip),
          );
          return found || curr;
        });
      },
    );

    return () => {
      unsubPeers();
    };
  }, []);

  const handleSelectPeer = useCallback(
    (peer: PeerDevice, targetMessageId?: string) => {
      setSelectedPeer(peer);
      if (targetMessageId && onTriggerHighlightRef.current) {
        onTriggerHighlightRef.current(targetMessageId);
      }
    },
    [],
  );

  const focusPeerAndMessage = useCallback((msg: ChatMessage) => {
    const currentConfig = configRef.current;
    if (!msg || msg.senderId === currentConfig.id) return;
    setPeers((currPeers) => {
      const found = currPeers.find(
        (p) =>
          p.id === msg.senderId ||
          (msg.fileAttachment?.senderIp &&
            p.ip === msg.fileAttachment.senderIp) ||
          ((msg as any).senderIp && p.ip === (msg as any).senderIp),
      );
      if (found) {
        setSelectedPeer(found);
      } else {
        const newPeer: PeerDevice = {
          id: msg.senderId,
          name: msg.senderName || "局域网设备",
          ip: (msg as any).senderIp || msg.fileAttachment?.senderIp || "",
          port:
            (msg as any).senderPort || msg.fileAttachment?.senderPort || 57088,
          os: "windows",
          avatarUrl: (msg as any).senderAvatarUrl || "",
          status: "online",
          lastSeen: Date.now(),
          pingMs: 1.0,
          version: "2.0.0",
        };
        setSelectedPeer(newPeer);
      }
      return currPeers;
    });

    if (onTriggerHighlightRef.current) {
      onTriggerHighlightRef.current(msg.id);
    }
  }, []);

  return {
    peers,
    setPeers,
    selectedPeer,
    setSelectedPeer,
    handleSelectPeer,
    focusPeerAndMessage,
  };
}
