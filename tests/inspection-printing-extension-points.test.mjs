// 判据 · **检查与打印/HTML 导出的扩展点**（`src/inspectionPrintingExtensionPoints.ts`，上游
// `ErrorOptionsProvider` 与 `PrintOption` 一族）。
//
// 钉四件事：
//   ① 两条 EP 的 id 与上游 xml/类（文件头逐行出处）逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效；返回 null 的选项段跳过；
//   ③ 消费面真的读 EP：`errorOptionsSections` / `printOptionReferences`（合并各收集器）/
//      `printOptionSections`；
//   ④ 本仓内建的行号引用收集器真的扫出 `path:line` 引用。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BUILTIN_PRINT_OPTION_ID,
  ERROR_OPTIONS_PROVIDER_EP,
  PRINT_OPTION_EP,
  builtinPrintOption,
  errorOptionsSections,
  printOptionReferences,
  printOptionSections,
  registerBundledPrintOption,
  registerErrorOptionsProvider,
  registerPrintOption,
} from '../src/inspectionPrintingExtensionPoints.ts'

test('两条 EP 已声明，id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(ERROR_OPTIONS_PROVIDER_EP, 'com.intellij.errorOptionsProvider')
  assert.equal(PRINT_OPTION_EP, 'com.intellij.printOption')
  for (const id of [ERROR_OPTIONS_PROVIDER_EP, PRINT_OPTION_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('第三方错误高亮选项提供方按 id 注册后被 errorOptionsSections 拿到；返回 null 跳过', () => {
  const real = registerErrorOptionsProvider({
    id: 'demo.errOpts',
    options: () => ({ title: '演示段', rows: [{ key: 'demo.key', label: '演示', value: 'on' }] }),
  })
  const skip = registerErrorOptionsProvider({ id: 'demo.errOpts.none', options: () => null })
  try {
    const sections = errorOptionsSections()
    assert.equal(sections.length, 1)
    assert.equal(sections[0].title, '演示段')
  } finally {
    real.dispose(); skip.dispose()
  }
  assert.deepEqual(errorOptionsSections(), [])
})

test('HTML 导出引用收集：第三方收集器按 id 注册后被 printOptionReferences 合并', () => {
  const collector = registerPrintOption({
    id: 'demo.print', collectReferences: (path) => [{ path, line: 2, text: 'Other.ts', column: 0 }],
  })
  try {
    const refs = printOptionReferences('src/A.ts', 'const x = 1')
    assert.deepEqual(refs, [{ path: 'src/A.ts', line: 2, text: 'Other.ts', column: 0 }])
  } finally { collector.dispose() }
  assert.deepEqual(printOptionReferences('src/A.ts', 'x'), [])
})

test('打印选项段从各 PrintOption 收；没有 options 的不进表', () => {
  const withOptions = registerPrintOption({
    id: 'demo.print.opts', collectReferences: () => [],
    options: () => ({ title: '导出选项', rows: [{ key: 'k', label: 'l', value: 'v' }] }),
  })
  const noOptions = registerPrintOption({ id: 'demo.print.none', collectReferences: () => [] })
  try {
    const sections = printOptionSections()
    assert.equal(sections.length, 1)
    assert.equal(sections[0].title, '导出选项')
  } finally {
    withOptions.dispose(); noOptions.dispose()
  }
  assert.deepEqual(printOptionSections(), [])
})

test('内建行号引用收集器扫出 path:line，挂上后被导出消费点拿到', () => {
  assert.equal(builtinPrintOption().id, BUILTIN_PRINT_OPTION_ID)
  const text = ['// see src/A.ts:12', 'const x = 1', '// also lib/B.java:7'].join('\n')
  const dispose = registerBundledPrintOption()
  try {
    const refs = printOptionReferences('src/Main.ts', text)
    assert.deepEqual(refs.map(r => r.text), ['src/A.ts:12', 'lib/B.java:7'])
    assert.equal(refs[0].line, 1)
    assert.equal(refs[1].line, 3)
  } finally { dispose() }
  assert.deepEqual(printOptionReferences('src/Main.ts', text), [])
})
