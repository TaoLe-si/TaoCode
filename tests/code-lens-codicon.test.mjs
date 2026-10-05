// `ls/code-lens` 的标题解析：VS Code 的 codicon 记号（`$(play) Run tests`）要变成图标，
// 而不是原样显示在编辑器里。
//
// 上游依据：`platform/lsp-impl/src/impl/features/codeLens/CodeLensTitle.kt`
//   · `parseCodeLensTitle`（`:25-34`）、已知记号表（`:13-18`）、消费方 `LspCodeVisionProvider.kt:54-55`。
// 纯规则在 `src/codeLens.ts`；渲染（图标 SVG + 删除记号后的文字）在 `src/codeLensExtension.ts`。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { CODE_LENS_CODICON_ICONS, parseCodeLensTitle } from '../src/codeLens.ts'

test('已知记号：play/run → execute，debug/debug-alt → debug（CodeLensTitle.kt:13-18）', () => {
  assert.deepEqual(CODE_LENS_CODICON_ICONS, {
    play: 'execute', run: 'execute', debug: 'debug', 'debug-alt': 'debug',
  })
  assert.deepEqual(parseCodeLensTitle('$(play) Run test'), { text: 'Run test', icon: 'execute' })
  assert.deepEqual(parseCodeLensTitle('$(run) Run'), { text: 'Run', icon: 'execute' })
  assert.deepEqual(parseCodeLensTitle('$(debug) Start'), { text: 'Start', icon: 'debug' })
  assert.deepEqual(parseCodeLensTitle('$(debug-alt) Start'), { text: 'Start', icon: 'debug' })
})

test('没有 `$(` 的标题原样返回（CodeLensTitle.kt:26）', () => {
  assert.deepEqual(parseCodeLensTitle('3 usages'), { text: '3 usages', icon: null })
  assert.deepEqual(parseCodeLensTitle(''), { text: '', icon: null })
  assert.deepEqual(parseCodeLensTitle(undefined), { text: '', icon: null })
})

test('每一个记号都从文字里删掉（CodeLensTitle.kt:23 的注释 + :28-31 的 replace）', () => {
  assert.deepEqual(parseCodeLensTitle('$(play) a $(debug) b'), { text: 'a b', icon: 'execute' })
  // 记号后面那个可选空格也一起吃掉（正则里的 ` ?`），所以不会留下双空格。
  assert.deepEqual(parseCodeLensTitle('$(play)Run'), { text: 'Run', icon: 'execute' })
})

test('取第一个**已知**记号；未知记号不占位，后面那个已知的仍能顶上（:29 的 icon == null 判断）', () => {
  assert.deepEqual(parseCodeLensTitle('$(sparkles) $(play) Run'), { text: 'Run', icon: 'execute' })
  assert.deepEqual(parseCodeLensTitle('$(play) $(debug) Run'), { text: 'Run', icon: 'execute' },
    '第二个记号只在第一个未被识别时才生效')
})

test('删空且没有图标 → 回退成原标题（CodeLensTitle.kt:32）；只有未知记号时同理', () => {
  // 标题只剩一个已知记号：文字被删空但图标认得，上游仍返回空文字 + 图标。
  assert.deepEqual(parseCodeLensTitle('$(play)'), { text: '', icon: 'execute' })
  assert.deepEqual(parseCodeLensTitle('$(unknown)'), { text: '$(unknown)', icon: null })
  // 文字被删空但**认得**图标时仍返回空文字 + 图标（上游 `:32` 只在 icon 也为 null 时回退）。
  assert.deepEqual(parseCodeLensTitle('$(play)   '), { text: '', icon: 'execute' })
})

test('纯函数：同一个正则重复调用不会串位（带 g 标志的 lastIndex 陷阱）', () => {
  const title = '$(play) Run'
  for (let i = 0; i < 5; ++i) assert.deepEqual(parseCodeLensTitle(title), { text: 'Run', icon: 'execute' })
})

test('接线：CodeMirror 落点画的是解析后的文字，并把图标 SVG 放在按钮里', () => {
  const extension = readFileSync('src/codeLensExtension.ts', 'utf8')
  assert.ok(extension.includes('const title = parseCodeLensTitle(this.lens.item.title)'),
    '按钮文字没有走 parseCodeLensTitle')
  assert.ok(extension.includes("icon.className = 'cm-code-lens-icon'"), '图标节点没有落点')
  assert.ok(extension.includes("button.appendChild(document.createTextNode(title.text))"),
    '文字节点不是解析后的标题')
  assert.ok(!/button\.textContent = this\.lens\.item\.title/.test(extension), '还在用原始标题（会把 $(play) 显示给用户）')
})

test('图标路径取自上游图标资源，不是随手画的近似形', () => {
  const extension = readFileSync('src/codeLensExtension.ts', 'utf8')
  const execute = readFileSync(
    'D:/Backup/Downloads/intellij-community-master/intellij-community-master/platform/icons/src/actions/execute_stroke.svg', 'utf8')
  const path = /M13\.5 7\.13397[^"]*/.exec(execute)?.[0]
  assert.ok(path, '上游 execute_stroke.svg 里找不到那条路径')
  assert.ok(extension.includes(path), 'execute 图形的路径与上游 SVG 不一致')
})
