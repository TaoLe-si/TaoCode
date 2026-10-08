// 路径宏表与展开算法 —— 上游 `PathMacros` 一族的 DOM/宿主侧等价物。
//
// 上游分层（本仓逐条对照，来源树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 接口 `platform/core-api/src/com/intellij/openapi/application/PathMacros.java:21-53`
//     （`getUserMacros()`/`getSystemMacroNames()`/`getIgnoredMacroNames()`/`getLegacyMacroNames()`）。
//   · 实现 `platform/projectModel-impl/src/com/intellij/application/options/PathMacrosImpl.kt`
//     —— `:64-71` 是**系统宏名**集合（6 个）；`:186-233` 的 `loadState` 是那份用户自定义宏表的真实形状。
//   · 宏名常量 `jps/model-serialization/src/org/jetbrains/jps/model/serialization/PathMacroUtil.java`
//     —— 每个内置宏名一个常量，值来自 `PathManager` / `SystemProperties` / 项目与模块。
//   · 展开算法 `jps/model-serialization/src/com/intellij/openapi/components/ExpandMacroToPathMap.java`
//     —— 两条通道：`myPlainMap` 字面替换（`:47-51`）与 `myMacroExpands` 的 `$名字$` 替换（`:53-55`）。
//   · 宏名合法字符集 `platform/projectModel-impl/src/com/intellij/application/options/PathMacrosCollector.kt:25`
//     （`MACRO_PATTERN = Pattern.compile("\\$([\\w\\-.]+?)\\$")`）。
//   · 设置页（`preferences.pathVariables`）`platform/platform-impl/src/com/intellij/application/options/pathMacros/`
//     整个目录：`PathMacroConfigurable.java`（注册见 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:776-780`）、
//     `PathMacroTable.java`（表的形状与提交规则）、`PathMacroListEditor.java`（忽略变量）、
//     `PathMacroEditor.kt`（单条编辑对话框）。
//
// 本仓差异（如实）：状态由宿主持有、前端没有 `PathMacrosImpl` 服务，所以这里落的是
// **宏表模型 + 展开算法 + 表规则**的纯函数（零 import ⇒ 可单测）；持久化通道与设置页是接线请求。

/** 一个内置宏：名字、语义、取值来源、是否系统宏（系统宏用户不能重定义/删除）。 */
export interface PathMacroDefinition {
  /** 宏名（不含两侧 `$`）。 */
  name: string
  /** 语义（本仓设置页/提示用）。 */
  description: string
  /** 上游宏名常量的声明位置（相对路径:行号）。 */
  upstream: string
  /** 取值来源（相对路径:行号）。 */
  source: string
  /** 是否 `PathMacrosImpl.SYSTEM_MACROS`（`PathMacrosImpl.kt:64-71`）的成员。 */
  system: boolean
}

/**
 * `PathMacrosImpl.SYSTEM_MACROS`（`PathMacrosImpl.kt:64-71`）逐字：6 个名字。
 * 注意 `APPLICATION_CONFIG_DIR`（`PathMacroUtil.java:32`）与 `PROJECT_NAME`（`:20`）
 * **不在**这个集合里 —— 它们能展开，但用户可以拿同名自定义宏覆盖。
 */
export const SYSTEM_MACRO_NAMES: readonly string[] = [
  'APPLICATION_HOME_DIR',
  'APPLICATION_PLUGINS_DIR',
  'PROJECT_DIR',
  'MODULE_WORKING_DIR',
  'MODULE_DIR',
  'USER_HOME',
]

