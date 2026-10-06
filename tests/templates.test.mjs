import test from 'node:test'
import assert from 'node:assert/strict'
import { availableTemplates, candidates, expand, languageFor, render, templates } from '../src/templates.ts'

// `line` and `caret` are line-local, exactly as CodeEditor hands them over.
const at = (line, caret, path) => expand(line, caret, path)

test('a keyword template replaces itself and lands the caret at $END$', () => {
  const result = at('    sout', 8, 'src/App.java')
  assert.ok(result)
  assert.equal(result.start, 4)
  assert.equal(result.end, 8)
  assert.equal(result.text, 'System.out.println();')
  assert.equal(result.caret, 'System.out.println('.length)
  assert.deepEqual(result.stops, [])
})

test('templates are filtered by language', () => {
  assert.equal(at('sout', 4, 'src/app.ts'), null)
  assert.equal(at('log', 3, 'src/app.ts').text, 'console.log();')
  assert.equal(languageFor('native/main.cpp'), 'cpp')
  assert.equal(languageFor('README.md'), 'other')
})

test('multi-line bodies follow the indent of the line being expanded', () => {
  const result = at('      fori', 10, 'src/App.java')          // six spaces of indent
  assert.equal(result.text, 'for (int index = 0; index < 10; index++) {\n        \n      }')
  const limit = result.stops[0]
  assert.equal(result.text.slice(limit.start, limit.end), '10', 'the LIMIT slot is selectable')
  assert.ok(result.text.slice(0, result.caret).endsWith('\n' + ' '.repeat(8)), 'caret sits on the body line, past its indent')
})

