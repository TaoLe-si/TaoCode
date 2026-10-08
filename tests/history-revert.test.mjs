// 本地历史**回滚路径**（重点③）两项修复的判据，外加保留期事实（重点①）与「假档」回归守卫（重点②）。
// 上游坐标在 src/historySessions.ts 与 src/components/HistoryPanel.vue 的注释里，本文件只核行为形状。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import {
  REVERT_SKIP_LABELS, buildSessionFiles, describeRevertSkips, missingFromDiskPaths,
  revertRouteFor, revertSkipFor, sessionRevertReport, tallyRevertSkips,
} from '../src/historySessions.ts'

const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const HOUR = 60 * 60 * 1000
const NOW = 1_760_000_000_000
const snap = (id, hoursAgo) => ({ id, reason: 'save', bytes: 3, timeMillis: NOW - hoursAgo * HOUR, time: id })
const change = (path, extra = {}) => ({
  path, indexStatus: 'M', workStatus: 'M', staged: false, untracked: false, renameFrom: '', ...extra,
})

test('回滚落点三档：活动文件走宿主、盘上的别的文件直写、不在盘上的不动', () => {
  const gone = missingFromDiskPaths([change('src/new.ts', { indexStatus: 'R', workStatus: 'R', renameFrom: 'src/old.ts' })])
  assert.equal(revertRouteFor({ path: 'src/a.ts' }, 'src/a.ts', gone), 'host', '活动文件必须仍交宿主链')
  assert.equal(revertRouteFor({ path: 'src/b.ts' }, 'src/a.ts', gone), 'direct', '别的在盘上的文件是可回滚的（上游目录对话框就是如此）')
  assert.equal(revertRouteFor({ path: 'src/old.ts' }, 'src/a.ts', gone), 'none', '重命名前身已不在磁盘上，写它就是凭空造文件')
  assert.equal(revertRouteFor(null, 'src/a.ts', gone), 'none', '没选中就没有落点')
  // 反证：空集合里"别的文件"一律 direct —— 这条判据真在听 missingFromDisk 说话，不是硬编码路径。
  assert.equal(revertRouteFor({ path: 'src/old.ts' }, 'src/a.ts', new Set()), 'direct')
  // 反证：宿主给的是反斜杠写法时仍算同一个文件（路径口径不分叉）。
  assert.equal(revertRouteFor({ path: 'src\\a.ts' }, 'src/a.ts', gone), 'host')
})

test('不在磁盘上的路径 = renameFrom 的旧名 ∪ porcelain 的 D 行', () => {
  const gone = missingFromDiskPaths([
    change('src/n.ts', { renameFrom: 'src/o.ts' }),
    change('gone.ts', { indexStatus: 'D', workStatus: ' ' }),
    change('gone2.ts', { indexStatus: 'M', workStatus: 'D' }),
    change('kept.ts'),
    change('nope', { renameFrom: '' }),
  ])
  assert.deepEqual([...gone].sort(), ['gone.ts', 'gone2.ts', 'src/o.ts'], `实际 ${JSON.stringify([...gone])}`)
  // 反证：普通修改行绝不能被当成"已删除"，否则会话视图就没人能回滚了。
  assert.equal(gone.has('kept.ts'), false)
  assert.equal(gone.has(''), false, '空 renameFrom 不该占一个位置')
})

test('只读前置检查顶在上游 checkCanRevert() 的位置，内容已一致排它前面', () => {
  assert.equal(revertSkipFor({}), null, '什么都没挡 ⇒ 允许写（反证：别把正常文件判成跳过）')
  assert.equal(revertSkipFor({ readOnly: true }), 'read-only')
  assert.equal(revertSkipFor({ readOnly: true, unchanged: true }), 'unchanged', '无需写就不必谈只读')
  assert.equal(revertSkipFor({ readOnly: undefined }), null, '只读位缺失（宿主没给）不算只读')
})

test('写失败按宿主错误码分档，catch 里永不出 null', () => {
  assert.equal(revertSkipFor({ code: 'CONFLICT' }), 'conflict')
  assert.equal(revertSkipFor({ code: 'READ_ONLY' }), 'read-only')
  assert.equal(revertSkipFor({ code: 'NOT_FOUND' }), 'failed')
  assert.equal(revertSkipFor({ code: '' }), 'failed', '非 BridgeError 的抛出也要有一档可报')
  assert.equal(revertSkipFor({ code: null }), 'failed')
})

