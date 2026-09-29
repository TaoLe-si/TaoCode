param([switch]$TestOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (!(Test-Path $vswhere)) { throw 'Install Visual Studio C++ desktop build tools first.' }
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'No MSVC x64 toolchain was found.' }
$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ctest = Join-Path (Split-Path $cmake) 'ctest.exe'
$ninja = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'
if (!(Test-Path $cmake)) { throw 'Enable the C++ CMake tools component in Visual Studio.' }
$build = Join-Path $root 'build'
if ($TestOnly) {
    & $ctest --test-dir $build --output-on-failure --no-tests=error
    if ($LASTEXITCODE -ne 0) { throw "Native tests failed: $LASTEXITCODE" }
    exit 0
}
if (!(Test-Path (Join-Path $root 'dist\index.html'))) { throw 'Run npm run build first.' }
$sdkVersion = '1.0.4191.47'
$sdk = Join-Path $env:USERPROFILE ".nuget\packages\microsoft.web.webview2\$sdkVersion"
if (!(Test-Path (Join-Path $sdk 'build\native\include\WebView2.h'))) {
    $sdk = Join-Path $root ".tools\webview2-$sdkVersion"
    if (!(Test-Path (Join-Path $sdk 'build\native\include\WebView2.h'))) {
        New-Item -ItemType Directory -Force (Join-Path $root '.tools') | Out-Null
        $zip = Join-Path $root '.tools\webview2.zip'
        Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $zip
        Expand-Archive $zip -DestinationPath $sdk -Force
        Remove-Item $zip
    }
}
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
$compilerEnvironment = & $env:ComSpec /d /c "call `"$vcvars`" >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'Failed to load the MSVC environment.' }
foreach ($line in $compilerEnvironment) {
    $separator = $line.IndexOf('=')
    if ($separator -gt 0) {
        [Environment]::SetEnvironmentVariable($line.Substring(0, $separator), $line.Substring($separator + 1), 'Process')
    }
}
& $cmake -S $root -B $build -G Ninja -DCMAKE_BUILD_TYPE=Release "-DCMAKE_MAKE_PROGRAM=$ninja" "-DWEBVIEW2_SDK=$sdk"
if ($LASTEXITCODE -ne 0) { throw "Native configure failed: $LASTEXITCODE" }
# Java 支持随发行走（IDEA 就是把 Java 支持打包进 IDE 的）：JDT LS 用**IDE 自带的 JRE** 启动，
# 与项目的 Java 版本无关。先取件，再链接，最后让 CMake 的 taocode_ui 目标把它们放进产物旁边。
& (Join-Path $PSScriptRoot 'fetch-jre.ps1') -Destination (Join-Path $build 'jre')
& (Join-Path $PSScriptRoot 'fetch-jdtls.ps1') -Destination (Join-Path $build 'jdtls')
& $cmake --build $build --parallel
if ($LASTEXITCODE -ne 0) { throw "Native build failed: $LASTEXITCODE" }
& $ctest --test-dir $build --output-on-failure --no-tests=error
if ($LASTEXITCODE -ne 0) { throw "Native tests failed: $LASTEXITCODE" }
Write-Output "Built: $build\TaoCode.exe (keep the ui directory beside it)"
