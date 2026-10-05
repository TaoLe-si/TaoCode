// 悬停快速求值的**装配层行为**判据（`src/quickEvaluateHint.ts` + 规则层
// `src/debugQuickEvaluate.ts`）—— 上游 `XDebuggerTextPopup`
// （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/XDebuggerTextPopup.java`：
// 工具条四条 :249-256、可见性互斥 :286-290、`canSetTextValue` :308-321、
// F2 :391-401、Ctrl+Enter :346-357、Esc :413-424、去重 :127-140、抢焦点 :172）
// 与 `QuickEvaluateHandler`
// （同目录 `QuickEvaluateHandler.java:17-31`：`isEnabled` / `createValueHint` / `canShowHint` / `getValueLookupDelay`）。
//
// 这里测的是**不依赖 DOM 的那几个纯函数**（渲染本体 `buildPanel` 要 `document`，
// 由 `tests/debug-quick-evaluate.test.mjs` 的消费链静态判据守着）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { nextTick } from 'vue'
import { dapCapabilities, dapRememberCapabilities, dapState } from '../src/bridge.ts'
import {
  accessChainSpans, expressionAtPosition, expressionRangeAtPosition, expressionRangeForHint,
  lastShownText, quickEvaluateCoversPosition, quickEvaluateKeyAction, wordAtPosition, wordRangeAtPosition,
} from '../src/quickEvaluateHint.ts'
import {
  canSetTextValue, convertToStringLiteral, editableTextOf, quickEvaluateDelay,
  toolbarTransition, visibleToolbarModes,
} from '../src/debugQuickEvaluate.ts'
import {
  DEFAULT_DEBUGGER_EXTRA_SETTINGS, DEBUGGER_EXTRA_SETTINGS_KEY, attachDebuggerExtrasPersistence,
  debuggerExtras, loadDebuggerExtras, parseDebuggerExtras, patchDebuggerExtras, saveDebuggerExtras,
  serializeDebuggerExtras,
} from '../src/debugSettingsStore.ts'

const display = (expression, text) => ({ expression, text })

test('同值不重画只在「同一次展示 + 同一个表达式」里成立（上游 :127-140 的 lastFullValueHashCode 随每次 show() 新建）', () => {
  // 第一次：没有基准 ⇒ 一定要画。
  assert.equal(lastShownText(null, 'count'), undefined)
  // 同一个表达式的同一个值 ⇒ 给出基准文本，调用侧的 shouldRepaintValue 据此不重画。
  assert.equal(lastShownText(display('count', '0'), 'count'), '0')
  // 换一个表达式，哪怕值一模一样也必须重新弹 —— 这就是本轮修掉的真实缺陷
  // （原来只比文本，连着悬停两个值都是 0 的变量时第二个永远不出提示）。
  assert.equal(lastShownText(display('count', '0'), 'total'), undefined)
})

test('弹层收起即作废比对基准（上游 popup 的 cancelCallback :160-165）', () => {
  const first = display('count', '0')
  assert.equal(lastShownText(first, 'count'), '0')
  // destroy() 把 shown 置回 null；下一次展示同一表达式要重新画。
  assert.equal(lastShownText(null, 'count'), undefined)
})

