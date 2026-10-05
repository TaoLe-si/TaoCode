// `ls/features` 的补齐判据：按特性逐条的能力降级表（`src/lspFeatureMatrix.ts`）。
//
// 这张表是可执行契约，不是文档：
//   ① 覆盖 `src/bridge.ts` 的 `LspRequestKind` 全集（前端能发的每个 kind 都能查出降级处置）；
//   ② 每条落点文件真实存在（写错路径当场红）；
//   ③ provider 键与 `native/lsp_support.cpp` 的 `provider_for()` 对得上（漏一个就红）；
//   ④ 四档处置（hide/local/notice）都有真实用例，未登记的 kind 给 `notice` 而不是静默隐藏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LSP_FEATURES, degradationForKind, featureUsableWithoutServer, lspFeatureKinds, lspFeatureRow, unsupportedFeatureMessage } from '../src/lspFeatureMatrix.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFileSync(path, 'utf8')

test('覆盖前端会发的每一个 LSP kind（bridge.ts 的 LspRequestKind 全集）', () => {
  const bridge = read('src/bridge.ts')
  const union = bridge.match(/export type LspRequestKind =([^\n]+)/)?.[1] ?? ''
  const kinds = [...union.matchAll(/'([^']+)'/g)].map(match => match[1])
  assert.ok(kinds.length >= 30, `没解析出 LspRequestKind（拿到 ${kinds.length} 个）`)
  const missing = kinds.filter(kind => !lspFeatureRow(kind))
  assert.deepEqual(missing, [], `降级表缺这些 kind：${missing.join('、')}`)
  assert.equal(new Set(lspFeatureKinds()).size, lspFeatureKinds().length, 'kind 有重复登记')
})

test('provider 键与 native 的 provider_for 对得上', () => {
  const native = read('native/lsp_support.cpp') + read('native/lsp_capability_queries.cpp')
  for (const row of LSP_FEATURES) {
    // 层级两族的 provider 在 native 里是并列的 if 行；文件操作那族在 capability queries 里读 workspace.fileOperations。
    const head = row.provider.split('.')[0]
    assert.ok(native.includes(`"${row.provider}"`) || native.includes(`"${head}"`),
      `native 里没有 ${row.provider}（${row.kind}）`)
  }
})

test('每条落点文件真实存在，且都落在 src/ 下', () => {
  for (const row of LSP_FEATURES) {
    assert.ok(row.surface.startsWith('src/'), `${row.kind} 的落点不在 src/ 下：${row.surface}`)
    assert.ok(existsSync(join(root, row.surface)), `${row.kind} 的落点不存在：${row.surface}`)
  }
})

test('四档处置都有用例；未登记的 kind 按 notice 处理（不静默隐藏）', () => {
  const kinds = new Set(LSP_FEATURES.map(row => row.fallback))
  assert.deepEqual([...kinds].sort(), ['hide', 'local', 'notice'])
  assert.ok(LSP_FEATURES.some(row => row.fallback === 'hide'))
  assert.equal(degradationForKind('没登记过的能力'), 'notice')
  assert.equal(featureUsableWithoutServer('foldingRange'), true, '折叠有本地回退，服务缺失时仍可用')
  assert.equal(featureUsableWithoutServer('references'), false, '引用没有本地回退，必须隐藏入口')
})

test('不支持说明点名 provider 与处置（用户知道「点了会怎样」）', () => {
  const message = unsupportedFeatureMessage('callHierarchy', 'java')
  assert.match(message, /java 语言服务/)
  assert.match(message, /callHierarchyProvider/)
  assert.ok(message.length > 20)
  assert.match(unsupportedFeatureMessage('没登记过'), /不支持该操作/)
})
