// 接线收尾的回归门禁 —— 2026-10-05 那一轮「规则层齐、只差挂载点」的四条。
//
// 为什么要有这个文件：那四条里三条的逻辑本来就在（`keymapHost` / `keymapEditor` 的活状态、
// `actionRegistry` 的注册表、`MenuRow.icon` 的数据侧），**缺的只是宿主那一行**。缺宿主那行时
// 底下所有模块自己的测试照样全绿 —— 判词里说的「零消费方」就是这种状态。所以这里守的是
// **接线本身**：宿主那几行没了，就得红。
//
// 纯 JavaScript（`npm test` 不带 `--experimental-strip-types`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MENU_ROW_ICONS, menuRowIcon } from '../src/menuRowIcons.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------- 1 · 键位面板挂上

test('1 · 帮助菜单那个「键盘映射…」入口对面，KeymapDialog 真的挂在宿主上', () => {
  const app = read('src/App.vue')
  assert.match(app, /import KeymapDialog from '\.\/components\/KeymapDialog\.vue'/,
    'App.vue 没有 import 面板组件 —— helpMenu.ts:52 的 openKeymapDialog() 点了没反应')
  assert.match(app, /import \{ keymapHost \} from '\.\/keymapHost'/,
    '没有 import 活状态，开关读不到')
  assert.match(app, /<KeymapDialog v-if="keymapHost\.keymapDialogOpen" @close="keymapHost\.closeKeymapDialog\(\)" \/>/,
    '模板里没有挂载点')
  // 入口侧：菜单那一条必须还在，否则挂上去也没有人能打开它。
  const help = read('src/menus/helpMenu.ts')
  assert.match(help, /id: 'help\.keymapSettings'.*keymapHost\.openKeymapDialog\(\)/,
    '帮助菜单的入口不见了')
})

// ------------------------------------------- 2 · 注册表里那些没有菜单行的动作进搜索索引

