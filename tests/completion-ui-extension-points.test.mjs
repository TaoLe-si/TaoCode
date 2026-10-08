// 判据 · **补全弹层的五条 EP**（`src/completionExtensionPoints.ts` 的「第二批」段，上游
// `com.intellij.lookup.actionProvider` / `lookup.usageDetails` /
// `completion.preselectionBehaviourProvider` / `lookup.charFilter` /
// `codeInsight.completion.error.intention`）。
//
// 钉四件事：
//   ① 五条 EP 的 id 与上游逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效、按语言过滤（未知语言不收窄）；
//   ③ **真实消费点**读 EP：`collectCommands`（`src/completionCommands.ts`，`..` 命令补全）、
//      `shouldPreselectFirstSuggestion`（`src/lspCompletion.ts` 的 `selectOnOpen`）；
//   ④ bundled 五支 passthrough 真的在 EP 里，且不改变既有行为。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BUNDLED_ERROR_FIX_COMMAND_PROVIDER_ID,
  BUNDLED_LOOKUP_ACTION_PROVIDER_ID,
  BUNDLED_LOOKUP_CHAR_FILTER_ID,
  BUNDLED_LOOKUP_USAGE_DESCRIPTOR_ID,
  COMPLETION_CONFIDENCE_EP,
  ERROR_FIX_COMMAND_PROVIDER_EP,
  LOOKUP_ACTION_PROVIDER_EP,
  LOOKUP_CHAR_FILTER_EP,
  LOOKUP_USAGE_DETAILS_EP,
  PRESELECTION_BEHAVIOUR_PROVIDER_EP,
  WEIGHER_EP,
  charFilterDecision,
  errorFixCommandProviders,
  errorFixCommands,
  lookupActionProviders,
  lookupActionsFor,
  lookupCharFilters,
  lookupUsageDescriptors,
  lookupUsageRecord,
  preselectionBehaviourProviders,
  registerErrorFixCommandProvider,
  registerLookupActionProvider,
  registerLookupCharFilter,
  registerLookupUsageDescriptor,
  registerPreselectionBehaviourProvider,
  shouldPreselectFirstSuggestion,
} from '../src/completionExtensionPoints.ts'
// 真实消费点：`..` 命令补全的命令表。
import { collectCommands, findCommandInvocation } from '../src/completionCommands.ts'

const context = (over = {}) => ({
  path: 'src/Sample.java', language: 'java', prefix: 're', lookupString: 'Remove',
  itemKind: 'method', autoPopup: true, outcome: 'accepted', ...over,
})
const errorFixInput = (over = {}) => ({
  path: 'src/Sample.java', language: 'java', text: 'int a = ;', offset: 8,
  errors: [{ severity: 1, message: 'Syntax error' }], ...over,
})
const actionSource = {
  ids: () => ['Rename', 'RefactorThis'],
  titleOf: id => (id === 'Rename' ? 'Rename' : 'Refactor This'),
  isAvailable: () => true,
  keysOf: () => undefined,
}

