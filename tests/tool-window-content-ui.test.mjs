import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'
import { canToggleContentUiType, contentCountLabel, isTabbedContentUi, resolveContentUiType, toggledContentUiType } from '../src/toolWindowContentUi.ts'
import { ref } from 'vue'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'

// ToolWindowContentUiType.getInstance (:33-45) only knows the two names, logs anything else and
// returns TABBED — the same fallback a corrupted localStorage value must land on.
test('an unknown stored content UI type falls back to tabbed', () => {
  assert.equal(resolveContentUiType('combo'), 'combo')
  assert.equal(resolveContentUiType('tabbed'), 'tabbed')
  for (const value of [null, undefined, '', 'COMBO', 'Combo', 42, {}, ['combo']])
    assert.equal(resolveContentUiType(value), 'tabbed', `${JSON.stringify(value)} should fall back to tabbed`)
})

// ToggleContentUiTypeAction.isSelected (:10-12) — the registered action's checked state is TABBED,
// *not* COMBO. The opposite polarity belongs to the per-window copy in the tool window's gear menu
// (ToolWindowImpl.kt:952), which is a different action.
test('checked means the tab strip is showing', () => {
  assert.equal(isTabbedContentUi('tabbed'), true)
  assert.equal(isTabbedContentUi('combo'), false)
})

// setSelected (:14-17): state true -> TABBED, false -> COMBO.
test('the toggle maps the checkbox state onto the two types', () => {
  assert.equal(toggledContentUiType(true), 'tabbed')
  assert.equal(toggledContentUiType(false), 'combo')
  // Round trip: toggling off then on is back where it started.
  assert.equal(toggledContentUiType(isTabbedContentUi('tabbed')), 'tabbed')
  assert.equal(toggledContentUiType(isTabbedContentUi('combo')), 'combo')
})

// update (:19-21) — one content has nothing to switch between, so the row greys out.
test('the toggle is enabled only with more than one content', () => {
  assert.equal(canToggleContentUiType(0), false)
  assert.equal(canToggleContentUiType(1), false)
  assert.equal(canToggleContentUiType(2), true)
  assert.equal(canToggleContentUiType(8), true)
})

// ShowContentAction.update (:41-44) names the list after the UI type.
test('the content list is called tabs or views depending on the type', () => {
  assert.equal(contentCountLabel('tabbed'), '标签页')
  assert.equal(contentCountLabel('combo'), '视图')
})

const app = shellSource()
// output-heading 是**一个元素**，模板重排（拆行）后它不再落在同一行，所以按元素切片取，
// 不能只抓第一行 —— 那会把「组合框在同一条 else 分支上」这条断言变成排版断言。
const headingAt = app.indexOf('class="output-heading"')
assert.ok(headingAt >= 0, '底部工具窗口条没有 output-heading')
const strip = app.slice(headingAt, app.indexOf('</section>', headingAt))

