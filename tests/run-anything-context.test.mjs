// Run Anything 的执行上下文（`src/runAnythingContext.ts`）：`RunAnythingContext` 的四个子类、
// `allContexts` 的组装顺序（含「模块只有一个就整组不列」）、`getPath()`、
// `update()` 的三条选择规则、弹层分隔线、最近目录入栈的条数。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTEXT_DESCRIPTION_UNDEFINED, CONTEXT_LABEL_BROWSE, CONTEXT_LABEL_PROJECT, CONTEXT_POPUP_TITLE,
  CONTEXT_SEPARATOR_DIRECTORIES, CONTEXT_SEPARATOR_MODULES, CONTEXT_TOOLTIP,
  RUN_ANYTHING_RECENT_DIRECTORY_LIMIT,
  allRunAnythingContexts, contextPath, moduleDescription, pushRecentDirectory, recentDirectoryLabel,
  resolveSelectedContext, separatorAbove,
} from '../src/runAnythingContext.ts'

const project = { basePath: 'D:/demo' }
const twoModules = [
  { name: 'app', description: 'app' },
  { name: 'lib', description: 'lib/src' },
]

test('文案常量逐条对 IdeBundle:1183-1189', () => {
  assert.equal(CONTEXT_LABEL_PROJECT, '项目')          // L1184 run.anything.context.project=Project
  assert.equal(CONTEXT_LABEL_BROWSE, '浏览目录…')      // L1183 run.anything.context.browse.directory=Browse Directory…
  assert.equal(CONTEXT_DESCRIPTION_UNDEFINED, '未定义') // L1185 =undefined
  assert.equal(CONTEXT_POPUP_TITLE, '执行上下文')       // L1186 =Execution Context
  assert.equal(CONTEXT_SEPARATOR_DIRECTORIES, '目录')    // L1187 =Directories
  assert.equal(CONTEXT_SEPARATOR_MODULES, '模块')       // L1188 =Modules
  assert.equal(CONTEXT_TOOLTIP, '选择命令在哪个上下文里执行') // L1189
})

test('allContexts 顺序：项目 → 模块 → 浏览目录 → 最近目录（:235-240）', () => {
  const contexts = allRunAnythingContexts({
    project, modules: twoModules, recentDirectories: ['D:/a', 'D:/b'],
  })
  assert.deepEqual(contexts.map(entry => entry.kind), ['project', 'module', 'module', 'browse', 'recentDirectory', 'recentDirectory'])
  assert.equal(contexts[0].label, CONTEXT_LABEL_PROJECT)
  assert.equal(contexts[0].description, 'D:/demo', 'ProjectContext 的描述是 basePath（:18）')
  assert.equal(contexts[0].icon, null, 'ProjectContext 用 EmptyIcon.ICON_16（ChooseContextAction:124）⇒ 本仓 null')
  assert.deepEqual(contexts[1].value, 'app')
  assert.equal(contexts[3].label, CONTEXT_LABEL_BROWSE)
})

test('模块只有一个时整组不列（projectAndModulesContexts:247 的 if (it.size > 1)）', () => {
  const one = allRunAnythingContexts({ project, modules: [{ name: 'app', description: '' }], recentDirectories: [] })
  assert.deepEqual(one.map(entry => entry.kind), ['project', 'browse'], '单模块时那一行整个不出现')
  const none = allRunAnythingContexts({ project, modules: [], recentDirectories: [] })
  assert.deepEqual(none.map(entry => entry.kind), ['project', 'browse'])
})

test('没有可用上下文时「浏览目录…」可以被藏掉，其余语义不变（:237 的单例）', () => {
  const contexts = allRunAnythingContexts({ project, modules: [], recentDirectories: [], canBrowse: false })
  assert.deepEqual(contexts.map(entry => entry.kind), ['project'])
})

test('getPath：项目→工作区根，模块→模块内容根，最近目录→目录本身，浏览→null（:14-21）', () => {
  const contexts = allRunAnythingContexts({ project, modules: twoModules, recentDirectories: ['D:/a'] })
  const [proj, app, , browse, recent] = contexts
  assert.equal(contextPath(proj), '', '本仓路径是工作区相对 ⇒ 项目根是空串')
  assert.equal(contextPath(app, { app: 'app/src' }), 'app/src')
  assert.equal(contextPath(app, {}), null, '模块内容根拿不到就是 null（:18 的 ?）')
  assert.equal(contextPath(browse), null, '「浏览…」没有对应目录（:20）')
  assert.equal(contextPath(recent), 'D:/a')
})

test('模块描述：项目根拿不到**或**相对路径算不出才叫「未定义」，算得出的（含空串）照原样（:22-25）', () => {
  assert.equal(moduleDescription(true, 'app/src'), 'app/src')
  assert.equal(moduleDescription(true, ''), '', '相对路径为空是合法结果，不是「未定义」')
  // 留痕（2026-10-06 recentdir 一批）：原写「只有项目根拿不到才是未定义」、实际上游那一个 `?:` 还兜住
  // `getRelativePath` 自己返回 null 的那一档（模块目录与项目根没有公共前缀）——
  // `platform/util-rt/src/com/intellij/openapi/util/io/FileUtilRt.java:418`。上游同一情况**不是**空串而是 `.`
  // （同文件 `:404-405`），本仓的相对路径口径把工作区根本身表示成空串（`runAnythingContext.ts` 的 `contextPath`），
  // 两条都是「算得出的合法结果」，所以这一档钉的是「空串不判未定义」，null 才判。
  assert.equal(moduleDescription(true, null), CONTEXT_DESCRIPTION_UNDEFINED, '相对路径算不出（模块在项目根外面）也是未定义')
  assert.equal(moduleDescription(false, 'app/src'), CONTEXT_DESCRIPTION_UNDEFINED, 'guessProjectDir() 为 null 才是未定义')
})

