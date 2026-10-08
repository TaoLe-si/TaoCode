// 运行仪表盘的**规则层**：上游 `platform/execution.dashboard` 的分组规则、组与行的排序、
// 显示判据、行字段、行动作、状态过滤器。纯逻辑，零 Vue、零 DOM。
//
// ── 与 `src/runDashboard.ts` 的关系（明确） ──────────────────────────────────────
// `runDashboard.ts` **已有**：行模型 `runDashboardRows`、单层按类型分组 `groupRunDashboardRows`、类型开关的 localStorage 读写、汇总文案 —— 本文件**不重写**它们。本文件只补它没有的上游规则，消费方继续用它的行：
//   ① 三条内置分组规则的注册表（`RunDashboardGroupingRule`）；
//   ② 嵌套分组链（`RunDashboardServiceViewContributor.java:126-142`）；
//   ③ 组的排序：权重优先、再自然序（`ServiceModel.java:535-552`）；
//   ④ 显示判据 `isShowInDashboard`（`RunDashboardManagerImpl.java:371-390`）；
//   ⑤ 配置行的排序：上游按 `RunManager.getAllSettings()` 顺序（类型→文件夹→名字），**不是**实例 id；⑥ 行字段面 + 行动作表 + 状态过滤器。
// 输入类型只要求 `{ type, state, folder? }`，`RunDashboardRow` 天然满足。
import { RUN_DASHBOARD_OTHER_TYPE, runDashboardTypeLabel, type RunDashboardRow } from './runDashboard.ts'
import type { RunInstanceRowState } from './runInstances.ts'

// ── 1. 分组规则（RunDashboardGroupingRule） ─────────────────────────────────────
// 接口/EP：`platform/execution.dashboard/src/splitApi/frontend/RunDashboardGroupingRule.java`
//   `:31` EP id；`:38` `getGroup(node)`（null = 这条规则不管它）；`:46` `getName()`
// EP 声明 `platform/execution.dashboard/resources/intellij.platform.execution.dashboard.xml:40-41`

/** EP id（逐字取自上游 `RunDashboardGroupingRule.EP_NAME` 的构造参数，`:31`）。 */
export const RUN_DASHBOARD_GROUPING_RULE_EP = 'com.intellij.runDashboardGroupingRule'

/** 三条内置规则的 kind（= EP 里的 `id`，`intellij.platform.execution.dashboard.xml:56/58/60`）。 */
export type RunDashboardGroupKind = 'type' | 'status' | 'folder'

export interface RunDashboardGroupingRule {
  id: RunDashboardGroupKind
  /** 规则自报的名字（`getName()`），也是开关在 PropertiesComponent 里的键。 */
  name: string
  implementation: string
  /** EP 的 `order` 属性（决定嵌套链里的先后）。 */
  order: string
  /** 开关默认值（`PropertiesComponent.getBoolean(getName(), 默认)`）。 */
  enabledByDefault: boolean
  /** 对应的 `ToggleAction`；`null` = 上游没给这条规则做开关，它恒生效。 */
  toggleAction: string | null
}

/** 三条内置规则，顺序照 EP 的 order 链（`:56` first → `:58` after type → `:60` after status）；
 *  链的顺序就是嵌套层次（`RunDashboardServiceViewContributor.java:131-139`）。 */
export const RUN_DASHBOARD_GROUPING_RULES: readonly RunDashboardGroupingRule[] = [
  {
    id: 'type',
    // ConfigurationTypeDashboardGroupingRule.java:18 NAME；:29 getBoolean(NAME, true) —— 缺省开
    name: 'ConfigurationTypeDashboardGroupingRule',
    implementation: 'com.intellij.platform.execution.dashboard.splitApi.frontend.tree.ConfigurationTypeDashboardGroupingRule',
    order: 'first', enabledByDefault: true,
    // GroupByConfigurationTypeAction.java:8-15（默认 isEnabledByDefault() = true，基类 :65-67）
    toggleAction: 'com.intellij.platform.execution.dashboard.actions.GroupByConfigurationTypeAction',
  },
  {
    id: 'status',
    // StatusDashboardGroupingRule.java:17 NAME；:28 getBoolean(NAME, false) —— 缺省关
    name: 'StatusDashboardGroupingRule',
    implementation: 'com.intellij.platform.execution.dashboard.splitApi.frontend.tree.StatusDashboardGroupingRule',
    order: 'after type', enabledByDefault: false,
    // GroupByConfigurationStatusAction.java:18-20 isEnabledByDefault() = false
    toggleAction: 'com.intellij.platform.execution.dashboard.actions.GroupByConfigurationStatusAction',
  },
  {
    id: 'folder',
    // FolderDashboardGroupingRule.java:19 NAME；:27-34 没有 getBoolean ⇒ 恒生效；无 ToggleAction
    name: 'FolderDashboardGroupingRule',
    implementation: 'com.intellij.platform.execution.dashboard.splitApi.frontend.tree.FolderDashboardGroupingRule',
    order: 'after status', enabledByDefault: true, toggleAction: null,
  },
]

/** 按 id 取规则（认不出返回 undefined，不编一条）。 */
export function runDashboardGroupingRule(id: string): RunDashboardGroupingRule | undefined {
  return RUN_DASHBOARD_GROUPING_RULES.find(rule => rule.id === id)
}

/** 规则开关的持久化形状：规则名 → 是否开启（对应 PropertiesComponent 的 project 级布尔）。 */
export type RunDashboardGroupingSettings = Readonly<Record<string, boolean>>

/** 某条规则此刻开不开（`RunDashboardGroupingRuleToggleAction.java:46-51`）。没开关的恒 true。 */
export function runDashboardGroupingEnabled(
  rule: RunDashboardGroupingRule, settings: RunDashboardGroupingSettings | undefined,
): boolean {
  if (!rule.toggleAction) return true
  const stored = settings?.[rule.name]
  return typeof stored === 'boolean' ? stored : rule.enabledByDefault
}

/** 反转一条规则（`setSelected`，`RunDashboardGroupingRuleToggleAction.java:54-61` 的取反写入）。 */
export function toggleRunDashboardGroupingRule(
  rule: RunDashboardGroupingRule, settings: RunDashboardGroupingSettings | undefined,
): RunDashboardGroupingSettings {
  return { ...(settings ?? {}), [rule.name]: !runDashboardGroupingEnabled(rule, settings) }
}

/** 此刻生效的规则链（照 EP 顺序，过滤掉关掉的）。 */
export function activeRunDashboardGroupingRules(
  settings: RunDashboardGroupingSettings | undefined,
): RunDashboardGroupingRule[] {
  return RUN_DASHBOARD_GROUPING_RULES.filter(rule => runDashboardGroupingEnabled(rule, settings))
}

