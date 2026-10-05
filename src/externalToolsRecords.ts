// 外部工具的**完整 bean 字段**与本仓可用的持久化通道。
//
// 上游形状：`platform/lang-impl/src/com/intellij/tools/Tool.java:56-78` 的 16 个字段（订正：原写 :56-77，
// `myOutputFilters` 实际在 :78）
// （name / description / group / 4 个 shownIn* / enabled / useConsole / showConsoleOnStdOut /
// showConsoleOnStdErr / synchronizeAfterExecution / workingDirectory / program / parameters /
// outputFilters），编辑面是 `ToolEditorDialog.java:100-121`（`getData`）与 `:137-158`（`setData`），
// 控件与文案在 `ToolEditorDialogPanel.kt` + `resources/messages/ToolsBundle.properties`。
//
// 本仓的持久化现状（动手前核实过，不是照抄判词）：
//   · 宿主 `native/settings_schema.cpp` 的 `externalTools` 原先只做
//     `known_keys(entry, {"name","command"})` —— **多余键会被判 INVALID_SETTINGS**；
//     `src/settingsModel.ts:148` 的 `GeneralSettingsState.externalTools` 同形（冻结文件）。
//   ⇒ 2026-10-06 订正留痕：接线请求 W2（docs/wiring-requests-2026-10-06-bucket15.md）**已经落地**，
//     原生白名单按上游 `Tool.java:56-78` 放开（description/group/enabled/useConsole/
//     showConsoleOnStdOut/showConsoleOnStdErr/synchronizeAfterExecution/workingDirectory/outputFilters），
//     `toolRecordsFrom()` 也改成**宿主条目优先**（原写「宿主只存得下这两个键」已不成立）。
//     请求原文说「前端侧不需要改动：本模块已经在读这些键」——**核过是假的**：
//     原 `toolRecordsFrom` 只取 `entry.name`/`entry.command`，其余一律来自详情表，
//     所以放开原生白名单后必须同时改这里的合流，否则放开的键等于没人读。
//     其余字段仍落本模块的 localStorage 详情表（与 `src/fileTypeOverrides.ts:34` 的
//     `FILE_SETS_KEY`、`src/macros.ts:306` 的 `MACRO_STORAGE_KEY` 同一先例：应用级用户数据走
//     localStorage），本页是**兜底**那一半，不是唯一真源。
//   · 没放开的两组照上游注释如实登记：`program`/`parameters`（`Tool.java:75-76`）合成一条
//     `command`；四个 `shownIn*`（`Tool.java:62-65`）上游注明 "effectively not used anymore,
//     see IDEA-190856"，本仓也不给它开持久化口子。
//
// 已经被消费掉的字段（不是死数据）：
//   · `group` —— 子菜单分组（`BaseToolManager.java:89-113` 每个 ToolsGroup 注册成一个 delegate group）；
//   · `enabled` —— 停用工具不进菜单（`BaseToolManager.java:164` 的 `!o.isEnabled()` 分支）；
//   · `synchronizeAfterExecution` —— 跑完后按磁盘刷新（`src/diskSync.ts` 的 `refreshDirtyDocuments`
//     那条链，上游 `Tool.java:72` 的同一个开关）；
//   · 其余字段（workingDirectory / useConsole / showConsoleOnStd*）的运行时落点在
//     `src/runActions.ts` 与 App.vue（本批冻结），先持久化 + 在设置页如实标注落点。
import { computed, ref } from 'vue'

