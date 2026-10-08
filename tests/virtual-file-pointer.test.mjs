// 判据 · pf/vfs 的**虚拟文件指针**（`VirtualFilePointer` / `VirtualFilePointerManager` 一族）。
//
// 钉四件事：
//   ① `remapPointerPath` 的改名对账：目录改名带整棵子树、只按段边界匹配、无关路径不动；
//   ② `create`/`duplicate`/`dispose` 的身份语义（同路径同 kind 复用同一指针）；
//   ③ `rename` 广播两档回调（`beforeValidityChanged` → `validityChanged`），且只在结论真变时发；
//   ④ `refresh` 按注入的 exists 重判有效性并广播变化的那批。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createVirtualFilePointerManager,
  pointerFileName,
  remapPointerPath,
  remapPointerPaths,
} from '../src/virtualFilePointer.ts'

test('remapPointerPath：目录改名带上整棵子树，只按段边界匹配', () => {
  assert.equal(remapPointerPath('src/a/b.ts', { from: 'src', to: 'lib' }), 'lib/a/b.ts')
  assert.equal(remapPointerPath('src', { from: 'src', to: 'lib' }), 'lib', '目录自己也要改')
  assert.equal(remapPointerPath('src2/x.ts', { from: 'src', to: 'lib' }), 'src2/x.ts', 'src2 不该被 src 带走')
  assert.equal(remapPointerPath('other/x.ts', { from: 'src', to: 'lib' }), 'other/x.ts')
  // 尾斜杠与反斜杠都归一。
  assert.equal(remapPointerPath('src\\a\\b.ts', { from: 'src/', to: 'lib/' }), 'lib/a/b.ts')
})

test('remapPointerPaths：连续改名按顺序叠加', () => {
  assert.deepEqual(
    remapPointerPaths(['src/a.ts', 'src/b.ts', 'keep/c.ts'], [
      { from: 'src', to: 'lib' },
      { from: 'lib/b.ts', to: 'lib/bb.ts' },
    ]),
    ['lib/a.ts', 'lib/bb.ts', 'keep/c.ts'],
  )
})

test('pointerFileName：取末段（尾斜杠不算）', () => {
  assert.equal(pointerFileName('a/b/c.ts'), 'c.ts')
  assert.equal(pointerFileName('dir/sub/'), 'sub')
  assert.equal(pointerFileName('top.ts'), 'top.ts')
})

test('create：同路径同 kind 复用同一指针；不同 kind 是两个指针', () => {
  const manager = createVirtualFilePointerManager(() => true)
  const a = manager.create('src/a.ts')
  const b = manager.create('src/a.ts')
  assert.equal(a.isValid(), b.isValid())
  assert.equal(manager.pointers().length, 1, '同键复用')
  manager.create('src/a.ts', 'directory')
  assert.equal(manager.pointers().length, 2, 'kind 不同 ⇒ 两个指针')
})

test('duplicate 造新对象、dispose 解绑', () => {
  const manager = createVirtualFilePointerManager(() => true)
  const a = manager.create('src/a.ts')
  const copy = manager.duplicate(a)
  assert.equal(copy.path(), 'src/a.ts')
  assert.equal(manager.dispose(copy), true)
  assert.equal(manager.dispose(copy), false, '再删一次没有可删的')
})

test('rename：指针跟着改名走，目录改名带子树', () => {
  const manager = createVirtualFilePointerManager(() => true)
  const inner = manager.create('src/pkg/a.ts')
  const other = manager.create('other/b.ts')
  manager.rename({ from: 'src', to: 'lib' }, () => true)
  assert.equal(inner.path(), 'lib/pkg/a.ts')
  assert.equal(other.path(), 'other/b.ts', '不相关的指针不动')
})

test('rename：只在 isValid 结论真变时广播两档回调', () => {
  // 存在性：改名后旧路径没了（target 不存在），于是 isValid 从 true → false。
  const alive = new Set(['src/a.ts'])
  const manager = createVirtualFilePointerManager(path => alive.has(path))
  const seen = []
  const pointer = manager.create('src/a.ts', 'file', {
    beforeValidityChanged: pointers => seen.push(`before:${pointers.map(item => item.path()).join(',')}`),
    validityChanged: pointers => seen.push(`after:${pointers.map(item => item.path()).join(',')}`),
  })
  assert.equal(pointer.isValid(), true)
  manager.rename({ from: 'src/a.ts', to: 'lib/a.ts' }, path => alive.has(path))
  assert.deepEqual(seen, ['before:lib/a.ts', 'after:lib/a.ts'], '先 before 再 after，且带新路径')
})

test('rename：结论没变就不广播（改名前后都存在）', () => {
  const manager = createVirtualFilePointerManager(() => true)
  let fired = 0
  manager.create('src/a.ts', 'file', { validityChanged: () => { ++fired } })
  manager.rename({ from: 'src/a.ts', to: 'lib/a.ts' }, () => true)
  assert.equal(fired, 0, '两边都存在 ⇒ 有效性没变，不发')
})

