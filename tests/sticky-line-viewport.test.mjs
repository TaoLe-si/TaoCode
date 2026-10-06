// `src/stickyLineViewport.ts` 的判据（`lp/sticky-lines` 缺口的**模块侧那一半**）：
// 上游 `VisualStickyLines` 那层的候选/排序/宽度/面板度量规则，以及多分栏的
// 「模型在文档上、显示在每个编辑器上、新编辑器第一次必跑采集」。
//
// 每条断言后面标的就是上游坐标（都在本地参考树里逐行读过）：
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt`
//     `:18-23`（默认 5 行、允许下限 2）、`:66-87`（候选 = 与可视区那一段**相交**）、
//     `:96-111`（按主行去重 + 排序）、`:102`+`:162-163`（宽度门槛）、
//     `:125-127`+`:158-159`（面板放不下就一条不画）、`:144-148`（排满上限即停）；
//   · `.../StickyLinesModelImpl.java:112-117`（零宽作用域不收）、`:287-296`（比较器：起始升序、同起点宽的在前）；
//   · `.../StickyLinesManager.kt:20-34`、`:86-99`（每个编辑器各算一份）；
//   · `.../StickyLinesCollector.kt:36-51`（新编辑器第一次必跑）、`:77-79`（修订号 = PSI + 文档两段相加）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'

import {
  DEFAULT_SCOPE_MIN_LINES, MIN_SCOPE_MIN_SIZE, compareStickyScopes, emptyStickyPassState,
  overlapsStickyWindow, scopeNotNarrow, stickyLinesPerView, stickyPanelFits, stickyPanelWindow,
  stickyPassNeeded, stickyRevisionStamp, stickyScopeSpan, stickyVisualLines,
} from '../src/stickyLineViewport.ts'
import { createStickyLines, stickyScopes, stickyWindowScopes } from '../src/stickyLines.ts'

const scope = (name, startLine, endLine) => ({ name, startLine, endLine, navigateLine: startLine })

test('最小宽度那一档：默认 5 行，下限夹到 2（VisualStickyLines.kt:18-23 + :162-163）', () => {
  assert.equal(DEFAULT_SCOPE_MIN_LINES, 5)
  assert.equal(MIN_SCOPE_MIN_SIZE, 2)
  assert.equal(stickyScopeSpan(scope('a', 0, 4)), 5, '含首含尾')
  assert.equal(scopeNotNarrow(scope('a', 0, 4)), true)
  assert.equal(scopeNotNarrow(scope('a', 0, 3)), false, '4 行不到 5 行的门槛')
  assert.equal(scopeNotNarrow(scope('a', 0, 1), 1), true, 'minLines 传 1 也被夹到 2（:22 的 require）')
  assert.equal(scopeNotNarrow(scope('a', 0, 0), 1), false, '单行连 2 都不到')
})

test('比较器：起始升序，同起点时宽的在前（StickyLinesModelImpl.java:287-296）', () => {
  assert.ok(compareStickyScopes(scope('a', 0, 10), scope('b', 5, 10)) < 0)
  assert.ok(compareStickyScopes(scope('b', 5, 10), scope('a', 0, 10)) > 0)
  // 同一起点：结束行**降序** ⇒ 外层在前。
  assert.ok(compareStickyScopes(scope('outer', 5, 40), scope('inner', 5, 12)) < 0)
  assert.equal(compareStickyScopes(scope('x', 5, 12), scope('x', 5, 12)), 0)
})

test('候选窗口 = 可视区顶行往下「面板能放的那几行」，判据是相交而不是包含（:66-87 + :83）', () => {
  assert.equal(stickyPanelWindow({ id: 'pane' }, 3), null, '没有顶行度量就没有窗口（退回按光标行那条路径）')
  assert.deepEqual(stickyPanelWindow({ id: 'pane', firstVisibleLine: 10 }, 3), { fromLine: 10, toLine: 13 })
  // 窗口 10..13（1 基）= 0 基 9..12。
  const window = { fromLine: 10, toLine: 13 }
  assert.equal(overlapsStickyWindow(scope('above', 0, 8), window), false, '在窗口上方就结束了 ⇒ 不再候选')
  assert.equal(overlapsStickyWindow(scope('outer', 0, 60), window), true, '罩住整个窗口')
  assert.equal(overlapsStickyWindow(scope('inside', 11, 12), window), true)
  assert.equal(overlapsStickyWindow(scope('below', 14, 20), window), false, '还没进窗口')
})

test('面板放得下吗（:125-127 + :158-159：行数×行高再加两行，超视口一半就不画）', () => {
  assert.equal(stickyPanelFits(3, { id: 'pane' }), true, '没有像素度量时不做这一档')
  // 上游判的是「太大就不画」：`panelHeight + 2*lineHeight > height/2`（`:159`）⇒ 正好等于一半时仍画。
  assert.equal(stickyPanelFits(3, { id: 'pane', lineHeight: 20, viewportHeight: 200 }), true, '60+40 恰是 100，不大于')
  assert.equal(stickyPanelFits(3, { id: 'pane', lineHeight: 20, viewportHeight: 180 }), false, '60+40 > 90')
  assert.equal(stickyPanelFits(2, { id: 'pane', lineHeight: 20, viewportHeight: 200 }), true, '40+40 不超一半')
})

test('整条流水线：零宽/太窄被丢、同主行去重、外层起排、满上限即停', () => {
  const scopes = [
    scope('outer', 0, 60),
    scope('mid', 10, 50),
    scope('tiny', 30, 33),        // 4 行 ⇒ 宽度门槛外
    scope('flat', 20, 20),        // 零宽 ⇒ 不是层
    scope('dup', 10, 44),         // 与 mid 同主行 ⇒ 只留先到的一条
  ]
  const view = { id: 'pane', firstVisibleLine: 44 }
  assert.deepEqual(stickyVisualLines(scopes, view, 5).map(entry => entry.name), ['outer', 'mid'])
  // 上限 1 时留的是**最外**那条（上游从最外开始往面板里排，排满即停 `:144-148`）。
  assert.deepEqual(stickyVisualLines(scopes, view, 1).map(entry => entry.name), ['outer'])
  // 窗口把上方就结束的那层挡在外面：顶行 60 以下时 outer(0..60) 仍与窗口相交，tiny(30..33) 早出局。
  assert.deepEqual(stickyVisualLines(scopes, { id: 'pane', firstVisibleLine: 61 }, 5).map(entry => entry.name), ['outer'])
  // 视口很矮 ⇒ 一条都不画（isPanelTooBig）。
  assert.deepEqual(stickyVisualLines(scopes, { id: 'pane', firstVisibleLine: 44, lineHeight: 20, viewportHeight: 100 }, 3), [])
})

test('多分栏：同一个文档的两个视图各算各的（StickyLinesManager.kt:20-34 + :86-99）', () => {
  const scopes = [scope('outer', 0, 60), scope('mid', 10, 50), scope('deep', 20, 40)]
  const perView = stickyLinesPerView(scopes, [{ id: 'left', firstVisibleLine: 12 }, { id: 'right', firstVisibleLine: 22 }], 3)
  assert.deepEqual(perView.get('left').map(entry => entry.name), ['outer', 'mid'])
  assert.deepEqual(perView.get('right').map(entry => entry.name), ['outer', 'mid', 'deep'])
})

test('采集是否要重跑：新视图第一次必跑，之后按修订号（StickyLinesCollector.kt:36-51）', () => {
  const stamp = stickyRevisionStamp(7, 3)
  assert.equal(stamp, 10, '修订号 = 结构 + 文档两段相加（:77-79）')
  let state = emptyStickyPassState()
  const first = stickyPassNeeded(state, { id: 'left' }, stamp)
  assert.equal(first.needed, true, '第一次必跑')
  state = first.state
  assert.equal(stickyPassNeeded(state, { id: 'left' }, stamp).needed, false, '同一修订号不重跑')
  // 新开一个分栏：哪怕修订号没变也要跑一次（:39「always run pass on editor opening IJPL-158818」）。
  const second = stickyPassNeeded(state, { id: 'right' }, stamp)
  assert.equal(second.needed, true)
  // 文档变过 ⇒ 已知的视图重跑。
  assert.equal(stickyPassNeeded(second.state, { id: 'left', firstVisibleLine: 4 }, 11).needed, true)
  assert.deepEqual(Object.keys(second.state.seen).sort(), ['left', 'right'], '状态按视图记，不回退入参')
})

// 接线那一条判据：`createStickyLines` 拿到面板度量时走视口那一层，拿不到时保持原来的按光标行路径。
test('createStickyLines：有 view 走上游那一层，没有 view 保持退化路径', () => {
  const outline = ref([
    { name: 'Config', kind: 5, startLine: 0, endLine: 60, startChar: 0, endChar: 0 },
    { name: 'load', kind: 6, startLine: 10, endLine: 50, startChar: 0, endChar: 0 },
    { name: 'tiny', kind: 6, startLine: 42, endLine: 45, startChar: 0, endChar: 0 },
  ])
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 2 })
  const caretLine = 45   // 1 基 ⇒ 0 基 44，三层都包含它
  const without = createStickyLines({ editorSettings: settings, outline, currentLine: () => caretLine })
  assert.deepEqual(without.stickyLines.value.map(entry => entry.name), ['load', 'tiny'],
    '没有面板度量 = 维持现状（上限内取最内两层）')
  const withView = createStickyLines({
    editorSettings: settings, outline, currentLine: () => caretLine,
    view: () => ({ id: 'main', firstVisibleLine: 44 }),
  })
  assert.deepEqual(withView.stickyLines.value.map(entry => entry.name), ['Config', 'load'],
    '有面板度量：太窄的 tiny 不算一层，外层在前（`:111` 的 sort + `:145` 的即停）')
  withView.stickyLines.value.forEach((entry, index) => assert.equal(entry.startLine, withView.stickyLines.value[index].startLine))
  assert.deepEqual(withView.stickyLines.value.map(entry => entry.startLine), [0, 10], '外层在前')
})

// 「候选来自可视区，不是光标」那一条的判据（`VisualStickyLines.kt:66-87` 的 `collectLogical` +
// `StickyLinesCollector.kt:104-109`：模型里是**整篇文档**的每一个作用域，逐行问 provider，
// 与光标在哪儿无关）。上一批把这层判据建好了，但候选仍然先按光标行筛过一道 ——
// 那一道会把「压在可视区顶部、但光标不在里面」的兄弟层整族丢掉（同一个类里的另一个方法），
// 而上游会把它钉出来。本批把那一刀去掉。
test('stickyWindowScopes：候选不看光标行，只看起始行是否已滚出顶边', () => {
  const outline = [
    { name: 'Config', kind: 5, startLine: 0, endLine: 100, startChar: 0, endChar: 0 },
    { name: 'gone', kind: 6, startLine: 2, endLine: 8, startChar: 0, endChar: 0 },      // 早已结束
    { name: 'first', kind: 6, startLine: 10, endLine: 20, startChar: 0, endChar: 0 },   // 压在顶边
    { name: 'second', kind: 6, startLine: 30, endLine: 40, startChar: 0, endChar: 0 },  // 光标在这里
  ]
  assert.deepEqual(stickyWindowScopes(outline, 12).map(entry => entry.name), ['Config', 'gone', 'first'],
    '起头在第 11 行之前的都进候选；「在窗口上方就已经结束」那一刀归 stickyVisualLines（下一条用例验）')
  assert.deepEqual(stickyVisualLines(stickyWindowScopes(outline, 12), { id: 'main', firstVisibleLine: 12 }, 5)
    .map(entry => entry.name), ['Config', 'first'],
    '两道刀合起来才是上游那一条：gone 不与窗口 12–17 相交 ⇒ 出局')
  assert.deepEqual(stickyScopes(outline, 35).map(entry => entry.name), ['Config', 'second'],
    '按光标行那条给的是另一组：光标在 second 里面')
  assert.deepEqual(stickyWindowScopes(outline, 12, 'java').map(entry => entry.name), ['Config', 'gone', 'first'],
    'provider 表仍在前面过一道（kind 5/6 都算作用域；换成字段就会被滤掉）')
  assert.deepEqual(stickyWindowScopes(outline, 1), [], '一行都没滚出去 ⇒ 没有候选')
})

test('整条路：gone 那层不再候选（窗口相交那一刀），first 那层不再被光标那一刀误丢', () => {
  const outline = [
    { name: 'Config', kind: 5, startLine: 0, endLine: 100, startChar: 0, endChar: 0 },
    { name: 'gone', kind: 6, startLine: 2, endLine: 8, startChar: 0, endChar: 0 },
    { name: 'first', kind: 6, startLine: 10, endLine: 20, startChar: 0, endChar: 0 },
    { name: 'second', kind: 6, startLine: 30, endLine: 40, startChar: 0, endChar: 0 },
  ]
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 5 })
  const withView = createStickyLines({
    editorSettings: settings, outline: ref(outline), currentLine: () => 35,
    view: () => ({ id: 'main', firstVisibleLine: 12 }),
  })
  assert.deepEqual(withView.stickyLines.value.map(entry => entry.name), ['Config', 'first'],
    '顶边跟着滚动：钉的是压在窗口里的那层，不是光标所在的那层')
  const withoutView = createStickyLines({ editorSettings: settings, outline: ref(outline), currentLine: () => 35 })
  assert.deepEqual(withoutView.stickyLines.value.map(entry => entry.name), ['Config', 'second'],
    '拿不到度量时保持旧的退化路径（按光标行）')
})

// 按语言那一档在宿主侧的出口：设置表还没这个键 ⇒ 不给 = 全部语言都开（与上游默认档一致）。
test('createStickyLines 的按语言开关：给了表才关，不给就全开', () => {
  const outline = ref([
    { name: 'Config', kind: 5, startLine: 0, endLine: 40, startChar: 0, endChar: 0 },
    { name: 'load', kind: 6, startLine: 10, endLine: 20, startChar: 0, endChar: 0 },
  ])
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 5 })
  const open = createStickyLines({ editorSettings: settings, outline, currentLine: () => 15, language: () => 'java' })
  assert.deepEqual(open.stickyLines.value.map(entry => entry.name), ['Config', 'load'])
  const closed = createStickyLines({
    editorSettings: settings, outline, currentLine: () => 15, language: () => 'java',
    stickyLanguages: () => ({ java: false }),
  })
  assert.deepEqual(closed.stickyLines.value, [], '这一语言的层一条都不出')
  const other = createStickyLines({
    editorSettings: settings, outline, currentLine: () => 15, language: () => 'cpp',
    stickyLanguages: () => ({ java: false }),
  })
  assert.ok(other.stickyLines.value.length, '关掉 java 不影响 cpp')
  const off = createStickyLines({
    editorSettings: ref({ showStickyLines: false, stickyLinesLimit: 5 }), outline, currentLine: () => 15,
    language: () => 'java', stickyLanguages: () => ({ java: true }),
  })
  assert.deepEqual(off.stickyLines.value, [], '全局那条关掉时，按语言的 true 救不回来')
})
