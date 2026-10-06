// Git 日志窗口自己的「视图选项」齿轮（上游 `Vcs.Log.PresentationSettings`，日志工具条右角）。
//
// 上游成员与逐条判据写在 `src/vcsLogPresentation.ts` 的文件头（含"为什么这一条没接"）。
// 这里盯三件事：
//   1) 模型的形状（两个真能接住的行 + `列` 是子组 + 每条都真的翻状态）；
//   2) 勾掉一列**真的**不画：宽度不算、行里不渲染（`VcsLogTable.vue` 与 `VcsLogColumns.vue` 同一份判据）；
//   3) 不做的四条留在登记里，而不是在代码里留一个点了没反应的勾选项。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { LOG_COLUMNS, fitColumns, hiddenColumns, toggleColumn, visibleColumns } from '../src/vcsLogColumns.ts'
import { speedSearchMatches } from '../src/speedSearch.ts'
import { collapseLinearBranches, collapsedLinearHashes, canCollapseLinearBranches, buildLogGraph } from '../src/vcsLogGraph.ts'
import {
  LOG_ALIGN_LABELS_TITLE, LOG_CHANGES_FROM_PARENTS_TITLE, LOG_COLUMNS_TITLE, LOG_COLUMN_TITLES,
  LOG_COMPACT_REFERENCES_TITLE, LOG_LONG_EDGES_TITLE, LOG_PRESENTATION_DEFAULTS, LOG_PRESENTATION_GAPS,
  LOG_TAG_NAMES_TITLE, LOG_VIEW_OPTIONS_TITLE, LOG_PREVIEW_BOTTOM_TITLE, LOG_PREVIEW_RIGHT_TITLE,
  logCommitTooltip, logPresentationModel, logRefsToShow, logSpeedSearchColumns,
} from '../src/vcsLogPresentation.ts'
import { loadSfc } from './vue-sfc-loader.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const { component: VcsLogTable } = loadSfc('src/components/VcsLogTable.vue')

test('列的显示/隐藏：勾掉的列不画，坏存档不认', () => {
  assert.deepEqual(hiddenColumns(['author', '不存在', 42, 'author']), ['author'], '只认四列里的名字，且去重')
  assert.deepEqual(hiddenColumns('nope'), [], '坏输入 = 默认全显示')
  assert.deepEqual(toggleColumn([], 'date'), ['date'])
  assert.deepEqual(toggleColumn(['date'], 'date'), [], '再勾回来')
  assert.deepEqual(visibleColumns(['hash', 'commit', 'date', 'author'], ['date']), ['hash', 'commit', 'author'],
    '顺序是用户排的，勾掉的只是被摘出去')
})

test('勾掉的列不占宽度，提交列把余量吃掉', () => {
  const rows = [{ author: 'aaaaaaaaaa', date: '2026-01-01', shortHash: 'abcdef1' }]
  const measure = () => 40
  const all = fitColumns(rows, measure, 1000, 6, {})
  const fewer = fitColumns(rows, measure, 1000, 6, {}, ['author', 'hash'])
  assert.equal(fewer.author, 0, '勾掉的列宽度必须是 0')
  assert.equal(fewer.hash, 0)
  assert.equal(fewer.date, all.date, '没勾掉的那一列不受影响')
  assert.ok(fewer.commit > all.commit, '省下来的宽度给提交列')
  assert.equal(all.author, 50, '量出来的宽度保底 50')
})

