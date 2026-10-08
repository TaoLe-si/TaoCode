// Agent 面板的**弹层互斥状态**（工具条 + 标题栏共四个：添加菜单 / 模式 / 模型 / 会话库）。
//
// 为什么要单独一个模块：同屏只允许一个弹层是上游 DropdownMenu 的**单例语义**
// （Radix `DropdownMenu` 打开新的会关掉旧的）。原先 `AgentPanel.vue` 里每个控件各持一个
// 布尔，四个能同时打开 —— 视觉上就是「对话框重叠」。状态机写进面板会让那文件更长
// （它已顶在 900 行机检上限），而这条规则本身与渲染无关，可以脱离 Vue 单测。
import { ref, type Ref } from 'vue'

/** 面板上会互相顶掉的弹层。`null` = 都关着。 */
export type AgentPop = 'actionMenu' | 'mode' | 'model' | 'sessions' | null

export interface AgentPopState {
  /** 当前开着哪一个（模板用它做 `v-if` 与 `aria-expanded`）。 */
  open: Ref<AgentPop>
  /** 点触发器：同一个再点就关，换一个则直接切过去（不经过"都关"的中间态）。 */
  toggle(pop: Exclude<AgentPop, null>): void
  /** 全关（Esc、选中一项之后、点别处）。 */
  close(): void
  /** 这个是不是当前开着的（给 `aria-expanded`）。 */
  isOpen(pop: Exclude<AgentPop, null>): boolean
}

export function createAgentPopState(): AgentPopState {
  const open = ref<AgentPop>(null)
  return {
    open,
    toggle(pop) { open.value = open.value === pop ? null : pop },
    close() { open.value = null },
    isOpen: pop => open.value === pop,
  }
}

/**
 * 点面板外的任何地方就关弹层 —— 上游 DropdownMenu 的 `onPointerDownOutside`。
 *
 * 为什么用 `pointerdown` 而不是 `click`：`click` 在拖拽（选文字、拖滚动条）结束时也会触发，
 * 会把用户刚打开的面板关掉。`pointerdown` 是"手指/鼠标刚落下"，与上游一致。
 * 判定"面板外"用 `closest`，所以面板自己的元素（含弹层）都算里面。
 */
export function closeAgentPopsOnOutsidePointer(
  rootSelector: string,
  close: () => void,
  target: Document | null = typeof document === 'undefined' ? null : document,
): () => void {
  if (!target) return () => {}
  const handler = (event: Event) => {
    const node = event.target as { closest?: (selector: string) => unknown } | null
    // 点在面板**里面**（含弹层本身）不关；点在外面（编辑器、别的工具窗口）才关。
    if (node?.closest?.(rootSelector)) return
    close()
  }
  target.addEventListener('pointerdown', handler)
  return () => target.removeEventListener('pointerdown', handler)
}