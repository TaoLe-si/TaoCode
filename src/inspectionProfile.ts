// 本地检查配置文件（上游 `InspectionProfile` / `InspectionProfileManager` / `InspectionProfileImpl`
// / `InspectionToolWrapper` 一族的有界子集）。
//
// 上游行为：每个工程有多份 inspection profile，profile 里逐个工具（检查器）存
// 「启用/停用 + 级别覆盖」；根 profile（root profile）由 `setRootProfile(name)` 选，
// 运行检查与呈现结果都按 **当前 profile** 判定；profile 可以复制/改名/删除/加锁，
// 并以 `.xml` 落地（工程级那份就放在工程目录里，见下面的 `.taocode/inspectionProfiles/`）。
//
// 上游依据（相对 intellij-community 根）：
//   · `platform/analysis-api/src/com/intellij/codeInspection/InspectionProfile.java:22`
//     `DEFAULT_PROFILE_NAME = "Default"`；
//   · `platform/analysis-impl/src/com/intellij/profile/codeInspection/InspectionProfileManager.java:23,37,40`
//     `getProfiles()` / `setRootProfile(name)` / `getCurrentProfile()`；
//   · `platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionProfileImpl.java:87-88,279-289,351-353,494-502,209-220`
//     XML 形状（`version="1.0"` / `is_locked`）、级别登记册校验与回退；
//   · `platform/analysis-impl/src/com/intellij/codeInspection/ex/ToolsImpl.java:40-42,142-162`
//     逐工具属性名 `class` / `enabled` / `level` / `enabled_by_default`；
//   · `platform/lang-impl/src/com/intellij/profile/codeInspection/ui/header/InspectionProfileSchemesModel.java:196-200,47-63`
//     清单排序（先应用级后工程级，各段按名排序）与「同层至少留一份」的删除约束；
//   · `platform/lang-impl/src/com/intellij/profile/codeInspection/ui/InspectionProfileImporter.java:16-18`
//     profile 的导入导出扩展名**只有 `xml`**（判词里写的 `.ipr` 是 JPS 工程文件，与检查配置无关，
//     见 `jps/model-serialization/src/org/jetbrains/jps/model/serialization/JpsProjectLoader.java`）；
//   · 真实落盘样本：上游工程自己的 `.idea/inspectionProfiles/idea_default.xml:1-3`（
//     `<component name="InspectionProjectProfileManager"><profile version="1.0"><option name="myName" value="idea.default"/>`）
//     与 `.idea/inspectionProfiles/profiles_settings.xml:1-6`（`<settings><option name="PROJECT_PROFILE" value="idea.default"/>`）。
//
// 本仓的等价物（有界子集，按语言服务的 `source` 当检查器标识）：
//   · 只做**结果过滤与级别覆盖**，不做「工具不跑」的性能面 —— 诊断来自语言服务，
//     宿主无法让服务器不跑某个检查器；停用只是在本仓的聚合处丢行（行为对用户一致）；
//   · 逐检查项一条 `{ enabled, severity }`（键 = `src/inspectionIdentity.ts` 折出来的身份键，
//     旧存档里只有检查器名的键仍是它的一级回退），`severity: null` = 按服务端原值；
//     未列出的检查项一律启用 + 原值（上游 profile 里未登记的工具的默认档）；
//   · 多 profile + 根 profile 选择（`selectProfile`），当前 profile 决定 `applyInspectionProfile` 的判定；
//   · `.xml` 序列化/反序列化（`exportProfileXml` / `parseProfileXml` / `importProfileXml`），
//     落盘与读取在 `src/inspectionProfileIo.ts`。
//
// **键的粒度（本轮订正并扩展）**：以前只按 `source` 记一条，理由是
// 「native 的 `shape_diagnostics`（`native/lsp_support.cpp:127-145`）只透传四列 + source，没有 code」。
// 实测该前提已不成立 —— `native/lsp_support.cpp:148-149` 现在把 `code`/`tags` 一起透传，
// 宿主类型在 `src/bridge.ts:118`，聚合表也带着它们（`src/problems.ts` 的 `ProblemRow.code`/`tags`）。
// 于是本仓能做到上游真正的粒度：上游 profile 的启用状态按 **`HighlightDisplayKey`** 判
// （`platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionProfileImpl.java:804`），
// 而问题视图的检查项身份 = `problemGroup.problemName ?: inspectionToolId`
// （`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/HighlightingProblem.kt:85-89`；
// 外部注解器那一支的 problemName 就是外部检查名，`ExternalSourceProblemGroup.kt:13-18` +
// `HighlightInfo.java:477-481`；工具短名见同文件 `:473-475`）。
// 本仓用 `src/inspectionIdentity.ts` 把 (source, code, tags) 折成同一把身份键，
// 门控按「具体 → 宽泛」的候选键逐级查：`#<kind id>` → `<检查器>::<码>` → `<检查器>` → `<码>`。
// 只登记过 source 的旧存档继续命中第三级，不会被判成空。
//
// **明确不做**：`InspectionToolRegistrar` 的扩展点注册面（规则由语言服务注册，宿主没有注册点）；
// `enabled_by_default` 的往返（本仓没有逐工具默认状态可还原 —— 默认档由服务器给）；
// profile 里的 `<option>` 子元素（上游是 `InspectionToolWrapper.writeSettings` 的工具选项，
// 需要本地 inspection 工具实例，本仓没有）。
import { computed, ref } from 'vue'
import type { ProblemRow } from './problems.ts'
// 检查项身份（(source, code, tags) → 键与显示名），见 src/inspectionIdentity.ts。
import { inspectionIdentityOf, type InspectionIdentity } from './inspectionIdentity.ts'

