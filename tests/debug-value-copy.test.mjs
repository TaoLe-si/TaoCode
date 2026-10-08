// 变量树的复制动作（`src/debugValueCopy.ts` + `DebugPanel.vue` 的接线）。
//
// 上游：`XCopyValueAction` / `XCopyNameAction`
// （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/actions/`）挂在树上，
// 本仓用行尾复制按钮 + 两条目小弹层承载同一组动作。这里钉格式规则与面板接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { DEBUG_COPY_TITLES, debugCopyNote, debugCopyText } = await import('../src/debugValueCopy.ts')

test('复制值：取 value，空值时退回名字（复制空串没有意义）', () => {
  assert.equal(debugCopyText({ name: 'count', value: '42' }, 'value'), '42')
  assert.equal(debugCopyText({ name: 'Locals', value: '' }, 'value'), 'Locals')
  assert.equal(debugCopyText({ name: '[0]', value: 'null' }, 'value'), 'null', 'null 是适配器给的真实值文本，不特殊对待')
})

test('复制名称：取树上显示的名字（数组元素是 [i]）', () => {
  assert.equal(debugCopyText({ name: 'count', value: '42' }, 'name'), 'count')
  assert.equal(debugCopyText({ name: '[3]', value: 'x' }, 'name'), '[3]')
  assert.equal(debugCopyText({ name: 'a.b', value: '1' }, 'name'), 'a.b', '表达式名原样保留，不改写')
})

test('类型不进「值」的文本（类型是行上的另一列，不发明上游没有的字符串）', () => {
  assert.equal(debugCopyText({ name: 'count', value: '42', type: 'int' }, 'value'), '42')
})

test('提示文案逐模式不同，失败时不谎报成功', () => {
  assert.equal(DEBUG_COPY_TITLES.value, '复制值')
  assert.equal(DEBUG_COPY_TITLES.name, '复制名称')
  assert.match(debugCopyNote({ name: 'count', value: '1' }, 'value', true), /已复制 count 的值/)
  assert.match(debugCopyNote({ name: 'count', value: '1' }, 'name', true), /已复制 count 的名称/)
  assert.match(debugCopyNote({ name: 'count', value: '1' }, 'value', false), /失败/)
})

// —— 面板接线 ——
// 本轮把复制弹层升级为「行动作弹层」（复制值/名称 + 添加到监视 + 在控制台中求值 +
// 按数组显示，见 DebugRowMenu.vue 与 DebugPanel 的 rowActions），并拆到独立组件 ——
// 门禁跟着搬家，查的东西不变：两处入口、两个条目、走剪贴板环。

const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
const rowMenu = readFileSync('src/components/DebugRowMenu.vue', 'utf8')
// 监视列表的行在 2026-10-06 抽到 `src/components/DebugWatchesPane.vue`（面板贴着 900 行上限，
// 本批补四个监视动作时拆出去）：监视行的动作按钮在那里，面板把它接到 openCopy。
const watchesPane = readFileSync('src/components/DebugWatchesPane.vue', 'utf8')

test('变量行与监视行都有行动作入口，弹层有「值/名称」两条目', () => {
  // 条目清单已抽到 `src/debugRowActions.ts`（DebugPanel 顶到 900 行上限）；面板留接线与分派。
  const actions = readFileSync('src/debugRowActions.ts', 'utf8')
  assert.match(panel, /openCopy\(rowMenuTarget\(row\), \$event\)/, '变量行动作按钮')
  assert.match(watchesPane, /emit\('copy', \{ text: watch\.text, value: watch\.value, event: \$event \}\)/, '监视行动作按钮')
  assert.match(panel, /@copy="\$event => openCopy\(\{ row: \{ name: \$event\.text, value: \$event\.value \}/, '面板把监视行的复制入口接到 openCopy')
  assert.match(rowMenu, /class="debug-menu" role="menu"/, '行动作弹层')
  assert.match(actions, /label: '复制值'/, '弹层的「复制值」条目')
  assert.match(actions, /label: '复制名称'/, '弹层的「复制名称」条目')
  assert.match(panel, /mode === 'copy-value' \|\| mode === 'copy-name'/)
  assert.match(panel, /debugCopyText\(target\.row, copyMode\)/)
})

test('复制走剪贴板环（CopyPasteManager 的等价物），不是裸 navigator 调用', () => {
  assert.match(panel, /import \{ copyToClipboard \} from '\.\.\/clipboard'/)
  assert.ok(!panel.includes('navigator.clipboard'), '面板里不该绕过 src/clipboard.ts 直接写系统剪贴板')
})
