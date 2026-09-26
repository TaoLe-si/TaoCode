$ErrorActionPreference = 'Stop'
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
$envBlock = & $env:ComSpec /d /c "call `"$vcvars`" >nul && set"
foreach ($line in $envBlock) {
    $i = $line.IndexOf('=')
    if ($i -gt 0) {
        [Environment]::SetEnvironmentVariable($line.Substring(0, $i), $line.Substring($i + 1), 'Process')
    }
}
& $cmake --build D:\TaoCode\build --target projects_test