/**
 * 聊天服务辅助工具函数
 * 提供本地文件路径向 Tauri asset 协议 URL 的转换及对端网络地址解析辅助方法
 */

import { isTauri } from "../ipc";

// 辅助：在 Tauri 环境下将硬盘保存路径转换为可信安全资源协议 URL (asset://)
export async function convertToLocalUrl(filePath?: string): Promise<string> {
  if (!filePath) return "";
  if (isTauri()) {
    try {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      return convertFileSrc(filePath);
    } catch {
      return "";
    }
  }
  return "";
}
