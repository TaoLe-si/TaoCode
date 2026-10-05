// 断点分组（`src/breakpointGroups.ts` + `src/exceptionBreakpoints.ts` + `BreakpointsDialog.vue`）。
//
// 上游：`XBreakpointGroupingRule` 一族 —— `XBreakpointFileGroupingRule`（按文件）、
// `XBreakpointGroupingByTypeRule`（按类型，异常断点就是其中一类）、`BreakpointsGroupNode`。
// 本仓列表项都是行断点 ⇒ 按文件分组；异常断点是共享状态里的独立分组（面板与对话框同一份勾选）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
