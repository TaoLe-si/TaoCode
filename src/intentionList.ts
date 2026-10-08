// Alt+Enter / 问题面板行菜单里那份**意图列表**的排序、分组与「不可用」档位（纯函数，零 Vue、零 DOM）。
//
// 上游坐标（本轮逐字开过；派单点名的 `IntentionActionAvailabilityTheories` 在这份基准树里
// **不存在** —— `find . -iname "*AvailabilityTheories*"` 与全树 `grep -rln` 都是 0 命中，
// 真实规则在下面这几处，订正留痕见 docs/batch-2026-10-06-completion2b.md）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/CachedIntentions.java:353-368`
//     的 `getAllActions()` —— 列表顺序 = `myErrorFixes` → `myInspectionFixes` → `myIntentions`
//     （`:356-360` 逐条查重：已经作为修复出现过的那条**不再以意图身份重复出**）→ `myGutters`
//     → `myNotifications`；`:363` 再过一遍 dumb 模式可用性；`:366-367` 交给按语言的
//     `IntentionsOrderProvider.getSortedIntentions`。
//   · 同文件 `:371-393` 的 `getGroup()` —— 分组身份：ERROR / REMOTE_ERROR / INSPECTION /
//     NOTIFICATION / GUTTER / EMPTY_ACTION / ADVERTISEMENT / OTHER。
//   · `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/IntentionListStep.java:296-309`
//     的 `getSeparatorAbove()` —— **组变了就一条分隔线**（`:305` `getGroup(value) != getGroup(prev)`），
//     条目自己也可以带一条（`:297-299` 的 `hasSeparatorAbove()`）。
//   · 「不可用」那一档在同文件 `:102-104` 的 `isSelectable()` → `IntentionActionWithTextCaching.java:156-162`
//     （只有实现 `CustomizableIntentionAction` 的条目能说自己不可选，默认**可选**）。
//     ⇒ 上游的形状是「**照样列出来，但这一条不能被选中**」，不是"从列表里删掉"，
//     也不是"点下去再报错"。
//   · 订正：派单里说的「_show more」那一行在 `IntentionListStep.java` 里**没有对应物**
//     （本轮通读 343 行：只有分隔线 `:296-309`、子菜单 `:115-120 / :170-202 / :250-254`、
//     速搜 `:318 / :327-328`、默认选中第 0 条 `:293`）。全树 `grep -rn "show_more"` 在
//     lang-impl 的意图面里也是 0 命中（`show.more` 这个键在 `platform/lang-api/resources/messages/
//     LangBundle.properties:601`，属另一个面）。⇒ 本仓**不做**「更多」那一行，也不假装有。
//
// 本仓能对上的是这些行**确实有生产者**的那几档：
//   · 「修复」半区 = 语言服务的 `textDocument/codeAction`（`src/semanticActions.ts` 的 `openCodeActions`
//     与 `src/components/ProblemsPanel.vue` 的行菜单）；
//   · 「意图」半区 = 本仓自己折出来的抑制条目（`src/localIntentions.ts` 的 `suppressionActionsFor`）。
// GUTTER / NOTIFICATION 两档在本仓**没有生产者**（没有 PSI 的 gutter 意图，也没有
// 广告/通知条目），所以不进下面的档位表 —— 列两个恒空的档就是假档位。

/** 一行意图属于哪一组（上游 `IntentionGroup` 里本仓有对应物的那两档）。 */
export type IntentionRowGroup = 'fix' | 'intention'

/**
 * 上游 `getAllActions()` 的组先后：先所有**修复**，后**意图**
 * （`CachedIntentions.java:354-360`；`myGutters` / `myNotifications` 两档本仓没有生产者）。
 */
export const INTENTION_GROUP_ORDER: readonly IntentionRowGroup[] = ['fix', 'intention']

/** 一组（面板行菜单里就是那一段带标题的行）。 */
export interface IntentionSection<T> {
  group: IntentionRowGroup
  rows: T[]
}

/**
 * 按上游的组先后重排，**丢掉空组**（上游没有"空组节点"这一格：`getAllActions()` 是把
 * 五个列表串起来，某个列表空了自然就没有那一段）。同组内部的先后保持传入顺序 ——
 * 与上游 `:354-360` 的 `addAll` 一致，排序交给各段自己的来源。
 */
export function orderIntentionSections<T>(sections: readonly IntentionSection<T>[]): IntentionSection<T>[] {
  return INTENTION_GROUP_ORDER
    .map(group => sections.find(section => section.group === group))
    .filter((section): section is IntentionSection<T> => Boolean(section) && (section as IntentionSection<T>).rows.length > 0)
}

/** 一条意图行。`selectable` 见 `intentionRowsFor`。 */
export interface IntentionRow {
  /** 稳定键（面板拿它做 v-for 的 key）。 */
  key: string
  group: IntentionRowGroup
  /** 这一条能不能被选中并应用（上游 `IntentionListStep.java:102-104` 的那一档）。 */
  selectable: boolean
  /** `selectable === false` 时给用户的理由；可选时是空串。 */
  reason: string
}

/** 行上带不带分隔线（上游 `IntentionListStep.java:296-309`：组变了就一条）。 */
export function separatorAbove<T extends IntentionRow>(rows: readonly T[], index: number): boolean {
  if (index <= 0) return false
  return rows[index - 1]!.group !== rows[index]!.group
}

