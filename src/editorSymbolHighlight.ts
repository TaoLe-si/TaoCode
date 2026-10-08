// 同一符号高亮（IDEA 的 `HighlightUsagesHandler` 走 daemon 的那条链路在本仓的
// LSP 等价物：`textDocument/documentHighlight`）。光标移动后去抖地问一次语言服务，
// 把返回的整词出现位置标成 `.cm-lsp-highlight`。
//
// 从 `CodeEditor.vue` 拆出（那个文件贴着机检上限）：调度（去抖 + 飞行中丢弃过期结果）
// 与装饰状态机是自包含的，宿主只注入「当前视图 / 当前路径 / 能力是否可用」。
//
// 真正的临时高亮（`HighlightUsagesAction` = Ctrl+Shift+F7）在
// `src/usageHighlightExtension.ts`；本模块只跟 LSP 的 documentHighlight。
//
// **每次发之前先查按文件 × 按特性的表**（`src/lspPerFileCapabilities.ts`）：上游同一条链是
// `LspHighlightUsagesHandlerFactory.kt:50-55` 的三道闸，不过就 `:24` 返回 null（handler 根本不存在），
// 而不是"发了再丢弃"。查不到（能力被服务器显式拒过 / 这个文件的高亮级别是「无」）时
// 已画的标记要撤掉 —— 留着就是一份这条文件已经声明不要、却还在屏幕上画的旧高亮。
//
// ## 这一族的结果缓存（本轮补的缺项）
// 上游每一次 documentHighlight 都走 `documentHighlightCache.getOrCompute(file, offset)`
// （`platform/lsp-impl/src/impl/LspRequestExecutor.kt:55` 登记、`:180-192` 使用），命中条件是
// `LspDocumentHighlightCache.kt:8-10` 那两条：**同一个偏移**，或**光标仍落在已存区间里的任意一条**。
// 于是"在同一条引用上来回点两下"、"从一处用法走到另一处用法"这些操作**一次请求都不发**。
// 本仓之前是每次调度一趟往返（`tests/lsp-result-cache.test.mjs` 第 1、2 条钉的就是这件事）。
//   · 底座复用两份既有的东西：`src/lspPerFileCache.ts` 的 `LspPerFileCache`
//     （上游 `platform/lsp-impl/src/impl/cache/LspPerFileCache.kt:42-131` 的单槽缓存：
//     同文件 + stamp 未变 + `matches` 三条才命中，`null` 不入槽、在途合并 —— 见 `:68-82` 与 `:99-101`）；
//     `src/lspHighlightingCache.ts` 的 `documentHighlightHit()`（那条 matches 规则，此前只有判据在调、
//     生产侧零消费方）。
//   · stamp 用的是**文档修订号**（CodeMirror 的 `Text` 不可变 ⇒ 对象身份就是修订，
//     `semanticRevisionOf()` 把它压成整数）。修订一变 ⇒ `matches` 必然不成立 ⇒ 重新问 ——
//     与上游「`Document.modificationStamp` 变了就当未命中」同效。
//     修订号编在**键**里而不是编在 stamp 里，是因为本仓这份是模块级单例（上游那份跟着客户端走，
//     `LspRequestExecutor.kt:55`；本仓 `src/App.vue:2176` 每个标签页一个编辑器实例，逐实例建缓存会把
//     `src/lspPerFileCache.ts:41` 那张登记表越撑越大且永不回收），而 stamp 回调只能拿到 `file`、
//     拿不到"是哪个编辑器在问"。两条判据（同修订 + 位置命中）都在 `matches` 里，效果与上游三条一致。
//   · 编辑后区间跟着文档走：`LspClientImpl.kt:215-220` 的注释写明不做这一步「编辑之前应用上的
//     高亮会一直停在旧偏移上」。规则本体在 `remapHighlightRanges()`（与语义着色层共用）。
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { request as bridgeRequest, type LspHighlightResult } from './bridge.ts'
import { lspFileFeatures } from './lspPerFileCapabilities.ts'
import { LspPerFileCache } from './lspPerFileCache.ts'
import { documentHighlightHit, remapHighlightRanges, type TextRange } from './lspHighlightingCache.ts'
import { lspPosition } from './editorDiagnosticMarkers.ts'
import { semanticRevisionOf } from './semanticHighlighting.ts'

