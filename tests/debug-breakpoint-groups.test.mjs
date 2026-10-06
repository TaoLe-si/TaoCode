// 断点分组（`src/breakpointGroups.ts` + `src/exceptionBreakpoints.ts` + `BreakpointsDialog.vue`）。
//
// 上游：`XBreakpointGroupingRule` 一族 —— `XBreakpointFileGroupingRule`（按文件）、
// `XBreakpointGroupingByTypeRule`（按类型，异常断点就是其中一类）、`BreakpointsGroupNode`。
// 本仓列表项都是行断点 ⇒ 按文件分组；异常断点是共享状态里的独立分组（面板与对话框同一份勾选）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'

const { fileGroupLabel, groupBreakpointsByFile } = await import('../src/breakpointGroups.ts')
const exception = await import('../src/exceptionBreakpoints.ts')

const item = (path, line) => ({ id: `${path}:${line}`, title: `${path.split('/').pop()}:${line}`, path, body: '', hasSource: false })

test('按文件分组：同一文件一个组，组内与组间都保持输入顺序', () => {
  const groups = groupBreakpointsByFile([item('a/A.java', 3), item('a/A.java', 9), item('b/B.java', 2), item('a/A.java', 12)])
  assert.deepEqual(groups.map(group => group.path), ['a/A.java', 'b/B.java'])
  assert.deepEqual(groups[0].items.map(entry => entry.id), ['a/A.java:3', 'a/A.java:9', 'a/A.java:12'])
  assert.deepEqual(groups[1].items.map(entry => entry.id), ['b/B.java:2'])
})

test('空列表 = 空分组（对话框不画空组头）', () => {
  assert.deepEqual(groupBreakpointsByFile([]), [])
})

test('组头 = 文件名 + 目录；根下文件只有文件名', () => {
  assert.equal(fileGroupLabel('src/main/java/A.java'), 'A.java — src/main/java')
  assert.equal(fileGroupLabel('A.java'), 'A.java')
  assert.equal(fileGroupLabel('src/A.java'), 'A.java — src')
})

test('过滤器解析：丢掉坏条目与重复 id，保留适配器顺序', () => {
  const parsed = exception.parseExceptionFilters({ exceptionBreakpointFilters: [
    { filter: 'uncaught', label: '未捕获异常', default: true },
    { filter: 'uncaught', label: '重复' },
    null,
    { label: '没有 id' },
    { filter: 'caught', label: '捕获异常' },
  ] })
  assert.deepEqual(parsed.map(filter => filter.filter), ['uncaught', 'caught'])
  assert.deepEqual(exception.parseExceptionFilters(undefined), [])
})

test('整份覆盖：适配器声明的 default 只在用户一个都没勾时生效', () => {
  exception.applyExceptionFilters(exception.parseExceptionFilters({ exceptionBreakpointFilters: [
    { filter: 'uncaught', default: true }, { filter: 'caught' },
  ] }))
  assert.deepEqual(exception.checkedExceptionFilters(), ['uncaught'], '首次套用 default')
  exception.applyExceptionFilters(exception.parseExceptionFilters({ exceptionBreakpointFilters: [
    { filter: 'caught', default: true },
  ] }))
  assert.deepEqual(exception.checkedExceptionFilters(), ['caught'],
    '适配器不再声明 uncaught 且原勾选无一保留 ⇒ 按新声明套 default（不是留下无效 id）')
})

test('勾选立即翻转本地状态；适配器送不到时返回 false（不假装成功）', async () => {
  exception.applyExceptionFilters(exception.parseExceptionFilters({ exceptionBreakpointFilters: [{ filter: 'uncaught' }] }))
  // 测试环境没有宿主：dap.* 一律 DESKTOP_REQUIRED ⇒ 发送失败。
  const ok = await exception.toggleExceptionBreakpoint('uncaught')
  assert.equal(ok, false)
  assert.deepEqual(exception.checkedExceptionFilters(), ['uncaught'], '界面状态必须已经翻转（用户点了复选框）')
  const group = exception.exceptionBreakpointGroup()
  assert.equal(group.total, 1)
  assert.equal(group.enabled, 1)
  assert.equal(group.label, '异常断点')
  assert.deepEqual(group.rows, [{ filter: 'uncaught', label: 'uncaught', description: '', checked: true }])
  await exception.toggleExceptionBreakpoint('uncaught')
  assert.deepEqual(exception.checkedExceptionFilters(), [])
})

