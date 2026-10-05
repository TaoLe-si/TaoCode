// 「编辑器 › 内联提示」（`inlay.hints`）的行为回归。
//
// 上游依据：
//   · 注册行 `intellij.platform.lang.impl.xml:935-941`（`parentId="editor" id="inlay.hints" groupWeight="1"`）；
//   · 页面类 `InlaySettingsConfigurable.kt:15,51`（`INLAY_ID = "inlay.hints"` / `getId()`）；
//   · 面板是按 provider 的清单树，逐节点的开关是 `InlayProviderSettingsModel.isEnabled`
//     （`platform/lang-api/.../settings/InlayProviderSettingsModel.kt:26`）。
//
// 本仓只有一个 provider（LSP `textDocument/inlayHint`），所以那棵树塌成 LSP `kind` 的三档。
// 这条测试钉住三件事：三格开关是真设置（四处登记）、真的在拉取时被过滤、以及
// **不放假控件**（上游那些按语言分组 / 逐 case 明细 / 排除清单的入口不渲染）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INLAY_HINT_SETTING_KEYS, inlayHintToggles, inlayHintTogglesKey, shouldShowInlayHint } from '../src/inlayHints.ts'
import { defaultEditorSettings } from '../src/settingsModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('三把键与 LSP kind 的分组一一对应（kind 1 = Type，2 = Parameter，其余第三档）', () => {
  assert.deepEqual(INLAY_HINT_SETTING_KEYS, {
    type: 'showTypeInlayHints', parameter: 'showParameterInlayHints', other: 'showOtherInlayHints',
  })
  // 折叠规则：只有关掉的那一档被过滤掉，其余两档照旧。
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: ': int', kind: 1 }, { type: false, parameter: true, other: true }), false)
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: 'x', kind: 2 }, { type: false, parameter: true, other: true }), true)
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: 'x' }, { type: true, parameter: true, other: false }), false)
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: 'x' }, { type: true, parameter: true, other: true }), true)
  // 空 label 一律不画（与上游 isEnabled 无关，是渲染前提）
  assert.equal(shouldShowInlayHint({ line: 1, character: 0, label: '' }, { type: true, parameter: true, other: true }), false)
})

test('设置值 → 三档的折算：缺项/坏值都当全开（老 state 上不该整族不显示）', () => {
  assert.deepEqual(inlayHintToggles(defaultEditorSettings), { type: true, parameter: true, other: true })
  assert.deepEqual(inlayHintToggles(undefined), { type: true, parameter: true, other: true }, '老 state 没这三键 ⇒ 全开')
  assert.deepEqual(inlayHintToggles({ showParameterInlayHints: false }), { type: true, parameter: false, other: true })
  // watch 的比较键：三档拼成一行（数组当依赖会每拍都触发）。
  assert.equal(inlayHintTogglesKey(inlayHintToggles({})), 'true,true,true')
  assert.notEqual(inlayHintTogglesKey(inlayHintToggles({ showTypeInlayHints: false })), inlayHintTogglesKey(inlayHintToggles({})))
})

test('三格是真设置：模型 + native 键表/默认值 + 预览白名单都登记', () => {
  const model = read('src/settingsModel.ts')
  assert.match(model, /showTypeInlayHints: boolean; showParameterInlayHints: boolean; showOtherInlayHints: boolean/)
  assert.match(model, /showTypeInlayHints: true, showParameterInlayHints: true, showOtherInlayHints: true \}/,
    '默认必须全开（同上游 isEnabled 出厂为真）')
  const hpp = read('native/settings_schema.hpp')
  assert.match(hpp, /"showTypeInlayHints", "showParameterInlayHints", "showOtherInlayHints",/,
    'native 键表白名单漏了 ⇒ known_keys 拒掉整次 settings.update')
  const cpp = read('native/settings_schema.cpp')
  assert.match(cpp, /\{"showTypeInlayHints", true\}, \{"showParameterInlayHints", true\}, \{"showOtherInlayHints", true\},/)
  const preview = read('src/previewSettings.ts')
  assert.match(preview, /key === 'showTypeInlayHints' \|\| key === 'showParameterInlayHints' \|\| key === 'showOtherInlayHints'/)
})

test('消费链路：编辑器把三档交给提示控制器，按开关过滤后再画', () => {
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /createInlayHints\(\{[^}]*toggles: \(\) => inlayHintToggles\(props\.settings\)/, '编辑器没有把三档交给控制器')
  // 过滤发生在拉取那一拍（editorInlayHints.ts），不在渲染层。归位/过滤由 layoutInlayHints 一次做完
  // （开关 → 排序 → 同位置去重/优先级，见 src/inlayHintLayout.ts）。
  const host = read('src/editorInlayHints.ts')
  assert.match(host, /const toggles = deps\.toggles\?\.\(\) \?\? DEFAULT_INLAY_HINT_TOGGLES/, '每次拉取都要重取开关')
  assert.match(host, /layoutInlayHints\(result\.hints, toggles,/)
  // 改设置要能重画：关掉一档得把已经画出来的收走。
  assert.match(editor, /watch\(\(\) => inlayHintTogglesKey\(inlayHintToggles\(props\.settings\)\), \(\) => inlayHints\.schedule\(\)\)/)
})

test('页面：三个复选框挂在编辑器下，且不渲染上游那些本仓没有对应物的入口', () => {
  const page = read('src/components/InlayHintsSettingsPage.vue')
  assert.match(page, /:checked="settings\[INLAY_HINT_SETTING_KEYS\[group\.id\]\]"/, '复选框要绑到 INLAY_HINT_SETTING_KEYS 的那一格')
  assert.match(page, /function toggle\(key: InlayHintSettingKey, checked: boolean\)/)
  assert.match(page, /v-for="group in GROUPS"/)
  // 上游有、本仓没有：不渲染（按语言分组的清单节点 / 逐 case 明细 / 排除清单入口）。
  for (const label of ['排除', 'Exclude', '排除清单'])
    assert.ok(!new RegExp(`<span>\\s*${label}`).test(page), `${label} 不该被渲染成控件`)
  const tree = read('src/settingsTreeMeta.ts')
  assert.match(tree, /\{ key: 'inlay\.hints', label: '内联提示'[^}]*parent: 'editor'/, '上游是 parentId="editor"，要挂在编辑器下')
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<InlayHintsSettingsPage :settings="editor" :busy="busy" \/>/)
  assert.match(dialog, /data-page="inlay\.hints"/)
})
