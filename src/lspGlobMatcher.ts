// LSP 的 glob 匹配与文件事件筛选 —— 上游 `platform/lsp-impl/src/impl/LspGlobMatcher.kt` +
// `platform/util/src/com/intellij/openapi/util/globUtil.kt` 的可移植那一半。
//
// 为什么这一层值得单独落：`client/registerCapability` 带回来的 `registerOptions` 里，
// `documentSelector.pattern` 与 `workspace/didChangeWatchedFiles` 的 `watchers[].globPattern`
// 都是 glob。本仓宿主**原样透传**这两批参数（`native/lsp_host_bootstrap.cpp:113-121` 把
// `registrations` / `unregisterations` / `token` 三个键整个塞进 `lsp.message` 事件），
// 所以「哪个文件被这条动态注册管着」「哪些文件事件该告诉服务器」这两条判定在本仓是**可做的** ——
// 之前只是没有规则层，`src/lspServerMessages.ts:286-296` 的 `lspRegistrationEntries` 只取了 `{id, method}`。
//
// 逐条对照的源码（相对参考树根，本轮逐条打开核过）：
//   · `LspGlobMatcher.kt:8-27` —— `pathMatches(path, isDirectory, globPattern, basePath)`：
//     `basePath` 非空时先按它裁相对路径（相等 ⇒ 空串；以 `basePath/` 开头 ⇒ 去掉前缀；
//     否则 **不匹配**）；**目录一律返回 true**（上游注释原文：目录可能含匹配的文件，
//     而 per-file 事件不会生成，所以目录事件一律转给服务器）；文件才真正跑 matcher。
//   · `globUtil.kt:36-42` 的 `getPathMatcher` + `:44-78` 的 `transformIntoJdkFriendlyGlobs` ——
//     上游为了绕开 JDK `FileSystem.getPathMatcher` 对 globstar 的缺陷（globstar 加斜杠加 `foo.txt`
//     匹配不了 `foo.txt`），把 globstar 加斜杠那一段替换成 `{` + globstar + `/` + `,}`，并对尾部的每个
//     globstar 再生成一份「把它删掉」的变体；`{a,b}` 花括号组在 JDK glob 里是「或」。
//   · `FileChangeInfo.kt:16-28` 的 `doesFileWatcherKindMatchFileChangeType` ——
//     `watchKind == null` 等价于 Create|Change|Delete（协议原文），否则按位与判。
//   · `LspWatchedFiles.kt:19-45` 的 `getLsp4jFileEvent` —— 逐 watcher 先问 kind，再问 glob
//     （`globPattern` 是 Either：左 = 裸 pattern、basePath 为 null；右 = `RelativePattern`，
//     本仓与上游一样**只支持绝对 baseUri**，相对的那些跳过）。
//
// 本模块是纯函数、零运行时 import（`node --test` 可直接驱动）。

/** 一个文件变更事件（`FileChangeInfo.kt:7-12`；`changeType` 用协议的数字：1=Created 2=Changed 3=Deleted）。 */
export interface FileChangeInfo {
  path: string
  uri: string
  isDirectory: boolean
  changeType: 1 | 2 | 3
}

/** 协议的 `WatchKind` 位（`FileChangeInfo.kt:20-27` 的三个常量）。 */
export const WATCH_KIND_CREATE = 1
export const WATCH_KIND_CHANGE = 2
export const WATCH_KIND_DELETE = 4

/**
 * `FileChangeInfo.kt:16-28`：这个 watcher 的 kind 管不管这类变更。
 * `null`/`undefined` = 三类都管（协议 `fileSystemWatcher.watchKind` 缺省语义）。
 */
export function watcherKindMatchesFileChangeType(watchKind: number | null | undefined, changeType: number): boolean {
  if (watchKind === null || watchKind === undefined) return true
  if (changeType === 1) return (watchKind & WATCH_KIND_CREATE) !== 0
  if (changeType === 2) return (watchKind & WATCH_KIND_CHANGE) !== 0
  if (changeType === 3) return (watchKind & WATCH_KIND_DELETE) !== 0
  return false
}

/**
 * 把一条 glob 编成整串匹配的正则 —— `globUtil.kt` 那一套「JDK 友好 glob」的等价物。
 *
 * 上游把 globstar 加斜杠那一段展开成 `{` + globstar + `/` + `,}` 再交给 JDK；本仓直接把它
 * 编成 `(?:[^/]+/)*`（「零层或多层目录」），语义与展开后完全一致，且不需要花括号组：
 *   · 加斜杠的 globstar 命中零层（`foo.txt`）与多层（`src/foo.txt`）—— 正是上游要修的 JDK 缺陷；
 *   · `src` + 加斜杠 globstar + `foo.txt` 命中 `src/foo.txt` 与 `src/a/b/foo.txt`；
 *   · 单独的 globstar（后面没有斜杠）编成 `.*`（跨目录）；
 *   · `*` = `[^/]*`、`?` = `[^/]`、`{a,b}` = `(?:a|b)`（JDK glob 的花括号组）。
 *
 * 路径一律按 `/` 归一（上游 `Path.of(...)` 在 Windows 上也是 `/` 分隔的 `Path`）。
 */
