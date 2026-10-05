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

/**
 * 提示条文案：大小取排版过的 `formatFileSize`（上游 `StringUtil.formatFileSize`），
 * 并说明降级清单与只读保护。
 */
export function largeFileNoticeText(bytes: number): string {
  return `文件过大（${formatFileSize(bytes)}），已按只读模式打开：语法高亮、语言服务与自动换行已关闭；查找替换仍可用。`
}
