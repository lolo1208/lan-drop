/** 在 Vite 页面中运行截图交互检查，原生 IPC 使用内存替身，不发送消息或修改系统剪贴板。 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useScreenshot } from "/src/hooks/useScreenshot.ts";
import { ChatPanel } from "/src/components/ChatPanel/index.tsx";

export async function runScreenshotUiCheck() {
  const originalInternals = window.__TAURI_INTERNALS__;
  const originalEventInternals = window.__TAURI_EVENT_PLUGIN_INTERNALS__;
  const originalRoot = document.getElementById("root");
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;z-index:100;background:#1e1e1e";
  document.body.append(container);
  originalRoot.style.display = "none";
  const root = createRoot(container);
  const callbacks = new Map();
  const listeners = new Map();
  const toasts = [];
  const sent = [];
  const results = [];
  let callbackId = 0;
  let eventId = 0;
  let captures = 0;
  let failSending = false;
  let nextResult;
  let controls;
  const peerA = { id: "截图测试甲", name: "测试联系人甲", ip: "127.0.0.1", port: 57088, status: "online", os: "windows" };
  const peerB = { ...peerA, id: "截图测试乙", name: "测试联系人乙" };
  const canvas = document.createElement("canvas");
  canvas.width = 80; canvas.height = 60;
  const context = canvas.getContext("2d");
  context.fillStyle = "#0078d4"; context.fillRect(0, 0, 80, 60);
  const captureResult = { cancelled: false, pngBase64: canvas.toDataURL().split(",")[1], width: 80, height: 60, clipboardError: null };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback) { const id = ++callbackId; callbacks.set(id, callback); return id; },
    async invoke(command, args) {
      if (command === "start_screenshot") { captures++; return nextResult ?? captureResult; }
      if (command === "get_hotkey_errors") return [];
      if (command === "plugin:event|listen") {
        const id = ++eventId; listeners.set(id, { event: args.event, callback: callbacks.get(args.handler) }); return id;
      }
      if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
      return undefined;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id); } };
  const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const button = (text) => [...container.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
  const noop = () => {};
  function Harness() {
    const [peer, setPeer] = React.useState(peerA);
    const screenshot = useScreenshot({ selectedPeer: peer, onSelectPeer: setPeer, showToast: (message) => toasts.push(message) });
    controls = { ...screenshot, peer, setPeer };
    return React.createElement(ChatPanel, {
      peer, messages: [], screenshotDrafts: peer ? screenshot.drafts[peer.id] ?? [] : [],
      onScreenshot: screenshot.startScreenshot, screenshotSupported: screenshot.supported,
      isCapturing: screenshot.isCapturing, screenshotHotkey: "Ctrl+Alt+Shift+A",
      onRemoveScreenshot: screenshot.removeDraft, onToast: (message) => toasts.push(message),
      onSendMessage: async (target, text) => sent.push({ peerId: target.id, text }),
      onSendFile: async (target, file) => {
        if (failSending) throw new Error("模拟网络断开");
        sent.push({ peerId: target.id, name: file.name });
      },
      onAcceptFile: noop, onOpenInFolder: noop, onPreviewMedia: noop,
    });
  }
  try {
    flushSync(() => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness))));
    await wait();
    const toolbar = [...button("截图").parentElement.children].map((item) => item.textContent.trim());
    assert(toolbar.slice(0, 3).join(",") === "截图,文件,表情", "工具栏按钮顺序应为截图、文件、表情");
    assert(button("截图").title.includes("Ctrl+Alt+Shift+A"), "按钮未显示截图热键");
    results.push("截图按钮顺序与热键提示正确");

    await controls.startScreenshot(); await wait();
    assert(controls.drafts[peerA.id].length === 1 && sent.length === 0, "截图后应预览而非自动发送");
    assert(container.querySelector('img[alt^="待发送截图"]')?.naturalWidth === 80, "PNG 预览加载失败");
    assert(!button("发送").disabled, "只有截图时发送按钮应可用");
    results.push("截图复制结果转为 PNG 预览，未自动发送");

    flushSync(() => controls.setPeer(peerB)); await wait();
    assert(!container.querySelector('img[alt^="待发送截图"]'), "截图草稿串到了另一联系人");
    flushSync(() => controls.setPeer(peerA)); await wait();
    assert(container.querySelector('img[alt^="待发送截图"]'), "切换回来后截图丢失");
    results.push("截图草稿按联系人保留");

    failSending = true;
    button("发送").click(); await wait();
    assert(controls.drafts[peerA.id].length === 1 && toasts.some((text) => text.includes("未发送的内容已保留")), "失败后未保留截图");
    failSending = false;
    button("发送").click(); await wait();
    assert(controls.drafts[peerA.id].length === 0 && sent.length === 1, "重试未成功清除截图");
    results.push("发送失败保留截图，重试成功清除");

    let resolveCapture;
    nextResult = new Promise((resolve) => { resolveCapture = resolve; });
    const beforeCapture = captures;
    const pending = controls.startScreenshot();
    await controls.startScreenshot();
    flushSync(() => controls.setPeer(peerB));
    resolveCapture(captureResult);
    await pending; await wait();
    assert(captures === beforeCapture + 1 && controls.drafts[peerA.id].length === 1 && controls.peer.id === peerA.id, "重复启动或截图目标绑定错误");
    results.push("重复启动被拦截，截图期间切换联系人仍绑定原目标");
    nextResult = undefined;

    for (const item of listeners.values()) {
      if (item.event === "screenshot://requested") item.callback({ payload: null });
    }
    await wait();
    assert(controls.drafts[peerA.id].length === 2, "全局截图事件未进入统一流程");
    const textarea = container.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, "截图说明");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    button("发送").click(); await wait();
    assert(sent.length === 4 && sent[1].text === "截图说明" && sent[2].name.endsWith(".png") && sent[3].name.endsWith(".png"), "文字与多张截图发送顺序错误");
    results.push("全局事件只触发一次，文字先于多张截图发送");

    nextResult = { cancelled: true, pngBase64: null, width: 0, height: 0, clipboardError: null };
    await controls.startScreenshot(); await wait();
    assert(controls.drafts[peerA.id].length === 0, "取消截图生成了草稿");
    nextResult = { ...captureResult, clipboardError: "剪贴板被占用" };
    await controls.startScreenshot(); await wait();
    assert(controls.drafts[peerA.id].length === 1 && toasts.includes("剪贴板被占用"), "剪贴板失败后未保留预览或未提示");
    container.querySelector('button[aria-label="移除这张截图"]').click(); await wait();
    assert(controls.drafts[peerA.id].length === 0, "无法移除截图");
    results.push("取消、剪贴板失败和移除截图正确");

    flushSync(() => controls.setPeer(null));
    nextResult = captureResult;
    await controls.startScreenshot(); await wait();
    assert(Object.values(controls.drafts).every((drafts) => drafts.length === 0), "无联系人时不应生成聊天草稿");
    results.push("未选择联系人时仅复制并提示");
    return { passed: results.length, results };
  } finally {
    flushSync(() => root.unmount());
    await wait();
    container.remove();
    originalRoot.style.display = "";
    if (originalInternals) window.__TAURI_INTERNALS__ = originalInternals; else delete window.__TAURI_INTERNALS__;
    if (originalEventInternals) window.__TAURI_EVENT_PLUGIN_INTERNALS__ = originalEventInternals; else delete window.__TAURI_EVENT_PLUGIN_INTERNALS__;
  }
}
