// 补全的**调用形态**（上游 `CompletionType` + 动作族）：普通 / 智能类型 / 类名。
//
// 上游三条键位（`platform/platform-resources/src/keymaps/$default.xml`）：
//   · `CodeCompletion` = Ctrl+Space —— `:732-734`，动作体 `CodeCompletionAction.java:12-17`
//     （`invokeCompletion(e, CompletionType.BASIC, 1)`）；
//   · `SmartTypeCompletion` = Ctrl+Shift+Space —— `:909-911`，动作体
//     `SmartCodeCompletionAction.java:11-17`（`CompletionType.SMART`）；
//   · `ClassNameCompletion` = Ctrl+Alt+Space —— `:843-845`，动作体
//     `ClassNameCompletionAction.java:11-17`（**BASIC + 第二次调用**，`CompletionParameters.java:113-115`
//     的 `isExtendedCompletion() = BASIC && invocationCount >= 2`）。
// 同一个键再按一次不是重来一遍：`CodeCompletionHandlerBase.java:210-213` 在补全还开着时把
// `invocationCount` 往上加（`phase.newCompletionStarted(...)`），"再按一次把范围放宽"那句提示就来自
// 这一档（`JavaCompletionContributor.java:1090-1094` + `java/openapi/resources/messages/JavaBundle.properties:113`）。
//
// 本仓的架构差在哪（报告里也有这条，写在这儿是为了不让读代码的人再查一遍）：
//   · **智能补全按类型过滤做不到。** 上游的过滤键是 PSI 算出来的期望类型
//     （`java/java-impl/src/com/intellij/codeInsight/completion/JavaCompletionUtil.java` 的
//     `getExpectedTypes(parameters)`，使用点 `JavaCompletionContributor.java:1118-1136`）；
//     LSP 的 `textDocument/completion` 只有 `context.triggerKind`/`triggerCharacter`，
//     没有"期望类型"这个字段 —— 本仓宿主发的就是 `{triggerKind:1}`（`native/lsp_session.cpp:167-169`），
//     上游自己的 LSP 前端也没做这件事（`platform/lsp-impl/src/impl/features/completion/` 七个文件里
//     没有任何 `expectedType` 的引用）。⇒ 能做的等价物是**按"期望符号种类"收窄**：
//     位置明显在等一个类型（`new `、`extends`/`implements`/`:` 之后、泛型尖括号里、`@` 注解名）时
//     只留类型类条目；推不出期望种类时**不收窄**（宁缺毋滥，不做假过滤）。
//   · **类名补全能做全**：过滤到类型类条目 + 把工程里的类名也捞进来
//     （上游 `JavaClassNameCompletionContributor.java:69-77` 的 `addAllClasses` 走的是
//     `PsiShortNamesCache`/`allScope(project)`；本仓的等价数据源是 LSP `workspace/symbol`，
//     类型种类那道门照 `platform/lsp-impl/src/impl/features/workspaceSymbol/LspGoToClassContributor.kt:6-8`
//     的四类 Class/Interface/Enum/Struct）。

import type { EditorView } from '@codemirror/view'
import { CLASS_LIKE_SYMBOL_KINDS } from './lspSymbolBridge.ts'

export type CompletionMode = 'basic' | 'smart' | 'className'

/** 上游 `CompletionType` 的三个档（`platform/analysis-api/src/com/intellij/codeInsight/completion/CompletionType.java:3-9`，`CLASS_NAME` 已废弃、由 BASIC+第二次调用代替）。 */
export const COMPLETION_MODES: readonly CompletionMode[] = ['basic', 'smart', 'className']

/** 键盘事件里这一层用到的字段（物理键判定口径与 `completionUi.ts` 的 `isBasicCompletionKey` 一致）。 */
export interface CompletionKeyEvent {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
  keyCode?: number
}

/**
 * Ctrl+Space / Ctrl+Shift+Space / Ctrl+Alt+Space 三条（分别对应
 * `$default.xml:732-734`、`:909-911`、`:843-845`）。按物理 `Space` 判，避开输入法与
 * 布局差异；`keyCode 229`/`key 'Process'` 是合成中的码点，不能算补全键。
 */
export function completionModeForEvent(event: CompletionKeyEvent): CompletionMode | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.key === 'Process') return null
  if (!event.ctrlKey || event.metaKey) return null
  if (event.code !== 'Space' && event.key !== ' ') return null
  if (event.shiftKey && !event.altKey) return 'smart'
  if (event.altKey && !event.shiftKey) return 'className'
  if (!event.altKey && !event.shiftKey) return 'basic'
  return null
}

/**
 * 模式状态按编辑器存放 —— 上游那个状态在 `CompletionServiceImpl` 的 `CompletionPhase` 上
 * （`CodeCompletionHandlerBase.java:210-213` 从 phase 读"这是第几次调用"），
 * 本仓没有那个全局 phase 对象，用 WeakMap 挂在 `EditorView` 上，弹层关掉即失效。
 */
export interface CompletionInvocation { mode: CompletionMode; invocationCount: number }
const invocations = new WeakMap<EditorView, CompletionInvocation>()

