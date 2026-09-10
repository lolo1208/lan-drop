/**
 * HTTP Chunk 分块流式文件拉取与本地分片写入模块
 * 负责通过 HTTP POST 流式协议将本地文件分块推送到对端 Axum 服务器，支持断点续传 offset 偏移量
 */

import { ChatMessage } from "../../types";
import { ipc } from "../ipc";
import { storageService } from "../storage";

// 执行向对端 Axum 流式传输的核心方法（支持断点续传 offset 与目标文件夹）
export async function streamFileToTarget(
  fileBlob: File | Blob,
  fileName: string,
  fileSize: number,
  fileId: string,
  targetIp: string,
  targetPort: number,
  chatMsg?: ChatMessage,
  offset: number = 0,
  folder?: string,
) {
  const folderParam = folder ? `&folder=${encodeURIComponent(folder)}` : "";
  const url = `http://${targetIp}:${targetPort}/api/transfer/stream?task_id=${encodeURIComponent(fileId)}&file_name=${encodeURIComponent(fileName)}&file_size=${fileSize}&sender_id=local&offset=${offset}${folderParam}`;
  const sliceBlob =
    offset > 0 && offset < fileSize ? fileBlob.slice(offset) : fileBlob;

  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);

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
        const progress = Math.min(
          99,
          Math.round((currentTotalTransferred / fileSize) * 100),
        );
        if (chatMsg && chatMsg.fileAttachment) {
          chatMsg.fileAttachment.state = "transferring";
          chatMsg.fileAttachment.transferredBytes = currentTotalTransferred;
          chatMsg.fileAttachment.progress = progress;
          chatMsg.fileAttachment.speed = speed;
          ipc.emit("chat://updated", chatMsg);
        }
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (chatMsg && chatMsg.fileAttachment) {
          chatMsg.fileAttachment.state = "received";
          chatMsg.fileAttachment.transferredBytes = fileSize;
          chatMsg.fileAttachment.progress = 100;
          chatMsg.fileAttachment.speed = 0;
          await storageService.saveChatMessage(chatMsg);
          ipc.emit("chat://updated", chatMsg);
        }
      } else {
        throw new Error(`HTTP ${xhr.status}: ${xhr.statusText}`);
      }
    };

    xhr.onerror = async () => {
      console.error("推流连接失败");
      if (chatMsg && chatMsg.fileAttachment) {
        chatMsg.fileAttachment.state = "failed";
        chatMsg.fileAttachment.speed = 0;
        await storageService.saveChatMessage(chatMsg);
        ipc.emit("chat://updated", chatMsg);
      }
    };

    xhr.send(sliceBlob);
  } catch (err) {
    console.error("发起文件推流失败:", err);
    if (chatMsg && chatMsg.fileAttachment) {
      chatMsg.fileAttachment.state = "failed";
      chatMsg.fileAttachment.speed = 0;
      await storageService.saveChatMessage(chatMsg);
      ipc.emit("chat://updated", chatMsg);
    }
  }
}
