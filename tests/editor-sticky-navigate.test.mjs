// 粘性行的**点击跳转**目标（`lp/sticky-lines` 那一族的最后一块：`StickyLine.navigateOffset()`）。
// 实现 `src/stickyLines.ts` 的 `navigateLine` 字段 + `stickyRevealTarget`。
//
// 上游坐标（2026-10-06 逐行核对）：
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLine.kt:36-41`
//     —— 「鼠标点击时把光标放到的 offset」，通常就是元素自己的 textOffset；
//   · `.../stickyLines/ui/StickyLineComponent.kt:44-50` —— 挂了鼠标监听（`:211` 的调试串里叫 `offsetOnClick`）；
//   · LSP 那一侧的取数：`platform/lsp-impl/src/impl/features/documentSymbol/LspFileBreadcrumbsCollector.kt:57-59`
//     —— 先 `selectionRange.start`，取不到才退回 `range.start`；本仓 `LspDocumentSymbol`
//     （`src/bridge.ts:143`）只有 `range` ⇒ 用 `startLine`（上游的退路档），如实记着这一条差别。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStickyLines, stickyRevealTarget, stickyScopes } from '../src/stickyLines.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const symbol = (name, kind, startLine, endLine) => ({ name, kind, detail: '', startLine, startChar: 0, endLine, endChar: 0 })
// Config(4) 1-30 / load(6) 3-12 / Inner(5) 6-10
const OUTLINE = [symbol('Config', 5, 0, 30), symbol('load', 6, 2, 12), symbol('Inner', 5, 5, 10)]

test('每条粘性行都带 navigateLine：就是那一层作用域自己的起始行（0 基）', () => {
  const lines = stickyScopes(OUTLINE, 8, 'java')
  assert.deepEqual(lines.map(entry => entry.name), ['Config', 'load', 'Inner'])
  assert.deepEqual(lines.map(entry => entry.navigateLine), [0, 2, 5],
    'LspFileBreadcrumbsCollector.kt:57-59 的退路档（range.start 那一行的档）')
  for (const entry of lines) assert.equal(entry.navigateLine, entry.startLine)
})

test('stickyRevealTarget 给的是 revealLocation 要的 0 基行号（与 bookmarkActions.ts:241 同一约定）', () => {
  const [outer] = stickyScopes(OUTLINE, 8, 'java')
  assert.deepEqual(stickyRevealTarget(outer, '/src/Config.java'), { path: '/src/Config.java', line: 0 })
  const inner = stickyScopes(OUTLINE, 8, 'java')[2]
  assert.deepEqual(stickyRevealTarget(inner, '/src/Config.java'), { path: '/src/Config.java', line: 5 })
})

test('createStickyLines 出口的那一份也带着 navigateLine（接线时不必再自己算）', () => {
  const settings = { value: { showStickyLines: true, stickyLinesLimit: 2 } }
  const outline = { value: OUTLINE }
  const { stickyLines } = createStickyLines({ editorSettings: settings, outline, currentLine: () => 8, language: () => 'java' })
  assert.deepEqual(stickyLines.value.map(entry => entry.name), ['load', 'Inner'], '上限截断仍按最内层留')
  assert.deepEqual(stickyLines.value.map(entry => entry.navigateLine), [2, 5])
})

test('落点留痕：模块头引了 StickyLine.kt 与 LSP 取数那两条（不然下次又被当成"IDEA 一般是…"）', () => {
  const source = readFileSync(join(root, 'src/stickyLines.ts'), 'utf8')
  assert.match(source, /StickyLine\.kt:36-41/, '没引 navigateOffset 的出处')
  assert.match(source, /LspFileBreadcrumbsCollector\.kt:57-59/, '没引 LSP 侧 selectionRange→range 的退路')
  assert.match(source, /export function stickyRevealTarget/, '跳转目标没有出口')
})

// ── 接线（主代理 2026-10-06）：粘性行在宿主里真的可点，且不再对读屏隐藏 ──
// 上游：`StickyLine.kt:36-41`（navigateOffset）+ `ui/StickyLineComponent.kt:44-50`（鼠标监听）。
test('App.vue 把粘性行接成了可点的跳转（有行无动作 = 假控件）', () => {
  const app = readFileSync(join(root, 'src/App.vue'), 'utf8')
  assert.match(app, /import \{ createStickyLines, stickyRevealTarget \} from '\.\/stickyLines'/,
    '没引跳转目标出口')
  assert.match(app, /@click="revealLocation\(stickyRevealTarget\(symbol, groupActive\(pane\)!\.path\)\)"/,
    '粘性行没有点击入口 ⇒ 上游那三条点击语义落不了地')
  assert.match(app, /class="sticky-lines"(?! aria-hidden)/, '可交互的东西不能对读屏隐藏')
})
