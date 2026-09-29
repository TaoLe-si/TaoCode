// 工具窗口条（stripe）按钮的拖放：移动到另一侧 + 在目标侧排序。
// 对应 IDEA AbstractDroppableStripe。从 App.vue 拆出（桃 2026-09-26：模块化）。
// 拖放状态（draggingTool / dropTarget）由模块自持；其余依赖经 ctx 惰性注入。
import { ref } from 'vue'

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
    event.dataTransfer?.setData('text/plain', id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function onToolDragOver(side: string, before: string | null, event: DragEvent) {
    if (!draggingTool.value) return
    event.preventDefault()
    dropTarget.value = { side, before }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  function onToolDrop(side: 'left' | 'right' | 'bottom', before: string | null, event: DragEvent) {
    event.preventDefault()
    const id = draggingTool.value
    draggingTool.value = null
    dropTarget.value = null
    if (!id) return
    // Dropping onto a stripe both moves the window to that side and reorders it there.
    if ((ctx.toolAnchors()[id] ?? 'left') !== side) ctx.setToolAnchor(id, side)
    const order = ctx.toolOrder().value[side].filter(item => item !== id)
    const index = before ? order.indexOf(before) : -1
    if (index >= 0) order.splice(index, 0, id)
    else order.push(id)
    ctx.toolOrder().value[side] = order
    ctx.saveToolOrder()
  }

  function onToolDragEnd() { draggingTool.value = null; dropTarget.value = null }

  function isDropBefore(side: string, id: string) {
    return dropTarget.value?.side === side && dropTarget.value.before === id && draggingTool.value !== id
  }

  return { draggingTool, dropTarget, onToolDragStart, onToolDragOver, onToolDrop, onToolDragEnd, isDropBefore }
}
