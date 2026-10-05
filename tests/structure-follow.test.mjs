// 结构视图补上的两条：编辑光标 ↔ 树选中的互相跟随、按可见性排序。
// 上游坐标见 src/structureFollow.ts 与 src/outlineView.ts 的文件头。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { arrange, caretSymbolInTree, outlineKey, treeOf } from '../src/outlineView.ts'
import { ACCESS_LEVEL, shouldRevealInEditor, visibilityAccessLevel } from '../src/structureFollow.ts'

const sym = (name, kind, startLine, endLine, startChar = 0, detail = '') => ({
  name, kind, detail, startLine, startChar, endLine, endChar: startChar + name.length,
})

const members = [
  sym('Class', 5, 0, 20, 0, 'public class Class'),
  sym('priv', 6, 2, 3, 4, 'private void priv()'),
  sym('pub', 6, 5, 6, 4, 'public void pub()'),
  sym('prot', 6, 8, 9, 4, 'protected void prot()'),
  sym('pkg', 6, 11, 12, 4, 'package-private void pkg()'),
  sym('unknown', 6, 14, 15, 4, 'void unknown()'),
]
const tree = treeOf(members)
const names = list => list.map(entry => entry.symbol.name)

test('可见性档位照 PsiUtil 的四档判，判不出的是 unknown', () => {
  assert.equal(visibilityAccessLevel('public static void main()'), ACCESS_LEVEL.public)
  assert.equal(visibilityAccessLevel('protected int counter'), ACCESS_LEVEL.protected)
  assert.equal(visibilityAccessLevel('package-private void pkg()'), ACCESS_LEVEL.packageLocal)
  assert.equal(visibilityAccessLevel('private final String x'), ACCESS_LEVEL.private)
  assert.equal(visibilityAccessLevel('void nothing()'), ACCESS_LEVEL.unknown)
  // private 短路优先（PsiUtil.java:623-634 的判定次序：先 private，再包级，再 protected）。
  assert.equal(visibilityAccessLevel('public private'), ACCESS_LEVEL.private)
  // internal（Kotlin/Swift）在本仓落到包级档，理由写在模块头。
  assert.equal(visibilityAccessLevel('internal fun helper()'), ACCESS_LEVEL.packageLocal)
})

test('按可见性排序：公开在前、判不出的排最后，同级保持原序', () => {
  const rows = arrange(tree, { sort: false, flat: false, group: false, visibility: true, filter: '' })
  assert.deepEqual(names(rows), ['Class', 'pub', 'prot', 'pkg', 'priv', 'unknown'])
})

test('可见性与名称同时开时，名称就是同级的次序', () => {
  const tie = [
    sym('C', 5, 0, 9, 0, 'public class C'),
    sym('bbb', 6, 1, 2, 2, 'public void bbb()'),
    sym('aaa', 6, 3, 4, 2, 'public void aaa()'),
    sym('zzz', 6, 6, 7, 2, 'private void zzz()'),
  ]
  const rows = arrange(treeOf(tie), { sort: true, flat: false, group: false, visibility: true, filter: '' })
  assert.deepEqual(names(rows), ['C', 'aaa', 'bbb', 'zzz'])
})

test('不开可见性时顺序一个字都不变（不影响既有断言）', () => {
  assert.deepEqual(names(arrange(tree, { sort: false, flat: false, group: false, filter: '' })),
    ['Class', 'priv', 'pub', 'prot', 'pkg', 'unknown'])
})

test('光标命中最深的符号，祖先键一并给出以便展开', () => {
  const nested = [
    sym('Outer', 5, 0, 30, 0, 'class Outer'),
    sym('Inner', 5, 2, 25, 2, 'class Inner'),
    sym('work', 6, 10, 14, 4, 'void work()'),
  ]
  const match = caretSymbolInTree(treeOf(nested), 12, 6)
  assert.ok(match)
  assert.equal(match.key, outlineKey(nested[2]))
  assert.deepEqual(match.ancestors, [outlineKey(nested[0]), outlineKey(nested[1])])
  assert.equal(match.lineOnly, false)
})

test('光标停在声明行的关键字/缩进上仍命中那个符号', () => {
  // members[2] = pub：startLine 5 / startChar 4（声明名那一列），光标在第 5 行第 0 列。
  const match = caretSymbolInTree(tree, 5, 0)
  assert.ok(match, '第 5 行的 pub 要能被找到')
  assert.equal(match.key, outlineKey(members[2]))
  assert.equal(match.lineOnly, false)
})

test('同行越过符号终点时不认它，退化成按行才认（不空手）', () => {
  const leaf = [sym('only', 6, 3, 3, 4, 'void only()')]
  // 终点在第 3 行第 8 列，光标在第 3 行第 20 列：按列判定不命中，按行判定兜底。
  assert.equal(caretSymbolInTree(treeOf(leaf), 3, 20).lineOnly, true)
  assert.equal(caretSymbolInTree(treeOf(leaf), 3, 6).lineOnly, false)
})

test('光标不在任何符号里就什么都不选', () => {
  assert.equal(caretSymbolInTree(tree, 40, 0), null)
})

test('跟随到源码关掉时，选中同一行不再发跳转', () => {
  assert.equal(shouldRevealInEditor(true, 'a:1:0:2:0', ''), true)
  assert.equal(shouldRevealInEditor(true, 'a:1:0:2:0', 'a:1:0:2:0'), false, '重复选中不跳')
  assert.equal(shouldRevealInEditor(false, 'a:1:0:2:0', ''), false, '开关关掉时不跳（双击才跳）')
  assert.equal(shouldRevealInEditor(true, '', 'x'), false, '没有选中就不跳')
})

test('面板真的把两个跟随开关和可见性排序接上了（不是死代码）', () => {
  const panel = readFileSync('src/components/OutlinePanel.vue', 'utf8')
  // 钉**挂点**（事件绑定 / 调用表达式），不是 import 的符号名。
  assert.match(panel, /@click="autoscrollFromSource = !autoscrollFromSource"/, '从源码跟随的开关可切')
  assert.match(panel, /@click="autoscrollToSource = !autoscrollToSource"/, '到源码跟随的开关可切')
  assert.match(panel, /@click="sortByVisibility = !sortByVisibility"/, '可见性排序的开关可切')
  assert.match(panel, /visibility: sortByVisibility\.value/, '排序开关进了 arrange 的入参')
  assert.match(panel, /caretSymbolInTree\(tree\.value, props\.source\.line/, '光标→选中的判定接在面板上')
  assert.match(panel, /shouldRevealInEditor\(autoscrollToSource\.value/, '选中→跳转的判定接在面板上')
  assert.match(panel, /scrollRowIntoView\(match\.key\)/, '跟随时要把那一行滚进视野')
  assert.match(panel, /@dblclick="selectRow\(entry, true\)"/, '关掉跟随时双击仍跳源码')
})
