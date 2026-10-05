// 快速求值 / 值提示规则（`src/debugQuickEvaluate.ts`）—— 上游 `QuickEvaluateHandler`
// （`.../xdebugger/impl/evaluate/quick/common/QuickEvaluateHandler.java:17-31`）与
// `XDebuggerTextPopup`（同目录，尺寸常量 :62-66、夹取 :292-306、去重 :127-140、过期丢弃 :122/:154-157）。
// 默认延迟 700 出自 `platform/xdebugger-api/.../XDebuggerSettingsManager.java:21`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_VALUE_LOOKUP_DELAY, POPUP_MAX_HEIGHT, POPUP_MAX_WIDTH, POPUP_MIN_HEIGHT, POPUP_MIN_WIDTH,
  POPUP_TOOLBAR_MARGIN, QUICK_EVALUATE_TOOLBAR, acceptQuickEvaluateResult, quickEvaluateDecision,
  quickEvaluateDelay, quickEvaluatePopupSize, setQuickEvaluateSessionProbe, shouldRepaintValue,
} from '../src/debugQuickEvaluate.ts'

test('默认延迟 = 上游 700ms；非法值退回默认，非整数向下取整', () => {
  assert.equal(DEFAULT_VALUE_LOOKUP_DELAY, 700)
  assert.equal(quickEvaluateDelay(undefined), 700)
  assert.equal(quickEvaluateDelay(-1), 700)
  assert.equal(quickEvaluateDelay(Number.NaN), 700)
  assert.equal(quickEvaluateDelay(250.9), 250)
  assert.equal(quickEvaluateDelay(0), 0)
})

test('关掉值提示 ⇒ 不发 evaluate；会话不可用 / 词为空也不发（各带自己的原因）', () => {
  setQuickEvaluateSessionProbe(() => true)
  const off = quickEvaluateDecision('count', { showTooltip: false, valueLookupDelay: 300 })
  assert.equal(off.evaluate, false)
  assert.equal(off.delay, 300, '延迟照样算出来，设置项不会因为不求值而失真')
  assert.equal(off.reason, '值提示已关闭')

  assert.equal(quickEvaluateDecision('  ', {}).reason, '光标处没有可求值的词')

  setQuickEvaluateSessionProbe(() => false)
  assert.equal(quickEvaluateDecision('count', {}).reason, '没有暂停的调试会话')

  // 探测抛异常时按「没有会话」处理，不把异常带出去。
  setQuickEvaluateSessionProbe(() => { throw new Error('boom') })
  assert.equal(quickEvaluateDecision('count', {}).evaluate, false)
})

test('该求值时：给出延迟，reason 为空', () => {
  setQuickEvaluateSessionProbe(() => true)
  const result = quickEvaluateDecision('  order.total  ', { valueLookupDelay: 120 })
  assert.equal(result.evaluate, true)
  assert.equal(result.delay, 120)
  assert.equal(result.reason, '')
})

test('弹层尺寸：宽 = max(工具条, 文本) + 余量，再夹在屏幕 1/5 ~ 1/2 与常量之间', () => {
  // 1920×1080：上限 min(960, 650)=650，下限 max(384, 170)=384。
  // 文本宽 500 ⇒ 500+30=530 落在 [384, 650] 里。
  const big = quickEvaluatePopupSize(500, 200, 1920, 1080, { toolbarWidth: 100, toolbarHeight: 28 })
  assert.equal(big.width, 500 + POPUP_TOOLBAR_MARGIN)
  assert.equal(big.height, 200 + 28)
  // 比屏幕 1/5 还窄的文本会被抬到下限 384（上游 Math.max(屏幕/5, MIN)）。
  assert.equal(quickEvaluatePopupSize(300, 40, 1920, 1080, {}).width, 384)
  // 超长文本被 650 夹住。
  assert.equal(quickEvaluatePopupSize(2000, 40, 1920, 1080, {}).width, POPUP_MAX_WIDTH)
  // 工具条比文本宽时以工具条为准（上游 :229 的 Math.max）：500+30=530 仍在 [384, 650]。
  assert.equal(quickEvaluatePopupSize(10, 10, 1920, 1080, { toolbarWidth: 500 }).width, 500 + POPUP_TOOLBAR_MARGIN)
  // 高度上限 min(540, 400)。
  assert.equal(quickEvaluatePopupSize(10, 1000, 1920, 1080, {}).height, POPUP_MAX_HEIGHT)
  // 极小屏幕：下限的常量兜底压过屏幕比例（屏幕 400 宽 ⇒ 1/5=80，但下限是 170）。
  const tiny = quickEvaluatePopupSize(10, 10, 400, 300, {})
  assert.equal(tiny.width, POPUP_MIN_WIDTH)
  assert.equal(tiny.height, POPUP_MIN_HEIGHT)
})

