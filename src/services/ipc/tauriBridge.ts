/**
 * Tauri 桌面原生环境 IPC 桥接实现模块
 * 封装 Tauri Rust 后端 Invoke 命令调用及原生系统事件监听
 */

import { IPCService } from "./index";
import { storageService, detectLocalIPv4 } from "../storage";
import { ChatMessage, PeerDevice, TransferTask } from "../../types";

export async function initTauriBridge(ipc: IPCService) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    // 1. 立即优先注册所有 Tauri 原生事件监听器（确保第一时间捕获消息、信令与文件流）
    const safeListen = async (
      eventName: string,
      handler: (event: any) => void,
    ) => {
      try {
        return await listen(eventName, handler);
      } catch (err) {
        console.warn(
          `Tauri 监听事件 [${eventName}] 失败 (请确保 capabilities 已启用对应权限):`,
          err,
        );
        return () => {};
      }
    };

    // 监听接收到的即时聊天消息与系统控制信令
    await safeListen("chat://received", async (event: any) => {
      const msg = event.payload as ChatMessage;
      if (!msg || !msg.id) return;

      const senderIp =
        msg.senderIp ||
        msg.fileAttachment?.senderIp ||
        event.payload?.senderIp ||
        "";
      const senderPort =
        msg.senderPort || msg.fileAttachment?.senderPort || 57088;

      // 若不是自己发出的，则将对端设备 ID 设为 peerId
      if (msg.senderId !== ipc.localConfig.id) {
        msg.peerId = msg.senderId;
      }
      msg.senderIp = senderIp;
      msg.senderPort = senderPort;
      if (!msg.peerIp && senderIp) {
        msg.peerIp = senderIp;
      }

      // 自动将发送方设备注册/更新为联系人并立即更新在线状态
      if (msg.senderId && msg.senderId !== ipc.localConfig.id) {
        ipc.registerDiscoveredPeer({
          id: msg.senderId,
          name: msg.senderName || "局域网设备",
          ip: senderIp,
          port: senderPort,
          avatarUrl: msg.senderAvatarUrl || "",
          status: "online",
        });
      }

      // 拦截系统控制信令：如对方同意接收文件 或 对方请求断点续传文件
      if (msg.msgType === "system" && msg.content) {
        if (msg.content.startsWith("file_accept:")) {
          const parts = msg.content.split(":");
          const fileMsgId = parts[1];
          const folder = parts[2] || undefined;
          const destName = parts[3] || undefined;
          ipc.emit("file://accepted", {
            fileId: fileMsgId,
            receiverId: msg.senderId,
            receiverName: msg.senderName,
            receiverIp: senderIp,
            receiverPort: senderPort,
            offset: 0,
            folder,
            destName,
          });
          return; // 系统信令不作为常规聊天气泡展示
        } else if (msg.content.startsWith("file_resume:")) {
          const parts = msg.content.split(":");
          const fileMsgId = parts[1];
          const offset = Number(parts[2]) || 0;
          const folder = parts[3] || undefined;
          const destName = parts[4] || undefined;
          ipc.emit("file://accepted", {
            fileId: fileMsgId,
            receiverId: msg.senderId,
            receiverName: msg.senderName,
            receiverIp: senderIp,
            receiverPort: senderPort,
            offset,
            folder,
            destName,
          });
          return;
        }
      }

      // 常规聊天消息：立即在前端广播消息，保证 UI 毫秒级零延迟即时刷新与展现
      ipc.emit("chat://received", msg);
      ipc.emit("chat://updated", msg);

      // 异步写入持久化存储（不阻塞当前主事件派发循环）
      storageService.saveChatMessage(msg).catch((err) => {
        console.warn("异步保存聊天记录失败:", err);
      });
    });

    // 监听发现的对端设备 (纯 HTTP 网段并发扫描 或 手动 IP 探测回报)
    await safeListen("peer://discovered", (event: any) => {
      const data = event.payload;
      if (data && data.peer) {
        if (data.peer.id === ipc.localConfig.id) return;
        ipc.registerDiscoveredPeer({
          ...data.peer,
          ip: data.remoteIp || data.peer.ip,
        });
      }
    });

    // 监听设备离线
    await safeListen("peer://offline", (event: any) => {
      const id = event.payload?.id;
      const ip = event.payload?.ip;
      let changed = false;
      ipc.virtualPeers.forEach((p) => {
        if ((id && p.id === id) || (ip && p.ip === ip)) {
          if (p.status !== "offline") {
            p.status = "offline";
            changed = true;
          }
        }
      });
      if (changed) {
        ipc.emit("peers://updated", [...ipc.virtualPeers]);
      }
    });

    // 监听收到的流式文件传输进度 (收件方)
    await safeListen("transfer://incoming_progress", (event: any) => {
      const payload = event.payload;
      if (!payload) return;

      const progress = Math.min(
        99,
        Number(((payload.transferred / payload.total) * 100).toFixed(1)),
      );
      ipc.emit("transfer://incoming_progress", {
        taskId: payload.taskId,
        fileName: payload.fileName,
        transferred: payload.transferred,
        total: payload.total,
        progress,
        speed: payload.speed || 0,
      });
    });

    // 监听收到文件传输完成
    await safeListen("transfer://incoming_complete", async (event: any) => {
      const payload = event.payload;
      if (!payload) return;

      const allChats = await storageService.getAllChats();
      const fileMsg = allChats.find(
        (m) =>
          m.fileAttachment?.id === payload.taskId ||
          m.fileAttachment?.name === payload.fileName,
      );
      if (fileMsg && fileMsg.fileAttachment) {
        fileMsg.fileAttachment.state = "received";
        fileMsg.fileAttachment.progress = 100;
        fileMsg.fileAttachment.speed = 0;
        fileMsg.fileAttachment.savedPath = payload.savedPath;
        await storageService.saveChatMessage(fileMsg);
        ipc.emit("chat://updated", fileMsg);
        ipc.emit("file://received", fileMsg);
      }
    });

    // 监听发送端传输进度与报错
    await safeListen("transfer://progress", (event: any) => {
      const payload = event.payload;
      if (!payload) return;
      ipc.emit("transfer://progress", payload);
    });

    await safeListen("transfer://error", (event: any) => {
      ipc.emit("transfer://error", event.payload);
    });

    await safeListen("transfer://incoming_error", (event: any) => {
      ipc.emit("transfer://incoming_error", event.payload);
    });

    // 监听底层原生快捷键/系统托盘发来的窗口切换指令
    await safeListen("app://toggle_window", async () => {
      await ipc.toggleWindow();
    });

    // 2. 定期检测设备在线状态 (超过 25 秒未收到心跳则标记离线)
    setInterval(() => {
      const now = Date.now();
      let changed = false;
      ipc.virtualPeers.forEach((p) => {
        if (p.status === "online" && now - (p.lastSeen || 0) > 25000) {
          p.status = "offline";
          changed = true;
        }
      });
      if (changed) {
        ipc.emit("peers://updated", [...ipc.virtualPeers]);
      }
    }, 5000);

    // 3. 从 SQLite .db / localStorage 加载全部持久化配置
    const dbConfig = await storageService.loadSettingsFromDb();
    ipc.localConfig = { ...dbConfig };

    // 获取 Rust 端自动挑选的最优物理局域网 IP 与持久化 node_id
    const sysInfo = await invoke<any>("get_sys_info");
    if (sysInfo && sysInfo.node_id) {
      ipc.localConfig.id = sysInfo.node_id;
    }

    const localDevice = await invoke<any>("get_local_device");
    if (
      localDevice &&
      localDevice.ip &&
      localDevice.ip !== "127.0.0.1" &&
      localDevice.ip !== "0.0.0.0"
    ) {
      ipc.localConfig.ip = localDevice.ip;
    }

    // 将持久化好的设备配置同步至 Rust 核心
    const syncedDevice = await invoke<any>("sync_local_device", {
      device: {
        id: ipc.localConfig.id,
        name: ipc.localConfig.name,
        ip: ipc.localConfig.ip,
        port: ipc.localConfig.port || 57088,
        os: ipc.localConfig.os,
        avatarUrl: toCompactAvatarIdentifier(ipc.localConfig.avatarUrl),
      },
    });

    if (
      syncedDevice &&
      syncedDevice.ip &&
      syncedDevice.ip !== "127.0.0.1" &&
      syncedDevice.ip !== "0.0.0.0"
    ) {
      ipc.localConfig.ip = syncedDevice.ip;
    }

    // 同步设定的下载路径至 Rust 核心
    if (ipc.localConfig.downloadDir) {
      await invoke("set_download_dir", {
        dir: ipc.localConfig.downloadDir,
      }).catch(() => {});
    }

    storageService.saveSettings(ipc.localConfig);
    ipc.emit("config://updated", ipc.localConfig);
  } catch (e) {
    console.error("Tauri bridge 初始化失败:", e);
  }
}
import { toCompactAvatarIdentifier, PRESET_AVATARS } from "../../utils/avatars";
