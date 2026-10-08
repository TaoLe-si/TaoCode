// 判据 · **补全的扩展点**（`src/completionExtensionPoints.ts`，上游 `com.intellij.weigher` 与
// `com.intellij.completion.confidence`；补全贡献者那条 `com.intellij.completion.contributor`
// 由 `src/extensionPoints.ts` 声明，这里一并钉住）。
//
// 钉四件事：
//   ① 三条 EP 的 id 与上游 `qualifiedName` / `EP_NAME` 逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效、按 key / 语言过滤；
//   ③ 消费面真的读 EP：`weighersFor` 被 `src/completionSorter.ts` 吃、`shouldSkipAutopopup`
//      任一 yes 即跳过；
//   ④ bundled 权重（`completion` 档）真的能被消费点拿到。
import test from 'node:test'
import assert from 'node:assert/strict'

import { COMPLETION_CONTRIBUTOR_EP, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BUNDLED_COMPLETION_WEIGHER_ID,
  COMPLETION_CONFIDENCE_EP,
  WEIGHER_EP,
  WEIGHER_KEY_COMPLETION,
  builtinCompletionWeigher,
  completionConfidences,
  registerCompletionConfidence,
  registerWeigher,
  shouldSkipAutopopup,
  unregisterCompletionConfidence,
  unregisterWeigher,
  weighersFor,
} from '../src/completionExtensionPoints.ts'

const confidenceInput = (over = {}) => ({
  path: 'src/Sample.java', language: 'java', text: 'a.', line: 0, character: 2, ...over,
})

test('三条 EP 已声明，id 与上游逐字一致', () => {
  assert.equal(COMPLETION_CONTRIBUTOR_EP, 'com.intellij.completion.contributor')
  assert.equal(WEIGHER_EP, 'com.intellij.weigher')
  assert.equal(COMPLETION_CONFIDENCE_EP, 'com.intellij.completion.confidence')
  for (const id of [COMPLETION_CONTRIBUTOR_EP, WEIGHER_EP, COMPLETION_CONFIDENCE_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('权重按 key 过滤，注册/注销生效', () => {
  const completion = registerWeigher({
    id: 'demo.weigh.completion', key: WEIGHER_KEY_COMPLETION,
    weigh: element => (element && typeof element.priority === 'number' ? element.priority : null),
  })
  const proximity = registerWeigher({
    id: 'demo.weigh.proximity', key: 'proximity', weigh: () => 0,
  })
  try {
    assert.ok(weighersFor(WEIGHER_KEY_COMPLETION).some(w => w.id === 'demo.weigh.completion'))
    assert.equal(weighersFor(WEIGHER_KEY_COMPLETION).some(w => w.id === 'demo.weigh.proximity'), false)
    assert.ok(weighersFor('proximity').some(w => w.id === 'demo.weigh.proximity'))
  } finally {
    completion.dispose(); proximity.dispose()
  }
  assert.equal(weighersFor(WEIGHER_KEY_COMPLETION).some(w => w.id === 'demo.weigh.completion'), false)
})

test('注销函数返回是否真的删掉；再注册同 id 覆盖', () => {
  const handle = registerWeigher({ id: 'demo.weigh.toggle', key: WEIGHER_KEY_COMPLETION, weigh: () => 1 })
  assert.equal(handle.dispose(), true)
  assert.equal(unregisterWeigher('demo.weigh.toggle'), false)
  registerWeigher({ id: 'demo.weigh.toggle', key: WEIGHER_KEY_COMPLETION, weigh: () => 2 })
  assert.equal(weighersFor(WEIGHER_KEY_COMPLETION).some(w => w.id === 'demo.weigh.toggle'), true)
  assert.equal(unregisterWeigher('demo.weigh.toggle'), true)
})

test('自信度按语言过滤，任一 yes 即跳过自动弹出', () => {
  const java = registerCompletionConfidence({
    id: 'demo.confidence.java', languages: ['java'],
    shouldSkipAutopopup: input => input.text.endsWith('.') ? 'yes' : 'unsure',
  })
  const ts = registerCompletionConfidence({
    id: 'demo.confidence.ts', languages: ['typescript'], shouldSkipAutopopup: () => 'yes',
  })
  try {
    assert.ok(completionConfidences('java').some(c => c.id === 'demo.confidence.java'))
    assert.equal(completionConfidences('java').some(c => c.id === 'demo.confidence.ts'), false)
    assert.equal(shouldSkipAutopopup(confidenceInput({ text: 'a.' })), true)
    assert.equal(shouldSkipAutopopup(confidenceInput({ text: 'a b' })), false)
    assert.equal(shouldSkipAutopopup(confidenceInput({ language: 'typescript', text: 'a b' })), true)
  } finally {
    java.dispose(); ts.dispose()
  }
  assert.equal(shouldSkipAutopopup(confidenceInput({ text: 'a.' })), false)
})

test('注销自信度返回是否真的删掉', () => {
  registerCompletionConfidence({ id: 'demo.confidence.toggle', shouldSkipAutopopup: () => 'yes' })
  assert.equal(unregisterCompletionConfidence('demo.confidence.toggle'), true)
  assert.equal(unregisterCompletionConfidence('demo.confidence.toggle'), false)
})

test('bundled 权重挂上后消费点真的拿到', () => {
  const bundled = weighersFor(WEIGHER_KEY_COMPLETION).filter(w => w.id === BUNDLED_COMPLETION_WEIGHER_ID)
  assert.equal(bundled.length, 1)
  // 内建权重取 sortText（字符串），没有就 null
  assert.equal(bundled[0].weigh({ sortText: '0002' }, {}), '0002')
  assert.equal(bundled[0].weigh({}, {}), null)
  assert.equal(bundled[0].key, WEIGHER_KEY_COMPLETION)
  assert.equal(bundled[0].negated, true)
  assert.equal(builtinCompletionWeigher().prefixDependent, true)
})
