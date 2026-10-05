// 拖放的**统一模型** —— 上游 `com.intellij.ide.dnd` 那一族在 DOM/HTML5 拖放下的等价物。
//
// 上游分两半，本模块把两半都摊开：
//   · ide-core（`DnDAction`/`DnDSource`/`DnDTarget`/`DnDTargetChecker`/`DnDDragStartBean`/
//     `DnDEvent`/`DnDDropHandler`/`DnDDropActionHandler`/`DropActionHandler`）是接口与动作枚举；
//   · platform-impl（`DnDManagerImpl`/`DnDEventImpl`/`DropTargetHighlighter`/`Highlighters`/
//     `TransferableWrapper`/`TransferableList`/`FileFlavorProvider`/`PathFlavorProvider`/
//     `LinuxDragAndDropSupport`/`DroppedFileCopy`）是实现。
//
// **本仓的 DOM 等价物**（逐条对照，不做没依据的发明）：
//   · `DnDConstants` 的 ACTION_COPY=1 / ACTION_MOVE=2 / ACTION_LINK=0x40000000 与
//     `DnDManagerImpl.getDnDActionForPlatformAction`（`DnDManagerImpl.java:656-663`）的
//     alt-only 反转照抄；
//   · `DnDManagerImpl.registerTarget`/`getTarget`（`DnDManagerImpl.java:183-220`）的"把 target 挂到
//     component 客户端属性、拖到某组件时**沿父链**找最近的注册目标" —— 这里用 id 链的注册表表达；
//   · `DnDEventImpl` 的 drop 判定（`setDropPossible` 两态 + `canHandleDrop` 看有没有 handler）、
//     委派（`delegateUpdateTo`/`delegateDropTo`/`wasDelegated`/`clearDelegatedTarget`）与
//     高亮（`setHighlighting`/`hideHighlighter` + `Highlighters` 的掩码注册表：RECTANGLE=1 /
//     FILLED_RECTANGLE=2 / H_ARROWS=4 / V_ARROWS=8 / TEXT=16 / ERROR_TEXT=32 / BOTTOM=64）；
//   · `TransferableWrapper`/`FileFlavorProvider`/`PathFlavorProvider` 的"从拖拽载荷里取文件清单"
//     与 `LinuxDragAndDropSupport.toUriList` 的 uri-list 编解码（含 `#` 注释行与百分号还原）；
//   · `DroppedFileCopy` 的复制计划：目标已存在同名文件要问一次（上游 `confirmOverwrite`），
//     拒绝就整批不复制（上游 `copy` 返回空表）。
//
// 真实的消费链路：`src/tabDragDrop.ts`（标签重排/拖出分屏）与 `src/toolStripeDrag.ts`
// （工具窗口条）的 HTML5 事件现在都走这里的 `beginDrag`/`acceptDrop`/`dropActionFor`，
// 而不是各自手写 `event.dataTransfer.dropEffect = 'move'`。

export type DnDAction = 'move' | 'copy' | 'link'

/** `java.awt.dnd.DnDConstants` 的三个动作 id（同一数值，便于与上游日志/判据对齐）。 */
export const DND_ACTION_ID: Record<DnDAction, number> = {
  move: 2,
  copy: 1,
  link: 0x40000000,
}

/** `DnDConstants.ACTION_COPY_OR_MOVE`。 */
export const DND_ACTION_COPY_OR_MOVE = 3

export function actionIdOf(action: DnDAction): number {
  return DND_ACTION_ID[action]
}

export function actionFromActionId(id: number): DnDAction | null {
  if (id === DND_ACTION_ID.copy) return 'copy'
  if (id === DND_ACTION_ID.move) return 'move'
  if (id === DND_ACTION_ID.link) return 'link'
  return null
}

/**
 * `DnDManagerImpl.getDnDActionForPlatformAction`（`DnDManagerImpl.java:656-663`）的照抄：
 * 平台给 COPY/MOVE 时按「仅 Alt 才拖」的设置反转，LINK 原样，其余 null。
 */
export function actionForPlatformAction(platformAction: number, altOnly: boolean): DnDAction | null {
  if (platformAction === DND_ACTION_ID.copy) return altOnly ? 'move' : 'copy'
  if (platformAction === DND_ACTION_ID.move) return altOnly ? 'copy' : 'move'
  if (platformAction === DND_ACTION_ID.link) return 'link'
  return null
}

/** HTML5 `dropEffect` 文案 ↔ 动作（浏览器用字符串，上游用常量）。 */
export function dropEffectOf(action: DnDAction): 'move' | 'copy' | 'link' {
  return action
}

