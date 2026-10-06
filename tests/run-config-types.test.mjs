// exec/run-configs + exec/configurations-types：**逐类型编辑器表与逐类型校验**
// （`src/runConfigEditors.ts` 的判据，模块头里点名的就是这份文件）。
//
// 上游依据（坐标逐条开过上游文件，也写在各模块头里）：
//   · `platform/execution/src/com/intellij/execution/configurations/RunConfiguration.java:156-167`
//     —— `checkConfiguration()` 的三档严重级别，且「每敲一个字都可能被调用」；
//   · `platform/execution-impl/src/com/intellij/execution/impl/ConfigurationSettingsEditor.java:79-87`
//     —— 页签集合由配置类型决定（内建页标题 zh「配置」）；
//   · `platform/execution-impl/src/com/intellij/execution/compound/CompoundRunConfiguration.kt:113-123`
//     —— 复合配置两条校验：没有成员 ⇒「没有可以运行的内容」，没有可用目标 ⇒ 提醒；
//   · `platform/execution-impl/src/com/intellij/execution/impl/ConfigurationSettingsEditorWrapper.java:71-74`
//     —— 复合配置不显示「启动前」行（`WithoutOwnBeforeRunSteps`）。
//
// 这个文件还钉住一件真实出事过的事：**类型清单有五份副本**
// （`settingsModel.ts` 的 `RunConfig['type']` 联合、schema 的 `RUN_CONFIG_TYPE_IDS`、
//  左树的 `RUN_CONFIG_TYPES`、逐类型编辑器的 `RUN_CONFIG_EDITORS`、
//  宿主的 `native/settings_schema.cpp` 白名单）。
// 桶 11c 的 JAR 接线请求要落的就是这五处（见 docs/wiring-requests-2026-10-06-runcfg.md 与
// docs/wiring-requests-2026-10-06-runcfg2.md R1）；少落一处，本文件的判据就红 ——
// 免得「建得出 jar 配置、存不下去」这种形状第二次出现。
// 第五处是 C++、跑不了 TS 的 import，所以按文本读那张白名单（前四条判据是 import 进来的真值）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { RUN_CONFIG_EDITORS, runConfigEditorFor, runConfigFieldsFor, checkRunConfiguration, targetOptionLabel } =
  await import('../src/runConfigEditors.ts')
const { RUN_CONFIG_TYPES, runConfigTypeLabel } = await import('../src/runConfigTree.ts')
const { RUN_CONFIG_TYPE_IDS, normalizeRunConfigurations } = await import('../src/runConfigurationSchema.ts')

/** `src/settingsModel.ts` 里 `RunConfig['type']` 的联合成员（文本解析，保留文件由主代理持有）。 */
function runConfigTypeUnionFromModel() {
  const model = readFileSync('src/settingsModel.ts', 'utf8')
  const block = /export interface RunConfig \{([\s\S]*?)\n\}/.exec(model)
  assert.ok(block, 'src/settingsModel.ts 里要能找到 RunConfig 接口')
  const line = /\n\s*type\?:\s*([^\n]+)/.exec(block[1])
  assert.ok(line, 'RunConfig 里要有一行 type?: 联合')
  return [...line[1].matchAll(/'([^']+)'/g)].map(entry => entry[1])
}

test('四份类型清单必须同步：模型联合 = schema 清单 = 左树 = 逐类型编辑器表', () => {
  const modelTypes = runConfigTypeUnionFromModel()
  const schemaIds = [...RUN_CONFIG_TYPE_IDS]
  const treeIds = RUN_CONFIG_TYPES.map(entry => entry.id)
  const editorIds = Object.keys(RUN_CONFIG_EDITORS)
  assert.deepEqual([...modelTypes].sort(), [...schemaIds].sort(), 'settingsModel 的联合与 schema 清单不一致')
  assert.deepEqual([...schemaIds].sort(), [...treeIds].sort(), 'schema 清单与左树 RUN_CONFIG_TYPES 不一致')
  assert.deepEqual([...schemaIds].sort(), [...editorIds].sort(), 'schema 清单与 RUN_CONFIG_EDITORS 不一致')
  for (const entry of RUN_CONFIG_TYPES) assert.ok(entry.label && entry.label !== entry.id, `${entry.id} 要有中文名`)
  for (const [key, editor] of Object.entries(RUN_CONFIG_EDITORS)) assert.equal(editor.typeId, key)
})