/** 内置宏清单（每个名字一个上游常量，见 `PathMacroUtil.java`）。 */
export const PATH_MACRO_DEFINITIONS: readonly PathMacroDefinition[] = [
  {
    name: 'PROJECT_DIR',
    description: '项目基础目录（.idea 所在目录）',
    upstream: 'PathMacroUtil.java:19',
    source: 'ProjectPathMacroManager.kt:41,53（`basePathPointer()` = 项目的 historicalProjectBasePath / basePath）',
    system: true,
  },
  {
    name: 'PROJECT_NAME',
    description: '项目名（默认项目没有名字，不注册）',
    upstream: 'PathMacroUtil.java:20',
    source: 'ProjectPathMacroManager.kt:42（`project.name`，`namePointer` 在 `isDefault` 时为 null）',
    system: false,
  },
  {
    name: 'MODULE_DIR',
    description: '模块目录（.iml 所在目录；.iml 在 .idea 下时取其父目录）',
    upstream: 'PathMacroUtil.java:22',
    source: 'ModulePathMacroManager.java:44 → PathMacroUtil.getModuleDir(:42-60)',
    system: true,
  },
  {
    name: 'MODULE_WORKING_DIR',
    description: '运行配置工作目录的占位符（解析时才换成模块/项目目录）',
    upstream: 'PathMacroUtil.java:26',
    source: 'ProgramParametersConfigurator.java:201-209（模块目录优先，其次项目目录）',
    system: true,
  },
  {
    name: 'APPLICATION_HOME_DIR',
    description: 'IDE 安装目录',
    upstream: 'PathMacroUtil.java:31',
    source: 'PathMacroUtil.java:99（`PathManager.getHomePath()`，正斜杠归一）',
    system: true,
  },
  {
    name: 'APPLICATION_CONFIG_DIR',
    description: 'IDE 配置目录',
    upstream: 'PathMacroUtil.java:32',
    source: 'PathMacroUtil.java:100（`PathManager.getConfigPath()`）',
    system: false,
  },
  {
    name: 'APPLICATION_PLUGINS_DIR',
    description: 'IDE 插件目录',
    upstream: 'PathMacroUtil.java:33',
    source: 'PathMacroUtil.java:101（`PathManager.getPluginsPath()`）',
    system: true,
  },
  {
    name: 'USER_HOME',
    description: '用户主目录',
    upstream: 'PathMacroUtil.java:34',
    source: 'PathMacroUtil.java:106-108（`SystemProperties.getUserHome()`，去掉末尾 `/`）',
    system: true,
  },
  {
    name: 'MAVEN_REPOSITORY',
    description: 'Maven 本地仓库（由 contributor 注册，非系统宏）',
    upstream: 'PathMacrosImpl.kt:61',
    source: 'MavenPathMacroContributor.java:18-19 / JpsMavenHomePathMacroContributor.java:12-18',
    system: false,
  },
]

/** 按名字取内置宏定义。 */
export function pathMacroDefinition(name: string): PathMacroDefinition | undefined {
  return PATH_MACRO_DEFINITIONS.find(definition => definition.name === name)
}

/**
 * `PathMacrosCollector.MACRO_PATTERN`（`PathMacrosCollector.kt:25`）：
 * `\$([\w\-.]+?)\$`，Java 默认 `\w` 是 ASCII ⇒ 合法字符集 = `[A-Za-z0-9_.-]`，且**非空**。
 */
export const PATH_MACRO_NAME_CHARACTER = /[A-Za-z0-9_.-]/

/** 整串名字是否是语法合法的宏名（`AddValidator.checkName` 的判据）。 */
export function isValidPathMacroName(name: string): boolean {
  return name.length > 0 && [...name].every(character => PATH_MACRO_NAME_CHARACTER.test(character))
}

/**
 * `PathMacroTable.AddValidator.checkName`（`PathMacroTable.java:244-247`）+
 * `EditValidator.checkName`（`:262-269`）+ `hasMacroWithName`（`:131-142`）：
 * 空名、非法字符、系统宏名、重名一律拒绝。返回空串表示合法。
 */
export function pathMacroNameError(name: string, existing: readonly string[] = [], systemNames: readonly string[] = SYSTEM_MACRO_NAMES): string {
  if (!name) return '变量名不能为空。'
  if (!isValidPathMacroName(name)) return '变量名只能包含字母、数字、下划线、连字符与句点。'
  if (systemNames.includes(name)) return `「${name}」是内置变量名，不能覆盖。`
  if (existing.includes(name)) return `已经有名为 ${name} 的变量了。`
  return ''
}

