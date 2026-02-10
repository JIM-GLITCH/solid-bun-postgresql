// 在 Windows 发布版中隐藏控制台窗口，请勿删除！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 程序入口：只负责调用 lib 里的 Tauri 应用启动逻辑
fn main() {
    tauri_app_lib::run()
}
