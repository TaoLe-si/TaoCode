// 高亮 pass 的**注册表与脏范围** —— 上游 `platform/analysis-impl/com/intellij/codeHighlighting`
// 那族在"本地检查通道"这一侧的等价物。
//
// 逐条对照：
//   · `TextEditorHighlightingPass`（pass 的生命周期：`doCollectInformation`/`doApplyInformationToEditor`）
//     —— 这里对应 `HighlightPass.run(context)` 的"收集 + 落地"两拍（本仓落地在 pass 自己里，
//     因为问题表就是落地目标，没有 PSI 高亮层可分开）。
//   · `TextEditorHighlightingPassRegistrar`/`TextEditorHighlightingPassFactoryRegistrar` ——
//     `registerTextEditorHighlightingPass(factory, afterPassId, …)`：pass id 唯一、
//     `afterPassId` 决定顺序、未知的 id 追加到末尾（上游 registerPass 的容错）。
//   · `MainHighlightingPassFactory` —— 文件内容变了就跑主 pass；没变（同一内容重复触发）直接跳过。
//   · `EditorBoundHighlightingPass` —— 「同一个 Document 可以有多个 Editor，这类 pass 要**每个编辑器**跑一次」
//     （`platform/analysis-impl/.../codeHighlighting/EditorBoundHighlightingPass.java:8-15`：普通 pass 是
//     document-bound，markup 存进 Document；editor-bound pass 带的是编辑器专属 markup，例如代码折叠）。
//     所以它**不走** MainHighlightingPassFactory 的「内容没变就跳过」——折叠标记随布局/视口变，
//     文本没动也要重画；而且同一个文档开两个编辑器就要跑两遍。
//   · `DirtyScopeTrackingHighlightingPassFactory` —— 记录上次跑过之后哪些行被改过
//     （本仓用前后文本的公共前缀/后缀算出行区间），pass 跑完把脏范围消费掉。
//   · `Pass` 的 `getProgressIndicator`/取消面：本仓 pass 是同步纯文本扫描，没有进度面。
//
// 消费链路：`src/junitInspections.ts` 的 `refreshLocalInspections` —— 本地检查是注册进来的
// 第一个 pass；同一内容重复刷新会经 `MainHighlightingPassFactory` 的判据短路，脏范围被
// `DirtyScopeTracker` 记录并在跑完后消费。
//
// 本轮补的两块（`LspHighlightingApplier` / `LspHighlightingPass` 那一族，判词里点名的 ①②）：
//   · `HighlightingApplier` —— 统一 apply 器：把「每一层高亮各写各的表、各自整体替换」
//     收成「按代排期 → 收集 → 一次性落地」，并带上上游那两个闸门：
//     `scheduleHighlightingRefresh` 的**缓存代数**去重（`LspHighlightingApplier.kt:76-80,102`）
//     与落地前的**文档 stamp 复核**（`:107`：`modificationStamp != collectedModStamp` 就整份丢弃）。
//     编辑走 `scheduleHighlightingRefreshDebounced`（`:88-98`，`EDIT_DEBOUNCE = 40ms`，`:288`）——
//     一次连打并成一次收集，窗口内在屏的那一层仍是区间标记，跟着编辑走。
//   · `runGeneralHighlightingPass` —— `GeneralHighlightingPass` 的调度口径（`myUpdateAll`
//     决定整份还是只算脏范围、pass 名是 `AnalysisBundle.message("pass.syntax")`）。

export type HighlightPassKind = 'main' | 'editorBound'

export interface HighlightPassContext {
  /** 文件路径（工作区相对）。 */
  path: string
  /** 当前文本。 */
  text: string
  /** 这一拍要跑的脏行范围（0 基、闭区间；空 = 没有脏范围）。 */
  dirtyRanges: readonly DirtyLineRange[]
  /** 上一轮跑时看到的内容（第一轮为 null）。 */
  previousText: string | null
  /**
   * 编辑器身份。只在 `kind === 'editorBound'` 的 pass 上下文里有值 —— 上游那种 pass
   * 「同一个 Document 每个 Editor 都要跑一次」（`EditorBoundHighlightingPass.java:8-15`），
   * 本仓没有 Editor 对象，用调用方给的字符串标识区分。
   */
  editorId?: string
}

