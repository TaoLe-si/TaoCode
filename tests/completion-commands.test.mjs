// **命令补全**判据（上游 `platform/lang-impl/src/com/intellij/codeInsight/completion/command/**`）。
// 模块本身早已落地（`src/completionCommands.ts`，消费方 `src/lspCompletion.ts`），但**一条判据都没有**
// ⇒ 本轮（2026-10-06）补上，锁住判决词里那几句原文：
//   · `CommandCompletionSuffixProvider.kt:23,28,30-36`：后缀 `.`、完整过滤后缀 `..`；
//   · `CommandCompletionProvider.kt:701-742` `findCommandCompletionType`：三种形态
//     PartialSuffix / FullSuffix / FullLine，`foo...`（第三个点）**不是**命令调用点；
//   · `CommandCompletionProvider.kt:651-699` `findActualIndex`：先按后缀、再往回扫、最后空行那条路；
//   · `AbstractActionCompletionCommand.kt:224-229,234-241` + `CommandCompletionProvider.kt:311-317,319-326`
//     的名字整形与尾文本 ` (快捷键)`；
//   · `CommandCompletionProvider.kt:237` 用驼峰匹配命令名；`:80` 默认优先级 -150。
// 常量与上游逐条对上（`src/completionCommands.ts:37-46`）。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COMMAND_DEFAULT_PRIORITY, COMMAND_LOOKUP_STRING_LIMIT, commandLabel, collectCommands,
  findActualIndex, findCommandInvocation,
} from '../src/completionCommands.ts'

test('后缀常量对上上游那张表（CommandCompletionSuffixProvider.kt:23,28 + :80 + :319 + properties:585）', () => {
  assert.equal(COMMAND_DEFAULT_PRIORITY, -150)
  assert.equal(COMMAND_LOOKUP_STRING_LIMIT, 50)
})

test('findActualIndex：刚敲完一个点 = 1（:651-660 的第一段逐级匹配）', () => {
  assert.equal(findActualIndex('..', 'foo.', 4), 1, '只有单个点 ⇒ 后缀 ".." 逐级退到 "."')
  assert.equal(findActualIndex('..', 'foo..', 5), 2, '两个点 = 完整过滤后缀')
  assert.equal(findActualIndex('..', '', 0), 0, 'offset 0 没有命令调用点')
})

test('findCommandInvocation 的三种形态（CommandCompletionProvider.kt:701-742）', () => {
  // PartialSuffix：`foo.` 刚敲完点（:715-719）。
  assert.deepEqual(findCommandInvocation('foo.', 4),
    { kind: 'partial-suffix', pattern: '', suffix: '.', start: 3 })
  // PartialSuffix：`foo.re` —— 后缀在标识符里面（:731-736）：命令文本从**点**起算，前缀是点后的 `re`。
  assert.deepEqual(findCommandInvocation('foo.re', 6),
    { kind: 'partial-suffix', pattern: 're', suffix: '.', start: 3 })
  // FullSuffix：`foo..` 只留命令（:721-730）。
  assert.deepEqual(findCommandInvocation('foo..', 5),
    { kind: 'full-suffix', pattern: '', suffix: '..', start: 3 })
  // 第三个点就不是命令调用点了（:721-730 那两个前置检查）。
  assert.equal(findCommandInvocation('foo...', 6), null)
  // FullLine：整行只有命令名（:737-740），没有点所以 suffix 是空串。
  assert.deepEqual(findCommandInvocation('a\nren', 5),
    { kind: 'full-line', pattern: 'ren', suffix: '', start: 2 })
  // 行中没有点、上一行也不是空行 ⇒ 不是调用点。
  assert.equal(findCommandInvocation('ab ren', 6), null)
})

test('命令名整形：去掉结尾的 ... / 下划线、超 50 字符截断（:311-313,319-326 + AbstractActionCompletionCommand.kt:224-229）', () => {
  assert.equal(commandLabel('Rename Element'), 'Rename Element')
  assert.equal(commandLabel('Surround With...'), 'Surround With')
  assert.equal(commandLabel('Reformat Code…'), 'Reformat Code')
  assert.equal(commandLabel('Toggle_ Line Comment'), 'Toggle Line Comment')
  const long = 'x'.repeat(COMMAND_LOOKUP_STRING_LIMIT + 10)
  assert.equal(commandLabel(long).length, COMMAND_LOOKUP_STRING_LIMIT + 1)
  assert.ok(commandLabel(long).endsWith('…'))
})

const sourceOf = actions => ({
  ids: () => Object.keys(actions),
  titleOf: id => actions[id].title,
  isAvailable: id => actions[id].enabled !== false,
  keysOf: id => actions[id].keys,
})

