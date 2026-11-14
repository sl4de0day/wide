#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use http::Response;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

#[derive(Debug)]
enum UserEvent {
    SidecarLine(String),
    SidecarExit,
    WindowDrag,
    WindowMinimize,
    WindowMaximize,
    WindowClose,
    OpenPath(String),
}

fn get_mime(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn get_exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_renderer_dir(exe_dir: &Path) -> PathBuf {
    let direct_ui = exe_dir.join("ui");
    if direct_ui.join("index.html").exists() {
        return direct_ui;
    }
    let res_renderer = exe_dir.join("resources").join("app").join("out").join("renderer");
    if res_renderer.join("index.html").exists() {
        return res_renderer;
    }
    let out_renderer = exe_dir.join("out").join("renderer");
    if out_renderer.join("index.html").exists() {
        return out_renderer;
    }
    let mut cur = exe_dir.to_path_buf();
    for _ in 0..8 {
        let cand = cur.join("out").join("renderer");
        if cand.join("index.html").exists() {
            return cand;
        }
        let cand_ui = cur.join("ui");
        if cand_ui.join("index.html").exists() {
            return cand_ui;
        }
        if !cur.pop() {
            break;
        }
    }
    direct_ui
}

fn resolve_assets_dir(exe_dir: &Path) -> PathBuf {
    let direct_assets = exe_dir.join("assets");
    if direct_assets.exists() {
        return direct_assets;
    }
    let native_assets = exe_dir.join("native-host").join("assets");
    if native_assets.exists() {
        return native_assets;
    }
    let mut cur = exe_dir.to_path_buf();
    for _ in 0..8 {
        let cand = cur.join("native-host").join("assets");
        if cand.exists() {
            return cand;
        }
        let cand_a = cur.join("assets");
        if cand_a.exists() {
            return cand_a;
        }
        if !cur.pop() {
            break;
        }
    }
    direct_assets
}

fn resolve_node_exe(exe_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let local_node = exe_dir.join("node.exe");
        if local_node.exists() {
            return local_node;
        }
        let sys_node = PathBuf::from("C:\\Program Files\\nodejs\\node.exe");
        if sys_node.exists() {
            return sys_node;
        }
        PathBuf::from("node.exe")
    }
    #[cfg(not(windows))]
    {
        let local_node = exe_dir.join("node");
        if local_node.exists() {
            return local_node;
        }
        PathBuf::from("node")
    }
}

fn resolve_sidecar_script(exe_dir: &Path) -> PathBuf {
    let cand1 = exe_dir.join("sidecar").join("sidecar.cjs");
    if cand1.exists() {
        return cand1;
    }
    let cand2 = exe_dir.join("resources").join("app").join("sidecar").join("sidecar.cjs");
    if cand2.exists() {
        return cand2;
    }
    let mut cur = exe_dir.to_path_buf();
    for _ in 0..8 {
        let cand = cur.join("sidecar").join("sidecar.cjs");
        if cand.exists() {
            return cand;
        }
        if !cur.pop() {
            break;
        }
    }
    cand1
}

fn build_preload_script(assets_dir: &Path) -> String {
    let bridge_shim = r#"
window.chrome = window.chrome || {};
window.__wideIpcListeners = window.__wideIpcListeners || new Set();
window.chrome.webview = {
  postMessage: function(data) {
    if (window.ipc && window.ipc.postMessage) {
      window.ipc.postMessage(typeof data === "string" ? data : JSON.stringify(data));
    }
  },
  addEventListener: function(event, fn) {
    if (event === "message") window.__wideIpcListeners.add(fn);
  },
  removeEventListener: function(event, fn) {
    if (event === "message") window.__wideIpcListeners.delete(fn);
  }
};
window.__wideDispatchMessage = function(raw) {
  var msg = typeof raw === "string" ? JSON.parse(raw) : raw;
  window.__wideIpcListeners.forEach(function(fn) {
    try { fn({ data: msg }); } catch (e) { console.error(e); }
  });
};
"#;

    let engine_preview = fs::read_to_string(assets_dir.join("engine-preview.js")).unwrap_or_default();
    let preload_shim = fs::read_to_string(assets_dir.join("preload-shim.js")).unwrap_or_default();
    let titlebar = fs::read_to_string(assets_dir.join("titlebar.js")).unwrap_or_default();

    format!("{}\n{}\n{}\n{}", bridge_shim, engine_preview, preload_shim, titlebar)
}

struct Sidecar {
    child: Mutex<Option<Child>>,
    stdin_tx: Mutex<Option<Sender<String>>>,
    proxy: EventLoopProxy<UserEvent>,
    exe_dir: PathBuf,
}

