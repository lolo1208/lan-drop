/**
 * 聊天消息与文件传输发送模块
 * 负责构建文本与文件传输消息载荷、向对端设备推送传输请求并维护发送方状态队列
 */

import { ChatMessage, FileAttachmentMeta, PeerDevice } from "../../types";
import { ipc } from "../ipc";
import { storageService } from "../storage";
import { calculateBlobMd5 } from "../../utils/md5";
import { toCompactAvatarIdentifier } from "../../utils/avatars";
import { convertToLocalUrl } from "./utils";
import { pendingOutgoingFiles } from "./state";

// 发送即时文本消息
export async function sendTextMessage(
  targetPeer: PeerDevice,
  text: string,
): Promise<ChatMessage> {
  const local = ipc.getLocalConfig();
  const msg: ChatMessage = {
    id: "msg-" + Math.random().toString(36).substring(2, 10),
    peerId: targetPeer.id,
    peerIp: targetPeer.ip,
    senderId: local.id,
    senderName: local.name,
    senderAvatarUrl: toCompactAvatarIdentifier(local.avatarUrl),
    senderIp: local.ip,
    senderPort: local.port || 57088,
    content: text,
    msgType: "text",
    timestamp: Date.now(),
    status: targetPeer.status === "online" ? "delivered" : "sent",
  };

  await ipc.sendChatMessage(targetPeer, msg);
  return msg;
}

// 发送文件/多媒体消息（多媒体自动保存至 [用户文档]/LAN Drop/Media 并以 MD5 命名，非 base64 形式发送）
export async function sendFileMessage(
  targetPeer: PeerDevice,
  file:
    | File
    | { name: string; size: number; type: string; blob: Blob; path?: string },
): Promise<ChatMessage> {
  const local = ipc.getLocalConfig();
  const blob = "blob" in file ? file.blob : file;
  const originalPath = "path" in file ? file.path : (file as any).path;

  let msgType: "file" | "image" | "video" | "audio" = "file";
  if (file.type.startsWith("image/")) {
    msgType = "image";
  } else if (file.type.startsWith("video/")) {
    msgType = "video";
  } else if (file.type.startsWith("audio/")) {
    msgType = "audio";
  }

  const isMedia =
    msgType === "image" || msgType === "video" || msgType === "audio";
  const fileId = "file-" + Math.random().toString(36).substring(2, 10);

  const dotIndex = file.name.lastIndexOf(".");
  const ext = dotIndex !== -1 ? file.name.substring(dotIndex + 1) : "";

  let fileMd5: string | undefined = undefined;
  let savedPath: string | undefined = undefined;
  let blobUrl = "";
  let mediaDestName: string | undefined = undefined;

  if (isMedia) {
    fileMd5 = await calculateBlobMd5(blob);
    mediaDestName = ext ? `${fileMd5}.${ext}` : fileMd5;

    if (originalPath) {
      savedPath = await ipc.saveMediaFromPath(fileMd5, ext, originalPath);
    } else {
      const arrayBuffer = await blob.arrayBuffer();
      savedPath = await ipc.saveMediaFileToDisk(
        fileMd5,
        ext,
        new Uint8Array(arrayBuffer),
      );
    }

    if (savedPath) {
      blobUrl = await convertToLocalUrl(savedPath);
    }
    if (!blobUrl && typeof window !== "undefined") {
      blobUrl = URL.createObjectURL(blob);
    }
  } else {
    blobUrl = typeof window !== "undefined" ? URL.createObjectURL(blob) : "";
  }

  const localFileMeta: FileAttachmentMeta = {
    id: fileId,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    md5: fileMd5,
    isMedia,
    blobUrl,
    originalPath,
    savedPath,
    state: isMedia ? "received" : "waiting_accept",
    progress: isMedia ? 100 : 0,
    speed: 0,
    senderIp: local.ip,
    senderPort: local.port || 57088,
  };

  pendingOutgoingFiles.set(fileId, {
    file: blob,
    name: file.name,
    size: file.size,
    originalPath,
    destName: mediaDestName,
    folder: isMedia ? "Media" : undefined,
  });

  const outgoingFileMeta: FileAttachmentMeta = {
    id: fileId,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    md5: fileMd5,
    isMedia,
    state: "waiting_accept",
    progress: 0,
    speed: 0,
    senderIp: local.ip,
    senderPort: local.port || 57088,
  };

  const msg: ChatMessage = {
    id: "msg-" + Math.random().toString(36).substring(2, 10),
    peerId: targetPeer.id,
    peerIp: targetPeer.ip,
    senderId: local.id,
    senderName: local.name,
    senderAvatarUrl: toCompactAvatarIdentifier(local.avatarUrl),
    senderIp: local.ip,
    senderPort: local.port || 57088,
    content: file.name,
    msgType,
    timestamp: Date.now(),
    status: targetPeer.status === "online" ? "delivered" : "sent",
    fileAttachment: outgoingFileMeta,
  };

  await ipc.sendChatMessage(targetPeer, msg);

  const localMsg: ChatMessage = {
    ...msg,
    fileAttachment: localFileMeta,
  };
  await storageService.saveChatMessage(localMsg);
  ipc.emit("chat://updated", localMsg);

  return localMsg;
}

// 发送局域网已读回执信令给对端，通知对方我已阅读消息
export async function sendReadReceipt(
  targetPeer: PeerDevice | string,
): Promise<void> {
  const local = ipc.getLocalConfig();
  const peerId = typeof targetPeer === "string" ? targetPeer : targetPeer.id;
  const receiptMsg: ChatMessage = {
    id: "receipt-" + Math.random().toString(36).substring(2, 10),
    peerId,
    senderId: local.id,
    senderName: local.name,
    content: "read_receipt:all",
    msgType: "system",
    timestamp: Date.now(),
    status: "delivered",
  };
  try {
    await ipc.sendChatMessage(targetPeer, receiptMsg);
  } catch {
    // ignore read receipt network failure
  }
}
