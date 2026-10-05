// 项目视图的键盘动作：**Shift+F6 = `RenameElement`** —— 树里按下就给焦点那一行改名。
//
// 上游依据（键位与动作体）：
//   · `platform/platform-resources/src/keymaps/$default.xml:996-998`
//       `<action id="RenameElement"><keyboard-shortcut first-keystroke="shift F6"/>`
//     （F2 在默认键位表里是 `GotoNextError`，编辑器那侧已经占用，见 CodeEditor.vue:718-721；
//      macOS 键位表同样是 shift F6 + meta alt R，`macOS System Shortcuts.xml:140-143`）
//   · `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:216`
//       `RenameElement` → `com.intellij.refactoring.actions.RenameElementAction`
//   · `RenameElementAction.java:130-131` 动作体是**分派器**：按数据上下文收集 `RenamerFactory`
//     扩展给出的 renamer；`:115-117` 只有一个可用时直接执行（项目视图里就是文件/目录改名）。
//   动作本体在项目视图里的落点就是树的右键菜单「重命名…」，所以键盘与右键应当是同一个对话框。
//
// 判据：FileTree 把 Shift+F6 转成 `rename` 事件（合成行除外），宿主接到 `beginRename`，
// 两条路共用 `nameDialog`；其它按键仍旧走 `projectTreeModel.navigate`（不吞键）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n')
const tree = read('src/components/FileTree.vue')
const actions = read('src/treeActions.ts')
const view = read('src/components/ToolWindowView.vue')
const ctx = read('src/toolViewContext.ts')

test('FileTree 的行 keydown 走 onRowKeydown（导航不再直接绑在模板上）', () => {
  assert.match(tree, /@keydown="onRowKeydown\(row\.entry, \$event\)"/, '行上的按键要经过自己的分派')
  assert.doesNotMatch(tree, /@keydown="model\.navigate\(/, '不能把 navigate 直接绑在模板上（那样按不到 Shift+F6）')
  assert.match(tree, /function onRowKeydown\(entry: Entry, event: KeyboardEvent\)/, '要有这个分派函数')
  assert.match(tree, /void model\.navigate\(event, entry,/, '其余按键照旧交给 navigate')
})

test('Shift+F6 派发 rename：带修饰键判定、合成行不发、吃掉默认行为', () => {
  const body = tree.slice(tree.indexOf('function onRowKeydown('), tree.indexOf('function toggleChevron('))
  assert.match(body, /event\.key === 'F6' && event\.shiftKey && !event\.ctrlKey && !event\.metaKey && !event\.altKey/,
    '只认裸的 Shift+F6（上游 default 键位表就是 shift F6）')
  assert.match(body, /if \(entry\.path\.startsWith\('\\u0000'\)\) return/, '合成节点（NUL 前缀）没有可改名的文件')
  assert.match(body, /event\.preventDefault\(\)/, '不能让这键继续冒泡（编辑器那边 F6 无绑定，但保险）')
  assert.match(body, /emit\('rename', entry\)/, '事件带上整行 Entry，宿主才能复用既有改名流程')
  assert.match(tree, /rename: \[entry: Entry\]/, 'emit 声明里要有 rename')
})

test('beginRename/beginDelete 收一条可选的 entry：键盘那条路不经过右键菜单', () => {
  assert.match(actions, /function beginRename\(chosen\?: Entry\) \{ const entry = chosen \?\? treeMenu\.value\?\.entry;/,
    '右键那条路不传 chosen，键盘那条路把焦点行直接传进来')
  assert.match(actions, /function beginDelete\(chosen\?: Entry\) \{ const entry = chosen \?\? treeMenu\.value\?\.entry;/)
  // 合成节点与空路径在两条路上都要挡住（守卫在取 entry 之后、动作之前）。
  assert.match(actions, /isSyntheticPath\(entry\.path\)\) return; treeMenu\.value = null; nameDialog\.value = \{ mode: 'rename'/, '守卫与菜单收尾照旧')
})

test('两处宿主都接上：工具窗口里的树与并排的那棵', () => {
  assert.match(view, /@rename="ctx\.onTreeRename"/, 'ToolWindowView 要转发 rename 事件')
  assert.match(ctx, /onTreeRename: any/, 'ctx 输入类型要有它')
  assert.match(ctx, /onTreeRename: \(entry: unknown\) => onTreeRename\(entry\)/, 'ctx 工厂要透传')
  const app = read('src/App.vue')
  assert.match(app, /onTreeRename: beginRename/, 'App.vue 把它接到既有改名对话框（同一个 nameDialog）')
  assert.match(app, /@context="onTreeContext" @rename="beginRename"/, '并排那棵树也要接')
})

test('编辑器那侧不动：F2 仍是下一个高亮错误，Shift+F2 上一个', () => {
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /\{ key: 'F2', preventDefault: true, run: \(\) => goToError\(true\) \}/, 'F2 = 下一个错误')
  assert.match(editor, /\{ key: 'Shift-F2', preventDefault: true, run: \(\) => goToError\(false\) \}/, 'Shift+F2 = 上一个错误')
})
