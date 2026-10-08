// 问题面板行菜单里那一份意图列表的**宿主侧模型**（纯函数 + 纯类型，零 Vue、零 DOM）。
//
// 它只回答一个问题：本仓行菜单手里的两种对象（语言服务给的 codeAction、本仓折出来的抑制条目）
// 怎么喂给 `src/intentionList.ts` 的那三条规则（档位顺序 / 分隔线 / 不可选）。
// 规则本体不住这里，住 `src/intentionList.ts`（逐条对着上游开的坐标写在那份文件的头上）。
//
// 上游为什么"两种对象进同一个弹层"：问题视图的 QuickFixes 那颗按钮（
// `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103` 的
// `ProblemsView.QuickFixes`）走 `ShowProblemsViewQuickFixesAction.kt:78-92` 的
// `IntentionListStep(…, IntentionSource.PROBLEMS_VIEW)`，而枚举里那一格的注释原文就是
// 「Quick fixes button in the Problems tool window」（`platform/lang-impl/src/com/intellij/
// codeInsight/intention/IntentionSource.java:37-40`）；抑制本身也是一个意图
// （`platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19`
// `implements Iconable, IntentionAction`）⇒ 修复与抑制在上游就是同一张列表里的两种行。
import type { LspCodeAction } from './bridge.ts'
import type { IntentionPreview } from './intentionPreview.ts'
import type { SuppressOption } from './suppressIntention.ts'
import type { FixInput, IntentionRowGroup, SuppressionInput } from './intentionList.ts'

/** 一条快速修复 + 它的意图预览（预览由面板取完 codeAction 后算好，这里不请求、不写盘）。 */
export interface MenuIntentionFix {
  action: LspCodeAction
  preview: IntentionPreview | null
}

/**
 * 一条抑制条目 + 将插入的那一行。`preview` 在插入点算不出来时是 `UNSUPPRESSIBLE_PREVIEW`；
 * `unavailable` 是喂给规则的字段：可选时传空串，不可选时传理由文本（见 `intentionList.ts` 的
 * `SuppressionInput.unavailable`）。
 */
export interface MenuIntentionOption {
  option: SuppressOption
  preview: string
  unavailable: string
}

/** 插入点算不出来时给用户的理由（面板原本就印这一串，搬到这里只留一份）。 */
export const UNSUPPRESSIBLE_PREVIEW = '（行号越界，不能插入）'

/**
 * 「这条修复当场点得动吗」= `FixInput.hasEdits` 在本仓的口径：
 * 自带编辑载荷、或服务端把它标成可直接执行（`command`）、或给了 `codeAction/resolve` 的入口
 * （`native/lsp_support.hpp:173` 的 `resolvable = !has_edit && (command || data)`）。
 *
 * 三条都不满足时这一行**什么都改不了**：面板的 `applyMenuFix` 会把空的编辑列表跑一遍、
 * 然后照样播报「已应用：〈标题〉」—— 一句假的成交。上游那种条目根本进不了列表
 * （`IntentionActionWithTextCaching.java:156-162` 默认 `isSelectable()` 为真，而列出来的是真动作），
 * 本仓拿不到"服务端只列不给"以外的信息，所以按上游 `IntentionListStep.java:102-104` 的形状
 * 把它列出来、但**不能被选中**。
 */
export function menuIntentionFixInput(fix: MenuIntentionFix): FixInput {
  return {
    title: fix.action.title,
    hasEdits: (fix.action.edits?.length ?? 0) > 0 || fix.action.command === true || fix.action.resolvable === true,
  }
}

/** 抑制条目 → 规则输入：`id` 用面板那份稳定键（同一行菜单里每条抑制的 `option.id` 唯一）。 */
export function menuIntentionOptionInput(entry: MenuIntentionOption): SuppressionInput {
  return { id: entry.option.id, unavailable: entry.unavailable }
}

/**
 * 两档的段标题（本仓行菜单原本就印这两行字，搬到这里只留一份；
 * 上游那一份没有标题、只有分隔线，见 `intentionList.ts` 头上 `getSeparatorAbove()` 那条）。
 */
export const INTENTION_MENU_GROUP_TITLES: Record<IntentionRowGroup, string> = {
  fix: '快速修复（应用前预览）',
  intention: '抑制此检查（写入文件）',
}
