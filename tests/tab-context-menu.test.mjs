// 标签右键菜单（`src/components/TabContextMenu.vue`）：第一百零九批从 App.vue 的模板里整块搬出来，
// 并补上上游 `EditorTabPopupMenu` 上的 `CopyReferencePopupGroup`（`PlatformActions.xml:1280`）。
//
// 为什么要一条门禁：组件的依赖走 `ctx`（`any`），**TS 看不见 ctx 里的笔误** ——
// 少一个键就是"点了没反应"，而且只在真机上暴露。所以这里逐键核对：
// 组件模板里出现的每个 `ctx.X` 都必须在 App.vue 的 `tabMenuContext` 里真的有。
//
// 第二组门禁（键盘与 ARIA）见文件末尾：上游这张菜单是个 `JPopupMenu`，行的角色、禁用态、
// 焦点进出与 ↑↓ 行走表都按 Swing 弹层菜单的口径钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseDom, NodeTypes } from '@vue/compiler-dom'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('every ctx.X the component uses is declared in App.vue', () => {
  const component = read('src/components/TabContextMenu.vue')
  const app = read('src/App.vue')
  const start = app.indexOf('const tabMenuContext = {')
  assert.ok(start > 0, 'App.vue 里找不到 tabMenuContext')
  const end = app.indexOf('\n}', start)
  const block = app.slice(start, end).replace('const tabMenuContext = {', '')
  // 对象字面量里的键有两种写法：`name: value` 与简写 `name,`。按"逗号分段 + 段首标识符"取，
  // 这样函数体里引用的 findTab / groups 之类的名字不会被误当成键。
  const declared = new Set()
  // 只按逗号切：段首的空白会把换行一起吃掉，所以「换行 + 缩进 + name: value」这种写法也认。
  for (const segment of block.split(',')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*(?::|\(|$)/.exec(segment)
    if (m) declared.add(m[1])
  }
  declared.delete('const'); declared.delete('tabMenuContext')
  const used = new Set([...component.matchAll(/\bctx\.([A-Za-z0-9_]+)/g)].map(m => m[1]))
  assert.ok(used.size >= 25, `组件只用到 ${used.size} 个 ctx 键，多半没搬全`)
  const missing = [...used].filter(name => !declared.has(name))
  assert.deepEqual(missing, [], `这些键在 tabMenuContext 里没有：${missing.join(', ')}`)
})

test('the menu keeps the upstream row order and the copy group right after 复制路径', () => {
  // 只看模板段：文件头的注释里也提到过「复制路径」，会干扰 indexOf。
  const component = read('src/components/TabContextMenu.vue')
  const template = component.slice(component.indexOf('<template>'))
  const order = ['>关闭<', '关闭其他标签页', '关闭右侧标签页', '关闭左侧标签页', '关闭所有未固定标签页', '全部关闭',
    '复制路径', 'COPY_REFERENCE_GROUP', '切换只读属性', '向右拆分', '向下拆分', 'ctx.pinned(path)']  // 「固定标签页」那一行的判据用处理函数名：标签文案是三元式，且「关闭所有未固定标签页」里也含这四个字
  let cursor = -1
  for (const needle of order) {
    const at = template.indexOf(needle)
    assert.ok(at > cursor, `「${needle}」不在预期的位置（EditorTabPopupMenu 的行序）`)
    cursor = at
  }
})

test('the copy group is a submenu with the four shipped labels', () => {
  const component = read('src/components/TabContextMenu.vue')
  assert.match(component, /import \{ COPY_REFERENCE_GROUP, FIND_COPY_ACTIONS, findResultClipboardText, type FindCopyActionId \} from '\.\.\/copyPathActions'/)
  assert.match(component, /COPY_REFERENCE_GROUP/, '组名取 group.CopyReferencePopupGroup.text')
  assert.match(component, /v-for="row in copyRows"/)
  assert.match(component, /class="sub-item"/)
  assert.match(component, /findResultClipboardText\(id, copyTarget\(\), root\)/, '四项共用同一份文本口径')
})

test('the group targets the tab, and the line comes from that tab', () => {
  const component = read('src/components/TabContextMenu.vue')
  assert.match(component, /return \{ path: props\.path, line: props\.ctx\.tabLine\(props\.path\) \}/)
})

test('App.vue renders the component and no longer carries the menu markup', () => {
  const app = read('src/App.vue')
  assert.match(app, /<TabContextMenu v-if="tabMenu" :ctx="tabMenuContext"/)
  assert.ok(!app.includes('配置编辑器标签页…</button>'), '那段 markup 必须整块搬走（App.vue 贴上限）')
  assert.match(app, /@close="tabMenu = null"/)
})