/** 一个宏取值对（上游是 `Couple<String>` / `Pair<String,String>`）。 */
export interface PathMacroPair {
  name: string
  value: string
}

/**
 * 展开用的宏上下文。取不到的值省略 —— 与上游「全局系统宏一定有值、
 * 项目/模块宏在没有项目/模块时不注册」同口径：省略即不注册，文本里的宏**原样保留**。
 */
export interface PathMacroContext {
  /** `$PROJECT_DIR$`。 */
  projectDir?: string
  /** `$PROJECT_NAME$`。 */
  projectName?: string
  /** `$MODULE_DIR$`。 */
  moduleDir?: string
  /** `$USER_HOME$`。 */
  userHome?: string
  /** `$APPLICATION_HOME_DIR$`。 */
  applicationHomeDir?: string
  /** `$APPLICATION_CONFIG_DIR$`。 */
  applicationConfigDir?: string
  /** `$APPLICATION_PLUGINS_DIR$`。 */
  applicationPluginsDir?: string
  /** 其余由 contributor 注册的宏（如 `MAVEN_REPOSITORY`）。 */
  contributed?: Readonly<Record<string, string>>
}

/**
 * 展开表 —— 上游 `ExpandMacroToPathMap` 的**两条通道**：
 *   · `plain`：`myPlainMap`，字面替换（`ExpandMacroToPathMap.java:47-51`），键是完整文本如 `$MODULE_DIR$/..`；
 *   · `expands`：`myMacroExpands`，键是**裸宏名**，走 `replaceMacro` 的 `$名字$` 边界匹配（`:53-55`）。
 * 顺序有语义（`LinkedHashMap` / 递归注册顺序），所以用数组不用 Map。
 */
export interface PathMacroTable {
  plain: Array<[string, string]>
  expands: Array<[string, string]>
}

/** 正斜杠归一（`FileUtilRt.toSystemIndependentName`，`FileUtilRt.java:367-369`）。 */
export function toSystemIndependentPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** 平台分隔符（`File.separatorChar`）。 */
export const NATIVE_SEPARATOR: string = typeof process !== 'undefined' && process.platform === 'win32' ? '\\' : '/'

/** 去尾斜杠（`Strings.trimEnd(path, "/")`）。 */
export function trimTrailingSlashes(path: string): string {
  let end = path.length
  while (end > 0 && path.charAt(end - 1) === '/') end--
  return path.slice(0, end)
}

/**
 * 取父路径（`PathUtilRt.getParentPath`，`PathUtilRt.java:61-64` + `:72-93`）：
 * 去掉最后一段；已是根（`/`、`C:/`、`//host`）时返回空串。
 * 目录穿越（`..`）不解析 —— 与上游注释一致。
 */
export function parentPath(path: string): string {
  if (!path) return ''
  let end = lastSeparatorIndex(path, path.length - 1)
  if (end === path.length - 1 && end >= 1) end = lastSeparatorIndex(path, end - 1)
  if (end === -1 || end === 0) return ''
  if (isUncRoot(path, end)) return ''
  const previous = path.charAt(end - 1)
  if (previous === '/' || previous === '\\') end--
  return path.slice(0, end)
}

function lastSeparatorIndex(text: string, endInclusive: number): number {
  for (let index = endInclusive; index >= 0; index--) {
    const character = text.charAt(index)
    if (character === '/' || character === '\\') return index
  }
  return -1
}