test('没有过滤器就没有分组（对话框不渲染空组）', () => {
  exception.applyExceptionFilters([])
  assert.equal(exception.exceptionBreakpointGroup(), null)
})

// —— 对话框接线 ——

const dialog = readFileSync('src/components/BreakpointsDialog.vue', 'utf8')

test('对话框同时画异常分组与按文件分组的行断点', () => {
  assert.match(dialog, /exceptionBreakpointGroup\(\)/, '异常分组来自共享状态')
  assert.match(dialog, /groupBreakpointsByFile\(props\.items\)/, '行断点按文件分组')
  assert.match(dialog, /class="breakpoints-group-head"/)
  assert.match(dialog, /@change="toggleExceptionBreakpoint\(row\.filter\)"/, '勾选写回同一份状态')
  assert.match(dialog, /class="breakpoints-list"/, '仍是上游的 master-detail 左列表')
})

// 本轮（bucket12c）收尾：断点**写入口**这一侧的两个悬空回调 + 项目根传参 + More 链接的宿主通道。
// 上一版把对话框的 `@more` / `@set-default-group` 接到了两个**不存在**的函数上
// （`DebugBreakpointsPane.vue` 整份组件因此类型检查不过 ⇒ 组这一族看着做完其实没法构建）。
test('断点区的「更多选项 / 设为默认」有真实现，默认组随项目落盘，面板把项目根传了进来', () => {
  const pane = readFileSync(new URL('../src/components/DebugBreakpointsPane.vue', import.meta.url), 'utf8')
  const panel = readFileSync(new URL('../src/components/DebugPanel.vue', import.meta.url), 'utf8')
  assert.match(pane, /@more="openBreakpointsDialog"/, '「更多选项」接到一个不存在的函数上')
  assert.match(pane, /function openBreakpointsDialog\(\) \{\s*error\.value = requestBreakpointsDialog\(\)/,
    '「更多选项」没走宿主登记表（组件树上要跨两层别人的文件才能到 App.vue）')
  assert.match(pane, /import \{ requestBreakpointsDialog \} from '\.\.\/dbgBreakpointsDialogHost'/,
    '宿主模块没被断点区引用')
  assert.match(pane, /function pickDefaultGroup\(name: string \| null\) \{[\s\S]{0,140}setDefaultBreakpointGroup\(name\)/,
    '「设为默认」没写进组状态')
  assert.match(pane, /@set-default-group="pickDefaultGroup"/)
  // 组状态按项目根存：面板必须把 root 传进断点区（否则两个项目共用一份组表）。
  assert.match(panel, /<DebugBreakpointsPane[\s\S]{0,220}:root="props\.root"/, '断点区没拿到项目根')
  const dialog = readFileSync(new URL('../src/components/DebugBreakpointEditDialog.vue', import.meta.url), 'utf8')
  assert.match(dialog, /v-if="breakpointsDialogAvailable"[\s\S]{0,160}@click="emit\('more'\)"/,
    '宿主没注册时也画了「更多选项」⇒ 点不动的假控件')
  const host = readFileSync(new URL('../src/dbgBreakpointsDialogHost.ts', import.meta.url), 'utf8')
  assert.match(host, /export function requestBreakpointsDialog\(\): boolean/, '宿主登记表没有「没人接」的返回位')
})

test('宿主登记表：没注册时 requestBreakpointsDialog 返回 false，注册后调到的就是那一个动作', async () => {
  const { breakpointsDialogAvailable, requestBreakpointsDialog, setBreakpointsDialogOpener } =
    await import('../src/dbgBreakpointsDialogHost.ts')
  const calls = []
  setBreakpointsDialogOpener(() => calls.push('open'))
  assert.equal(breakpointsDialogAvailable.value, true)
  assert.equal(requestBreakpointsDialog(), true)
  assert.deepEqual(calls, ['open'])
  // 撤销注册（App.vue 卸载路径）⇒ 立刻回到「没人接」，链接随之消失。
  setBreakpointsDialogOpener(null)
  assert.equal(breakpointsDialogAvailable.value, false)
  assert.equal(requestBreakpointsDialog(), false)
  assert.deepEqual(calls, ['open'], '没注册时不许调到旧动作')
  // 给的不是函数（undefined / 字符串）等于没注册：不许把坏值存下来。
  setBreakpointsDialogOpener(undefined)
  assert.equal(requestBreakpointsDialog(), false)
  setBreakpointsDialogOpener(null)
})

// —— 具名逻辑断点组的**写入口**（桶 12 遗留 W2 的弹层侧，本桶 dap 补）——————————————
// 上游：`BreakpointsDialog.java:317-348` 的右键菜单里「Move to Group」子菜单 =
//   `<无组>`(`:332`) + 现有组名 distinct+sorted(`:336-341`) + 分隔线 + `Create New…`(`:338`)；
//   执行体 `:542-557` 循环的是 `getSelectedBreakpoints(true)`，而 `traverse = true` 那一支
//   （`BreakpointItemsTreeController.java:187-194`）对选中节点做**先深遍历子树**
//   ⇒ 选中「组节点」改组 = 组里每条断点一起 `setGroup`。
// 上游**没有**组的改名/删除（组只是断点上的字符串：`XBreakpointGroup.java:10-42` 只有名字/比较/展开态/图标，
// `XBreakpointCustomGroup.java:16-38` 多一个 `isDefault`）⇒ 本仓不另造假控件。
const groups = await import('../src/breakpointGroups.ts')

test('组状态解析：旧存档缺键 / 坏 JSON / 空串一律补成空状态，不许按字段数量判损坏', () => {
  const empty = { members: {}, disabled: [], defaultGroup: null }
  assert.deepEqual(groups.parseGroupState(null), empty)
  assert.deepEqual(groups.parseGroupState('不是 JSON'), empty)
  assert.deepEqual(groups.parseGroupState('{}'), empty, '只有对象没有键 ⇒ 补默认（历史上这样把用户锁在项目外过）')
  assert.deepEqual(groups.parseGroupState('[]'), empty)
  assert.deepEqual(groups.parseGroupState('{"members":{"a:1":"组一","b:2":"  ","c:3":7},"disabled":["d:4","","d:4"]}'),
    { members: { 'a:1': '组一' }, disabled: ['d:4'], defaultGroup: null }, '空组名/空 ref/非字符串丢掉，disabled 去重保序')
  assert.deepEqual(groups.parseGroupState('{"members":{"a:1":"组一"},"defaultGroup":"  "}'),
    { members: { 'a:1': '组一' }, disabled: [], defaultGroup: null }, '空白默认组 = 没有默认组')
})

test('按项目根分桶存：读写来回一致，存储坏了只剩会话内状态（不抛）', () => {
  const store = new Map()
  const fake = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) }
  groups.assignBreakpointsToGroup(['src/a.cpp:1'], '组一')
  groups.setDefaultBreakpointGroup('组一')
  try {
    groups.saveGroupState(fake, 'D:/proj')
    assert.ok(store.has(groups.groupStateKey('D:/proj')), '落盘键带项目根')
    assert.deepEqual(JSON.parse(store.get(groups.groupStateKey('D:/proj')) ?? '{}'),
      { members: { 'src/a.cpp:1': '组一' }, disabled: [], defaultGroup: '组一' }, '落的是当前这份状态（不多不少）')
    assert.deepEqual(groups.loadGroupState(fake, 'D:/proj').members['src/a.cpp:1'], '组一')
    assert.equal(groups.loadGroupState(fake, 'D:/other').defaultGroup, null, '换项目根读不到上一份')
    const broken = { getItem: () => { throw new Error('存储坏了') }, setItem: () => { throw new Error('写不进去') } }
    assert.deepEqual(groups.loadGroupState(broken, 'D:/proj').disabled, [], '读坏了给空状态')
    groups.saveGroupState(broken, 'D:/proj')
  } finally {
    groups.assignBreakpointsToGroup(['src/a.cpp:1'], null)
    groups.setDefaultBreakpointGroup(null)
  }
})

