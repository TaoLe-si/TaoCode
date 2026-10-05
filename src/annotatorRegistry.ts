// 注解器（annotator）的**注册与分派** —— 上游 `Annotator` / `ExternalAnnotator` / `AnnotatorRunner` /
// `GeneralHighlightingPass` 一族在本仓的等价物。
//
// 上游逐条：
//   · `Annotator.annotate(element, holder)`（`platform/analysis-api/.../lang/annotation/Annotator.java:22,36`）
//     —— 注解器拿到 PSI 元素，把注解塞进 holder；本仓没有 PSI，给的是**整份文本 + 脏行范围**。
//   · `LanguageAnnotators.INSTANCE.allForLanguageOrAny(language)`（`AnnotatorRunner.java:102`）
//     —— 按语言取注解器，**并且带上"任意语言"的那些**；`AnnotatorRunner.java:96-110` 是
//     "先收集出现过的语言，再对每种语言取一遍"的分派。注册表这里照抄这个形状：
//     `languages: '*'` = 任意语言都跑（对应 allForLanguageOrAny 里的 any 部分）。
//   · `AnnotatorRunner.java:132-140` —— 每个注解器一个 holder，只遍历它支持的语言；
//     索引未就绪（dumb mode）的那一个被跳过（`isUsableInCurrentContext`）。本仓对应 `whenDumb`
//     开关：dumb 时跳过的注解器不产出。
//   · `HighlightInfo.fromAnnotation(annotator.getClass(), annotation, myBatchMode, document)`
//     （`AnnotatorRunner.java:154-155`）—— annotation → HighlightInfo 的转换**带着 batchMode**；
//     batchMode 一路传到 `HyperlinkAnnotator.java:56` 的 `if (holder.isBatchMode()) return`：
//     批处理不画交互式的东西。注册表把 `batchMode` 一路带到每条注解上。
//   · `GeneralHighlightingPass`（`.../daemon/impl/GeneralHighlightingPass.java:79-96,112-117`）
//     —— `myUpdateAll` 决定是整份重算还是只算脏范围，`myPriorityRange` 是优先算的区间，
//     pass 名是 `AnalysisBundle.message("pass.syntax")` = "Syntax analysis"
//     （`AnalysisBundle.properties:123`）。分趟调度的另一半在 `src/highlightPasses.ts`。
//
// 与上游的差异（如实）：本仓**没有插件贡献点宿主**（没有 plugin.xml、没有第三方注册面），
// 注册表是进程内的单例，注解器由本仓自己 `register()` 进来。第三方注解器这件事做不到，
// 不是"太复杂"，是**没有加载插件描述符的那一层**。

/** 注解的严重度档（上游 `HighlightSeverity` 的可移植子集；四档模型见 `src/highlightLevels.ts`）。 */
export type AnnotationSeverity = 'error' | 'warning' | 'weakWarning' | 'information'

/**
 * 上游 `HighlightInfoType` 那几档外观的**可移植子集**（`HighlightInfoType.java:32-54` 里
 * 文字属性 key 决定外观的那几档）。本仓的渲染层按这个名分派 CSS class。
 */
export type AnnotationKind =
  | 'information'      // HighlightInfoType.INFORMATION
  | 'unusedSymbol'     // HighlightInfoType.UNUSED_SYMBOL（:49-51，CodeInsightColors.NOT_USED_ELEMENT_ATTRIBUTES）
  | 'deprecated'       // HighlightInfoType.DEPRECATED（:53-54）
  | 'wrongRef'         // HighlightInfoType.WRONG_REF
  | 'hyperlink'        // CodeInsightColors.INACTIVE_HYPERLINK_ATTRIBUTES（LspHighlightingApplier.kt:236）
  | 'error'            // HighlightInfoType.ERROR
  | 'warning'          // HighlightInfoType.WARNING

/**
 * 声明成 **type 而不是 interface**：`src/highlightPasses.ts` 的 `HighlightLayerItem` 是
 * `{ readonly [key: string]: unknown }`，而 TypeScript 只给**类型别名**的匿名对象类型隐式索引签名，
 * interface 拿不到。写成本 interface 时 `Annotation[]` 赋不进 `readonly HighlightLayerItem[]`
 * （`src/annotatorHighlightLayer.ts:70`），反向也赋不进 `readonly Annotation[]`。
 * 与 `src/annotatorHighlights.ts` 的 `TaggedLspDiagnostic` 是同一个根因、同一味药。
 */
export type Annotation = {
  /** 偏移区间（半开）。 */
  from: number
  to: number
  severity: AnnotationSeverity
  kind: AnnotationKind
  /** 悬停/说明文案（上游 `HighlightInfo.descriptionAndTooltip`）。 */
  description?: string
  /** 点一下要做什么（`WebReference.navigate` / `OpenFileDescriptor` 那条链路）。 */
  target?: string
  /** 产出这条注解的注解器 id（上游 `HighlightInfo.fromAnnotation` 的第一个参数就是注解器类）。 */
  annotator: string
  /** 上游 `Annotation.isBatchMode` 传下来的批处理标记：批处理结果不画交互式装饰。 */
  batchMode: boolean
}

/** 外部（语言服务）给的结果的最小结构 —— 只取"行/列 + 严重度 + 消息"那几个字段。 */
export interface ExternalDiagnosticShape {
  line: number
  character: number
  endLine?: number
  endCharacter?: number
  severity: number
  message: string
  source?: string
}

