// 启动失败面 —— 上游 `platform/platform-impl/src/com/intellij/platform/ide/bootstrap/`
// 一族（`StartupErrorReporter` + `StartupErrorHandler`）在本仓的对应物。
//
// 上游形状（逐跳核过）：
//   · `StartupErrorReporter.processException`（:353-409）**先分类再挑标题**：安装损坏
//     （`EssentialPluginMissingException` → `bootstrap.error.title.corrupted`，退出码
//     `AppExitCodes.INSTALLATION_CORRUPTED`）、插件初始化失败（`PluginException` →
//     `bootstrap.error.title.plugin.init`，退出码 `PLUGIN_ERROR`）、其余一律
//     `bootstrap.error.title.start.failed`（退出码 `STARTUP_EXCEPTION`）。
//   · `showError(title, t)`（:122-141）拼正文：前缀（原因是 `AWTError` 就走
//     `bootstrap.error.prefix.graphics`，否则 `bootstrap.error.prefix.other`）+ 空行 +
//     异常栈 + `-----` + `JRE: {jreDetails}` 附录。`jreDetails()`（:143-150）的形状是
//     `runtime.version + ' ' + os.arch + " (" + java.vendor + ")" + "\n" + java.home`，
//     四个字段各自都有 `(unknown …)` 兜底。
//   · 对话框四个选项（:191）：Close / Reset Settings&Plugins / Report Problem / Learn More。
//   · 正文那个 `SafeActionTextPane`（:443-451）**吞掉所有按键**：出错时不让动作抢快捷键
//     （IJPL-34968）——否则连报错文本都没法选中复制。
//   · 上报通道是 `StartupErrorHandler.uploadLogs(Throwable, Path logs)`（:11-13），
//     日志侧把 `idea.log` + `product-info.json` + 附件打成 zip（:286-310）再交给 handler。
//
// 本仓的落法（按「功能等价」而不是逐行复刻，逐支写清为什么不一样）：
//   · 分类：脚本侧只有一种失败 —— 界面挂不起来（`createApp(App).mount('#app')` 抛，
//     见 src/main.ts）。上游的「安装损坏」「插件初始化失败」两支没有对等物：本仓没有
//     安装器（`EssentialPluginMissingException` 报的是发行包缺件），也没有插件宿主
//     （插件只是配置目录下的文件夹，见 native/projects.cpp），所以只落 `start.failed`
//     一支；另外两支不是"判不做"，是**前提不成立**。
//   · 前缀：`AWTError` 那支判的是图形环境初始化失败，而 WebView2 缺运行时是**宿主**失败
//     （脚本压根没跑起来，宿主自己的窗口都建不出来）。脚本侧只剩 `prefix.other`
//     「内部错误」这一支 —— 与 `src/internalErrors.ts` 的 `INTERNAL_ERROR_WIDGET_NAME` 同一个词。
//   · 四个选项：Close → 面板就是终点，没有可关的窗口；Reset Settings&Plugins → 需要配置
//     迁移/备份机制（上游 `ConfigBackup` + `CustomConfigMigrationOption`），本仓没有，
//     不渲染；Report Problem → 上报走 JetBrains 后端（`LogUploader`/`ITNProxy`），
//     本仓不连后端，不渲染。**留下的两个都是真能干活的**：复制报告（走本仓
//     `copyToClipboard`）与打开日志目录（`app.logPaths` + `file.reveal`，和「显示日志」
//     同一条通道，见 src/helpActions.ts:47-50）。
//   · 吞按键那一条：面板不注册任何键盘监听，天然满足；报错文本用 `<pre>` 展示，可全选。
//
// 退出码那一层（`AppExitCodes`）不做：脚本没有 `System.exit`，进程退出码由宿主掌握，
// 而宿主侧那一段在 `native/main.cpp`（本批禁改文件）。

import { request } from './bridge.ts'
import { copyToClipboard } from './clipboard.ts'

/** `bootstrap.error.title.start.failed`（BootstrapBundle.properties:1）。 */
export const STARTUP_FAILURE_TITLE = '启动失败'
/** `bootstrap.error.prefix.other`（BootstrapBundle.properties:7）。 */
export const STARTUP_FAILURE_PREFIX = '内部错误'
/** 上游附录那一行是 `JRE: {0}`（BootstrapBundle.properties:8）；本仓没有 JRE，标签按同一位置改写。 */
export const STARTUP_FAILURE_APPENDIX_LABEL = '运行时'
/** `showError` 拼正文时异常栈与附录之间的分隔行（`StartupErrorReporter.java:138`）。 */
export const STARTUP_FAILURE_SEPARATOR = '-----'

