// 2026-10-06 这一批**新增设置键**的四处落位 + 旧存档可读门禁（形状照
// `tests/navbar-members-setting.test.mjs`，逐键跑一遍）。
//
// 为什么每批新键都要这么一条：一把设置键必须同时活在四个地方 ——
//   ① `src/settingsModel.ts` 的类型声明，
//   ② `src/settingsModel.ts` 的 `defaultEditorSettings` 默认值，
//   ③ `native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS` 白名单，
//   ④ `native/settings_schema.cpp` 的 `editor_defaults_impl()` 默认值表
//      （外加预览态的 `src/previewSettings.ts` 白名单 —— 同一条规则的第二道关卡），
//   ⑤ 非布尔键还要在 `native/settings_editor_keys.hpp` 有校验分支，否则存进去的新存档
//      下次读盘会被"Editor flags must be JSON booleans"那条兜底判成 INVALID_SETTINGS。
// 少任何一处出现的都是**静默**故障：类型检查全绿，界面能勾，值存不下去，或者更狠 ——
// `prune_unknown` 把它从盘上剪掉，前端拿回 `undefined`，落到 `v-if` 上整条界面消失
// （`showStatusBar` 就是这么把状态栏弄没的，见 `tests/settings-keys-parity.test.mjs` 文件头）。
//
// 更要紧的是**旧存档**：新增键绝不能把老 `projects.json` 判成损坏（真出过把用户锁在
// 项目外的事故）。读盘那一条链是 `native/project_settings_state.cpp:39-49`：
// `prune_unknown` 剪未知键（不判坏）→ `validate_editor_patch` 只校验剩下的键 →
// 按 `editor_defaults_impl()` **逐键补默认**。这条门把那条循环钉在源码上，并逐键验证
// 「整本账里删掉这一键」后仍然读得出默认值。
//
// 默认值的出处一律指向上游真源码（逐条见 `docs/batch-2026-10-06-setkeys.md` 的判词表）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/**
 * 这一批的十把键。`frontDefault` / `nativeDefault` 是**源码里那一行**的写法（字符串按 TS 的引号、
 * 数组与数字按字面量），`upstream` 是默认值的出处，`value` 是补默认判据要比的运行时值。
 */
const KEYS = [
  { key: 'stripTrailingSpaces', frontDefault: "'Changed'", nativeDefault: '"Changed"', value: 'Changed',
    upstream: 'EditorSettingsExternalizable.java:73 + :216-218' },
  { key: 'ensureNewLineAtEof', frontDefault: 'false', nativeDefault: 'false', value: false,
    upstream: 'EditorSettingsExternalizable.java:74' },
  { key: 'keepTrailingSpacesOnCaretLine', frontDefault: 'true', nativeDefault: 'true', value: true,
    upstream: 'EditorSettingsExternalizable.java:142' },
  { key: 'autoInsertPairQuote', frontDefault: 'true', nativeDefault: 'true', value: true,
    upstream: 'CodeInsightSettings.java:140' },
  { key: 'closeCommentOnEnter', frontDefault: 'true', nativeDefault: 'true', value: true,
    upstream: 'CodeInsightSettings.java:132' },
  { key: 'insertBraceOnEnter', frontDefault: 'true', nativeDefault: 'true', value: true,
    upstream: 'CodeInsightSettings.java:130' },
  { key: 'codeVisionEnabled', frontDefault: 'true', nativeDefault: 'true', value: true,
    upstream: 'CodeVisionSettings.kt:36/55-60' },
  { key: 'codeVisionDisabledGroups', frontDefault: '[]', nativeDefault: 'Json::array()', value: [],
    upstream: 'CodeVisionSettings.kt:45' },
  { key: 'codeVisionEnabledGroups', frontDefault: '[]', nativeDefault: 'Json::array()', value: [],
    upstream: 'CodeVisionSettings.kt:50' },
  { key: 'codeVisionVisibleEntries', frontDefault: '5', nativeDefault: '5', value: 5,
    upstream: 'CodeVisionSettings.kt:38-39（出厂 5，界 1..10 = CodeVisionGlobalSettingsProvider.kt:43）' },
  { key: 'showQuickDocOnMouseHover', frontDefault: 'true', nativeDefault: 'true', value: true,
    upstream: 'EditorSettingsExternalizable.java:76' },
  { key: 'autoUpdateDocumentation', frontDefault: 'true', nativeDefault: 'true', value: true,
    upstream: 'DocumentationToolWindowManager.kt:55（documentation.auto.update）' },
]
const NAMES = KEYS.map(entry => entry.key)