test('跳过原因汇总：先说拦路的，再说本来就不用动的', () => {
  const reasons = ['read-only', 'read-only', 'conflict', 'unchanged', 'failed', 'failed', 'failed']
  const tally = tallyRevertSkips(reasons)
  assert.deepEqual(tally, { 'read-only': 2, conflict: 1, unchanged: 1, failed: 3 })
  assert.equal(describeRevertSkips(tally), '只读 2、磁盘已变 1、内容已一致 1、写不进去 3')
  assert.equal(describeRevertSkips(tallyRevertSkips([])), '', '没有原因就是空串')
  assert.deepEqual(Object.keys(REVERT_SKIP_LABELS).sort(), ['conflict', 'failed', 'read-only', 'unchanged'])
})

test('会话回滚状态行报实数，不再把四种原因混成一句', () => {
  assert.equal(sessionRevertReport(2, []), '会话回滚：已回退 2 个文件。')
  assert.equal(sessionRevertReport(1, ['read-only', 'unchanged']),
    '会话回滚：已回退 1 个文件，跳过 2 个（只读 1、内容已一致 1）。')
  // 反证：旧那句"无更早版本、内容已一致或写不进去"把只读藏了起来，必须不再出现。
  assert.doesNotMatch(sessionRevertReport(0, ['read-only']), /无更早版本、内容已一致或写不进去/)
})