test('整组搬迁（moveGroupContents）：组里每条一起改组，源组随之消失', () => {
  const refs = ['src/a.cpp:1', 'src/a.cpp:2', 'src/b.cpp:9', 'src/c.cpp:3']
  groups.assignBreakpointsToGroup(['src/a.cpp:1', 'src/a.cpp:2', 'src/b.cpp:9'], '甲')
  groups.assignBreakpointsToGroup(['src/c.cpp:3'], '乙')
  try {
    assert.deepEqual(groups.groupMembers(refs, '甲'), ['src/a.cpp:1', 'src/a.cpp:2', 'src/b.cpp:9'])
    assert.deepEqual(groups.moveGroupContents(refs, '甲', '甲'), [], '同名 = 一条都不动（不白白发一轮）')
    const moved = groups.moveGroupContents(refs, '甲', '乙')
    assert.deepEqual(moved, ['src/a.cpp:1', 'src/a.cpp:2', 'src/b.cpp:9'], '返回真正变了的 ref（调用方据此落盘）')
    assert.deepEqual(groups.groupNames(refs), ['乙'], '源组没有成员了就不再是个组（上游同样：组名从断点上取）')
    assert.deepEqual(groups.groupMembers(refs, '乙'), refs, '先深遍历子树 ⇒ 组里全部落到目标组')
    assert.deepEqual(groups.moveGroupContents(refs, '不存在的组', '乙'), [])
  } finally {
    groups.assignBreakpointsToGroup(refs, null)
  }
})