/** `effectAllowed` 里允许的动作集合；`'none'`/空串是"什么也不允许"。 */
export function allowedActions(effectAllowed: string | undefined | null): DnDAction[] {
  switch (effectAllowed) {
    case 'copy': return ['copy']
    case 'move': return ['move']
    case 'link': return ['link']
    case 'copyMove': return ['copy', 'move']
    case 'copyLink': return ['copy', 'link']
    case 'linkMove': return ['link', 'move']
    case 'all': return ['copy', 'move', 'link']
    default: return []
  }
}

/** 平台动作 → HTML5 `effectAllowed` 文案（本仓在 dragstart 上写它）。 */
export function effectAllowedFor(action: DnDAction): 'copy' | 'move' | 'link' {
  return action
}

export interface DropModifiers {
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * 修饰键的首选语义：Ctrl/Cmd = 复制，Shift = 移动，Ctrl/Cmd+Shift 或 Alt = 链接。
 * 浏览器在 dragover 上并不把修饰键折进 `dropEffect`，所以这一步得落点自己做 ——
 * 对应上游由 `DnDDragStartBean`/平台 AWT 在拖拽开始时就定下 `DnDAction` 的那层。
 */
export function preferredActionFor(modifiers: DropModifiers): DnDAction {
  const withCtrl = !!(modifiers.ctrlKey || modifiers.metaKey)
  if (modifiers.altKey) return 'link'
  if (withCtrl && modifiers.shiftKey) return 'link'
  if (withCtrl) return 'copy'
  if (modifiers.shiftKey) return 'move'
  return 'move'
}

/**
 * 落点动作：首选动作在 `effectAllowed` 允许的集合里就用它，否则退回集合里的第一个
 * （HTML5 的 `dropEffect` 只能是 `effectAllowed` 的子集，浏览器自身也是这个规则）。
 * 没有允许的动作时返回 null = 这个落点不接受。
 */
export function dropActionFor(
  effectAllowed: string | undefined | null,
  modifiers: DropModifiers = {},
  fallback: DnDAction = 'move',
): DnDAction | null {
  const allowed = allowedActions(effectAllowed)
  if (!allowed.length) return null
  const preferred = preferredActionFor(modifiers)
  if (allowed.includes(preferred)) return preferred
  return allowed.includes(fallback) ? fallback : allowed[0]
}

/** DOM 事件上的拖拽数据（只取本模块要用的三件，判据里给替身不用真 `DataTransfer`）。 */
export interface DragDataLike {
  getData?: (type: string) => string
  files?: ArrayLike<{ name?: string; path?: string }>
  effectAllowed?: string
  dropEffect?: string
}

/** 拖拽事件的最小形状（`DragEvent` 满足它，判据里给普通对象也满足）。 */
export interface DragEventLike {
  dataTransfer?: DragDataLike | null
  preventDefault?: () => void
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/** dragstart：写数据 + 允许的动作（`DnDManagerImpl` 的 dragGestureRecognizer 那一拍）。 */
export function beginDrag(event: DragEventLike, options: { text?: string; action: DnDAction; textType?: string }): void {
  const data = event.dataTransfer
  if (!data) return
  if (options.text !== undefined && data.getData) {
    // 只用 setData 的写侧；读侧留给落点（上游把 attachedObject 直接挂在事件上，这里只能过字符串）。
    const setter = (data as { setData?: (type: string, value: string) => void }).setData
    if (setter) setter.call(data, options.textType ?? 'text/plain', options.text)
  }
  data.effectAllowed = effectAllowedFor(options.action)
}

/** dragover：答应这个落点并把 `dropEffect` 设成解析出来的动作。 */
export function acceptDrop(event: DragEventLike, action: DnDAction): void {
  event.preventDefault?.()
  if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectOf(action)
}

/** dragover 的完整判定：`effectAllowed` × 修饰键 → 动作；null 表示不该 preventDefault。 */
export function dropActionForEvent(event: DragEventLike, fallback: DnDAction = 'move'): DnDAction | null {
  return dropActionFor(event.dataTransfer?.effectAllowed, event, fallback)
}

/** `DnDDragStartBean`：拖拽开始时携带的对象（本仓用 kind + 载荷描述）。 */
export interface DnDDragStartBean<T = unknown> {
  /** 拖动源的标识（上游是 `DnDSource` 实例；这里是哪个界面在拖）。 */
  kind: string
  /** 被拖的对象（标签路径 / 工具窗口 id / 文件清单）。 */
  payload: T
  /** `DnDDragStartBean.isEmpty()`：true = 不显示拖拽图像（本仓没有图像层，保留语义）。 */
  empty?: boolean
}

export function isEmptyDragBean(bean: DnDDragStartBean | null | undefined): boolean {
  return !bean || bean.empty === true
}

/** `DnDSource.canStartDragging` 的等价判断：载荷为空就不该起拖。 */
export function canStartDragging(bean: DnDDragStartBean | null | undefined): boolean {
  if (!bean) return false
  const payload = bean.payload
  if (payload === undefined || payload === null) return false
  if (typeof payload === 'string') return payload.length > 0
  if (Array.isArray(payload)) return payload.length > 0
  return true
}

// ── target 注册表（`DnDManagerImpl.registerTarget` / `getTarget` 沿父链找）──────────────────

/** `DnDTargetChecker.update(event)` 的返回值语义：true = 本目标处理不了，交给父组件。 */
export interface DnDTargetLike {
  update: (event: DnDEventModel) => boolean
  drop: (event: DnDEventModel) => void
  cleanUpOnLeave?: () => void
}

/**
 * `DnDManagerImpl` 的 target 注册表。上游把 target 挂到 Swing 组件的客户端属性、拖拽经过某组件时
 * **沿父链**找最近的注册目标（`DnDManagerImpl.java:183-189, 242`）；DOM 里对应的就是
 * "事件冒泡到哪个带 target 的元素" —— 调用方给一条从落点往上排的 id 链即可。
 */
export class DnDTargetRegistry<T extends DnDTargetLike = DnDTargetLike> {
  private readonly targets = new Map<string, T>()

