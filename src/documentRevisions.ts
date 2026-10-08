// 每篇文档的**修订号** —— 上游 `Document.getModificationStamp()` 在本仓前端的那一份账。
//
// 上游的事实（逐行开过，相对 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/core-api/src/com/intellij/openapi/editor/Document.java:184-192` —— 号本身：
//     "Modification stamp is a value changed by any modification of the content of the file.
//     Note that it is not related to the file modification time."（声明 `:191-192`）；
//   · `platform/core-api/src/com/intellij/openapi/editor/Document.java:25` —— 号挂在**文档**上
//     （"Document is also a ModificationTracker whose stamp is incremented whenever the content changes"），
//     不是挂在某个消费者身上：提交检查、缓存、异常行链接都只是去读它；
//   · `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171` —— 换号动作：
//     每一次 `replaceString` 都领一个新号（不是"内容不同才换"，是"改了一次就换"）；
//   · `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentModStamp.java:6-12` —— 号源：
//     `next()` = `LocalTimeCounter.currentTime()`，所以号**不必递增 1**、也不能当时间戳用；
//   · `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:215-226` ——
//     提交检查就是**每篇文档每次文本变更**作废一次（`documentChanged` 早退 `:218`、取文件 `:221`、
//     过筛 `:222`、`resetCommitChecksResult()` `:223`）。
//
// 为什么这一份账放在模块里而不是 App.vue：本仓的"编辑器内容变了"这一击只落在一处 ——
// `src/lspNavigation.ts` 的 `onEditorChange(tab)`（宿主把它挂在 `@change` 上，CodeMirror 每次
// `docChanged` 都发一次，`src/components/CodeEditor.vue:1010`）。号属于**文档**（上游 `:25` 那条），
// 谁都能读；把它做成一个 prop 从 App.vue 一路传下来，等于让组装层替编辑器记账。
//
// 三条口径（与上游逐字对齐，写在这里免得后来人"顺手优化"）：
//   · **只在真的改过时才换号**：没改 ⇒ 号不动 ⇒ 读它的人（提交检查的指纹）逐字不变 ⇒ 结果仍复用；
//   · **号不是内容哈希**：改回去也算改过（上游 `documentChanged` 就是这样，一次事件作废一次）。
//     哈希会在"改了又改回来"时不作废，那不是上游的判据；
//   · **号也不是文件时间戳**：磁盘时间变了不算改过（上游 `:185` 明说"not related to the file
//     modification time"），保存走的是另一档（宿主的未保存清单 + 变更集）。
//
// 落盘持久化：**没有**。这份账是"这一次会话里哪篇被敲过几下"，跨会话没有意义，
// 也不给 `projects.json` 添新键（本仓因为新增持久化键把用户存档判坏过一次，见 MEMORY）。
import { ref } from 'vue'
import type { DocumentRevision } from './commitChecksResult.ts'

/** 每篇文档的当前号（路径 → 第几次变更）。整体替换才让 Vue 看见变化（同 `referenceContents.ts`）。 */
const stamps = ref<Record<string, number>>({})

/**
 * 一次文档变更记一笔：`onEditorChange` 与两处"程序改正文"的入口调它。
 * 返回新号（调用方不需要，留着是给判据能直接比对"这次真的换号了"）。
 */
export function bumpDocumentRevision(path: string): number {
  const next = (stamps.value[path] ?? 0) + 1
  stamps.value = { ...stamps.value, [path]: next }
  return next
}

/**
 * 当前这份账的快照（提交检查的指纹吃它，见 `src/commitChecksResult.ts` 的 `commitChecksFingerprint`）。
 * 只在真的被编辑过的文档之间取 —— 一篇没在编辑器里出现的文件没有号，也就不进指纹，
 * 这与上游一致：没有 `documentChanged` 就没有作废。
 */
export function documentRevisionList(): DocumentRevision[] {
  return Object.entries(stamps.value).map(([path, revision]) => ({ path, revision }))
}
