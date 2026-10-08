// 判据 · 文件类型的**插件贡献面**（`com.intellij.fileType` EP，即上游 `<fileType …>` 声明）。
//
// 上游 `<fileType>` 是 EP 的贡献，`FileTypeManagerImpl` 自己实现 `ExtensionPointListener<FileTypeBean>`
// （`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:132` 的
// `EP_NAME`，`:280-300` 的 extensionAdded/Removed 才是「插件声明的扩展名立刻能认」那条链）。
// 本仓没有插件 XML 解析器，改由扩展点宿主承载。这个判据钉四件事：
//   ① EP 已声明，id 与上游 qualifiedName 逐字一致；
//   ② 本仓 bundled 的标准类型仍以 bundled 贡献登记在 EP 上；
//   ③ 第三方按 EP id 挂进来的 `FileTypeDescriptor`，被进程内单例（真实消费点）当场认领、能认文件；
//   ④ 临时/判据用的 `new FileTypeManager()` 不往全局 EP 里灌（不跨用例串味）——反之单例注册会挂进 EP。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS, FILE_TYPE_EP } from '../src/extensionPoints.ts'
import { FileTypeManager, STANDARD_FILE_TYPES, fileTypeManager } from '../src/fileTypeRegistry.ts'

const thirdPartyType = () => ({
  id: 'ThirdPartyTs', name: 'Third Party TS', language: 'typescript',
  matchers: [{ kind: 'extension', extension: 'thirdts' }],
})

test('文件类型 EP 的 id 与上游逐字一致（com.intellij.fileType）', () => {
  assert.equal(FILE_TYPE_EP, 'com.intellij.fileType')
  assert.equal(EXTENSIONS.hasExtensionPoint(FILE_TYPE_EP), true)
})

test('bundled 标准类型仍以 bundled 贡献登记在 EP 上', () => {
  const ids = EXTENSIONS.extensionsOf(FILE_TYPE_EP).map(type => type.id)
  for (const type of STANDARD_FILE_TYPES) assert.ok(ids.includes(type.id), `bundled 类型「${type.id}」不在 EP 里`)
  const java = EXTENSIONS.entriesFor(FILE_TYPE_EP).find(entry => entry.id === 'JAVA')
  assert.equal(java?.source, 'bundled')
})

test('第三方按 EP id 挂进来的类型被单例（真实消费点）当场认领', () => {
  const type = thirdPartyType()
  const handle = EXTENSIONS.registerExtension(FILE_TYPE_EP, type.id, type)
  try {
    assert.equal(fileTypeManager.getFileTypeByExtension('thirdts')?.id, 'ThirdPartyTs',
      'EP 上新增的文件类型没被单例认领 ⇒ 编辑器语言判定看不到它')
    assert.equal(fileTypeManager.getFileTypeByFileName('a.thirdts')?.language, 'typescript')
  } finally {
    handle.dispose()
    fileTypeManager.unregister('ThirdPartyTs')
  }
  assert.equal(fileTypeManager.getType('ThirdPartyTs'), null)
})

test('单例 register() 会挂进 EP；临时实例不会（不串味）', () => {
  fileTypeManager.register({
    id: 'LiveEpType', name: 'Live EP', language: 'other',
    matchers: [{ kind: 'extension', extension: 'liveep' }],
  })
  try {
    assert.ok(EXTENSIONS.entriesFor(FILE_TYPE_EP).some(entry => entry.id === 'LiveEpType'),
      '单例 register() 没把类型挂进 EP')
  } finally { fileTypeManager.unregister('LiveEpType') }

  const adHoc = new FileTypeManager([
    { id: 'AdHocOnly', name: 'Ad Hoc', language: 'other', matchers: [{ kind: 'extension', extension: 'adhoc' }] },
  ])
  assert.equal(adHoc.getFileTypeByExtension('adhoc')?.id, 'AdHocOnly')
  assert.ok(!EXTENSIONS.entriesFor(FILE_TYPE_EP).some(entry => entry.id === 'AdHocOnly'),
    '临时 FileTypeManager 不该往全局 EP 灌类型')
})
