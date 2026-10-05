import test from 'node:test'
import assert from 'node:assert/strict'
import { compileStructuralPattern, compileStructuralReplacement, replacementVariables } from '../src/structuralSearch.ts'

const run = (pattern, flags = '') => new RegExp(compileStructuralPattern(pattern).regex, flags)
const ok = pattern => {
  const compiled = compileStructuralPattern(pattern)
  assert.ok(!('error' in compiled), `${pattern} 不该编译失败`)
  return compiled
}

test('字面量照抄且正则元字符被转义', () => {
  const compiled = ok('a.b(c)')
  assert.equal(compiled.regex, 'a\\.b\\(c\\)')
  assert.ok(run('a.b(c)').test('a.b(c)'))
  assert.ok(!run('a.b(c)').test('axb(c)'))
})

test('变量编译成标识符捕获组', () => {
  // 模板里的空白不参与比对（上游 `MatchOptions.java:60` 的 looseMatching 恒为真、
  // `GlobalMatchingVisitor.java:93,234-236` 跳过模式侧空白节点），所以字面空格编成
  // `\s*`/`\s+` 而不是原样照抄：标点两侧可以没有空白，两个词之间必须有空白。
  const compiled = ok('$x$ + 1')
  assert.equal(compiled.regex, '([A-Za-z_$][\\w$]*)\\s*\\+\\s*1')
  assert.deepEqual(compiled.variables, ['x'])
  const re = run('$x$ + 1')
  assert.ok(re.test('count + 1'))
  // 空白少写一个也照样命中（这是 looseMatching 的用户可见面，不是放宽断言）。
  assert.ok(re.test('count+1'))
  assert.ok(re.test('count\t+  1'))
  // 结构化搜索和上游同样不是整行匹配，前面那段文本不参与。
  assert.equal(re.exec('a b + 1')?.[0], 'b + 1')
  assert.ok(!re.test('+ 1'))
})

test('两个词之间的空白仍然必须有，loose 不等于把词粘起来', () => {
  const re = run('foo bar')
  assert.ok(re.test('foo bar'))
  assert.ok(re.test('foo\tbar'))
  assert.ok(re.test('foo  bar'))
  // `foo bar` 是语法树上的两个 token，loose matching 跳过的是 token **之间**的空白节点，
  // 不是把两个 token 合成一个 —— 所以 `foobar` 不许命中。
  assert.ok(!re.test('foobar'))
})

test('同名变量第二次出现是反向引用（必须匹配同一段文本）', () => {
  const compiled = ok('$x$ == $x$')
  assert.equal(compiled.regex, '([A-Za-z_$][\\w$]*)\\s*==\\s*\\1')
  const re = run('$x$ == $x$')
  assert.ok(re.test('value == value'))
  assert.ok(re.test('value==value'))
  assert.ok(!re.test('left == right'))
})


test('不同变量各自建组，替换串翻成 $N', () => {
  const compiled = ok('$a$.$b$')
  assert.deepEqual(compiled.variables, ['a', 'b'])
  assert.equal(compileStructuralReplacement('$b$($a$)', compiled.variables), '$2($1)')
  const re = run('$a$.$b$')
  assert.equal(re.exec('user.name')?.[0], 'user.name')
})

test('替换串里的未知变量保持字面，不动其它文本', () => {
  assert.equal(compileStructuralReplacement('$nope$ x', ['x']), '$nope$ x')
  assert.equal(compileStructuralReplacement('log($x$)', ['x']), 'log($1)')
})

test('replacementVariables 按出现顺序去重', () => {
  assert.deepEqual(replacementVariables('$b$ $a$ $b$'), ['b', 'a'])
  assert.deepEqual(replacementVariables('none'), [])
})

test('空模板与纯变量模板的边界', () => {
  assert.ok('error' in compileStructuralPattern(''))
  assert.ok('error' in compileStructuralPattern('   '))
  // 只有变量也算合法模板（匹配任意标识符）。
  const compiled = ok('$x$')
  assert.equal(compiled.regex, '([A-Za-z_$][\\w$]*)')
})

test('落单的 $ 按字面处理', () => {
  const compiled = ok('price $ 1')
  // `$` 在本仓的标识符字符集里算词字符（`IDENTIFIER` 含 `$`），所以两侧仍要求有空白边界。
  assert.equal(compiled.regex, 'price\\s+\\$\\s+1')
  assert.ok(run('price $ 1').test('price $ 1'))
  assert.ok(!run('price $ 1').test('price$1'))
})

test('未闭合的 $ 不做变量解析', () => {
  const compiled = ok('$x')
  assert.deepEqual(compiled.variables, [])
  assert.ok(run('$x').test('$x'))
})
