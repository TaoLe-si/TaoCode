// `.editorconfig` 的解析、目录层级合并与「键 → 缩进选项」的映射。
//
// 上游落点（`plugins/editorconfig`，本树里完整在）：
//   · 文件名与「取消设置」的值 —— `backend/src/Utils.kt:45`（`.editorconfig`）、`:53`
//     （`UNSET_VALUES = ["none", "unset"]`）、`:61-64`（`configValueForKey`：trim 后，unset 一律当空串，
//     也就是「这一层不覆盖」）；
//   · 键与取值域 —— `backend/resources/schemas/editorconfig/basic.json`（`indent_size` / `indent_style`
//     / `tab_width` / `end_of_line` / `charset` / `trim_trailing_whitespace` / `insert_final_newline`
//     / `max_line_length` 八个基础键与各自的取值）；
//   · 层级查找 —— `backend/src/plugincomponents/EditorConfigPropertiesService.kt:78-82`（从文件所在目录
//     往上走）、`:84-111`（逐目录找同名文件；**坏文件直接 break**、遇到 `root = true` 也 break）、
//     `:100-103`（`isRoot` 停在这里）；
//   · 合并 —— 同文件 `:144-162`：`foldRight` + 逐 section `section.match(相对路径)`，所以
//     **离文件最近的 .editorconfig 覆盖更远的**（后者先写、前者后写）；
//   · 键 → `IndentOptions` —— `backend/src/configmanagement/EditorConfigIndentOptionsProvider.kt:113-155`
//     （`indent_size = "tab"` 折成 `tab_width` 再折成 `TAB_SIZE`；`tab_width` 缺省时取 `indent_size`；
//     `indent_style` 决定 `USE_TAB_CHARACTER`）。
//
// **如实说明两处**：
//   1. **section 头的 glob 语法无法在本树核实** —— 上游把它交给捆绑库 `org.ec4j.core`
//     （`EditorConfigPropertiesService.kt:155` 的 `section.match(...)`），本树里没有 ec4j 源码。
//     下面按 editorconfig-core 规范实现常用子集（`*` 不跨 `/`、`**` 跨、`?` 单字符、`[...]`/`[!...]`
//     字符类、`{a,b}` 择一、`{n1..n2}` 区间、**不含 `/` 的模式对任意层级目录生效**），
//     注释里逐条标明哪些是「树内无法核实」的规范行为。
//   2. 上游还有一个「读不出来就整份文件作废」的分支（`ParseException` → `InvalidEditorConfig`），
//     这里照抄成 `EditorConfigParseError` + 调用方 break；**坏文件的上层不会被继续往上找**。
//
// 消费链路：`src/codeStyleSettings.ts` 解析每份文件的生效缩进选项 → `src/semanticActions.ts` 的
// `runFormatting` 把它当 LSP `FormattingOptions` 发出去（对齐上游 `LspFormattingService.kt:119-125`）；
// `src/editorSaveTransforms.ts` 消费 `trim_trailing_whitespace` / `insert_final_newline`
// 两个键（上游 `EditorConfigTrailingSpacesOptionsProvider.kt:13-45`，保存前跑一次纯文本 pass）。

/** 配置文件名（上游 `Utils.EDITOR_CONFIG_FILE_NAME`，`Utils.kt:45`）。 */
export const EDITOR_CONFIG_FILE_NAME = '.editorconfig'

/** 「这一层不覆盖」的值（上游 `Utils.UNSET_VALUES`，`Utils.kt:53`）。 */
const UNSET_VALUES = ['none', 'unset']

export interface EditorConfigSection {
  /** section 头里的模式原文（`[*]` → `*`）。 */
  pattern: string
  /** section 内的键值，**小写键**（规范要求键大小写不敏感）。 */
  properties: Record<string, string>
}

export interface ParsedEditorConfig {
  isRoot: boolean
  sections: EditorConfigSection[]
}

/** 解析失败。上游是 ec4j 的 `ParseException` → `InvalidEditorConfig`（整份文件作废）。 */
export class EditorConfigParseError extends Error {}

const normalize = (path: string) => path.replace(/\\/g, '/')

// ---------------------------------------------------------------- section 头的 glob

