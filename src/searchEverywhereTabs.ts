// Search Everywhere 的 **tab 表定制**（上游 `SeTabsCustomizer` 的等价物）。
//
// 上游那份很薄（`platform/searchEverywhere/frontend/src/SeTabsCustomizer.kt`）：
//   · `customizeTabInfo(tabId: String, info: SeTabInfo): SeTabInfo?`（`:17`）——
//     返回 null 就是**这一档不出现**，返回改过的 `SeTabInfo` 就是改名/改位次；
//   · `isTypeFilterEnabled(tabId: String): Boolean = true`（`:25`）——
//     某一档的"类型漏斗"能不能用；注释里特意叮嘱：关掉用户可见的筛选器时
//     要把筛选状态归到干净档，因为用户没有别的入口去清已存的设置（`:22-24`）；
//   · `SeTabInfo(priority: Int, name: String)`（`:29`）。
// priority 的含义写在 `SeTab.kt:31-34`：0..1000，**越大越靠左**。
//
// ⚠️ 判词里还写着"缺 `SeAsyncTabsProvider` 的异步供给"。本树那个文件是
// `platform/searchEverywhere/frontend/src/SeAsyncTabsProvider.kt:7-8` ——
// **类体是空的**（`class SeAsyncTabsProvider { }`，一个成员都没有）。
// 所以那不是缺口：上游在这个版本里就没有实现，移植一个空类等于放假控件。
// 真正的异步供给发生在别处：每档的 `getFilterEditor()` 是 `suspend` 的
// （`SeTab.kt:51`），tab 自己的初值用 `initAsync` 懒算
// （`tabs/classes/SeClassesTab.kt:23`、`tabs/files/SeFilesTab.kt:25`、
//  `tabs/text/SeTextTab.kt:24`），本仓对应的异步供给在 `src/searchEverywhereHost.ts`
// （文件清单 / LSP 符号 / 工程内文本搜索三条真实通道都是异步回来的）。
//
// 本仓的承接：tab 表从 `SEARCH_EVERYWHERE_TABS` 常量变成**可定制的数据**
// —— `visibleEverywhereTabs()` 走一遍 `customizeTabInfo`，按 priority 降序排，
// 返回 null 的档被摘掉。对话框渲染这一份表，类型漏斗那一步过 `isTypeFilterEnabled`。

/** 上游 `SeTabInfo`（`SeTabsCustomizer.kt:29`）。 */
export interface SeTabInfo {
  priority: number
  name: string
}

export interface TabCustomization {
  /** 改名（`SeTabInfo.name`）。 */
  rename?: Record<string, string>
  /** 改位次（`SeTabInfo.priority`）。 */
  reprioritize?: Record<string, number>
  /** 值为 true 表示这一档**不出现**（`customizeTabInfo` 返回 null）。 */
  hidden?: Record<string, boolean>
  /** 某一档的类型漏斗是否可用；缺省 = 可用（上游 `:25` 的默认值就是 true）。 */
  typeFilterEnabled?: Record<string, boolean>
}

const EMPTY: TabCustomization = {}

/** `customizeTabInfo`（`:17`）：返回 null = 这一档不列。 */
export function customizeTabInfo(tabId: string, info: SeTabInfo, customization: TabCustomization = EMPTY): SeTabInfo | null {
  if (customization.hidden?.[tabId]) return null
  const name = customization.rename?.[tabId] ?? info.name
  const priority = customization.reprioritize?.[tabId] ?? info.priority
  return { priority, name }
}

/** `isTypeFilterEnabled`（`:25`）：没提意见时恒为真。 */
export function isTypeFilterEnabled(tabId: string, customization: TabCustomization = EMPTY): boolean {
  return customization.typeFilterEnabled?.[tabId] ?? true
}

/**
 * 排好的 tab 表：**priority 降序**（`SeTab.kt:31-34`「越大越靠左」）。
 *
 * 同分时保持表里的原始先后 —— 上游 `SeTabVm` 也是按 priority 稳定排序，
 * 不给两个同权档一个"看起来随机"的顺序。
 */
export function sortTabsByPriority<T extends { id: string; priority: number }>(tabs: readonly T[]): T[] {
  return tabs.map((tab, index) => ({ tab, index }))
    .sort((left, right) => right.tab.priority - left.tab.priority || left.index - right.index)
    .map(entry => entry.tab)
}

/** 把定制过表（改名/摘档/改位次）并排好序，给对话框直接用。 */
export function visibleEverywhereTabs<T extends { id: string; priority: number; label: string }>(
  tabs: readonly T[],
  customization: TabCustomization = EMPTY,
): (T & { label: string })[] {
  const mapped: T[] = []
  for (const tab of tabs) {
    const info = customizeTabInfo(tab.id, { priority: tab.priority, name: tab.label }, customization)
    if (!info) continue
    mapped.push({ ...tab, label: info.name, priority: info.priority })
  }
  return sortTabsByPriority(mapped)
}