/** 一条工具的完整字段（上游 `Tool` 的 bean 形状，name/command 之外都存本仓）。 */
export interface ExternalToolRecord {
  name: string
  /** `Tool.java:57`；菜单项的描述槽位（`ToolAction.java:57` 的 `presentation.setDescription`）。 */
  description: string
  /** `Tool.java:58`，缺省 = `DEFAULT_GROUP_NAME`（`:53`，取 `ToolsBundle` 的 `external.tools`）。 */
  group: string
  /** `Tool.java:62-65` 那四个「effectively not used anymore（IDEA-190856）」的开关，按上游原样保留。 */
  shownInMainMenu: boolean
  shownInEditor: boolean
  shownInProjectViews: boolean
  shownInSearchResultsPopup: boolean
  /** `Tool.java:67`。新建的工具默认是启用的（`BaseToolsPanel.java:116` `tool.setEnabled(true)`）。 */
  enabled: boolean
  /** `Tool.java:69` = 「Open console for tool output」（`ToolsBundle.properties:31`）。 */
  useConsole: boolean
  /** `Tool.java:70`，只在 useConsole 勾选时可编辑（`ToolEditorDialog.java:149`）。 */
  showConsoleOnStdOut: boolean
  /** `Tool.java:71`，同上（`:151`）。 */
  showConsoleOnStdErr: boolean
  /** `Tool.java:72` = 「Synchronize files after execution」（`ToolsBundle.properties:34`）。 */
  synchronizeAfterExecution: boolean
  /** `Tool.java:74` = 「Working directory:」（`ToolsBundle.properties:36`）。 */
  workingDirectory: string
  /** `Tool.java:75` = 「Program:」（`ToolsBundle.properties:33`）。 */
  program: string
  /** `Tool.java:76` = 「Arguments:」（`ToolsBundle.properties:24`）。 */
  parameters: string
  /** `Tool.java:77` 的 `FilterInfo[]`，每条一个正则（`ToolEditorDialog.java:118` 用 `new FilterInfo(s, "", "")`）。 */
  outputFilters: string[]
}

/** 设置页要画的那条「Advanced Options」分隔线（`ToolsBundle.properties:37`）。 */
export const TOOL_ADVANCED_SEPARATOR = '高级选项'

/** 上游缺省分组名（`Tool.java:53` 的 `DEFAULT_GROUP_NAME` = `ToolsBundle.properties:38` 的 `external.tools`）。 */
export const DEFAULT_TOOL_GROUP = '外部工具'

/**
 * 宿主条目：`name` / `command` 必填，其余是上游 `Tool` 的 bean 字段（Tool.java:56-78），
 * 2026-10-06 起 `native/settings_schema.cpp` 的白名单放开、可以随应用设置存走
 * （接线请求 docs/wiring-requests-2026-10-06-bucket15.md W2）。一律**可选**：
 * 旧存档少一个键不是损坏，缺的值由 `withToolDetailDefaults` 补默认。
 * 没放开的两组：`program`/`parameters`（本仓合成一条 `command`）、四个 `shownIn*`
 * （Tool.java:62-65 上游自己注明 "effectively not used anymore, see IDEA-190856"）。
 */
export interface HostToolEntry {
  name: string
  command: string
  description?: string
  group?: string
  enabled?: boolean
  useConsole?: boolean
  showConsoleOnStdOut?: boolean
  showConsoleOnStdErr?: boolean
  synchronizeAfterExecution?: boolean
  workingDirectory?: string
  outputFilters?: string[]
}

/** 宿主条目上「真的带了值」的那几个键；形态不对的当没带，回落到详情表与缺省。 */
const HOST_TOOL_TEXT_FIELDS = ['description', 'group', 'workingDirectory'] as const
const HOST_TOOL_FLAG_FIELDS = ['enabled', 'useConsole', 'showConsoleOnStdOut', 'showConsoleOnStdErr',
  'synchronizeAfterExecution'] as const

export function hostToolFields(entry: HostToolEntry): Partial<ExternalToolDetail> {
  const source = entry as unknown as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const key of HOST_TOOL_TEXT_FIELDS) if (typeof source[key] === 'string') picked[key] = source[key]
  for (const key of HOST_TOOL_FLAG_FIELDS) if (typeof source[key] === 'boolean') picked[key] = source[key]
  if (Array.isArray(source.outputFilters)) picked.outputFilters = source.outputFilters
  return picked as Partial<ExternalToolDetail>
}

