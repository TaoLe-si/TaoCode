// 外部工具的**宏变量**与输出过滤（上游 `platform/lang-impl/src/com/intellij/ide/tools/`：
// `ToolManager`/`Tool` 里把 `$FilePath$`/`$SelectedText$` 这类宏在运行前展开成真实参数，
// `ExternalToolsGroup` 负责菜单；工具输出有 include/exclude 的过滤面）。
//
// 本仓现状：外部工具在 `src/menus/toolsMenu.ts` 与 `src/runActions.ts` 的 `runExternalTool`
// 里，参数是用户在设置里手写的**原文**，`$FilePath$` 这类宏不会被替换，输出也是整段原样贴进控制台。
// 这个模块补两件纯规则：宏展开（含 `$FileDirPathFromParent(dir)$` 这类带参宏）与输出过滤。
//
// 接线缺口（如实）：`runExternalTool` 目前只拿得到命令行字符串，宏上下文（当前文件/选区/剪贴板）
// 要由宿主在调用点组装；本模块先把展开规则与判据锁住。

/** 宏展开的上下文（拿不到的值给空串，宏会按 IDEA 口径展开成空还是保留见 `expandToolMacros`）。 */
export interface ToolMacroContext {
  /** 当前文件的工作区相对路径（`/` 分隔；没有当前文件时空）。 */
  filePath?: string
  /** 工作区根（推 `$ProjectFileDir$` 用）。 */
  projectRoot?: string
  projectName?: string
  /** 编辑器选区文本（`$SelectedText$`）。 */
  selectedText?: string
  /** 剪贴板文本（`$ClipboardContent$`）。 */
  clipboardContent?: string
  /** 光标位置（1 基；`$LineNumber$`/`$ColumnNumber$`）。 */
  line?: number
  column?: number
}

/** 宏名 → 说明（设置页的「插入宏」列表）。 */
export const TOOL_MACROS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'FilePath', description: '当前文件的工作区相对路径' },
  { name: 'FileDir', description: '当前文件所在目录' },
  { name: 'FileName', description: '当前文件名（含扩展名）' },
  { name: 'FileExt', description: '当前文件扩展名' },
  { name: 'FileNameWithoutExtension', description: '当前文件名（不含扩展名）' },
  { name: 'FileDirPathFromParent', description: '自某个祖先目录起的相对路径（带参宏）' },
  { name: 'ProjectFileDir', description: '项目根目录' },
  { name: 'ProjectName', description: '项目名' },
  { name: 'SelectedText', description: '编辑器选中文本' },
  { name: 'ClipboardContent', description: '剪贴板文本' },
  { name: 'LineNumber', description: '光标行号（1 基）' },
  { name: 'ColumnNumber', description: '光标列号（1 基）' },
]

const MACRO = /\$([A-Za-z][A-Za-z0-9]*)(?:\(([^)]*)\))?\$/g

/** 路径的各个部分（Windows 与 `/` 都吃）。 */
export function pathParts(path: string): { directory: string; fileName: string; stem: string; extension: string } {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized
  const directory = slash >= 0 ? normalized.slice(0, slash) : ''
  const dot = fileName.lastIndexOf('.')
  return {
    directory,
    fileName,
    stem: dot > 0 ? fileName.slice(0, dot) : fileName,
    extension: dot > 0 ? fileName.slice(dot + 1) : '',
  }
}

/** `$FileDirPathFromParent(src)$`：从名为 `src` 的祖先目录起，到文件所在目录的相对路径。 */
export function fileDirPathFromParent(filePath: string, parent: string): string {
  const { directory } = pathParts(filePath)
  if (!parent) return directory
  const segments = directory.split('/').filter(Boolean)
  const index = segments.lastIndexOf(parent)
  return index >= 0 ? segments.slice(index + 1).join('/') : ''
}

function macroValue(name: string, argument: string, context: ToolMacroContext): string | null {
  const filePath = context.filePath ?? ''
  const parts = pathParts(filePath)
  switch (name) {
    case 'FilePath': return filePath
    case 'FileDir': return parts.directory
    case 'FileName': return parts.fileName
    case 'FileExt': return parts.extension
    case 'FileNameWithoutExtension': return parts.stem
    case 'FileDirPathFromParent': return fileDirPathFromParent(filePath, argument)
    case 'ProjectFileDir': return context.projectRoot ?? ''
    case 'ProjectName': return context.projectName ?? ''
    case 'SelectedText': return context.selectedText ?? ''
    case 'ClipboardContent': return context.clipboardContent ?? ''
    case 'LineNumber': return context.line === undefined ? '' : String(context.line)
    case 'ColumnNumber': return context.column === undefined ? '' : String(context.column)
    default: return null
  }
}

/**
 * 展开命令里的宏（`$Name$` / `$Name(arg)$`）。
 * 未知宏**原样保留**：用户写错宏名时能看到 `$FlePath$` 还在参数里，而不是被静默吃掉。
 * 已知宏但上下文没有值 → 展开成空串（IDEA 的行为：没打开文件时 `$FilePath$` 就是空）。
 */
export function expandToolMacros(command: string, context: ToolMacroContext = {}): string {
  MACRO.lastIndex = 0
  return command.replace(MACRO, (whole, name: string, argument: string) => {
    const value = macroValue(name, argument ?? '', context)
    return value === null ? whole : value
  })
}

/** 命令里出现的宏名（设置页「检查宏」用；未知名单独标出）。 */
export function toolMacrosIn(command: string): string[] {
  const names: string[] = []
  MACRO.lastIndex = 0
  for (let match = MACRO.exec(command); match; match = MACRO.exec(command)) if (!names.includes(match[1])) names.push(match[1])
  return names
}

/** 未知宏名（对照 `TOOL_MACROS`）。 */
export function unknownToolMacros(command: string): string[] {
  const known = new Set(TOOL_MACROS.map(macro => macro.name))
  return toolMacrosIn(command).filter(name => !known.has(name))
}

/**
 * 只有命令里出现**已知宏名**时才展开。
 * 运行控制台这条通道同时承载 Gradle 任务与用户手输命令（`runInConsole`），不能对任意文本做替换；
 * 只在明确用到已知宏时展开，`echo $HOME` 这类（没有成对 `$`）本来就不命中。
 */
export function expandKnownToolMacros(command: string, context: ToolMacroContext = {}): string {
  const known = new Set(TOOL_MACROS.map(macro => macro.name))
  if (!toolMacrosIn(command).some(name => known.has(name))) return command
  return expandToolMacros(command, context)
}

export interface ToolOutputFilter {
  /** 命中即丢弃（`exclude` 优先于 `include`）。 */
  exclude?: RegExp
  /** 给了它就只有命中的行进输出。 */
  include?: RegExp
}

export interface FilteredToolOutput {
  lines: string[]
  /** 被过滤掉的行数（工具窗口状态行显示「已隐藏 N 行」）。 */
  hidden: number
}

/**
 * 输出过滤（IDEA 外部工具的 include/exclude 正则）：逐行判定，`exclude` 先赢。
 * 保留原始顺序与原文（不做 trim —— 输出里的缩进是有意义的）。
 */
export function filterToolOutput(output: string | readonly string[], filter: ToolOutputFilter = {}): FilteredToolOutput {
  const lines = typeof output === 'string' ? output.split(/\r?\n/) : [...output]
  const kept: string[] = []
  let hidden = 0
  for (const line of lines) {
    if (filter.exclude && filter.exclude.test(line)) { ++hidden; continue }
    if (filter.include && !filter.include.test(line)) { ++hidden; continue }
    kept.push(line)
  }
  return { lines: kept, hidden }
}