/** 画在编辑器里的一条高亮（文档偏移）。 */
export interface SymbolHighlightMark { from: number; to: number }

export const setSymbolHighlights = StateEffect.define<SymbolHighlightMark[]>()

/** 缓存里存的那份形状：与上游 `TextRange` 同形的半开区间（`documentHighlightHit()` 吃的就是它）。 */
interface HighlightQuery {
  /** 这一次查询是为哪个文档修订取的（`semanticRevisionOf(state.doc)`）。 */
  revision: number
  /** 光标偏移（上游 `getDocumentHighlightsCaching(file, offset)` 的那个 offset）。 */
  offset: number
}

function spansOf(marks: readonly SymbolHighlightMark[]): TextRange[] {
  return marks.map(mark => ({ start: mark.from, end: mark.to }))
}

/**
 * documentHighlight 的结果缓存（上游 `LspRequestExecutor.kt:55` 的那一份 `documentHighlightCache`）。
 * 单槽 + 「同文件 / 同修订 / 同偏移或落在已存区间内」三条命中判据；`null` 不入槽；同文件的并发查询
 * 合并在途那一次（`src/lspPerFileCache.ts:110-124`）；语言服务重启与服务器 `…/refresh`
 * 经 `clearAllLspCaches()` 整批作废（构造时自登记，见同文件 `:41-46`）。
 */
export const documentHighlightCache = new LspPerFileCache<HighlightQuery, readonly TextRange[]>(
  // 修订号编在键里（理由见文件头）：这一格留常量，命中判据全走 `matches`。
  () => 'revision-in-key',
  {
    matches: (stored, storedRanges, queried) => stored.revision === queried.revision
      && documentHighlightHit(stored.offset, storedRanges, queried.offset),
  },
)

export const symbolHighlightField = StateField.define<SymbolHighlightMark[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setSymbolHighlights)) return effect.value
    // 编辑后区间跟着文档走（`LspClientImpl.kt:215-220` 的那一步）：被编辑吃掉的映射后零宽 ⇒ 丢掉。
    if (transaction.docChanged) {
      return remapHighlightRanges(value, transaction.changes,
        mark => ({ start: mark.from, end: mark.to }),
        (_mark, span) => ({ from: span.start, to: span.end }))
    }
    return value
  },
  provide: f => EditorView.decorations.compute([f], state => {
    const builder = new RangeSetBuilder<Decoration>()
    let last = -1
    for (const range of [...state.field(f)].sort((a, b) => a.from - b.from || a.to - b.to)) {
      if (range.to <= range.from || range.from < last) continue
      builder.add(range.from, range.to, Decoration.mark({ class: 'cm-lsp-highlight' }))
      last = range.to
    }
    return builder.finish()
  }),
})

export interface SymbolHighlightDeps {
  /** LSP 可用且不是大文件模式。 */
  enabled: () => boolean
  path: () => string
  view: () => EditorView | undefined
  /**
   * 判据注入的假往返（生产仍用 `src/bridge.ts` 那一个）。同一做法的先例：
   * `src/docHoverContent.ts:135` 的 `request?`、`src/cvLocalVision.ts` 的 `createCodeVisionLocalChannel({request})`。
   */
  request?: <T>(method: string, params: Record<string, unknown>) => Promise<T>
}

/** 去抖时长：跟着编辑走，比补全宽松一点即可（与 LSP 请求的 400ms 同一量级）。 */
const DEBOUNCE_MS = 160

/**
 * 服务端答案 → 当前文档的区间。越界的行列丢掉（一个畸形 token 不该把编辑器打挂）；
 * 终点不大于起点的同样丢（上游 `LspHighlightingCache.kt:215-222` `buildHighlightings` 里
 * `getRangeInDocument(...) ?: continue` 同一条 —— 落不进文档的区间就不进缓存）。
 */
