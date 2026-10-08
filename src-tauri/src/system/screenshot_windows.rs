// Windows 原生区域截图。整个虚拟桌面统一使用物理像素，跨屏框选不经过 WebView 的缩放换算。
use super::{selection_rect, ScreenshotResult};
use base64::Engine;
use std::{borrow::Cow, ffi::c_void, io::Cursor, mem::size_of};
use windows::{
    core::w,
    Win32::{
        Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::{Dwm::DwmFlush, Gdi::*},
        System::LibraryLoader::GetModuleHandleW,
        UI::{HiDpi::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    },
};

struct DpiGuard(DPI_AWARENESS_CONTEXT);
impl Drop for DpiGuard {
    fn drop(&mut self) {
        unsafe {
            SetThreadDpiAwarenessContext(self.0);
        }
    }
}

struct DesktopDc(HDC);
impl Drop for DesktopDc {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(None, self.0);
        }
    }
}

struct BitmapDc {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
}
impl Drop for BitmapDc {
    fn drop(&mut self) {
        unsafe {
            if !self.previous.is_invalid() {
                SelectObject(self.dc, self.previous);
            }
            if !self.bitmap.is_invalid() {
                let _ = DeleteObject(self.bitmap.into());
            }
            let _ = DeleteDC(self.dc);
        }
    }
}

struct Overlay {
    width: i32,
    height: i32,
    info: BITMAPINFO,
    pixels: Vec<u8>,
    dimmed: Vec<u8>,
    start: Option<(i32, i32)>,
    end: (i32, i32),
    dragging: bool,
    confirmed: bool,
    button: RECT,
    scale: i32,
}

impl Overlay {
    fn selection(&self) -> Option<RECT> {
        self.start
            .and_then(|start| selection_rect(start, self.end, self.width, self.height))
            .map(|(left, top, right, bottom)| RECT {
                left,
                top,
                right,
                bottom,
            })
    }

    unsafe fn paint(&mut self, hwnd: HWND) {
        let mut paint = PAINTSTRUCT::default();
        let dc = BeginPaint(hwnd, &mut paint);
        // 两幅 DIB 均为自上而下排列；选区通过剪裁区域显示原始图像。
        SetDIBitsToDevice(
            dc,
            0,
            0,
            self.width as u32,
            self.height as u32,
            0,
            0,
            0,
            self.height as u32,
            self.dimmed.as_ptr().cast(),
            &self.info,
            DIB_RGB_COLORS,
        );
        let blue = CreateSolidBrush(COLORREF(0x00d47800));
        let dark = CreateSolidBrush(COLORREF(0x00252525));
        let previous_font = SelectObject(dc, GetStockObject(DEFAULT_GUI_FONT));
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, COLORREF(0x00ffffff));
        self.button = RECT::default();
        if let Some(rect) = self.selection() {
            let clip = CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom);
            SelectClipRgn(dc, Some(clip));
            SetDIBitsToDevice(
                dc,
                0,
                0,
                self.width as u32,
                self.height as u32,
                0,
                0,
                0,
                self.height as u32,
                self.pixels.as_ptr().cast(),
                &self.info,
                DIB_RGB_COLORS,
            );
            SelectClipRgn(dc, None);
            let _ = DeleteObject(clip.into());
            FrameRect(dc, &rect, blue);
            if !self.dragging {
                // 工具栏跟随选区；限制在鼠标所在显示器范围，避免出现在双屏间的空白区域。
                let mut monitor = MONITORINFO {
                    cbSize: size_of::<MONITORINFO>() as u32,
                    ..Default::default()
                };
                let mut cursor = POINT::default();
                let _ = GetCursorPos(&mut cursor);
                let _ = GetMonitorInfoW(
                    MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST),
                    &mut monitor,
                );
                let mut origin = POINT {
                    x: monitor.rcMonitor.left,
                    y: monitor.rcMonitor.top,
                };
                let _ = ScreenToClient(hwnd, &mut origin);
                let unit = self.scale;
                let toolbar_width = 180 * unit;
                let toolbar_height = 34 * unit;
                let x = rect.right.saturating_sub(toolbar_width).clamp(
                    origin.x,
                    (origin.x + monitor.rcMonitor.right - monitor.rcMonitor.left - toolbar_width)
                        .max(origin.x),
                );
                let y = if rect.bottom + toolbar_height + 8 * unit
                    <= origin.y + monitor.rcMonitor.bottom - monitor.rcMonitor.top
                {
                    rect.bottom + 8 * unit
                } else {
                    (rect.top - toolbar_height - 8 * unit).max(origin.y)
                };
                let bar = RECT {
                    left: x,
                    top: y,
                    right: x + toolbar_width,
                    bottom: y + toolbar_height,
                };
                FillRect(dc, &bar, dark);
                let mut size_rect = RECT {
                    right: x + 96 * unit,
                    ..bar
                };
                draw_text(
                    dc,
                    &format!("{} × {}", rect.right - rect.left, rect.bottom - rect.top),
                    &mut size_rect,
                );
                self.button = RECT {
                    left: x + 96 * unit,
                    ..bar
                };
                FillRect(dc, &self.button, blue);
                let mut button = self.button;
                draw_text(dc, "确认 ↵", &mut button);
            }
        }
        // 提示放在当前显示器左上角，副屏触发时也能看到。
        let mut cursor = POINT::default();
        let _ = GetCursorPos(&mut cursor);
        let mut monitor = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(
            MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST),
            &mut monitor,
        );
        let mut origin = POINT {
            x: monitor.rcMonitor.left,
            y: monitor.rcMonitor.top,
        };
        let _ = ScreenToClient(hwnd, &mut origin);
        let mut hint = RECT {
            left: origin.x + 16,
            top: origin.y + 16,
            right: origin.x + 440,
            bottom: origin.y + 52,
        };
        FillRect(dc, &hint, dark);
        draw_text(dc, "拖动框选 · Enter 确认 · Esc / 右键取消", &mut hint);
        SelectObject(dc, previous_font);
        for brush in [blue, dark] {
            let _ = DeleteObject(brush.into());
        }
        let _ = EndPaint(hwnd, &paint);
    }
}

