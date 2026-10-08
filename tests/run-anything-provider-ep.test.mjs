// EP 判据：`com.intellij.runAnything.executionProvider` 的宿主（`src/runAnything.ts`）。
//
// 上游依据：EP 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:243`
// `<extensionPoint qualifiedName="com.intellij.runAnything.executionProvider"
//  interface="com.intellij.ide.actions.runAnything.activity.RunAnythingProvider" dynamic="true"/>`。
// 三件事：① bundled 两条供给方仍在；② 第三方按 EP id 挂的 provider 被真实消费点
// `buildRunAnythingRows()` 合并进候选；③ EP id 逐字等于上游。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COMMAND_LINE_PROVIDER, RUN_ANYTHING_PROVIDER_EP, RUN_CONFIGURATION_PROVIDER,
  buildRunAnythingRows, registerRunAnythingProvider, runAnythingProviders, unregisterRunAnythingProvider,
} from '../src/runAnything.ts'

test('EP id 逐字等于上游 qualifiedName', () => {
  assert.equal(RUN_ANYTHING_PROVIDER_EP, 'com.intellij.runAnything.executionProvider')
})

test('bundled 两条供给方仍在 EP 上', () => {
  const ids = runAnythingProviders().map(provider => provider.id)
  assert.ok(ids.includes(RUN_CONFIGURATION_PROVIDER.id), '运行配置供给方在 EP 上')
  assert.ok(ids.includes(COMMAND_LINE_PROVIDER.id), '命令行供给方在 EP 上')
})

test('第三方按 EP id 注册后被真实消费点合并进候选', () => {
  const handle = registerRunAnythingProvider({
    id: 'acme-gradle', group: 'general',
    getValues: () => [{ kind: 'config', name: 'bootRun', detail: 'Gradle' }],
  })
  try {
    const rows = buildRunAnythingRows([{ name: 'MyApp' }], '', [])
    assert.ok(rows.some(row => row.name === 'bootRun' && row.group === 'general'), '第三方候选进了列表')
    assert.ok(rows.some(row => row.name === 'MyApp'), 'bundled 配置候选仍在')
  } finally {
    handle.dispose()
  }
  assert.equal(buildRunAnythingRows([{ name: 'MyApp' }], '', []).some(row => row.name === 'bootRun'), false,
    '注销后第三方候选不再出现')
})

test('unregister 返回真值语义', () => {
  assert.equal(unregisterRunAnythingProvider('does-not-exist'), false)
})
