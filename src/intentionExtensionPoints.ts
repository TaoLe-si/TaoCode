// **lp/intention 域第二条上游 EP 的宿主接线**（Alt-Enter 菜单贡献者
// `com.intellij.intentionMenuContributor`）。意图/快速修复那条（`com.intellij.intentionAction`）
// 已由 `src/daemonExtensionPoints.ts` 声明（见那里的注释），本文件补菜单贡献者那条。
//
// 上游依据（EP_NAME / qualifiedName **逐字**取自上游）：
//   · `com.intellij.intentionMenuContributor` ——
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:229`
//     （`interface="com.intellij.codeInsight.daemon.impl.IntentionMenuContributor"` dynamic="true"）；
//     接口 `platform/lang-impl/src/com/intellij/codeInsight/daemon/impl/IntentionMenuContributor.java:19`
//     （`EP_NAME` 在 `:20`）；方法面
//     `collectActions(Editor hostEditor, PsiFile hostFile, ShowIntentionsPass.IntentionsInfo intentions,
//     int passIdToShowIntentionsFor, int offset)`（`:21`）—— 往 Alt-Enter 菜单里补条目。
//
// 本仓此前：Alt-Enter 的条目由 `src/semanticActions.ts` 的 `openCodeActions` 从语言服务
// `textDocument/codeAction` + 本仓 JUnit 修复 + 抑制条目合成，**没有插件 EP 宿主** ——
// 第三方无法往菜单里补一条自己的动作。本文件补上：EP 声明 + 与上游同名的方法面（`collectActions`）
// + consume 函数 `collectedIntentions(input)`；消费点是 `src/semanticActions.ts` 的 `openCodeActions`
// （把贡献的条目并进 `intention` 半区，与上游把贡献收进 `IntentionsInfo` 同一形状）。
//
// 与上游的如实差异：① 本仓没有 `IntentionsInfo`/`PsiElement`，贡献者直接返回一排可执行条目
// （`ContributedIntentionAction`，编辑载荷与 LSP `codeAction` 的 `edits` 同形）；② `passIdToShowIntentionsFor`
// 收成本仓的 `passId`（0 = 交互式 Alt-Enter，与上游 `ShowIntentionsPass` 的 pass 号同一含义）。
//
// 纯数据层：只 import `src/extensionPoints.ts`，便于 `node --test` 直测。
//
// 判据：`tests/intention-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** EP id（逐字取自上游 `IntentionMenuContributor.EP_NAME`，见文件头）。 */
export const INTENTION_MENU_CONTRIBUTOR_EP = 'com.intellij.intentionMenuContributor'

/** 一条贡献编辑（与 `src/bridge.ts` 的 `LspTextEdit`/`LspFileEdits` 结构一致，不 import 以保纯数据层）。 */
export interface ContributedTextEdit {
  text: string
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}
export interface ContributedFileEdits {
  path: string
  textEdits: ContributedTextEdit[]
}

/** Alt-Enter 菜单贡献的上下文（上游 `collectActions(editor, hostFile, intentions, passId, offset)` 的可移植替代）。 */
export interface IntentionMenuInput {
  path: string
  language: string
  /** 当前文档全文。 */
  text: string
  line: number
  character: number
  /** pass 号（0 = 交互式 Alt-Enter）。 */
  passId: number
}

/** 贡献者往菜单里补的一条动作（本仓形状：能列、能落地）。 */
export interface ContributedIntentionAction {
  id: string
  title: string
  kind?: string
  preferred?: boolean
  /** 直接落地的编辑（空 = 只列不可执行，`src/intentionList.ts` 会把它标成不可选）。 */
  edits: readonly ContributedFileEdits[]
  /** 服务端风格的可执行标记（宿主按它决定要不要走 command 那条）。 */
  command?: boolean
}

/** 一条菜单贡献者（`IntentionMenuContributor.collectActions` 的同名方法面）。 */
export interface IntentionMenuContributorContribution {
  id: string
  /** 语言限定（空/缺省 = 任意语言）。 */
  languages?: readonly string[]
  collectActions: (input: IntentionMenuInput) => readonly ContributedIntentionAction[]
}

/** `IntentionMenuContributor.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function intentionMenuContributors(language: string, scope: string = APPLICATION_SCOPE): IntentionMenuContributorContribution[] {
  return EXTENSIONS.extensionsOf<IntentionMenuContributorContribution>(INTENTION_MENU_CONTRIBUTOR_EP, scope)
    .filter(contributor => !contributor.languages || contributor.languages.length === 0 || contributor.languages.includes(language))
}

/**
 * 收全部贡献者给的条目（上游 `ShowIntentionsPass` 遍历 `EP_NAME.extensionList` 逐条
 * `collectActions`）。坏贡献者跳过，不影响别的。
 */
export function collectedIntentions(input: IntentionMenuInput, scope: string = APPLICATION_SCOPE): ContributedIntentionAction[] {
  const out: ContributedIntentionAction[] = []
  for (const contributor of intentionMenuContributors(input.language, scope)) {
    try {
      out.push(...contributor.collectActions(input))
    } catch {
      // 坏贡献者跳过。
    }
  }
  return out
}

// ── EP 声明 / 注册 / 注销 ─────────────────────────────────────────────────────────────────

/** 声明 EP（幂等）。 */
export function declareIntentionExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: INTENTION_MENU_CONTRIBUTOR_EP, name: '意图菜单贡献者', scope: APPLICATION_SCOPE, dynamic: true })
}

declareIntentionExtensionPoints()

/** 注册一条菜单贡献者（缺省 bundled）。 */
export function registerIntentionMenuContributor(
  contribution: IntentionMenuContributorContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(INTENTION_MENU_CONTRIBUTOR_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注销一条菜单贡献者（返回是否真的删掉了）。 */
export function unregisterIntentionMenuContributor(id: string): boolean {
  return EXTENSIONS.unregisterExtension(INTENTION_MENU_CONTRIBUTOR_EP, id)
}

/** 本仓内建的菜单贡献者 id（passthrough：本仓的 Alt-Enter 条目在 `src/semanticActions.ts` 合成）。 */
export const BUNDLED_INTENTION_MENU_CONTRIBUTOR_ID = 'taocode.intentionMenuContributor.bundled'

/**
 * 本仓内建的菜单贡献者：**如实**是一个 passthrough —— 本仓的 Alt-Enter 条目由
 * `src/semanticActions.ts` 从语言服务 + JUnit 修复 + 抑制条目合成，不在这张注册表里生成。
 * 它存在的意义是让 EP 里有一条 bundled 项、并使 `collectedIntentions` 的合并链成立；
 * 第三方按 id 挂的贡献者在 Alt-Enter 时被真实问到（消费点 `openCodeActions`）。
 */
export function builtinIntentionMenuContributor(): IntentionMenuContributorContribution {
  return { id: BUNDLED_INTENTION_MENU_CONTRIBUTOR_ID, collectActions: () => [] }
}

registerIntentionMenuContributor(builtinIntentionMenuContributor())
