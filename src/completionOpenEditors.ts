// 「现在开着哪些编辑器、各自正文是什么」—— 上游
// `FileEditorManager.getInstance(project).getAllEditors()` 在本仓前端的等价物
// （使用点 `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/HippieWordCompletionHandler.java:271-278`：
// 循环词补全第一轮在当前文档里走完，就换到**别的已打开文本编辑器**里接着找词；
// `:274` 那条 `anotherEditor != editor` 就是"排除自己"的判据 —— 上游按编辑器对象身份排除，
// 本仓按"正文与当前文档相同"排除**第一条**命中的（编辑器扩展里拿不到 `props.path`，
// 那张表在 `App.vue` 的 `editorRefs`/`groups` 上 —— 见 `docs/wiring-requests-2026-10-06-bucket2c.md` 的 W2）。
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
 * 正文取不到（编辑器已卸载、句柄失效）或抛错的条目**当场清掉** —— 上游那条循环里非 `TextEditor`
 * 的编辑器（`instanceof TextEditor textEditor`，`:272`）本来就不参与，本仓的生产者
 * （`src/lspCompletion.ts` 每次补全查询登记自己）也没有关标签的时机，所以死句柄在**被看见的那一次**
 * 就摘掉，不让它一直占着已卸载的组件作用域。空正文（空文件 / 已卸载）同样不入表。
 */
export function otherOpenEditorTexts(selfText: string): HippieDocument[] {
  const documents: HippieDocument[] = []
  let skippedSelf = false
  for (const [path, read] of openEditors) {
    let text = ''
    try { text = read() } catch { openEditors.delete(path); continue }
    if (!text) { openEditors.delete(path); continue }
    if (!skippedSelf && text === selfText) { skippedSelf = true; continue }
    documents.push({ path, text })
  }
  return documents
}
