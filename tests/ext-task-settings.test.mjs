// es/execution 的判据：任务编辑对话框的字段面/存储/执行折命令（上游 `ExternalSystemEditTaskDialog` +
// `ExternalSystemTaskSettingsControl` + `ExternalSystemExecuteTaskTask`，坐标在 `src/externalTaskSettings.ts` 头注）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  composeTaskRunCommand, formatEnvironmentLines, loadTaskSettingsMap, parseEnvironmentLines,
  saveTaskSettingsMap, taskDialogDefaults, taskNeedsEnvironment, taskRunEnvironment, taskSettingsForBuild,
  taskSettingsForLinkedBuilds, taskSettingsFromDialog, taskSettingsIsDefault, taskSettingsKey,
  withTaskSettings,
} from '../src/externalTaskSettings.ts'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = file => readFileSync(join(here, '..', 'src', file), 'utf8')

function fakeStore() {
  const data = new Map()
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
    dump: () => Object.fromEntries(data),
  }
}

test('对话框文本 → 设置：任务名按 ParametersList 口径切（尊重引号）、VM/参数取原文、env 按行解析', () => {
  const settings = taskSettingsFromDialog({
    tasksText: 'clean "build jar" :app:test',
    vmOptions: ' -Xmx2g ',
    scriptParameters: '--info --tests "com.acme.Foo Bar"',
    envText: 'FOO=bar\nEMPTY=\nBAD LINE',
  })
  assert.deepEqual(settings.taskNames, ['clean', 'build jar', ':app:test'])
  assert.equal(settings.vmOptions, '-Xmx2g')
  assert.equal(settings.scriptParameters, '--info --tests "com.acme.Foo Bar"')
  assert.deepEqual(settings.env, { FOO: 'bar', EMPTY: '' })
  const parsed = parseEnvironmentLines('FOO=bar\nBAD LINE\n\nKEY=value=with=equals')
  assert.deepEqual(parsed.values, { FOO: 'bar', KEY: 'value=with=equals' })
  assert.deepEqual(parsed.invalid, ['BAD LINE'])
  assert.equal(formatEnvironmentLines({ A: '1', B: '2' }), 'A=1\nB=2')
})

test('回填（control reset）：没存过时任务文本 = 点到的任务；存过时 = 任务名空格连接', () => {
  const fresh = taskDialogDefaults(null, ':app:build')
  assert.equal(fresh.tasksText, ':app:build')
  assert.equal(fresh.vmOptions, '')
  const saved = taskDialogDefaults({ taskNames: ['clean', 'build'], vmOptions: '-Xmx2g', scriptParameters: '--info', env: { FOO: 'bar' } }, ':app:build')
  assert.equal(saved.tasksText, 'clean build')
  assert.equal(saved.vmOptions, '-Xmx2g')
  assert.equal(saved.envText, 'FOO=bar')
})

test('默认判定 + 存储：等于没编辑就不落条目；清空编辑会删掉旧条目；空表清键', () => {
  const store = fakeStore()
  const root = 'D:/workspace'
  const edited = taskSettingsFromDialog({ tasksText: 'build', vmOptions: '-Xmx2g', scriptParameters: '', envText: '' })
  assert.equal(taskSettingsIsDefault(edited, 'build'), false)
  let map = withTaskSettings({}, 'app/', 'build', edited)
  assert.ok(taskSettingsForBuild(map, 'app', 'build'), '目录键归一（尾斜杠不算两条）')
  assert.equal(saveTaskSettingsMap(store, root, map), true)
  assert.deepEqual(loadTaskSettingsMap(store, root), map)
  // 「存回默认」= 删条目；删空后落盘时连键一起清。
  map = withTaskSettings(map, 'app', 'build', taskSettingsFromDialog({ tasksText: 'build', vmOptions: '', scriptParameters: '', envText: '' }))
  assert.equal(Object.keys(map).length, 0)
  saveTaskSettingsMap(store, root, map)
  assert.equal(store.getItem(taskSettingsKey(root)), null, '空表不留空壳')
  // 脏 JSON 不炸（旧存档缺键补默认的教训：读不回来就当空表）。
  store.setItem(taskSettingsKey('D:/other'), '{not json')
  assert.deepEqual(loadTaskSettingsMap(store, 'D:/other'), {})
})

test('旧存档缺新键不判损坏：整表缺失读到空表；条目里坏字段整条剔掉', () => {
  const store = fakeStore()
  store.setItem(taskSettingsKey('D:/r'), JSON.stringify({ settings: { app: { build: { taskNames: ['build'], vmOptions: 42, env: 'nope' }, test: 'not-an-object' } } }))
  const map = loadTaskSettingsMap(store, 'D:/r')
  assert.deepEqual(map.app, { build: { taskNames: ['build'], vmOptions: '', scriptParameters: '', env: {} } }, '字段缺失按默认档补，不整表报废')
})

test('折命令：默认设置不动命令；额外任务与参数按「任务在前、参数在后」追加', () => {
  const base = 'gradlew.bat --console=plain -p "app" :app:build'
  assert.equal(composeTaskRunCommand(base, null, ':app:build'), base)
  assert.equal(composeTaskRunCommand(base, { taskNames: [':app:build'], vmOptions: '', scriptParameters: '', env: {} }, ':app:build'), base, '只点了原任务 = 没编辑')
  const composed = composeTaskRunCommand(base, { taskNames: ['clean', ':app:build'], vmOptions: '', scriptParameters: '--info --tests com.acme.Foo', env: {} }, ':app:build')
  assert.equal(composed, `${base} clean --info --tests com.acme.Foo`, '点击的任务留在原位，其余任务名与参数跟在后面')
})

