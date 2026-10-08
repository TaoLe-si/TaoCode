// 多文件**合成**差异与逐文件导航的判据（上游 `CombinedDiffViewer`，
// `platform/diff-impl/src/com/intellij/diff/tools/combined/`）。
//
// 上游那张窗口把多个文件的差异块叠在一个滚动面里（`CombinedDiffBlocksPanel` 按 `BlockOrder` 排块），
// 导航分两档：块内（`canGoNextDiff`/`goNextDiff`，`CombinedDiffViewer.kt:314-341`）与块间
// （`canGoNextBlock`/`goNextBlock`，`:343-362`，动作 id 复用 `Diff.NextChange`/`Diff.PrevChange`，
// `CombinedDiffActions.kt:29-82`，键位 `$default.xml:609-614` = Alt+Shift+Left/Right）。
//
// 本仓落成"当前看哪个文件 + 该文件内的差异导航"两层：
//   ① 纯逻辑 `src/diffCombined.ts`：文件表、当前位置、两层边界（两端都不绕圈）、整份增删合计；
//   ② 取数 `src/compareDiffHost.ts`：并行取每份行表 + 补丁，取不到的**跳过**；
//   ③ 视图：`DiffView.vue` 的 `files` prop 进入合成档（多一组块间导航），
//      `CombinedDiffDialog.vue` 是面板那一档的挂载点。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import {
  activeCombinedFile, canGoNextFile, canGoPrevFile, combinedFiles, combinedStats,
  filePositionLabel, stepFile,
} from '../src/diffCombined.ts'
import { targetSubtitle, targetsForChanges, targetsForCompare } from '../src/compareDiffHost.ts'
import { loadSfc } from './vue-sfc-loader.mjs'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const file = (path, rows, unified = '') => ({ path, rows, unified })
const change = (path, text = 'x') => file(path, [{ kind: 'change', left: { no: 1, text: 'a' }, right: { no: 1, text } }])
const EQUAL = [{ kind: 'equal', left: { no: 1, text: 'a' }, right: { no: 1, text: 'a' } }]

test('文件表：只留有内容的块（上游"没有差异就不建块"）', () => {
  const list = combinedFiles([change('a.ts'), file('b.ts', []), file('c.ts', [], 'patch text'), file('d.ts', EQUAL)])
  assert.deepEqual(list.map(f => f.path), ['a.ts', 'c.ts', 'd.ts'], '空行表且空补丁的 b.ts 不建块')
  assert.deepEqual(combinedFiles(null), [])
  assert.deepEqual(combinedFiles([]), [])
})

test('块间边界：两端为假、不走回头路（与块内 canGoNext/canGoPrev 同一口径）', () => {
  assert.equal(canGoNextFile(0, 3), true)
  assert.equal(canGoNextFile(2, 3), false, '最后一个块没有下一个')
  assert.equal(canGoPrevFile(0, 3), false, '第一个块没有上一个')
  assert.equal(canGoPrevFile(1, 3), true)
  assert.equal(canGoNextFile(0, 0), false, '没有块时两端都假')
  assert.equal(canGoPrevFile(0, 0), false)
  assert.equal(stepFile(0, 3, true), 1)
  assert.equal(stepFile(2, 3, true), 2, '到底就停住（不绕回 0）')
  assert.equal(stepFile(0, 3, false), 0, '到顶就停住')
  assert.equal(stepFile(1, 3, false), 0)
})

test('当前位置与整份增删合计', () => {
  assert.equal(filePositionLabel(0, 3), '1 / 3', '显示是 1 基')
  assert.equal(filePositionLabel(2, 3), '3 / 3')
  assert.equal(filePositionLabel(0, 0), '0 / 0', '没有块时给 0 / 0')
  assert.equal(filePositionLabel(9, 3), '3 / 3', '越界夹住')
  const stats = combinedStats([change('a.ts'), file('b.ts', [{ kind: 'insert', right: { no: 1, text: 'x' } }, { kind: 'delete', left: { no: 1, text: 'y' } }])])
  assert.deepEqual(stats, { added: 2, removed: 2 }, 'change 算一增一删，insert/delete 各算一个')
  assert.equal(activeCombinedFile(combinedFiles([change('a.ts')]), 0)?.path, 'a.ts')
  assert.equal(activeCombinedFile(combinedFiles([change('a.ts')]), 5), null, '越界给 null')
})

