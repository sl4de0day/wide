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
    dpi::{LogicalSize, PhysicalPosition, PhysicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::{Fullscreen, WindowBuilder},
};
#[cfg(windows)]
use tao::platform::windows::WindowExtWindows;
use wry::{WebContext, WebViewBuilder};
#[cfg(windows)]
use wry::WebViewBuilderExtWindows;

const BACKGROUND_COLOR: (u8, u8, u8) = (0x3B, 0x42, 0x52);

fn b64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((input.len() + 2) / 3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn b64_decode(input: &str) -> Option<Vec<u8>> {
    let mut val = 0u32;
    let mut valb = -8i32;
    let mut out = Vec::with_capacity((input.len() * 3) / 4);
    for byte in input.bytes() {
        if matches!(byte, b'\n' | b'\r' | b' ' | b'\t') {
            continue;
        }
        if byte == b'=' {
            break;
        }
        let d = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        val = (val << 6) | (d as u32);
        valb += 6;
        if valb >= 0 {
            out.push(((val >> valb) & 0xFF) as u8);
            valb -= 8;
        }
    }
    Some(out)
}

#[cfg(windows)]
mod dpapi {
    use core::ffi::c_void;
    use std::ptr::{null, null_mut};

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DataBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            p_data_in: *const DataBlob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }

    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        let mut input = DataBlob {
            cb_data: u32::try_from(data.len()).ok()?,
            pb_data: if data.is_empty() { null_mut() } else { data.as_ptr() as *mut u8 },
        };
        let mut output = DataBlob { cb_data: 0, pb_data: null_mut() };
        let ok = unsafe {
            CryptProtectData(
                &mut input,
                null(),
                null(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 || output.pb_data.is_null() {
            return None;
        }
        let slice = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) };
        let copy = slice.to_vec();
        unsafe {
            LocalFree(output.pb_data as *mut c_void);
        }
        Some(copy)
    }

    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        let mut input = DataBlob {
            cb_data: u32::try_from(data.len()).ok()?,
            pb_data: if data.is_empty() { null_mut() } else { data.as_ptr() as *mut u8 },
        };
        let mut output = DataBlob { cb_data: 0, pb_data: null_mut() };
        let ok = unsafe {
            CryptUnprotectData(
                &mut input,
                null_mut(),
                null(),
                null_mut(),
                null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 || output.pb_data.is_null() {
            return None;
        }
        let slice = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) };
        let copy = slice.to_vec();
        unsafe {
            LocalFree(output.pb_data as *mut c_void);
        }
        Some(copy)
    }
}

#[cfg(windows)]
mod win_host {
    use std::path::Path;
    use std::ptr::{null, null_mut};

    const HKEY_CURRENT_USER: isize = -2147483647isize;
    const KEY_READ: u32 = 0x20019;
    const KEY_WRITE: u32 = 0x20006;
    const REG_BINARY: u32 = 3;
    const IMAGE_ICON: u32 = 1;
    const LR_LOADFROMFILE: u32 = 0x0010;
    const WM_SETICON: u32 = 0x0080;
    const ICON_SMALL: usize = 0;
    const ICON_BIG: usize = 1;
    const MONITOR_DEFAULTTONULL: u32 = 0;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Point {
        pub x: i32,
        pub y: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WindowPlacement {
        pub length: u32,
        pub flags: u32,
        pub show_cmd: u32,
        pub pt_min_position: Point,
        pub pt_max_position: Point,
        pub rc_normal_position: Rect,
    }

    #[link(name = "user32")]
    extern "system" {
        fn IsZoomed(hwnd: isize) -> i32;
        fn GetWindowPlacement(hwnd: isize, lpwndpl: *mut WindowPlacement) -> i32;
        fn MonitorFromRect(lprc: *const Rect, dw_flags: u32) -> isize;
        fn LoadImageW(
            h_inst: isize,
            name: *const u16,
            img_type: u32,
            cx: i32,
            cy: i32,
            fu_load: u32,
        ) -> isize;
        fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn GetSystemMetrics(n_index: i32) -> i32;
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            hkey: isize,
            subkey: *const u16,
            options: u32,
            sam_desired: u32,
            phk_result: *mut isize,
        ) -> i32;
        fn RegCreateKeyExW(
            hkey: isize,
            subkey: *const u16,
            reserved: u32,
            class: *const u16,
            options: u32,
            sam_desired: u32,
            sec_attrs: *const core::ffi::c_void,
            phk_result: *mut isize,
            disposition: *mut u32,
        ) -> i32;
        fn RegQueryValueExW(
            hkey: isize,
            value_name: *const u16,
            reserved: *const u32,
            val_type: *mut u32,
            data: *mut u8,
            cb_data: *mut u32,
        ) -> i32;
        fn RegSetValueExW(
            hkey: isize,
            value_name: *const u16,
            reserved: u32,
            val_type: u32,
            data: *const u8,
            cb_data: u32,
        ) -> i32;
        fn RegCloseKey(hkey: isize) -> i32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        let mut v: Vec<u16> = s.encode_utf16().collect();
        v.push(0);
        v
    }