test('模型：视图选项的每一行，`列` 与 `差异预览位置` 是子组，每条都真的翻状态', () => {
  const calls = []
  const actions = {
    setShowTagNames: value => calls.push(['tag', value]),
    toggleColumn: column => calls.push(['column', column]),
    setCompactReferences: value => calls.push(['compact', value]),
    setShowLongEdges: value => calls.push(['edges', value]),
    setAlignLabels: value => calls.push(['labels', value]),
    setDiffPreviewAtBottom: value => calls.push(['preview', value]),
    setShowChangesFromParents: value => calls.push(['parents', value]),
  }
  const state = { showTagNames: true, hidden: ['date'], compactReferences: true, showLongEdges: true,
    alignLabels: false, diffPreviewAtBottom: true, showChangesFromParents: false }
  const model = logPresentationModel(state, actions)
  assert.deepEqual(model.map(row => row.id), [
    'vcs.log.compactReferences', 'vcs.log.showTagNames', 'vcs.log.longEdges', 'vcs.log.alignLabels',
    'vcs.log.columns', 'vcs.log.changesFromParents', 'vcs.log.diffPreviewLocation',
  ], '顺序照上游 PresentationSettings（xml:253-266）+ 齿轮弹层尾部那两条（xml:386-392）')
  assert.equal(model[0].title, LOG_COMPACT_REFERENCES_TITLE, 'action.Vcs.Log.CompactReferencesView.text')
  assert.equal(model[0].checked, true, '上游缺省就是紧凑（VcsLogApplicationSettings.kt:106-107）')
  model[0].run?.()
  assert.deepEqual(calls[0], ['compact', false], '点一下要把状态取反交回宿主')
  assert.equal(model[1].title, LOG_TAG_NAMES_TITLE, 'action.Vcs.Log.ShowTagNames.text = 标签名称')
  model[1].run?.()
  assert.deepEqual(calls[1], ['tag', false])
  assert.equal(model[2].title, LOG_LONG_EDGES_TITLE, 'action.Vcs.Log.ShowLongEdges.text = 长边')
  model[2].run?.()
  assert.deepEqual(calls[2], ['edges', false])
  assert.equal(model[3].title, LOG_ALIGN_LABELS_TITLE, 'action.Vcs.Log.AlignLabels.text = 左侧的引用')
  assert.equal(model[3].checked, false, '上游缺省关（VcsLogApplicationSettings.kt:113-114）')
  model[3].run?.()
  assert.deepEqual(calls[3], ['labels', true])

  const columns = model[4]
  assert.equal(columns.title, LOG_COLUMNS_TITLE, 'group.Vcs.Log.ToggleColumns.text = 列')
  assert.equal(columns.group, true)
  assert.deepEqual(columns.children.map(row => row.id), LOG_COLUMNS.map(column => `vcs.log.column.${column}`))
  assert.deepEqual(columns.children.map(row => row.title), ['提交', '作者', '日期', '哈希'])
  assert.deepEqual(columns.children.map(row => row.checked), [true, true, false, true], '勾掉的日期列没有勾')
  columns.children[2].run?.()
  assert.deepEqual(calls[4], ['column', 'date'])
  assert.equal(LOG_COLUMN_TITLES.commit, '提交', '列名与表头同一份文案（VcsLogColumns 读它）')

  assert.equal(model[5].title, LOG_CHANGES_FROM_PARENTS_TITLE, 'action.Vcs.Log.ShowChangesFromParents.text')
  model[5].run?.()
  assert.deepEqual(calls[5], ['parents', true])

  const location = model[6]
  assert.equal(location.group, true)
  assert.deepEqual(location.children.map(row => row.title), [LOG_PREVIEW_BOTTOM_TITLE, LOG_PREVIEW_RIGHT_TITLE],
    '两档文案 = MoveDiffPreviewToBottom/Right.text（底部 / 右侧）')
  assert.deepEqual(location.children.map(row => row.checked), [true, false], '缺省在下方（isDiffPreviewVerticalSplit = true）')
  location.children[1].run?.()
  assert.deepEqual(calls[6], ['preview', false], '点「右侧」= 纵向分栏关掉')
})

test('不做的三条留在登记里，接住的六条从登记里移出且真的出现在行里', () => {
  assert.deepEqual(LOG_PRESENTATION_GAPS.map(gap => gap.id), [
    'Vcs.Log.ShowRootsColumnAction', 'Vcs.Log.PreferCommitDate', 'Vcs.Log.HighlightersActionGroup',
  ], '原写六条：CompactReferencesView / ShowLongEdges / AlignLabels 三条本批接住了（文件头逐条留痕）')
  for (const gap of LOG_PRESENTATION_GAPS) assert.ok(gap.why.length > 8, `${gap.id} 要写清为什么不接`)
  const actions = { setShowTagNames: () => {}, toggleColumn: () => {}, setCompactReferences: () => {},
    setShowLongEdges: () => {}, setAlignLabels: () => {}, setDiffPreviewAtBottom: () => {}, setShowChangesFromParents: () => {} }
  const model = logPresentationModel({ showTagNames: true, hidden: [], ...LOG_PRESENTATION_DEFAULTS }, actions)
  const ids = JSON.stringify(model)
  for (const gap of LOG_PRESENTATION_GAPS) assert.ok(!ids.includes(gap.title), `${gap.title} 不该出现在可点的行里`)
  for (const title of [LOG_COMPACT_REFERENCES_TITLE, LOG_LONG_EDGES_TITLE, LOG_ALIGN_LABELS_TITLE,
    LOG_CHANGES_FROM_PARENTS_TITLE, LOG_PREVIEW_BOTTOM_TITLE, LOG_PREVIEW_RIGHT_TITLE]) {
    assert.ok(ids.includes(title), `${title} 要真的能点`)
  }
  const todo = read('docs/source-todo.md')
  assert.match(todo.split('## 11.')[1] ?? '', /提交时间戳/, '逐条不做项要登记在 docs/source-todo.md §11')
})

