// LSP `textDocument/documentLink` —— 文档里的可点击区间。
//
// IDEA 侧的对应物（已核实的类，不是"看起来像"）：
//   · 编辑器里 Ctrl+Click 跳到目标的扩展点是 `GotoDeclarationHandler`
//     （`platform/analysis-api/src/com/intellij/codeInsight/navigation/actions/GotoDeclarationHandler.java`）；
//   · "点一下导航"这个抽象是 `HyperlinkInfo.navigate(project)`
//     （`platform/core-api/src/com/intellij/execution/filters/HyperlinkInfo.kt:17-20`）——
//     它不关心目标是网页还是文件，由实现决定（`OpenUrlHyperlinkInfo`
//     在 `platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java` 走浏览器，
//     文件链接走 `OpenFileDescriptor`）。
//
// 所以这里的 `classifyLinkTarget` 就是那个"由实现决定"的部分：**外部链接交给系统**，
// **文件路径交给 IDE 自己打开**（这样才能定位到行、复用标签页）。

export interface DocumentLink {
  /** 0 基行号。 */
  startLine: number
  startChar: number
  endLine: number
  endChar: number
  /** 规范里可选：`resolveProvider: false` 时服务器一般会给，但**可能没有**。 */
  target?: string
  tooltip?: string
}

export interface DocumentLinkResult {
  available: boolean
  links?: DocumentLink[]
}

/** 点一下要做什么。`none` = 这条链接没有目标（只有 tooltip 可显示）。 */
export type LinkAction =
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string; line: number }
  | { kind: 'none' }

/** RFC 3986 的 `scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` 后面跟冒号。 */
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
/**
 * Windows 盘符：`C:/x`、`C:\x`。
 *
 * **必须在 `URL_SCHEME` 之前判**：`C:` 完全符合 scheme 的语法，不排除的话每个绝对路径都会被
 * 当成 URL 交给浏览器（而这个函数的另一端是宿主的 `shell.openUrl`，那边更危险 ——
 * `ShellExecuteW` 对 `C:\x.exe` 会直接执行它）。
 */
const DRIVE_LETTER = /^[A-Za-z]:[\\/]/

/** `file:///C:/x/y.ts#L12-L15` 里的 `#L12` —— 很多服务器用它指到具体行。 */
const FRAGMENT_LINE = /^#?L(\d+)/i

/**
 * 把 `file:` URI 还原成路径。处理 `file:///C:/...`（Windows 盘符）、`file:///home/...`（Unix）
 * 与 `file://<主机>/<共享>`（UNC 共享，还原成 `\\主机\共享\...`）；解不出来时返回空串
 * （调用方据此降级成"点不动"，而不是去打开一个猜出来的路径）。
 */
export function filePathFromUri(target: string): { path: string; line: number } {
  if (!target.toLowerCase().startsWith('file:')) return { path: '', line: 0 }
  const rest = target.slice('file:'.length)
  // 去掉 `//` 与紧跟在主机位之后的盘符形式：`file:///C:/x` → `/C:/x` → `C:/x`
  let body = rest.replace(/^\/\//, '')
  const hash = body.indexOf('#')
  let line = 0
  if (hash >= 0) {
    const match = body.slice(hash + 1).match(FRAGMENT_LINE)
    if (match) line = Number(match[1])
    body = body.slice(0, hash)
  }
  const query = body.indexOf('?')
  if (query >= 0) body = body.slice(0, query)
  // `//` 之后的第一段是**主机位**（空 / `localhost` = 本机；其余 = UNC 共享）。
  // 不还原 UNC 的话，`file://server/share/x` 会变成 `server/share/x` —— 一个看似工作区内的
  // 相对路径，Ctrl+Click 会打开一个完全不相干的位置（本仓是 Windows 宿主，UNC 是真实形态）。
  const firstSlash = body.indexOf('/')
  const rawAuthority = firstSlash === -1 ? body : body.slice(0, firstSlash)
  const decode = (value: string) => { try { return decodeURIComponent(value) } catch { return value } }
  if (rawAuthority && rawAuthority.toLowerCase() !== 'localhost') {
    const authority = decode(rawAuthority)
    const tail = firstSlash === -1 ? '' : decode(body.slice(firstSlash + 1))
    return { path: `\\\\${authority}${tail ? '\\' + tail.replace(/\//g, '\\') : ''}`, line }
  }
  // 本机：`localhost` 前缀是 URI 写法里多出来的主机位，路径从它后面的斜杠开始。
  let path = rawAuthority.toLowerCase() === 'localhost' && firstSlash >= 0 ? body.slice(firstSlash) : body
  path = decode(path)
  // `/C:/x` 是 Windows 盘符形式，开头的斜杠必须去掉，否则会变成一个不存在的路径。
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return { path, line }
}

/**
 * 目标的打开方式。
 *
 * 没有协议的字符串按**路径**处理：规范说 `target` 是 URI，但真实服务器（以及 IDEA 自己的
 * `HyperlinkFilter`）也会给相对/绝对路径 —— 直接当"点不动"会让一半链接失效。
 */
export function classifyLinkTarget(target: string | undefined | null): LinkAction {
  if (!target) return { kind: 'none' }
  if (target.toLowerCase().startsWith('file:')) {
    const { path, line } = filePathFromUri(target)
    return path ? { kind: 'file', path, line } : { kind: 'none' }
  }
  // 盘符先于 scheme 判定（见 `DRIVE_LETTER` 的注释）。
  if (DRIVE_LETTER.test(target)) return { kind: 'file', path: target, line: 0 }
  if (URL_SCHEME.test(target)) return { kind: 'external', url: target }
  // 没有协议：看起来像路径就按路径开（`src/a.ts` / `./a.md` / `\\server\share\x`）。
  if (target.includes('/') || target.includes('\\')) return { kind: 'file', path: target, line: 0 }
  return { kind: 'none' }
}

/** 位置比较：`(line, char)` 升序。 */
function before(lineA: number, charA: number, lineB: number, charB: number): boolean {
  return lineA < lineB || (lineA === lineB && charA < charB)
}

/**
 * 落在 (line, char) 上的链接。区间是**半开**的 `[start, end)`，与 LSP 一致 ——
 * 把末尾算进去会让相邻的两个链接在边界上互相抢。
 * 同一位置命中多条时取**最短**的那条：外层通常是服务器给的宽泛区间，内层才是真的链接。
 */
export function linkAt(links: readonly DocumentLink[] | undefined, line: number, character: number): DocumentLink | undefined {
  if (!Array.isArray(links)) return undefined
  let best: DocumentLink | undefined
  let bestLength = Number.POSITIVE_INFINITY
  for (const link of links) {
    if (!link) continue
    if (before(line, character, link.startLine, link.startChar)) continue
    if (!before(line, character, link.endLine, link.endChar)) continue
    const length = (link.endLine - link.startLine) * 10000 + (link.endChar - link.startChar)
    if (length < bestLength) { best = link; bestLength = length }
  }
  return best
}

/** hover / 状态栏用的文案。没有 target 时**说清楚**，而不是显示一个能点却点不动的链接。 */
export function describeLink(link: DocumentLink | undefined): string {
  if (!link) return ''
  if (link.tooltip) return link.tooltip
  if (link.target) return link.target
  return '这个链接没有目标（服务器只给了 tooltip）'
}