/** 开始一次调用：同一个模式再按一次才递增计数（上游 `newCompletionStarted` 的 repeated 语义）。 */
export function beginCompletion(view: EditorView, mode: CompletionMode): CompletionInvocation {
  const previous = invocations.get(view)
  const next = previous && previous.mode === mode
    ? { mode, invocationCount: previous.invocationCount + 1 }
    : { mode, invocationCount: 1 }
  invocations.set(view, next)
  return next
}

export function currentCompletion(view: EditorView): CompletionInvocation {
  return invocations.get(view) ?? { mode: 'basic', invocationCount: 1 }
}

export function endCompletion(view: EditorView): void {
  invocations.delete(view)
}

// ---------------------------------------------------------------- 条目该不该留在表里

/**
 * 「类型类条目」= LSP `CompletionItemKind` 里的 Class(7)/Interface(8)/Enum(13)/Struct(22)/
 * TypeParameter(25) 五个名字（`native/lsp_support.cpp:61-71` 的 `completion_kind` 给的就是这些串），
 * 外加 Constructor(4) —— 上游类名补全在 `new Foo()` 位置给的就是构造条目
 * （`java/java-impl/src/com/intellij/codeInsight/completion/JavaConstructorCallElement.java`）。
 */
export const TYPE_ITEM_KINDS: ReadonlySet<string> = new Set([
  'class', 'interface', 'enum', 'struct', 'type-parameter', 'constructor',
])

/** 符号种类的门与 `LspGoToClassContributor.kt:6-8` 同一套（Class/Interface/Enum/Struct）。 */
export const CLASS_LIKE_SYMBOLKIND = CLASS_LIKE_SYMBOL_KINDS

/**
 * LSP `SymbolKind` → 本仓条目用的 kind 名（与 `native/lsp_support.cpp:61-71` 的
 * `completion_kind` 那一套名字对齐，弹层的图标/右侧灰字才走同一条渲染路径）。
 */
export function symbolKindToItemKind(kind: number): string {
  switch (kind) {
    case 5: return 'class'
    case 10: return 'enum'
    case 11: return 'interface'
    case 23: return 'struct'
    default: return 'text'
  }
}

/** 词的形状像类名：首字母大写、其余按驼峰分段（本仓文档词补全在没有语言服务时用它当类名档的判据）。 */
export function looksLikeTypeName(word: string): boolean {
  return /^[A-Z][\p{L}\p{N}_$]*$/u.test(word)
}

/** 光标前的文本里能不能确定"这里在等一个类型"（智能档的唯一可用推断，见文件头）。 */
const TYPE_POSITION = /(?:\bnew\s+[\p{L}\p{N}_$]*|\b(?:extends|implements|super)\s+[\p{L}\p{N}_$]*|[:<>]\s*[\p{L}\p{N}_$]*|@\s*[\p{L}\p{N}_$]*)$/u

export function expectsTypeNameAt(text: string, offset: number): boolean {
  return TYPE_POSITION.test(text.slice(0, offset))
}

export interface ModeFilterable { kind?: string; label: string }

/**
 * 这一次调用留下哪些条目。上游的三档：
 *   · BASIC —— 全部贡献者；
 *   · CLASS_NAME（= BASIC 的第二次调用）—— 只剩类名，并把工程里的类也捞进来
 *     （`JavaClassNameCompletionContributor.java:69-77`）；
 *   · SMART —— 只剩与期望类型相符的；本仓按"期望种类"收窄，推不出来就不过滤（文件头那条卡点）。
 * 第二次调用（`invocationCount >= 2`）一律放宽回全部：上游那一步是"再按一次把搜索范围放大"
 * （`JavaCompletionContributor.java:1090-1094`、`JavaBundle.properties:113` 的提示文案），
 * 本仓没有 PSI 可以继续放大，于是放宽到不过滤。
 */
export function keepsInMode(mode: CompletionMode, item: ModeFilterable, invocationCount = 1): boolean {
  if (mode === 'basic' || invocationCount >= 2) return true
  const kind = (item.kind ?? '').toLowerCase()
  if (mode === 'className') return TYPE_ITEM_KINDS.has(kind) || looksLikeTypeName(item.label)
  return true
}

/** 智能档的类型位置收窄（与 `keepsInMode` 分开：它只在位置能确定时生效，两种模式都用）。 */
export function keepsByExpectedKind(mode: CompletionMode, item: ModeFilterable, typePosition: boolean): boolean {
  if (mode !== 'smart' || !typePosition) return true
  return TYPE_ITEM_KINDS.has((item.kind ?? '').toLowerCase())
}

// ---------------------------------------------------------------- 空表那一行

/**
 * 上游的占位行：`LookupImpl.java:702-703` 往表里塞一个 `EmptyLookupItem`，
 * 文案是 `LangBundle.properties:1` 的 `completion.no.suggestions`（**正在算的时候是一个空白行**）。
 * `EmptyLookupItem.java:9-22` 的类注释写死了三条：不是建议、永不插进文档、不参与前缀匹配。
 */
export const NO_SUGGESTIONS_TEXT = '无建议'
export const CALCULATING_TEXT = ' '

export function lookupPlaceholderText(calculating: boolean): string {
  return calculating ? CALCULATING_TEXT : NO_SUGGESTIONS_TEXT
}

/** 占位行的 `Completion.label`：上游 `EmptyLookupItem.getLookupString()` 返回一串空格（`:35-37`）。 */
export const EMPTY_LOOKUP_STRING = '             '
