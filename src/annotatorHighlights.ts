// 内建注解器与它们的 CodeMirror 装饰层 —— 上游 `HyperlinkAnnotator`（注释里的网页超链接）
// 与 `LspDiagnosticsCustomizer` 的 tags 映射（未使用符号 / 已废弃的"灰掉"）这两族。
//
// 两个都是真正的 `Annotator`：上游 `HyperlinkAnnotator implements Annotator`
// （`HyperlinkAnnotator.java:50`），而 tags 那条链的上游形态是
// `LspDiagnosticsCustomizer.kt:93-96` 的 `getSpecialHighlightType` —— 一个按诊断内容
// 决定 `ProblemHighlightType` 的定制点，在本仓的架构里就是"读诊断表的注解器"。
//
// 逐条：
//   · `HyperlinkAnnotator.annotate`（:55-70）：`if (holder.isBatchMode()) return` 先过批处理闸门，
//     再 `WebReference.isWebReferenceWorthy(element)`（`WebReference.java:95-97`）只对
//     "可能藏外链"的宿主问引用。本仓没有 PSI 宿主，那个判据的等价物是"在**注释里**"——
//     注释是本仓唯一确定不会藏可执行引用的地方。
//   · `HyperlinkAnnotator.java:117-130`：`WebReference` 分支画 `INACTIVE_HYPERLINK_ATTRIBUTES`
//     并带 message（`:151-158` 的 `getMessage()` = `IdeBundle` 的 `open.url.in.browser.tooltip`
//     加上 Go To Declaration 的键位文本）。
//   · `HighlightInfoType.java:49-51`：`UNUSED_SYMBOL` → `CodeInsightColors.NOT_USED_ELEMENT_ATTRIBUTES`；
//     `DefaultColorSchemesManager.xml:2615-2619`（New UI 深色）给的是 FOREGROUND `72737A`
//     单独一档灰（`Annotation.java:281` 把 `LIKE_UNUSED_SYMBOL` 映到这个 key）。
//     `HighlightInfoType.java:217-219` + `AnalysisBundle.properties:19` 给显示名 "Unused declaration"。
//   · `LspHighlightingApplier.kt:328-334` 的 `toHighlightInfoType`：Unnecessary → UNUSED_SYMBOL、
//     Deprecated → DEPRECATED、其余按 severity 走。本仓的 `diagnosticKind` 照抄这一张表。
import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
// 偏移一律走本文件自己的 `offsetOfLine`（按诊断的 0 基行号换算），不引 `editorDiagnosticMarkers`：
// 那条 import 是上一轮留下的死引用（`lspPosition` 全文没被用到），而它会把本模块变成
// `node --test` 加载不了 —— `import` 到加载失败，**所有**引用本模块的用例一起红，看着像「测试坏了」。
import { commentStyleFromState } from './commentToggle.ts'
import { commentRanges, stringRanges } from './usageHighlight.ts'
import {
  AnnotatorRegistry, type Annotation, type Annotator, type AnnotatorInput, SYNTAX_PASS_NAME,
} from './annotatorRegistry.ts'
// tags → 检查项身份的**唯一一份**判定（`LspDiagnosticsCustomizer.kt:93-96` 的等价物）：
// 问题视图/配置面走同一个函数，见 src/inspectionIdentity.ts。
import { KIND_INSPECTIONS, problemKindOf, type ProblemKind } from './inspectionIdentity.ts'
import type { LspDiagnostic } from './bridge'

/**
 * `LspDiagnostic` 加上 `tags` / `code`（宿主透传了，见 `native/lsp_support.cpp` 的 `shape_diagnostics`）。
 *
 * 声明成 **type 而不是 interface**：`ExternalAnnotatorInput.diagnostics` 的元素类型是
 * `ExternalDiagnosticShape & Record<string, unknown>`，TypeScript 只给**类型别名**的匿名对象类型
 * 隐式索引签名，interface 拿不到，所以 interface 版本赋不进去（那正是快照里 192 行的报错）。
 */
export type TaggedLspDiagnostic = LspDiagnostic & {
  /** LSP `DiagnosticTag`：1 = Unnecessary、2 = Deprecated。 */
  tags?: number[]
  code?: string | number
}

/** 上游 `IdeBundle` 的 `open.url.in.browser.tooltip`（`HyperlinkAnnotator.getMessage()` 用的那一条）。 */
export const OPEN_URL_TOOLTIP = 'Open in browser'

/** 上游 `HighlightDisplayKey` 给 UNUSED_SYMBOL 注册的显示名（`HighlightInfoType.java:50,217-219`）。 */
export const UNUSED_SYMBOL_DISPLAY_NAME = 'Unused declaration'

// ---------------------------------------------------------------- 诊断 tags → 注解类型