test('上游缺省档逐条对得上（紧凑开 / 长边开 / 左侧引用关 / 预览在下方 / 对父项更改关）', () => {
  assert.deepEqual({ ...LOG_PRESENTATION_DEFAULTS }, {
    compactReferences: true, showLongEdges: true, alignLabels: false, diffPreviewAtBottom: true,
    showChangesFromParents: false,
  })
})

test('引用画哪几个：紧凑档只给第一个，标签名称档不给 tag', () => {
  const refs = [{ name: 'main', type: 'local' }, { name: 'v1.0', type: 'tag' }, { name: 'origin/main', type: 'remote' }]
  assert.deepEqual(logRefsToShow(refs, { showTagNames: false, compact: false }), [refs[0], refs[2]], '关标签 = 摘掉 tag')
  assert.deepEqual(logRefsToShow(refs, { showTagNames: true, compact: true }), [refs[0]],
    '紧凑 = 仅在表中显示提交的第一个引用（bundle description 逐字）')
  assert.deepEqual(logRefsToShow(refs, { showTagNames: false, compact: true }), [refs[0]], '两档叠加时先过滤再取第一个')
  assert.deepEqual(logRefsToShow([], { showTagNames: true, compact: true }), [], '没有引用不编一个')
})

test('速度搜索只比可见的元数据列（VcsLogSpeedSearch.getColumnsForSpeedSearch）', () => {
  const row = { subject: '修复折叠', author: 'Tao', date: '2026-09-29 10:00', hash: 'a'.repeat(40), shortHash: 'aaaaaaaa' }
  assert.deepEqual(logSpeedSearchColumns(row, []), ['修复折叠', 'Tao', '2026-09-29 10:00', 'aaaaaaaa'])
  assert.deepEqual(logSpeedSearchColumns(row, ['date', 'hash']), ['修复折叠', 'Tao'], '勾掉的列不参与匹配')
  assert.ok(speedSearchMatches('ta', logSpeedSearchColumns(row, [])[1]), '子序列命中作者')
  assert.ok(!speedSearchMatches('zzz', logSpeedSearchColumns(row, []).join('')), '不命中的 pattern 不假装命中')
})

test('行 tooltip 的三行内容 = 主题 / 作者+日期 / 哈希（完整哈希在有时给完整的）', () => {
  const text = logCommitTooltip({ subject: '主题', author: 'Tao', date: '2026-09-29 10:00', hash: 'aaaaaaaa', fullHash: 'b'.repeat(40) })
  assert.deepEqual(text.split('\n'), ['主题', 'Tao  2026-09-29 10:00', 'b'.repeat(40)])
  assert.equal(logCommitTooltip({ subject: 's', author: 'a', date: 'd', hash: 'short' }).split('\n')[2], 'short')
})

test('表格真的不画勾掉的列（SSR 渲真组件）', async () => {
  const commit = {
    hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Tao', date: '2026-09-29T10:00:00+08:00',
    subject: '提交主题', parents: [], refs: [{ name: 'main', type: 'local' }],
  }
  const html = await renderToString(createSSRApp({
    render: () => h(VcsLogTable, { commits: [commit], selected: commit.hash, root: 'D:/p', hidden: ['date', 'hash'] }),
  }))
  // 原写法用 `!html.includes(shortHash)` 判"这一列没画"：本批把 tooltip 挂到行上以后，
  // 属性里的完整哈希（40 个 a）里就含着那 7 个 a ⇒ 那个判据实际上在判"整段 HTML 里有没有这串字符"。
  // 这里改成只看**元素文本**（`>` 之后、下一个标签之前），断言的是列单元格，强度不降。
  const text = html.replace(/<[a-zA-Z][^>]*>/g, '|')
  assert.ok(html.includes('提交主题'), '提交列照画')
  assert.ok(html.includes('Tao'), '作者列照画')
  assert.ok(!html.includes('class="hash"'), '勾掉的哈希列连单元格都不出现')
  assert.ok(!text.includes('aaaaaaa'), '勾掉的哈希列不画（元素文本里不许出现短哈希）')
  assert.ok(!html.includes('class="date"'), '勾掉的日期列连单元格都不出现')
  assert.ok(!/>2026-09-29/.test(html), '勾掉的日期列不画（表格自己格式化日期）')
})