unsafe fn draw_text(dc: HDC, text: &str, rect: &mut RECT) {
    let mut text: Vec<u16> = text.encode_utf16().collect();
    DrawTextW(dc, &mut text, rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
}

unsafe fn cursor_position(hwnd: HWND) -> (i32, i32) {
    // 不使用 LPARAM 的 16 位鼠标坐标，避免大尺寸虚拟桌面溢出。
    let mut point = POINT::default();
    let _ = GetCursorPos(&mut point);
    let _ = ScreenToClient(hwnd, &mut point);
    (point.x, point.y)
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let create = &*(lparam.0 as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
    // GDI 和窗口销毁可能同步重入回调；无状态消息不创建 Overlay 的可变引用。
    match message {
        WM_ERASEBKGND => return LRESULT(1),
        WM_DESTROY => {
            PostQuitMessage(0);
            return LRESULT(0);
        }
        WM_NCDESTROY => {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            return DefWindowProcW(hwnd, message, wparam, lparam);
        }
        WM_RBUTTONDOWN | WM_CLOSE | WM_DISPLAYCHANGE | WM_CANCELMODE => {
            let _ = DestroyWindow(hwnd);
            return LRESULT(0);
        }
        WM_KEYDOWN if wparam.0 == VK_ESCAPE.0 as usize => {
            let _ = DestroyWindow(hwnd);
            return LRESULT(0);
        }
        WM_ACTIVATE if wparam.0 & 0xffff == WA_INACTIVE as usize => {
            let _ = DestroyWindow(hwnd);
            return LRESULT(0);
        }
        WM_PAINT | WM_LBUTTONDOWN | WM_MOUSEMOVE | WM_LBUTTONUP | WM_KEYDOWN => {}
        _ => return DefWindowProcW(hwnd, message, wparam, lparam),
    }
    let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Overlay;
    if pointer.is_null() {
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
    let overlay = &mut *pointer;
    match message {
        WM_PAINT => {
            overlay.paint(hwnd);
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            let point = cursor_position(hwnd);
            let button = overlay.button;
            if overlay.selection().is_some()
                && point.0 >= button.left
                && point.0 < button.right
                && point.1 >= button.top
                && point.1 < button.bottom
            {
                overlay.confirmed = true;
                let _ = DestroyWindow(hwnd);
            } else {
                overlay.start = Some(point);
                overlay.end = point;
                overlay.dragging = true;
                SetCapture(hwnd);
                let _ = InvalidateRect(Some(hwnd), None, false);
            }
            LRESULT(0)
        }
        WM_MOUSEMOVE if overlay.dragging => {
            overlay.end = cursor_position(hwnd);
            let _ = InvalidateRect(Some(hwnd), None, false);
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            if overlay.dragging {
                overlay.end = cursor_position(hwnd);
                overlay.dragging = false;
                let _ = ReleaseCapture();
                let _ = InvalidateRect(Some(hwnd), None, false);
            }
            LRESULT(0)
        }
        WM_KEYDOWN if wparam.0 == VK_RETURN.0 as usize => {
            if !overlay.dragging && overlay.selection().is_some() {
                overlay.confirmed = true;
                let _ = DestroyWindow(hwnd);
            }
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

pub fn capture() -> Result<ScreenshotResult, String> {
    unsafe { capture_inner(true).map_err(|e| format!("截图失败：{}", e)) }
}

unsafe fn capture_inner(write_clipboard: bool) -> Result<ScreenshotResult, String> {
    let previous_dpi = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    if previous_dpi.is_invalid() {
        return Err("无法启用物理像素截图模式".into());
    }
    let _dpi = DpiGuard(previous_dpi);
    // 等待桌面合成完成，捕获包括本程序在内的当前可见画面。
    std::thread::sleep(std::time::Duration::from_millis(120));
    let _ = DwmFlush();
    let origin_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
    let origin_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
    let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if width <= 0 || height <= 0 {
        return Err("无法读取屏幕尺寸".into());
    }
    let byte_count = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))
        .filter(|n| *n <= 512 * 1024 * 1024)
        .ok_or("屏幕尺寸过大，无法分配截图内存")?;
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let desktop = DesktopDc(GetDC(None));
    if desktop.0.is_invalid() {
        return Err("无法读取桌面画面".into());
    }
    let dc = CreateCompatibleDC(Some(desktop.0));
    if dc.is_invalid() {
        return Err("无法创建截图设备上下文".into());
    }
    let mut buffer = BitmapDc {
        dc,
        bitmap: HBITMAP::default(),
        previous: HGDIOBJ::default(),
    };
    let mut bits: *mut c_void = std::ptr::null_mut();
    buffer.bitmap = CreateDIBSection(Some(desktop.0), &info, DIB_RGB_COLORS, &mut bits, None, 0)
        .map_err(|e| e.to_string())?;
    if bits.is_null() {
        return Err("无法分配截图像素缓冲区".into());
    }
    buffer.previous = SelectObject(dc, buffer.bitmap.into());
    if buffer.previous.is_invalid() {
        return Err("无法选择截图位图".into());
    }
    BitBlt(
        dc,
        0,
        0,
        width,
        height,
        Some(desktop.0),
        origin_x,
        origin_y,
        SRCCOPY | CAPTUREBLT,
    )
    .map_err(|e| e.to_string())?;
    let _ = GdiFlush();
    let pixels = std::slice::from_raw_parts(bits.cast::<u8>(), byte_count).to_vec();
    drop(buffer);
    drop(desktop);
    let mut dimmed = pixels.clone();
    for pixel in dimmed.chunks_exact_mut(4) {
        for channel in &mut pixel[..3] {
            *channel /= 2;
        }
    }
    let mut overlay = Box::new(Overlay {
        width,
        height,
        info,
        pixels,
        dimmed,
        start: None,
        end: (0, 0),
        dragging: false,
        confirmed: false,
        button: RECT::default(),
        scale: 1,
    });
    let instance = HINSTANCE(GetModuleHandleW(None).map_err(|e| e.to_string())?.0);
    let class = w!("LAN_DROP_SCREENSHOT_OVERLAY");
    let window_class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        hCursor: LoadCursorW(None, IDC_CROSS).map_err(|e| e.to_string())?,
        lpszClassName: class,
        ..Default::default()
    };
    // 类注册在线程结束后释放；上一会话异常留下的类仍可复用。
    RegisterClassW(&window_class);
    let hwnd = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        class,
        w!("屏幕截图"),
        WS_POPUP,
        origin_x,
        origin_y,
        width,
        height,
        None,
        None,
        Some(instance),
        Some((&mut *overlay as *mut Overlay).cast()),
    )
    .map_err(|e| e.to_string())?;
    let _ = ShowWindow(hwnd, SW_SHOW);
    let _ = SetForegroundWindow(hwnd);
    let _ = SetFocus(Some(hwnd));
    let mut msg = MSG::default();
    let mut message_error = None;
    loop {
        let status = GetMessageW(&mut msg, None, 0, 0).0;
        if status <= 0 {
            if status == -1 {
                message_error = Some("截图窗口消息循环失败".to_string());
            }
            break;
        }
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    if IsWindow(Some(hwnd)).as_bool() {
        let _ = DestroyWindow(hwnd);
    }
    let _ = UnregisterClassW(class, Some(instance));
    // DestroyWindow 在异常路径可能产生 WM_QUIT，避免复用线程时误取消下一次截图。
    while PeekMessageW(&mut msg, None, WM_QUIT, WM_QUIT, PM_REMOVE).as_bool() {}
    if let Some(error) = message_error {
        return Err(error);
    }
    if !overlay.confirmed {
        return Ok(ScreenshotResult::cancelled());
    }
    let rect = overlay.selection().ok_or("请选择非空区域")?;
    let crop_width = (rect.right - rect.left) as u32;
    let crop_height = (rect.bottom - rect.top) as u32;
    let mut rgba = Vec::with_capacity(crop_width as usize * crop_height as usize * 4);
    for y in rect.top..rect.bottom {
        let offset = (y as usize * width as usize + rect.left as usize) * 4;
        for pixel in overlay.pixels[offset..offset + crop_width as usize * 4].chunks_exact(4) {
            rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
        }
    }
    let image = image::RgbaImage::from_raw(crop_width, crop_height, rgba.clone())
        .ok_or("截图像素数据无效")?;
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let clipboard_error = if write_clipboard {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| {
                clipboard.set_image(arboard::ImageData {
                    width: crop_width as usize,
                    height: crop_height as usize,
                    bytes: Cow::Owned(rgba),
                })
            })
            .err()
            .map(|e| format!("图片未能复制到剪贴板：{}", e))
    } else {
        None
    };
    Ok(ScreenshotResult {
        cancelled: false,
        png_base64: Some(base64::engine::general_purpose::STANDARD.encode(png.into_inner())),
        width: crop_width,
        height: crop_height,
        clipboard_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// 需要交互式 Windows 桌面；只截取测试窗口，不改动用户剪贴板。
    #[test]
    #[ignore = "需要交互式 Windows 桌面，会短暂显示测试窗口和框选界面"]
    fn native_overlay_confirms_png_and_cancels_next_session() {
        unsafe {
            let previous_dpi =
                SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let _dpi = DpiGuard(previous_dpi);
            let mut original_cursor = POINT::default();
            GetCursorPos(&mut original_cursor).unwrap();
            // STATIC 的 SS_WHITERECT（0x0006）提供已知的白色画面。
            let fixture = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("截图验证"),
                WINDOW_STYLE(WS_POPUP.0 | 0x0006),
                100,
                100,
                240,
                180,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            let _ = ShowWindow(fixture, SW_SHOW);
            let _ = UpdateWindow(fixture);
            let controller = std::thread::spawn(|| {
                let deadline = Instant::now() + Duration::from_secs(5);
                let overlay = loop {
                    if let Ok(hwnd) = FindWindowW(w!("LAN_DROP_SCREENSHOT_OVERLAY"), None) {
                        if IsWindowVisible(hwnd).as_bool() {
                            break hwnd;
                        }
                    }
                    assert!(Instant::now() < deadline, "没有找到截图窗口");
                    std::thread::sleep(Duration::from_millis(20));
                };
                std::thread::sleep(Duration::from_millis(150));
                SetCursorPos(130, 130).unwrap();
                SendMessageW(overlay, WM_LBUTTONDOWN, Some(WPARAM(0)), Some(LPARAM(0)));
                SetCursorPos(210, 190).unwrap();
                SendMessageW(overlay, WM_MOUSEMOVE, Some(WPARAM(0)), Some(LPARAM(0)));
                SendMessageW(overlay, WM_LBUTTONUP, Some(WPARAM(0)), Some(LPARAM(0)));
                SendMessageW(
                    overlay,
                    WM_KEYDOWN,
                    Some(WPARAM(VK_RETURN.0 as usize)),
                    Some(LPARAM(0)),
                );
            });
            let result = capture_inner(false);
            controller.join().unwrap();
            let _ = DestroyWindow(fixture);
            SetCursorPos(original_cursor.x, original_cursor.y).unwrap();
            let result = result.unwrap();
            assert!(!result.cancelled, "框选未确认");
            assert_eq!((result.width, result.height), (80, 60));
            let png = base64::engine::general_purpose::STANDARD
                .decode(result.png_base64.unwrap())
                .unwrap();
            let image = image::load_from_memory(&png).unwrap().to_rgba8();
            assert_eq!(image.dimensions(), (80, 60));
            assert!(
                image.pixels().all(|pixel| pixel.0 == [255, 255, 255, 255]),
                "裁剪位置或色彩不正确"
            );

            // 同一线程连续截图，验证窗口销毁、类注销以及 WM_QUIT 清理。
            let controller = std::thread::spawn(|| {
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    if let Ok(hwnd) = FindWindowW(w!("LAN_DROP_SCREENSHOT_OVERLAY"), None) {
                        if IsWindowVisible(hwnd).as_bool() {
                            SendMessageW(
                                hwnd,
                                WM_KEYDOWN,
                                Some(WPARAM(VK_ESCAPE.0 as usize)),
                                Some(LPARAM(0)),
                            );
                            return;
                        }
                    }
                    assert!(Instant::now() < deadline, "没有找到第二次截图窗口");
                    std::thread::sleep(Duration::from_millis(20));
                }
            });
            let cancelled = capture_inner(false).unwrap();
            controller.join().unwrap();
            assert!(cancelled.cancelled);
            assert!(cancelled.png_base64.is_none());
        }
    }
}