test('同一次展示里值文本相同就不重画（上游 preventDoubleExecution :127-140）', () => {
  assert.equal(shouldRepaintValue('42', '42'), false)
  assert.equal(shouldRepaintValue('42', '43'), true)
  assert.equal(shouldRepaintValue(undefined, '42'), true)
})

test('过期结果丢弃：nonce 不是最新的就丢掉（上游 evaluationObsolete :122/:154-157）', () => {
  assert.deepEqual(acceptQuickEvaluateResult(3, 3, { value: '42' }), { value: '42', error: '' })
  assert.equal(acceptQuickEvaluateResult(2, 3, { value: '42' }), null)
  assert.equal(acceptQuickEvaluateResult(3, 3, null), null)
  assert.deepEqual(acceptQuickEvaluateResult(3, 3, { error: 'no such field' }), { value: '', error: 'no such field' })
})

test('工具条动作与快捷键对齐上游（XDebuggerTextPopup :249-256 / :350 / :394 / :418）', () => {
  const byMode = Object.fromEntries(QUICK_EVALUATE_TOOLBAR.map(item => [item.mode, item.shortcut]))
  assert.equal(byMode['set-value-mode'], 'F2')
  assert.equal(byMode['set-text-value'], 'Ctrl+Enter')
  assert.equal(byMode['cancel-set-value'], 'Esc')
})

