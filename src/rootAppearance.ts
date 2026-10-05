// 根 / SDK 的**呈现模型** —— 上游 `platform-impl/openapi/roots/ui` 那一族在 DOM 里的等价物。
//
// 逐条对照（上游路径都在 platform/platform-impl/src/com/intellij/openapi/roots/）：
//   · `ui/FileAppearanceServiceImpl.java:38-80` —— `forVirtualFile`：坏了 → `forInvalidUrl`；
//     二进制 → 二进制外观；目录 → 目录外观；其余 → `ValidFileCellAppearance`；
//     `forIoFile` 则按"文件在不在"分。`forInvalidUrl` 是错误态（红字 + 说明）。
//   · `ui/util/ValidFileCellAppearance.java:34-35` —— 图标来自文件类型；
//     `ui/util/JarSubfileCellAppearance.java:18-19` —— jar 里的路径用归档图标；
//     `ui/util/HttpUrlCellAppearance.java:17` —— http(s) 用 URL 图标。
//   · `ui/SdkAppearanceServiceImpl` —— SDK 行的名字/图标/注释（"Project SDK" 那一行）。
//   · `ui/configuration/SidePanelCountLabel.java` —— 侧栏条目的计数标签（计数 + 上限提示）；
//     `ui/configuration/SidePanelSeparator.java` —— 分组标题之间的分隔条（带标题与可见性）。
//   · `ProjectRootUtil` —— 根的展示顺序（内容根先、再按路径），本模块给纯函数。
//
// 消费链路：`src/components/ProjectStructurePane.vue` 的项目结构面板 —— SDK 行的说明走
// `sdkAppearance`、内容根行的标题/计数走 `rootRowAppearance`/`sidePanelCountLabel`。
// Swing 组件本体（`SidePanel`/`ProjectRootsConfigurable` 等）不在移植范围，行为由这个 DOM 面板承担。

/** 一次呈现的"图标种类"（DOM 侧没有 IntelliJ 图标表，用语义种类 + `src/uiIcons` 的映射）。 */
export type RootAppearanceKind = 'directory' | 'binary' | 'validFile' | 'jarSubfile' | 'httpUrl' | 'invalid'

export interface CellAppearance {
  kind: RootAppearanceKind
  /** 图标语义名（渲染层按它选图标；与上游 `FileType.getIcon` 的位置对应）。 */
  icon: RootAppearanceKind
  /** 显示文本（路径/URL 原样）。 */
  label: string
  /** 灰字注释（大小、状态、归档内路径…）。 */
  comment: string
  /** 错误态（上游 `forInvalidUrl` 的红色）：渲染层据此上色。 */
  error: boolean
  tooltip: string
}

