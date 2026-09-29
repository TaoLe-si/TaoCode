// 编辑器双向文本方向（IDEA `EditorBidiTextDirection` 子菜单）的规则与接线单测。
//
// 源码依据（路径见 src/bidiTextDirection.ts 头部）：
//   · `BidiTextDirection.java:21-23` 只有 `CONTENT_BASED, LTR, RTL` 三个值
//   · `EditorSettingsExternalizable.java:137` 默认 `CONTENT_BASED`
//   · `SetEditorBidiTextDirectionAction.java:20-32` 三选一 ToggleAction（`isSelected` 比较设置值）
//   · `PlatformActions.xml:591-595` 子菜单位于 ViewMenu 末尾
// 这个模块是纯的，所以能直接 import；菜单/CSS/设置的接线用源码断言（与 tests/*-source 系列同一路数）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'
import {
  BIDI_DIRECTIONS, BIDI_DIRECTION_DEFAULT, bidiContentStyle, bidiDataAttribute, bidiDirectionActionId,
  bidiDirectionLabel, isBidiDirection,
} from '../src/bidiTextDirection.ts'
import { defaultEditorSettings } from '../src/bridge.ts'

test('三个取值与 IDEA 的 BidiTextDirection 一一对应，默认内容自适应', () => {
  assert.deepEqual([...BIDI_DIRECTIONS], ['contentBased', 'ltr', 'rtl'])
  assert.equal(BIDI_DIRECTION_DEFAULT, 'contentBased')
  assert.equal(defaultEditorSettings.bidiTextDirection, BIDI_DIRECTION_DEFAULT)
  for (const direction of BIDI_DIRECTIONS) assert.ok(isBidiDirection(direction))
  assert.equal(isBidiDirection('auto'), false)
  assert.equal(isBidiDirection(0), false)
})

test('菜单 id 与文案：id 直接沿用 IDEA 的动作 id，文案三项互不相同', () => {
  assert.equal(bidiDirectionActionId('contentBased'), 'EditorSetContentBasedBidiTextDirection')
  assert.equal(bidiDirectionActionId('ltr'), 'EditorSetLtrBidiTextDirection')
  assert.equal(bidiDirectionActionId('rtl'), 'EditorSetRtlBidiTextDirection')
  const labels = BIDI_DIRECTIONS.map(bidiDirectionLabel)
  assert.equal(new Set(labels).size, 3)
  assert.equal(bidiDataAttribute('rtl'), 'rtl')
})

test('三档到 CSS 的映射：RTL/LTR 强制方向，内容自适应用 plaintext（段落级）', () => {
  // 强制档用 isolate，避免相邻的相反方向文本互相影响
  assert.deepEqual(bidiContentStyle('rtl'), { direction: 'rtl', unicodeBidi: 'isolate' })
  assert.deepEqual(bidiContentStyle('ltr'), { direction: 'ltr', unicodeBidi: 'isolate' })
  // 内容自适应用 plaintext：每个换行分隔的段落各自按首个强方向字符定方向
  assert.deepEqual(bidiContentStyle('contentBased'), { direction: 'ltr', unicodeBidi: 'plaintext' })
})

test('宿主与样式表都真的接了这三档（不是只有设置字段）', () => {
  const css = readFileSync('src/style.css', 'utf8')
  for (const direction of BIDI_DIRECTIONS)
    assert.ok(css.includes(`[data-bidi="${direction}"] .cm-content`), `样式表缺少 ${direction} 档的选择器`)
  // 内容自适应的关键是 plaintext（段落级判定），不是 auto（元素级）
  assert.ok(/\[data-bidi="contentBased"\] \.cm-content \{[^}]*unicode-bidi: plaintext/.test(css),
    'contentBased 档没有用 unicode-bidi: plaintext')
  // 编辑器宿主要把设置值挂到 DOM 上，否则样式选不中
  assert.ok(readFileSync('src/App.vue', 'utf8').includes(':data-bidi="editorSettings.bidiTextDirection"'),
    '编辑器 stage 没有绑定方向属性')
})

test('视图菜单里是「文本方向」子菜单，三项指向 IDEA 的三个动作 id', () => {
  const source = shellSource()
  assert.ok(source.includes("id: 'view.bidiTextDirection'"), '视图菜单没有「文本方向」子菜单')
  // 三项是 map 出来的（id/文案都由纯函数生成，所以这里断言"用了这两个函数"，
  // 三个具体 id 的正确性由上面的纯函数用例覆盖 —— 比抄一份字面量更能发现漂移）。
  assert.ok(source.includes('children: BIDI_DIRECTIONS.map(direction => ({'), '子菜单不是按三档展开的')
  assert.ok(source.includes('id: bidiDirectionActionId(direction)'), '子菜单的 id 没有沿用 IDEA 的动作 id')
  assert.ok(source.includes('title: bidiDirectionLabel(direction)'), '子菜单的文案没有走统一定义')
  assert.ok(source.includes('checked: () => ctx.editorSettings.value.bidiTextDirection === direction'),
    '子菜单没有按设置值显示勾选（ToggleAction 的三选一语义）')
  assert.ok(source.includes('bidiTextDirection: direction'), '子菜单没有把选择写回设置')
})

test('设置键进了前端白名单与原生 schema（否则存不下来）', () => {
  const bridge = readFileSync('src/bridge.ts', 'utf8')
  assert.ok(bridge.includes("key === 'bidiTextDirection'"), '前端设置白名单里没有这个键')
  const schema = readFileSync('native/settings_schema.cpp', 'utf8')
  assert.ok(schema.includes('"bidiTextDirection", "contentBased"'), '原生默认值里没有这个键')
  assert.ok(schema.includes('bidiTextDirection must be contentBased, ltr or rtl'), '原生没有取值校验')
  assert.ok(readFileSync('native/settings_schema.hpp', 'utf8').includes('"bidiTextDirection"'), '原生键白名单里没有它')
})