test('最近目录的标签：非 Unix 上原样返回（FileUtil:1273 的 isUnix || !unixOnly）', () => {
  assert.equal(recentDirectoryLabel('D:/work/notes'), 'D:/work/notes', 'Windows 宿主：不做 ~ 缩写')
  assert.equal(recentDirectoryLabel('/home/me/notes', true, '/home/me'), '~/notes', 'Unix 上家目录**以下**折成 ~/子路径（:1277）')
  // 留痕（2026-10-06 recentdir 一批）：原钉的是 `'~'`，值**钉错了** —— 祖先判定用的是
  // `isAncestor(userHomeDir, projectDir, /* strict = */ true)`（`platform/util/src/com/intellij/openapi/util/io/FileUtil.java:1276`），
  // 而 strict 档在两段等长时返回 ThreeState.NO（同文件 `:180-182`；注释 `:130` 说明只有 strict=false 才认相等）
  // ⇒ 路径**正好等于**家目录时整条折叠不成立，上游给的是原样全路径。
  assert.equal(recentDirectoryLabel('/home/me', true, '/home/me'), '/home/me', '家目录本身不折成 ~（strict 祖先判定不含相等）')
  assert.equal(recentDirectoryLabel('/opt/notes', true, '/home/me'), '/opt/notes', '家目录以外不动')
  assert.equal(recentDirectoryLabel('D:/x', true), 'D:/x', '没有家目录就不缩写')
})

test('update()：表空就整个隐藏（:65-68）', () => {
  const result = resolveSelectedContext([], null)
  assert.equal(result.hidden, true)
  assert.equal(result.selected, null)
  assert.equal(result.label, '')
})

test('update()：还没选就取第一个；选中的作废后也回到第一个（:70-77）', () => {
  const contexts = allRunAnythingContexts({ project, modules: twoModules, recentDirectories: [] })
  const first = resolveSelectedContext(contexts, null)
  assert.equal(first.hidden, false)
  assert.equal(first.label, CONTEXT_LABEL_PROJECT, '默认第一个')
  assert.equal(first.icon, null)

  const stale = resolveSelectedContext(contexts, { kind: 'recentDirectory', label: 'D:/gone', description: '', icon: 'Folder', value: 'D:/gone' })
  assert.equal(stale.label, CONTEXT_LABEL_PROJECT, '选中的不在表里 ⇒ 作废 ⇒ 回到第一个')

  const kept = resolveSelectedContext(contexts, contexts[2])
  assert.equal(kept.selected, contexts[2])
  assert.equal(kept.label, 'lib', '还在表里就保留')
})

test('弹层分隔线：浏览目录上方是「目录」，第一个模块上方是「模块」（:218-226）', () => {
  const contexts = allRunAnythingContexts({ project, modules: twoModules, recentDirectories: ['D:/a'] })
  assert.equal(separatorAbove(contexts, 0), null, '项目行上面没有分隔线')
  assert.equal(separatorAbove(contexts, 1), CONTEXT_SEPARATOR_MODULES, '第一个模块')
  assert.equal(separatorAbove(contexts, 2), null, '第二个模块上方没有')
  assert.equal(separatorAbove(contexts, 3), CONTEXT_SEPARATOR_DIRECTORIES, '浏览目录行')
  assert.equal(separatorAbove(contexts, 4), null, '最近目录行上方没有（只有 BrowseDirectoryItem 触发，:221）')
  assert.equal(separatorAbove(contexts, 99), null, '越界不炸')
})

test('最近目录入栈：满了先摘最老的一条再 push，条数取注册表默认值 5（:139-147 + xml:170）', () => {
  assert.equal(RUN_ANYTHING_RECENT_DIRECTORY_LIMIT, 5)
  assert.deepEqual(pushRecentDirectory([], 'a'), ['a'])
  assert.deepEqual(pushRecentDirectory(['a', 'b', 'c', 'd'], 'e'), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(pushRecentDirectory(['a', 'b', 'c', 'd', 'e'], 'f'), ['b', 'c', 'd', 'e', 'f'], '最老的被摘掉')
  assert.deepEqual(pushRecentDirectory(['a', 'b'], 'c', 2), ['b', 'c'], 'limit 可注入')
  assert.deepEqual(pushRecentDirectory(['a', 'b', 'c'], 'd', 1), ['d'], 'limit=1 时只留最新的一条')
  // 与 src/runAnything.ts 的命令历史（12 条）是两张表，别混。
  assert.notEqual(RUN_ANYTHING_RECENT_DIRECTORY_LIMIT, 12)
})