    pub fn is_zoomed(hwnd: isize) -> bool {
        if hwnd == 0 {
            return false;
        }
        unsafe { IsZoomed(hwnd) != 0 }
    }

    pub fn read_window_placement() -> Option<WindowPlacement> {
        let subkey = to_wide("Software\\Wide");
        let name = to_wide("WindowPlacement");
        let mut hkey: isize = 0;
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) };
        if rc != 0 || hkey == 0 {
            return None;
        }
        let mut wp = WindowPlacement {
            length: std::mem::size_of::<WindowPlacement>() as u32,
            flags: 0,
            show_cmd: 0,
            pt_min_position: Point { x: 0, y: 0 },
            pt_max_position: Point { x: 0, y: 0 },
            rc_normal_position: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        };
        let mut val_type: u32 = 0;
        let mut cb_data: u32 = std::mem::size_of::<WindowPlacement>() as u32;
        let q = unsafe {
            RegQueryValueExW(
                hkey,
                name.as_ptr(),
                null(),
                &mut val_type,
                (&mut wp as *mut WindowPlacement) as *mut u8,
                &mut cb_data,
            )
        };
        unsafe {
            RegCloseKey(hkey);
        }
        if q != 0 || val_type != REG_BINARY || cb_data != wp.length {
            return None;
        }
        Some(wp)
    }

    pub fn rect_on_monitor(rect: &Rect) -> bool {
        if rect.right - rect.left < 400 || rect.bottom - rect.top < 300 {
            return false;
        }
        unsafe { MonitorFromRect(rect as *const Rect, MONITOR_DEFAULTTONULL) != 0 }
    }

    pub fn write_window_placement(hwnd: isize) {
        if hwnd == 0 {
            return;
        }
        let mut wp = WindowPlacement {
            length: std::mem::size_of::<WindowPlacement>() as u32,
            flags: 0,
            show_cmd: 0,
            pt_min_position: Point { x: 0, y: 0 },
            pt_max_position: Point { x: 0, y: 0 },
            rc_normal_position: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        };
        let ok = unsafe { GetWindowPlacement(hwnd, &mut wp) };
        if ok == 0 {
            return;
        }
        if wp.show_cmd == 2 {
            wp.show_cmd = 1;
        }
        let subkey = to_wide("Software\\Wide");
        let name = to_wide("WindowPlacement");
        let mut hkey: isize = 0;
        let mut disp: u32 = 0;
        let rc = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                null(),
                0,
                KEY_WRITE,
                null_mut(),
                &mut hkey,
                &mut disp,
            )
        };
        if rc != 0 || hkey == 0 {
            return;
        }
        unsafe {
            RegSetValueExW(
                hkey,
                name.as_ptr(),
                0,
                REG_BINARY,
                (&wp as *const WindowPlacement) as *const u8,
                wp.length,
            );
            RegCloseKey(hkey);
        }
    }

    pub fn apply_window_icon(hwnd: isize, assets_dir: &Path) {
        if hwnd == 0 {
            return;
        }
        let ico = assets_dir.join("wide.ico");
        if !ico.exists() {
            return;
        }
        let wide = to_wide(&ico.to_string_lossy());
        unsafe {
            let sm_cx = GetSystemMetrics(49).max(16);
            let sm_cy = GetSystemMetrics(50).max(16);
            let big_cx = GetSystemMetrics(11).max(32);
            let big_cy = GetSystemMetrics(12).max(32);
            let small_icon = LoadImageW(0, wide.as_ptr(), IMAGE_ICON, sm_cx, sm_cy, LR_LOADFROMFILE);
            let big_icon = LoadImageW(0, wide.as_ptr(), IMAGE_ICON, big_cx, big_cy, LR_LOADFROMFILE);
            if small_icon != 0 {
                SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small_icon);
            }
            if big_icon != 0 {
                SendMessageW(hwnd, WM_SETICON, ICON_BIG, big_icon);
            }
        }
    }
}