/**
 * section 模式 → 正则。
 *
 * **树内无法核实的部分**（ec4j 未随树提供）：`{s1,s2}` 择一、`{n1..n2}` 区间、
 * 「模式里没有 `/` 时对任意层级目录生效」这三条规范行为；`*` 不跨 `/`、`**` 跨、`?` 单字符、
 * `[seq]` / `[!seq]` 字符类是最基本的通配，本仓按字面实现。
 * 与 `src/analysisIgnore.ts` 的 `globToRegExp` 是**两套语义**（那份是 gitignore 味的整串路径匹配，
 * 这份要匹配「相对 .editorconfig 所在目录的路径」），所以不共用。
 */
export function editorConfigPatternToRegExp(pattern: string): RegExp {
  const source = globSource(pattern)
  // 规范：模式里不含 `/` 时，`a.py` 也要匹配 `sub/dir/a.py`。
  return new RegExp(pattern.includes('/') ? `^${source}$` : `^(?:.*/)?${source}$`)
}

function globSource(pattern: string): string {
  let source = ''
  for (let index = 0; index < pattern.length; ++index) {
    const char = pattern[index]!
    if (char === '*') {
      if (pattern[index + 1] === '*') { source += '.*'; ++index } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else if (char === '[') {
      const close = findClosingBracket(pattern, index)
      // 找不到配对的 `]` 时按字面 `[` 处理。
      if (close < 0) { source += '\\['; continue }
      let body = pattern.slice(index + 1, close)
      if (body.startsWith('!')) body = '^' + body.slice(1)
      source += `[${body.replace(/\\/g, '\\\\')}]`
      index = close
    } else if (char === '{') {
      const close = pattern.indexOf('}', index)
      if (close < 0) { source += '\\{'; continue }
      const alternatives = splitTopLevel(pattern.slice(index + 1, close)).map(expandBraceRange)
      source += `(?:${alternatives.map(globSource).join('|')})`
      index = close
    } else if (char === '\\' && index + 1 < pattern.length) {
      source += escapeLiteral(pattern[index + 1]!); ++index
    } else source += escapeLiteral(char)
  }
  return source
}

function findClosingBracket(pattern: string, open: number): number {
  for (let index = open + 1; index < pattern.length; ++index) {
    if (pattern[index] === ']' && index > open + 1) return index
  }
  return -1
}

function escapeLiteral(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `{a,b}` 择一里的顶层逗号切分（嵌套的 `{}` 不算）。 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of body) {
    if (char === '{') ++depth
    if (char === '}') --depth
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += char
  }
  parts.push(current)
  return parts
}

/** `{1..5}` → `1,2,3,4,5`；不是区间就原样返回。 */
function expandBraceRange(alternative: string): string {
  const range = /^(-?\d+)\.\.(-?\d+)$/.exec(alternative)
  if (!range) return alternative
  const from = Number(range[1])
  const to = Number(range[2])
  const step = from <= to ? 1 : -1
  const values: string[] = []
  for (let value = from; step > 0 ? value <= to : value >= to; value += step) values.push(String(value))
  return `{${values.join(',')}}`
}

/** section 是否命中这个相对路径（上游 `EditorConfigSection.match`，`EditorConfigPropertiesService.kt:155`）。 */
export function editorConfigSectionMatches(pattern: string, relativePath: string): boolean {
  return editorConfigPatternToRegExp(pattern).test(normalize(relativePath))
}

// ---------------------------------------------------------------- 解析

/**
 * 解析一份 `.editorconfig`（`EditorConfigPropertiesService.kt:132-135` 的 `parseEditorConfig`）。
 * 抛 `EditorConfigParseError` 等价于上游的 `ParseException` —— 调用方把这份文件当废件并停止往上找。
 */
export function parseEditorConfig(text: string): ParsedEditorConfig {
  const sections: EditorConfigSection[] = []
  let current: EditorConfigSection | null = null
  let isRoot = false
  let inPreamble = true
  text.split(/\r?\n/).forEach((rawLine, lineNumber) => {
    const line = rawLine.trim()
    // 注释与空行在任何位置都跳过（`;` 在行首也是注释）。
    if (!line || line.startsWith('#') || line.startsWith(';')) return
    if (line.startsWith('[')) {
      if (!line.endsWith(']')) throw parseError(lineNumber, 'section 头缺少 `]`')
      current = { pattern: line.slice(1, -1).trim(), properties: {} }
      if (!current.pattern) throw parseError(lineNumber, 'section 头是空的')
      sections.push(current)
      inPreamble = false
      return
    }
    const separator = line.indexOf('=')
    if (separator < 0) throw parseError(lineNumber, '属性行缺少 `=`')
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (!key) throw parseError(lineNumber, '属性名是空的')
    // `root = true` 只在前言（第一个 section 之前）里出现，出现在 section 内按普通属性处理。
    if (inPreamble && key === 'root' && value.toLowerCase() === 'true') { isRoot = true; return }
    if (!current) throw parseError(lineNumber, '属性出现在任何 section 之前')
    current.properties[key] = value
  })
  return { isRoot, sections }
}

