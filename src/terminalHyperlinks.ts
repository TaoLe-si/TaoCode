// 终端里的**超链接**（上游那一族：`Osc8UrlHyperlinkFilter` + `JediTermHyperlinkFilterAdapter`
// + `CompositeFilterWrapper`，判定规则都在 `UrlFilter` 与 `URLUtil`）。
//
// 判词 `ex/terminal` 的未做项之一：终端输出里的 URL 在上游是可点开的链接，本仓以前只画字符。
//
// 上游坐标（逐个文件开过）：
//   · 挂载 `platform/execution-impl/src/com/intellij/terminal/JBTerminalWidget.java:87-90`
//     —— `myHyperlinkFilter = new JediTermHyperlinkFilterAdapter(project, console, this)` →
//     `addAsyncHyperlinkFilter(...)`，并且 `jediTerminal.setUrlHyperlinkFilter(new Osc8UrlHyperlinkFilter(project, this))`；
//     `:71` 是字段声明，`:189` 是 `addFilter(filter)` 的入口（控制台过滤器往同一处加）。
//   · OSC 8 那条 `platform/execution-impl/src/com/intellij/terminal/Osc8UrlHyperlinkFilter.kt:10-17`
//     —— 本体只有一件事：把整行交给 `UrlFilter(project)`（`:11` `private val delegate: Filter = UrlFilter(project)`、
//     `:13-17` `apply(line)` = `delegate.applyFilter(line, line.length)?.let { convertLinkResult(...) }`）。
//     **注意**：OSC 8 的链接文本也要再过一遍 URL 判定，不是「协议里写了什么就照开」。
//   · 异步与限流 `platform/execution-impl/src/com/intellij/terminal/JediTermHyperlinkFilterAdapter.kt:49`
//     （`Channel(MAX_BUFFERED_REQUESTS, DROP_OLDEST)`）、`:58`（`limitedParallelism(1)`，注释 `:54-57`
//     写明「超链接是附加功能，不能吃 CPU」）、`:97`（`lineInfo.line ?: return null` —— 过期的行不算）、
//     `:115`（`MAX_BUFFERED_REQUESTS = 10000`）。
//   · 点击后的动作 `JediTermHyperlinkFilterAdapter.kt:131-143` —— `setNavigateCallback { info.navigate(project) }`，
//     以及 `HyperlinkWithPopupMenuInfo` 时给右键菜单（动作再经 `TerminalActionUtil.createTerminalAction` 包装，`:141`）。
//   · 过滤器合成 `platform/execution-impl/src/com/intellij/terminal/CompositeFilterWrapper.java:52-62`
//     —— 自定义过滤器 + 项目预置过滤器，`:59` `setForceUseAllFilters(true)`（全部过滤器都要跑）。
//   · 判定规则本体 `platform/execution-impl/src/com/intellij/execution/filters/UrlFilter.java`：
//     `:56` 先 `URLUtil.canContainUrl(line)` 否则整行跳过；
//     `:61-63` 行里有 `file:` 才跑 `FILE_URL_PATTERN_OPTIMIZED`；
//     `:65-67` `isPotentialUrl(line)` 才跑 `URL_PATTERN_OPTIMIZED`；
//     `:69-71` 没有命中就 null；`:73-78` **只有一个命中**时返回单个区间，多个命中返回列表；
//     `:81-87` `isPotentialUrl` = 含 `www` / `http` / `mailto` / `ftp` / `news`；
//     `:89-92` `buildHyperlinkInfo` = 先试 `buildFileHyperlinkInfo`，不是文件就是 `OpenUrlHyperlinkInfo(url)`；
//     `:94-123` `buildFileHyperlinkInfo`（`.html` 不当文件、末尾 `:行` 与 `:行:列` 的解析、`prefix.length()` 之后才认冒号）；
//     `:125-133` `findFileProtocolPrefix`（`file:///` 与最小式 `file:`，但 `LocalFileSystem.PROTOCOL_PREFIX`
//     = `file:///` 那种完整形式走前一条）；
//     `:135-141` `toWindowsPath`（`/C:/x` 去掉开头那个斜杠）；`:143-150` `decode`（百分号解码，解不动就原样）。
//   · 两条正则与预检 `platform/util/src/com/intellij/util/io/URLUtil.java:50`（`URL_PATTERN_OPTIMIZED`）、
//     `:52`（`FILE_URL_PATTERN_OPTIMIZED`）、`:60-62`（`canContainUrl` = 含 `mailto:` / `://` / `www.` / `file:`）。
//   · 右键菜单里那两条动作 `platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java:44-67`
//     （逐个活动浏览器「在 X 中打开」+ `:58-65` 「复制链接」）与 `:69-72` 的 `navigate` = `BrowserLauncher.browse(url, ...)`。
//
// 与架构不等价的地方（照本仓架构还原同一件用户可见的事，不自建上游没有的控件）：
//   1. 上游的链接判定是**逐行异步**算的（`JediTermHyperlinkFilterAdapter.kt:75-79`）；本仓用 xterm 的
//      `registerLinkProvider`，宿主同样是「按行问一次」（`provideLinks(bufferLineNumber, callback)`），
//      所以这里只做同步的纯函数判定，缓存与限流交给 xterm。
//      面板只在**鼠标悬停那一行**才问（xterm 的行为），与上游 `:97`「过期行不算」是同一类约束。
//   2. 「逐个浏览器打开」这条**不渲染**：本仓宿主只有系统默认那一出口（`src/browsers.ts:159`
//      写明「宿主没有「用指定程序打开 URL」的通道」）⇒ 只给「在浏览器中打开」（`shell.openUrl`）与「复制链接」。
//   3. `www.` 这种**没有协议前缀**的命中在这里不算链接：本仓 `shell.openUrl` 的另一端
//      `open_external` 明确拒绝无协议字符串（`native/file_queries.cpp:234-236` 的注释写的就是这条安全边界），
//      画一个点不开的链接比不画更糟。上游那层补协议的动作发生在 `BrowserLauncher` 里，本仓没有等价物。
//   4. `file:` / `file:///` 命中会**判定并解析**（`terminalLinkTarget` 返回 `kind:'file'`），但面板
//      当前拿它去走 `terminalLinkActivatable` 的否分支：终端面板没有打开编辑器的通道
//      （`src/components/TerminalPanel.vue` 的 props/emits 里没有 jump 一类，宿主 `src/App.vue` 是保留文件）
//      ⇒ 解析结果先由判据钉住，接线写在 `docs/wiring-requests-2026-10-06-terminal.md` T1。
//
// 判据：`tests/terminal-hyperlinks.test.mjs`。

