// 「现在开着哪些编辑器、各自正文是什么」—— 上游
// `FileEditorManager.getInstance(project).getAllEditors()` 在本仓前端的等价物
// （使用点 `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/HippieWordCompletionHandler.java:271-278`：
// 循环词补全第一轮在当前文档里走完，就换到**别的已打开文本编辑器**里接着找词；
// `:274` 那条 `anotherEditor != editor` 就是"排除自己"的判据 —— 上游按编辑器对象身份排除，
// 本仓按"正文与当前文档相同"排除**第一条**命中的（编辑器扩展里拿不到自己的路径）。
//
// 2026-10-06 订正（留痕）：本文件原写着「生产者只能挂在补全查询上、宿主登记待接 = 接线请求 W2」，
// **实际 W2 已经落地**：`src/App.vue:134` 引入这三个导出、`:183` 在编辑器挂载时 `registerOpenEditor`、
// `:187` 关标签时 `unregisterOpenEditor`、`:201`（`closeAllPanes`）换工程/关全部时 `clearOpenEditors`。
// `src/lspCompletion.ts` 里那份登记保留，作为宿主之外的兜底（同一张表、按 path 覆盖，不会重复）。
//
// 上游 `getAllEditors()` 的顺序是工具窗口里内容编辑器的顺序；本仓用 Map 的**插入顺序**
// （= tab 打开顺序），与上游 `LspOpenedFilesService` 那张 `LinkedHashMap` 同一口径
// （`platform/lsp-impl/src/impl/documentSync/LspOpenedFilesService.kt:36` 的"插入序保证可预测顺序"）。
//
// 消费方是 `src/completionUi.ts` 的 Alt+/（`hippieCompletionKeys`）：没有注册者时这张表是空的，
// 换档阶段就没候选 ⇒ 行为退回"只搜当前文档，一轮走完恢复原前缀"（与上游只开一个文件时一致）。
import type { HippieDocument } from './cyclicWordCompletion.ts'

const openEditors = new Map<string, () => string>()

/** 登记一个打开的编辑器（`path` 是标签里的文件路径，`text` 取**实时**正文，不是落盘的那份）。 */
export function registerOpenEditor(path: string, text: () => string): void {
  if (!path) return
  openEditors.set(path, text)
}

/** 关闭标签 / 编辑器卸载：从表里摘掉（上游 `fileClosed` 之后那个编辑器就不在 `getAllEditors()` 里了）。 */
export function unregisterOpenEditor(path: string): void {
  openEditors.delete(path)
}

/** 整表清空（换工程 / 关窗口：`FileEditorManager` 换了一批编辑器，旧的那份不能留）。 */
export function clearOpenEditors(): void {
  openEditors.clear()
}

/** 现在开着几个编辑器（诊断与测试用）。 */
export function openEditorCount(): number {
  return openEditors.size
}

/** 路径列表，按打开顺序（上游 `getAllEditors()` 的 `FileEditor[]` 那一层）。 */
export function openEditorPaths(): string[] {
  return [...openEditors.keys()]
}

/**
 * 「除我以外的打开文档」：`selfText` 是当前编辑器正文，第一条与它相同的条目被当成"自己"跳过。
 * 上游那条循环只**读** `getAllEditors()`（`HippieWordCompletionHandler.java:271-278`），
 * 不会把任何一个编辑器从这张表里摘掉 —— 摘掉只有关标签那一条路（`unregisterOpenEditor`，
 * 宿主在 `src/App.vue:187` 调）。所以本函数遇到**正文取不到 / 抛错 / 空正文**的条目时
 * **跳过但保留登记**：
 *   · 空正文可能就是空文件（上游照样把它算作"打开的编辑器"，只是贡献不出词）；
 *   · 宿主只在编辑器挂载那一刻登记一次（`src/App.vue:183`），此刻 CodeMirror 的 view
 *     可能还没建好 ⇒ 正文暂时是空串。当场摘掉 = 这个标签**永远**离开这张表
 *     （补全查询只替**当前**标签兜底重新登记），跨文档那一档就少一个候选来源。
 * 2026-10-06 订正（留痕）：这里原先是"当场清掉"，理由是"生产者只有补全查询、没有关标签的时机" ——
 * 那个前提随着宿主登记（接线请求 W2）落地已经不成立，判据 `tests/completion-open-editors.test.mjs`。
 */
export function otherOpenEditorTexts(selfText: string): HippieDocument[] {
  const documents: HippieDocument[] = []
  let skippedSelf = false
  for (const [path, read] of openEditors) {
    let text = ''
    try { text = read() } catch { continue }
    if (!text) continue
    if (!skippedSelf && text === selfText) { skippedSelf = true; continue }
    documents.push({ path, text })
  }
  return documents
}