fn handle_crypto_protect(data_b64: &str) -> Value {
    let Some(raw) = b64_decode(data_b64) else {
        return json!({ "ok": false });
    };
    #[cfg(windows)]
    {
        if let Some(enc) = dpapi::protect(&raw) {
            return json!({ "ok": true, "data": b64_encode(&enc) });
        }
    }
    let _ = raw;
    json!({ "ok": false })
}

fn handle_crypto_unprotect(data_b64: &str) -> Value {
    let Some(enc) = b64_decode(data_b64) else {
        return json!({ "ok": false });
    };
    #[cfg(windows)]
    {
        if let Some(plain) = dpapi::unprotect(&enc) {
            return json!({ "ok": true, "data": b64_encode(&plain) });
        }
    }
    let _ = enc;
    json!({ "ok": false })
}

#[derive(Debug)]
enum UserEvent {
    SidecarLine(String),
    SidecarExit,
    WindowDrag,
    WindowMinimize,
    WindowMaximize,
    WindowFullscreen,
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

fn resolve_portable_root(exe_dir: &Path) -> Option<PathBuf> {
    if exe_dir.join("portable").exists() || exe_dir.join("wide.portable").exists() {
        return Some(exe_dir.to_path_buf());
    }
    if let Ok(env_val) = std::env::var("WIDE_PORTABLE") {
        let trimmed = env_val.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    None
}

fn resolve_webview_user_data_dir(exe_dir: &Path) -> PathBuf {
    if let Some(root) = resolve_portable_root(exe_dir) {
        return root.join("data").join("WebView2");
    }
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.trim().is_empty() {
                return PathBuf::from(local).join("wide").join("WebView2");
            }
        }
        return std::env::temp_dir().join("wide").join("WebView2");
    }
    #[cfg(not(windows))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.trim().is_empty() {
                return PathBuf::from(xdg).join("wide").join("webview");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.trim().is_empty() {
                return PathBuf::from(home).join(".local").join("share").join("wide").join("webview");
            }
        }
        std::env::temp_dir().join("wide").join("webview")
    }
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

