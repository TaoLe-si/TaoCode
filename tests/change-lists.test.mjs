// 多变更列表（changelist）模型的判据 —— 上游 `ChangeListManager` / `ChangeList` / `LocalChangeList`，
// 用本仓架构还原（一份「路径 → 列表 id」的归属表 + 具名列表 + 活动列表 + localStorage 持久化）。
//
// 上游形状（逐条核过，注释里带坐标）：
//   · `LocalChangeList`（`platform/vcs-api/shared/src/com/intellij/openapi/vcs/changes/LocalChangeList.java:20-68`）：
//     `getId()` 改名后不变（`:34-37`）、`isDefault()`（`:43`）、`isReadOnly()`（`:45`）、
//     `hasDefaultName()`（`:61-63`，三种默认名 `:24-28`）；
//   · `ChangeListManager`（`platform/vcs-api/src/com/intellij/openapi/vcs/changes/ChangeListManager.java`）：
//     `getDefaultChangeList()`（`:133`）、`getChangeList(id)`（`:158`）、`getChangeLists(change)`（`:161`）、
//     `getChangesIn(dir)`（`:192`）；
//   · 增删改（`platform/vcs-impl/src/com/intellij/openapi/vcs/changes/ChangeListManagerImpl.kt:841-907`）；
//   · 删除语义（`actions/RemoveChangeListAction.kt:46-141`）：只读不许删、非空要确认、
//     删活动列表要换活动列表、删光要新建默认列表、变更**移到活动列表不丢**；
//     文案 `VcsBundle.properties:274-283`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_CHANGE_LIST_NAME, LEGACY_DEFAULT_CHANGE_LIST_NAMES, MOVE_TO_ACTIVE_NOTE,
  addList, canRemoveList, changeListsKey, changesInList, countInList, createChangeListsState, currentList,
  hasDefaultName, listById, listIdOf, moveChanges, parseChangeLists, readChangeLists, removeAllListsQuestion,
  removeList, removeListQuestion, renameList, serializeChangeLists, setComment, setCurrentList, writeChangeLists,
} from '../src/changeLists.ts'

const change = path => ({ path, indexStatus: 'M', workStatus: ' ', staged: false, untracked: false, renameFrom: '' })

test('缺省状态：一个名为 Changes 的列表，它就是活动列表', () => {
  const state = createChangeListsState()
  assert.equal(state.lists.length, 1)
  assert.equal(state.lists[0].name, DEFAULT_CHANGE_LIST_NAME)
  assert.equal(DEFAULT_CHANGE_LIST_NAME, 'Changes', 'VcsBundle.properties:274')
  assert.equal(state.lists[0].isDefault, true)
  assert.equal(currentList(state).id, state.lists[0].id)
  assert.deepEqual(state.assignments, {}, '没有归属条目 = 全在活动列表')
})

test('默认名三种写法都认（hasDefaultName，LocalChangeList.java:61-63）', () => {
  assert.equal(hasDefaultName('Changes'), true)
  assert.equal(hasDefaultName('Default Changelist'), true)
  assert.equal(hasDefaultName('Default'), true)
  assert.equal(LEGACY_DEFAULT_CHANGE_LIST_NAMES.length, 2)
  assert.equal(hasDefaultName('我的重构'), false)
})

test('新建：名字去空白、空名/重名被拒、可选设为活动', () => {
  let state = createChangeListsState()
  assert.equal(addList(state, '   ', ''), null, '空名被拒')
  assert.equal(addList(state, DEFAULT_CHANGE_LIST_NAME, ''), null, '与现有列表重名被拒')
  const made = addList(state, ' 重构 ', '把工具类拆开')
  assert.ok(made)
  assert.equal(made.list.name, '重构', '名字去首尾空白')
  assert.equal(made.list.comment, '把工具类拆开')
  assert.equal(made.list.isDefault, false, '不激活时不是活动列表')
  assert.equal(made.state.current, state.current, '不激活时活动列表不变')
  const activated = addList(made.state, '实验', '', true)
  assert.ok(activated)
  assert.equal(activated.state.current, activated.list.id)
  assert.equal(activated.state.lists.filter(l => l.isDefault).length, 1, '同一时刻只有一个活动列表')
  assert.equal(activated.state.lists.find(l => l.name === '重构').isDefault, false, '旧活动列表被让位')
})

test('改名：id 不变（上游 getId 语义）、空名/重名被拒', () => {
  let state = createChangeListsState()
  const made = addList(state, '旧名')
  state = made.state
  assert.equal(renameList(state, made.list.id, '   '), null)
  assert.equal(renameList(state, made.list.id, DEFAULT_CHANGE_LIST_NAME), null, '与默认列表重名')
  assert.equal(renameList(state, 'no-such-id', 'x'), null, '不存在的列表')
  const renamed = renameList(state, made.list.id, '新名')
  assert.equal(listById(renamed, made.list.id).name, '新名')
  assert.equal(listById(renamed, made.list.id).id, made.list.id, 'id 不随名字变')
})

