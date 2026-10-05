// exec/junit：模式语法（TestsPattern）与 tag 表达式（TestTags）的判据。
// 上游对照：plugins/junit/.../TestsPattern.java:74-105,108-117,120-122,205-227、
// TestTags.java:66-91（parseAsJavaExpression：`1+2` 是合法 tag、`!1+2` 是否定、
// 顶层 `&&`/`||` 与括号不配平都抛）、JUnitBundle.properties:32,51,61。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classNamesOf, filterByTags, filterDiscovered, packagePattern, parseTagExpression, parseTestPattern,
         tagFilter, testPatternSelector, validateTestPattern } from '../src/junitPatterns.ts'

const FOUND = [
  { id: 'junit:a1', name: 'adds', suite: 'com.foo.MathTest', line: 10 },
  { id: 'junit:a2', name: 'subtracts', suite: 'com.foo.MathTest', line: 20 },
  { id: 'junit:b1', name: 'opens', suite: 'com.other.FileTest', line: 7 },
  { id: 'junit:n1', name: 'nestedCase', suite: 'com.foo.Outer$Inner', line: 3 },
]

test('模式三种形状：整类 / 类,方法 / 通配；逗号前是类名（TestsPattern:74-105 + checkConfiguration:216）', () => {
  assert.deepEqual(parseTestPattern('com.foo.MathTest'),
    { raw: 'com.foo.MathTest', className: 'com.foo.MathTest', methodName: null, wildcard: false, nested: false })
  assert.deepEqual(parseTestPattern('com.foo.MathTest,adds'),
    { raw: 'com.foo.MathTest,adds', className: 'com.foo.MathTest', methodName: 'adds', wildcard: false, nested: false })
  assert.equal(parseTestPattern('com.foo.*').wildcard, true)
  assert.equal(parseTestPattern('com.foo.MathTest,add*').wildcard, true, '方法位带 * 也算通配')
  assert.equal(parseTestPattern('com.foo.Outer$Inner').nested, true, 'JUnit5 的嵌套类形态（:84-95）')
  assert.equal(parseTestPattern(''), null, '空模式（上游 no.pattern.error.message，JUnitBundle.properties:32）')
  assert.equal(parseTestPattern('  ,adds'), null, '逗号前没有类名就不是模式')
})

test('校验只判「类在不在」，通配一律放过（checkConfiguration:218-226：类解析不出来且没有 * 才报错）', () => {
  const names = classNamesOf(FOUND)
  assert.equal(validateTestPattern(parseTestPattern('com.foo.MathTest'), names), null)
  assert.equal(validateTestPattern(parseTestPattern('MathTest'), names), null, '短名也算命中（上游按限定名找类，本仓的清单同时带短名）')
  assert.match(validateTestPattern(parseTestPattern('com.foo.NoneTest'), names), /com\.foo\.NoneTest/)
  assert.equal(validateTestPattern(parseTestPattern('com.foo.*'), names), null, '通配不核实（原样交给运行器）')
  assert.equal(validateTestPattern(parseTestPattern('com.foo.NoneTest'), new Set()), null, '没有类清单时无法核实，不猜')
})

test('选择器写成 surefire 认的 Class#method，通配原样交出（testPatternSelector 与 rerunCommand 同口径）', () => {
  assert.equal(testPatternSelector(['com.foo.MathTest,adds']), 'com.foo.MathTest#adds')
  assert.equal(testPatternSelector(['com.foo.MathTest', 'com.other.FileTest']), 'com.foo.MathTest,com.other.FileTest')
  assert.equal(testPatternSelector(['com.foo.*']), 'com.foo.*')
  assert.equal(testPatternSelector(['', '  ']), '')
})

