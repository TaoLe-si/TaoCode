// 外部工具的**结构化模型**（上游 `platform/lang-impl/src/com/intellij/tools/Tool.java` 的 bean
// 字段 + `ToolEditorDialog.java` 的编辑面）。
//
// 判词里 lp/external-tools 缺「工具设置的结构化编辑页（`ToolEditorDialog`/`ToolsPanel`）」。
// 这个模块把那层编辑面需要的规则落成纯函数：一条工具的字段清单、每条工具的校验、宏插入。
//
// **哪些字段真的能存（2026-10-06 重新核实，订正上一版的判词）**：宿主
// `native/settings_schema.cpp:262-270` 的 `externalTools` 每条只允许 `{name, command}`
// （`known_keys` 之外的键直接 `INVALID_SETTINGS`），`src/settingsModel.ts:148` 同形。
// 其余 14 个上游字段由 `src/externalToolsRecords.ts` 存进应用级 localStorage 详情表
// （先例：`src/fileTypeOverrides.ts:34`、`src/macros.ts:306`），并由
// `toolRecordsFrom()` 与宿主条目合流 ⇒ 本模块的 `EXTERNAL_TOOL_FIELDS` 逐条写
// `persisted`（存得下）与 `consumed`（有人读）两档；没有运行消费者的那几条在设置页页脚
// 直接列出卡点，不画点不动的控件（playbook §3 禁止假控件）。`command` 一栏承接上游
// `program` + `parameters`（`Tool.java:75-76`）合成的一条命令串，因为本仓的运行通道是
// `run.start` 的单条命令。

/** 一条外部工具（本仓的持久化形状 = 上游 `Tool` 的 name + program/parameters 合成）。 */
export interface ExternalToolEntry {
  name: string
  command: string
}

/** 上游 `Tool` 的字段清单，附本仓的落点状态。 */
export interface ExternalToolField {
  /** 上游的 java 字段名。 */
  field: string
  label: string
  /** 上游证据（相对路径:行号）。 */
  upstream: string
  /** 本仓能不能存（宿主 `{name, command}` 或 `src/externalToolsRecords.ts` 的详情表）。 */
  persisted: boolean
  /** 不能存时的那句卡点（能存时为空）。 */
  blocker: string
  /** 存下来之后**有没有人读**（true = 本仓已有运行时消费者；false = 只有编辑面，消费缺哪一层写在 `consumer`）。 */
  consumed: boolean
  /** 消费方（`consumed` 为 true）或具体卡点 + 接线请求号（为 false）。 */
  consumer: string
}

const RUNTIME_BLOCKER = '本仓的运行通道是 `src/runActions.ts` 的 `runExternalTool` → `run.start`（单条命令 + 工作区根 cwd），逐工具的这一档要改那两个文件（本批冻结）⇒ 见接线请求。'

