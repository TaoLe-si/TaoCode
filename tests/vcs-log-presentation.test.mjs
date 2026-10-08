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
  LOG_ALIGN_LABELS_TITLE, LOG_CHANGES_FROM_PARENTS_TITLE, LOG_COLUMNS_TITLE, LOG_COLUMN_TITLES, LOG_DYNAMIC_COLUMNS,
  LOG_COMPACT_REFERENCES_TITLE, LOG_LONG_EDGES_TITLE, LOG_PRESENTATION_DEFAULTS, LOG_PRESENTATION_GAPS,
  LOG_TAG_NAMES_TITLE, LOG_VIEW_OPTIONS_TITLE, LOG_PREVIEW_BOTTOM_TITLE, LOG_PREVIEW_RIGHT_TITLE, LOG_COMMIT_DATE_TITLE,
  LOG_REF_TIERS, LOG_REF_TOOLTIP_LIMIT, compareLogRefs, logCommitTooltip, logPresentationModel, logRefGroups, logRefTier,
  logRefTooltip, logRowCopyText, logRowsCopyText, logSpeedSearchColumns, naturalCompareRefNames,
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

test('模型：视图选项的禁用项与动作状态，`列` 与 `差异预览位置` 是子组', () => {
  const calls = []
  const actions = {
    setShowTagNames: value => calls.push(['tag', value]),
    setPreferCommitDate: value => calls.push(['commitDate', value]),
    toggleColumn: column => calls.push(['column', column]),
    setCompactReferences: value => calls.push(['compact', value]),
    setShowLongEdges: value => calls.push(['edges', value]),
    setAlignLabels: value => calls.push(['labels', value]),
    setDiffPreviewAtBottom: value => calls.push(['preview', value]),
    setShowChangesFromParents: value => calls.push(['parents', value]),
  }
  const state = { showTagNames: true, hidden: ['date'], preferCommitDate: false, compactReferences: true, showLongEdges: true,
    alignLabels: false, diffPreviewAtBottom: true, showChangesFromParents: false }
  const model = logPresentationModel(state, actions)
  assert.deepEqual(model.map(row => row.id), [
    'vcs.log.compactReferences', 'vcs.log.showTagNames', 'vcs.log.longEdges', 'vcs.log.preferCommitDate', 'vcs.log.alignLabels',
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
  assert.equal(model[3].title, LOG_COMMIT_DATE_TITLE, 'action.Vcs.Log.PreferCommitDate.text')
  assert.equal(model[3].checked, false, '上游缺省关（VcsLogApplicationSettings.kt:124-125）')
  assert.equal(model[3].disabled, true, '隐藏日期列时与 PreferCommitDateAction.update 一致')
  assert.equal(model[4].title, LOG_ALIGN_LABELS_TITLE, 'action.Vcs.Log.AlignLabels.text = 左侧的引用')
  assert.equal(model[4].checked, false, '上游缺省关（VcsLogApplicationSettings.kt:113-114）')
  model[4].run?.()
  assert.deepEqual(calls[3], ['labels', true])

  const columns = model[5]
  assert.equal(columns.title, LOG_COLUMNS_TITLE, 'group.Vcs.Log.ToggleColumns.text = 列')
  assert.equal(columns.group, true)
  // 原写四条（`LOG_COLUMNS` 全量，含「提交」）：上游这一组的成员不是全部列，而是 `getDynamicColumns()`
  // = Author / Hash / Date（`VcsLogDefaultColumn.kt:43`），`Commit.isDynamic = false`（同文件 `:89`）、
  // 列序存档还强制把 Root/Commit 补回（`VcsLogColumnUtil.kt:18-32`）⇒ 提交列在 IDEA 里勾不掉。
  // 断言按上游形状改**得更精确**（逐元素 deepEqual 没放松成 includes），表格那半的判据在 tests/vcs-log-display.test.mjs。
  assert.deepEqual(columns.children.map(row => row.id), LOG_DYNAMIC_COLUMNS.map(column => `vcs.log.column.${column}`))
  assert.deepEqual(columns.children.map(row => row.title), ['作者', '哈希', '日期'], '次序照上游 listOf(Author, Hash, Date)')
  assert.deepEqual(columns.children.map(row => row.checked), [true, true, false], '勾掉的日期列没有勾')
  // 四列里唯一不进这一组的就是提交列 ⇒ 用 LOG_COLUMNS 反证一次，将来加列时这里会提醒去核 isDynamic。
  assert.deepEqual(LOG_COLUMNS.filter(column => !LOG_DYNAMIC_COLUMNS.includes(column)), ['commit'])
  columns.children[2].run?.()
  assert.deepEqual(calls[4], ['column', 'date'])
  assert.equal(LOG_COLUMN_TITLES.commit, '提交', '列名与表头同一份文案（VcsLogColumns 读它）')

  assert.equal(model[6].title, LOG_CHANGES_FROM_PARENTS_TITLE, 'action.Vcs.Log.ShowChangesFromParents.text')
  model[6].run?.()
  assert.deepEqual(calls[5], ['parents', true])

  const location = model[7]
  assert.equal(location.group, true)
  assert.deepEqual(location.children.map(row => row.title), [LOG_PREVIEW_BOTTOM_TITLE, LOG_PREVIEW_RIGHT_TITLE],
    '两档文案 = MoveDiffPreviewToBottom/Right.text（底部 / 右侧）')
  assert.deepEqual(location.children.map(row => row.checked), [true, false], '缺省在下方（isDiffPreviewVerticalSplit = true）')
  location.children[1].run?.()
  assert.deepEqual(calls[6], ['preview', false], '点「右侧」= 纵向分栏关掉')
})

test('不做的两条留在登记里，接住的七条从登记里移出且真的出现在行里', () => {
  assert.deepEqual(LOG_PRESENTATION_GAPS.map(gap => gap.id), [
    'Vcs.Log.ShowRootsColumnAction', 'Vcs.Log.HighlightersActionGroup',
  ], '原写六条：CompactReferencesView / ShowLongEdges / AlignLabels 三条本批接住了（文件头逐条留痕）')
  for (const gap of LOG_PRESENTATION_GAPS) assert.ok(gap.why.length > 8, `${gap.id} 要写清为什么不接`)
  const actions = { setShowTagNames: () => {}, setPreferCommitDate: () => {}, toggleColumn: () => {}, setCompactReferences: () => {},
    setShowLongEdges: () => {}, setAlignLabels: () => {}, setDiffPreviewAtBottom: () => {}, setShowChangesFromParents: () => {} }
  const model = logPresentationModel({ showTagNames: true, hidden: [], ...LOG_PRESENTATION_DEFAULTS }, actions)
  const ids = JSON.stringify(model)
  for (const gap of LOG_PRESENTATION_GAPS) assert.ok(!ids.includes(gap.title), `${gap.title} 不该出现在可点的行里`)
  for (const title of [LOG_COMPACT_REFERENCES_TITLE, LOG_LONG_EDGES_TITLE, LOG_COMMIT_DATE_TITLE, LOG_ALIGN_LABELS_TITLE,
    LOG_CHANGES_FROM_PARENTS_TITLE, LOG_PREVIEW_BOTTOM_TITLE, LOG_PREVIEW_RIGHT_TITLE]) {
    assert.ok(ids.includes(title), `${title} 要真的能点`)
  }
  const todo = read('docs/source-todo.md')
  assert.match(todo.split('## 11.')[1] ?? '', /提交时间戳/, '逐条不做项要登记在 docs/source-todo.md §11')
})

test('上游缺省档逐条对得上（紧凑开 / 长边**关** / 提交日期关 / 左侧引用关 / 预览在下方 / 对父项更改关）', () => {
  assert.deepEqual({ ...LOG_PRESENTATION_DEFAULTS }, {
    compactReferences: true, showLongEdges: false, preferCommitDate: false, alignLabels: false, diffPreviewAtBottom: true,
    showChangesFromParents: false,
  })
  // 长边那一档原写"开"：那是没读过 State。上游两处都写着 false ——
  // platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsLogUiPropertiesImpl.kt:121-122（LONG_EDGES_VISIBLE）
  // 与 platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/facade/VisibleGraphImpl.kt:35。
  // 另外两条出厂值不同的（表格里显示标签名 = 关）不在这一份里：那是本仓的**项目设置**，见接线请求。
})

test('引用画哪几枚：紧凑档 = 一个组一枚 chip，标签名称档不给 tag', () => {
  const refs = [{ name: 'main', type: 'local' }, { name: 'v1.0', type: 'tag' }, { name: 'origin/main', type: 'remote' }]
  // 原来这一条断的是「扁平 ref 数组」上的四档（logRefsToShow）；换成组模型后**强度只升不降**：
  // 既断画出来的组名（= 原来那几条 chip 名单，逐字同值），又断组里到底还剩谁（紧凑档少画的那些没被丢掉）。
  const names = (list, options) => logRefGroups(list, options).map(group => group.name)
  const inside = (list, options) => logRefGroups(list, options).map(group => group.refs.map(ref => ref.name))
  assert.deepEqual(names(refs, { showTagNames: false, compact: false }), [refs[0].name, refs[2].name], '关标签 = 摘掉 tag')
  assert.deepEqual(names(refs, { showTagNames: true, compact: true }), [refs[0].name],
    '紧凑 = 仅在表中显示提交的第一个引用（bundle description 逐字）')
  assert.deepEqual(names(refs, { showTagNames: false, compact: true }), [refs[0].name], '两档叠加时先过滤再取第一个')
  assert.deepEqual(logRefGroups([], { showTagNames: true, compact: true }), [], '没有引用不编一个')
  assert.deepEqual(inside(refs, { showTagNames: true, compact: true }), [[refs[0].name, refs[2].name, refs[1].name]],
    '紧凑档 = 全部引用并进同一个组（SimpleRefGroup.kt:33-37），组名只是**第一枚**chip')
  assert.deepEqual(inside(refs, { showTagNames: true, compact: false }), [['main'], ['origin/main'], ['v1.0']],
    '非紧凑档里 isBranch 的引用各占一组（同文件 :44-45），tag 单独一组')
})

test('引用的次序 = GitLabelComparator 那八档，不是 git 的 refname 字典序', () => {
  // 档位表逐字照抄 GitRefManager.kt:191-200（HEAD, CURRENT_BRANCH, MASTER, ORIGIN_MASTER, LOCAL_BRANCH, REMOTE_BRANCH, TAG, OTHER）。
  // 注意同文件的私有枚举 RefType:172-180 的**声明序**不是这个序 —— 拿声明序排就错。
  assert.deepEqual([...LOG_REF_TIERS],
    ['head', 'currentBranch', 'master', 'originMaster', 'local', 'remote', 'tag', 'other'])
  const refs = [
    { name: 'beta', type: 'local' }, { name: 'v10', type: 'tag' }, { name: 'origin/feature', type: 'remote' },
    { name: 'HEAD', type: 'head' }, { name: 'main', type: 'local' }, { name: 'v2', type: 'tag' },
  ]
  const groups = logRefGroups(refs, { showTagNames: true, compact: false })
  assert.deepEqual(groups.map(group => group.name), ['main', 'beta', 'origin/feature', 'v2'],
    'chip 的次序：main 走 MASTER 档排在 beta 前；两个 tag 并成一枚 chip（同类型一组，:46-48）')
  assert.deepEqual(groups[0].refs.map(ref => ref.name), ['HEAD', 'main'],
    'HEAD 摘出来并进**第一组**的引用表最前（GitRefManager.kt:100 + :122-124），不贡献组名')
  assert.deepEqual(groups[3].refs.map(ref => ref.name), ['v2', 'v10'],
    'tag 组内 = natural 序（v2 在 v10 前）；git 的 %D 会把 v10 排前面')
  const compact = logRefGroups(refs, { showTagNames: true, compact: true })
  assert.equal(compact.length, 1, '紧凑档只有组')
  assert.equal(compact[0].name, 'main', '紧凑档的"第一个"是分支名而不是 "HEAD"')
  assert.deepEqual(compact[0].refs.map(ref => ref.name), ['HEAD', 'main', 'beta', 'origin/feature', 'v2', 'v10'],
    '少画的 chip 留在组里（可达面见 tooltip 那一条）')
  assert.ok(compareLogRefs({ name: 'origin/x', type: 'remote' }, { name: 'aaa', type: 'local' }) > 0,
    'REMOTE_BRANCH 档在 LOCAL_BRANCH 档之后（档位优先，不看名字）')
})

test('CURRENT_BRANCH 那一档：要仓库状态，给了就升到 MASTER 之前', () => {
  const refs = [{ name: 'release', type: 'local' }, { name: 'main', type: 'local' }]
  assert.equal(logRefTier({ name: 'beta', type: 'local' }), 'local', '不给当前分支 = 这一档不参与')
  assert.equal(logRefTier({ name: 'release', type: 'local' }, 'release'), 'currentBranch')
  assert.equal(logRefTier({ name: 'main', type: 'local' }, 'main'), 'currentBranch',
    '当前分支恰好叫 main：CURRENT_BRANCH 盖过 MASTER（GitLabelComparator.getType:204-208 的升档）')
  assert.equal(logRefGroups(refs, { showTagNames: true, compact: true })[0].name, 'main',
    '没接线时仍按 MASTER 档排 ⇒ main 在前')
  assert.equal(logRefGroups(refs, { showTagNames: true, compact: true, currentBranch: 'release' })[0].name, 'release',
    '接上线后当前分支升到 MASTER 之前（orderedTypes 的第 2 档 vs 第 3 档）')
})

test('名字档 = NaturalComparator（ignoreCase=true, likeFileNames=false）那三步收尾', () => {
  assert.ok(naturalCompareRefNames('v2', 'v10') < 0, '数字段比**值**不比字符（NaturalComparator.java:52-74）')
  assert.ok(naturalCompareRefNames('feature/10', 'feature/2') > 0, '前缀相同时位数多的算大')
  assert.ok(naturalCompareRefNames('main', 'main2') < 0, '一边走完另一边还有字符 ⇒ 长的算大（:100-102）')
  assert.ok(naturalCompareRefNames('V2', 'v2') < 0,
    '忽略大小写那一遍相等 ⇒ 再来一遍区分大小写（:105）；大写 V 的码元比小写 v 小 ⇒ 大写在前的那一枚排前')
  assert.ok(naturalCompareRefNames('a b', 'a-c') > 0,
    'transitivity fix（:116-121）：空格与 0x21~0x2F 之间那些字符相遇时**空格算大**')
  assert.ok(naturalCompareRefNames('007', '7') > 0,
    '有效位数相同、数字也相同 ⇒ 第三步比**含前导零的总长**（NaturalComparator.java:66-68）⇒ 带前导零的那一枚排后面')
  assert.ok(naturalCompareRefNames('v10', 'v9x') > 0,
    '第一步「有效位数多的算大」（:58-60）在这一例就是终点：两串等长、首个 differing 字符 1 比 9 小 ⇒ 只有真走过数字段才回正')
})

test('组内其余引用可达 = 悬停 chip 的 tooltip，十行封顶（TooltipReferencesPanel）', () => {
  assert.equal(LOG_REF_TOOLTIP_LIMIT, 10, 'REFS_LIMIT = 10（TooltipReferencesPanel.java:36）')
  const many = Array.from({ length: 13 }, (_, index) => ({ name: `b${index}`, type: 'local' }))
  const lines = logRefTooltip(many).split('\n')
  assert.equal(lines.length, 11, '十条引用 + 一行余数（ReferencesPanel.java:61-107 的 visible/rest）')
  assert.equal(lines[0], 'b0', '一行一个引用（上游同行内补逗号，换行宿主里不搬）')
  assert.match(lines[10], /^… 还有 3 个/, '余数那一行 = vcs.log.references.more.tooltip（VcsLogBundle.properties:131）')
  assert.equal(logRefTooltip(many.slice(0, 10)).split('\n').length, 10, '刚好十条不补余数那一行')
  assert.equal(logRefTooltip([]), '', '没有引用不给一枚空 tooltip')
})

test('速度搜索只比可见的元数据列（VcsLogSpeedSearch.getColumnsForSpeedSearch）', () => {
  const row = { subject: '修复折叠', author: 'Tao', date: '2026-09-29 10:00', hash: 'a'.repeat(40), shortHash: 'aaaaaaaa' }
  assert.deepEqual(logSpeedSearchColumns(row, []), ['修复折叠', 'Tao', '2026-09-29 10:00', 'aaaaaaaa'])
  assert.deepEqual(logSpeedSearchColumns(row, ['date', 'hash']), ['修复折叠', 'Tao'], '勾掉的列不参与匹配')
  assert.ok(speedSearchMatches('ta', logSpeedSearchColumns(row, [])[1]), '子序列命中作者')
  assert.ok(!speedSearchMatches('zzz', logSpeedSearchColumns(row, []).join('')), '不命中的 pattern 不假装命中')
})

test('Ctrl+C 复制的是**整行看得见的列**，不是哈希（表格自己的 performCopy）', () => {
  const row = { subject: '修一个折叠', author: 'Tao', date: '2026-09-29 10:00', hash: 'a'.repeat(40), shortHash: 'aaaaaaaa' }
  // 上游 `VcsLogGraphTable.performCopy`：可见列的值用 `" "` 连（`ui/table/VcsLogGraphTable.java:697-704`），
  // 哈希列给的是**短**哈希（`ui/table/column/VcsLogDefaultColumn.kt:204` 的 `toShortString()`）。
  assert.equal(logRowCopyText(row, []), '修一个折叠 Tao 2026-09-29 10:00 aaaaaaaa')
  assert.ok(!logRowCopyText(row, []).includes('a'.repeat(40)), '40 位完整哈希不在这条复制路径里（那是「复制修订号」）')
  assert.equal(logRowCopyText(row, ['date', 'hash']), '修一个折叠 Tao', '勾掉的列不参与（与速度搜索同一份可见列判据）')
  // 多行 = 每行一条，`"\n"` 串（同一文件 `:705`）。本仓日志单选 ⇒ 组件一次只交一行，模型这边先钉住形状。
  assert.deepEqual(logRowsCopyText([row, { ...row, subject: '第二条' }], ['author', 'date', 'hash'])
    .split('\n'), ['修一个折叠', '第二条'])
  assert.equal(logRowsCopyText([], []), '', '没有选中行 = 空文本（上游 isCopyEnabled 要求至少一行，:717-719）')
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

test('tooltip 挂在行上、紧凑档只画一枚 chip 而组内其余引用挂在 chip 的 title 上（SSR 渲真组件）', async () => {
  const commit = {
    hash: 'c'.repeat(40), shortHash: 'ccccccc', author: 'Tao', date: '2026-09-29T10:00:00+08:00',
    subject: '主题一', parents: [],
    refs: [{ name: 'HEAD', type: 'head' }, { name: 'beta', type: 'local' }, { name: 'main', type: 'local' }],
  }
  const render = props => renderToString(createSSRApp({
    render: () => h(VcsLogTable, { commits: [commit], selected: commit.hash, root: 'D:/p', ...props }),
  }))
  // 只认 **chip 元素自己**（`<span class="ref …">文本</span>`）：原写法 `!html.includes('beta')` 判的是整段 HTML
  // 里有没有这串字符 —— 这一批把组内其余引用挂到 chip 的 title 上以后，"整段里没有 beta"根本不再等价于"没画 beta"。
  // 两处原写法还差一层：`class="ref[^"]*"` 连**外层**那圈 `class="references"` 一起吃进来（chip 名单会多出一条空项），
  // 而且 chip 里那枚警示图标是 `v-if` ⇒ SSR 会给一个 `<!--v-if-->` 占位注释 / 内层占位元素，"chip 内容 = 纯文本"不成立。
  // 判据本体是"类名里有一个**恰为** ref 的类"；取文本前先去掉注释与占位图标（`data-stub` 是本夹具的替身标记）。
  const chipTags = html => [...html.matchAll(/<span[^>]*class="ref(?:\s[^"]*)?"[^>]*>/g)].map(match => match[0])
  const chipTexts = html => [...html.replace(/<!--[^>]*-->/g, '').replace(/<span data-stub[^>]*><\/span>/g, '')
    .matchAll(/<span[^>]*class="ref(?:\s[^"]*)?"[^>]*>([^<]*)<\/span>/g)].map(match => match[1])
  const chipTitles = html => chipTags(html)
    .map(tag => ((tag.match(/title="([^"]*)"/) ?? [])[1] ?? '').replace(/&#10;/g, '\n'))
  const compact = await render({ compactReferences: true })
  assert.deepEqual(chipTexts(compact), ['main'], '紧凑档只画一枚 chip')
  assert.deepEqual(chipTitles(compact), ['HEAD\nmain\nbeta'],
    '少画的引用留在同一个组里、悬停 chip 就列得出来（GraphCommitCellRenderer.kt:84-103 → TooltipReferencesPanel.java:35-56）')
  const full = await render({ compactReferences: false })
  assert.deepEqual(chipTexts(full), ['main', 'beta'], '非紧凑 = isBranch 的引用各画一枚；HEAD 不占一枚（它并进第一组，:122-124）')
  assert.deepEqual(chipTitles(full), ['HEAD\nmain', ''], '组内多于一条才补这枚 tooltip，单引用组不把自己的名字再写一遍')
  // 左侧引用那一档（`Vcs.Log.AlignLabels`）走的是**另一支模板**（`.labels` 列），同一组模型也得同一份判据，
  // 否则"只有 inline 那支接了组模型"这种半截接线没人看得见。
  const aligned = await render({ compactReferences: true, alignLabels: true })
  assert.ok(aligned.includes('class="labels"'), '勾上左侧引用 ⇒ 引用进独立那一列')
  assert.deepEqual(chipTexts(aligned), ['main'], '对齐列画的还是同一枚组名 chip')
  assert.deepEqual(chipTitles(aligned), ['HEAD\nmain\nbeta'], '对齐列同样带组内其余引用')
  const row = compact.match(/<div[^>]*class="log-row[^"]*"[^>]*>/)?.[0] ?? ''
  assert.ok(row.includes('title='), '行上有 tooltip（`Vcs.Log.ShowTooltip` 走的就是同一个 tooltip）')
  assert.ok(row.includes('主题一'), 'tooltip 里带主题')
})

test('长边档缺省=关，但只有跨满 30 行的边真的被截（把默认改掉而常见画面不变）', () => {
  const commit = (hash, parents) => ({ hash, shortHash: hash, author: 'A', date: '2026-01-01T00:00:00Z', subject: hash, parents, refs: [] })
  // 常见情形：c1→c3 跨 2 行。关档也不截它 ⇒ 日志面不会因为我们把出厂档改成"关"就满屏梳齿。
  const near = [commit('c1', ['c3', 'c2']), commit('c2', ['c3']), commit('c3', [])]
  const nearClosed = buildLogGraph(near, { showLongEdges: false })
  assert.deepEqual(nearClosed.rows.map(row => row.pass.length), [0, 1, 0], '关档：跨 2 行的边照旧穿过中间行')
  assert.deepEqual(nearClosed.rows.map(row => row.stub.length), [0, 0, 0], '一条终端竖线都不给')
  assert.deepEqual(buildLogGraph(near).rows.map(row => row.pass.length), [0, 1, 0],
    '缺省档（= 上游出厂的"关"，VcsLogUiPropertiesImpl.kt:121-122）对这种页面上的结果与开档逐字一致')
  // 跨满 30 行（PrintElementGeneratorImpl.kt:278 的 LONG_EDGE_SIZE）才是这一档管的那条边。
  const far = [commit('a1', ['f0', 'a9']),
    ...Array.from({ length: 29 }, (_, i) => commit(`f${i}`, [i === 28 ? 'a9' : `f${i + 1}`])), commit('a9', [])]
  assert.equal(far.findIndex(c => c.hash === 'a9'), 30, 'a1 在第 0 行、a9 在第 30 行 ⇒ 跨度恰好到分界')
  assert.deepEqual(buildLogGraph(far).rows.map(row => row.stub.length),
    buildLogGraph(far, { showLongEdges: false }).rows.map(row => row.stub.length),
    '缺省档 = 关档：长的那条被截成两头的终端段')
  assert.equal(buildLogGraph(far).rows[0].stub.length, 1, '起点那一行有一段朝下的竖线')
  assert.equal(buildLogGraph(far).rows[30].stub.length, 1, '目标行那一段朝上')
  assert.equal(buildLogGraph(far, { showLongEdges: true }).rows[15].pass.length, 1, '开档：同一条边穿过中间行')
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
  // 原写两条「分两步」的形状（`collapseLinearBranches` 再 `buildLogGraph`）：那正是 vcslog2 请求 1 要换掉的写法，
  // 两步之间丢掉的是上游收起时同一次修改里补的那条 DOTTED 边（CollapsedActionManager.java:231）。
  // 接线后钉的是**一次成型**那一步，强度没降：仍是逐字整段调用式正则（不是 includes），
  // 虚线是否真的画出来由 tests/vcs-log-graph-render.test.mjs 渲真组件核。
  assert.match(table, /collapseLinearGraph\(props\.commits, props\.collapsed \?\? false,/)
  assert.match(table, /showLongEdges: props\.showLongEdges === true/,
    '长边那一档不给"未传当开"的兜底：出厂档 = 关（VcsLogUiPropertiesImpl.kt:121-122）')
  assert.match(table, /const graph = computed\(\(\) => folded\.value\.graph\)/)
  assert.match(table, /graph\.value\.units\.map\(units => paintGraphRow\(units\)\)/, '每行按 graph.units 画，不再吃 row.pass/down/up')
  assert.match(table, /:stroke-dasharray="stroke\.dash"/, '虚线单元真的落成 stroke-dasharray')
  assert.match(table, /logRefGroups\(commit\.refs \?\? \[\]/, '引用画哪几枚 chip 由模型判，组件不自己排')
  assert.match(table, /:title="chip\.tooltip \|\| undefined"/, '组内其余引用真的挂到 chip 的 title 上')
  assert.match(table, /tooltip: [\s\S]{0,80}\? logRefTooltip\(group\.refs\) : ''/,
    '单引用组不补 tooltip 这一档也在模型侧判，不留一枚空 title（警示组走另一支：detached HEAD 那一条）')
  assert.match(table, /currentBranch: props\.currentBranch/, 'CURRENT_BRANCH 那一档从宿主取仓库状态，不在组件里猜')
  assert.match(table, /:title="logCommitTooltip\(/, 'tooltip 挂在行上')
  assert.match(table, /<SpeedSearchBar :open="searchOpen"/, '速度搜索框（复用书签面板同一件）')
  assert.match(table, /speedSearchMatches\(value, text\)/, '匹配规则复用 src/speedSearch 那一处真源')
  // 点一次图形收/展那一条链：命中判定 + 把点击吃掉（上游 shouldSelectCell 说不选中那一行）+ 手形光标。
  assert.match(table, /@click\.stop="onGraphClick\(row\.commit\.hash\)"/, '图形格里点一次 = 收/展那一条链，且不落到行的 select')
  assert.match(table, /clickLinearFragment\(props\.commits, props\.collapsed \?\? false, hash\)/, '要不要动交给模型判')
  assert.match(table, /:class="\{ foldable: foldable\.has\(row\.commit\.hash\) \}"/, '只有会改变折叠态的那一格给手形光标')
  assert.match(table, /\.graph\.foldable \{ cursor: pointer/, '手形光标 = 上游 MOUSE_OVER 回 HAND_CURSOR 的等价物')
  // Ctrl+C 与 Ctrl+Alt+Shift+C 是两条动作：前者整行文本、后者修订号。
  assert.match(table, /logRowCopyText\(\{ subject: commit\.subject/, '整行文本 = 模型算的可见列，不在组件里另拼')
  assert.match(table, /emit\('copy', text\)/, 'Ctrl+C 交出去的是那一行的文本')
  assert.match(table, /emit\('copyRevision'\)/, '带 Alt 那一条走「复制修订号」')
  const log = read('src/components/VcsLog.vue')
  assert.match(log, /setViewPref\('compactReferences', value\)/)
  assert.match(log, /setViewPref\('showChangesFromParents', value\)/)
  assert.match(log, /:vertical="viewPrefs\.diffPreviewAtBottom"/, '差异预览位置 = 外层分栏的方向')
  assert.match(log, /:from-parents="viewPrefs\.showChangesFromParents"/)
  assert.match(log, /:collapsed="collapsed"[\s\S]*:can-collapse="canCollapse"/, '折叠状态接到过滤器')
  assert.match(log, /:collapsed="collapsedSpans"/, '表格吃的是**那几条收起的链**，不是一句布尔')
  assert.match(log, /@set-collapsed="setCollapsedAll"/, '菜单里那两条按钮 = 全收 / 全展')
  assert.match(log, /@fold="foldFragment"/, '图形上那一次点击接回同一个状态')
  assert.match(log, /collapsedSpans\.value = value \? collapsedLinearSpans\(commits\.value\) : \[\]/,
    '收起全部 = 把当前页所有链都记上（上游 COLLAPSE_ALL 逐节点做同件事）')
  assert.match(log, /@copy="copyRowText"/, 'Ctrl+C 的文本由宿主写剪贴板')
  assert.match(log, /@copy-revision="copyHash"/, '复制修订号仍是完整哈希那一条')
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
