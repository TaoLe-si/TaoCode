import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shellSource } from './shell-source.mjs'

// IDEA 的菜单是一棵 ActionGroup 树：`<group popup="true">` 就是**子菜单**
// （PlatformActions.xml 里 LayoutsGroup / ViewAppearanceGroup / FindMenuGroup /
// FilePropertiesGroup / ExportImportGroup / Macros / HelpDiagnosticTools 等十几处）。
// TaoCode 原来把子菜单的行拍平进父菜单，这里锁住"模型 + 渲染 + 交互"三处都真的有层级。
const app = shellSource()
// 拆分后子菜单的状态与定位在独立模块、MenuRow 在共享类型文件（模仿 IDEA 一类一文件）。
const submenuSrc = readFileSync(new URL('../src/menus/submenuState.ts', import.meta.url), 'utf8')
const menuTypes = readFileSync(new URL('../src/menus/types.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const appearance = readFileSync(new URL('../src/appearanceActions.ts', import.meta.url), 'utf8')

test('MenuRow carries children so a group can stay a submenu', () => {
  assert.match(menuTypes, /interface MenuRow \{[\s\S]*?children\?: MenuRow\[\]/, 'MenuRow 必须有 children')
  assert.match(app, /from '\.\/menus\/types'/, 'App 引用共享类型而不是自带一份')
})

test('the window layout group is one row with children, not flattened rows', () => {
  assert.match(app, /id: 'window\.layouts', title: '[^']*', keywords: '[^']*', children \}/,
    'LayoutsGroup 应是一行带 children 的子菜单')
  // 拍平时代的字段名不该再出现在顶层 rows 里
  assert.doesNotMatch(app, /rows\.push\(\{ id: 'window\.restoreLayout'/)
  assert.doesNotMatch(app, /rows\.push\(\{ id: 'window\.storeLayout'/)
  assert.doesNotMatch(app, /const rows: MenuRow\[\] = \[\n\s*\{ id: 'window\.factoryLayout'/)
})

// PlatformActions.xml:680-686 —— `<group id="ResizeToolWindowGroup" popup="true">`，子项是四条拉伸动作。
// 以前用 section 标题顶替（注释里写着 "TaoCode's menus are flat"），现在必须是真子菜单。
test('the tool window resize group is a real submenu now', () => {
  assert.match(app, /id: 'window\.resizeToolWindow', title: '[^']*', keywords: '[^']*', children: \[/)
  assert.doesNotMatch(app, /id: 'window\.sectionResizeToolWindow'/, 'section 顶替的做法应已删除')
  for (const direction of ['Left', 'Right', 'Up', 'Down'])
    assert.ok(app.includes(`id: 'window.resizeToolWindow${direction}'`), `子项 ${direction} 不能丢`)
})

// PlatformActions.xml:465-486 —— `<group id="FindMenuGroup" popup="true">`。
test('the edit menu find group is a real submenu now', () => {
  assert.match(app, /id: 'edit\.findMenu', title: '[^']*', keywords: '[^']*', children: \[/)
  assert.doesNotMatch(app, /id: 'edit\.sectionFind'/, 'section 顶替的做法应已删除')
  const body = app.slice(app.indexOf("id: 'edit.findMenu'"), app.indexOf("id: 'edit.findMenu'") + 1400)
  assert.match(body, /editable\('find',/, 'Find 是子项')
  assert.match(body, /editable\('find\.next'/, 'FindNext 是子项')
  assert.match(body, /editable\('find\.previous'/, 'FindPrevious 是子项')
  assert.match(body, /toolWindow\('search'/, 'FindInPath 的落点也在这一组里')
})

// PlatformActions.xml:688-705 —— `<group id="EditorTabsGroup" popup="true">`；其中的
// CloseEditorsGroup **不带** popup，是内联组，所以用分隔线表达同一层，不做第二层嵌套。
test('the editor tabs group is a submenu with the close group inlined', () => {
  assert.match(app, /id: 'window\.editorTabsGroup', title: '[^']*', keywords: '[^']*', children: \[/)
  assert.doesNotMatch(app, /id: 'window\.ruleTabs'/, '被 submenu 边界取代的旧分隔线应已删除')
  assert.match(app, /id: 'window\.ruleCloseEditors', rule: true/, '内联组用分隔线表达')
  for (const id of ['window.nextTab', 'window.previousTab', 'window.closeActiveTab', 'window.closeOtherTabs', 'window.closeAllTabs'])
    assert.ok(app.includes(`id: '${id}'`), `${id} 不能丢`)
})

// PlatformActions.xml:572-586 —— EditorToggleActions popup：这些是 ToggleAction，落点是同一份
// 编辑器设置；`EditorToggleShowGutterIcons` 在 TaoCode 没有落点（没有行内图标层），不造空行。
test('the editor toggle actions submenu flips real editor settings', () => {
  assert.match(app, /id: 'view\.editorToggleActions', title: '[^']*', keywords: '[^']*', children: \[/)
  const body = app.slice(app.indexOf("id: 'view.editorToggleActions'"), app.indexOf("id: 'view.editorToggleActions'") + 3200)
  // 菜单模块通过 ctx 注入编辑器设置与保存动作（src/menus/viewMenu.ts）。
  for (const setting of ['wordWrap', 'showWhitespaces', 'lineNumbers', 'showGutterIcons', 'showIndentGuides'])
    assert.match(body, new RegExp(`ctx\\.saveSettingsPatch\\(\\{ ${setting}: !ctx\\.editorSettings\\.value\\.${setting} \\}\\)`),
      `${setting} 的开关要有真实落点`)
  // 字号动作受与设置页相同的上下限约束（10–32）
  assert.match(body, /Math\.min\(32, ctx\.editorSettings\.value\.fontSize \+ 1\)/)
  assert.match(body, /Math\.max\(10, ctx\.editorSettings\.value\.fontSize - 1\)/)
  // 原先这里断言「不许出现 gutter icons 一项」（当时 TaoCode 没有行内图标层）。2026-09-27 已把
  // 宿主能力补齐（src/gutterIcons.ts + src/editorGutterIcons.ts，IDEA `GutterIconRenderer`），
  // 所以守卫改成上面 `showGutterIcons` 的**正向**断言：这一行必须写回真实设置。
})

// PlatformActions.xml:726-728 —— `<group id="Notifications" popup="true">`：CloseFirstNotification
// 关掉**最新**一条（`pushNotice` 前插，所以是下标 0），CloseAllNotifications 清空日志。
test('the notifications submenu closes the newest notification and clears the log', () => {
  assert.match(app, /id: 'window\.notifications', title: '[^']*', keywords: '[^']*', children: \[/)
  const body = app.slice(app.indexOf('function closeFirstNotification()'), app.indexOf('function closeFirstNotification()') + 400)
  assert.match(body, /noticeLog\.value = noticeLog\.value\.slice\(1\)/, '最新一条 = 下标 0，去掉它')
  // 清空后既要收起面板，也要把状态栏那段文字交回通道（IDEA `StatusPanel.updateText` 在
  // 没有通知可用时回去显示通道自己的文字 —— 见 tests/status-bar-text.test.mjs）。
  assert.match(body, /if \(!noticeLog\.value\.length\) \{ noticeOpen\.value = false; clearNoticeStatus\(\) \}/,
    '清空后收起通知面板并交回状态栏文字')
  const menu = app.slice(app.indexOf("id: 'window.notifications'"), app.indexOf("id: 'window.notifications'") + 700)
  assert.match(menu, /run: clearNotices/, '关闭全部复用通知中心的清空逻辑')
  // 两条都在空日志时禁用（用子串断言，避免正则转义把断言本身写坏）
  for (const id of ['window.closeFirstNotification', 'window.closeAllNotifications']) {
    const row = app.slice(app.indexOf(`id: '${id}'`), app.indexOf(`id: '${id}'`) + 260)
    assert.ok(row.includes('enabled: () => noticeLog.value.length > 0'), `${id} 空日志时禁用`)
  }
})

// PlatformActions.xml:523-546 —— ViewAppearanceGroup popup，内部 ToggleFullScreenGroup 与
// UIToggleActions 都是**不带 popup 的内联组**（用分隔线表达），所以外观只做一层。
test('the view appearance group is a submenu and does not duplicate Zen Mode', () => {
  assert.match(app, /id: 'view\.appearanceGroup', title: '[^']*', keywords: '[^']*', children: \[/)
  const count = (app.match(/id: 'view\.zenMode'/g) ?? []).length
  assert.equal(count, 1, 'Zen Mode 只应出现一次（收进子菜单后不能留顶层副本）')
  const body = app.slice(app.indexOf("id: 'view.appearanceGroup'"), app.indexOf("id: 'view.appearanceGroup'") + 2000)
  assert.match(body, /id: 'view\.presentation'/, 'TogglePresentationMode 是子项')
  assert.match(body, /id: 'view\.compactMode'/, 'ToggleCompactMode 是子项（TaoCode 用 compactMode 设置落点）')
  assert.match(body, /id: 'view\.ruleAppearance', rule: true/, '内联组用分隔线表达')
})

// PlatformActions.xml:400-412 —— FilePropertiesGroup popup，且它里面的 ChangeLineSeparators(:405)
// **自己也是 popup** → 这是真正的两层嵌套，也是本轮唯一一处二级子菜单。
test('the file properties group nests the line-separator group inside it', () => {
  const props = app.indexOf("id: 'file.properties'")
  assert.ok(props > 0, '文件属性应是子菜单')
  const body = app.slice(props, props + 2200)
  assert.match(body, /id: 'file\.lineSeparators', title: '[^']*', keywords: '[^']*', children: \[/, '行分隔符要嵌在文件属性里')
  assert.match(body, /id: 'file\.lineSeparatorWindows'/, 'Windows 行尾在第二层里')
  assert.match(body, /id: 'file\.lineSeparatorUnix'/, 'Unix 行尾在第二层里')
  assert.match(body, /id: 'file\.encoding'/, '文件编码是同级的第一个子项')
  assert.match(body, /id: 'file\.toggleReadOnly'/, '只读属性在同一子菜单里')
  // IDEA 还有 ConvertToMacLineSeparators，但 TaoCode 的转换只支持 CRLF/LF，不造第三项
  assert.doesNotMatch(body, /id: 'file\.lineSeparatorMac'/)
})

test('the renderer has a submenu branch ahead of the plain row branch', () => {
  const loop = app.slice(app.indexOf('v-for="row in group.rows"'), app.indexOf('</motion.div>'))
  const submenuAt = loop.indexOf('v-else-if="hasSubmenu(row)"')
  const plainAt = loop.indexOf('v-else class="menu-item"')
  assert.ok(submenuAt > 0, '必须有子菜单分支')
  assert.ok(plainAt > submenuAt, '子菜单分支必须排在普通行之前（v-else 链按顺序求值）')
  // 2026-09-27：渲染改用 `submenuRows(row)` —— 它优先取动态组（`childrenOf`，IDEA `ActionGroup.getChildren()`），
  // 静态 `children` 仍然走同一条路（见 src/menus/submenuState.ts）。
  assert.match(loop, /v-for="child in submenuRows\(row\)"/, '子菜单要渲染 children')
  assert.match(loop, /role="separator"/, '子菜单里也要能放分隔线')
})

test('picking a parent row toggles the submenu instead of running it', () => {
  const body = app.slice(app.indexOf('function pickMenuRow('), app.indexOf('function pickMenuRow(') + 900)
  assert.match(body, /if \(hasSubmenu\(row\)\) \{/, '父行必须先判子菜单')
  assert.match(body, /return/, '父行不能继续走到 run() 与关闭菜单')
  // 关闭顺序：先关主菜单，再关子菜单，最后才执行动作
  assert.match(body, /menu\.value = null[\s\S]*?submenuRow\.value = null[\s\S]*?row\.run\?\.\(\)/)
})

test('a submenu opens next to its parent row and can be dismissed', () => {
  assert.match(submenuSrc, /function openSubmenu\(row: MenuRow, event: Event\)/, '需要按父行 rect 定位')
  assert.match(submenuSrc, /getBoundingClientRect\(\)/, '定位取自父行')
  assert.match(app, /@keydown\.esc\.stop="closeSubmenu\(\)"/, 'Esc 关闭子菜单')
  assert.match(app, /submenuRow = null/, '切换主菜单时要清掉子菜单')
})

test('the submenu is positioned out of the parent menu flow', () => {
  assert.match(css, /\.dropdown\.menu-submenu \{ position: fixed;/, '子菜单必须脱离父菜单的 overflow')
  // Teleport 到 body 后不再继承父菜单的层叠上下文：z-index 要压过编辑器浮层（900）与 z-40 的工具弹层。
  assert.match(css, /\.dropdown\.menu-submenu \{[^}]*z-index: 901;/, '子菜单要抬到编辑器浮层之上')
  assert.match(css, /\.menu-submenu-caret \{ margin-left: auto;/)
})

// 子菜单里的动作不能因为搬进 children 就从「查找操作」里消失 —— IDEA 的 Find Action
// 同样会把子菜单的动作列出来。
test('the action index flattens submenus instead of losing their rows', () => {
  assert.match(app, /function flattenMenuRows\(rows: readonly MenuRow\[\]\): MenuRow\[\]/, '需要一个递归摊平')
  assert.match(app, /for \(const row of flattenMenuRows\(group\.rows\)\)/, '索引要遍历摊平后的行')
  // 父行没有 run，摊平后不会变成点不动的命令
  assert.match(app, /if \(!row\.run \|\| seen\.has\(row\.id\)\) continue/)
})

// IDEA ExpandableMenu.switchState: 点左上角按钮是把真正的菜单栏横着展开，
// 不是另开一棵分组树。菜单栏本来就有子菜单，所以不再需要汉堡面板的缩进行。
test('the hamburger button expands the real menu bar instead of a second menu tree', () => {
  assert.match(app, /hamburgerOpen = !hamburgerOpen/, '按钮仍是开关')
  assert.doesNotMatch(app, /class="hamburger-menu"/, '不再渲染另一套菜单树')
  assert.match(css, /html\[data-main-menu='hamburger'\]:not\(\[data-menu-expanded='on'\]\) \.menubar \{ display: none; \}/,
    '未展开时菜单栏隐藏')
  // merged 档的溢出按钮点开的是同一个弹层（上游两档共用 MainMenuButton），所以这条规则是两条选择器。
  assert.match(css, /html\[data-main-menu='hamburger'\]\[data-menu-expanded='on'\] \.menubar,\s*html\[data-main-menu='merged'\]\[data-menu-expanded='on'\] \.menubar \{ display: flex;/,
    '展开时显示真正的菜单栏（汉堡档与 merged 溢出档共用同一条规则）')
  assert.match(appearance, /dataset\.menuExpanded = 'on'/, '展开状态写到根节点')
})

// 父级弹层是 motion.div，动画会留下 transform —— transformed 祖先会让 position:fixed 退化成
// 相对弹层定位，子菜单会弹到错误位置。所以浮层必须 Teleport 到 body（项目里 quickDoc /
// signaturePopup 也是这么做的），且 dismissMenu 要放行 .menu-submenu。
test('the submenu is teleported to body and click-through is whitelisted', () => {
  assert.match(app, /<Teleport to="body">\s*<div v-if="submenuRow === row\.id" class="dropdown menu-submenu"/,
    '浮层必须 Teleport 到 body')
  assert.match(app, /closest\('[^']*\.menu-submenu[^']*'\)/, 'dismissMenu 必须放行子菜单，否则点子项会关掉整条菜单')
})

// 鼠标从父行移向浮层的路上不能立刻关：延迟关闭、进入浮层取消。
test('the submenu closes on mouse leave with a grace period', () => {
  assert.match(submenuSrc, /function scheduleSubmenuClose\(\)/, '要有延迟关闭')
  assert.match(submenuSrc, /function cancelSubmenuClose\(\)/, '进入浮层要取消关闭')
  assert.match(app, /@mouseleave="scheduleSubmenuClose"/, '父行离开时调度关闭')
  assert.match(app, /@mouseenter="cancelSubmenuClose"/, '进入浮层取消关闭')
})

// —— 嵌套 UI 的样式（这批修的就是它们） ——

// 父行外面包了 anchor，`.dropdown > .menu-item` 的 hover 规则够不到它：不补就既没有 hover
// 高亮、子菜单打开时父行也不保持选中（IDEA 的父行在子菜单打开时是选中态）。
test('the submenu parent row is styled on hover and while its submenu is open', () => {
  assert.match(css, /\.menu-submenu-trigger \{ display: flex;/, '触发器要有自己的盒样式')
  assert.match(css, /\.menu-submenu-trigger:hover:not\(:disabled\)/, '要有 hover 高亮')
  assert.match(css, /\.menu-submenu-trigger\[aria-expanded='true'\] \{ background: var\(--selected\)/,
    '子菜单打开时父行保持选中')
})

// 父级弹层有入场动画（motion.div），子菜单不该突然弹出；且要尊重系统的减少动态设置。
// 时长/缓动已搬进 tokens.css 的 --dur-submenu / --ease（原先就地写死 160ms + cubic-bezier），
// 所以这里断言的是**令牌引用**，再单独钉住令牌的值 —— 数值本身不能被悄悄改掉。
test('the submenu entrance animation matches the parent and honours reduced motion', () => {
  const tokens = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
  assert.match(tokens, /--dur-submenu: 160ms;/, '子菜单入场时长令牌不能变')
  assert.match(tokens, /--ease: cubic-bezier\(\.16, 1, \.3, 1\);/, '缓动令牌不能变')
  assert.match(css, /animation: menu-submenu-in var\(--dur-submenu\) var\(--ease\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.dropdown\.menu-submenu \{ animation: none; \} \}/)
})

// 长子菜单（比如「布局」）不能顶出屏幕：放不下要向上翻转，两个朝向都夹住 maxHeight。
test('the submenu flips above and clamps its height inside the viewport', () => {
  const logic = submenuSrc.slice(submenuSrc.indexOf('function openSubmenu('), submenuSrc.indexOf('function closeSubmenu()'))
  assert.match(logic, /submenuPlacement\.value = 'above'/, '要有向上翻转')
  assert.match(logic, /bottom: `/, '向上翻转用 bottom 锚定')
  assert.match(logic, /maxHeight: `/, '两个朝向都要夹 maxHeight')
  assert.match(app, /:style="submenuStyle"/, '定位与高度走同一个 style 对象')
})
