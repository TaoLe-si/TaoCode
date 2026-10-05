// 分步列表弹层的模型 —— `src/popupSteps.ts`。
// 上游：`platform/ide-core/src/com/intellij/openapi/ui/popup/ListPopupStep.java` +
// `ListSeparator.java` + `platform/core-ui/src/openapi/ui/popup/PopupStep.java` +
// `platform/platform-impl/src/com/intellij/ui/popup/WizardPopup.java` +
// `platform/ide-core/src/com/intellij/openapi/ui/popup/PopupShowOptions.kt` +
// `platform/util/ui/src/com/intellij/ui/awt/AnchoredPoint.kt`。
//
// 这个模块在本仓**没有消费方**（现有弹层各自写自己的列表与定位），所以这个文件是它唯一的
// 判据。钉的是几条最容易写错的定义性行为：
//   · 有子步骤的行按下去**不关弹层**（`ListPopupStep.java:38` `isClosableOnExecute`，
//     `:40-42` `isFinal`，同一个判据的两个名字）——这条是分步弹层的定义；
//   · 速度搜索：`canBeHidden` 为假 ⇒ **永远显示**，不参与过滤（`WizardPopup.java:566`），
//     参与过滤的只有 `getIndexedString`（`:568`）而不是显示文本；
//   · 分隔行**跟着它那一项一起被过滤**（不是过滤完再补）；
//   · `ide.popup.auto.delay` 默认 **500ms**，且计时器只对**有子步骤**的行有意义；
//   · `PopupShowOptions` 四个工厂的角点对 + 缝：`above*` 是 4、`below*` 是 **0**（不对称）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aboveComponent,
  aboveComponentRightAligned,
  atScreenLocation,
  anchorPointOn,
  AUTO_SELECTION_DELAY_MS,
  autoSelectionFired,
  belowComponent,
  belowComponentRightAligned,
  chosenOutcome,
  DEFAULT_SHOW_OPTIONS,
  hasScreenPoint,
  initialRowIndex,
  isClosableOnExecute,
  isFinalStepValue,
  listSeparator,
  listStepRows,
  nextSelectableRow,
  popupComponentGapOf,
  shouldBeShowing,
  showOptionsPoint,
} from '../src/popupSteps.ts'

/** 一步：三个值，第二个有子步骤、第三个不可选。 */
const step = {
  values: () => ['alpha', 'beta', 'gamma'],
  text: value => value,
  isSelectable: value => value !== 'gamma',
  hasSubstep: value => value === 'beta',
  separatorAbove: value => (value === 'gamma' ? listSeparator('分组') : null),
  defaultOptionIndex: () => 0,
}

test('ListSeparator 只有文字 + 图标；无参构造给空串（ListSeparator.java:27-29）', () => {
  assert.deepEqual(listSeparator(), { text: '' })
  assert.deepEqual(listSeparator('近期'), { text: '近期' })
  assert.deepEqual(listSeparator('近期', 'Star'), { text: '近期', icon: 'Star' })
})

test('有子步骤的行按下去不关弹层 —— isClosableOnExecute 与 isFinal 是同一个判据', () => {
  // ListPopupStep.java:38 `default boolean isClosableOnExecute(T value) { return !hasSubstep(value); }`
  // :40-42 `isFinal` 同一句。
  assert.equal(isClosableOnExecute(step, 'beta'), false)
  assert.equal(isFinalStepValue(step, 'beta'), false)
  assert.equal(isClosableOnExecute(step, 'alpha'), true)
  assert.equal(isFinalStepValue(step, 'alpha'), true)
  // 不给 hasSubstep 就没有子步骤。
  const plain = { values: () => ['a'], text: v => v }
  assert.equal(isClosableOnExecute(plain, 'a'), true)
})

