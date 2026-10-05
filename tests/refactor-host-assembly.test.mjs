// 桶 1 重构域**宿主装配层**的判据（`src/refactorHostAssembly.ts`，2026-10-06 接线）。
//
// 为什么要有这一份：`src/refactorSignatureFlow.ts` / `refactorMemberMove.ts` /
// `refactorIntroduceParameterObject.ts` / `safeDelete.ts` 各自的单测只验模型，
// `tests/refactor-menu-parity.test.mjs` 只验「菜单行按能力渲染」的契约 ——
// 中间那层「宿主把模型接成一次真实改动」以前没有任何判据，接错了（依赖名对不上、
// 预览链没走、勾选表出不来）只有点界面才知道。这里用假依赖把四条链路跑通：
//   1) 更改签名：状态起得来 → 改预览 → apply 走 renamePreviewOf 闸门 → openEditsPreview → 写盘；
//   2) 成员上移：勾选表按 memberMovePanelTitle 起 → 目标类在**同文件**也认 → 编辑交给预览链；
//   3) 引入形参对象：面板次序 = PARAMETER_OBJECT_PANELS；ts 档不给「保持为委托」复选框（supportsDelegate）；
//   4) 安全删除：有字面用法 → blocked → 三选一；选「仍然删除」才调宿主的删档那条链。
// 纯 JS（node --test 不带 --experimental-strip-types），值 import 一律写全 `.ts`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRefactorHost } from '../src/refactorHostAssembly.ts'

/** 最小宿主假象：所有落盘/预览/通知都记进 calls，便于逐条比对。 */
function host(files, options = {}) {
  const calls = []
  const byPath = new Map(files.map(file => [file.path, file]))
  const deps = {
    active: { value: files[0] },
    allTabs: { value: files },
    findTab: path => byPath.get(path),
    editorFor: path => ({
      text: () => (byPath.get(path) ?? files[0]).content,
      getCursor: () => ({ line: options.line ?? 0, ch: options.character ?? 20 }),
      setDraft() {},
    }),
    notify: (message, error) => { calls.push(['notify', message, Boolean(error)]) },
    workspace: () => ({ root: '/', entries: files.map(file => ({ path: file.path, kind: 'file' })) }),
    isDesktop: true,
    languageOf: () => options.language ?? 'typescript',
    applyEditsToFiles: async (edits, message) => {
      calls.push(['apply', message, edits.map(edit => `${edit.path}:${edit.textEdits.length}`).join('|')])
      return edits.length
    },
    openEditsPreview: async (label, edits, write) => {
      calls.push(['preview', label, edits.length])
      await write(edits)
    },
    deleteFile: async path => { calls.push(['delete', path]) },
    showUsages: target => { calls.push(['usages', target.path, target.line, target.character]) },
    refreshOutline: async () => undefined,
    outline: () => options.symbols ?? [],
  }
  return { host: createRefactorHost(deps), calls, deps }
}

test('更改签名：装配后的状态、预览与「重构」写盘链路是通的', async () => {
  const decl = { path: 'src/greet.ts', content: 'export function greet(name: string, loud: boolean) {\n  return name\n}\n', line: 1, column: 20 }
  const user = { path: 'src/use.ts', content: 'import { greet } from "./greet"\nconst a = greet("x", true)\n', line: 1, column: 1 }
  const { host: wired, calls } = host([decl, user])
  await wired.openChangeSignature()
  const state = wired.changeSignatureState.value
  assert.ok(state, 'openChangeSignature 没有把对话框状态立起来')
  assert.equal(state.name, 'greet')
  assert.deepEqual(state.params.map(param => param.name), ['name', 'loud'])
  wired.changeSignature.setName('hello')
  wired.changeSignature.setParam(1, { name: 'shout' })
  assert.equal(wired.changeSignatureState.value.preview, 'function hello(name: string, shout: boolean)')
  assert.equal(wired.changeSignatureState.value.error, '', '合法改动不该报错')
  await wired.changeSignature.applyChangeSignature()
  assert.equal(wired.changeSignatureState.value, null, '应用后对话框必须收掉')
  assert.deepEqual(calls.map(call => call[0]), ['preview', 'apply'], '必须先过预览再写盘')
  assert.match(calls[0][1], /^更改签名 hello$/)
  assert.equal(calls[0][2], 2, '声明处 + 调用点两个文件')
  assert.match(calls[1][1], /已应用「更改签名 hello」/, '写盘提示用的是宿主那条链')
})

test('更改签名：光标不在声明上时如实说不做，不立一个空对话框', async () => {
  const stray = { path: 'src/notes.ts', content: 'const a = 1\n', line: 1, column: 1 }
  const { host: wired, calls } = host([stray])
  await wired.openChangeSignature()
  assert.equal(wired.changeSignatureState.value, null)
  assert.deepEqual(calls, [['notify', '光标不在可改签名的函数/方法声明上。请把光标放到方法名或其函数体内。', true]])
})