/** 除 name 之外的那部分（上游 `Tool` 的其余 15 个字段）。 */
export type ExternalToolDetail = Omit<ExternalToolRecord, 'name'>

/** 新增一条工具时的初值。 */
export function defaultToolDetail(): ExternalToolDetail {
  return {
    description: '',
    group: DEFAULT_TOOL_GROUP,
    shownInMainMenu: false,
    shownInEditor: false,
    shownInProjectViews: false,
    shownInSearchResultsPopup: false,
    enabled: true,
    useConsole: true,
    showConsoleOnStdOut: false,
    showConsoleOnStdErr: true,
    synchronizeAfterExecution: true,
    workingDirectory: '',
    program: '',
    parameters: '',
    outputFilters: [],
  }
}

/**
 * 「缺失键补默认值」的规范化（不按键数判整份存档损坏 —— 加字段必须能让旧存档继续用）。
 * 布尔取布尔、字符串取字符串、`outputFilters` 取字符串数组；其他形态一律回落到缺省。
 */
export function withToolDetailDefaults(raw: unknown): ExternalToolDetail {
  const base = defaultToolDetail()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const source = raw as Record<string, unknown>
  const bool = (key: keyof ExternalToolDetail, fallback: boolean) => (typeof source[key] === 'boolean' ? (source[key] as boolean) : fallback)
  const text = (key: keyof ExternalToolDetail, fallback: string) => (typeof source[key] === 'string' ? (source[key] as string) : fallback)
  const filters = Array.isArray(source.outputFilters)
    ? source.outputFilters.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : base.outputFilters
  return {
    description: text('description', base.description),
    group: text('group', base.group) || DEFAULT_TOOL_GROUP,
    shownInMainMenu: bool('shownInMainMenu', base.shownInMainMenu),
    shownInEditor: bool('shownInEditor', base.shownInEditor),
    shownInProjectViews: bool('shownInProjectViews', base.shownInProjectViews),
    shownInSearchResultsPopup: bool('shownInSearchResultsPopup', base.shownInSearchResultsPopup),
    enabled: bool('enabled', base.enabled),
    useConsole: bool('useConsole', base.useConsole),
    showConsoleOnStdOut: bool('showConsoleOnStdOut', base.showConsoleOnStdOut),
    showConsoleOnStdErr: bool('showConsoleOnStdErr', base.showConsoleOnStdErr),
    synchronizeAfterExecution: bool('synchronizeAfterExecution', base.synchronizeAfterExecution),
    workingDirectory: text('workingDirectory', base.workingDirectory),
    program: text('program', base.program),
    parameters: text('parameters', base.parameters),
    outputFilters: filters,
  }
}

/**
 * `command` → `{ program, parameters }` 的反向拆解（本仓把上游那两个字段合成了一条命令串）。
 * 只在详情表里**两个字段都为空**时用它补一次，避免把用户填过的值盖掉。
 */
export function splitToolCommand(command: string): { program: string; parameters: string } {
  const match = /^\s*("[^"]*"|\S+)\s*(.*)$/.exec(command)
  if (!match) return { program: '', parameters: '' }
  return { program: match[1] ?? '', parameters: (match[2] ?? '').trim() }
}