/**
 * `LspHighlightingApplier.kt:328-334` 的 `toHighlightInfoType` 的可移植子集：
 * tags 里的 Unnecessary(1) → 未使用符号、Deprecated(2) → 已废弃，其余按 severity 走。
 * 返回 null 表示这条诊断**不产生**文字属性注解（只有波浪线/行号标记，那是 `editorDiagnosticMarkers.ts` 的活）。
 */
export function diagnosticKind(diagnostic: TaggedLspDiagnostic): ProblemKind | null {
  return problemKindOf(diagnostic.tags)
}

/** LSP severity（1..4）→ 本仓的四档（与 `src/highlightLevels.ts` 的档位同名）。 */
function severityOf(diagnostic: LspDiagnostic): Annotation['severity'] {
  if (diagnostic.severity === 1) return 'error'
  if (diagnostic.severity === 2) return 'warning'
  if (diagnostic.severity === 3) return 'information'
  return 'weakWarning'
}

// ---------------------------------------------------------------- 注解器一：未使用符号 / 已废弃

/**
 * 诊断 tags 注解器（`LspDiagnosticsCustomizer.getSpecialHighlightType`，
 * `LspDiagnosticsCustomizer.kt:93-96` 的等价物）。产出的是**文字属性**那条注解
 * （上游走 `HighlightInfoType.UNUSED_SYMBOL`/`DEPRECATED` → `TextAttributesKey`），
 * 波浪线不在这里 —— 那是本仓 `editorDiagnosticMarkers.ts` 已经画的那一层。
 */
export const unusedDeclarationAnnotator: Annotator = {
  id: 'lsp.diagnosticTags',
  languages: ['*'],
  displayName: UNUSED_SYMBOL_DISPLAY_NAME,
  annotate(input: AnnotatorInput) {
    const diagnostics = (input.external?.diagnostics ?? []) as readonly TaggedLspDiagnostic[]
    const lines = input.dirtyLines
    const out: Omit<Annotation, 'annotator' | 'batchMode'>[] = []
    for (const diagnostic of diagnostics) {
      const kind = diagnosticKind(diagnostic)
      if (!kind) continue
      // 增量拍只收落在脏行里的（`GeneralHighlightingPass` 的 myUpdateAll=false 那条路）。
      if (lines && !lines.some(range => range.start <= diagnostic.line && diagnostic.line <= range.end)) continue
      const start = offsetOfLine(input.text, diagnostic.line) + Math.max(0, diagnostic.character)
      const end = diagnostic.endLine !== undefined && diagnostic.endCharacter !== undefined
        ? offsetOfLine(input.text, diagnostic.endLine) + Math.max(0, diagnostic.endCharacter)
        : start
      out.push({
        from: start,
        to: end,
        severity: severityOf(diagnostic),
        kind,
        description: kind === 'unusedSymbol' ? UNUSED_SYMBOL_DISPLAY_NAME : 'Deprecated',
      })
    }
    return out
  },
}

/** 第 `line` 行（0 基）的起始偏移。 */
function offsetOfLine(text: string, line: number): number {
  if (line <= 0) return 0
  let at = 0
  for (let current = 0; current < line; ++current) {
    const next = text.indexOf('\n', at)
    if (next < 0) return text.length
    at = next + 1
  }
  return at
}

// ---------------------------------------------------------------- 注解器二：注释里的网页超链接

/**
 * `http(s)://…`，终止于空白与常见标点。**带 scheme 是硬条件** —— 注释里的裸词
 * （`TODO`、`TBD`）不该变成一个点开就跳浏览器的链接。
 *
 * `g` 标志是硬要求：`webUrlsIn` 走 `String.prototype.matchAll`，而它对**非全局**正则会直接抛
 * `TypeError: ... called with a non-global RegExp argument`（`matchAll` 不克隆、不改 lastIndex，
 * 只认全局正则）。少了 `g`，这个注解器每跑一次就抛一次 —— 之前没暴露是因为整层是零消费方。
 */
const WEB_URL = /\bhttps?:\/\/[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?]/g

/**
 * `HyperlinkAnnotator` 的等价物。只在**注释**里找（`HyperlinkAnnotator.java:58` 那个
 * `isWebReferenceWorthy` 闸门在无 PSI 的架构里落成"在注释里"）。
 * URL 落在字符串字面量里的那一份由 `stringRanges` 挖掉。
 */