/** `FileUtil.formatFileSize` 的等价物：字节 → 人读文本（保留一位小数）。 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/** `jar://…!/inner` 或 `x.jar!/inner` 的拆解（拿不到内部路径时返回 null）。 */
export function splitJarSubfile(path: string): { archive: string; inner: string } | null {
  const bang = path.indexOf('!/')
  if (bang <= 0) return null
  const archive = path.slice(0, bang).replace(/^jar:\/\//i, '')
  const inner = path.slice(bang + 2)
  if (!archive || !inner) return null
  return { archive, inner }
}

/**
 * `JarSubfileCellAppearance`：jar 内条目的外观。`null` = 这个路径不是 jar 子文件
 * （调用方继续往下判，与上游"先 `file.getFileSystem()` 是不是 `ArchiveFileSystem`"同一分工）。
 */
export function jarSubfileAppearance(path: string): CellAppearance | null {
  const split = splitJarSubfile(path)
  if (!split) return null
  return {
    kind: 'jarSubfile',
    icon: 'jarSubfile',
    label: path,
    comment: split.inner,
    error: false,
    tooltip: `归档 ${split.archive} 中的 ${split.inner}`,
  }
}

/** `HttpUrlCellAppearance`：http/https 外观；`null` = 不是 URL。 */
export function httpUrlAppearance(value: string): CellAppearance | null {
  if (!/^https?:\/\//i.test(value)) return null
  const withoutScheme = value.replace(/^https?:\/\//i, '')
  const host = withoutScheme.split(/[/?#]/)[0]
  return {
    kind: 'httpUrl',
    icon: 'httpUrl',
    label: value,
    comment: host,
    error: false,
    tooltip: `HTTP 地址：${host}`,
  }
}

/** `FileAppearanceServiceImpl.forInvalidUrl`：坏了/不存在的路径是错误态（红字 + 说明）。 */
export function invalidUrlAppearance(text: string, reason = '路径不存在或无法解析'): CellAppearance {
  return { kind: 'invalid', icon: 'invalid', label: text, comment: reason, error: true, tooltip: `${text}：${reason}` }
}

export interface FileAppearanceOptions {
  exists?: boolean
  directory?: boolean
  binary?: boolean
  size?: number
  /** 文件所属作用域（源根/排除目录，由项目结构面板给）：排除的给灰字说明。 */
  excluded?: boolean
}

/**
 * `FileAppearanceServiceImpl.forVirtualFile`/`forIoFile` 的判定顺序：
 * jar 子文件 → http URL → 不存在（错误态）→ 目录 → 二进制 → 普通文件。
 * `exists` 缺省按"未知"处理（不给不存在的红字，避免把没查过的路径报成坏路径）。
 */
export function fileAppearance(path: string, options: FileAppearanceOptions = {}): CellAppearance {
  const jar = jarSubfileAppearance(path)
  if (jar) return jar
  const url = httpUrlAppearance(path)
  if (url) return url
  if (options.exists === false) {
    return invalidUrlAppearance(path, options.excluded ? '已被排除，磁盘上不存在' : '磁盘上不存在')
  }
  const parts: string[] = []
  if (options.directory) parts.push('目录')
  if (options.binary) parts.push('二进制文件')
  if (typeof options.size === 'number' && !options.directory) parts.push(formatFileSize(options.size))
  if (options.excluded) parts.push('已排除')
  const icon: RootAppearanceKind = options.directory ? 'directory' : options.binary ? 'binary' : 'validFile'
  return {
    kind: icon,
    icon,
    label: path,
    comment: parts.join(' · '),
    error: false,
    tooltip: parts.length ? `${path}（${parts.join('，')}）` : path,
  }
}

/** 面板里统一入口：先按 jar/http 特判，再按文件判断（与 `FileAppearanceServiceImpl` 的分派同序）。 */
export function pathCellAppearance(value: string, options: FileAppearanceOptions = {}): CellAppearance {
  return fileAppearance(value, options)
}

// ── `SdkAppearanceServiceImpl`：SDK 行的呈现 ─────────────────────────────────────────────

export interface SdkAppearance {
  /** SDK 的显示名（上游 `Sdk.getName`；留空用语言服务的检测结果）。 */
  label: string
  icon: 'sdk' | 'sdkMissing'
  /** 灰字说明（路径 / 语言级别 / 来源）。 */
  comment: string
  tooltip: string
  /** 系统检测（未配置路径）还是用户配置。 */
  detected: boolean
}

/**
 * `SdkAppearanceServiceImpl` 的行外观：没配路径 = 「SDK 默认（语言服务检测）」；
 * 配了但不像绝对路径 = 错误态由调用方判（这里只如实给 detected 标记）。
 */
export function sdkAppearance(jdkHome: string, jdkName: string): SdkAppearance {
  const home = jdkHome.trim()
  if (!home) {
    return {
      label: 'SDK 默认',
      icon: 'sdk',
      comment: '由语言服务自动检测的 JDK',
      tooltip: '未指定 JDK 路径：使用语言服务器自动检测的 JDK',
      detected: true,
    }
  }
  const level = jdkName.trim() ? `语言级别 ${jdkName.replace(/^JavaSE-/, '').replace(/^1\.(\d+)$/, '$1')}` : ''
  return {
    label: '项目 SDK',
    icon: 'sdk',
    comment: [home, level].filter(Boolean).join(' · '),
    tooltip: `项目 SDK：${home}${level ? `（${level}）` : ''}`,
    detected: false,
  }
}

// ── `SidePanelCountLabel` / `SidePanelSeparator` ────────────────────────────────────────

/**
 * `SidePanelCountLabel` 的文本与提示：只给计数；给了上限时超出用 `count / limit`
 * （上游把超出上限渲染成警示色，文本仍只是数字 —— 这里保留 same 语义的 `overflow` 标记）。
 */
export function sidePanelCountLabel(count: number, limit?: number): { text: string; overflow: boolean; tooltip: string } {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  const bounded = typeof limit === 'number' && limit > 0
  const overflow = bounded && safe > limit
  return {
    text: overflow ? `${safe} / ${limit}` : String(safe),
    overflow,
    tooltip: overflow ? `${safe} 项，已超出上限 ${limit}` : `${safe} 项`,
  }
}

/** `SidePanelSeparator`：一个带标题的分隔（标题空 = 纯分隔线；`visible` 由调用方按条目数决定）。 */
export function sidePanelSeparator(title: string, visible = true): { title: string; visible: boolean } {
  return { title: title.trim(), visible }
}

// ── 根的呈现（`ProjectRootUtil` 的顺序 + 逐根的计数标签）────────────────────────────────

export interface RootRowInput {
  path: string
  kind: string
  fileCount: number
  missing: boolean
  excludedBy?: string | null
}

export interface RootRowAppearance {
  label: string
  icon: RootAppearanceKind
  /** 计数标签（`SourceRootStatus.fileCount` → `SidePanelCountLabel`）。 */
  count: string
  /** 灰字注释（类型 / 状态）。 */
  comment: string
  tone: 'normal' | 'warning' | 'error'
  tooltip: string
}

/**
 * 内容根行的呈现：类型标签 + 文件计数 + 告警态（不存在 = error，踩进排除目录 = warning），
 * 对应上游把根渲染进 `ContentEntryTreeEditor` 时逐节点带的图标/计数/告警。
 */
export function rootRowAppearance(root: RootRowInput): RootRowAppearance {
  const count = sidePanelCountLabel(root.fileCount)
  const comment = root.excludedBy ? `位于被排除的目录「${root.excludedBy}」中` : root.missing ? '磁盘上不存在' : `${count.text} 个文件`
  const tone: RootRowAppearance['tone'] = root.missing ? 'error' : root.excludedBy ? 'warning' : 'normal'
  return {
    label: root.path,
    icon: 'directory',
    count: count.text,
    comment,
    tone,
    tooltip: `${root.path}：${comment}`,
  }
}

/**
 * `ProjectRootUtil` 在 Swing 侧还负责根集合的合并与排序（内容根先、再按路径）。
 * 本仓面板按用户列表顺序渲染（根顺序在存储里就是用户顺序），所以这里只给一个可复算的
 * "展示顺序"纯函数：告警态（不存在 → 踩进排除目录 → 正常）在前的稳定排序 ——
 * 检测出来的建议根列表用它把最需要处理的排在前面。
 */
export function orderRootRows<T extends RootRowInput>(roots: readonly T[]): T[] {
  const rank = (root: T) => root.missing ? 2 : root.excludedBy ? 1 : 0
  return [...roots].sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
