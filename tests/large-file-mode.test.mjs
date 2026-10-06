import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LARGE_FILE_DISABLED_COMMANDS, LARGE_FILE_LIMIT, LARGE_FILE_NOTICE,
  largeFileCommandAllowed, largeFileCommandGate, largeFilePolicy,
} from '../src/largeFileMode.ts'

test('小文件保持全部特性', () => {
  const policy = largeFilePolicy(1024)
  assert.equal(policy.large, false)
  assert.equal(policy.notice, null)
  assert.deepEqual(policy.features, { lsp: true, syntaxHighlighting: true, wordWrap: true })
})

test('恰好到阈值即降级（判定是 >=）', () => {
  assert.equal(largeFilePolicy(LARGE_FILE_LIMIT - 1).large, false)
  assert.equal(largeFilePolicy(LARGE_FILE_LIMIT).large, true)
})

test('大文件关掉语言服务/高亮/自动换行并给出提示', () => {
  const policy = largeFilePolicy(LARGE_FILE_LIMIT + 1)
  assert.equal(policy.large, true)
  assert.equal(policy.notice, LARGE_FILE_NOTICE)
  assert.deepEqual(policy.features, { lsp: false, syntaxHighlighting: false, wordWrap: false })
})

test('坏输入（NaN/负数）按空文档处理', () => {
  assert.equal(largeFilePolicy(Number.NaN).large, false)
  assert.equal(largeFilePolicy(-1).large, false)
})

// 上游 PlatformActionsReplacer.java:34-54（登记面）与 :56-58（禁用那一档 = LfeEditorActionHandlerDisabled）。
test('大文件里被禁的动作（上游禁用清单逐条）', () => {
  for (const id of LARGE_FILE_DISABLED_COMMANDS) {
    assert.equal(largeFileCommandGate(id, true), 'blocked', `${id} 在大文件里必须禁用`)
    assert.equal(largeFileCommandAllowed(id, true), false, `${id}`)
    assert.equal(largeFileCommandGate(id, false), 'allowed', `${id} 普通文件不受影响`)
  }
  assert.deepEqual([...LARGE_FILE_DISABLED_COMMANDS].sort(), [
    'find.prevWordAtCaret', 'find.wordAtCaret', 'navigate.gotoLine', 'occurrence.next',
    'occurrence.select', 'occurrence.unselect', 'replace', 'usage.highlight',
  ].sort(), '清单 = 上游 :37-38 + :48-53 那八条，一条不多一条不少')
})

test('Find 换成「只搜不替换」那一档，FindNext/FindPrevious 与其余动作不动', () => {
  assert.equal(largeFileCommandGate('find', true), 'find-only', '上游 :47 换处理器，不禁')
  assert.equal(largeFileCommandAllowed('find', true), true)
  // 上游 :40-41 给 FindNext/FindPrevious 换的是页内搜索档（照样能按）。
  assert.equal(largeFileCommandGate('find.next', true), 'allowed')
  assert.equal(largeFileCommandGate('find.previous', true), 'allowed')
  assert.equal(largeFileCommandGate('find.toggleInSelection', true), 'allowed')
  // 白名单式降级：表里没有的动作不许被顺手关掉。
  assert.equal(largeFileCommandGate('line.join', true), 'allowed')
  assert.equal(largeFileCommandGate('未知动作', true), 'allowed')
})

test('表里的 id 必须在本仓的动作/命令/键位表里真实存在（防止拿上游名字糊弄）', () => {
  const corpus = [
    readFileSync(new URL('../src/menus/editMenu.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/editorCommands.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/keymapBindings.ts', import.meta.url), 'utf8'),
  ].join('\n')
  for (const id of [...LARGE_FILE_DISABLED_COMMANDS, 'find', 'find.next', 'find.previous']) {
    const quoted = `'${id}'`
    assert.ok(corpus.includes(quoted), `${quoted} 在本仓三张表里找不到 ⇒ 这条门禁是空转`)
  }
})
