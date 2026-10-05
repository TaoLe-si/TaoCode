// 「关于」的信息行与**扩展文本** —— 上游 `com.intellij.ide.actions.AboutDialog`：
//   · `getText()`（:164-267）画出来的那几行，同时**逐行**进 `myInfo`（:97/:174/:178/:194/
//     :201/:227/:234）——显示与复制共用一份数据，不会各说各话。
//   · `myInfo` 装的是**非本地化**英文串（`buildInfoNonLocalized`、`"Source revision: "`、
//     `"Open-source build"`、`MessageFormat.format("Runtime version: {0} {1}", …)`、
//     `MessageFormat.format("VM: {0} by {1}", …)`），粘给支持的时候不依赖对方语言。
//   · `getExtendedAboutText()`（:320-342）在 `myInfo` 之后追加：`Toolkit: <类名>`、
//     `OS: <名> <版本>`、`AboutPopupDescriptionProvider` 的扩展行、`GC: <收集器>`、
//     `Memory: <max>>20>MiB`、`Cores: <availableProcessors>`。
//   · 复制动作挂在 **OK 按钮**上（`createDefaultActions` :140-155，按钮文案
//     `button.copy.and.close`，`IdeBundle.properties:734`；南面板还额外注册了 Ctrl+C
//     同动作，:110-123 —— 但那是"按钮之外的第二入口"，不是本仓要落的重点）。
//
// 本仓的对应物：对话框那一列 `dt/dd` 与复制出去的文本**同源**（都是 `aboutRows`），
// 复制走 `copyToClipboard`（`CopyPasteManager.setContents` 的等价物）。
//
// 逐条对齐与**明确不做**：
//   · 名称 → `TaoCode`（上游 `getFullApplicationName()`）。
//   · 构建 → `Build #<version>`（上游 :271-272 是 `"Build #" + appInfo.getBuild().asString()`；
//     本仓没有 build 号/构建日期，版本串由宿主 `app.info` 给，界面那一行额外给出入口包名，
//     原因写在 AboutDialog.vue 里）。
//   · 运行时 → 上游报的是**IDE 自己的 JRE**（`:223` 的 `java.runtime.version` + `os.arch`）。
//     本仓的界面跑在 WebView2 上，那一行已经是「WebView2」，所以不另立 JRE 行。
//   · VM 行（`:229-232`）→ 没有对等物：宿主是 C++20 二进制 + Chromium，没有 VM 概念，不编。
//   · Toolkit/OS/Cores → 有对等物（WebView2 版本 / 宿主给的 Windows + 架构 /
//     `navigator.hardwareConcurrency`），照上游那三行的位置落下。
//   · GC / Memory / Vulkan / `AboutPopupDescriptionProvider` → **前提不成立**：
//     脚本侧没有 GC  introspection、没有"最大堆"这个量（宿主给的是进程工作集，另一个指标）、
//     渲染器不是 Metal/Vulkan、没有 EP 宿主。缺的那几行宁可少写，也不填假值。

import type { AppInfo } from './helpActions'

/** 上游 `myInfo` 里的产品名（`getFullApplicationName()`）；本仓只有产品名，没有 edition 追加。 */
export const ABOUT_APP_NAME = 'TaoCode'

/** 上游 `AboutDialog` 显示的那几行（本仓与宿主 `app.info` 一一对应）。 */
export interface AboutRow {
  label: string
  value: string
}

const NO_VALUE = '—'

/**
 * 对话框显示的那几行（上游 `getText()` 的顺序：名称 → 构建 → 平台 → 运行时/VM → 目录）。
 * 缺值照上游的 `…` 口径写占位符，不写空串 —— 空串会让这一行看不出是"没取到"还是"就是空的"。
 */
export function aboutRows(info: AppInfo | null, entryScript: string): AboutRow[] {
  return [
    { label: '版本', value: info?.version || NO_VALUE },
    { label: '构建', value: entryScript || NO_VALUE },
    { label: '平台', value: info ? `${info.platform} ${info.arch}` : NO_VALUE },
    { label: 'WebView2', value: info?.webview2 || NO_VALUE },
    { label: '配置目录', value: info?.profile || NO_VALUE },
  ]
}

/** 上游 `Memory: <max>>20>MiB`（:341）那类硬件量的兜底写法：取不到就不写这一行。 */
function lineOrSkip(lines: string[], label: string, value: string | null | undefined): void {
  if (value) lines.push(`${label}: ${value}`)
}

/**
 * 复制出去的扩展文本（上游 `getExtendedAboutText()` :320-342）。
 * `cores` 由调用方给（浏览器/WebView2 侧是 `navigator.hardwareConcurrency`），
 * 拿不到就**不写** `Cores` 那一行，不写 0。
 */
export function extendedAboutText(info: AppInfo | null, entryScript: string, cores?: number | null): string {
  const rows = aboutRows(info, entryScript)
  const version = info?.version
  const lines: string[] = [ABOUT_APP_NAME]
  lineOrSkip(lines, 'Build', version ? `#${version}` : null)
  if (info) lines.push(`OS: ${info.platform} (${info.arch})`)
  lineOrSkip(lines, 'Toolkit', info?.webview2 ? `WebView2 ${info.webview2}` : null)
  // 对话框里已经显示配置目录，复制出去就必须带上（贴给支持时要能定位是哪份配置）。
  lineOrSkip(lines, 'Config directory', info?.profile || null)
  if (entryScript) lines.push(`Entry bundle: ${entryScript}`)
  if (cores && cores > 0) lines.push(`Cores: ${cores}`)
  return lines.join('\n')
}

/** 按钮文案（上游 `IdeBundle.properties:734` 的 `button.copy.and.close`）。 */
export const ABOUT_COPY_BUTTON = '复制并关闭'
/** 按钮 tooltip / aria-label（上游 `:735` 的 `description.copy.text.to.clipboard`）。 */
export const ABOUT_COPY_DESCRIPTION = '把关于信息复制到剪贴板'
/** 复制成功后按钮上的字。 */
export const ABOUT_COPIED = '已复制'
export const ABOUT_COPY_FEEDBACK_MS = 2200
