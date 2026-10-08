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
//
// 2026-10-06 第三批（runcfg3）：JAR 在**模块侧**已经做完，五处都从同一份家族清单投影，
// 宿主那两处（type 联合 + 原生白名单，都是保留文件）由 `RUN_CONFIG_TYPE_IDS_HOST_PENDING` 挡住。
// 新增的判据：`JAR 那一族五处一致`、`gate 与宿主两处必须同步`、`JAR 缺入口四层都报错`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { RUN_CONFIG_EDITORS, RUN_CONFIG_TYPE_FAMILY_EDITORS, runConfigEditorFor, runConfigFieldsFor, checkRunConfiguration, targetOptionLabel } =
  await import('../src/runConfigEditors.ts')
const { RUN_CONFIG_TYPES, RUN_CONFIG_TYPE_FAMILY_LABELS, buildRunConfigTree, runConfigClosure, runConfigTypeLabel } = await import('../src/runConfigTree.ts')
const { RUN_CONFIG_TYPE_IDS, RUN_CONFIG_TYPE_FAMILY_IDS, RUN_CONFIG_TYPE_IDS_HOST_PENDING, normalizeRunConfigurations } =
  await import('../src/runConfigurationSchema.ts')
const { JAR_RUN_CONFIG_TYPE_ID, JAR_APPLICATION_TYPE_LABEL, jarRunConfigPath, jarRunConfigProblem, jarRunConfigParams } =
  await import('../src/jarRun.ts')

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
      : entry.id === JAR_RUN_CONFIG_TYPE_ID
        // jar 那一型多一道入口校验（args 里必须有 `-jar <路径>`），通用夹具喂不出合法记录。
        ? { name: `配置-${entry.id}`, type: entry.id, command: '', program: 'C:/jdk/bin/java.exe', args: ['-jar', 'build/app.jar'] }
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
  assert.equal(runConfigTypeLabel('jar'), 'JAR Application', 'JAR 已接 ⇒ 取上游 bundle 原文（ExecutionBundle.properties:55）')
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

// ── 2026-10-06 第三批（runcfg3）：JAR 那一族 ────────────────────────────────────────────
//
// 派单要求的「五处一致」在本仓的具体落点（每处都指得到模块里的一个真实导出）：
//   ① 新建配置表单 = `RUN_CONFIG_TYPE_FAMILY_EDITORS.jar`（`src/runConfigEditors.ts`）
//   ② schema 校验 = `normalizeRunConfigurations`（`src/runConfigurationSchema.ts`，JAR 走 `jarRunConfigProblem`）
//   ③ 持久化    = 同一份 `RUN_CONFIG_TYPE_IDS`（前端门）+ 宿主白名单（第五处，保留文件）
//   ④ 执行参数  = `jarRunConfigParams` / `jarRunConfigPath`（`src/jarRun.ts`）
//   ⑤ 树里显示  = `RUN_CONFIG_TYPE_FAMILY_LABELS` → `RUN_CONFIG_TYPES` → `buildRunConfigTree`
// 上游坐标（本批亲自开过）：`java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:19-23`
// （id `JarApplication` + name/description/icon）、`JarApplicationConfigurable.java:47-49/73/81`（表单四格的行序与标签）、
// `JarApplicationConfiguration.java:270-278`（bean 七个字段）、`JarApplicationCommandLineState.java:18-25`（argv 形状）、
// `platform/execution/resources/messages/ExecutionBundle.properties:54-55/564`。
const jarConfig = (fields = {}) => ({
  name: '跑 app.jar', type: JAR_RUN_CONFIG_TYPE_ID, command: '',
  program: 'C:/jdk/bin/java.exe', args: ['-jar', 'build/app.jar'], ...fields,
})

/** 跑一段并把它抛出的**消息**交回来（要核的是「报的是哪一句」，不是「有没有抛」）。 */
function thrownMessage(run) {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return assert.fail('本应抛错，却没有抛')
}

