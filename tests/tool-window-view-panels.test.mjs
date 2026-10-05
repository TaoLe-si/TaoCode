// 工具窗口宿主不能留着「import 了但不渲染」的面板 —— 接线请求
// docs/wiring-requests-2026-10-06-bucket11c.md 的 W-B11c-2（本仓的形状判定，不是上游行为，
// 所以这条不给上游坐标；判据就是 `node .tools/find-orphan-modules.mjs --dead-imports` 的输出）。
//
// 为什么值得钉住：`ToolWindowView.vue` 是「同一批组件按停靠边复用」的宿主，读代码的人只会看
// 它 import 了哪些面板来判断「这个视图在工具窗口里有没有一份」。留着一条没渲染的 import，
// 就等于对外宣称有一份 —— 而真正渲染 `<TestRunnerPanel>` 的只有 `src/App.vue` 那一处。
// 实测（2026-10-06）：陈旧 import 两条，`./HistoryPanel.vue`（渲染点在 src/App.vue:2390）与
// `./TestRunnerPanel.vue`（渲染点在 src/App.vue:2283；请求原文写 :2254，行号已漂，按现树订正）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** 某个 .vue 文件里 import 的本地组件（`import X from './X.vue'`）与它在模板里出现的渲染点。 */
function localComponentImports(source) {
  return [...source.matchAll(/import\s+(\w+)\s+from\s+'\.\/[^']+\.(?:vue|ts)'/g)].map(match => match[1])
}

function templateOf(source) {
  const start = source.indexOf('<template>')
  return start < 0 ? '' : source.slice(start)
}

test('ToolWindowView 的每条本地组件 import 都在本文件里真的渲染', () => {
  const source = read('src/components/ToolWindowView.vue')
  const template = templateOf(source)
  const unrendered = localComponentImports(source).filter(name => !new RegExp(`<${name}[\\s/>]`).test(template))
  assert.deepEqual(unrendered, [], `这些面板被 import 却没有渲染点（假接线形状）：${unrendered.join(', ')}`)
})

test('TestRunnerPanel 的渲染归属只有一处（App.vue），工具窗口宿主不重复声明', () => {
  const hosts = ['src/App.vue', 'src/components/ToolWindowView.vue']
    .filter(path => new RegExp('<TestRunnerPanel[\\s/>]').test(read(path)))
  assert.deepEqual(hosts, ['src/App.vue'], '渲染点要么只有 App.vue 一处，要么这条面板就该由宿主统一渲染 —— 两处都画就是两份真源')
  assert.doesNotMatch(read('src/components/ToolWindowView.vue'), /import TestRunnerPanel/,
    'W-B11c-2：宿主没渲染就不该 import 它')
})
