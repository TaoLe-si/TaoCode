// 判据 · **转到 类/符号/文件 的扩展点**（`src/gotoByNameContributors.ts`，上游
// `com.intellij.navigation.ChooseByNameContributor` 一族）。
//
// 钉四件事：
//   ① 三个 EP 的 id 与上游 `ChooseByNameContributor.java:26-28` 的 `ExtensionPointName` 逐字一致，
//      且已在宿主里声明；
//   ② 贡献者注册/注销按 id 生效，模型分表（symbol/class/file 互不串）；
//   ③ `gotoByNameContributions` 收全表、去重、尊重 `isAvailableNow`；
//   ④ LSP 那两条 bundled 贡献（`LspGoToSymbolContributor`/`LspGoToClassContributor` 的等价物）
//      真的读缓存快照并按 kind 过滤（转到类只收 Class/Interface/Enum/Struct）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { APPLICATION_SCOPE, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  GOTO_CLASS_EP, GOTO_FILE_EP, GOTO_SYMBOL_EP,
  gotoByNameContributions, gotoByNameContributors, gotoByNameExtensionPoint,
  lspGotoClassContributor, lspGotoSymbolContributor,
  registerGotoByNameContributor, registerLspGotoContributors, unregisterGotoByNameContributor,
} from '../src/gotoByNameContributors.ts'

const sym = (name, kind, line = 1) => ({ name, kind, path: `src/${name}.ts`, line, character: 0 })

test('三个 EP 已声明，id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(GOTO_CLASS_EP, 'com.intellij.gotoClassContributor')
  assert.equal(GOTO_SYMBOL_EP, 'com.intellij.gotoSymbolContributor')
  assert.equal(GOTO_FILE_EP, 'com.intellij.gotoFileContributor')
  for (const id of [GOTO_CLASS_EP, GOTO_SYMBOL_EP, GOTO_FILE_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
  assert.equal(gotoByNameExtensionPoint('class'), GOTO_CLASS_EP)
  assert.equal(gotoByNameExtensionPoint('file'), GOTO_FILE_EP)
})

test('贡献者按 id 注册/注销，模型分表互不串', () => {
  const handle = registerGotoByNameContributor({
    id: 'demo.sym', model: 'symbol', getItemsByName: () => [sym('Alpha', 12)],
  })
  try {
    assert.ok(gotoByNameContributors('symbol').some(c => c.id === 'demo.sym'))
    assert.equal(gotoByNameContributors('class').some(c => c.id === 'demo.sym'), false)
    const items = gotoByNameContributions('symbol', 'Alpha', 'Alpha')
    assert.ok(items.some(item => item.name === 'Alpha'))
    assert.equal(gotoByNameContributions('class', 'Alpha', 'Alpha').length, 0)
  } finally {
    handle.dispose()
  }
  assert.equal(gotoByNameContributors('symbol').some(c => c.id === 'demo.sym'), false)
  assert.equal(unregisterGotoByNameContributor('symbol', 'demo.sym'), false, '已注销再注销返回 false')
})

test('isAvailableNow 为假的贡献不进结果；未给的方法缺省可用', () => {
  registerGotoByNameContributor({
    id: 'demo.off', model: 'symbol', isAvailableNow: () => false, getItemsByName: () => [sym('Hidden', 12)],
  })
  registerGotoByNameContributor({
    id: 'demo.on', model: 'symbol', getItemsByName: () => [sym('Shown', 12)],
  })
  try {
    const names = gotoByNameContributions('symbol', 'x', 'x').map(item => item.name)
    assert.equal(names.includes('Hidden'), false)
    assert.ok(names.includes('Shown'))
  } finally {
    unregisterGotoByNameContributor('symbol', 'demo.off')
    unregisterGotoByNameContributor('symbol', 'demo.on')
  }
})

test('合并去重：同一位置同名同 kind 合成一条', () => {
  registerGotoByNameContributor({ id: 'demo.a', model: 'symbol', getItemsByName: () => [sym('Dup', 6, 3)] })
  registerGotoByNameContributor({ id: 'demo.b', model: 'symbol', getItemsByName: () => [sym('Dup', 6, 3)] })
  try {
    const items = gotoByNameContributions('symbol', 'Dup', 'Dup').filter(item => item.name === 'Dup')
    assert.equal(items.length, 1)
  } finally {
    unregisterGotoByNameContributor('symbol', 'demo.a')
    unregisterGotoByNameContributor('symbol', 'demo.b')
  }
})

test('LSP 两条 bundled 贡献：符号不过滤 kind、转类只收四类', () => {
  const store = [sym('Widget', 5), sym('run', 6), sym('Itf', 11), sym('Enum', 10), sym('Struct', 23)]
  const source = { snapshot: () => store }
  const symbol = lspGotoSymbolContributor(source)
  const klass = lspGotoClassContributor(source)
  assert.equal(symbol.getItemsByName('x', 'x').length, 5, '转到符号不过滤 kind')
  assert.deepEqual(klass.getItemsByName('x', 'x').map(item => item.kind).sort((a, b) => a - b), [5, 10, 11, 23])
  assert.equal(symbol.isAvailableNow(), true)
  assert.equal(lspGotoSymbolContributor({ snapshot: () => [] }).isAvailableNow(), false)

  const dispose = registerLspGotoContributors(source)
  try {
    assert.ok(gotoByNameContributors('class').some(c => c.id === 'lsp.gotoClass'))
    assert.ok(gotoByNameContributors('symbol').some(c => c.id === 'lsp.gotoSymbol'))
    assert.equal(gotoByNameContributions('class', 'x', 'x').length, 4)
    assert.equal(gotoByNameContributions('symbol', 'x', 'x').length, 5)
  } finally {
    dispose()
  }
  assert.equal(gotoByNameContributors('class').some(c => c.id === 'lsp.gotoClass'), false)
})

test('scope：application 贡献对任意 scope 可见', () => {
  registerGotoByNameContributor(
    { id: 'demo.scoped', model: 'file', getItemsByName: () => [sym('file-ish', 1)] },
    { scope: APPLICATION_SCOPE },
  )
  try {
    assert.ok(gotoByNameContributions('file', 'x', 'x', '/some/root').some(item => item.name === 'file-ish'))
  } finally {
    unregisterGotoByNameContributor('file', 'demo.scoped')
  }
})
