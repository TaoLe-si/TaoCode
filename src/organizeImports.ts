// 「优化导入」（Code › Optimize Imports, Ctrl+Alt+O）在 LSP 架构下的**请求形状**与**动作筛选**。
//
// 上游落点（唯一参考树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/lsp-impl/src/impl/features/formatter/LspImportOptimizer.kt`
//     —— IntelliJ 自己把 `ImportOptimizer` 接到 LSP 的那一份实现，就是要照抄的形状：
//       - `:20` import 的是常量 `CodeActionKind.SourceOrganizeImports`、`:72` `only = listOf(SourceOrganizeImports)`
//         ⇒ **按 kind 认动作，从不按标题认**；
//       - `:69-72` `CodeActionContext`：`diagnostics = emptyList()`、`triggerKind = CodeActionTriggerKind.Invoked`；
//       - `:77-80` `CodeActionParams(document, Range(Position(0, 0), Position(0, 0)), context)`，
//         范围那一行源码注释写着 `// doesn't matter`
//         ⇒ 整理导入是**文件级**动作，与光标在哪一列无关；
//       - `:42` `supports()` = 「有没有能整理导入的 client」，同样是文件级判定。
//   · 结果侧的账（本仓暂时给不出 `only` 筛选：宿主发 `textDocument/codeAction` 时 context 里只有
//     `diagnostics`，`native/lsp_code_actions.cpp:44-46` 实测无 `only` —— 接线请求
//     `docs/wiring-requests-2026-10-06-refactorfix.md` R2）：
//     `platform/lang-impl/src/com/intellij/codeInsight/actions/OptimizeImportsProcessor.java:278-288`
//     —— 「Imports optimized」那句 hint 只在**至少有一个 optimizer 真改了东西**时才给
//     （`NotificationInfo.NOTHING_CHANGED_NOTIFICATION`，`:292` 是 `isSomethingChanged = false`）。
//
// 消费链路：`src/semanticActions.ts` 的 `runOrganizeImports`（Code 菜单那一行 `code.optimizeImports`
// 与 Ctrl+Alt+O 键位都走它）。
import type { LspCodeAction } from './bridge.ts'

/** LSP 的 `CodeActionKind.SourceOrganizeImports`（上游 `LspImportOptimizer.kt:20` 用的就是这个常量）。 */
export const ORGANIZE_IMPORTS_KIND = 'source.organizeImports'

/**
 * `lsp.request` 的那一份入参（`bridge.ts:876` 的 `request<T>(method, params: Record<string, unknown>)`）。
 * **必须是 `type` 不能是 `interface`**：TS 只给对象字面量类型的**别名**隐式索引签名，
 * `interface` 没有 ⇒ 传给 `Record<string, unknown>` 会报 TS2345（本轮 `vue-tsc -b --force` 实测到的
 * 就是这条，refactor1 留下的那份形状没类型检查过）。形状一字未改。
 */
export type OrganizeImportsRequestParams = {
  kind: 'codeAction'
  path: string
  line: number
  character: number
  diagnostics: []
}

/**
 * 整理导入的请求：位置固定 `(0, 0)`，诊断固定空表（上游 `:70` 与 `:79`）。
 * 单独成函数是因为「用光标位置当范围」是本仓此前的真实缺陷 —— 服务器按范围筛动作时，
 * 光标落在字符串/注释里就可能不给 source 动作，用户看到的是「动一下光标，Ctrl+Alt+O 忽然能用」。
 */
export function organizeImportsRequest(path: string): OrganizeImportsRequestParams {
  return { kind: 'codeAction', path, line: 0, character: 0, diagnostics: [] }
}

/** 标题兜底（`kind` 缺失的老服务器才用）；上游从不按标题找动作。 */
const TITLE_PATTERN = /organize\s*imports|优化导入/i

/**
 * 从服务器给的代码动作里挑「整理导入」那一条：
 *   · 先按 kind 精确比（含 `source.organizeImports.xxx` 这一族子 kind）；
 *   · kind 全都缺的服务器才退回标题；**只要有任何一条填了 kind，就不拿标题去猜**
 *     —— 否则「Add import」这类快速修复的标题一旦被正则命中，就会被当成整理导入应用掉。
 */
export function organizeImportsActionOf(actions: readonly LspCodeAction[]): LspCodeAction | undefined {
  const byKind = actions.find(action =>
    action.kind === ORGANIZE_IMPORTS_KIND || Boolean(action.kind?.startsWith(`${ORGANIZE_IMPORTS_KIND}.`)))
  if (byKind) return byKind
  if (!actions.some(action => !action.kind)) return undefined
  return actions.find(action => TITLE_PATTERN.test(action.title))
}