test('快捷键按形态互斥派发（F2 :394 / Ctrl+Enter :349 / Esc :418，互斥来自 shouldBeVisible :286-290）', () => {
  // 非改值态：只有 F2 ⇒ 进入改值。
  assert.equal(quickEvaluateKeyAction({ key: 'F2' }, 'value'), 'set-value-mode')
  assert.equal(quickEvaluateKeyAction({ key: 'Enter', ctrlKey: true }, 'value'), null,
    '非改值态的 Ctrl+Enter 在上游是「设置文本值」不可见 ⇒ 不派发')
  assert.equal(quickEvaluateKeyAction({ key: 'Escape' }, 'value'), 'hide-hint',
    '非改值态的 Esc 收起整个弹层：上游 keyEventHandler（XDebuggerTextPopup.java:173-184）在'
    + ' mySetValueModeEnabled 为 false 时把 close request 交给 myPopup.cancel()。'
    + '本仓走 closeHoverTooltips（@codemirror/view 6.43 的 dist/index.d.ts:2123 就是这条通道）；'
    + '上一版写的「hover tooltip 没有程序化关闭的门 ⇒ 不拦」是错的，本轮订正')
  // 改值态：只有 Ctrl+Enter（提交）与 Esc（取消）。
  assert.equal(quickEvaluateKeyAction({ key: 'Enter', ctrlKey: true }, 'editing'), 'set-text-value')
  assert.equal(quickEvaluateKeyAction({ key: 'Enter', metaKey: true }, 'editing'), 'set-text-value')
  assert.equal(quickEvaluateKeyAction({ key: 'Escape' }, 'editing'), 'cancel-set-value')
  assert.equal(quickEvaluateKeyAction({ key: 'F2' }, 'editing'), null,
    '改值态的 F2 在上游被隐藏 ⇒ 无事发生')
  // 裸 Enter（编辑态）不提交：上游的 SetTextValueAction 只在 Ctrl+Enter 上（:349）。
  assert.equal(quickEvaluateKeyAction({ key: 'Enter' }, 'editing'), null)
  // 其余键一律不拦，不能把编辑器的键位吃掉。
  for (const key of ['a', 'ArrowDown', 'Tab', 'F9']) {
    assert.equal(quickEvaluateKeyAction({ key }, 'value'), null)
    assert.equal(quickEvaluateKeyAction({ key }, 'editing'), null)
  }
})

test('派发出的动作一定在工具条上画得出来（不出现「有键没按钮 / 有按钮点不动」）', () => {
  const flags = { hasChildren: true, canSetText: true }
  const actions = ['set-value-mode', 'set-text-value', 'cancel-set-value']
  for (const mode of ['value', 'editing']) {
    const visible = visibleToolbarModes(mode, flags)
    const keyAction = quickEvaluateKeyAction({ key: mode === 'editing' ? 'Escape' : 'F2' }, mode)
    if (keyAction) assert.ok(visible.includes(keyAction), `${mode} 态派发了 ${keyAction}，但工具条上没有这一格`)
  }
  for (const action of actions) assert.ok(action.startsWith('set-') || action === 'cancel-set-value')
  // 不可写（没有 supportsSetExpression ⇒ canSetText=false）时改值两格既不画也不派发。
  const readOnly = visibleToolbarModes('value', { hasChildren: false, canSetText: false })
  assert.deepEqual(readOnly, [])
})

test('词与选区：普通悬停取整条访问链，Alt 悬停优先手动选区（XQuickEvaluateHandler.kt:69-82 / XValueHint.java:138）', () => {
  const doc = 'int total = order.getTotal();'
  const state = EditorState.create({ doc })
  // `order` 占 12..16（`.` 在 17、`getTotal` 在 18..25）—— 逐位对齐上游「拿光标处的那个元素」。
  assert.equal(wordAtPosition(state, 14), 'order')
  assert.equal(wordAtPosition(state, 22), 'getTotal')
  assert.equal(wordAtPosition(state, 0), 'int')
  // 位置是「光标」而不是「字符」：紧贴词右边（17 在 `.` 左侧、前一个字符是 `r`）仍算 `order`，
  // 两侧都不是词字符才切不出词（11 在 `=` 后面那个空格上）⇒ 空串交给规则层判「没有可求值的词」。
  assert.equal(wordAtPosition(state, 17), 'order')
  assert.equal(wordAtPosition(state, 11), '')
  // 选中 `order.getTotal()` 后 Alt 悬停落在选区里 ⇒ 求选区；不带修饰符仍走「取表达式」那条路，
  // 而那条路在调用处截断成宿主（副作用门，`XQuickEvaluateHandler.kt:73`）⇒ `order`。
  const selected = state.update({ selection: { anchor: 12, head: 28 } }).state
  assert.equal(expressionAtPosition(selected, 20, 'altHover'), 'order.getTotal()')
  assert.equal(expressionAtPosition(selected, 20, 'hover'), 'order',
    '上一版这里给的是 `getTotal`（只取标识符词）：单独不构成可求值表达式 ⇒ 求值必失败 ⇒ 普通悬停永远不出提示')
  // 选区外仍按链。
  assert.equal(expressionAtPosition(selected, 5, 'altHover'), 'total')
})