test('tooltip 挂在行上、紧凑档只画第一个引用、非紧凑全画（SSR 渲真组件）', async () => {
  const commit = {
    hash: 'c'.repeat(40), shortHash: 'ccccccc', author: 'Tao', date: '2026-09-29T10:00:00+08:00',
    subject: '主题一', parents: [], refs: [{ name: 'main', type: 'local' }, { name: 'beta', type: 'local' }],
  }
  const render = props => renderToString(createSSRApp({
    render: () => h(VcsLogTable, { commits: [commit], selected: commit.hash, root: 'D:/p', ...props }),
  }))
  const compact = await render({ compactReferences: true })
  assert.ok(compact.includes('main'), '紧凑档至少画第一个引用')
  assert.ok(!compact.includes('beta'), '紧凑 = 只给第一个引用')
  const full = await render({ compactReferences: false })
  assert.ok(full.includes('main') && full.includes('beta'), '非紧凑 = 一排引用都画出来')
  const row = compact.match(/<div[^>]*class="log-row[^"]*"[^>]*>/)?.[0] ?? ''
  assert.ok(row.includes('title='), '行上有 tooltip（`Vcs.Log.ShowTooltip` 走的就是同一个 tooltip）')
  assert.ok(row.includes('主题一'), 'tooltip 里带主题')
})

test('长边：关掉时长链不再穿过中间行，只在起点留一段竖线', () => {
  // c1 -> c3（c2 是另一条线上的），c3 在第三行 ⇒ 跨行的长边。
  const list = [
    { hash: 'c1', shortHash: 'c1', author: 'A', date: '2026-01-01T00:00:00Z', subject: '一', parents: ['c3', 'c2'], refs: [] },
    { hash: 'c2', shortHash: 'c2', author: 'A', date: '2026-01-01T00:00:00Z', subject: '二', parents: ['c3'], refs: [] },
    { hash: 'c3', shortHash: 'c3', author: 'A', date: '2026-01-01T00:00:00Z', subject: '三', parents: [], refs: [] },
  ]
  const shown = buildLogGraph(list, { showLongEdges: true })
  const hidden = buildLogGraph(list, { showLongEdges: false })
  assert.deepEqual(shown.rows.map(row => row.pass.length), [0, 1, 0], '开档：中间那一行有一条穿过的线')
  assert.equal(shown.rows[0].down.length, 2)
  assert.equal(hidden.rows[0].pass.length, 0, '关档：不再有穿过中间行的线')
  assert.equal(hidden.rows[1].pass.length, 0)
  assert.equal(hidden.rows[0].stub.length, 1, '关档：那条长边在起点只留一段竖线（另一条是相邻边，仍走 down）')
  assert.equal(hidden.rows[0].down.length, 1, '相邻的边不受影响')
  assert.equal(hidden.rows[2].up.length, 1, '关档：目标行只接相邻那一条，跨行的不再从顶上接')
  assert.equal(shown.rows[2].up.length, 2, '开档：目标行照常接两条')
  // 缺省 = 开（与上游 SHOW_LONG_EDGES 的缺省一致）。
  assert.deepEqual(buildLogGraph(list).rows.map(row => row.pass.length), shown.rows.map(row => row.pass.length))
})

test('收起线性分支：只隐藏线性链的中间行，展开逐字回到原列表', () => {
  const chain = [
    { hash: 'h1', shortHash: 'h1', author: 'A', date: '2026-01-01T00:00:00Z', subject: '一', parents: ['h2'], refs: [] },
    { hash: 'h2', shortHash: 'h2', author: 'A', date: '2026-01-01T00:00:00Z', subject: '二', parents: ['h3'], refs: [] },
    { hash: 'h3', shortHash: 'h3', author: 'A', date: '2026-01-01T00:00:00Z', subject: '三', parents: ['h4'], refs: [] },
    { hash: 'h4', shortHash: 'h4', author: 'A', date: '2026-01-01T00:00:00Z', subject: '四', parents: [], refs: [] },
  ]
  assert.deepEqual([...collapsedLinearHashes(chain)], ['h2', 'h3'], '首尾留、中间藏（上游 hideNode 的中间节点）')
  assert.equal(canCollapseLinearBranches(chain), true)
  assert.deepEqual(collapseLinearBranches(chain, true).map(c => c.hash), ['h1', 'h4'])
  assert.deepEqual(collapseLinearBranches(chain, false).map(c => c.hash), ['h1', 'h2', 'h3', 'h4'], '展开 = 逐字原样')
  const merged = [
    { hash: 'm1', shortHash: 'm1', author: 'A', date: '2026-01-01T00:00:00Z', subject: '合并', parents: ['p1', 'p2'], refs: [] },
    { hash: 'p1', shortHash: 'p1', author: 'A', date: '2026-01-01T00:00:00Z', subject: '一父', parents: [], refs: [] },
    { hash: 'p2', shortHash: 'p2', author: 'A', date: '2026-01-01T00:00:00Z', subject: '二父', parents: [], refs: [] },
  ]
  assert.deepEqual(collapsedLinearHashes(merged), new Set(), '两个父提交 ⇒ 不是线性段，一行都不藏')
  assert.equal(canCollapseLinearBranches(merged), false, '没得收 = 上游那条行也不出现')
  assert.deepEqual(collapseLinearBranches(merged, true).map(c => c.hash), ['m1', 'p1', 'p2'])
})

