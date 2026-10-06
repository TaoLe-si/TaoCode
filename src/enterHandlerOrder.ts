// 回车家族的**问题次序表**（`lp/editor-actions` 重点①：`Enter` 按下时那串 delegate 谁先被问）。
//
// 为什么要把次序做成数据而不是写在 `if` 链里：上游的次序**不是**代码写死的调用顺序，而是扩展点表
// 排完序之后的结果（`order="last"` 会把一条推到表尾），而且它带着「第一个不返回 Continue 的就 break」
// 这一条语义（`platform/lang-impl/src/com/intellij/codeInsight/editorActions/EnterHandler.java:136-153`）。
// 次序散在 if 链里时，谁都可能在不看上游的情况下把它调乱 —— 本文件就是那张表 + 那个循环。
//
// 上游坐标（2026-10-06 逐行打开核对；派单给的 `platform/ide/srcCodes/.../editor/actions/EnterBetweenBracesHandler.java`
// 这一路**在这棵树里不存在**，真实路径是 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/`，
// 且 `EnterBetweenBracesHandler.java:13` 已是 `@Deprecated`，实体是 `EnterBetweenBracesFinalHandler.java:41+`）：
//   · EP 声明：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:399`
//     （`com.intellij.enterHandlerDelegate`，接口 = `enter/EnterHandlerDelegate.java:17`，
//     `EP_NAME` 在 `:18`）。
//   · 五条 `Result`：`enter/EnterHandlerDelegate.java:25-26`
//     `Default / Continue / DefaultForceIndent / DefaultSkipIndent / Stop`。
//   · 循环与 break 语义：`EnterHandler.java:136`（`for (delegate : EP_NAME.getExtensionList())`）、
//     `:142-144`（`Stop` ⇒ **直接 return**，原 handler 都不跑）、
//     `:145-153`（不是 `Continue` 的每一档都 break：`DefaultForceIndent` 置 forceIndent、
//     `DefaultSkipIndent` 置 forceSkipIndent，然后 break）。
//   · forceIndent 的实际用处：`EnterHandler.java:167-171` —— 只有 `SMART_INDENT_ON_ENTER`
//     （`platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:129`，默认 true）
//     **关掉**时，`Default` 与 `DefaultForceIndent` 才有差别（差别只在回车后光标要不要跳过行首空白）；
//     开着时两档同结果。本仓 `EditorSettings` 里没有 `SMART_INDENT_ON_ENTER` 这一条键
//     （`src/settingsModel.ts` 全文无 smartIndent ⇒ 核对过）⇒ 两档在本仓**观察不到差别**，
//     表里照上游记着，`applyEnterHit` 按上游默认档（true）走，不假装有这条设置。
//   · 注册与 `order`：`intellij.platform.lang.impl.xml:1159-1171`（每条的行号写在下面的表里）。
//     `order="last"` 的两条（`blockComment` `:1161-1162`、`InjectedIndentPostProcessor` `:1167-1170`）
//     被推到整张表尾部 ⇒ 本仓的有效问次序见 `ENTER_HANDLER_ORDER` 的 `rank`。
//     同为 `last` 的这两条之间谁先谁后：上游没有再给约束（跨 descriptor 时由加载顺序决定）⇒
//     **无法核实**，本表按它们在同一份 XML 里的声明顺序记，且两条的相位不同（一条 preprocess、一条
//     postprocess），次序对本仓不可观察。
//   · 别的插件也往这张表里加东西（`order="first"` 的有 `plugins/yaml/resources/intellij.yaml.xml:54`
//     与 `python/python-syntax/resources/intellij.python.syntax.xml:29`；`order="after EnterInLineCommentHandler"`
//     的有 `java/java-backend/resources/META-INF/JavaPlugin.xml:555`）⇒ 本表只覆盖**平台那 7 条**，
//     也就是本仓能打开的语言（Java/C++/TS/JSON/HTML/CSS/纯文本，`src/editorLanguage.ts:15-21`）里
//     真正会被问到的那一段；YAML/Python/Groovy/Markdown 那几条不在本仓的语言档里，不搬。
//
// 「本仓这一条谁来实现」写在 `ported` / `owner` 两列里，没实现的按 `Result.Continue` 处理
// （= 上游问到了但没人接 ⇒ 循环继续），不是跳过不问。
import type { ChangeSpec } from '@codemirror/state'

