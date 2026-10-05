// 欢迎页最近项目列表的选择与键盘规则（`src/welcomeRowSelection.ts`）。
// 2026-10-06 桶 14c 从 `src/components/WelcomePage.vue` 搬出来时才有的判据；
// 上游坐标（RecentProjectFilteringTree.kt:189-191 的 ENTER / ALT+DELETE、SHIFT/CTRL 进
// SelectionModel、RemoveSelectedProjectsAction 删的是选区）写在新模块的文件头与函数注释里。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deleteTargets, isRowDeleteKey, searchKeyAction, selectionAfterClick,
} from '../src/welcomeRowSelection.ts'

const mod = (extra = {}) => ({ shiftKey: false, ctrlKey: false, metaKey: false, ...extra })
const LIST = ['/a', '/b', '/c', '/d']

test('裸点击清空选区，但选区本来就空时返回同一个 Set（不触发无谓的重渲染）', () => {
  const empty = new Set()
  const plain = selectionAfterClick(LIST, new Set(['/a']), '/a', '/b', mod())
  assert.deepEqual([...plain.selected], [], '裸点击把选区清干净')
  assert.equal(plain.lastClicked, '/b', '锚点跟着走')
  const again = selectionAfterClick(LIST, empty, '/b', '/c', mod())
  assert.equal(again.selected, empty, 'size 为 0 时不换对象')
})

test('Shift 段选：从锚点到这一行的闭区间，正着选与倒着选一样', () => {
  const forward = selectionAfterClick(LIST, new Set(), '/a', '/c', mod({ shiftKey: true }))
  assert.deepEqual([...forward.selected], ['/a', '/b', '/c'], '闭区间：两端都在')
  assert.equal(forward.lastClicked, '/a', '段选不动锚点（连着按 Shift 选同一段）')
  const backward = selectionAfterClick(LIST, new Set(), '/c', '/a', mod({ shiftKey: true }))
  assert.deepEqual([...backward.selected], ['/a', '/b', '/c'], '倒着拖也是同一区间')
  const added = selectionAfterClick(LIST, new Set(['/d']), '/b', '/c', mod({ shiftKey: true }))
  assert.deepEqual([...added.selected].sort(), ['/b', '/c', '/d'], '段选是并入，不是替换')
})

test('Shift 的锚点被过滤掉了（或从没点过）→ 退化成单行切换', () => {
  const hidden = selectionAfterClick(LIST, new Set(), '/zzz', '/c', mod({ shiftKey: true }))
  assert.deepEqual([...hidden.selected], ['/c'])
  assert.equal(hidden.lastClicked, '/c', '退化那一支把锚点挪过来了')
  const noAnchor = selectionAfterClick(LIST, new Set(['/a']), '', '/b', mod({ shiftKey: true }))
  assert.deepEqual([...noAnchor.selected], ['/a', '/b'])
})

test('Ctrl / Cmd 单行增删（toggle），两个修饰键同权', () => {
  const added = selectionAfterClick(LIST, new Set(['/a']), '/a', '/c', mod({ ctrlKey: true }))
  assert.deepEqual([...added.selected].sort(), ['/a', '/c'])
  assert.equal(added.lastClicked, '/c')
  const removed = selectionAfterClick(LIST, added.selected, '/c', '/c', mod({ ctrlKey: true }))
  assert.deepEqual([...removed.selected], ['/a'], '再按一次是取消这一行')
  const meta = selectionAfterClick(LIST, new Set(), '/a', '/b', mod({ metaKey: true }))
  assert.deepEqual([...meta.selected], ['/b'], 'macOS 的 Cmd 与 Ctrl 同义')
})

test('Delete 与 Backspace 都算「移除这一行」', () => {
  assert.equal(isRowDeleteKey('Delete'), true)
  assert.equal(isRowDeleteKey('Backspace'), true)
  assert.equal(isRowDeleteKey('Enter'), false)
})

test('删除作用在哪些行：焦点行在选区里 = 整片选区，否则只有它自己；顺序跟着可见列表', () => {
  const rows = LIST.map(path => ({ path }))
  const selected = deleteTargets(rows, new Set(['/c', '/a']), '/a')
  assert.deepEqual(selected.map(r => r.path), ['/a', '/c'], '按列表顺序，不按点击顺序')
  const single = deleteTargets(rows, new Set(['/c']), '/a')
  assert.deepEqual(single.map(r => r.path), ['/a'], '焦点行不在选区里就只删它')
  assert.deepEqual(deleteTargets(rows, new Set(), '/a').map(r => r.path), ['/a'])
  const gone = deleteTargets(rows, new Set(['/a', '/c']), '/a')
  assert.deepEqual(gone.map(r => r.path), ['/a', '/c'])
  assert.deepEqual(deleteTargets([], new Set(['/a']), '/a'), [], '被过滤掉的行不会被删（选区里残留的路径不背锅）')
})

test('搜索框：ENTER 打开可用项；不可用 / 忙时吃掉按键但什么都不做；ALT+DELETE 才删记录', () => {
  const live = { available: true }
  const missing = { available: false }
  assert.equal(searchKeyAction('Enter', false, live, false), 'open')
  assert.equal(searchKeyAction('Enter', false, live, true), 'noop', '忙的时候 ENTER 不该落到表单上')
  assert.equal(searchKeyAction('Enter', false, missing, false), 'noop')
  assert.equal(searchKeyAction('Delete', true, live, false), 'remove', '删记录不受 busy 影响：路径没了也删得掉')
  assert.equal(searchKeyAction('Delete', false, live, false), null, '没有 Alt 的 DELETE 走的是行上的那一条')
  assert.equal(searchKeyAction('Backspace', true, live, false), null, '搜索框里 Backspace = 退格，不能被吞')
  assert.equal(searchKeyAction('Enter', false, undefined, false), null, '没有当前行时什么都不做')
})