function parseError(lineNumber: number, message: string): EditorConfigParseError {
  return new EditorConfigParseError(`.editorconfig 第 ${lineNumber + 1} 行：${message}`)
}

// ---------------------------------------------------------------- 层级查找与合并

/** 一份参与合并的配置文件：所在目录（用于算相对路径）+ 解析结果。 */
export interface LoadedEditorConfig {
  /** `.editorconfig` 所在目录，工作区相对、已用 `/`。 */
  dir: string
  parsed: ParsedEditorConfig
}

/**
 * 从文件所在目录往上的候选目录（近 → 远），到工作区根为止（`EditorConfigPropertiesService.kt:78-82`）。
 * 上游靠 `project.getBaseDirectories()` 限定；本仓是单根工作区，根就是 `root`。
 */
export function editorConfigDirsFor(path: string, root?: string): string[] {
  const normalized = normalize(path)
  const dirs: string[] = []
  let dir = parentDir(normalized)
  const rootDir = root === undefined ? '' : normalize(root).replace(/\/+$/, '')
  for (;;) {
    if (rootDir && dir === rootDir) { dirs.push(dir); break }
    // 工作区根本身**要**进列表（它就是最外层那份 `.editorconfig` 所在目录），所以先 push 再收口。
    dirs.push(dir)
    if (!dir) break
    dir = parentDir(dir)
  }
  return dirs
}

/**
 * 去掉最后一段。**没有** `/` 时结果是 `''`（不是 `slice(0, -1)` 那种砍掉末字符的写法 ——
 * `'src'.slice(0, -1)` 会得到 `'sr'`，那正是这条函数的 bug）。
 */
function parentDir(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/**
 * 沿候选目录找 `.editorconfig`：**第一个坏文件或 `root = true` 就停**（`EditorConfigPropertiesService.kt:84-111`）。
 * `read` 返回 `null` 表示该目录没有这份文件。
 */
export function relevantEditorConfigsFor(
  path: string,
  read: (dir: string) => ParsedEditorConfig | null,
  root?: string,
): LoadedEditorConfig[] {
  const result: LoadedEditorConfig[] = []
  for (const dir of editorConfigDirsFor(path, root)) {
    let parsed: ParsedEditorConfig | null
    try {
      parsed = read(dir)
    } catch {
      break  // 坏文件：上游 `is InvalidEditorConfig -> break`，不再往上找
    }
    if (!parsed) continue
    result.push({ dir, parsed })
    if (parsed.isRoot) break
  }
  return result
}

/**
 * 合并成一份生效属性（`EditorConfigPropertiesService.kt:144-162`）。
 * **离文件最近的赢**：远层先写、近层后写覆盖；同一个文件里后面的 section 覆盖前面的。
 */
export function mergeEditorConfigs(path: string, configs: readonly LoadedEditorConfig[]): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const { dir, parsed } of configs) {
    if (!relativeTo(dir, path)) continue
    const relative = relativeTo(dir, path)!
    for (const section of parsed.sections) {
      if (!editorConfigSectionMatches(section.pattern, relative)) continue
      for (const [key, value] of Object.entries(section.properties)) merged[key] = value
    }
  }
  return merged
}

/** `FileUtil.getRelativePath(dir, path, '/')`（`EditorConfigPropertiesService.kt:148-153`）。 */
function relativeTo(dir: string, path: string): string | null {
  const from = normalize(dir).replace(/\/+$/, '')
  const to = normalize(path)
  // 根目录那一层 `dir` 是空串（见 `editorConfigDirsFor`）：路径本来就以工作区根为基准，
  // 相对根的相对路径就是它自己。少了这一条，**根那份 `.editorconfig` 永远匹配不到任何 section**。
  if (!from) return to
  if (to.startsWith(`${from}/`)) return to.slice(from.length + 1)
  if (from === to) return ''
  return null
}

