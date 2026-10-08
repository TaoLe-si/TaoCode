// Alt+Enter 那张弹层的**宿主侧数据形状**（纯函数 + 纯类型，零 Vue、零 DOM）。
//
// 它只回答两件事：
//   ① Alt+Enter 手里只有一种对象（`LspCodeAction[]`，服务端修复 + 本仓 JUnit 修复 + 本仓抑制条目
//      三者在 `src/semanticActions.ts:477-480` 已经并成一条按档位排好的列表），
//      这一种对象怎么喂进 `src/intentionList.ts` 的那三条规则（顺序 / 分隔线 / 不可选）；
//   ② 弹层的键盘落点：初始选中哪一行、↑↓ 怎么在**可选行**之间移动。
//
// 为什么不住 `src/intentionMenuModel.ts`：那一份服务的是**问题面板行菜单**，它同时接两种载荷
// （`MenuIntentionFix` 带预览、`MenuIntentionOption` 带将插入的那一行），而 Alt+Enter 这一路
// 两种都没有 —— 弹层只在请求回来之后打开（`src/semanticActions.ts:486-488`：0 条提示、1 条直接应用），
// 预览没算过、抑制条目也已经是一条能落盘的 `LspCodeAction`。把两种形状塞进同一个模型，
// 得到的就是一个"字段一半永远为 null"的联合类型。规则本体仍然只有一份，在 `src/intentionList.ts`。
//
// 上游坐标（本轮逐字开过；派单点名的 `HighSeverityQuickFix` / `ActionIntentionAction` /
// `IntentionActionList` 一族在这份基准树里 **0 命中**，登记见 docs/batch-2026-10-06-codeactionpopup.md §2）：
//   · `platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupImpl.java:267-274`
//     `selectFirstSelectableItem()`（`:330` 在建列表时调用）—— 打开弹层时选中的是**第一条 selectable**，
//     不是第 0 行；配合 `IntentionListStep.java:101-104` 的 `isSelectable()` 才有意义。
//     全表都不可选时那个循环什么都不设 ⇒ 下面 `firstSelectableRow` 返回 `-1`（不画选中底）。
//   · 同文件 `:337-341` `registerAction("handleSelection1", KeyEvent.VK_ENTER, 0, …)` → `handleSelect(true, …)`
//     ⇒ Enter 是"最终选择"，落点还是宿主既有的那一条应用链。
//   · 同文件 `:333` `ScrollingUtil.installActions(myList)` → `platform/platform-api/src/com/intellij/ui/ScrollingUtil.java:348-349`
//     `VK_UP` = SELECT_PREVIOUS_ROW、`VK_DOWN` = SELECT_NEXT_ROW ⇒ ↑↓ 就是这里两档。
//   · `ListPopupImpl.java:343-352`（Right = 子菜单 / 扩展按钮）与 `:357-372`（Left = `goBack()`）
//     本仓**不做**：子菜单要"动作带子动作"的输入（上游 `IntentionActionWithOptions`），
//     而 `LspCodeAction`（`src/bridge.ts:152`）没有子动作字段 ⇒ 画出来就是假控件。
import type { LspCodeAction } from './bridge.ts'
import { intentionMenuItems, type IntentionMenuItem } from './intentionList.ts'
import { menuIntentionFixInput } from './intentionMenuModel.ts'

/**
 * 本仓抑制条目的 `kind`。**这是本仓自定的串，不是 LSP / 上游的**：全仓唯一的生产者是
 * `src/localIntentions.ts:113`，服务端给的 kind 是 `quickfix` / `source.*` / `refactor.*`。
 * 弹层拿它当"这一行属于意图半区"的**唯一真判定源**（不靠标题正则猜）。
 */
export const SUPPRESS_ACTION_KIND = 'quickfix.suppress'

/**
 * 弹层里的一行：`intentionList.ts` 判出来的档位（key / group / selectable / reason）
 * 加上这一行要应用的那条动作本身作载荷。
 *
 * 为什么载荷不用 `{ kind: 'fix' | 'option', … }` 那种联合体（行菜单组件用的是那种）：
 * Alt+Enter 这一路两半的载荷是**同一个类型** `LspCodeAction`（抑制条目在
 * `src/localIntentions.ts:106-121` 就被折成了带 edits 的 codeAction），
 * 所以"点击抛给谁"只看 `group` 就够了，不需要再造一个判别式。
 */
