// 搁架（储藏栈）一节的判据：`git stash list` 的条目整形 + 视图接线。
//
// 上游那块 UI 是「搁架」工具窗口（`platform/vcs-impl/frontend/.../shelf/ShelfToolWindowPanel.kt:47-60`：
// 一个 `ShelfTree` + 工具栏 + 预览开关）。本仓的储藏是 `git stash`，通道在 `native/git.cpp`
// 的 `stash_list`（`git stash list --pretty=%gd\x1f%s`）→ 桥接 `git.stash`。
//
// 三条判据：
//   ① 纯解析：`WIP on <branch>: …` / `On <branch>: …` 两段拆得对，坏形状不丢行；
//   ② 取回判据：`git stash pop` 收 ref（`stash@{n}`）⇒ 任意一条都能取回，认不出 ref 的行给出原因；
//   ③ 接线：SourceControl 真请求 `git.stash`、把行喂给 ShelfPane，三条动作都接上。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parseStashMessage, restoreBlockedReason, shelfRows, SHELF_EMPTY_TEXT, SHELF_TITLE, stashIndex } from '../src/shelfTree.ts'
import { loadSfc } from './vue-sfc-loader.mjs'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('stash@{n} 解析：正常、非数字、带空格、坏形状', () => {
  assert.equal(stashIndex('stash@{0}'), 0)
  assert.equal(stashIndex('stash@{12}'), 12)
  assert.equal(stashIndex(' stash@{3} '), 3, '两侧空白可容忍')
  assert.equal(stashIndex('stash@{x}'), -1, '非数字给 -1')
  assert.equal(stashIndex('HEAD'), -1)
  assert.equal(stashIndex(''), -1)
})

test('两段文本：自动储藏（WIP on）与带信息（On）各自拆对，坏形状不丢行', () => {
  assert.deepEqual(parseStashMessage('WIP on master: 1234abc 提交主题'), { branch: 'master', message: '1234abc 提交主题', auto: true })
  assert.deepEqual(parseStashMessage('On feature/x: 我的储藏信息'), { branch: 'feature/x', message: '我的储藏信息', auto: false })
  // 坏形状：整条当信息、分支留空（不至于让整行消失）。
  assert.deepEqual(parseStashMessage('随便什么文本'), { branch: '', message: '随便什么文本', auto: false })
  assert.deepEqual(parseStashMessage(''), { branch: '', message: '', auto: false })
  // 分支名里没有冒号时也不会把整条吞掉。
  assert.deepEqual(parseStashMessage('WIP on detached: x'), { branch: 'detached', message: 'x', auto: true })
})

test('行表：顺序照 git（栈顶在前）、任意一条都能取回（native 收 ref）', () => {
  const rows = shelfRows([
    { ref: 'stash@{0}', message: 'On main: 最近的' },
    { ref: 'stash@{1}', message: 'WIP on main: abc 旧一点' },
    { ref: 'stash@{2}', message: 'On main: 更旧' },
  ])
  assert.deepEqual(rows.map(r => r.ref), ['stash@{0}', 'stash@{1}', 'stash@{2}'], '顺序照 git stash list')
  assert.deepEqual(rows.map(r => r.restorable), [true, true, true], 'ref 是 stash@{n} ⇒ 都能取回（非栈顶也行）')
  assert.equal(rows[1].auto, true, 'WIP on = 自动储藏')
  assert.equal(rows[0].auto, false)
  assert.equal(restoreBlockedReason(rows[0]), null, '栈顶不阻塞')
  assert.equal(restoreBlockedReason(rows[1]), null, '非栈顶也不阻塞（走 git stash pop stash@{1}）')
  assert.deepEqual(shelfRows(null), [], '没有列表 = 空行表')
  assert.deepEqual(shelfRows([]), [], '空列表 = 空行表')
})

test('ref 解析不出来时按列表位置兜底（但取回要 ref 认得出，认不出才禁用）', () => {
  const rows = shelfRows([{ ref: 'HEAD', message: 'x' }, { ref: 'HEAD~1', message: 'y' }])
  assert.deepEqual(rows.map(r => r.index), [0, 1], '位置兜底（显示序号）')
  assert.deepEqual(rows.map(r => r.restorable), [false, false], '认不出 stash@{n} ⇒ 不能按 ref 取回')
  const reason = restoreBlockedReason(rows[0])
  assert.ok(reason && reason.includes('HEAD'), '原因里带上那条 ref')
})