test('a postfix template consumes the receiver as fixed text', () => {
  const result = at('list.size().for', 15, 'src/App.java')
  assert.ok(result)
  assert.equal(result.start, 0, 'the whole receiver.dot.key run is replaced')
  assert.match(result.text, /^for \(.*item : list\.size\(\)\) \{/)
  assert.equal(result.stops[0].start, result.stops[0].end, 'the empty type slot is zero-width')
  const item = result.text.indexOf('item')
  assert.deepEqual(result.stops[1], { start: item, end: item + 4 }, 'the item slot carries a selectable default')
  assert.ok(!result.text.includes('EXPR'), 'the placeholder is gone, the receiver is literal text')
})

test('the postfix receiver is the expression before the dot, not the whole statement', () => {
  assert.equal(at('.for', 4, 'src/App.java'), null, 'a dot with no receiver is not a trigger')
  const result = at('x = value.nn', 12, 'src/App.java')
  assert.equal(result.start, 4, 'only value.nn is replaced, the assignment survives')
  assert.match(result.text, /^if \(value != null\) \{/)
  const call = at('return map.get(key).sout', 24, 'src/App.java')
  assert.match(call.text, /^System\.out\.println\(map\.get\(key\)\);/, 'a balanced call chain stays one receiver')
})

test('render resolves $END$, literal variables and defaulted slots', () => {
  const plain = render('a$END$b$X:y$', '', {})
  assert.equal(plain.text, 'aby')
  assert.deepEqual(plain.stops, [{ start: 2, end: 3 }])
  assert.equal(plain.caret, 1, '$END$ wins over the trailing default')
  const withVar = render('$EXPR$ + $TAIL:$', '', { EXPR: 'v' })
  assert.equal(withVar.text, 'v + ')
  assert.deepEqual(withVar.stops, [{ start: 4, end: 4 }], 'a slot with no default is a caret stop')
})

// 上游模板正文有一条美元转义：`TemplateTextLexer.flex:27` 把 `$$` 认成 ESCAPE_DOLLAR，
// `TemplateBase.java:66-68` 落进插入文本的是一个字面 `$`。本仓以前原样输出 `$$`，
// 设置页还写着「引擎没有转义机制」—— 那条文案这次一并订正。
test('a doubled dollar is the escaped dollar sign, not a slot', () => {
  const result = render('log("$$");$END$', '', {})
  assert.equal(result.text, 'log("$");')
  assert.deepEqual(result.stops, [], '转义不产生槽位')
  assert.equal(result.caret, 'log("$");'.length, '光标位置按转义之后的文本算')
  assert.equal(render('$$$NAME:value$', '', {}).text, '$value', '转义紧跟一个真槽位')
  assert.equal(render('price: $$5', '', {}).text, 'price: $5')
})

// 本仓那段 `:默认值` 只在同一行内认（上游的 `$…$` token 里根本没有换行）。
// 引擎与设置页以前各写一份词法：一个允许跨行、一个不允许 ⇒ 预览和展开会两套口径，这里是合流后的那一份。
test('a slot default does not swallow a line break', () => {
  const result = render('x$A:\nB$y', '', {})
  assert.equal(result.text, 'x$A:\nB$y', '跨行的那一段不是槽位，原样留着')
  assert.deepEqual(result.stops, [])
})

test('the completion list offers matching keywords and postfix keys', () => {
  const keys = candidates('for', 3, 'src/App.java').map(entry => entry.key)
  assert.ok(keys.includes('fori') && keys.includes('foreach'), 'longer keywords are suggested')
  assert.equal(candidates('sout', 4, 'src/App.java').length, 0, 'an exactly typed keyword needs no suggestion')
  const postfix = candidates('x = list.', 9, 'src/App.java').map(entry => entry.key)
  assert.ok(postfix.includes('nn') && postfix.includes('sout'), 'postfix keys appear after the dot')
  assert.ok(!postfix.includes('main'), 'keyword templates are not offered as postfixes')
  assert.deepEqual(candidates('list.n', 8, 'src/App.java').map(entry => entry.key), ['not', 'nn', 'null'], 'the typed prefix narrows the postfix keys')
  const bare = candidates('.', 1, 'src/App.java')
  assert.ok(bare.length && bare.every(entry => entry.detail === 'live template'), 'a dot with no receiver offers keywords, never postfixes')
})

test('every template has a description, a body and a known language', () => {
  const known = new Set(['java', 'cpp', 'typescript', 'other'])
  const seen = new Set()
  for (const template of [...templates, ...availableTemplates('a.java'), ...availableTemplates('a.cpp'), ...availableTemplates('a.ts')]) {
    if (seen.has(template)) continue
    seen.add(template)
    assert.ok(template.key && template.body && template.description, 'complete entry: ' + template.key)
    assert.ok(!template.languages.length || template.languages.every(language => known.has(language)), 'known language in ' + template.key)
  }
  assert.ok(seen.size > 20, 'the built-in set is substantial, got ' + seen.size)
})

// --- live template settings: switches, customs and shadowing ---------------------
const settings = await import('../src/templates.ts')

test('a disabled switch hides a built-in from expansion and completion', () => {
  const off = { overrides: [{ pattern: settings.templatePattern(settings.templates.find(t => t.key === 'sout')), disabled: true }], customs: [] }
  assert.equal(settings.expand('    sout', 8, 'A.java', off), null)
  assert.ok(!settings.candidates('    so', 6, 'A.java', off).some(entry => entry.key === 'sout'))
  assert.ok(settings.expand('    sout', 8, 'A.java'), 'the same template still expands when nothing is switched off')
})

test('a custom template shadows and extends the built-in list', () => {
  const withCustom = { overrides: [], customs: [{ key: 'sout', body: 'log($END$)', description: '自己的打印', languages: ['java'] }] }
  const result = settings.expand('    sout', 8, 'A.java', withCustom)
  assert.equal(result.text, 'log()', 'the custom body replaces the keyword (text is line-local)')
  const extra = { overrides: [], customs: [{ key: 'logger', body: 'Logger.log($END$)', description: '日志器', languages: [] }] }
  assert.ok(settings.expand('  logger', 8, 'A.java', extra), 'a custom entry with no language list works everywhere')
  assert.ok(settings.candidates('  logg', 6, 'A.java', extra).some(entry => entry.key === 'logger'))
})

test('custom shadowing is limited to enabled live templates in the same language', () => {
  const custom = { key: 'main', body: 'custom()', description: 'custom', languages: ['java'] }
  const config = { overrides: [], customs: [custom] }
  assert.equal(expand('main', 4, 'A.java', config).text, 'custom()')
  assert.equal(expand('main', 4, 'a.cpp', config).text, expand('main', 4, 'a.cpp').text)
  const sout = { overrides: [], customs: [{ ...custom, key: 'sout' }] }
  assert.equal(expand('value.sout', 10, 'A.java', sout).text, 'System.out.println(value);')
  config.overrides.push({ pattern: 'custom:main', disabled: true })
  assert.equal(expand('main', 4, 'A.java', config).text, expand('main', 4, 'A.java').text)
  assert.deepEqual(availableTemplates('A.java', { overrides: [], customs: [] }), availableTemplates('A.java'))
})

test('postfix templates obey their switch too', () => {
  const target = settings.postfixTemplates.find(template => template.key === 'var' && template.languages.includes('java'))
  const off = { overrides: [{ pattern: settings.templatePattern(target), disabled: true }], customs: [] }
  assert.equal(settings.expand('value.var', 9, 'A.java', off), null)
  assert.ok(settings.expand('value.var', 9, 'A.java'), 'enabled by default')
})
