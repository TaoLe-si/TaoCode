// 欢迎页的**分组**：新建 / 改名 / 「移动到分组」那一段的项序（`pv/welcome` 里 `ProjectGroup` 一族）。
// 上游依据（本轮逐条读过，行号可复现）：
//   · `platform/platform-impl/resources/idea/PlatformActions.xml:1021-1025`
//     —— 行菜单分组段的次序：`<separator/>` → NewGroup → MoveToGroup → EditGroup；
//   · `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:578-581`
//     —— 三个 id 的实现类（`CreateNewProjectGroupAction` / `MoveProjectToGroupActionGroup` / `EditProjectGroupAction`）；
//   · `…/welcomeScreen/projectActions/MoveProjectToGroupActionGroup.kt:31-48`
//     —— 弹层内容：分组按 `NaturalComparator.INSTANCE` 排序名（`:38`）、`isTutorials` 的组跳过（`:39-42`）、
//        有组时末尾加分隔线（`:46`）+ `RemoveSelectedProjectsFromGroupsAction`（`:47`）；
//   · `…/projectActions/CreateNewProjectGroupAction.kt:19-32` —— trim 后查重、建的是**空分组**；
//   · `…/projectActions/EditProjectGroupAction.kt:22-48` —— 重命名：初值当前名、空名报错、撞名报错、
//        改回原名放行，且 `isEnabledAndVisible = item is ProjectsGroupItem`（**只在分组行上**）；
//   · 文案：`platform/platform-resources-en/src/messages/ActionsBundle.properties:2205`（New Project Group）/
//     `:2206`（Edit…）/ `:2558`（Move to Group）、
//     `platform/platform-api/resources/messages/IdeBundle.properties:242`（Name cannot be empty）/
//     `:2639`（Group ''{0}'' already exists.）/ `:1793`（Remove from Groups）/
//     `:2149-2150`（Change Group Name / Enter group name:）/ `:2168-2169`（Create New Project Group / Project group name）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GROUP_MENU_LABELS, GROUP_NEW_PROMPT, GROUP_NEW_TITLE, GROUP_RENAME_PROMPT, GROUP_RENAME_TITLE, moveTargetGroupNames, validateGroupName } from '../src/welcomeProjects.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ── 纯规则 ────────────────────────────────────────────────────────────────────────

test('「移动到分组」的组名按自然序，tutorials 那类组不出现（MoveProjectToGroupActionGroup.kt:38-42）', () => {
  const names = moveTargetGroupNames([
    { name: 'Group 10' }, { name: 'Group 2' }, { name: '课程', tutorials: true }, { name: 'alpha' },
  ])
  assert.deepEqual(names, ['alpha', 'Group 2', 'Group 10'], '比较器 ignoreCase（NaturalComparator.java:20-34），数字段按数值比；教程组被跳过')
  assert.deepEqual(moveTargetGroupNames([{ name: 'x', tutorials: true }]), [], '全是教程组时是空表')
})

test('分组名校验：空名 / 撞名 / 改回原名（CreateNewProjectGroupAction.kt:19-21 + EditProjectGroupAction.kt:26-40）', () => {
  assert.deepEqual(validateGroupName(['a'], '', '  '), { ok: false, error: '名称不能为空。' })
  assert.deepEqual(validateGroupName(['a'], '', 'a'), { ok: false, error: '分组「a」已存在。' })
  assert.deepEqual(validateGroupName(['a', 'b'], 'a', ' a '), { ok: true, name: 'a' }, '改回原名放行（trim 后相等）')
  assert.deepEqual(validateGroupName(['a'], 'a', 'b'), { ok: true, name: 'b' })
})

test('两个对话框的标题/提示来自上游那四条 message key', () => {
  assert.equal(GROUP_NEW_TITLE, '新建项目分组')        // dialog.title.create.new.project.group（:2168）
  assert.equal(GROUP_NEW_PROMPT, '分组名称')           // dialog.message.project.group.name（:2169）
  assert.equal(GROUP_RENAME_TITLE, '更改分组名称')     // dialog.title.change.group.name（:2149）
  assert.equal(GROUP_RENAME_PROMPT, '请输入分组名称：') // label.enter.group.name（:2150）
})

test('菜单文案来自上游那四条 action 文本', () => {
  assert.equal(GROUP_MENU_LABELS.create, '新建项目分组')     // action.WelcomeScreen.NewGroup.text（:2205）
  assert.equal(GROUP_MENU_LABELS.edit, '编辑分组…')          // action.WelcomeScreen.EditGroup.text（:2206）
  assert.equal(GROUP_MENU_LABELS.moveTo, '移动到分组')       // group.WelcomeScreen.MoveToGroup.text（:2558）
  assert.equal(GROUP_MENU_LABELS.removeFromGroups, '从分组移出') // IdeBundle.properties:1793
})