test('模式对发现结果的作用：整类给全部方法，类,方法只给那一个，通配按前缀', () => {
  assert.deepEqual(filterDiscovered(['com.foo.MathTest'], FOUND).map(row => row.id), ['junit:a1', 'junit:a2'])
  assert.deepEqual(filterDiscovered(['com.foo.MathTest,adds'], FOUND).map(row => row.id), ['junit:a1'])
  assert.deepEqual(filterDiscovered(['com.foo.*'], FOUND).map(row => row.id).sort(), ['junit:a1', 'junit:a2', 'junit:n1'])
  assert.deepEqual(filterDiscovered([], FOUND).map(row => row.id), FOUND.map(row => row.id), '空模式不过滤')
  assert.deepEqual(filterDiscovered(['com.zzz.Nope'], FOUND), [])
  // 行的其它字段原样透传（面板要 path/framework）。
  assert.equal(filterDiscovered(['com.other.FileTest'], [{ ...FOUND[2], path: 'a/FileTest.java' }])[0].path, 'a/FileTest.java')
})

test('tag 表达式：& / | / 括号 / ! 都认，1+2 是合法 tag（TestTags:66-91 的 javadoc）', () => {
  assert.deepEqual(parseTagExpression('fast'), { raw: 'fast', tags: ['fast'], negated: [], error: null })
  assert.deepEqual(parseTagExpression('fast & !slow'), { raw: 'fast & !slow', tags: ['fast'], negated: ['slow'], error: null })
  // 括号是分组不是词：`(a|b) & c` 的三个操作数是 a、b、c。
  assert.deepEqual(parseTagExpression('(a|b) & c'), { raw: '(a|b) & c', tags: ['a', 'b', 'c'], negated: [], error: null })
  assert.deepEqual(parseTagExpression('1+2'), { raw: '1+2', tags: ['1+2'], negated: [], error: null })
  assert.deepEqual(parseTagExpression('!1+2'), { raw: '!1+2', tags: [], negated: ['1+2'], error: null })
})

test('tag 语法问题：上游只有一句话，逐字取自 JUnitBundle.properties:61；空的是 :60 那句', () => {
  for (const text of ['a && b', 'a || b', '(a & b']) {
    const parsed = parseTagExpression(text)
    assert.ok(parsed.error, `${text} 应该判非法`)
    assert.match(parsed.error, new RegExp(`Tag name \\[${text.replace(/[()&|]/g, '\\$&')}\\] must be syntactically valid`),
      `错误文案要含上游那句（JUnitBundle.properties:61）：${parsed.error}`)
  }
  // TestTags.checkConfiguration:49-52 对空的是另一条（RuntimeConfigurationError）。
  assert.match(parseTagExpression('').error, /Tags are not specified/)
  assert.match(parseTagExpression('   ').error, /Tags are not specified/)
  // 顶层判定：括号里的 && 不参与（上游 createExpressionFromText 只看顶层运算符类型）。
  assert.equal(parseTagExpression('(a && b)').error, null)
})

test('tag 过滤器原样透传只去空格（TestTags:115 的 getTags().replaceAll(" ", "")）', () => {
  assert.equal(tagFilter(parseTagExpression('fast & !slow')), 'fast&!slow')
  assert.equal(tagFilter(parseTagExpression('(a|b) & c')), '(a|b)&c')
  assert.equal(tagFilter(parseTagExpression('a && b')), '', '语法不过什么都不交')
})

test('tag 筛选用「全含 + 不含否定项」（面板的即时效果）', () => {
  const tagged = [
    { name: 'a', tags: ['fast'] },
    { name: 'b', tags: ['fast', 'slow'] },
    { name: 'c', tags: ['slow'] },
  ]
  assert.deepEqual(filterByTags(tagged, parseTagExpression('fast')), [0, 1])
  assert.deepEqual(filterByTags(tagged, parseTagExpression('fast & !slow')), [0])
  assert.deepEqual(filterByTags(tagged, parseTagExpression('a && b')), [], '非法表达式不筛（不猜）')
})

test('包范围退路的形状与 testPatternSelector 同源（类名通配，不是路径通配）', () => {
  assert.equal(packagePattern('com.foo'), 'com.foo.**.*Test')
  assert.equal(testPatternSelector([packagePattern('com.foo')]), 'com.foo.**.*Test')
  assert.equal(parseTestPattern(packagePattern('com.foo')).wildcard, true, '退路串必须仍被认成通配模式')
})