// ── 2. 状态档（RunDashboardRunConfigurationStatus） ────────────────────────────
// `platform/lang-api/src/com/intellij/execution/dashboard/RunDashboardRunConfigurationStatus.java`：
//   `:21-28` 四常量与权重（STARTED 10 / FAILED 20 / STOPPED 30 / CONFIGURED 40）
//   `:54-57` `getWeight()`（实现 WeighedItem，被组排序读）；`:59-76` `getStatus(descriptor)`
//   `:79-89` `getStatusById`（认不出的 id ⇒ null）
// 组名 bundle 键 `run.dashboard.*.group.name` 在 `platform/execution/resources/messages/
// ExecutionBundle.properties:373-376`；中文取本地化包 `localization-zh.jar` 同名键。

export type RunDashboardStatusId = 'STARTED' | 'FAILED' | 'STOPPED' | 'CONFIGURED'

export interface RunDashboardStatus {
  id: RunDashboardStatusId
  labelKey: string
  /** 组名（中文，本地化包同名键的原文）。 */
  label: string
  /** `getWeight()`（`:54-57`）；组排序第一键。 */
  weight: number
}

/** 四档，顺序照 `:21-28` 的声明序（权重也是这个序）。 */
export const RUN_DASHBOARD_STATUSES: readonly RunDashboardStatus[] = [
  { id: 'STARTED', labelKey: 'run.dashboard.started.group.name', label: '正在运行', weight: 10 },
  { id: 'FAILED', labelKey: 'run.dashboard.failed.group.name', label: '已失败', weight: 20 },
  { id: 'STOPPED', labelKey: 'run.dashboard.stopped.group.name', label: '已完成', weight: 30 },
  { id: 'CONFIGURED', labelKey: 'run.dashboard.configured.group.name', label: '未启动', weight: 40 },
]

function statusById(id: RunDashboardStatusId): RunDashboardStatus {
  const found = RUN_DASHBOARD_STATUSES.find(status => status.id === id)
  if (!found) throw new Error(`内置状态档缺 ${id}`)
  return found
}

/** `getStatusById`（`:79-89`）：认不出返回 null。 */
export function runDashboardStatusById(id: string | null | undefined): RunDashboardStatus | null {
  if (!id) return null
  return RUN_DASHBOARD_STATUSES.find(status => status.id === id) ?? null
}

/** `getStatus(descriptor)`（`:59-76`）的忠实移植。三档入参就是上游读的三件事实。
 *  本仓仪表盘列的是**有 descriptor 的实例** ⇒ 走不到 CONFIGURED；这一档照样实现
 *  （它是上游真判据，状态过滤器也有它一个开关），只是调用点要如实说明本仓落不了地。 */
export function runDashboardStatusFor(
  descriptorPresent: boolean, handlerPresent: boolean,
  exitCode: number | null, terminationRequested: boolean,
): RunDashboardStatus {
  if (!descriptorPresent) return statusById('CONFIGURED')   // `:60-62`
  if (!handlerPresent) return statusById('STOPPED')         // `:64-66`
  if (exitCode === null) return statusById('STARTED')       // `:67-70`
  if (exitCode === 0 || terminationRequested) return statusById('STOPPED')   // `:71-74`
  return statusById('FAILED')                               // `:75`
}

/** 本仓四档 → 上游四档：`ok`（exit 0）与 `stopped`（被停止）在上游都落 STOPPED（`:72-73`
 *  一条判据同时管这两件事）；本仓没有「没有 descriptor」的行 ⇒ 不产出 CONFIGURED。 */
export function runDashboardStatusOfRowState(state: RunInstanceRowState): RunDashboardStatus {
  if (state === 'running') return runDashboardStatusFor(true, true, null, false)
  if (state === 'failed') return runDashboardStatusFor(true, true, 1, false)
  return runDashboardStatusFor(true, true, 0, false)
}

// ── 3. 自然序（NaturalComparator） ──────────────────────────────────────────────
// `platform/util/base/src/com/intellij/openapi/util/text/NaturalComparator.java`：
//   `:20-27` `compare` 委托 `naturalCompare(s1,s2,len1,len2,true,false)` —— **忽略大小写**
//   `:39-106` 数字段按「位数 → 数值 → 前导空白/零的个数」（`:57-71`）；非数字段 `compareChars`
//   `:100-105` 收尾：更长的大；忽略大小写相等时再按区分大小写比一遍
// 调用点 `StringUtil.naturalCompare`（`platform/util/src/com/intellij/openapi/util/text/StringUtil.java:2691-2693`），
// 被组排序（`ServiceModel.java:551`）与配置排序（`RunConfigurationListManagerHelper.kt:138/241/271`）读。
// 差异：`Strings.compare(ch,ignoreCase)` 是 Java 的 `Character.toLowerCase`，本仓用 JS `toLowerCase()`
// （BMP 内一致）；只影响先后，不影响判据成立与否。
function isDecimalDigit(ch: string): boolean { return ch >= '0' && ch <= '9' }

function compareChars(left: string, right: string, ignoreCase: boolean): number {
  // `:118-119` 的传递性修正：' ' 排在 ' '..'0' 之间那些字符的**后面**
  if (left === ' ' && right > ' ' && right < '0') return 1
  if (right === ' ' && left > ' ' && left < '0') return -1
  const a = ignoreCase ? left.toLowerCase() : left
  const b = ignoreCase ? right.toLowerCase() : right
  return a < b ? -1 : a > b ? 1 : 0
}

function compareCharRange(left: string, right: string, offset1: number, offset2: number, end1: number): number {
  for (let i = offset1, j = offset2; i < end1; i++, j++) {
    const diff = left.charCodeAt(i) - right.charCodeAt(j)
    if (diff !== 0) return diff
  }
  return 0
}

function skipDigits(text: string, start: number, end: number): number {
  let i = start
  while (i < end && isDecimalDigit(text[i]!)) i++
  return i
}

function skipChar(text: string, start: number, end: number, ch: string): number {
  let i = start
  while (i < end && text[i] === ch) i++
  return i
}