test('每一种已声明的类型都能存得下去（schema 不再硬编码第二份清单）', () => {
  const leaf = { name: '叶子', type: 'shell', command: 'echo hi' }
  for (const entry of RUN_CONFIG_TYPES) {
    const config = entry.id === 'compound'
      ? { name: '复合', type: 'compound', command: '', configurations: [leaf.name] }
      : { name: `配置-${entry.id}`, type: entry.id, command: 'echo hi', program: 'a.exe', adapter: 'cpp' }
    const saved = normalizeRunConfigurations([leaf, config])
    assert.ok(saved.some(item => item.name === config.name), `${entry.id} 应当过得了 schema`)
  }
})

test('清单外的类型 id 一律拒（联合加宽但清单没跟上时，这条先红）', () => {
  assert.throws(() => normalizeRunConfigurations([{ name: 'a', type: 'definitely-not-a-type', command: 'x' }]), /运行配置字段无效/)
})

test('编辑器表：每种类型一套字段，页签标题照上游内建页（ConfigurationSettingsEditor.java:86）', () => {
  for (const entry of RUN_CONFIG_TYPES) {
    const editor = RUN_CONFIG_EDITORS[entry.id]
    assert.equal(editor.tabTitle, '配置', '上游内建页签标题（zh 文案「配置」）')
    assert.ok(editor.fields.length, `${entry.id} 要有字段`)
    assert.ok(['command', 'program', 'members'].includes(editor.primary))
    for (const field of editor.fields) assert.ok(field.label, `${entry.id} 的字段要有标签`)
  }
  assert.equal(RUN_CONFIG_EDITORS.compound.withoutOwnBeforeRunSteps, true, '复合配置没有自己的「启动前」（ConfigurationSettingsEditorWrapper.java:71）')
  assert.equal(RUN_CONFIG_EDITORS.shell.withoutOwnBeforeRunSteps, undefined)
  assert.equal(runConfigEditorFor(undefined).typeId, 'shell', '类型缺省按 shell 编辑器')
})

test('字段并集：填了值但不属于该类型的字段仍渲染出来（值不能静默吞掉）', () => {
  const shellWithProgram = { name: 'a', type: 'shell', command: 'x', program: 'p.exe' }
  const ids = runConfigFieldsFor('shell', shellWithProgram).map(field => field.id)
  assert.deepEqual(ids.slice(0, RUN_CONFIG_EDITORS.shell.fields.length), RUN_CONFIG_EDITORS.shell.fields.map(field => field.id))
  assert.ok(ids.includes('program'), 'program 有值 ⇒ 即使是 shell 类型也要露出来')
  assert.ok(!ids.includes('adapter'), '没值的字段不补')
  const empty = { name: 'a', type: 'shell', command: 'x' }
  assert.ok(!runConfigFieldsFor('shell', empty).map(field => field.id).includes('program'))
})

const base = { name: '应用', type: 'application', command: '', program: 'a.exe' }