test('活动列表：setCurrentList 只留一个 isDefault', () => {
  let state = addList(createChangeListsState(), 'A').state
  state = addList(state, 'B').state
  const a = state.lists.find(l => l.name === 'A')
  const next = setCurrentList(state, a.id)
  assert.equal(next.current, a.id)
  assert.deepEqual(next.lists.filter(l => l.isDefault).map(l => l.id), [a.id])
  assert.equal(setCurrentList(next, 'missing'), next, '不存在的 id 不改变状态')
})

test('归属与过滤：有归属按归属，没有 = 活动列表（getChangeList/getChangesIn）', () => {
  let state = addList(createChangeListsState(), '重构').state
  const refactor = state.lists.find(l => l.name === '重构')
  const active = currentList(state)
  const changes = [change('a.ts'), change('b.ts'), change('c.ts')]
  assert.deepEqual(changesInList(state, active.id, changes).map(c => c.path), ['a.ts', 'b.ts', 'c.ts'], '初始全在活动列表')
  state = moveChanges(state, ['b.ts'], refactor.id)
  assert.equal(listIdOf(state, 'b.ts'), refactor.id)
  assert.deepEqual(changesInList(state, refactor.id, changes).map(c => c.path), ['b.ts'])
  assert.deepEqual(changesInList(state, active.id, changes).map(c => c.path), ['a.ts', 'c.ts'])
  assert.equal(countInList(state, refactor.id, changes), 1)
  // 移到活动列表 = 删条目（缺省归属就是活动列表，不留冗余）。
  state = moveChanges(state, ['b.ts'], active.id)
  assert.equal('b.ts' in state.assignments, false)
})

test('归属指向不存在的列表（存档被手改）时落回活动列表，变更不丢', () => {
  const state = createChangeListsState()
  const broken = { ...state, assignments: { 'x.ts': 'ghost' } }
  assert.equal(listIdOf(broken, 'x.ts'), currentList(broken).id)
  assert.equal(countInList(broken, currentList(broken).id, [change('x.ts')]), 1)
})

test('删除：非空要确认、变更移到活动列表、删活动列表换活动、删光新建默认列表、只读不许删', () => {
  let state = addList(createChangeListsState(), '重构').state
  const refactor = state.lists.find(l => l.name === '重构')
  const active = currentList(state)
  state = moveChanges(state, ['a.ts', 'b.ts'], refactor.id)
  // 只读列表不许删。
  const readOnly = { ...state, lists: state.lists.map(l => (l.id === refactor.id ? { ...l, readOnly: true } : l)) }
  assert.equal(canRemoveList(readOnly, refactor.id), false)
  const blocked = removeList(readOnly, refactor.id)
  assert.equal(blocked.state, readOnly, '只读列表删除是 no-op')
  assert.equal(blocked.moved, 0)
  // 正常删除非活动列表：变更回活动列表，不丢。
  const outcome = removeList(state, refactor.id)
  assert.equal(outcome.moved, 2, '两处变更被移走')
  assert.equal(outcome.removedActive, false)
  assert.deepEqual(changesInList(outcome.state, active.id, [change('a.ts'), change('b.ts')]).map(c => c.path), ['a.ts', 'b.ts'],
    '被删列表里的变更落到活动列表')
  assert.equal(listById(outcome.state, refactor.id), undefined)
  // 删活动列表：活动权交给剩下的第一个。
  let two = addList(createChangeListsState(), 'X').state
  two = addList(two, 'Y').state
  const currentTwo = currentList(two)
  const removedActive = removeList(two, currentTwo.id)
  assert.equal(removedActive.removedActive, true)
  assert.equal(removedActive.newCurrent, removedActive.state.lists[0].id)
  assert.equal(removedActive.state.lists.filter(l => l.isDefault).length, 1, '换完仍只有一个活动列表')
  // 删光：新建一个默认列表（上游 RemoveChangeListAction.kt:78-90）。
  const only = createChangeListsState()
  const wiped = removeList(only, only.lists[0].id)
  assert.equal(wiped.state.lists.length, 1)
  assert.equal(wiped.state.lists[0].name, DEFAULT_CHANGE_LIST_NAME)
  assert.equal(wiped.state.current, wiped.state.lists[0].id)
})

test('删除确认文案照 VcsBundle.properties:281-283；空列表不弹确认', () => {
  const list = { id: '1', name: '重构', comment: '', isDefault: false, readOnly: false }
  assert.match(removeListQuestion(list, 3), /重构/)
  assert.match(removeListQuestion(list, 3), /3/)
  assert.match(removeListQuestion(list, 3), /活动列表/)
  assert.match(removeAllListsQuestion(2), /2/)
  assert.equal(MOVE_TO_ACTIVE_NOTE.includes('活动列表'), true)
})

