// 拖放的**落点**（drop target）：目标装饰（拖到/拖出）+ 「外部文件拖进目录」的完整落点链路。
// 上游坐标：`platform/platform-impl/src/com/intellij/ide/dnd/` 的 `Highlighters.java`、
// `DropTargetHighlighter.java`、`DroppedFileCopy.kt`，加上 `ide-core` 的 `DragAndDropUtil` 那一面。
//
// 判决表 `pf/dnd` 的缺口原文是：
// 「**文件拖入的 drop target** —— 复制计划与 uri-list 解析已就位（`src/dndModel.ts` 的
//   `droppedFileCopyPlan` / `filePathsFromDragData`），但编辑器与文件树都还没有
//   `dragover`/`drop` 挂点，外部文件拖进项目没有入口」。
// 本模块就是那个**挂点**：把已就位的纯函数接成一段 `dragover` / `dragleave` / `drop` 的宿主逻辑，
// 写盘、确认框、进度登记都作为注入的回调传进来（本仓没有 `VirtualFileManager`，
// 也没有 `EelPathTransfer`，抄的是**用户可见的那一面**）。
//
// 抄下来的行为（逐条带坐标）：
//   · `Highlighters.java:31-39` 的注册顺序七个高亮器，与 `src/dndModel.ts` 的
//     `DND_HIGHLIGHTERS` 一致（那一张表已经在上一批落好，这里只补**几何**）；
//   · `RectangleHighlighter._show`（`:226-228`）/ `FilledRectangleHighlighter._show`（`:208-210`）/
//     `BottomHighlighter._show`（`:296-298`）：三个都是 `setBounds(aRectangle)`，只是画法不同 ——
//     矩形（带行底色）、实心矩形（边框+底色）、**只有下边框 2px**（`:292` 的
//     `customLine(BORDER_COLOR, 0, 0, 2, 0)`）；
//   · `HorizontalLinesHighlighter._show`（`:246-250`）：包围盒按箭头图标**四边各撑开**一格
//     （左 `ArrowRight`、上 `ArrowRight`、右 `ArrowLeft`、下 `ArrowRight`）。
//     四个图标都是 16×16（`platform/icons/src/general/arrowRight.svg:2` 等四个文件的 `<svg>` 行），
//     所以撑开量 = 16，不是猜的；
//   · `VerticalLinesHighlighter._show`（`:270-273`）：只在**上/下**各撑开一格（左右不撑）；
//   · `BaseTextHighlighter.show`（`:139-160`）：提示气泡落在**目标矩形的右缘、垂直居中**
//     （`:148` 的 `rec.x + rec.width, rec.y + rec.height / 2`，`:158` 的 `Balloon.Position.atRight`），
//     文案取 `DnDEvent.getExpectedDropResult()`，且整条被 `Registry.is("ide.dnd.textHints")` 门住
//     （`:140`）—— 没开这个开关就什么都不显示；
//   · `DropTargetHighlighter.vanish()`（`:117-124`）：离开即撤，不留残影；
//   · `DroppedFileCopy.copy`（`DroppedFileCopy.kt:58-98`）：取不到文件名的**跳过**（`:60`）、
//     已存在的**先问一次**（`:65-66`）、用户拒绝就 `return emptyList()` **整批不复制**（`:66`）、
//     复制在**后台进度**里逐项报（`:71-77`）、**第一个失败就中断整批**并弹错误（`:78-96`）、
//     返回已复制的那部分（`:97`）；收尾刷新目标目录（`:117-120` 的 `markDirtyAndRefresh`）；
//   · 文案：`IdeBundle.properties:3393-3399` 的 7 个 key。**随 IDE 发货的中文包没有这 7 个 key**
//     （`localization-zh.jar` 的 `messages/IdeBundle.properties` 里只有 `dnd.with.alt.pressed.only`），
//     所以下面的中文是本仓按英文原文自拟，报告里单列。
//   · `isAcrossEnvironments`（`:48-50`）的 EEL 跨环境分支本仓不做（本仓单环境）。