/** 一条检查器的本地设置。`severity: null` = 不覆盖（用服务端 severity）。 */
export interface InspectionToolSetting {
  enabled: boolean
  severity: number | null
}

export interface InspectionProfile {
  /** source（检查器名）→ 设置；空字符串是「无来源」的口径。 */
  tools: Record<string, InspectionToolSetting>
}

/** 落盘的一份 profile（`InspectionProfileImpl` 的 `is_locked` 也存这里）。 */
export interface StoredInspectionProfile extends InspectionProfile {
  locked: boolean
}

/** 整个配置档集合（`InspectionProfileManager` 的 `getProfiles()` + `setRootProfile`）。 */
export interface InspectionProfileStore {
  /** 根 profile 名；不存在时读当前 profile 会回落到 `DEFAULT_PROFILE_NAME`。 */
  root: string
  profiles: Record<string, StoredInspectionProfile>
}

/** `InspectionProfile.DEFAULT_PROFILE_NAME`（`InspectionProfile.java:22`）。 */
export const DEFAULT_PROFILE_NAME = 'Default'

/**
 * 级别表：LSP 的四档 severity ↔ profile XML 的 `level=` 属性名。
 * 名字取 `HighlightSeverity.getName()`（`platform/analysis-api/.../HighlightSeverity.java:43-119`），
 * 经 `HighlightDisplayLevel.getName()` = `severity.name` 落到 XML
 * （`platform/analysis-api/.../HighlightDisplayLevel.kt:260-261`）。
 * **`WEAK WARNING` 中间有空格** —— 那是 `HighlightSeverity.WEAK_WARNING` 的 `myName` 原文，
 * 上游自己的 `.idea/inspectionProfiles/idea_fatal_errors.xml:28` 就是这么写的。
 * 与 `src/highlightLevels.ts` 的四档是同一份（排序权重、中文名同源）。
 */
export const INSPECTION_LEVELS = [
  { xml: 'ERROR', severity: 1, label: '错误' },
  { xml: 'WARNING', severity: 2, label: '警告' },
  { xml: 'WEAK WARNING', severity: 3, label: '提示' },
  { xml: 'INFO', severity: 4, label: '信息' },
] as const

