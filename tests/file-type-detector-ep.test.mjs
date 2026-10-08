// EP 判据：`com.intellij.fileTypeDetector` 的宿主（`src/fileTypeDetection.ts`）。
//
// 上游依据：EP 声明 `platform/core-api/resources/intellij.platform.core.xml:99`
// `<extensionPoint name="fileTypeDetector" interface="com.intellij.openapi.fileTypes.FileTypeRegistry$FileTypeDetector" dynamic="true"/>`
// （name 属性在默认命名空间下 = `com.intellij.fileTypeDetector`）。
// 三件事：① 内置探测器仍在；② 第三方按 EP id 挂的探测器被真实判定点 `detectByContent()` 用到；
// ③ EP id 逐字等于上游。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FILE_TYPE_DETECTOR_EP, detectByContent, fileTypeDetectorsFromExtensions,
  registerFileTypeDetector, unregisterFileTypeDetector,
} from '../src/fileTypeDetection.ts'

test('EP id 逐字等于上游 qualifiedName', () => {
  assert.equal(FILE_TYPE_DETECTOR_EP, 'com.intellij.fileTypeDetector')
})

test('bundled 内置探测器仍在 EP 上', () => {
  const ids = fileTypeDetectorsFromExtensions().map(detector => detector.id)
  assert.ok(ids.includes('json-document'), 'JSON 探测器在 EP 上')
  assert.ok(ids.includes('xml-prolog'), 'XML 探测器在 EP 上')
})

test('第三方按 EP id 注册后被真实判定点用到（order 小的先判）', () => {
  const handle = registerFileTypeDetector({
    id: 'acme-toml', order: 5,
    match: head => (/^\s*\[[A-Za-z0-9_.-]+\]\s*$/m.test(head) ? { type: 'TOML', language: 'other', confidence: 'high' } : null),
  })
  try {
    assert.equal(detectByContent('[server]\nport = 1').type, 'TOML', '第三方探测器命中')
    assert.equal(detectByContent('<?xml version="1.0"?>').type, 'XML', 'bundled 探测器仍在工作')
  } finally {
    handle.dispose()
  }
  assert.equal(detectByContent('[server]\nport = 1'), null, '注销后第三方探测器不再命中')
})

test('unregister 返回真值语义', () => {
  assert.equal(unregisterFileTypeDetector('does-not-exist'), false)
})