impl Sidecar {
    fn new(proxy: EventLoopProxy<UserEvent>, exe_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            child: Mutex::new(None),
            stdin_tx: Mutex::new(None),
            proxy,
            exe_dir,
        })
    }

    fn spawn(&self) {
        let node_bin = resolve_node_exe(&self.exe_dir);
        let script = resolve_sidecar_script(&self.exe_dir);

        let mut cmd = Command::new(node_bin);
        cmd.arg(&script);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::inherit());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        match cmd.spawn() {
            Ok(mut child) => {
                let stdout = child.stdout.take();
                let stdin = child.stdin.take();

                let (tx, rx): (Sender<String>, Receiver<String>) = channel();
                *self.stdin_tx.lock().unwrap() = Some(tx);
                *self.child.lock().unwrap() = Some(child);

                let proxy = self.proxy.clone();
                if let Some(stdout) = stdout {
                    thread::spawn(move || {
                        let reader = BufReader::new(stdout);
                        for line in reader.lines() {
                            match line {
                                Ok(l) => {
                                    let _ = proxy.send_event(UserEvent::SidecarLine(l));
                                }
                                Err(_) => break,
                            }
                        }
                        let _ = proxy.send_event(UserEvent::SidecarExit);
                    });
                }

                if let Some(mut stdin) = stdin {
                    thread::spawn(move || {
                        while let Ok(msg) = rx.recv() {
                            let _ = stdin.write_all(msg.as_bytes());
                            let _ = stdin.write_all(b"\n");
                            let _ = stdin.flush();
                        }
                    });
                }
            }
            Err(e) => {
                eprintln!("Failed to spawn sidecar: {}", e);
                let _ = self.proxy.send_event(UserEvent::SidecarExit);
            }
        }
    }

    fn send(&self, line: String) {
        if let Some(tx) = self.stdin_tx.lock().unwrap().as_ref() {
            let _ = tx.send(line);
        }
    }

    fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        *self.stdin_tx.lock().unwrap() = None;
    }
}