/** 上游 `Tool.java:57-77` 的字段逐条登记。 */
export const EXTERNAL_TOOL_FIELDS: readonly ExternalToolField[] = [
  { field: 'myName', label: '名称', upstream: 'Tool.java:83', persisted: true, blocker: '', consumed: true, consumer: '宿主 `settings_schema.cpp:266-269` 的 `name` + `src/menus/toolsMenu.ts` 的菜单标题。' },
  { field: 'myDescription', label: '说明', upstream: 'Tool.java:57,87', persisted: true, blocker: '', consumed: true, consumer: '设置页的描述行（`ExternalToolsSettingsPage.vue` 的工具设置区）；上游这一档落在 `ToolAction.java:57` 的 `presentation.setDescription`，本仓的 `MenuRow` 没有描述槽位（`src/menus/types.ts` 冻结）⇒ 见接线请求。' },
  { field: 'myGroup', label: '所属分组', upstream: 'Tool.java:91,399', persisted: true, blocker: '', consumed: true, consumer: '`src/menus/toolsMenu.ts` 按分组建子菜单（等价 `BaseToolManager.java:89-113` 每组建一个 delegate group）。' },
  { field: 'myShownInMainMenu', label: '在主菜单显示', upstream: 'Tool.java:62', persisted: true, blocker: '', consumed: false, consumer: '上游 `Tool.java:60-61` 自己注明这四项「effectively not used anymore（IDEA-190856）」，本仓同样不消费：值存着、编辑面不画（画了就是假控件）。' },
  { field: 'myShownInEditor', label: '在编辑器右键菜单显示', upstream: 'Tool.java:63', persisted: true, blocker: '', consumed: false, consumer: '同上（IDEA-190856 之后上游也不再消费）；且本仓的编辑器右键菜单在禁改的 `src/App.vue` 里。' },
  { field: 'myShownInProjectViews', label: '在项目视图右键菜单显示', upstream: 'Tool.java:64', persisted: true, blocker: '', consumed: false, consumer: '同上（IDEA-190856）；项目视图右键菜单属桶 14 的 `src/components/ProjectViewPopup.vue`。' },
  { field: 'myShownInSearchResultsPopup', label: '在搜索结果浮窗显示', upstream: 'Tool.java:65', persisted: true, blocker: '', consumed: false, consumer: '同上（IDEA-190856）；本仓搜索结果浮窗没有工具挂点。' },
  { field: 'myEnabled', label: '启用', upstream: 'Tool.java:67', persisted: true, blocker: '', consumed: true, consumer: '`src/menus/toolsMenu.ts` 的 `enabledToolRecords()` 过滤（等价 `BaseToolManager.java:164` 的 `!o.isEnabled()`），勾选框在设置页每行（`BaseToolsPanel.java:248`）。' },
  { field: 'myWorkingDirectory', label: '工作目录', upstream: 'Tool.java:74', persisted: true, blocker: '', consumed: false, consumer: RUNTIME_BLOCKER },
  { field: 'myProgram', label: '程序', upstream: 'Tool.java:75', persisted: true, blocker: '', consumed: true, consumer: '`hostCommandOf()` 与 `myParameters` 合成宿主那条 `command`，`src/menus/toolsMenu.ts` 把它交给 `runExternalTool` 执行。' },
  { field: 'myParameters', label: '参数', upstream: 'Tool.java:76', persisted: true, blocker: '', consumed: true, consumer: '与 `myProgram` 一起由 `hostCommandOf()` 合成宿主那条 `command`，`src/menus/toolsMenu.ts` 把它交给 `runExternalTool` 执行。' },
  { field: 'myUseConsole', label: '在控制台运行', upstream: 'Tool.java:69', persisted: true, blocker: '', consumed: false, consumer: RUNTIME_BLOCKER },
  { field: 'myShowConsoleOnStdOut', label: '标准输出时显示控制台', upstream: 'Tool.java:70', persisted: true, blocker: '', consumed: false, consumer: `${RUNTIME_BLOCKER}依赖 myUseConsole（上游在 \`ToolEditorDialog.java:149\` 把它做成条件可用）。` },
  { field: 'myShowConsoleOnStdErr', label: '错误输出时显示控制台', upstream: 'Tool.java:71', persisted: true, blocker: '', consumed: false, consumer: `${RUNTIME_BLOCKER}依赖 myUseConsole（\`ToolEditorDialog.java:151\`）。` },
  { field: 'mySynchronizeAfterExecution', label: '执行后同步', upstream: 'Tool.java:72', persisted: true, blocker: '', consumed: false, consumer: `${RUNTIME_BLOCKER}同步动作本身在 \`src/diskSync.ts\` 有等价物，缺的是「工具进程退出」这个回调点。` },
  { field: 'myOutputFilters', label: '输出过滤（include/exclude 正则）', upstream: 'ToolEditorDialog.java:158', persisted: true, blocker: '', consumed: false, consumer: '规则已落在 `src/toolMacros.ts` 的 `filterToolOutput`，但输出行的消费方在 `src/buildOutput.ts` / App.vue 的控制台（均非本桶文件）⇒ 见接线请求。' },
]

/** 上游编辑对话框的字段顺序（`ToolEditorDialog.java:137-138,155-158`）。 */
export const EXTERNAL_TOOL_EDITOR_FIELD_ORDER: readonly string[] = ['name', 'description', 'workingDirectory', 'program', 'arguments', 'outputFilters']

/** 上游把多条过滤规则用同一个 joiner 串起来编辑（`ToolEditorDialog.java:158` 的 `OUTPUT_FILTERS_JOINER`）。 */
export function joinOutputFilters(filters: readonly string[]): string {
  return filters.filter(Boolean).join(';')
}

/** 反过来拆（`ToolEditorDialog.java:118` 把一串映射成 `FilterInfo[]`）。 */
export function splitOutputFilters(value: string): string[] {
  return value.split(';').map(part => part.trim()).filter(Boolean)
}

