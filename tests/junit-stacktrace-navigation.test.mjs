// exec/sm-runner / exec/junit：**失败堆栈的定位**（上游 `SMStacktraceParser.getErrorNavigatable` 那一族）。
//
// 上游对照（本轮逐条自己开文件核实，声明行/分支行都按 `grep -n` 的实际输出写）：
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/SMStacktraceParser.java:29-38`
//     —— 接口本体：`getErrorNavigatable(location, stacktrace)`，注释原文
//     "Used for navigation from tests view to the editor if 'open failed line' option is selected"；
//     `:36-38` 的 `getTestStackTraceParser` 把 `proxy.getStacktrace()` 交给 `TestStackTraceParser`。
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestProxy.java:406-421`
//     —— `getDescriptor`：**先**问堆栈给出的 navigatable，给了就用它，否则退 `location.getNavigatable()`
//     （注释 `:409` "by location gets navigatable element. It can be file or place in file (e.g. when
//     OPEN_FAILURE_LINE is enabled)"）。⇒ 「失败行优先、认不出退回声明行」这条退路是上游自己的形状。
//   · `java/execution/impl/src/com/intellij/execution/testframework/JavaAwareTestConsoleProperties.java:84-121`
//     —— `:84-87` `getErrorNavigatable` 的注释 "//navigate to the first stack trace"；`:89-…` 的实现是
//     **逐帧比**「方法名 == 测试方法名 且 限定类名 == 测试类」，命中即 `break`（`:108-111`），
//     落点文件取的是**那个类的 containingFile**（`:115`），行号取那一帧的 `File.java:行`（`:114`）。
//   · `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/ui/TestStackTraceParser.java:20-21`
//     —— 两个正则：`outerPattern = \tat (.*)\.([^.]*)\((.*)\)`、`innerPattern = (.*):(\d*)`；
//     `:76-83` 那一帧的 `(...)` 里 `innerPattern` 不成立就直接**中止**（`return`，不是跳过）。
//   · `platform/testRunner/src/com/intellij/execution/testframework/TestConsoleProperties.java:54`
//     —— `openFailureLine` 默认 **true**；`:58 includeNonStarted` 默认 true（判据在 junit-rerun-failed-scope）。
//   · 工具栏上这条开关是真的：`platform/testRunner/src/com/intellij/execution/testframework/ToolbarPanel.java:187-189`
//     往 gear 组里加 `ToggleBooleanProperty(ExecutionBundle."junit.running.info.open.source.at.exception.*", OPEN_FAILURE_LINE)`；
//     文案在 `platform/execution/resources/messages/ExecutionBundle.properties:166-167`。
//
// 架构不等价的落点（写清楚，别当成省略）：上游 `:113-121` 还有一道 PSI 校验
// （行号必须落在该方法的 `TextRange` 里，且 `< document.getLineCount()`），本仓没有 PSI，
// 也不去猜文件行数 —— 只接受「类名/方法名对得上 + 那一帧自己报了 `:行`」，行号原样交给编辑器；
// 真正的越界由宿主打不开文件时如实报错兜住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OPEN_FAILURE_LINE_DESCRIPTION, OPEN_FAILURE_LINE_NAME, failureLocation, parseStackFrame, resolveFrameFile, testIndexOf } from '../src/testLocator.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const index = testIndexOf([
  { suite: 'com.foo.MathTest', name: 'adds', path: 'src/test/java/com/foo/MathTest.java', line: 11 },
  { suite: 'com.foo.MathTest', name: 'subtracts', path: 'src/test/java/com/foo/MathTest.java', line: 20 },
])

test('parseStackFrame：上游 outerPattern/innerPattern 的两段拆分（TestStackTraceParser.java:20-21）', () => {
  assert.deepEqual(parseStackFrame('\tat com.foo.MathTest.adds(MathTest.java:42)'),
    { className: 'com.foo.MathTest', methodName: 'adds', file: 'MathTest.java', line: 42 })
  // `CompiledCode` / `Native Method` 那两型：括号里没有 `:行` ⇒ line 为 null（innerPattern 不成立）。
  assert.deepEqual(parseStackFrame('\tat java.lang.Thread.run(CompiledCode)'),
    { className: 'java.lang.Thread', methodName: 'run', file: 'CompiledCode', line: null })
  assert.equal(parseStackFrame('expected 1 but was 2'), null, '不是栈帧的行不认')
  assert.equal(parseStackFrame('at Computed things'), null, '没有 `(参数)` 尾巴的行不是栈帧')
  assert.equal(parseStackFrame('MathTest.java:42'), null, '光一个文件位置是 `file:line`，不是栈帧')
})

