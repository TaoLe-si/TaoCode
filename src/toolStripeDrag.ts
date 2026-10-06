// 工具窗口条（stripe）按钮的拖放：移动到另一侧 + 在目标侧排序 + 落点决定「前半组还是后半组」。
// 对应 IDEA AbstractDroppableStripe。从 App.vue 拆出（桃 2026-09-26：模块化）。
// 拖放状态（draggingTool / dropTarget）由模块自持；其余依赖经 ctx 惰性注入。
// HTML5 事件的读写走统一 DnD 模型（`src/dndModel.ts`），与标签拖放同一条规则。
import { ref } from 'vue'
import { acceptDrop, beginDrag, dropActionForEvent } from './dndModel.ts'
import { splitForDrop, stripeSeparatorIndex } from './toolStripeSplit.ts'

export interface ToolStripeDragContext {
  toolAnchors: () => Record<string, 'left' | 'right' | 'bottom'>
  toolOrder: () => { value: Record<string, string[]> }
  setToolAnchor: (id: string, side: 'left' | 'right' | 'bottom') => void
  saveToolOrder: () => void
  /**
   * 这一侧**正在渲染**的按钮顺序（`src/toolWindowStripes.ts` 的 `stripeOrder(side)`，
   * 已经把后半组排到后面、也滤掉了「从侧栏移除」的那些）。
   * 落点与分隔件必须比在**同一条下标轴**上，所以不能用 `toolOrder` 的原始表。
   */
  stripeIds?: (side: string) => readonly string[]
  /** 某个窗口的后半组身份（`WindowInfo.isSplit`）。与 `setSideTool` 成对给，缺一个就整条不动。 */
  isSplit?: (id: string) => boolean
  /** 改后半组身份（上游 `setSideToolAndAnchor(..., isSplit)`，`AbstractDroppableStripe.kt:255`）。 */
  setSideTool?: (id: string, split: boolean) => void
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

  /**
   * 落点算不算「放进后半组」，并把它写回（上游 `finishDrop` 的第 5 个参数，
   * `AbstractDroppableStripe.kt:250-256`；判据原文 `:463-469`）。
   * 宿主没给 `isSplit`/`setSideTool` 这一对时什么都不做 —— 排序照旧，不猜分组。
   */
  function applyDropGroup(side: string, id: string, before: string | null) {
    if (!ctx.isSplit || !ctx.setSideTool || !ctx.stripeIds) return
    const rendered = ctx.stripeIds(side).filter(item => item !== id)
    // 分隔件画在这儿之前（一个后半组都没有 ⇒ null：上游那种"拖时才把缝挂出来"的落点，
    // 行标记模型给不出"压在缝上"，`splitForDrop` 里写明不猜）。
    const separatorIndex = stripeSeparatorIndex(rendered, ctx.isSplit)
    const at = before ? rendered.indexOf(before) : -1
    const next = splitForDrop(separatorIndex, at >= 0 ? at : rendered.length)
    if (next === null || next === ctx.isSplit(id)) return
    ctx.setSideTool(id, next)
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
    // 先定组再判"有没有动过顺序"：落点跨了分隔件时顺序可能一点没变（同一条纹的同一段），
    // 但 `isSplit` 那一位必须写进去（上游是同一次 `setSideToolAndAnchor` 一起写的）。
    applyDropGroup(side, id, before)
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