test('refresh：按注入的 exists 重判，返回并广播变化的那批', () => {
  const alive = new Set(['a.ts', 'b.ts'])
  const manager = createVirtualFilePointerManager(path => alive.has(path))
  const events = []
  const a = manager.create('a.ts', 'file', { validityChanged: pointers => events.push(pointers.map(item => item.path()).join(',')) })
  manager.create('b.ts')
  alive.delete('a.ts')
  const changed = manager.refresh(path => alive.has(path))
  assert.deepEqual(changed.map(item => item.path()), ['a.ts'], '只有 a 的有效性变了')
  assert.equal(a.isValid(), false)
  assert.deepEqual(events, ['a.ts'])
  // 再刷一次：已经没有变化，不再广播。
  assert.deepEqual(manager.refresh(path => alive.has(path)), [])
  assert.deepEqual(events, ['a.ts'])
})

test('refresh 可只针对一批候选（其余不动）', () => {
  const alive = new Set(['a.ts', 'b.ts'])
  const manager = createVirtualFilePointerManager(path => alive.has(path))
  const a = manager.create('a.ts')
  const b = manager.create('b.ts')
  alive.delete('a.ts')
  alive.delete('b.ts')
  const changed = manager.refresh(path => alive.has(path), [b])
  assert.deepEqual(changed.map(item => item.path()), ['b.ts'], '只重判候选那一批')
  assert.equal(a.isValid(), true, '未列入候选的保持原结论')
  assert.equal(b.isValid(), false)
})

test('fileName 跟着当前路径走', () => {
  const manager = createVirtualFilePointerManager(() => true)
  const pointer = manager.create('src/a.ts')
  assert.equal(pointer.fileName(), 'a.ts')
  manager.rename({ from: 'src/a.ts', to: 'lib/renamed.ts' }, () => true)
  assert.equal(pointer.fileName(), 'renamed.ts')
})

// ── 持有者（2026-10-08 lane pf-vfs）：上游一个指针是**一个实例**，`create`/`duplicate` 各把
// `useCount` 加一（`VirtualFilePointerManagerImpl.java:316`/`:448`），`dispose` 只在计数落到 0
// 时摘节点（同文件 `decrementUsageCount:808-818`）；listener 挂在实例上（`:715-730` 的
// `groupPointersToFire` 把每个 listener 自己那几个指针折成一个数组发出去）。

test('dispose 按持有者解绑：还有别的持有者时条目留着，最后一个走了才摘', () => {
  const manager = createVirtualFilePointerManager(() => true)
  const a = manager.create('src/a.ts')
  const b = manager.duplicate(a)
  assert.equal(manager.pointers().length, 1, '一条目上两个持有者')
  assert.equal(manager.dispose(a), true)
  assert.equal(manager.pointers().length, 1, 'a 走了 b 还在 ⇒ 条目不许摘')
  assert.equal(b.isValid(), true)
  manager.rename({ from: 'src/a.ts', to: 'src/renamed.ts' }, () => true)
  assert.equal(b.path(), 'src/renamed.ts', '剩下的持有者照样跟着改名')
  assert.equal(manager.dispose(b), true)
  assert.equal(manager.pointers().length, 0, '最后一个持有者走了才摘')
  assert.equal(manager.dispose(a), false, '已经解绑过的身份再解一次没有可解的')
})

test('listener 随持有者：解绑掉登记它的那个持有者之后就不再收到广播', () => {
  const alive = new Set(['src/a.ts'])
  const manager = createVirtualFilePointerManager(path => alive.has(path))
  const mine = []
  const theirs = []
  const first = manager.create('src/a.ts', 'file', { validityChanged: () => mine.push('first') })
  manager.create('src/a.ts', 'file', { validityChanged: () => theirs.push('second') })
  assert.equal(manager.dispose(first), true, '解绑 first；条目还在（第二位持有者）')
  alive.delete('src/a.ts')
  const changed = manager.refresh(path => alive.has(path))
  assert.deepEqual(changed.map(item => item.path()), ['src/a.ts'])
  assert.deepEqual(mine, [], '解绑过的持有者不该再收到广播')
  assert.deepEqual(theirs, ['second'], '还在的持有者照收')
})

test('一批改名里每个 listener 只收到自己那几个指针（上游 groupPointersToFire 的分组）', () => {
  const manager = createVirtualFilePointerManager(() => true)
  const seenA = []
  const seenB = []
  manager.create('src/a.ts', 'file', { validityChanged: pointers => seenA.push(pointers.map(item => item.path())) })
  manager.create('src/b.ts', 'file', { validityChanged: pointers => seenB.push(pointers.map(item => item.path())) })
  manager.rename({ from: 'src', to: 'lib' }, () => false)     // 两条都由有效变无效 ⇒ 同一批
  assert.deepEqual(seenA, [['lib/a.ts']], 'A 的 listener 只收到自己那条')
  assert.deepEqual(seenB, [['lib/b.ts']])
})

// ── 接线留痕（2026-10-08 lane pf-vfs）：本模块是**有意未接线**的库（实现与判据都在，持有者在冻结
// 文件/别的族的文件面里）。文件头写明卡点、`.tools/orphan-baseline.txt` 记理由；这一段一旦被悄悄删掉
// 判据就红 —— 接线之后该连它一起改成「已接上」的断言。

test('文件头写明 NOT WIRED YET 与三个持有者面（接线清单的锚点）', () => {
  const source = readFileSync(new URL('../src/virtualFilePointer.ts', import.meta.url), 'utf8')
  assert.match(source, /NOT WIRED YET/)
  for (const consumer of ['src/App.vue', 'src/bookmarks.ts', 'pv/recent'])
    assert.ok(source.includes(consumer), `接线清单要点名 ${consumer}`)
  assert.match(source, /orphan-baseline\.txt/)
})
