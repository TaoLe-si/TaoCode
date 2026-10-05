// 接线门禁：`pv/command` 那一层不能只是新模块 —— 粘贴/剪切必须登记成命令，
// 项目视图的 Ctrl+Z / Ctrl+Shift+Z 必须真的走那条栈。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('粘贴副本/剪切粘贴登记为可撤命令（FileUndoProvider 的等价物）', () => {
  const actions = read('src/explorerActions.ts')
  assert.match(actions, /import \{ getCommandProcessor \} from '\.\/pvCommandProcessor\.ts'/)
  assert.match(actions, /import \{ createFileUndoProvider, hostFileIo, recordFileCommand, reportText \} from '\.\/pvFileUndoProvider\.ts'/)
  assert.match(actions, /const commands = \(\) => getCommandProcessor\(workspace\.value\?\.root \?\? ''\)/)
  assert.match(actions, /recordFileCommand\(commands\(\), \{ name: '粘贴副本', groupId: 'paste', steps: \[fileUndo\.copyStep\(clip\.entry\.path, destination\)\] \}\)/)
  assert.match(actions, /recordFileCommand\(commands\(\), \{ name: '移动', groupId: 'paste', steps: \[fileUndo\.moveStep\(clip\.entry\.path, destination\)\] \}\)/)
  assert.match(actions, /const undoFileOperation = \(scope: readonly string\[\] = \[\]\) => undoOrRedoFileOperation\('undo', scope\)/)
  assert.match(actions, /undoFileOperation, redoFileOperation,/)
})

test('项目视图上 Ctrl+Z / Ctrl+Shift+Z 接的是命令栈，不是编辑器文本撤销', () => {
  const tree = read('src/components/FileTree.vue')
  assert.match(tree, /import \{ getCommandProcessor \} from '\.\.\/pvCommandProcessor\.ts'/)
  assert.match(tree, /function undoRedoFileOperation\(kind: 'undo' \| 'redo'\) \{/)
  // `selection` 是从 createProjectTreeModel 解构出来的 reactive Set（`src/projectTreeModel.ts:26`），不是 ref ⇒ 没有 `.value`。
  assert.match(tree, /const scope = \[\.\.\.selection\]/)
  assert.match(tree, /void processor\[kind\]\(scope\)\.then\(result => \{/)
  assert.match(tree, /if \(!result\.ok && result\.report\) emit\('error', reportText\(result\.report\)\)/)
  // 键位：Ctrl+Shift+Z = 重做，Ctrl+Z = 撤销（$default.xml:232-235 / :685-688）。
  assert.match(tree, /if \(event\.key === 'Z' && event\.ctrlKey && !event\.altKey && !event\.metaKey\) \{/)
  assert.match(tree, /undoRedoFileOperation\(event\.shiftKey \? 'redo' : 'undo'\)/)
  assert.ok(!/document\.execCommand/.test(tree), '不用已废弃的 execCommand 兜壳')
})

test('撤销/重做的文案与上限来自上游坐标，不许写死在组件里', () => {
  const processor = read('src/pvCommandProcessor.ts')
  assert.match(processor, /undoTemplate: '撤消\{0\}'/)
  assert.match(processor, /localName: '本地'/)
  assert.match(processor, /nonUndoableProblem: '无法执行 \{0\}\\n以下文件包含无法撤消的更改：'/)
  assert.match(processor, /GLOBAL_UNDO_LIMIT = 10/)
  assert.match(processor, /DOCUMENT_UNDO_LIMIT = 100/)
  assert.match(processor, /COMMAND_NAME_MAX = 30/)
  const rows = read('src/pvFileUndoProvider.ts')
  assert.match(rows, /id: '\$Undo', title: \(\) => processor\.menuText\('undo', scope\(\)\), keys: 'Ctrl\+Z'/)
  assert.match(rows, /id: '\$Redo', title: \(\) => processor\.menuText\('redo', scope\(\)\), keys: 'Ctrl\+Shift\+Z'/)
  // 组件里没有硬编码的撤销文案（只允许从 pvCommandProcessor 那张表里取）。
  const tree = read('src/components/FileTree.vue')
  assert.ok(!/['"`]撤消|['"`]撤销/.test(tree), '树组件不自己拼撤销文案')
})