test('接线：齿轮那六条真的接到表格/变更面板/分栏上，收起接到图选项上', () => {
  const table = read('src/components/VcsLogTable.vue')
  assert.match(table, /buildLogGraph\(visible\.value, \{ showLongEdges: props\.showLongEdges !== false \}\)/)
  assert.match(table, /collapseLinearBranches\(props\.commits, props\.collapsed === true\)/)
  assert.match(table, /logRefsToShow\(commit\.refs \?\? \[\]/, '引用画哪几个由模型判')
  assert.match(table, /:title="logCommitTooltip\(/, 'tooltip 挂在行上')
  assert.match(table, /<SpeedSearchBar :open="searchOpen"/, '速度搜索框（复用书签面板同一件）')
  assert.match(table, /speedSearchMatches\(value, text\)/, '匹配规则复用 src/speedSearch 那一处真源')
  const log = read('src/components/VcsLog.vue')
  assert.match(log, /setViewPref\('compactReferences', value\)/)
  assert.match(log, /setViewPref\('showChangesFromParents', value\)/)
  assert.match(log, /:vertical="viewPrefs\.diffPreviewAtBottom"/, '差异预览位置 = 外层分栏的方向')
  assert.match(log, /:from-parents="viewPrefs\.showChangesFromParents"/)
  assert.match(log, /:collapsed="collapsed"[\s\S]*:can-collapse="canCollapse"/, '折叠状态接到过滤器')
  const changes = read('src/components/VcsLogChanges.vue')
  assert.match(changes, /slice\(0, props\.fromParents \? undefined : 1\)/, '关档只看第一个父提交')
  const filters = read('src/components/VcsLogFilters.vue')
  assert.match(filters, /@set-collapsed="emit\('setCollapsed', \$event\)"/)
  const options = read('src/components/VcsLogGraphOptions.vue')
  assert.match(options, /setCollapsed: value => emit\('setCollapsed', value\)/)
  assert.match(options, /v-else-if="row\.command"/, '收起/展开是命令档，不是勾选档')
  const graph = read('src/vcsLogGraph.ts')
  assert.match(graph, /CollapsedActionManager[\s\S]{0,200}COLLAPSE_ALL:214-241/, '折叠的等价物写到上游行号级')
})

test('接线：齿轮在日志自己的工具条上，列隐藏按仓库根存，标签名称走项目设置', () => {
  const log = read('src/components/VcsLog.vue')
  assert.match(log, /<details class="filter presentation"/, '齿轮挂在日志工具条（上游 Vcs.Log.PresentationSettings 的位置）')
  assert.match(log, /logPresentationModel\(/, '菜单来自模型模块，不在组件里另写一份')
  assert.match(log, /columns\.hidden`\)/, '列隐藏按仓库根持久化（与列宽/顺序同一个家族）')
  assert.match(log, /emit\('setTagNames', value\)/, '标签名称写回宿主（项目设置）')
  const view = read('src/components/ToolWindowView.vue')
  assert.match(view, /@set-tag-names="ctx\.onSetVcsLogTagNames\?\.\(\$event\)"/)
  const context = read('src/toolViewContext.ts')
  assert.match(context, /onSetVcsLogTagNames: \(value: boolean\) => \{ void saveVcsLog\(/, '走既有的 project.settings.update 通路')
  assert.match(read('src/App.vue'), /saveSettingsPatch, saveVcsLog, gitCompareWith/, '宿主把写回函数注入 ctx')
})
