// 大文件模式。上游 `platform/lang-impl/src/com/intellij/largeFilesEditor/editor/LargeFileEditorProvider.java`
// 在打开文件时按大小换成 `LargeFileEditorImpl`（一个精简的纯文本编辑器，见 `LargeFileEditor.java`
// 的 `isLargeFile` 判定与 `LargeFileNotificationProvider` 的提示气泡）。本仓的编辑器是 CodeMirror
// 单视图（`src/components/CodeEditor.vue`），没有第二个编辑器可换，等价物是**在同一视图里降级**：
//   · 关掉语法高亮（`syntaxHighlighting` 扩展不进编辑器）；
//   · 关掉语言服务（LSP 请求不再发：补全/hover/诊断/语义着色/折叠区间）；
//   · 关掉自动换行与内联补全 —— 大文件的换行计算与幽灵文本是拖慢输入的主要来源。
// 编辑、查找/替换、保存照常（CodeMirror 自身按视口虚拟化，文档不整份复制）。
//
// 阈值取 5 MiB（原先 CodeEditor 里的 `HEAVY_LIMIT` 口径不变，只是搬到这里才可测）。
// 判定按**字符数**而不是字节数：前端拿到的是已解码文本，按字节数要在宿主侧再算一遍，
// 而两者的量级判断一致（5M 字符对 UTF-8 源码接近 5M 字节）。
export const LARGE_FILE_LIMIT = 5 * 1024 * 1024

export interface LargeFileFeatures {
  /** LSP 请求（补全/诊断/语义着色/折叠区间/inlay 等）。 */
  lsp: boolean
  /** 语法高亮（词法着色）。 */
  syntaxHighlighting: boolean
  /** 自动换行（长行的折行计算）。 */
  wordWrap: boolean
}

export interface LargeFilePolicy {
  /** 超过阈值 ⇒ 上面的 features 全关，并在编辑器顶部给出 notice。 */
  large: boolean
  notice: string | null
  features: LargeFileFeatures
}

const FULL: LargeFileFeatures = { lsp: true, syntaxHighlighting: true, wordWrap: true }
const REDUCED: LargeFileFeatures = { lsp: false, syntaxHighlighting: false, wordWrap: false }

export const LARGE_FILE_NOTICE =
  '大文件模式：已关闭语法高亮、语言服务与自动换行；编辑、查找替换与保存不受影响。'

export function largeFilePolicy(contentLength: number): LargeFilePolicy {
  // 负数/NaN 当作空文档（防御宿主或调用方传来的坏值），不误判成大文件。
  const size = Number.isFinite(contentLength) ? Math.max(0, contentLength) : 0
  const large = size >= LARGE_FILE_LIMIT
  return { large, notice: large ? LARGE_FILE_NOTICE : null, features: large ? REDUCED : FULL }
}

// ---------------------------------------------------------------- 大文件模式下的**动作**降级
// 上游不是"关掉功能"了事，而是把动作处理器整个换掉：
// `platform/lang-impl/src/com/intellij/largeFilesEditor/PlatformActionsReplacer.java:22`（类本身）
// 在 `:34-54` 一次性登记，`:56-58` 的 `addDisablingEditorActionHandler(actionId)`
// = `addEditorActionHandler(actionId, LfeEditorActionHandlerDisabled::new)`（`:57`），
// 而 `LfeEditorActionHandlerDisabled` 的 `isEnabledInLfe()` 直接 `return false`
// （`platform/lang-impl/src/com/intellij/largeFilesEditor/actions/LfeEditorActionHandlerDisabled.java:31-36`）。
// 两条通道：`disableActionForLfe`（整条动作换成代理，`:72-74`）用于
// `HighlightUsagesInFile`（`:37`）与 `GotoLine`（`:38`）；`addDisablingEditorActionHandler` 用于
// 编辑器命令 `Replace`（`:48`）· `FindWordAtCaret`（`:49`）· `FindPrevWordAtCaret`（`:50`）·
// `SelectAllOccurrences`（`:51`）· `SelectNextOccurrence`（`:52`）· `UnselectPreviousOccurrence`（`:53`）。
// `Find`（`:47`）**不禁**，换成 `LfeEditorActionHandlerFind`（该类 `isEnabledInLfe()` 恒 true，
// `platform/lang-impl/src/com/intellij/largeFilesEditor/actions/LfeEditorActionHandlerFind.java:26-32`）
// —— 即"只搜不替换"那一档（替换那两条已经被 :48 禁掉）；`FindNext`/`FindPrevious` 同理换成
// 页内搜索档（`:40-41`）。
//
// 本仓的 id 口径（逐条对着本仓的动作表取，不放上游的名字）：
//   · `replace` / `find` / `find.wordAtCaret` / `find.prevWordAtCaret` / `occurrence.select` /
//     `occurrence.next` / `occurrence.unselect` / `usage.highlight`
//     —— `src/menus/editMenu.ts:83-96` 与 `:107` 的 `ctx.editable(<id>, …)`，
//        命令表在 `src/editorCommands.ts:239-249`；
//   · `navigate.gotoLine` —— `src/keymapBindings.ts:110-111`。
export const LARGE_FILE_DISABLED_COMMANDS: readonly string[] = [
  'replace', 'find.wordAtCaret', 'find.prevWordAtCaret',
  'occurrence.select', 'occurrence.next', 'occurrence.unselect',
  'usage.highlight', 'navigate.gotoLine',
]

export type LargeFileCommandGate = 'allowed' | 'blocked' | 'find-only'

/**
 * 某个动作在大文件模式（`heavy === true`）下的处置。`find-only` 只有 `find` 一条：
 * 上游那条换成的是"能开、但没有替换区"的处理器（见上面 `:47` 与 `LfeEditorActionHandlerFind.java:26-32`），
 * 本仓的等价要求 = 查找栏以非替换档打开、替换那一行不出现（宿主挂载点在 `src/components/CodeEditor.vue`
 * 的 `openFindBar` 与 `<EditorFindBar>`，属接线请求）。
 * 未知 id 一律 `allowed`：降级是**白名单式**的，不拿一张可能过期的表去关掉别人的动作。
 */
export function largeFileCommandGate(command: string, heavy: boolean): LargeFileCommandGate {
  if (!heavy) return 'allowed'
  if (command === 'find') return 'find-only'
  return LARGE_FILE_DISABLED_COMMANDS.includes(command) ? 'blocked' : 'allowed'
}

/** 那条动作在大文件里到底能不能按（菜单行 `enabled` 与键位分发都用它）。 */
export function largeFileCommandAllowed(command: string, heavy: boolean): boolean {
  return largeFileCommandGate(command, heavy) !== 'blocked'
}
