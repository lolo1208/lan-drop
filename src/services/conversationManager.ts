/**
 * 会话与流式文件传输编排管理器
 * 负责调度聊天消息构建、文件发送握手、对端接收确认以及推流/拉流
 */

import { ChatMessage, FileAttachmentMeta, PeerDevice } from '../types';
import { ipc, isTauri } from './ipc';
import { storageService } from './storage';

// 辅助：将 Blob/File 读取为 Base64 Data URL (防图片裂开、无跨域问题、持久化正常渲染)
function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    if (blob.size > 8 * 1024 * 1024) {
      resolve(typeof window !== 'undefined' ? URL.createObjectURL(blob) : '');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string) || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

// 辅助：在 Tauri 环境下将硬盘保存路径转换为可信安全资源协议 URL (asset://)
export async function convertToLocalUrl(filePath?: string): Promise<string> {
  if (!filePath) return '';
  if (isTauri()) {
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      return convertFileSrc(filePath);
    } catch {
      return '';
    }
  }
  return '';
}

class ConversationManager {
  // 内存中缓存待发送的原始 File/Blob 引用，用于接收方确认接收时推流
  private pendingOutgoingFiles: Map<
    string,
    { file: File | Blob; name: string; size: number; originalPath?: string }
  > = new Map();

  constructor() {
    this.initFileTransferListeners();
  }

  // 发送即时文本消息
  async sendTextMessage(targetPeer: PeerDevice, text: string): Promise<ChatMessage> {
    const local = ipc.getLocalConfig();
    const msg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: targetPeer.id,
      peerIp: targetPeer.ip,
      senderId: local.id,
      senderName: local.name,
      senderAvatarUrl: local.avatarUrl,
      senderIp: local.ip,
      senderPort: local.port || 57088,
      content: text,
      msgType: 'text',
      timestamp: Date.now(),
      status: targetPeer.status === 'online' ? 'delivered' : 'sent',
    };