function naturalCompareImpl(
  left: string, right: string, length1: number, length2: number, ignoreCase: boolean, likeFileNames: boolean,
): number {
  let i = 0
  let j = 0
  for (; i < length1 && j < length2; i++, j++) {
    const ch1 = left[i]!
    const ch2 = right[j]!
    if ((isDecimalDigit(ch1) || ch1 === ' ') && (isDecimalDigit(ch2) || ch2 === ' ')) {
      const start1 = skipChar(left, skipChar(left, i, length1, ' '), length1, '0')
      const start2 = skipChar(right, skipChar(right, j, length2, ' '), length2, '0')
      const end1 = skipDigits(left, start1, length1)
      const end2 = skipDigits(right, start2, length2)
      const lengthDiff = (end1 - start1) - (end2 - start2)   // 位数多的那个大（`:57-59`）
      if (lengthDiff !== 0) return lengthDiff
      const numberDiff = compareCharRange(left, right, start1, start2, end1)   // 位数相同比数值
      if (numberDiff !== 0) return numberDiff
      const fullLengthDiff = (end1 - i) - (end2 - j)   // 再比含前导空白/零的整段长度
      if (fullLengthDiff !== 0) return fullLengthDiff
      const leadingDiff = compareCharRange(left, right, i, j, start1)
      if (leadingDiff !== 0) return leadingDiff
      i = end1 - 1
      j = end2 - 1
    }
    else if (likeFileNames) {
      if (ch1 !== ch2) {
        let diff: number
        if (ch1 === '-' && ch2 !== '_') diff = compareChars('_', ch2, ignoreCase)
        else if (ch2 === '-' && ch1 !== '_') diff = compareChars(ch1, '_', ignoreCase)
        else diff = compareChars(ch1, ch2, ignoreCase)
        if (diff !== 0) return diff
      }
    }
    else {
      const diff = compareChars(ch1, ch2, ignoreCase)
      if (diff !== 0) return diff
    }
  }
  if (i < length1) return 1
  if (j < length2) return -1
  if (length1 !== length2) return length1 - length2
  return ignoreCase ? naturalCompareImpl(left, right, length1, length2, false, likeFileNames) : 0
}

/** `NaturalComparator.INSTANCE.compare`（`:20-27`：忽略大小写、按文件名规则）。 */
export function naturalCompare(left: string, right: string): number {
  return naturalCompareImpl(left, right, left.length, right.length, true, true)
}

// ── 4. 组的排序（ServiceModel.compareGroups） ───────────────────────────────────
// `platform/execution.serviceView/src/ServiceModel.java`：
//   `:516-533` `addGroupOrdered`：组插到第一个「比它大」的组前；碰到 ServiceNode 就插在它前面
//             （同层里**组在行之前**）
//   `:535-552` `compareGroups`：都带权重先比 `getWeight()` 差（`:543`）；一方带权重则它在前（`:540-548`）；
//             否则/权重相等时比 `StringUtil.naturalCompare(显示名)`（`:549-551`）
// `RunDashboardServiceViewContributor.java:475-482` 组的 `getWeight()`：value 是 WeighedItem 才取它，否则 **0**。
// 于是：status 组权重 10/20/30/40；type 组与 folder 组的 value 是 String ⇒ 权重 0。

export interface RunDashboardWeightedGroup {
  /** 上游 value 是不是 WeighedItem（`RunDashboardServiceViewContributor.java:477-481`）。 */
  weighed: boolean
  weight: number
  name: string
}

/** `compareGroups`（`:535-552`）：权重优先、再自然序；返回 <0 表示 left 在前。 */
export function compareRunDashboardGroups(left: RunDashboardWeightedGroup, right: RunDashboardWeightedGroup): number {
  if (left.weighed !== right.weighed) return left.weighed ? -1 : 1
  if (left.weighed) {
    const diff = left.weight - right.weight
    if (diff !== 0) return diff
  }
  return naturalCompare(left.name, right.name)
}

// ── 5. 配置行的排序（RunManager.getAllSettings 的顺序） ───────────────────────────
// 行的顺序来自 `RunDashboardManagerImpl.syncConfigurations()`（`:621-656`）遍历 `RunManager.getAllSettings()`（`:623`）的那个顺序；`getAllSettings`（`platform/execution-impl/src/com/intellij/execution/impl/RunManagerImpl.kt:686-695`）的排序在 `RunConfigurationListManagerHelper.kt`：
//   `:146-169` 有用户拖拽顺序用 `doCustomSort`，否则（`:157-160`）`sortAlphabetically`
//   `:131-144` `sortAlphabetically`：类型 → 文件夹 → **自然序的名字**
//   `:60-89` 类型不同比 `compareTypesForUi`；文件夹不同比在 `folderNames` 里的下标差；同类型同文件夹时**临时配置排后面**（`:79-87`）
//   `:266-273` `compareTypesForUi`：`UnknownConfigurationType` 排最后，其余按显示名自然序
//   `:232-244` `getSortedFolderNames`：出现过的文件夹名自然序，`null` 加在最后
//   `:171-191` `doCustomSort`：按用户下标；两边都没下标时按 `name.compareTo`（区分大小写）
// ⚠️ 本仓没有拖拽 UI（仪表盘是弹层清单）⇒ 默认走无自定义顺序那条；`customOrder` 传了就照 doCustomSort。

/** 排序要看的一行配置的事实（`RunnerAndConfigurationSettings` 的可移植子集）。 */
export interface RunDashboardOrderingEntry {
  name: string
  /** 配置类型 id（本仓 `RunConfig['type']`；认不出用「其它」）。 */
  typeId: string
  typeDisplayName: string
  folder?: string | null
  temporary?: boolean
}

/** 未知类型 id（上游 `UnknownConfigurationType`，`:269-270` 判它排最后）在本仓就是「其它」。 */
export const RUN_DASHBOARD_UNKNOWN_TYPE = RUN_DASHBOARD_OTHER_TYPE

/** `compareTypesForUi`（`:266-273`）。 */
export function compareRunDashboardTypes(left: RunDashboardOrderingEntry, right: RunDashboardOrderingEntry): number {
  if (left.typeId === right.typeId) return 0
  if (left.typeId === RUN_DASHBOARD_UNKNOWN_TYPE) return 1
  if (right.typeId === RUN_DASHBOARD_UNKNOWN_TYPE) return -1
  return naturalCompare(left.typeDisplayName, right.typeDisplayName)
}

/** `getSortedFolderNames`（`:232-244`）：出现过的文件夹名自然序，`null` 加在最后。 */
export function sortedRunDashboardFolderNames(
  entries: readonly RunDashboardOrderingEntry[],
): Array<string | null> {
  const names: string[] = []
  for (const entry of entries) {
    const folder = entry.folder ?? null
    if (folder !== null && !names.includes(folder)) names.push(folder)
  }
  names.sort(naturalCompare)
  return [...names, null]
}

/** `compareByTypeAndFolderAndCustomComparator`（`:60-89`）配 `sortAlphabetically` 的内层
 *  （`:137-139` 自然序名字）。`folderNames` 必须是整份列表算出来的（上游比下标）。
 *  `customOrder` 传了就按 `doCustomSort`（`:171-191`）。 */
