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