/** 上游四个字段各自的兜底写法（`jreDetails()` 里 `sp.getProperty(key, "(unknown …)")`）。 */
export const UNKNOWN_RUNTIME = '(unknown)'
export const UNKNOWN_ARCH = '(unknown arch)'
export const UNKNOWN_VENDOR = '(unknown vendor)'
export const UNKNOWN_HOME = '(unknown home)'

/** `jreDetails()` 的四件（`:143-150`）。本仓的 vendor 拿不到，就按上游那样兜底。 */
export interface StartupRuntime {
  /** 上游 `java.runtime.version` / `java.version`；本仓是 WebView2 的 Chromium 版本。 */
  version: string
  /** 上游 `os.arch`；本仓用 UA 的平台串。 */
  arch: string
  /** 上游 `java.vendor`；本仓没有 VM，恒为兜底值。 */
  vendor: string
  /** 上游 `java.home`；本仓的对应物是界面所在目录（`location.href` 的目录部分）。 */
  home: string
  /** UA 原文（上游没有这一行：JVM 版本不用从 UA 里猜，本仓要猜，所以把原文一并报出来）。 */
  userAgent: string
}

/** 报告里用的「User-Agent」标签（上游没有对应项，见 `StartupRuntime.userAgent`）。 */
export const STARTUP_FAILURE_UA_LABEL = 'User-Agent'

const CHROME_VERSION = /Chrome\/([\d.]+)/

/**
 * 从运行环境取 `jreDetails()` 的等价物。
 * Chromium 版本从 UA 的 `Chrome/<x.y.z>` 里取（WebView2 与浏览器预览都在 UA 里带这一段）；
 * 平台串用 `navigator.platform`（上游 `os.arch` 那一格）；vendor 拿不到就照上游写兜底值。
 */
export function detectStartupRuntime(nav: Partial<Navigator> = typeof navigator !== 'undefined' ? navigator : {}): StartupRuntime {
  const userAgent = nav.userAgent ?? ''
  const version = CHROME_VERSION.exec(userAgent)?.[1] ?? UNKNOWN_RUNTIME
  return {
    version,
    arch: nav.platform || UNKNOWN_ARCH,
    vendor: UNKNOWN_VENDOR,
    home: typeof location !== 'undefined' ? new URL('.', location.href).href : UNKNOWN_HOME,
    userAgent: userAgent || UNKNOWN_RUNTIME,
  }
}

/** 附录那一行（`JRE: {0}` 的形状：`版本 架构 (厂商)`，见 `jreDetails()` `:149`）。 */
export function startupRuntimeLine(runtime: StartupRuntime): string {
  return `${STARTUP_FAILURE_APPENDIX_LABEL}：${runtime.version} ${runtime.arch} (${runtime.vendor})`
}

/** 异常文本：`printStackTrace` 那段。`cause` 链按 "Caused by" 逐层展开（上游 `findCause` 的同一条链）。 */
export function startupFailureDetail(error: unknown): string {
  const lines: string[] = []
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    const errorLike = current as { message?: unknown; stack?: unknown }
    const message = typeof errorLike.message === 'string' ? errorLike.message : String(current)
    const stack = typeof errorLike.stack === 'string' ? errorLike.stack : ''
    // 栈的第一行通常已经含 message，重复了就只留 message 那条。
    const stackBody = stack && !stack.startsWith(message) ? stack : ''
    lines.push(stackBody ? stackBody.trimEnd() : message)
    const next = (current as { cause?: unknown }).cause
    // 标记只在下一层真的是新对象时写：自引用的 cause 不能留一个空的 "Caused by:"。
    if (next === undefined || next === null || seen.has(next)) break
    lines.push('Caused by:')
    current = next
  }
  return lines.join('\n')
}

/**
 * 启动失败报告全文（上游 `showError(title, t)` `:122-141` 的拼装顺序：
 * 标题 → 空行 → 前缀 → 空行 → 异常栈 → 空行 → `-----` → 附录两行）。
 */
export function startupFailureReport(error: unknown, runtime: StartupRuntime = detectStartupRuntime()): string {
  return [
    STARTUP_FAILURE_TITLE,
    '',
    STARTUP_FAILURE_PREFIX,
    '',
    startupFailureDetail(error),
    '',
    STARTUP_FAILURE_SEPARATOR,
    startupRuntimeLine(runtime),
    `主目录：${runtime.home || UNKNOWN_HOME}`,
    `${STARTUP_FAILURE_UA_LABEL}：${runtime.userAgent}`,
  ].join('\n')
}