  register(id: string, target: T): () => void {
    this.targets.set(id, target)
    return () => this.unregister(id, target)
  }

  unregister(id: string, target?: T): void {
    if (target && this.targets.get(id) !== target) return
    this.targets.delete(id)
  }

  get(id: string): T | null {
    return this.targets.get(id) ?? null
  }

  /** 沿链找最近的注册目标（链的顺序 = 从落点往上）。 */
  targetForChain(chain: readonly string[]): T | null {
    for (const id of chain) {
      const target = this.targets.get(id)
      if (target) return target
    }
    return null
  }

  get size(): number {
    return this.targets.size
  }

  clear(): void {
    this.targets.clear()
  }
}

// ── 高亮（`Highlighters` 的掩码注册表 + `DnDEventImpl.setHighlighting`）────────────────────

/** `DnDEvent.DropTargetHighlightingType` 的七个掩码位。 */
export const DND_HIGHLIGHT = {
  RECTANGLE: 1,
  FILLED_RECTANGLE: 2,
  H_ARROWS: 4,
  V_ARROWS: 8,
  TEXT: 16,
  ERROR_TEXT: 32,
  BOTTOM: 64,
} as const

export type DndHighlightType = (typeof DND_HIGHLIGHT)[keyof typeof DND_HIGHLIGHT]

/** `Highlighters` 静态表里七个高亮器的名字（按注册顺序；掩码一个位一个）。 */
export const DND_HIGHLIGHTERS: ReadonlyArray<{ name: string; mask: number }> = [
  { name: 'rectangle', mask: DND_HIGHLIGHT.RECTANGLE },
  { name: 'filledRectangle', mask: DND_HIGHLIGHT.FILLED_RECTANGLE },
  { name: 'horizontalLines', mask: DND_HIGHLIGHT.H_ARROWS },
  { name: 'text', mask: DND_HIGHLIGHT.TEXT },
  { name: 'errorText', mask: DND_HIGHLIGHT.ERROR_TEXT },
  { name: 'verticalLines', mask: DND_HIGHLIGHT.V_ARROWS },
  { name: 'bottom', mask: DND_HIGHLIGHT.BOTTOM },
]

/** `Highlighters.show(aType, …)`：掩码命中的高亮器（顺序 = 注册顺序）。 */
export function highlightersForMask(mask: number): string[] {
  return DND_HIGHLIGHTERS.filter(entry => (entry.mask & mask) !== 0).map(entry => entry.name)
}

/**
 * 当前显示中的高亮器（`Highlighters.ourCurrentHighlighters` 的三条操作：
 * show 追加、hide(掩码) 只收命中的、hideAll / hideAllBut / isVisibleExcept 的判定）。
 */
export class HighlighterRegistry {
  private current: number[] = []

  show(mask: number): string[] {
    const shown = highlightersForMask(mask)
    for (const entry of DND_HIGHLIGHTERS) if ((entry.mask & mask) !== 0) this.current.push(entry.mask)
    return shown
  }

  hide(mask: number): void {
    this.current = this.current.filter(bit => (bit & mask) === 0)
  }