test('failureLocation：命中「本类本方法」的第一帧就停（JavaAwareTestConsoleProperties.java:108-111 的 break）', () => {
  const stack = [
    'java.lang.AssertionError: expected:<1> but was:<2>',
    '\tat org.junit.Assert.fail(Assert.java:89)',
    '\tat com.foo.MathTest.adds(MathTest.java:42)',
    '\tat com.foo.MathTest.adds(MathTest.java:99)',
  ]
  const hit = failureLocation(stack, 'com.foo.MathTest', 'adds', index, true)
  assert.equal(hit?.path, 'src/test/java/com/foo/MathTest.java', '落点文件是**那个类**所在的文件（:115 的 containingFile）')
  assert.equal(hit?.line, 42, '行号取第一帧的，后面的帧不再看（:108-111 命中即 break）')
})

test('failureLocation：别的类/别的方法不算（:108-111 的两个 equals）', () => {
  const stack = ['\tat com.other.Helper.adds(Helper.java:7)', '\tat com.foo.MathTest.other(MathTest.java:42)']
  assert.equal(failureLocation(stack, 'com.foo.MathTest', 'adds', index, true), null,
    '方法名对不上、或类对不上 ⇒ 上游没有 navigatable，退路在调用方（SMTestProxy.java:406-421 的 location.getNavigatable()）')
})

test('failureLocation：命中的那一帧没有行号 ⇒ 中止而不是跳过（TestStackTraceParser.java:79-82 的 return）', () => {
  const stack = ['\tat com.foo.MathTest.adds(CompiledCode)', '\tat com.foo.MathTest.adds(MathTest.java:42)']
  assert.equal(failureLocation(stack, 'com.foo.MathTest', 'adds', index, true), null)
})

test('failureLocation：Open Source at Exception 关着就不定位（TestConsoleProperties.java:54 的那条开关）', () => {
  const stack = ['\tat com.foo.MathTest.adds(MathTest.java:42)']
  assert.equal(failureLocation(stack, 'com.foo.MathTest', 'adds', index, true)?.line, 42)
  assert.equal(failureLocation(stack, 'com.foo.MathTest', 'adds', index, false), null)
})

test('failureLocation：类解析不到就没有落点（不臆造路径，与 locateTest 的空表口径一致）', () => {
  const stack = ['\tat com.foo.UnknownTest.adds(UnknownTest.java:42)']
  assert.equal(failureLocation(stack, 'com.foo.UnknownTest', 'adds', index, true), null)
})

test('resolveFrameFile：栈帧里的裸文件名落到发现索引里的真实路径', () => {
  assert.deepEqual(resolveFrameFile('MathTest.java', 42, index),
    { path: 'src/test/java/com/foo/MathTest.java', line: 42, paramName: null })
  assert.equal(resolveFrameFile('Helper.java', 7, index), null, '索引里没有的文件不硬造一条路径')
  assert.deepEqual(resolveFrameFile('src/test/java/com/foo/MathTest.java', 8, index),
    { path: 'src/test/java/com/foo/MathTest.java', line: 8, paramName: null }, '已经是工作区相对路径时直接落')
  assert.equal(resolveFrameFile('', 8, index), null)
})

test('文案常量直译自上游 bundle（ExecutionBundle.properties:166-167）', () => {
  assert.equal(OPEN_FAILURE_LINE_NAME, 'Open Source at Exception')
  assert.equal(OPEN_FAILURE_LINE_DESCRIPTION, 'Go to the line which caused an exception when opening a test source')
})

test('消费链：详情区的文件位置是真按钮、点了走 jump；失败节点的定位优先用堆栈行', () => {
  const panel = read('src/components/TestRunnerPanel.vue')
  assert.match(panel, /const openFailureLine = ref\(DEFAULT_OPEN_FAILURE_LINE\)/,
    '默认值取自模块（上游 `:54` 默认 true），不是面板里手写一个字面量')
  assert.match(panel, /failureLocation\(feed\.detailLines\(node\.id\), classNameOf\(node\), node\.name, testIndex\.value, openFailureLine\.value\)/,
    '失败节点的落点先问堆栈（SMTestProxy.java:406-421 的先堆栈后声明）')
  assert.match(panel, /firstTestLocation\(node\.location, testIndex\.value\)/, '认不出时退回声明位置（上游的退路）')
  assert.match(panel, /v-else-if="segment\.link\.kind === 'file'" class="testrun-link"[\s\S]{0,160}@click="jumpDetailLink\(segment\.link\)"/,
    '详情区的 file 片段由 span 换成带 @click 的 button —— 之前只画了下划线点不动')
  assert.match(panel, /emit\('jump', \{ path: target\.path, line: target\.line \}\)/,
    '跳转复用面板现成的 jump 通道（App.vue 已在听 @jump，见 :2265 那一行）')
  assert.match(panel, /OPEN_FAILURE_LINE_NAME[\s\S]{0,120}openFailureLine = !openFailureLine/,
    'gear 组里那条开关在面板上是用户可见的（上游 ToolbarPanel.java:187-189）')
})