test('环境通道判据 + 环境变量组装：GRADLE_OPTS 在前、用户 env 覆盖在后（后写赢）', () => {
  const plain = { taskNames: ['build'], vmOptions: '', scriptParameters: '', env: {} }
  assert.equal(taskNeedsEnvironment(plain), false)
  assert.equal(taskNeedsEnvironment({ ...plain, vmOptions: '-Xmx2g' }), true)
  assert.equal(taskNeedsEnvironment({ ...plain, env: { TOKEN: 'a' } }), true)
  const env = taskRunEnvironment(
    { taskNames: ['build'], vmOptions: '-Xmx2g', scriptParameters: '', env: { ZZZ: 'last', GRADLE_OPTS: '-Xmx4g' } },
    ['JAVA_HOME=C:/jdk'],
  )
  assert.deepEqual(env, ['JAVA_HOME=C:/jdk', 'GRADLE_OPTS=-Xmx2g', 'GRADLE_OPTS=-Xmx4g', 'ZZZ=last'],
    '用户明确写了 GRADLE_OPTS 时以他的为准（后写的赢）')
})

test('取消链接的 build 一并丢掉任务设置（与激活表同一口径：按归一后的链接目录命中）', () => {
  const map = { app: { build: { taskNames: ['build'], vmOptions: '-Xmx2g', scriptParameters: '', env: {} } }, other: { test: { taskNames: ['test'], vmOptions: '', scriptParameters: '', env: {} } } }
  const pruned = taskSettingsForLinkedBuilds(map, ['app', 'missing/'])
  assert.deepEqual(Object.keys(pruned), ['app'])
})

// —— 接线判据（不放假控件：每一段都必须在真链路上）——
test('接线①：任务右键矩阵有「编辑任务…」行（上游 Edit {0} Task，properties:134）', () => {
  const actions = readSource('externalSystemActions.ts')
  assert.match(actions, /id: 'EditExternalSystemTaskAction', title: '编辑任务…'/)
})

test('接线②：面板真的打开对话框并把保存写进存储', () => {
  const panel = readSource('components/GradlePanel.vue')
  assert.match(panel, /import \{[\s\S]*?from '\.\.\/externalTaskSettings\.ts'/)
  assert.match(panel, /row\.id === 'EditExternalSystemTaskAction' && target\.task\) openTaskEditor/)
  assert.match(panel, /role="dialog" aria-modal="true" aria-label="编辑 Gradle 任务"/)
  assert.match(panel, /saveTaskSettingsMap\(activationStore, props\.result\.workspaceRoot/)
})

test('接线③：runTask/saveTaskAsRunConfig 消费存过的设置；env 走原生通道', () => {
  const host = readSource('gradleHost.ts')
  assert.match(host, /import \{[\s\S]*?from '\.\/externalTaskSettings\.ts'/)
  assert.match(host, /const composed = composeTaskRunCommand\(command, settings, task\)/)
  assert.match(host, /if \(taskNeedsEnvironment\(settings\)\) \{/)
  assert.match(host, /kind: 'task', commandOverride: composed, environment: env/)
  assert.match(host, /deps\.addRunConfiguration\(taskRunName\(task, directory\), composeTaskRunCommand/)
  // 「保存为运行配置」也带 env（上游把 vmOptions/scriptParameters 整bean 写进配置 XML，
  // `ExternalSystemBeforeRunTask.java:38-45`）：第三参 = `taskRunEnvironment(settings, [])`，
  // 空基表 = 只交增量（GRADLE_OPTS + 用户 env），不把自己解析出的 JAVA_HOME 冻进配置。
  assert.match(host, /addRunConfiguration: \(name: string, command: string, env\?: string\[\]\) => unknown/)
  assert.match(host, /taskNeedsEnvironment\(settings\) \? taskRunEnvironment\(settings, \[\]\) : undefined/)
})

test('接线④：任务 tooltip 一个绑定同时回声「激活阶段」与「已编辑」（拆回去就断链）', () => {
  const panel = readSource('components/GradlePanel.vue')
  const body = /function taskActivationTitle[\s\S]*?\n\}/.exec(panel)?.[0] ?? ''
  assert.ok(body, '任务 tooltip 的产出函数必须在')
  assert.match(body, /activationTooltip\(activationMap\.value, directory, task\.name\)/, 'tooltip 读激活表（阶段串）')
  assert.match(body, /激活：/, '阶段串的口径：激活阶段前缀（上游 `ExternalSystemTaskActivator.getDescription` 的阶段名连接）')
  assert.match(body, /taskEditedSuffix\(directory, task\.name\)/, 'tooltip 读任务设置表（「（已编辑）」）')
  // 模板里只留这一个出口：把后缀拆回模板里的字符串拼接，`tests/file-chooser-activation-wiring.test.mjs`
  // 那条 `:title="taskActivationTitle\(task, build\.directory\)"` 门禁会当场撞红（本轮真红过一次）。
  const binding = /:title="([^"]*)" @dblclick/.exec(panel)?.[1] ?? ''
  assert.equal(binding, 'taskActivationTitle(task, build.directory)', `title 绑定必须只有这一个出口：${binding}`)
})
