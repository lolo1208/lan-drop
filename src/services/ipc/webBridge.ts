/**
 * 纯 Web 浏览器环境模拟 IPC 桥接实现模块
 * 基于 BroadcastChannel 与 LocalStorage 模拟多标签页局域网互联与文件传输交互
 */

import { IPCService } from "./index";
import { storageService, detectLocalIPv4 } from "../storage";
import { ChatMessage, PeerDevice, TransferTask } from "../../types";

export async function initWebBridge(ipc: IPCService) {
  if (typeof window === "undefined") return;

  // 浏览器环境动态探测真实局域网 IPv4
  detectLocalIPv4().then((realIp) => {
    if (realIp && realIp !== ipc.localConfig.ip) {
      ipc.localConfig.ip = realIp;
      storageService.saveSettings(ipc.localConfig);
      ipc.emit("config://updated", ipc.localConfig);
      ipc.broadcastLocalHeartbeat();
    }
  });

  ipc.virtualPeers = [
    {
      id: "peer-mbp-m3",
      name: "MacBook Pro M3 Max",
      avatarUrl: PRESET_AVATARS[1].url,
      os: "macos",
      ip: "192.168.1.102",
      port: 57088,
      status: "online",
      lastSeen: Date.now(),
      pingMs: 1.8,
      version: "2.0.0",
    },
    {
      id: "peer-win11-pc",
      name: "Alienware Gaming PC",
      avatarUrl: PRESET_AVATARS[3].url,
      os: "windows",
      ip: "192.168.1.145",
      port: 57088,
      status: "online",
      lastSeen: Date.now(),
      pingMs: 2.4,
      version: "2.0.0",
    },
  ];

  if ("BroadcastChannel" in window) {
    ipc.broadcastChannel = new BroadcastChannel("flashdrop_multicast_bus");
    ipc.broadcastChannel.onmessage = (event) => {
      const { type, data } = event.data || {};
      if (type === "HEARTBEAT") {
        if (data.id !== ipc.localConfig.id) {
          ipc.handleIncomingPeerHeartbeat(data);
        }
      } else if (type === "CHAT_MSG") {
        if (
          data.peerId === ipc.localConfig.id ||
          data.peerId === data.senderId
        ) {
          const incoming = { ...data, peerId: data.senderId };

          if (incoming.msgType === "system" && incoming.content) {
            if (incoming.content.startsWith("file_accept:")) {
              const parts = incoming.content.split(":");
              const fileMsgId = parts[1];
              const folder = parts[2] || undefined;
              const destName = parts[3] || undefined;
              ipc.emit("file://accepted", {
                fileId: fileMsgId,
                receiverId: incoming.senderId,
                receiverName: incoming.senderName,
                receiverIp: incoming.senderIp,
                receiverPort: incoming.senderPort || 57088,
                offset: 0,
                folder,
                destName,
              });
              return;
            } else if (incoming.content.startsWith("file_resume:")) {
              const parts = incoming.content.split(":");
              const fileMsgId = parts[1];
              const offset = Number(parts[2]) || 0;
              const folder = parts[3] || undefined;
              const destName = parts[4] || undefined;
              ipc.emit("file://accepted", {
                fileId: fileMsgId,
                receiverId: incoming.senderId,
                receiverName: incoming.senderName,
                receiverIp: incoming.senderIp,
                receiverPort: incoming.senderPort || 57088,
                offset,
                folder,
                destName,
              });
              return;
            } else if (incoming.content.startsWith("read_receipt")) {
              ipc.emit("chat://received", incoming);
              return;
            }
          }

          ipc.emit("chat://received", incoming);
          ipc.emit("chat://updated", incoming);
          storageService.saveChatMessage(incoming);
        }
      } else if (type === "CHAT_DELETED") {
        if (data && data.msgIds) {
          ipc.emit("chat://deleted", data);
        }
      } else if (type === "CHAT_CLEARED") {
        if (data && data.peerId) {
          ipc.emit("chat://cleared", data);
        }
      }
    };

    setInterval(() => {
      ipc.broadcastLocalHeartbeat();
      ipc.checkPeersLiveness();
    }, 3000);

    ipc.broadcastLocalHeartbeat();
  }
}
import { toCompactAvatarIdentifier, PRESET_AVATARS } from "../../utils/avatars";