test('取词订正：成员访问链整条取，range 与文本对齐（上游 expressionInfo.getTextRange()）', () => {
  const cases = [
    // 文档, 光标列, 类型, 期望文本, 期望 [from,end)
    ['result = order.total;', 15, 'hover', 'order.total', [9, 20]],
    ['result = order.total;', 20, 'hover', 'order.total', [9, 20]],
    ['result = order.total;', 3, 'hover', 'result', [0, 6]],
    ['node = cursor->next;', 15, 'hover', 'cursor->next', [7, 19]],
    ['size = Map.Entry.count;', 16, 'hover', 'Map.Entry.count', [7, 22]],
    ['item = list[0].name;', 16, 'hover', 'list[0].name', [7, 19]],
    // 调用：普通悬停截到宿主，Alt 悬停把实参括号并进来。
    ['int n = order.getTotal();', 15, 'hover', 'order', [8, 13]],
    ['int n = order.getTotal();', 21, 'hover', 'order', [8, 13]],
    ['int n = order.getTotal();', 21, 'altHover', 'order.getTotal()', [8, 24]],
    // 裸调用没有宿主 ⇒ 空串（上游普通悬停也不求值有副作用的表达式）。
    ['int n = compute();', 11, 'hover', '', [15, 15]],
    ['int n = compute();', 11, 'altHover', 'compute()', [8, 17]],
  ]
  for (const [doc, column, kind, expected, [from, to]] of cases) {
    const state = EditorState.create({ doc })
    const found = expressionRangeAtPosition(state, column, kind)
    assert.equal(found.text, expected, `${doc} 第 ${column} 列（${kind}）`)
    assert.equal(found.from, from, `${doc} 的 from 要和文本对齐（弹层范围用它）`)
    assert.equal(found.end, to, `${doc} 的 end 要和文本对齐（弹层范围用它）`)
  }
})

test('链的切分只看这一行：跨行、后缀点、下标不闭合都不并进表达式', () => {
  const spans = accessChainSpans('a.b + c.d(e.f) g[0].h ', false)
  assert.deepEqual(spans.map(span => span.start), [0, 6, 10, 15])
  assert.deepEqual(spans.map(span => span.end), [3, 9, 13, 21])
  // 普通悬停不吃括号：`c.d(e.f)` 的链只到 `d`，最后一段就是「调用的方法名」。
  const hover = accessChainSpans('c.d(e.f)', false)[0]
  assert.equal(hover.end, 3)
  assert.equal(hover.segments.length, 2)
  // Alt 悬停允许副作用 ⇒ 实参括号组并进来（嵌套也吃得下）。
  const alt = accessChainSpans('c.d(e.f(g))', true)[0]
  assert.equal(alt.end, 11, '实参括号组（含嵌套）整段并进表达式')
  // 不闭合的下标/括号不吞（`indexOf` 找不到就放弃这条链的后续）。
  assert.equal(accessChainSpans('a[b', false)[0].end, 1)
  assert.equal(accessChainSpans('a. ', false)[0].end, 1, '点后面没有标识符 ⇒ 点不属于这条链')
})


test('改值的文本口径：显示形态 ⇄ 可编辑形态（convertToStringLiteral / translateStringValue）', () => {
  assert.equal(convertToStringLiteral('hi'), '"hi"')
  assert.equal(convertToStringLiteral('a"b\\c'), '"a\\"b\\\\c"')
  assert.equal(convertToStringLiteral('tab\there\n'), '"tab\\there\\n"')
  assert.equal(convertToStringLiteral('\x01'), '"\\u0001"')
  // 编辑初值剥掉外层引号并反转义，提交时再包回去 —— 两个方向必须互为逆。
  assert.equal(editableTextOf('"a\\"b\\\\c"'), 'a"b\\c')
  assert.equal(convertToStringLiteral(editableTextOf('"tab\\there\\n"')), '"tab\\there\\n"')
  // 「能按文本改」的两个条件：适配器支持 setExpression + 值本身是字符串形态。
  assert.equal(canSetTextValue('"x"', true), true)
  assert.equal(canSetTextValue('"x"', false), false, '没有 supportsSetExpression ⇒ 不画改值格（假控件）')
  assert.equal(canSetTextValue('42', true), false)
})

test('改值形态的转移：只有 Ctrl+Enter 那一条真的提交（:365-376）', () => {
  assert.deepEqual(toolbarTransition('editing', 'set-text-value'), { mode: 'value', commit: true })
  assert.deepEqual(toolbarTransition('value', 'set-text-value'), { mode: 'value', commit: false })
  assert.deepEqual(toolbarTransition('value', 'set-value-mode'), { mode: 'editing', commit: false })
  assert.deepEqual(toolbarTransition('editing', 'cancel-set-value'), { mode: 'value', commit: false })
})

