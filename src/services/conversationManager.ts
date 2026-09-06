/**
 * LAN Drop 会话与文件消息调度器
 * 核心逻辑：
 * 1. 发送方选择发送文件后，产生一条待接收状态的消息卡片；
 * 2. 接收方必须主动点击“接收”按钮；
 * 3. 若发送方离线，则阻止接收并给出明确错误警告；
 * 4. 接收完成后，支持“打开所在目录”及媒体内嵌直接预览。
 */

import { ChatMessage, FileAttachmentMeta, PeerDevice, TransferTask } from '../types';
import { ipc, isTauri } from './ipc';
import { storageService } from './storage';

class ConversationManager {
  private activeDownloadTasks: Map<string, number> = new Map();

  // 发送文本消息
  async sendTextMessage(targetPeer: PeerDevice, text: string): Promise<ChatMessage> {
    const local = ipc.getLocalConfig();
    const msg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: targetPeer.id,
      senderId: local.id,
      senderName: local.name,
      content: text,
      msgType: 'text',
      timestamp: Date.now(),
      status: targetPeer.status === 'online' ? 'delivered' : 'sent',
    };

    await storageService.saveChatMessage(msg);
    ipc.emit('chat://updated', msg);

    await ipc.sendChatMessage(targetPeer.id, text);

    // 如果对方在线并且为内置模拟节点，自动回复一条简短消息
    if (targetPeer.status === 'online' && targetPeer.id.startsWith('peer-')) {
      setTimeout(() => {
        this.simulateAutoReply(targetPeer, text);
      }, 1200 + Math.random() * 800);
    }

