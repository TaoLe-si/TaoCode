// 提交面板里那些"取自中文包"的文案 —— 逐条锁住值 + 盯住它们的**控件形状与位置**（第四十六批）。
//
// 背景：第四十五批靠真机截图抓到过一个"上游没有的常显按钮"，这一批把同一类风险系统化：
// 面板里凡是写明"这是 IDEA 的说法"的地方，要么取自中文包的取值，要么写明是本仓措辞。
// 这一份判据盯三件事：值对不对、控件在不在上游那一行、有没有再冒出编造的控件。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AMEND_CHECKBOX_TEXT, COMMIT_MESSAGE_PLACEHOLDER, MESSAGE_HISTORY_TEXT, MESSAGE_HISTORY_DESCRIPTION,
  AMEND_SHORTCUT_TEXT, AMEND_TOOLTIP, EXPAND_ALL_TEXT, COLLAPSE_ALL_TEXT } from '../src/commitPanelStrings.ts'
import { CHECKS_FAILED_UNKNOWN, RERUN_CHECKS_TOOLTIP, commitAnywayLabel, checksFailedTitle } from '../src/commitChecks.ts'
import { commitBlockMessage } from '../src/commitCheck.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('值逐条等于随 IDE 发货的中文包（localization-zh）', () => {
  assert.equal(AMEND_CHECKBOX_TEXT, '修正(M)', 'VcsBundle checkbox.amend = 修正(_M)（_ 是助记符）')
  assert.equal(COMMIT_MESSAGE_PLACEHOLDER, '提交消息', 'VcsBundle commit.message.placeholder')
  assert.equal(MESSAGE_HISTORY_TEXT, '提交消息历史记录', 'ActionsBundle action.Vcs.ShowMessageHistory.text')
  assert.equal(MESSAGE_HISTORY_DESCRIPTION, '显示提交消息历史记录', 'ActionsBundle action.Vcs.ShowMessageHistory.description')
  assert.equal(AMEND_SHORTCUT_TEXT, 'Alt+M', '$default.xml:1057-1059 Vcs.ToggleAmendCommitMode = alt M')
  assert.equal(commitBlockMessage('no-message'), '指定提交消息', 'VcsBundle error.no.commit.message')
  assert.equal(commitAnywayLabel(), '仍然提交', 'VcsBundle action.commit.anyway.text = 仍然{0}')
  assert.equal(checksFailedTitle(), '提交 检查失败', 'VcsBundle commit.checks.failed.notification.title = {0} 检查失败')
  assert.equal(RERUN_CHECKS_TOOLTIP, '重新运行提交检查', 'VcsBundle tooltip.rerun.commit.checks')
  assert.equal(CHECKS_FAILED_UNKNOWN, '检查失败', 'VcsBundle label.commit.checks.failed.unknown.reason')
})

test('amend 的浮层是"标题 + 快捷键"（上游那枚复选框没有描述）', () => {
  assert.equal(AMEND_TOOLTIP, '修正(M)（Alt+M）', 'ToggleAmendCommitModeAction.kt:30 把 description 清成 null')
  assert.ok(AMEND_TOOLTIP.includes(AMEND_CHECKBOX_TEXT) && AMEND_TOOLTIP.includes(AMEND_SHORTCUT_TEXT),
    '浮层里的标题与键位都来自常量，不许手写')
})

test('amend 与消息历史在**图例那一行**，消息区自己不带工具条', () => {
  const panel = read('src/components/SourceControl.vue')
  const toolbar = panel.slice(panel.indexOf('<div class="sc-toolbar">'))
  const row = toolbar.slice(0, toolbar.indexOf('</div>\n') > 0 ? toolbar.indexOf('class="sc-the-end"') : toolbar.length)
  const beforeLegend = toolbar.slice(0, toolbar.indexOf('class="sc-legend"'))
  assert.match(beforeLegend, /class="sc-amend"[^>]*>\s*<input v-model="amend"/, '修正(M) 复选框在图例行里')
  assert.match(beforeLegend, /\{\{ AMEND_CHECKBOX_TEXT \}\}/, '文案走常量（不许写死中文）')
  assert.ok(beforeLegend.includes('@click="toggleMessageHistory"'), '消息历史那颗按钮同在图例行（Vcs.MessageActionGroup）')
  assert.ok(!panel.includes('sc-msg-head'), '非模态面板的消息区没有自己的工具条（CommitMessage showToolbar=false）')
  assert.ok(!panel.includes('sc-msg-title'), '连带那一行标题也去掉（withSeparator=false）')
  void row
})

test('上游不存在的「回滚提交信息」已删，连带那套"上次提交信息"持久化', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.ok(!panel.includes('回滚提交信息'), 'platform 里没有这个动作（VcsBundle 也没有对应 key）')
  assert.ok(!panel.includes('rollbackMessage'), '处理器一起删')
  assert.ok(!panel.includes('taocode.commitMsg:'), '本仓自造的持久化键也删掉')
  assert.ok(!panel.includes('默认信息'), '占位文本不是包里的字，已换成 commit.message.placeholder')
})

test('消息历史按钮的名称与说明取自 ShowMessageHistory 那条动作', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /:title="MESSAGE_HISTORY_DESCRIPTION" :aria-expanded="messageHistoryOpen" :aria-label="MESSAGE_HISTORY_TEXT"/,
    'title = 动作说明，aria-label = 动作名')
})