/** 上游 `EnterHandlerDelegate.Result` 的五档（`enter/EnterHandlerDelegate.java:25-26`），小写是本仓的写法。 */
export const ENTER_RESULTS = ['continue', 'stop', 'default', 'defaultForceIndent', 'defaultSkipIndent'] as const
export type EnterResult = (typeof ENTER_RESULTS)[number]

/** 一张表里的相位：`preprocess` 在插换行**之前**问，`postprocess` 在之后（上游只有那一条后置处理器）。 */
export type EnterPhase = 'preprocess' | 'postprocess'

export interface EnterStepSpec {
  /** 排序后第几个被问（1 = 最先）。 */
  readonly rank: number
  /** XML 里的 bean id；没写 id 的取类名（与上游 `id` 属性的缺省一致）。 */
  readonly id: string
  /** 注册行的实现类全名（XML 里 `implementation` 的值，逐字照抄）。 */
  readonly className: string
  /** 注册行（`platform/lang-impl/resources/intellij.platform.lang.impl.xml`）。 */
  readonly xml: string
  /** XML 里的 `order` 属性（空串 = 没写）。 */
  readonly orderAttr: '' | 'last'
  readonly phase: EnterPhase
  /** 命中时上游返回的那一档（`null` = 这一条在本树里从不返回非 `Continue`）。 */
  readonly result: Exclude<EnterResult, 'continue'> | null
  /** 命中那一档的出处（`文件:行号`，同一目录下的类）。 */
  readonly resultAt: string
  /** 本仓有没有实现这一条。 */
  readonly ported: boolean
  /** 没实现/换地方实现的理由（一句话，指得到人话落点）。 */
  readonly owner: string
}

export const ENTER_HANDLER_ORDER: readonly EnterStepSpec[] = [
  {
    rank: 1, id: 'EnterInStringLiteralHandler',
    className: 'com.intellij.codeInsight.editorActions.enter.EnterInStringLiteralHandler',
    xml: 'intellij.platform.lang.impl.xml:1159', orderAttr: '', phase: 'preprocess',
    result: 'defaultForceIndent', resultAt: 'EnterInStringLiteralHandler.java:81', ported: true,
    owner: 'src/enterHandlers.ts 的第①支（门槛 = 这门语言有没有 JavaLike 的引号连接符，同文件 :39-42/:109-114）',
  },
  {
    rank: 2, id: 'EnterInLineCommentHandler',
    className: 'com.intellij.codeInsight.editorActions.enter.EnterInLineCommentHandler',
    xml: 'intellij.platform.lang.impl.xml:1160', orderAttr: '', phase: 'preprocess',
    result: 'defaultForceIndent', resultAt: 'EnterInLineCommentHandler.java:88', ported: true,
    owner: 'src/enterHandlers.ts 的第②支',
  },
  {
    rank: 3, id: 'afterUnmatchedBrace',
    className: 'com.intellij.codeInsight.editorActions.enter.EnterAfterUnmatchedBraceHandler',
    xml: 'intellij.platform.lang.impl.xml:1163-1164', orderAttr: '', phase: 'preprocess',
    result: 'defaultForceIndent', resultAt: 'EnterAfterUnmatchedBraceHandler.java:57', ported: true,
    owner: 'src/enterHandlers.ts 的第③支；开关 = INSERT_BRACE_ON_ENTER（CodeInsightSettings.java:130，关掉 ⇒ :50-51 的 maxRBraceCount 为 0 ⇒ 整条 Continue）',
  },
  {
    rank: 4, id: 'EnterBetweenBracesHandler',
    className: 'com.intellij.codeInsight.editorActions.enter.EnterBetweenBracesFinalHandler',
    xml: 'intellij.platform.lang.impl.xml:1165-1166', orderAttr: '', phase: 'preprocess',
    result: null, resultAt: 'EnterBetweenBracesFinalHandler.java:45-122（本树里这条只有 Continue 与下面的 postProcess 支）', ported: true,
    owner: '由 CodeMirror 的 insertNewlineAndIndent 承担（isBetweenBrackets，node_modules/@codemirror/commands/dist/index.js:1514-1524）；差别三条见 src/enterHandlers.ts 模块头',
  },
  {
    rank: 5, id: 'EnterAfterJavadocTagHandler',
    className: 'com.intellij.codeInsight.editorActions.enter.EnterAfterJavadocTagHandler',
    xml: 'intellij.platform.lang.impl.xml:1171', orderAttr: '', phase: 'preprocess',
    result: 'defaultForceIndent', resultAt: 'EnterAfterJavadocTagHandler.java:77', ported: false,
    owner: 'Java 的 `@param` 标签续行，依赖 javadoc PSI；本仓没有 javadoc 解析层 ⇒ 记在未做清单',
  },
  {
    // `order="last"` ⇒ 虽然声明在第 3 行（`:1161`），实际排在整张表后面被问。
    rank: 6, id: 'blockComment',
    className: 'com.intellij.codeInsight.editorActions.enter.EnterInBlockCommentHandler',
    xml: 'intellij.platform.lang.impl.xml:1161-1162', orderAttr: 'last', phase: 'preprocess',
    result: 'default', resultAt: 'EnterInBlockCommentHandler.java:67（补闭尾那一支）与 :98（`* ` 续行那一支）', ported: true,
    owner: '判定在 src/editorEnterBlockComment.ts，接线在 src/enterHandlers.ts 的第④支；开关 = CLOSE_COMMENT_ON_ENTER（CodeInsightSettings.java:132，问在 :62）',
  },
  {
    rank: 7, id: 'EnterBetweenBracesInjectedIndentPostProcessor',
    className: 'com.intellij.codeInsight.editorActions.enter.EnterBetweenBracesFinalHandler$InjectedIndentPostProcessor',
    xml: 'intellij.platform.lang.impl.xml:1167-1170', orderAttr: 'last', phase: 'postprocess',
    result: null, resultAt: 'EnterBetweenBracesFinalHandler.java:94-96（只覆写 postProcessEnter）', ported: false,
    owner: '注入片段（host language 的 formatter 不跑）的缩进补偿，本仓没有 injected fragment 这一层 ⇒ 不适用',
  },
]

