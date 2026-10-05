// 欢迎页分组的纯逻辑（`src/welcomeProjectGroups.ts`）：读法/写法、判序、桶布局、折叠、移入移出。
//
// 2026-10-06 桶 14c 从 `src/components/WelcomePage.vue` 搬出来时才有的判据；
// 上游坐标与规则出处写在新模块的文件头里（`ProjectGroup.java`、
// `RecentProjectListActionProvider.kt:333-355` 与 `:388-407`、
// `CreateNewProjectGroupAction.kt` / `EditProjectGroupAction.kt` / `MoveProjectToGroupActionGroup.kt`），
// 这里只钉「搬过去的每条规则」的边界，不重复抄上游。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROJECT_GROUPS_KEY, UNGROUPED, buildGroupBuckets, compareProjectGroups, createWelcomeProjectGroups,
  groupCollapseAction, isInGroup, parseStoredGroups, serializeGroups,
} from '../src/welcomeProjectGroups.ts'

const project = (path, extra = {}) => ({ path, name: path.split('/').pop(), lastOpened: '2026-10-01T00:00:00Z', available: true, ...extra })
const group = (name, paths, extra = {}) => ({ name, paths, expanded: true, tutorials: false, bottomGroup: false, ...extra })

// ── 读法 / 写法 ───────────────────────────────────────────────────────────────────

test('坏数据逐条退化：缺字段、类型不对、整份 JSON 坏了都不会炸列表', () => {
  assert.deepEqual(parseStoredGroups(null), { groups: [], collapsed: [] })
  assert.deepEqual(parseStoredGroups(undefined), { groups: [], collapsed: [] })
  assert.deepEqual(parseStoredGroups('{"groups":[{"paths":[]}]}'), { groups: [], collapsed: [] }, '缺 name 的条目丢掉')
  assert.deepEqual(parseStoredGroups('{"groups":[{"name":"a"}]}'), { groups: [], collapsed: [] }, 'paths 不是数组的条目丢掉')
  assert.deepEqual(parseStoredGroups('{"groups":"不是数组"}'), { groups: [], collapsed: [] })
  assert.deepEqual(parseStoredGroups('这根本不是 JSON'), { groups: [], collapsed: [] }, '整份坏了 → 没有分组，不抛异常')
  const one = parseStoredGroups('{"groups":[{"name":"a","paths":["/x",7,null,"/y"]}]}')
  assert.deepEqual(one.groups[0].paths, ['/x', '/y'], 'paths 里只留字符串')
  assert.equal(one.groups[0].expanded, true, '缺 expanded 的旧记录默认展开（旧口径是 collapsed set，读的时候那一份还是空）')
  assert.equal(one.groups[0].tutorials, false, 'tutorials 只认 true')
  assert.equal(one.groups[0].bottomGroup, false)
  assert.deepEqual(parseStoredGroups('{"collapsed":["a",5,null,"b"]}').collapsed, ['a', 'b'], 'collapsed 里只留字符串')
})

test('写法与读法是一对：组字段与折叠状态都往返得住', () => {
  const groups = [group('甲', ['/x', '/y']), group('乙', [], { expanded: false, bottomGroup: true })]
  const raw = serializeGroups(groups, new Set(['甲']))
  assert.deepEqual(JSON.parse(raw).collapsed, ['甲'])
  const back = parseStoredGroups(raw)
  assert.deepEqual(back.groups, groups, 'expanded/tutorials/bottomGroup 都跟着存回去')
  assert.deepEqual(back.collapsed, ['甲'])
})

// ── 判序（ProjectGroupComparator）─────────────────────────────────────────────────

test('组序 = 组内最近那条项目的位次（最近列表是新的在前）；都没命中的组按名字自然序', () => {
  const recent = ['/new', '/mid', '/old']
  const old = group('老组', ['/old'])
  const neu = group('新组', ['/new'])
  const mid = group('中间组', ['/mid'])
  assert.ok(compareProjectGroups(neu, mid, recent) < 0, '0 号位的组排在 1 号位之前')
  assert.ok(compareProjectGroups(mid, old, recent) < 0)
  assert.ok(compareProjectGroups(neu, group('别组', []), recent) < 0, '有命中的组排在没命中的组之前（没命中 = 最大下标）')
  // 组内取的是**最小**下标，不是第一条。
  assert.ok(compareProjectGroups(group('抓新的', ['/old', '/new']), old, recent) < 0)
  // 都没命中（被过滤掉了 / 空组）→ 自然序，数字段按数值比。
  assert.ok(compareProjectGroups(group('Group 2', []), group('Group 10', []), []) < 0)
  assert.equal(compareProjectGroups(group('a', []), group('a', []), recent), 0, '同名同位次 = 平局')
})

