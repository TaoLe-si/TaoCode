// 三方合并编辑器的判据 —— 上游 `MergeThreesideViewer` / `MergeRequest` / `MergeResult` / `TextMergeChange`，
// 用本仓架构还原（输入 = git 写进工作区文件的冲突标记，行模型在 `src/mergeEditor.ts`，
// 视图在 `src/components/MergeEditor.vue`）。
//
// 上游形状（逐条核过，注释里带坐标）：
//   · `ThreesideMergeRequest`（`platform/diff-api/src/com/intellij/diff/merge/ThreesideMergeRequest.java:13-27`）：
//     `getContents()` 三份（left-middle-right = local-base-server）、`getOutputContent()`、`getContentTitles()`；
//   · `TextMergeRequest`（同目录 `:8-18`）：三份是 `DocumentContent`；
//   · `MergeResult`（`platform/diff-api/src/com/intellij/diff/merge/MergeResult.java`）四档；
//   · `MergeThreesideViewer.handleAcceptSide`（`platform/diff-impl/src/com/intellij/diff/merge/MergeThreesideViewer.java:333-351`）：
//     接受一侧 = 全部改动取那一侧；逐条是 `TextMergeChange` 的粒度；
//     按钮文案 `DiffBundle.properties:250-251`（只有左/右两条）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ACCEPT_BOTH_NOTE, ACCEPT_BOTH_TEXT, AUTO_RESOLVABLE_NOTE, CONFLICT_BLOCK_LABEL, MERGE_TITLES, NO_BASE_NOTE,
  acceptAllBlocks, acceptBlock, acceptBoth, blockStatus, buildMergeEditorModel, mergeBlocks, mergePanes, nextBlockIndex, stepBlock,
} from '../src/mergeEditor.ts'
import { parseConflicts } from '../src/mergeConflicts.ts'

// diff3 风格（带 `|||||||` 基线段）：左改第三行、右改第二行 ⇒ 两处都是"一侧没动"，都能自动合。
const DIFF3 = [
  'one',
  '<<<<<<< HEAD',
  'two-mine',
  '||||||| base',
  'two',
  '=======',
  'two',
  '>>>>>>> side',
  'three',
].join('\n')
// 真冲突（两侧都改、改得不一样）：不能自动合。
const REAL = [
  'a',
  '<<<<<<< HEAD',
  'ours',
  '=======',
  'theirs',
  '>>>>>>> side',
  'z',
].join('\n')

test('三份内容从冲突标记派生：左/中/右（上游 getContents 的等价物）', () => {
  const panes = mergePanes(DIFF3)
  assert.deepEqual(panes.left, ['one', 'two-mine', 'three'])
  assert.deepEqual(panes.base, ['one', 'two', 'three'], 'diff3 的基线段进中栏')
  assert.deepEqual(panes.right, ['one', 'two', 'three'])
  // 没有 diff3 基线段时中栏该段留空（不伪造基线）。
  const noBase = mergePanes(REAL)
  assert.deepEqual(noBase.base, ['a', 'z'], '缺基线段 ⇒ 中栏不拿 ours 冒充')
})

test('行模型：未改动区三格相同，冲突块按最长一栏补空、三栏各带自己的行号', () => {
  const model = buildMergeEditorModel(DIFF3)
  assert.equal(model.rows[0].kind, 'equal')
  assert.deepEqual([model.rows[0].left.no, model.rows[0].base.no, model.rows[0].right.no], [1, 1, 1])
  assert.equal(model.rows[0].left.text, 'one')
  // 冲突块那一行：三格都在（diff3 三段都有一行）。
  const conflictRow = model.rows.find(row => row.kind === 'conflict')
  assert.equal(conflictRow.block, 0)
  assert.deepEqual([conflictRow.left.text, conflictRow.base.text, conflictRow.right.text], ['two-mine', 'two', 'two'])
  // 行号是**每一栏自己的**：左栏 2、中栏 2、右栏 2（都从各自栏的首行起数）。
  assert.deepEqual([conflictRow.left.no, conflictRow.base.no, conflictRow.right.no], [2, 2, 2])
  assert.deepEqual(model.lineCounts, { left: 3, base: 3, right: 3 })
  assert.equal(model.rows.at(-1).left.text, 'three')
})

