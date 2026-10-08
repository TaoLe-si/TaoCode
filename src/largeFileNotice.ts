// 大文件提示条的文案与「隐藏 / 不再显示」持久化（上游 `LargeFileNotificationProvider` 的等价物）。
//
// 上游行为逐条（`LargeFileNotificationProvider.java:36-53`）：
//   · 文案 = 「文件过大，已按只读模式打开」+ `StringUtil.formatFileSize` 的字节大小；
//   · 「隐藏」= 该编辑器实例的用户数据（本仓是会话内状态，见 `CodeEditor.vue` 的 `largeNoticeHidden`）；
//   · 「不再显示」= `PropertiesComponent` 的全局开关（本仓用 `localStorage`，key 见下）。
//
// 只读那半来自 `EditorModel.java:1017`：大文件用 `EditorFactory.createViewer` 造**只读**
// 编辑器；本仓没有第二个编辑器可换，所以在同一视图里 `EditorState.readOnly` 保护，
// 提示条上给一个「解除只读」把保护撤掉（用户明确要求编辑时才放行）。
import { formatFileSize } from './largeFileBytes.ts'
import { largeFileEditorViewFor } from './largeFileViewer.ts'
import type { LargeFileFeatures } from './largeFileMode.ts'

/** 「不再显示」的持久化键（`PropertiesComponent` 的 `large.file.editor.notification.disabled` 等价物）。 */
export const LARGE_FILE_DISABLE_KEY = 'taocode.largeFile.notice.disabled'

export interface NoticeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 浏览器/测试环境共用的取用方式（没有 localStorage 时退化成"从不记住"）。 */
export function noticeStorage(): NoticeStorage | null {
  try {
    const storage = (globalThis as { localStorage?: NoticeStorage }).localStorage
    return storage ?? null
  } catch { return null }
}

/** 上游的 `isTrueValue(DISABLE_KEY)`：存的就是字符串 'true'。 */
export function isLargeFileNoticeDismissed(storage: NoticeStorage | null = noticeStorage()): boolean {
  try { return storage?.getItem(LARGE_FILE_DISABLE_KEY) === 'true' } catch { return false }
}

export function dismissLargeFileNotice(storage: NoticeStorage | null = noticeStorage()): void {
  try { storage?.setItem(LARGE_FILE_DISABLE_KEY, 'true') } catch { /* 隐私模式写不进去：这次会话内仍然隐藏 */ }
}

/** 降级清单文案：按**实际生效的** feature 表列（关掉的才写；全开时退回那句"未降级"）。 */
function featureSummary(features: LargeFileFeatures): string {
  const off: string[] = []
  if (!features.syntaxHighlighting) off.push('语法高亮')
  if (!features.lsp) off.push('语言服务')
  if (!features.wordWrap) off.push('自动换行')
  if (off.length === 3) return '语法高亮、语言服务与自动换行已关闭'
  return off.length ? `${off.join('、')}已关闭` : '未降级任何编辑器能力'
}

/**
 * 提示条文案：大小与降级清单**来自编辑器提供者**（`com.intellij.fileEditorProvider` 的
 * `LargeFileEditorProvider`，消费端 `largeFileEditorViewFor`，见 `src/largeFileViewer.ts`）——
 * 上游这条提示是 `LargeFileNotificationProvider`，它读的正是那个编辑器视图的大小与能力；
 * 本仓把"用哪个编辑器、降级到哪一档"收进 EP，提示文案就跟着 EP 的裁决走：
 *   · 正常：拿到本仓 `LargeFileEditor` 支的视图 ⇒ 大小用 `view.sizeText`、清单用 `view.features`；
 *   · 被抑制器挡住 / 被第三方提供者抢先 ⇒ 退回本地格式化的说法（仍如实写"只读"，
 *     与 CodeEditor 的保护层一致）。
 * `path`/`root` 由调用方给（CodeEditor 那条只给字节，走默认空串 —— 认领只看大小那一支）。
 */
export function largeFileNoticeText(bytes: number, path = '', root = ''): string {
  const view = largeFileEditorViewFor({ path, root, bytes })
  const sizeText = view?.sizeText ?? formatFileSize(bytes)
  const features = view?.features
  return `文件过大（${sizeText}），已按只读模式打开：${features ? featureSummary(features) : '语法高亮、语言服务与自动换行已关闭'}；查找替换仍可用。`
}
