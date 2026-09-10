/**
 * 聊天与文件传输管理服务门面模块
 * 对外统一导出文本消息发送、文件传输启动、已读回执、接收同意与断点续传操作接口
 */

import { initFileTransferListeners } from "./listeners";
import { sendTextMessage, sendFileMessage, sendReadReceipt } from "./sender";
import {
  acceptFileTransfer,
  resumeFileTransfer,
  rejectFileTransfer,
} from "./receiver";
import { deleteMessage, deleteMessages, clearPeerChat } from "./delete";
export { convertToLocalUrl } from "./utils";
export { deleteMessage, deleteMessages, clearPeerChat } from "./delete";

class ChatManager {
  constructor() {
    initFileTransferListeners();
  }

  sendTextMessage = sendTextMessage;
  sendFileMessage = sendFileMessage;
  sendReadReceipt = sendReadReceipt;

  acceptFileTransfer = acceptFileTransfer;
  resumeFileTransfer = resumeFileTransfer;
  rejectFileTransfer = rejectFileTransfer;

  deleteMessage = deleteMessage;
  deleteMessages = deleteMessages;
  clearPeerChat = clearPeerChat;
}

export const chatManager = new ChatManager();
