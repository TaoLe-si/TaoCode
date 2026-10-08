// 运行配置的**副本 / 重命名**可用性与落盘形状（批次 runcfg4，2026-10-06）。
//
// 上游出处（本批自己开树逐行核过，不是照抄派单）：
//   platform/execution/src/com/intellij/execution/RunManager.kt:51-65   suggestUniqueName：`名 (N)`、N 从 1 起
//   同文件 :67-71  extractBaseName：被占用时先剥掉尾部的 ` (N)`
//   platform/execution-impl/src/com/intellij/execution/impl/RunConfigurable.kt:1142  副本的基名 = 源配置自己的名字
//   同文件 :900-911  副本插在「被选中的那条」之后（getIndex(selectedNode) + 1）
//   同文件 :659-666  apply 时的重名判据，文案 ExecutionBundle.properties:66
//   同文件 :934 + :942-949  新建名 = suggestName(...) 取不到就落回落档（bundle :266 = Unnamed）
//   platform/execution-impl/src/com/intellij/execution/compound/CompoundRunConfiguration.kt:93-98
//       上游解析不到成员就 continue（**不**回写引用）⇒ 本仓的回写是登记过的差异，理由见 applyRunConfigSave 的注释。
//
// 本仓落点：
//   src/runConfigTree.ts            applyRunConfigSave / runConfigNameProblem / uniqueRunConfigName / RUN_CONFIG_UNNAMED_NAME
//   src/runConfigurations.ts        saveRunConfigFromDialog 的第二参（origin）
//   src/components/RunConfigurationsDialog.vue  originName / copyConfig / save / 折叠标题的条数后缀
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RUN_CONFIG_UNNAMED_NAME, applyRunConfigSave, runConfigNameProblem, uniqueRunConfigName,
} from '../src/runConfigTree.ts'
import { normalizeRunConfigurations } from '../src/runConfigurationSchema.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const config = (name, extra = {}) => ({ name, command: 'run', ...extra })

// ── 唯一名：上游那条规则的形状 ─────────────────────────────────────────────
test('新建配置的回落名取上游的 Unnamed 那一档（bundle 的 run.configuration.unnamed.name.prefix）', () => {
  assert.equal(RUN_CONFIG_UNNAMED_NAME, '未命名')
  // 上游回落点在 RunConfigurable.kt:1559 + ExecutionBundle.properties:266；本仓只有这一处常量。
  const tree = read('src/runConfigTree.ts')
  assert.match(tree, /export const RUN_CONFIG_UNNAMED_NAME/, '回落名必须是导出的那一份，不是散在各处的字面量')
  const dialog = read('src/components/RunConfigurationsDialog.vue')
  assert.match(dialog, /uniqueName\(RUN_CONFIG_UNNAMED_NAME\)/, '新建走的就是这一份')
  assert.ok(!/'新配置'/.test(dialog), '自造的「新配置」基名必须从代码里消失')
})

// ── 重名判据（上游 apply 那一条）────────────────────────────────────────────
test('改成一个已经被别的配置占用的名字：保存前就拦下来，报的是撞上的那条自己的类型', () => {
  const configs = [config('api', { type: 'application' }), config('web')]
  // `web` 没写 type ⇒ 与左树同一口径按 shell 归组（runConfigTree.ts 的 `config.type ?? 'shell'`）。
  assert.equal(runConfigNameProblem(configs, 'web', 'api'), '类型为「Shell 命令」的运行配置已存在：名字「web」。')
  assert.equal(runConfigNameProblem(configs, 'api', 'web'), '类型为「应用程序」的运行配置已存在：名字「api」。',
    '反方向撞的是另一条，类型也跟着那条走')
  assert.equal(runConfigNameProblem(configs, 'api', 'api'), null, '名字没动 ⇒ 不算撞（就地编辑）')
  assert.equal(runConfigNameProblem(configs, 'new', 'api'), null, '没人用过的名字放行')
  assert.equal(runConfigNameProblem(configs, '  ', 'api'), null, '空名由「配置名不能为空」那条管，这条不重复报')
  assert.equal(runConfigNameProblem(configs, 'web', ''), '类型为「Shell 命令」的运行配置已存在：名字「web」。',
    '新建（没有前身）撞名同样拦')
})

// ── 就地改名：旧的那条不能留在盘上 ────────────────────────────────────────
test('改名 = 就地替换那一条、保住原来那一格；旧名不再留在清单里', () => {
  const list = [config('a'), config('b'), config('c')]
  const result = applyRunConfigSave(list, config('B'), { from: 'b' })
  assert.equal(result.renamed, true)
  assert.equal(result.previous, 'b')
  assert.deepEqual(result.configs.map(entry => entry.name), ['a', 'B', 'c'], '不追加、不重排，槽位就是旧的那一格')
})