test('面板真的挂上了三档落点与只读前置检查（不是死代码）', () => {
  const panel = readFileSync('src/components/HistoryPanel.vue', 'utf8')
  // 钉挂点（表达式 / 事件绑定），不钉符号名 —— 只 import 不用的假接线要能被照出来。
  assert.match(panel, /const revertRoute = computed<RevertRoute>\(\(\) => revertRouteFor\(selected\.value, props\.path, goneFromDisk\.value\)\)/,
    '落点由 selected + 活动路径 + 不在盘上的集合算')
  assert.match(panel, /@click="revertSelected"/, '按钮的点击走新的分档入口')
  assert.match(panel, /:disabled="reverting \|\| !canRevert"/, '写盘期间按钮不可再点')
  assert.match(panel, /if \(revertRoute\.value === 'host'\) \{ emit\('revert', row\.entry\); return \}/,
    '活动文件仍交宿主链（只有它会重建编辑器缓冲并重记历史）')
  assert.match(panel, /revertSkipFor\(\{ readOnly: current\.readOnly, unchanged: current\.content === snapshot\.content \}\)/,
    '写之前先做上游那句只读检查')
  assert.match(panel, /saveFailureFor\('READ_ONLY'/, '只读文案沿用 src/appSaveFailure.ts 那一句，不另编一套')
  assert.match(panel, /goneFromDisk\.value = missingFromDiskPaths\(changedPaths\)/, '不在盘上的集合来自同一次 git.status')
  assert.match(panel, /sessionRevertReport\(done, reasons\)/, '会话状态行由原因算')
  assert.match(panel, /reasons\.push\(skipReasonFrom\(caught\)\)/, '写失败按错误码归类，不再一律算"跳过"')
  // 反证：偏差 A 那句死路文案（"请先打开该文件再看它的历史"）不该还留着。
  assert.doesNotMatch(panel, /请先打开该文件再看它的历史/, '别的文件已可直写，不该再指这条路')
})

test('回滚结果必须写在 await load() 之后（load 一开头就清空提示位）', () => {
  const panel = readFileSync('src/components/HistoryPanel.vue', 'utf8')
  for (const name of ['async function revertSelected()', 'async function restoreSession()']) {
    const start = panel.indexOf(name)
    assert.ok(start >= 0, `面板里找不到 ${name}`)
    const end = panel.indexOf('\n}', start)
    const body = panel.slice(start, end)
    const reload = body.lastIndexOf('await load()')
    // 用**最后**一次落提示的那句：函数开头的守卫句（"这个时刻之前没有更早的版本可回退"）本来就在刷新前，
    // 拿它比会误判 —— 要管的是这一次操作的结果到底看不看得见。
    const note = Math.max(body.lastIndexOf('restoreMessage.value ='), body.lastIndexOf('error.value = saveFailureFor'))
    assert.ok(reload >= 0, `${name}：没有刷新这一步`)
    assert.ok(note > reload, `${name}：提示写在 load() 之前会被 load 的清空抹掉（用户看不到结果）`)
  }
  // 反证：活动文件那条仍走宿主链，且在重挂之前不发多余的汇总（宿主自己 notify）。
  assert.match(panel, /if \(own\) \{\n\s+\/\/ 活动文件也在清单里[\s\S]*?emit\('revert', own\.entry\)\n\s+return\n\s+\}/,
    '会话里含活动文件时交给宿主链，不重复写留不住的提示')
})

test('会话行仍按自己的路径取差异，直写只碰磁盘上不消失的文件', () => {
  const files = buildSessionFiles([
    { path: 'a.ts', entries: [snap('a2', 1), snap('a1', 6)] },
    { path: 'b.ts', entries: [snap('b1', 2)] },
  ])
  assert.deepEqual(files.map(file => file.path), ['a.ts', 'b.ts'])
  assert.equal(files[0].versions, 2)
})

// —— 重点②的回归守卫：本族**没有**任何持久化键，所以也不许出现"设置了但不生效"的假档。
// 将来谁加了保留期/容量设置，必须同时有 native 侧的消费者，否则这条红。
test('本地历史没有假档：任何持久化的本地历史键都必须有 native 消费者', () => {
  const keyDecls = [
    ['native/settings_schema.cpp', /"(localHistory|daysToKeep)[A-Za-z0-9_.]*"/gi],
    ['src/registryKeys.ts', /key:\s*'(localHistory|lvcs|history)[.\w-]*'/gi],
    ['src/settingsModel.ts', /\b(localHistory|daysToKeep)[A-Za-z0-9_]*/g],
  ]
  const consumers = readFileSync('native/history.cpp', 'utf8') + readFileSync('native/main.cpp', 'utf8')
  const found = []
  for (const [file, pattern] of keyDecls) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) found.push(`${file}: ${match[0]}`)
  }
  for (const entry of found) {
    const name = entry.split(': ')[1].replace(/["']/g, '')
    assert.ok(consumers.includes(name), `假档：${entry} 有键位却没有 native 消费者（${name} 在 native/history*.cpp 里没人读）`)
  }
  // 今天的实情一条：一个键都没有 ⇒ 上面那个循环空转 ⇒ 这一句负责让它不是空转。
  assert.equal(found.length, 0, `本族已有 ${found.length} 个持久化键（${found.join('，')}）：请同步补 native 消费与本文件的上游事实登记`)
  // 面板不许悄悄落 localStorage —— 本族没有任何持久化位。
  assert.doesNotMatch(readFileSync('src/components/HistoryPanel.vue', 'utf8'), /localStorage/,
    '本地历史面板没有持久化位；要加就得先有缺键补默认的读盘路径')
})

// —— 重点①：上游保留期事实钉死（参考树在位才核，与 tests/source-citations.test.mjs 同口径）。
test('上游保留期就一个 advancedSetting：localHistory.daysToKeep 默认 5 天', () => {
  if (!existsSync(REF)) return
  const xml = readFileSync(`${REF}/platform/lvcs-impl/resources/intellij.platform.lvcs.impl.xml`, 'utf8')
  assert.match(xml, /<advancedSetting id="localHistory\.daysToKeep" default="5"/,
    '键名与默认值（5 天）是这一族唯一的保留期设置')
  assert.doesNotMatch(xml, /registryKey key="localHistory\./, '容量那侧没有 localHistory.* 注册表键（老 LocalHistoryConfiguration 一族已经不在这棵树里）')
  const bundle = readFileSync(`${REF}/platform/ide-core/resources/messages/ApplicationBundle.properties`, 'utf8')
  assert.match(bundle, /^advanced\.setting\.localHistory\.daysToKeep=Duration of storing changes in Local History$/m)
  assert.match(bundle, /^advanced\.setting\.localHistory\.daysToKeep\.trailingLabel=days$/m)
  const impl = readFileSync(`${REF}/platform/lvcs-impl/src/com/intellij/history/core/ChangeListImpl.kt`, 'utf8')
  assert.match(impl, /private const val DEFAULT_DAYS_TO_KEEP = 5/, '代码兜底与注册值同一个数')
  // 本仓实情（2026-10-06 histdays 落地后订正）：宿主已按天过期 —— `first_obsolete_index` 是
  // `PersistentChangeListStorage.kt:308-329` 的逐句等价物，`History::record` 的 trim 先按活动时长、
  // 再按条数封顶。原哨兵（"宿主没有按天过期"）钉的是落地前的现状，实现到位后按行为改写。
  const native = readFileSync('native/history.cpp', 'utf8')
  assert.match(native, /first_obsolete_index\(/, '按天过期用的是上游 findFirstObsoleteBlock 的口径')
  assert.match(native, /days_to_keep_ \* 24LL \* 60LL \* 60LL \* 1000LL/, 'period = daysToKeep 天换算毫秒（ChangeListImpl.kt:118）')
  assert.match(native, /while \(versions\.size\(\) > max_versions_\)/, '条数上限这一种裁剪仍然保留')
})
