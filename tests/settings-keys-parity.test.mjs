// 键一致性门禁：前端 `defaultEditorSettings` 的每一个键都必须同时出现在
//   1. `native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS` 白名单
//   2. `native/settings_schema.cpp` 的 `editor_defaults_impl()` 默认值
//   3. `src/bridge.ts` 的 `settings.update` 编辑器档白名单
//
// 这条门禁是被一个真机缺陷逼出来的：前端认 `showStatusBar`（还有 `rightMargin`、
// `showStickyLines`、`stickyLinesLimit`、`diffContextLines`），native 白名单里却没有。
// 后果有两层，都不是"少存一项"能盖过去的：
//   - `validate_editor_patch` 第一行 `known_keys(patch, EDITOR_SETTING_KEYS)` 直接拒；
//     而前端每次保存发的是**整个** editorSettings（`src/App.vue:676`），所以一次都存不进去。
//   - 即便存进去了，`prune_unknown`（`native/project_settings_state.cpp:41`）也会在读盘时
//     把它剪掉，前端拿回的对象里 `showStatusBar` 是 `undefined` —— falsy，于是
//     `src/App.vue:2316` 的 `v-if` 让**整条状态栏**在真机上不渲染。
// 这类缺陷在纯前端测试里完全看不见（前端单测用的是 `defaultEditorSettings`，值是对的），
// 只有真机截图与真机量测能发现，所以钉在源码一致性上。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')

/** `defaultEditorSettings` 是单行字面量（src/settingsModel.ts:149），按行取最稳。 */
function frontendEditorKeys() {
  const line = read('src/settingsModel.ts').split(/\r?\n/)
    .find(l => l.includes('export const defaultEditorSettings'))
  assert.ok(line, 'src/settingsModel.ts 里找不到 defaultEditorSettings')
  return [...line.matchAll(/(?:^|[{,])\s*([A-Za-z_]\w*)\s*:/g)].map(m => m[1])
}

function nativeAllowlist() {
  const block = read('native/settings_schema.hpp').match(/EDITOR_SETTING_KEYS\[\] = \{([\s\S]*?)\};/)
  assert.ok(block, '找不到 EDITOR_SETTING_KEYS')
  // 注释里出现的字符串（`@Storage("editor.xml")`）不是键，只取整行的引号条目。
  const keys = []
  for (const raw of block[1].split('\n')) {
    const line = raw.replace(/\/\/.*$/, '')
    for (const m of line.matchAll(/"([^"]+)"/g)) keys.push(m[1])
  }
  return new Set(keys)
}

function nativeDefaults() {
  const body = read('native/settings_schema.cpp').match(/Json editor_defaults_impl\(\) \{([\s\S]*?)\n\}/)
  assert.ok(body, '找不到 editor_defaults_impl')
  return new Set([...body[1].matchAll(/\{"([^"]+)"/g)].map(m => m[1]))
}

/** `src/bridge.ts` 的 `case 'settings.update'` 段：只认 `key === '...'` 形式的白名单。 */
function bridgeEditorAllowlist() {
  const src = read('src/bridge.ts')
  const start = src.indexOf("case 'settings.update'")
  assert.ok(start > 0, "找不到 bridge.ts 的 settings.update 分支")
  const accepted = src.slice(start, src.indexOf("case 'settings.general.update'", start) > 0
    ? src.indexOf("case 'settings.general.update'", start) : start + 20000)
  return new Set([...accepted.matchAll(/key === '([A-Za-z_]\w*)'/g)].map(m => m[1]))
}

test('defaultEditorSettings 的每个键都在 native 编辑器键白名单里（漏一个 = 整条 UI 静默消失）', () => {
  const allow = nativeAllowlist()
  const missing = frontendEditorKeys().filter(k => !allow.has(k))
  assert.deepEqual(missing, [],
    `这些键前端认、native 不认：会被 validate_editor_patch 拒、也会被 prune_unknown 剪掉盘上的值。\n` +
    `症状是 undefined 落到 v-if 上，对应界面整条不渲染（showStatusBar 就是这么把状态栏弄没的）。\n${missing.join(', ')}`)
})

test('defaultEditorSettings 的每个键在 native 里都有默认值（否则老 state 迁移后仍是 undefined）', () => {
  const defaults = nativeDefaults()
  const missing = frontendEditorKeys().filter(k => !defaults.has(k))
  assert.deepEqual(missing, [],
    `这些键在 editor_defaults_impl() 里没有默认项 —— project_settings_state.cpp:47-49 的补洞循环` +
    `只按 editor_defaults_impl() 补，所以缺项在老 state 上永远是 undefined：\n${missing.join(', ')}`)
})

test('前端设置保存走的是整本账，所以白名单里的键也必须都被 defaultEditorSettings 认（否则一次都存不进去）', () => {
  // App.vue:676 发的是 `{ ...editorSettings.value, ...patch }` —— 整本账，不是 patch。
  // 于是 native 白名单里任何**前端没有**的键，会让每一次 settings.update 都被 known_keys 拒。
  const front = new Set(frontendEditorKeys())
  const orphans = [...nativeAllowlist()].filter(k => !front.has(k))
  assert.deepEqual(orphans, [],
    `native 认、前端不认的键：前端每次保存发整本账（App.vue:676），这些键会让保存整条失败。\n${orphans.join(', ')}`)
})

test('bridge.ts 的 settings.update 编辑器档白名单与 native 一致（前端这一关也不能漏）', () => {
  const bridge = bridgeEditorAllowlist()
  const allow = nativeAllowlist()
  const missing = frontendEditorKeys().filter(k => !bridge.has(k))
  assert.deepEqual(missing, [], `bridge.ts 的 settings.update 拒收这些键：\n${missing.join(', ')}`)
  const drift = [...bridge].filter(k => !allow.has(k))
  assert.deepEqual(drift, [], `bridge.ts 认、native 不认（bridge 会放行、native 会拒）：\n${drift.join(', ')}`)
})

test('showStatusBar 默认必须为 true（状态栏是默认可见的界面，不是可选装饰）', () => {
  // 上游 UISettingsState.kt:113 `var showStatusBar: Boolean by property(true)`，
  // 消费点是 ProjectFrameHelper.kt:329 `statusBar.isVisible = uiSettings.showStatusBar && ...`。
  // 钉住这条是因为它一旦被改成 false（或又从 native 默认里漏掉），状态栏就整条消失，
  // 而这个症状在真机上只表现为"下面少一条"，很容易被当成设计如此。
  const body = read('native/settings_schema.cpp').match(/Json editor_defaults_impl\(\) \{([\s\S]*?)\n\}/)[1]
  assert.match(body, /\{"showStatusBar", true\}/, 'native 默认必须是 showStatusBar = true')
  const line = read('src/settingsModel.ts').split(/\r?\n/)
    .find(l => l.includes('export const defaultEditorSettings'))
  assert.match(line, /showStatusBar: true/, '前端默认必须是 showStatusBar = true')
})