import { ref, type Ref } from 'vue'
import {
  DND_HIGHLIGHT,
  HighlighterRegistry,
  allowedActions,
  applyOverwriteAnswer,
  droppedFileCopyPlan,
  filePathsFromDragData,
  type DnDAction,
  type DragEventLike,
  type DroppedFileCopyItem,
  type DroppedFileCopyPlan,
} from './dndModel.ts'
import { backgroundTaskManager } from './progressTasks.ts'

export interface TargetRect {
  x: number
  y: number
  width: number
  height: number
}

/** 四个箭头图标都是 16×16（`platform/icons/src/general/arrow{Right,Left,Down,Up}.svg` 的 `<svg>` 行）。 */
export const ARROW_ICON_SIZE = 16

/** `BottomHighlighter` 的下边框厚度（`Highlighters.java:292` 的 `customLine(..., 0, 0, 2, 0)` 末位）。 */
export const BOTTOM_HIGHLIGHT_BORDER = 2

/**
 * 一个高亮器要画在哪 —— 照 `Highlighters` 里七个 `_show` 的 `setBounds(...)`。
 * `mask` 命中哪个就算哪个（`Highlighters.show` 的 `(getMask() & aType) != 0` 判据，`:44`）。
 * 返回空数组 = 这一档掩码没有高亮器（例如只给了 FILLED_RECTANGLE 之外的未知位）。
 */
export function highlighterBounds(mask: number, rect: TargetRect, arrowIconSize = ARROW_ICON_SIZE): { name: string; bounds: TargetRect }[] {
  const out: { name: string; bounds: TargetRect }[] = []
  const push = (name: string, bounds: TargetRect) => out.push({ name, bounds })
  if (mask & DND_HIGHLIGHT.RECTANGLE) push('rectangle', { ...rect })
  if (mask & DND_HIGHLIGHT.FILLED_RECTANGLE) push('filledRectangle', { ...rect })
  if (mask & DND_HIGHLIGHT.BOTTOM) push('bottom', { ...rect })
  if (mask & DND_HIGHLIGHT.H_ARROWS) {
    // :247-249 —— 四边各撑开一格（左/上/下用 ArrowRight，右用 ArrowLeft；四个都是 16×16）。
    push('horizontalLines', {
      x: rect.x - arrowIconSize,
      y: rect.y - arrowIconSize,
      width: rect.width + arrowIconSize + arrowIconSize,
      height: rect.height + arrowIconSize,
    })
  }
  if (mask & DND_HIGHLIGHT.V_ARROWS) {
    // :271-272 —— 只在上/下各撑开一格，左右不撑。
    push('verticalLines', {
      x: rect.x,
      y: rect.y - arrowIconSize,
      width: rect.width,
      height: rect.height + arrowIconSize + arrowIconSize,
    })
  }
  return out
}

/** `TextHighlighter`/`ErrorTextHighlighter` 是气球不是矩形（`Highlighters.java:129-174`）。 */
export function highlighterIsBalloon(mask: number): boolean {
  return Boolean(mask & (DND_HIGHLIGHT.TEXT | DND_HIGHLIGHT.ERROR_TEXT))
}

/**
 * 提示气泡的落点（`BaseTextHighlighter.show`，`Highlighters.java:139-160`）：
 * 优先用**别的**高亮器（组件型）当前那一块的右缘，竖直居中；没有就退回目标矩形自己的右缘（`:154`）。
 * 位置档位是 `atRight`（`:158`）—— 本仓记成 `side`，由渲染层翻到锚点右侧。
 */
export function hintAnchor(componentBounds: readonly TargetRect[], target: TargetRect): { x: number; y: number; side: 'right' } {
  const rect = componentBounds[0] ?? target
  return { x: rect.x + rect.width, y: rect.y + rect.height / 2, side: 'right' }
}

