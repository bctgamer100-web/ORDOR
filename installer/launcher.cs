// ตัวเปิดโปรแกรม ORDER Workspace: เปิด app\index.html เป็นหน้าต่างแอปของ Edge (หรือ Chrome)
// ใช้โปรไฟล์แยกใน %LOCALAPPDATA%\ORDER Workspace\profile ข้อมูลที่บันทึกไว้ (IndexedDB / localStorage) จึงอยู่ครบแม้ติดตั้งทับ
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

static class Launcher
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string index = Path.Combine(dir, "app", "index.html");
        if (!File.Exists(index))
        {
            MessageBox.Show("ไม่พบไฟล์โปรแกรม: " + index + "\nกรุณาติดตั้งใหม่", "ORDER Workspace", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        string browser = FindBrowser();
        if (browser == null)
        {
            MessageBox.Show("ไม่พบ Microsoft Edge หรือ Google Chrome ในเครื่องนี้", "ORDER Workspace", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ORDER Workspace", "profile");
        Directory.CreateDirectory(profile);

        string args = "--app=\"" + new Uri(index).AbsoluteUri + "\""
            + " --user-data-dir=\"" + profile + "\""
            + " --no-first-run --no-default-browser-check --start-maximized";
        Process.Start(new ProcessStartInfo(browser, args) { UseShellExecute = false });
    }

    static string FindBrowser()
    {
        foreach (string exe in new[] { "msedge.exe", "chrome.exe" })
        {
            foreach (RegistryKey root in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                using (RegistryKey k = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                {
                    string p = k == null ? null : k.GetValue("") as string;
                    if (!string.IsNullOrEmpty(p) && File.Exists(p.Trim('"'))) return p.Trim('"');
                }
            }
        }
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (string p in new[] {
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe") })
        {
            if (File.Exists(p)) return p;
        }
        return null;
    }
}