test('家族清单 = 已接 + 宿主未接，两处不重不漏（pending 摘掉一项就是五处一起开）', () => {
  const family = [...RUN_CONFIG_TYPE_FAMILY_IDS]
  assert.ok(family.includes(JAR_RUN_CONFIG_TYPE_ID), 'JAR 必须在家族清单里：模块侧已经做完，只剩宿主两处')
  for (const id of family) {
    const accepted = RUN_CONFIG_TYPE_IDS.includes(id)
    const pending = RUN_CONFIG_TYPE_IDS_HOST_PENDING.includes(id)
    assert.notEqual(accepted, pending, `${id} 要么已接、要么等宿主，不能两处都有或都没有`)
  }
  assert.deepEqual(family.filter(id => RUN_CONFIG_TYPE_IDS_HOST_PENDING.includes(id)), [...RUN_CONFIG_TYPE_IDS_HOST_PENDING],
    'pending 里的每一项都得是家族成员（写错 id 就是永远接不上）')
  // 已接那份保持家族顺序（左树固定顺序与宿主报错文案都按这个顺序念）。
  assert.deepEqual([...RUN_CONFIG_TYPE_IDS], family.filter(id => RUN_CONFIG_TYPE_IDS.includes(id)))
})

test('JAR 那一族五处一致：表单 / schema / 持久化 / 执行参数 / 树里显示都指同一个 id', () => {
  // ① 新建配置表单：字段表按家族穷尽 ⇒ 家族加 id 而这里少一行就编译不过。
  const editor = RUN_CONFIG_TYPE_FAMILY_EDITORS[JAR_RUN_CONFIG_TYPE_ID]
  assert.equal(editor.typeId, JAR_RUN_CONFIG_TYPE_ID)
  assert.equal(editor.tabTitle, '配置', '上游内建页签标题（ConfigurationSettingsEditor.java:86 的 zh 文案）')
  assert.equal(editor.primary, 'program', 'JAR 靠「Java 可执行文件」那一格跑起来')
  assert.deepEqual(editor.fields.map(field => field.id), ['program', 'args', 'cwd', 'env', 'beforeLaunch'],
    '表单顺序 = 上游 JarApplicationConfigurable 的行序折算（JRE → Path to JAR/参数 → 工作目录 → 环境变量）')
  for (const field of editor.fields) {
    assert.ok(field.label && field.placeholder, `jar 的 ${field.id} 要有标签与占位文案`)
    assert.notEqual(field.id, 'adapter', 'JAR 不画调试适配器那一格（上游那型没有 debugger 字段，本仓 debug 类型才要）')
    assert.notEqual(field.id, 'members', 'JAR 不是复合配置')
  }
  // ②③ schema 校验 + 持久化：人写的错报成人看得懂的那一句，而不是通用的「字段无效」。
  assert.match(thrownMessage(() => normalizeRunConfigurations([jarConfig({ args: ['-jar'] })])), /没有 JAR 路径/)
  assert.match(thrownMessage(() => normalizeRunConfigurations([jarConfig({ args: [], command: 'java' })])), /没有 JAR 路径/,
    '只在命令格里写了 java（没有 -jar 那一截）同样是缺入口')
  assert.ok(normalizeRunConfigurations([jarConfig()]).some(item => item.name === '跑 app.jar'),
    '形状齐的 jar 记录存得下去（宿主两处已接 ⇒ pending 摘掉；此前它被 gate 挡在「宿主还没接」那一句）')
  // ④ 执行参数：VM 参数 → -jar 路径 → 程序参数（与 jarRunArgs 同形），缺入口就抛而不是给一条空命令行。
  assert.deepEqual(jarRunConfigParams(jarConfig()), { program: 'C:/jdk/bin/java.exe', args: ['-jar', 'build/app.jar'], shell: false })
  assert.equal(jarRunConfigPath(jarConfig({ args: [], command: 'java -jar "build/my app.jar" --port 8080' })), 'build/my app.jar')
  assert.throws(() => jarRunConfigParams(jarConfig({ args: [] })), /没有 JAR 路径/)
  assert.throws(() => jarRunConfigParams(jarConfig({ program: '' })), /没有 Java 可执行文件/)
  assert.deepEqual(jarRunConfigParams(jarConfig({ program: '' }), { jdkHome: 'C:/jdk' }).program, 'C:/jdk/bin/java.exe',
    'JRE 那格留空 ⇒ 退到项目 JDK（上游 JarApplicationCommandLineState.java:20-21 的 createProjectJdk）')
  // ⑤ 树里显示：家族标签穷尽，已接清单是它按 gate 投影出来的结果。
  assert.equal(RUN_CONFIG_TYPE_FAMILY_LABELS[JAR_RUN_CONFIG_TYPE_ID], JAR_APPLICATION_TYPE_LABEL)
  assert.equal(RUN_CONFIG_TYPE_FAMILY_LABELS[JAR_RUN_CONFIG_TYPE_ID], 'JAR Application', '上游 bundle 原文（ExecutionBundle.properties:55）')
  for (const id of RUN_CONFIG_TYPE_FAMILY_IDS) {
    assert.ok(RUN_CONFIG_TYPE_FAMILY_LABELS[id] && RUN_CONFIG_TYPE_FAMILY_LABELS[id] !== id, `${id} 要有标签，不许拿 id 顶`)
    assert.ok(RUN_CONFIG_TYPE_FAMILY_EDITORS[id], `${id} 要有字段表`)
  }
  assert.deepEqual(RUN_CONFIG_TYPES.map(entry => entry.id), [...RUN_CONFIG_TYPE_IDS],
    '左树那份类型清单必须就是已接清单（摘掉 pending 后 jar 自动出现在树上与「添加」菜单里）')
})