export function compareRunDashboardOrdering(
  left: RunDashboardOrderingEntry, right: RunDashboardOrderingEntry,
  folderNames: readonly (string | null)[], customOrder?: Readonly<Record<string, number>>,
): number {
  const typeDiff = compareRunDashboardTypes(left, right)
  if (typeDiff !== 0) return typeDiff
  const folder1 = left.folder ?? null
  const folder2 = right.folder ?? null
  if (folder1 !== folder2) {
    const i1 = folderNames.indexOf(folder1)
    const i2 = folderNames.indexOf(folder2)
    if (i1 !== i2) return i1 - i2
  }
  const temporary1 = left.temporary === true
  const temporary2 = right.temporary === true
  if (temporary1 !== temporary2) return temporary1 ? 1 : -1   // `:79-87` 临时在后
  if (customOrder) {
    const index1 = customOrder[left.name] ?? -1
    const index2 = customOrder[right.name] ?? -1
    if (index1 === -1 && index2 === -1) return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    return index1 - index2
  }
  return naturalCompare(left.name, right.name)   // sortAlphabetically，`:138`
}

/** 按上游顺序排一遍（稳定：同键保持输入顺序）。 */
export function sortRunDashboardOrdering<T extends RunDashboardOrderingEntry>(
  entries: readonly T[], customOrder?: Readonly<Record<string, number>>,
): T[] {
  const folderNames = sortedRunDashboardFolderNames(entries)
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const diff = compareRunDashboardOrdering(a.entry, b.entry, folderNames, customOrder)
      return diff !== 0 ? diff : a.index - b.index
    })
    .map(item => item.entry)
}

/** 从本仓的行取排序用的那几格（类型显示名走 `runDashboardTypeLabel`）。 */
function orderingOf(row: { type: string; title: string; folder?: string | null }): RunDashboardOrderingEntry {
  const typeId = row.type || RUN_DASHBOARD_UNKNOWN_TYPE
  return {
    name: row.title, typeId, typeDisplayName: runDashboardTypeLabel(typeId),
    folder: row.folder ?? null, temporary: false,
  }
}

/** 把本仓的行按上游顺序排（输入 `RunDashboardRow` 形状，输出同序新数组）。 */
export function sortRunDashboardRows<T extends { type: string; title: string; folder?: string | null }>(
  rows: readonly T[], customOrder?: Readonly<Record<string, number>>,
): T[] {
  const entries = rows.map(orderingOf)
  const folderNames = sortedRunDashboardFolderNames(entries)
  return rows
    .map((row, index) => ({ row, entry: entries[index]!, index }))
    .sort((a, b) => {
      const diff = compareRunDashboardOrdering(a.entry, b.entry, folderNames, customOrder)
      return diff !== 0 ? diff : a.index - b.index
    })
    .map(item => item.row)
}

// ── 6. 显示判据（isShowInDashboard） ────────────────────────────────────────────
// `platform/execution.dashboard/src/RunDashboardManagerImpl.java`：
//   `:371-380` `isShowInDashboard`：先问 `isShown`，为假再取 `getBaseConfiguration`（`:392-395`）
//              递归问一次 —— 「委托配置」（复合配置成员/包装配置）算在内
//   `:382-390` `isShown`：类型 id 必须在 `myTypes` 里（`:383`）；该类型在 `excludedNewTypes` 里
//              ⇒ 只有在 `myShownConfigurations` 里才算显示（`:384-386`）；否则不在 `myHiddenConfigurations`
//              就算显示（`:387-389`）
//   `:397-399` `isSameConfiguration`：**类型 id 相同且名字相同**（隐藏/显示表的键）
//   `:407-430` `setTypes`：`configurationTypes = types - enableByDefault`、`excludedTypes = enableByDefault - types`
//              （`:414-420`）；`:946-963` `loadState`：`types = configurationTypes ∪ (enableByDefault - excludedTypes)`
//   `:884-891` `getEnableByDefaultTypes`：逐个问 EP `com.intellij.runDashboardDefaultTypesProvider`
// 前端同判据 `splitApi/frontend/FrontendRunDashboardManager.kt:219-224`（按 typeId+name 找）。
// ⚠️ EP `runDashboardDefaultTypesProvider` 在**上游树里没有任何贡献**（`platform/lang-api/resources/
// intellij.platform.lang.xml:151` 只有声明）⇒ 纯平台树里 `getEnableByDefaultTypes()` 是**空集**。
// 本仓照此：默认列表由调用点传。

export interface RunDashboardConfigurationRef { typeId: string; name: string }

/** 判据要看的状态（上游 `RunDashboardManagerImpl.State`，`:1027-1037`）。 */
export interface RunDashboardVisibilityState {
  /** `myTypes`（`:96`）—— 显示哪些配置类型。 */
  types: readonly string[]
  /** `myHiddenConfigurations`（`:97`）—— 显式隐藏的配置。 */
  hidden: readonly RunDashboardConfigurationRef[]
  /** `myShownConfigurations`（`:98`）—— 「默认隐藏新建」的类型里被放回来的配置。 */
  shown: readonly RunDashboardConfigurationRef[]
  /** `myState.excludedNewTypes`（`:1035`）—— 该类型的新建配置默认不进仪表盘。 */
  excludedNewTypes: readonly string[]
}

export function emptyRunDashboardVisibilityState(): RunDashboardVisibilityState {
  return { types: [], hidden: [], shown: [], excludedNewTypes: [] }
}

/** `isSameConfiguration`（`:397-399`）：类型 id 相同**且**名字相同。 */
export function sameRunDashboardConfiguration(
  left: RunDashboardConfigurationRef, right: RunDashboardConfigurationRef,
): boolean {
  return left.typeId === right.typeId && left.name === right.name
}

function containsConfiguration(
  list: readonly RunDashboardConfigurationRef[], candidate: RunDashboardConfigurationRef,
): boolean {
  return list.some(entry => sameRunDashboardConfiguration(entry, candidate))
}

/** `isShown`（`:382-390`）—— 不看委托配置那一层。 */
export function isShownInRunDashboard(
  candidate: RunDashboardConfigurationRef, state: RunDashboardVisibilityState,
): boolean {
  if (!state.types.includes(candidate.typeId)) return false
  if (state.excludedNewTypes.includes(candidate.typeId)) {
    return containsConfiguration(state.shown, candidate)
  }
  return !containsConfiguration(state.hidden, candidate)
}