/** `//host` 是根（`PathUtilRt.isWindowsUNCRoot` + `hasFileSeparatorsOrNavigatableDots`）。 */
function isUncRoot(path: string, lastPathSeparatorPosition: number): boolean {
  if (path.length <= 1 || path.charAt(0) !== '/' || path.charAt(1) !== '/') return false
  if (lastPathSeparatorPosition < 1) return false
  for (let index = lastPathSeparatorPosition - 1; index >= 2; index--) {
    const character = path.charAt(index)
    if (character === '/' || character === '\\') return false
    if (character === '.' && (index === 2 || (index === 3 && path.charAt(2) === '.'))) return false
  }
  return true
}

/**
 * `PathMacroManager.addFileHierarchyReplacements(ExpandMacroToPathMap, ...)`
 * （`PathMacroManager.kt:114-126`，递归实现 `:120-126`）：为一条路径注册
 * `$M$/../..`、`$M$/..`，**最后**才是 `$M$` 本身（都走 plain 通道的 `put`）。
 * 例：`/proj/module` → `[["$MODULE_DIR$/..","/proj"], ["$MODULE_DIR$","/proj/module"]]`。
 */
export function fileHierarchyMacroReplacements(macroName: string, path: string | undefined): Array<[string, string]> {
  if (path === undefined) return []
  const normalized = trimTrailingSlashes(toSystemIndependentPath(path))
  const ancestors: Array<[string, string]> = []
  let cursor = normalized
  let expression = `$${macroName}$`
  for (;;) {
    const parent = parentPath(cursor)
    if (parent === '') break
    expression = `${expression}/..`
    ancestors.unshift([expression, parent])
    cursor = parent
  }
  return [...ancestors, [`$${macroName}$`, normalized]]
}

/**
 * `PathMacroUtil.getGlobalSystemMacros`（`PathMacroUtil.java:97-104`）：四个**全局系统宏**，
 * 与项目无关。注册顺序照 `computeGlobalPathMacrosInsideIde`（`:98-103`），走 expands 通道。
 */
export function globalSystemPathMacros(context: PathMacroContext): Array<[string, string]> {
  const macros: Array<[string, string]> = []
  const push = (name: string, value: string | undefined) => {
    if (value !== undefined) macros.push([name, toSystemIndependentPath(value)])
  }
  push('APPLICATION_HOME_DIR', context.applicationHomeDir)
  push('APPLICATION_CONFIG_DIR', context.applicationConfigDir)
  push('APPLICATION_PLUGINS_DIR', context.applicationPluginsDir)
  push('USER_HOME', context.userHome)
  return macros
}

/**
 * `ProjectPathMacroManager.expandMacroMap`（`ProjectPathMacroManager.kt:38-49`）：
 * `$PROJECT_DIR$`（plain，含层级 `..`）→ `$PROJECT_NAME$`（expands）→ 项目级 contributor 的宏。
 */
export function projectPathMacroTable(context: PathMacroContext): PathMacroTable {
  const table: PathMacroTable = { plain: fileHierarchyMacroReplacements('PROJECT_DIR', context.projectDir), expands: [] }
  if (context.projectName !== undefined) table.expands.push(['PROJECT_NAME', context.projectName])
  for (const [name, value] of Object.entries(context.contributed ?? {})) table.expands.push([name, toSystemIndependentPath(value)])
  return table
}

/**
 * `ModulePathMacroManager.getExpandMacroMap`（`ModulePathMacroManager.java:41-52`）：
 * `$MODULE_DIR$`（plain，含层级 `..`）。
 * ⚠️ `$MODULE_WORKING_DIR$` **不在这里注册** —— 它由运行配置的工作目录解析处理
 * （`resolveModuleWorkingDir`），`PathMacroManager` 里没有任何 `addMacroExpand(MODULE_WORKING_DIR, ...)`。
 */
export function modulePathMacroTable(context: PathMacroContext): PathMacroTable {
  return { plain: fileHierarchyMacroReplacements('MODULE_DIR', context.moduleDir), expands: [] }
}