/** profile 里没有登记级别时的默认档（`InspectionProfileImpl.java:212` 的 `HighlightDisplayLevel.WARNING`）。 */
export const DEFAULT_LEVEL_XML = 'WARNING'

const STORAGE_KEY = 'taocode.inspectionProfile'
const SEVERITIES: readonly number[] = INSPECTION_LEVELS.map(level => level.severity)

/** 级别名 → LSP severity；不在本仓登记册里的（上游的 `INFORMATION`/`TEXT ATTRIBUTES`/`SERVER PROBLEM`）返回 null。 */
export function severityForLevelXml(name: string | null | undefined): number | null {
  const found = INSPECTION_LEVELS.find(level => level.xml === name)
  return found ? found.severity : null
}

/** LSP severity → 级别名；越界值按默认档（`WARNING`）给。 */
export function levelXmlForSeverity(severity: number): string {
  return INSPECTION_LEVELS.find(level => level.severity === severity)?.xml ?? DEFAULT_LEVEL_XML
}

// ---------------------------------------------------------------- 存储

export const inspectionProfileStore = ref<InspectionProfileStore>(readStored())

function emptyStore(): InspectionProfileStore {
  return { root: DEFAULT_PROFILE_NAME, profiles: { [DEFAULT_PROFILE_NAME]: { tools: {}, locked: false } } }
}

function sanitizeTools(raw: unknown): Record<string, InspectionToolSetting> {
  const tools: Record<string, InspectionToolSetting> = {}
  if (!raw || typeof raw !== 'object') return tools
  for (const [source, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof source !== 'string' || !value || typeof value !== 'object') continue
    const enabled = (value as { enabled?: unknown }).enabled !== false
    const severity = (value as { severity?: unknown }).severity
    const valid = typeof severity === 'number' && SEVERITIES.includes(severity) ? severity : null
    if (enabled && valid === null) continue  // 默认档不落存储（与逐文件级别同口径）
    tools[source] = { enabled, severity: valid }
  }
  return tools
}

function readStored(): InspectionProfileStore {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return emptyStore()
    // 旧版是单份 profile 的 `{ tools }` 形状：整体搬进默认档，不丢用户已有的设置。
    if (parsed.tools && typeof parsed.tools === 'object' && !parsed.profiles) {
      return { root: DEFAULT_PROFILE_NAME, profiles: { [DEFAULT_PROFILE_NAME]: { tools: sanitizeTools(parsed.tools), locked: false } } }
    }
    const profiles: Record<string, StoredInspectionProfile> = {}
    const rawProfiles = parsed.profiles
    if (rawProfiles && typeof rawProfiles === 'object') {
      for (const [name, value] of Object.entries(rawProfiles as Record<string, unknown>)) {
        if (typeof name !== 'string' || !name || !value || typeof value !== 'object') continue
        profiles[name] = {
          tools: sanitizeTools((value as { tools?: unknown }).tools),
          locked: (value as { locked?: unknown }).locked === true,
        }
      }
    }
    if (Object.keys(profiles).length === 0) return emptyStore()
    const root = typeof parsed.root === 'string' && profiles[parsed.root] ? parsed.root : Object.keys(profiles)[0]!
    return { root, profiles }
  } catch {
    return emptyStore()
  }
}

function writeStored(store: InspectionProfileStore) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 存储不可用时只影响持久化，当前会话内的设置照常生效。
  }
}

function commit(store: InspectionProfileStore) {
  inspectionProfileStore.value = store
  writeStored(store)
}

function withRoot(store: InspectionProfileStore, root: string): InspectionProfileStore {
  return { ...store, root }
}

// ---------------------------------------------------------------- 当前 profile

/** 当前 profile 的名字（根 profile 名；指向不存在的档时回落到默认档，同 `getProfile(name, true)`）。 */
export function currentProfileName(): string {
  const { root, profiles } = inspectionProfileStore.value
  return profiles[root] ? root : DEFAULT_PROFILE_NAME
}

function storedProfile(name: string): StoredInspectionProfile {
  return inspectionProfileStore.value.profiles[name] ?? { tools: {}, locked: false }
}