test('ShelfPane 渲染真实行：空态文案、两条动作、每颗取回按钮都可点', async () => {
  const { component } = loadSfc('src/components/ShelfPane.vue')
  const rows = shelfRows([{ ref: 'stash@{0}', message: 'On main: 最近的' }, { ref: 'stash@{1}', message: 'On main: 旧的' }])
  const html = await renderToString(createSSRApp(component, { rows, busy: false, loading: false }))
  assert.ok(html.includes(SHELF_TITLE), '标题来自常量')
  assert.ok(html.includes('stash@{0}') && html.includes('stash@{1}'), '两条 ref 都画出来')
  assert.ok(html.includes('最近的'), '信息列画出来')
  // 任意一条都能取回（native 收 ref：`git stash pop stash@{n}`），两颗按钮都可点。
  const buttons = [...html.matchAll(/<button[^>]*aria-label="取回 stash@\{(\d+)\}"[^>]*>/g)]
  assert.equal(buttons.length, 2, '每行一颗取回按钮')
  assert.ok(!/disabled/.test(buttons[0][0]), '栈顶可点')
  assert.ok(!/disabled/.test(buttons[1][0]), '非栈顶也可点')
  const empty = await renderToString(createSSRApp(component, { rows: [], busy: false, loading: false }))
  assert.ok(empty.includes(SHELF_EMPTY_TEXT), '空态说明')
})

test('接线：取数与三条动作真走 git.stash 通道（宿主已拆到 src/shelfHost.ts），面板挂 ShelfPane', () => {
  // 2026-10-06 复算：取数与三条动作从 SourceControl.vue 拆到了 src/shelfHost.ts（那个组件贴着
  // 机检上限），所以这三条断言改核 shelfHost —— 原来写死在 SourceControl 里，文件一拆就红。
  const host = read('src/shelfHost.ts')
  assert.match(host, /request<GitStash>\('git\.stash'\)/, '列表走 git.stash（native 的 stash_list）')
  assert.match(host, /request\('git\.stash\.save'/, '「储藏当前更改」走 git.stash.save')
  assert.match(host, /request\('git\.stash\.pop', \{ ref \}\)/, '「取回」走 git.stash.pop（带 ref）')
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /void loadShelf\(\)/, 'load() 里顺带刷新储藏列表')
  assert.match(panel, /<ShelfPane :rows="shelfRowsView"/, '视图挂 ShelfPane')
  assert.match(panel, /@save="saveShelf" @pop="popShelf" @refresh="loadShelf"/, '三条动作都接')
  assert.match(panel, /createShelfHost\(/, '面板用 shelfHost 工厂装配取数/动作')
  // 认不出 ref 的行在宿主侧也再挡一次（不只靠按钮 disabled）。
  assert.match(host, /if \(!row \|\| !row\.restorable\) return/, '宿主侧对认不出 ref 的 pop 请求也拦下')
})

test('差异预览：任何一条都能看（`stash@{n}` 是合法 revision，走现有 git.showCommit）', async () => {
  // 上游搁架树的预览面（`ShelvedChangesViewManager` 的预览开关 / `ShelvedWrapperDiffRequestProducer`）。
  // 本仓**零 native 改动**：`git.showCommit` 收任意 revision，`stash@{n}` 就是一条合法 revision
  // （实测 `git show --first-parent 'stash@{0}'` 出的正是这条储藏含的补丁）。
  const host = read('src/shelfHost.ts')
  assert.match(host, /request<GitShowCommit>\('git\.showCommit', \{ revision: ref \}\)/, '差异走 git.showCommit')
  assert.match(host, /function show\(ref: string\)/, '有 show 动作')
  assert.match(host, /function clearPreview\(\)/, '有关闭预览')
  // 非栈顶也能看差异（show 从来不受 restorable 限制）。
  const pane = read('src/components/ShelfPane.vue')
  assert.match(pane, /@click="emit\('show', row\.ref\)"/, '每行都有查看差异按钮')
  assert.match(pane, /v-if="diffEnabled"/, '按钮按接线能力位出现（宿主没接 ⇒ 整个不渲染，不放假控件）')
  assert.match(pane, /:disabled="busy"/, '查看差异不受 restorable 限制（只有 busy 挡）')
  assert.match(pane, /v-if="preview"/, '预览面板按 preview 出现')
  assert.match(pane, /preview\.sides/, '并排行渲染（与 git.diffSides 同一形状）')
  assert.match(pane, /SHELF_DIFF_TITLE/, '提示文案来自常量')
  // 能力位默认关：宿主（SourceControl.vue，别的 lane 独占）还没接线 ⇒ 不渲染假控件。
  const { component } = loadSfc('src/components/ShelfPane.vue')
  const rows = shelfRows([{ ref: 'stash@{0}', message: 'On main: x' }])
  const without = await renderToString(createSSRApp(component, { rows }))
  assert.ok(!without.includes('查看 stash@{0} 的差异'), '没接线时查看差异按钮不出现')
  const withDiff = await renderToString(createSSRApp(component, { rows, diffEnabled: true }))
  assert.ok(withDiff.includes('查看 stash@{0} 的差异'), '接线后按钮出现')
})

test('ShelfPane 仍满足动效令牌门禁（hover 有令牌驱动的 transition）', () => {
  const pane = read('src/components/ShelfPane.vue')
  assert.match(pane, /\.shelf-row \{[^}]*transition: background var\(--dur-1\) var\(--ease\)/, 'hover 底规则有令牌 transition')
})
