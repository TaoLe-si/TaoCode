// `pv/command` 族：应用级命令栈（UndoManagerImpl / CommandMerger / UndoableGroup 的等价物）。
// 每条断言的右边是上游坐标，改判据前先去看那段源码。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  commandMenuText, getCommandProcessor, resetCommandProcessor,
  COMMAND_NAME_MAX, DOCUMENT_UNDO_LIMIT, GLOBAL_UNDO_LIMIT, UNDO_TEXTS,
} from '../src/pvCommandProcessor.ts'

const scratchRoot = () => `scratch:${Math.random().toString(36).slice(2)}`

/** 造一条命令：每个 step 记一笔 undo/redo 流水，断言执行次序与配对用得上。 */
function step(log, name, paths, extra = {}) {
  return {
    paths,
    undo: () => { log.push(`undo:${name}`) },
    redo: () => { log.push(`redo:${name}`) },
    ...extra,
  }
}

test('栈深上限照抄上游 registry（global=10 / document=100）', () => {
  assert.equal(GLOBAL_UNDO_LIMIT, 10)
  assert.equal(DOCUMENT_UNDO_LIMIT, 100)
  assert.equal(COMMAND_NAME_MAX, 30)
})

test('菜单文本按 undo.command=「撤消{0}」拼，空名回落 action.undo.description.empty', () => {
  assert.equal(commandMenuText('undo', '粘贴副本'), '撤消粘贴副本')
  assert.equal(commandMenuText('redo', '粘贴副本'), '重做粘贴副本')
  assert.equal(commandMenuText('undo', null), `撤消${UNDO_TEXTS.undoEmptyName}`)
  assert.equal(commandMenuText('redo', null), `重做${UNDO_TEXTS.redoEmptyName}`)
  // UndoManagerImpl:362 的 StringUtil.first(desc, 30, true)：长名字截到 30 个字符。
  const long = 'x'.repeat(40)
  assert.equal(commandMenuText('undo', long), `撤消${'x'.repeat(COMMAND_NAME_MAX)}`)
})

test('同名同组的相邻命令并成一笔撤销，撤销按倒序跑（UndoableGroup:264）', async () => {
  const root = scratchRoot()
  const log = []
  const processor = getCommandProcessor(root)
  const first = processor.record({ name: '新建', groupId: 'new', steps: [step(log, 'a', ['a.txt'])] })
  assert.equal(first, 'NEW_COMMAND')
  const second = processor.record({ name: '新建', groupId: 'new', steps: [step(log, 'b', ['b.txt'])] })
  assert.equal(second, 'NOTHING_TO_FLUSH', '同 groupId 不该封口')
  assert.equal(processor.size().undo, 1, '并进来的两步还是同一组')
  const result = await processor.undo()
  assert.equal(result.ok, true)
  assert.deepEqual(log, ['undo:b', 'undo:a'], '撤销必须倒序')
  assert.equal(result.name, '新建')
})

test('groupId 变了就把前一组封口（CommandMerger:100-101 CHANGED_GROUP）', async () => {
  const root = scratchRoot()
  const log = []
  const processor = getCommandProcessor(root)
  processor.record({ name: '新建', groupId: 'new:1', steps: [step(log, 'a', ['a.txt'])] })
  const reason = processor.record({ name: '新建', groupId: 'new:2', steps: [step(log, 'b', ['b.txt'])] })
  assert.equal(reason, 'CHANGED_GROUP')
  assert.equal(processor.size().undo, 2)
  await processor.undo(['b.txt'])
  assert.deepEqual(log, ['undo:b'], '只撤最近那一组')
  assert.equal(processor.nextName('undo', ['a.txt']), '新建')
})

test('命令名不同先封口（CommandMerger:77 INCOMPATIBLE_COMMAND）', () => {
  const root = scratchRoot()
  const processor = getCommandProcessor(root)
  processor.record({ name: '复制', groupId: 'g', steps: [{ paths: ['a.txt'], undo: () => {}, redo: () => {} }] })
  assert.equal(processor.record({ name: '复制', groupId: 'g', steps: [{ paths: ['b.txt'], undo: () => {}, redo: () => {} }] }), 'NOTHING_TO_FLUSH')
  assert.equal(processor.record({ name: '移动', groupId: 'g', steps: [{ paths: ['c.txt'], undo: () => {}, redo: () => {} }] }), 'INCOMPATIBLE_COMMAND')
})

