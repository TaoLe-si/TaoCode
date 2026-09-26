$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int W, int H, bool repaint);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$p = Get-Process | Where-Object { $_.MainWindowTitle -match 'TaoCode' } | Select-Object -First 1
$h = $p.MainWindowHandle
[Win32]::MoveWindow($h, 0, 0, 1280, 800, $true) | Out-Null
[Win32]::ShowWindow($h, 9) | Out-Null
[Win32]::BringWindowToTop($h) | Out-Null
[Win32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 1200
$r = New-Object Win32+RECT
[Win32]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$h2 = $r.Bottom - $r.Top
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $h2)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, [System.Drawing.Size]::new($w, $h2))
$bmp.Save('D:\TaoCode\screenshots\workspace.png', [System.Drawing.Imaging.ImageFormat]::Png)
