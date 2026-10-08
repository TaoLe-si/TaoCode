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
  /**
   * 上游 `AbstractDroppableStripe` 的 `dragTargetChosen` 位（`doLayout` 里每一档认领落点之前都先问
   * `if (processDrop && !data.dragTargetChosen)`，`:354`、`:375`、`:409`、`:436`；只有**一个按钮都没
   * 认领**时那条 `:436-441` 才把落点兜到末尾 `dragInsertPosition = -1`）。
   * DOM 里同一次 `dragover` 会先命中按钮、再冒泡到轨道（轨道自己那条 `dragover` 给的是 `before = null`
   * = 末尾），没有这一位的话轨道的兜底会把按钮已经认领的落点覆盖掉 —— 表现就是"插入线永远画在条尾"。
   * 记的是**事件对象本身**：同一次事件里按钮赢；下一次事件（指针真的移到空白处）末尾才生效。
   */
  let claimedFor: DragEvent | null = null

  function onToolDragStart(id: string, event: DragEvent) {
    draggingTool.value = id
    claimedFor = null
    beginDrag(event, { text: id, action: 'move' })
  }

  function onToolDragOver(side: string, before: string | null, event: DragEvent) {
    if (!draggingTool.value) return
    if (before === null) {
      // 轨道的末尾兜底：同一次事件里已经被某个按钮认领过就不覆盖（`!data.dragTargetChosen`）。
      if (claimedFor === event) return
    }
    else claimedFor = event
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
    // 一次拖放结束就把「谁认领过这次事件」清掉：下一段拖放必须重新认领（残留会把下一次的
    // 末尾落点当成"已被按钮认领过"而永远画不出来）。
    claimedFor = null
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

  /** 拖放结束（含**取消**：Esc 与"在条纹外面松手"都只走这条路，不走 `onToolDrop`）。 */
  function onToolDragEnd() { draggingTool.value = null; dropTarget.value = null; claimedFor = null }

  /**
   * 「这一格前面是不是落点」。`id === null` 问的是**末尾槽**（这条条纹最后一个按钮之后）——
   * 上游同一档就是 `dragInsertPosition = -1`（`AbstractDroppableStripe.kt:436-441`：一个按钮都没
   * 认领这次拖放时，落点兜到末尾）。宿主把这一位直接喂给右侧条也画得出标记，所以两侧对称：
   * 不必依赖调用方自己再算一遍（`App.vue` 现在给左条算了一份、给右条写死 `false`，那条不对称
   * 登记在 `docs/wiring-requests-2026-10-06-dnd8.md` D-1）。
   */
  function isDropBefore(side: string, id: string | null) {
    if (dropTarget.value?.side !== side) return false
    if (id === null) return dropTarget.value.before === null && draggingTool.value !== null
    return dropTarget.value.before === id && draggingTool.value !== id
  }

  return { draggingTool, dropTarget, onToolDragStart, onToolDragOver, onToolDrop, onToolDragEnd, isDropBefore }
}
