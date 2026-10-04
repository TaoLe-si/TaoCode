// 标签右键菜单（`src/components/TabContextMenu.vue`）：第一百零九批从 App.vue 的模板里整块搬出来，
// 并补上上游 `EditorTabPopupMenu` 上的 `CopyReferencePopupGroup`（`PlatformActions.xml:1280`）。
//
// 为什么要一条门禁：组件的依赖走 `ctx`（`any`），**TS 看不见 ctx 里的笔误** ——
// 少一个键就是"点了没反应"，而且只在真机上暴露。所以这里逐键核对：
// 组件模板里出现的每个 `ctx.X` 都必须在 App.vue 的 `tabMenuContext` 里真的有。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