export interface HighlightPass {
  id: number
  /** 上游 `TextEditorHighlightingPass` 的种类：主 pass 随文件打开/变更跑，编辑器绑定 pass 跟编辑器。 */
  kind: HighlightPassKind
  run: (context: HighlightPassContext) => void
}

export interface DirtyLineRange {
  /** 0 基起始行（含）。 */
  start: number
  /** 0 基结束行（含）。 */
  end: number
}

/** 行的拆分口径与编辑器一致（`\r?\n`）。 */
function linesOf(text: string): string[] {
  return text.split(/\r?\n/)
}

/**
 * 前后文本的脏行范围（`DirtyScopeTrackingHighlightingPassFactory` 的文本等价物）：
 * 公共前缀/后缀之外的区间；删空一段时给一个"零宽"区间（start = end = 变更点所在行），
 * 这样 pass 仍知道"这一带被改过"。
 */
export function dirtyLineRanges(previousText: string, nextText: string): DirtyLineRange[] {
  if (previousText === nextText) return []
  const before = linesOf(previousText)
  const after = linesOf(nextText)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix++
  const start = Math.min(prefix, Math.max(0, after.length - 1))
  const end = Math.max(start, after.length - 1 - suffix)
  return [{ start, end }]
}

/** 脏行范围的总行数（`WeakHashMap` 那侧的"有没有脏东西"判据）。 */
export function dirtyLineCount(ranges: readonly DirtyLineRange[]): number {
  let total = 0
  for (const range of ranges) total += Math.max(0, range.end - range.start + 1)
  return total
}

export function rangesOverlap(a: DirtyLineRange, b: DirtyLineRange): boolean {
  return a.start <= b.end && b.start <= a.end
}

/**
 * pass 注册表：id 唯一、`afterPassId` 插在对应 pass 之后、未知 id 追加到末尾
 * （上游 `registerTextEditorHighlightingPass` 的容错：坏参数只记日志，不砸调用方）。
 */
export class HighlightPassRegistrar {
  private readonly passes: HighlightPass[] = []
  private nextId = 1

  registerPass(run: HighlightPass['run'], options: { kind?: HighlightPassKind; afterPassId?: number; id?: number } = {}): number {
    const id = options.id ?? this.nextId++
    if (this.passes.some(pass => pass.id === id)) throw new Error(`高亮 pass id 重复：${id}`)
    const pass: HighlightPass = { id, kind: options.kind ?? 'main', run }
    const after = options.afterPassId === undefined ? -1 : this.passes.findIndex(entry => entry.id === options.afterPassId)
    if (after >= 0) this.passes.splice(after + 1, 0, pass)
    else this.passes.push(pass)
    if (id >= this.nextId) this.nextId = id + 1
    return id
  }

  getPasses(): readonly HighlightPass[] {
    return this.passes
  }

  findByKind(kind: HighlightPassKind): HighlightPass[] {
    return this.passes.filter(pass => pass.kind === kind)
  }

  clear(): void {
    this.passes.length = 0
    this.nextId = 1
  }
}

/**
 * `DirtyScopeTrackingHighlightingPassFactory` 的状态域：按文件记"上次跑过的文本"与累积的脏范围，
 * pass 跑完 `takeDirtyRanges` 把范围消费掉（上游也是跑完清脏 scope，不清就会反复重算）。
 */
export class DirtyScopeTracker {
  private readonly lastText = new Map<string, string>()
  private readonly dirty = new Map<string, DirtyLineRange[]>()

