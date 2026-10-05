// 「将目录标记为」那一组（上游 `MarkRootGroup`）的成员、次序、可见性与写回。
// 规则推导与全部上游坐标都在 `src/pvMarkRoots.ts` 的模块头；这一文件只把**用户看得见的那几件事**钉住：
//   · 组标题按选区里有没有目录换成两种说法（`MarkRootGroup.java:16-22`）；
//   · 「已排除」与「未排除」互斥，出现哪一个由当前排除态决定
//     （`MarkAsContentRootAction.kt:25-29` 要求「当前已被排除」）；
//   · 「取消标记」的标题是动态的（`UnmarkRootAction.java:29-41` + zh `LangBundle` 的三个键）；
//   · 成员顺序照 `intellij.platform.customization.min.xml:62-65`；
//   · 写回的只有本仓真有的那两份表（`ProjectSettings.excludedDirs` / `java.sourcePaths`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isFilesOnlySelection, markRootGroupTitle, markRootItems, markRootNotice, markRootPatch } from '../src/pvMarkRoots.ts'

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8')
const directory = (path, name = path.split('/').at(-1)) => ({ path, name, kind: 'directory' })
const file = (path, name = path.split('/').at(-1)) => ({ path, name, kind: 'file' })
const state = (over = {}) => ({ excludedDirs: [], sourcePaths: [], ...over })

test('组标题：有目录是「将目录标记为」，全是文件才换「将文件标记为」（MarkRootGroup.java:16-32）', () => {
  assert.equal(markRootGroupTitle([directory('src')]), '将目录标记为')
  assert.equal(markRootGroupTitle([file('a.ts')]), '将文件标记为')
  assert.equal(markRootGroupTitle([directory('src'), file('a.ts')]), '将目录标记为', '混着文件的选区仍算目录那一种')
  assert.equal(markRootGroupTitle([]), '将目录标记为', '空选区不是 files-only')
  assert.equal(isFilesOnlySelection([file('a.ts'), file('b.ts')]), true)
  assert.equal(isFilesOnlySelection([]), false)
})

test('成员与可见性：已排除与未排除互斥，顺序照 customization.min.xml:62-65', () => {
  assert.deepEqual(markRootItems([directory('src')], state()), [{ id: 'exclude', label: '已排除' }])
  assert.deepEqual(markRootItems([directory('src')], state({ excludedDirs: ['src'] })),
    [{ id: 'include', label: '未排除' }, { id: 'unmark', label: '取消排除' }])
  // 被祖先的名字排除掉的也算「当前已排除」（本仓的 excludedDirs 是目录名表，excludedByNames 的口径）
  assert.deepEqual(markRootItems([directory('a/build/out')], state({ excludedDirs: ['build'] })),
    [{ id: 'include', label: '未排除' }, { id: 'unmark', label: '取消排除' }])
  // 只有源根标记 ⇒ 「取消标记为源代码根目录」；两种都有 ⇒ 「取消标记」（mark.as.unmark.several）
  assert.deepEqual(markRootItems([directory('src')], state({ sourcePaths: ['src'] })),
    [{ id: 'exclude', label: '已排除' }, { id: 'unmark', label: '取消标记为源代码根目录' }])
  assert.deepEqual(markRootItems([directory('src')], state({ excludedDirs: ['src'], sourcePaths: ['src'] })),
    [{ id: 'include', label: '未排除' }, { id: 'unmark', label: '取消标记' }])
  // 纯文件选区：本仓的两种标记都作用在目录上 ⇒ 整格没有项（不放假控件）
  assert.deepEqual(markRootItems([file('a.ts')], state({ excludedDirs: ['src'] })), [])
  assert.deepEqual(markRootItems([], state()), [])
  // 混着「已排除 / 未排除」的多目录选区：上游那三条 `all{}` 判据一个都不满足 ⇒ 空表（整格不画）
  assert.deepEqual(markRootItems([directory('a/x'), directory('a/y')], state({ excludedDirs: ['x'] })), [])
  assert.deepEqual(markRootItems([directory('a/x'), directory('a/y')], state({ excludedDirs: ['x', 'y'] })),
    [{ id: 'include', label: '未排除' }, { id: 'unmark', label: '取消排除' }], '全部已排除才轮到「未排除」')
})

test('写回的表：排除按目录名、取消按名字与源根路径（本仓的后端形状，见模块头）', () => {
  const patch = markRootPatch('exclude', [directory('src'), directory('docs')], state({ excludedDirs: ['build'] }))
  assert.deepEqual(patch.excludedDirs, ['build', 'src', 'docs'])
  assert.deepEqual(patch.changed, ['excludedDirs'])

  const noop = markRootPatch('exclude', [directory('src')], state({ excludedDirs: ['src'] }))
  assert.deepEqual(noop.changed, [], '已经排除的不再塞一遍')

  const nested = markRootPatch('exclude', [directory('a/build')], state())
  assert.deepEqual(nested.excludedDirs, ['build'], '写进去的是目录名，不是路径')

  const include = markRootPatch('include', [directory('a/build/out')], state({ excludedDirs: ['build', 'dist'] }))
  assert.deepEqual(include.excludedDirs, ['dist'], '取消的是命中的那一个名字')
  assert.deepEqual(include.changed, ['excludedDirs'])

  const unmark = markRootPatch('unmark', [directory('src')], state({ excludedDirs: ['src'], sourcePaths: ['src'] }))
  assert.deepEqual(unmark.excludedDirs, [])
  assert.deepEqual(unmark.sourcePaths, [])
  assert.deepEqual(unmark.changed, ['excludedDirs', 'sourcePaths'])

  const unmarkChild = markRootPatch('unmark', [directory('src/main')], state({ sourcePaths: ['src'] }))
  assert.deepEqual(unmarkChild.sourcePaths, [], '源根本身被祖先那条命中时也一起摘掉')
  assert.deepEqual(unmarkChild.changed, ['sourcePaths'])

  const nothing = markRootPatch('unmark', [directory('src')], state())
  assert.deepEqual(nothing.changed, [])
  assert.equal(markRootNotice('unmark', [directory('src')], []), '没有需要更改的标记。')
})

test('提示语说的是后果与找回路径（本仓的排除在设置 → 项目结构 里可改）', () => {
  assert.equal(markRootNotice('exclude', [directory('src')], ['excludedDirs']), '已把 src 按名字排除（设置 → 项目结构 里可改回）')
  assert.equal(markRootNotice('include', [directory('src'), directory('docs')], ['excludedDirs']), '已取消排除 2 个目录')
})

test('接线：treeActions 是这一格的宿主入口，写回走 project.settings.update', () => {
  const actions = read('../src/treeActions.ts')
  assert.match(actions, /from '.\/pvMarkRoots\.ts'/, '模型被生产代码消费，不是只过自己测试的死模块')
  assert.match(actions, /function markRootMenu\(entry\?: Entry\)/)
  assert.match(actions, /async function applyMarkRoot\(command: MarkRootCommand, entry\?: Entry\)/)
  assert.match(actions, /markRootPatch\(command, \[markRootTarget\(target\)\], state\)/)
  assert.match(actions, /'project\.settings\.update', body/)
  assert.match(actions, /markRootMenu, applyMarkRoot,/, '两个入口都从 createTreeActions 交回宿主')
  assert.match(actions, /refreshTree\?: \(\) => unknown/, '改完排除要重取目录树（宿主接线请求 W2）')
  const model = read('../src/pvMarkRoots.ts')
  assert.match(model, /import \{ excludedByNames \} from '.\/projectRoots\.ts'/, '排除口径复用本仓唯一的那把尺子，不再自己写一遍')
})
