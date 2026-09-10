/**
 * 聊天记录与关联文件删除及存储清理服务模块
 * 负责单条/批量删除聊天记录并彻底物理删除落盘文件、释放内存 Blob URL 及清理数据库
 */

import { ChatMessage } from "../../types";
import { ipc } from "../ipc";
import { storageService } from "../storage";
import { pendingOutgoingFiles } from "./state";

/**
 * 辅助：从单条消息中提取所有可能的本地物理文件路径及内存 Blob 引用
 */
function extractFilePathsAndCleanBlobs(msg: ChatMessage): string[] {
  const paths: string[] = [];
  const file = msg.fileAttachment;
  if (!file) return paths;

  // 1. 释放浏览器内存中的 Blob 预览 URL 句柄
  if (file.blobUrl && file.blobUrl.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(file.blobUrl);
    } catch {
      // ignore
    }
  }

  // 2. 收集落地保存路径（如 Files/xxx 或 Media/xxx）
  if (file.savedPath && file.savedPath.trim()) {
    paths.push(file.savedPath);
  }

  // 3. 收集原文件名对应的可能路径（在 Media 或 Files 目录）
  if (file.name && file.name.trim()) {
    paths.push(file.name);
  }

  // 4. 若为音视频图片媒体且有 md5，收集按 md5 命名的缓存文件
  if (file.md5 && file.md5.trim()) {
    const ext = file.name ? file.name.split(".").pop() : "";
    const md5FileName = ext ? `${file.md5}.${ext}` : file.md5;
    paths.push(md5FileName);
  }

  // 5. 从运行时的待发送/正在发送缓存映射中移除
  if (file.id && pendingOutgoingFiles.has(file.id)) {
    pendingOutgoingFiles.delete(file.id);
  }
  if (msg.id && pendingOutgoingFiles.has(msg.id)) {
    pendingOutgoingFiles.delete(msg.id);
  }

  return paths;
}

/**
 * 删除单条聊天记录，若包含文件/图片/音视频则同步从硬盘物理删除
 */
export async function deleteMessage(msg: ChatMessage): Promise<void> {
  if (!msg || !msg.id) return;

  const filePaths = extractFilePathsAndCleanBlobs(msg);

  // 1. 从 SQLite / IndexedDB 数据库中删除消息记录
  await storageService.deleteChatMessage(msg.id);

  // 2. 如果关联有传输任务 ID，一并从传输表中清除
  if (msg.fileAttachment?.id) {
    await storageService.deleteTransfer(msg.fileAttachment.id);
  }

  // 3. 物理删除关联的文件（无论图片、视频、音频或普通文件）
  if (filePaths.length > 0) {
    for (const fp of filePaths) {
      await ipc.deleteFileFromDisk(fp);
    }
  }

  // 4. 发送事件通知前端组件即时更新
  ipc.emit("chat://deleted", { msgIds: [msg.id], peerId: msg.peerId });

  // 5. Web 预览模式下跨标签广播同步删除
  if (ipc.broadcastChannel) {
    try {
      ipc.broadcastChannel.postMessage({
        type: "CHAT_DELETED",
        data: { msgIds: [msg.id], peerId: msg.peerId },
      });
    } catch {
      // ignore
    }
  }
}

/**
 * 批量删除选中的多条聊天记录及其关联文件
 */
export async function deleteMessages(msgs: ChatMessage[]): Promise<void> {
  if (!msgs || msgs.length === 0) return;

  const msgIds: string[] = [];
  const allFilePaths: string[] = [];
  let targetPeerId: string | undefined = undefined;

  for (const m of msgs) {
    if (!m || !m.id) continue;
    msgIds.push(m.id);
    if (!targetPeerId) targetPeerId = m.peerId;

    const fps = extractFilePathsAndCleanBlobs(m);
    allFilePaths.push(...fps);

    if (m.fileAttachment?.id) {
      storageService.deleteTransfer(m.fileAttachment.id).catch(() => {});
    }
  }

  if (msgIds.length === 0) return;

  // 1. 批量从数据库删除
  await storageService.deleteChatMessages(msgIds);

  // 2. 批量物理删除硬盘中的文件
  if (allFilePaths.length > 0) {
    await ipc.deleteFilesFromDisk(allFilePaths);
  }

  // 3. 触发本地事件与广播通知
  ipc.emit("chat://deleted", { msgIds, peerId: targetPeerId });

  if (ipc.broadcastChannel) {
    try {
      ipc.broadcastChannel.postMessage({
        type: "CHAT_DELETED",
        data: { msgIds, peerId: targetPeerId },
      });
    } catch {
      // ignore
    }
  }
}

/**
 * 清空与指定联系人的全部聊天记录，并彻底删除该会话的所有关联文件
 */
export async function clearPeerChat(
  peerId: string,
  peerMessages: ChatMessage[],
): Promise<void> {
  if (!peerId) return;

  const allFilePaths: string[] = [];

  // 1. 提取该联系人所有历史消息中的文件路径并释放 Blob
  for (const m of peerMessages) {
    if (m.peerId === peerId || m.senderId === peerId) {
      const fps = extractFilePathsAndCleanBlobs(m);
      allFilePaths.push(...fps);

      if (m.fileAttachment?.id) {
        storageService.deleteTransfer(m.fileAttachment.id).catch(() => {});
      }
    }
  }

  // 2. 从数据库清空该联系人的所有聊天消息
  await storageService.clearChat(peerId);

  // 3. 物理删除该联系人聊天记录中的所有文件
  if (allFilePaths.length > 0) {
    await ipc.deleteFilesFromDisk(allFilePaths);
  }

  // 4. 触发本地与广播事件
  ipc.emit("chat://cleared", { peerId });

  if (ipc.broadcastChannel) {
    try {
      ipc.broadcastChannel.postMessage({
        type: "CHAT_CLEARED",
        data: { peerId },
      });
    } catch {
      // ignore
    }
  }
}