function marksOfDocument(state: EditorState, result: LspHighlightResult): SymbolHighlightMark[] {
  const marks: SymbolHighlightMark[] = []
  for (const item of result.highlights ?? []) {
    try {
      const from = lspPosition(state.doc, item.startLine, item.startChar)
      const to = lspPosition(state.doc, item.endLine, item.endChar)
      if (to > from) marks.push({ from, to })
    } catch { /* 越界：丢掉这一条 */ }
  }
  return marks
}

export function createSymbolHighlight(deps: SymbolHighlightDeps) {
  const send = deps.request ?? (bridgeRequest as <T>(method: string, params: Record<string, unknown>) => Promise<T>)
  let timer: number | undefined
  let generation = 0

  async function run() {
    const editor = deps.view()
    if (!editor || !deps.enabled()) return
    const current = ++generation
    const head = editor.state.selection.main.head
    const info = editor.state.doc.lineAt(head)
    const path = deps.path()
    // 闸在缓存**之前**：上游 `LspHighlightingCache.kt:62-63` 的 `getHighlightings()` 第一行就是
    // `if (!isSupportedForFile(file)) return emptyList()` —— 不过那道闸连手里那份结果都不返回，
    // 于是"这个文件被改成不显示任何高亮 / 这条能力被服务器拒过"的那一拍必然撤掉旧标记，
    // 而不是靠缓存继续把旧高亮画在屏幕上。
    if (!lspFileFeatures.plan('documentHighlight', path).ask) { clear(); return }
    const revision = semanticRevisionOf(editor.state.doc)
    // 先问缓存（上游 `getDocumentHighlightsCaching` 就是 `documentHighlightCache.getOrCompute`，
    // `LspRequestExecutor.kt:181`）：命中 ⇒ 一次往返都不发；未命中 ⇒ 这一趟里发一次并落进槽。
    const ranges = await documentHighlightCache.getOrCompute(path, { revision, offset: head }, async () => {
      // 每次请求前先查表（上游同一条链的三道闸在 `LspHighlightUsagesHandlerFactory.kt:50-55`，
      // 不过就 `:24` 返回 null —— handler 根本不建，不是"发出去再看回来的是什么"）。
      const attempt = await lspFileFeatures.ask<LspHighlightResult>('documentHighlight', path,
        () => send<LspHighlightResult>('lsp.request', { kind: 'documentHighlight', path, line: info.number - 1, character: head - info.from }))
      if (!attempt.asked) { clear(); return null }   // 这一条文件不再问语言服务：已画的标记要撤掉
      if (!attempt.ok) {
        // 服务器失败：旧高亮留着无害（与接入本表之前的吞错口径逐字一致）；但**确定被拒**的那一发
        // 要把画着的撤掉 —— 表里已经记下这条能力不支持，留着就是一条已声明没有、却还在屏幕上画的高亮。
        if (!lspFileFeatures.plan('documentHighlight', path).ask) clear()
        return null
      }
      return spansOf(marksOfDocument(editor.state, attempt.value))
    })
    if (!ranges) return
    const target = deps.view()
    if (!target || current !== generation) return
    // 接受闸门（上游 `LspHighlightingCache.kt:170-177`：回来时文档戳变了就整份不收、只重排下一次）：
    // 同修订 + 同一个文件才认，否则这份行列是新内容上的偏移量，顶上去会把高亮画错位置。
    if (deps.path() !== path || semanticRevisionOf(target.state.doc) !== revision) return
    target.dispatch({ effects: setSymbolHighlights.of(ranges.map(range => ({ from: range.start, to: range.end }))) })
  }

  function schedule() {
    if (!deps.enabled()) return
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => { timer = undefined; void run() }, DEBOUNCE_MS)
  }

  /** 关掉语言服务/大文件模式时把已画的去样撤掉 —— 留着就是一份没人再更新的旧标记。 */
  function clear() {
    ++generation
    deps.view()?.dispatch({ effects: setSymbolHighlights.of([]) })
  }

  function dispose() {
    ++generation
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  // `run` 是给判据直接驱动的那一个入口（生产的调度走 `schedule()` 的去抖）；
  // 与 `src/cvLocalVision.ts` 把 `refresh()` 一并返回、由判据数往返次数是同一套做法。
  return { extension: symbolHighlightField as Extension, schedule, clear, dispose, run }
}
