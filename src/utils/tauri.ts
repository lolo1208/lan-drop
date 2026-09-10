/**
 * 运行时环境检测工具函数
 * 检测当前前端代码是否运行在 Tauri 桌面原生容器或标准 Web 浏览器环境中
 */

export const isTauri = (): boolean => {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
};