// —— 面板 ——

/** 复制成功后按钮上的字（上游没有这一行：本仓的"复制"是替代 Report 的真动作）。 */
export const STARTUP_FAILURE_COPIED = '已复制'
export const STARTUP_FAILURE_COPY_LABEL = '复制报告'
export const STARTUP_FAILURE_LOG_LABEL = '打开日志目录'
const COPY_FEEDBACK_MS = 2200

const PANEL_STYLE = `
.taocode-startup-failure { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center;
  justify-content: center; padding: var(--space-4); background: var(--backdrop); font-family: var(--font-ui); }
.taocode-startup-failure > section { display: flex; flex-direction: column; gap: var(--space-3); width: min(720px, 100%);
  max-height: 100%; padding: var(--space-4); background: var(--elevated); border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-3); color: var(--text); }
.taocode-startup-failure h1 { margin: 0; font-size: 15px; font-weight: 500; color: var(--bright); }
.taocode-startup-failure pre { margin: 0; padding: var(--space-3); overflow: auto; font: 12px/1.6 var(--font-mono);
  color: var(--text); white-space: pre-wrap; word-break: break-word; background: var(--selected); border-radius: var(--radius-sm); }
.taocode-startup-failure footer { display: flex; align-items: center; gap: var(--space-2); }
.taocode-startup-failure button { padding: 0 var(--space-3); height: 28px; font: inherit; color: var(--text);
  background: transparent; border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
.taocode-startup-failure button:hover { border-color: var(--line-strong); color: var(--bright); }
.taocode-startup-failure em { color: var(--muted); font-style: normal; }
`

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * 渲染启动失败面板（上游是对话框；这里没有能挂 Vue 的应用，所以是**裸 DOM** ——
 * 上游这个场景本来也刻意不走 IDE 自己的 UI，见 `UIManager.setLookAndFeel(system)` `:168`）。
 * 面板不注册任何键盘监听（`SafeActionTextPane` `:443-451` 的要求）。
 */
export function renderStartupFailure(report: string, root: HTMLElement = document.body): HTMLElement {
  const style = element('style', 'taocode-startup-failure-style')
  style.textContent = PANEL_STYLE
  const backdrop = element('div', 'taocode-startup-failure')
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')
  backdrop.setAttribute('aria-label', STARTUP_FAILURE_TITLE)
  const panel = element('section', '')
  panel.append(element('h1', '', STARTUP_FAILURE_TITLE), element('pre', '', report))
  const footer = element('footer', '')
  const copy = element('button', '', STARTUP_FAILURE_COPY_LABEL)
  copy.type = 'button'
  copy.title = '把上面的报告复制到剪贴板'
  copy.setAttribute('aria-label', '把启动失败报告复制到剪贴板')
  copy.addEventListener('click', () => {
    void copyToClipboard(report).then(() => {
      copy.textContent = STARTUP_FAILURE_COPIED
      window.setTimeout(() => { copy.textContent = STARTUP_FAILURE_COPY_LABEL }, COPY_FEEDBACK_MS)
    })
  })
  const openLog = element('button', '', STARTUP_FAILURE_LOG_LABEL)
  openLog.type = 'button'
  openLog.title = '在文件管理器里打开日志目录'
  openLog.setAttribute('aria-label', '在文件管理器里打开日志目录')
  const note = element('em', '')
  openLog.addEventListener('click', () => {
    void request<{ dir: string }>('app.logPaths')
      .then(paths => request('file.reveal', { path: paths.dir }))
      .catch((error: unknown) => { note.textContent = error instanceof Error ? error.message : String(error) })
  })
  footer.append(copy, openLog, note)
  panel.append(footer)
  backdrop.append(panel)
  root.append(style, backdrop)
  return backdrop
}

/**
 * 启动失败的入口（`src/main.ts` 的挂载失败分支调用）。
 * 报告先算好、面板先渲染，再去问宿主日志目录 —— 问不到也不影响面板可用。
 */
export function showStartupFailure(error: unknown): void {
  const report = startupFailureReport(error)
  try { document.getElementById('app')?.replaceChildren() } catch { /* 面板照样挂上 */ }
  const panel = renderStartupFailure(report)
  const note = panel.querySelector('em')
  void request<{ dir: string; exists: boolean }>('app.logPaths')
    .then(paths => { if (note) note.textContent = paths.exists ? '' : '日志文件还没有生成。' })
    .catch(() => { if (note) note.textContent = '（拿不到宿主通道）' })
}
