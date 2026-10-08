// exec/filters 本轮的判据：异常分类（上游 ExceptionInfo 一族）、多文件超链接
// （MultipleFilesHyperlinkInfo）、Java 栈帧折叠，与三处真实接线的存在性。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classifyJavaException,
  describeExceptionKind,
  foldJavaStackFrames,
  parseStackFrame,
  stackFrameCopyText,
} from '../src/exceptionFilter.ts'
import { findRunHyperlinks, splitRunLine } from '../src/runHyperlinks.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('异常头分类：NPE / 越界 / arraycopy / 负长度 / 除零 / 转换 / 断言', () => {
  const npe = classifyJavaException('Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()" because "s" is null')
  assert.equal(npe.className, 'java.lang.NullPointerException')
  assert.equal(npe.simpleName, 'NullPointerException')
  assert.equal(npe.kind, 'null-pointer')
  assert.equal(npe.thread, 'main')
  assert.equal(npe.hint, '在 String.length() 上出现空引用')
  assert.equal(npe.causedBy, false)

  const aioobe = classifyJavaException('java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 3')
  assert.equal(aioobe.kind, 'array-index')
  assert.equal(aioobe.hint, '下标 5 超出长度 3')

  const copy = classifyJavaException('java.lang.ArrayIndexOutOfBoundsException: arraycopy: last source index 6 out of bounds for int[3]')
  assert.equal(copy.kind, 'array-copy-index', 'System.arraycopy 的越界单独分类（上游 ArrayCopyIndexOutOfBoundsExceptionInfo）')

  const negative = classifyJavaException('java.lang.NegativeArraySizeException: -3')
  assert.equal(negative.kind, 'negative-array-size')
  assert.equal(negative.hint, '数组长度为负：-3')

  const arithmetic = classifyJavaException('Caused by: java.lang.ArithmeticException: / by zero')
  assert.equal(arithmetic.kind, 'arithmetic')
  assert.equal(arithmetic.causedBy, true, 'cause 链的 Caused by 头要认出来')
  assert.equal(arithmetic.hint, '除零')

  const cast = classifyJavaException('java.lang.ClassCastException: class java.lang.String cannot be cast to class java.lang.Integer (java.lang.String and java.lang.Integer are in module java.base)')
  assert.equal(cast.kind, 'class-cast')
  assert.equal(cast.hint, '无法把 String 转成 Integer')

  const assertion = classifyJavaException('java.lang.AssertionError: Expected true')
  assert.equal(assertion.kind, 'assertion')
  assert.equal(assertion.hint, '断言期望 true')

  const notNull = classifyJavaException("java.lang.IllegalArgumentException: Argument for @NotNull parameter 'name' of com/x/Y.z must not be null")
  assert.equal(notNull.kind, 'not-null', 'JetBrains @NotNull 插桩的 IAE 单独分类')
  assert.equal(notNull.hint, '参数 name 不能为空')

  assert.equal(classifyJavaException('java.lang.IllegalStateException: closed').kind, 'other')
  assert.equal(classifyJavaException('编译失败：3 个错误'), null, '不是异常头就不认领')
  assert.equal(classifyJavaException('    at com.x.Y.z(Y.java:12)'), null, '栈帧不是异常头')
})

test('异常分类徽标与栈帧解析、复制文本', () => {
  assert.equal(describeExceptionKind('null-pointer'), '空指针')
  assert.equal(describeExceptionKind('array-copy-index'), '数组复制越界')
  assert.equal(describeExceptionKind('other'), '异常')
  const frame = parseStackFrame('    at com.example.Main.main(Main.java:12)')
  assert.deepEqual(frame, { method: 'com.example.Main.main', file: 'Main.java', line: 12 })
  assert.equal(parseStackFrame('Exception in thread "main" x'), null)
  assert.equal(stackFrameCopyText('  at a.b(c.java:1)  '), 'at a.b(c.java:1)')
})

test('Java 栈帧折叠：保留阈值内帧并将其余帧合并到占位行；展开时原样', () => {
  const lines = [
    { text: 'Exception in thread "main" java.lang.RuntimeException: boom' },
    { text: '\tat a.A.a(A.java:1)' },
    { text: '\tat b.B.b(B.java:2)' },
    { text: '\tat c.C.c(C.java:3)' },
    { text: '\tat d.D.d(D.java:4)' },
    { text: '\tat e.E.e(E.java:5)' },
  ]
  const folded = foldJavaStackFrames(lines, false)
  assert.deepEqual(folded.map(line => line.text), [
    'Exception in thread "main" java.lang.RuntimeException: boom',
    '\tat a.A.a(A.java:1)',
    '\tat b.B.b(B.java:2)',
    '\t<3 个折叠帧>',
  ])
  assert.equal(folded[3].foldedFrames, 3, '占位行记录阈值之后折叠的 3 行')
  assert.equal(folded[2].foldedFrames, undefined)
  assert.equal(foldJavaStackFrames(lines, true).length, 6, '展开时一行不少')

  // 阈值内的栈帧不折叠。
  const short = foldJavaStackFrames(lines.slice(0, 3), false)
  assert.equal(short.length, 3)
  assert.ok(short.every(line => line.foldedFrames === undefined))
})

test('一行里的多个文件位置：全部扫出、各自成片段、去重叠', () => {
  const links = findRunHyperlinks('见 C:\\proj\\src\\A.java:12:3 与 B.kt:7（另见 http://host/x.js:1）', 'C:/proj')
  assert.deepEqual(links.map(link => [link.path, link.line, link.column]), [
    ['src/A.java', 12, 3],
    ['B.kt', 7, 1],
  ], '绝对路径按项目根归一化；URL 不算（前面是 //）')
  const segments = splitRunLine('见 C:\\proj\\src\\A.java:12:3 与 B.kt:7', links)
  assert.equal(segments.map(segment => segment.text).join(''), '见 C:\\proj\\src\\A.java:12:3 与 B.kt:7', '片段覆盖整行')
  assert.equal(segments.filter(segment => segment.link).length, 2)
  assert.deepEqual(findRunHyperlinks('没有位置', ''), [])
  assert.ok(findRunHyperlinks('x A.java:1 x B.java:2 x C.java:3', '', 2).length === 2, '上限生效')
})

test('接线：runIssues 收集全部链接、RunConsole 渲染片段与异常徽标/复制/栈帧开关', () => {
  const issues = read('src/runIssues.ts')
  assert.match(issues, /findRunHyperlinks\(text, workspace\.value\?\.root \?\? ''\)/)
  assert.match(issues, /links,/)
  const console = read('src/components/RunConsole.vue')
  assert.match(console, /classifyJavaException\(text\)/)
  assert.match(console, /foldJavaStackFrames\(/)
  assert.match(console, /splitRunLine\(text, links\)/)
  assert.match(console, /describeExceptionKind\(line\.exception\.kind\)/)
  // 暂停输出那颗钮的标签随暂停态翻转。读的是 `consolePaused`（`runOutputPausedState()`：
  // EP `com.intellij.execution.consolePauseStateProvider` 的贡献，内建那条就是运行控制台自己的
  // 暂停位），不是直接读 `runOutputPaused` —— 判据守**意图**（标签跟着暂停态翻），不锁死中间那一层。
  assert.match(console, /:aria-label="consolePaused \? '继续输出' : '暂停输出'"/)
  assert.match(console, /@click="copyLine\(line\)"/)
  assert.match(console, /jumpLink\(segment\.link\)/)
})
