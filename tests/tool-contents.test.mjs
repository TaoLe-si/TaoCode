// 工具窗口多内容（`ContentManager.addContent` 那一半）的纯逻辑判据。
//
// 这一族的规矩来自 `UsageViewContentManagerImpl.addContent`（`:149-192`）与
// `ContentManagerImpl.doAddContent`（`:198-243`）；下面每条都写成"错了会怎样"可观察的形状。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addToolContent, canCloseAllToolContents, canCloseOtherToolContents, removeToolContent,
  replaceableContentAt, selectedToolContent, togglePinned, toolContentsToCloseAll,
  toolContentsToCloseOthers, usagesPanelTitle, usagesTabName,
} from '../src/toolContents.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let seq = 0
const content = (over = {}) => ({
  id: ++seq, tabName: 't', panelTitle: 'p', pinned: false, searching: false, reusable: true, payload: 'x', ...over,
})

test('再查一次：顶替选中的那条，位置与条数都不变', () => {
  const a = content({ tabName: 'A' })
  const b = content({ tabName: 'B' })
  const list = [a, b]
  const next = content({ tabName: 'C' })
  const result = addToolContent(list, b.id, next.id, next, false)
  assert.deepEqual(result.contents.map(item => item.tabName), ['A', 'C'], '被顶替者在**自己的下标**上被换掉（先占位再删）')
  assert.equal(result.selectedId, next.id)
  assert.equal(result.removedId, b.id)
})

test('钉住的那条动不得：下一次搜索另开一条', () => {
  const a = content({ tabName: 'A' })
  const pinned = content({ tabName: 'P', pinned: true })
  const list = [a, pinned]
  const next = content({ tabName: 'N' })
  const result = addToolContent(list, pinned.id, next.id, next, false)
  assert.equal(result.removedId, null, '选中的那条被钉住 ⇒ 谁也不该被删')
  assert.deepEqual(result.contents.map(item => item.tabName), ['A', 'P', 'N'], '没有可顶替的候选就是追加到末尾')
})

test('正在搜索的那条也不顶替：往前找一条可复用的', () => {
  const a = content({ tabName: 'A' })
  const busy = content({ tabName: '忙', searching: true })
  const list = [a, busy]
  const next = content({ tabName: 'N' })
  const result = addToolContent(list, busy.id, next.id, next, false)
  assert.equal(result.removedId, a.id, '上游那个循环没有 break，留下的是**最后匹配**的一条')
  assert.deepEqual(result.contents.map(item => item.tabName), ['N', '忙'])
})

test('不可复用的内容永远新开一条（reusable 就是上游那个 REUSABLE_CONTENT_KEY）', () => {
  const a = content({ tabName: 'A' })
  const next = content({ tabName: 'N', reusable: false })
  const result = addToolContent([a], a.id, next.id, next, false)
  assert.deepEqual(result.contents.map(item => item.tabName), ['A', 'N'])
  assert.equal(result.removedId, null)
})

test('顶替候选：选中的那条排在候选末尾，所以它优先', () => {
  const a = content({ tabName: 'A' })
  const b = content({ tabName: 'B' })
  assert.equal(replaceableContentAt([a, b], a.id), a.id, '选中者优先，即便它在列表里排在前面')
  assert.equal(replaceableContentAt([a, b], null), b.id, '没选中就取最后一条可复用的')
  assert.equal(replaceableContentAt([content({ tabName: 'X', pinned: true })], null), null)
  assert.equal(replaceableContentAt([content({ tabName: 'X', reusable: false })], null), null)
})

test('关闭谓词按**条目数**判，不再按 kind', () => {
  const a = content({ tabName: 'A' })
  const b = content({ tabName: 'B' })
  assert.equal(canCloseAllToolContents([]), false)
  assert.equal(canCloseAllToolContents([a]), true)
  assert.equal(canCloseOtherToolContents([a], a.id), false, '只有一条时"关闭其他"没有对象')
  assert.equal(canCloseOtherToolContents([a, b], a.id), true)
  assert.deepEqual(toolContentsToCloseOthers([a, b], a.id), [b.id], 'closeOther 跳过选中的那条')
  assert.deepEqual(toolContentsToCloseAll([a, b]), [a.id, b.id], 'closeAll 含选中的那条 —— 这是唯一的区别')
})

test('钉住是取反，不是设为 true（PinActiveTabAction 的 actionPerformed）', () => {
  const a = content({ id: 7 })
  const pinned = togglePinned([a], 7)
  assert.equal(pinned[0].pinned, true)
  assert.equal(togglePinned(pinned, 7)[0].pinned, false)
  assert.equal(a.pinned, false, '不改传入的那条对象')
})

test('删一条与取选中：不在列表里的 id 只会得到 null，不猜', () => {
  const a = content()
  const b = content()
  assert.deepEqual(removeToolContent([a, b], a.id).map(item => item.id), [b.id])
  assert.equal(selectedToolContent([b], a.id), null)
  assert.equal(selectedToolContent([b], b.id), b)
})

test('标签与面板标题沿用上游那两条模板的两槽', () => {
  // find.usages.of.element.tab.name={0} of {1}（Usages + 短名）；
  // find.usages.of.element.in.scope.panel.title={0} in {1}（长名 + 范围）。
  assert.equal(usagesTabName('foo'), '对“foo”的引用')
  assert.equal(usagesPanelTitle('com.example.Bar#foo', '整个项目'), 'com.example.Bar#foo 在整个项目中')
})

test('实现里没有凭空造的开关：钉住/可复用/搜索中三态都得来自上游', () => {
  const text = readFileSync(join(root, 'src/toolContents.ts'), 'utf8')
  for (const cite of ['ContentManagerImpl.java:198-243', 'UsageViewContentManagerImpl', 'ContentImpl.java:135-137',
    'FindBundle.properties:31', 'AnalysisBundle.properties:13']) {
    assert.ok(text.includes(cite), `缺出处 ${cite}`)
  }
})
