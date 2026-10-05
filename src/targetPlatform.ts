// 目标平台（上游 `Platform` 枚举与 `TargetPlatform` 包装）。
//
// 上游出处：
//   platform/util/src/com/intellij/execution/Platform.java:8-24
//       只有两档：WINDOWS('\\', ';', "\r\n") / UNIX('/', ':', "\n")；文件分隔符、PATH 分隔符、
//       换行符都写死在枚举常量里，`current()` = `SystemInfo.isWindows ? WINDOWS : UNIX`（:22-24）。
//   platform/execution/src/com/intellij/execution/target/TargetPlatform.java:7-21
//       `TargetPlatform` 只是把 `Platform` 包一层：默认构造 = UNIX（:12-14），也可以显式
//       传一个平台进来（:16-18）——远程目标的平台与本机不同。
//
// 本仓为什么需要它（上一版没有这一层，是真实的缺口）：
//   src/executionTargets.ts 旧版按 JDK home 字符串里有没有 `\` 猜分隔符，并且**无条件**给可执行
//   文件加 `.exe`。宿主只做本机 CreateProcess（exec/wsl 判 `[-]`），所以目标平台恒等于本机平台，
//   但「恒等于本机」不等于「恒等于 Windows」：在 Linux/macOS 上跑 TaoCode（或 home 写成
//   `C:/Java21` 这种正斜杠形式）时，`<home>/bin/java.exe` 是不存在的路径。
//   上游不需要在本仓做这件事 —— 它把可执行文件解析交给目标端（`TargetEnvironmentRequest`，
//   见 TargetEnvironmentConfiguration.kt:39），本仓没有目标端，于是必须自己按平台拼。
//
// 纯函数（平台探测是唯一的浏览器/Node 差异点），判据 tests/target-environments.test.mjs。

export type TargetPlatformId = 'windows' | 'unix'

export interface TargetPlatform {
  id: TargetPlatformId
  /** 路径分隔符（`Platform.fileSeparator`）。 */
  fileSeparator: '/' | '\\'
  /** PATH 分隔符（`Platform.pathSeparator`）。 */
  pathSeparator: ';' | ':'
  /** 换行符（`Platform.lineSeparator`）。 */
  lineSeparator: string
}

/** `Platform.WINDOWS`（Platform.java:9）。 */
export const WINDOWS_PLATFORM: TargetPlatform = {
  id: 'windows', fileSeparator: '\\', pathSeparator: ';', lineSeparator: '\r\n',
}

/** `Platform.UNIX`（Platform.java:10）。 */
export const UNIX_PLATFORM: TargetPlatform = {
  id: 'unix', fileSeparator: '/', pathSeparator: ':', lineSeparator: '\n',
}

/**
 * 本机平台（`Platform.current()` 的等价物，Platform.java:22-24）。
 * 判据沿用仓库既有写法 `src/presentationAssistant.ts:67-71`：`navigator.platform` + `userAgent`。
 * 两者都拿不到时（Node 侧的测试环境）按 Windows 返回 —— 宿主只在本机起进程，而本仓 CI/桌面宿主
 * 都是 Windows；调用方也可以显式传平台，不必依赖这里。
 */
export function currentTargetPlatform(): TargetPlatform {
  const probe = typeof navigator === 'undefined'
    ? ''
    : `${(navigator as { platform?: string }).platform ?? ''} ${(navigator as { userAgent?: string }).userAgent ?? ''}`
  if (!probe) return WINDOWS_PLATFORM
  return /win/i.test(probe) ? WINDOWS_PLATFORM : UNIX_PLATFORM
}

/**
 * 从已知的路径形状反推目标平台（显式指定平台之外的第二条路：配置里已经有一个真实路径）。
 * `TargetPlatform` 的构造允许显式传平台（TargetPlatform.java:16-18），本仓的「显式平台」就是
 * 用户填的主路径。含反斜杠 ⇒ Windows；否则看是否像 Windows 盘符（`C:/...`）⇒ 仍是 Windows。
 */
export function targetPlatformOfPath(path: string): TargetPlatform {
  const value = path.trim()
  if (!value) return WINDOWS_PLATFORM
  if (value.includes('\\')) return WINDOWS_PLATFORM
  return /^[a-zA-Z]:[\\/]/.test(value) ? WINDOWS_PLATFORM : UNIX_PLATFORM
}

/**
 * 拼目标上的路径（分隔符取自平台，不用 `path.join` —— 那是宿主本机语义）。
 * 空段忽略，首尾多余的分隔符去掉；结果保留主路径原本的书写风格
 * （`C:\Java21` + `bin\java.exe`，而不是混成 `C:\Java21/bin\java.exe`）。
 */
export function joinTargetPath(platform: TargetPlatform, home: string, ...segments: string[]): string {
  const separator = platform.fileSeparator
  const head = home.replace(/[\\/]+$/, '')
  const tail = segments
    .map(segment => segment.replace(/^[\\/]+|[\\/]+$/g, ''))
    .filter(Boolean)
    .join(separator)
  return tail ? `${head}${separator}${tail}` : head
}
