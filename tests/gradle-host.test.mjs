import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'
import * as gradle from '../src/gradle.ts'
import * as model from '../src/externalSystemModel.ts'
import * as viewOptions from '../src/externalSystemViewOptions.ts'
import * as activationModel from '../src/externalProjectModel.ts'
import * as externalSystemTask from '../src/externalSystemTask.ts'
// 任务编辑设置（`src/externalTaskSettings.ts`）：gradleHost 的 runTask 读它折命令/env，宿主测试喂真实模块。
import * as externalTaskSettings from '../src/externalTaskSettings.ts'
// 配置源根的进程表（`src/projectFileIndex.ts`）：gradleHost 是它的写者，宿主测试喂真实模块。
import * as projectFileIndex from '../src/projectFileIndex.ts'
import * as autoImportNotifications from '../src/autoImportNotifications.ts'
import * as backgroundTasks from '../src/backgroundTasks.ts'
// 自动导入 API 层（esa/autoimport）：gradleHost 的改动经 tracker 决策，宿主测试要喂真实模块。
import * as autoImportApi from '../src/externalSystemAutoImport.ts'
// 自动链接开关的存储面（`src/externalSystemAutoLink.ts`）与设置文件内容 CRC 比对
// （`src/externalSystemSettingsCrc.ts`）：两者都是纯函数，gradleHost 直接调，宿主测试同样喂真实模块
// —— 喂假实现会让「CRC 相同就跳过」与「自动链接关闭就不链」这两条判据在测试里形同虚设。
import * as autoLink from '../src/externalSystemAutoLink.ts'
import * as settingsCrc from '../src/externalSystemSettingsCrc.ts'
// 模块名去重的候选序（`src/externalSystemNameGenerator.ts`）：gradleHost 的
// `uniqueProjectDisplayName` 直接调它，宿主测试喂真实模块（同上，不喂假实现）。
import * as nameGenerator from '../src/externalSystemNameGenerator.ts'
// 跨会话工程数据存储（`src/externalSystemDataStorage.ts`）：gradleHost 打开工程时从它拿
// 「上次会话的结构」，每次导入成功后写回 —— 宿主测试同样喂真实模块。
import * as dataStorage from '../src/externalSystemDataStorage.ts'

