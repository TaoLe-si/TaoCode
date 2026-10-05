// dm/quickfix 的判据（一）：本地抑制的即时过滤器（`src/localSuppressions.ts`）。
// 上游依据：`SuppressIntentionAction` 应用后 daemon 立即重跑、问题表同步变短；
// 本仓在 LSP 重发布之前用这张表先隐去该行，重发布确认不报（或超时）后记录脱落。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clearLocalSuppressions, isLocallySuppressed, locallySuppressed, noteLocalSuppression,
  reconcileLocalSuppressions, SUPPRESSION_HIDE_MS, suppressionRowKey,
} from '../src/localSuppressions.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const row = (over = {}) => ({ path: 'src/a.ts', line: 3, message: 'm', source: 'eslint', ...over })

test('记账键按路径归一化，行/来源/消息各自独立', () => {
  assert.equal(suppressionRowKey(row({ path: 'src\\a.ts' })), suppressionRowKey(row({ path: 'src/a.ts' })))
  assert.notEqual(suppressionRowKey(row()), suppressionRowKey(row({ line: 4 })))
  assert.notEqual(suppressionRowKey(row()), suppressionRowKey(row({ source: 'jdt' })))
  assert.notEqual(suppressionRowKey(row()), suppressionRowKey(row({ message: 'other' })))
})

test('记录后立即隐藏；重复记录不重复入表', () => {
  clearLocalSuppressions()
  const now = 1_000
  assert.equal(isLocallySuppressed(row(), now), false)
  noteLocalSuppression(row(), now)
  noteLocalSuppression(row(), now)
  assert.equal(locallySuppressed.value.length, 1)
  assert.equal(isLocallySuppressed(row(), now + 100), true)
  assert.equal(isLocallySuppressed(row({ line: 9 }), now + 100), false)
  clearLocalSuppressions()
})

test('超时自动失效：语言服务不认抑制时不无限期隐藏', () => {
  clearLocalSuppressions()
  noteLocalSuppression(row(), 5_000)
  assert.equal(isLocallySuppressed(row(), 5_000 + SUPPRESSION_HIDE_MS - 1), true)
  assert.equal(isLocallySuppressed(row(), 5_000 + SUPPRESSION_HIDE_MS), false)
  // 对账也会顺手清掉到期记录。
  reconcileLocalSuppressions([row()], 5_000 + SUPPRESSION_HIDE_MS)
  assert.equal(locallySuppressed.value.length, 0)
  clearLocalSuppressions()
})

test('对账：语言服务重发布后不含该诊断 ⇒ 记录脱落；仍含 ⇒ 继续隐藏', () => {
  clearLocalSuppressions()
  const now = 10_000
  noteLocalSuppression(row(), now)
  // 重发布仍带这条（服务器还没重算）：记录留着，继续隐藏。
  reconcileLocalSuppressions([row()], now + 50)
  assert.equal(isLocallySuppressed(row(), now + 50), true)
  // 重发布已不含这条（抑制真的生效）：记录丢掉，之后不再隐藏。
  reconcileLocalSuppressions([row({ line: 9 })], now + 100)
  assert.equal(locallySuppressed.value.length, 0)
  assert.equal(isLocallySuppressed(row(), now + 100), false)
  clearLocalSuppressions()
})

test('消费链：面板在渲染侧过滤，对账用未过滤列表；聚合表本身不动', () => {
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /isLocallySuppressed/)
  assert.match(panel, /reconcileLocalSuppressions\(rows\)/)
  assert.match(panel, /noteLocalSuppression\(menu\.row\)/)
  const problems = read('src/problems.ts')
  assert.doesNotMatch(problems, /locallySuppressed|localSuppress/, '本地抑制是面板侧的即时隐去，不改聚合表')
})
