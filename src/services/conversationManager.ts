/**
 * 会话与流式文件传输编排管理器
 * 负责调度聊天消息构建、文件发送握手、对端接收确认以及推流/拉流
 */

import { ChatMessage, FileAttachmentMeta, PeerDevice } from '../types';
import { ipc, isTauri } from './ipc';
import { storageService } from './storage';
import { calculateBlobMd5 } from '../utils/md5';
import { toCompactAvatarIdentifier } from '../utils/avatars';

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
    {
      file: File | Blob;
      name: string;
      size: number;
      originalPath?: string;
      destName?: string;
      folder?: string;
    }
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
      senderAvatarUrl: toCompactAvatarIdentifier(local.avatarUrl),
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

  // 发送文件/多媒体消息（多媒体自动保存至 [用户文档]/LAN Drop/Media 并以 MD5 命名，非 base64 形式发送）
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

    const isMedia = msgType === 'image' || msgType === 'video' || msgType === 'audio';
    const fileId = 'file-' + Math.random().toString(36).substring(2, 10);

    const dotIndex = file.name.lastIndexOf('.');
    const ext = dotIndex !== -1 ? file.name.substring(dotIndex + 1) : '';

    let fileMd5: string | undefined = undefined;
    let savedPath: string | undefined = undefined;
    let blobUrl = '';
    let mediaDestName: string | undefined = undefined;

    if (isMedia) {
      // 1. 计算媒体文件内容的 MD5 值
      fileMd5 = await calculateBlobMd5(blob);
      mediaDestName = ext ? `${fileMd5}.${ext}` : fileMd5;

      // 2. 发送方自动接收并保存到 [用户文档]/LAN Drop/Media 目录中（MD5 命名去重）
      if (originalPath) {
        savedPath = await ipc.saveMediaFromPath(fileMd5, ext, originalPath);
      } else {
        const arrayBuffer = await blob.arrayBuffer();
        savedPath = await ipc.saveMediaFileToDisk(fileMd5, ext, new Uint8Array(arrayBuffer));
      }

      // 3. 聊天界面中显示或播放（预览）的是保存的这个文件
      if (savedPath) {
        blobUrl = await convertToLocalUrl(savedPath);
      }
      if (!blobUrl && typeof window !== 'undefined') {
        blobUrl = URL.createObjectURL(blob);
      }
    } else {
      blobUrl = typeof window !== 'undefined' ? URL.createObjectURL(blob) : '';
    }

    // 发送方本地持久化文件元数据
    const localFileMeta: FileAttachmentMeta = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      md5: fileMd5,
      isMedia,
      blobUrl,
      originalPath,
      savedPath,
      state: isMedia ? 'received' : 'waiting_accept',
      progress: isMedia ? 100 : 0,
      speed: 0,
      senderIp: local.ip,
      senderPort: local.port || 57088,
    };

    // 缓存至发送方待传输队列，供对端自动/手动拉取
    this.pendingOutgoingFiles.set(fileId, {
      file: blob,
      name: file.name,
      size: file.size,
      originalPath,
      destName: mediaDestName,
      folder: isMedia ? 'Media' : undefined,
    });

    // 发给对端的消息：多媒体以文件形式发送，不传递巨大 Base64
    const outgoingFileMeta: FileAttachmentMeta = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      md5: fileMd5,
      isMedia,
      state: 'waiting_accept',
      progress: 0,
      speed: 0,
      senderIp: local.ip,
      senderPort: local.port || 57088,
    };

    const msg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
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
      status: targetPeer.status === 'online' ? 'delivered' : 'sent',
      fileAttachment: outgoingFileMeta,
    };

    // 发送网络信令/消息
    await ipc.sendChatMessage(targetPeer, msg);

    // 本地保存发送方自己的完整状态（含已保存路径 savedPath）
    const localMsg: ChatMessage = {
      ...msg,
      fileAttachment: localFileMeta,
    };
    await storageService.saveChatMessage(localMsg);
    ipc.emit('chat://updated', localMsg);

    return localMsg;
  }

  // 接收方接收文件（支持多媒体自动接收及指定 Media 目录与 MD5 文件名）
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

    const isMedia = msg.msgType === 'image' || msg.msgType === 'video' || msg.msgType === 'audio' || fileMeta.isMedia;
    const dotIndex = fileMeta.name.lastIndexOf('.');
    const ext = dotIndex !== -1 ? fileMeta.name.substring(dotIndex + 1) : '';
    const mediaFileName = fileMeta.md5 ? (ext ? `${fileMeta.md5}.${ext}` : fileMeta.md5) : undefined;

    // 1. 立即在本地将状态更新为传输中
    fileMeta.state = 'transferring';
    fileMeta.progress = 0;
    await storageService.saveChatMessage(msg);
    ipc.emit('chat://updated', msg);

    // 2. 向发送方发送 file_accept 信令
    const local = ipc.getLocalConfig();
    const content = isMedia && mediaFileName
      ? `file_accept:${fileMeta.id}:Media:${mediaFileName}`
      : `file_accept:${fileMeta.id}`;

    const acceptMsg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: msg.senderId,
      peerIp: senderIp,
      senderId: local.id,
      senderName: local.name,
      senderAvatarUrl: toCompactAvatarIdentifier(local.avatarUrl),
      senderIp: local.ip,
      senderPort: local.port || 57088,
      content,
      msgType: 'system',
      timestamp: Date.now(),
      status: 'delivered',
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
      fileMeta.state = 'failed';
      fileMeta.speed = 0;
      await storageService.saveChatMessage(msg);
      ipc.emit('chat://updated', msg);
      return {
        success: false,
        error: `发送方 [${senderIp}:${senderPort}] 当前无法连接，请确认对方已启动应用并连接在同一局域网`,
      };
    }

    return { success: true };
  }

  // 接收方点击【继续接收】（断点续传）
  async resumeFileTransfer(
    msg: ChatMessage,
    senderPeer?: PeerDevice
  ): Promise<{ success: boolean; error?: string }> {
    if (!msg.fileAttachment) {
      return { success: false, error: '消息中未包含文件元数据' };
    }

    const fileMeta = msg.fileAttachment;
    const senderIp = fileMeta.senderIp || senderPeer?.ip || msg.senderIp || msg.peerIp;
    const senderPort = fileMeta.senderPort || senderPeer?.port || msg.senderPort || 57088;

    if (!senderIp) {
      return { success: false, error: '无法获取发送方的局域网 IP 地址' };
    }

    const isMedia = msg.msgType === 'image' || msg.msgType === 'video' || msg.msgType === 'audio' || fileMeta.isMedia;
    const dotIndex = fileMeta.name.lastIndexOf('.');
    const ext = dotIndex !== -1 ? fileMeta.name.substring(dotIndex + 1) : '';
    const mediaFileName = fileMeta.md5 ? (ext ? `${fileMeta.md5}.${ext}` : fileMeta.md5) : undefined;
    const destName = isMedia && mediaFileName ? mediaFileName : fileMeta.name;

    // 若发送方当前显示为离线或在已发现列表中找不到，优先快速探测一次以确认是否已上线并恢复在线状态
    let isPeerOnline = senderPeer?.status === 'online';
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
      if (fileMeta.transferredBytes && fileMeta.transferredBytes < fileMeta.size) {
        offset = fileMeta.transferredBytes;
      } else if (fileMeta.progress > 0 && fileMeta.progress < 100) {
        offset = Math.floor((fileMeta.progress / 100) * fileMeta.size);
      }
    }

    // 更新本地状态为继续传输中
    fileMeta.state = 'transferring';
    fileMeta.transferredBytes = offset;
    fileMeta.progress = fileMeta.size > 0 ? Math.min(99.9, Number(((offset / fileMeta.size) * 100).toFixed(1))) : 0;
    await storageService.saveChatMessage(msg);
    ipc.emit('chat://updated', msg);

    // 获取本机配置与最新可用 IP
    let local = ipc.getLocalConfig();
    if (!local.ip || local.ip === '127.0.0.1' || local.ip === '0.0.0.0') {
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
    const resumeContent = isMedia && mediaFileName
      ? `file_resume:${fileMeta.id}:${offset}:Media:${mediaFileName}`
      : `file_resume:${fileMeta.id}:${offset}`;

    const resumeMsg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: msg.senderId,
      peerIp: senderIp,
      senderId: local.id,
      senderName: local.name,
      senderAvatarUrl: toCompactAvatarIdentifier(local.avatarUrl),
      senderIp: local.ip,
      senderPort: local.port || 57088,
      content: resumeContent,
      msgType: 'system',
      timestamp: Date.now(),
      status: 'delivered',
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
      fileMeta.state = 'failed';
      fileMeta.speed = 0;
      await storageService.saveChatMessage(msg);
      ipc.emit('chat://updated', msg);
      return {
        success: false,
        error: `发送方 [${senderIp}:${senderPort}] 当前无法连接，请确认对方已启动应用并连接在同一局域网`,
      };
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

  // 发送局域网已读回执信令给对端，通知对方我已阅读消息
  async sendReadReceipt(targetPeer: PeerDevice | string): Promise<void> {
    const local = ipc.getLocalConfig();
    const peerId = typeof targetPeer === 'string' ? targetPeer : targetPeer.id;
    const receiptMsg: ChatMessage = {
      id: 'receipt-' + Math.random().toString(36).substring(2, 10),
      peerId,
      senderId: local.id,
      senderName: local.name,
      content: 'read_receipt:all',
      msgType: 'system',
      timestamp: Date.now(),
      status: 'delivered',
    };
    try {
      await ipc.sendChatMessage(targetPeer, receiptMsg);
    } catch {
      // ignore read receipt network failure
    }
  }

  // 初始化监听：当作为发送端收到接收方的 file_accept 时，触发流式上传
  private initFileTransferListeners() {
    // 监听接收到的消息（包含常规消息与系统已读回执信令）
    ipc.on<ChatMessage>('chat://received', async (msg) => {
      if (!msg) return;

      // 监听已读回执信令：当对端告知已读时，将本端发给对端的消息更新为已读
      if (msg.msgType === 'system' && msg.content && msg.content.startsWith('read_receipt')) {
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
            ipc.emit('chat://updated', m);
          }
        }
        if (updatedCount > 0) {
          ipc.emit('chat://read_status_changed', { peerId });
        }
        return;
      }

      if (!msg.fileAttachment) return;
      const isMedia = msg.msgType === 'image' || msg.msgType === 'video' || msg.msgType === 'audio' || msg.fileAttachment.isMedia;
      if (!isMedia) return;

      const fileMeta = msg.fileAttachment;
      const dotIndex = fileMeta.name.lastIndexOf('.');
      const ext = dotIndex !== -1 ? fileMeta.name.substring(dotIndex + 1) : '';
      const mediaFileName = fileMeta.md5 ? (ext ? `${fileMeta.md5}.${ext}` : fileMeta.md5) : fileMeta.name;

      // 1. 检查本地是否已存在相同 MD5 的媒体文件（去重，避免相同文件重复保存/下载）
      const mediaDir = await ipc.getMediaDir();
      const expectedPath = `${mediaDir}/${mediaFileName}`;
      const alreadyExists = await ipc.checkFileExists(expectedPath);

      if (alreadyExists) {
        // 本地已存在完全一致的媒体文件，立即完成
        fileMeta.state = 'received';
        fileMeta.progress = 100;
        fileMeta.transferredBytes = fileMeta.size;
        fileMeta.savedPath = expectedPath;
        fileMeta.blobUrl = await convertToLocalUrl(expectedPath);
        await storageService.saveChatMessage(msg);
        ipc.emit('chat://updated', msg);
        return;
      }

      // 若已经接收完成并且文件存在则无需处理
      if (fileMeta.state === 'received' && fileMeta.savedPath) return;

      // 2. 本地不存在，自动发起接收
      const peers = await ipc.getDiscoveredPeers();
      const senderPeer = peers.find(
        (p) =>
          p.id === msg.senderId ||
          (fileMeta.senderIp && p.ip === fileMeta.senderIp) ||
          (msg.senderIp && p.ip === msg.senderIp)
      );
      await this.acceptFileTransfer(msg, senderPeer);
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
    }>('file://accepted', async (data) => {
      let item = this.pendingOutgoingFiles.get(data.fileId);
      const offset = data.offset || 0;

      // 获取当前聊天消息对象
      const allChats = await storageService.getAllChats();
      const msg = allChats.find((m) => m.fileAttachment?.id === data.fileId);

      // 若因刷新等导致内存中未找到 pending item，但消息元数据中有 originalPath 或 savedPath，自动进行灾备重建
      if (!item && msg && (msg.fileAttachment?.originalPath || msg.fileAttachment?.savedPath)) {
        const sourcePath = msg.fileAttachment.savedPath || msg.fileAttachment.originalPath;
        item = {
          file: new Blob([]),
          name: msg.fileAttachment.name,
          size: msg.fileAttachment.size,
          originalPath: sourcePath,
          folder: data.folder || (msg.fileAttachment.isMedia ? 'Media' : undefined),
          destName: data.destName,
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

      const effectiveFolder = data.folder || item.folder;
      const effectiveDestName = data.destName || item.destName;

      if (msg && msg.fileAttachment) {
        msg.fileAttachment.state = 'transferring';
        msg.fileAttachment.transferredBytes = offset;
        msg.fileAttachment.progress = msg.fileAttachment.size > 0 ? Math.min(99.9, Number(((offset / msg.fileAttachment.size) * 100).toFixed(1))) : 0;
        await storageService.saveChatMessage(msg);
        ipc.emit('chat://updated', msg);
      }

      // 优先在 Tauri 环境下调用 Rust 真正的 Tokio 异步推流（支持断点续传 offset 与 Media 目录）
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          if (item.originalPath) {
            await invoke('start_file_transfer', {
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
            const arrayBuffer = await (item.file instanceof Blob ? item.file.arrayBuffer() : (item.file as any).arrayBuffer());
            const uint8Array = new Uint8Array(arrayBuffer);
            await invoke('transfer_file_data', {
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
          console.warn('Tauri 原生推流启动失败，回退到 Web 数据流:', err);
        }
      }

      // Web 或非原生路径回退：通过 HTTP Chunk 写入流
      this.streamFileToTarget(
        item.file,
        effectiveDestName || item.name,
        item.size,
        data.fileId,
        targetIp,
        targetPort,
        msg,
        offset,
        effectiveFolder
      );
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
        const progress = total > 0 ? Math.min(99.9, Number(((data.transferred / total) * 100).toFixed(1))) : 0;
        msg.fileAttachment.state = 'transferring';
        msg.fileAttachment.transferredBytes = data.transferred;
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
        msg.fileAttachment.transferredBytes = data.totalSize;
        msg.fileAttachment.speed = 0;
        msg.fileAttachment.savedPath = data.savedPath;
        if (msg.msgType === 'image' || msg.msgType === 'video' || msg.msgType === 'audio' || msg.fileAttachment.isMedia) {
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
          const progress = total > 0 ? Math.min(99.9, Number(((data.transferred / total) * 100).toFixed(1))) : 0;
          msg.fileAttachment.state = 'transferring';
          msg.fileAttachment.transferredBytes = data.transferred;
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

    // 监听发送端传输中断/报错
    ipc.on<{ taskId: string; error: string }>('transfer://error', async (data) => {
      const allChats = await storageService.getAllChats();
      const msg = allChats.find((m) => m.fileAttachment?.id === data.taskId);
      if (msg && msg.fileAttachment && msg.fileAttachment.state === 'transferring') {
        msg.fileAttachment.state = 'failed';
        msg.fileAttachment.speed = 0;
        await storageService.saveChatMessage(msg);
        ipc.emit('chat://updated', msg);
      }
    });

    // 监听接收端传输中断/报错
    ipc.on<{ taskId: string; fileName: string; transferred: number; total: number; error: string }>(
      'transfer://incoming_error',
      async (data) => {
        const allChats = await storageService.getAllChats();
        const msg = allChats.find(
          (m) => m.fileAttachment?.id === data.taskId || m.fileAttachment?.name === data.fileName
        );
        if (msg && msg.fileAttachment && msg.fileAttachment.state === 'transferring') {
          msg.fileAttachment.state = 'failed';
          msg.fileAttachment.transferredBytes = data.transferred;
          msg.fileAttachment.speed = 0;
          await storageService.saveChatMessage(msg);
          ipc.emit('chat://updated', msg);
        }
      }
    );

    // 监听对端设备掉线：当有对端设备离线时，若存在与其正在进行中的流式传输，自动标记为“传输中断”并保留进度供重连后续传
    ipc.on<PeerDevice[]>('peers://updated', async (peers) => {
      const offlinePeerIds = new Set(
        peers.filter((p) => p.status === 'offline').map((p) => p.id)
      );
      const offlinePeerIps = new Set(
        peers.filter((p) => p.status === 'offline' && p.ip).map((p) => p.ip)
      );

      if (offlinePeerIds.size === 0 && offlinePeerIps.size === 0) return;

      const allChats = await storageService.getAllChats();
      let changed = false;

      for (const msg of allChats) {
        if (msg.fileAttachment && msg.fileAttachment.state === 'transferring') {
          const peerId = msg.peerId;
          const peerIp = msg.peerIp || msg.fileAttachment.senderIp;
          if (
            (peerId && offlinePeerIds.has(peerId)) ||
            (peerIp && offlinePeerIps.has(peerIp))
          ) {
            msg.fileAttachment.state = 'failed';
            msg.fileAttachment.speed = 0;
            await storageService.saveChatMessage(msg);
            ipc.emit('chat://updated', msg);
            changed = true;
          }
        }
      }
    });
  }

  // 执行向对端 Axum 流式传输的核心方法（支持断点续传 offset 与目标文件夹）
  private async streamFileToTarget(
    fileBlob: File | Blob,
    fileName: string,
    fileSize: number,
    fileId: string,
    targetIp: string,
    targetPort: number,
    chatMsg?: ChatMessage,
    offset: number = 0,
    folder?: string
  ) {
    const folderParam = folder ? `&folder=${encodeURIComponent(folder)}` : '';
    const url = `http://${targetIp}:${targetPort}/api/transfer/stream?task_id=${encodeURIComponent(fileId)}&file_name=${encodeURIComponent(fileName)}&file_size=${fileSize}&sender_id=local&offset=${offset}${folderParam}`;
    const sliceBlob = offset > 0 && offset < fileSize ? fileBlob.slice(offset) : fileBlob;

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

          const currentTotalTransferred = offset + e.loaded;
          const progress = Math.min(99, Math.round((currentTotalTransferred / fileSize) * 100));
          if (chatMsg && chatMsg.fileAttachment) {
            chatMsg.fileAttachment.state = 'transferring';
            chatMsg.fileAttachment.transferredBytes = currentTotalTransferred;
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
            chatMsg.fileAttachment.transferredBytes = fileSize;
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
          chatMsg.fileAttachment.speed = 0;
          await storageService.saveChatMessage(chatMsg);
          ipc.emit('chat://updated', chatMsg);
        }
      };

      xhr.send(sliceBlob);
    } catch (err) {
      console.error('发起文件推流失败:', err);
      if (chatMsg && chatMsg.fileAttachment) {
        chatMsg.fileAttachment.state = 'failed';
        chatMsg.fileAttachment.speed = 0;
        await storageService.saveChatMessage(chatMsg);
        ipc.emit('chat://updated', chatMsg);
      }
    }
  }
}

export const conversationManager = new ConversationManager();
