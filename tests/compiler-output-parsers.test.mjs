// lp/build 的编译器输出解析补齐：kotlinc 与 groovyc 两个上游 parser 的文本子集。
// 依据：
//   · `platform/lang-impl/src/com/intellij/build/output/KotlincOutputParser.kt:52-63`（严重级前缀
//     `e:`/`w:` + `file:` URI/路径 + `line:col` 或 `(line, col)` 位置）；
//   · `.../GroovycOutputParser.java:24-25` 的 `FILE_LINE` + `LOCATION` 模式。
// 消费链路：`src/runIssues.ts` → `parseAnyIssue`（运行/构建输出里的可跳转问题），App.vue 的构建控制台。

import test from 'node:test'
import assert from 'node:assert/strict'
const { fileUriToPath, parseRunIssue, parseAnyIssue } = await import('../src/buildOutput.ts')

test('kotlinc：file URI + 行:列', () => {
  assert.deepEqual(parseRunIssue('e: file:///D:/proj/src/Main.kt:5:9 Unresolved reference: foo'),
    { path: 'D:/proj/src/Main.kt', line: 5, column: 9 })
  assert.deepEqual(parseRunIssue('w: file:///D:/proj/src/Main.kts:12:3 Parameter never used'),
    { path: 'D:/proj/src/Main.kts', line: 12, column: 3 })
})

test('kotlinc：路径形态 + (行, 列)', () => {
  assert.deepEqual(parseRunIssue('e: src/Main.kt: (3, 15): Unresolved reference: bar'),
    { path: 'src/Main.kt', line: 3, column: 15 })
})

test('kotlinc：URI 里的百分号编码还原成路径字符', () => {
  assert.deepEqual(parseRunIssue('e: file:///D:/my%20proj/A.kt:2:4 boom'),
    { path: 'D:/my proj/A.kt', line: 2, column: 4 })
})

test('groovyc：同行的 @ line/column 给列号，没有就退回列 1', () => {
  assert.deepEqual(parseRunIssue('Main.groovy: 5: unexpected token: } @ line 5, column 3.'),
    { path: 'Main.groovy', line: 5, column: 3 })
  assert.deepEqual(parseRunIssue('src/App.groovy: 7: unable to resolve class Foo'),
    { path: 'src/App.groovy', line: 7, column: 1 })
})

test('fileUriToPath：盘符 / Unix / UNC 三种形态', () => {
  assert.equal(fileUriToPath('/D:/proj/Main.kt'), 'D:/proj/Main.kt')
  assert.equal(fileUriToPath('/home/u/Main.kt'), '/home/u/Main.kt')
  assert.equal(fileUriToPath('server/share/Main.kt'), '//server/share/Main.kt')
})

test('parseAnyIssue：kotlinc 的绝对 URI 归成根相对路径', () => {
  assert.deepEqual(parseAnyIssue('e: file:///D:/p/src/Main.kt:5:9 Unresolved reference: x', 'D:/p'),
    { path: 'src/Main.kt', line: 5, column: 9 })
  assert.deepEqual(parseAnyIssue('src/Main.groovy: 4: bad @ line 4, column 2.', 'D:/p'),
    { path: 'src/Main.groovy', line: 4, column: 2 })
})

test('不误报：普通文本、只有严重级、以及既有格式不走新分支', () => {
  assert.equal(parseRunIssue('hello world'), null)
  assert.equal(parseRunIssue('e: something went wrong'), null)
  assert.equal(parseRunIssue('build.gradle: 5: not a compiler message'), null)
  // 既有格式仍然命中（回归）
  assert.deepEqual(parseRunIssue('Main.java:10: error: cannot find symbol'),
    { path: 'Main.java', line: 10, column: 1 })
  assert.deepEqual(parseRunIssue('src/lib.rs:3:9: error[E0425]: cannot find value'),
    { path: 'src/lib.rs', line: 3, column: 9 })
})