test('真冲突（无基线段）行模型：中栏在冲突块里没有行（补空而不是造内容）', () => {
  const model = buildMergeEditorModel(REAL)
  const conflictRows = model.rows.filter(row => row.kind === 'conflict')
  assert.equal(conflictRows.length, 1)
  assert.equal(conflictRows[0].left.text, 'ours')
  assert.equal(conflictRows[0].right.text, 'theirs')
  assert.equal(conflictRows[0].base, null, '没有基线段 ⇒ 中栏这一格是空的')
  assert.deepEqual(model.panes.base, ['a', 'z'], '中栏就是没有冲突内容的那份')
})

test('块的可自动合判定（MergeConflictModel.hasAutoResolvableConflictedChanges 落到单块）', () => {
  assert.equal(mergeBlocks(DIFF3)[0].resolvable, true, '一侧没动 ⇒ 能自动合')
  assert.equal(mergeBlocks(DIFF3)[0].hasBase, true)
  assert.equal(mergeBlocks(REAL)[0].resolvable, false, '两侧改成不一样的东西 ⇒ 真冲突')
  assert.equal(mergeBlocks(REAL)[0].hasBase, false)
})

test('逐块接受一侧（TextMergeChange 的粒度）与整文件接受一侧（handleAcceptSide）', () => {
  assert.equal(acceptBlock(DIFF3, 0, 'left'), 'one\ntwo-mine\nthree')
  assert.equal(acceptBlock(DIFF3, 0, 'right'), 'one\ntwo\nthree')
  assert.equal(acceptBlock(DIFF3, 9, 'left'), DIFF3, '越界下标不动内容')
  // 整文件：多块一次全取一侧（上游 replaceChanges(getAllChanges(), side, true)）。
  const two = [
    '<<<<<<< HEAD', 'a1', '=======', 'a2', '>>>>>>> side',
    'mid',
    '<<<<<<< HEAD', 'b1', '=======', 'b2', '>>>>>>> side',
  ].join('\n')
  assert.equal(acceptAllBlocks(two, 'left'), 'a1\nmid\nb1')
  assert.equal(acceptAllBlocks(two, 'right'), 'a2\nmid\nb2')
  assert.equal(parseConflicts(acceptAllBlocks(two, 'left')).length, 0, '整文件接受后没有标记了')
})

test('「接受两者」是本仓扩展：先左后右，退化情形不另造内容', () => {
  assert.equal(acceptBoth(REAL, 0), 'a\nours\ntheirs\nz')
  assert.equal(acceptBoth(DIFF3, 0), 'one\ntwo-mine\ntwo\nthree', '中栏不进结果（上游也没有这一档）')
  // 一侧为空（另一侧纯插入）时退化成"接受那一侧"。
  const insert = ['<<<<<<< HEAD', '=======', 'added', '>>>>>>> side'].join('\n')
  assert.equal(acceptBoth(insert, 0), 'added')
  const remove = ['<<<<<<< HEAD', 'removed', '=======', '>>>>>>> side'].join('\n')
  assert.equal(acceptBoth(remove, 0), 'removed')
  assert.match(ACCEPT_BOTH_NOTE, /上游只有接受左侧\/接受右侧/, '扩展要如实标注')
  assert.equal(ACCEPT_BOTH_TEXT, '接受两者')
})

test('导航：块间绕圈、状态文案、接受完一块后下一个该看的块', () => {
  assert.equal(stepBlock(0, -1, true), -1, '没有块')
  assert.equal(stepBlock(3, -1, true), 0)
  assert.equal(stepBlock(3, -1, false), 2)
  assert.equal(stepBlock(3, 2, true), 0, '走完一圈回绕')
  assert.equal(stepBlock(3, 0, false), 2)
  assert.equal(blockStatus(3, 1), '2/3')
  assert.equal(blockStatus(0, 0), '')
  assert.equal(nextBlockIndex(REAL, 0), 0, '接受完最后一块回第一块')
})

