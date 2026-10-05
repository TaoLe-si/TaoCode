// 抑制动作（`src/suppressIntention.ts`）：按语言/来源生成抑制文本、插入位置、幂等判定。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  alreadySuppressed, applySuppression, suppressOptionsFor, suppressionRuleFor,
} from '../src/suppressIntention.ts'

test('来源到规则：eslint/jdt/pylint/clang/junit 各归各档', () => {
  assert.equal(suppressionRuleFor({ line: 0, source: 'eslint', code: 'no-unused-vars' }).tool, 'eslint')
  assert.equal(suppressionRuleFor({ line: 0, source: 'jdt', code: '' }).language, 'java')
  assert.equal(suppressionRuleFor({ line: 0, source: 'JUnit', code: '' }).rule, 'JUnit')
  assert.equal(suppressionRuleFor({ line: 0, source: 'clang-tidy', code: 'bugprone-x' }).language, 'cpp')
  assert.equal(suppressionRuleFor({ line: 0, source: '', code: '' }).tool, 'generic')
})

test('java：注释式带规则名，注解式兜底', () => {
  const options = suppressOptionsFor({ line: 3, source: 'jdt', code: 'unused' }, 'java')
  assert.equal(options[0].insertText, '//noinspection unused')
  assert.equal(options[0].placement, 'line-above')
  assert.equal(options[1].insertText, '@SuppressWarnings("all")')
})

test('typescript：优先 eslint-disable-next-line + 规则名，另有 @ts-ignore', () => {
  const eslint = suppressOptionsFor({ line: 1, source: 'eslint', code: 'no-console' }, 'typescript')
  assert.equal(eslint[0].insertText, '// eslint-disable-next-line no-console')
  assert.equal(eslint[1].insertText, '// @ts-ignore')
  const plain = suppressOptionsFor({ line: 1, source: 'ts', code: '' }, 'typescript')
  assert.equal(plain[0].insertText, '// eslint-disable-next-line')
})

test('python：# noqa 行尾；cpp/go 的 nolint 行尾', () => {
  const python = suppressOptionsFor({ line: 2, source: 'pylint', code: 'W0611' }, 'python')
  assert.deepEqual(python.map(option => option.placement), ['line-end', 'line-end'])
  assert.equal(python[0].insertText, '# noqa: W0611')
  assert.equal(suppressOptionsFor({ line: 0, source: 'clang', code: 'x' }, 'cpp')[0].insertText, '// NOLINT(x)')
  assert.equal(suppressOptionsFor({ line: 0, source: 'golangci', code: 'errcheck' }, 'go')[0].insertText, '//nolint:errcheck')
})

test('未知语言给通用注释式抑制', () => {
  const options = suppressOptionsFor({ line: 0, source: '', code: '' }, 'kotlin')
  assert.equal(options.length, 1)
  assert.equal(options[0].placement, 'line-above')
})

test('applySuppression：行尾追加 / 上一行插入（带缩进），越界返回 null', () => {
  const text = 'if (x) {\n    call();\n}\n'
  const endOption = { id: 'noqa', title: '', insertText: '# noqa', placement: 'line-end' }
  assert.equal(applySuppression(text, 1, endOption), 'if (x) {\n    call();  # noqa\n}\n')
  const aboveOption = { id: 'noinspection', title: '', insertText: '//noinspection x', placement: 'line-above' }
  assert.equal(applySuppression(text, 1, aboveOption, '    '), 'if (x) {\n    //noinspection x\n    call();\n}\n')
  assert.equal(applySuppression(text, 9, aboveOption), null)
  assert.equal(applySuppression(text, -1, aboveOption), null)
})

test('alreadySuppressed：行尾查本行、上一行式查相邻两行', () => {
  const text = 'class A {\n    //noinspection unused\n    int x;\n'
  const above = { id: 'a', title: '', insertText: '//noinspection unused', placement: 'line-above' }
  assert.ok(alreadySuppressed(text, 2, above))
  assert.ok(!alreadySuppressed(text, 1, above))
  const end = { id: 'b', title: '', insertText: '# noqa', placement: 'line-end' }
  assert.ok(alreadySuppressed('x = 1  # noqa\n', 0, end))
})
