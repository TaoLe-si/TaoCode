// 判据 · **Code Vision 提供者的扩展点宿主**（`src/codeVisionProviders.ts` +
// `src/extensionPoints.ts`，上游 `CodeVisionProvider.EP_NAME` /
// `intellij.platform.lang.impl.xml:282-283` 的 `com.intellij.codeInsight.codeVisionProvider`）。
//
// 钉三件事：
//   ① EP id 与上游 qualifiedName 逐字一致，且已声明；
//   ② 三个内置提供者作为 **bundled 贡献**在 EP 里看得见（不是只进私有表）；
//   ③ 第三方/测试按 EP id 挂进来的提供者，`createCodeVisionRegistry()` 缺省收编（不是死代码）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { APPLICATION_SCOPE, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  CODE_VISION_PROVIDER_EP, codeVisionProvidersFromExtensions, createCodeVisionRegistry,
} from '../src/codeVisionProviders.ts'

test('EP id 与上游 qualifiedName 逐字一致，且已声明', () => {
  assert.equal(CODE_VISION_PROVIDER_EP, 'com.intellij.codeInsight.codeVisionProvider')
  assert.equal(EXTENSIONS.hasExtensionPoint(CODE_VISION_PROVIDER_EP), true)
})

test('三个内置提供者是 bundled 贡献（EP 里看得见）', () => {
  const ids = codeVisionProvidersFromExtensions().map(provider => provider.id).sort()
  assert.deepEqual(ids, ['inheritors', 'problems', 'references'])
})

test('createCodeVisionRegistry() 缺省从 EP 取初始集合', () => {
  assert.deepEqual(createCodeVisionRegistry().providers().map(provider => provider.id).sort(),
    ['inheritors', 'problems', 'references'])
})

test('第三方按 EP id 挂的提供者被缺省注册表收编', () => {
  const custom = { id: 'demo.vision', isAvailableFor: () => true, computeForDocument: () => [] }
  const handle = EXTENSIONS.registerExtension(CODE_VISION_PROVIDER_EP, custom.id, custom, { scope: APPLICATION_SCOPE })
  try {
    assert.ok(createCodeVisionRegistry().providers().some(provider => provider.id === 'demo.vision'),
      'EP 里的外部提供者没被收编')
  } finally {
    handle.dispose()
  }
  assert.equal(createCodeVisionRegistry().providers().some(provider => provider.id === 'demo.vision'), false)
})