  /**
   * 记录一次文本变化；返回这一拍新增的脏范围与**变化前**的文本（首见该文件时 previous 为 null，
   * 脏范围整文件）。无变化时返回空数组 —— 调用方据此整拍跳过。
   */
  noteText(path: string, text: string): { ranges: DirtyLineRange[]; previousText: string | null } {
    const previous = this.lastText.get(path)
    this.lastText.set(path, text)
    if (previous === undefined) {
      const ranges: DirtyLineRange[] = [{ start: 0, end: Math.max(0, linesOf(text).length - 1) }]
      this.dirty.set(path, ranges)
      return { ranges, previousText: null }
    }
    if (previous === text) return { ranges: [], previousText: previous }
    const fresh = dirtyLineRanges(previous, text)
    this.dirty.set(path, [...(this.dirty.get(path) ?? []), ...fresh])
    return { ranges: fresh, previousText: previous }
  }

  pendingRanges(path: string): DirtyLineRange[] {
    return this.dirty.get(path) ?? []
  }

  hasDirtyScope(path: string): boolean {
    return this.pendingRanges(path).length > 0
  }

  takeDirtyRanges(path: string): DirtyLineRange[] {
    const ranges = this.pendingRanges(path)
    this.dirty.delete(path)
    return ranges
  }

  forget(path: string): void {
    this.lastText.delete(path)
    this.dirty.delete(path)
  }
}

/**
 * `MainHighlightingPassFactory` 的调度：文件内容没变就整拍跳过（同一内容重复触发是常见情形 ——
 * 打开文件算一次、随后一次"内容其实没变"的编辑器事件又算一次）；变了才按注册顺序跑主 pass。
 * 返回跑过的 pass id（判据与调试用）。
 */
export function runMainHighlightPasses(
  registrar: HighlightPassRegistrar,
  tracker: DirtyScopeTracker,
  path: string,
  text: string,
): number[] {
  const note = tracker.noteText(path, text)
  if (note.ranges.length === 0) return []
  const dirtyRanges = tracker.takeDirtyRanges(path)
  const ran: number[] = []
  for (const pass of registrar.findByKind('main')) {
    pass.run({ path, text, dirtyRanges, previousText: note.previousText })
    ran.push(pass.id)
  }
  return ran
}

// ---------------------------------------------------------------- 统一 apply 器（LspHighlightingApplier）

/**
 * `LspHighlightingApplier.kt:288` 的 `EDIT_DEBOUNCE` = 40ms —— 一次连打并成一次刷新。
 * 上游那个窗口"在屏上不可见"是因为已落地的那一层是区间标记，跟着编辑走
 * （`:85-86` 的注释原话）；本仓的落点一样是 CodeMirror 装饰，编辑时 CodeMirror 自己平移。
 */
export const EDIT_DEBOUNCE_MS = 40

/** 一层高亮：收集阶段产出的注解（名字对齐上游的 `HighlightInfo` 列表）。 */
export interface HighlightLayerItem { readonly [key: string]: unknown }

/** 一次收集的结果 + 落地前的复核凭据（`HighlightsToApply`，`LspHighlightingApplier.kt:145-150`）。 */
export interface HighlightsToApply<T> {
  items: T[]
  groupId: number
  collectedStamp: number
}

export interface ApplierLayer<T> {
  /** 上游 `registerTextEditorHighlightingPass(factory, …)` 领到的 pass id（`GROUP_ID`）。 */
  id: number
  /** 收集：从各层缓存里把该文件的内容合成一份（`collectHighlightInfos`，`:152-163`）。 */
  collect: (path: string) => T[]
}

/** `LspHighlightingApplier.kt:285` 的 `UNREGISTERED_PASS_ID`。 */
export const UNREGISTERED_PASS_ID = -1

export interface ApplierSchedule<T> {
  /** 这一拍实际跑了吗（被更新的代数取代 / stamp 不符时返回 false）。 */
  applied: boolean
  /** 排期时的代数。 */
  generation: number
  items: T[]
}

/**
 * `LspHighlightingApplier` 的可移植状态机（去掉协程与 EDT）：
 *   · `scheduleRefresh`（`:76-80`）—— 代数 +1 再跑；跑之前若代数已被更新取代就整份跳过（`:102`）。
 *   · `scheduleRefreshDebounced`（`:88-98`）—— 代数**同步**领掉（所以这一下取代此前所有排期），
 *     等 `EDIT_DEBOUNCE_MS` 再跑；等待期间又来了新的排期就作废（`:95`）。
 *   · 落地前复核（`:107`）：收集时的 stamp 与落地时的 stamp 不符 → 不落地（那一拍编辑已经
 *     排过替代刷新，落地了就会画错位置）。
 */