/**
 * 展开时用的完整宏表，注册顺序照 `PathMacroManager.expandMacroMap`
 * （`PathMacroManager.kt:33-41`：用户宏 → 全局系统宏）再叠两个子类的 `super` 链：
 * **用户宏 → 全局系统宏 → 项目宏 → 模块宏**。
 * （上游 `myMacroExpands` 是 `HashMap`、顺序不定；这里固定成这条链，因为顺序会影响嵌套展开的结果。）
 */
export function pathMacroTable(context: PathMacroContext, userMacros: readonly PathMacroPair[] = []): PathMacroTable {
  const project = projectPathMacroTable(context)
  const module = modulePathMacroTable(context)
  return {
    plain: [...project.plain, ...module.plain],
    expands: [
      ...userMacros.map((pair): [string, string] => [pair.name, toSystemIndependentPath(pair.value)]),
      ...globalSystemPathMacros(context),
      ...project.expands,
      ...module.expands,
    ],
  }
}

/** 表里定义过的宏名（plain 键里出现的 `$名字$` + expands 的裸名），供「未知宏」判据用。 */
export function definedPathMacroNames(table: PathMacroTable): string[] {
  const names: string[] = []
  for (const [from] of table.plain) for (const use of pathMacroUses(from)) if (!names.includes(use.name)) names.push(use.name)
  for (const [name] of table.expands) if (!names.includes(name)) names.push(name)
  return names
}

/**
 * `$MODULE_WORKING_DIR$` 的解析（`ProgramParametersConfigurator.java:201-209`）：
 * 先把废弃的 `$MODULE_DIR$` 换成 `$MODULE_WORKING_DIR$`（`:201-202`），再按
 * **模块目录优先、其次项目目录** 替换（`:204-209`）。两者都没有时原样保留。
 */
export function resolveModuleWorkingDir(workingDirectory: string, moduleDir: string | undefined, projectDir: string | undefined): string {
  const normalized = workingDirectory.split('$MODULE_DIR$').join('$MODULE_WORKING_DIR$')
  if (!normalized.includes('$MODULE_WORKING_DIR$')) return normalized
  const replacement = moduleDir ?? projectDir
  if (replacement === undefined) return normalized
  return normalized.split('$MODULE_WORKING_DIR$').join(toSystemIndependentPath(replacement))
}

/** `ExpandMacroToPathMap.findMacroIndex`（`ExpandMacroToPathMap.java:79-90`）：大小写敏感、`$名字$` 边界精确。 */
function findMacroIndex(text: string, macroName: string): number {
  let index = -1
  for (;;) {
    index = text.indexOf('$', index + 1)
    if (index < 0) return -1
    if (text.startsWith(macroName, index + 1) && text.charAt(index + macroName.length + 1) === '$') return index
  }
}

/** `ExpandMacroToPathMap.getSlashCount`（`ExpandMacroToPathMap.java:75-77`）：0/1/2。 */
function slashCountAt(text: string, position: number): number {
  if (text.charAt(position) !== '/') return 0
  return text.charAt(position + 1) === '/' ? 2 : 1
}

/**
 * `ExpandMacroToPathMap.replaceMacro`（`ExpandMacroToPathMap.java:60-73`）：
 * 替换**全部**出现处；宏后面的 1~2 个 `/` 一起吃掉，若替换值本身不以 `/` 结尾则补一个
 * （所以 `$PROJECT_DIR$/src` 得到 `/proj/src` 而不是 `/proj//src`）。
 */
function replaceMacro(text: string, macroName: string, replacement: string): string {
  let result = text
  for (;;) {
    const start = findMacroIndex(result, macroName)
    if (start < 0) return result
    const end = start + macroName.length + 2
    const slashes = slashCountAt(result, end)
    const actual = slashes > 0 && !replacement.endsWith('/') ? `${replacement}/` : replacement
    const next = result.slice(0, start) + actual + result.slice(end + slashes)
    // 替换值里含同名宏时上游会死循环（真实宏表不会出现）；这里按「文本没变就停」收口。
    if (next === result) return result
    result = next
  }
}

