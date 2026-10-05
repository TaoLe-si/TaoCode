// 「贴着**另一个浮层**摆位」的几何 —— `src/popupPosition.ts` 对
// `platform/lang-impl/src/com/intellij/ui/popup/PopupPositionManager.java` 的照抄。
//
// 这一族在本仓**没有消费方**（`popupAnchor.ts` 的点锚点那一支走的是 `placeMenu`，
// 是另一个算法），所以这个文件是它唯一的判据：把上游那几段判据逐条钉死，
// 钉的是**数字**而不是形状 —— 缝是 5（`:140`）、遍历顺序是 右/左/上/下（`:35`）、
// 「上」这一位量的基线默认取锚点自己的 y（`:175-177`，`PositionAdjuster2` 改成栈顶那个
// 弹层的 y，`:130-133`）、都不放得下时取**面积最大**的那块空地把弹层裁小塞进去
// （`:261-269`），以及 `crop` **允许算出负宽高**这一条（`:285-291`）。
//
// 最后一条最容易被当成 bug 修掉：负宽不是错，它就是「这块地一块都放不下」的度量，
// 排序时自然垫底。判据里单独钉一条钉住它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adjustBounds,
  childStepAnchor,
  crop,
  DEFAULT_GAP,
  DEFAULT_POSITION_ORDER,
  overlaps,
  paddedParentBounds,
  positionAbove,
  positionLeft,
  positionRight,
  positionUnder,
  STEP_X_PADDING,
} from '../src/popupPosition.ts'

test('四个候选位与默认缝：DEFAULT_GAP = 5、遍历顺序 右/左/上/下', () => {
  // `PopupPositionManager.java:140` 的 `DEFAULT_GAP = 5`；`:35` 的
  // `DEFAULT_POSITION_ORDER = {RIGHT, LEFT, TOP, BOTTOM}`。
  assert.equal(DEFAULT_GAP, 5)
  assert.deepEqual([...DEFAULT_POSITION_ORDER], ['right', 'left', 'top', 'bottom'])

  const relative = { x: 100, y: 100, width: 50, height: 20 }
  const size = { width: 30, height: 40 }
  // `:158-161` / `:163-165` / `:167-169` / `:171-173`
  assert.deepEqual(positionRight(relative, size), { x: 155, y: 100, width: 30, height: 40 })
  assert.deepEqual(positionLeft(relative, size), { x: 65, y: 100, width: 30, height: 40 })
  assert.deepEqual(positionAbove(relative, size), { x: 100, y: 55, width: 30, height: 40 })
  assert.deepEqual(positionUnder(relative, size), { x: 100, y: 125, width: 30, height: 40 })
  // 缝可覆盖（`PositionAdjuster(relativeTo, gap)` 那个构造，`:147-152`）。
  assert.equal(positionRight(relative, size, 0).x, 150)
})

test('「上」这一位量的基线：默认取锚点自己的 y，PositionAdjuster2 换栈顶那个弹层的 y', () => {
  // `:175-177` `getYForTopPositioning() { return myRelativeOnScreen.y; }`
  assert.equal(positionAbove({ x: 0, y: 150, width: 10, height: 10 }, { width: 20, height: 60 }).y, 85)
  // `:130-133` `PositionAdjuster2` 返回 `myTopComponent.getLocationOnScreen().y`。
  assert.equal(positionAbove({ x: 0, y: 150, width: 10, height: 10 }, { width: 20, height: 60 }, 5, 90).y, 25)

  // 同一个输入在 adjustBounds 里也走这一支：不传 topBaselineY → 85；传 90 → 25。
  const input = {
    relative: { x: 400, y: 150, width: 50, height: 20 },
    screen: { x: 0, y: 0, width: 1000, height: 200 },
    size: { width: 100, height: 60 },
    order: ['top'],
  }
  assert.equal(adjustBounds(input).y, 85)
  assert.equal(adjustBounds({ ...input, topBaselineY: 90 }).y, 25)
})

test('adjustBounds：第一个整块放得下的候选位就赢（不放得下的先翻过去）', () => {
  const screen = { x: 0, y: 0, width: 1000, height: 800 }
  // 右边放得下 ⇒ 用右边（遍历顺序第一位，`:35` + `:250`）。
  assert.deepEqual(adjustBounds({
    relative: { x: 100, y: 100, width: 50, height: 20 },
    screen,
    size: { width: 100, height: 60 },
  }), { x: 155, y: 100, width: 100, height: 60 })

  // 右边放不下（155+100=1055 > 1000）⇒ 翻到左边第二位。
  assert.deepEqual(adjustBounds({
    relative: { x: 900, y: 400, width: 50, height: 20 },
    screen,
    size: { width: 100, height: 60 },
  }), { x: 795, y: 400, width: 100, height: 60 })

  // 左右都放不下、上面放得下 ⇒ 翻到「上」（第三位）。
  assert.deepEqual(adjustBounds({
    relative: { x: 400, y: 150, width: 50, height: 20 },
    screen: { x: 0, y: 0, width: 1000, height: 200 },
    size: { width: 100, height: 60 },
  }), { x: 400, y: 85, width: 100, height: 60 })

  // 顺序可以显式给（`adjust(popup, d, traversalPolicy)`，`:191-195`）。
  assert.equal(adjustBounds({
    relative: { x: 400, y: 150, width: 50, height: 20 },
    screen: { x: 0, y: 0, width: 1000, height: 200 },
    size: { width: 100, height: 60 },
    order: ['bottom', 'top'],
  }).y, 85)
  // 空数组等价于默认顺序（`:221` `if (traversalPolicy.length == 0) traversalPolicy = DEFAULT_POSITION_ORDER`）。
  assert.deepEqual(adjustBounds({
    relative: { x: 100, y: 100, width: 50, height: 20 },
    screen,
    size: { width: 100, height: 60 },
    order: [],
  }), { x: 155, y: 100, width: 100, height: 60 })
})

