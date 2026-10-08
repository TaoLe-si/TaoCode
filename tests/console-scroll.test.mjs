// 运行控制台的「滚动到末尾」族：贴底判定 + 回底落点（纯函数在 src/consoleScroll.ts）+ 组件接线。
//
// 上游（本批逐条在参考树里打开核实）：
//   · 工具条动作 ScrollToTheEndToolbarAction：ConsoleViewImpl.kt:1360-1361 建、:1367 加进动作表；
//     类本体 platform/platform-impl/src/com/intellij/openapi/editor/actions/ScrollToTheEndToolbarAction.java:17-39
//     （普通 AnAction，一次点击 = EditorUtil.scrollToTheEnd，不是 ToggleAction）；
//     文案键 platform/platform-resources-en/src/messages/ActionsBundle.properties:205 =「Scroll to End」。
//   · 贴底跟随（stick-to-end）：ConsoleViewImpl.kt 的 flushDeferredTextImpl:666-668、isStickingToEnd:1684-1686、
//     isVScrollAtTheBottom:1708-1711（整数精确相等）、updateStickToEndState:481-487。
//
// 全是纯同步用例，没有计时器 / 没有 await ⇒ 不会挂住 `node --test`（判据要能失败，也不许卡死）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONSOLE_BOTTOM_TOLERANCE, consoleScrollToEndPosition, consoleViewAtBottom } from '../src/consoleScroll.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// ── 纯函数：贴底判定（上游 isVScrollAtTheBottom 的 DOM 等价，带 1px 子像素容差） ──────────────
test('consoleViewAtBottom：正好贴底为真、往上滚为假（上游 isVScrollAtTheBottom 的等价）', () => {
  // scrollHeight 200 / clientHeight 100 ⇒ 底部 = scrollTop 100。
  assert.equal(consoleViewAtBottom({ scrollTop: 100, scrollHeight: 200, clientHeight: 100 }), true, '正好到底')
  assert.equal(consoleViewAtBottom({ scrollTop: 99, scrollHeight: 200, clientHeight: 100 }), true, '差 1px（容差内，子像素取整）')
  assert.equal(consoleViewAtBottom({ scrollTop: 98, scrollHeight: 200, clientHeight: 100 }), false, '差 2px ⇒ 已停跟')
  assert.equal(consoleViewAtBottom({ scrollTop: 50, scrollHeight: 200, clientHeight: 100 }), false, '用户滚到中间')
  assert.equal(consoleViewAtBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 100 }), false, '停在顶部')
})

test('consoleViewAtBottom：分数设备像素下整数精确相等会失效，靠容差兜住', () => {
  // 上游那句是 `scrollBarPosition == maximum - visibleAmount`（整数）；DOM 三值可能带小数。
  const m = { scrollTop: 100.4, scrollHeight: 200.4, clientHeight: 100 }
  assert.equal(m.scrollTop, m.scrollHeight - m.clientHeight, '这里 scrollTop ≠ bottom（小数）')
  assert.equal(consoleViewAtBottom(m), true, '差值在容差内 ⇒ 判贴底')
})

test('consoleViewAtBottom：内容不足一屏（没有可滚动溢出）算贴底，保证首屏/短输出仍跟随', () => {
  assert.equal(consoleViewAtBottom({ scrollTop: 0, scrollHeight: 80, clientHeight: 100 }), true, '内容比视口短')
  assert.equal(consoleViewAtBottom({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 }), true, '刚好一屏')
})

// ── 纯函数：回底落点（上游 EditorUtil.scrollToTheEnd 的目标 scrollTop） ────────────────────
test('consoleScrollToEndPosition：到底目标 = scrollHeight - clientHeight，且不越界为负', () => {
  assert.equal(consoleScrollToEndPosition({ scrollTop: 0, scrollHeight: 500, clientHeight: 100 }), 400)
  assert.equal(consoleScrollToEndPosition({ scrollTop: 0, scrollHeight: 50, clientHeight: 100 }), 0, '没溢出⇒0，不是负数')
  assert.equal(consoleScrollToEndPosition({ scrollTop: 0, scrollHeight: 200.6, clientHeight: 100 }), 100.6, '小数原样给回')
})

test('CONSOLE_BOTTOM_TOLERANCE：本模块唯一的非上游数值，钉住为 1px（改它要连带改文件头理由）', () => {
  assert.equal(CONSOLE_BOTTOM_TOLERANCE, 1)
})

// ── 接线：RunConsole 用这两个纯函数 + 有可点按钮 + 可滚容器挂 ref/scroll ──────────────────
test('接线：RunConsole 从 consoleScroll.ts 取判定，输出区有 ref/scroll，工具条有「滚动到末尾」', () => {
  const view = read('src/components/RunConsole.vue')
  assert.ok(view.includes(`from '../consoleScroll.ts'`), '要 import 本模块（否则纯函数没有生产消费方）')
  assert.ok(view.includes('consoleViewAtBottom(el)'), '滚动事件把贴底判定接进来')
  assert.ok(view.includes('consoleScrollToEndPosition(el)'), '回底落点用同一个纯函数')
  assert.ok(view.includes('ref="logEl"'), '输出区要拿到滚动容器引用')
  assert.ok(view.includes('@scroll.passive="onLogScroll"'), '用户滚动⇒重新判定贴底（上滚即停跟）')
  assert.ok(view.includes('aria-label="滚动到末尾"'), '按钮可访问（aria-label）')
  assert.ok(view.includes('@click="scrollLogToEnd"'), '按钮接回底动作（不是假控件）')
})
