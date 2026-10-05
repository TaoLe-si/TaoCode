// 演示助手（`src/presentationAssistant.ts`）：键位呈现（Win/Mac）、开关默认值、状态栏提示的
// 显示与自动收起，以及消费链（分派器与帮助菜单真的接了它）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clearPresentation, macKeystroke, presentationForAction, presentationText, presentShortcut,
  presentationAssistantEnabled, setPresentationAssistantEnabled, togglePresentationAssistant, windowsKeystroke,
} from '../src/presentationAssistant.ts'
import { IDLE_TEXT, statusText } from '../src/statusBarText.ts'

const root = new URL('..', import.meta.url)

test('键位呈现：Win 用 + 连接，Mac 用 MacKeymapUtil 的符号', () => {
  assert.equal(windowsKeystroke('Ctrl Shift F4'), 'Ctrl+Shift+F4')
  assert.equal(windowsKeystroke('Ctrl+Alt+V'), 'Ctrl+Alt+V')
  assert.equal(macKeystroke('Ctrl Shift V'), '⌘⇧V')
  assert.equal(macKeystroke('Ctrl Alt Shift C'), '⌘⌥⇧C')
  assert.equal(macKeystroke('Ctrl F12'), '⌘F12')
})

test('提示模型：动作名与键位来自注册表条目，渲染成一行', () => {
  const presentation = presentationForAction({ id: 'edit.pasteHistory', label: '从历史粘贴…', display: 'Ctrl Shift V' }, 'other')
  assert.deepEqual(presentation, { actionId: 'edit.pasteHistory', title: '从历史粘贴…', shortcut: 'Ctrl+Shift+V' })
  assert.equal(presentationText(presentation), 'Ctrl+Shift+V  从历史粘贴…')
})

test('默认关闭（同上游 PresentationAssistantState），开启后才写状态栏，收起后回到就绪', () => {
  assert.equal(presentationAssistantEnabled(), false)
  assert.equal(presentShortcut({ id: 'x', label: 'X', display: 'Ctrl X' }), null)
  assert.equal(statusText.value, IDLE_TEXT)

  assert.equal(togglePresentationAssistant(), true)
  const presentation = presentShortcut({ id: 'edit.copyPath', label: '复制路径', display: 'Ctrl Shift C' }, { platform: 'other', durationMs: 5 })
  assert.equal(presentation.shortcut, 'Ctrl+Shift+C')
  assert.equal(statusText.value, 'Ctrl+Shift+C  复制路径')

  // 关掉开关会立即收起（上游 `updatePresenter` 的 `presenter?.disable()`）。
  assert.equal(setPresentationAssistantEnabled(false), false)
  assert.equal(statusText.value, IDLE_TEXT)
  assert.equal(presentShortcut({ id: 'x', label: 'X', display: 'Ctrl X' }), null)
})

test('没有键位的动作不显示（上游浮层不会空着键位那一行）', () => {
  setPresentationAssistantEnabled(true)
  assert.equal(presentShortcut({ id: 'x', label: 'X', display: '' }), null)
  clearPresentation()
  setPresentationAssistantEnabled(false)
})

test('消费链：分派器在表驱动分派后调用 presentShortcut，帮助菜单有开关行', () => {
  const keymap = readFileSync(new URL('src/keymap.ts', root), 'utf8')
  assert.match(keymap, /from '\.\/presentationAssistant\.ts'/)
  assert.match(keymap, /presentShortcut\(binding\)/)
  const help = readFileSync(new URL('src/menus/helpMenu.ts', root), 'utf8')
  assert.match(help, /togglePresentationAssistant\(\)/)
  assert.match(help, /presentationAssistantEnabled\(\)/)
})