// The row itself, plus the two things that make it real rather than a decoration: the combo form of
// the strip and the persisted type.
test('the content UI toggle is wired to a real combo rendering and is remembered', () => {
  const lines = app.split('\n')
  const row = lines.find(line => line.includes("id: 'window.toggleContentUiType'"))
  assert.ok(row, 'the Window menu has no 合并标签页 row')
  assert.ok(row.includes('checked: () => isTabbedContentUi(contentUiType())'), 'the row does not show the source checked state')
  assert.ok(row.includes('canToggleContentUiType(activeContentCount())'), 'the row does not use the source enable rule')
  assert.ok(row.includes('run: () => toggleContentUiType()'), 'the row does not flip the type')

  assert.ok(strip.includes('v-if="isTabbedContentUi(contentUiType())"'), 'the tab strip is not conditional on the type')
  assert.ok(strip.includes('class="output-content-select"'), 'there is no combo form of the content list')
  // 2026-10-04：combo 的本体搬进了 src/components/ContentComboLabel.vue（图标 + 名称 + 箭头 + 点击弹层）。
  assert.ok(/<ContentComboLabel[^>]*v-else class="output-content-select"[^>]*:options="bottomTabOptions"/.test(strip),
    'the combo is not the else branch of the strip / does not list the contents')
  const combo = readFileSync(new URL('../src/components/ContentComboLabel.vue', import.meta.url), 'utf8')
  // 2026-10-06（桶 8c 收口）：这一条原判 `v-for="(option, index) in rows"`，是速度搜索落地时
  // **按实现写的**，把 `tests/content-combo-label.test.mjs` 那条「逐条列每一条 content」钉红了。
  // 按上游改正：`ListPopupModel` 留着原表、只把没命中的行标成不可见
  // （`platform/platform-impl/src/com/intellij/ui/popup/list/ListPopupModel.java:44-48` 的
  // `getOriginalIndex` / `:152-154` 的 `isVisible`），列表数据源始终是
  // `ToolWindowContentUi.java:863` 传进去的**全量 contents**。所以渲染源改回 `options`，
  // `rows` 退回它上游的位置 —— 一张「可见行的原索引」表，由 `props.options` 投影出来。
  assert.match(combo, /v-for="\(option, index\) in options"/, 'combo 画的那一排不是内容列表')
  assert.match(combo, /v-show="rows\.includes\(index\)"/, '速度搜索没把没命中的行收起（上游是过滤视图，不是换数据源）')
  // 2026-10-06（桶 8 注册/门面这一批）：过滤那一步搬进了 `src/popupSteps.ts` 的 `listStepRows`
  // （桶 7b 的接线请求 A1：那份行模型此前**零生产消费方**，而这一层列表的上游对象就是
  // `SelectContentStep` —— `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/SelectContentStep.kt:17`
  // 给这一层开了速度搜索，`ToolWindowContentUi.java:862-875` 把**全量 contents** 交给这一步）。
  // 判据**没有放松**，只是改指真源：数据源仍是全量 `props.options`（`step.values()`），
  // `rows` 仍是「可见行的原索引」投影（`idOf` 给的就是原索引），而匹配规则只剩 `popupSteps` 里那一份。
  assert.match(combo, /values: \(\) => props\.options/, 'combo 的数据源不是全量 contents')
  assert.match(combo, /const stepRows = computed\(\(\) => listStepRows\(step, \{ query: filter\.value, idOf \}\)\)/,
    'rows 不是这一步的行模型投影（过滤串为空时必须是全量）')
  assert.match(combo, /const rows = computed\(\(\) => stepRows\.value\.flatMap\(row => row\.kind === 'item' \? \[Number\(row\.id\)\] : \[\]\)\)/,
    '可见行表不再是原索引投影')
  assert.ok(!combo.includes('speedSearchMatches'), 'combo 里又写了第二份速度搜索匹配（规则只准住在 popupSteps）')
  assert.match(readFileSync(new URL('../src/popupSteps.ts', import.meta.url), 'utf8'),
    /export function shouldBeShowing[\s\S]{0,400}speedSearchMatches\(query, text\)/,
    'popupSteps 里那条过滤规则不在了（上面那句"只住一处"就落空了）')
  assert.ok(combo.includes('contentCountLabel'), 'the combo does not use the tabs/views naming')
  // 形态改成**每个内容一份**、跟着项目布局走（上游 `WindowInfo.contentUiType`）：见第四十二批 §AT。
  const stripes = readFileSync(new URL('../src/toolWindowStripes.ts', import.meta.url), 'utf8')
  assert.ok(stripes.includes('function contentUiType(id: string)'), '内容形态不是每内容一份的读')
  assert.ok(stripes.includes('function setContentUiType(id: string, type'), '内容形态没有写回项目布局')
  assert.ok(stripes.includes("localStorage.getItem(LEGACY_CONTENT_UI_STORAGE_KEY)"), '旧全局键没有一次性采纳')
  // `getActiveToolWindowId()` — a single-view side window cannot use the toggle.
  assert.ok(/function activeContentCount\(\)[\s\S]{0,200}activeToolWindowDock\(\)/.test(app), 'the active tool window is not resolved from the focus owner')
})

// --- 内容形态是**每个内容一份**的（上游 `WindowInfo.contentUiType`，第四十二批）------------------

function withStorage() {
  const values = new Map()
  const previous = globalThis.localStorage
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
  return { values, restore: () => { globalThis.localStorage = previous } }
}
const stripes = workspace => createToolWindowStripes({
  isDesktop: true, workspace, lspReady: { value: true }, gradleAvailable: { value: true },
  explorer: { value: false }, activeView: { value: 'files' },
})

test('每个内容各记一份形态，默认都是 TABBED（WindowInfoImpl.contentUiType 的默认）', () => {
  const storage = withStorage()
  try {
    const h = stripes({ value: { root: 'A' } })
    for (const id of ['output', 'run', 'problems', 'references', 'vcslog', 'todo']) assert.equal(h.contentUiType(id), 'tabbed', id)
    h.setContentUiType('output', 'combo')
    assert.equal(h.contentUiType('output'), 'combo')
    assert.equal(h.contentUiType('run'), 'tabbed', '只翻当前那一个，别的内容不动')
    const saved = JSON.parse(storage.values.get('taocode.toolLayout:A'))
    assert.equal(saved.windows.output?.contentUiType, 'combo', '形态跟着项目布局走（不是另一个全局键）')
    assert.equal(saved.windows.run?.contentUiType, undefined, '没动过的内容不写死值')
  } finally { storage.restore() }
})

