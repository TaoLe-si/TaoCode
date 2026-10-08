// Run Anything 执行上下文的**最近目录缓存**（`src/runAnythingRecentDirectories.ts`）+ 弹层那头的端到端链。
//
// 上游依据（每条坐标都自己开过参考树）：
//   · 状态本体：`platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingContextRecentDirectoryCache.kt:26-29`
//     （`State.paths`，`@XCollection(elementName = "recentPaths")`），存储 = 同文件 `:13-14` 的
//     `Storage(StoragePathMacros.WORKSPACE_FILE)`（宏在 `platform/projectModel-api/src/com/intellij/openapi/components/StoragePathMacros.java:25`）
//     ⇒ **项目级**，跟着项目的 workspace 文件走；
//   · 唯一的写入点：`platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingChooseContextAction.kt:139-147`
//     （满了先 `removeAt(0)` 再 `add`，条数取注册表 `run.anything.context.recent.directory.number` = 5，
//     `platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:170-171`），
//     记完把当前上下文设成新加的那一档（同文件 `:146`）；起始目录 = 项目根（`:138`）；
//   · 唯一的读取点：同文件 `:238`（`allContexts` 把缓存整份列成 `RecentDirectoryContext`，排在「浏览目录…」之后）；
//   · 收端：`RunAnythingContextUtils.kt:14-21` 的 `getPath()` 交给执行侧当工作目录（本仓 = `runCommand` 的 `cwd`）。
//
// 本仓落点：`projects.json` → `perProject[项目根].runAnythingRecentPaths`，读盘时机 = `src/workspaceLifecycle.ts`
// 读回项目设置那一处（与 `foldingState` 同族；键缺失 = 老存档 = 空表，**不判损坏**）。
//
// 跑法同 `run-anything-context-dialog.test.mjs`：行为判据走 `loadSetup`（真调组件的 setup），
// 「这一档到底渲不渲染」走 `loadSfc` + `renderToString`；两边与缓存模块用的是**同一个**模块实例
// （`loadModule` 走夹具那份带缓存的 require 桩），所以能把缓存灌进组件真看到的那一份里。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadModule, loadSetup, loadSfc } from './vue-sfc-loader.mjs'
import { CONTEXT_LABEL_BROWSE, CONTEXT_LABEL_PROJECT } from '../src/runAnythingContext.ts'