test('2 · 动作索引把「只有键位、没有菜单行」的动作也收进去', () => {
  const ui = read('src/menuUi.ts')
  // 供给侧：注册表的描述符按 id 补进索引，且不覆盖菜单已有的行。
  assert.match(ui, /for \(const entry of registryEntries\(\)\) if \(!seen\.has\(entry\.id\)\) seen\.set\(entry\.id, entry\)/,
    'actionList 没有合并注册表快照 ⇒ 不在菜单里的动作（转到行 / 快速文档 / 提取方法…）搜不到')
  assert.match(ui, /for \(const id of ACTIONS\.ids\(\)\)/, '快照没有从 ACTIONS.ids() 取')
  // 刷新点：注册表不是响应式的（键位动作按需注册），所以两个搜索面板打开时都要显式重算。
  assert.match(ui, /const refreshActionRegistryIndex = \(\) => \{ registryRevision\.value\+\+ \}/,
    '缺刷新口')
  assert.match(ui, /function openActionSearch\(\) \{\s*\/\/[^\n]*\n\s*refreshActionRegistryIndex\(\)/,
    'Find Action 打开时没有重算注册表')
  const se = read('src/searchEverywhereHost.ts')
  assert.match(se, /deps\.refreshActionRegistryIndex\?\.\(\)/,
    'Search Everywhere 打开时没有重算注册表')
  // 宿主把那个口递进去了。
  assert.match(read('src/App.vue'), /actionList, runAction, refreshActionRegistryIndex,/,
    'App.vue 没有把刷新口传给 createSearchEverywhereHost')
})

// ------------------------------------------------------------- 3 · MenuRow.icon 渲染位

test('3 · 菜单行的图标位真的渲染（尺寸走阶梯，不是写死的数字）', () => {
  const app = read('src/App.vue')
  assert.match(app, /import \{ menuRowIcon \} from '\.\/menuRowIcons'/, '没有 import 解析器')
  // 三个行位：子菜单触发行、子菜单里的子行、顶层行。`.menu-item-icon` 槽位是既有的
  // （状态栏那两处是别的槽，不在这三条断言里）。
  assert.match(app, /<span class="menu-item-icon"><component :is="menuRowIcon\(row\.icon\)" v-if="menuRowIcon\(row\.icon\)"/,
    '子菜单触发行（原本是空槽）没接上行图标')
  assert.match(app, /<IdeaCheckedIcon v-if="child\.checked && child\.checked\(\)"[^>]*\/><component v-else-if="menuRowIcon\(child\.icon\)"/,
    '子菜单里的子行：勾选记号之外没有行图标位')
  assert.match(app, /<IdeaCheckedIcon v-if="row\.checked && row\.checked\(\)"[^>]*\/><component v-else-if="menuRowIcon\(row\.icon\)"/,
    '顶层菜单行：勾选记号之外没有行图标位')
  // 尺寸只能来自 uiIcons 的阶梯，模板里不许出现写死的像素。
  for (const hit of app.match(/<component[^>]*menuRowIcon[^>]*>/g) ?? []) {
    assert.match(hit, /:size="iconSize\./, '菜单行图标必须用 iconSize.* 阶梯：' + hit)
    assert.match(hit, /aria-hidden="true"/, '图标是装饰，行的可访问名由文字给出：' + hit)
  }
  // 只看代码行：这个模块的注释里**故意**引用了被禁的 `:size="14"` 写法来说明禁令本身。
  const resolverCode = read('src/menuRowIcons.ts')
    .split('\n').filter(line => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
  assert.doesNotMatch(resolverCode.join('\n'), /:size="\d+"/, '解析器里不许写死尺寸')
})

test('3b · 图标名解析：认得的给组件，认不给的返回 null（不占槽）', () => {
  assert.ok(menuRowIcon('Folder'), '本仓已有的那个图标名（runAnythingContext.ts:132）要能解析')
  assert.equal(menuRowIcon('NoSuchIcon'), null, '表里没有的名字返回 null，模板 v-if 掉')
  assert.equal(menuRowIcon(undefined), null, '没给名字返回 null')
  assert.equal(menuRowIcon(''), null, '空串返回 null')
  assert.deepEqual(Object.keys(MENU_ROW_ICONS), ['Folder'],
    '图标表不该被随手加键 —— 上游 PlatformActions.xml 里 icon= 只有 2 处命中，' +
    'IconLoader 在本 checkout 里搜不到，配图标没有可引的依据')
})

// ------------------------------------------------------- 4 · Settings › Keymap 节点

test('4 · 键位面板挂在设置树里（上游的真实入口位置）', () => {
  const meta = read('src/settingsTreeMeta.ts')
  // 上游：intellij.platform.ide.impl.xml:950-952 groupId="root" groupWeight="65" id="preferences.keymap"
  assert.match(meta, /groupId="root" groupWeight="65"[^>]*id="preferences\.keymap"/,
    '上游注册证据那行不在注释里了（intellij.platform.ide.impl.xml:950-952）')
  assert.match(meta, /key: 'preferences\.keymap', label: '键盘映射', icon: Keyboard, parent: null/,
    'Keymap 节点必须是顶层节点（parent: null，对应上游 groupId="root"）')
  // 这两个键都要在 `PageKey` 联合里 —— **不钉它们相邻**（原写法要求 Gradle 页键后面紧跟
  // keymap 页键，于是往联合尾部加 `agent` 页键就把这条判据打红了：那是形状，不是意图）。
  assert.match(meta, /'reference\.settingsdialog\.project\.gradle',[\s\S]{0,120}'preferences\.keymap'/,
    '页面键没进 PageKey 联合 —— 没进就渲染不出内容')
  assert.match(meta, /\n\s+\| 'preferences\.keymap'/,
    '页面键没进 PageKey 联合')
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /import KeymapSettingsPage from '\.\/KeymapSettingsPage\.vue'/,
    '设置对话框没有 import 面板页')
  assert.match(dialog, /<section v-show="section === 'preferences\.keymap'"[\s\S]*?<KeymapSettingsPage \/>/,
    '设置对话框里没有这一页的挂载位')
  // 页面与对话框读同一份活状态（改键两边立刻同步）。
  const page = read('src/components/KeymapSettingsPage.vue')
  assert.match(page, /import \{ keymapHost \} from '\.\.\/keymapHost'/, '页面没有读活状态')
  assert.match(page, /} = keymapHost/, '页面没有解构 keymapHost')
})
