// 「同一个控件在各面板写法一致」这条纪律里最要紧的一件：**带状态的按钮必须把状态暴露给辅助技术**。
//
// 由来（2026-10-06 UI 对标线）：全仓按「按钮的 class / :class 里出现 active / selected / on / toggled /
// pinned / running 这类**布尔状态记号**」扫了一遍，发现 20 余处只有视觉类名、没有 `aria-pressed` /
// `aria-checked` / `aria-selected` / `aria-current` / `aria-expanded`。读屏用户因此听不出「开还是关、
// 是不是当前这一项」——鼠标看得见、键盘/读屏看不见。
//
// 上游口径：IDEA 的这类控件都是 `JToggleButton` / `JBTabbedPane` / `JBList` 的子类，状态在
// `ButtonModel.isSelected()` / `SelectionModel` 里，会被 `AccessibleContext` 报出去
// （`AbstractButton.AccessibleAbstractButton.getAccessibleStateSet` 把 `isSelected()` 翻成
// `AccessibleState.SELECTED` / `.CHECKED`）—— 本仓的等价物就是 aria 状态属性。
//
// 判据（结构式，逐按钮）：
//   一个 `<button>` 的 class / `:class` 里出现状态记号时，必须满足以下之一：
//     · 自己带 `aria-pressed` / `aria-checked` / `aria-selected` / `aria-current` / `aria-expanded`；
//     · 自己的 `role` 属于 aria-widget 家族（tab / option / radio / checkbox / switch /
//       menuitemcheckbox / menuitemradio）—— 状态由该角色的 `aria-*` 定义；
//     · 某个祖先已经带上了上述状态属性或状态角色（例如 `li role="option" aria-selected` 里的
//       点击按钮，状态在父级表达）。
//   例外表只列**禁改文件**（大组件 lane 独占，本线不能动），每条写清原因。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseDom, NodeTypes } from '@vue/compiler-dom'

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** 布尔状态记号：出现在 class / `:class` 里就表示这个按钮有开/关、选中/未选中的状态。 */
const STATE_MARKERS = new Set([
  'active', 'selected', 'on', 'toggled', 'pinned', 'inline-on', 'running', 'checked',
  'open', 'expanded', 'current', 'is-open',
])
/** 能把状态讲给辅助技术的 aria 属性。 */
const STATE_ATTRS = ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current', 'aria-expanded']
/** 状态由角色定义（角色自带的 aria-* 才是状态的正式表达）。 */
const STATE_ROLES = new Set(['tab', 'option', 'radio', 'checkbox', 'switch', 'menuitemcheckbox', 'menuitemradio'])

/** 禁改文件：大组件 lane 独占，本线不能改 —— 记账而不是放行。 */
const EXEMPT_FILES = new Map([
  ['src/components/DebugPanel.vue', '大组件 lane 独占（禁改）：调试帧行 `active` 的选中态由该文件的角色体系表达，本线不能动。'],
  ['src/components/DiffView.vue', '大组件 lane 独占（禁改）：并排/统一视图切换与折叠开关的 `selected` 状态由该文件表达，本线不能动。'],
])

function vueFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) vueFiles(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}
const rel = file => file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')

function walk(node, visit, parents = []) {
  visit(node, parents)
  for (const child of node.children ?? []) walk(child, visit, [...parents, node])
}
function attrOf(node, name) {
  for (const p of node.props ?? []) {
    if (p.type === NodeTypes.ATTRIBUTE && p.name === name) return p.value?.content
    if (p.type === NodeTypes.DIRECTIVE && p.arg?.content === name) return undefined
  }
  return undefined
}
function hasProp(node, name) {
  return (node.props ?? []).some(p =>
    (p.type === NodeTypes.ATTRIBUTE && p.name === name) ||
    (p.type === NodeTypes.DIRECTIVE && p.arg?.content === name))
}
/** class / `:class` 里出现的词（静态类名、对象键、字符串字面量三条来源都收）。 */
function classTokens(node) {
  const toks = new Set()
  for (const p of node.props ?? []) {
    if (p.type === NodeTypes.ATTRIBUTE && p.name === 'class') {
      for (const t of (p.value?.content ?? '').split(/\s+/)) if (t) toks.add(t)
    }
    if (p.type === NodeTypes.DIRECTIVE && p.arg?.content === 'class') {
      const s = JSON.stringify(p.exp?.content ?? '')
      for (const m of s.matchAll(/([A-Za-z][\w-]*)\s*:/g)) toks.add(m[1])
      for (const m of s.matchAll(/'([\w-]+)'/g)) toks.add(m[1])
    }
  }
  return toks
}
function stateWritten(node) {
  if (STATE_ATTRS.some(a => hasProp(node, a))) return true
  const role = attrOf(node, 'role')
  return Boolean(role && STATE_ROLES.has(role))
}

test('带状态的按钮必须把状态暴露给辅助技术（aria-pressed / aria-checked / aria-selected / aria-current / aria-expanded）', () => {
  const bad = []
  let checked = 0
  for (const file of vueFiles()) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    if (!descriptor.template) continue
    const offset = descriptor.template.loc.start.line - 1
    let ast
    try { ast = parseDom(descriptor.template.content) } catch { continue }
    walk(ast, (node, parents) => {
      if (node.type !== NodeTypes.ELEMENT || node.tag !== 'button') return
      const hits = [...classTokens(node)].filter(t => STATE_MARKERS.has(t))
      if (!hits.length) return
      checked += 1
      if (stateWritten(node)) return
      if (parents.some(p => p.type === NodeTypes.ELEMENT && stateWritten(p))) return
      bad.push(`${rel(file)}:${node.loc.start.line + offset}  [${hits.join(',')}]`)
    })
  }
  // 例外表按禁改文件过滤（不是"整条关掉"：同文件里别的按钮仍要合规）。
  const remaining = bad.filter(line => {
    const file = line.split(':')[0]
    return !EXEMPT_FILES.has(file)
  })
  assert.ok(checked >= 30, `只匹配到 ${checked} 个带状态记号的按钮 —— 门禁本身失效了`)
  assert.deepEqual(remaining, [], `这些按钮的状态只有视觉类名、辅助技术读不出来：\n${remaining.join('\n')}`)
})

