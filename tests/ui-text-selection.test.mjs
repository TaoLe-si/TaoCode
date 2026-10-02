// 文字可选性（src/style.css 顶上的 user-select 那一档）。
//
// 2026-10-03 用户原话：「所有文字部分都像浏览器一样能被框选出来，禁止这种操作」——
// 截图里按住鼠标扫过顶栏与文件树会拉出一片蓝色选区，点一下还容易把它当"选不中文字"误操作。
//
// 方向照上游：IDEA 是 Swing，控件上的字（菜单项、树行、标签页、标题栏、状态栏）**不可选中**，
// `BasicTextUI.update()` 只给真正可编辑/可复制的文本组件装 Highlighter。
// 我们的对应物就是：整体关掉，再把**可复制的文本面**逐个开回来。
// 白名单的依据是上游"哪里有「复制」动作"：
//   · 编辑器    `EditorActionUtil` 的 copy
//   · 控制台/终端 `ConsoleView` / `ConsoleHistory` / TerminalWidget 的 copy
//   · diff      `DiffContents` 的 copy
// 不在白名单里的**终端**要特别说明：xterm.js 用自己的隐藏 textarea（`_helper_textarea`，
// 它走下面那条 `textarea` 档）驱动选区，浏览器原生选区会和它打架 —— 同一个字被选两遍，
// 复制出来是双份。所以终端**不**开 `user-select: text`，只保留它自己的复制动作。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const style = readFileSync(join(root, 'src/style.css'), 'utf8')

/**
 * 查某个选择器的 user-select 值。CSS 里选择器是**成组**写的（`html, body, #app { … }`），
 * 所以先把样式切成 (选择器列表, 声明块)，再按逗号拆成单个选择器；同名后者覆盖前者（层叠）。
 */
const rules = []
// 注释里也会出现 `{`、`}` 和选择器名字，先剥掉再切规则，否则选择器名会带上注释尾巴。
const declarationsOnly = style.replace(/\/\*[\s\S]*?\*\//g, '')
for (const match of declarationsOnly.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const value = /user-select:\s*([a-z]+)/.exec(match[2])?.[1]
  if (!value) continue
  for (const selector of match[1].split(',')) rules.push([selector.trim(), value])
}
const userSelect = selector => {
  let found
  for (const [name, value] of rules) if (name === selector) found = value
  return found
}

test('默认关掉：整页不可框选', () => {
  for (const selector of ['html', 'body', '#app']) {
    assert.equal(userSelect(selector), 'none', `${selector} 没有关掉 user-select`)
  }
})

test('白名单：可复制的文本面必须重新开回来', () => {
  for (const selector of ['.cm-editor', '.cm-content', '.output-lines', '.run-log', '.diff-body']) {
    assert.equal(userSelect(selector), 'text', `${selector} 是可复制的文本面，却没开 user-select: text`)
  }
  for (const selector of ['input', 'textarea']) {
    assert.equal(userSelect(selector), 'text', `${selector} 要能选中复制`)
  }
})

test('WebView2 两个属性都要写 —— 只写 user-select 不生效', () => {
  assert.match(style, /-webkit-user-select: none; user-select: none;/,
    '关的那一档没有同时写 -webkit-user-select；WebView2 只认带前缀的那个时会整条失效')
  assert.match(style, /-webkit-user-select: text; user-select: text;/,
    '开的那一档没有同时写 -webkit-user-select')
})

test('终端不在白名单里 —— xterm 自己驱动选区，浏览器原生选区会和它打架', () => {
  assert.equal(userSelect('.terminal-host-wrap'), undefined, '终端宿主不能进白名单')
  assert.equal(userSelect('.xterm'), undefined, '.xterm 不能进白名单')
  assert.ok(!/\.xterm[^{]*\{[^}]*user-select: text/.test(style), '.xterm 上开了原生可选，xterm 的选区会与之重复')
})

test('不能靠删掉规则来"关"：已有的这两条本来就是 none，删了就跟着全局走', () => {
  assert.match(style, /\.diff-no \{[^}]*user-select: none/, '.diff-no 的 none 是有意义的覆盖，删了它会跟着全局一起关掉')
  assert.match(style, /\.quick-definition-number \{[^}]*user-select: none/, '.quick-definition-number 同上')
})
