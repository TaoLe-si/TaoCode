// 外部工具宏（`src/toolMacros.ts`）：`$FilePath$` 一族展开、带参宏、未知宏保留、输出过滤。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TOOL_MACROS, expandKnownToolMacros, expandToolMacros, fileDirPathFromParent, filterToolOutput, pathParts, toolMacrosIn, unknownToolMacros,
} from '../src/toolMacros.ts'

const context = {
  filePath: 'src/main/java/com/acme/App.java',
  projectRoot: 'C:/proj',
  projectName: 'demo',
  selectedText: 'hello world',
  clipboardContent: 'clip',
  line: 12,
  column: 5,
}

test('路径拆分：目录/文件名/词干/扩展名', () => {
  assert.deepEqual(pathParts('a/b/My.Class.java'), { directory: 'a/b', fileName: 'My.Class.java', stem: 'My.Class', extension: 'java' })
  assert.deepEqual(pathParts('a\\b\\x'), { directory: 'a/b', fileName: 'x', stem: 'x', extension: '' })
})

test('展开：文件/项目/选区/剪贴板/光标宏', () => {
  const command = 'run --file "$FilePath$" --dir "$FileDir$" --name "$FileName$" --ext $FileExt$ --stem $FileNameWithoutExtension$ --proj $ProjectName$ --sel "$SelectedText$" --clip "$ClipboardContent$" --at $LineNumber$:$ColumnNumber$'
  assert.equal(expandToolMacros(command, context),
    'run --file "src/main/java/com/acme/App.java" --dir "src/main/java/com/acme" --name "App.java" --ext java --stem App --proj demo --sel "hello world" --clip "clip" --at 12:5')
})

test('带参宏：$FileDirPathFromParent(src)$ 从祖先目录起算', () => {
  assert.equal(fileDirPathFromParent('src/main/java/A.java', 'src'), 'main/java')
  assert.equal(fileDirPathFromParent('src/main/java/com/acme/A.java', 'src'), 'main/java/com/acme')
  assert.equal(fileDirPathFromParent('src/main/java/A.java', 'java'), '')
  assert.equal(fileDirPathFromParent('src/main/java/A.java', 'missing'), '')
  assert.equal(expandToolMacros('--rel $FileDirPathFromParent(src)$', context), '--rel main/java/com/acme')
})

test('未知宏原样保留；已知宏无值是空串', () => {
  assert.equal(expandToolMacros('$FlePath$ $FilePath$', context), '$FlePath$ src/main/java/com/acme/App.java')
  assert.equal(expandToolMacros('x=$FilePath$', {}), 'x=')
  assert.deepEqual(unknownToolMacros('$FlePath$ $FilePath$ $Whatever(x)$'), ['FlePath', 'Whatever'])
  assert.deepEqual(toolMacrosIn('$FilePath$ $FilePath$ $ProjectName$'), ['FilePath', 'ProjectName'])
})

test('宏表覆盖展开器的名字（两边不漂移）', () => {
  const names = TOOL_MACROS.map(macro => macro.name)
  assert.deepEqual(toolMacrosIn(TOOL_MACROS.map(macro => `$${macro.name}$`).join(' ')), names)
})

test('只在出现已知宏时展开（运行控制台通道不做任意文本替换）', () => {
  assert.equal(expandKnownToolMacros('clang-format -i $FilePath$', context), 'clang-format -i src/main/java/com/acme/App.java')
  // 只有未知宏：不展开也不吞掉（原样），由调用点提示。
  assert.equal(expandKnownToolMacros('echo $FlePath$', context), 'echo $FlePath$')
  // 普通 shell/命令：一个字都不动（`$HOME` 没有成对 `$`，本来就不是宏）。
  assert.equal(expandKnownToolMacros('gradlew --console=plain build', context), 'gradlew --console=plain build')
  assert.equal(expandKnownToolMacros('echo $HOME $PATH', context), 'echo $HOME $PATH')
  assert.equal(expandKnownToolMacros('tool --name "$FileName$"', context), 'tool --name "App.java"', '已知宏名仍按表展开')
})

test('输出过滤：exclude 优先、include 只要命中行，保留原文与顺序', () => {
  const output = ['ok 1', 'warning: x', '  indented', 'error: y']
  assert.deepEqual(filterToolOutput(output, { exclude: /warning:/ }).lines, ['ok 1', '  indented', 'error: y'])
  assert.equal(filterToolOutput(output, { exclude: /warning:/ }).hidden, 1)
  const only = filterToolOutput(output.join('\n'), { include: /error|ok/ })
  assert.deepEqual(only.lines, ['ok 1', 'error: y'])
  assert.equal(only.hidden, 2)
  assert.deepEqual(filterToolOutput(output, { exclude: /./, include: /error/ }).lines, [], 'exclude 先赢')
})