/** 当前 profile（`InspectionProfileManager.getCurrentProfile()` 的等价物）。 */
export function currentProfile(): StoredInspectionProfile {
  return storedProfile(currentProfileName())
}

/** 当前 profile 的工具表（`getCurrentProfile().getTools()` 的等价物；`inspectionProfile` 是它的 reactive 视图）。 */
export const inspectionProfile = computed<InspectionProfile>(() => ({ tools: currentProfile().tools }))

/** 当前 profile 是否加锁（`InspectionProfileImpl.isProfileLocked`；锁住的档导出时写 `is_locked="true"`）。 */
export function isProfileLocked(): boolean {
  return currentProfile().locked
}

// ---------------------------------------------------------------- profile 清单与切换

/**
 * 清单（`InspectionProfileSchemesModel.getSortedProfiles` 的有界版：按名排序；本仓只有工程级一份，
 * 上游的「应用级 + 工程级」两段合并退化成一段）。当前 profile 排在最前，便于菜单呈现。
 */
export function profileNames(): string[] {
  const names = Object.keys(inspectionProfileStore.value.profiles).sort((a, b) => a.localeCompare(b))
  const root = currentProfileName()
  return [root, ...names.filter(name => name !== root)]
}

/** 切到指定 profile（`setRootProfile(name)`）。档不存在返回 false。 */
export function selectProfile(name: string): boolean {
  if (!inspectionProfileStore.value.profiles[name]) return false
  commit(withRoot(inspectionProfileStore.value, name))
  return true
}

/**
 * 复制一份 profile（`InspectionProfileImpl.copyFrom`：整份工具表 + 级别覆盖一起搬过去）。
 * 返回新档名；名字已存在或为空时返回 null。
 */
export function duplicateProfile(name: string, newName: string): string | null {
  const store = inspectionProfileStore.value
  const source = store.profiles[name]
  const target = newName.trim()
  if (!source || !target || store.profiles[target]) return null
  commit({ ...store, profiles: { ...store.profiles, [target]: { tools: { ...source.tools }, locked: source.locked } } })
  return target
}

/** 改名（`SchemesModel.renameScheme`）。目标名已存在时返回 false。 */
export function renameProfile(name: string, newName: string): boolean {
  const store = inspectionProfileStore.value
  const target = newName.trim()
  if (!store.profiles[name] || !target || store.profiles[target]) return false
  const profiles: Record<string, StoredInspectionProfile> = {}
  for (const [key, value] of Object.entries(store.profiles)) profiles[key === name ? target : key] = value
  commit(withRoot({ ...store, profiles }, store.root === name ? target : store.root))
  return true
}

/**
 * 删除一份 profile（`InspectionProfileSchemesModel.canDeleteScheme`：至少要还剩一份，否则返回 false；
 * 删掉的是当前 profile 时根档落到剩下的第一份）。
 */
export function deleteProfile(name: string): boolean {
  const store = inspectionProfileStore.value
  if (!store.profiles[name] || Object.keys(store.profiles).length <= 1) return false
  const profiles = { ...store.profiles }
  delete profiles[name]
  commit(withRoot({ ...store, profiles }, store.root === name ? Object.keys(profiles).sort((a, b) => a.localeCompare(b))[0]! : store.root))
  return true
}

/** 加锁/解锁（`InspectionProfileImpl.lockProfile`）。锁住的档在本仓不改写（导出时带 `is_locked="true"`）。 */
export function setProfileLocked(name: string, locked: boolean): boolean {
  const store = inspectionProfileStore.value
  const profile = store.profiles[name]
  if (!profile) return false
  commit({ ...store, profiles: { ...store.profiles, [name]: { ...profile, locked } } })
  return true
}

// ---------------------------------------------------------------- 逐检查器设置

/** 某个检查器在当前 profile 里的设置；未登记 = 启用 + 不覆盖级别（上游的默认档）。 */
export function toolSettingFor(source: string): InspectionToolSetting {
  return currentProfile().tools[source] ?? { enabled: true, severity: null }
}