  hideAllBut(mask: number): void {
    this.hide(~mask)
  }

  hideAll(): void {
    this.current = []
  }

  isVisible(): boolean {
    return this.current.length > 0
  }

  /** `Highlighters.isVisibleExcept(type)`：有任何一个"不在 type 里"的高亮器还亮着。 */
  isVisibleExcept(type: number): boolean {
    let resultType = type
    for (const bit of this.current) resultType |= bit
    return type !== resultType
  }

  visibleNames(): string[] {
    return DND_HIGHLIGHTERS.filter(entry => this.current.includes(entry.mask)).map(entry => entry.name)
  }
}

// ── DnDEventImpl 的模型 ─────────────────────────────────────────────────────────────────

export type DropActionHandler = (event: DnDEventModel) => void

export interface DnDEventInit {
  action: DnDAction
  attachedObject?: unknown
  point?: { x: number; y: number }
  manager?: { hideCurrentHighlighter?: () => void }
}

/**
 * `DnDEventImpl` 的行为子集：drop 可行性两态（`setDropPossible(boolean, expected?)` 与
 * `setDropPossible(expected, handler)`）、`canHandleDrop`、委派、高亮与点位。
 * 上游是 Swing 组件坐标；这里点/局部点就是普通 `{x, y}`。
 */
export class DnDEventModel {
  action: DnDAction
  attachedObject: unknown
  point: { x: number; y: number }
  orgPoint: { x: number; y: number } | null = null
  localPoint: { x: number; y: number } | null = null
  dropPossible = false
  expectedDropResult: string | null = null
  handlerComponentId: string | null = null
  highlighting = 0
  private dropHandler: DropActionHandler | null = null
  private delegatedTarget: DnDTargetLike | null = null
  private readonly manager?: { hideCurrentHighlighter?: () => void }

  constructor(init: DnDEventInit) {
    this.action = init.action
    this.attachedObject = init.attachedObject ?? null
    this.point = init.point ?? { x: 0, y: 0 }
    this.manager = init.manager
  }

  getAction(): DnDAction {
    return this.action
  }

  updateAction(action: DnDAction): void {
    this.action = action
  }

  getAttachedObject(): unknown {
    return this.attachedObject
  }

  setDropPossible(possible: boolean, expectedResult?: string | null): void {
    this.dropPossible = possible
    this.expectedDropResult = expectedResult ?? null
    this.dropHandler = null
  }

  /** 上游的第二个重载：`setDropPossible(expected, handler)`（落地要执行的动作）。 */
  acceptDrop(expectedResult: string, handler: DropActionHandler): void {
    this.dropPossible = true
    this.expectedDropResult = expectedResult
    this.dropHandler = handler
  }

  isDropPossible(): boolean {
    return this.dropPossible
  }

  canHandleDrop(): boolean {
    return this.dropHandler !== null
  }

  handleDrop(): void {
    this.dropHandler?.(this)
  }

  wasDelegated(): boolean {
    return this.delegatedTarget !== null
  }

  getDelegatedTarget(): DnDTargetLike | null {
    return this.delegatedTarget
  }

  clearDelegatedTarget(): void {
    this.delegatedTarget = null
  }

  /** 委派给子目标更新；返回子目标的 `update` 结果（true = 它处理不了）。 */
  delegateUpdateTo(target: DnDTargetLike): boolean {
    this.delegatedTarget = target
    return target.update(this)
  }

  delegateDropTo(target: DnDTargetLike): void {
    this.delegatedTarget = target
    target.drop(this)
  }

  setHighlighting(type: number): void {
    this.highlighting = type
    this.manager?.hideCurrentHighlighter?.()
  }

  hideHighlighter(): void {
    this.highlighting = 0
  }