test('一块都放不下：取面积最大的那块空地把弹层裁小塞进去（不是夹回原位）', () => {
  // 屏幕 100×100，锚点正中，弹层 80×80 —— 四个位全部越界。
  // 上游 `:261-263` 把四块空地按宽再按高升序排、取最后一块（最大），
  // `:264-269` 在空地起点落在锚点之前时把弹层推到空地另一端贴边，最后再 `crop` 一次。
  const out = adjustBounds({
    relative: { x: 40, y: 40, width: 20, height: 20 },
    screen: { x: 0, y: 0, width: 100, height: 100 },
    size: { width: 80, height: 80 },
  })
  // 四块空地：上 {40,0,60,35}、下 {40,65,60,35}、左 {0,40,35,100}、右 {65,40,35,100}。
  // 排序后最大的是「下」（宽 60 > 35），弹层被裁成 60×35 塞进去。
  assert.deepEqual(out, { x: 40, y: 65, width: 60, height: 35 })
  assert.ok(out.width < 80 && out.height < 80, '放不下时是**裁小**，不是平移')
  assert.ok(out.x >= 0 && out.y >= 0 && out.x + out.width <= 100 && out.y + out.height <= 100,
    '裁完必须整块落在屏幕里')
})

test('crop：整块落在外面时**允许算出负宽高** —— 那是「这块地放不下」的度量，不是 bug', () => {
  // `:273-294` 逐行照抄，包括不夹到 0 这一条。Java 的 Rectangle 宽高可以是负的。
  assert.deepEqual(crop({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 20, width: 30, height: 40 }),
    { x: 0, y: 20, width: 30, height: 40 })
  // 左边缘越界 ⇒ 宽度减去越出去的量、x 贴回 source 左缘（`:275-278`）。
  assert.deepEqual(crop({ x: 0, y: 0, width: 100, height: 100 }, { x: -10, y: 20, width: 30, height: 40 }),
    { x: 0, y: 20, width: 20, height: 40 })
  // 越得太多 ⇒ 负宽（`:285-291`，上游不夹 0）。
  assert.deepEqual(crop({ x: 0, y: 0, width: 100, height: 100 }, { x: -30, y: 20, width: 10, height: 40 }),
    { x: 0, y: 20, width: -20, height: 40 })
  // 右/下缘越界同理（`:285-291`）。
  assert.deepEqual(crop({ x: 0, y: 0, width: 100, height: 100 }, { x: 80, y: 80, width: 40, height: 40 }),
    { x: 80, y: 80, width: 20, height: 20 })
})

test('分步弹层的下一层：与父边界相交就改摆到父弹层左边，且不许出屏幕左缘', () => {
  // `WizardPopup.java:73` 的 `STEP_X_PADDING = 2`。
  assert.equal(STEP_X_PADDING, 2)
  // `:261-262`：父弹层边界先各内缩 2（只有 x 与 width，y/height 不动）。
  assert.deepEqual(paddedParentBounds({ x: 100, y: 100, width: 200, height: 300 }),
    { x: 102, y: 100, width: 196, height: 300 })

  const viewport = { x: 0, y: 0, width: 1000, height: 800 }
  const size = { width: 100, height: 50 }
  // 请求位落在父弹层之外 ⇒ `:289-291`「No intersection with the parent bounds」⇒ 用夹好的落位。
  assert.deepEqual(childStepAnchor({ x: 100, y: 100, width: 200, height: 300 }, size, viewport),
    { x: 305, y: 100 })
  // 请求位压在父弹层上 ⇒ `:277-278` 改摆到父弹层左侧 `parent.x - width - STEP_X_PADDING`。
  assert.deepEqual(
    childStepAnchor({ x: 200, y: 100, width: 600, height: 300 }, size, viewport, 5, { x: 250, y: 150 }),
    { x: 98, y: 150 })
  // `:282-284`：摆过去后 x < 屏幕左缘就夹回左缘（注释写明是为了不跑到另一块屏上）。
  assert.deepEqual(
    childStepAnchor({ x: 100, y: 100, width: 600, height: 300 }, size, viewport, 5, { x: 150, y: 150 }),
    { x: 0, y: 150 })
  // `:273` moveToFit 在相交判定**之前**：请求位出屏幕先被夹回来（x 夹到 0；y 夹出的是负高，
  // 见上面 crop 那条），夹完不相交就直接用。
  assert.deepEqual(
    childStepAnchor({ x: 100, y: 100, width: 200, height: 300 }, size, viewport, 5, { x: -40, y: 900 }),
    { x: 0, y: 900 })
  // 夹完之后仍然压在父弹层上才走左边那一支（顺序换了语义就变，所以要钉住）。
  assert.deepEqual(
    childStepAnchor({ x: 100, y: 100, width: 400, height: 300 }, size, viewport, 5, { x: -90, y: 200 }),
    { x: 0, y: 200 })
})

test('overlaps：边贴边不算相交（Rectangle.intersects 要求两边都有正交叠）', () => {
  const a = { x: 0, y: 0, width: 10, height: 10 }
  assert.equal(overlaps(a, { x: 10, y: 0, width: 10, height: 10 }), false, '右边缘贴一起不算相交')
  assert.equal(overlaps(a, { x: 0, y: 10, width: 10, height: 10 }), false, '下边缘贴一起不算相交')
  assert.equal(overlaps(a, { x: 9, y: 9, width: 10, height: 10 }), true)
  assert.equal(overlaps(a, { x: -5, y: -5, width: 6, height: 6 }), true)
})
