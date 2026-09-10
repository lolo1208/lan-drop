// 桌面系统通知管理
use tauri::AppHandle;

pub fn send_desktop_notification(_app: &AppHandle, title: &str, body: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;

        // 对 XML 实体字符进行转义
        let title_clean = title
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;");
        let body_clean = body
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;");

        let ps_cmd = format!(
            r#"$ErrorActionPreference = 'SilentlyContinue';
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;
$xml = @"
<toast activationType="protocol" launch="http://127.0.0.1:57088/api/wake_from_tray">
    <visual>
        <binding template="ToastGeneric">
            <text>{}</text>
            <text>{}</text>
        </binding>
    </visual>
    <actions>
        <action content="打开应用" arguments="http://127.0.0.1:57088/api/wake_from_tray" activationType="protocol"/>
    </actions>
</toast>
"@;
$doc = [Windows.Data.Xml.Dom.XmlDocument]::new();
$doc.LoadXml($xml);
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc);
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}}\WindowsPowerShell\v1.0\powershell.exe');
$notifier.Show($toast);
"#,
            title_clean, body_clean
        );

        let _ = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &ps_cmd])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW 隐藏控制台
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }
}
