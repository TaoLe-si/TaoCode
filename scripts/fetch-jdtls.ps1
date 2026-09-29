<#
.SYNOPSIS
    把 Eclipse JDT Language Server 取到可执行文件旁边 —— TaoCode 的「内置 Java 支持」。

.DESCRIPTION
    IDEA 把 Java 支持随 IDE 分发，用户装完就有代码提示。TaoCode 不内置任何二进制
    （那会把 40MB+ 的第三方 jar 塞进版本库），但「内置」这件事的用户体验必须对齐：
    **装好 IDE 就有 Java 补全**，而不是让人自己去 Eclipse 官网下载、再手写
    TaoCode.lsp.json。

    做法与仓库里 WebView2 SDK 的处理一致（scripts/build-native.ps1）——构建期取件，
    校验 SHA-256，解压到目标目录；宿主在运行时从 exe 旁边发现它
    （native/jdtls.cpp）。版本与校验和在这里钉死，升级是一次有意的改动。

.PARAMETER Destination
    JDT LS 的安装目录（解压后应含 plugins/ 与 config/）。默认 <exe 目录>\jdtls。

.PARAMETER Force
    已经有一份通过校验的安装时也重新下载。

.EXAMPLE
    powershell -File scripts/fetch-jdtls.ps1 -Destination build\jdtls
#>
[CmdletBinding()]
param(
    [string]$Destination = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# 1.44.0 是最后一个以 Java 17 为运行要求的里程碑线；JDT LS 自身要 JDK 17+ 才能启动
# （见 jdtls/README 的 Requirements）。TaoCode 用项目 JDK 启动它，所以这台机器上
# 有 JDK 17 就能跑 —— 钉一个要求更高 JDK 的版本会让「内置」在最常见的机器上失效。
$Version = '1.44.0'
$Build = '202501221502'
$File = "jdt-language-server-$Version-$Build.tar.gz"
$Base = "https://download.eclipse.org/jdtls/milestones/$Version/"
$Url = $Base + $File
# 官方同目录发布的 .sha256sum
$Expected = 'd3eab84f06d148fc7a08a1af46ff64b8041da400304515863d62ca4e6cda72b3'

if (-not $Destination) { $Destination = Join-Path $root 'build\jdtls' }
$marker = Join-Path $Destination '.taocode-jdtls-version'

function Test-Installed([string]$path) {
    if ($Force -or -not (Test-Path $marker)) { return $false }
    $recorded = (Get-Content $marker -Raw).Trim()
    return $recorded -eq "$Version-$Build" -and (Test-Path (Join-Path $path 'plugins')) -and (Test-Path (Join-Path $path 'config'))
}

if (Test-Installed $Destination) {
    Write-Output "JDT LS $Version already in $Destination"
    exit 0
}

$tools = Join-Path $root '.tools'
New-Item -ItemType Directory -Force $tools | Out-Null
$archive = Join-Path $tools $File

if (-not (Test-Path $archive) -or $Force) {
    Write-Output "Downloading $Url"
    Invoke-WebRequest $Url -OutFile $archive
}

$actual = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
if ($actual -ne $Expected) {
    throw "JDT LS archive checksum mismatch: expected $Expected, got $actual"
}

# 解压：官方包里顶层就是 plugins/ 与 config/，直接落到 Destination。
$staging = Join-Path $tools 'jdtls-staging'
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null
# Windows 自带的 tar.exe 能解 .tar.gz（Windows 10 1803+ 自带 bsdtar）。
# 显式用 System32 的 bsdtar：Git Bash 的 GNU tar 在 PATH 里排前时会把 `D:` 当远程主机。
& (Join-Path (Join-Path $env:SystemRoot 'System32') 'tar.exe') -xzf $archive -C $staging
if ($LASTEXITCODE -ne 0) { throw "Failed to extract $archive" }

if (Test-Path $Destination) { Remove-Item -Recurse -Force $Destination }
New-Item -ItemType Directory -Force $Destination | Out-Null
Copy-Item -Recurse -Force (Join-Path $staging '*') $Destination
Remove-Item -Recurse -Force $staging
Set-Content -Path $marker -Value "$Version-$Build" -NoNewline -Encoding UTF8

$launcher = Get-ChildItem -Path (Join-Path $Destination 'plugins') -Filter 'org.eclipse.equinox.launcher_*.jar' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $launcher) { throw "JDT LS launcher jar not found under $Destination\plugins" }
Write-Output "JDT LS $Version ready in $Destination (launcher: $($launcher.Name))"