/** `StringUtil.replace(text, old, new, false)`（`StringUtil.java:172-201`）：字面全量替换、大小写敏感。 */
function literalReplace(text: string, from: string, to: string): string {
  if (!from) return text
  return text.split(from).join(to)
}

/**
 * 展开路径里的宏（`PathMacroManager.expandPath` → `ExpandMacroToPathMap.substitute`）。
 * 逐条照抄上游：
 *   1. `ExpandMacroToPathMap.java:43-45`：文本里既没有 `$` 也没有 `%` 时**原样返回**；
 *   2. `:47-51`：先按 plain 表做字面替换（`StringUtil.replace(..., false)`，大小写敏感）；
 *   3. `:53-55`：再按 expands 表逐个 `replaceMacro`，**大小写敏感**（`:48-49` 的注释：
 *      展开永远按大小写敏感处理，免得在大小写不敏感文件系统上做多余的 `toLowerCase()`）；
 *   4. **非递归**：`PathMacroManager.expandPath`（`PathMacroManager.kt:72-75`）调的是 `substitute`
 *      而不是 `substituteRecursively`；所以替换值里再出现的宏只有在该宏名**晚于**当前键时才会被处理；
 *   5. 表里没有的宏名**原样保留**（`findMacroIndex` 找不到 ⇒ 不改），不会被吃成空串；
 *   6. 空串原样返回（`PathMacroManager.kt:73`）。
 */
export function expandPathMacros(text: string, table: PathMacroTable): string {
  if (!text) return text
  if (!text.includes('$') && !text.includes('%')) return text
  let result = text
  for (const [from, to] of table.plain) result = literalReplace(result, from, to)
  for (const [macroName, value] of table.expands) result = replaceMacro(result, macroName, value)
  return result
}

/** 由上下文 + 用户自定义宏表直接展开（`PathMacroManager.expandPath` 的等价入口）。 */
export function expandWithPathMacros(text: string, context: PathMacroContext, userMacros: readonly PathMacroPair[] = []): string {
  return expandPathMacros(text, pathMacroTable(context, userMacros))
}

/** 文本里出现的一个宏 token（含位置，供高亮/替换用）。 */
export interface PathMacroUse {
  /** 完整 token（`$PROJECT_DIR$`）。 */
  token: string
  /** 宏名（不含 `$`）。 */
  name: string
  start: number
  end: number
}

/** 扫描文本里所有语法合法的宏 token（字符集与 `MACRO_PATTERN` 同）。 */
export function pathMacroUses(text: string): PathMacroUse[] {
  const uses: PathMacroUse[] = []
  for (const match of text.matchAll(/\$([A-Za-z0-9_.-]+)\$/g)) {
    uses.push({ token: match[0], name: match[1], start: match.index, end: match.index + match[0].length })
  }
  return uses
}

/**
 * 文本里**未定义**的宏名（去重、保序）。上游用同一判据找「未知宏」：
 * `PathMacrosCollector.getMacroNames` 先收全部 token（`PathMacrosCollector.kt:27-42`），
 * 再 `removeAll(getSystemMacroNames())` / `removeAll(getLegacyMacroNames())` /
 * `removeToolMacroNames` / 逐个 `getIgnoredMacroNames()`（`:44-53`）。
 */
export function undefinedPathMacros(text: string, table: PathMacroTable): string[] {
  const defined = new Set(definedPathMacroNames(table))
  const unknown: string[] = []
  for (const use of pathMacroUses(text)) if (!defined.has(use.name) && !unknown.includes(use.name)) unknown.push(use.name)
  return unknown
}

/**
 * 一份用户自定义宏表的真实形状（`PathMacrosImpl.getUserMacros()`，`PathMacrosImpl.kt:38,79`）：
 * 名字 → 路径的键值对，**默认空表**（`:49` `macros = java.util.Map.of()`）。
 */
export interface PathMacroTableState {
  macros: PathMacroPair[]
  /** `getIgnoredMacroNames()`（`:42`）：被忽略、不参与「未知宏」告警的宏名。默认空（`:51`）。 */
  ignored: string[]
}

