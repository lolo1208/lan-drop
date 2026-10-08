# 屏幕截图

Windows 桌面客户端中，输入框下方的按钮从左到右依次为“截图、文件、表情”。默认全局截图快捷键为 `Ctrl+Alt+Shift+A`，可在“偏好设置 → 系统设置 → 截图快捷键”更改或禁用。窗口显示／隐藏快捷键保持独立。

触发截图时保持本程序可见，可框选本程序界面。拖动鼠标框选区域，点击“确认”或按 Enter 完成；按 Esc、右键或切换到其他应用取消。框选区域按物理像素计算，可以跨显示器。

确认后图片复制到系统剪贴板，同时加入截图开始时所选联系人的输入区预览。点击缩略图查看大图，点击叉号移除，点击“发送”才发送给对方。多张截图可一起发送，文字先发送；失败时保留尚未发送的内容。切换联系人不会将截图草稿带入另一个聊天。

没有选中联系人时仅复制并提示。剪贴板被其他软件占用时显示错误；有聊天目标的截图仍可预览和发送。草稿仅保存在内存中，关闭应用后不会保留。

首次增加配置时自动采用默认组合，空字符串表示禁用。系统热键被其他应用占用、与窗口热键重复或格式无效时，保存失败并保留旧配置。应用启动时某个热键注册失败，不影响另一热键和按钮截图。

首版不包含标注工具。macOS、Linux 和浏览器预览显示截图不可用说明。

## 验证

- `pnpm lint`、`pnpm build`、`cargo check --manifest-path src-tauri/Cargo.toml`。
- `cargo test --manifest-path src-tauri/Cargo.toml`：坐标边界、反向拖拽、热键注册／持久化失败回滚、旧配置和禁用配置。
- 交互式 Windows 桌面运行 `cargo test --manifest-path src-tauri/Cargo.toml native_overlay_confirms_png_and_cancels_next_session -- --ignored --test-threads=1`。测试短暂显示白色测试窗口，验证 80 × 60 PNG 的位置、颜色及下一次截图取消；不修改剪贴板。
- 运行 `pnpm dev`，在隔离浏览器的开发者工具执行 `const { runScreenshotUiCheck } = await import('/scripts/screenshot-ui-check.mjs'); await runScreenshotUiCheck();`。检查按钮顺序、预览、联系人绑定、失败重试、多图发送、重复启动与取消；使用内存 IPC 替身，不实际发送消息。
- 多显示器负坐标和 100%／125%／150% 混合缩放、托盘和最小化热键、实际剪贴板粘贴及另一台设备接收图片，还需在相应桌面环境完成手动验收。