test('整组移到 <无组>（上游子菜单第一项 MoveToGroupAction(null)）：组清空、逐条那一格不受影响', () => {
  const refs = ['src/a.cpp:1', 'src/a.cpp:2']
  groups.assignBreakpointsToGroup(refs, '甲')
  try {
    assert.deepEqual(groups.moveGroupContents(refs, '甲', null), refs)
    assert.deepEqual(groups.groupNames(refs), [])
    assert.equal(groups.groupNameOf('src/a.cpp:1'), null)
  } finally {
    groups.assignBreakpointsToGroup(refs, null)
  }
})

test('搬迁目标清单 = 上游那份 distinct+sorted 去掉它自己（码元序，不用 localeCompare）', () => {
  const refs = ['src/a.cpp:1', 'src/a.cpp:2', 'src/a.cpp:3']
  groups.assignBreakpointsToGroup(['src/a.cpp:1'], 'b 组')
  groups.assignBreakpointsToGroup(['src/a.cpp:2'], 'a 组')
  groups.assignBreakpointsToGroup(['src/a.cpp:3'], 'a 组')
  try {
    assert.deepEqual(groups.groupNames(refs), ['a 组', 'b 组'])
    assert.deepEqual(groups.groupMoveTargets(refs, 'a 组'), ['b 组'])
    assert.deepEqual(groups.groupMoveTargets(refs, '没这个名字'), ['a 组', 'b 组'])
  } finally {
    groups.assignBreakpointsToGroup(refs, null)
  }
})