/** `isShowInDashboard`（`:371-380`）：本配置不算显示时再看它的**委托配置**
 *  （调用点用 `getBaseConfiguration` 那一档取；本仓没有 RunProfile 委托链 ⇒ 由调用点传 null）。 */
export function isShowInRunDashboard(
  candidate: RunDashboardConfigurationRef, state: RunDashboardVisibilityState,
  baseConfiguration: RunDashboardConfigurationRef | null = null,
): boolean {
  if (isShownInRunDashboard(candidate, state)) return true
  return baseConfiguration ? isShownInRunDashboard(baseConfiguration, state) : false
}

/** `getEnableByDefaultTypes`（`:884-891`）：把各 provider 的类型 id 并起来（去重）。 */
export function runDashboardEnableByDefaultTypes(providers: readonly (readonly string[])[]): string[] {
  const result = new Set<string>()
  for (const provider of providers) for (const typeId of provider) result.add(typeId)
  return [...result]
}

export interface RunDashboardTypesState {
  configurationTypes: string[]
  excludedTypes: string[]
  excludedNewTypes: string[]
}

/** `setTypes` 的状态算术（`:414-426`）。`excludedNewTypes` 只保留仍在 `types` 里的类型（`:422`）。 */
export function applyRunDashboardTypes(
  current: RunDashboardTypesState, types: readonly string[], enableByDefault: readonly string[],
): RunDashboardTypesState {
  const wanted = [...new Set(types)]
  return {
    configurationTypes: wanted.filter(typeId => !enableByDefault.includes(typeId)),
    excludedTypes: enableByDefault.filter(typeId => !wanted.includes(typeId)),
    excludedNewTypes: current.excludedNewTypes.filter(typeId => wanted.includes(typeId)),
  }
}

/** `loadState`（`:946-953`）的类型合并：`configurationTypes ∪ (enableByDefault - excludedTypes)`。 */
export function runDashboardTypesFromState(
  state: Pick<RunDashboardTypesState, 'configurationTypes' | 'excludedTypes'>,
  enableByDefault: readonly string[],
): string[] {
  const result = new Set(state.configurationTypes)
  for (const typeId of enableByDefault) {
    if (!state.excludedTypes.includes(typeId)) result.add(typeId)
  }
  return [...result]
}

// ── 7. 分组链与组的身份 ────────────────────────────────────────────────────────
// `RunDashboardServiceViewContributor.java:126-142`：逐条规则问 `getGroup(node)`，非 null 就建组节点，
// 并**把它挂在上一条规则的组下面**（`:135-138`）—— 得到 type → status → folder 的嵌套链。
// 组的身份：`RunDashboardGroupImpl.java:37-50` 只由 value 决定；树节点 id 在
// `RunDashboardServiceViewContributor.java:508-524`：嵌套路径用 `/` 连，叶子段 —— value 是
// `ConfigurationType` 时取它的 id，**否则取 `group.getName()`**（三条内置规则都走 name）。

/** 分组只看这三格（`RunDashboardRow` 结构化兼容）。 */
export interface RunDashboardGroupingInput {
  type: string
  state: RunInstanceRowState
  /** 上游 `RunnerAndConfigurationSettings.getFolderName()`；缺省 = 不在文件夹里。 */
  folder?: string | null
}

export interface RunDashboardGroupPathEntry {
  kind: RunDashboardGroupKind
  /** 组的 value（`RunDashboardGroupImpl.getValue()`）：typeId / 状态 id / 文件夹名。 */
  value: string
  name: string
  /** value 是不是一个「配置类型对象」（上游 getId 那一档；内置规则恒 false）。 */
  valueIsConfigurationType: boolean
  weighed: boolean
  weight: number
}

export interface RunDashboardGroupNode extends RunDashboardWeightedGroup {
  kind: RunDashboardGroupKind
  value: string
  name: string
  /** 树节点 id（`:508-524` 的规则）。 */
  id: string
  children: RunDashboardGroupNode[]
  /** 最深一层组才挂行（上游组节点的孩子才是行）。 */
  rows: RunDashboardGroupingInput[]
}

/** 一条规则对一行给出的组（`getGroup(node)`；null = 这条规则不管这一行）。 */
export function runDashboardGroupEntry(
  rule: RunDashboardGroupingRule, row: RunDashboardGroupingInput,
): RunDashboardGroupPathEntry | null {
  if (rule.id === 'type') {
    // ConfigurationTypeDashboardGroupingRule.java:32-34：value = typeId，name = 类型显示名
    const typeId = row.type || RUN_DASHBOARD_OTHER_TYPE
    return { kind: 'type', value: typeId, name: runDashboardTypeLabel(typeId),
      valueIsConfigurationType: false, weighed: false, weight: 0 }
  }
  if (rule.id === 'status') {
    // StatusDashboardGroupingRule.java:31-34：value = 状态对象（WeighedItem ⇒ 参与权重排序）
    const status = runDashboardStatusOfRowState(row.state)
    return { kind: 'status', value: status.id, name: status.label,
      valueIsConfigurationType: false, weighed: true, weight: status.weight }
  }
  // FolderDashboardGroupingRule.java:29-33：没有文件夹名就返回 null（不进文件夹组）
  const folder = row.folder ?? null
  if (!folder) return null
  return { kind: 'folder', value: folder, name: folder,
    valueIsConfigurationType: false, weighed: false, weight: 0 }
}

/** 逐条规则给一行算它的组链（照 EP 顺序，跳过返回 null 的规则）。 */
export function runDashboardGroupPath(
  row: RunDashboardGroupingInput, settings?: RunDashboardGroupingSettings,
): RunDashboardGroupPathEntry[] {
  const path: RunDashboardGroupPathEntry[] = []
  for (const rule of activeRunDashboardGroupingRules(settings)) {
    const entry = runDashboardGroupEntry(rule, row)
    if (entry) path.push(entry)
  }
  return path
}

/** 组的树节点 id 段（`:508-524`）：value 是配置类型对象取它的 id，**否则取 `getName()`**。 */
function groupSegmentId(entry: RunDashboardGroupPathEntry): string {
  return entry.valueIsConfigurationType ? entry.value : entry.name
}

/** 组链 → 树节点 id（嵌套路径用 `/` 连，`:508-514`）。 */
export function runDashboardGroupPathId(path: readonly RunDashboardGroupPathEntry[]): string {
  return path.map(entry => groupSegmentId(entry)).join('/')
}

export interface RunDashboardGroupingResult {
  groups: RunDashboardGroupNode[]
  /** 没有任何组可挂的行（上游不会出现：type 规则默认开；留着是为了不丢行）。 */
  ungrouped: RunDashboardGroupingInput[]
}