    await ipc.sendChatMessage(targetPeer, msg);
    return msg;
  }

  // 发送文件消息（生成带文件元数据的待接收消息，并将文件放入内存等待接收方点击接收）
  async sendFileMessage(
    targetPeer: PeerDevice,
    file: File | { name: string; size: number; type: string; blob: Blob; path?: string }
  ): Promise<ChatMessage> {
    const local = ipc.getLocalConfig();
    const blob = 'blob' in file ? file.blob : file;
    const originalPath = 'path' in file ? file.path : (file as any).path;

    let msgType: 'file' | 'image' | 'video' | 'audio' = 'file';
    if (file.type.startsWith('image/')) {
      msgType = 'image';
    } else if (file.type.startsWith('video/')) {
      msgType = 'video';
    } else if (file.type.startsWith('audio/')) {
      msgType = 'audio';
    }

    // 图片转 Base64 存储，彻底消除 blob URL 权限与生命周期失效导致的图片裂开问题
    let blobUrl = '';
    if (msgType === 'image') {
      blobUrl = await fileToBase64(blob);
    } else {
      blobUrl = typeof window !== 'undefined' ? URL.createObjectURL(blob) : '';
    }

    const fileId = 'file-' + Math.random().toString(36).substring(2, 10);
    const fileMeta: FileAttachmentMeta = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      blobUrl,
      originalPath,
      state: 'waiting_accept', // 初始为“等待对端确认接收”
      progress: 0,
      speed: 0,
      senderIp: local.ip,
      senderPort: local.port || 57088,
    };

    // 缓存至内存，等待对端发回 file_accept 信令时推流
    this.pendingOutgoingFiles.set(fileId, {
      file: blob,
      name: file.name,
      size: file.size,
      originalPath,
    });

    const msg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: targetPeer.id,
      peerIp: targetPeer.ip,
      senderId: local.id,
      senderName: local.name,
      senderAvatarUrl: local.avatarUrl,
      senderIp: local.ip,
      senderPort: local.port || 57088,
      content: file.name,
      msgType,
      timestamp: Date.now(),
      status: targetPeer.status === 'online' ? 'delivered' : 'sent',
      fileAttachment: fileMeta,
    };

    await ipc.sendChatMessage(targetPeer, msg);
    return msg;
  }

  // 接收方点击【接收文件】
  async acceptFileTransfer(
    msg: ChatMessage,
    senderPeer?: PeerDevice
  ): Promise<{ success: boolean; error?: string }> {
    if (!msg.fileAttachment) {
      return { success: false, error: '消息中未包含文件元数据' };
    }

    const fileMeta = msg.fileAttachment;
    const senderIp = fileMeta.senderIp || senderPeer?.ip || msg.senderIp;
    const senderPort = fileMeta.senderPort || senderPeer?.port || msg.senderPort || 57088;

    if (!senderIp) {
      return { success: false, error: '无法获取发送方的局域网 IP 地址' };
    }

    // 1. 立即在本地将状态更新为传输中
    fileMeta.state = 'transferring';
    fileMeta.progress = 0;
    await storageService.saveChatMessage(msg);
    ipc.emit('chat://updated', msg);

    // 2. 向发送方发送 file_accept 信令
    const local = ipc.getLocalConfig();
    const acceptMsg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: msg.senderId,
      peerIp: senderIp,
      senderId: local.id,
      senderName: local.name,
      senderAvatarUrl: local.avatarUrl,
      senderIp: local.ip,
      senderPort: local.port || 57088,
      content: `file_accept:${fileMeta.id}`,
      msgType: 'system',
      timestamp: Date.now(),
      status: 'delivered',
      fileAttachment: {
        ...fileMeta,
        senderIp: local.ip,
        senderPort: local.port || 57088,
      },
    };

    if (senderPeer && senderPeer.ip) {
      await ipc.sendChatMessage(senderPeer, acceptMsg);
    } else {
      await ipc.sendChatMessage(senderIp, acceptMsg);
    }

    return { success: true };
  }

  // 拒绝接收文件
  async rejectFileTransfer(msg: ChatMessage): Promise<void> {
    if (!msg.fileAttachment) return;
    msg.fileAttachment.state = 'rejected';
    await storageService.saveChatMessage(msg);
    ipc.emit('chat://updated', msg);
  }

  // 初始化监听：当作为发送端收到接收方的 file_accept 时，触发流式上传
  private initFileTransferListeners() {
    ipc.on<{
      fileId: string;
      receiverId: string;
      receiverName: string;
      receiverIp?: string;
      receiverPort?: number;
    }>('file://accepted', async (data) => {
      let item = this.pendingOutgoingFiles.get(data.fileId);

      // 获取当前聊天消息对象
      const allChats = await storageService.getAllChats();
      const msg = allChats.find((m) => m.fileAttachment?.id === data.fileId);

      // 若因刷新等导致内存中未找到 pending item，但消息元数据中有 originalPath，自动进行灾备重建
      if (!item && msg && msg.fileAttachment?.originalPath) {
        item = {
          file: new Blob([]),
          name: msg.fileAttachment.name,
          size: msg.fileAttachment.size,
          originalPath: msg.fileAttachment.originalPath,
        };
      }

      if (!item) {
        console.warn('未在发送缓存中找到待传文件:', data.fileId);
        return;
      }

      // 寻找接收方 IP
      const peers = await ipc.getDiscoveredPeers();
      const receiverPeer = peers.find((p) => p.id === data.receiverId || (data.receiverIp && p.ip === data.receiverIp));
      const targetIp = data.receiverIp || receiverPeer?.ip;
      const targetPort = data.receiverPort || receiverPeer?.port || 57088;

      if (!targetIp) {
        console.error('无法确定接收方 IP，传输已终止:', data);
        return;
      }

      if (msg && msg.fileAttachment) {
        msg.fileAttachment.state = 'transferring';
        msg.fileAttachment.progress = 0;
        await storageService.saveChatMessage(msg);
        ipc.emit('chat://updated', msg);
      }

      // 优先在 Tauri 环境下调用 Rust 真正的 Tokio 异步推流
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          if (item.originalPath) {
            await invoke('start_file_transfer', {
              targetIp,
              targetPort,
              filePath: item.originalPath,
              taskId: data.fileId,
            });
            return;
          } else if (item.file && item.file.size > 0) {
            // 通过 ArrayBuffer 读取并在 Rust 侧以直连 Socket 推流，彻底避开 Webview CORS/PNA 限制
            const arrayBuffer = await (item.file instanceof Blob ? item.file.arrayBuffer() : (item.file as any).arrayBuffer());
            const uint8Array = new Uint8Array(arrayBuffer);
            await invoke('transfer_file_data', {
              targetIp,
              targetPort,
              taskId: data.fileId,
              fileName: item.name,
              fileSize: item.size,
              data: Array.from(uint8Array),
            });
            return;
          }
        } catch (err) {
          console.warn('Tauri 原生推流启动失败，回退到 Web 数据流:', err);
        }
      }

      // Web 或非原生路径回退：通过 HTTP Chunk 写入流
      this.streamFileToTarget(item.file, item.name, item.size, data.fileId, targetIp, targetPort, msg);
    });

    // 监听接收端流式接收实时进度 (收件方视角更新进度条)
    ipc.on<{
      taskId: string;
      fileName: string;
      transferred: number;
      total: number;
      speed: number;
    }>('transfer://incoming_progress', async (data) => {
      const allChats = await storageService.getAllChats();
      const msg = allChats.find(
        (m) => m.fileAttachment?.id === data.taskId || m.fileAttachment?.name === data.fileName
      );
      if (msg && msg.fileAttachment) {
        const total = data.total || msg.fileAttachment.size || 0;
        const progress = total > 0 ? Math.min(99, Math.round((data.transferred / total) * 100)) : 0;
        msg.fileAttachment.state = 'transferring';
        msg.fileAttachment.progress = progress;
        msg.fileAttachment.speed = data.speed;
        ipc.emit('chat://updated', msg);
      }
    });

    // 监听接收端接收完全完成 (收件方落地磁盘完成)
    ipc.on<{
      taskId: string;
      fileName: string;
      savedPath: string;
      totalSize: number;
    }>('transfer://incoming_complete', async (data) => {
      const allChats = await storageService.getAllChats();
      const msg = allChats.find(
        (m) => m.fileAttachment?.id === data.taskId || m.fileAttachment?.name === data.fileName
      );
      if (msg && msg.fileAttachment) {
        msg.fileAttachment.state = 'received';
        msg.fileAttachment.progress = 100;
        msg.fileAttachment.speed = 0;
        msg.fileAttachment.savedPath = data.savedPath;
        if (msg.msgType === 'image' && data.savedPath) {
          msg.fileAttachment.blobUrl = await convertToLocalUrl(data.savedPath);
        }
        await storageService.saveChatMessage(msg);
        ipc.emit('chat://updated', msg);
      }
    });

    // 监听 Tauri 原生发送进度 (发件方视角更新)
    ipc.on<{ taskId: string; transferred: number; total: number; speed: number }>(
      'transfer://progress',
      async (data) => {
        const allChats = await storageService.getAllChats();
        const msg = allChats.find((m) => m.fileAttachment?.id === data.taskId);
        if (msg && msg.fileAttachment) {
          const total = data.total || msg.fileAttachment.size || 0;
          const progress = total > 0 ? Math.min(99, Math.round((data.transferred / total) * 100)) : 0;
          msg.fileAttachment.state = 'transferring';
          msg.fileAttachment.progress = progress;
          msg.fileAttachment.speed = data.speed;
          if (progress >= 99 || data.transferred >= total) {
            msg.fileAttachment.state = 'received';
            msg.fileAttachment.progress = 100;
          }
          await storageService.saveChatMessage(msg);
          ipc.emit('chat://updated', msg);
        }
      }
    );
  }

  // 执行向对端 Axum 流式传输的核心方法
  private async streamFileToTarget(
    fileBlob: File | Blob,
    fileName: string,
    fileSize: number,
    fileId: string,
    targetIp: string,
    targetPort: number,
    chatMsg?: ChatMessage
  ) {
    const url = `http://${targetIp}:${targetPort}/api/transfer/stream?task_id=${encodeURIComponent(fileId)}&file_name=${encodeURIComponent(fileName)}&file_size=${fileSize}&sender_id=local`;

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);

      let lastTime = Date.now();
      let lastLoaded = 0;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const now = Date.now();
          const elapsed = (now - lastTime) / 1000;
          const speed = elapsed > 0 ? (e.loaded - lastLoaded) / elapsed : 0;
          lastTime = now;
          lastLoaded = e.loaded;

          const progress = Math.min(99, Math.round((e.loaded / e.total) * 100));
          if (chatMsg && chatMsg.fileAttachment) {
            chatMsg.fileAttachment.progress = progress;
            chatMsg.fileAttachment.speed = speed;
            ipc.emit('chat://updated', chatMsg);
          }
        }
      };

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (chatMsg && chatMsg.fileAttachment) {
            chatMsg.fileAttachment.state = 'received';
            chatMsg.fileAttachment.progress = 100;
            chatMsg.fileAttachment.speed = 0;
            await storageService.saveChatMessage(chatMsg);
            ipc.emit('chat://updated', chatMsg);
          }
        } else {
          throw new Error(`HTTP ${xhr.status}: ${xhr.statusText}`);
        }
      };

      xhr.onerror = async () => {
        console.error('推流连接失败');
        if (chatMsg && chatMsg.fileAttachment) {
          chatMsg.fileAttachment.state = 'failed';
          await storageService.saveChatMessage(chatMsg);
          ipc.emit('chat://updated', chatMsg);
        }
      };

      xhr.send(fileBlob);
    } catch (err) {
      console.error('发起文件推流失败:', err);
      if (chatMsg && chatMsg.fileAttachment) {
        chatMsg.fileAttachment.state = 'failed';
        await storageService.saveChatMessage(chatMsg);
        ipc.emit('chat://updated', chatMsg);
      }
    }
  }
}

export const conversationManager = new ConversationManager();
