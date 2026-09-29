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
import {
  LOG_COLUMNS_TITLE, LOG_COLUMN_TITLES, LOG_PRESENTATION_GAPS, LOG_TAG_NAMES_TITLE, LOG_VIEW_OPTIONS_TITLE,
  logPresentationModel,
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

test('模型：两个真能接住的行，`列` 是子组，每条都真的翻状态', () => {
  const calls = []
  const model = logPresentationModel({ showTagNames: true, hidden: ['date'] }, {
    setShowTagNames: value => calls.push(['tag', value]),
    toggleColumn: column => calls.push(['column', column]),
  })
  assert.deepEqual(model.map(row => row.id), ['vcs.log.showTagNames', 'vcs.log.columns'])
  assert.equal(model[0].title, LOG_TAG_NAMES_TITLE, 'action.Vcs.Log.ShowTagNames.text = 标签名称')
  assert.equal(model[0].checked, true, '勾选态跟着项目设置走')
  model[0].run?.()
  assert.deepEqual(calls[0], ['tag', false], '点一下要把状态交给宿主（写回项目设置）')

  const columns = model[1]
  assert.equal(columns.title, LOG_COLUMNS_TITLE, 'group.Vcs.Log.ToggleColumns.text = 列')
  assert.equal(columns.group, true)
  assert.deepEqual(columns.children.map(row => row.id), LOG_COLUMNS.map(column => `vcs.log.column.${column}`))
  assert.deepEqual(columns.children.map(row => row.title), ['提交', '作者', '日期', '哈希'])
  assert.deepEqual(columns.children.map(row => row.checked), [true, true, false, true], '勾掉的日期列没有勾')
  columns.children[2].run?.()
  assert.deepEqual(calls[1], ['column', 'date'])
  assert.equal(LOG_COLUMN_TITLES.commit, '提交', '列名与表头同一份文案（VcsLogColumns 读它）')
})

test('不做的四条留在登记里，代码里没有它们的勾选项', () => {
  assert.deepEqual(LOG_PRESENTATION_GAPS.map(gap => gap.id), [
    'Vcs.Log.ShowRootsColumnAction', 'Vcs.Log.CompactReferencesView', 'Vcs.Log.ShowLongEdges',
    'Vcs.Log.PreferCommitDate', 'Vcs.Log.AlignLabels', 'Vcs.Log.HighlightersActionGroup',
  ])
  for (const gap of LOG_PRESENTATION_GAPS) assert.ok(gap.why.length > 8, `${gap.id} 要写清为什么不接`)
  const model = logPresentationModel({ showTagNames: true, hidden: [] }, { setShowTagNames: () => {}, toggleColumn: () => {} })
  const ids = JSON.stringify(model)
  for (const gap of LOG_PRESENTATION_GAPS) assert.ok(!ids.includes(gap.title), `${gap.title} 不该出现在可点的行里`)
  const todo = read('docs/source-todo.md')
  assert.match(todo.split('## 11.')[1] ?? '', /提交时间戳/, '逐条不做项要登记在 docs/source-todo.md §11')
})

test('表格真的不画勾掉的列（SSR 渲真组件）', async () => {
  const commit = {
    hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Tao', date: '2026-09-29T10:00:00+08:00',
    subject: '提交主题', parents: [], refs: [{ name: 'main', type: 'local' }],
  }
  const html = await renderToString(createSSRApp({
    render: () => h(VcsLogTable, { commits: [commit], selected: commit.hash, root: 'D:/p', hidden: ['date', 'hash'] }),
  }))
  assert.ok(html.includes('提交主题'), '提交列照画')
  assert.ok(html.includes('Tao'), '作者列照画')
  assert.ok(!html.includes(commit.shortHash), '勾掉的哈希列不画')
  assert.ok(!/>2026-09-29/.test(html), '勾掉的日期列不画（表格自己格式化日期）')
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