const CACHE = 'src/runAnythingRecentDirectories.ts'
const DIALOG = 'src/components/RunAnythingDialog.vue'
const cacheSource = readFileSync(new URL(`../${CACHE}`, import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL(`../${DIALOG}`, import.meta.url), 'utf8')

/** 每次都要一份干净的模块状态：夹具的模块缓存是共享的，测试之间不清就会互相串。 */
function freshCache() {
  const cache = loadModule(CACHE)
  cache.importRunAnythingRecentDirectories(undefined, '')
  return cache
}

function quiet(fn) {
  const error = console.error
  console.error = () => {}
  try { return fn() } finally { console.error = error }
}
const commandRow = () => ({ kind: 'command', name: 'npm test', detail: '', group: 'command', score: 0, indices: [] })

// ── 1. 入栈规则（`:139-147`）真的被生产代码消费 ────────────────────────────────
test('记一条 = 走 runAnythingContext 的入栈规则并落盘那一个键（不是另写一份条数逻辑）', () => {
  const cache = freshCache()
  const written = []
  const paths = cache.rememberRunAnythingRecentDirectory('D:\\work\\one', next => written.push([...next]))
  assert.deepEqual(paths, ['D:\\work\\one'])
  assert.deepEqual(written, [['D:\\work\\one']], '落盘交出去的就是入栈后的那一份')
  // 满 5 条之后先摘最老的一条（注册表默认值 5，xml:170-171）：这一轮里被摘掉的是最开始的 `D:\work\one`。
  let all = paths
  for (const dir of ['a', 'b', 'c', 'd', 'e']) all = cache.rememberRunAnythingRecentDirectory(dir, () => {})
  assert.deepEqual(all, ['a', 'b', 'c', 'd', 'e'], '第五条进来时摘掉最老的那一条')
  assert.equal(all.length, 5, '条数上限 = 注册表默认值')
  assert.equal(cache.rememberRunAnythingRecentDirectory('   ', () => []).length, 5, '空白路径什么都不记（也不落盘）')
})

// ── 2. 迁移判据：缺键 / 坏形状一律补默认，**不许判损坏** ────────────────────────
test('读盘：缺键、null、非数组、条目形状不对、条数超过上限 —— 全部是合法输入（都不抛错）', () => {
  const cache = freshCache()
  const settingsKey = cache.RUN_ANYTHING_RECENT_PATHS_KEY
  assert.equal(settingsKey, 'runAnythingRecentPaths')
  const cases = [
    ['整个设置对象没这个键（老存档）', { excludedDirs: [] }, []],
    ['设置本身是 undefined（关项目 / 换项目）', undefined, []],
    ['值是 null', { [settingsKey]: null }, []],
    ['值不是数组', { [settingsKey]: 'D:/x' }, []],
    ['条目里混了非字符串与空串', { [settingsKey]: ['D:/a', 7, '', '  ', 'D:/b'] }, ['D:/a', 'D:/b']],
    // 条数比上限多（注册表被调小之后的老存档）：**不判损坏也不截断**，原样读出来（上游读出侧不截断，:238）。
    ['条数超过 5', { [settingsKey]: ['1', '2', '3', '4', '5', '6', '7'] }, ['1', '2', '3', '4', '5', '6', '7']],
  ]
  for (const [name, record, expected] of cases) {
    cache.importRunAnythingRecentDirectories(record, 'D:/ws')
    assert.deepEqual([...cache.recentDirectoryPaths.value], expected, `${name} ⇒ 补默认/逐条丢，不许抛错也不许判损坏`)
  }
  cache.importRunAnythingRecentDirectories(undefined, '')
  assert.deepEqual([...cache.recentDirectoryPaths.value], [], '关项目 / 换项目 ⇒ 清空，上一个项目的目录不串过来')
  assert.equal(cache.recentDirectoryChooserStart(), '', '起始目录跟着一起清')
})

test('起始目录 = 项目根（上游 :138 的 choose(project.guessProjectDir())），浏览时交给宿主', () => {
  const cache = freshCache()
  cache.importRunAnythingRecentDirectories({ [cache.RUN_ANYTHING_RECENT_PATHS_KEY]: ['D:/ws/one'] }, 'D:/ws')
  assert.equal(cache.recentDirectoryChooserStart(), 'D:/ws')
})

// ── 3. 缓存有值 ⇒ 弹层里真的出现「最近目录」那一档（选择器逐项对得上）──────────
test('缓存灌进组件看的那一份后，下拉里逐项就是 项目 / 模块 / 浏览 / 最近目录，顺序与上游一致', async () => {
  const cache = freshCache()
  cache.importRunAnythingRecentDirectories({ [cache.RUN_ANYTHING_RECENT_PATHS_KEY]: ['D:\\tmp\\one', 'D:\\tmp\\two'] }, 'D:/ws')
  const props = { configs: [], moduleRoots: { app: 'app', lib: 'lib/src' }, canBrowseDirectories: true }
  const { bindings } = quiet(() => loadSetup(DIALOG, props))
  assert.deepEqual(bindings.availableContexts.value.map(entry => entry.kind),
    ['project', 'module', 'module', 'browse', 'recentDirectory', 'recentDirectory'],
    '顺序照 :235-240：模块在浏览行之前、最近目录排在浏览行之后（:238）')
  // Windows 宿主上不折 `~`（FileUtil.java:1273 的 isUnix || !unixOnly）⇒ label 就是原样绝对路径。
  assert.deepEqual(bindings.availableContexts.value.filter(entry => entry.kind === 'recentDirectory').map(entry => entry.label),
    ['D:\\tmp\\one', 'D:\\tmp\\two'])
  const html = await renderToString(createSSRApp(loadSfc(DIALOG).component, props))
  const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1])
  assert.deepEqual(options, [CONTEXT_LABEL_PROJECT, 'app', 'lib', CONTEXT_LABEL_BROWSE, 'D:\\tmp\\one', 'D:\\tmp\\two'],
    '渲染出来的就是那张表：没有多出来的行，也没有少了的档')
  assert.ok(html.includes('run-ctx-select'), '有了第二档（最近目录）⇒ 那一格要出现')
})

// ── 4. 选中最近目录 ⇒ runCommand 带上那个 cwd（端到端的收端在 runActions）───────
test('选了「最近目录」那一档后，命令行的 cwd 就是那条绝对路径（getPath 的 recentDirectory 一支，:19）', () => {
  const cache = freshCache()
  cache.importRunAnythingRecentDirectories({ [cache.RUN_ANYTHING_RECENT_PATHS_KEY]: ['D:\\tmp\\one'] }, 'D:/ws')
  const { bindings, emitted } = quiet(() => loadSetup(DIALOG, { configs: [], moduleRoots: { app: 'app', lib: 'lib/src' } }))
  const index = bindings.availableContexts.value.findIndex(entry => entry.kind === 'recentDirectory')
  assert.ok(index > 0, '最近目录那一档要在表里')
  bindings.chooseContext(index)
  assert.equal(bindings.context.value.label, 'D:\\tmp\\one')
  bindings.pick(commandRow())
  assert.deepEqual(emitted[emitted.length - 1].payload, { command: 'npm test', cwd: 'D:\\tmp\\one' },
    '缓存里的目录要真的变成命令的工作目录（绝对路径：native/run_host.cpp:258-261 按绝对路径原样用）')
})