test('延迟格非法值按上游默认 700（XDebuggerDataViewSettings.java:26 的初始化）', () => {
  assert.equal(quickEvaluateDelay(undefined), 700)
  assert.equal(quickEvaluateDelay(-5), 700)
  assert.equal(quickEvaluateDelay(Number.POSITIVE_INFINITY), 700)
  assert.equal(quickEvaluateDelay(120), 120)
})

test('设置格持久化：读盘补默认、只写差异、坏数据不炸', () => {
  const snapshot = { ...debuggerExtras }
  try {
    const fake = { map: new Map(), getItem(key) { return this.map.has(key) ? this.map.get(key) : null }, setItem(key, value) { this.map.set(key, value) } }
    assert.deepEqual(parseDebuggerExtras(null), DEFAULT_DEBUGGER_EXTRA_SETTINGS)
    assert.deepEqual(parseDebuggerExtras('{oops'), DEFAULT_DEBUGGER_EXTRA_SETTINGS)
    // 老存盘里没有新键 ⇒ 逐键补默认，不能按「键数不对」判损坏。
    assert.deepEqual(parseDebuggerExtras('{"scrollToCenter":true}'), { ...DEFAULT_DEBUGGER_EXTRA_SETTINGS, scrollToCenter: true })
    // 与默认档相同的格不写盘（存盘短）。
    assert.equal(serializeDebuggerExtras(DEFAULT_DEBUGGER_EXTRA_SETTINGS), '{}')
    const saved = patchDebuggerExtras(fake, { valueTooltipAutoShow: false, valueLookupDelay: 300 })
    assert.equal(saved.valueTooltipAutoShow, false)
    assert.equal(saved.valueLookupDelay, 300)
    assert.deepEqual(JSON.parse(fake.map.get(DEBUGGER_EXTRA_SETTINGS_KEY)), { valueTooltipAutoShow: false, valueLookupDelay: 300 })
    // 非法延迟被丢掉，上一轮的 300 原样留着（`patchDebuggerExtras` 的兜底）。
    patchDebuggerExtras(fake, { valueLookupDelay: Number.NaN })
    assert.equal(JSON.parse(fake.map.get(DEBUGGER_EXTRA_SETTINGS_KEY)).valueLookupDelay, 300)
    // 存储不可用时静默降级：save 不抛；load 读不到盘就退回上游默认档（并把它灌进单例）。
    saveDebuggerExtras(null)
    assert.equal(loadDebuggerExtras({ getItem() { throw new Error('locked') }, setItem() { throw new Error('locked') } }).valueTooltipAutoShow,
      DEFAULT_DEBUGGER_EXTRA_SETTINGS.valueTooltipAutoShow)
    assert.equal(debuggerExtras.valueLookupDelay, DEFAULT_DEBUGGER_EXTRA_SETTINGS.valueLookupDelay)
  }
  finally {
    patchDebuggerExtras(null, snapshot)
  }
})

test('localStorage 接线：有盘就接、没盘就不接（App.vue 不参与也存得下来）', async () => {
  const snapshot = { ...debuggerExtras }
  const fake = { map: new Map(), getItem(key) { return this.map.has(key) ? this.map.get(key) : null }, setItem(key, value) { this.map.set(key, value) } }
  fake.setItem(DEBUGGER_EXTRA_SETTINGS_KEY, '{"scrollToCenter":true,"valueLookupDelay":250}')
  // 没有可用存储（node 里没有 localStorage）⇒ 返回 false，不去污染单例。
  assert.equal(attachDebuggerExtrasPersistence(null), false, '给了空存储还宣称接上了')
  const attached = attachDebuggerExtrasPersistence(fake)
  assert.equal(typeof attached, 'boolean', 'attachDebuggerExtrasPersistence 必须给个布尔')
  if (attached) {
    assert.equal(debuggerExtras.scrollToCenter, true, '接上时应当先读盘')
    assert.equal(debuggerExtras.valueLookupDelay, 250)
    debuggerExtras.runToCursorGestureEnabled = false
    await nextTick()
    assert.equal(JSON.parse(fake.map.get(DEBUGGER_EXTRA_SETTINGS_KEY)).runToCursorGestureEnabled, false,
      '改一格没自动落盘')
  }
  else {
    // 本进程的模块加载期没盘可接（node 里没有 localStorage）⇒ 用显式 load/save 证同一条通路。
    loadDebuggerExtras(fake)
    assert.equal(debuggerExtras.scrollToCenter, true, '读盘没把存过的值灌进单例')
    assert.equal(debuggerExtras.valueLookupDelay, 250)
    debuggerExtras.runToCursorGestureEnabled = false
    saveDebuggerExtras(fake)
    assert.ok(String(fake.map.get(DEBUGGER_EXTRA_SETTINGS_KEY)).includes('"runToCursorGestureEnabled":false'),
      '与默认档不同的格没被写进存盘')
  }
  patchDebuggerExtras(null, snapshot)
})

