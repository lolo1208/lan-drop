/**
 * 局域网文件接收、断点续传确认与拒收处理模块
 * 负责处理接收方文件接收逻辑、向发送方发送同意/断点续传信令并拉起流式传输
 */

import { ChatMessage, PeerDevice } from "../../types";
import { ipc } from "../ipc";
import { storageService } from "../storage";
import { toCompactAvatarIdentifier } from "../../utils/avatars";

// 接收方接收文件（支持多媒体自动接收及指定 Media 目录与 MD5 文件名）
export async function acceptFileTransfer(
  msg: ChatMessage,
  senderPeer?: PeerDevice,
): Promise<{ success: boolean; error?: string }> {
  if (!msg.fileAttachment) {
    return { success: false, error: "消息中未包含文件元数据" };
  }

  const fileMeta = msg.fileAttachment;
  const senderIp = fileMeta.senderIp || senderPeer?.ip || msg.senderIp;
  const senderPort =
    fileMeta.senderPort || senderPeer?.port || msg.senderPort || 57088;

  if (!senderIp) {
    return { success: false, error: "无法获取发送方的局域网 IP 地址" };
  }

  const isMedia =
    msg.msgType === "image" ||
    msg.msgType === "video" ||
    msg.msgType === "audio" ||
    fileMeta.isMedia;
  const dotIndex = fileMeta.name.lastIndexOf(".");
  const ext = dotIndex !== -1 ? fileMeta.name.substring(dotIndex + 1) : "";
  const mediaFileName = fileMeta.md5
    ? ext
      ? `${fileMeta.md5}.${ext}`
      : fileMeta.md5
    : undefined;

  // 1. 立即在本地将状态更新为传输中
  fileMeta.state = "transferring";
  fileMeta.progress = 0;
  await storageService.saveChatMessage(msg);
  ipc.emit("chat://updated", msg);

  // 2. 向发送方发送 file_accept 信令
  const local = ipc.getLocalConfig();
  const content =
    isMedia && mediaFileName
      ? `file_accept:${fileMeta.id}:Media:${mediaFileName}`
      : `file_accept:${fileMeta.id}`;

  const acceptMsg: ChatMessage = {
    id: "msg-" + Math.random().toString(36).substring(2, 10),
    peerId: msg.senderId,
    peerIp: senderIp,
    senderId: local.id,
    senderName: local.name,
    senderAvatarUrl: toCompactAvatarIdentifier(local.avatarUrl),
    senderIp: local.ip,
    senderPort: local.port || 57088,
    content,
    msgType: "system",
    timestamp: Date.now(),
    status: "delivered",
    fileAttachment: {
      ...fileMeta,
      senderIp: local.ip,
      senderPort: local.port || 57088,
    },
  };

  try {
    if (senderPeer && senderPeer.ip) {
      await ipc.sendChatMessage(senderPeer, acceptMsg);
    } else {
      await ipc.sendChatMessage(senderIp, acceptMsg);
    }
  } catch (err: any) {
    // 无法连接发送方，回退至中断状态
    fileMeta.state = "failed";
    fileMeta.speed = 0;
    await storageService.saveChatMessage(msg);
    ipc.emit("chat://updated", msg);
    return {
      success: false,
      error: `发送方 [${senderIp}:${senderPort}] 当前无法连接，请确认对方已启动应用并连接在同一局域网`,
    };
  }

  return { success: true };
}

