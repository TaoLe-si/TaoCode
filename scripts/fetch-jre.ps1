<#
.SYNOPSIS
    取 IDE 自带的 Java 运行时（Temurin JRE），用来跑 JDT LS。

.DESCRIPTION
    为什么要自带一个 JRE，而不是用项目的 JDK 启动语言服务器：

    JDT LS 对 **它自己运行的 JVM** 有要求（1.44 需要 JavaSE 21），而用户的项目可以是
    8 / 11 / 17 / 21 / 25 任何版本。把这两件事绑在一起，结果就是「项目 JDK 是 17 就
    没有代码提示」—— 而 IDEA 从不这样：它用自带的 JetBrains Runtime 跑 IDE 与 Java 插件
    （项目 SDK 只负责编译与运行用户代码）。这里就是那个等价物：**IDE 自己的运行时**。

    所以取件顺序是「IDE 自带 JRE → 项目 JDK → PATH 上的 java」，只要有前者就与项目
    Java 版本无关。

.PARAMETER Destination
    JRE 的安装目录（应含 bin\java.exe）。默认 <exe 目录>\jre。

.EXAMPLE
    powershell -File scripts/fetch-jre.ps1 -Destination build\jre
#>
[CmdletBinding()]
param(
    [string]$Destination = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# 钉死版本：语言服务器要求 JavaSE 21（见 JDT LS 1.44 的 bundle 要求），这里用对应的 LTS。
$Version = '21.0.12.1+1'
$File = 'OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip'
$Url = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/' + $File
$Expected = 'd35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636'

if (-not $Destination) { $Destination = Join-Path $root 'build\jre' }
$marker = Join-Path $Destination '.taocode-jre-version'

if (-not $Force -and (Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq $Version) -and
    (Test-Path (Join-Path $Destination 'bin\java.exe'))) {
    Write-Output "JRE $Version already in $Destination"
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
if ($actual -ne $Expected) { throw "JRE archive checksum mismatch: expected $Expected, got $actual" }

$staging = Join-Path $tools 'jre-staging'
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null
Expand-Archive -Path $archive -DestinationPath $staging -Force

# zip 里顶层是 jdk-21.0.12.1+1\，把内容（不是那层目录）搬到 Destination。
$inner = Get-ChildItem $staging -Directory | Select-Object -First 1
if (-not $inner) { throw "Unexpected JRE archive layout" }
if (Test-Path $Destination) { Remove-Item -Recurse -Force $Destination }
New-Item -ItemType Directory -Force $Destination | Out-Null
Copy-Item -Recurse -Force (Join-Path $inner.FullName '*') $Destination
Remove-Item -Recurse -Force $staging
Set-Content -Path $marker -Value $Version -NoNewline -Encoding UTF8

if (-not (Test-Path (Join-Path $Destination 'bin\java.exe'))) { throw "JRE java.exe missing under $Destination" }
Write-Output "JRE $Version ready in $Destination"
