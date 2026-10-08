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

test('typescript：eslint 来源下 eslint-disable 优先带规则名，@ts-ignore 备档；tsserver 反过来', () => {
  const eslint = suppressOptionsFor({ line: 1, source: 'eslint', code: 'no-console' }, 'typescript')
  assert.equal(eslint[0].insertText, '// eslint-disable-next-line no-console')
  assert.equal(eslint[1].insertText, '// @ts-ignore')
  // batch-inspections2 A3：source='ts'（tsserver 报的诊断，`native/lsp_support.cpp` 的 `source` 直接透传）
  // **不认** eslint-disable ⇒ 第一条必须是 `// @ts-ignore`，且不带规则名时不再塞一条 eslint 抑制冒充主项。
  const plain = suppressOptionsFor({ line: 1, source: 'ts', code: '' }, 'typescript')
  assert.equal(plain[0].insertText, '// @ts-ignore')
  assert.equal(plain.length, 1, '没有规则名时 eslint-disable 那一档不给（摆了也是假控件）')
  // 同一份 tsserver 诊断带规则码（`source: 'typescript'`, code 是 tsc 的 `TS2345` 那类）时：
  // 主项仍是 `@ts-ignore`；带码的 eslint-disable 降为备档，让同时装 eslint 的工作区能一键切过去。
  const withCode = suppressOptionsFor({ line: 1, source: 'typescript', code: 'TS2345' }, 'typescript')
  assert.equal(withCode[0].insertText, '// @ts-ignore')
  assert.equal(withCode[1].insertText, '// eslint-disable-next-line TS2345')
  assert.equal(withCode.length, 2)
})

test('javascript 与 typescript 走同一份分派（`suppressOptionsFor` 的两个 case 是**并立的**）', () => {
  // batch-inspections2 A3 反向：如果哪天合并成 `case 'typescript'` 一支、javascript 掉进 default，
  // 这里的 javascript 会拿到 `// 已确认：忽略此行告警` 而不是 `@ts-ignore` —— 会红。
  const js = suppressOptionsFor({ line: 0, source: 'ts', code: '' }, 'javascript')
  assert.equal(js[0].insertText, '// @ts-ignore')
  const jsEslint = suppressOptionsFor({ line: 0, source: 'eslint', code: 'no-unused-vars' }, 'javascript')
  assert.equal(jsEslint[0].insertText, '// eslint-disable-next-line no-unused-vars')
})

test('未知来源在 ts/js 文件上仍以 @ts-ignore 为主项，不再摆一条空的 eslint-disable 冒充', () => {
  // 覆盖 `tool === 'generic'` 那一支：source 没匹配到 eslint/ts/java/… 时（`suppressIntention.ts:52` 的兜底）
  // 主项也必须是真能生效的那一支，不是 `// eslint-disable-next-line`（不带规则时同样没作用）。
  const unknown = suppressOptionsFor({ line: 0, source: 'some-unknown-linter', code: '' }, 'typescript')
  assert.deepEqual(unknown.map(o => o.insertText), ['// @ts-ignore'])
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
