import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'
import { canToggleContentUiType, contentCountLabel, isTabbedContentUi, resolveContentUiType, toggledContentUiType } from '../src/toolWindowContentUi.ts'

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
  assert.ok(row.includes('checked: () => isTabbedContentUi(bottomContentUiType.value)'), 'the row does not show the source checked state')
  assert.ok(row.includes('canToggleContentUiType(activeContentCount())'), 'the row does not use the source enable rule')
  assert.ok(row.includes('toggledContentUiType('), 'the row does not flip the type')

  assert.ok(strip.includes('v-if="isTabbedContentUi(bottomContentUiType)"'), 'the tab strip is not conditional on the type')
  assert.ok(strip.includes('class="output-content-select"'), 'there is no combo form of the content list')
  assert.ok(/<select[^>]*v-else class="output-content-select"/.test(strip), 'the combo is not the else branch of the strip')
  assert.ok(strip.includes('v-for="option in bottomTabOptions"'), 'the combo does not list the tool window contents')
  assert.ok(app.includes("localStorage.setItem('taocode.toolWindowContentUi'"), 'the chosen type is not remembered')
  assert.ok(app.includes('resolveContentUiType(localStorage.getItem('), 'the stored value is not validated on load')
  // `getActiveToolWindowId()` — a single-view side window cannot use the toggle.
  assert.ok(/function activeContentCount\(\)[\s\S]{0,200}activeToolWindowDock\(\)/.test(app), 'the active tool window is not resolved from the focus owner')
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