test('写入口接线：组节点那一格真的在弹层里，且没有上游没有的「改名/删除组」', () => {
  const view = readFileSync('src/components/BreakpointsDialog.vue', 'utf8')
  assert.match(view, /function moveWholeGroup\(node: BreakpointGroupNode, value: string\)/, '整组搬迁的入口没接上')
  assert.match(view, /moveGroupContents\(allRefs\.value, node\.name, target \|\| null\)/, '没走规则层')
  assert.match(view, /@change="moveWholeGroup\(row\.node,/, '组头那一格没接上 change')
  assert.match(view, /:aria-label="`把组 \$\{row\.node\.name\} 整体移至`"/, '纯图标/无名的下拉必须有 aria-label')
  assert.match(view, /<option :value="NO_GROUP">&lt;无组&gt;<\/option>/, '上游子菜单第一项是 <无组>')
  assert.match(view, /groupMoveTargetsOf\(row\.node\.name\)/, '目标清单没走规则层')
  assert.match(view, /<option :value="NEW_GROUP">新建…<\/option>/, '「新建…」是子菜单最后一项（上游 :338 在分隔线之后）')
  assert.doesNotMatch(view, /重命名组|删除组|renameGroup|removeGroup/, '上游没有这两个动作 ⇒ 不许造出来的假控件')
})

test('「新建…」的输入是三态，不是两态：取消 = 上游的 return，空名 = <无组>', () => {
  // 上游 `MoveToGroupAction.actionPerformed`：`Messages.showInputDialog` 返回 null 时直接 return
  // ⇒ 取消**不**碰任何断点；按了确定但名字是空串时走 `setGroup("")`，而空名在分组规则那边就是「没有组」。
  assert.equal(groups.resolveNewGroupName(null), null, '取消（null）必须原样是 null ⇒ 调用方 return')
  assert.equal(groups.resolveNewGroupName(''), '', '空名按确定 = 空串 = <无组>（上游不 return 这一支）')
  assert.equal(groups.resolveNewGroupName('   '), '', '只有空白也算空名（组名会被 trim）')
  assert.equal(groups.resolveNewGroupName(' 网络 '), '网络', '首尾空白去掉，中间保留')
  // 空名落到规则层：assign 那边空串与 null 同义（`XBreakpointCustomGroupingRule.kt:24` 的 takeIf{isNotEmpty}）。
  const refs = ['src/a.cpp:1', 'src/a.cpp:2']
  groups.assignBreakpointsToGroup(refs, '甲')
  try {
    assert.deepEqual(groups.assignBreakpointsToGroup(refs, groups.resolveNewGroupName('')), refs)
    assert.deepEqual(groups.groupNames(refs), [], '空名 = 组清空')
  } finally {
    groups.assignBreakpointsToGroup(refs, null)
  }
})

test('接线：两处「新建…」都走同一个取消判据（原来组节点那条把取消当成搬到无组）', () => {
  const view = readFileSync('src/components/BreakpointsDialog.vue', 'utf8')
  const calls = view.match(/resolveNewGroupName\(window\.prompt\('新建组名称', ''\)\)/g) ?? []
  assert.equal(calls.length, 2, '逐条的「所在组」与组节点的「移至组」两处都要问同一个判据')
  const returns = view.match(/if \(name === null\) return/g) ?? []
  assert.equal(returns.length, 2, '拿到取消后必须当场 return（上游 `:547-549` 那两行）')
  // 旧形状：把取消折成空串（`?? ''`）= 按一次 Esc 整组搬去「无组」；`?.trim()` 后 `if (!name)` = 空名按确定也不动。
  assert.doesNotMatch(view, /window\.prompt\([^)]*\)\?\.trim\(\)/, '又回到自己 trim ⇒ 取消与空名糊成一团')
  assert.doesNotMatch(view, /window\.prompt\([^)]*\)\?\.trim\(\) \?\? ''/, '组节点那条又开始把取消当空名')
  assert.match(view, /import \{[\s\S]*?resolveNewGroupName[\s\S]*?\} from '\.\.\/breakpointGroups'/, '没从规则层 import')
})

test('行号锚点：「移至组」族引用的上游行逐字对得上参考树（不在则跳过）', () => {
  if (!existsSync(REF)) return
  const dialog = 'platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/breakpoints/ui/BreakpointsDialog.java'
  const rule = 'platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/breakpoints/ui/grouping/XBreakpointCustomGroupingRule.kt'
  const at = (path, n) => readFileSync(join(REF, path), 'utf8').split('\n')[n - 1].trim()
  const pins = [
    [dialog, 324, 'res.add(new MoveToGroupAction(null));'],
    [dialog, 337, 'res.add(new Separator());'],
    [dialog, 338, 'res.add(new MoveToGroupAction());'],
    [dialog, 542, 'public void actionPerformed(@NotNull AnActionEvent e) {'],
    [dialog, 545, 'groupName = Messages.showInputDialog(XDebuggerBundle.message("breakpoints.dialog.new.group.name"),'],
    [dialog, 547, 'if (groupName == null) {'],
    [dialog, 548, 'return;'],
    [dialog, 551, 'for (BreakpointItem item : myTreeController.getSelectedBreakpoints(true)) {'],
    [rule, 24, 'val name = proxy.getGroup()?.takeIf { it.isNotEmpty() }'],
  ]
  for (const [path, n, text] of pins) assert.equal(at(path, n), text, `${path.split('/').pop()}:${n} 不是那一行`)
  // 本仓的引用形状必须指着上面这些实测行（裸行号不带路径 ⇒ 仓里的引用门控收不到，只能这样钉）。
  const groups = readFileSync('src/breakpointGroups.ts', 'utf8')
  const view = readFileSync('src/components/BreakpointsDialog.vue', 'utf8')
  assert.match(groups, /BreakpointsDialog\.java:324/, '「<无组>」那一项没钉在实测的 :324')
  for (const text of [groups, view]) {
    assert.match(text, /:547-549/, '取消 = 上游 return 那两行没进引用')
    assert.match(text, /:338/, '「新建…」那一项的行号没引用')
  }
  assert.match(view, /XBreakpointCustomGroupingRule\.kt:24/, '空名 = 无组 那条依据没引用')
})