// ── 接线：组件真的用上面那些规则 ──────────────────────────────────────────────────

test('接线：新建的是空分组，改名走 validateGroupName（不是又建一个）', () => {
  const page = read('src/welcomeProjectGroups.ts')
  assert.match(page, /function createGroup\(\) \{[\s\S]*?askGroupName\(GROUP_NEW_TITLE, GROUP_NEW_PROMPT, ''\)[\s\S]*?paths: \[\]/)
  assert.match(page, /function renameGroup\(from: string\)[\s\S]*?askGroupName\(GROUP_RENAME_TITLE, GROUP_RENAME_PROMPT, from\)/)
  assert.match(page, /validateGroupName\(groups\.value\.map\(group => group\.name\), initial, answer\)/)
  assert.ok(!/createGroupWith/.test(page), '旧的「新建分组并移入」已换成上游的 NewGroup 语义')
})

test('接线：改名只挂在分组行上（EditProjectGroupAction.kt:48 的那条判定）', () => {
  const page = read('src/components/WelcomePage.vue')
  const head = page.slice(page.indexOf('class="recent-group-head"'), page.indexOf('</header>', page.indexOf('class="recent-group-head"')))
  assert.match(head, /@click\.stop="renameGroup\(group\.name\)"/)
  assert.match(head, /GROUP_MENU_LABELS\.edit/)
  assert.match(head, /group\.name !== UNGROUPED/)
  const menu = page.slice(page.indexOf('class="row-menu"'), page.indexOf('仅从列表移除', page.indexOf('class="row-menu"')))
  assert.ok(!/renameGroup/.test(menu), '项目行的菜单里没有改名这一项')
})

test('接线：折叠状态跟着改名走（groupCollapsed 是按名字存的）', () => {
  const page = read('src/welcomeProjectGroups.ts')
  assert.match(page, /groupCollapsed\.value = new Set\(\[\.\.\.groupCollapsed\.value\]\.map\(collapsed => \(collapsed === from \? name : collapsed\)\)\)/)
})

test('分组段的项序：NewGroup → 各分组 → 弹层自己的分隔线 → 从分组移出（PlatformActions.xml:1022-1024）', () => {
  const page = read('src/components/WelcomePage.vue')
  const start = page.indexOf('class="row-menu"')
  const menu = page.slice(start, page.indexOf('仅从列表移除', start))
  const create = menu.indexOf('GROUP_MENU_LABELS.create')
  const move = menu.indexOf('v-for="name in moveTargets"')
  const rule = menu.indexOf('class="submenu-rule"')
  const remove = menu.indexOf('GROUP_MENU_LABELS.removeFromGroups')
  for (const [name, index] of [['新建项目分组', create], ['移入各分组', move], ['弹层分隔线', rule], ['从分组移出', remove]]) {
    assert.ok(index >= 0, `分组段少了「${name}」`)
  }
  assert.ok(create < move, 'NewGroup 在 MoveToGroup 之前（:1022 先于 :1023）')
  assert.ok(move < rule && rule < remove, '弹层自己的分隔线夹在分组列表与「从分组移出」之间（:46-47）')
})

test('「从分组移出」只对已在组里的项目可点，且不会把记录从最近列表里删掉', () => {
  const page = read('src/components/WelcomePage.vue')
  // moveToGroup 的实现 2026-10-06 搬进 src/welcomeProjectGroups.ts（桶 14c 拆文件），锚点跟着改指。
  const impl = read('src/welcomeProjectGroups.ts')
  assert.match(page, /:disabled="groupOf\(project\.path\) === UNGROUPED"[\s\S]*?moveToGroup\(project, UNGROUPED\)/)
  // 实现侧：moveToGroup 是把 path 从各组的 paths 里摘掉，不碰 projects/持久最近列表。
  assert.match(impl, /function moveToGroup\(project: RecentProject, name: string\)[\s\S]*?paths\.filter\(path => path !== project\.path\)/)
  assert.ok(!/projects\.value = |props\.projects\.filter/.test(impl.slice(impl.indexOf('function moveToGroup'), impl.indexOf('function askGroupName'))),
    '移出分组≠移除最近项目（那是 RemoveSelectedProjectsAction 的活）')
})