fn handle_open_dialog(params: &Value, owner_hwnd: isize) -> Value {
    let props: Vec<String> = params
        .get("properties")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let is_dir = props.iter().any(|p| p == "openDirectory");
    let multi = props.iter().any(|p| p == "multiSelections");
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let default_path = params.get("defaultPath").and_then(|v| v.as_str()).unwrap_or("").to_string();

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let ps_script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = $null
if ($env:WIDE_DLG_HWND -and $env:WIDE_DLG_HWND -ne '0') {
  try {
    $nw = New-Object System.Windows.Forms.NativeWindow
    $nw.AssignHandle([IntPtr]::new([int64]$env:WIDE_DLG_HWND))
    $owner = $nw
  } catch { $owner = $null }
}
try {
  if ($env:WIDE_DLG_DIR -eq '1') {
    $d = New-Object System.Windows.Forms.FolderBrowserDialog
    if ($env:WIDE_DLG_TITLE) { $d.Description = $env:WIDE_DLG_TITLE }
    if ($env:WIDE_DLG_DEFAULT -and (Test-Path -LiteralPath $env:WIDE_DLG_DEFAULT)) { $d.SelectedPath = $env:WIDE_DLG_DEFAULT }
    $r = if ($owner) { $d.ShowDialog($owner) } else { $d.ShowDialog() }
    if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $d.SelectedPath) {
      @{ canceled = $false; filePaths = @($d.SelectedPath) } | ConvertTo-Json -Compress
    } else {
      '{"canceled":true,"filePaths":[]}'
    }
  } else {
    $d = New-Object System.Windows.Forms.OpenFileDialog
    if ($env:WIDE_DLG_TITLE) { $d.Title = $env:WIDE_DLG_TITLE }
    if ($env:WIDE_DLG_DEFAULT -and (Test-Path -LiteralPath $env:WIDE_DLG_DEFAULT)) { $d.InitialDirectory = $env:WIDE_DLG_DEFAULT }
    if ($env:WIDE_DLG_MULTI -eq '1') { $d.Multiselect = $true }
    $r = if ($owner) { $d.ShowDialog($owner) } else { $d.ShowDialog() }
    if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $d.FileNames.Count -gt 0) {
      @{ canceled = $false; filePaths = @($d.FileNames) } | ConvertTo-Json -Compress
    } else {
      '{"canceled":true,"filePaths":[]}'
    }
  }
} finally {
  if ($owner) { try { $owner.ReleaseHandle() } catch {} }
}
"#;
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-STA", "-Command", ps_script]);
        cmd.env("WIDE_DLG_DIR", if is_dir { "1" } else { "0" });
        cmd.env("WIDE_DLG_MULTI", if multi { "1" } else { "0" });
        cmd.env("WIDE_DLG_TITLE", title);
        cmd.env("WIDE_DLG_DEFAULT", default_path);
        cmd.env("WIDE_DLG_HWND", owner_hwnd.to_string());
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd.output() {
            let txt = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Ok(parsed) = serde_json::from_str::<Value>(&txt) {
                return parsed;
            }
        }
        return json!({ "canceled": true, "filePaths": [] });
    }

    #[cfg(not(windows))]
    {
        let _ = (is_dir, multi, title, default_path, owner_hwnd);
        json!({ "canceled": true, "filePaths": [] })
    }
}

fn handle_show_in_folder(raw_path: &str) {
    if raw_path.is_empty() {
        return;
    }
    #[cfg(windows)]
    {
        let norm = raw_path.replace('/', "\\");
        let _ = Command::new("explorer.exe").arg(format!("/select,{}", norm)).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").args(["-R", raw_path]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let target = Path::new(raw_path)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or(raw_path);
        let _ = Command::new("xdg-open").arg(target).spawn();
    }
}