test('形态跨重启保留，且按项目分开', () => {
  const storage = withStorage()
  try {
    const workspace = ref({ root: 'A' })
    stripes(workspace).setContentUiType('vcslog', 'combo')
    assert.equal(stripes(workspace).contentUiType('vcslog'), 'combo', '重开还是那个形态')
    const other = stripes({ value: { root: 'B' } })
    assert.equal(other.contentUiType('vcslog'), 'tabbed', '另一个项目不受影响')
    // 坏值当默认（`resolveContentUiType` 只认两个名字）。
    storage.values.set('taocode.toolLayout:A', JSON.stringify({ windows: { vcslog: { contentUiType: 'COMBO' } } }))
    assert.equal(stripes(workspace).contentUiType('vcslog'), 'tabbed')
  } finally { storage.restore() }
})

test('改版前的全局键只做一次性采纳，用户点过的那个才有显式值', () => {
  const storage = withStorage()
  try {
    storage.values.set('taocode.toolWindowContentUi', 'combo')   // 改版前的全局设置
    const h = stripes({ value: { root: 'A' } })
    assert.equal(h.contentUiType('output'), 'combo', '没写过记录的内容按旧键走（现状不变）')
    assert.equal(h.contentUiType('terminal'), 'combo')
    h.setContentUiType('terminal', 'tabbed')
    assert.equal(h.contentUiType('terminal'), 'tabbed', '点过之后这一个有了显式值')
    assert.equal(h.contentUiType('output'), 'combo', '别的仍按旧键')
  } finally { storage.restore() }
})

// A Swing menu does not take focus, a DOM menu button does: without the top-bar fallback every row
// that needs the active tool window would grey out the instant its own menu opened.
test('the active tool window survives the focus moving into the top bar', () => {
  const lines = app.split('\n')
  const dock = lines.findIndex(line => line.includes('function activeToolWindowDock()'))
  assert.ok(dock >= 0, 'activeToolWindowDock moved')
  const body = lines.slice(dock, dock + 8).join('\n')
  assert.ok(body.includes("closest('.topbar')"), 'the top-bar fallback is gone')
  assert.ok(body.includes('lastDockFocus.value'), 'the remembered dock is not used')
  // The remembered dock is recorded from real focus events, on the shell so it sees every dock.
  assert.ok(app.includes('function noteDockFocus(event: FocusEvent)'), 'the focus recorder is missing')
  assert.ok(/@focusin="noteDockFocus"/.test(app), 'the shell does not record where the focus was')
  // ...and it must be recorded for the editor too, or "menu opened from the editor" would look
  // like "menu opened from the last tool window".
  const note = lines.slice(lines.findIndex(line => line.includes('function noteDockFocus')), lines.findIndex(line => line.includes('function noteDockFocus')) + 3).join('\n')
  assert.ok(note.includes('dockOf(event.target as Element | null)'), 'the recorder does not map the focus target to a dock')
})

// The combo has to name the contents the strip names, or the two presentations disagree. The labels
// live in `bottomTabLabel`, so each one is checked against the strip markup as well.
test('the combo and the tab strip use the same labels', () => {
  // 『工作区说明』那个 about 标签已删 —— IDEA 的「关于」是「帮助 › 关于」的对话框，不是底部面板的标签。
  // 『追溯』也已删（2026-09-27）—— IDEA 的 Annotate 是**编辑器装订线注解**
  // （`AnnotateToggleAction.java:139-153`），不是底部面板的内容标签。
  for (const label of ['操作输出', '运行', '问题', '终端']) {
    assert.ok(app.includes(`return '${label}'`), `bottomTabLabel does not produce ${label}`)
    assert.ok(strip.includes(label), `the tab strip no longer shows ${label}`)
  }
  // 引用不再是一个固定标签：那一格挂的是**每条 content 自己的**标签（IDEA 的 Find 窗口就是这样）。
  assert.ok(app.includes("?? '引用'"), '没有选中内容时的兜底名字没了')
  assert.ok(app.includes("id === 'references' ? referenceComboOptions.value"),
    'combo 不再把引用列成一条内容')
  assert.ok(strip.includes("tab.searching ? '正在查找…' : tab.label"), '标签条不再显示每条 content 自己的名字')
  assert.ok(strip.includes('v-for="tab in referenceTabs"'), '标签条不再逐条列出引用的 content')
  assert.equal(app.includes("return '追溯'"), false, 'the bottom strip has an Annotate tab again')
  // The hierarchy tab's label is its own dynamic title, in both places.
  assert.ok(strip.includes('{{ hierTitle }}'), 'the hierarchy tab button lost its title')
  assert.ok(app.includes("if (tab === 'hierarchy') return ctx.hierTitle.value"), 'the combo does not use the hierarchy title')
  // Every option the combo offers is a tab the strip would show, and vice versa.
  assert.ok(app.includes('BOTTOM_TABS.filter(bottomTabAvailable).flatMap(id =>'),
    'the combo list is not the available contents of the strip')
})