test('shouldBeShowing：空查询全显示；canBeHidden 为假 ⇒ 永远显示；只按索引串过滤', () => {
  // WizardPopup.java:563-569 那一串判据。
  assert.equal(shouldBeShowing(step, 'gamma', ''), true, '没字 ⇒ 全显示')
  assert.equal(shouldBeShowing(step, 'gamma', '   '), true, '空白串等同没字')
  assert.equal(shouldBeShowing(step, 'alpha', 'alp'), true)
  assert.equal(shouldBeShowing(step, 'alpha', 'zzz'), false)

  // :566 `if (!filter.canBeHidden(value)) return true` —— 不可隐藏的项不参与过滤。
  const pinned = { ...step, canBeHidden: value => value !== 'beta' }
  assert.equal(shouldBeShowing(pinned, 'beta', '完全对不上'), true)

  // :568 `filter.getIndexedString(value)` —— 只有索引串参与过滤，
  // 行尾那些附属内容（显示文本里带的那截）不进搜索。
  const indexed = { ...step, text: v => `${v}（附注）`, indexedString: v => v }
  assert.equal(shouldBeShowing(indexed, 'alpha', '附'), false, '显示文本不该进搜索')
  assert.equal(shouldBeShowing(indexed, 'alpha', 'alp'), true)
})

test('listStepRows：分隔行插在它所属的项**上面**，并跟着那一项一起被过滤', () => {
  const rows = listStepRows(step)
  assert.deepEqual(rows.map(row => row.kind), ['item', 'item', 'separator', 'item'])
  assert.equal(rows[2].text, '分组')
  assert.equal(rows[3].value, 'gamma')
  assert.equal(rows[3].selectable, false, 'isSelectable 说不可选就是不可选')
  assert.equal(rows[1].hasSubstep, true)
  assert.equal(rows[1].closesOnExecute, false, '有子步骤 ⇒ 按下不关')
  assert.equal(rows[1].isFinal, false)
  assert.equal(rows[0].closesOnExecute, true)
  // 行 id：不给 idOf 时是 `下标:文本`。
  assert.equal(rows[0].id, '0:alpha')

  // 过滤掉 gamma ⇒ 它上面那条分隔行也跟着没（上游分隔行是行模型的一部分，不是过滤后补的）。
  const onlyGamma = listStepRows(step, { query: 'ga' })
  assert.deepEqual(onlyGamma.map(row => row.kind), ['separator', 'item'], '分隔行跟着它那一项活下来了')
  assert.equal(onlyGamma[1].value, 'gamma')
  const onlyAlpha = listStepRows(step, { query: 'alph' })
  assert.deepEqual(onlyAlpha.map(row => row.kind), ['item'], 'gamma 被过滤掉 ⇒ 它那条分隔行也不能残留')
  assert.equal(onlyAlpha[0].value, 'alpha')

  // idOf 由调用方给稳定键。
  const keyed = listStepRows(step, { idOf: value => `k:${value}` })
  assert.equal(keyed[3].id, 'k:gamma')
})

test('上下键走的是项行：跳过分隔行与不可选项，并且回绕', () => {
  const rows = listStepRows(step)
  assert.equal(nextSelectableRow(rows, 0, 1), 1)
  assert.equal(nextSelectableRow(rows, 1, 1), 0, 'gamma 不可选、分隔行不算 ⇒ 绕回 alpha')
  assert.equal(nextSelectableRow(rows, -1, 1), 0, '还没有当前项时从头起步')
  assert.equal(nextSelectableRow(rows, 0, -1), 1, '往回绕 ⇒ 越过 gamma 落到 beta')
  assert.equal(nextSelectableRow([], 0, 1), -1)
  // 全不可选时返回 -1，而不是死循环。
  const noneSelectable = listStepRows({ values: () => ['a', 'b'], text: v => v, isSelectable: () => false })
  assert.equal(nextSelectableRow(noneSelectable, 0, 1), -1)
})