/** 一条行文本里的一个链接区间（左闭右开，偏移按 UTF-16 计，与 xterm 的 buffer 列号同域）。 */
export interface TerminalHyperlinkRange {
  start: number
  end: number
  /** 命中的原文（上游 `matcher.group()`，`UrlFilter.java:49`）。 */
  text: string
}

/** 链接的落点（上游 `buildHyperlinkInfo` 的两个分支，`UrlFilter.java:89-92`）。 */
export type TerminalLinkTarget =
  /** 交给浏览器/系统默认处理器（上游 `OpenUrlHyperlinkInfo`）。 */
  | { kind: 'browser'; url: string }
  /** 交给编辑器（上游 `FileUrlHyperlinkInfo`）；`line`/`column` 是 0 基，null = 没写。 */
  | { kind: 'file'; path: string; line: number | null; column: number | null; url: string }

/** `URLUtil.java:50` 的 `URL_PATTERN_OPTIMIZED`（JS 侧：`\p{L}` 与后顾都要 `u` 旗标）。 */
const URL_PATTERN = /\b(?:mailto:|(?:news|(?:ht|f)tps?):\/\/|(?<![\p{L}0-9_.])www\.)[-A-Za-z0-9+$&@#/%?=~_|!:,.;]*[-A-Za-z0-9+$&@#/%=~_|]/gu

/** `URLUtil.java:52` 的 `FILE_URL_PATTERN_OPTIMIZED`。 */
const FILE_URL_PATTERN = /\bfile:(?:\/|[A-Za-z]:)[^\s()[\]]*[^\s()[\]:;?!,.]/gu

/** `URLUtil.canContainUrl`（`URLUtil.java:60-62`）：四种含串之一才继续查。 */
export function terminalLineMayContainUrl(line: string): boolean {
  return line.includes('mailto:') || line.includes('://') || line.includes('www.') || line.includes('file:')
}

/** `UrlFilter.isPotentialUrl`（`UrlFilter.java:81-87`）：五个词之一。 */
export function terminalUrlWordPresent(line: string): boolean {
  return line.includes('www') || line.includes('http') || line.includes('mailto') || line.includes('ftp') || line.includes('news')
}

/** 一条正则在一行里取全部命中（`UrlFilter.findMatchingItems`，`:44-52`）。 */
function matchesOf(pattern: RegExp, line: string): TerminalHyperlinkRange[] {
  const rows: TerminalHyperlinkRange[] = []
  // 复用一个全局正则前先归零 lastIndex，否则上一个调用留下的偏移会吃掉行首。
  pattern.lastIndex = 0
  for (;;) {
    const found = pattern.exec(line)
    if (!found) break
    // JS 与 Java 的一个差别：零宽命中时 exec 不会自动前进，这里手动让一格，避免死循环。
    if (found[0].length === 0) { pattern.lastIndex += 1; continue }
    rows.push({ start: found.index, end: found.index + found[0].length, text: found[0] })
  }
  return rows
}

/**
 * 一行里的全部链接区间，顺序与 `UrlFilter.applyFilter`（`:61-67`）一致：**先 `file:` 命中、再 URL 命中**。
 *
 * 上游把多个过滤器的结果并成一张表（`CompositeFilterWrapper.java:58` 的 `ContainerUtil.concat`），
 * 区间可以交叠；xterm 的 link provider 每个格子只能挂一条链接（`ILink.range`），
 * 所以这里按上游顺序**丢后被前一个区间覆盖的命中** —— 保留的是上游"先算出来的那条"，不是新规则。
 */
export function terminalHyperlinkRanges(line: string): TerminalHyperlinkRange[] {
  if (!terminalLineMayContainUrl(line)) return []
  const found: TerminalHyperlinkRange[] = []
  if (line.includes('file:')) found.push(...matchesOf(FILE_URL_PATTERN, line))
  if (terminalUrlWordPresent(line)) found.push(...matchesOf(URL_PATTERN, line))
  const kept: TerminalHyperlinkRange[] = []
  for (const range of found) {
    if (kept.some(other => range.start < other.end && other.start < range.end)) continue
    kept.push(range)
  }
  return kept
}

/**
 * `UrlFilter.findFileProtocolPrefix`（`:125-133`）：`file:///` 命中时返回的是
 * `LocalFileSystem.PROTOCOL_PREFIX`（= `file` + `://`，即 **`file://`**，不是 `file:///`），
 * 所以 `file:///home/x` 剥完前缀是 `/home/x`、`file:///C:/x` 是 `/C:/x`（再由 `toWindowsPath` 去掉那根斜杠）；
 * 最小式 `file:` 只在**不是** `file://` 开头时用（`:129` 的那个 `!startsWith`）。
 */
function fileProtocolPrefix(url: string): string | null {
  if (url.startsWith('file:///')) return 'file://'
  if (url.startsWith('file:') && !url.startsWith('file://')) return 'file:'
  return null
}

/** `UrlFilter.toWindowsPath`（`:135-141`）：`/C:/x` 这种带前导斜杠的盘符去掉第一个斜杠。 */
function toWindowsPath(path: string): string {
  if (path.length >= 4 && path.charAt(0) === '/' && /[A-Za-z]/.test(path.charAt(1)) &&
      path.charAt(2) === ':' && (path.charAt(3) === '/' || path.charAt(3) === '\\')) {
    return path.slice(1)
  }
  return path
}

/** `UrlFilter.decode`（`:143-150`）：百分号解码，`IllegalArgumentException` 时原样返回。 */
function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** `StringUtil.parseInt(x, Integer.MIN_VALUE)`：整串是十进制整数才给值。 */
function parseIntOrNull(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * 命中文本 → 落点（`UrlFilter.buildHyperlinkInfo:89-92` + `buildFileHyperlinkInfo:94-123`）。
 *
 * 上游那两个分支的取舍原样搬：
 *   · `.html` 结尾的 `file:` 串**不当文件**（`:95` `!url.endsWith(".html")`）—— 那是给浏览器看的页面；
 *   · 末尾的 `:行` / `:行:列` 只有**冒号后是整数**才算（`:104-117`），且冒号要在协议前缀之后（`:103`）；
 *   · 其余一律 `OpenUrlHyperlinkInfo`（`:91`）。
 */
export function terminalLinkTarget(matched: string): TerminalLinkTarget {
  const prefix = fileProtocolPrefix(matched)
  if (prefix === null || matched.toLowerCase().endsWith('.html')) {
    return { kind: 'browser', url: matched }
  }
  let filePathEnd = matched.length
  let line: number | null = null
  let column: number | null = null
  const lastColon = matched.lastIndexOf(':')
  if (lastColon > prefix.length && lastColon < matched.length - 1) {
    const tail = parseIntOrNull(matched.slice(lastColon + 1))
    if (tail !== null) {
      line = tail - 1
      filePathEnd = lastColon
      const previousColon = matched.lastIndexOf(':', lastColon - 1)
      if (previousColon > prefix.length) {
        const before = parseIntOrNull(matched.slice(previousColon + 1, lastColon))
        if (before !== null) {
          line = before - 1
          column = tail - 1
          filePathEnd = previousColon
        }
      }
    }
  }
  return {
    kind: 'file',
    path: toWindowsPath(decodeUrlPart(matched.slice(prefix.length, filePathEnd))),
    line,
    column,
    url: matched,
  }
}

/** `URLUtil.java:42` 的 `SCHEME_SEPARATOR`：本仓宿主只认带协议前缀的串（见文件头第 3 条）。 */
const SCHEME_PATTERN = /^[-A-Za-z][-.A-Za-z0-9+]*:/

/**
 * 面板**能不能真的把这条链接点开**。
 *
 * 三个真实的否分支，各给一句用户能看懂的原因（不渲染点不动的控件）：
 *   · `file:` —— 终端面板没有编辑器通道（文件头第 4 条）；
 *   · 没有协议前缀（`www.` 那种）—— 宿主 `open_external` 直接拒；
 *   · 浏览器预览 —— 没有 `shell.openUrl` 这条宿主通道。
 */
export function terminalLinkActivatable(target: TerminalLinkTarget, desktop: boolean): { ok: boolean; reason: string } {
  if (target.kind === 'file') return { ok: false, reason: '终端面板没有打开编辑器的通道（见接线请求 T1）。' }
  if (!SCHEME_PATTERN.test(target.url)) return { ok: false, reason: '这个地址没有协议前缀，宿主不会把它交给浏览器。' }
  if (!desktop) return { ok: false, reason: '浏览器预览不能调用系统默认程序打开链接。' }
  return { ok: true, reason: '' }
}

/**
 * OSC 8 链接的 URI 该怎么处理（上游 `Osc8UrlHyperlinkFilter.kt:10-17`：OSC 8 也要过 `UrlFilter`）。
 *
 * xterm.js 在没有 `linkHandler` 时用浏览器的 `confirm` + `window.open`（`node_modules/@xterm/xterm/typings/xterm.d.ts:155-166`
 * 的注释写明了这条默认行为与它的安全提醒）—— 桌面宿主里那是错的一条路，
 * 面板因此**总是**装自己的 handler：能开的走 `shell.openUrl`，不能开的什么都不做并给出原因。
 */
export function terminalOsc8Target(uri: string): TerminalLinkTarget {
  return terminalLinkTarget(uri)
}

/** 悬停提示（上游把链接动作放进右键菜单；本仓把它写成一行 title，动作仍然只有「打开/复制」两条）。 */
export function terminalLinkTooltip(target: TerminalLinkTarget, activatable: boolean): string {
  if (target.kind === 'file') return `文件 ${target.url}${activatable ? '（Ctrl+单击打开）' : '（终端面板暂时打不开编辑器）'}`
  return activatable ? `在浏览器中打开 ${target.url}（Ctrl+单击）` : target.url
}

// ---------------------------------------------------------------------------
// 终端输出里的**裸文件路径**（`foo.c:12:3`、`C:\work\a.ts:8`、`~/notes/x.md: (3, 7)`）→ 该跳到哪一行。
//
// 判词 `ex/terminal` 里「跳转到错误行/路径」这一条的可判定部分。上游坐标（逐个文件开过）：
//   · 本体 `plugins/terminal/src/org/jetbrains/plugins/terminal/hyperlinks/filter/TerminalGenericFileFilter.kt`
//     —— 注释 `:20-30` 写明它「在终端输出里找文件路径并变成**不可见**超链接」，识别三种：
//     环境相关的绝对路径、`~/` 家目录相对路径、shell 当前目录相对路径；
//     `:25-27` 那条硬规则：**只有 `fileLookup` 查得到文件才算链接**（查找器在 `:110-112`：
//     「每一行输出都要过滤，所以只有 VFS 缓存查得起」）。
//     注册成 console 过滤器 `.../META-INF/terminal.xml:84`（`TerminalGenericFileFilterProvider`），
//     而终端确实会把所有 `ConsoleFilterProvider` 过滤器跑在每一行输出上
//     （`platform/execution-impl/src/com/intellij/terminal/CompositeFilterWrapper.java:51-62`
//     + `platform/platform-impl/src/com/intellij/execution/impl/ConsoleViewUtil.java:315-335`）。
//     开关：`TerminalGenericFileFilter.kt:95` 的 Registry `terminal.generic.hyperlinks`（**默认 false**）。
//   · 起点与门槛 `.../TerminalAbsolutePathLinkFinder.kt:116-133`（`/` 起、`~` 紧跟分隔符起、
//     大写字母紧跟 `:\` 或 `:/` 起）；`:77-93` 的 `findFile`（段长 ≤ `FILENAME_MAX`、总长 ≥ `PATH_MIN`、
//     整串全是分隔符不算、`~` 要有家目录才展开）；两个常量在同包的
//     `TerminalGenericFileFilter.kt:59-68`（255 / 2）。
//   · 行号列号 `.../TerminalRelativePathLinkFinder.kt:169-218` 的 `parsePosition`，
//     三种形状：`path: (line, column)`、`path:line[:column]`、`path:start-end`（跳到 start，列给 1）；
//     `:226-238` 的 `takeNumberFromIndex` —— **数字一路吃到行尾就不算**（`for` 走完直接 `return null`）、
//     超过 7 位也不算；`:70` 的 `safeToIntOrDefault` = `StringUtil.parseInt(x, 默认值)`，默认值给 1。
//     换算成 0 基在 `TerminalAbsolutePathLinkFinder.kt:107-114`（`oneBasedLine - 1`）。
//
// **没有搬的那半（如实）**：上游状态机里「路径含空格时逐段回看目录前缀」（`:145-198`）依赖
// `directoryPrefixMayExist()`（`:99-105`）——那是拿 VFS 缓存问目录存在性；本仓没有同步、廉价的
// exists 通道（`file.read` 会把整个文件读进来、`workspace.files` 是全树扫描），所以这里的
// `exists` 由调用方注入，面板**先不渲染**这批链接，接线的两个候选落点写在
// `docs/wiring-requests-2026-10-06-term3.md`（R2：宿主 `fs.exists`；N2：把 `workspace.files` 的清单挂成
// 可查询的状态）。链接点开还需要编辑器通道 ⇒ 同一份请求的 R1（沿用 `docs/wiring-requests-2026-10-06-terminal.md` 的 T1）。
//
// 判据：`tests/terminal-hyperlinks.test.mjs`。
// ---------------------------------------------------------------------------

/** `TerminalGenericFileFilter.kt:60` 的 `FILENAME_MAX`（单个路径段的上限）。 */
export const TERMINAL_FILENAME_MAX = 255

/** `TerminalGenericFileFilter.kt:68` 的 `PATH_MIN`：短于这个长度不算路径（避免 `[10 / 1,000]` 那种进度条）。 */
export const TERMINAL_PATH_MIN = 2

/** 一条裸路径命中（左闭右开，偏移按 UTF-16 计）。 */
export interface TerminalPathLink {
  start: number
  end: number
  /** 剥掉 `~`/协议前缀之后、交给 `exists` 问过存在性的路径原文。 */
  path: string
  /** 0 基行号/列号；`parsePosition` 没认出行号时上游给的是 0（`findValidResult(…, 0, 0)`，`:110`）。 */
  line: number
  column: number
}

export interface TerminalPathLinkContext {
  /** 上游 `context?.userHomeDirectory`（`:87-90`）：没有家目录时 `~/x` 一律不算。 */
  home?: string | null
  /** 上游 `TerminalRelativePathLinkFinder` 的靶子；这里只用于「相对路径要不要试」，见文件头。 */
  workingDirectory?: string | null
  /** 存在性查询（上游的 `TerminalFileLookup`）：查不到就不是链接，这是硬规则 `:25-27`。 */
  exists: (path: string) => boolean
}

/** `TerminalRelativePathLinkFinder.kt:226-238` 的 `takeNumberFromIndex`（含「吃到行尾就不算」与 7 位上限两条 quirk）。 */
function takeNumberFromIndex(line: string, startIndex: number): string | null {
  for (let i = startIndex; i < line.length; i += 1) {
    if (i - startIndex >= 7) return null
    if (!/\d/.test(line[i])) return i === startIndex ? null : line.slice(startIndex, i)
  }
  return null
}

/** `TerminalRelativePathLinkFinder.kt:70` 的 `safeToIntOrDefault`：整串是十进制才给值，否则给默认值。 */
function safeToIntOrDefault(value: string, defaultValue: number): number {
  return /^-?\d+$/.test(value) ? Number(value) : defaultValue
}

/** `TerminalRelativePathLinkFinder.kt:169-218` 的 `parsePosition`（1 基的行/列 + 链接右端）。 */
export function terminalPathPosition(line: string, colonIndex: number): { line: number; column: number; linkEnd: number } | null {
  if (line.startsWith(' (', colonIndex + 1)) {
    let i = colonIndex + 3
    const lineStr = takeNumberFromIndex(line, i)
    if (lineStr === null) return null
    i += lineStr.length
    if (!line.startsWith(', ', i)) return null
    i += 2
    const columnStr = takeNumberFromIndex(line, i)
    if (columnStr === null) return null
    i += columnStr.length
    if (line[i] !== ')') return null
    return { line: safeToIntOrDefault(lineStr, 1), column: safeToIntOrDefault(columnStr, 1), linkEnd: i + 1 }
  }
  let i = colonIndex + 1
  const lineStr = takeNumberFromIndex(line, i)
  if (lineStr === null) return null
  i += lineStr.length
  const next = i < line.length ? line[i] : ''
  if (next === '-') {
    i += 1
    const endStr = takeNumberFromIndex(line, i)
    if (endStr !== null) return { line: safeToIntOrDefault(lineStr, 1), column: 1, linkEnd: i + endStr.length }
    return { line: safeToIntOrDefault(lineStr, 1), column: 1, linkEnd: i }
  }
  if (next === ':') {
    i += 1
    const columnStr = takeNumberFromIndex(line, i)
    if (columnStr !== null) return { line: safeToIntOrDefault(lineStr, 1), column: safeToIntOrDefault(columnStr, 1), linkEnd: i + columnStr.length }
  }
  return { line: safeToIntOrDefault(lineStr, 1), column: 1, linkEnd: i }
}

/** `TerminalAbsolutePathLinkFinder.kt:77-93` 的 `findFile` 门槛（段长/总长/纯分隔符/`~` 展开）。 */
function resolvePathToken(rawPath: string, context: TerminalPathLinkContext): string | null {
  if (rawPath.length < TERMINAL_PATH_MIN) return null
  if (/^[\\/]+$/.test(rawPath)) return null
  const segments = rawPath.split(/[\\/]/)
  if (segments.some(segment => segment.length > TERMINAL_FILENAME_MAX)) return null
  if (rawPath[0] === '~') {
    if (!context.home) return null
    return `${context.home}${rawPath.slice(1)}`
  }
  return rawPath
}

/**
 * 一行输出里的裸文件路径链接（`exists` 查得到才算）。
 * 起点扫描照 `TerminalAbsolutePathLinkFinder.kt:116-133`：`/`、`~/`|`~\`、`C:\`|`C:/`。
 */
export function terminalPathLinkRanges(line: string, context: TerminalPathLinkContext): TerminalPathLink[] {
  const links: TerminalPathLink[] = []
  let index = 0
  while (index < line.length) {
    const char = line[index]
    const driveStart = char >= 'A' && char <= 'Z' && (line.startsWith(':\\', index + 1) || line.startsWith(':/', index + 1))
    const homeStart = char === '~' && (line[index + 1] === '/' || line[index + 1] === '\\')
    if (char !== '/' && !driveStart && !homeStart) { index += 1; continue }
    const start = index
    if (driveStart) index += 2
    let end = index + 1
    while (end < line.length && !/\s|:/.test(line[end])) end += 1
    const rawPath = line.slice(start, end)
    const path = resolvePathToken(rawPath, context)
    let consumed = end
    if (path !== null && context.exists(path)) {
      let line1 = 0
      let column = 0
      let linkEnd = end
      const colon = line[end] === ':' ? end : -1
      if (colon !== -1) {
        const position = terminalPathPosition(line, colon)
        if (position !== null) {
          // `findValidResultWithNumbers`（`:107-114`）：1 基换算成 0 基，链接右端吃到行列号。
          line1 = position.line - 1
          column = position.column - 1
          linkEnd = position.linkEnd
        }
      }
      links.push({ start, end: linkEnd, path, line: line1, column })
      consumed = Math.max(consumed, linkEnd)
    }
    index = consumed > index ? consumed : index + 1
  }
  return links
}
