// 项目视图自己的齿轮组（IDEA `additionalGearActions`）那三条行为的判据。
//
// 上游：`ProjectViewImpl.java:1169`（把 actionGroup 交给 `setAdditionalGearActions`）、
// `platform/projectView/shared/resources/intellij.platform.projectView.xml:44-55`
// （Behavior 组：OpenInPreviewTab / AutoscrollToSource / OpenDirectoriesWithSingleClick / AutoscrollFromSource）、
// `ProjectViewSharedSettings.kt:32-34`（三条默认 false）、
// `ActionsBundle.properties:1453-1458`（文案）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldSelectInTree, treeClickOpensFile, treeOpenUsesPreviewTab } from '../src/projectViewBehavior.ts'
import { DEFAULT_PROJECT_TREE_SETTINGS } from '../src/projectTreeState.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const behavior = (over = {}) => ({ autoscrollToSource: false, autoscrollFromSource: false, openInPreviewTab: false, ...over })

test('单击打开文件：开关关着时只有双击开（ProjectViewSharedSettings.kt:33 默认 false）', () => {
  assert.equal(treeClickOpensFile(behavior(), 'file', 1), 'select-only', '默认单击只选中')
  assert.equal(treeClickOpensFile(behavior(), 'file', 2), 'open', '双击才开')
  assert.equal(treeClickOpensFile(behavior({ autoscrollToSource: true }), 'file', 1), 'open', '打开后单击就开')
})

test('目录行永远不由这个开关决定（目录归 OpenDirectoriesWithSingleClick / 单击展开）', () => {
  assert.equal(treeClickOpensFile(behavior({ autoscrollToSource: true }), 'directory', 1), 'select-only')
  assert.equal(treeClickOpensFile(behavior({ autoscrollToSource: true }), 'directory', 2), 'select-only')
})

test('预览标签开关就是 openFile 的 preview 参数（UISettingsState.kt:75 默认 false）', () => {
  assert.equal(treeOpenUsesPreviewTab(behavior()), false, '默认是持久标签')
  assert.equal(treeOpenUsesPreviewTab(behavior({ openInPreviewTab: true })), true)
})

test('始终选择打开的文件：开关关着不动，开着且真有文件时才选中', () => {
  assert.equal(shouldSelectInTree(behavior(), 'D:/p/a.kt'), false)
  assert.equal(shouldSelectInTree(behavior({ autoscrollFromSource: true }), 'D:/p/a.kt'), true)
  // 关掉所有标签（activePath 为空）时不该把树里的选中也清掉。
  assert.equal(shouldSelectInTree(behavior({ autoscrollFromSource: true }), ''), false)
})

test('三条默认值都是 false，且旧存档缺这三键时按默认走（不被判成损坏）', () => {
  assert.equal(DEFAULT_PROJECT_TREE_SETTINGS.autoscrollToSource, false)
  assert.equal(DEFAULT_PROJECT_TREE_SETTINGS.autoscrollFromSource, false)
  assert.equal(DEFAULT_PROJECT_TREE_SETTINGS.openInPreviewTab, false)
  const state = read('src/projectTreeState.ts')
  assert.match(state, /for \(const key of BOOLEAN_KEYS\) if \(typeof value\[key\] === 'boolean'\) state\[key\] = value\[key\]/,
    '读盘要按"缺键补默认"逐键判断，不能按键数判损坏')
})

test('齿轮里有这一组，且顺序是 Behavior 在最前（源码 :44-55 就是第一组）', () => {
  const view = read('src/components/ToolWindowView.vue')
  const behaviorAt = view.indexOf('ProjectView.ToolWindow.Behavior.Actions')
  const sortAt = view.indexOf('<ProjectViewSortSettings')
  assert.ok(behaviorAt > 0, '齿轮里没有 Behavior 组')
  assert.ok(behaviorAt < sortAt, 'Behavior 组要排在排序之前')
  for (const label of ['单击打开文件', '始终选择打开的文件', '用预览标签打开']) {
    assert.ok(view.includes(label), `齿轮少了「${label}」`)
  }
  // 三个开关都要写回同一份项目视图设置（`projectTreeState.update`）。
  assert.equal((view.match(/ctx\.projectTreeState\.update\(\{/g) ?? []).length, 3, '三条都要写回设置')
})

test('接线：树按开关决定开不开、宿主按开关决定选不选', () => {
  const tree = read('src/components/FileTree.vue')
  assert.match(tree, /treeClickOpensFile\(behavior\(\), 'file', event\.detail\)/, '单击路径没走这条判据')
  assert.match(tree, /emit\('open', entry\.path, treeOpenUsesPreviewTab\(behavior\(\)\)\)/, '打开时要带上预览标记')
  const side = read('src/editorSideViews.ts')
  assert.match(side, /shouldSelectInTree\(projectViewBehavior\(\), target\)/, '切标签时没走这条判据')
  assert.match(side, /getProjectTreeState\(workspaceRoot\(\)\)/, '行为设置要取当前项目的 host')
  const ctx = read('src/toolViewContext.ts')
  assert.match(ctx, /onTreeOpen: \(path, preview: boolean\) => void openFile\(path, false, \{ preview \}\)/, '预览标记要真的落到 openFile')
})
