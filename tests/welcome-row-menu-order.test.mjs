// 欢迎页**行菜单**的项序：照上游 `WelcomeScreenRecentProjectActionGroup`，不自己排。
//
// 上游依据 `platform/platform-impl/resources/idea/PlatformActions.xml:1017-1031`：
//   1018 `<reference ref="WelcomeScreen.OpenSelected"/>`        → 打开项目
//   1019 `<reference ref="WelcomeScreen.RevealIn"/>`            → 在资源管理器中显示
//   1020 `<reference ref="WelcomeScreen.CopyProjectPath"/>`     → 复制路径
//   1021 `<separator/>`
//   1022-1024 NewGroup / MoveToGroup / EditGroup                → 分组那一段
//   1026 ChangeProjectIcon                                       → **项目颜色**（ChangeProjectColorActionGroup）
//   1030 `<reference ref="WelcomeScreen.RemoveSelected"/>`      → 仅从列表移除
// 动作 id 的落点：`platform-impl/resources/intellij.platform.ide.impl.actions.xml:574-577`
// （OpenSelectedProjectsAction / RevealProjectDirAction / CopyProjectPathAction）。
// 文案：`platform/platform-resources-en/src/messages/ActionsBundle.properties:2204-2209`。
//
// :1026 这一项现在**有**落点了：上游它挂在项目窗口标题栏上（`ChangeProjectColorActionGroup.kt:33-44`
// 的九个具名颜色），本仓项目颜色唯一可见处是欢迎页这一行，所以照上游的**次序**放进行菜单。
// 它展开成一个二级菜单，二级菜单自己的分隔线用 `submenu-rule` 而不是 `menu-rule` ——
// 下面那条"正好两个分隔线"数的是**行菜单本身**的 :1021 与 :1029，两层菜单不能混进同一个计数。
//
// 刻意不做的两项（无内容源，放出来就是假控件）：`Learn`/`RemoteDevelopment` 标签页
// （docs/ui-parity-checklist.md:172）、`WelcomeScreen.CustomRecentProjectActions` 扩展点。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n')

/** 行菜单（`.row-menu`）那段模板。 */
function rowMenu() {
  const page = read('src/components/WelcomePage.vue')
  const start = page.indexOf('class="row-menu"')
  assert.ok(start >= 0, '找不到行菜单')
  const end = page.indexOf('</div>', page.indexOf('仅从列表移除', start))
  return page.slice(start, end)
}

test('项序 = OpenSelected · RevealIn · CopyProjectPath（PlatformActions.xml:1018-1020）', () => {
  const menu = rowMenu()
  const open = menu.indexOf('打开项目')
  const reveal = menu.indexOf('在资源管理器中显示')
  const copy = menu.indexOf('复制路径')
  const groups = menu.indexOf('GROUP_MENU_LABELS.create')
  const remove = menu.indexOf('仅从列表移除')
  for (const [name, index] of [['打开项目', open], ['在资源管理器中显示', reveal], ['复制路径', copy], ['新建项目分组', groups], ['仅从列表移除', remove]]) {
    assert.ok(index >= 0, `行菜单里少了「${name}」`)
  }
  assert.ok(open < reveal, 'RevealIn 在 CopyProjectPath 之前（:1019 先于 :1020）')
  assert.ok(reveal < copy)
  assert.ok(copy < groups, '分组那一段在分隔线之后（:1021）')
  assert.ok(groups < remove, 'RemoveSelected 最后（:1030）')
})

test('复制路径与分组段之间有一个分隔线，移除前也有一个（:1021 / :1029）', () => {
  const menu = rowMenu()
  const copy = menu.indexOf('复制路径')
  const groups = menu.indexOf('GROUP_MENU_LABELS.create')
  const remove = menu.indexOf('仅从列表移除')
  const rules = [...menu.matchAll(/class="menu-rule"/g)].map(match => match.index)
  assert.equal(rules.length, 2, `行菜单里应当正好两个分隔线（实际 ${rules.length}）`)
  assert.ok(rules[0] > copy && rules[0] < groups, '第一个分隔线夹在复制路径与分组段之间')
  assert.ok(rules[1] > groups && rules[1] < remove, '第二个分隔线夹在分组段与移除之间')
})

test('复制路径的快捷键来自 CopyPaths（use-shortcut-of，intellij.platform.ide.impl.actions.xml:576-577）', () => {
  const menu = rowMenu()
  const copy = menu.slice(menu.indexOf('复制路径') - 200, menu.indexOf('复制路径'))
  assert.match(copy, /copyProjectPath\(project\)/, '复制路径走既有实现（平台自己的路径形态）')
})

test('项目颜色落在 :1026 那个位置：分组段之后、最后那条分隔线之前', () => {
  const menu = rowMenu()
  const groups = menu.indexOf('GROUP_MENU_LABELS.create')
  const color = menu.indexOf('项目颜色')
  const remove = menu.indexOf('仅从列表移除')
  assert.ok(color >= 0, '行菜单里少了「项目颜色」')
  assert.ok(groups < color, '分组段之后才是 ChangeProjectIcon（PlatformActions.xml:1022-1024 之后）')
  assert.ok(color < remove, 'RemoveSelected 仍然最后（:1030）')
  // :1026 与 :1030 之间正好是上游 :1029 那一条分隔线 —— **没有新增**。
  // （前一条断言已经数过整段正好两个 `.menu-rule`，这条钉住第二个落在哪一侧。）
  assert.equal(menu.slice(color, remove).match(/class="menu-rule"/g)?.length ?? 0, 1)
})

test('二级菜单的分隔线不占用行菜单自己的两个计数', () => {
  const menu = rowMenu()
  assert.match(menu, /class="submenu-rule"/, '二级菜单自己那一条用 submenu-rule')
  // 两条：项目颜色子菜单一条 + 「移动到分组」弹层自己的那条（MoveProjectToGroupActionGroup.kt:46）。
  assert.equal([...menu.matchAll(/class="submenu-rule"/g)].length, 2)
})