/** `ExternalAnnotator` 那一侧的输入（上游是 `collectInformation` / `doAnnotate` 两拍，本仓是一次给全）。 */
export interface ExternalAnnotatorInput {
  /**
   * 语言服务推来的诊断；具体扩展字段（`tags` / `code` 那一族）由注解器自己断言成需要的形状 ——
   * 见 `src/annotatorHighlights.ts` 的 `TaggedLspDiagnostic`。
   *
   * 这里**不**写成 `ExternalDiagnosticShape & Record<string, unknown>`：那个交叉类型要求元素带索引签名，
   * 而 `LspDiagnostic` 是 interface（TS 只给匿名对象类型别名隐式索引签名），实参永远赋不进去 ——
   * 改成接口本身的形状，注解器读扩展字段时自己断言。
   */
  diagnostics?: readonly ExternalDiagnosticShape[]
  /** 语言数据里的注释标记（CodeMirror 的 `commentTokens`）。 */
  commentStyle?: { line?: string; block?: [string, string] } | null
}

export interface AnnotatorInput {
  /** 工作区相对路径。 */
  path: string
  text: string
  /** 这一拍要算的行范围（0 基、闭区间）；`null` = 整份重算（`myUpdateAll`）。 */
  dirtyLines: readonly { start: number; end: number }[] | null
  batchMode: boolean
  /** 外部注解器的输入（`ExternalAnnotator`）。 */
  external?: ExternalAnnotatorInput
}

export interface Annotator {
  id: string
  /** 适用的语言 id；`'*'` = 任意语言（上游 `allForLanguageOrAny` 的 any 部分）。 */
  languages: readonly string[]
  /** 上游 `PossiblyDumbAware`：false 表示索引未就绪时不跑（`AnnotatorRunner.java:137-139`）。 */
  dumbAware?: boolean
  /** 上游 `Annotator.getDisplayName` / pass 名；只在调试与状态栏上用。 */
  displayName?: string
  annotate: (input: AnnotatorInput) => readonly Omit<Annotation, 'annotator' | 'batchMode'>[]
}

/** pass 名（`GeneralHighlightingPass.java:91` 的 `AnalysisBundle.message("pass.syntax")`）。 */
export const SYNTAX_PASS_NAME = 'Syntax analysis'

/** 一次分派的结果：注解 + 跑过的注解器 id（判据与调试用）。 */
export interface AnnotatorRun {
  annotations: Annotation[]
  ran: string[]
  /** 索引未就绪而被跳过的注解器（`AnnotatorRunner.java:137-139`）。 */
  skippedDumb: string[]
}

/**
 * 注解器注册表（`LanguageAnnotators` 的进程内等价物）。
 * 分派顺序 = 注册顺序；上游那份也是"任意顺序"（`Annotator.java:15` 明确说
 * "annotators are executed in arbitrary order"），所以本仓也不承诺稳定顺序。
 */
export class AnnotatorRegistry {
  private readonly annotators = new Map<string, Annotator>()

  register(annotator: Annotator): void {
    if (this.annotators.has(annotator.id)) throw new Error(`注解器 id 重复：${annotator.id}`)
    this.annotators.set(annotator.id, annotator)
  }

  unregister(id: string): void {
    this.annotators.delete(id)
  }

  get(id: string): Annotator | undefined {
    return this.annotators.get(id)
  }

  /** 按语言取：`allForLanguageOrAny(language)` —— 命中的按注册顺序，未命中的不返回。 */
  forLanguage(language: string): Annotator[] {
    return [...this.annotators.values()].filter(annotator =>
      annotator.languages.includes('*') || annotator.languages.includes(language))
  }

  /** `AnnotatorRunner.runAnnotators` 的同步版：按语言分派、合并全部注解。 */
  run(language: string, input: Omit<AnnotatorInput, 'dirtyLines'> & { dirtyLines?: readonly { start: number; end: number }[] | null; dumb?: boolean }): AnnotatorRun {
    const annotations: Annotation[] = []
    const ran: string[] = []
    const skippedDumb: string[] = []
    const dumb = input.dumb === true
    for (const annotator of this.forLanguage(language)) {
      if (dumb && annotator.dumbAware === false) { skippedDumb.push(annotator.id); continue }
      ran.push(annotator.id)
      for (const annotation of annotator.annotate({
        path: input.path,
        text: input.text,
        batchMode: input.batchMode,
        external: input.external,
        dirtyLines: input.dirtyLines ?? null,
      })) {
        if (annotation.to <= annotation.from) continue
        annotations.push({ ...annotation, annotator: annotator.id, batchMode: input.batchMode })
      }
    }
    return { annotations, ran, skippedDumb }
  }
}

/**
 * 批处理标记（`AnnotationSession` 的 batchMode）的来源判定。
 * 上游由 `DaemonCodeAnalyzer.restart` 的调用方给；本仓的等价口径是
 * `highlightSettingsPerFile` 那种"逐文件高亮级别"里有没有到 Syntax 档 ——
 * 调用方把档位传进来，这一层只判它是不是批处理。
 */
export function isBatchMode(highlightLevel: 'none' | 'syntax' | 'inspections'): boolean {
  return highlightLevel === 'inspections'
}
