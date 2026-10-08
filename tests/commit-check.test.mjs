import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commitBlockMessage, commitBlockReason, commitIncludedCount } from '../src/commitCheck.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// NonModalCommitWorkflowHandler.checkCommit() (:177-184) sets isEmptyChanges / isEmptyMessage.
test('nothing staged and no message reports both missing preconditions', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: false, amend: false }), 'no-changes-no-message')
  assert.equal(commitBlockMessage('no-changes-no-message'), '选择要提交的文件并指定提交消息', 'VcsBundle error.no.changes.no.commit.message（中文包原文）')
})

test('a staged file with no message only complains about the message', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: true, hasMessage: false, amend: false }), 'no-message')
  assert.equal(commitBlockMessage('no-message'), '指定提交消息', 'VcsBundle error.no.commit.message（中文包原文）')
})

test('a message with nothing staged only complains about the files', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: true, amend: false }), 'no-changes')
  assert.equal(commitBlockMessage('no-changes'), '选择要提交的文件')
})

test('a staged file plus a message passes the check', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: true, hasMessage: true, amend: false }), null)
  assert.equal(commitBlockMessage(null), '')
})

// NonModalAmendCommitHandler.kt:51 — an amend is exempt from the changes requirement.
test('amending needs no staged changes but still needs a message', () => {
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: false, amend: true }), null)
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: true, amend: true }), null)
  assert.equal(commitBlockReason({ hasStagedChanges: true, hasMessage: true, amend: true }), null)
})

test('every reason has a label and passing has none', () => {
  const reasons = ['no-changes', 'no-message', 'no-changes-no-message']
  for (const reason of reasons) assert.notEqual(commitBlockMessage(reason), '')
  assert.equal(commitBlockMessage(null), '')
})

// ── R1 补完（commit2）：部分提交时"有没有内容"问的是**这次包含的那一批 ──────────────
// 上游 `AbstractCommitWorkflowHandler.kt:82`：
//   isCommitEmpty() = getIncludedChanges().isEmpty() && getIncludedUnversionedFiles().isEmpty()
// ⇒ 只选了未跟踪的新文件也是"有内容"，而按整份暂存区判会错报「选择要提交的文件」。
// 范围本身由 `CheckinActionUtil.kt:135-136` 的 `setCommitState(initialChangeList, included, …)` 定。

const changeRow = (path, extra = {}) => ({ path, staged: false, untracked: false, ...extra })

test('includedCount：范围里算了什么（未跟踪的新文件也算、目录算它下面每一行）', () => {
  const rows = [changeRow('m.ts', { staged: true }), changeRow('new.ts', { untracked: true }),
    changeRow('src/a.ts'), changeRow('src/deep/b.ts'), changeRow('other.ts')]
  assert.equal(commitIncludedCount(rows), null, '没有范围 = 不做这一档（调用方照旧按整份暂存区判）')
  assert.equal(commitIncludedCount(rows, []), null, '空范围也是"没有范围"（空 paths ⇒ 走全量）')
  assert.equal(commitIncludedCount(rows, ['new.ts']), 1, '只选未跟踪的新文件 ⇒ 1 条，不是 0')
  assert.equal(commitIncludedCount(rows, ['src']), 2, '选中目录算它下面的每一行（git 的 pathspec 语义）')
  assert.equal(commitIncludedCount(rows, ['src', 'src/a.ts']), 2, '目录和它的子项一起给不重复计数')
  assert.equal(commitIncludedCount(rows, ['ghost.ts']), 0, '对不上任何变更 = 这次真的没内容')
})

test('范围进判据：只选中新文件不再误报「选择要提交的文件」；没给范围时逐字旧行为', () => {
  // 整份暂存区是空的，但这次提交包含一个未跟踪的新文件 ⇒ 上游认为不空。
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: true, amend: false, includedCount: 1 }), null)
  assert.equal(commitBlockReason({ hasStagedChanges: true, hasMessage: true, amend: false, includedCount: 0 }), 'no-changes',
    '范围里一条都没对上 ⇒ 仍然报「选择要提交的文件」')
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: false, amend: false, includedCount: 0 }),
    'no-changes-no-message')
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: true, amend: false, includedCount: null }),
    'no-changes', 'null = 没有范围这一档 ⇒ 与本批之前逐字一致')
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: true, amend: false }), 'no-changes',
    '连这个入参都不给 = 同样旧行为')
  assert.equal(commitBlockReason({ hasStagedChanges: false, hasMessage: true, amend: true, includedCount: 0 }), null,
    '修正提交（amend）本来就不要求有内容（NonModalAmendCommitHandler.kt:51）')
})

test('接线：检查宿主把范围接到空判上，没接时交 null 而不是替宿主编一个范围', () => {
  const host = read('src/sourceControlCommitChecks.ts')
  assert.match(host, /commitScope\?: \(\) => readonly string\[\]/, '可选入参：宿主没接之前恒为 undefined')
  assert.match(host, /includedCount: commitScope \? commitIncludedCount\(changes\.value, commitScope\(\)\) : null/,
    '没给范围 ⇒ 交给空判的是 null，判据落回整份暂存区')
  // 按实现的真实锚点写（2026-10-07）：文案那半已搬到 `checkinHandlers.ts` 的 `cancelMessage`
  // （`git diff` 里 `commitCheckError.value = commitBlockMessage(reason)` 那行随之移走），
  // 本宿主只留判定要用的两个值。意图不变：**值的 import 必须带 `.ts` 扩展名**
  // （本仓的三条语法坑之一），缺扩展名会在 Node 的 ESM 解析期整片变红。
  assert.match(host, /import \{ commitBlockReason, commitIncludedCount \} from '\.\/commitCheck\.ts'/,
    '值的 import 带 .ts 扩展名（本仓的三条语法坑之一）')
  assert.doesNotMatch(host, /includedCount: 0/, '不许在检查宿主里替范围编一个常数')
})