/** 在命令的 caret 处插入一个宏；`macro` 可以带参数（`FileDirPathFromParent(src)`）。 */
export function insertToolMacro(command: string, macro: string, caret: number): { command: string; caret: number } {
  const token = `$${macro}$`
  const at = Math.max(0, Math.min(caret, command.length))
  return { command: command.slice(0, at) + token + command.slice(at), caret: at + token.length }
}

/** 命令里所有宏的 token（含参数形态，`$FileDirPathFromParent(src)$`）。 */
export function toolMacroTokens(command: string): string[] {
  const found: string[] = []
  for (const match of command.matchAll(/\$[A-Za-z][A-Za-z0-9]*(?:\([^)]*\))?\$/g)) found.push(match[0])
  return found
}

/** 一个宏 token 落在命令里的位置（给高亮/替换用）。 */
export interface ToolMacroUse {
  token: string
  name: string
  argument: string
  start: number
  end: number
}

export function toolMacroUses(command: string): ToolMacroUse[] {
  const uses: ToolMacroUse[] = []
  for (const match of command.matchAll(/\$([A-Za-z][A-Za-z0-9]*)(?:\(([^)]*)\))?\$/g)) {
    uses.push({
      token: match[0],
      name: match[1],
      argument: match[2] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return uses
}

/** 命令里没有成对 `$` 的落单美元符号（写了 `$HOME` 这种会被用户当成宏漏写收尾）。 */
export function danglingToolDollars(command: string): number {
  // 每个宏 token 恰好含 2 个 `$`（`$Name$` 或 `$Name(arg)$`），所以成对的是 `uses.length * 2` 个。
  return (command.match(/\$/g)?.length ?? 0) - toolMacroUses(command).length * 2
}

export interface ExternalToolProblem {
  field: 'name' | 'command'
  message: string
}

export interface ExternalToolValidation {
  problems: ExternalToolProblem[]
  /** 能不能存：没有 error 级问题即可。 */
  valid: boolean
  /** 未知宏名（不是错误，上游原样保留，但要提示）。 */
  unknownMacros: string[]
  /** 落单的 `$` 数量。 */
  danglingDollars: number
}

/**
 * 校验一条工具。同名冲突只在**其他条目**里查（`ToolEditorDialog` 是逐条编辑的，
 * 存进去之前不能拿自己跟自己比）。命令为空是不许存的；未知宏与落单 `$` 只提示。
 */
export function validateExternalTool(
  tool: ExternalToolEntry,
  others: readonly ExternalToolEntry[] = [],
  knownMacros: readonly string[] = [],
): ExternalToolValidation {
  const problems: ExternalToolProblem[] = []
  const name = tool.name.trim()
  const command = tool.command.trim()
  if (!name) problems.push({ field: 'name', message: '工具名不能为空。' })
  else if (name.length > 80) problems.push({ field: 'name', message: '工具名过长：请控制在 80 字节以内。' })
  else if (others.some(other => other.name.trim() === name)) {
    problems.push({ field: 'name', message: `已经有同名工具「${name}」了。` })
  }
  if (!command) problems.push({ field: 'command', message: '命令不能为空。' })
  else if (command.length > 2000) problems.push({ field: 'command', message: '命令过长：请控制在 2000 字节以内。' })
  const uses = toolMacroUses(command)
  const known = new Set(knownMacros)
  const unknownMacros = known.size ? [...new Set(uses.map(use => use.name).filter(macro => !known.has(macro)))] : []
  const danglingDollars = danglingToolDollars(command)
  return { problems, valid: problems.length === 0, unknownMacros, danglingDollars }
}

/** 整张表里能存的几条（逐条过滤并写明原因，设置页据此把坏行标出来）。 */
export function validatedTools(
  tools: readonly ExternalToolEntry[],
  knownMacros: readonly string[] = [],
): Array<{ tool: ExternalToolEntry; validation: ExternalToolValidation }> {
  return tools.map((tool, index) => ({ tool, validation: validateExternalTool(tool, tools.filter((_, other) => other !== index), knownMacros) }))
}

/** 一条命令展开宏后的样子（设置页的「这条命令实际会跑成什么」预览）。 */
export function previewExternalToolCommand(tool: ExternalToolEntry, expand: (command: string) => string): string {
  return tool.command.trim() ? expand(tool.command) : ''
}

/** 命令里第一个宏（设置页给「插入宏」按钮的默认落点）。 */
export function firstToolMacro(command: string): ToolMacroUse | undefined {
  return toolMacroUses(command)[0]
}