/** 语言服务给的一条修复（只取本模块要用的字段）。 */
export interface FixInput {
  title: string
  /** 服务端给的 `kind`（`quickfix` / `source.*` / `refactor.*`）。 */
  kind?: string
  /** 带 `isPreferred` 或诊断回链 —— 本仓已有的「这条真的在修一个问题」口径。 */
  preferred?: boolean
  linked?: boolean
  /** 已经有编辑载荷（没有就得先 resolve；本仓把它列出来但标不可直接应用）。 */
  hasEdits?: boolean
}

/** 抑制条目的输入：`preview` 为空串表示这一行的插入点算不出来（越界）。 */
export interface SuppressionInput {
  id: string
  /** 算不出编辑载荷时的理由文本；可选时传空串。 */
  unavailable: string
}

/** 一条带宿主载荷的意图行（四个字段与 `IntentionRow` 完全同源，多出来的只有 `payload`）。 */
export interface IntentionMenuItem<T> extends IntentionRow {
  /** 宿主点击这一行时要用的对象（面板放的是那条 codeAction / 那条抑制条目）。 */
  payload: T
}

/**
 * `intentionRowsFor` 的**带载荷**版本：宿主把「行输入 + 自己的载荷」成对传进来，拿回来的每一行
 * 既带上游那三条规则判出来的档位（顺序 / 分组 / 可选性），也带着宿主自己的对象。
 *
 * 为什么要有这一条而不是让宿主按 `key` 回查：`fix:` / `intention:` 那个键格式是本模块的**内部细节**，
 * 宿主自己拼一次就把内部格式当 API 用了，两边一改就悄悄错开（面板的 v-for key 与行的载荷对不上时
 * 画出来的是"标题对不上动作"的菜单）。顺序与可选性在这里只有**一份**实现。
 *
 * **订正留痕（本轮接线时复核，原样写在这里给下一个代理看）**：这一族函数原来还带一段"按 `key`
 * 去掉意图半区里与修复重名的行"，对应上游 `CachedIntentions.java:356-360` 的
 * `if (!myErrorFixes.contains(intention) && !myInspectionFixes.contains(intention))`。
 * 上游比的是**同一个 `IntentionActionWithTextCaching` 对象**在两个列表里都出现；本仓两半的键是
 * `fix:〈标题〉:〈序号〉` 与 `intention:〈id〉` 两个不相交的命名空间，`taken.has(key)` 恒假
 * ⇒ 那一段**永不触发**（本轮拿 `id = 'fix:A:0'` 这种最接近的输入实测，两条行照样都在）。
 * 按"死代码直接删"处理掉了。要在本仓复刻那条去重，得有"同一个动作跨半区"的身份可用 ——
 * 而 `SuppressionInput` 只有 `id`/`unavailable`，没有标题，也没有服务端动作的对象引用，
 * 拿标题近似去重又会把"两个不同动作恰好同名"误删，所以这里**不做**近似去重。
 */
export function intentionMenuItems<T>(
  fixes: readonly (FixInput & { payload: T })[],
  suppressions: readonly (SuppressionInput & { payload: T })[],
): IntentionMenuItem<T>[] {
  const fixRows: IntentionMenuItem<T>[] = fixes.map((fix, index) => ({
    key: `fix:${fix.title}:${index}`,
    group: 'fix' as IntentionRowGroup,
    selectable: fix.hasEdits === true,
    reason: fix.hasEdits === true ? '' : '需先向语言服务解析这条修复，才能预览并应用。',
    payload: fix.payload,
  }))
  const intentionRows: IntentionMenuItem<T>[] = suppressions.map(suppression => ({
    key: `intention:${suppression.id}`,
    group: 'intention',
    selectable: suppression.unavailable === '',
    reason: suppression.unavailable,
    payload: suppression.payload,
  }))
  // 档位先后只有 `INTENTION_GROUP_ORDER` 这一份（经 `orderIntentionSections`）—— 这里不自己排，
  // 否则 Alt+Enter 与行菜单两条路会在改档位表时悄悄分叉。
  return orderIntentionSections<IntentionMenuItem<T>>([
    { group: 'fix', rows: fixRows },
    { group: 'intention', rows: intentionRows },
  ]).flatMap(section => section.rows)
}

/**
 * 把面板/Alt+Enter 两路输入折成**同一份**行表：修复在前、意图在后，
 * 并且把「算不出插入位置」的那几条标成**不可选**（照样列出来，理由随行）——
 * 对应上游 `IntentionListStep.java:102-104` + `IntentionActionWithTextCaching.java:156-162` 的
 * 「列出来但不能选中」，取代本仓旧形状（那种条目照旧画成可点按钮，点下去只弹一句"未写入"）。
 *
 * 去重：上游 `CachedIntentions.java:356-360` 那条"同一个动作不跨半区重复列"**本仓没有对应物**，
 * 已在接线时按死代码删掉（两个键命名空间不相交、那段永不触发；理由与实测写在 `intentionMenuItems` 头上）。
 */
export function intentionRowsFor(fixes: readonly FixInput[], suppressions: readonly SuppressionInput[]): IntentionRow[] {
  // 规则本体只有 `intentionMenuItems` 那一份；这里把载荷剥掉，给「只要行」的调用方（与单元测试）。
  return intentionMenuItems<FixInput | SuppressionInput>(
    fixes.map(fix => ({ ...fix, payload: fix })),
    suppressions.map(suppression => ({ ...suppression, payload: suppression })),
  ).map(item => ({ key: item.key, group: item.group, selectable: item.selectable, reason: item.reason }))
}
