// 注解器高亮层的**宿主接线** —— 上游 `AnnotatorRunner` + `GeneralHighlightingPass` 那一族
// 在本仓编辑器里的落点（规则在 `src/annotatorHighlights.ts` / `src/annotatorRegistry.ts`）。
//
// 为什么单独一个模块：`src/annotatorHighlights.ts` 只有模型与纯函数（`runAnnotators` 的输入是
// 「文本 + 诊断 + 注释标记 + 语言」），没有人告诉它**什么时候**跑、跑完往哪派发。它此前是零消费方
// （除了自己的测试），也就是上一轮留下的「模型有了、没人用」那一类。
// 这里补的是上游那两个 pass 的**调度**口径，不是重写它：
//   · `AnnotatorRunner.runAnnotators`（`AnnotatorRunner.java:96-110,132-140`）—— 按语言分派；
//   · `GeneralHighlightingPass.java:79-96,112-117` —— 首次见到该文件整份重算（`myUpdateAll`），
//     之后只算脏行范围；
//   · 「整份 / 只算脏行 / 同一内容重复触发整拍跳过」那三拍**直接调** `src/highlightPasses.ts` 的
//     `runGeneralHighlightingPass`（本仓已有同一判据的实现），不在这里另写一套脏范围算法。
//
// 诊断来源是 LSP `publishDiagnostics`：`native/lsp_support.cpp:148-149` 已把 `code` / `tags`
// 原样透传过来，所以 `tags`（Unnecessary/Deprecated → 未使用符号 / 已废弃两档）与 `code`
// 在这一层拿得到 —— 判词 dm/highlight 里「code/tags 不透传」那条已被
// `native/lsp_support.cpp:143-149` 的实现与注释推翻，本模块按拿得到来写。
//
// 编码方式照 `src/editorSymbolHighlight.ts` 的 `createSymbolHighlight`：宿主只注入
// 「当前视图 / 当前路径 / 能力是否可用 / 诊断 / 注释标记 / 语言」，调度与去抖在这里自持。
import { DirtyScopeTracker, runGeneralHighlightingPass } from './highlightPasses.ts'
import {
  annotatorTheme, runAnnotators, setAnnotatorAnnotations, annotatorAnnotationField,
  type TaggedLspDiagnostic,
} from './annotatorHighlights.ts'
import type { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/** 去抖时长：与 `highlightPasses.ts` 的 `EDIT_DEBOUNCE_MS`（`LspHighlightingApplier.kt:288` 的 40ms）同值。 */
export const ANNOTATOR_DEBOUNCE_MS = 40

export interface AnnotatorHostDeps {
  /** LSP 可用且不是大文件模式。 */
  enabled: () => boolean
  path: () => string
  /** 语言 id（CodeMirror 的 `language` 名；注解器按它分派，见 `AnnotatorRegistry.forLanguage`）。 */
  language: () => string
  view: () => EditorView | undefined
  /** 当前语言的诊断表（宿主从 `lspDiagnostics` 取那一份注入）。 */
  diagnostics: () => readonly TaggedLspDiagnostic[]
  /** 该语言的注释标记（CodeMirror 的 `commentTokens`）。 */
  commentStyle: () => { line?: string; block?: [string, string] } | null
  /** 索引未就绪时跳过非 dumb 感知注解器（`AnnotatorRunner.java:137-139`）。 */
  dumb: () => boolean
}

/**
 * 一层注解器高亮。返回形状照 `createSymbolHighlight`：`extension` 挂进编辑器，
 * `schedule()` 在文档或诊断变化时调一次，`clear()` 在关掉语言服务时撤掉已画的，
 * `dispose()` 在编辑器卸载时清理定时器与脏范围。
 */
export function createAnnotatorHighlightLayer(deps: AnnotatorHostDeps) {
  const tracker = new DirtyScopeTracker()
  let timer: number | undefined
  let generation = 0

  function run() {
    const view = deps.view()
    if (!view || !deps.enabled()) return
    // 代数 +1 = 取代此前还没跑的那一次（`LspHighlightingApplier.kt:76-80,102` 的缓存代数去重）。
    const myGeneration = ++generation
    const path = deps.path()
    const text = view.state.doc.toString()
    const result = runGeneralHighlightingPass(tracker, {
      path,
      language: deps.language(),
      text,
      previousText: null,   // 由 tracker 自己记（MainHighlightingPassFactory 的短路判据用它）
      batchMode: false,
      collect: dirtyLines => runAnnotators({
        path,
        language: deps.language(),
        text,
        diagnostics: deps.diagnostics(),
        commentStyle: deps.commentStyle(),
        dirtyLines,
        dumb: deps.dumb(),
      }),
    })
    // 同一内容重复触发 → 整拍跳过，已画的留着（`MainHighlightingPassFactory`）。
    if (result.skipped) return
    if (myGeneration !== generation) return
    view.dispatch({ effects: setAnnotatorAnnotations.of(result.items) })
  }

  function schedule() {
    if (!deps.enabled()) return
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => { timer = undefined; run() }, ANNOTATOR_DEBOUNCE_MS)
  }

  /** 关掉语言服务 / 进大文件模式时撤掉已画的 —— 留一份没人再更新的旧标记就是错的。 */
  function clear() {
    ++generation
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    tracker.forget(deps.path())
    deps.view()?.dispatch({ effects: setAnnotatorAnnotations.of([]) })
  }

  function dispose() {
    ++generation
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    tracker.forget(deps.path())
  }

  return {
    /** 装饰层 + 三档外观（`annotatorTheme`）：一起挂，缺一就会出现「有 class 没样式」。 */
    extension: [annotatorAnnotationField, annotatorTheme()] as Extension,
    schedule,
    clear,
    dispose,
  }
}