  cleanUp(): void {
    this.highlighting = 0
    this.dropHandler = null
    this.delegatedTarget = null
  }
}

// ── 载荷：文件清单（`FileFlavorProvider`/`PathFlavorProvider`）与文本列表（`TransferableList`）──

/** `LinuxDragAndDropSupport.toUriList`：每行一个 file:// URI，末尾换行（`File.toURI` 的等价编码）。 */
export function toUriList(paths: readonly string[]): string {
  return paths.map(path => {
    // 逐段编码：空格/`#`/`?` 都要转义，但路径段里的 `:` 是合法字符（盘符不能被编成 %3A）。
    const encoded = path.replace(/\\/g, '/').split('/').map(seg => encodeURIComponent(seg).replace(/%3A/g, ':')).join('/')
    return 'file://' + (encoded.startsWith('/') ? '' : '/') + encoded
  }).join('\n') + '\n'
}

/**
 * `LinuxDragAndDropSupport.uriListToFileList` 的 DOM 侧子集：`#` 开头的注释行跳过、
 * 空行跳过、非 `file:` 的 URI 跳过、百分号还原；返回工作区路径（反斜杠归一）。
 */
export function uriListToPaths(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (!line.toLowerCase().startsWith('file:')) continue
    let rest = line.slice('file:'.length)
    // `file:///C:/x` 与 `file://host/share`：只接受空主机名（本机文件）。
    if (rest.startsWith('//')) {
      rest = rest.slice(2)
      const slash = rest.indexOf('/')
      const host = slash >= 0 ? rest.slice(0, slash) : rest
      if (host && host !== 'localhost') continue
      rest = slash >= 0 ? rest.slice(slash) : ''
    }
    if (!rest) continue
    let decoded = rest
    try { decoded = decodeURIComponent(rest) } catch { /* 坏了就按原文用 */ }
    // `/C:/dir` → `C:/dir`
    if (/^\/[A-Za-z]:\//.test(decoded)) decoded = decoded.slice(1)
    out.push(decoded.replace(/\\/g, '/'))
  }
  return out
}

/**
 * `FileCopyPasteUtil.getFilesFromAttachedObject` / `FileFlavorProvider.asFileList`：
 * 从一次拖拽的载荷里取文件路径清单。优先看 `Files`（资源管理器拖进来的 File 对象带 path），
 * 再看 `text/uri-list`（Linux/部分浏览器的形态）。
 */
export function filePathsFromDragData(data: DragDataLike | null | undefined): string[] {
  if (!data) return []
  const paths: string[] = []
  const files = data.files
  if (files && typeof files.length === 'number') {
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      const path = file?.path
      if (typeof path === 'string' && path) paths.push(path.replace(/\\/g, '/'))
    }
  }
  if (paths.length) return paths
  const uriList = data.getData?.('text/uri-list') ?? ''
  return uriList ? uriListToPaths(uriList) : []
}

/** `TransferableList.getText`：一条就原文，多条换行（HTML 形态是 `<ul><li>`）。 */
export function transferableListText(items: readonly string[]): string {
  return items.join('\n')
}

export function transferableListHtml(items: readonly string[]): string {
  return '<ul>\n' + items.map(item => `  <li>${item}</li>\n`).join('') + '</ul>'
}

// ── `DroppedFileCopy` 的复制计划（纯函数；写盘/确认框由调用方做）──────────────────────────

export interface DroppedFileCopyItem {
  source: string
  name: string
  target: string
}

export interface DroppedFileCopyPlan {
  items: DroppedFileCopyItem[]
  /** 已存在的目标名（上游 `confirmOverwrite` 问的就是这些；空 = 直接复制）。 */
  conflicts: string[]
  /** 取不出文件名的源（上游 `mapNotNull` 直接跳过）。 */
  skipped: number
}

/** 路径最后一段（上游 `Path.fileName`；`/` 与 `\` 都切）。 */
export function fileNameOf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/** 目录拼接（像 `Path.resolve` 那样归一多余分隔符，不碰盘）。 */
export function joinPath(directory: string, name: string): string {
  const base = directory.replace(/\\/g, '/').replace(/\/+$/, '')
  return base ? `${base}/${name}` : name
}

/**
 * 把一次"外部文件拖进目录"拟成复制计划。`exists` 由调用方给（宿主盘上判断；
 * 上游 `Files.exists` 在 IO 线程先筛一遍再弹确认框）。
 */
export function droppedFileCopyPlan(
  sources: readonly string[],
  destinationDir: string,
  exists: (target: string) => boolean = () => false,
): DroppedFileCopyPlan {
  const items: DroppedFileCopyItem[] = []
  const conflicts: string[] = []
  let skipped = 0
  for (const source of sources) {
    const name = fileNameOf(source)
    if (!name || !source) { skipped++; continue }
    const target = joinPath(destinationDir, name)
    items.push({ source, name, target })
    if (exists(target) && !conflicts.includes(name)) conflicts.push(name)
  }
  return { items, conflicts, skipped }
}

/**
 * 用户对覆盖问题的答复应用在计划上：拒绝就整批不复制（上游 `copy` 在 `confirmOverwrite`
 * 返回 false 时 `return emptyList()`），同意就整批复制。
 */
export function applyOverwriteAnswer(plan: DroppedFileCopyPlan, overwrite: boolean): DroppedFileCopyItem[] {
  if (plan.conflicts.length && !overwrite) return []
  return plan.items
}
