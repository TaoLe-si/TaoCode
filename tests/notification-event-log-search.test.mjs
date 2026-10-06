// 通知工具窗口（Event Log）那把**搜索框**的两条用户可见行为：
//   1. 过滤：`eventLogSections(entries, query)` 只留命中的行（上游 `NotificationComponent.matchQuery`，
//      `NotificationsPanel.kt:1347-1364` —— 大小写无关的子串，依次看标题/副标题/正文/动作文字；
//      本仓的等价映射在 `src/notificationEventLog.ts:54-60`）。
//   2. 零命中的**当场报警**：上游 `doSearch()` 把搜索框的底色换成红
//      （`NotificationsPanel.kt:461`：`searchField.textEditor.background = if (result) background else LightColors.RED`），
//      而不是只让列表变空；空串走 `clearSearch()`（`:447-451`）⇒ 只有"有字且零命中"才报警。
//   3. 取消：那个输入框的 `preprocessEventForTextField` 认 Esc —— `isVisible = false` +
//      `searchController.cancelSearch()`（`NotificationsPanel.kt:198-201`）。本仓搜索框常驻
//      （上游是齿轮动作 `startSearch()` 才显形，`:231-234`；这一处宿主差异记在批次报告里），
//      于是 Esc 兑现的是 `cancelSearch()` 那一半：把过滤器清空。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVENT_LOG_EMPTY_LINES, eventLogSections, showsNoticeEmptyText } from '../src/notificationEventLog.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const panel = readFileSync(join(root, 'src/components/EventLogPanel.vue'), 'utf8')

const notice = (id, message, extra = {}) => ({ id, message, error: false, at: '10:00', ...extra })

test('过滤：命中的留下、没命中的整段消失（空段不画那条一并生效）', () => {
  const entries = [notice(1, 'Gradle 同步完成'), notice(2, '语言服务已重启'), notice(3, '磁盘上有未保存的修改')]
  const idsOf = (query) => eventLogSections(entries, query).flatMap(section => section.entries.map(item => item.id))
  assert.deepEqual(idsOf('gradle'), [1], '只留命中的那一条')
  assert.deepEqual(idsOf('同步'), [1], '子串命中不要求整词')
  assert.deepEqual(idsOf('  GRADLE  '), [1], '大小写无关 + 首尾空格不算字')
  assert.deepEqual(idsOf(''), [1, 2, 3], '空查询 = 全留（上游 `doSearch` 空串直接 clearSearch）')
  assert.deepEqual(eventLogSections(entries, '没有这种字'), [], '零命中 ⇒ 两段都不画')
})

test('过滤也看正文细节与动作文字（上游 matchQuery 的那四处）', () => {
  const entries = [
    notice(1, '构建失败', { detail: ['Execution failed for task :app:compile'] }),
    notice(2, '有更新', { actions: [{ label: '停止 Gradle 服务器', run: () => {} }] }),
  ]
  assert.deepEqual(eventLogSections(entries, 'compile')[0].entries.map(item => item.id), [1], 'detail 里命中')
  assert.deepEqual(eventLogSections(entries, '停止')[0].entries.map(item => item.id), [2], '动作文字里命中')
})

test('接线：零命中把报警底色画在搜索框上，不是只让列表变空', () => {
  // 判据钉的是"命中与否真的参与渲染"，不是钉一个字符串形状：计算属性 + 类绑定 + CSS 那条都得在。
  assert.match(panel, /const searchHasNoMatch = computed\(\(\) => query\.value\.trim\(\) !== '' && sections\.value\.length === 0\)/,
    '「有字且零命中」这一条判据没落成计算属性')
  assert.match(panel, /:class="\{ 'no-match': searchHasNoMatch \}"/, '计算属性没接到搜索框的类上')
  assert.match(panel, /\.eventlog-search\.no-match \{[^}]*var\(--error-bg\)/, '零命中的底色要走令牌，不铺裸色')
  assert.doesNotMatch(panel, /\.eventlog-search\.no-match[^}]*#[0-9a-f]{3,8}/i, '样式里不许出现裸 hex')
})

test('接线：Esc 清空过滤器（上游 cancelSearch 那一半）', () => {
  assert.match(panel, /@keydown\.esc\.stop="query = ''"/, '搜索框上的 Esc 没有接"清空过滤器"')
})

// —— 空日志时的那两句占位（2026-10-06 桶 status2 按上游订正：原写的是本仓自造的
//    「没有通知。」/「没有匹配的通知。」，上游没有这两句）——
//   · `NotificationsPanel.kt:264-268` 的 `setEmptyState()` 用两个 `appendLine` 装
//     `notifications.toolwindow.empty.text.first.line` / `.second.line`
//     （英文 `platform/platform-api/resources/messages/IdeBundle.properties:3109/3110`，
//      中文包 `messages/IdeBundle.properties:1725/1726`）；`:145` 建面板时就装上，
//   · `startSearch()` 里 `clearEmptyState()`（`:437`）、`cancelSearch()` 里 `setEmptyState()`（`:472`）
//     ⇒ **搜索进行中不给占位**，那时"搜不到"由搜索框那条红报警（`:461`，上面第 3 条已钉）。
test('空态两句是上游 bundle 的原文，且只在"整份日志为空 + 没在搜索"时给', () => {
  assert.deepEqual([...EVENT_LOG_EMPTY_LINES], ['建议、事件，', '以及错误将出现在这里'])
  assert.equal(showsNoticeEmptyText([], ''), true, '一条都没有 ⇒ 上游那两句')
  assert.equal(showsNoticeEmptyText([], '   '), true, '只有空格不算查询（同 `clearSearch()` 的判据）')
  assert.equal(showsNoticeEmptyText([], 'gradle'), false, '搜索进行中收掉占位（`startSearch()` 的 clearEmptyState）')
  assert.equal(showsNoticeEmptyText([notice(1, 'Gradle 同步完成')], ''), false, '有内容就没有占位')
})

test('接线：占位渲染的就是那两句，自造文案已清掉', () => {
  assert.match(panel, /v-if="showsNoticeEmptyText\(entries, query\)"/, '那两道判据没接到模板上')
  assert.match(panel, /EVENT_LOG_EMPTY_LINES" :key="index" class="eventlog-empty-line"/, '两句没有各占一行')
  assert.match(panel, /\.eventlog-empty-line \{ display: block; \}/, '上游是两行（两个 appendLine），得各占一行')
  assert.doesNotMatch(panel, /没有通知。|没有匹配的通知。/, '上游没有这两句中文 —— 自造文案')
})
