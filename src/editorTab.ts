// 编辑器标签（IDEA 的 EditorTab / FileEditor 那一层的宿主侧表示）—— **共享类型**。
//
// 从 App.vue 搬出来：它被越来越多抽出的模块用到（磁盘同步、标签操作、书签定位…），
// 留在 App 里就只能让每个模块都写一份结构化近似类型，那等于每处都留一个漂移点。
import type { DocumentData } from './bridge'
import type { SurroundTemplate } from './surround'

export interface Tab extends DocumentData { saving: boolean; dirty: boolean; line: number; column: number; lspRunning?: boolean; lspConfigured?: boolean; pinned?: boolean; preview?: boolean }

/** 编辑器实例的宿主侧句柄（CodeEditor 暴露给 App 的那几个能力）。 */
import type { StyledLine } from './htmlExport.ts'

export interface EditorHandle {
  text(): string
  setDraft(value: string): void
  command(name: string): boolean
  expandAtCursor(text: string): boolean
  hasSelection(): boolean
  setReadOnly(value: boolean): void
  surroundWith(template: SurroundTemplate): void
  getCursor(): { line: number; ch: number }
  getCursorCoords(): { left: number; top: number; bottom: number } | null
  /**
   * 导出到 HTML 用（IDEA `ExportToHTMLManager` 从编辑器取高亮与选区）：
   * **已经渲染出来的**行及其颜色，和当前选中的文本（没有选区时为空串）。
   */
  exportStyledLines(): StyledLine[]
  selectionText(): string
}