test('编辑（名字没动）仍就地覆盖；新建才追加到末尾', () => {
  const list = [config('a'), config('b')]
  assert.deepEqual(applyRunConfigSave(list, config('b', { command: 'other' }), { from: 'b' }).configs.map(e => e.name),
    ['a', 'b'], '名字没改 ⇒ renamed=false，位置不变')
  assert.equal(applyRunConfigSave(list, config('b', { command: 'other' }), { from: 'b' }).renamed, false)
  assert.deepEqual(applyRunConfigSave(list, config('z'), undefined).configs.map(e => e.name), ['a', 'b', 'z'])
})

test('副本插在源之后（上游 getIndex(selectedNode) + 1），源自己留着', () => {
  const list = [config('api'), config('web')]
  const copy = applyRunConfigSave(list, config('api (1)'), { copyOf: 'api' })
  assert.equal(copy.renamed, false, '副本不是改名')
  assert.deepEqual(copy.configs.map(entry => entry.name), ['api', 'api (1)', 'web'])
  // 名字生成与插入位用的是同一条规则 ⇒ 连copy 得到 api (1)、api (2)、不会长成 api (1) (1)。
  const again = applyRunConfigSave(copy.configs, config(uniqueRunConfigName(copy.configs, 'api (1)')), { copyOf: 'api (1)' })
  assert.deepEqual(again.configs.map(entry => entry.name), ['api', 'api (1)', 'api (2)', 'web'])
})

// ── 引用回写：本仓 schema 严格性逼出来的那条差异 ──────────────────────────
test('改名的配置被复合成员按名字引用时，引用一起换成新名（整份存档因此仍然有效）', () => {
  const list = [config('api'), config('all', { type: 'compound', command: '', configurations: ['api'] })]
  const renamed = applyRunConfigSave(list, config('svc'), { from: 'api' })
  assert.deepEqual(renamed.configs.map(entry => entry.name), ['svc', 'all'])
  assert.deepEqual(renamed.configs[1].configurations, ['svc'], '复合成员跟着改名')
  // 真正的消费链：回写后的清单过得去落盘门；**不回写**的话这条就是「成员不存在」的整份坏档。
  normalizeRunConfigurations(renamed.configs)
  assert.throws(() => normalizeRunConfigurations([config('svc'), config('all', {
    type: 'compound', command: '', configurations: ['api'],
  })]), /复合配置/)
})

test('引用回写只动复合成员；普通配置的同名字符串字段不被乱改', () => {
  const list = [config('api'), config('web', { env: ['TARGET=api'] })]
  const renamed = applyRunConfigSave(list, config('svc'), { from: 'api' })
  assert.deepEqual(renamed.configs[1].env, ['TARGET=api'])
})

test('传进来的清单不被就地改写（副本语义，Vue 侧的响应式数组才不会被打脏）', () => {
  const list = [config('a'), config('b')]
  const snapshot = JSON.stringify(list)
  applyRunConfigSave(list, config('B'), { from: 'b' })
  assert.equal(JSON.stringify(list), snapshot, '原数组与其元素必须逐字不动')
})

// ── 接线：对话框真的带上了前身，父组件真的接住 ────────────────────────────
test('接线：副本与改名都带上 origin，宿主那句 @save 绑定不用改（保留文件不在本批改动里）', () => {
  const dialog = read('src/components/RunConfigurationsDialog.vue')
  assert.match(dialog, /emit\('save', copy, \{ copyOf: source\.name \}\)/, '副本带 copyOf')
  assert.match(dialog, /emit\('save', next, originName\.value/, '改名带 from')
  assert.match(dialog, /const conflict = runConfigNameProblem\(props\.configs, next\.name, originName\.value\)/,
    '重名判据排在逐类型校验之后（上游 applyByType 就是这个先后）')
  const parent = read('src/runConfigurations.ts')
  assert.match(parent, /async function saveRunConfigFromDialog\(config: RunConfig, origin\?: RunConfigSaveOrigin\)/)
  assert.match(parent, /applyRunConfigSave\(stableConfigs\.value, stable, origin\)/)
  // App.vue 是保留文件：这一条钉的是「它现在的写法已经能把第二个参数传进来」，不是要改它。
  const app = read('src/App.vue')
  assert.match(app, /@save="saveRunConfigFromDialog"/, 'Vue 把 emit 的全部实参传给处理函数 ⇒ 保留文件不动也接得上')
})

// ── Before launch 标题的条数后缀（上游 updateText 的可见规则）──────────────
test('「启动前」的条数只在折叠且非空时挂上标题（BeforeRunStepsPanel.updateText 那一条）', () => {
  const dialog = read('src/components/RunConfigurationsDialog.vue')
  assert.match(dialog, /!beforeOpen\.value && beforeLaunchCount\.value > 0/, '展开时不挂、0 条不挂')
  assert.match(dialog, /v-if="beforeLaunchSuffix" class="rc-before-count"/, '不挂的时候那一格根本不渲染')
  assert.ok(!dialog.includes('{{ (form.beforeLaunch ?? []).length }} 步'), '恒显示的「N 步」旧形状必须消失')
})