test('消费链：CodeEditor 真的挂上了值提示（不是只写了一个没人用的模块）', () => {
  const editor = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')
  assert.match(editor, /from '\.\.\/quickEvaluateHint'/, '装配层没 import')
  assert.match(editor, /createQuickEvaluateHint\(\{/, '没建值提示')
  // 必须挂在**常驻**扩展上，不能塞进 lspExtensions()：调试不依赖语言服务，
  // 塞进那扇门会让「没接语言服务器的文件」整族失效（同折叠族的教训）。
  assert.match(editor, /^\s*quickEvaluateHint,$/m, '值提示没进扩展数组')
  const host = readFileSync(new URL('../src/quickEvaluateHint.ts', import.meta.url), 'utf8')
  assert.match(host, /dapEvaluate\(\s*expression,\s*'hover'/, '没发 dap.evaluate')
  assert.match(host, /dapStackTrace\(dapState\.threadId\)/, '帧 id 没走 dap.stackTrace 的栈顶帧')
  assert.match(host, /setQuickEvaluateSessionProbe\(\(\) => dapState\.paused\)/, '会话可用性没注入')
  // 过期丢弃与同值不重画两道规则必须真的被调用（XDebuggerTextPopup :122 / :127-140）。
  // 「同值不重画」的比较边界是 `lastShownText(shown, expression)`：只在同一次展示、同一个表达式里比。
  assert.match(host, /acceptQuickEvaluateResult\(issued, nonce,/)
  assert.match(host, /shouldRepaintValue\(lastShownText\(shown, expression\), value\)/)
  // 弹层工具条（本轮主交付物）：条目必须经规则层过滤后才渲染，动作必须真发请求。
  assert.match(host, /visibleToolbarModes\(mode, flags\)/, '工具条没按可见性规则取条目')
  assert.match(host, /toolbarItem\(item\)/, '工具条条目没取上游文案与快捷键')
  assert.match(host, /canSetTextValue\(input\.value, dapCapability\('supportsSetExpression'\) === true\)/,
    '「改值」两格的可见性没判 supportsSetExpression ⇒ 会画出点不动的按钮')
  assert.match(host, /dapSetExpression\(input\.expression, literal, input\.frameId\)/, '提交改值没发 DAP 请求')
  assert.match(host, /dapVariables\(reference\)/, '「显示为对象」没走 DAP variables')
  assert.match(host, /toolbarTransition\(mode, 'set-text-value'\)/, '改值形态没走规则层的转移表')
  assert.match(host, /quickEvaluatePopupSize\(textWidth, textHeight/, '弹层尺寸没走规则层的夹取')
  assert.match(host, /lookupDelayFor\(decision\.delay, popupShowing\)/, '节流没走规则层（上游 :143-149）')
  assert.match(host, /viewportUnchanged\(area, viewportOf\(view\)\)/, '到点没比可视区域（上游 :127-141）')
  assert.match(host, /hoverHintKind\(lastMouse\)/, '悬停修饰符没走规则层（AbstractValueHint :460-469）')
  assert.match(host, /allowsSideEffects|isSideEffectFree\(expression\)/, '普通悬停的副作用门没判')
  // 快捷键挂在编辑器根节点的**捕获**阶段、收起时摘掉（本仓 tooltip 没有焦点宿主，见模块头差异）。
  assert.match(host, /view\.dom\.addEventListener\('keydown', onKeyDown, true\)/, '快捷键没挂到编辑器根节点')
  // 补全 UI 开着时 tooltip 挂在 document.body（completionUi.ts:239）⇒ 输入器里的键不路过编辑器根节点，
  // 所以弹层自己也要听一次（两处靠捕获阶段的 stopPropagation 保证只触发一遍）。
  assert.match(host, /^\s*dom\.addEventListener\('keydown', onKeyDown\)/m, '改值输入器里的快捷键没挂')
  assert.match(host, /view\.dom\.removeEventListener\('keydown', onKeyDown, true\)/, '弹层收起时没摘编辑器根节点的快捷键')
  assert.match(host, /dom\.removeEventListener\('keydown', onKeyDown\)/, '弹层收起时没摘弹层自己的快捷键')

  // 不许绕过规则层自己抄一份工具条常量（那四条的文案/快捷键只有一个来源）。
  assert.doesNotMatch(host, /import \{[^}]*\bQUICK_EVALUATE_TOOLBAR\b/, '工具条常量被直接 import 进装配层')
  assert.doesNotMatch(host, /for \(const \w+ of QUICK_EVALUATE_TOOLBAR\)/, '绕开可见性规则把四条全画出来（会有点不动的）')
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.quick-eval-value \{/, '值提示的类名没有样式（无样式裸标记）')
})

// 本轮（bucket12c）对**装配层**四条断链的机检：取词范围、弹层范围/方位、延迟来源、Esc 收起。
// 判据钉的是「装配有没有把规则层的量传到 CodeMirror」，不是字符串形状。
test('装配订正：弹层范围=整条表达式、方位=下方、hoverTime 不吃 0、Alt 悬停不排队、Esc 真收起', () => {
  const host = readFileSync(new URL('../src/quickEvaluateHint.ts', import.meta.url), 'utf8')
  // 「不许回来」的反向判据只看代码，不看注释（注释里正写着上一版那几条错法）。
  const code = host.replace(/^\s*\/\/.*$/gm, '')
  // 1) 取词：装配层必须用「整条访问链」的那一个 range（上游 XQuickEvaluateHandler.kt:78-82 → XValueHint.java:138），
  //    回到只取标识符词就会让成员访问链（order.total 的 total 半截）永远求值失败。
  assert.match(host, /const target = expressionRangeForHint\(view\.state, pos, kind\)/, '取词退回「标识符词」')
  assert.match(host, /return tooltipSpec\(view, target,/, '弹层没拿到表达式范围（还是零宽点）')
  // 2) 弹层范围与方位：`end` 决定「鼠标在表达式内不隐藏」（AbstractValueHint.java:304-311），
  //    `above:false` 对齐上游的 HintManager.UNDER（同文件 :324-331）。
  assert.match(host, /end: end > pos \? end : undefined,/, 'tooltip 少了 end ⇒ 工具条点不到')
  assert.match(host, /above: false,/, '弹层画在表达式上方，上游画在下方')
  assert.doesNotMatch(code, /above: true,/, '还留着上方')
  // 3) 延迟：CodeMirror 的实现写的是 `options.hoverTime || 300`（@codemirror/view/dist/index.js:10974），
  //    给 0 等于没给 ⇒ 实等 300+700ms。只有普通悬停排队（ValueLookupManager.java:129-140）。
  assert.doesNotMatch(code, /hoverTime: 0/, 'hoverTime 给 0 会被 CodeMirror 兜成 300ms')
  assert.match(host, /hoverTooltip\(source, \{ hoverTime: IDLE_PROBE_MS, hideOnChange: true \}\)/,
    '没把 CM 的空闲轮询间隔与「文本变更即收起」交给 CodeMirror')
  assert.match(host, /const IDLE_PROBE_MS = 1/, 'IDLE_PROBE_MS 不是 1（0 无效，>1 就多塞一段等待）')
  assert.match(host, /if \(kind === 'hover'\) \{[\s\S]{0,240}await sleep\(lookupDelayFor\(decision\.delay, popupShowing\)\)/,
    'Alt 悬停也在等 700ms（上游 ALT_OVER 走立即分支）')
  assert.doesNotMatch(code, /hideOnKeyDown/, 'hideOnKeyDown 不是 CodeMirror 6.43 的悬停选项')
  // 4) 非改值态的 Esc 真的收起弹层（XDebuggerTextPopup.java:173-184 ⇒ myPopup.cancel()）。
  assert.match(host, /closeHoverTooltips,/, '没 import CodeMirror 的程序化收起通道')
  assert.match(host, /else if \(action === 'hide-hint'\) view\.dispatch\(\{ effects: closeHoverTooltips \}\)/,
    '派发了 hide-hint 却没人收起')
  // 5) 普通悬停求值失败：收起自己、比对基准作废，把位置让回信息提示（XValueHint.java:421-427）。
  assert.match(host, /if \(kind !== 'altHover'\) \{ shown = null; return null \}/, '失败让位那一条被改掉了')
  // 6) 能力位口径：dapCapability 是严格布尔（src/bridge.ts:835），`!== false` 那种「看着像兜底其实是永假」的写法不许回来。
  assert.match(host, /return dapCapability\('supportsEvaluateForHovers'\) === true/)
})
