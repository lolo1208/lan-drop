/**
 * 文件传输状态队列与运行时临时缓存管理器
 * 维护内存中待发送、正在发送的文件 Blob 引用及传输任务上下文
 */

export const pendingOutgoingFiles = new Map<
  string,
  {
    file: File | Blob;
    name: string;
    size: number;
    originalPath?: string;
    destName?: string;
    folder?: string;
  }
>();
