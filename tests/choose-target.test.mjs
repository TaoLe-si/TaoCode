// 「选一个目标」的弹层 —— IDEA 那几个 goto 动作在多目标时共用的那个 chooser：
//   · 「转到声明」= Choose Declaration（`GotoDeclarationOnlyHandler2.kt:60-76`）；
//   · 「转到实现」= Choose Implementation（`GotoTargetHandler.java:140-160`，还带一个钉按钮）；
//   · 「转到类型声明」= Choose Type（`GotoTypeDeclarationHandler2.kt:52-62`）。
//
// 两半都测：① 行模型/过滤/移动/排序/标题是纯函数（src/chooseTarget.ts）；② 接线 —— 一个目标直接跳、
// 多个才弹层、零个按各自动作的规矩提示或静默；少接一条就又回到"取第一个目标、其余永远看不到"的老样子。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseTargetLabel, chooseTargetRows, filterChooseTargets, implementationChooserTitle, implementationsUsageTitle,
         loadTargetContents, moveChooseTarget, NO_IMPLEMENTATIONS_MESSAGE, sortTargetRows, targetRow, typeChooserTitle } from '../src/chooseTarget.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const editor = read('src/components/CodeEditor.vue')
const semantics = read('src/semanticActions.ts')
const popup = read('src/components/TargetChooserPopup.vue')
const app = read('src/App.vue')

const CONTENT = 'package a;\n\npublic class Sample {\n    int counter;\n}\n'

test('一行 = 目标位置上的名字 + 所在文件 + 1 基行列', () => {
  // 主文本取声明点上的标识符（`wordAt`），灰尾是所在文件，右列是 `行:列`。
  const row = targetRow({ path: 'src/Sample.java', line: 2, character: 13 }, CONTENT)
  assert.equal(row.name, 'Sample')
  assert.equal(row.container, 'src/Sample.java')
  assert.equal(row.position, '3:14')
  assert.equal(row.id, 'src/Sample.java:2:13')
})

test('读不到目标文件时退回文件名，灰尾只留目录（不重复文件名）', () => {
  const row = targetRow({ path: 'lib/Foo.java', line: 0, character: 0 }, null)
  assert.equal(row.name, 'Foo.java')
  assert.equal(row.container, 'lib')
  assert.equal(chooseTargetLabel(row), 'Foo.java lib')
})

test('内容里读不出标识符时退到那一行的原文（上游的 text 兜底）', () => {
  const row = targetRow({ path: 'src/Sample.java', line: 4, character: 0 }, CONTENT)
  assert.equal(row.name, '}')
})

test('同一个位置只留一行（LSP 允许同一位置回两次）', () => {
  const target = { path: 'src/Sample.java', line: 2, character: 13 }
  const rows = chooseTargetRows([target, { ...target }], new Map([['src/Sample.java', CONTENT]]))
  assert.equal(rows.length, 1)
})

test('过滤是速度搜索：大小写不敏感、驼峰按词首、空串放行全部', () => {
  const rows = [
    targetRow({ path: 'src/Sample.java', line: 2, character: 13 }, CONTENT),
    targetRow({ path: 'src/helper.java', line: 0, character: 6 }, 'class helperCount {\n    int count;\n}\n'),
  ]
  assert.equal(filterChooseTargets(rows, '').length, 2)
  assert.deepEqual(filterChooseTargets(rows, 'smp').map(row => row.name), ['Sample'], '大小写不敏感的子序列')
  assert.deepEqual(filterChooseTargets(rows, 'hc').map(row => row.name), ['helperCount'], '驼峰缩写')
  assert.deepEqual(filterChooseTargets(rows, 'HS').map(row => row.name), ['helperCount'], '大写字母按词首命中')
  assert.deepEqual(filterChooseTargets(rows, 'zzz'), [])
})

test('↑↓ 到两端就停住，不回绕', () => {
  assert.equal(moveChooseTarget(3, 0, -1), 0)
  assert.equal(moveChooseTarget(3, 2, 1), 2)
  assert.equal(moveChooseTarget(3, 1, 1), 2)
  assert.equal(moveChooseTarget(0, -1, 1), -1)
})

test('行内容：打开中的缓冲优先，其次问磁盘，读不到留空', async () => {
  const targets = [{ path: 'a.java', line: 0, character: 0 }, { path: 'b.java', line: 0, character: 0 }, { path: 'a.java', line: 3, character: 0 }]
  const asked = []
  const contents = await loadTargetContents(targets,
    path => (path === 'a.java' ? 'open buffer' : null),
    async path => { asked.push(path); if (path === 'c.java') throw new Error('unreadable'); return 'from disk' })
  assert.deepEqual([...contents.keys()], ['a.java', 'b.java'], '同一个文件只问一次')
  assert.equal(contents.get('a.java'), 'open buffer', '有打开的缓冲就不问磁盘')
  assert.equal(contents.get('b.java'), 'from disk')
  assert.deepEqual(asked, ['b.java'])
})

