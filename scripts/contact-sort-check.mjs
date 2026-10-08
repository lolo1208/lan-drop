/** 运行 node scripts/contact-sort-check.mjs，验证会话构建到侧边栏渲染的排序，不启动 IPC。 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export { buildConversations } from "./src/hooks/usePeerSync"; export { Sidebar } from "./src/components/Sidebar";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [{
    name: "隔离通信",
    setup(builder) {
      builder.onResolve({ filter: /services\/ipc$/ }, () => ({ path: "ipc", namespace: "检查替身" }));
      builder.onLoad({ filter: /.*/, namespace: "检查替身" }, () => ({ contents: "export const ipc = {};" }));
    },
  }],
});
const require = createRequire(import.meta.url);
let search = "";
let firstState;
const isolatedReact = {
  ...React,
  useState(initial) {
    const value = firstState ? search : initial;
    firstState = false;
    return React.useState(value);
  },
};
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  (name) => name === "react" ? isolatedReact : require(name), module, module.exports,
);
const { buildConversations, Sidebar } = module.exports;
const config = { id: "self", name: "本机", ip: "192.168.10.1" };
const peer = (id, name, status) => ({ id, name, status, ip: "192.168.10.8", port: 57088, os: "windows" });
// 各设备使用不同 IP，避免触发会话按 IP 合并。
const peers = [
  peer("zheng", "老郑", "online"), peer("desktop", "DESKTOP-S0TABJ5", "online"),
  peer("device", "局域网设备", "offline"), peer("bao", "包子", "offline"), peer("liu", "老刘", "online"),
].map((p, i) => ({ ...p, ip: `192.168.10.${i + 2}` }));
const message = (peerId, timestamp) => ({ id: `${peerId}-${timestamp}`, peerId, senderId: "self", senderName: "本机", content: "匹配", msgType: "text", timestamp, status: "sent" });
const chats = [message("zheng", 500), message("desktop", 100), message("device", 400), message("bao", 300), message("zheng", 50)];

function check(list, history, query, expected) {
  search = query;
  firstState = true;
  const conversations = buildConversations(list, history, config);
  const markup = renderToStaticMarkup(React.createElement(Sidebar, {
    conversations, allChats: history, activePeerId: null, currentUserId: config.id,
    localName: config.name, localIp: config.ip, onSelectPeer() {}, onOpenSettings() {},
  }));
  const visible = peers.map(p => ({ name: p.name, at: markup.indexOf(`>${p.name}</span>`) }))
    .filter(p => p.at >= 0).sort((a, b) => a.at - b.at).map(p => p.name);
  assert.deepEqual(visible, expected);
}
const expected = ["老郑", "DESKTOP-S0TABJ5", "老刘", "局域网设备", "包子"];
check(peers, chats, "", expected);
check([...peers].reverse(), [...chats].reverse(), "", expected);
check(peers, chats, "匹配", ["老郑", "DESKTOP-S0TABJ5", "局域网设备", "包子"]);
check(peers, chats, "老", ["老郑", "老刘"]);
check(peers.map(p => p.id === "liu" ? { ...p, status: "offline" } : p), chats, "", expected.filter(name => name !== "老刘"));
console.log("联系人侧边栏检查通过：截图顺序、搜索顺序、乱序输入和上下线。");