function put(source: string, setting: InspectionToolSetting) {
  const store = inspectionProfileStore.value
  const name = currentProfileName()
  const tools = { ...storedProfile(name).tools }
  if (setting.enabled && setting.severity === null) delete tools[source]
  else tools[source] = setting
  commit({ ...store, profiles: { ...store.profiles, [name]: { ...store.profiles[name]!, tools } } })
}

export function setInspectionToolEnabled(source: string, enabled: boolean): void {
  put(source, { ...toolSettingFor(source), enabled })
}

export function setInspectionToolSeverity(source: string, severity: number | null): void {
  put(source, { ...toolSettingFor(source), severity: severity !== null && SEVERITIES.includes(severity) ? severity : null })
}

/** 清掉一个检查器的覆盖（恢复默认）。 */
export function resetInspectionTool(source: string): void {
  const store = inspectionProfileStore.value
  const name = currentProfileName()
  const tools = { ...storedProfile(name).tools }
  delete tools[source]
  commit({ ...store, profiles: { ...store.profiles, [name]: { ...store.profiles[name]!, tools } } })
}

/** 清空当前 profile 的全部覆盖（工具表恢复成默认档；档本身保留）。 */
export function resetInspectionProfile(): void {
  const store = inspectionProfileStore.value
  const name = currentProfileName()
  commit({ ...store, profiles: { ...store.profiles, [name]: { ...store.profiles[name]!, tools: {} } } })
}

// ---------------------------------------------------------------- 聚合门控

/**
 * 聚合门控：返回 null = 这条诊断按当前 profile 停用；否则返回覆盖后的严重度
 * （`severity: null` 设置时原样返回传入值）。
 *
 * 查找顺序 = 身份候选键，具体 → 宽泛（`src/inspectionIdentity.ts` 的 `keys`）：
 * 先「伪检查项」那一档（`#unused` / `#Deprecation`，上游把 tags 折成注册出来的检查项，
 * `HighlightInfoType.java:49-55`），再「检查器::诊断码」，再「检查器」（旧存档唯一的形状），
 * 最后裸码。取**第一个有登记的**键 —— 于是「整个 eslint 停用」与「只停 eslint 的某条规则」
 * 能同时存在，窄的那条赢。
 */
export function applyInspectionProfile(
  source: string, severity: number, code?: string | number | null, tags?: readonly number[] | null,
): number | null {
  const keys = inspectionIdentityOf({ source, code, tags }).keys
  for (const key of keys) {
    const setting = currentProfile().tools[key]
    if (!setting) continue
    return setting.enabled ? setting.severity ?? severity : null
  }
  return severity
}

// ---------------------------------------------------------------- 面板清单
//
// 这里原本有一份 `inspectionSources`（只按 `source` 计数）。它被 `inspectionItems` 取代：
// 上游 profile 的启停粒度是单个检查项 key（`InspectionProfileImpl.java:804`），
// 只按检查器聚合会把同一检查器下的不同诊断码合成一条，面板上就没法只停一条规则了。

// ---------------------------------------------------------------- 检查项清单（诊断码粒度）

/** 面板「检查配置…」里的一行 = 一个检查项身份。 */
export interface InspectionItemEntry {
  /** 身份键（`tools` 表的键；写设置时传它）。 */
  key: string
  /** 检查器名（可能为空）。 */
  source: string
  /** 诊断码（可能为空）。 */
  code: string
  /** 检查项显示名 = 面板/分组的标题（上游 `HighlightDisplayKey` 的显示名）。 */
  label: string
  /** 'unusedSymbol' / 'deprecated' / null（tags 折出来的伪检查项）。 */
  kind: InspectionIdentity['kind']
  count: number
  setting: InspectionToolSetting
  /**
   * 被更宽的那一级停用了（例如整条 `eslint` 关掉后它的某个诊断码仍列在表里）：
   * 值是生效的那把宽键，null = 没有被上级牵连。面板据此标注，不把「本项启用」误读成「它在跑」。
   */
  disabledBy: string | null
}