/** 分组：产出**嵌套**组树（同层组按 `compareRunDashboardGroups` 排，行在组之后 ——
 *  `ServiceModel.java:516-533` 把组插到 ServiceNode 前面）。 */
export function groupRunDashboardByRules(
  rows: readonly RunDashboardGroupingInput[], settings?: RunDashboardGroupingSettings,
): RunDashboardGroupingResult {
  const roots: RunDashboardGroupNode[] = []
  const ungrouped: RunDashboardGroupingInput[] = []
  for (const row of rows) {
    const path = runDashboardGroupPath(row, settings)
    if (!path.length) { ungrouped.push(row); continue }
    let level = roots
    for (const entry of path) {
      const key = `${entry.kind}:${entry.value}`
      let node = level.find(candidate => `${candidate.kind}:${candidate.value}` === key)
      if (!node) {
        node = { kind: entry.kind, value: entry.value, name: entry.name,
          id: groupSegmentId(entry), weighed: entry.weighed, weight: entry.weight, children: [], rows: [] }
        level.push(node)
        level.sort(compareRunDashboardGroups)
      }
      if (entry === path[path.length - 1]) node.rows.push(row)
      else level = node.children
    }
  }
  return { groups: roots, ungrouped }
}

/** 组树里所有节点（深度优先、前序）与它们的完整路径 id（`:508-514` 的递归拼接）。 */
export function flattenRunDashboardGroups(
  groups: readonly RunDashboardGroupNode[], parentId = '',
): Array<{ node: RunDashboardGroupNode; pathId: string }> {
  const result: Array<{ node: RunDashboardGroupNode; pathId: string }> = []
  for (const node of groups) {
    const pathId = parentId ? `${parentId}/${node.id}` : node.id
    result.push({ node, pathId })
    result.push(...flattenRunDashboardGroups(node.children, pathId))
  }
  return result
}

// ── 8. 行的字段与图标（RunDashboardServiceDto + FrontendRunConfigurationNode） ──
// 字段面 `platform/execution.dashboard/src/splitApi/RunDashboardServiceDto.kt:12-30`（一行 = 一个 service）。
// 展示规则 `FrontendRunConfigurationNode.java`：
//   `:90-105` 名字：stored 且有 content ⇒ 加粗；stored 无 content ⇒ 常规；非 stored ⇒ 灰色加粗；
//             图标：非 stored 用置灰版
//   `:128-142` 图标：STARTED ⇒ 执行器图标；FAILED ⇒ 状态图标；否则 DTO 的 iconId
//   `:107-111` 之后套 `RunDashboardCustomizer` 定制（本仓没有插件 EP 宿主 ⇒ 不做，见报告）

/** DTO 的字段名，顺序照 `RunDashboardServiceDto.kt:14-29`（一行 = 一个 service 的 13 格）：
 *  uuid / name / iconId / typeId / typeDisplayName / typeIconId / folderName / contentId /
 *  isRemovable / serviceViewId / isStored / isActivateToolWindowBeforeRun / isFocusToolWindowBeforeRun。
 *  `folderName` 与 `contentId` 可空（`:20`/`:22`），其余非空（`iconId` 可空，`:16`）。 */
export const RUN_DASHBOARD_SERVICE_FIELD_NAMES: readonly string[] = [
  'uuid', 'name', 'iconId', 'typeId', 'typeDisplayName', 'typeIconId', 'folderName',
  'contentId', 'isRemovable', 'serviceViewId', 'isStored',
  'isActivateToolWindowBeforeRun', 'isFocusToolWindowBeforeRun',
]

/** 名字的强调档（`FrontendRunConfigurationNode.java:93-102`）。 */
export type RunDashboardNameEmphasis = 'bold' | 'regular' | 'grayed-bold'

export function runDashboardNameEmphasis(isStored: boolean, hasContent: boolean): RunDashboardNameEmphasis {
  if (!isStored) return 'grayed-bold'   // `:100-102`
  return hasContent ? 'bold' : 'regular'   // `:94-99`
}

/** 图标的来源档（`getNodeIcon`，`:128-142`）。 */
export type RunDashboardIconSource = 'executor' | 'status' | 'dto' | 'none'

export function runDashboardIconSource(
  statusId: string | null, hasExecutorIcon: boolean, hasStatusIcon: boolean, hasDtoIcon: boolean,
): RunDashboardIconSource {
  if (statusId === 'STARTED' && hasExecutorIcon) return 'executor'   // `:131-133`
  if (statusId === 'FAILED' && hasStatusIcon) return 'status'        // `:134-136`
  if (hasDtoIcon) return 'dto'                                       // `:137-141`
  return 'none'
}

/** 非 stored 的行图标是置灰版（`:105` 的 `IconLoader.getDisabledIcon`）。 */
export function runDashboardIconDimmed(isStored: boolean): boolean { return !isStored }

// ── 9. 行的动作（RunDashboardContentToolbar / Popup / ViewOptions） ─────────────
// 动作表出处 `platform/execution.dashboard/resources/intellij.platform.execution.dashboard.xml`：
//   `:80-86` 工具条 Run / Stop / ExpandAll / CollapseAll（后两个是平台动作引用）
//   `:87-114` 右键菜单：Edit / Copy / Hide / RestoreHidden / RemoveType / OpenInNewTab /
//             ClearConsole / ClearContent / RestoreConfiguration / Group / Ungroup
//   `:115-125` ViewOptions：GroupByType / GroupByStatus / Filter（四个状态开关）
//   `:126-135` AddConfiguration、DoubleClickRun
// 每个动作的判据抄在下面各条 `update()` 的注释里。

export type RunDashboardActionGroup = 'toolbar' | 'popup' | 'viewOptions' | 'serviceView'