export class HighlightingApplier<T extends HighlightLayerItem> {
  private readonly layers = new Map<number, ApplierLayer<T>>()
  private readonly generations = new Map<string, number>()
  private readonly stamps = new Map<string, number>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private stampOf: (path: string) => number
  private onApply: (path: string, data: HighlightsToApply<T>) => void

  constructor(options: {
    /** 每个文件当前内容的签名（复用 `src/lspHighlightingCache.ts` 的 `contentStamp`）。 */
    stampOf: (path: string) => number
    /** 落地：把收集到的那一份写进实际的高亮层。 */
    onApply: (path: string, data: HighlightsToApply<T>) => void
  }) {
    this.stampOf = options.stampOf
    this.onApply = options.onApply
  }

  /** `TextEditorHighlightingPassRegistrar.registerTextEditorHighlightingPass` 的等价物。 */
  registerLayer(layer: ApplierLayer<T>): void {
    if (this.layers.has(layer.id)) throw new Error(`高亮层 id 重复：${layer.id}`)
    this.layers.set(layer.id, layer)
  }

  unregisterLayer(id: number): void {
    this.layers.delete(id)
  }

  groupId(): number {
    return this.layers.size ? [...this.layers.keys()].sort((a, b) => a - b)[0]! : UNREGISTERED_PASS_ID
  }

  /** `currentGeneration`（`:247-249`）：没排过期的文件是 0。 */
  currentGeneration(path: string): number {
    return this.generations.get(path) ?? 0
  }

  /** 排一次刷新（`scheduleHighlightingRefresh`，`:76-80`）。 */
  scheduleRefresh(path: string): ApplierSchedule<T> {
    const generation = (this.generations.get(path) ?? 0) + 1
    this.generations.set(path, generation)
    return this.launchRefresh(path, generation)
  }

  /**
   * 排一次**去抖**刷新（`scheduleHighlightingRefreshDebounced`，`:88-98`）。
   * 代数在这里就领掉（同步），所以这一下取代此前所有排期；`setTimeout` 是 `delay()` 的等价物。
   */
  scheduleRefreshDebounced(path: string, delayMs: number = EDIT_DEBOUNCE_MS): number {
    const generation = (this.generations.get(path) ?? 0) + 1
    this.generations.set(path, generation)
    this.cancelTimer(path)
    this.timers.set(path, setTimeout(() => {
      this.timers.delete(path)
      this.launchRefresh(path, generation)
    }, delayMs))
    return generation
  }

  private launchRefresh(path: string, generation: number): ApplierSchedule<T> {
    // `:102`：等这一下真跑到时，若已经有更新的排期把代数抬上去了，这一整份就跳过。
    if (this.generations.get(path)! > generation) return { applied: false, generation, items: [] }
    const items: T[] = []
    let groupId = UNREGISTERED_PASS_ID
    for (const id of [...this.layers.keys()].sort((a, b) => a - b)) {
      const layer = this.layers.get(id)!
      items.push(...layer.collect(path))
      if (groupId === UNREGISTERED_PASS_ID) groupId = id
    }
    const collectedStamp = this.stampOf(path)
    // `:107`：收集之后又编辑了 —— 那一拍编辑自己排了替代刷新，这一份不落地。
    if (this.stampOf(path) !== collectedStamp) return { applied: false, generation, items }
    this.stamps.set(path, collectedStamp)
    this.onApply(path, { items, groupId, collectedStamp })
    return { applied: true, generation, items }
  }

  cancelTimer(path: string): void {
    const timer = this.timers.get(path)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(path)
  }

  /** 关掉编辑器时把待跑的去抖撤掉（上游 `destroy` 那一侧的清理）。 */
  dispose(): void {
    for (const path of [...this.timers.keys()]) this.cancelTimer(path)
    this.generations.clear()
    this.stamps.clear()
  }
}