/**
 * 当前问题表里出现过的**检查项**（比 `inspectionSources` 细一档：同一条 `source` 下的不同
 * 诊断码各算一项，tags 那两档单列成 `Unused declaration` / `Deprecated API usage`）。
 * 对应上游 profile 编辑器按 `HighlightDisplayKey` 逐条列工具的形状
 * （`InspectionProfileImpl.java:804` 的启停粒度）。同键合并计数，按条数降序、同数按名字排。
 */
export function inspectionItems(rows: readonly ProblemRow[]): InspectionItemEntry[] {
  const counts = new Map<string, { identity: InspectionIdentity; count: number }>()
  for (const row of rows) {
    const identity = inspectionIdentityOf({ source: row.source, code: row.code, tags: row.tags })
    const key = identity.key
    const seen = counts.get(key)
    if (seen) seen.count += 1
    else counts.set(key, { identity, count: 1 })
  }
  const tools = currentProfile().tools
  return [...counts.entries()].map(([key, entry]) => {
    const setting = toolSettingFor(key)
    // 上级牵连：候选键里比自己更宽的那些（`<检查器>` 相对 `<检查器>::<码>`）有停用记录时，
    // 生效的是那条 —— 门控也是这么算的（第一个命中的键赢）。
    const own = entry.identity.keys.indexOf(key)
    const disabledBy = entry.identity.keys.slice(own + 1)
      .find(wider => tools[wider] && tools[wider]!.enabled === false) ?? null
    return {
      key,
      source: entry.identity.checker,
      code: entry.identity.code,
      label: entry.identity.label,
      kind: entry.identity.kind,
      count: entry.count,
      setting,
      disabledBy,
    }
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------- profile 的 XML 序列化

/** XML 属性值转义（`class=`/`value=` 里的 `&`、`<`、引号必须转；上游走 `StringUtil.escapeXmlEntities`）。 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

const PROFILE_COMPONENT = 'InspectionProjectProfileManager'

/**
 * 一份 profile 的 XML（`InspectionProfileImpl.writeScheme` 的形状，见
 * `.idea/inspectionProfiles/idea_default.xml:1-3`）。只写 `class`/`enabled`/`level`
 * 三个属性：`enabled_by_default` 不写（本仓没有逐工具默认状态可还原，见文件头）。
 * 档名放在 `<option name="myName" value="…"/>` 里；工程级那份带 `version="1.0"`，
 * 锁住的档带 `is_locked="true"`（`InspectionProfileImpl.java:87-88`）。
 */
export function exportProfileXml(name: string): string {
  const profile = storedProfile(name)
  const tools = Object.keys(profile.tools).sort((a, b) => a.localeCompare(b)).map(source => {
    const setting = profile.tools[source]!
    const level = setting.severity === null ? DEFAULT_LEVEL_XML : levelXmlForSeverity(setting.severity)
    return `    <inspection_tool class="${escapeXml(source)}" enabled="${setting.enabled ? 'true' : 'false'}" level="${level}" />`
  })
  return [
    `<component name="${PROFILE_COMPONENT}">`,
    `  <profile version="1.0"${profile.locked ? ' is_locked="true"' : ''}>`,
    `    <option name="myName" value="${escapeXml(name)}" />`,
    ...tools,
    '  </profile>',
    '</component>',
    '',
  ].join('\n')
}

/**
 * 根 profile 选择那一份（`.idea/inspectionProfiles/profiles_settings.xml:1-6` 的形状：
 * `<settings><option name="PROJECT_PROFILE" value="…"/><version value="1.0"/></settings>`）。
 */
export function exportProfileSettingsXml(root: string): string {
  return [
    `<component name="${PROFILE_COMPONENT}">`,
    '  <settings>',
    `    <option name="PROJECT_PROFILE" value="${escapeXml(root)}" />`,
    '    <version value="1.0" />',
    '  </settings>',
    '</component>',
    '',
  ].join('\n')
}

export interface ParsedInspectionProfile {
  name: string
  locked: boolean
  profile: InspectionProfile
}

function attributeOf(source: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(source)
  return match ? unescapeXml(match[1]!) : null
}

/**
 * 解析一份 profile 的 XML。认 `<component name="InspectionProjectProfileManager">` 的包裹，
 * 也认裸 `<profile>`（上游 `InspectionProfileImpl.copyFrom:174-177` 就是先脱这层壳）。
 *
 * 级别名不在本仓登记册里的（上游 profile 常见的 `INFORMATION`/`TEXT ATTRIBUTES`/`SERVER PROBLEM`
 * —— `.idea/inspectionProfiles/idea_fatal_errors.xml:26-27` 就是）按
 * `InspectionProfileImpl.getErrorLevel:213-218` 的口径回落到 `WARNING`，
 * 且这个回退**写进解析结果**（上游那一行 `setErrorLevel` 就是回写 profile）。
 * 没有 `<option name="myName">` 时用 `fallbackName`（导入对话框给出的名字）。
 */
export function parseProfileXml(text: string, fallbackName: string = DEFAULT_PROFILE_NAME): ParsedInspectionProfile | null {
  const profileElement = /<profile\b([^>]*)>/.exec(text)
  if (!profileElement) return null
  const attrs = profileElement[1]!
  const nameOption = /<option\s+name="myName"\s+value="([^"]*)"\s*\/>/.exec(text)
  const tools: Record<string, InspectionToolSetting> = {}
  for (const match of text.matchAll(/<inspection_tool\b([^>]*?)\/?>/g)) {
    const toolAttrs = match[1]!
    const source = attributeOf(toolAttrs, 'class')
    if (!source) continue
    const enabled = attributeOf(toolAttrs, 'enabled') !== 'false'
    const rawLevel = attributeOf(toolAttrs, 'level')
    // 登记册里没有的级别名 → 回落 WARNING（severity 2），与上游 isSeverityValid 的回退同口径。
    const severity = rawLevel === null ? null : severityForLevelXml(rawLevel)
    const level = rawLevel === null ? null : (severity ?? severityForLevelXml(DEFAULT_LEVEL_XML)!)
    if (enabled && level === null) continue
    tools[source] = { enabled, severity: level }
  }
  return {
    name: nameOption ? unescapeXml(nameOption[1]!) : fallbackName,
    locked: attributeOf(attrs, 'is_locked') === 'true',
    profile: { tools },
  }
}

/** 解析 `profiles_settings.xml`；取不到 `PROJECT_PROFILE` 时返回 null。 */
export function parseProfileSettingsXml(text: string): string | null {
  const match = /<option\s+name="PROJECT_PROFILE"\s+value="([^"]*)"\s*\/>/.exec(text)
  return match ? unescapeXml(match[1]!) : null
}

/**
 * 导入一份 profile：按 `myName`（或 `fallbackName`）注册成新档，`activate` 为真时同时切过去。
 * 返回落地的档名；解析不出 `<profile>` 时返回 null。
 * `is_locked="true"` 的档照上游语义登记成锁住的（工具表照样读，只是标明是只读共享档）。
 */
export function importProfileXml(text: string, options: { fallbackName?: string; activate?: boolean } = {}): string | null {
  const parsed = parseProfileXml(text, options.fallbackName)
  if (!parsed) return null
  const store = inspectionProfileStore.value
  const name = store.profiles[parsed.name] ? `${parsed.name} (导入)` : parsed.name
  const next: InspectionProfileStore = {
    ...store,
    profiles: { ...store.profiles, [name]: { tools: parsed.profile.tools, locked: parsed.locked } },
  }
  commit(options.activate ? withRoot(next, name) : next)
  return name
}

/** 导入根 profile 选择（`PROJECT_PROFILE`）。档不存在时只返回 false，不凭空造档。 */
export function importProfileSettingsXml(text: string): boolean {
  const name = parseProfileSettingsXml(text)
  return name === null ? false : selectProfile(name)
}
