// 判据 · **Ctrl+Tab 切换器**（`src/switcher.ts` 纯模型 + `src/switcherHost.ts` 状态机）——
// 上游 `Switcher.kt` / `SwitcherActions.kt` / `SwitcherSpeedSearch.kt`
// （`platform/platform-impl/src/com/intellij/ide/actions/`）与 `frontendSwitcherItemsCollector.kt`。
//
// 钉四件事：
//   ① 条目收集：编辑器选择历史优先、去重、到 30 停；多于一个编辑器就直接返回（不混最近文件）；
//      否则按 `getRecentFiles` 的口径补最近文件并倒序 append；
//   ② 初始选中：正向找第一个不是当前标签的条目（反向从尾找）—— 按一下松手 = 切到上一个文件；
//   ③ 走位：越界在文件表与工具窗口表之间切换；单表时环绕；
//   ④ 速度搜索按前缀过滤（title/subtitle 大小写不敏感），过滤后光标夹回表内；
//      提交（Ctrl 松手）真的把条目交给 commit，取消（Esc）什么都不做。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SWITCHER_ELEMENTS_LIMIT, baseNameOf, collectSwitcherItems, currentSwitcherItem, filterSwitcherItems,
  initialSwitcherIndex, mergeRecentWithOpen, switcherStep, toolWindowMnemonic,
} from '../src/switcher.ts'
import { createSwitcherHost } from '../src/switcherHost.ts'

const fileItem = (path, kind = 'recent') => ({ id: path, kind, title: baseNameOf(path), subtitle: path, path })

test('显示名：两种分隔符都认', () => {
  assert.equal(baseNameOf('src/App.vue'), 'App.vue')
  assert.equal(baseNameOf('src\\components\\App.vue'), 'App.vue')
  assert.equal(baseNameOf('App.vue'), 'App.vue')
  assert.equal(baseNameOf(''), '')
})

test('getRecentFiles 口径：打开但不在最近里的文件插到第一个命中的打开文件之后', () => {
  assert.deepEqual(mergeRecentWithOpen(['b', 'c'], ['c', 'b']), ['b', 'c'], '最近里已含两个打开文件，不新增')
  assert.deepEqual(mergeRecentWithOpen(['b', 'c'], ['a', 'b']), ['a', 'b', 'c'], 'a 插到第一个命中（b）之前')
  assert.deepEqual(mergeRecentWithOpen(['b', 'c'], ['a']), ['a', 'b', 'c'], '没有命中就插到最前')
  assert.deepEqual(mergeRecentWithOpen([], ['a']), ['a'])
})

test('条目收集：编辑器优先、去重、到 30 停；多于一个编辑器就不混最近文件', () => {
  const many = Array.from({ length: 40 }, (_, i) => `f${i}.ts`)
  const capped = collectSwitcherItems({ openEditors: many, recentFiles: ['recent.ts'] })
  assert.equal(capped.items.length, SWITCHER_ELEMENTS_LIMIT, '文件表上限 30')
  assert.equal(capped.items[0].kind, 'editor')

  const two = collectSwitcherItems({ openEditors: ['a.ts', 'b.ts'], recentFiles: ['z.ts'] })
  assert.deepEqual(two.items.map(i => i.path), ['a.ts', 'b.ts'], '两个编辑器 ⇒ 不再补最近文件')

  const one = collectSwitcherItems({ openEditors: ['p1.ts'], recentFiles: ['p0.ts', 'p1.ts', 'p2.ts'] })
  assert.deepEqual(one.items.map(i => i.path), ['p1.ts', 'p2.ts', 'p0.ts'], '一个编辑器 ⇒ 倒序补最近，已存在的去重')
  assert.equal(one.items[0].kind, 'editor')
  assert.equal(one.items[1].kind, 'recent')

  const none = collectSwitcherItems({ openEditors: [], recentFiles: ['r1.ts', 'r2.ts'] })
  assert.deepEqual(none.items.map(i => i.path), ['r2.ts', 'r1.ts'], '没有编辑器 ⇒ 全是最近（倒序）')
})

test('onlyEdited 复选框：最近那一段改用「已编辑」集合', () => {
  const list = collectSwitcherItems({ openEditors: [], recentFiles: ['r1.ts', 'r2.ts'], onlyEditedFiles: ['e1.ts'] })
  assert.deepEqual(list.items.map(i => i.path), ['e1.ts'])
})

test('工具窗口助记符：首字母大写优先，否则按序号（getIndexShortcut）', () => {
  assert.equal(toolWindowMnemonic('Project', 0), 'P')
  assert.equal(toolWindowMnemonic('git Commits', 0), 'C', '首个大写字母')
  assert.equal(toolWindowMnemonic('commit', 1), (2).toString(2).toUpperCase(), '小写没有大写字母 ⇒ 退序号')
  assert.equal(toolWindowMnemonic('commit', 40), undefined, '超出 0..35 不给助记符')
})