    return msg;
  }

  // 发送文件/图片/音视频（在消息中创建卡片，不自动传，等待对端接收）
  async sendFileMessage(
    targetPeer: PeerDevice,
    file: File | { name: string; size: number; type: string; blob: Blob; path?: string }
  ): Promise<ChatMessage> {
    const local = ipc.getLocalConfig();
    const blobUrl = 'blob' in file ? URL.createObjectURL(file.blob) : URL.createObjectURL(file);
    const originalPath = 'path' in file ? file.path : (file as any).path;

    // 判断媒体类型
    let msgType: 'file' | 'image' | 'video' | 'audio' = 'file';
    if (file.type.startsWith('image/')) {
      msgType = 'image';
    } else if (file.type.startsWith('video/')) {
      msgType = 'video';
    } else if (file.type.startsWith('audio/')) {
      msgType = 'audio';
    }

    const fileMeta: FileAttachmentMeta = {
      id: 'file-' + Math.random().toString(36).substring(2, 10),
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      blobUrl,
      originalPath,
      state: 'waiting_accept', // 初始为“等待对端点击接收”
      progress: 0,
      speed: 0,
      senderIp: local.ip,
      senderPort: local.port,
    };

    const msg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: targetPeer.id,
      senderId: local.id,
      senderName: local.name,
      content: file.name,
      msgType,
      timestamp: Date.now(),
      status: targetPeer.status === 'online' ? 'delivered' : 'sent',
      fileAttachment: fileMeta,
    };

    // 发送真实消息给对端，带上 fileAttachment 的完整 JSON
    // 因为 sendChatMessage 本身会 saveChatMessage 并且 emit，我们直接调它
    await ipc.sendChatMessage(targetPeer.id, JSON.stringify(msg));

    // 若对端是在线模拟节点，模拟对端收到文件后有一定几率主动点击“接收”或提示已收到推送邀请
    if (targetPeer.status === 'online' && targetPeer.id.startsWith('peer-')) {
      setTimeout(() => {
        this.simulatePeerFileAck(targetPeer, file.name);
      }, 1500);
    }

    return msg;
  }

  // 接收方主动点击【接收文件】
  async acceptFileTransfer(
    msg: ChatMessage,
    senderPeer: PeerDevice | undefined,
    onProgress?: (progress: number, speed: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    if (!msg.fileAttachment) {
      return { success: false, error: '消息不包含文件' };
    }

    // 核心约束：发送方不在线时，无法接收文件！
    if (!senderPeer || senderPeer.status !== 'online') {
      const errMsg = `发送方 [${msg.senderName}] 当前不在线，无法启动流式传输！必须等待发送方重新接入局域网后方可接收。`;
      return { success: false, error: errMsg };
    }

    // 状态置为正在传输
    msg.fileAttachment.state = 'transferring';
    msg.fileAttachment.progress = 0;
    await storageService.saveChatMessage(msg);
    ipc.emit('chat://updated', msg);

    if (isTauri()) {
      // 真实环境：发送 file_accept 信令给对方，让对方启动推流
      const acceptMsg: ChatMessage = {
        id: 'msg-' + Math.random().toString(36).substring(2, 10),
        peerId: msg.senderId,
        senderId: ipc.getLocalConfig().id,
        senderName: ipc.getLocalConfig().name,
        content: 'file_accept:' + msg.id,
        msgType: 'system',
        timestamp: Date.now(),
        status: 'delivered',
      };
      await ipc.sendChatMessage(msg.senderId, JSON.stringify(acceptMsg));
      return { success: true };
    }

    // 网页模拟环境：开始走假进度条
    return new Promise((resolve) => {
      const totalBytes = msg.fileAttachment!.size;
      let transferred = 0;
      const targetSpeed = 92 * 1024 * 1024; // 92 MB/s 千兆传输
      const intervalMs = 60;
      const bytesPerTick = Math.max(64 * 1024, Math.floor((targetSpeed * intervalMs) / 1000));

      const timerId = window.setInterval(async () => {
        // 每步步进，并增加微弱真实网络抖动
        const chunk = Math.min(Math.floor(bytesPerTick * (0.9 + Math.random() * 0.2)), totalBytes - transferred);
        transferred += chunk;

        const currentSpeed = targetSpeed * (0.92 + Math.random() * 0.16);
        const progress = Math.min(100, Math.floor((transferred / totalBytes) * 100));

        if (msg.fileAttachment) {
          msg.fileAttachment.progress = progress;
          msg.fileAttachment.speed = currentSpeed;
        }

        if (onProgress) {
          onProgress(progress, currentSpeed);
        }

        ipc.emit('chat://updated', msg);

        // 传输结束
        if (transferred >= totalBytes) {
          clearInterval(timerId);
          this.activeDownloadTasks.delete(msg.id);

          const localConfig = ipc.getLocalConfig();
          const savedPath = `${localConfig.downloadDir}/${msg.fileAttachment!.name}`;

          if (msg.fileAttachment) {
            msg.fileAttachment.state = 'received';
            msg.fileAttachment.progress = 100;
            msg.fileAttachment.speed = 0;
            msg.fileAttachment.savedPath = savedPath;
          }

          await storageService.saveChatMessage(msg);

          // 记录至传输历史
          const taskRecord: TransferTask = {
            id: 'recv-' + msg.fileAttachment!.id,
            peerId: msg.senderId,
            peerName: msg.senderName,
            peerIp: senderPeer.ip,
            direction: 'receive',
            fileName: msg.fileAttachment!.name,
            fileSize: msg.fileAttachment!.size,
            fileType: msg.fileAttachment!.type,
            transferredBytes: msg.fileAttachment!.size,
            speed: 0,
            avgSpeed: targetSpeed,
            progress: 100,
            status: 'completed',
            startTime: Date.now() - 2000,
            endTime: Date.now(),
            etaSeconds: 0,
            memoryUsageMb: 3.6,
            fileBlobUrl: msg.fileAttachment!.blobUrl,
          };
          await storageService.saveTransfer(taskRecord);

          ipc.emit('chat://updated', msg);
          ipc.emit('file://received', msg);

          resolve({ success: true });
        }
      }, intervalMs);

      this.activeDownloadTasks.set(msg.id, timerId);
    });
  }

  // 拒收文件
  async rejectFile(msg: ChatMessage) {
    if (msg.fileAttachment) {
      msg.fileAttachment.state = 'rejected';
      await storageService.saveChatMessage(msg);
      ipc.emit('chat://updated', msg);
    }
  }

  // 打开文件所在目录并选中文件
  openInFolder(savedPath?: string, fileName?: string) {
    const target = savedPath || `[用户文档]/lan-drop/${fileName || 'file'}`;
    
    // 如果在 Tauri 桌面环境下，调用系统资源管理器定位文件
    if (isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('open_in_folder', { path: target }).catch((e) => {
          console.warn('Tauri open_in_folder invocation failed:', e);
        });
      });
      return target;
    }

    // Web 预览环境：提示已定位目录并触发直接保存/打开
    return target;
  }

  // 模拟对端收到文件后发送一条系统回执
  private async simulatePeerFileAck(peer: PeerDevice, fileName: string) {
    const replyMsg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: peer.id,
      senderId: peer.id,
      senderName: peer.name,
      content: `[Axum 接收端提示]: 收到文件「${fileName}」推送请求。我已点击“接收”，Tokio 异步数据流已写入我的磁盘。`,
      msgType: 'text',
      timestamp: Date.now(),
      status: 'delivered',
    };
    await storageService.saveChatMessage(replyMsg);
    ipc.emit('chat://updated', replyMsg);
  }

  // 模拟对端回复文本
  private async simulateAutoReply(peer: PeerDevice, userText: string) {
    let reply = `[${peer.name}]: 收到！局域网直连一切正常。`;
    if (userText.includes('好') || userText.includes('在吗')) {
      reply = `[${peer.name}]: 在线！正在通过 UDP 组播与你保持零配置心跳同步。`;
    } else if (userText.includes('视频') || userText.includes('图') || userText.includes('看')) {
      reply = `[${peer.name}]: 可以在聊天里直接发图片/视频/音频，支持直接内嵌播放与预览哦！`;
    }

    const replyMsg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 10),
      peerId: peer.id,
      senderId: peer.id,
      senderName: peer.name,
      content: reply,
      msgType: 'text',
      timestamp: Date.now(),
      status: 'delivered',
    };
    await storageService.saveChatMessage(replyMsg);
    ipc.emit('chat://updated', replyMsg);
  }
}

export const conversationManager = new ConversationManager();