test('初始选中项：defaultOptionIndex 落在不可选/越界上时退回第一个可选行', () => {
  // ListPopupStep.java:75 只是"初始选中项"，不保证那个下标可选。
  const rows = listStepRows(step)
  assert.equal(initialRowIndex(step, rows), 0)
  assert.equal(initialRowIndex({ ...step, defaultOptionIndex: () => 1 }, rows), 1)
  assert.equal(initialRowIndex({ ...step, defaultOptionIndex: () => 2 }, rows), 0, '2 是不可选项 ⇒ 退回 0')
  assert.equal(initialRowIndex({ ...step, defaultOptionIndex: () => 99 }, rows), 0, '越界 ⇒ 退回 0')
  const allOff = listStepRows({ ...step, isSelectable: () => false })
  assert.equal(initialRowIndex({ ...step, isSelectable: () => false }, allOff), -1, '一个可选的都没有 ⇒ -1')
  const noSeparatorStep = listStepRows({ values: () => ['a'], text: v => v })
  assert.equal(initialRowIndex({ values: () => ['a'], text: v => v }, noSeparatorStep), 0)
})

test('自动选中：默认 500ms，且只对有子步骤的行有意义', () => {
  // WizardPopup.java:84 `TimerUtil.createNamedTimer("Wizard auto-selection",
  //   Registry.intValue("ide.popup.auto.delay", 500), this)`；:537-542 触发。
  assert.equal(AUTO_SELECTION_DELAY_MS, 500)
  const rows = listStepRows(step)
  assert.equal(autoSelectionFired(step, rows, 1, 499), false, '没到 500ms 不触发')
  assert.equal(autoSelectionFired(step, rows, 1, 500), true, 'beta 有子步骤 ⇒ 到点触发')
  assert.equal(autoSelectionFired(step, rows, 0, 500), false, 'alpha 没有子步骤 ⇒ 自动选中等于直接关弹层')
  assert.equal(autoSelectionFired(step, rows, 3, 500), false, 'gamma 不可选')
  assert.equal(autoSelectionFired(step, rows, 1, 900, 1000), false, '自定义档：没到就不触发')
  assert.equal(autoSelectionFired(step, rows, 1, 1000, 1000), true)
})

test('chosenOutcome：onChosen 给了下一层就换内容不关；没给且没有子步骤才关', () => {
  // PopupStep.java:26-31：返回子步骤就显示它；返回 FINAL_CHOICE（:15 那个 null）就关。
  const next = { values: () => ['x'], text: v => v }
  const withNext = { ...step, onChosen: value => (value === 'beta' ? next : null) }
  assert.equal(chosenOutcome(withNext, 'beta').kind, 'substep')
  assert.equal(chosenOutcome(withNext, 'beta').next, next)
  assert.equal(chosenOutcome(withNext, 'alpha').kind, 'final', '没有子步骤、onChosen 也没给 ⇒ 关')

  // 有子步骤但 onChosen 没给内容：留在原层等下一次选择（不关）。
  const stalled = chosenOutcome(step, 'beta')
  assert.equal(stalled.kind, 'substep')
  assert.equal(stalled.value, 'beta')
  assert.equal(chosenOutcome({ ...step, onChosen: () => null }, 'alpha').kind, 'final', '显式 null = FINAL_CHOICE')
})

test('AnchoredPoint.Anchor 九个角点的取点公式（AnchoredPoint.kt:14-52）', () => {
  const r = { x: 100, y: 200, width: 40, height: 20 }
  // 注意 LEFT/RIGHT/TOP/BOTTOM 取的是**中线**，不是贴那条边。
  assert.deepEqual(anchorPointOn(r, 'center'), { x: 120, y: 210 })
  assert.deepEqual(anchorPointOn(r, 'left'), { x: 100, y: 210 })
  assert.deepEqual(anchorPointOn(r, 'right'), { x: 140, y: 210 })
  assert.deepEqual(anchorPointOn(r, 'top'), { x: 120, y: 200 })
  assert.deepEqual(anchorPointOn(r, 'bottom'), { x: 120, y: 220 })
  assert.deepEqual(anchorPointOn(r, 'top-left'), { x: 100, y: 200 })
  assert.deepEqual(anchorPointOn(r, 'bottom-left'), { x: 100, y: 220 })
  assert.deepEqual(anchorPointOn(r, 'top-right'), { x: 140, y: 200 })
  assert.deepEqual(anchorPointOn(r, 'bottom-right'), { x: 140, y: 220 })
})

