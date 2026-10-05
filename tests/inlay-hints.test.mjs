// `src/inlayHints.ts`：内联提示的显示文本、按类型开关、点击命令三条纯规则。
//
// 现状要如实（模块头里写着）：渲染在 `CodeEditor.vue` 的只读 InlayWidget 里，
// 开关与点击**还没接线**（那一处文件贴着机检上限、本批冻结）；宿主也还没转发 tooltip/command。
// 这份判据锁住的是"接线时照抄的规则"，不是"已经接上了"。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_INLAY_HINT_TOGGLES, INLAY_HINT_SETTING_KEYS, inlayHintCommand, inlayHintDisplayText,
  inlayHintGroup, inlayHintTooltip, shouldShowInlayHint,
} from '../src/inlayHints.ts'

const hint = overrides => ({ line: 3, character: 8, label: 'String', ...overrides })

test('kind 分组：1 = 类型、2 = 参数、缺省/其它 = other', () => {
  assert.equal(inlayHintGroup(1), 'type')
  assert.equal(inlayHintGroup(2), 'parameter')
  assert.equal(inlayHintGroup(undefined), 'other')
  assert.equal(inlayHintGroup(99), 'other')
  // 三个设置键齐全且互不相同（接线时照这三个键登记设置页）。
  assert.deepEqual(Object.keys(INLAY_HINT_SETTING_KEYS).sort(), ['other', 'parameter', 'type'])
  assert.equal(new Set(Object.values(INLAY_HINT_SETTING_KEYS)).size, 3)
})

test('按类型开关：关掉哪一组就藏哪一组，别的组不受影响', () => {
  assert.equal(shouldShowInlayHint(hint({ kind: 1 })), true, '默认全开')
  assert.equal(DEFAULT_INLAY_HINT_TOGGLES.type && DEFAULT_INLAY_HINT_TOGGLES.parameter, true)
  const noTypes = { ...DEFAULT_INLAY_HINT_TOGGLES, type: false }
  assert.equal(shouldShowInlayHint(hint({ kind: 1 }), noTypes), false)
  assert.equal(shouldShowInlayHint(hint({ kind: 2 }), noTypes), true, '参数提示不跟着类型走')
  const noParams = { ...DEFAULT_INLAY_HINT_TOGGLES, parameter: false }
  assert.equal(shouldShowInlayHint(hint({ kind: 2 }), noParams), false)
  assert.equal(shouldShowInlayHint(hint({ kind: 1 }), noParams), true)
  // 空 label 不是可显示条目；空输入不抛。
  assert.equal(shouldShowInlayHint(hint({ label: '' })), false)
  assert.equal(shouldShowInlayHint(undefined), false)
  assert.equal(shouldShowInlayHint(null), false)
})

test('显示文本 = label + 规范里的左右 padding（与编辑器 InlayWidget 同形）', () => {
  assert.equal(inlayHintDisplayText(hint({})), 'String')
  assert.equal(inlayHintDisplayText(hint({ paddingLeft: true })), ' String')
  assert.equal(inlayHintDisplayText(hint({ paddingRight: true })), 'String ')
  assert.equal(inlayHintDisplayText(hint({ paddingLeft: true, paddingRight: true })), ' String ')
  assert.equal(inlayHintDisplayText(undefined), '')
})

test('点击命令：有就发，缺 arguments 不带这个键，没有命令就不可点', () => {
  assert.deepEqual(inlayHintCommand(hint({ command: { command: 'editor.action.showType' } })),
    { command: 'editor.action.showType' })
  assert.deepEqual(inlayHintCommand(hint({ command: { command: 'go', arguments: [{ line: 1 }] } })),
    { command: 'go', arguments: [{ line: 1 }] })
  assert.deepEqual(inlayHintCommand(hint({ command: { command: 'go', arguments: [] } })),
    { command: 'go', arguments: [] }, '空数组是"显式零参数"，与没传不同')
  assert.equal(inlayHintCommand(hint({})), null, '没有 command = 不可点')
  assert.equal(inlayHintCommand(hint({ command: { command: '' } })), null)
  assert.equal(inlayHintCommand(undefined), null)
})

test('悬停说明：优先 tooltip，没有就给按组的默认文案', () => {
  assert.equal(inlayHintTooltip(hint({ tooltip: 'java.lang.String' })), 'java.lang.String')
  assert.equal(inlayHintTooltip(hint({ kind: 1 })), '推断的类型')
  assert.equal(inlayHintTooltip(hint({ kind: 2 })), '参数名')
  assert.equal(inlayHintTooltip(hint({})), '内联提示')
  assert.equal(inlayHintTooltip(undefined), '')
})