// ── 桶布局（两趟：上组 → 未分组 → 下组）───────────────────────────────────────────

test('两趟布局：上组在前、未分组居中、bottomGroup 垫底；只有未分组那段空了就消失', () => {
  const projects = [project('/a'), project('/b'), project('/c')]
  const groups = [group('上面', ['/a']), group('下面', ['/b'], { bottomGroup: true })]
  const buckets = buildGroupBuckets(groups, projects)
  assert.deepEqual(buckets.map(b => b.name), ['上面', UNGROUPED, '下面'])
  assert.deepEqual(buckets.map(b => b.projects.map(p => p.path)), [['/a'], ['/c'], ['/b']])
  assert.equal(buildGroupBuckets([], projects).length, 1, '没有分组时只有未分组那一段')
  assert.deepEqual(buildGroupBuckets([group('空组', [])], []), [{ name: '空组', projects: [] }],
    '有名分组即使空也保留（上游建的就是空分组，等用户往里移项目）；未分组空了才整段不渲染')
})

test('在哪个组 = 第一个包含它的组，找不到就是未分组', () => {
  const groups = [group('甲', ['/x'])]
  assert.equal(isInGroup(groups, '/x'), '甲')
  assert.equal(isInGroup(groups, '/y'), UNGROUPED)
  assert.equal(isInGroup([], '/x', '其它'), '其它')
})

test('左右方向键：左折叠、右展开，已经是那个状态就不动', () => {
  assert.equal(groupCollapseAction('ArrowLeft', false), 'toggle', '展开着才需要折叠')
  assert.equal(groupCollapseAction('ArrowLeft', true), null)
  assert.equal(groupCollapseAction('ArrowRight', true), 'toggle')
  assert.equal(groupCollapseAction('ArrowRight', false), null)
  assert.equal(groupCollapseAction('Enter', false), null)
})

// ── 接线：工厂（新建 / 改名 / 移入移出 / 折叠）─────────────────────────────────────

/** 一个够用的假 localStorage。 */
function fakeStore(initial = null) {
  const map = new Map(initial ? [[PROJECT_GROUPS_KEY, initial]] : [])
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value) } }
}

function withPrompts(answers, body) {
  const saved = globalThis.window
  const queue = [...answers]
  const calls = []
  globalThis.window = { prompt: (message, initial) => { calls.push({ message, initial }); return queue.length ? queue.shift() : null } }
  try { return { result: body(), calls } } finally {
    if (saved === undefined) delete globalThis.window
    else globalThis.window = saved
  }
}

function newGroups(projects, store) {
  const closed = []
  const api = createWelcomeProjectGroups({
    recentProjects: () => projects,
    closeMenu: () => closed.push('menu'),
    store,
  })
  return { api, closed }
}

test('新建分组：建的是空分组、关掉行菜单、落盘；取消就什么都不做', () => {
  const store = fakeStore()
  const projects = [project('/a')]
  const { api, closed } = newGroups(projects, store)
  const answers = withPrompts(['  我的组  '], () => { api.createGroup(); return api.groups.value.map(g => g.name) })
  assert.deepEqual(answers.result, ['我的组'], 'trim 后收下')
  assert.deepEqual(api.groups.value[0].paths, [], '建的是空分组（往里放项目是「移动到分组」的事）')
  assert.deepEqual(closed, ['menu'])
  assert.deepEqual(JSON.parse(store.map.get(PROJECT_GROUPS_KEY)).groups, [group('我的组', [], { expanded: true })])
  const none = withPrompts([null], () => api.createGroup())
  assert.equal(none.result, undefined)
  assert.equal(api.groups.value.length, 1, '取消（prompt 返回 null）不建组')
})

test('名字撞了不关动作就重来一次：带着错误再问（上游是 validator 写在框上）', () => {
  const store = fakeStore(serializeGroups([group('甲', ['/a'])], []))
  const { api } = newGroups([project('/a')], store)
  const asked = withPrompts(['甲', ' ', '乙'], () => api.createGroup())
  assert.deepEqual(api.groups.value.map(g => g.name), ['甲', '乙'])
  assert.equal(asked.calls.length, 3, '两次被拦下，第三次才收下')
  assert.match(asked.calls[1].message, /分组「甲」已存在。/, '第二次的提示是上一次的错误')
  assert.match(asked.calls[2].message, /名称不能为空。/, '第三次的提示同样是上一次的错误')
  assert.equal(asked.result, undefined)
})