test('词范围是半开区间且与文本对齐（弹层范围直接用它，零宽 ⇒ 鼠标一动就收起）', () => {
  const state = EditorState.create({ doc: 'abc = value.x;' })
  // `abc` 占 0..3：`wordRangeAtPosition` 给的 end 是「词后一位」，text 必须正好等于 sliceDoc(from,end)。
  const word = wordRangeAtPosition(state, 1)
  assert.deepEqual([word.from, word.end, word.text], [0, 3, 'abc'])
  assert.equal(state.sliceDoc(word.from, word.end), word.text)
  // 两侧都不是词字符才切不出词：pos 5 在 `=` 与空格之间 ⇒ 空范围（不是给个假范围）。
  // pos 3 紧贴 `abc` 右边仍算 `abc` —— 取的是「光标位置」而不是「光标下那个字符」，与上游
  // `AbstractValueHint.calculateOffset` + `TargetElementUtil.adjustOffset`（`XQuickEvaluateHandler.kt:66-68`）同一口径。
  assert.equal(wordRangeAtPosition(state, 3).text, 'abc')
  const none = wordRangeAtPosition(state, 5)
  assert.equal(none.text, '')
  assert.equal(none.from, none.end)
  // Alt 悬停落在选区里：range 随 trim 收缩，text 与 range 仍然对齐（弹层不能盖住两端空白）。
  const selected = state.update({ selection: { anchor: 6, head: 13 } }).state
  const hint = expressionRangeForHint(selected, 8, 'altHover')
  assert.equal(hint.text, 'value.x')
  assert.equal(selected.sliceDoc(hint.from, hint.end), hint.text)
})

test('给宿主的让路判据：值提示接管这个位置时，语言服务那条悬停要让路（AbstractValueHint.java:295 先 hideCurrentHint）', () => {
  const doc = 'int n = order.total + compute();'
  const state = EditorState.create({ doc })
  const paused = dapState.paused
  const snapshot = { ...dapCapabilities }
  try {
    dapRememberCapabilities({ supportsEvaluateForHovers: true })
    // 没有暂停的会话 ⇒ 谁都不接管（未调试时 LSP 悬停照旧，不能把文档提示一起关掉）。
    dapState.paused = false
    assert.equal(quickEvaluateCoversPosition(state, 10), false, '没暂停也声称接管')
    dapState.paused = true
    assert.equal(quickEvaluateCoversPosition(state, 10), true, '`order.total` 这一段该由值提示接管')
    assert.equal(quickEvaluateCoversPosition(state, 14), true, '链的中间（`.` 前后）也算同一条表达式')
    assert.equal(quickEvaluateCoversPosition(state, 22), false, 'compute( 是调用 ⇒ 普通悬停不求值 ⇒ 不让路')
    // 能力位没报 / 明确报 false ⇒ 整族不接管（本仓自带的假适配器就报 false，native/dap_fake_adapter.cpp:302）。
    dapRememberCapabilities({ supportsEvaluateForHovers: false })
    assert.equal(quickEvaluateCoversPosition(state, 10), false)
    dapRememberCapabilities({})
    assert.equal(quickEvaluateCoversPosition(state, 10), false, '没声明 supportsEvaluateForHovers ⇒ 不发注定失败的请求')
  }
  finally {
    dapState.paused = paused
    for (const key of Object.keys(dapCapabilities)) delete dapCapabilities[key]
    Object.assign(dapCapabilities, snapshot)
  }
})