test('例外表只列禁改文件（别拿它掩盖自己能改的地方）', () => {
  const forbidden = new Set([
    'src/components/CodeEditor.vue',
    'src/components/DebugPanel.vue',
    'src/components/SourceControl.vue',
    'src/components/DiffView.vue',
  ])
  for (const file of EXEMPT_FILES.keys()) {
    assert.ok(forbidden.has(file), `${file} 不在禁改清单里 —— 这份例外表不许扩到能改的文件上`)
  }
})

test('App.vue 底部内容标签条是 tablist + role=tab + aria-selected（不是只有 selected 类名）', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(app, /class="output-tabs" role="tablist" aria-label="底部工具窗口内容"/, '底部内容标签条要有 role="tablist"')
  // 每一个内容标签都要有 role="tab" 与 :aria-selected。
  for (const expr of ["bottomTab === 'output'", "bottomTab === 'run'", "bottomTab === 'problems'", "bottomTab === 'hierarchy'", "bottomTab === 'terminal'"]) {
    const re = new RegExp(`role="tab" :aria-selected="${expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" :class="\\{ selected: ${expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\}"`)
    assert.match(app, re, `底部标签 ${expr} 缺 role="tab" / aria-selected`)
  }
  // 底部锚定的工具窗口标签（v-for）同样带状态。
  assert.match(app, /v-for="id in bottomAnchoredIds"[^>]*role="tab" :aria-selected="bottomTab === id"/, '底部锚定的工具窗口标签缺 role="tab" / aria-selected')
})

test('Hierarchy 方向是 radiogroup + role=radio + aria-checked（单选项不能写成 toggle）', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(app, /class="call-direction" role="radiogroup"/, '方向组要是 radiogroup')
  assert.match(app, /v-for="\[direction, label\] in hierOptions"[^>]*role="radio" :aria-checked="hierDirection === direction"/, '每个方向要是 role=radio + aria-checked')
})

test('各面板的状态钮逐处接线（不是把类名删掉了事）', () => {
  const cases = [
    ['src/App.vue', [/:aria-pressed="activity"/, /:aria-pressed="bottom"/, /:aria-pressed="markdownPreviewOn"/]],
    ['src/components/ToolStripe.vue', [/:aria-pressed="isActive\(id\)"/]],
    ['src/components/DebugBreakpointsPane.vue', [/:aria-pressed="muted"/]],
    ['src/components/DebugWatchesPane.vue', [/:aria-pressed="watch\.paused"/, /:aria-pressed="inlineShown\(watch\.text\)"/]],
    ['src/components/OutlinePanel.vue', [/:aria-pressed="sortByName"/, /:aria-pressed="flatView"/]],
    ['src/components/TerminalPanel.vue', [/:aria-pressed="searchOpen"/]],
    ['src/components/MainToolbar.vue', [/:aria-pressed="c\.runState\.running"/]],
    ['src/components/FileChooserDialog.vue', [/:aria-current="crumb\.path === currentPath/]],
    ['src/components/GradlePanel.vue', [/:aria-current="selectedDirectory === build\.directory/]],
    ['src/components/ProjectGitDialogs.vue', [/:aria-current="ctx\.fileHistorySelected === commit\.hash/]],
    // 这一批补的三颗：状态只写在**读屏名/视觉**里、class 上没有任何记号，所以上面那条
    // 「按 class 记号扫」的门禁抓不到 —— 这里按各自的表达式逐个钉住。
    //   · RunConsole 的暂停钮是纯粹的开关（上游 PauseOutputAction 是 ToggleAction）⇒ aria-pressed；
    //   · 断点对话框的「新建…」与历史面板的「放置标签」是**显隐一段输入区**的披露钮 ⇒ aria-expanded
    //     （披露不是开关：按下它不代表某个东西"被开了"，而是"露出了下面那段"，所以两者不混用）。
    // RunConsole 的暂停钮绑的是 `consolePaused`（`runOutputPausedState()` = EP consolePauseStateProvider
    // 的贡献 + 本仓 `runOutputPaused`，无插件时同值）—— 钉意图（那颗钮确实带 aria-pressed），不锁死中间层。
    ['src/components/RunConsole.vue', [/:aria-pressed="consolePaused"/]],
    ['src/components/DebugBreakpointEditDialog.vue', [/:aria-expanded="creatingGroup"/, /aria-controls="bp-new-group"/]],
    ['src/components/HistoryPanel.vue', [/:aria-expanded="labelPrompt"/, /aria-controls="hist-label-add"/]],
  ]
  for (const [file, patterns] of cases) {
    const src = readFileSync(file, 'utf8')
    for (const p of patterns) assert.match(src, p, `${file} 缺 ${p}`)
  }
})

test('运行/停止那一颗的读屏名跟着状态走（原来恒念「运行」）', () => {
  const src = readFileSync('src/components/MainToolbar.vue', 'utf8')
  assert.match(src, /:aria-label="c\.runState\.running \? '停止' : '运行'"/, '运行中的读屏名要变成「停止」')
})