test('占位文本就是包里那一条 —— 没有再编一句本仓提示', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /:placeholder="COMMIT_MESSAGE_PLACEHOLDER"/, '只有一种占位文本（上游两种模式下都是它）')
  assert.ok(!read('src/commitPanelStrings.ts').includes('留空则沿用上次的提交信息'),
    '那句本仓提示随"amend 预填上次信息"一起删了（见 tests/amend-message.test.mjs）')
})

test('那一行只剩上游 VcsToolbarActions 里我们有的两个操作（第四十七批）', () => {
  const panel = read('src/components/SourceControl.vue')
  const row = panel.slice(panel.indexOf('<div class="sc-toolbar">'), panel.indexOf('class="sc-legend"'))
  assert.ok(row.includes('更新项目'), 'Vcs.UpdateProject 在 VcsToolbarActions 里（VcsActions.xml:416-425）')
  assert.match(row, /title="更新项目（Ctrl\+T）"/, 'Ctrl+T 是 Vcs.UpdateProject 自己的键位（VcsActions.xml:49-52）')
  assert.ok(row.includes('>推送<') || /推送<span/.test(row), 'Vcs.Push 也在这个组里')
  assert.match(row, /title="推送（Ctrl\+Shift\+K）"/, 'Vcs.Push 的键位（dvcs-impl 的注册里声明 control shift K）')
  // 只看按钮（注释里会写到被移走的那些名字，不能拿整段文本当判据）
  const buttons = [...row.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1])
  assert.ok(buttons.length >= 2, '这一行至少有更新项目与推送两个按钮')
  const labels = buttons.join(' | ')
  for (const gone of ['获取', '变基', '储藏', '弹出', '提交历史']) {
    assert.ok(!labels.includes(gone), `上游这一行没有「${gone}」，不该在这里重复一份`)
  }
  assert.match(panel, /const updateProject = \(\) => act\(async \(\) => \{ await request\('git\.fetch'\); await request\('git\.pull'\) \}\)/,
    '更新项目 = 先刷新远端再整合（Vcs.UpdateProject）')
})

test('移走的那几个操作仍在 Git 菜单里（上游给它们的位置）', () => {
  const menu = read('src/menus/gitMenu.ts')
  for (const entry of ['git.fetch', 'git.rebase', 'git.stash', 'git.unstash', 'git.update', 'git.push']) {
    assert.ok(menu.includes(`id: '${entry}'`), `Git 菜单缺 ${entry}`)
  }
  const panel = read('src/components/SourceControl.vue')
  assert.ok(!panel.includes('sc-commit-row'), '面板内那份提交历史列表已删（上游是日志工具窗口）')
  assert.ok(menu.includes("run: () => ctx.showView('vcslog')"), '日志工具窗口是它的上游位置（Git 菜单 → 显示日志）')
})

test('变更树头部那对按钮 = 上游的 header 动作（全部展开 / 全部收起）', () => {
  assert.equal(EXPAND_ALL_TEXT, '全部展开', 'ActionsBundle action.ExpandAll.text')
  assert.equal(COLLAPSE_ALL_TEXT, '全部收起', 'ActionsBundle action.CollapseAll.text（包里是「收起」不是「折叠」）')
  const panel = read('src/components/SourceControl.vue')
  const head = panel.slice(panel.indexOf('<div class="sc-changes-head">'), panel.indexOf('<div class="sc-toolbar">'))
  assert.ok(head.includes('{{ EXPAND_ALL_TEXT }}') && head.includes('{{ COLLAPSE_ALL_TEXT }}'), '两个按钮的文案走常量')
  assert.match(head, /aria-label="全部收起" @click="changesCollapsed = true"/, '收起 = 把分组里的行收起来')
  assert.match(head, /aria-label="全部展开" @click="changesCollapsed = false"/)
  assert.ok(head.includes(':disabled="busy || !hasGroups"'), '可见性/可用性照 isExpandAllVisible()（有分组才成立）')
  assert.match(panel, /const hasGroups = computed\(\(\) => changes\.value\.length > 0\)/, '本仓的分组就是已暂存/更改两组')
  // 折叠的是行，不是整块（组节点留着）——上游收起的是树的子节点
  assert.ok(!panel.includes('v-show="!changesCollapsed" class="sc-scroll"'), '整块滚动区不该被隐藏')
  // 第一百一十二批起这两段按「分组依据」分组渲染，行循环变成 `group.changes` ——
  // 判的东西没变：行仍然随折叠显隐（折叠的是行，不是整块）。
  assert.match(panel, /v-for="change in group\.changes" v-show="!changesCollapsed"/, '分组的行随折叠显隐')
  assert.match(panel, /v-for="change in group\.changes" v-show="!changesCollapsed"/, '未暂存那一组同样随折叠显隐')
})

test('分支/检出/合并/删除/比较 不在面板里（上游位置 = 分支弹窗，本仓已有）', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.ok(!panel.includes('新建并切换到分支') && !panel.includes('合并所选分支到当前分支'), '合并/删除分支的按钮已删')
  assert.ok(!panel.includes('与分支比较…'), '比较的下拉已删（触发点在上游是分支弹窗）')
  assert.match(panel, /watch\(\(\) => props\.compareWith/, '弹窗选一行 ⇒ 宿主设 compareWith ⇒ 面板跑一次')
  const popup = read('src/branchPopup.ts')
  for (const id of ['checkout', 'compare', 'merge', 'delete']) {
    assert.ok(popup.includes(`id: '${id}'`), `分支弹窗缺 ${id}`)
  }
})

test('重新格式化提交信息接上上游键位（Vcs.ReformatCommitMessage 借 ReformatCode = Alt+L）', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /@keydown\.alt\.l\.prevent="reformatMessage"/, '提交信息框上绑定 Alt+L')
})