/** `Registry.is("ide.dnd.textHints")`（`Highlighters.java:140`）：关着就整条不显示。 */
export function hintVisible(mask: number, expectedResult: string | null | undefined, textHintsEnabled: boolean): boolean {
  if (!textHintsEnabled) return false
  if (!highlighterIsBalloon(mask)) return false
  // :143 —— 没有预期结果就没有可显示的文字（空串也不行）。
  return Boolean(expectedResult && expectedResult.length)
}

// ── 落点装饰的状态机（拖到 / 拖出）────────────────────────────────────────────────────

export interface DropDecoration {
  /** 命中的高亮器掩码（`DnDEvent.setHighlighting` 的那一串）。 */
  mask: number
  /** 目标矩形（元素局部坐标，渲染层自己换算成视口坐标）。 */
  rect: TargetRect
  /** 这一拍解析出来的动作（`DnDEvent.getAction()`）；null = 这个落点不接受。 */
  action: DnDAction | null
  /** 预期结果（`DnDEvent.getExpectedDropResult()`），也就是提示气泡要显示的字。 */
  expectedResult: string | null
  /** 提示气泡是否该显示（`hintVisible` 的判据）。 */
  hint: boolean
}

export interface FileDropTargetOptions {
  /** 落点目录（由元素自己算：树节点是它的目录，编辑器是它所属文件的目录）。 */
  destinationDir: (event: DragEventLike) => string | null
  /** 落点矩形（元素局部坐标）。给不出就 `null` = 不接受。 */
  targetRect: (event: DragEventLike) => TargetRect | null
  /** 这次落点要显示的预期结果（默认：复制 N 个文件 / 落点无效）。 */
  expectedResult?: (plan: DroppedFileCopyPlan, event: DragEventLike) => string | null
  /** 目标已存在同名文件时问一次；返回 false = 整批不复制（`DroppedFileCopy.kt:66`）。 */
  confirmOverwrite?: (question: string, names: readonly string[]) => boolean | Promise<boolean>
  /** 真复制（对应上游 `EelPathTransfer.walkingTransfer(..., removeSource = false, copyAttributes = true)`）。 */
  copy: (items: readonly DroppedFileCopyItem[]) => Promise<void> | void
  /** 目标路径是否已存在（宿主盘上判断；上游 `Files.exists`，`DroppedFileCopy.kt:65`）。 */
  exists?: (target: string) => boolean
  /** 复制收尾刷新目标目录（上游 `VfsUtil.markDirtyAndRefresh`，`:117-120`）。 */
  refreshDestination?: (destinationDir: string) => void | Promise<void>
  /** 复制途中某一项失败（上游 `showError`，`:131-139`）。默认抛出去。 */
  onError?: (item: DroppedFileCopyItem, error: unknown) => void
  /** `ide.dnd.textHints`（`Highlighters.java:140`）；不给 = 关。 */
  textHintsEnabled?: boolean
  /** 进度行的 id（`src/progressTasks.ts` 的 `ConcurrentTasksProgressManager`）。 */
  progressTaskId?: string
}

export interface FileDropTarget {
  /** 当前显示中的装饰；null = 没有拖到上面（对应 `vanish()`）。 */
  readonly decoration: Ref<DropDecoration | null>
  /** 同一拍解析出来的落点（判据与调试用）。 */
  plan(): DroppedFileCopyPlan | null
  dragover(event: DragEventLike): DropDecoration | null
  dragleave(): void
  drop(event: DragEventLike): Promise<DroppedFileCopyItem[]>
  /** 复制过程中把 `dnd.copy.progress.item` 那一拍报给进度行（上游 `reportRawProgress`，`:73-76`）。 */
  progressTitle(): string
}

/** `dnd.copy.progress.title`（`IdeBundle.properties:3393`，英文 "Copying files"；中文包无此 key）。 */
export const COPY_PROGRESS_TITLE = '正在复制文件'