/** 载荷：一条分支要落地的编辑 + 换行前后光标怎么走。 */
export interface EnterBranch {
  /** 换行**之前**先落地的编辑（绝对偏移）。 */
  readonly edits: readonly ChangeSpec[]
  /** 换行的切点（绝对偏移）；不给 = 就在当前光标处切。 */
  readonly breakAt?: number
  /** 换行之后光标再前进的字符数（上游的 `caretAdvance`，`EnterHandler.java:168` 那一档）。 */
  readonly caretAdvance?: number
  /** 分支自己声明的档（块注释那条有两档）；不给 = 用表里那一档。 */
  readonly result?: EnterResult
  /** 落文档改动时挂的 `userEvent`（决定 CodeMirror 的撤销分组；上游没有这一层，本仓照本仓既有档位给）。 */
  readonly userEvent?: string
}

/** 表里排完序、真正会被问到的那一段（preprocess 相位）。 */
export function preprocessSteps(steps: readonly EnterStepSpec[] = ENTER_HANDLER_ORDER): EnterStepSpec[] {
  return steps.filter(step => step.phase === 'preprocess')
}

export interface EnterHit {
  readonly step: EnterStepSpec
  readonly branch: EnterBranch
  /** 这一支最终算的那一档。 */
  readonly result: EnterResult
}

/**
 * `EnterHandler.java:136-153` 那个循环的等价物：按 `steps` 的**数组顺序**逐个问，
 * 第一个给出载荷的赢（其余按 `Continue` 处理），返回 null = 全都不接 ⇒ 交回默认回车。
 *
 * 两条如实的简化：① 本仓没实现的那些条目（`ported === false`）不参与问
 * （上游会问它们、它们对我们的文档返回 Continue ⇒ 观察不到差别）；
 * ② `postprocess` 相位的条目本表里没有实现者，循环只跑 `preprocess` 那一段。
 */
export function preprocessEnter(
  steps: readonly EnterStepSpec[], ask: (step: EnterStepSpec) => EnterBranch | null,
): EnterHit | null {
  for (const step of preprocessSteps(steps)) {
    if (!step.ported) continue
    const branch = ask(step)
    if (!branch) continue
    const result = branch.result ?? step.result ?? 'default'
    // `:142-144` 的 Stop 与 `:145-153` 的其余档都停在这一条：本函数把「停在哪一条」原样交出去。
    return { step, branch, result }
  }
  return null
}

/** 命中那一档要不要「插完换行再缩进」（本仓只有这一种默认回车；`stop` 才是真的什么都不做）。 */
export function enterInsertsNewline(result: EnterResult): boolean {
  return result !== 'stop' && result !== 'continue'
}
