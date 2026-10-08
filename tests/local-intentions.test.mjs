// 本地抑制条目（`src/localIntentions.ts`）：把抑制规则做成 Alt+Enter 列表里可应用的编辑，
// 并接进 `src/semanticActions.ts` 的 `openCodeActions`（LSP 条目 + 本地条目合流）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ruleIdFromMessage, suppressionActionsFor, suppressionEditFor, suppressionLanguageFor,
} from '../src/localIntentions.ts'

const root = new URL('..', import.meta.url)

test('语言档：python/go 不再落进 other，java/ts/cpp 与 templates 同口径', () => {
  assert.equal(suppressionLanguageFor('a/b/c.py'), 'python')
  assert.equal(suppressionLanguageFor('x.go'), 'go')
  assert.equal(suppressionLanguageFor('A.java'), 'java')
  assert.equal(suppressionLanguageFor('x.mts'), 'typescript')
  assert.equal(suppressionLanguageFor('x.hpp'), 'cpp')
  assert.equal(suppressionLanguageFor('README.md'), '')
})

test('规则 id 从消息里抠：方括号优先，末尾圆括号兜底', () => {
  assert.equal(ruleIdFromMessage(`'x' is assigned a value but never used. [no-unused-vars]`), 'no-unused-vars')
  assert.equal(ruleIdFromMessage('Unexpected console statement (no-console)'), 'no-console')
  assert.equal(ruleIdFromMessage('unused variable x'), '')
})

test('抑制编辑：上一行带缩进 + 换行；行尾两个空格且 CRLF 不越行', () => {
  const lines = ['class A {', '    int x;', '}\r']
  const above = suppressionEditFor(lines, 1, { id: 'n', title: '', insertText: '//noinspection unused', placement: 'line-above' })
  assert.deepEqual(above, { text: '    //noinspection unused\n', startLine: 1, startChar: 0, endLine: 1, endChar: 0 })
  const end = suppressionEditFor(lines, 2, { id: 'e', title: '', insertText: '# noqa', placement: 'line-end' })
  assert.deepEqual(end, { text: '  # noqa', startLine: 2, startChar: 1, endLine: 2, endChar: 1 })
  assert.equal(suppressionEditFor(lines, 9, { id: 'n', title: '', insertText: 'x', placement: 'line-above' }), null)
})

test('条目生成：可应用编辑落在正确位置，已抑制的行不再出条目', () => {
  const text = 'const a = 1\nconsole.log(a)\n'
  const actions = suppressionActionsFor({
    path: '/w/x.ts', text,
    diagnostics: [{ line: 1, character: 0, severity: 2, message: "Unexpected console statement. [no-console]", source: 'eslint' }],
  })
  assert.equal(actions.length, 2)              // eslint-disable-next-line + @ts-ignore
  assert.equal(actions[0].kind, 'quickfix.suppress')
  assert.equal(actions[0].preferred, true)
  assert.deepEqual(actions[0].edits[0].textEdits[0], {
    text: '// eslint-disable-next-line no-console\n', startLine: 1, startChar: 0, endLine: 1, endChar: 0,
  })
  const suppressed = suppressionActionsFor({
    path: '/w/x.ts', text: 'const a = 1\n// eslint-disable-next-line no-console\nconsole.log(a)\n',
    diagnostics: [{ line: 2, character: 0, severity: 2, message: "Unexpected console statement. [no-console]", source: 'eslint' }],
  })
  assert.equal(suppressed.length, 1)           // 只剩 @ts-ignore
  assert.equal(suppressed[0].edits[0].textEdits[0].text, '// @ts-ignore\n')
})

test('同一行多源诊断去重；越界行直接跳过', () => {
  const actions = suppressionActionsFor({
    path: '/w/x.js',
    text: 'a()\n',
    diagnostics: [
      { line: 0, character: 0, severity: 2, message: 'x (no-undef)', source: 'eslint' },
      { line: 0, character: 0, severity: 2, message: 'y (no-undef)', source: 'eslint' },
      { line: 7, character: 0, severity: 2, message: 'gone', source: 'eslint' },
    ],
  })
  assert.deepEqual(actions.map(action => action.edits[0].textEdits[0].text), ['// eslint-disable-next-line no-undef\n', '// @ts-ignore\n'])
})

test('消费链：semanticActions 的 openCodeActions 把本地条目与 LSP 条目合流', () => {
  const source = readFileSync(new URL('src/semanticActions.ts', root), 'utf8')
  assert.match(source, /from '\.\/localIntentions(?:\.ts)?'/)
  assert.match(source, /suppressionActionsFor\(/)
  // 2026-10-06 接线后合流不再按「哪段代码先写」排，改按上游档位排（CachedIntentions.java:354-360 先修复后意图），
  // 所以这里钉的是「两半都进了同一张表、并由规则判档」，不再钉旧的 `...localActions` 拼接形状。
  assert.match(source, /\{ group: 'fix', rows: \[[\s\S]*?\.\.\.localFixes\] \}/, 'LSP 条目与 JUnit 修复没并进 fix 档')
  assert.match(source, /\{ group: 'intention', rows: \[\.\.\.contributed, \.\.\.suppressions\] \}/,
    '抑制条目没并进 intention 档')
  assert.match(source, /orderIntentionSections<LspCodeAction>\(\[[\s\S]*?\]\)\.flatMap/, '档位顺序没交给 src/intentionList.ts')
})

test('消费链：本地条目这一层同时喂 LSP 诊断与本地检查诊断（JUnit 修复才到得了 Alt+Enter）', () => {
  const source = readFileSync(new URL('src/semanticActions.ts', root), 'utf8')
  assert.match(source, /from '\.\/junitQuickFix(?:\.ts)?'/, 'JUnit 快速修复规则没接进来')
  assert.match(source, /junitQuickFixActions\(\{/, 'openCodeActions 没调 JUnit 修复规则')
  // 本地检查诊断在**另一张表**里（junitInspections.ts:281）。只喂 lspDiagnostics 的话
  // JUnit 检查的诊断根本到不了这一层 —— 这是接这条链时最容易漏的一半。
  assert.match(source, /localDiagnostics\.get\(payload\.path\)/,
    '本地条目只看了 lspDiagnostics，localDiagnostics 没并进来')
  // 发给服务端的 codeAction 请求仍只能用 LSP 那张：本地检查不是服务端报的。
  assert.match(source, /const lineRows: LspDiagnostic\[\] = \[/)
})