test('PopupShowOptions 四个工厂：角点对照抄，缝「上面 4 / 下面 0」的不对称也照抄', () => {
  // PopupShowOptions.kt:56-64 / :70-78 / :84-91 / :97-104
  const above = aboveComponent()
  assert.equal(above.ownerAnchor, 'top-left')
  assert.equal(above.relativePosition, 'top')
  assert.equal(above.popupAnchor, 'bottom-left')
  assert.equal(popupComponentGapOf(above), 4, ':63 的 withDefaultPopupComponentUnscaledGap(4)')

  const aboveRight = aboveComponentRightAligned()
  assert.equal(aboveRight.ownerAnchor, 'top-right')
  assert.equal(aboveRight.popupAnchor, 'bottom-right')
  assert.equal(popupComponentGapOf(aboveRight), 4)

  // :84-91 没有 withDefaultPopupComponentUnscaledGap 那一行 ⇒ 缝是 0，不是 4。
  const below = belowComponent()
  assert.equal(below.ownerAnchor, 'bottom-left')
  assert.equal(below.relativePosition, 'bottom')
  assert.equal(below.popupAnchor, 'top-left')
  assert.equal(popupComponentGapOf(below), 0)

  const belowRight = belowComponentRightAligned()
  assert.equal(belowRight.ownerAnchor, 'bottom-right')
  assert.equal(belowRight.popupAnchor, 'top-right')
  assert.equal(popupComponentGapOf(belowRight), 0)

  // :130-131 `screenPoint?.x ?: -1` —— 初值两个都是 -1，两个角与相对位置都空着。
  assert.equal(DEFAULT_SHOW_OPTIONS.screenX, -1)
  assert.equal(DEFAULT_SHOW_OPTIONS.screenY, -1)
  assert.equal(DEFAULT_SHOW_OPTIONS.considerForcedXY, false)
  assert.equal(DEFAULT_SHOW_OPTIONS.ownerAnchor, null)
  assert.equal(popupComponentGapOf(DEFAULT_SHOW_OPTIONS), 0)
})

test('atScreenLocation：只给 owner + 屏幕点 + 强制位，角点与相对位置都不给', () => {
  // :110-115
  const options = atScreenLocation(120, 340, true)
  assert.equal(options.screenX, 120)
  assert.equal(options.screenY, 340)
  assert.equal(options.considerForcedXY, true)
  assert.equal(options.ownerAnchor, null)
  assert.equal(options.popupAnchor, null)
  assert.equal(options.relativePosition, null)
  assert.equal(hasScreenPoint(options), true)
  // (-1,-1) 意为"没有屏幕点"（:146 `withScreenXY` 把这一对解释成清掉）。
  assert.equal(hasScreenPoint(DEFAULT_SHOW_OPTIONS), false)
})

test('showOptionsPoint：有屏幕点就用它，否则从组件角点按相对位置加/减缝推出去', () => {
  const owner = { x: 100, y: 200, width: 40, height: 20 }
  const size = { width: 30, height: 10 }
  // 屏幕点优先（:111-114）。
  assert.deepEqual(showOptionsPoint(atScreenLocation(7, 9, false), owner, size), { x: 7, y: 9 })
  // aboveComponent：owner 角在 top-left (100,200)，缝 4 ⇒ 弹层底边贴在 y=200-4=196 处。
  assert.deepEqual(showOptionsPoint(aboveComponent(), owner, size), { x: 100, y: 186 })
  // belowComponent：owner 角在 bottom-left (100,220)，缝 0 ⇒ 顶边就在 220。
  assert.deepEqual(showOptionsPoint(belowComponent(), owner, size), { x: 100, y: 220 })
  // 什么都没给 ⇒ 原样返回组件角点，调用方自己挑落位。
  assert.deepEqual(showOptionsPoint(DEFAULT_SHOW_OPTIONS, owner, size), { x: 0, y: 0 })
  assert.deepEqual(showOptionsPoint(belowComponent(), null, size), { x: 0, y: 0 })
})
