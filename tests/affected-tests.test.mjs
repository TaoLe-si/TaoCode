// exec/junit：变更列表受影响的测试（`src/affectedTests.ts`）的判据。
//
// 上游依据：`plugins/junit/src/com/intellij/execution/junit/testDiscovery/TestsByChanges.java:9-21`
// （`getChangeList` 非空、`getPosition` 为 null）、
// `java/vcs/src/com/intellij/execution/testDiscovery/AffectedTestsInChangeListPainter.java:33-43`
// （空列表不画、`Find Affected Tests` 链接）、`ShowAffectedTestsAction.showDiscoveredTestsByChanges`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const {
  affectedTestFiles, affectedTestPaths, affectedChangeName, affectedTestsNote, FIND_AFFECTED_TESTS_TEXT,
} = await import('../src/affectedTests.ts')

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const entries = [
  { path: 'src/Main.java', kind: 'file' },
  { path: 'tests/MainTest.java', kind: 'file' },
  { path: 'src/Util.java', kind: 'file' },
  { path: 'tests/UtilTest.java', kind: 'file' },
  { path: 'tests/OtherTest.java', kind: 'file' },
]

test('变更的本身就是测试 ⇒ 它自己受影响（weight 0）', () => {
  const hits = affectedTestFiles([{ path: 'tests/MainTest.java' }], entries)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].testPath, 'tests/MainTest.java')
  assert.equal(hits[0].changedPath, 'tests/MainTest.java')
  assert.equal(hits[0].reason, 'changed-test')
  assert.equal(hits[0].weight, 0)
})

test('变更的是被测文件 ⇒ 按名字找到它的测试（JavaTestFinder 的名字包含 + 邻近度）', () => {
  const hits = affectedTestFiles([{ path: 'src/Main.java' }], entries)
  assert.deepEqual(hits.map(hit => hit.testPath), ['tests/MainTest.java'])
  assert.equal(hits[0].reason, 'name-match')
})

test('多个变更、去重、排序：本身就是测试的在前，其余按 weight', () => {
  const hits = affectedTestFiles([
    { path: 'src/Main.java' },
    { path: 'tests/UtilTest.java' },
    { path: 'src/Main.java' },   // 重复变更项不重复出
  ], entries)
  assert.deepEqual(hits.map(hit => `${hit.changedPath}=>${hit.testPath}`), [
    'tests/UtilTest.java=>tests/UtilTest.java',
    'src/Main.java=>tests/MainTest.java',
  ])
  assert.deepEqual(affectedTestPaths(hits), ['tests/UtilTest.java', 'tests/MainTest.java'])
})

test('空变更列表 ⇒ 空命中，且说明为什么', () => {
  const hits = affectedTestFiles([], entries)
  assert.deepEqual(hits, [])
  assert.equal(affectedTestsNote([], hits), '当前没有本地更改，没有受影响的测试。')
  assert.equal(affectedChangeName({ path: 'src/Main.java' }), 'Main', '显示名 = 去扩展名的文件主干（baseNameOfPath）')
})

test('有关联但没发现测试 ⇒ 说明白（不静默）', () => {
  const hits = affectedTestFiles([{ path: 'src/Lonely.java' }], entries)
  assert.deepEqual(hits, [])
  assert.match(affectedTestsNote([{ path: 'src/Lonely.java' }], hits), /没在其中或按名字找到/)
  assert.equal(FIND_AFFECTED_TESTS_TEXT, '查找受影响的测试')
})

test('反斜杠路径归一（Windows 的 git 输出）', () => {
  const hits = affectedTestFiles([{ path: 'src\\Main.java' }], entries)
  assert.deepEqual(hits.map(hit => hit.testPath), ['tests/MainTest.java'])
})

test('接线：面板有「受影响的测试」按钮，变更来自 git.status', () => {
  const panel = read('src/components/TestRunnerPanel.vue')
  assert.match(panel, /affectedTestFiles\(/, '面板要调受影响测试的规则')
  assert.match(panel, /git\.status/, '变更列表来自宿主 git.status')
  assert.match(panel, /FIND_AFFECTED_TESTS_TEXT/, '按钮文案复用上游那条链接文案')
})