const model = read('src/settingsModel.ts')
const defaultsLine = model.split(/\r?\n/).find(line => line.includes('export const defaultEditorSettings'))
const schemaCpp = read('native/settings_schema.cpp')
const schemaHpp = read('native/settings_schema.hpp')
const preview = read('src/previewSettings.ts')
const extraValidator = read('native/settings_editor_keys.hpp')

for (const entry of KEYS) {
  test(`${entry.key}：类型、默认值、原生两处、预览白名单都登记了（出处 ${entry.upstream}）`, () => {
    // ① 类型声明（interface EditorSettings 里的这一行）。
    assert.match(model, new RegExp(`\\b${entry.key}: `), 'settingsModel.ts 的类型里没有这一键')
    // ② 前端默认值（defaultEditorSettings 那一行）。
    assert.match(defaultsLine, new RegExp(`${entry.key}: ${entry.frontDefault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `前端默认值不是 ${entry.frontDefault}`)
    // ③ 原生白名单（补丁校验与读盘剪枝共用那一份）。
    assert.match(schemaHpp, new RegExp(`"${entry.key}"`), 'settings_schema.hpp 的 EDITOR_SETTING_KEYS 没登记')
    // ④ 原生默认值表（旧存档补默认就靠它）。
    assert.match(schemaCpp, new RegExp(`\\{"${entry.key}", ${entry.nativeDefault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`),
      'settings_schema.cpp 的 editor_defaults_impl 没登记默认值')
    // ⑤ 预览态白名单。
    assert.match(preview, new RegExp(`key === '${entry.key}'`), 'previewSettings.ts 没放行这一键')
  })
}

test('非布尔的三把键在原生校验里有分支（否则新存档下次读盘就被判坏）', () => {
  // `validate_editor_patch` 末尾的兜底是 `else if (!value.is_boolean()) fail(...)`：
  // 一把字符串枚举 / 整数 / 数组键若不在 `validate_editor_added_key` 里命中，
  // **存进去能读回来、但下一次读盘直接 INVALID_SETTINGS** —— 这正是"锁在项目外"那一类。
  assert.match(extraValidator, /if \(key == "stripTrailingSpaces"\)/, 'stripTrailingSpaces 没有校验分支')
  assert.match(extraValidator, /if \(key == "codeVisionVisibleEntries"\)/, 'codeVisionVisibleEntries 没有校验分支')
  assert.match(extraValidator, /key == "codeVisionDisabledGroups" \|\| key == "codeVisionEnabledGroups"/,
    'Code Vision 的两个组集合没有校验分支')
  // 而且这个分支必须在兜底**之前**被调用（写在后面的 else-if 链是死代码）。
  const cpp = schemaCpp
  const call = cpp.indexOf('validate_editor_added_key(it.key(), value)')
  const fallback = cpp.indexOf('Editor flags must be JSON booleans')
  assert.ok(call >= 0 && fallback >= 0 && call < fallback, '新增键校验必须在布尔兜底之前调用')
})

test('旧存档缺键：删掉这一批的十把键仍然读得回来，并按默认值补齐（不许按字段数量判损坏）', async () => {
  const { defaultEditorSettings } = await import('../src/settingsModel.ts')
  // ① 前端默认值逐个对得上上游。
  for (const entry of KEYS) {
    const actual = defaultEditorSettings[entry.key]
    if (Array.isArray(entry.value)) assert.deepEqual(actual, entry.value, `${entry.key} 的默认值不对`)
    else assert.equal(actual, entry.value, `${entry.key} 的默认值不对（应为 ${entry.upstream} 的那一个）`)
  }
  // ② 旧 `projects.json` 的形状：整个 editorSettings 里**根本没有**这些键。
  const legacy = structuredClone(defaultEditorSettings)
  for (const name of NAMES) delete legacy[name]
  const { normalizeEditorSettings } = await import('../src/bridge.ts')
  // 补默认发生在原生 `editor_defaults_impl()` 那一层（`project_settings_state.cpp` 的逐键补洞循环），
  // 前端迁移不许凭空造值，更不许因为"少了几项"就把整本账判坏。
  const migrated = normalizeEditorSettings(legacy)
  for (const name of NAMES) assert.equal(migrated[name], undefined, `${name} 不该被前端造出来`)
  // 删键之后其余键必须一个不少（按字段数量判损坏的那一类回归）。
  const rest = Object.keys(defaultEditorSettings).filter(name => !NAMES.includes(name))
  assert.deepEqual(Object.keys(migrated).sort(), rest.sort(), '少几项就整本账不认识了')
  assert.ok(rest.length > 50, `这份夹具应该是一份**很大**的旧存档（其余键 ${rest.length} 个）`)
})

test('读盘那条补默认循环钉在源码上：未知键剪掉、缺键按 editor_defaults_impl 逐项补', () => {
  const state = read('native/project_settings_state.cpp')
  assert.match(state, /prune_unknown\(value\["settings"\], EDITOR_SETTING_KEYS\)/,
    '读盘要先剪未知键（旧版本写过、新版本删掉的键不能让文件损坏）')
  assert.match(state, /if \(!value\["settings"\]\.contains\(entry\.key\(\)\)\) value\["settings"\]\[entry\.key\(\)\] = entry\.value\(\)/,
    '缺键必须逐个按 editor_defaults_impl() 补，这是新增键唯一的迁移通道')
})

test('预览态取值校验真的在管这批新键（不是只登记了名字）', async () => {
  const { previewSettingsError } = await import('../src/previewSettings.ts')
  const languages = ['java', 'cpp', 'typescript', 'other']
  // 三档字面值 = EditorSettingsExternalizable.java:216-218；越界按上游一样拒收这一条。
  for (const value of ['None', 'Changed', 'Whole']) assert.equal(previewSettingsError('stripTrailingSpaces', value, languages), null)
  assert.equal(previewSettingsError('stripTrailingSpaces', 'modified', languages), '无效设置：stripTrailingSpaces')
  // 可见条数 1..10 = CodeVisionGlobalSettingsProvider.kt:43 的 spinner(1..10, 1)。
  assert.equal(previewSettingsError('codeVisionVisibleEntries', 5, languages), null)
  assert.equal(previewSettingsError('codeVisionVisibleEntries', 11, languages), '无效设置：codeVisionVisibleEntries')
  // 两个组集合：已知组 id（src/codeLensSettings.ts:48-50）放行，未知拒收；空数组是默认态。
  assert.equal(previewSettingsError('codeVisionDisabledGroups', [], languages), null)
  assert.equal(previewSettingsError('codeVisionEnabledGroups', ['problems'], languages), null)
  assert.equal(previewSettingsError('codeVisionDisabledGroups', ['nope'], languages), '无效设置：codeVisionDisabledGroups')
  assert.equal(previewSettingsError('codeVisionDisabledGroups', 'problems', languages), '无效设置：codeVisionDisabledGroups')
  // 布尔键：只有布尔放行，其它一律拒（走的是链路末尾那一条 typeof 兜底）。
  for (const name of ['ensureNewLineAtEof', 'keepTrailingSpacesOnCaretLine', 'autoInsertPairQuote',
    'closeCommentOnEnter', 'insertBraceOnEnter', 'codeVisionEnabled',
    'showQuickDocOnMouseHover', 'autoUpdateDocumentation']) {
    assert.equal(previewSettingsError(name, false, languages), null, `${name} 应当收布尔值`)
    assert.equal(previewSettingsError(name, 'no', languages), `无效设置：${name}`, `${name} 应当只收布尔值`)
  }
})

test('设置页那三处格子的 v-model 绑到同名设置字段（有键就有界面，不是假格子）', () => {
  const dialog = read(join('src', 'components', 'SettingsDialog.vue'))
  for (const mount of ['EditorSavePassesFields', 'EditorEnterKeysFields', 'CodeVisionSettingsPage']) {
    assert.match(dialog, new RegExp(`<${mount} :settings="editor"`), `${mount} 没挂在对话框的 editor 草稿上`)
  }
  const fields = read(join('src', 'components', 'EditorSavePassesFields.vue'))
    + read(join('src', 'components', 'EditorEnterKeysFields.vue'))
    + read(join('src', 'components', 'CodeVisionSettingsPage.vue'))
  // 这一批在设置页里落地的那些键（快速文档那两档的界面不在设置页 —— 见下面单独一条判据）。
  const pageKeys = NAMES.filter(name => name !== 'showQuickDocOnMouseHover' && name !== 'autoUpdateDocumentation')
  for (const name of pageKeys) {
    assert.ok(new RegExp(`settings\\.${name}\\b`).test(fields), `界面里没有 ${name} 这一格`)
  }
})

test('快速文档那两档的界面与键名同源（齿轮那一颗，不是设置页假格子）', () => {
  // 键名由 `src/docHoverPolicy.ts` 的 `DOC_HOVER_SETTING_KEYS` 定死（登记请求
  // `docs/wiring-requests-2026-10-06-bucket3a.md` 的 R4）；界面是快速文档弹层的齿轮
  // （`QuickDocPopup.vue` 里 `v-if="canToggleHover"` 那一条 —— 没有生效点就不渲染），
  // 点下去写的是运行时单例、发出去的补丁用的就是这两把键。
  const policy = read(join('src', 'docHoverPolicy.ts'))
  assert.match(policy, /showOnMouseMove: 'showQuickDocOnMouseHover'/, 'DOC_HOVER_SETTING_KEYS 的键名漂了')
  assert.match(policy, /autoUpdate: 'autoUpdateDocumentation'/, 'DOC_HOVER_SETTING_KEYS 的键名漂了')
  const popup = read(join('src', 'components', 'QuickDocPopup.vue'))
  assert.match(popup, /emit\('policy-change', toggleDocHoverPolicy\(key\)\)/, '齿轮那一条没有产出设置补丁')
  assert.match(popup, /v-if="canToggleHover"/, '没有生效点的开关不许渲染')
  // 默认档与运行时的出厂值一致（两档都是开 = EditorSettingsExternalizable.java:76 / documentation.auto.update）。
  assert.match(defaultsLine, /showQuickDocOnMouseHover: true/)
  assert.match(defaultsLine, /autoUpdateDocumentation: true/)
})

test('Code Vision 页把盘上那一份接进了运行时表（不是只写草稿）', () => {
  const page = read(join('src', 'components', 'CodeVisionSettingsPage.vue'))
  assert.match(page, /from '\.\.\/codeLensSettings\.ts'/, '页面没有用那份运行时设置表')
  assert.match(page, /codeVisionSettings\.enabled = props\.settings\.codeVisionEnabled/, '总闸没同步到运行时表')
  assert.match(page, /setCodeVisionGroupEnabled\(id, groupOn\(id\)\)/, '每组的开关没同步到运行时表')
  assert.match(page, /onMounted\(syncRuntime\)/, '打开页面时不该按内存里那份旧表继续跑')
})

// ------------------------------------------------------------------ 反证（新门禁必须能变红）
test('反证：把键名从五处抠掉后，同一组判据一条都不成立', () => {
  for (const entry of KEYS) {
    const strippedModel = model.replaceAll(entry.key, 'zzAbsent')
    const strippedDefaults = defaultsLine.replaceAll(entry.key, 'zzAbsent')
    assert.equal(new RegExp(`\\b${entry.key}: `).test(strippedModel), false, `${entry.key}：类型那条正则不吃得住`)
    assert.equal(new RegExp(`${entry.key}: `).test(strippedDefaults), false, `${entry.key}：默认值那条正则不吃得住`)
    assert.equal(new RegExp(`"${entry.key}"`).test(schemaHpp.replaceAll(entry.key, 'zzAbsent')), false,
      `${entry.key}：hpp 白名单那条正则不吃得住`)
    assert.equal(new RegExp(`key === '${entry.key}'`).test(preview.replaceAll(entry.key, 'zzAbsent')), false,
      `${entry.key}：预览白名单那条正则不吃得住`)
  }
  // 校验分支那三条也要能判不出来。
  for (const name of ['stripTrailingSpaces', 'codeVisionVisibleEntries', 'codeVisionDisabledGroups']) {
    assert.equal(new RegExp(`if \\(key == "${name}"\\)`).test(extraValidator.replaceAll(name, 'zzAbsent')), false,
      `${name}：校验分支那条正则不吃得住`)
  }
})