test('改名：折叠状态跟着名字走，改回原名什么都不写', () => {
  const store = fakeStore(serializeGroups([group('甲', ['/a'])], ['甲']))
  const { api } = newGroups([project('/a')], store)
  assert.ok(api.groupCollapsed.value.has('甲'))
  withPrompts(['乙'], () => api.renameGroup('甲'))
  assert.deepEqual([...api.groupCollapsed.value], ['乙'], '旧的折叠记录换到新名字上，展开状态不丢')
  assert.deepEqual(api.groups.value.map(g => g.name), ['乙'])
  assert.deepEqual(JSON.parse(store.map.get(PROJECT_GROUPS_KEY)).collapsed, ['乙'])
  const before = store.map.get(PROJECT_GROUPS_KEY)
  withPrompts(['乙'], () => api.renameGroup('乙'))
  assert.equal(store.map.get(PROJECT_GROUPS_KEY), before, '改回原名 = 不写盘')
})

test('移入分组：先从所有组里摘掉再挂到目标组；移到未分组就是只摘不挂；最近项目本身不碰', () => {
  const store = fakeStore(serializeGroups([group('甲', ['/a']), group('乙', ['/b'])], []))
  const projects = [project('/a'), project('/b')]
  const { api } = newGroups(projects, store)
  withPrompts([], () => api.moveToGroup(projects[0], '乙'))
  assert.deepEqual(api.groups.value.map(g => g.paths), [[], ['/b', '/a']], '一个项目只属于一个组')
  assert.deepEqual(projects.map(p => p.path), ['/a', '/b'], '移组≠移最近项目')
  assert.equal(api.groupOf('/a'), '乙')
  withPrompts([], () => api.moveToGroup(projects[0], UNGROUPED))
  assert.deepEqual(api.groups.value.map(g => g.paths), [[], ['/b']])
  assert.equal(api.groupOf('/a'), UNGROUPED)
  assert.deepEqual(JSON.parse(store.map.get(PROJECT_GROUPS_KEY)).groups.map(g => g.paths), [[], ['/b']], '移完落盘')
})

test('折叠：collapsed 与 expanded 两个口径一起翻，并写盘', () => {
  const store = fakeStore(serializeGroups([group('甲', ['/a'])], []))
  const { api } = newGroups([project('/a')], store)
  api.toggleGroupCollapsed('甲')
  assert.deepEqual([...api.groupCollapsed.value], ['甲'])
  assert.equal(api.groups.value[0].expanded, false)
  api.onGroupKeydown('甲', { key: 'ArrowRight' })
  assert.equal(api.groupCollapsed.value.has('甲'), false, '右键展开；已经是展开态就不动')
  api.onGroupKeydown('甲', { key: 'ArrowRight' })
  assert.equal(api.groupCollapsed.value.has('甲'), false)
  api.onGroupKeydown('甲', { key: 'ArrowLeft' })
  assert.deepEqual(JSON.parse(store.map.get(PROJECT_GROUPS_KEY)), { groups: [group('甲', ['/a'], { expanded: false })], collapsed: ['甲'] })
})

test('「移动到分组」的项序来自 welcomeProjects 的自然序，tutorials 组不出现', () => {
  const store = fakeStore(serializeGroups([group('Group 10', []), group('Group 2', []), group('课程', [], { tutorials: true })], []))
  const { api } = newGroups([], store)
  assert.deepEqual(api.moveTargets.value, ['Group 2', 'Group 10'])
  assert.equal(api.groupingActive.value, true)
})

test('分组桶跟着过滤后的列表走：判序与内容都只看当前可见的那几条', () => {
  const store = fakeStore(serializeGroups([group('甲', ['/a', '/b']), group('底', ['/c'], { bottomGroup: true })], []))
  const projects = [project('/c'), project('/b')]
  const { api } = newGroups(projects, store)
  assert.deepEqual(api.groupedProjects.value.map(b => [b.name, b.projects.map(p => p.path)]),
    [['甲', ['/b']], ['底', ['/c']]], '/a 被过滤掉了：甲仍在（有名分组空也保留），未分组那段不出现')
})
