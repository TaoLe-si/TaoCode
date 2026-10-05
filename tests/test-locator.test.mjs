// exec/sm-runner / exec/junit：测试位置解析的判据。
// 上游对照：platform/smRunner/.../SMTestLocator.java:22-54、
// java/execution/impl/.../JavaTestLocator.java:33-46,57-80,98-132,138-152,161-179,186-209、
// plugins/gradle/java/.../GradleTestLocator.kt:29-33。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SUITE_PROTOCOL, TEST_PROTOCOL, createTestUrl, firstTestLocation, locateTest, locateTestFromStack,
  parseTestUrl, resolveTestLocation, splitTestPath, testIndexOf,
} from '../src/testLocator.ts'

const INDEX = [
  { className: 'com.foo.BarTest', method: null, path: 'src/test/com/foo/BarTest.java', line: 5 },
  { className: 'com.foo.BarTest', method: 'adds', path: 'src/test/com/foo/BarTest.java', line: 12 },
  { className: 'com.foo.BarTest', method: 'adds', path: 'src/test/com/foo/BarTest.java', line: 21 },
  { className: 'com.foo.MathTest', method: 'subtracts', path: 'src/test/com/foo/MathTest.java', line: 9 },
]

test('URL 语法：协议://类[/方法[参数名]]，参数名单独截出来', () => {
  assert.deepEqual(parseTestUrl('java:test://com.foo.BarTest/adds[1]'),
    { protocol: 'java:test', path: 'com.foo.BarTest/adds', paramName: '[1]' })
  assert.equal(parseTestUrl('java:suite://com.foo.BarTest.').path, 'com.foo.BarTest.')   // 拆 URL 不动原串
  // 尾部的 `.` 在**解析位置**时去掉（上游 :68 trimEnd(path, ".")）。
  assert.deepEqual(locateTest(parseTestUrl('java:suite://com.foo.BarTest.'), INDEX).map(h => h.line), [5])
  assert.deepEqual(splitTestPath('com.foo.BarTest/adds'), { className: 'com.foo.BarTest', method: 'adds' })
  // 上游 :145-151 的旧格式兼容：没有 `/` 时按「包名.方法名」拆。
  assert.deepEqual(splitTestPath('com.foo.MathTest.subtracts'), { className: 'com.foo.MathTest', method: 'subtracts' })
})

test('生成侧 createTestUrl 与解析侧互逆（上游 :186-209 去掉方法行的 `()`）', () => {
  const url = createTestUrl(TEST_PROTOCOL, 'com.foo.BarTest', 'adds()', '[1]')
  assert.equal(url, 'java:test://com.foo.BarTest/adds[1]')
  assert.equal(parseTestUrl(url).path, 'com.foo.BarTest/adds')
})

test('suite 协议导航到类；方法名等于类名（构造器测试）也导航到类', () => {
  const hits = locateTest(parseTestUrl('java:suite://com.foo.BarTest'), INDEX)
  assert.deepEqual(hits.map(h => `${h.path}:${h.line}`), ['src/test/com/foo/BarTest.java:5'])
  const ctor = locateTest(parseTestUrl('java:test://com.foo.BarTest/BarTest'), INDEX)
  assert.deepEqual(ctor.map(h => h.line), [5])
})

test('test 协议给**全部**同名重载（上游 :168 的 findMethodsByName），不是只给第一个', () => {
  const hits = locateTest(parseTestUrl('java:test://com.foo.BarTest/adds'), INDEX)
  assert.equal(hits.length, 2)
  assert.deepEqual(hits.map(h => h.line), [12, 21])
})

test('参数化用例把 `[1]` 带在结果上（上游 PsiMemberParameterizedLocation）', () => {
  const hits = locateTest(parseTestUrl('java:test://com.foo.BarTest/adds[1]'), INDEX)
  assert.equal(hits[0].paramName, '[1]')
})

test('解析不出来就是空表，绝不臆造位置（上游 :82/:87/:152）', () => {
  assert.deepEqual(locateTest(parseTestUrl('java:test://com.nowhere.Thing/run'), INDEX), [])
  assert.deepEqual(resolveTestLocation('tp://[Unit test:%%~]', INDEX), [])
})

test('栈帧行直接可导航（上游 :129-132 + StackTraceLine:33/:78）', () => {
  const hits = locateTestFromStack('\tat com.foo.MathTest.subtracts(MathTest.java:30)', INDEX)
  assert.deepEqual(hits.map(h => `${h.path}:${h.line}`), ['src/test/com/foo/MathTest.java:9'])
})

test('本仓通道的 file:line 写法优先，认不出才走 URL（定位器链，GradleTestLocator:29-33）', () => {
  assert.deepEqual(firstTestLocation('src/test/com/foo/BarTest.java:12', INDEX), { path: 'src/test/com/foo/BarTest.java', line: 12, paramName: null })
  assert.deepEqual(firstTestLocation('java:test://com.foo.MathTest/subtracts', INDEX), { path: 'src/test/com/foo/MathTest.java', line: 9, paramName: null })
})

test('嵌套类 Outer$Inner 按外层类名命中（JUnit 5 的运行时名）', () => {
  const nested = [{ className: 'com.foo.Outer', method: null, path: 'Outer.java', line: 3 }]
  assert.deepEqual(locateTest(parseTestUrl(`${SUITE_PROTOCOL}://com.foo.Outer$Inner`), nested).map(h => h.path), ['Outer.java'])
})

test('metainfo 的 行:列 覆盖类节点自带行（上游 :106-121）', () => {
  const url = parseTestUrl('java:suite://com.foo.MathTest 9:4')
  const hits = resolveTestLocation('java:suite://com.foo.MathTest 9:4', INDEX)
  assert.equal(url.path, 'com.foo.MathTest 9:4')
  assert.deepEqual(hits.map(h => h.line), [9])
})

test('testIndexOf 由发现结果建索引：限定名与短名都能命中', () => {
  const index = testIndexOf([{ suite: 'com.foo.BarTest', name: 'adds', path: 'a/BarTest.java', line: 12 }])
  assert.deepEqual(firstTestLocation('java:test://BarTest/adds', index)?.line, 12)
  assert.deepEqual(firstTestLocation('java:test://com.foo.BarTest/adds', index)?.line, 12)
})

test('接线：面板用 resolveTestLocation 而不是只认 file:line', () => {
  const source = readFileSync(new URL('../src/components/TestRunnerPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /from '\.\.\/testLocator'/, '面板没有引用位置解析模块')
  assert.match(source, /resolveTestLocation|firstTestLocation/, '面板没有调用位置解析')
})