test('逐类型校验：致命问题一律 error，运行目标问题只是 warning', () => {
  assert.equal(checkRunConfiguration({ ...base, name: '  ' }, []).message, '配置名不能为空。')
  assert.equal(checkRunConfiguration({ ...base, folder: 'a\nb' }, []).severity, 'error')
  // 非复合：命令与程序都空 ⇒ 致命（CompoundRunConfiguration.kt 的「没有可以运行的内容」同族）。
  assert.match(checkRunConfiguration({ ...base, program: '' }, []).message, /命令或可执行程序/)
  // 复合：没有成员 ⇒ 上游文案「There is nothing to run」（zh：没有可以运行的内容）。
  const compound = { name: '复合', type: 'compound', command: '', configurations: [] }
  assert.match(checkRunConfiguration(compound, []).message, /没有可以运行的内容/)
  assert.equal(checkRunConfiguration(compound, []).severity, 'error')
  // 成员不存在 / 环 ⇒ error（成员表 apply 时的 dependency cycle，本仓在整组校验里报）。
  assert.match(checkRunConfiguration({ ...compound, configurations: ['不存在'] }, []).message, /不存在/)
  const cyclic = { name: '复合', type: 'compound', command: '', configurations: ['另一个'] }
  const other = { name: '另一个', type: 'compound', command: '', configurations: ['复合'] }
  assert.match(checkRunConfiguration(cyclic, [cyclic, other]).message, /循环/)
  // 环境变量与启动前步骤。
  assert.match(checkRunConfiguration({ ...base, env: ['NOPE'] }, []).message, /KEY=VALUE/)
  assert.match(checkRunConfiguration({ ...base, beforeLaunch: [{ name: '', command: 'x' }] }, []).message, /启动前步骤/)
  // 一切正常 ⇒ 没有问题。
  assert.equal(checkRunConfiguration(base, [base]), null)
})

test('运行目标只有提醒没有致命（上游找不到目标就回落本机继续跑）', () => {
  const missing = checkRunConfiguration(base, [base], { templateTargetId: 'gone' })
  assert.equal(missing.severity, 'warning')
  assert.match(missing.message, /将按本机目标运行/)
  const broken = checkRunConfiguration(base, [base], {
    templateTargetId: 'wsl',
    templateTarget: { id: 'wsl', displayName: '假目标', runtimes: [], description: '', icon: '' },
  })
  assert.ok(broken === null || broken.severity === 'warning', '目标自身的问题也只报提醒')
})

test('类型标签与编辑器一致，未知类型退回原 id（不编一个标签）', () => {
  assert.equal(runConfigTypeLabel('compound'), '复合配置')
  assert.equal(runConfigTypeLabel('jar'), 'jar', '本仓还没接 JAR 类型 ⇒ 不显示假标签')
  assert.equal(typeof targetOptionLabel, 'function')
})

/**
 * 第五处副本：宿主 `native/settings_schema.cpp` 的 type 白名单（保留文件，跑不了 TS import ⇒ 按文本读）。
 * 原请求（W-B11c-3）只点了前四张表，实际宿主也在拒类型：前端四表全改了、宿主仍会 `INVALID_SETTINGS`
 * 把整个项目设置拒掉（`docs/batch-2026-10-06-runcfg.md` §B 最后一行登记过这一处）。
 */
function nativeRunConfigTypeWhitelist() {
  const source = readFileSync('native/settings_schema.cpp', 'utf8')
  const guard = /if \(type != "([a-z]+)"((?: && type != "[a-z]+")+)\)/.exec(source)
  assert.ok(guard, 'native/settings_schema.cpp 里要有运行配置 type 的白名单判断')
  const ids = [guard[1], ...[...guard[2].matchAll(/"([a-z]+)"/g)].map(entry => entry[1])]
  const message = /fail\("INVALID_SETTINGS", "运行配置类型只能是([^"]+?)。"\)/.exec(source)
  assert.ok(message, '白名单要有一句点明允许哪些类型（用户看得见的是这句）')
  return { ids, message: message[1] }
}

test('第五处：宿主 settings_schema.cpp 的 type 白名单与 schema 清单同源（少改一处 ⇒ 建得出、存不下去）', () => {
  const { ids, message } = nativeRunConfigTypeWhitelist()
  assert.deepEqual([...ids].sort(), [...RUN_CONFIG_TYPE_IDS].sort(), '原生白名单与 RUN_CONFIG_TYPE_IDS 不一致')
  assert.deepEqual(ids, [...RUN_CONFIG_TYPE_IDS], '两边顺序也要一致（报错文案按这个顺序念出来）')
  for (const id of RUN_CONFIG_TYPE_IDS) assert.ok(message.includes(id), `报错文案要点出 ${id}`)
})