/** `dnd.copy.overwrite.message.one`（`:3398`）。 */
export function copyOverwriteMessageOne(name: string): string {
  return `“${name}”已存在于目标目录。要覆盖它吗？`
}

/** `dnd.copy.overwrite.message.many`（`:3399`）。 */
export function copyOverwriteMessageMany(count: number): string {
  return `目标目录里已有 ${count} 个同名文件。要覆盖它们吗？`
}

/** `dnd.copy.overwrite.title`（`:3397`，英文 "Copy Files"）。 */
export const COPY_OVERWRITE_TITLE = '复制文件'

/** `dnd.copy.error.title`（`:3395`，英文 "Cannot copy files"）。 */
export const COPY_ERROR_TITLE = '无法复制文件'

/** `dnd.copy.error.message`（`:3396`）。 */
export function copyErrorMessage(name: string, reason: string): string {
  return `无法复制“${name}”：${reason}`
}

/** `dnd.copy.progress.item`（`:3394`，英文 "Copying “{0}”"）。 */
export function copyProgressItem(name: string): string {
  return `正在复制“${name}”`
}

/**
 * 外部文件落点的动作。
 *
 * 上游这一条只有一条路：`DroppedFileCopy.copy`（`DroppedFileCopy.kt:58-98`）**只复制**，
 * 类注释 `:29-33` 写明"move 重构不能跨文件系统，所以跨环境的那一侧一定是复制"。
 * 所以本仓的落点动作恒为 `copy`；只有当拖拽源声明的 `effectAllowed` 不含 copy 时才如实降级
 * （浏览器不允许 `dropEffect` 超出 `effectAllowed` —— 与 `src/dndModel.ts` 的
 * `dropActionFor` 同一约束），降级后的动作**不由本模块执行**，报告里记为未覆盖。
 */
export function externalFileDropAction(effectAllowed: string | undefined | null, fallback: DnDAction = 'copy'): DnDAction | null {
  const allowed = allowedActions(effectAllowed)
  if (!allowed.length) return null
  return allowed.includes('copy') ? 'copy' : allowed.includes(fallback) ? fallback : allowed[0]
}