fn handle_trash_item(raw_path: &str) -> Value {
    if raw_path.is_empty() {
        return json!({ "ok": false, "error": "Missing path" });
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let norm = raw_path.replace('/', "\\");
        let ps_script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName Microsoft.VisualBasic
$p = $env:WIDE_TRASH_PATH
if (-not (Test-Path -LiteralPath $p)) { throw 'Path not found' }
if ((Get-Item -LiteralPath $p).PSIsContainer) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
}
"#;
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps_script]);
        cmd.env("WIDE_TRASH_PATH", &norm);
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.output() {
            Ok(out) if out.status.success() => json!({ "ok": true }),
            Ok(out) => {
                let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                json!({ "ok": false, "error": if err.is_empty() { "Failed to trash item".to_string() } else { err } })
            }
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }
    #[cfg(not(windows))]
    {
        let p = Path::new(raw_path);
        let res = if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) };
        match res {
            Ok(_) => json!({ "ok": true }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }
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
(function() {
  if (window.__wideIpcBridgeInstalled) return;
  window.__wideIpcBridgeInstalled = true;
  var nativeWebview = window.chrome && window.chrome.webview;
  var nativePost = nativeWebview && typeof nativeWebview.postMessage === "function"
    ? nativeWebview.postMessage.bind(nativeWebview)
    : null;
  window.chrome = window.chrome || {};
  window.__wideIpcListeners = window.__wideIpcListeners || new Set();
  window.chrome.webview = {
    postMessage: function(data) {
      var payload = typeof data === "string" ? data : JSON.stringify(data);
      if (nativePost) {
        nativePost(payload);
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
})();
"#;
    let mut script = String::from(bridge_shim);
    for asset_name in ["engine-preview.js", "preload-shim.js", "titlebar.js"] {
        let path = assets_dir.join(asset_name);
        if let Ok(content) = fs::read_to_string(&path) {
            script.push('\n');
            script.push_str(&content);
            script.push('\n');
        }
    }
    script
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
        cmd.current_dir(&self.exe_dir);
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

fn window_is_maximized(window: &tao::window::Window) -> bool {
    #[cfg(windows)]
    {
        return win_host::is_zoomed(window.hwnd());
    }
    #[cfg(not(windows))]
    {
        window.is_maximized()
    }
}

fn emit_window_state(webview: &wry::WebView, window: &tao::window::Window) {
    let maximized = window_is_maximized(window);
    let fullscreen = window.fullscreen().is_some();
    let ev = json!({
        "type": "event",
        "channel": "host:windowState",
        "payload": {
            "maximized": maximized,
            "fullscreen": fullscreen
        }
    });
    let script = format!(
        "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
        ev.to_string()
    );
    let _ = webview.evaluate_script(&script);
}

fn save_window_state(window: &tao::window::Window) {
    #[cfg(windows)]
    win_host::write_window_placement(window.hwnd());
    #[cfg(not(windows))]
    let _ = window;
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let exe_dir = get_exe_dir();
    let renderer_dir = resolve_renderer_dir(&exe_dir);
    let assets_dir = resolve_assets_dir(&exe_dir);
    let webview_data_dir = resolve_webview_user_data_dir(&exe_dir);
    let _ = fs::create_dir_all(&webview_data_dir);
    let pending_open_path = parse_cli_open_path();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let mut wb = WindowBuilder::new()
        .with_title("Wide IDE")
        .with_decorations(false)
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(720.0, 480.0));

    #[cfg(windows)]
    {
        if let Some(wp) = win_host::read_window_placement() {
            if win_host::rect_on_monitor(&wp.rc_normal_position) {
                let w = (wp.rc_normal_position.right - wp.rc_normal_position.left) as u32;
                let h = (wp.rc_normal_position.bottom - wp.rc_normal_position.top) as u32;
                wb = wb
                    .with_position(PhysicalPosition::new(
                        wp.rc_normal_position.left,
                        wp.rc_normal_position.top,
                    ))
                    .with_inner_size(PhysicalSize::new(w, h));
            }
            wb = wb.with_maximized(wp.show_cmd == 3);
        } else {
            wb = wb.with_maximized(true);
        }
    }
    #[cfg(not(windows))]
    {
        wb = wb.with_maximized(true);
    }

    let window = wb.build(&event_loop)?;

    #[cfg(windows)]
    let owner_hwnd: isize = {
        let hwnd = window.hwnd();
        win_host::apply_window_icon(hwnd, &assets_dir);
        hwnd
    };
    #[cfg(not(windows))]
    let owner_hwnd: isize = 0;

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
                    "fullscreen" => {
                        let _ = proxy_for_ipc.send_event(UserEvent::WindowFullscreen);
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
    let mut web_context = WebContext::new(Some(webview_data_dir));

    let mut wv_builder = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_background_color((BACKGROUND_COLOR.0, BACKGROUND_COLOR.1, BACKGROUND_COLOR.2, 255))
        .with_custom_protocol("app".into(), protocol_handler)
        .with_initialization_script(&preload_init)
        .with_ipc_handler(ipc_handler)
        .with_url("app://local/index.html");

    #[cfg(windows)]
    {
        wv_builder = wv_builder.with_https_scheme(true);
    }

    let webview = wv_builder.build(&window)?;

    let sidecar_main = sidecar.clone();
    let mut last_win_state = (window_is_maximized(&window), window.fullscreen().is_some());

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::UserEvent(ue) => match ue {
                UserEvent::SidecarLine(line) => {
                    if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                        if msg.get("type").is_some() {
                            if let Ok(serialized) = serde_json::to_string(&msg) {
                                let script = format!(
                                    "if (window.__wideDispatchMessage) window.__wideDispatchMessage({});",
                                    serialized
                                );
                                let _ = webview.evaluate_script(&script);
                            }
                        } else {
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
                                } else if method == "window:setTitle" {
                                    if let Some(new_title) = msg.get("params").and_then(|p| p.get("title")).and_then(|s| s.as_str()) {
                                        window.set_title(new_title);
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
                                } else if method == "dialog:showOpenDialog" {
                                    let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
                                    let sidecar_clone = sidecar_main.clone();
                                    thread::spawn(move || {
                                        let result = handle_open_dialog(&params, owner_hwnd);
                                        let rep = json!({
                                            "t": "hostReply",
                                            "id": id,
                                            "result": result
                                        });
                                        sidecar_clone.send(rep.to_string());
                                    });
                                } else if method == "shell:showItemInFolder" {
                                    if let Some(p) = msg.get("params").and_then(|p| p.get("path")).and_then(|u| u.as_str()) {
                                        handle_show_in_folder(p);
                                    }
                                    let rep = json!({
                                        "t": "hostReply",
                                        "id": id,
                                        "result": Value::Null
                                    });
                                    sidecar_main.send(rep.to_string());
                                } else if method == "shell:trashItem" {
                                    let p = msg.get("params").and_then(|p| p.get("path")).and_then(|u| u.as_str()).unwrap_or("").to_string();
                                    let sidecar_clone = sidecar_main.clone();
                                    thread::spawn(move || {
                                        let result = handle_trash_item(&p);
                                        let rep = json!({
                                            "t": "hostReply",
                                            "id": id,
                                            "result": result
                                        });
                                        sidecar_clone.send(rep.to_string());
                                    });
                                } else if method == "crypto:protect" {
                                    let raw = msg.get("params").and_then(|p| p.get("data")).and_then(|d| d.as_str()).unwrap_or("");
                                    let result = handle_crypto_protect(raw);
                                    let rep = json!({
                                        "t": "hostReply",
                                        "id": id,
                                        "result": result
                                    });
                                    sidecar_main.send(rep.to_string());
                                } else if method == "crypto:unprotect" {
                                    let raw = msg.get("params").and_then(|p| p.get("data")).and_then(|d| d.as_str()).unwrap_or("");
                                    let result = handle_crypto_unprotect(raw);
                                    let rep = json!({
                                        "t": "hostReply",
                                        "id": id,
                                        "result": result
                                    });
                                    sidecar_main.send(rep.to_string());
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
                    if window.fullscreen().is_some() {
                        window.set_fullscreen(None);
                    } else {
                        let currently_max = window_is_maximized(&window);
                        window.set_maximized(!currently_max);
                    }
                    last_win_state = (window_is_maximized(&window), window.fullscreen().is_some());
                    emit_window_state(&webview, &window);
                }
                UserEvent::WindowFullscreen => {
                    if window.fullscreen().is_some() {
                        window.set_fullscreen(None);
                    } else {
                        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
                    }
                    last_win_state = (window_is_maximized(&window), window.fullscreen().is_some());
                    emit_window_state(&webview, &window);
                }
                UserEvent::WindowClose => {
                    save_window_state(&window);
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
                WindowEvent::Resized(_) => {
                    let cur = (window_is_maximized(&window), window.fullscreen().is_some());
                    if cur != last_win_state {
                        last_win_state = cur;
                        emit_window_state(&webview, &window);
                    }
                }
                WindowEvent::CloseRequested => {
                    save_window_state(&window);
                    sidecar_main.stop();
                    *control_flow = ControlFlow::Exit;
                }
                _ => {}
            },
            _ => {}
        }
    });
}
