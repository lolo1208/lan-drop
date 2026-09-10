/**
 * 应用程序前端入口文件
 * 负责 React 18 根节点挂载、全局样式加载以及在特定桌面环境下全局禁用默认右键菜单
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// 全局禁用 WebView 默认右键菜单（彻底消除“返回/刷新/另存为/检查”等浏览器原生菜单）
if (typeof window !== "undefined") {
  window.addEventListener(
    "contextmenu",
    (e: MouseEvent) => {
      e.preventDefault();
    },
    { capture: true },
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