test('范围为空时只有全局组可撤；碰到多个文件的组自动升为全局（CommandMerger:56-69 / :197-199）', async () => {
  const root = scratchRoot()
  const single = getCommandProcessor(root)
  single.record({ name: '粘贴副本', groupId: 'paste', steps: [{ paths: ['a.txt'], undo: () => {}, redo: () => {} }] })
  assert.equal(single.canUndo([]), false, '单文件组不属于全局范围')
  assert.equal(single.canUndo(['a.txt']), true, '按路径查就该看得到')
  assert.equal(single.canUndo(['other.txt']), false, '别人的文件不该点亮')

  const wide = getCommandProcessor(`${root}:wide`)
  wide.record({ name: '粘贴副本', groupId: 'paste', steps: [
    { paths: ['a.txt'], undo: () => {}, redo: () => {} },
    { paths: ['b.txt'], undo: () => {}, redo: () => {} },
  ] })
  assert.equal(wide.canUndo([]), true, '跨两个文件 = 全局组，空范围也算可用')
})

test('登记了不可撤的改动之后，撤销整体拒绝并给出上游那份报告', async () => {
  const root = scratchRoot()
  const log = []
  const processor = getCommandProcessor(root)
  processor.record({ name: '粘贴副本', groupId: 'paste', steps: [step(log, 'a', ['a.txt'])] })
  processor.markNonUndoable(['a.txt'])
  assert.equal(processor.canUndo(['a.txt']), false)
  const result = await processor.undo(['a.txt'])
  assert.equal(result.ok, false)
  assert.equal(result.report.title, '无法撤消')
  assert.match(result.report.problem, /无法执行 撤消粘贴副本/)
  assert.match(result.report.problem, /以下文件包含无法撤消的更改/)
  assert.deepEqual(result.report.files, ['a.txt'])
  assert.deepEqual(log, [], '拒绝之后一步都不该执行')
})

test('自检失败 = 受此操作影响的其它文件已更改，已执行的步骤补回去', async () => {
  const root = scratchRoot()
  const log = []
  const processor = getCommandProcessor(root)
  processor.record({ name: '移动', groupId: 'move', steps: [
    step(log, 'b', ['b.txt'], { stillMatches: () => false, checkPaths: ['c.txt'] }),
    step(log, 'a', ['a.txt'], { stillMatches: () => true }),
  ] })
  const result = await processor.undo()
  assert.equal(result.ok, false)
  assert.match(result.report.problem, /受此操作影响的以下文件已更改/)
  assert.deepEqual(log, ['undo:a', 'redo:a'], '倒序撤到第二歩失败，第一歩要原路补回去')
  assert.deepEqual(result.report.files, ['a.txt', 'b.txt', 'c.txt'])
})

test('撤销后能重做；重做之后再记一条新命令就作废重做栈', async () => {
  const root = scratchRoot()
  const log = []
  const processor = getCommandProcessor(root)
  processor.record({ name: '粘贴副本', groupId: 'paste', steps: [step(log, 'a', ['a.txt'])] })
  await processor.undo(['a.txt'])
  assert.equal(processor.canRedo([]), false)
  assert.equal(processor.canRedo(['a.txt']), true)
  assert.equal(processor.state.canRedo, true, '菜单绑的那份状态不分范围')
  await processor.redo(['a.txt'])
  assert.deepEqual(log, ['undo:a', 'redo:a'])
  await processor.undo(['a.txt'])
  processor.record({ name: '删除', groupId: 'delete', steps: [step(log, 'b', ['b.txt'])] })
  assert.equal(processor.size().redo, 0, '新命令作废重做栈')
  assert.equal(processor.canRedo(), false)
})

test('外部改动让含该路径的组失效（UndoableGroup:195-199）', async () => {
  const root = scratchRoot()
  const processor = getCommandProcessor(root)
  processor.record({ name: '粘贴副本', groupId: 'paste', steps: [{ paths: ['a.txt'], undo: () => {}, redo: () => {} }] })
  processor.invalidate('a.txt')
  assert.equal(processor.canUndo(['a.txt']), false)
  const result = await processor.undo()
  assert.equal(result.ok, false)
})

test('全局栈只留最近 10 组（registry.properties:20）', () => {
  const root = scratchRoot()
  const processor = getCommandProcessor(root)
  for (let index = 0; index < GLOBAL_UNDO_LIMIT + 5; index += 1) {
    processor.record({ name: `新建 ${index}`, groupId: `g${index}`, steps: [{ paths: [`f${index}.txt`], global: true, undo: () => {}, redo: () => {} }] })
  }
  assert.equal(processor.size().undo, GLOBAL_UNDO_LIMIT)
})
