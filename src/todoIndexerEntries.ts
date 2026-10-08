// **TODO 索引器的消费层**（上游 `com.intellij.todoIndexer`）—— 把
// `src/ideViewExtensionPoints.ts` 的 `todoIndexersFor` / `indexTodoEntries` 接进 TODO 工具窗口
// （`src/components/TodoPanel.vue`），并补上上游那支**bundled** 的纯文本索引器。
//
// 上游是什么：
//   · EP 声明 `com.intellij.todoIndexer`（`platform/core-api/resources/intellij.platform.core.xml:69`，
//     `beanClass="com.intellij.openapi.fileTypes.FileTypeExtensionPoint"` dynamic="true"），
//     按**文件类型**挂 `TodoIndexer`；
//   · 接口方法面 `map(FileContent): Map<TodoIndexEntry, Integer>`
//     （`platform/indexing-impl/src/com/intellij/psi/impl/cache/impl/todo/TodoIndexer.java`）——
//     把一份文件内容折成 TODO 条目；消费点是索引器 `TodoIndexers.needsTodoIndex` 之后那一步
//     （`TodoIndexers.java:31-56`），条目进索引、由 TODO 工具窗口读出来；
//   · bundled 那支是 `PlainTextTodoIndexer`
//     （`platform/analysis-impl/resources/intellij.platform.analysis.impl.xml:127`
//     `<todoIndexer filetype="PLAIN_TEXT" implementationClass="com.intellij.psi.impl.cache.impl.todo.PlainTextTodoIndexer"/>`），
//     另有 Java/Kotlin/XML/Python… 各语言一支。
//
// 本仓此前：EP 声明与消费函数（`todoIndexersFor` / `indexTodoEntries`）都在，但**没有任何调用点**，
// 也没有 bundled 索引器 —— 第三方按 id 挂一个「给某类文件建 TODO 条目」的索引器在本仓无处生效。
// 本模块补两头：
//   ① 把上游那支 `PlainTextTodoIndexer` 按同名 id 作为 bundled 贡献登记进来（模式表由宿主灌，
//      见 `setTodoIndexerPatterns`）；
//   ② 给出 `providerTodoIndexerPaths` / `providerTodoItems` 两条入口，供
//      `src/components/TodoPanel.vue` 在扫描结果上合并**第三方索引器**给出的条目。
//
// 与上游的如实差异：上游索引器只做粗筛计数、位置由 `IndexPatternSearcher` 事后定位；本仓
// `map` 直接给出 `{pattern, text, line}`（`TodoIndexEntry` 的可移植面）。上游的 `FileContent`
// 收成 `{ path, text }`（与 `src/ideViewExtensionPoints.ts` 同一口径）。
//
// 纯数据层：只 import `src/ideViewExtensionPoints.ts` / `src/todoView.ts` / `src/settingsModel.ts`
// 的类型，不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/todo-indexer-entries.test.mjs`。

import {
  registerTodoIndexer, todoIndexerEntriesFor, todoIndexersFor,
  type TodoIndexEntry, type TodoIndexerContribution,
} from './ideViewExtensionPoints.ts'
import { markerMatches, type TodoPatternView } from './todoView.ts'

/** 上游 bundled 纯文本索引器的类名（`analysis.impl.xml:127`）。 */
export const PLAIN_TEXT_TODO_INDEXER_ID = 'PlainTextTodoIndexer'

/**
 * bundled 索引器用的模式表。上游 `PlainTextTodoIndexer` 读全局 `TodoConfiguration`；本仓的模式
 * 表是**项目级**的（`ProjectSettings.todoPatterns`），所以由宿主（TodoPanel）灌进来。
 * 空表 ⇒ `map` 什么都不给（没有定义任何标记就没有任何 TODO，与 `keepPatternHits` 同一口径）。
 */
let patterns: readonly TodoPatternView[] = []

/** 宿主灌入当前项目的 TODO 模式（幂等；TodoPanel 在 `patterns` 变化时调用）。 */
export function setTodoIndexerPatterns(next: readonly TodoPatternView[]): void {
  patterns = [...next]
}

/** 当前索引器模式表（诊断/判据用）。 */
export function todoIndexerPatterns(): readonly TodoPatternView[] {
  return patterns
}

/** 一行文本命中的**全部**模式（上游索引器按每条模式分别记一个条目，不是首条命中）。 */
export function todoEntriesFromText(text: string, table: readonly TodoPatternView[]): TodoIndexEntry[] {
  const out: TodoIndexEntry[] = []
  const lines = text.split(/\r?\n/)
  for (let line = 0; line < lines.length; ++line) {
    for (const entry of table) {
      if (!entry.pattern) continue
      if (markerMatches(lines[line], entry.pattern, entry.caseSensitive)) {
        out.push({ pattern: entry.pattern, text: lines[line].trim(), line })
      }
    }
  }
  return out
}