// 接收方点击【继续接收】（断点续传）
export async function resumeFileTransfer(
  msg: ChatMessage,
  senderPeer?: PeerDevice,
): Promise<{ success: boolean; error?: string }> {
  if (!msg.fileAttachment) {
    return { success: false, error: "消息中未包含文件元数据" };
  }

  const fileMeta = msg.fileAttachment;
  const senderIp =
    fileMeta.senderIp || senderPeer?.ip || msg.senderIp || msg.peerIp;
  const senderPort =
    fileMeta.senderPort || senderPeer?.port || msg.senderPort || 57088;

  if (!senderIp) {
    return { success: false, error: "无法获取发送方的局域网 IP 地址" };
  }

  const isMedia =
    msg.msgType === "image" ||
    msg.msgType === "video" ||
    msg.msgType === "audio" ||
    fileMeta.isMedia;
  const dotIndex = fileMeta.name.lastIndexOf(".");
  const ext = dotIndex !== -1 ? fileMeta.name.substring(dotIndex + 1) : "";
  const mediaFileName = fileMeta.md5
    ? ext
      ? `${fileMeta.md5}.${ext}`
      : fileMeta.md5
    : undefined;
  const destName = isMedia && mediaFileName ? mediaFileName : fileMeta.name;

  // 若发送方当前显示为离线或在已发现列表中找不到，优先快速探测一次以确认是否已上线并恢复在线状态
  let isPeerOnline = senderPeer?.status === "online";
  if (!isPeerOnline) {
    try {
      const probed = await ipc.probePeerIp(senderIp, senderPort);
      if (probed) {
        isPeerOnline = true;
      }
    } catch {
      // 探测未果，直接尝试发送信令进行网络连通性测试
    }
  }

  // 精确获取本地已有部分文件的字节大小作为续传 offset
  let offset = 0;
  try {
    const diskSize = await ipc.getPartialFileSize(destName);
    if (diskSize > 0 && diskSize < fileMeta.size) {
      offset = diskSize;
    }
  } catch {
    // ignore
  }

  if (offset === 0) {
    if (
      fileMeta.transferredBytes &&
      fileMeta.transferredBytes < fileMeta.size
    ) {
      offset = fileMeta.transferredBytes;
    } else if (fileMeta.progress > 0 && fileMeta.progress < 100) {
      offset = Math.floor((fileMeta.progress / 100) * fileMeta.size);
    }
  }

  // 更新本地状态为继续传输中
  fileMeta.state = "transferring";
  fileMeta.transferredBytes = offset;
  fileMeta.progress =
    fileMeta.size > 0
      ? Math.min(99.9, Number(((offset / fileMeta.size) * 100).toFixed(1)))
      : 0;
  await storageService.saveChatMessage(msg);
  ipc.emit("chat://updated", msg);

  // 获取本机配置与最新可用 IP
  let local = ipc.getLocalConfig();
  if (!local.ip || local.ip === "127.0.0.1" || local.ip === "0.0.0.0") {
    try {
      const sysInfo = await ipc.getSysInfo();
      if (sysInfo && sysInfo.local_ip) {
        local = { ...local, ip: sysInfo.local_ip };
        ipc.updateLocalConfig(local);
      }
    } catch {
      // ignore
    }
  }

  // 向发送方发送 file_resume:fileId:offset 信令（媒体携带 :Media:destName）
  const resumeContent =
    isMedia && mediaFileName
      ? `file_resume:${fileMeta.id}:${offset}:Media:${mediaFileName}`
      : `file_resume:${fileMeta.id}:${offset}`;

  const resumeMsg: ChatMessage = {
    id: "msg-" + Math.random().toString(36).substring(2, 10),
    peerId: msg.senderId,
    peerIp: senderIp,
    senderId: local.id,
    senderName: local.name,
    senderAvatarUrl: toCompactAvatarIdentifier(local.avatarUrl),
    senderIp: local.ip,
    senderPort: local.port || 57088,
    content: resumeContent,
    msgType: "system",
    timestamp: Date.now(),
    status: "delivered",
    fileAttachment: {
      ...fileMeta,
      senderIp: local.ip,
      senderPort: local.port || 57088,
    },
  };

  try {
    if (senderPeer && senderPeer.ip) {
      await ipc.sendChatMessage(senderPeer, resumeMsg);
    } else {
      await ipc.sendChatMessage(senderIp, resumeMsg);
    }
  } catch (err: any) {
    // 无法连接发送方，回退至中断状态
    fileMeta.state = "failed";
    fileMeta.speed = 0;
    await storageService.saveChatMessage(msg);
    ipc.emit("chat://updated", msg);
    return {
      success: false,
      error: `发送方 [${senderIp}:${senderPort}] 当前无法连接，请确认对方已启动应用并连接在同一局域网`,
    };
  }

  return { success: true };
}

// 拒绝接收文件
export async function rejectFileTransfer(msg: ChatMessage): Promise<void> {
  if (!msg.fileAttachment) return;
  msg.fileAttachment.state = "rejected";
  await storageService.saveChatMessage(msg);
  ipc.emit("chat://updated", msg);
}