export interface RunDashboardActionContext {
  /** 选中的叶子行数（`RunDashboardActionSelection.kt:25-30`）。 */
  selectionCount: number
  /** 选中里**可跑**的条数（`DashboardExecutorAction.kt:41-49`）。 */
  runnableCount: number
  /** 选中里**在跑**的条数（`lang-impl/.../ExecutorAction.java:101-109`）。 */
  runningCount: number
  /** 有隐藏配置可还原（`RestoreHiddenConfigurationsAction.java:57`）。 */
  hasHiddenConfigurations: boolean
  /** 选中的类型数（`RemoveRunConfigurationTypeAction.java:60-63`）。 */
  selectedTypeCount: number
  /** 选中里控制台**有内容**的条数（`ClearConsoleAction.kt:21-26`）。 */
  consoleWithContentCount: number
  /** 选中里**可清内容**的条数（`ClearContentAction.java:46-56`）。 */
  clearableContentCount: number
  /** 选中里「配置已不在 RunManager 里」的条数（`RestoreConfigurationAction.java:31-33`）。 */
  restorableCount: number
  /** 选中的组是不是全是文件夹组（`UngroupConfigurationsActions.java:30-34`）。 */
  allTargetsAreFolderGroups: boolean
  /** 分组开关当前态（`RunDashboardGroupingRuleToggleAction.java:46-51`）。 */
  groupingEnabled: Readonly<Record<string, boolean>>
  /** `isOpenRunningConfigInNewTab()`（`RunDashboardManagerImpl.java:534-536`，默认 false，`:1036`）。 */
  openRunningConfigInNewTab: boolean
  /** `isDoubleClickRunEnabled()`（`RunDashboardDoubleClickRunAction.kt:44-46`，默认 **true**）。 */
  doubleClickRun: boolean
  /** 双击运行可见否：工具窗口 id 得对得上（`RunDashboardDoubleClickRunAction.kt:25-31`）。 */
  doubleClickRunVisible: boolean
  /** 该动作是不是从右键菜单里调的（多个 `update` 用它决定「不可用时藏还是置灰」）。 */
  fromContextMenu: boolean
}

export function emptyRunDashboardActionContext(): RunDashboardActionContext {
  return {
    selectionCount: 0, runnableCount: 0, runningCount: 0, hasHiddenConfigurations: false,
    selectedTypeCount: 0, consoleWithContentCount: 0, clearableContentCount: 0,
    restorableCount: 0, allTargetsAreFolderGroups: false, groupingEnabled: {},
    openRunningConfigInNewTab: false, doubleClickRun: true, doubleClickRunVisible: false,
    fromContextMenu: false,
  }
}

export interface RunDashboardActionRule {
  /** 动作 id（XML 里的 `id`）。 */
  id: string
  group: RunDashboardActionGroup
  implementation: string
  /** 文案 bundle 键；null = 文案来自 `use-shortcut-of` 指向的动作模板（本轮没取到行号，见报告）。 */
  labelKey: string | null
  label: string | null
  toggle: boolean
  /** 开关默认值（只有开关有）。 */
  defaultOn?: boolean
  /** `update()` 里算出来的可用性。 */
  enabled: (ctx: RunDashboardActionContext) => boolean
  /** `update()` 里算出来的可见性（缺省 = 可用性）。 */
  visible?: (ctx: RunDashboardActionContext) => boolean
}

/** 动作表（顺序照 XML 声明序；纯视觉的 separator 不登记）。 */
export const RUN_DASHBOARD_ACTION_RULES: readonly RunDashboardActionRule[] = [
  // `:71-75`；RunAction.kt:14-26 文案随在跑与否切换
  { id: 'RunDashboard.Run', group: 'toolbar',
    implementation: 'com.intellij.platform.execution.dashboard.actions.RunAction',
    labelKey: 'run.dashboard.run.action.name', label: '运行', toggle: false,
    // DashboardExecutorAction.kt:36-38：enabled = 可跑叶子非空；visible = 选中非空
    enabled: ctx => ctx.runnableCount > 0, visible: ctx => ctx.selectionCount > 0 },
  // `:76-78`；StopAction.kt:14-26
  { id: 'RunDashboard.Stop', group: 'toolbar',
    implementation: 'com.intellij.platform.execution.dashboard.actions.StopAction',
    labelKey: null, label: null, toggle: false,
    // StopAction.kt:21-25：enabled = 有人在跑；visible = enabled 或不在右键菜单
    enabled: ctx => ctx.runningCount > 0, visible: ctx => ctx.runningCount > 0 || !ctx.fromContextMenu },
  // `:88-89`；EditConfigurationAction.java:24-35（单行选中，RunDashboardActionUtils.kt:15-17）
  { id: 'RunDashboard.EditConfiguration', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.EditConfigurationAction',
    labelKey: null, label: null, toggle: false,
    enabled: ctx => ctx.selectionCount === 1, visible: ctx => ctx.selectionCount === 1 || !ctx.fromContextMenu },
  // `:90-91`；CopyConfigurationAction.java:27-38（判据同 Edit）
  { id: 'RunDashboard.CopyConfiguration', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.CopyConfigurationAction',
    labelKey: null, label: null, toggle: false,
    enabled: ctx => ctx.selectionCount === 1, visible: ctx => ctx.selectionCount === 1 || !ctx.fromContextMenu },
  // `:93-94`；HideConfigurationAction.java:30-39，文案带条数
  { id: 'RunDashboard.HideConfiguration', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.HideConfigurationAction',
    labelKey: 'run.dashboard.hide.configuration.action.name', label: '隐藏配置', toggle: false,
    enabled: ctx => ctx.selectionCount > 0 },
  // `:95-96`；RestoreHiddenConfigurationsAction.java:48-70
  { id: 'RunDashboard.RestoreHiddenConfigurations', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.RestoreHiddenConfigurationsAction',
    labelKey: 'run.dashboard.restore.hidden.configurations.popup.action.name', label: '还原隐藏的配置', toggle: false,
    enabled: ctx => ctx.hasHiddenConfigurations },
  // `:97-98`；RemoveRunConfigurationTypeAction.java:35-44
  { id: 'RunDashboard.RemoveType', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.RemoveRunConfigurationTypeAction',
    labelKey: 'run.dashboard.remove.run.configuration.type.action.name', label: '从服务中移除配置类型', toggle: false,
    enabled: ctx => ctx.selectedTypeCount > 0 },
  // `:99-100`；OpenRunningConfigInNewTabAction.java:21-34，默认关（RunDashboardManagerImpl.java:1036）
  { id: 'RunDashboard.OpenRunningConfigInNewTab', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.OpenRunningConfigInNewTabAction',
    labelKey: null, label: null, toggle: true, defaultOn: false, enabled: () => true },
  // `:102-103`；ClearConsoleAction.kt:13-28
  { id: 'RunDashboard.ClearConsole', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.ClearConsoleAction',
    labelKey: null, label: null, toggle: false,
    enabled: ctx => ctx.consoleWithContentCount > 0,
    visible: ctx => ctx.consoleWithContentCount > 0 || !ctx.fromContextMenu },
  // `:104-105`；ClearContentAction.java:38-59
  { id: 'RunDashboard.ClearContent', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.ClearContentAction',
    labelKey: null, label: null, toggle: false,
    enabled: ctx => ctx.clearableContentCount > 0,
    visible: ctx => ctx.clearableContentCount > 0 || !ctx.fromContextMenu },
  // `:106-107`；RestoreConfigurationAction.java:28-38
  { id: 'RunDashboard.RestoreConfiguration', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.RestoreConfigurationAction',
    labelKey: null, label: null, toggle: false,
    enabled: ctx => ctx.restorableCount > 0, visible: ctx => ctx.restorableCount > 0 || !ctx.fromContextMenu },
  // `:109-110`；GroupConfigurationsAction.java:34-40
  { id: 'RunDashboard.GroupConfigurations', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.GroupConfigurationsAction',
    labelKey: 'run.dashboard.group.configurations.title', label: '组配置', toggle: false,
    enabled: ctx => ctx.selectionCount > 0 },
  // `:111-112`；UngroupConfigurationsActions.java:29-35
  { id: 'RunDashboard.UngroupConfigurations', group: 'popup',
    implementation: 'com.intellij.platform.execution.dashboard.actions.UngroupConfigurationsActions',
    labelKey: null, label: null, toggle: false,
    enabled: ctx => ctx.selectionCount > 0 && ctx.allTargetsAreFolderGroups },
  // `:117-118`；GroupByConfigurationTypeAction.java:13-15（默认开）
  { id: 'RunDashboard.GroupByType', group: 'viewOptions',
    implementation: 'com.intellij.platform.execution.dashboard.actions.GroupByConfigurationTypeAction',
    labelKey: null, label: null, toggle: true, defaultOn: true, enabled: () => true },
  // `:119-120`；GroupByConfigurationStatusAction.java:13-20（默认关）
  { id: 'RunDashboard.GroupByStatus', group: 'viewOptions',
    implementation: 'com.intellij.platform.execution.dashboard.actions.GroupByConfigurationStatusAction',
    labelKey: null, label: null, toggle: true, defaultOn: false, enabled: () => true },
  // `:132-135`；RunDashboardDoubleClickRunAction.kt:18-46（默认开）
  { id: 'RunDashboard.DoubleClickRun', group: 'serviceView',
    implementation: 'com.intellij.platform.execution.dashboard.actions.RunDashboardDoubleClickRunAction',
    labelKey: null, label: null, toggle: true, defaultOn: true,
    enabled: ctx => ctx.doubleClickRunVisible, visible: ctx => ctx.doubleClickRunVisible },
]