test('JAR 缺入口时**表单实时校验**与**启动链路**都报错，不静默起跑', () => {
  // 表单：逐类型校验取的是致命档（上游 RunConfiguration.java:156-167 的 RuntimeConfigurationError = 无法执行）。
  const problem = checkRunConfiguration(jarConfig({ program: 'java.exe', args: ['-jar'] }), [])
  assert.equal(problem.severity, 'error')
  assert.match(problem.message, /没有 JAR 路径/)
  assert.equal(checkRunConfiguration(jarConfig(), [jarConfig()]), null, '形状齐的 jar 记录在编辑器层没有拦路问题')
  // 启动：`runConfigClosure` 落 schema 同一道门（src/runConfigTree.ts 里那句 normalizeRunConfigurations）。
  assert.match(thrownMessage(() => runConfigClosure(jarConfig({ args: ['-jar'] }), [])), /没有 JAR 路径/)
  assert.deepEqual(runConfigClosure(jarConfig(), []).map(entry => entry.name), ['跑 app.jar'],
    '宿主两处已接 ⇒ 形状齐的 jar 过得了启动链路里 schema 那道门（此前停在「宿主还没接」）')
})

test('宿主两处接了 JAR 之后左树要列出 jar 类型节点（pending 摘掉 ⇒ 树、添加菜单、类型下拉三处同源）', () => {
  assert.deepEqual(buildRunConfigTree([jarConfig()]).map(group => group.id), ['jar'],
    'gate 摘掉 ⇒ 树里必须出现 jar 类型节点（表单的「添加」菜单同理，两处读的都是 RUN_CONFIG_TYPES）')
  assert.deepEqual(buildRunConfigTree([{ name: 'shell 一条', type: 'shell', command: 'echo hi' }]).map(group => group.id), ['shell'])
})

test('JAR 的 gate 与宿主两处必须同步：宿主接了却留着 pending（或前端先接）都算红', () => {
  const { ids } = nativeRunConfigTypeWhitelist()
  const modelTypes = runConfigTypeUnionFromModel()
  for (const id of RUN_CONFIG_TYPE_FAMILY_IDS) {
    const hostAccepts = ids.includes(id) && modelTypes.includes(id)
    assert.equal(RUN_CONFIG_TYPE_IDS.includes(id), hostAccepts,
      `${id}：前端清单与宿主两处不一致 ⇒ 改 settingsModel 的 type 联合与 native/settings_schema.cpp 的白名单时，`
      + '要同时把 src/runConfigurationSchema.ts 的 RUN_CONFIG_TYPE_IDS_HOST_PENDING 里那一项删掉')
  }
})
