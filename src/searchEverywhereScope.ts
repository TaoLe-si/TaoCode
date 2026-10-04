// 随处搜索的**作用域选择**（上游 `ScopeChooserAction` + `TextSearchContributor.ScopeAction`）。
//
// 上游的形态（`TextSearchContributor.kt:249-268`）：
//   · `ScopeAction` 是一个弹出组，列出 `createScopes()` 的作用域；
//   · 选中一个 ⇒ `setSelectedScope` 后重跑搜索；
//   · `onProjectScopeToggled()` 是那格按钮的**快捷切换**（Ctrl+Alt+P，
//     `ScopeChooserAction.java:119-120` 把 `TOGGLE` 注册在 `WHEN_IN_FOCUSED_WINDOW` 上）：
//     在"项目"与"所有位置"之间来回；
//   · `canToggleEverywhere()`（`:264-266`）是它可不可用的判据 —— 当 everywhere 与 project
//     是同一个作用域时**恒不可切换**（两者没差别）。
//
// 本仓的对应物：
//   · 作用域语言本身早就有（`src/scopes.ts` 的词法/求值，界面在设置页的「作用域」）；
//   · 本仓 SE 只有 Project 那一档是**文件**来源，commands / runConfigs 与作用域无关
//     （上游同理：`ScopeChooserAction` 只挂在 `TextSearchContributor` 与
//     `AbstractGotoSEContributor` 上，也就是文字搜索与 Goto 类）。
//
// **两级作用域**（上游那两个 `ScopeDescriptor`）：
//   项目 = `GlobalSearchScope.projectScope`   → 本仓 = 工作区里的全部文件
//   所有位置 = `GlobalSearchScope.everythingScope` → 本仓 = 外部库也算（本仓没有库索引，
//   所以这一档与"项目"在**当前架构下是同一个集合**）
// 正因为如此，`canToggleEverywhere` 在本仓恒为 false —— 与上游 `:264` 那条判据同一语义，
// 所以那格切换按钮**不渲染**（不放假控件）。

import { compileScope, scopeMatches, type ScopeContext } from './scopes.ts'
import type { NamedScopeSetting } from './settingsModel.ts'

export interface ScopeChoice {
  /** 显示名（上游 `ScopeDescriptor.getDisplayName()`）。 */
  name: string
  /** 该档的表达式；`null` 表示"项目全部文件"（不用过滤）。 */
  expression: string | null
}

/** 项目那一档的显示名（上游 `EverythingGlobalScope.getNameText()` 的对应物在 `SE_EMPTY_TEXT` 里）。 */
export const PROJECT_SCOPE_NAME = '项目'

/**
 * 选择器的候选：**只有真的能筛出东西的那些**。
 *
 * 上游 `createScopes()` 会额外挂一批预定义作用域（Project Files / Project and Libraries /
 * Problems / 变更列表…），本仓没有那套 `CustomScopesProvider`（已在
 * `docs/class-parity-todo.md` §4 登记为缺口），所以这里只列**项目**加用户自己定义的作用域。
 * 列一个筛不出任何东西的档就是放假控件。
 */
export function scopeChoices(named: readonly NamedScopeSetting[]): ScopeChoice[] {
  return [
    { name: PROJECT_SCOPE_NAME, expression: null },
    ...named.map(scope => ({ name: scope.name, expression: scope.pattern })),
  ]
}

/**
 * 按作用域筛一批路径。`expression` 为 null（项目档）时原样放行 —— 上游那一档就是
 * `projectScope`，而本仓的文件清单本来就只含工作区内的文件。
 *
 * 表达式**编译失败**时也原样放行并让调用方去显示错误：上游那里 `ScopeDescriptor` 在选中时
 * 就已经是合法对象，坏表达式根本进不了列表；本仓的列表来自设置页，那里的校验与这里同一套
 * （`src/scopes.ts` 的 `compileScope`），所以坏表达式只在设置被绕过时才会出现。
 */
export function filterByScope<T>(items: readonly T[], pathOf: (item: T) => string, expression: string | null, context: ScopeContext = {}): T[] {
  if (expression === null) return [...items]
  // `compileScope` **抛** `ScopeParseError`（`src/scopes.ts:243-246` 的契约与
  // `PackageSetFactory.compile` 一致），不返回 invalid —— 所以这里必须接住。
  // 接住之后放行而不是清空：列表来自设置页，那里的校验（同一个 `compileScope`）已经拦过一次，
  // 能走到这里的坏表达式意味着设置被绕过；这时"什么都搜不到"比"忽略这条作用域"更难排查。
  let set
  try { set = compileScope(expression) } catch { return [...items] }
  return items.filter(item => scopeMatches(set, pathOf(item), false, context))
}

/**
 * 那格"在项目 / 所有位置之间切换"能不能用（上游 `canToggleEverywhere()`，`:264-266`）。
 * 本仓的两档指向同一个文件集合（没有库索引、也没有索引外文件的概念），所以恒 false。
 * 这个函数存在的意义是**把这条判据写成可检查的**，而不是让界面去猜。
 */
export function canToggleEverywhere(projectDiffersFromEverything = false): boolean {
  return projectDiffersFromEverything
}