test('「选择实现」的三条分支：零个提示、一个直跳、多个弹层（上游 goto 动作的形状）', () => {
  // 零个：实现那条给错误提示（`goto.implementation.notFound`），类型声明那条静默返回。
  assert.match(semantics, /if \(!refs\.length\) \{[\s\S]{0,80}?if \(payload\.kind === 'implementation'\) notify\(NO_IMPLEMENTATIONS_MESSAGE, true\)/,
    '一个实现都没找到时只有实现那条提示')
  assert.equal(NO_IMPLEMENTATIONS_MESSAGE, '没有找到实现。')
  // 一个：直接跳（把光标落在目标列上）。
  assert.match(semantics, /if \(refs\.length === 1\) \{ void revealLocation\(\{ path: refs\[0\]!\.path, line: refs\[0\]!\.line, column: refs\[0\]!\.character \+ 1 \}\); return \}/,
    '单个目标直接跳')
  // 多个：开弹层，标题按动作取（实现带名字与计数，类型固定）。
  assert.match(semantics, /title: payload\.kind === 'implementation' \? implementationChooserTitle\(symbol, refs\.length\) : typeChooserTitle\(\)/)
  assert.equal(implementationChooserTitle('run', 3), '选择 run 的实现（找到 3 个）')
  assert.equal(implementationChooserTitle('', 2), '选择实现（找到 2 个）', '取不到名字时不硬塞空名字')
  assert.equal(typeChooserTitle(), '选择类型')
  // 行要排序（上游 GotoTargetHandler.shouldSortTargets），「选择声明」那条不排。
  const rows = [
    { id: 'b', path: 'b.java', line: 0, character: 0, name: 'beta', container: 'b.java', position: '1:1' },
    { id: 'a', path: 'a.java', line: 0, character: 0, name: 'alpha', container: 'a.java', position: '1:1' },
  ]
  assert.deepEqual(sortTargetRows(rows).map(row => row.name), ['alpha', 'beta'], '按 名字/容器/位置 排序')
  assert.deepEqual(rows.map(row => row.name), ['beta', 'alpha'], '不改原数组顺序（声明那条仍在用）')
})

test('钉按钮：只有实现那条有，点它把这批地点放进引用面板', () => {
  // 上游 `GotoTargetHandler.java:238-246` 的 setCouldPin 只在实现那条挂着。
  assert.match(semantics, /pinnable: payload\.kind === 'implementation',/,
    '类型声明的弹层不该有钉（上游 GotoTypeDeclarationHandler2 没挂 setCouldPin）')
  assert.match(semantics, /function pinTargetChooser\(\) \{[\s\S]{0,400}?startReferences\(chooser\.usageTitle, chooser\.usageTitle\)[\s\S]{0,200}?finishReferences\(search, chooser\.refs\)[\s\S]{0,80}?showOutput\('references'\)/,
    '钉 = FindUtil.showInUsageView 的等价物：把这批地点填进引用面板并切过去')
  assert.equal(implementationsUsageTitle('run'), 'run 的实现')
  // 组件：pinnable 才画钉按钮，点它 emit('pin')。
  assert.match(popup, /<button v-if="pinnable" type="button" class="choose-target-pin" title="在查找窗口中打开结果"[^>]*@click="emit\('pin'\)"/)
  // App：三个动作的标题由调用方给，弹层本身不写死文案。
  assert.match(popup, /defineProps<\{ title: string; rows: ChooseTargetRow\[\]; x\?: number; y\?: number; pinnable\?: boolean \}>\(\)/)
  assert.match(app, /<TargetChooserPopup :title="targetChooser\.title"[^>]*@pick="pickTarget\(\$event\)" @close="closeTargetChooser\(\)" @pin="pinTargetChooser\(\)"/)
  assert.match(editor, /title="选择声明"/, '「选择声明」的标题由编辑器那条路给')
})

test('单个目标直接跳，多个才开弹层（上游的两条分支）', () => {
  assert.match(editor, /if \(targets\.length > 1\) \{ await openChooseTarget\(targets, pos\); return \}/,
    '多目标必须走弹层，不能只取第一个')
  assert.match(editor, /const target = targets\[0\]!\s*\n\s*emit\('reveal', \{ path: target\.path, line: target\.line, column: target\.character \+ 1 \}\)/,
    '单目标保持直接跳，并把光标落在声明列上')
})

test('弹层的每一行都带上位置，挑选后按行列跳转', () => {
  assert.match(editor, /function pickChooseTarget\(row: ChooseTargetRow\) \{\s*\n\s*chooseTarget\.value = null\s*\n\s*emit\('reveal', \{ path: row\.path, line: row\.line, column: row\.character \+ 1 \}\)/,
    '选择的结果必须回到 reveal 通道（导航历史/最近位置都挂在它上面）')
  assert.match(semantics, /function pickTarget\(row: ChooseTargetRow\) \{\s*\n\s*targetChooser\.value = null\s*\n\s*void revealLocation\(\{ path: row\.path, line: row\.line, column: row\.character \+ 1 \}\)/,
    '实现/类型那条同样按行列跳（同一套导航通道）')
})