export function createFileDropTarget(options: FileDropTargetOptions): FileDropTarget {
  const registry = new HighlighterRegistry()
  const decoration = ref<DropDecoration | null>(null) as Ref<DropDecoration | null>
  let lastPlan: DroppedFileCopyPlan | null = null

  function buildPlan(event: DragEventLike): { plan: DroppedFileCopyPlan; destination: string } | null {
    const destination = options.destinationDir(event)
    if (!destination) return null
    const sources = filePathsFromDragData(event.dataTransfer)
    if (!sources.length) return null
    return { plan: droppedFileCopyPlan(sources, destination, options.exists), destination }
  }

  function dragover(event: DragEventLike): DropDecoration | null {
    const rect = options.targetRect(event)
    if (!rect) return dragleave()
    const action = externalFileDropAction(event.dataTransfer?.effectAllowed)
    if (!action) return dragleave()
    const built = buildPlan(event)
    if (!built) return dragleave()
    lastPlan = built.plan
    const expected = options.expectedResult?.(built.plan, event) ?? `${COPY_PROGRESS_TITLE}（${built.plan.items.length}）`
    const mask = DND_HIGHLIGHT.FILLED_RECTANGLE | DND_HIGHLIGHT.BOTTOM
    registry.hideAll()
    registry.show(mask)
    event.preventDefault?.()
    if (event.dataTransfer) event.dataTransfer.dropEffect = action
    decoration.value = {
      mask,
      rect,
      action,
      expectedResult: expected,
      hint: hintVisible(mask, expected, options.textHintsEnabled === true),
    }
    return decoration.value
  }

  function dragleave(): null {
    registry.hideAll()
    decoration.value = null
    lastPlan = null
    return null
  }

  async function drop(event: DragEventLike): Promise<DroppedFileCopyItem[]> {
    const state = decoration.value
    dragleave()
    if (!state) return []
    const built = buildPlan(event)
    if (!built) return []
    const { plan, destination } = built
    // 取不到文件名的已经由 droppedFileCopyPlan 记成 skipped（上游 `mapNotNull`，`DroppedFileCopy.kt:60`）。
    if (!plan.items.length) return []
    let overwrite = true
    if (plan.conflicts.length) {
      const question = plan.conflicts.length === 1
        ? copyOverwriteMessageOne(plan.conflicts[0])
        : copyOverwriteMessageMany(plan.conflicts.length)
      overwrite = options.confirmOverwrite ? await options.confirmOverwrite(question, plan.conflicts) : false
    }
    const items = applyOverwriteAnswer(plan, overwrite)
    if (!items.length) return []
    const taskId = options.progressTaskId ?? 'dnd.copy'
    backgroundTaskManager.begin(taskId, COPY_PROGRESS_TITLE, { detail: copyProgressItem(items[0].name) })
    const copied: DroppedFileCopyItem[] = []
    try {
      for (const item of items) {
        backgroundTaskManager.update(taskId, { detail: copyProgressItem(item.name) })
        try {
          await options.copy([item])
          copied.push(item)
        } catch (error) {
          // 上游 :78-84 —— 第一个失败就中断整批，并报出失败的那一项。
          backgroundTaskManager.update(taskId, { detail: copyErrorMessage(item.name, String((error as Error)?.message ?? error)) })
          options.onError?.(item, error)
          break
        }
      }
    } finally {
      backgroundTaskManager.end(taskId)
      await options.refreshDestination?.(destination)
    }
    return copied
  }

  return {
    decoration,
    plan: () => lastPlan,
    dragover,
    dragleave,
    drop,
    progressTitle: () => COPY_PROGRESS_TITLE,
  }
}

/**
 * 把落点接到一个元素上（`dragover` / `dragleave` / `drop` 三个挂点）。
 *
 * 返回值直接绑模板：`:class` 拿 `boundsOf()`、`title` 拿 `expectedResult`。
 * `destroy()` 在组件卸载时摘掉三个监听 —— 上游对应 `DropTargetHighlighter.vanish()` 的清理
 * （`Highlighters.java:117-124`：从父容器上摘掉并重画它占过的那块）。
 */
export interface FileDropBinding {
  activeClass: Ref<string | null>
  boundsOf: () => { name: string; bounds: TargetRect }[] | null
  expectedResult: Ref<string | null>
  destroy: () => void
}

export function useFileDropTarget(el: Ref<HTMLElement | null | undefined>, target: FileDropTarget): FileDropBinding {
  const activeClass = ref<string | null>(null) as Ref<string | null>
  const bounds = ref<{ name: string; bounds: TargetRect }[] | null>(null)
  const expectedResult = ref<string | null>(null)
  const sync = () => {
    const state = target.decoration.value
    activeClass.value = state ? 'dnd-drop-target' : null
    bounds.value = state ? highlighterBounds(state.mask, state.rect) : null
    expectedResult.value = state?.expectedResult ?? null
  }
  const onOver = (event: DragEvent) => { target.dragover(event as DragEventLike); sync() }
  const onLeave = () => { target.dragleave(); sync() }
  const onDrop = (event: DragEvent) => { event.preventDefault(); void target.drop(event as DragEventLike).then(sync) }
  el.value?.addEventListener('dragover', onOver)
  el.value?.addEventListener('dragleave', onLeave)
  el.value?.addEventListener('drop', onDrop)
  return {
    activeClass,
    boundsOf: () => bounds.value,
    expectedResult,
    destroy() {
      el.value?.removeEventListener('dragover', onOver)
      el.value?.removeEventListener('dragleave', onLeave)
      el.value?.removeEventListener('drop', onDrop)
      target.dragleave()
    },
  }
}