// ── 5. 缓存为空 ⇒ 那一格不因为「最近目录」而多出来（没有假行）──────────────────
test('缓存空 ⇒ 表里没有最近目录那一档，也没有假的「浏览」行（isDesktop=false）', () => {
  const cache = freshCache()
  const { bindings } = quiet(() => loadSetup(DIALOG, { configs: [], moduleRoots: {} }))
  assert.deepEqual(bindings.availableContexts.value.map(entry => entry.kind), ['project'])
  assert.equal(bindings.cellVisible.value, false, '除了项目档没有第二档 ⇒ 整格不渲染（:65-68 的隐藏分支）')
})

// ── 6. 宿主链路的形状钉住（模块 → 弹层 → 落盘键）───────────────────────────────
test('落盘只交那一个键；弹层吃的是缓存那一份，浏览行只在桌面端出现', () => {
  const cache = freshCache()
  const sent = []
  cache.rememberRunAnythingRecentDirectory('D:/tmp/three', next => sent.push([...next]))
  assert.deepEqual(sent, [['D:/tmp/three']])
  assert.deepEqual(cache.runAnythingRecentPathsPatch(['D:/tmp/three']), { runAnythingRecentPaths: ['D:/tmp/three'] },
    '整份设置一起发会把别的字段覆盖掉：这里只许有这一个键')
  const cacheSource = readFileSync(new URL(`../${CACHE}`, import.meta.url), 'utf8')
  assert.match(cacheSource, /request\('project\.settings\.update', runAnythingRecentPathsPatch\(paths\)\)/,
    '默认落盘通道 = project.settings.update（`native/projects.cpp:820-844` 的 merge_patch 那条）')
  assert.match(cacheSource, /pushRecentDirectory\(stored\.value, picked\)/,
    '入栈规则用 runAnythingContext 那一份（上游 :139-147），不在这里另写一条')
  assert.match(dialogSource, /recentDirectories: recentDirectoryPaths\.value/, '弹层读缓存那一份，不是又一次装配')
  assert.match(dialogSource, /canBrowse: props\.canBrowseDirectories \?\? isDesktop/,
    '浏览行只在有原生目录框的那一档出现（预览点了没反应 ⇒ 不渲染）；判据用 prop 覆盖核另一档')
  assert.match(dialogSource, /rememberRunAnythingRecentDirectory\(picked\)/, '选完记进缓存（上游 :139-147）')
  assert.match(dialogSource, /if \(entry\?\.kind === 'browse'\) \{ void browseContextDirectory\(\); return \}/,
    '「浏览目录…」是动作不是目录：不把它设成当前档（getPath 对它返回 null，RunAnythingContextUtils.kt:20）')
})

// ── 7. 运行时那半截：谁来灌缓存 + 原生认不认这个键（少了后者 = 下次开机整个 projects.json 判损坏）──
test('换项目/关项目真的会喂这份缓存，且这个键登记在原生项目设置白名单里', () => {
  const cache = freshCache()
  const lifecycle = readFileSync(new URL('../src/workspaceLifecycle.ts', import.meta.url), 'utf8')
  // 读盘时机 = `project.settings.get` 那一处（与 `importFoldState(loaded?.foldingState)` 同批，
  // `src/workspaceLifecycle.ts:323`）；第二个实参是起始目录（项目根，上游 :138 的 guessProjectDir()）。
  assert.match(lifecycle, /importRunAnythingRecentDirectories\(loaded, result\.root\)/,
    '读回来的那一份要灌进缓存 —— 弹层看的是同一个单例，没人灌就等于这一档永远不出现')
  assert.equal((lifecycle.match(/importRunAnythingRecentDirectories\(undefined/g) ?? []).length, 2,
    '换项目（activateWorkspace 开头）与关项目各清一次：上一个项目的目录不许串过来')
  // 白名单这条是**硬教训**换来的：漏登 ⇒ 存它 `INVALID_SETTINGS`，而读盘那一条把整个 perProject 记录判
  // STATE_CORRUPT（`native/project_settings_state.cpp:106` 调 `validate_project_patch`），用户直接被锁在项目外。
  const schema = readFileSync(new URL('../native/settings_schema.cpp', import.meta.url), 'utf8')
  const from = schema.indexOf('void validate_project_patch(')
  const whitelist = schema.slice(from, schema.indexOf('if (patch.contains("foldingState"))'))
  assert.ok(from > 0 && whitelist.length > 0, '找得到 validate_project_patch 那一段')
  assert.ok(whitelist.includes(`"${cache.RUN_ANYTHING_RECENT_PATHS_KEY}"`),
    '键必须登记进 validate_project_patch 的 known_keys（`native/settings_schema.cpp:949-953`）')
})