const tick = async () => { for (let i = 0; i < 12; i++) await vue.nextTick() }
function host({ dirs = ['a', 'b'], failSave = false, deferredList = false } = {}) {
  const state = vue.reactive({ running: false, command: '', startedAt: 0, at: 0, output: '', exit: null, cancelled: false })
  const calls = [], notices = [], progress = []
  let clock = 10, releaseList, rejectStart, deferStart = false
  const deps = {
    isDesktop: true, workspace: vue.ref({ root: 'D:/workspace' }),
    projectSettings: vue.ref({ buildTools: { ...gradle.DEFAULT_BUILD_TOOLS, gradle: { ...gradle.GRADLE_RUN_DEFAULTS, linkedProjects: dirs } } }),
    notify: (...args) => notices.push(args), notifyProgress: (...args) => progress.push(args),
    runInConsole: (...args) => calls.push(['console', ...args]), addRunConfiguration: (...args) => calls.push(['config', ...args]),
    isOpenInEditor: () => false, openSettings() {}, openFile: path => calls.push(['open', path]),
    async saveGradleSettings(patch) { if (failSave) throw new Error('disk full'); deps.projectSettings.value.buildTools.gradle = patch },
  }
  const send = async (method, params) => {
    calls.push([method, params])
    if (method === 'workspace.list') {
      if (deferredList) await new Promise(resolve => { releaseList = resolve })
      return [{ path: `${params.path ? params.path + '/' : ''}build.gradle` }, { path: `${params.path ? params.path + '/' : ''}gradlew.bat` }]
    }
    if (method === 'file.read') return { content: 'distributionUrl=https\\://x/gradle-8.7-bin.zip' }
    if (method === 'gradle.sync') {
      if (deferStart) return new Promise((_, reject) => { rejectStart = reject })
      // Deliberately match native field mutation order.
      state.running = true; state.command = params.command; state.output = ''; state.exit = null; state.cancelled = false
      state.at = state.startedAt = ++clock
    }
    if (method === 'gradle.cancel') { state.running = false; state.exit = -1; state.cancelled = true; state.at = ++clock }
    return {}
  }
  const js = ts.transpileModule(readFileSync(new URL('../src/gradleHost.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  new Function('require', 'exports', js)(name => {
    if (name === 'vue') return vue
    if (name === './bridge.ts') return { request: send, gradleSync: state }
    if (name === './gradle.ts') return gradle
    if (name === './errors.ts') return { errorMessage: e => e.message }
    if (name === './progressNotices.ts') return { gradleFinishedNoticeOf: (...x) => x, gradleRunningNoticeOf: (...x) => x }
    if (name === './externalSystemModel.ts') return model
    if (name === './externalSystemViewOptions.ts') return viewOptions
    if (name === './externalProjectModel.ts') return activationModel
    if (name === './externalSystemTask.ts') return externalSystemTask
    if (name === './externalTaskSettings.ts') return externalTaskSettings
    if (name === './projectFileIndex.ts') return projectFileIndex
    if (name === './autoImportNotifications.ts') return autoImportNotifications
    if (name === './backgroundTasks.ts') return backgroundTasks
    if (name === './externalSystemAutoImport.ts') return autoImportApi
    if (name === './externalSystemAutoLink.ts') return autoLink
    if (name === './externalSystemSettingsCrc.ts') return settingsCrc
    if (name === './externalSystemNameGenerator.ts') return nameGenerator
    if (name === './externalSystemDataStorage.ts') return dataStorage
    throw new Error(name)
  }, exports)
  const scope = vue.effectScope()
  const api = scope.run(() => exports.createGradleHost(deps))
  function finish(output = "Root project 'demo'\nBuild tasks\n-----------\nbuild - build it", code = 0) {
    state.output = output; state.running = false; state.exit = code; state.at = ++clock
  }
  return { api, state, deps, calls, notices, progress, finish, stop: () => scope.stop(),
    release: () => releaseList?.(), failStart: () => rejectStart?.(new Error('BUSY')), deferStart: () => { deferStart = true } }
}

test('all linked builds detect and sync sequentially with independent model namespaces', async () => {
  const h = host()
  await tick()
  assert.ok(h.api.linkedProjects.value.length, JSON.stringify({ deps: h.deps.projectSettings.value, calls: h.calls, notices: h.notices }))
  assert.deepEqual(h.calls.filter(([m]) => m === 'gradle.sync').map(([, p]) => p.root), ['D:/workspace/a'])
  h.finish(); await tick()
  assert.deepEqual(h.calls.filter(([m]) => m === 'gradle.sync').map(([, p]) => p.root), ['D:/workspace/a', 'D:/workspace/b'])
  h.finish(); await tick()
  assert.deepEqual(h.api.projects.value.map(p => [p.directory, p.result.tasks[0].name]), [['a', 'build'], ['b', 'build']])
  assert.equal(h.api.reloading.value, false)
  h.stop()
})

test('cancel clears queued builds and never parses canceled partial models', async () => {
  const h = host(); await tick()
  h.state.output = "Root project 'partial'\nBuild tasks\n-----------\nrun - partial"
  await h.api.cancel(); await tick()
  assert.equal(h.calls.filter(([m]) => m === 'gradle.sync').length, 1)
  assert.deepEqual(h.api.projects.value[0].result.tasks, [])
  assert.equal(h.api.projects.value[0].result.error, '已取消。')
  h.stop()
})

test('dependencies enqueue behind sync, cache an empty successful result, invalidate only the refreshed build', async () => {
  const h = host(); await tick()
  const loading = h.api.loadDependencies('b')
  h.finish(); await tick(); h.finish(); await tick()
  assert.equal(h.calls.filter(([m]) => m === 'gradle.sync').at(-1)[1].command, 'gradlew.bat --console=plain dependencies')
  h.finish('BUILD SUCCESSFUL'); await loading; await tick()
  assert.equal(h.api.projects.value[1].dependenciesLoaded, true)
  await h.api.loadDependencies('b')
  assert.equal(h.calls.filter(([m]) => m === 'gradle.sync').length, 3)
  const refresh = h.api.sync('a'); await tick(); h.finish(); await refresh
  assert.equal(h.api.projects.value[1].dependenciesLoaded, true)
  h.stop()
})

test('link appends, failed persistence does not sync, and unlink preserves the other build', async () => {
  const h = host(); await tick(); h.finish(); await tick(); h.finish(); await tick()
  const linking = h.api.linkProject('c/build.gradle'); await tick()
  assert.deepEqual([...h.api.linkedProjects.value], ['a', 'b', 'c'])
  h.finish(); await linking
  await h.api.unlinkProject('b')
  assert.deepEqual([...h.api.linkedProjects.value], ['a', 'c'])
  assert.equal(h.api.projects.value[0].result.tasks[0].name, 'build')
  h.stop()
  const failed = host({ dirs: [], failSave: true }); await tick()
  await failed.api.linkProject('c/build.gradle')
  assert.equal(failed.calls.some(([m]) => m === 'gradle.sync'), false)
  failed.stop()
})

test('workspace switch discards old results and drains ownership before syncing the new root', async () => {
  const h = host(); await tick()
  h.deps.workspace.value = { root: 'D:/new' }
  await tick()
  assert.ok(h.calls.some(([m]) => m === 'gradle.cancel'))
  assert.ok(h.calls.filter(([m]) => m === 'gradle.sync').slice(1).every(([, p]) => p.root.startsWith('D:/new/')))
  assert.ok(h.api.projects.value.every(p => !p.result.at))
  h.finish(); await tick(); h.finish(); await tick()
  assert.equal(h.api.result.value.workspaceRoot, 'D:/new')
  h.stop()
})

test('late detect replies and rejected starts never apply to another workspace', async () => {
  const h = host({ deferredList: true, dirs: ['a'] })
  h.deps.workspace.value = null; h.release(); await tick()
  assert.equal(h.calls.some(([m]) => m === 'gradle.sync'), false)
  assert.deepEqual(h.api.projects.value[0]?.result.tasks ?? [], [])
  h.stop()
  const busy = host({ dirs: ['a'] }); busy.deferStart(); await tick()
  busy.failStart(); await tick()
  assert.match(busy.api.projects.value[0].result.error, /BUSY/)
  assert.equal(busy.api.reloading.value, false)
  busy.stop()
})

test('selected-directory config/run/save callbacks use the right wrapper and project path', async () => {
  const h = host(); await tick(); h.finish(); await tick(); h.finish(); await tick()
  h.api.openConfig('b'); await h.api.runTask(':app:build', 'b'); await h.api.saveTaskAsRunConfig(':app:build', 'b')
  assert.ok(h.calls.some(([m, path]) => m === 'open' && path === 'b/build.gradle'))
  assert.ok(h.calls.some(([m, command]) => m === 'console' && command === '"b/gradlew.bat" --console=plain -p "b" :app:build'))
  // 运行配置名 = 上游 `AbstractExternalSystemTaskConfigurationType.generateName`：`工程名 [任务短名]`。
  // 这里两个构建（`a`、`b`）都有 `:app:build`，工程显示名会撞成 `app` —— 去重走
  // `AbstractIdeModifiableModelsProvider.java:125-135` 的候选序（`src/externalSystemNameGenerator.ts`），
  // 第一个没被占用的候选是「父目录段-原名」，所以是 `b-app`。
  assert.ok(h.calls.some(([m, name]) => m === 'config' && name === 'b-app [build]'))
  h.stop()
  // 只有一个构建时不存在冲突，名字保持上游原样（`app [build]`），去重不该凭空加前缀。
  const single = host({ dirs: ['b'] }); await tick(); await single.finish(); await tick()
  single.api.openConfig('b'); await single.api.saveTaskAsRunConfig(':app:build', 'b')
  assert.ok(single.calls.some(([m, name]) => m === 'config' && name === 'app [build]'))
  single.stop()
})

// 自动重载被禁时挂「同步更改 / 隐藏此通知」的通知（`AutoImportProjectTracker.kt:220-223` 的
// notificationNotify 分支；本仓 `src/autoImportNotifications.ts`，消费点在 `onBuildFilesChanged`）。
test('IDE 内改动且 SELECTIVE：不自动同步，改挂一条带按钮的通知；再次变更不重复弹', async () => {
  const h = host({ dirs: ['a'] }); await tick(); h.finish(); await tick()
  h.deps.isOpenInEditor = () => true            // 改动发生在 IDE 内 ⇒ SELECTIVE 不自动重载
  h.notices.length = 0
  const synced = h.calls.filter(([m]) => m === 'gradle.sync').length
  const reloaded = await h.api.onBuildFilesChanged(['a/build.gradle'])
  assert.equal(reloaded, false, 'SELECTIVE 下 IDE 内改动不触发重载')
  assert.equal(h.calls.filter(([m]) => m === 'gradle.sync').length, synced, '没有起新的同步')
  assert.equal(h.notices.length, 1, '要挂一条通知而不是静默跳过')
  const [message, error, , detail, displayId, actions] = h.notices[0]
  assert.match(message, /Gradle 项目结构已更改/)
  assert.equal(error, false)
  assert.equal(displayId, 'external-system:reload:GRADLE')
  assert.match(detail[0], /同步更改后才会生效/)
  assert.deepEqual(actions.map(action => action.label), ['同步更改', '隐藏此通知'])
  await h.api.onBuildFilesChanged(['a/build.gradle'])
  assert.equal(h.notices.length, 1, '同一个待同步系统不重复弹（集合语义）')
  h.stop()
})

// 显式重载（点通知的「同步更改」）走后台任务队列：连点两下排成一条（`BackgroundTaskQueue` 串行）。
test('通知的「同步更改」走后台队列，入队后真的同步且队列清空', async () => {
  const h = host({ dirs: ['a'] }); await tick(); h.finish(); await tick()
  h.deps.isOpenInEditor = () => true
  h.notices.length = 0
  await h.api.onBuildFilesChanged(['a/build.gradle'])
  const syncAction = h.notices[0][5][0]
  const synced = h.calls.filter(([m]) => m === 'gradle.sync').length
  syncAction.run()
  await tick()
  assert.equal(h.calls.filter(([m]) => m === 'gradle.sync').length, synced + 1, '队列里的任务真的发起了同步')
  h.finish(); await tick()
  assert.equal(backgroundTasks.backgroundTaskQueue.queuedCount.value, 0)
  assert.equal(backgroundTasks.backgroundTaskQueue.isEmpty(), true)
  h.stop()
})

// ── 「编辑任务…」存过的设置参与执行（上游 `ExternalSystemEditTaskDialog` + `ExternalSystemTasksTree.java:183-190`）──
function installTaskStore() {
  const data = new Map()
  globalThis.localStorage = {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
  }
  return () => { delete globalThis.localStorage }
}

test('存过的脚本参数/额外任务折进「运行」的控制台命令；没存过时命令一字不改', async () => {
  const restore = installTaskStore()
  try {
    externalTaskSettings.saveTaskSettingsMap(globalThis.localStorage, 'D:/workspace',
      externalTaskSettings.withTaskSettings({}, 'b', ':app:build',
        { taskNames: ['clean', ':app:build'], vmOptions: '', scriptParameters: '--info', env: {} }))
    const h = host(); await tick(); h.finish(); await tick(); h.finish(); await tick()
    await h.api.runTask(':app:build', 'b')
    assert.ok(h.calls.some(([m, command]) => m === 'console'
      && /"b\/gradlew\.bat" --console=plain -p "b" :app:build/.test(command)
      && command.endsWith('clean --info')), `控制台命令应带上存过的任务与参数：${JSON.stringify(h.calls)}`)
    h.stop()
  } finally { restore() }
  // 对照组：没装存储（没存过）→ 命令一字不改（既有断言的口径）。
  const plain = host({ dirs: ['b'] }); await tick(); await plain.finish(); await tick()
  await plain.api.runTask(':app:build', 'b')
  assert.ok(plain.calls.some(([m, command]) => m === 'console' && command === '"b/gradlew.bat" --console=plain -p "b" :app:build'))
  plain.stop()
})

test('VM 选项/env 的任务执行走带环境的原生通道（env 数组里能看到 GRADLE_OPTS）', async () => {
  const restore = installTaskStore()
  try {
    externalTaskSettings.saveTaskSettingsMap(globalThis.localStorage, 'D:/workspace',
      externalTaskSettings.withTaskSettings({}, 'a', 'build',
        { taskNames: ['build'], vmOptions: '-Xmx2g', scriptParameters: '', env: { TOKEN: 'secret' } }))
    const h = host({ dirs: ['a', 'b'] }); await tick(); h.finish(); await tick(); h.finish(); await tick()
    const before = h.calls.filter(([m]) => m === 'gradle.sync').length
    await h.api.runTask('build', 'a')
    await tick()
    const run = h.calls.filter(([m]) => m === 'gradle.sync').at(-1)
    assert.equal(h.calls.filter(([m]) => m === 'gradle.sync').length, before + 1, '原生通道起了这一次任务执行')
    assert.match(run[1].command, /-p "a" build/)
    assert.ok(run[1].env.includes('GRADLE_OPTS=-Xmx2g'), `env 要带 VM 选项：${JSON.stringify(run[1].env)}`)
    assert.ok(run[1].env.includes('TOKEN=secret'), 'env 要带用户的环境变量')
    assert.equal(h.calls.some(([m]) => m === 'console'), false, '带 env 的执行不走只有命令字符串的控制台通道')
    h.finish('BUILD SUCCESSFUL'); await tick()
    assert.match(h.api.projects.value[0].message, /任务运行完成/)
    h.stop()
  } finally { restore() }
})

// 「保存为运行配置」也带得上 env（接线请求 R1 的模块侧）：上游那份是整 bean 随配置持久
// （`ExternalSystemBeforeRunTask.java:38-45` 把 tasks/externalProjectPath/vmOptions/scriptParameters
// 全写进运行配置 XML），不是只在「直接运行」那一刻生效。
test('存过的 VM 选项/env 随「创建运行配置」交出（第三参 KEY=VALUE 数组；没存过时不给 env）', async () => {
  const restore = installTaskStore()
  try {
    externalTaskSettings.saveTaskSettingsMap(globalThis.localStorage, 'D:/workspace',
      externalTaskSettings.withTaskSettings({}, 'b', ':app:build',
        { taskNames: [':app:build'], vmOptions: '-Xmx2g', scriptParameters: '--info', env: { TOKEN: 'secret' } }))
    const h = host(); await tick(); h.finish(); await tick(); h.finish(); await tick()
    await h.api.saveTaskAsRunConfig(':app:build', 'b')
    const config = h.calls.find(([m]) => m === 'config')
    assert.ok(config, `应有一次「创建运行配置」：${JSON.stringify(h.calls)}`)
    assert.match(config[2], /-p "b" :app:build --info$/, '脚本参数照旧折进命令')
    assert.deepEqual(config[3], ['GRADLE_OPTS=-Xmx2g', 'TOKEN=secret'],
      'VM 选项折 GRADLE_OPTS、用户 env 跟在后（与直接运行那条同一口径）')
    assert.equal(config[3].some(entry => /^JAVA_HOME=/.test(entry)), false,
      '不把自己解析出的 Gradle JVM 冻进配置（上游只持久 vmOptions/env）')
    h.stop()
  } finally { restore() }
  // 对照组：没存过设置 ⇒ 第三参不给（运行配置形状不变）。
  const plain = host({ dirs: ['b'] }); await tick(); await plain.finish(); await tick()
  await plain.api.saveTaskAsRunConfig(':app:build', 'b')
  const call = plain.calls.find(([m]) => m === 'config')
  assert.equal(call[3], undefined, '没编辑过就不凭空塞 env')
  assert.equal(call[2], '"b/gradlew.bat" --console=plain -p "b" :app:build')
  plain.stop()
})

// 自动重载的合并窗（上游 `AutoImportProjectTracker.kt:157-170`：延迟重载不当场跑；显式刷新 :137-142 不等）。
test('ALL 档外部改动进合并窗：不当场起同步，2.7s 的窗到点后一次跑完', async () => {
  const h = host({ dirs: ['a'] }); await tick(); h.finish(); await tick()
  // isOpenInEditor false + 非 VCS ⇒ EXTERNAL；ALL 档的自动重载走合并窗（有效延迟 2700ms）。
  const synced = h.calls.filter(([m]) => m === 'gradle.sync').length
  const reloaded = await h.api.onBuildFilesChanged(['a/build.gradle'])
  assert.equal(reloaded, true, '决策是重载（只是排进了窗）')
  assert.equal(h.calls.filter(([m]) => m === 'gradle.sync').length, synced, '当场不起新的同步（合并窗代跑）')
  assert.equal(h.notices.length, 0, 'ALL 档不挂通知')
  await new Promise(resolve => { setTimeout(resolve, 2850) })
  assert.equal(h.calls.filter(([m]) => m === 'gradle.sync').length, synced + 1, '窗到点后真的排了同步')
  h.finish(); await tick()
  assert.equal(h.api.reloading.value, false)
  h.stop()
})
