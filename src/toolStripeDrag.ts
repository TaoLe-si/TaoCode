// 工具窗口条（stripe）按钮的拖放：移动到另一侧 + 在目标侧排序。
// 对应 IDEA AbstractDroppableStripe。从 App.vue 拆出（桃 2026-09-26：模块化）。
// 拖放状态（draggingTool / dropTarget）由模块自持；其余依赖经 ctx 惰性注入。
// HTML5 事件的读写走统一 DnD 模型（`src/dndModel.ts`），与标签拖放同一条规则。
import { ref } from 'vue'
import { acceptDrop, beginDrag, dropActionForEvent } from './dndModel.ts'

export interface ToolStripeDragContext {
  toolAnchors: () => Record<string, 'left' | 'right' | 'bottom'>
  toolOrder: () => { value: Record<string, string[]> }
  setToolAnchor: (id: string, side: 'left' | 'right' | 'bottom') => void
  saveToolOrder: () => void
}

export function createToolStripeDrag(ctx: ToolStripeDragContext) {
  const draggingTool = ref<string | null>(null)
  const dropTarget = ref<{ side: string | null; before: string | null } | null>(null)

  function onToolDragStart(id: string, event: DragEvent) {
    draggingTool.value = id
    beginDrag(event, { text: id, action: 'move' })
  }

  function onToolDragOver(side: string, before: string | null, event: DragEvent) {
    if (!draggingTool.value) return
    dropTarget.value = { side, before }
    acceptDrop(event, dropActionForEvent(event) ?? 'move')
  }

  function onToolDrop(side: 'left' | 'right' | 'bottom', before: string | null, event: DragEvent) {
    event.preventDefault()
    const id = draggingTool.value
    draggingTool.value = null
    dropTarget.value = null
    if (!id) return
    // Dropping onto a stripe both moves the window to that side and reorders it there.
    const anchor = ctx.toolAnchors()[id] ?? 'left'
    if (anchor !== side) ctx.setToolAnchor(id, side)
    // `before === id` 是"落点就是被拖的那个按钮自己"（宿主把按钮 id 当 before 传进来）——
    // 原地松手不该换次序。旧实现会先把它从表里摘掉再 `indexOf(id)`（-1）⇒ 一路 push 到末尾，
    // 于是在自家按钮上按一下再松手都会把窗口挪到侧条最后。
    if (before === id) {
      if (anchor !== side) ctx.saveToolOrder()
      return
    }
    const list = ctx.toolOrder().value[side] ?? []
    const order = list.filter(item => item !== id)
    const index = before ? order.indexOf(before) : -1
    if (index >= 0) order.splice(index, 0, id)
    else order.push(id)
    // 位置没变就不写盘（拖动经过自家按钮、或在表尾落下，都不该产生一次存档写入）。
    if (order.length === list.length && order.every((item, at) => item === list[at])) return
    ctx.toolOrder().value[side] = order
    ctx.saveToolOrder()
  }

  function onToolDragEnd() { draggingTool.value = null; dropTarget.value = null }

  function isDropBefore(side: string, id: string) {
    return dropTarget.value?.side === side && dropTarget.value.before === id && draggingTool.value !== id
  }

  return { draggingTool, dropTarget, onToolDragStart, onToolDragOver, onToolDrop, onToolDragEnd, isDropBefore }
}