test('collectCommands：不可用的动作不出现、尾文本是快捷键、名字按驼峰命中（:237-259 + AbstractActionCompletionCommand.kt:234-241）', () => {
  const actions = {
    'rename': { title: 'Rename Element', keys: 'Shift F6' },
    'changeSignature': { title: 'Change Signature' },
    'hidden': { title: 'Never Shown', enabled: false },
  }
  const items = collectCommands({ kind: 'partial-suffix', pattern: '', suffix: '.', start: 3 }, sourceOf(actions))
  assert.deepEqual(items.map(item => item.label), ['Rename Element', 'Change Signature'], '禁用项不出现')
  assert.deepEqual(items.map(item => item.detail), ['(Shift F6)', ''], 'additionalInfo 有才显示，且带括号')
  assert.deepEqual(items.map(item => item.actionId), ['rename', 'changeSignature'])
  assert.ok(items.every(item => item.commandFrom === 3), '接受时从命令文本起点删起（CommandInsertHandler.kt:77-109）')
  // 前缀命中（`ren` → Rename Element）。
  const prefix = collectCommands({ kind: 'partial-suffix', pattern: 'ren', suffix: '.', start: 3 }, sourceOf(actions))
  assert.deepEqual(prefix.map(item => item.label), ['Rename Element'])
  assert.deepEqual(collectCommands({ kind: 'partial-suffix', pattern: 'zz', suffix: '.', start: 3 }, sourceOf(actions)), [],
    '谁都不命中就是空表')
})

// 命令名过滤的匹配档 = 上游那把匹配器（`CommandCompletionProvider.kt:237` 造
// `CamelHumpMatcher(prefix, false, true)`、`:252` 用 `prefixMatches` 决定谁留在表里；
// `CamelHumpMatcher.java:80-87` 的 `prefixMatches` 就是 `myMatcher.matches(name)`）。
// 本仓同档 = `camelHumpMatcher(pattern, { caseSensitiveMode: 'ignore-case' }).matches(label)`
// （`createMatcher` 在 `caseSensitive=false` 时不套大小写档 ⇒ `NameUtil.buildMatcher` 的默认
// `MatchingMode.IGNORE_CASE`，`CamelHumpMatcher.java:130-147` + `NameUtil.java:299-300`）。
test('驼峰两档真的进表：cs/sw 命中两个词首（旧实现只吃前缀，这三例是本轮换匹配器的判据）', () => {
  const actions = {
    rename: { title: 'Rename Element' },
    changeSignature: { title: 'Change Signature' },
    surround: { title: 'Surround With' },
    comment: { title: 'Toggle Line Comment' },
  }
  const call = pattern => collectCommands({ kind: 'partial-suffix', pattern, suffix: '.', start: 3 }, sourceOf(actions)).map(i => i.label)
  assert.deepEqual(call('cs'), ['Change Signature'], 'c 在串首、s 在 Signature 的词首')
  assert.deepEqual(call('CS'), ['Change Signature'], '第 2 个参数 caseSensitive=false ⇒ 大小写不吃候选')
  assert.deepEqual(call('Cs'), ['Change Signature'])
  assert.deepEqual(call('sw'), ['Surround With'], 's 在串首、w 在 With 的词首')
  assert.deepEqual(call('line'), ['Toggle Line Comment'], '中间匹配（applyMiddleMatching 的前导星号档）')
  assert.deepEqual(call('zz'), [], '字母表里根本没有的字符还是不给进表')
})

test('已知差异：typoTolerant 那一档不移植，rn 不吃 Rename（上游第三参数 true 的本体在 TypoTolerantMatcher）', () => {
  const actions = { rename: { title: 'Rename Element' } }
  const call = pattern => collectCommands({ kind: 'partial-suffix', pattern, suffix: '.', start: 3 }, sourceOf(actions)).map(i => i.label)
  assert.deepEqual(call('ren'), ['Rename Element'], '连续前缀那档照旧')
  assert.deepEqual(call('rne'), [], '`*rne` 要求 r-n-e 连续（`applyMiddleMatching` 只在**词首**跳，不在中间逐字母跳），'
    + '上游靠 `CamelHumpMatcher.java:143-145` 的 `typoTolerant()` 才放行；本仓 `src/completionCamelHump.ts:39-41` 明确不移植键盘布局纠错')
})

test('优先级：默认 -150 那批与显式更高 priority 的排序键不同（:78-80,354-355,371-372）', () => {
  const actions = { 'a': { title: 'Alpha' }, 'b': { title: 'Bravo' } }
  const items = collectCommands({ kind: 'full-suffix', pattern: '', suffix: '..', start: 5 }, sourceOf(actions), { b: 10 })
  const keys = items.map(item => item.sortText)
  assert.deepEqual(keys, [...keys].sort(), '排序键本身要能直接排（组号 + 优先级前缀）')
  const bravo = items.find(item => item.label === 'Bravo')
  const alpha = items.find(item => item.label === 'Alpha')
  assert.equal(bravo.priority, 10)
  assert.equal(alpha.priority, COMMAND_DEFAULT_PRIORITY)
})
