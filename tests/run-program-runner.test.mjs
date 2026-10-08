// exec/configurations-types：运行器调度（`src/programRunners.ts`）的判据。
//
// 上游依据：`platform/execution/src/com/intellij/execution/runners/ProgramRunner.java:52-88`
// （`getRunner(executorId, settings)` = 第一个 canRun 为真的、`getRunnerId`、canRun）、
// `platform/lang-api/src/com/intellij/execution/RunnerRegistry.java`（注册表按序问）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  RUN_EXECUTOR_ID, DEBUG_EXECUTOR_ID, BUILTIN_PROGRAM_RUNNERS, PROGRAM_RUNNER_EP,
  pickRunner, resolveRunner, runnerById, hasAnyRunner, allProgramRunners,
  programRunnerRegistry, registerProgramRunner,
} = await import('../src/programRunners.ts')

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const cfg = (name, type, extra = {}) => ({ name, type, ...extra })

test('执行器 id 与上游常量一致', () => {
  assert.equal(RUN_EXECUTOR_ID, 'Run')
  assert.equal(DEBUG_EXECUTOR_ID, 'Debug')
})

test('Run 执行器：非 debug 类型能跑，debug 类型被挡且理由与面板文案逐字一致', () => {
  const plain = cfg('App', 'application')
  assert.equal(pickRunner('Run', plain).runnerId, 'GenericProgramRunner')
  const dbg = cfg('Dbg', 'debug')
  assert.equal(pickRunner('Run', dbg), null, 'debug 类型不能被 Run 认下')
  const resolved = resolveRunner('Run', dbg)
  assert.equal(resolved.runner, null)
  assert.equal(resolved.reason, '配置「Dbg」是调试类型；用 Shift+F9 调试它。')
})

test('Debug 执行器：debug 类型、临时配置、复合配置能调试；普通配置被挡', () => {
  assert.equal(pickRunner('Debug', cfg('Dbg', 'debug')).runnerId, 'DebugProgramRunner')
  assert.equal(pickRunner('Debug', cfg('Tmp', 'shell', { temporary: true })).runnerId, 'DebugProgramRunner', '临时配置走各自链路')
  assert.equal(pickRunner('Debug', cfg('Compound', 'compound')).runnerId, 'DebugProgramRunner')
  const resolved = resolveRunner('Debug', cfg('App', 'application'))
  assert.equal(resolved.runner, null)
  assert.equal(resolved.reason, '配置「App」不是调试类型；在运行配置里勾选“调试”后才会交给 DAP。')
})

test('getRunner 的「第一个认下的赢」：顺序即询问顺序', () => {
  const first = { runnerId: 'First', canRun: () => true, refusalReason: () => '' }
  const second = { runnerId: 'Second', canRun: () => true, refusalReason: () => '' }
  assert.equal(pickRunner('Run', cfg('x', 'shell'), [first, second]).runnerId, 'First')
  assert.equal(pickRunner('Run', cfg('x', 'shell'), [second, first]).runnerId, 'Second')
})

test('按 id 找 runner（上游 findRunnerById）与「任意执行器能跑吗」', () => {
  assert.equal(runnerById('GenericProgramRunner')?.runnerId, 'GenericProgramRunner')
  assert.equal(runnerById('Nope'), undefined)
  assert.equal(hasAnyRunner(cfg('App', 'application')), true)
  assert.equal(hasAnyRunner(cfg('Dbg', 'debug')), true)
  assert.equal(BUILTIN_PROGRAM_RUNNERS.length, 2, '两条内建 runner（Run/Debug）')
})

test('接线：runActions 用 resolveRunner 选执行器路径，不再写死 if (debug)', () => {
  const actions = read('src/runActions.ts')
  assert.match(actions, /const executorId = debug \? DEBUG_EXECUTOR_ID : RUN_EXECUTOR_ID/)
  assert.match(actions, /const resolved = resolveRunner\(executorId, found\)/)
  assert.match(actions, /if \(!resolved\.runner\) \{ notify\(resolved\.reason, true\); return \}/)
  // 执行器必须先在 `com.intellij.executor` EP 里（executionExtensionPoints 登记的内建 Run/Debug）。
  assert.match(actions, /if \(!executorById\(executorId\)\)/)
})

// ── `com.intellij.programRunner` EP + 注册表类（重构后不再只是数据表）──────────────────────
test('EP id 逐字等于上游 `intellij.platform.execution.xml:31`', () => {
  assert.equal(PROGRAM_RUNNER_EP, 'com.intellij.programRunner')
})

test('程序运行器注表：register/unregister/adoptFromExtensions/find/all 五个面', () => {
  const runner = {
    runnerId: 'TestRunner', executorId: 'Run',
    canRun: (executorId, config) => executorId === 'Run' && config.name === 'test-only',
    refusalReason: () => '不认。',
  }
  const dispose = registerProgramRunner(runner, 'test.runner')
  try {
    assert.equal(runnerById('TestRunner')?.runnerId, 'TestRunner', 'all() 里能按 id 找到')
    assert.ok(allProgramRunners().some(candidate => candidate.runnerId === 'TestRunner'))
    assert.equal(allProgramRunners()[0].runnerId, 'GenericProgramRunner', '内建永远在前')
    assert.ok(programRunnerRegistry.find('TestRunner'))
    assert.equal(programRunnerRegistry.adoptFromExtensions(), 0, 'EP 里已登记的项不重复收编')
    assert.equal(pickRunner('Run', cfg('test-only', 'shell')).runnerId, 'GenericProgramRunner',
      '内建先认下（第一个认下的赢，与重构前逐字一致）')
  } finally { dispose() }
  assert.equal(runnerById('TestRunner'), undefined, '注销后 all() 里不见')
  assert.equal(programRunnerRegistry.unregister('TestRunner'), false, '再注销返回 false')
})