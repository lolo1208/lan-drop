/**
 * 左侧侧边栏主容器组件
 * 包含本机设备状态摘要、联系人搜索过滤栏、会话列表以及手动添加 IP 入口
 */

import React, { useMemo, useState } from "react";
import { ChatMessage, PeerConversation, PeerDevice } from "../../types";
import { ipc } from "../../services/ipc";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarSearch } from "./SidebarSearch";
import { SidebarList } from "./SidebarList";
import { AddIpModal } from "./AddIpModal";

interface SidebarProps {
  conversations: PeerConversation[];
  allChats: ChatMessage[];
  activePeerId: string | null;
  currentUserId?: string;
  onSelectPeer: (peer: PeerDevice, targetMessageId?: string) => void;
  onOpenSettings: (defaultTab?: "user" | "system") => void;
  localName: string;
  localIp: string;
  localAvatarUrl?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  allChats,
  activePeerId,
  currentUserId,
  onSelectPeer,
  onOpenSettings,
  localName,
  localIp,
  localAvatarUrl,
}) => {
  const [search, setSearch] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [showAddIpModal, setShowAddIpModal] = useState(false);
  const [targetIpInput, setTargetIpInput] = useState("");
  const [targetPortInput, setTargetPortInput] = useState("57088");
  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState("");

  const handleRefreshScan = () => {
    setIsScanning(true);
    ipc.triggerDiscoveryScan();
    setTimeout(() => {
      setIsScanning(false);
    }, 1200);
  };

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetIpInput.trim()) return;
    setIsProbing(true);
    setProbeError("");
    try {
      const port = parseInt(targetPortInput.trim(), 10) || 57088;
      const peer = await ipc.probePeerIp(targetIpInput.trim(), port);
      setShowAddIpModal(false);
      setTargetIpInput("");
      onSelectPeer(peer);
    } catch (err: any) {
      setProbeError(
        err?.message ||
          err?.toString() ||
          "连接失败，请检查 IP 与应用是否已启动",
      );
    } finally {
      setIsProbing(false);
    }
  };

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations
      .filter((c) => {
        if (!q) return true;
        return (
          c.peer.name.toLowerCase().includes(q) ||
          c.peer.ip.includes(q) ||
          (c.lastMessage?.content || "").toLowerCase().includes(q)
        );
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
  }, [conversations, search]);

  const matchedFileMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];

    return allChats
      .filter((msg) => {
        if (!msg.fileAttachment) return false;
        const fileName = msg.fileAttachment.name.toLowerCase();
        return fileName.includes(q);
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [allChats, search]);

  const handleSelectFileMatch = (msg: ChatMessage) => {
    const targetPeerId = msg.peerId;
    const conversation = conversations.find(
      (c) => c.peer.id === targetPeerId || c.peer.id === msg.senderId,
    );

    if (conversation) {
      onSelectPeer(conversation.peer, msg.id);
    }
  };

  return (
    <div className="w-72 sm:w-80 flex flex-col h-full bg-[#181818] border-r border-[#2b2b2b] select-none shrink-0 text-[#cccccc]">
      <SidebarHeader
        localName={localName}
        localIp={localIp}
        localAvatarUrl={localAvatarUrl}
        isScanning={isScanning}
        onOpenSettings={onOpenSettings}
        onRefreshScan={handleRefreshScan}
        onShowAddIpModal={() => {
          setProbeError("");
          setShowAddIpModal(true);
        }}
      />

      <SidebarSearch search={search} setSearch={setSearch} />

      <SidebarList
        filteredConversations={filteredConversations}
        matchedFileMessages={matchedFileMessages}
        search={search}
        activePeerId={activePeerId}
        currentUserId={currentUserId}
        allChats={allChats}
        onSelectPeer={onSelectPeer}
        onShowAddIpModal={() => {
          setProbeError("");
          setShowAddIpModal(true);
        }}
        onSelectFileMatch={handleSelectFileMatch}
      />

      {showAddIpModal && (
        <AddIpModal
          targetIpInput={targetIpInput}
          setTargetIpInput={setTargetIpInput}
          targetPortInput={targetPortInput}
          setTargetPortInput={setTargetPortInput}
          isProbing={isProbing}
          probeError={probeError}
          onManualConnect={handleManualConnect}
          onClose={() => setShowAddIpModal(false)}
        />
      )}
    </div>
  );
};