/** `Utils.configValueForKey`（`Utils.kt:61-64`）：trim；`none`/`unset` 一律当空串（这一层不覆盖）。 */
export function configValueForKey(properties: Record<string, string>, key: string): string {
  const value = properties[key]?.trim() ?? ''
  return UNSET_VALUES.includes(value.toLowerCase()) ? '' : value
}

// ---------------------------------------------------------------- 键 → 缩进选项

/** 本仓能兑现的那三个缩进字段（上游 `CommonCodeStyleSettings.IndentOptions` 的对应项，见 codeStyleSettings.ts）。 */
export interface EditorConfigIndentDelta {
  indentSize?: number
  continuationIndentSize?: number
  tabSize?: number
  useTabCharacter?: boolean
}

/**
 * `EditorConfigIndentOptionsProvider.applyIndentOptions`（`:71-155`）的等价物：
 * 四个键各自算一遍，谁算得出就覆盖谁（`:78-109` 的四个独立 if），**一条都没算得出就返回空对象**
 * （对应上游 `:64-68` 的 `return null` —— 不覆盖任何语言默认值）。
 */
export function indentOptionsFromEditorConfig(
  properties: Record<string, string>,
  base: { tabSize: number },
): EditorConfigIndentDelta {
  const delta: EditorConfigIndentDelta = {}
  const indentSize = configValueForKey(properties, 'indent_size')
  const continuationSize = configValueForKey(properties, 'continuation_indent_size')
  const tabWidth = configValueForKey(properties, 'tab_width')
  const indentStyle = configValueForKey(properties, 'indent_style')

  // `calculateIndentSize`（:113-115）："tab" 折成 tab_width，再折成既有 TAB_SIZE。
  const calculatedIndentSize = indentSize === 'tab' ? (tabWidth || String(base.tabSize)) : indentSize
  // `calculateContinuationIndentSize`（:117-118）：缺省继承 indent_size 算出来的那个值。
  const calculatedContinuationSize = continuationSize || calculatedIndentSize
  // `calculateTabWidth`（:120-129）。
  const calculatedTabWidth = !tabWidth && indentSize === 'tab' ? ''
    : tabWidth || indentSize

  const indent = toPositiveInt(calculatedIndentSize)
  if (indent !== null) delta.indentSize = indent
  const continuation = toPositiveInt(calculatedContinuationSize)
  if (continuation !== null) delta.continuationIndentSize = continuation
  const tab = toPositiveInt(calculatedTabWidth)
  if (tab !== null) delta.tabSize = tab
  // `applyIndentStyle`（:149-155）：只有 "tab" / "space" 算得出，其它值算不出（走 `invalidConfigMessage`）。
  if (indentStyle === 'tab' || indentStyle === 'space') delta.useTabCharacter = indentStyle === 'tab'
  return delta
}

/** `toIntOrNull` + 正数校验（`applyIndentSize` 等三个 apply*，`EditorConfigIndentOptionsProvider.kt:131-147`）。 */
function toPositiveInt(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return parsed > 0 ? parsed : null
}

/** 这些键本仓**没有**落点（`basic.json` 里在册，但 LSP 兑现不了 / 宿主没有通道）。报告里如实登记。
 *
 * `trim_trailing_whitespace` 与 `insert_final_newline` **已经不在这一列**：2026-10-06 起
 * 由 `src/editorSaveTransforms.ts` 的 `editorConfigSaveOverrides` 真实消费（保存前的纯文本 pass），
 * 判据在 `docs/batch-2026-10-06-saveops.md`。
 */
export const EDITOR_CONFIG_KEYS_WITHOUT_CONSUMER = [
  'end_of_line',           // basic.json:59-83 —— 行尾在 pf/vfs 域（src/editorFileOps.ts），不在格式化请求里
  'charset',               // basic.json:85-123 —— 编码在 pf/vfs 域（src/sessionEncodings.ts）
  'max_line_length',       // basic.json:160-174 —— 硬换行需要本地格式化模型，本仓不建
] as const

/**
 * 路径是不是**这一份 `.editorconfig` 本身**（`Utils.isEditorConfigName` / `isEditorConfigFile`，
 * `plugins/editorconfig/backend/src/Utils.kt:243-247`：文件名大小写不敏感）。
 * 上游用它挡掉「配置文件对自己生效」—— 保存 pass 与缩进解析都读这一份。
 */
export function isEditorConfigPath(path: string): boolean {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  return name.toLowerCase() === EDITOR_CONFIG_FILE_NAME
}