/** 上游 `PlainTextTodoIndexer` 的本仓等价物（`fileType` 空 = 任意文件类型，与 EP 的 `FileTypeExtensionPoint` 同义）。 */
export function plainTextTodoIndexer(): TodoIndexerContribution {
  return {
    id: PLAIN_TEXT_TODO_INDEXER_ID,
    map: ({ text }) => todoEntriesFromText(text, patterns),
  }
}

let registered = false

/** 登记 bundled 的纯文本索引器（幂等，与 `src/extensionPoints.ts` 末尾同一纪律）。 */
export function registerBundledPlainTextTodoIndexer(): void {
  if (registered) return
  registered = true
  registerTodoIndexer(plainTextTodoIndexer(), { source: 'bundled' })
}

// 模块加载即登记（bundled 贡献必须真的在表里，消费端才拿得到）。
registerBundledPlainTextTodoIndexer()

// ── 第三方索引器的消费面（TodoPanel 用） ────────────────────────────────────────────────────

/** 一条第三方索引器给出的 TODO 条目（面板行的形状，与 `src/todoTree.ts` 的 `TodoItem` 兼容）。 */
export interface ProviderTodoItem {
  path: string
  line: number
  text: string
  kind: string
}

/**
 * 这些路径里，哪些**有第三方（`source: 'user'`）索引器**认领 —— 只有这些才值得为它读一次文件。
 * bundled 那支与 `search.run` 的命中重合（同一份模式表），所以不算在"需要补条目"里，
 * 于是**没有第三方索引器时本函数恒空、TodoPanel 一次文件都不读**（既有行为零改动）。
 */
export function providerTodoIndexerPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    const providerIds = new Set(todoIndexersFor(path).map(indexer => indexer.id))
    const hasUserIndexer = todoIndexerEntriesFor(path).some(
      entry => entry.source === 'user' && providerIds.has(entry.value.id),
    )
    if (hasUserIndexer) out.push(path)
  }
  return out
}

/**
 * 一份文件内容经索引器折出的面板行。
 *
 * `userOnly`（缺省 **true**）：只取第三方（`source: 'user'`）索引器 —— bundled 那支
 * `PlainTextTodoIndexer` 与 `search.run` 用的是**同一份模式表**，把它并进来只会给同一个文件
 * 重复出条目（本仓既有行为会变），所以面板只并第三方那几支。要给 bundled 也出条目（例如
 * `indexTodoEntries` 那条路径）传 `userOnly: false`。
 *
 * `kind` 取命中的那条模式的说明（与 `keepPatternHits` 同一口径）；模式表里找不到说明时退回模式串。
 * 同一 `(行, 模式)` 只留一条（上游索引是 `Map<TodoIndexEntry, Integer>`，天然去重）。
 */
export function providerTodoItems(
  path: string, text: string, table: readonly TodoPatternView[], options: { userOnly?: boolean } = {},
): ProviderTodoItem[] {
  const userOnly = options.userOnly ?? true
  const descriptionOf = new Map(table.map(entry => [entry.pattern, entry.description || entry.pattern]))
  const userIds = new Set(todoIndexerEntriesFor(path).filter(entry => entry.source === 'user').map(entry => entry.value.id))
  const items: ProviderTodoItem[] = []
  const seen = new Set<string>()
  for (const indexer of todoIndexersFor(path)) {
    if (userOnly && !userIds.has(indexer.id)) continue
    let entries: readonly TodoIndexEntry[]
    try { entries = indexer.map({ path, text }) } catch { continue }
    for (const entry of entries) {
      const key = `${entry.line}\u0000${entry.pattern}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ path, line: entry.line + 1, text: entry.text, kind: descriptionOf.get(entry.pattern) ?? entry.pattern })
    }
  }
  return items
}

/**
 * 把第三方索引器给出的条目并进扫描结果（`path + line + text` 去重，后到的留原序）。
 * 没有额外条目时**原样返回入参**（既有行为零改动）。
 */
export function mergeTodoItems<T extends { path: string; line: number; text: string }>(
  base: readonly T[], extra: readonly T[],
): T[] {
  if (!extra.length) return [...base]
  const seen = new Set(base.map(item => `${item.path}\u0000${item.line}\u0000${item.text}`))
  const out = [...base]
  for (const item of extra) {
    const key = `${item.path}\u0000${item.line}\u0000${item.text}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
