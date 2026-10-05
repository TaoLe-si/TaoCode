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