test('五条 EP 的 id 与上游逐字一致，且都已在宿主里声明（与原有的两条共存）', () => {
  assert.equal(LOOKUP_ACTION_PROVIDER_EP, 'com.intellij.lookup.actionProvider')
  assert.equal(LOOKUP_USAGE_DETAILS_EP, 'com.intellij.lookup.usageDetails')
  assert.equal(PRESELECTION_BEHAVIOUR_PROVIDER_EP, 'com.intellij.completion.preselectionBehaviourProvider')
  assert.equal(LOOKUP_CHAR_FILTER_EP, 'com.intellij.lookup.charFilter')
  assert.equal(ERROR_FIX_COMMAND_PROVIDER_EP, 'com.intellij.codeInsight.completion.error.intention')
  for (const id of [
    LOOKUP_ACTION_PROVIDER_EP, LOOKUP_USAGE_DETAILS_EP, PRESELECTION_BEHAVIOUR_PROVIDER_EP,
    LOOKUP_CHAR_FILTER_EP, ERROR_FIX_COMMAND_PROVIDER_EP, WEIGHER_EP, COMPLETION_CONFIDENCE_EP,
  ]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 应当已声明`)
  }
})

test('bundled 五支都在 EP 里，且都是 passthrough（既有行为不变）', () => {
  const ids = [
    ...lookupActionProviders('java'), ...lookupUsageDescriptors(), ...lookupCharFilters('java'),
    ...errorFixCommandProviders('java'),
  ].map(contribution => contribution.id)
  for (const id of [
    BUNDLED_LOOKUP_ACTION_PROVIDER_ID, BUNDLED_LOOKUP_USAGE_DESCRIPTOR_ID,
    BUNDLED_LOOKUP_CHAR_FILTER_ID, BUNDLED_ERROR_FIX_COMMAND_PROVIDER_ID,
  ]) {
    assert.equal(ids.includes(id), true, `${id} 应当是 bundled 贡献`)
  }
  assert.deepEqual(lookupActionsFor(context()), [])
  assert.equal(charFilterDecision(',', 2, context()), null)
  assert.deepEqual(errorFixCommands(errorFixInput()), [])
  // 用量：bundled 描述符有一条（键由它给），数据空
  const records = lookupUsageRecord(context())
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].data, [])
})

test('lookup.actionProvider：fillActions 的结果被收集（真实消费点是 Alt+Enter 键位）', () => {
  const provider = registerLookupActionProvider({
    id: 'test.lookup.action', languages: ['java'],
    fillActions: input => (input.lookupString === 'Remove' ? [{ text: '移除', run: () => {} }] : []),
  })
  try {
    assert.deepEqual(lookupActionsFor(context()).map(action => action.text), ['移除'])
    assert.deepEqual(lookupActionsFor(context({ lookupString: 'Other' })), [])
    assert.deepEqual(lookupActionsFor(context({ language: 'cpp' })), [])
  } finally {
    provider.dispose()
  }
})

test('lookup.usageDetails：getExtensionKey + getAdditionalUsageData', () => {
  const descriptor = registerLookupUsageDescriptor({
    id: 'test.lookup.usage', getExtensionKey: () => 'test.completion.finished',
    getAdditionalUsageData: input => [['outcome', input.outcome], ['item', input.lookupString]],
  })
  try {
    const records = lookupUsageRecord(context({ outcome: 'cancelled' }))
    const mine = records.find(record => record.key === 'test.completion.finished')
    assert.deepEqual(mine.data, [['outcome', 'cancelled'], ['item', 'Remove']])
  } finally {
    descriptor.dispose()
  }
})

test('preselectionBehaviourProvider：显式调用一律预选，自动弹层问 provider', () => {
  const provider = registerPreselectionBehaviourProvider({
    id: 'test.preselect', languages: ['java'],
    shouldPreselectFirstSuggestion: input => input.prefix.length < 2,
  })
  try {
    assert.equal(shouldPreselectFirstSuggestion(context({ prefix: 'r' })), true)
    assert.equal(shouldPreselectFirstSuggestion(context({ prefix: 're' })), false, 'provider 说不要')
    assert.equal(shouldPreselectFirstSuggestion(context({ prefix: 're', autoPopup: false })), true,
      '显式调用不看 provider（类注释 :11-13）')
    assert.equal(shouldPreselectFirstSuggestion(context({ prefix: 're', language: 'cpp' })), true, '语言收窄')
  } finally {
    provider.dispose()
  }
  assert.equal(shouldPreselectFirstSuggestion(context({ prefix: 're' })), true)
})

test('lookup.charFilter：第一个非 null 说了算，三档透传', () => {
  const filter = registerLookupCharFilter({
    id: 'test.char.filter', languages: ['java'],
    acceptChar: (char, prefixLength) => {
      if (char === ';' && prefixLength > 0) return 'SELECT_ITEM_AND_FINISH_LOOKUP'
      if (char === ' ') return 'HIDE_LOOKUP'
      if (char === '.') return 'ADD_TO_PREFIX'
      return null
    },
  })
  try {
    assert.equal(charFilterDecision(';', 2, context()), 'SELECT_ITEM_AND_FINISH_LOOKUP')
    assert.equal(charFilterDecision(' ', 2, context()), 'HIDE_LOOKUP')
    assert.equal(charFilterDecision('.', 2, context()), 'ADD_TO_PREFIX')
    assert.equal(charFilterDecision('x', 2, context()), null)
    assert.equal(charFilterDecision(';', 2, context({ language: 'cpp' })), null, '语言收窄')
  } finally {
    filter.dispose()
  }
})

test('error.intention：真实消费点是命令补全的命令表（collectCommands 的 errorFix 那一格）', () => {
  // 上游 `DirectIntentionCommandProvider.kt:474`：命令表里追加错误修复命令。
  const invocation = findCommandInvocation('foo..', 5)
  assert.notEqual(invocation, null, '`foo..` 是双点命令调用点')
  const before = collectCommands(invocation, actionSource)
  assert.equal(before.some(item => item.label === 'Fix Syntax Error'), false)
  const provider = registerErrorFixCommandProvider({
    id: 'test.error.fix', languages: ['java'],
    getCommands: input => (input.errors.some(error => error.severity === 1)
      ? [{ label: 'Fix Syntax Error', detail: '(Alt+Shift+Enter)', priority: -50 }] : []),
  })
  try {
    assert.equal(errorFixCommands(errorFixInput()).length, 1)
    const after = collectCommands(invocation, actionSource, {}, errorFixInput())
    const item = after.find(entry => entry.label === 'Fix Syntax Error')
    assert.notEqual(item, undefined, '错误修复命令要进命令表')
    assert.equal(item.detail, '(Alt+Shift+Enter)')
    assert.equal(after.length, before.length + 1)
    // 没有诊断时 provider 不给命令 ⇒ 表回到原样
    assert.equal(collectCommands(invocation, actionSource, {}, errorFixInput({ errors: [] })).length, before.length)
    // 语言不匹配时也不给
    assert.equal(errorFixCommands(errorFixInput({ language: 'cpp' })).length, 0)
  } finally {
    provider.dispose()
  }
  assert.equal(collectCommands(invocation, actionSource, {}, errorFixInput()).length, before.length)
})