export function globToRegExpSource(pattern: string): string {
  const normalized = pattern.replace(/\\/g, '/').replace(/^glob:/, '')
  let source = ''
  for (let index = 0; index < normalized.length; ++index) {
    const char = normalized[index]!
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        // globstar 加斜杠 ⇒ 零层或多层目录；裸 globstar ⇒ 任意字符（含 `/`）。
        if (normalized[index + 2] === '/') { source += '(?:[^/]+/)*'; index += 2 }
        else { source += '.*'; ++index }
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else if (char === '{') source += '(?:'
    else if (char === '}') source += ')'
    else if (char === ',') source += '|'
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return source
}

/** 编好并缓存的正则表（上游 `patternToPathMatcherCache`，`LspGlobMatcher.kt:10`）。 */
const patternCache = new Map<string, RegExp>()

/**
 * 一条 glob 是否整串命中这个路径（大小写敏感，与 JDK 默认文件系统一致）。
 * 非法 pattern 不抛错，返回 false（上游 `getPathMatcher` 的 `ignorePatternSyntaxException=true` 口径）。
 */
export function globMatches(path: string, pattern: string): boolean {
  if (!pattern) return false
  let matcher = patternCache.get(pattern)
  if (!matcher) {
    try { matcher = new RegExp(`^(?:${globToRegExpSource(pattern)})$`) }
    catch { matcher = /(?!)/ }   // 编不出来 ⇒ 永不匹配
    patternCache.set(pattern, matcher)
  }
  return matcher.test(path.replace(/\\/g, '/'))
}

/**
 * `LspGlobMatcher.pathMatches`（`:8-27`）的等价物。
 *
 * `basePath` 非空时先裁相对路径：相等 ⇒ 空串、以 `basePath/` 开头 ⇒ 去前缀、
 * 否则**直接 false**（上游 `:14` 的 `return false // base URI doesn't match this path`）。
 * **目录一律 true**（上游 `:18-21` 的注释：目录可能含匹配的文件，而 per-file 事件不会生成，
 * 所以目录事件一律转给服务器）。
 */
export function pathMatchesGlob(path: string, isDirectory: boolean, globPattern: string, basePath?: string | null): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  let pathToMatch = normalizedPath
  if (basePath) {
    const base = basePath.replace(/\\/g, '/').replace(/\/+$/, '')
    if (normalizedPath === base) pathToMatch = ''
    else if (normalizedPath.startsWith(`${base}/`)) pathToMatch = normalizedPath.slice(base.length + 1)
    else return false
  }
  if (isDirectory) return true
  return globMatches(pathToMatch, globPattern)
}

/** `RelativePattern` 的形状（协议 `globPattern` 那个 Either 的右支；`:33-40`）。 */
export interface LspRelativePattern {
  /** `baseUri`：本仓只认字符串形态（`{uri}` 对象形态由调用方先折算）。 */
  baseUri: string
  pattern: string
}

/** 一个文件系统监视器（协议 `fileSystemWatcher`）。 */
export interface LspFileWatcher {
  /** 裸 glob，或 `{baseUri, pattern}` 的相对形态（协议的 Either）。 */
  globPattern: string | LspRelativePattern
  /** `WatchKind` 位；缺省 = Create|Change|Delete。 */
  kind?: number | null
}

/**
 * `LspWatchedFiles.getLsp4jFileEvent`（`:30-45`）的等价物：这个事件该不该告诉服务器。
 *
 * 逐 watcher 先问 kind（`:31`），再问 glob：
 *   · 裸 pattern ⇒ `basePath = null`（`:35-38`）；
 *   · `RelativePattern` ⇒ 把 `baseUri` 落成目录路径当 basePath（`:40-45`）——
 *     上游要求那个 base 目录**真实存在且是目录**，本仓把这件事交给调用方（`baseDir` 参数：
 *     undefined = 找不到那个目录 ⇒ 这条 watcher 跳过，与上游 `baseDir != null && isDirectory` 同效）。
 */
export function fileEventMatchesWatchers(
  info: FileChangeInfo,
  watchers: readonly LspFileWatcher[],
  baseDir?: (baseUri: string) => string | undefined,
): boolean {
  for (const watcher of watchers) {
    if (!watcherKindMatchesFileChangeType(watcher.kind, info.changeType)) continue
    if (typeof watcher.globPattern === 'string') {
      if (pathMatchesGlob(info.path, info.isDirectory, watcher.globPattern, null)) return true
      continue
    }
    const base = baseDir?.(watcher.globPattern.baseUri)
    if (!base) continue
    if (pathMatchesGlob(info.path, info.isDirectory, watcher.globPattern.pattern, base)) return true
  }
  return false
}

/** 清缓存（判据与「换工程」用；生产链路不需要）。 */
export function clearGlobMatcherCache(): void { patternCache.clear() }