test('the extracted component still checks "tab exists" before acting, like the old expressions', () => {
  const app = read('src/App.vue')
  // 原来模板里写的是 `const tab = findTab(path); if (tab) …`，搬到 ctx 里必须保持这一步。
  for (const name of ['closeTabIn', 'closeTabsToRightIn', 'copyPathOfTab', 'convertLineSeparators', 'togglePinTab', 'keepTabOpen'])
    assert.match(app, new RegExp(`${name}: \\([^)]*\\) => \\{ const tab = findTab\\(path\\); if \\(tab\\)`), `${name} 少了 if (tab) 守卫`)
})

// ── 键盘与 ARIA ───────────────────────────────────────────────────────────────────
// 上游这张菜单是个 `JPopupMenu`：`TabLabel.kt:463-491` 用 `JBPopupMenu.showByEvent` 显示它，
// `JBPopupMenu.java:203-205` 里就是 `menu.show(...)`。行为取自 Swing 的弹层菜单：
//   · 显示即成为"选中路径"的根 ⇒ 键盘归弹层（`JPopupMenu.java:798-806` 的 `setSelectedPath([this])`）；
//     关闭时焦点还给激活前的组件（`BasicPopupMenuUI.java:1006-1040` 的 `MenuKeyboardHelper.removeItems()`）；
//   · ↑↓ = `selectPrevious`/`selectNext`（`BasicLookAndFeel.java:1139-1152` 的键表）；还没有选中行时
//     选第一条/最后一条**可用**行（`BasicPopupMenuUI.java:567-580` 的 `selectItem`），行走表跳过不可用的行
//     （同文件 `:702-730` 的 `nextEnabledChild`/`previousEnabledChild`；IDEA 树上没有人设
//     `MenuItem.disabledAreNavigable`，所以禁用行不在行走表里）；
//   · Enter/Space = `return`，只对**已选中**的行生效（`:457-485` 的 `doReturn`；路径里只有弹层时什么都不做）；
//   · Esc = `cancel`，本仓归全局弹层栈（判据在 `tests/popup-layer-wiring.test.mjs`），组件里不许再挂一份。
// 本仓的落点是**真实 DOM 焦点**（右键落点是不可聚焦的标签 div，不把焦点搬进来键盘就够不着），
// 行走表与 `TabEntryPoint.vue:76-84` 同一套写法，环绕复用 `src/menuKeyboard.ts` 的 `nextMenuIndex`。