test('取数入参的整形：与分支比较 / 变更列表两处', () => {
  assert.deepEqual(targetsForCompare([{ path: 'a.ts', status: 'M' }], 'main'), [{ path: 'a.ts', base: 'main', status: 'M' }])
  const changes = targetsForChanges([
    { path: 'a.ts', staged: true, indexStatus: 'M', workStatus: ' ' },
    { path: 'b.ts', staged: false, indexStatus: ' ', workStatus: 'M' },
  ])
  assert.deepEqual(changes, [
    { path: 'a.ts', staged: true, status: 'M' },
    { path: 'b.ts', staged: false, status: 'M' },
  ], '已暂存取 indexStatus、工作区取 workStatus（与变更行记号同一口径）')
  assert.equal(targetSubtitle({ path: 'a.ts', staged: true }), '（已暂存）')
  assert.equal(targetSubtitle({ path: 'a.ts', base: 'main' }), '（与 main 的比较）')
  assert.equal(targetSubtitle({ path: 'a.ts' }), '（工作区）')
  assert.equal(targetSubtitle({ path: 'a.ts', subtitle: '自定义' }), '自定义', '给了就用给的')
})

test('DiffView 进入合成档：多一组块间导航、标题取当前文件、单文件档不变', async () => {
  const { component } = loadSfc('src/components/DiffView.vue')
  const files = combinedFiles([change('a.ts', 'first'), change('b.ts', 'second')])
  const html = await renderToString(createSSRApp(component, { path: '', rows: [], unified: '', files }))
  assert.ok(html.includes('文件间导航'), '合成档多出块间导航这一组')
  assert.ok(html.includes('a.ts'), '标题取当前选中文件')
  assert.ok(html.includes('1 / 2'), '位置读数')
  assert.ok(!html.includes('second'), '只显示当前文件的差异')
  // 单文件档（不给 files）：块间导航整组不出现。
  const single = await renderToString(createSSRApp(component, { path: 'x.ts', rows: change('x.ts').rows, unified: '' }))
  assert.ok(!single.includes('文件间导航'), '单文件视图一字未改')
  assert.ok(single.includes('x.ts'))
})

test('接线：DiffView 有 files prop 与两档导航；面板有「全部差异…」入口与对话框', () => {
  const view = read('src/components/DiffView.vue')
  assert.match(view, /files\?: CombinedDiffFile\[\]/, 'files prop')
  assert.match(view, /import \{[^}]*canGoNextFile[^}]*\} from '\.\.\/diffCombined'/, '块间判据走纯模块')
  assert.match(view, /@keydown\.alt\.shift\.left\.exact\.prevent="stepFileBlock\(false\)"/, 'Alt+Shift+Left 上一个文件（$default.xml:609-611）')
  assert.match(view, /@keydown\.alt\.shift\.right\.exact\.prevent="stepFileBlock\(true\)"/, 'Alt+Shift+Right 下一个文件（$default.xml:612-614）')
  assert.match(view, /<div v-if="inCombined" class="diff-nav diff-file-nav"/, '块间导航那一组只在合成档出现')
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /targetsForCompare\(compared\.value, compareTo\.value\)/, '与分支比较那一档的入口')
  assert.match(panel, /<CombinedDiffDialog v-if="combinedTargets\.length"/, '对话框挂载点')
  const dialog = read('src/components/CombinedDiffDialog.vue')
  assert.match(dialog, /loadCombinedFiles\(targets, props\.context \?\? 0\)/, '对话框走取数模块')
  assert.match(dialog, /:files="files"/, '把合成文件表交给 DiffView')
})