/** 宿主条目 + 详情表 → 完整记录（详情表里没有这条时按缺省补，并按 `splitToolCommand` 拆一次命令）。 */
export function toolRecordsFrom(entries: readonly HostToolEntry[], details: Readonly<Record<string, ExternalToolDetail>>): ExternalToolRecord[] {
  return entries.map(entry => {
    const detail = details[entry.name]
    // 宿主条目优先（`native/settings_schema.cpp` 的 externalTools 白名单放开后它就是唯一真源），
    // localStorage 的详情表补其次，最后 `withToolDetailDefaults` 兜缺省 ——
    // 「按字段数量判损坏」是禁止的：少了键就回默认，旧存档继续可用。
    const filled = withToolDetailDefaults({ ...(detail ?? {}), ...hostToolFields(entry) })
    const split = detail ? null : splitToolCommand(entry.command)
    return {
      name: entry.name,
      description: filled.description,
      group: filled.group,
      shownInMainMenu: filled.shownInMainMenu,
      shownInEditor: filled.shownInEditor,
      shownInProjectViews: filled.shownInProjectViews,
      shownInSearchResultsPopup: filled.shownInSearchResultsPopup,
      enabled: filled.enabled,
      useConsole: filled.useConsole,
      showConsoleOnStdOut: filled.showConsoleOnStdOut,
      showConsoleOnStdErr: filled.showConsoleOnStdErr,
      synchronizeAfterExecution: filled.synchronizeAfterExecution,
      workingDirectory: filled.workingDirectory,
      // 用户没单独填过程序/参数时，命令串就是这两段合成后的值（`Tool.java:75-76` → 本仓 `command`）。
      program: filled.program || split?.program || entry.command,
      parameters: filled.parameters || split?.parameters || '',
      outputFilters: filled.outputFilters,
    }
  })
}

/** 菜单可见的那批（`BaseToolManager.java:164` 的 `!o.isEnabled()` 那一档）。 */
export function enabledToolRecords(records: readonly ExternalToolRecord[]): ExternalToolRecord[] {
  return records.filter(record => record.enabled)
}

/** 一条记录回落到宿主形状（`{name, command}`）：程序 + 参数合成一条命令（空命令由校验拦下）。 */
export function hostCommandOf(record: ExternalToolRecord): string {
  return [record.program.trim(), record.parameters.trim()].filter(Boolean).join(' ')
}

/** 分组后的菜单行（`BaseToolManager.java:89-113`：每个 `ToolsGroup` 是一个 delegate group）。 */
export interface ToolMenuGroup {
  group: string
  tools: ExternalToolRecord[]
}

/**
 * 按 `group` 分桶，**保留条目首次出现的顺序**（上游的组顺序就是存储顺序，
 * `BaseToolManager.java:76` 的 `getGroups()` 就是列表本身）。
 * 只有一个组时调用方可以不建子层（`toolsMenu` 里那侧的判断）。
 */
export function groupToolRecords(records: readonly ExternalToolRecord[]): ToolMenuGroup[] {
  const order: string[] = []
  const buckets = new Map<string, ExternalToolRecord[]>()
  for (const record of records) {
    const name = record.group || DEFAULT_TOOL_GROUP
    if (!buckets.has(name)) { buckets.set(name, []); order.push(name) }
    buckets.get(name)!.push(record)
  }
  return order.map(name => ({ group: name, tools: buckets.get(name)! }))
}

/**
 * 输出过滤式的判据：每条必须含 `$FILE_PATH$`（`ToolEditorDialogPanel.kt:135` 把
 * `RegexpFilter.FILE_PATH_MACROS` 塞进那条 `dialog.message.each.output.filter.must.contain.0.macro`）。
 * 返回**不合规的那几条**原文，空数组 = 全合规。
 */
export function outputFiltersMissingFilePathMacro(filters: readonly string[]): string[] {
  return filters.filter(filter => !filter.includes('$FILE_PATH$'))
}

/** 上游对「名称为空」的那句校验（`ToolsBundle.properties:22` 的 `dialog.message.specify.the.tool.name`）。 */
export const TOOL_NAME_REQUIRED_MESSAGE = '请指定工具名称。'

export const TOOL_DETAIL_STORAGE_KEY = 'taocode.externalTools.details'

function readStoredDetails(): Record<string, ExternalToolDetail> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(TOOL_DETAIL_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, ExternalToolDetail> = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!name) continue
      out[name] = withToolDetailDefaults(value)
    }
    return out
  } catch {
    // 读不出来 = 按「没有详情」处理，name/command 那条主表不受影响。
    return {}
  }
}