/** 模板里的元素节点（走 `compiler-dom` 的 AST：属性值里带 `>` 的写法正则认不准）。 */
function templateElements() {
  const { descriptor } = parseSfc(read('src/components/TabContextMenu.vue'), { filename: 'TabContextMenu.vue' })
  assert.ok(descriptor.template, 'TabContextMenu.vue 没有 template 段')
  const out = []
  const walk = node => {
    if (node.type === NodeTypes.ELEMENT) out.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(parseDom(descriptor.template.content))
  return out
}
const attrValue = (node, name) => (node.props ?? [])
  .find(p => p.type === NodeTypes.ATTRIBUTE && p.name === name)?.value?.content
const hasStatic = (node, name) => (node.props ?? []).some(p => p.type === NodeTypes.ATTRIBUTE && p.name === name)
const hasBound = (node, name) => (node.props ?? []).some(p => p.type === NodeTypes.DIRECTIVE && p.arg?.content === name)
const expOf = (node, name) => (node.props ?? [])
  .find(p => p.type === NodeTypes.DIRECTIVE && p.arg?.content === name)?.exp?.content
const linesOfNodes = nodes => nodes.map(node => node.loc.start.line)

test('菜单结构：容器是 menu、每行是 menuitem、分隔线是 separator', () => {
  const elements = templateElements()
  // 容器属性透传到 AnchoredMenu 的根 div —— 与 `RunConsole.vue:693` 同一写法（不另造一层外壳）。
  const root = elements.find(node => node.tag === 'AnchoredMenu')
  assert.ok(root, '找不到 AnchoredMenu 容器')
  assert.equal(attrValue(root, 'role'), 'menu')
  assert.ok(attrValue(root, 'aria-label'), 'role=menu 要有可访问名')
  assert.ok(hasStatic(root, 'tabindex'), '菜单根要能接住焦点（打开后焦点进菜单）')
  assert.ok(hasBound(root, 'keydown'), '↑↓ 的键处理器挂在菜单根上（焦点进来才有键盘）')
  // 行：模板里每个 button 都必须是 menuitem —— 少一个就是"一排按钮"混进 role=menu 里。
  const buttons = elements.filter(node => node.tag === 'button')
  assert.ok(buttons.length >= 25, `只找到 ${buttons.length} 个按钮，模板不像搬全了`)
  assert.deepEqual(linesOfNodes(buttons.filter(node => attrValue(node, 'role') !== 'menuitem')), [], '这些行没有 role="menuitem"')
  // 分隔线：role=menu 的合法子元素只有 menuitem/separator/group。
  const rules = elements.filter(node => (attrValue(node, 'class') ?? '').split(/\s+/).includes('menu-rule'))
  assert.ok(rules.length >= 4, `只找到 ${rules.length} 条分隔线`)
  assert.deepEqual(linesOfNodes(rules.filter(node => attrValue(node, 'role') !== 'separator')), [], '这些分隔线没有 role="separator"')
})

test('禁用行：`:disabled` 与 `:aria-disabled` 绑同一个真实谓词', () => {
  // role=menuitem 覆盖了原生按钮语义之后，光有 `disabled` 讲不清"不可用"（本仓 VcsLog/SelectInPopup 同一口径）。
  const disabled = templateElements().filter(node => node.tag === 'button' && hasBound(node, 'disabled'))
  assert.ok(disabled.length >= 5, `只找到 ${disabled.length} 个禁用行`)
  assert.deepEqual(linesOfNodes(disabled.filter(node => !hasBound(node, 'aria-disabled'))), [], '这些禁用行没有 aria-disabled')
  // 成对还不够：两边要绑**同一个真实谓词**（`ctx.canCloseOthers(pane, path)` 这类宿主函数）——
  // 不许出现"写死 false 的灰行"，也不许两边各算一套。
  const mismatched = disabled.filter(node => !expOf(node, 'disabled') || expOf(node, 'disabled') !== expOf(node, 'aria-disabled'))
  assert.deepEqual(linesOfNodes(mismatched), [], '这些行的 disabled / aria-disabled 不是同一个表达式')
})

test('「复制路径/引用…」子段：aria-haspopup=menu + 绑到真实展开态', () => {
  const component = read('src/components/TabContextMenu.vue')
  assert.match(component, /role="menuitem" class="has-sub" aria-haspopup="menu" :aria-expanded="copyOpen"/,
    '子段父行要同时有 aria-haspopup="menu" 与绑到 copyOpen 的 aria-expanded（上游 popup="true"）')
  assert.match(component, /@click="copyOpen = !copyOpen"/, 'aria-expanded 要真的能翻转')
})

test('键盘落点：焦点进菜单、↑↓走可用行、Enter 走原生、关闭还原焦点；Esc 仍归弹层栈', () => {
  const component = read('src/components/TabContextMenu.vue')
  // 环绕复用编辑器右键浮层那份纯逻辑（`src/menuKeyboard.ts`），不另写第二套行走表。
  assert.match(component, /import \{ nextMenuIndex \} from '\.\.\/menuKeyboard'/, '环绕要走 src/menuKeyboard.ts 的 nextMenuIndex')
  assert.match(component, /nextMenuIndex\(list\.length, list\.findIndex\(row => row === current\), step\)/,
    '行走表要现问「焦点在哪个行」（不能另存一份下标，那是第二份真相）')
  assert.ok(component.includes('[role="menuitem"]:not(:disabled)'), '行走表要把禁用行排除掉（上游 nextEnabledChild 同一条）')
  // 只认 ↑↓，且与 `EditorPopupMenu.vue:57-58` 同一种写法（其余按键放行：Enter 归原生、Esc 归弹层栈）。
  assert.match(component, /if \(event\.key === 'ArrowDown'\) \{ event\.preventDefault\(\); moveActive\(1\); return \}/, '↓ 要移到下一行')
  assert.match(component, /if \(event\.key === 'ArrowUp'\) \{ event\.preventDefault\(\); moveActive\(-1\); return \}/, '↑ 要移到上一行')
  // Enter/Space 是 `return`（BasicLookAndFeel.java:1149-1151），浏览器里由原生 <button> 翻成 click ——
  // 这里再写一遍就是同一条动作触发两次。
  assert.ok(!component.includes("'Enter'"), 'Enter 不该有自己的处理（原生 button 自己会触发 click）')
  // Esc 只有一个所有者：注册进全局弹层栈的那一层（本组件 `usePopupLayer(...)`）。组件里再挂一份
  // 就是"两条路关同一层"，与 `tests/popup-layer-wiring.test.mjs` 的"一条链一个所有者"冲突。
  assert.ok(!component.includes("'Escape'"), 'Esc 归弹层栈，组件里不许再来一份')
  assert.ok(!component.includes('window.addEventListener'), '组件自挂全局监听会和弹层栈抢同一次按键/点击')
  // 焦点管理：挂载时把焦点交给菜单根（右键落点不可聚焦，不搬焦点键盘够不着）、
  // 卸载时还给打开前的元素（上游 `MenuKeyboardHelper.removeItems()` 的 `lastFocused`）。
  assert.match(component, /returnFocus\.value = document\.activeElement instanceof HTMLElement \? document\.activeElement : null/,
    '要先记住打开前的焦点持有者（上游 lastFocused）')
  assert.match(component, /onMounted\(\(\) => \{[\s\S]{0,260}?void nextTick\(\(\) => box\.value\?\.focus\(\)\)/, '打开后焦点要进菜单根节点')
  assert.match(component, /onBeforeUnmount\(\(\) => \{[\s\S]{0,600}?returnFocus\.value\?\.isConnected\) returnFocus\.value\.focus\(\)/, '关闭时要还原焦点')
})
