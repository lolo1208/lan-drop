// Tauri 构建预处理脚本
// 负责在 Rust 编译阶段自动链接图标、生成 Windows 资源及应用元数据清单
fn main() {
    tauri_build::build()
}