export const webLinkAnnotator: Annotator = {
  id: 'comment.webLink',
  languages: ['*'],
  displayName: 'Web link',
  annotate(input: AnnotatorInput) {
    // 上游 `HyperlinkAnnotator.java:56`：批处理不画交互式的东西。
    if (input.batchMode) return []
    const out: Omit<Annotation, 'annotator' | 'batchMode'>[] = []
    const style = input.external?.commentStyle ?? null
    const comments = commentRanges(input.text, style)
    const strings = stringRanges(input.text)
    for (const comment of comments) {
      const body = input.text.slice(comment.from, comment.to)
      for (const hit of webUrlsIn(body)) {
        const from = comment.from + hit.from
        const to = comment.from + hit.to
        // 字符串字面量（注释里也可能有引号片段）里出现的不是链接。
        if (strings.some(range => range.from < to && range.to > from)) continue
        out.push({ from, to, severity: 'information', kind: 'hyperlink', target: hit.url, description: OPEN_URL_TOOLTIP })
      }
    }
    return out
  },
}

/** `body` 里的全部网页 URL（相对区间）。独立成函数是为了能在测试里直接判。 */
export function webUrlsIn(body: string): { from: number; to: number; url: string }[] {
  const out: { from: number; to: number; url: string }[] = []
  for (const match of body.matchAll(WEB_URL)) {
    const url = match[0]
    out.push({ from: match.index, to: match.index + url.length, url })
  }
  return out
}

// ---------------------------------------------------------------- 注册表与分派

/** 本仓的注解器注册表（进程内单例；上游那份在插件容器里，见本文件头的"差异"一节）。 */
export const annotatorRegistry = new AnnotatorRegistry()
annotatorRegistry.register(unusedDeclarationAnnotator)
annotatorRegistry.register(webLinkAnnotator)

export interface AnnotatorHighlightInput {
  path: string
  language: string
  text: string
  diagnostics: readonly TaggedLspDiagnostic[]
  commentStyle: ReturnType<typeof commentStyleFromState>
  dirtyLines?: readonly { start: number; end: number }[] | null
  batchMode?: boolean
  dumb?: boolean
}

/** 跑一遍全部分派（`AnnotatorRunner.runAnnotators` 的同步版）。 */
export function runAnnotators(input: AnnotatorHighlightInput): Annotation[] {
  return annotatorRegistry.run(input.language, {
    path: input.path,
    text: input.text,
    batchMode: input.batchMode === true,
    dumb: input.dumb,
    dirtyLines: input.dirtyLines ?? null,
    external: { diagnostics: input.diagnostics, commentStyle: input.commentStyle },
  }).annotations
}

// ---------------------------------------------------------------- CodeMirror 装饰层

export const setAnnotatorAnnotations = StateEffect.define<readonly Annotation[]>()

export const annotatorAnnotationField = StateField.define<readonly Annotation[]>({
  create: () => [],
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) if (effect.is(setAnnotatorAnnotations)) next = effect.value
    return next
  },
  provide: field => EditorView.decorations.from(field, value => decorationsOf(value)),
})

function markFor(annotation: Annotation): Range<Decoration> {
  const className = annotation.kind === 'hyperlink'
    ? 'cm-commentLink'
    : annotation.kind === 'unusedSymbol' ? 'cm-unusedSymbol'
      : annotation.kind === 'deprecated' ? 'cm-deprecatedSymbol' : 'cm-annot-info'
  return Decoration.mark({ class: className, attributes: { title: annotation.description ?? '' } }).range(annotation.from, annotation.to)
}

function decorationsOf(annotations: readonly Annotation[]): DecorationSet {
  if (!annotations.length) return Decoration.none
  // 同一区间叠多条是允许的（上游 `HighlightInfo` 就是可叠加的）—— 所以不去重，按起点排。
  return Decoration.set([...annotations].sort((a, b) => a.from - b.from || a.to - b.to).map(markFor))
}

/**
 * 这三档 class 的外观。取值全部来自 `src/tokens.css` 的既有令牌（`--muted` / `--warning`），
 * 没有任何裸色值；放在这里而不是 `src/editorTheme.ts`，是因为那一层只负责查找高亮与读用法，
 * 而这几档是注解层自己的事。深浅两套主题由 token 自己切换。
 */
export function annotatorTheme(): Extension {
  return EditorView.theme({
    // `CodeInsightColors.NOT_USED_ELEMENT_ATTRIBUTES` 那一档（`DefaultColorSchemesManager.xml:2617`
    // 给的是单独的灰 `72737A`；本仓的灰是 `--muted`）。
    '.cm-unusedSymbol': { color: 'var(--muted)' },
    // `CodeInsightColors.DEPRECATED_ATTRIBUTES`：上游是删除线 + 一档琥珀（`HighlightInfoType.java:53-54`）。
    '.cm-deprecatedSymbol': { color: 'var(--warning)', textDecoration: 'line-through' },
    // `CodeInsightColors.INACTIVE_HYPERLINK_ATTRIBUTES`（`LspHighlightingApplier.kt:236`）。
    '.cm-commentLink': { color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' },
    '.cm-annot-info': { color: 'var(--secondary)' },
  })
}

export { SYNTAX_PASS_NAME }