export type CodeActionPopupRow = IntentionMenuItem<LspCodeAction>

/** 这一行是不是「意图」半区（抑制）。判定源只有 `SUPPRESS_ACTION_KIND` 一个。 */
export function isSuppressionAction(action: LspCodeAction): boolean {
  return action.kind === SUPPRESS_ACTION_KIND
}

/**
 * 把 Alt+Enter 的那条列表折成弹层行表。
 *
 * 两半的**先后与空档不占位**由 `intentionMenuItems` → `INTENTION_GROUP_ORDER` 决定，
 * 这里不自己排（否则会与行菜单那一路在改档位表时悄悄分叉）。
 *
 * 两半的**可选性**来源不同，两处都是真判定源：
 *   · 修复半区：`menuIntentionFixInput`（`src/intentionMenuModel.ts:51-56`）——
 *     自带 edits / 服务端标了 command / 给了 resolve 入口，三者皆无则这一行什么都改不了，
 *     按上游 `IntentionListStep.java:101-104` 的形状"列出来但不能选中"；
 *     `preview` 传 `null` 是**事实**：Alt+Enter 这一路没有算过预览（预览是行菜单那一路的宿主算的），
 *     而 `menuIntentionFixInput` 本身不读这个字段。
 *   · 意图半区：`unavailable` 恒为空串 = 可选。这**不是**偷懒的默认值：
 *     `src/localIntentions.ts:105-106` 在算不出插入点时 `if (!edit) continue` —— 越界的抑制条目
 *     根本进不到 Alt+Enter 的列表里。⇒ 这一档的置灰在弹层这条路上**没有输入**，
 *     只有行菜单那一路有（`IntentionListMenu.vue`）。已在 `tests/intention-list.test.mjs` 按这个事实钉住。
 *
 * `id` 用「标题 + 序号」：`intentionMenuItems` 会拼成 `intention:〈id〉` 当 v-for 的键，
 * 而 `src/localIntentions.ts:99-101` 的按插入文本去重并不保证**标题**唯一
 * （同一行多源诊断可以给出两条同名不同位置的条目）⇒ 光用标题会撞键。
 */
export function codeActionPopupRows(actions: readonly LspCodeAction[]): CodeActionPopupRow[] {
  return intentionMenuItems<LspCodeAction>(
    actions.filter(action => !isSuppressionAction(action))
      .map(action => ({ ...menuIntentionFixInput({ action, preview: null }), payload: action })),
    actions.filter(isSuppressionAction)
      .map((action, index) => ({ id: `${action.title}:${index}`, unavailable: '', payload: action })),
  )
}

/**
 * 打开弹层时的初始选中：第一条**可选**的行；全表都不可选时返回 `-1`（不画选中底）。
 * 上游 `ListPopupImpl.java:267-274` 的 `selectFirstSelectableItem()` 就是这个循环。
 */
export function firstSelectableRow(rows: readonly { selectable: boolean }[]): number {
  return rows.findIndex(row => row.selectable)
}

/**
 * ↑↓ 移动：只在可选行之间走，**到端点不越界、不循环**。
 *
 * 为什么不循环：上游的循环是**设置项**（`ScrollingUtil.java:261-262` 把
 * `UISettings.getInstance().getCycleScrolling()` 传给 `installActions`），本仓没有这一项设置，
 * 于是取"关掉那一档"的行为 —— 自造一个循环就是自加没有判定源的规则。
 * 本仓同形状的既有实现是 `src/selectIn.ts:79-88` 的 `moveSelectIn`（同样返回 `from`）。
 */
export function moveRowSelection(rows: readonly { selectable: boolean }[], from: number, delta: number): number {
  if (!rows.length) return -1
  let cursor = from
  for (let step = 0; step < rows.length; step++) {
    cursor += delta
    if (cursor < 0 || cursor >= rows.length) return from
    if (rows[cursor]?.selectable) return cursor
  }
  return from
}
