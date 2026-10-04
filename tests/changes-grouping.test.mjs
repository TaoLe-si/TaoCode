// 提交面板的「分组依据」（上游 `ChangesView.GroupBy` → `SelectChangesGroupingActionGroup`）。
//
// 上游要点（逐条核过）：
//   · 组名 `group.ChangesView.GroupBy.text` = 「分组依据」（`ActionsBundle.properties:2547`）；
//   · 三项：`ChangesView.GroupBy.Directory` = 目录（`:134`）、`Module` = 模块（`:135`）、
//     `Repository` = 仓库（`:136`，dvcs-impl 注册）；键位 Ctrl+Alt+P / Ctrl+Alt+M（`$default.xml:1116-1120`）。
//   · **本仓只做「目录」**：模块要模块模型、仓库要多仓库视图，两者在本仓都不存在
//     （理由逐条写在 src/changesGrouping.ts 的文件头）—— 下拉里不列点了没反应的档。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHANGES_GROUP_BY_LABELS, GROUP_BY_DIRECTORY, GROUP_BY_LABEL, GROUP_BY_NONE, directoryOf, groupChanges,
} from '../src/changesGrouping.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const change = path => ({ path, staged: false, workStatus: 'M', indexStatus: ' ', untracked: false })

test('the group label and the directory option are the shipped Chinese ones', () => {
  assert.equal(GROUP_BY_LABEL, '分组依据', 'ActionsBundle.properties:2547 group.ChangesView.GroupBy.text')
  assert.equal(GROUP_BY_DIRECTORY, '目录', ':134 action.ChangesView.GroupBy.Directory.text')
  assert.equal(GROUP_BY_NONE, '不分组', '本仓把"三条 toggle 全不选"显式写成一项')
  assert.deepEqual(Object.keys(CHANGES_GROUP_BY_LABELS), ['none', 'directory'])
})

test('the module and repository options are documented as not offered', () => {
  const src = read('src/changesGrouping.ts')
  assert.match(src, /模块/, '模块要模块模型')
  assert.match(src, /仓库|多仓库/, '仓库要多仓库视图')
  assert.ok(!Object.values(CHANGES_GROUP_BY_LABELS).includes('模块'), '不列点了没反应的档')
  assert.ok(!Object.values(CHANGES_GROUP_BY_LABELS).includes('仓库'))
})

test('directoryOf takes the workspace-relative parent', () => {
  assert.equal(directoryOf('src/deep/inner.ts'), 'src/deep')
  assert.equal(directoryOf('top.txt'), '')
  assert.equal(directoryOf('.idea/vcs.xml'), '.idea')
})

test('grouping by directory puts top-level files first and sorts inside a group', () => {
  const groups = groupChanges([change('src/b.ts'), change('top.txt'), change('src/a.ts'), change('.idea/vcs.xml')], 'directory')
  assert.deepEqual(groups.map(g => g.dir), ['', '.idea', 'src'])
  assert.deepEqual(groups[0].changes.map(c => c.path), ['top.txt'])
  assert.deepEqual(groups[2].changes.map(c => c.path), ['src/a.ts', 'src/b.ts'], '组内按路径排序')
})

test('the none option keeps one flat group in the original order', () => {
  const list = [change('src/b.ts'), change('top.txt'), change('src/a.ts')]
  const groups = groupChanges(list, 'none')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].dir, '')
  assert.deepEqual(groups[0].changes.map(c => c.path), ['src/b.ts', 'top.txt', 'src/a.ts'], '不分组 = 原样')
})

test('an empty change list has no groups at all', () => {
  assert.deepEqual(groupChanges([], 'none'), [])
  assert.deepEqual(groupChanges([], 'directory'), [])
})

// —— 接线 ——

test('the panel offers the selector and groups both sections', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /import \{[^}]*groupChanges[^}]*\} from '\.\.\/changesGrouping'/)
  assert.match(panel, /const stagedGroups = computed\(\(\) => groupChanges\(staged\.value, groupBy\.value\)\)/)
  assert.match(panel, /const unstagedGroups = computed\(\(\) => groupChanges\(unstaged\.value, groupBy\.value\)\)/)
  assert.match(panel, /v-for="\(label, value\) in CHANGES_GROUP_BY_LABELS"/)
  assert.match(panel, /v-for="change in group\.changes"/)
  assert.equal((panel.match(/class="sc-group-head"/g) ?? []).length, 2, '已暂存/更改两组都要能显示目录头')
})

test('the group head only shows in the directory mode', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.equal((panel.match(/v-if="groupBy === 'directory'" class="sc-group-head"/g) ?? []).length, 2)
})