test('文案与标题：三栏标题、无基线段说明、可自动合说明、块标头', () => {
  assert.deepEqual(Object.values(MERGE_TITLES), ['您的版本', '基线', '他们的版本'])
  assert.match(NO_BASE_NOTE, /diff3/)
  assert.match(AUTO_RESOLVABLE_NOTE, /自动合并/)
  assert.equal(CONFLICT_BLOCK_LABEL, '冲突')
})

test('MergeEditor.vue 接线：三栏 / 导航 / 三个逐块按钮 / 整文件两个 / 读写走 file.read·file.write', () => {
  const view = readFileSync('src/components/MergeEditor.vue', 'utf8')
  assert.match(view, /buildMergeEditorModel\(content\.value\)/, '行模型来自纯模块')
  assert.match(view, /request<FileFacts>\('file\.read', \{ path: props\.path \}\)/, '内容走现有 file.read 通道')
  assert.match(view, /request\('file\.write', \{ path: props\.path, content: next, expectedVersion: version\.value/, '写回带版本/编码/BOM')
  // 三栏渲染：每一行三个格子（等值行与冲突行各一套）。
  const cells = view.match(/class="merge-cell/g) ?? []
  assert.ok(cells.length >= 6, `三栏每行三个格子（等值 + 冲突两套），实际 ${cells.length}`)
  assert.match(view, /MERGE_TITLES\.left[\s\S]{0,200}MERGE_TITLES\.base[\s\S]{0,200}MERGE_TITLES\.right/, '三个栏标题都渲染')
  assert.match(view, /:title="ACCEPT_LEFT_TEXT" @click="acceptOne\('left'\)"/, '逐块接受左：按钮挂左文案标题与左处理')
  assert.match(view, /:title="ACCEPT_RIGHT_TEXT" @click="acceptOne\('right'\)"/, '逐块接受右：按钮挂右文案标题与右处理')
  assert.match(view, /acceptBothOne\(\)/, '逐块接受两者')
  assert.match(view, /acceptWhole\('left'\)[\s\S]{0,200}acceptWhole\('right'\)/, '整文件接受左/右')
  assert.match(view, /@click="step\(false\)"[\s\S]{0,200}@click="step\(true\)"/, '上下冲突导航')
})

test('SourceControl 接线：冲突行菜单的「合并…」真的打开那张窗口', () => {
  const panel = readFileSync('src/components/SourceControl.vue', 'utf8')
  assert.match(panel, /case 'mergeWindow': return void \(mergeTarget\.value = path\)/, '菜单那一行有分派')
  assert.match(panel, /<MergeEditor :path="mergeTarget" closable @close="mergeTarget = null"/, '窗口在模板里')
  const menu = readFileSync('src/changesMenuActions.ts', 'utf8')
  assert.match(menu, /id: 'mergeWindow', label: '合并…', available: c => Boolean\(c\.conflicted\)/, '冲突行才有这一条')
})

test('「暂存内容…」挂载索引冲突三阶段真内容（RevisionCompareDialog 的 stages 模式）', () => {
  // 上游三方查看器三个编辑器读的就是 stage1/2/3（`ThreesideMergeRequest.getContents()`），
  // 本仓走 `src/revisionContent.ts` 的 `loadMergeStages` + 现有 `git.showCommit` 的 `:<n>:<path>`
  // 说明符（不新增 native 通道）——这条钉住"真内容面板真的被挂出来了"。
  const view = readFileSync('src/components/MergeEditor.vue', 'utf8')
  assert.match(view, /import RevisionCompareDialog from '\.\/RevisionCompareDialog\.vue'/, '按需引面板')
  assert.match(view, /@click="stagesOpen = true">暂存内容…<\/button>/, '工具栏有入口按钮')
  assert.match(view, /<RevisionCompareDialog v-if="stagesOpen" :path="path" stages @close="stagesOpen = false" \/>/, 'stages 模式真的挂出来')
  assert.match(view, /\.merge-editor \{ position: relative;/, '面板绝对定位的锚点')
  const dialog = readFileSync('src/components/RevisionCompareDialog.vue', 'utf8')
  assert.match(dialog, /loadMergeStages\(props\.path\)/, 'stages 模式读的是三阶段真 blob')
})