test('持久化：序列化往返、坏存档退回缺省、换工作区是另一份存档', () => {
  let state = addList(createChangeListsState(), '重构', '说明').state
  const refactor = state.lists.find(l => l.name === '重构')
  state = moveChanges(state, ['a.ts'], refactor.id)
  state = setCurrentList(state, refactor.id)
  state = setComment(state, refactor.id, '新的说明')
  const round = parseChangeLists(serializeChangeLists(state))
  assert.deepEqual(round, state, '序列化往返一致')
  // 坏存档退回缺省。id 是每次新生成的，所以按形状核（一个名为 Changes 的活动列表、无归属）。
  const isFreshDefault = value => {
    assert.equal(value.lists.length, 1)
    assert.equal(value.lists[0].name, DEFAULT_CHANGE_LIST_NAME)
    assert.equal(value.lists[0].isDefault, true)
    assert.equal(value.current, value.lists[0].id)
    assert.deepEqual(value.assignments, {})
  }
  isFreshDefault(parseChangeLists('not json'))
  isFreshDefault(parseChangeLists('[]'))
  isFreshDefault(parseChangeLists('{"lists":[]}'))
  isFreshDefault(parseChangeLists('{"lists":[{"name":"no id"}]}'))
  // 活动列表指向不存在的 id ⇒ 取第一个 isDefault。
  const fixed = parseChangeLists(JSON.stringify({ lists: [{ id: 'a', name: 'A', isDefault: true }, { id: 'b', name: 'B' }], current: 'ghost' }))
  assert.equal(fixed.current, 'a')
  // 多个 isDefault（手改坏）⇒ 只留 current 一个。
  const single = parseChangeLists(JSON.stringify({ lists: [{ id: 'a', name: 'A', isDefault: true }, { id: 'b', name: 'B', isDefault: true }], current: 'b' }))
  assert.equal(single.lists.filter(l => l.isDefault).length, 1)
  // 归属指向不存在的列表 ⇒ 丢弃该条（读回时由 listIdOf 落回活动列表）。
  const orphan = parseChangeLists(JSON.stringify({ lists: [{ id: 'a', name: 'A', isDefault: true }], current: 'a', assignments: { 'x.ts': 'ghost', 'y.ts': 'a' } }))
  assert.deepEqual(orphan.assignments, { 'y.ts': 'a' })
  // localStorage 读写 + 换工作区。
  const store = new Map()
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) }
  isFreshDefault(readChangeLists(storage, "/ws"))
  writeChangeLists(storage, '/ws', state)
  assert.deepEqual(readChangeLists(storage, '/ws'), state)
  assert.equal(changeListsKey('/ws').includes(encodeURIComponent('/ws')), true)
  assert.notEqual(changeListsKey('/ws'), changeListsKey('/other'))
})

test('SourceControl 接线：选择器 / 新建 / 重命名 / 删除 / 按列表过滤 / 移动 / 换项目重读', () => {
  const panel = readFileSync('src/components/SourceControl.vue', 'utf8')
  assert.match(panel, /createChangeListsSection\(\{/, '面板建了变更列表一节')
  assert.match(panel, /visible: visibleChanges/, '取到了按列表过滤后的变更')
  assert.match(panel, /const listChanges = computed\(\(\) => visibleChanges\.value\)/, '变更树按当前列表过滤')
  assert.match(panel, /const staged = computed\(\(\) => listChanges\.value\.filter/, '已暂存那一半也按列表过滤')
  assert.match(panel, /const unstaged = computed\(\(\) => listChanges\.value\.filter/, '更改那一半也按列表过滤')
  // 那一行（选择器 + 三个动作）整块拆到 ChangeListBar.vue（面板贴着 900 行上限）。
  assert.match(panel, /<ChangeListBar/, '变更列表那一行在模板里')
  assert.match(panel, /@select="changeLists\.select\(\$event\)" @create="newChangeList" @rename="renameChangeList\(selectedChangeList\)" @remove="removeChangeList\(selectedChangeList\)"/,
    '三个动作与选择都接上')
  assert.match(panel, /:removable="canRemoveList\(changeListState, selectedChangeList\)"/, '只读列表的删除按钮被禁用')
  assert.match(panel, /changeLists\.reload\(\)/, '换工作区重读存档')
  // 右键菜单那一行真的接上了（上游 ChangesView.Move）。
  assert.match(panel, /case 'moveToChangeList': return moveChangesToOtherList\(\[path\]\)/)
  const menu = readFileSync('src/changesMenuActions.ts', 'utf8')
  assert.match(menu, /id: 'moveToChangeList', label: '移到其他变更列表…'/)
  const bar = readFileSync('src/components/ChangeListBar.vue', 'utf8')
  assert.match(bar, /class="cl-select"/, '选择器本体在 ChangeListBar')
  assert.match(bar, /@click="\$emit\('create'\)"/, '新建按钮')
  assert.match(bar, /@click="\$emit\('rename'\)"/, '重命名按钮')
  assert.match(bar, /@click="\$emit\('remove'\)"/, '删除按钮')
})