function persistDetails(details: Readonly<Record<string, ExternalToolDetail>>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TOOL_DETAIL_STORAGE_KEY, JSON.stringify(details))
  } catch {
    // 存储不可用只影响持久化，本次会话仍然可编辑。
  }
}

/**
 * 详情表的**响应式单例**（与 `src/fileTypeOverrides.ts:221` 的 `fileSetEntries` 同一形态）。
 * 键是工具名：改名要跟着搬键（`renameToolDetail`），删工具要跟着删键（`dropToolDetail`），
 * 否则会留下一条永远不会命中的孤儿详情。
 */
export const toolDetails = ref<Record<string, ExternalToolDetail>>(readStoredDetails())

function save(details: Record<string, ExternalToolDetail>) {
  // 空表直接摘掉这个键，别在 localStorage 里留一份 `null` 形态的垃圾。
  try {
    if (typeof localStorage !== 'undefined') {
      if (Object.keys(details).length) localStorage.setItem(TOOL_DETAIL_STORAGE_KEY, JSON.stringify(details))
      else localStorage.removeItem(TOOL_DETAIL_STORAGE_KEY)
    }
  } catch { /* 同上 */ }
  toolDetails.value = details
}

/**
 * 改一条工具的详情（只合并传进来的那些键）。
 * 表里**还没有**这条时，先用 `seedCommand` 把 `program` / `parameters` 落一次初值
 * （上游这两栏本来就是分开的两段，`Tool.java:75-76`；不 seed 的话用户第一次改详情
 * 就会把原来那条 `command` 的参数丢掉）。
 */
export function patchToolDetail(name: string, patch: Partial<ExternalToolDetail>, seedCommand = ''): ExternalToolDetail {
  const existing = toolDetails.value[name]
  const seeded: ExternalToolDetail = existing ?? { ...defaultToolDetail(), ...splitToolCommand(seedCommand) }
  const next = withToolDetailDefaults({ ...seeded, ...patch })
  save({ ...toolDetails.value, [name]: next })
  return next
}

/** 删掉一条工具的详情（`name` 不在表里时原样返回，不产生新存档）。 */
export function dropToolDetail(name: string): void {
  if (!Object.prototype.hasOwnProperty.call(toolDetails.value, name)) return
  const next = { ...toolDetails.value }
  delete next[name]
  save(next)
}

/**
 * 改名时把详情表里的键一起搬过去。
 * 新名字**已经有**详情时不覆盖（上游 `BaseToolsPanel.java:270` 也是「按这条节点写回」，
 * 同名冲突由 `validateExternalTool` 提前拦掉，这里只是兜底）。
 */
export function renameToolDetail(from: string, to: string): void {
  if (from === to) return
  const detail = toolDetails.value[from]
  if (!detail) return
  const next = { ...toolDetails.value }
  delete next[from]
  if (!Object.prototype.hasOwnProperty.call(next, to)) next[to] = detail
  save(next)
}

/** 整表重载（导入设置、或宿主 schema 放开后一次性搬回主表时用）。 */
export function replaceToolDetails(details: Readonly<Record<string, ExternalToolDetail>>): void {
  const next: Record<string, ExternalToolDetail> = {}
  for (const [name, value] of Object.entries(details)) if (name) next[name] = withToolDetailDefaults(value)
  save(next)
}

/** 存储重读（测试与「外部改动」对账用）。 */
export function reloadToolDetails(): void {
  toolDetails.value = readStoredDetails()
}

/** 宿主条目 + 详情表的合并视图（设置页与菜单都从这里取，两处来源只在这一处合流）。 */
export function toolRecords(entries: readonly HostToolEntry[]): ExternalToolRecord[] {
  return toolRecordsFrom(entries, toolDetails.value)
}

/** 响应式的合并视图。 */
export function useToolRecords(entries: () => readonly HostToolEntry[]) {
  return computed(() => toolRecords(entries()))
}
