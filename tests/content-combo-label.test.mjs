// COMBO 内容形态的下拉标签（IDEA `ContentComboLabel.java` + `toggleContentPopup`）的判据。
//
// 与 `tests/tool-window-content-ui.test.mjs` 分工：那边钉"形态是每内容一份、combo 与标签条同标签"，
// 这边钉**下拉本体**：按钮上是图标 + 名称 + 箭头，点开列全部内容且标出当前项，键盘能选。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const { component: ContentComboLabel } = loadSfc('src/components/ContentComboLabel.vue')

const OPTIONS = [
  { id: 'output', label: '操作输出' },
  { id: 'references:7', label: '对“Foo”的引用' },
]
const render = props => renderToString(createSSRApp({ render: () => h(ContentComboLabel, props) }))

test('按钮上是内容名 + 箭头，且是可展开的组合框', async () => {
  const html = await render({ options: OPTIONS, value: 'output', type: 'combo' })
  assert.match(html, /class="output-content-select content-combo-toggle"/, '没有沿用 combo 的样式基类')
  assert.match(html, /操作输出/, '按钮上没有当前内容的名称')
  assert.match(html, /aria-haspopup="listbox"/, '没有弹出列表的语义')
  assert.match(html, /aria-expanded="false"/, '初始应为收起')
  assert.match(html, /显示视图列表/, '无障碍动作名没取「视图」那一档（ContentComboLabel:192）')
})

test('type=tabbed 时无障碍文案用「标签页」（ShowContentAction.update 的两档）', async () => {
  const html = await render({ options: OPTIONS, value: 'output', type: 'tabbed' })
  assert.match(html, /显示标签页列表/)
})

test('选项是每一条 content，当前项带 aria-selected（`toggleContentPopup` 的默认项）', () => {
  const source = read('src/components/ContentComboLabel.vue')
  assert.ok(source.includes('v-for="(option, index) in options"'), '不逐条列内容')
  assert.ok(source.includes(':aria-selected="option.id === value"'), '没有标出当前内容')
  assert.ok(source.includes('@click="pick(option.id)"'), '点选项不回传选择')
  // 引用那种复合 id 也要能显示：选中项按完整 id 匹配（不是前缀）。
  assert.ok(source.includes('option.id === props.value'), 'selected 的匹配口径与选项不一致')
})

test('键盘：上下移动、Enter 选中、Esc 收起（WizardPopup/keyPressed 的同一套）', () => {
  const source = read('src/components/ContentComboLabel.vue')
  assert.ok(source.includes("event.key === 'ArrowDown'"), '缺向下')
  assert.ok(source.includes("event.key === 'ArrowUp'"), '缺向上')
  assert.ok(source.includes("event.key === 'Enter'"), '缺 Enter')
  assert.ok(source.includes("event.key === 'Escape'"), '缺 Esc')
  assert.ok(source.includes('@keydown.esc.stop="open = false"'), 'Esc 没有就地收起')
})

test('图标：工具窗口走注册表、引用与固定内容各有字形（不是空图标列）', () => {
  const source = read('src/components/ContentComboLabel.vue')
  assert.ok(source.includes('toolIcons'), '没有接工具窗口注册表的图标')
  assert.ok(source.includes('references:'), '引用内容没有图标分支')
  for (const id of ['output', 'run', 'problems', 'hierarchy', 'terminal']) {
    assert.ok(source.includes(`${id}:`), `固定内容 ${id} 没有图标`)
  }
})

test('接在 App.vue 的 else 分支上：options/value/type 都来自同一份模型', () => {
  const app = read('src/App.vue')
  assert.match(app, /<ContentComboLabel v-else class="output-content-select" :options="bottomTabOptions" :value="bottomSelectValue" :type="contentUiType\(\)" @pick="pickBottomOption" \/>/,
    'combo 的接线变了：必须还是 else 分支、同一份 bottomTabOptions / bottomSelectValue / contentUiType')
})
