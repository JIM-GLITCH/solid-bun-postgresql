//! Tauri 主逻辑：sidecar 后端通过 stdin/stdout pipe 通信，暴露 api_request 与事件
//!
//! 整体流程简述：
//! 1. 启动时用 sidecar 拉起一个后端进程（server-stdio），用管道和它通信
//! 2. 前端通过 Tauri 的 invoke 调用 api_request(method, payload)
//! 3. 我们把请求写成一行 JSON 发到 sidecar 的 stdin，并记下请求 id
//! 4. 另一个异步任务从 sidecar 的 stdout 读一行行 JSON：若是响应就根据 id 把结果还给对应请求；若是 event 就发给前端

use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::sync::{oneshot, Mutex};

/// 全局自增的请求 id，每次 api_request 调用时 +1，用来区分并发请求
static REQUEST_ID: AtomicU64 = AtomicU64::new(0);

/// 正在等待后端响应的请求表：key = 请求 id，value = 用于把结果送回调用方的 oneshot sender
type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// 与 sidecar 相关的状态，由 Tauri 的 app.manage() 管理，可在 command 里通过 state 拿到
struct SidecarState {
    /// sidecar 子进程句柄，用于往其 stdin 写请求；None 表示未启动或启动失败
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    /// 当前未完成的请求 id -> sender，后端返回时根据 id 找到 sender 并 send(result)
    pending: PendingMap,
}

/// 前端通过 Tauri invoke 调用的命令：把一次 API 请求发给 sidecar，等后端返回后把结果带回
#[tauri::command]
async fn api_request(
    app: tauri::AppHandle,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    let state = app.state::<SidecarState>();
    // 分配本请求唯一 id，后端返回时会带上这个 id
    let id = REQUEST_ID.fetch_add(1, Ordering::SeqCst);

    // oneshot：这边 send 一次，另一边 recv 一次；这里用来等后端返回时把 result 传回
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending.lock().await;
        pending.insert(id, tx);
    }

    // 拿到 sidecar 子进程，才能往它的 stdin 写
    let mut child_guard = state.child.lock().await;
    let child = child_guard
        .as_mut()
        .ok_or_else(|| "后端 sidecar 未启动".to_string())?;

    // 协议：一行 JSON，末尾换行。{ id, method, payload } 发给后端
    let line = serde_json::json!({ "id": id, "method": method, "payload": payload }).to_string();
    let buf = format!("{}\n", line);
    child
        .write(buf.as_bytes())
        .map_err(|e| format!("写入 pipe 失败: {}", e))?;

    drop(child_guard);

    // 阻塞直到：后端返回对应 id 的响应并 send 到 tx，或 channel 被 drop（超时/断开）
    let result = rx
        .await
        .map_err(|_| "等待后端响应超时或连接已断开".to_string())?;
    result
}

/// Tauri 应用入口：注册插件、在 setup 里启动 sidecar 并注册 api_request 命令
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())   // 打开链接/文件等
        .plugin(tauri_plugin_shell::init())    // 执行命令、sidecar
        .setup(|app| {
            let handle = app.handle().clone();
            let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));

            // 获取名为 "server-stdio" 的 sidecar 命令（对应打包进去的 server-stdio 可执行文件）
            let sidecar_cmd = match handle.shell().sidecar("server-stdio") {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("sidecar server-stdio 不可用（请先执行 build-stdio）: {}", e);
                    app.manage(SidecarState {
                        child: Mutex::new(None),
                        pending,
                    });
                    return Ok(());
                }
            };

            // 真正启动子进程；rx 用来接收子进程的 stdout/stderr 等事件，child 用来写 stdin
            let (mut rx, child) = match sidecar_cmd.spawn() {
                Ok(pair) => pair,
                Err(e) => {
                    eprintln!("启动后端 sidecar 失败: {}", e);
                    app.manage(SidecarState {
                        child: Mutex::new(None),
                        pending,
                    });
                    return Ok(());
                }
            };

            // 后台任务：持续读 sidecar 的 stdout，按行解析 JSON
            let pending_clone = pending.clone();
            tauri::async_runtime::spawn(async move {
                let mut buf = Vec::new();  // 行缓冲，可能一次收到多行或半行
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            buf.extend_from_slice(&line);
                            // 按 \n 切分出一行行
                            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                                let line_bytes = buf.drain(..=pos).collect::<Vec<_>>();
                                let line_str = match String::from_utf8(line_bytes) {
                                    Ok(s) => s.trim().to_string(),
                                    _ => continue,
                                };
                                if line_str.is_empty() {
                                    continue;
                                }
                                if let Ok(v) = serde_json::from_str::<Value>(&line_str) {
                                    // 类型为 "event" 的：推给前端监听 "backend-event"
                                    if v.get("type").and_then(|t| t.as_str()) == Some("event") {
                                        let _ = handle.emit("backend-event", &v);
                                        continue;
                                    }
                                    // 带 id 的：认为是某次 api_request 的响应，从 pending 里取出 sender 并送回结果
                                    if let Some(id) = v.get("id").and_then(|i| i.as_u64()) {
                                        let result = if let Some(err) =
                                            v.get("error").and_then(|e| e.as_str())
                                        {
                                            Err(err.to_string())
                                        } else if let Some(res) = v.get("result") {
                                            Ok(res.clone())
                                        } else {
                                            Err("响应缺少 result/error".to_string())
                                        };
                                        let mut p = pending_clone.lock().await;
                                        if let Some(tx) = p.remove(&id) {
                                            let _ = tx.send(result);
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            });

            // 把 sidecar 子进程和 pending 表交给 Tauri 管理，供 api_request 使用
            app.manage(SidecarState {
                child: Mutex::new(Some(child)),
                pending,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
