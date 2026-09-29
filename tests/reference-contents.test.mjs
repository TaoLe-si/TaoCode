// 「引用」内容存储的判据：一条搜索 = 一条内容，标签条上多一行，能关、能钉、能被下一次搜索顶替。
//
// 这一族之所以要有：以前 `references` 是一个数组，"再查一次就把上一批冲掉"是**唯一**可能的行为，
// 于是 `关闭所有标签页` 对引用只能算"数组清空"，`ContentManager` 的条目语义无处安放。
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  closeAllReferences, closeOtherReferences, closeReferences, failReferences, finishReferences,
  hasReferences, references, referencesInNewTab, referenceTabs, resetReferences, selectReferences,
  startReferences, togglePinReferences,
} from '../src/referenceContents.ts'

beforeEach(() => { resetReferences(); referencesInNewTab.value = false })

const loc = (path, line = 0) => ({ path, line, character: 0 })

test('开新标签后并排两条：面板显示的是**选中的那条**，不是两次结果拼起来', () => {
  referencesInNewTab.value = true
  const first = startReferences('alpha', 'com.example.A#alpha')
  finishReferences(first, [loc('a.java'), loc('b.java')])
  const second = startReferences('beta', 'com.example.B#beta')
  finishReferences(second, [loc('c.java')])
  assert.deepEqual(referenceTabs.value.map(tab => tab.label), ['对“alpha”的引用', '对“beta”的引用'])
  assert.equal(references.value.length, 1, '看得见的是选中的那一条')
  assert.equal(references.value[0].path, 'c.java')
  assert.deepEqual(referenceTabs.value.map(tab => tab.count), [2, 1], '每条各自记自己的条数')
})

test('没开"新标签"时，第二条顶替选中的那条（与 IDEA 同一默认）', () => {
  finishReferences(startReferences('alpha', 'A#alpha'), [loc('a.java')])
  finishReferences(startReferences('beta', 'B#beta'), [loc('c.java')])
  assert.equal(referenceTabs.value.length, 1, '默认不开新标签 ⇒ 列表里始终一条')
  assert.equal(referenceTabs.value[0].label, '对“beta”的引用')
})

test('开关打开（Open Results in New Tab）才并排两条', () => {
  referencesInNewTab.value = true
  finishReferences(startReferences('alpha', 'A#alpha'), [loc('a.java')])
  finishReferences(startReferences('beta', 'B#beta'), [loc('c.java')])
  assert.deepEqual(referenceTabs.value.map(tab => tab.label), ['对“alpha”的引用', '对“beta”的引用'])
})

test('空结果不留一条空标签', () => {
  const search = startReferences('alpha', 'A#alpha')
  assert.equal(hasReferences.value, true, '搜索期间就该看见这一行（还在跑）')
  assert.equal(referenceTabs.value[0].searching, true)
  assert.equal(finishReferences(search, []), false)
  assert.equal(referenceTabs.value.length, 0, '"没有找到引用"由通知说，不占一行标签')
})

test('失败的搜索同样不留"正在搜索"的那条', () => {
  const search = startReferences('alpha', 'A#alpha')
  failReferences(search)
  assert.equal(referenceTabs.value.length, 0)
})

test('钉住当前结果：下一次搜索只能另开一行', () => {
  finishReferences(startReferences('alpha', 'A#alpha'), [loc('a.java')])
  togglePinReferences()
  assert.equal(referenceTabs.value[0].pinned, true)
  finishReferences(startReferences('beta', 'B#beta'), [loc('c.java')])
  assert.deepEqual(referenceTabs.value.map(tab => tab.label), ['对“alpha”的引用', '对“beta”的引用'])
})

test('切到别条再看：references 跟着选中的那条走', () => {
  referencesInNewTab.value = true
  const a = startReferences('alpha', 'A#alpha'); finishReferences(a, [loc('a.java')])
  const b = startReferences('beta', 'B#beta'); finishReferences(b, [loc('c.java'), loc('d.java')])
  selectReferences(a.id)
  assert.equal(references.value.length, 1)
  assert.equal(referenceTabs.value.find(tab => tab.id === a.id).selected, true)
  selectReferences(999999)
  assert.equal(referenceTabs.value.find(tab => tab.selected).id, a.id, '不存在的 id 不改选中（还停在 alpha 上）')
})

test('关闭：关掉选中的那条会退回邻居，关掉别条不动选中', () => {
  referencesInNewTab.value = true
  const a = startReferences('alpha', 'A#alpha'); finishReferences(a, [loc('a.java')])
  const b = startReferences('beta', 'B#beta'); finishReferences(b, [loc('c.java')])
  closeReferences(a.id)                       // b 是选中的，关的是别条
  assert.deepEqual(referenceTabs.value.map(tab => tab.id), [b.id])
  assert.equal(references.value[0].path, 'c.java')
  closeReferences(b.id)                       // 现在关选中的
  assert.equal(referenceTabs.value.length, 0)
  assert.equal(hasReferences.value, false)
})

test('关闭中间那条时选中位不动：邻居接上，不清空', () => {
  referencesInNewTab.value = true
  const a = startReferences('a', 'A'); finishReferences(a, [loc('a.java')])
  const b = startReferences('b', 'B'); finishReferences(b, [loc('b.java')])
  const c = startReferences('c', 'C'); finishReferences(c, [loc('c.java')])
  selectReferences(b.id)
  closeReferences(b.id)
  assert.equal(references.value[0].path, 'c.java', '取后一条，没有才取前一条')
  selectReferences(a.id)
  closeReferences(a.id)
  assert.equal(references.value[0].path, 'c.java')
})

test('关闭其他/关闭全部按**条目**收，返回被收的 id 给宿主清自己的状态', () => {
  referencesInNewTab.value = true
  const a = startReferences('a', 'A'); finishReferences(a, [loc('a.java')])
  const b = startReferences('b', 'B'); finishReferences(b, [loc('b.java')])
  assert.deepEqual(closeOtherReferences(), [a.id], '选中的是 b，那就收 a')
  assert.deepEqual(referenceTabs.value.map(tab => tab.id), [b.id])
  const c = startReferences('c', 'C'); finishReferences(c, [loc('c.java')])
  assert.deepEqual(closeAllReferences().sort(), [b.id, c.id])
  assert.equal(referenceTabs.value.length, 0)
})

test('标签与面板标题带上符号名，两个槽都不留空', () => {
  finishReferences(startReferences('foo', 'com.example.Bar#foo'), [loc('a.java')])
  assert.equal(referenceTabs.value[0].label, '对“foo”的引用')
  assert.equal(referenceTabs.value[0].tooltip, 'com.example.Bar#foo 在项目文件中')
})