fn parse_cli_open_path() -> Option<String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    for arg in args {
        if !arg.starts_with('-') && !arg.starts_with('/') {
            let p = PathBuf::from(&arg);
            if p.exists() {
                return fs::canonicalize(&p)
                    .ok()
                    .and_then(|c| c.to_str().map(|s| s.to_string()))
                    .or(Some(arg));
            }
        }
    }
    None
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let exe_dir = get_exe_dir();
    let renderer_dir = resolve_renderer_dir(&exe_dir);
    let assets_dir = resolve_assets_dir(&exe_dir);
    let pending_open_path = parse_cli_open_path();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("Wide")
        .with_decorations(false)
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(720.0, 480.0))
        .build(&event_loop)?;

    let sidecar = Sidecar::new(proxy.clone(), exe_dir);
    sidecar.spawn();

    let r_dir = renderer_dir.clone();
    let protocol_handler = move |_webview_id: wry::WebViewId, req: http::Request<Vec<u8>>| {
        let uri_path = req.uri().path();
        let target_rel = if uri_path == "/" || uri_path.is_empty() {
            "index.html"
        } else {
            uri_path.trim_start_matches('/')
        };

        let target_file = r_dir.join(target_rel);
        let final_file = if target_file.exists() && target_file.is_file() {
            target_file
        } else {
            r_dir.join("index.html")
        };

        match fs::read(&final_file) {
            Ok(bytes) => {
                let mime = get_mime(&final_file);
                Response::builder()
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(Cow::from(bytes))
                    .unwrap()
            }
            Err(_) => Response::builder()
                .status(404)
                .header("Content-Type", "text/plain")
                .body(Cow::from(b"404 Not Found".to_vec()))
                .unwrap(),
        }
    };

    let sidecar_for_ipc = sidecar.clone();
    let proxy_for_ipc = proxy.clone();
    let pending_open_for_ipc = pending_open_path.clone();

    let ipc_handler = move |req: http::Request<String>| {
        let body = req.body();
        if let Ok(val) = serde_json::from_str::<Value>(body) {
            let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if msg_type == "host-cmd" {
                let cmd = val.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
                match cmd {
                    "drag" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowDrag);
                    }
                    "minimize" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowMinimize);
                    }
                    "maximize" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowMaximize);
                    }
                    "close" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowClose);
                    }
                    "consume-open-path" => {
                        if let Some(path) = &pending_open_for_ipc {
                            let _ = proxy_for_ipc.send_event(UserEvent::OpenPath(path.clone()));
                        }
                    }
                    _ => {}
                }
            } else if msg_type == "invoke" {
                let fwd = json!({
                    "t": "invoke",
                    "id": val.get("replyId").and_then(|v| v.as_u64()).unwrap_or(0),
                    "channel": val.get("channel").and_then(|v| v.as_str()).unwrap_or(""),
                    "args": val.get("args").unwrap_or(&json!([]))
                });
                sidecar_for_ipc.send(fwd.to_string());
            }
        }
    };

    let preload_init = build_preload_script(&assets_dir);

    let webview = WebViewBuilder::new()
        .with_custom_protocol("app".into(), protocol_handler)
        .with_initialization_script(&preload_init)
        .with_ipc_handler(ipc_handler)
        .with_url("app://localhost/index.html")
        .build(&window)?;

    let sidecar_main = sidecar.clone();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::UserEvent(ue) => match ue {
                UserEvent::SidecarLine(line) => {
                    if line.starts_with("{\"type\":") {
                        let script = format!(
                            "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
                            line
                        );
                        let _ = webview.evaluate_script(&script);
                    } else if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                        let t = msg.get("t").and_then(|v| v.as_str()).unwrap_or("");
                        if t == "reply" {
                            let rep = json!({
                                "type": "reply",
                                "replyId": msg.get("id"),
                                "result": msg.get("result"),
                                "error": msg.get("error")
                            });
                            let script = format!(
                                "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
                                rep.to_string()
                            );
                            let _ = webview.evaluate_script(&script);
                        } else if t == "host" {
                            let id = msg.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                            let method = msg.get("channel")
                                .or_else(|| msg.get("method"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if method == "webview:eval" {
                                if let Some(code) = msg.get("params").and_then(|p| p.get("code")).and_then(|c| c.as_str()) {
                                    let _ = webview.evaluate_script(code);
                                }
                                let rep = json!({
                                    "t": "hostReply",
                                    "id": id,
                                    "result": Value::Null
                                });
                                sidecar_main.send(rep.to_string());
                            } else if method == "app:installUpdate" {
                                let installer_path = msg.get("params")
                                    .and_then(|p| p.get("path"))
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let path = PathBuf::from(&installer_path);
                                if !installer_path.is_empty() && path.exists() {
                                    let rep = json!({
                                        "t": "hostReply",
                                        "id": id,
                                        "result": { "ok": true }
                                    });
                                    sidecar_main.send(rep.to_string());
                                    let path_clone = path.clone();
                                    let sidecar_stop = sidecar_main.clone();
                                    thread::spawn(move || {
                                        thread::sleep(std::time::Duration::from_millis(500));
                                        sidecar_stop.stop();
                                        #[cfg(windows)]
                                        {
                                            use std::os::windows::process::CommandExt;
                                            const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
                                            let mut cmd = Command::new(&path_clone);
                                            cmd.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOCANCEL"]);
                                            cmd.creation_flags(CREATE_BREAKAWAY_FROM_JOB);
                                            let _ = cmd.spawn();
                                        }
                                        #[cfg(not(windows))]
                                        {
                                            let _ = Command::new("chmod").args(["+x", path_clone.to_str().unwrap_or("")]).status();
                                            let _ = Command::new(&path_clone).spawn();
                                        }
                                        std::process::exit(0);
                                    });
                                } else {
                                    let rep = json!({
                                        "t": "hostReply",
                                        "id": id,
                                        "result": { "ok": false, "error": "The installer file could not be found." }
                                    });
                                    sidecar_main.send(rep.to_string());
                                }
                            } else if method == "shell:openExternal" {
                                if let Some(url) = msg.get("params").and_then(|p| p.get("url")).and_then(|u| u.as_str()) {
                                    #[cfg(windows)]
                                    let _ = Command::new("cmd").args(["/c", "start", "", url]).spawn();
                                    #[cfg(target_os = "macos")]
                                    let _ = Command::new("open").arg(url).spawn();
                                    #[cfg(target_os = "linux")]
                                    let _ = Command::new("xdg-open").arg(url).spawn();
                                }
                                let rep = json!({
                                    "t": "hostReply",
                                    "id": id,
                                    "result": Value::Null
                                });
                                sidecar_main.send(rep.to_string());
                            } else {
                                let rep = json!({
                                    "t": "hostReply",
                                    "id": id,
                                    "result": Value::Null
                                });
                                sidecar_main.send(rep.to_string());
                            }
                        }
                    }
                }
                UserEvent::SidecarExit => {
                    let ev = json!({
                        "type": "event",
                        "channel": "host:backend",
                        "payload": {
                            "state": "down"
                        }
                    });
                    let script = format!(
                        "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
                        ev.to_string()
                    );
                    let _ = webview.evaluate_script(&script);
                }
                UserEvent::WindowDrag => {
                    let _ = window.drag_window();
                }
                UserEvent::WindowMinimize => {
                    window.set_minimized(true);
                }
                UserEvent::WindowMaximize => {
                    window.set_maximized(!window.is_maximized());
                }
                UserEvent::WindowClose => {
                    sidecar_main.stop();
                    *control_flow = ControlFlow::Exit;
                }
                UserEvent::OpenPath(path) => {
                    let ev = json!({
                        "type": "event",
                        "channel": "host:openPath",
                        "payload": {
                            "path": path
                        }
                    });
                    let script = format!(
                        "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
                        ev.to_string()
                    );
                    let _ = webview.evaluate_script(&script);
                }
            },
            Event::WindowEvent { event, .. } => match event {
                WindowEvent::CloseRequested => {
                    sidecar_main.stop();
                    *control_flow = ControlFlow::Exit;
                }
                _ => {}
            },
            _ => {}
        }
    });
}