/** 默认（空）宏表 —— `PathMacrosImpl` 的字段初值：两个空集合。 */
export function emptyPathMacroTable(): PathMacroTableState {
  return { macros: [], ignored: [] }
}

/** `FileUtilRt.toSystemDependentName`（`FileUtilRt.java:357-365`）：`/` 与 `\` 都换成平台分隔符。 */
export function toSystemDependentValue(path: string, separator: string = NATIVE_SEPARATOR): string {
  return path.replace(/[/\\]/g, separator)
}

/**
 * `PathMacroTable.obtainMacroPairs`（`PathMacroTable.java:159-172`）：
 * 用户宏表 + 未定义宏名（值空串，红字提示，`:62-64`）合流，**按名字排序**（`:42` `Pair.comparingByFirst()`）。
 * 未定义宏只在设置页里补位显示，不写回存储。
 */
export function pathMacroTableEntries(userMacros: readonly PathMacroPair[], undefinedNames: readonly string[] = []): PathMacroPair[] {
  const entries: PathMacroPair[] = userMacros.map(pair => ({ name: pair.name, value: toSystemDependentValue(pair.value) }))
  for (const name of undefinedNames) if (!entries.some(entry => entry.name === name)) entries.push({ name, value: '' })
  return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

/**
 * `PathMacroTable.commit`（`PathMacroTable.java:116-125`）单条值的归一：
 * 先把平台分隔符换成 `/`（`:121` `value.replace(File.separatorChar, '/')`），再去掉末尾 `/`；
 * **空值/纯空白不写**（`:120`）。返回 `null` 表示这一条应当被丢弃
 * （上游 `setMacro` 收到空值即删除该键，`PathMacrosImpl.kt:128-136`）。
 */
export function normalizePathMacroValue(value: string): string | null {
  if (!value.trim()) return null
  return trimTrailingSlashes(toSystemIndependentPath(value))
}

/**
 * `PathMacrosImpl.loadState`（`PathMacrosImpl.kt:194-205`）读档规则：
 * 丢掉**系统宏名**（`:197-199`）、去掉值末尾的 `/`（`:201-203`）。返回可写入的宏表。
 */
export function loadPathMacroEntries(raw: readonly PathMacroPair[], systemNames: readonly string[] = SYSTEM_MACRO_NAMES): PathMacroPair[] {
  const macros: PathMacroPair[] = []
  for (const pair of raw) {
    if (systemNames.includes(pair.name)) continue
    macros.push({ name: pair.name, value: trimTrailingSlashes(pair.value) })
  }
  return macros
}

/**
 * `PathMacroListEditor.parseIgnoredVariables`（`PathMacroListEditor.java:75-84`）：
 * 忽略变量是一个 `;` 分隔的串（`IdeBundle.properties:1363-1364` 的
 * `path.macro.ignored.variables` / `path.macro.use.semicolon`），逐段 trim。
 */
export function parseIgnoredMacroNames(text: string): string[] {
  return text.split(';').map(part => part.trim()).filter(Boolean)
}

/** 反向：`PathMacroListEditor.fillIgnoredVariables`（`PathMacroListEditor.java:65-68`）用 `;` 拼起来。 */
export function joinIgnoredMacroNames(names: readonly string[]): string {
  return names.join(';')
}

/**
 * `PathMacroTable.isModified`（`PathMacroTable.java:191-195`）：把当前表与存储里的表
 * （合流未定义名后）逐条比较。顺序在 `obtainMacroPairs` 里已排序，故这里是稳定比较。
 */
export function pathMacroTableModified(current: readonly PathMacroPair[], saved: readonly PathMacroPair[], undefinedNames: readonly string[] = []): boolean {
  const stored = pathMacroTableEntries(saved, undefinedNames)
  if (stored.length !== current.length) return true
  return stored.some((pair, index) => pair.name !== current[index]?.name || pair.value !== current[index]?.value)
}