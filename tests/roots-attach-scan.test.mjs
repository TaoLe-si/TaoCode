// 附加扫描外壳的判据（`src/rootsAttachScan.ts`）：配额、读不到文本、以及三种落点。
//
// 上游依据（与源文件头同一批）：
//   · `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/impl/RootDetectionUtil.java:53-149`
//   · `java/idea-ui/src/com/intellij/openapi/roots/ui/configuration/JavaVfsSourceRootDetectionUtil.java:36-72`
import test from 'node:test'
import assert from 'node:assert/strict'
import { attachablePaths, MAX_SCANNED_SOURCE_FILES, scanAttachRoots } from '../src/rootsAttachScan.ts'

const pkg = name => `package ${name};\n`

test('auto 支：候选自身被检出时直接给路径，且只读了需要读的文本', async () => {
  let reads = 0
  const result = await scanAttachRoots({
    candidates: ['lib/srcs'], files: ['lib/srcs/p/A.java', 'lib/srcs/q/B.java', 'other/C.java'],
    read: async () => { reads += 1; return pkg(reads === 1 ? 'p' : 'q') },
  })
  assert.equal(result.outcome.kind, 'auto')
  assert.deepEqual(attachablePaths(result, { candidates: ['lib/srcs'] }), ['lib/srcs'])
  assert.equal(result.readCount, 2, '只读候选下的 .java（other/C.java 不在范围内）')
  assert.equal(result.truncated, false)
  assert.equal(result.progress, '正在扫描根…')
})

test('配额：读满上限就说 truncated，不谎称扫全', async () => {
  const files = Array.from({ length: 50 }, (_, index) => `src/p/F${index}.java`)
  const result = await scanAttachRoots({ candidates: ['src'], files, read: async () => pkg('p') })
  assert.equal(result.readCount, MAX_SCANNED_SOURCE_FILES, `最多读 ${MAX_SCANNED_SOURCE_FILES} 个`)
  assert.equal(result.truncated, true)
  const small = await scanAttachRoots({ candidates: ['src'], files, read: async () => pkg('p'), limit: 3 })
  assert.equal(small.readCount, 3)
  assert.equal(small.truncated, true)
})

test('读不到文本时不当根（检测器的 null 口径），也不报错', async () => {
  const result = await scanAttachRoots({ candidates: ['src'], files: ['src/p/A.java'], read: async () => null })
  assert.equal(result.outcome.kind, 'askSingleType', '读得到文本但检不出根时进「要不要按 sources 附加」那一档')
  assert.equal(result.readCount, 1)
  assert.deepEqual(attachablePaths(result, { candidates: ['src'], confirmed: false }), [], '用户没确认就一条都不加')
  assert.deepEqual(attachablePaths(result, { candidates: ['src'], confirmed: true }), ['src'],
    '兜底确认后把**全部候选**附加为该类型（RootDetectionUtil.java:121-126）')
})

test('choose 支：只收用户在对话框里勾中的那些检出根', async () => {
  const result = await scanAttachRoots({
    candidates: ['lib'], files: ['lib/x/y/p/A.java'], read: async () => pkg('p'),
  })
  assert.equal(result.outcome.kind, 'choose')
  assert.deepEqual(attachablePaths(result, { candidates: ['lib'], chosen: ['lib/x/y'] }), ['lib/x/y'])
  assert.deepEqual(attachablePaths(result, { candidates: ['lib'], chosen: ['lib/别的'] }), [], '勾中的必须是检出的那几条')
  assert.deepEqual(attachablePaths(result, { candidates: ['lib'] }), [], '没勾 ⇒ 空')
})

test('none 支：候选下一无所有 ⇒ 什么都不附加', async () => {
  const result = await scanAttachRoots({ candidates: ['empty'], files: ['README.md'], read: async () => null, allowedTypes: [] })
  assert.equal(result.readCount, 0, '没有 .java 就不该发起任何读取')
  assert.equal(result.outcome.kind, 'none')
  assert.deepEqual(attachablePaths(result, { candidates: ['empty'], confirmed: true }), [])
})

test('多个候选共享同一文件时只读一次（seen 去重）', async () => {
  let reads = 0
  await scanAttachRoots({ candidates: ['src', 'src/main'], files: ['src/main/java/A.java'], read: async () => { reads += 1; return pkg('java') } })
  assert.equal(reads, 1)
})