// ---------------------------------------------------------------- GeneralHighlightingPass 的调度

/**
 * 泛型参数 `T` 是这一层收集到的注解形状（上游那一列叫 `HighlightInfo` 列表）。
 * 写成泛型而不是就地钉死 `HighlightLayerItem`：调用方（`src/annotatorHighlightLayer.ts`）
 * 手里是 `Annotation[]`，钉死会把结果拓宽成 `HighlightLayerItem[]`，那份就没法灌回
 * `setAnnotatorAnnotations`（它要 `readonly Annotation[]`）了。默认参数留给只用基类的老调用方。
 */
export interface GeneralHighlightPassInput<T extends HighlightLayerItem = HighlightLayerItem> {
  path: string
  language: string
  text: string
  /** 上一轮跑时看到的内容（`MainHighlightingPassFactory` 的短路判据用它）。 */
  previousText: string | null
  batchMode: boolean
  /** 返回这一拍产出的注解。 */
  collect: (dirtyLines: readonly DirtyLineRange[] | null) => readonly T[]
}

export interface GeneralHighlightPassRun<T extends HighlightLayerItem = HighlightLayerItem> {
  /** `myUpdateAll`：true = 整份重算，false = 只算脏范围。 */
  updateAll: boolean
  dirtyLines: DirtyLineRange[] | null
  passName: string
  items: T[]
  /** 同一内容重复触发 → 整拍跳过（`MainHighlightingPassFactory`）。 */
  skipped: boolean
}

/** `GeneralHighlightingPass.java:91` 的 pass 名 = `AnalysisBundle.message("pass.syntax")`。 */
export const SYNTAX_PASS_NAME = 'Syntax analysis'

/**
 * `GeneralHighlightingPass` 的调度口径（`GeneralHighlightingPass.java:79-96,112-117`）：
 * 首次见到该文件 = `updateAll`（整份重算）；之后按 `DirtyScopeTracker` 给的脏行范围只算那一段。
 * 同一内容重复触发整拍跳过 —— 那是 `MainHighlightingPassFactory` 的既有判据，不是新增的。
 */
export function runGeneralHighlightingPass<T extends HighlightLayerItem>(
  tracker: DirtyScopeTracker,
  input: GeneralHighlightPassInput<T>,
): GeneralHighlightPassRun<T> {
  const note = tracker.noteText(input.path, input.text)
  if (note.ranges.length === 0) {
    return { updateAll: false, dirtyLines: null, passName: SYNTAX_PASS_NAME, items: [], skipped: true }
  }
  const updateAll = note.previousText === null
  const dirtyLines = updateAll ? null : tracker.takeDirtyRanges(input.path)
  if (!updateAll) tracker.takeDirtyRanges(input.path)
  return {
    updateAll,
    dirtyLines,
    passName: SYNTAX_PASS_NAME,
    items: [...input.collect(dirtyLines)],
    skipped: false,
  }
}

/**
 * `EditorBoundHighlightingPass` 的调度：只跑 `kind === 'editorBound'` 的 pass，
 * **每次调用都跑**（不查 `DirtyScopeTracker` 的「内容没变」），因为它带的是编辑器专属 markup
 * （`EditorBoundHighlightingPass.java:8-15` 的代码折叠那一类），文本不动也要重画。
 *
 * `editorId` 是编辑器身份：同一个文档开几个编辑器就要跑几遍（上游那句 "even if there are many
 * for this document"）。传给 pass 的 `dirtyRanges` 恒为空数组 —— 折叠标记的失效判据是
 * `TextEditorHighlightingPass.isValid()`（`:104-122`：document 的 modification stamp 没变），
 * 不是行范围。
 */
export function runEditorBoundHighlightPasses(
  registrar: HighlightPassRegistrar,
  path: string,
  text: string,
  editorId: string,
): number[] {
  const ran: number[] = []
  for (const pass of registrar.findByKind('editorBound')) {
    pass.run({ path, text, editorId, dirtyRanges: [], previousText: null })
    ran.push(pass.id)
  }
  return ran
}