test('成员上移：勾选表按上游面板次序起，同文件的父类也认，编辑交给预览链', async () => {
  const java = 'package demo;\nclass Main extends Base {\n  void run() { go(); }\n  int x = 1;\n}\nclass Base {\n}\n'
  const file = { path: 'src/demo/Main.java', content: java, line: 3, column: 10 }
  const { host: wired, calls } = host([file], { language: 'java', line: 2, character: 10 })
  await wired.openPullUp()
  const model = wired.chooserState.value
  assert.ok(model, 'openPullUp 没有起勾选表')
  assert.equal(model.title, '向上拉取成员')
  assert.deepEqual(model.panels.map(panel => panel.title), ['将Main的成员向上拉取至:', '成员'])
  assert.equal(model.panels[0].value, 'Base', '目标类默认就是 extends 那个名字')
  assert.deepEqual(model.panels[1].rows.map(row => row.id), ['run', 'x'])
  assert.deepEqual(model.panels[1].columns.map(column => column.label), ['成员', '种类', '保持抽象'])
  wired.toggleChooserRow(1, 0)
  await wired.applyChooser()
  assert.deepEqual(calls.map(call => call[0]), ['preview', 'apply'])
  assert.equal(calls[0][1], '向上拉取成员 Main → Base')
  assert.match(calls[1][1], /从「Main」向上拉取到「Base」/, '完成提示用 memberMoveNotice 的账')
})

test('成员上移：没有父类时直接说不做（不猜一个目标）', async () => {
  const java = 'class Solo {\n  void run() { go(); }\n}\n'
  const file = { path: 'src/demo/Solo.java', content: java, line: 2, column: 8 }
  const { host: wired, calls } = host([file], { language: 'java', line: 1, character: 8 })
  await wired.openPullUp()
  assert.equal(wired.chooserState.value, null)
  assert.deepEqual(calls, [['notify', '「Solo」没有父类，无法向上拉取成员。', true]])
})

test('引入形参对象：面板次序 = PARAMETER_OBJECT_PANELS，ts 档不给「保持为委托」那一格', async () => {
  const ts = 'export function draw(width: number, height: number, pad: number) {\n  return width + height + pad\n}\n'
  const file = { path: 'src/demo/draw.ts', content: ts, line: 1, column: 20 }
  const { host: wired, calls } = host([file], { language: 'typescript', line: 0, character: 20 })
  await wired.openIntroduceParameterObject()
  const model = wired.chooserState.value
  assert.equal(model.title, '引入形参对象')
  assert.deepEqual(model.panels.map(panel => panel.title), ['要提取形参的方法', '形参类', '要提取的形参'])
  assert.deepEqual(model.panels[2].rows.map(row => row.id), ['width', 'height', 'pad'])
  assert.deepEqual(model.checks, [], 'supportsDelegate(typescript) 为假 ⇒ 这一格根本不渲染，不是灰着')
  wired.toggleChooserRow(2, 0)
  wired.toggleChooserRow(2, 1)
  await wired.applyChooser()
  assert.deepEqual(calls.map(call => call[0]), ['preview', 'apply'])
  assert.equal(calls[0][1], '引入形参对象')
  assert.match(calls[1][1], /为 draw\(\) 引入了形参类 DrawOptions/, '撤销栈那一行用 parameterObjectCommandName')
})

test('安全删除：有字面用法才弹三选一，选「仍然删除」才走宿主删档那条链', async () => {
  const widget = { path: 'src/demo/Widget.java', content: 'class Widget {\n}\n// 提到 Widget 的注释\n', line: 1, column: 8 }
  const { host: wired, calls } = host([widget], { language: 'java' })
  await wired.openSafeDelete(widget)
  const state = wired.safeDeleteState.value
  assert.ok(state, '注释里有字面用法时必须弹三选一（不能静默删）')
  assert.equal(state.prompt.title, '检测到用法')
  assert.equal(state.prompt.lead, '发现以下问题：')
  assert.deepEqual(state.prompt.choices.map(choice => choice.id), ['viewUsages', 'deleteAnyway', 'cancel'])
  assert.deepEqual(state.prompt.choices.filter(choice => choice.primary).map(choice => choice.id), ['viewUsages'],
    '默认项是「查看用法」（UnsafeUsagesDialog.java:41-47）')
  assert.ok(state.prompt.details.length, '清单里得有一条具体的位置')
  wired.safeDeleteChoose('deleteAnyway')
  assert.equal(wired.safeDeleteState.value, null)
  assert.deepEqual(calls, [['delete', 'src/demo/Widget.java']])
})

test('安全删除：没有引用也没有字面出现时不弹框，直接交宿主删', async () => {
  const clean = { path: 'src/demo/Clean.java', content: 'class Clean {\n  void go() {}\n}\n', line: 1, column: 8 }
  const { host: wired, calls } = host([clean], { language: 'java' })
  await wired.openSafeDelete(clean)
  assert.equal(wired.safeDeleteState.value, null, '一笔用法都没有 ⇒ 上游也是直接删')
  assert.deepEqual(calls, [['delete', 'src/demo/Clean.java']])
})