test('初始选中：正向找第一个不是当前标签的条目，反向从尾找', () => {
  const items = ['a.ts', 'b.ts', 'c.ts'].map(path => fileItem(path))
  assert.equal(initialSwitcherIndex(items, 'a.ts', true), 1, '正向跳过当前')
  assert.equal(initialSwitcherIndex(items, 'a.ts', false), 2, '反向从尾')
  assert.equal(initialSwitcherIndex(items, 'z.ts', true), 0)
  assert.equal(initialSwitcherIndex(items, 'z.ts', false), 2)
  assert.equal(initialSwitcherIndex([fileItem('a.ts')], 'a.ts', true), -1, '全是当前标签 ⇒ -1')
})

test('走位：越界在两张表之间切换，单表时环绕', () => {
  assert.deepEqual(switcherStep({ list: 'files', index: 2 }, 3, 2, true), { list: 'toolwindows', index: 0 }, '文件表走到底 ⇒ 切工具窗口表头')
  assert.deepEqual(switcherStep({ list: 'toolwindows', index: 1 }, 3, 2, true), { list: 'files', index: 0 }, '工具窗口表走到底 ⇒ 回文件表头')
  assert.deepEqual(switcherStep({ list: 'files', index: 0 }, 3, 2, false), { list: 'toolwindows', index: 1 }, '反向越界 ⇒ 另一张表尾')
  assert.deepEqual(switcherStep({ list: 'files', index: 2 }, 3, 0, true), { list: 'files', index: 0 }, '没有工具窗口 ⇒ 单表环绕')
  assert.deepEqual(switcherStep({ list: 'files', index: 1 }, 3, 2, true), { list: 'files', index: 2 }, '正常前进')
})

test('速度搜索：前缀过滤 title/subtitle、大小写不敏感、空前缀不过滤', () => {
  const items = [fileItem('src/App.vue'), fileItem('src/main.ts'), { id: 'git', kind: 'toolwindow', title: 'Git', subtitle: 'git' }]
  assert.deepEqual(filterSwitcherItems(items, '').length, 3)
  assert.deepEqual(filterSwitcherItems(items, 'app').map(i => i.id), ['src/App.vue'], '按 title 匹配、忽略大小写')
  assert.deepEqual(filterSwitcherItems(items, 'src/').map(i => i.id), ['src/App.vue', 'src/main.ts'], '按 subtitle 匹配')
  assert.deepEqual(filterSwitcherItems(items, 'nope'), [])
})

test('currentSwitcherItem：按光标取条目，越界给 null', () => {
  const list = { items: [fileItem('a.ts')], toolWindows: [{ id: 'git', kind: 'toolwindow', title: 'Git', subtitle: 'git' }] }
  assert.equal(currentSwitcherItem(list, { list: 'files', index: 0 }).id, 'a.ts')
  assert.equal(currentSwitcherItem(list, { list: 'toolwindows', index: 0 }).id, 'git')
  assert.equal(currentSwitcherItem(list, { list: 'files', index: 5 }), null)
})

test('宿主状态机：open → go → 速度搜索夹回 → 提交/取消', () => {
  const committed = []
  const host = createSwitcherHost({
    sources: () => ({
      openEditors: [],
      recentFiles: ['a.ts', 'b.ts', 'c.ts'],
      currentPath: 'c.ts',
      toolWindows: [{ id: 'git', title: 'Git' }],
    }),
    commit: item => committed.push(item.id),
  })
  assert.equal(host.open.value, false)
  // 打开：初始选中"不是当前标签"的第一个（最近列表倒序后 c.ts 在首，跳过它 ⇒ 选中 b.ts）。
  host.start(true)
  assert.equal(host.open.value, true)
  assert.notEqual(host.current.value.path, 'c.ts')
  // 走位：从初始索引再连按 Tab 两次 ⇒ 文件表（3 项）走完，跨到工具窗口表。
  host.go(true)
  host.go(true)
  assert.equal(host.cursor.value.list, 'toolwindows', '文件表走完 ⇒ 工具窗口表')
  assert.equal(host.current.value.id, 'git')
  // 速度搜索：回到文件表、只剩 a.ts，光标夹回表内。
  host.cursor.value = { list: 'files', index: 0 }
  host.setQuery('a.ts')
  assert.equal(host.files.value.length, 1)
  assert.ok(host.cursor.value.index < 1)
  // 提交：把当前条目交给 commit 并关闭。
  const chosen = host.commitSelection()
  assert.equal(host.open.value, false)
  assert.equal(committed.length, 1)
  assert.equal(committed[0], chosen.id)
  assert.equal(chosen.path, 'a.ts')
})

test('宿主：取消不提交；onlyEdited 切换重取来源', () => {
  const committed = []
  let only = false
  const host = createSwitcherHost({
    sources: () => ({ openEditors: [], recentFiles: ['r1.ts'], onlyEditedFiles: ['e1.ts'], toolWindows: [] }),
    commit: item => committed.push(item.id),
  })
  host.start(true)
  host.cancel()
  assert.equal(host.open.value, false)
  assert.deepEqual(committed, [], '取消不提交')

  host.toggleOnlyEdited()
  only = host.onlyEdited.value
  assert.equal(only, true)
  assert.deepEqual(host.files.value.map(i => i.path), ['e1.ts'], '只看已编辑时来源换成 changedFiles')
})