/** 按 id 取动作规则（认不出返回 undefined）。 */
export function runDashboardActionRule(id: string): RunDashboardActionRule | undefined {
  return RUN_DASHBOARD_ACTION_RULES.find(rule => rule.id === id)
}

/** 某个动作此刻可不可用；认不出的 id 一律 false（不编一个默认可用的动作）。 */
export function runDashboardActionEnabled(id: string, ctx: RunDashboardActionContext): boolean {
  const rule = runDashboardActionRule(id)
  return rule ? rule.enabled(ctx) : false
}

/** 某个动作此刻可不可见（没写 `visible` 就跟 `enabled` 同源）。 */
export function runDashboardActionVisible(id: string, ctx: RunDashboardActionContext): boolean {
  const rule = runDashboardActionRule(id)
  if (!rule) return false
  return rule.visible ? rule.visible(ctx) : rule.enabled(ctx)
}

/** 动作此刻的文案：`Run`/`Rerun` 随「选中里有人在跑」切换（`RunAction.kt:14-26`，
 *  判据 `DashboardExecutorAction.kt:31` 的 `running`）。其余返回表里的固定文案。 */
export function runDashboardActionLabel(id: string, ctx: RunDashboardActionContext): string | null {
  if (id === 'RunDashboard.Run') return ctx.runningCount > 0 ? '重新运行' : '运行'
  const rule = runDashboardActionRule(id)
  return rule ? rule.label : null
}

/** 开关动作此刻的选中态（`ToggleAction.isSelected` 一族）。 */
export function runDashboardActionSelected(id: string, ctx: RunDashboardActionContext): boolean {
  if (id === 'RunDashboard.OpenRunningConfigInNewTab') return ctx.openRunningConfigInNewTab
  if (id === 'RunDashboard.DoubleClickRun') return ctx.doubleClickRun
  if (id === 'RunDashboard.GroupByType' || id === 'RunDashboard.GroupByStatus') {
    const kind = id === 'RunDashboard.GroupByType' ? 'type' : 'status'
    const rule = runDashboardGroupingRule(kind)
    return rule ? ctx.groupingEnabled[rule.name] ?? rule.enabledByDefault : false
  }
  return false
}

// ── 10. 状态过滤器（RunDashboardStatusFilter） ─────────────────────────────────
// `splitApi/frontend/tree/RunDashboardStatusFilter.java:15-33`：记一组「被隐藏的状态」。
// 四个开关的构造顺序 `RunDashboardFilterActionGroup.java:38`：STARTED, FAILED, STOPPED, CONFIGURED
// （**不是**权重序）；`setSelected`（`:88-101`）先改过滤器再 `updateDashboard(true)`。

export interface RunDashboardStatusFilterState {
  /** 被隐藏的状态 id（上游 `myFilteredStatuses`）。 */
  hidden: readonly RunDashboardStatusId[]
}

export function runDashboardStatusVisible(
  statusId: RunDashboardStatusId, filter: RunDashboardStatusFilterState,
): boolean {
  return !filter.hidden.includes(statusId)
}

export function toggleRunDashboardStatusFilter(
  filter: RunDashboardStatusFilterState, statusId: RunDashboardStatusId, visible: boolean,
): RunDashboardStatusFilterState {
  const hidden = filter.hidden.filter(id => id !== statusId)
  if (!visible) hidden.push(statusId)
  return { hidden }
}

/** 行的状态被过滤器挡住就不渲染（`RunDashboardServiceViewContributor.java:401-406`）。 */
export function runDashboardRowVisible(
  row: RunDashboardGroupingInput, filter: RunDashboardStatusFilterState,
): boolean {
  return runDashboardStatusVisible(runDashboardStatusOfRowState(row.state).id, filter)
}

// ── 11. 便捷入口：给本仓的 RunDashboardRow 直接用 ───────────────────────────────

/** 用规则层重排 + 重分组的入口。**不替代** `runDashboard.ts` 的 `groupRunDashboardRows`
 *  （那个是单层类型分组、被 `MainToolbar.vue` 接线中）；这是给「照上游嵌套链分组」的调用点用的。 */
export function runDashboardRuleView(
  rows: readonly RunDashboardRow[], settings?: RunDashboardGroupingSettings,
  filter?: RunDashboardStatusFilterState,
): RunDashboardGroupingResult {
  const visible = filter ? rows.filter(row => runDashboardRowVisible(row, filter)) : rows
  return groupRunDashboardByRules(sortRunDashboardRows(visible), settings)
}
