// 「把焦点还给编辑器」—— IDEA `ToolWindowManager.activateEditorComponent()` 的等价物。
//
// 为什么单独一个模块：这句话在本仓有三处需要（状态栏键盘导航回焦点、主工具栏 Esc 回焦点、
// 以后任何"从工具窗口/工具栏回到编辑器"的动作），而它的**难点不在调用，在选择器**：
// `.editor-stage .cm-content` 在分屏或"会话恢复出多个标签组"时会有**多个**，其中隐藏面板里的那个
// `focus()` 是**无声失败**的（`document.activeElement` 不动）。真 exe 里踩到过：
// 主工具栏按 Esc 后焦点留在按钮上，日志里没有任何 focus/blur 事件 —— 因为命中的是隐藏的那个。
//
// 判据（为什么"看得见"就算对）：上游 `activateEditorComponent()` 激活的是**当前那个**编辑器组件，
// 而"当前"在本仓的 DOM 里就是"真的在显示"（`offsetParent !== null`）的第一个；
// 分屏时它是焦点所在那一栏（DOM 顺序 + 可见性已经足够区分，不必再引入 pane 状态）。
export function editorFocusCandidates(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.editor-stage .cm-content, .editor-stage textarea')]
}

/** 取"看得见"的那个候选；一个都看不见时退回第一个（至少不假装成功）。 */
export function pickEditorToFocus(candidates: readonly HTMLElement[]): HTMLElement | null {
  return candidates.find(element => element.offsetParent !== null) ?? candidates[0] ?? null
}

/** 聚焦当前编辑器；成功（`activeElement` 真的动了）返回 true。 */
export function focusActiveEditor(): boolean {
  const target = pickEditorToFocus(editorFocusCandidates())
  if (!target) return false
  target.focus()
  return document.activeElement === target
}
