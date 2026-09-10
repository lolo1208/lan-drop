/**
 * 局域网传输网络事件监听与状态调度模块
 * 监听底层文件传输进度、接收完毕事件、断点续传请求及对端离线状态更新
 */

import { ChatMessage, PeerDevice } from "../../types";
import { ipc, isTauri } from "../ipc";
import { storageService } from "../storage";
import { convertToLocalUrl } from "./utils";
import { pendingOutgoingFiles } from "./state";
import { acceptFileTransfer } from "./receiver";
import { streamFileToTarget } from "./stream";

// 初始化监听：当作为发送端收到接收方的 file_accept 时，触发流式上传
export function initFileTransferListeners() {
  // 监听接收到的消息（包含常规消息与系统已读回执信令）
  ipc.on<ChatMessage>("chat://received", async (msg) => {
    if (!msg) return;

    // 监听已读回执信令：当对端告知已读时，将本端发给对端的消息更新为已读
    if (
      msg.msgType === "system" &&
      msg.content &&
      msg.content.startsWith("read_receipt")
    ) {
      const local = ipc.getLocalConfig();
      const peerId = msg.senderId; // 谁发来的回执，就是谁阅读了我的消息
      const messages = await storageService.getChatMessages(peerId);
      let updatedCount = 0;
      for (const m of messages) {
        if (m.senderId === local.id && !m.isRead) {
          m.isRead = true;
          m.readTimestamp = Date.now();
          await storageService.saveChatMessage(m);
          updatedCount++;
          ipc.emit("chat://updated", m);
        }
      }
      if (updatedCount > 0) {
        ipc.emit("chat://read_status_changed", { peerId });
      }
      return;
    }

    if (!msg.fileAttachment) return;
    const isMedia =
      msg.msgType === "image" ||
      msg.msgType === "video" ||
      msg.msgType === "audio" ||
      msg.fileAttachment.isMedia;
    if (!isMedia) return;

    const fileMeta = msg.fileAttachment;
    const dotIndex = fileMeta.name.lastIndexOf(".");
    const ext = dotIndex !== -1 ? fileMeta.name.substring(dotIndex + 1) : "";
    const mediaFileName = fileMeta.md5
      ? ext
        ? `${fileMeta.md5}.${ext}`
        : fileMeta.md5
      : fileMeta.name;

    // 1. 检查本地是否已存在相同 MD5 的媒体文件（去重，避免相同文件重复保存/下载）
    const mediaDir = await ipc.getMediaDir();
    const expectedPath = `${mediaDir}/${mediaFileName}`;
    const alreadyExists = await ipc.checkFileExists(expectedPath);

    if (alreadyExists) {
      // 本地已存在完全一致的媒体文件，立即完成
      fileMeta.state = "received";
      fileMeta.progress = 100;
      fileMeta.transferredBytes = fileMeta.size;
      fileMeta.savedPath = expectedPath;
      fileMeta.blobUrl = await convertToLocalUrl(expectedPath);
      await storageService.saveChatMessage(msg);
      ipc.emit("chat://updated", msg);
      return;
    }

    // 若已经接收完成并且文件存在则无需处理
    if (fileMeta.state === "received" && fileMeta.savedPath) return;

    // 2. 本地不存在，自动发起接收
    const peers = await ipc.getDiscoveredPeers();
    const senderPeer = peers.find(
      (p) =>
        p.id === msg.senderId ||
        (fileMeta.senderIp && p.ip === fileMeta.senderIp) ||
        (msg.senderIp && p.ip === msg.senderIp),
    );
    await acceptFileTransfer(msg, senderPeer);
  });

  ipc.on<{
    fileId: string;
    receiverId: string;
    receiverName: string;
    receiverIp?: string;
    receiverPort?: number;
    offset?: number;
    folder?: string;
    destName?: string;
  }>("file://accepted", async (data) => {
    let item = pendingOutgoingFiles.get(data.fileId);
    const offset = data.offset || 0;

    // 获取当前聊天消息对象
    const allChats = await storageService.getAllChats();
    const msg = allChats.find((m) => m.fileAttachment?.id === data.fileId);

    // 若因刷新等导致内存中未找到 pending item，但消息元数据中有 originalPath 或 savedPath，自动进行灾备重建
    if (
      !item &&
      msg &&
      (msg.fileAttachment?.originalPath || msg.fileAttachment?.savedPath)
    ) {
      const sourcePath =
        msg.fileAttachment.savedPath || msg.fileAttachment.originalPath;
      item = {
        file: new Blob([]),
        name: msg.fileAttachment.name,
        size: msg.fileAttachment.size,
        originalPath: sourcePath,
        folder:
          data.folder || (msg.fileAttachment.isMedia ? "Media" : undefined),
        destName: data.destName,
      };
    }

    if (!item) {
      console.warn("未在发送缓存中找到待传文件:", data.fileId);
      return;
    }

    // 寻找接收方 IP
    const peers = await ipc.getDiscoveredPeers();
    const receiverPeer = peers.find(
      (p) =>
        p.id === data.receiverId ||
        (data.receiverIp && p.ip === data.receiverIp),
    );
    const targetIp = data.receiverIp || receiverPeer?.ip;
    const targetPort = data.receiverPort || receiverPeer?.port || 57088;

    if (!targetIp) {
      console.error("无法确定接收方 IP，传输已终止:", data);
      return;
    }

    const effectiveFolder = data.folder || item.folder;
    const effectiveDestName = data.destName || item.destName;

    if (msg && msg.fileAttachment) {
      msg.fileAttachment.state = "transferring";
      msg.fileAttachment.transferredBytes = offset;
      msg.fileAttachment.progress =
        msg.fileAttachment.size > 0
          ? Math.min(
              99.9,
              Number(((offset / msg.fileAttachment.size) * 100).toFixed(1)),
            )
          : 0;
      await storageService.saveChatMessage(msg);
      ipc.emit("chat://updated", msg);
    }

    // 优先在 Tauri 环境下调用 Rust 真正的 Tokio 异步推流（支持断点续传 offset 与 Media 目录）
    if (isTauri()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (item.originalPath) {
          await invoke("start_file_transfer", {
            targetIp,
            targetPort,
            filePath: item.originalPath,
            taskId: data.fileId,
            offset,
            destName: effectiveDestName,
            folder: effectiveFolder,
          });
          return;
        } else if (item.file && item.file.size > 0) {
          // 通过 ArrayBuffer 读取并在 Rust 侧以直连 Socket 推流
          const arrayBuffer = await (item.file instanceof Blob
            ? item.file.arrayBuffer()
            : (item.file as any).arrayBuffer());
          const uint8Array = new Uint8Array(arrayBuffer);
          await invoke("transfer_file_data", {
            targetIp,
            targetPort,
            taskId: data.fileId,
            fileName: effectiveDestName || item.name,
            fileSize: item.size,
            data: Array.from(uint8Array),
            offset,
            folder: effectiveFolder,
          });
          return;
        }
      } catch (err) {
        console.warn("Tauri 原生推流启动失败，回退到 Web 数据流:", err);
      }
    }

    // Web 或非原生路径回退：通过 HTTP Chunk 写入流
    streamFileToTarget(
      item.file,
      effectiveDestName || item.name,
      item.size,
      data.fileId,
      targetIp,
      targetPort,
      msg,
      offset,
      effectiveFolder,
    );
  });

  // 监听接收端流式接收实时进度 (收件方视角更新进度条)
  ipc.on<{
    taskId: string;
    fileName: string;
    transferred: number;
    total: number;
    speed: number;
  }>("transfer://incoming_progress", async (data) => {
    const allChats = await storageService.getAllChats();
    const msg = allChats.find(
      (m) =>
        m.fileAttachment?.id === data.taskId ||
        m.fileAttachment?.name === data.fileName,
    );
    if (msg && msg.fileAttachment) {
      const total = data.total || msg.fileAttachment.size || 0;
      const progress =
        total > 0
          ? Math.min(
              99.9,
              Number(((data.transferred / total) * 100).toFixed(1)),
            )
          : 0;
      msg.fileAttachment.state = "transferring";
      msg.fileAttachment.transferredBytes = data.transferred;
      msg.fileAttachment.progress = progress;
      msg.fileAttachment.speed = data.speed;
      ipc.emit("chat://updated", msg);
    }
  });

  // 监听接收端接收完全完成 (收件方落地磁盘完成)
  ipc.on<{
    taskId: string;
    fileName: string;
    savedPath: string;
    totalSize: number;
  }>("transfer://incoming_complete", async (data) => {
    const allChats = await storageService.getAllChats();
    const msg = allChats.find(
      (m) =>
        m.fileAttachment?.id === data.taskId ||
        m.fileAttachment?.name === data.fileName,
    );
    if (msg && msg.fileAttachment) {
      msg.fileAttachment.state = "received";
      msg.fileAttachment.progress = 100;
      msg.fileAttachment.transferredBytes = data.totalSize;
      msg.fileAttachment.speed = 0;
      msg.fileAttachment.savedPath = data.savedPath;
      if (
        msg.msgType === "image" ||
        msg.msgType === "video" ||
        msg.msgType === "audio" ||
        msg.fileAttachment.isMedia
      ) {
        msg.fileAttachment.blobUrl = await convertToLocalUrl(data.savedPath);
      }
      await storageService.saveChatMessage(msg);
      ipc.emit("chat://updated", msg);
    }
  });

  // 监听 Tauri 原生发送进度 (发件方视角更新)
  ipc.on<{ taskId: string; transferred: number; total: number; speed: number }>(
    "transfer://progress",
    async (data) => {
      const allChats = await storageService.getAllChats();
      const msg = allChats.find((m) => m.fileAttachment?.id === data.taskId);
      if (msg && msg.fileAttachment) {
        const total = data.total || msg.fileAttachment.size || 0;
        const progress =
          total > 0
            ? Math.min(
                99.9,
                Number(((data.transferred / total) * 100).toFixed(1)),
              )
            : 0;
        msg.fileAttachment.state = "transferring";
        msg.fileAttachment.transferredBytes = data.transferred;
        msg.fileAttachment.progress = progress;
        msg.fileAttachment.speed = data.speed;
        if (progress >= 99 || data.transferred >= total) {
          msg.fileAttachment.state = "received";
          msg.fileAttachment.progress = 100;
        }
        await storageService.saveChatMessage(msg);
        ipc.emit("chat://updated", msg);
      }
    },
  );

  // 监听发送端传输中断/报错
  ipc.on<{ taskId: string; error: string }>(
    "transfer://error",
    async (data) => {
      const allChats = await storageService.getAllChats();
      const msg = allChats.find((m) => m.fileAttachment?.id === data.taskId);
      if (
        msg &&
        msg.fileAttachment &&
        msg.fileAttachment.state === "transferring"
      ) {
        msg.fileAttachment.state = "failed";
        msg.fileAttachment.speed = 0;
        await storageService.saveChatMessage(msg);
        ipc.emit("chat://updated", msg);
      }
    },
  );

  // 监听接收端传输中断/报错
  ipc.on<{
    taskId: string;
    fileName: string;
    transferred: number;
    total: number;
    error: string;
  }>("transfer://incoming_error", async (data) => {
    const allChats = await storageService.getAllChats();
    const msg = allChats.find(
      (m) =>
        m.fileAttachment?.id === data.taskId ||
        m.fileAttachment?.name === data.fileName,
    );
    if (
      msg &&
      msg.fileAttachment &&
      msg.fileAttachment.state === "transferring"
    ) {
      msg.fileAttachment.state = "failed";
      msg.fileAttachment.transferredBytes = data.transferred;
      msg.fileAttachment.speed = 0;
      await storageService.saveChatMessage(msg);
      ipc.emit("chat://updated", msg);
    }
  });

  // 监听对端设备掉线：当有对端设备离线时，若存在与其正在进行中的流式传输，自动标记为“传输中断”并保留进度供重连后续传
  ipc.on<PeerDevice[]>("peers://updated", async (peers) => {
    const offlinePeerIds = new Set(
      peers.filter((p) => p.status === "offline").map((p) => p.id),
    );
    const offlinePeerIps = new Set(
      peers.filter((p) => p.status === "offline" && p.ip).map((p) => p.ip),
    );

    if (offlinePeerIds.size === 0 && offlinePeerIps.size === 0) return;

    const allChats = await storageService.getAllChats();
    let changed = false;

    for (const msg of allChats) {
      if (msg.fileAttachment && msg.fileAttachment.state === "transferring") {
        const peerId = msg.peerId;
        const peerIp = msg.peerIp || msg.fileAttachment.senderIp;
        if (
          (peerId && offlinePeerIds.has(peerId)) ||
          (peerIp && offlinePeerIps.has(peerIp))
        ) {
          msg.fileAttachment.state = "failed";
          msg.fileAttachment.speed = 0;
          await storageService.saveChatMessage(msg);
          ipc.emit("chat://updated", msg);
          changed = true;
        }
      }
    }
  });
}
