// 判据 · **意图/快速修复的扩展点**（`src/intentionExtensionPoints.ts`，
// 上游 `com.intellij.intentionMenuContributor`；意图那条 `com.intellij.intentionAction`
// 由 `src/daemonExtensionPoints.ts` 声明，这里一并钉住）。
//
// 钉四件事：
//   ① 两条 EP 的 id 与上游 `qualifiedName` / `EP_NAME` 逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效、按语言过滤；
//   ③ 消费面真的读 EP：`collectedIntentions` 把全部贡献者的条目合并（坏贡献者跳过）；
//   ④ bundled passthrough 挂上后消费点仍拿得到（空表），不影响第三方。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import { INTENTION_ACTION_EP, intentionActionContributions } from '../src/daemonExtensionPoints.ts'
import {
  BUNDLED_INTENTION_MENU_CONTRIBUTOR_ID,
  INTENTION_MENU_CONTRIBUTOR_EP,
  collectedIntentions,
  intentionMenuContributors,
  registerIntentionMenuContributor,
  unregisterIntentionMenuContributor,
} from '../src/intentionExtensionPoints.ts'

const input = (over = {}) => ({
  path: 'src/Sample.java', language: 'java', text: 'int a;', line: 0, character: 5, passId: 0, ...over,
})

const action = (id, title) => ({ id, title, edits: [] })

test('两条 EP 已声明，id 与上游逐字一致', () => {
  assert.equal(INTENTION_MENU_CONTRIBUTOR_EP, 'com.intellij.intentionMenuContributor')
  assert.equal(INTENTION_ACTION_EP, 'com.intellij.intentionAction')
  assert.equal(EXTENSIONS.hasExtensionPoint(INTENTION_MENU_CONTRIBUTOR_EP), true)
  assert.equal(EXTENSIONS.hasExtensionPoint(INTENTION_ACTION_EP), true)
})

test('菜单贡献者按语言过滤，注册/注销生效', () => {
  const java = registerIntentionMenuContributor({
    id: 'demo.intention.java', languages: ['java'],
    collectActions: () => [action('demo.java.action', '演示 Java 动作')],
  })
  const ts = registerIntentionMenuContributor({
    id: 'demo.intention.ts', languages: ['typescript'],
    collectActions: () => [action('demo.ts.action', '演示 TS 动作')],
  })
  try {
    assert.ok(intentionMenuContributors('java').some(c => c.id === 'demo.intention.java'))
    assert.equal(intentionMenuContributors('java').some(c => c.id === 'demo.intention.ts'), false)
    const javaActions = collectedIntentions(input())
    assert.ok(javaActions.some(a => a.id === 'demo.java.action'))
    assert.equal(javaActions.some(a => a.id === 'demo.ts.action'), false)
    assert.ok(collectedIntentions(input({ language: 'typescript' })).some(a => a.id === 'demo.ts.action'))
  } finally {
    java.dispose(); ts.dispose()
  }
  assert.equal(collectedIntentions(input()).some(a => a.id === 'demo.java.action'), false)
  assert.equal(unregisterIntentionMenuContributor('demo.intention.java'), false)
})

test('多个贡献者合并；坏贡献者不影响别的', () => {
  const good = registerIntentionMenuContributor({
    id: 'demo.intention.good', collectActions: () => [action('good.1', '好的一')],
  })
  const bad = registerIntentionMenuContributor({
    id: 'demo.intention.bad', collectActions: () => { throw new Error('boom') },
  })
  const also = registerIntentionMenuContributor({
    id: 'demo.intention.also', collectActions: () => [action('also.1', '也一')],
  })
  try {
    const ids = collectedIntentions(input()).map(a => a.id)
    assert.ok(ids.includes('good.1'))
    assert.ok(ids.includes('also.1'))
    assert.ok(!ids.includes('bad.1'))
  } finally {
    good.dispose(); bad.dispose(); also.dispose()
  }
})

test('bundled passthrough 挂上（空表），不挡第三方', () => {
  const bundled = intentionMenuContributors('java').filter(c => c.id === BUNDLED_INTENTION_MENU_CONTRIBUTOR_ID)
  assert.equal(bundled.length, 1)
  assert.deepEqual(bundled[0].collectActions(input()), [])
})

test('意图 EP（daemon 侧）仍按 id 取得到贡献', () => {
  assert.ok(Array.isArray(intentionActionContributions()))
})
