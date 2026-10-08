// 判据 · **文档目标一族的其余四条 EP**（`src/documentationTargetExtensionPoints.ts`，上游
// `com.intellij.platform.backend.documentation.psiTargetProvider` / `symbolTargetProvider` /
// `lookupElementTargetProvider` / `linkHandler` 四条 EP；族里第一条 `targetProvider` 的判据在
// `tests/documentation-extension-points.test.mjs`）。
//
// 钉四件事：
//   ① 四条 EP 的 id 与上游 `ExtensionPointName.create` 的串逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效、按语言过滤（未知语言不收窄）；
//   ③ **真实消费点**读 EP：`documentationTargetsFor`（`src/documentationExtensionPoints.ts`，
//      弹层 `src/quickDocHost.ts` 取文档时问）取到 psi 那一族的第三方贡献；
//   ④ bundled 四支 passthrough 真的在 EP 里，且不改变既有行为。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  BUNDLED_LINK_HANDLER_ID,
  BUNDLED_LOOKUP_ELEMENT_TARGET_PROVIDER_ID,
  BUNDLED_PSI_TARGET_PROVIDER_ID,
  BUNDLED_SYMBOL_TARGET_PROVIDER_ID,
  LINK_HANDLER_EP,
  LOOKUP_ELEMENT_TARGET_PROVIDER_EP,
  PSI_TARGET_PROVIDER_EP,
  SYMBOL_TARGET_PROVIDER_EP,
  documentationLinkHandlers,
  documentationTargetForLookupElement,
  documentationTargetForSymbol,
  lookupElementDocumentationTargetProviders,
  psiDocumentationTargetProviders,
  psiDocumentationTargets,
  registerDocumentationLinkHandler,
  registerLookupElementDocumentationTargetProvider,
  registerPsiDocumentationTargetProvider,
  registerSymbolDocumentationTargetProvider,
  resolveDocumentationLinkTarget,
  symbolDocumentationTargetProviders,
} from '../src/documentationTargetExtensionPoints.ts'
// 真实消费点：文档目标的总收集口（弹层取文档走它）。
import { documentationFor, documentationTargetsFor } from '../src/documentationExtensionPoints.ts'

const element = (over = {}) => ({
  path: 'src/Sample.java', language: 'java', text: 'class Sample {}', line: 0, character: 6, ...over,
})
const target = (path, line, text) => ({
  path, line, character: 0, computeDocumentation: () => text,
})

test('四条 EP 的 id 与上游逐字一致，且都已在宿主里声明', () => {
  assert.equal(PSI_TARGET_PROVIDER_EP, 'com.intellij.platform.backend.documentation.psiTargetProvider')
  assert.equal(SYMBOL_TARGET_PROVIDER_EP, 'com.intellij.platform.backend.documentation.symbolTargetProvider')
  assert.equal(LOOKUP_ELEMENT_TARGET_PROVIDER_EP, 'com.intellij.platform.backend.documentation.lookupElementTargetProvider')
  assert.equal(LINK_HANDLER_EP, 'com.intellij.platform.backend.documentation.linkHandler')
  for (const id of [PSI_TARGET_PROVIDER_EP, SYMBOL_TARGET_PROVIDER_EP, LOOKUP_ELEMENT_TARGET_PROVIDER_EP, LINK_HANDLER_EP]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 应当已声明`)
  }
})

test('bundled 四支都在 EP 里，且都是 passthrough（既有行为不变）', () => {
  const ids = [
    ...psiDocumentationTargetProviders('java'), ...symbolDocumentationTargetProviders('java'),
    ...lookupElementDocumentationTargetProviders('java'), ...documentationLinkHandlers('java'),
  ].map(contribution => contribution.id)
  for (const id of [
    BUNDLED_PSI_TARGET_PROVIDER_ID, BUNDLED_SYMBOL_TARGET_PROVIDER_ID,
    BUNDLED_LOOKUP_ELEMENT_TARGET_PROVIDER_ID, BUNDLED_LINK_HANDLER_ID,
  ]) {
    assert.equal(ids.includes(id), true, `${id} 应当是 bundled 贡献`)
  }
  assert.deepEqual(psiDocumentationTargets(element()), [])
  assert.equal(documentationTargetForSymbol({ ...element(), symbol: 'Foo' }), null)
  assert.equal(documentationTargetForLookupElement({ ...element(), lookupString: 'foo' }), null)
  assert.equal(resolveDocumentationLinkTarget({ url: 'Foo', path: 'src/A.java', line: 0, character: 0, language: 'java' }), null)
})

test('psiTargetProvider：documentationTarget 非 null 就不再问同一提供方的 documentationTargets', () => {
  const provider = registerPsiDocumentationTargetProvider({
    id: 'test.psi.provider', languages: ['java'],
    documentationTarget: input => (input.character === 6 ? target('src/Other.java', 3, 'single') : null),
    documentationTargets: () => [target('src/List.java', 9, 'list')],
  })
  try {
    const hit = psiDocumentationTargets(element())
    assert.equal(hit.length, 1)
    assert.equal(hit[0].path, 'src/Other.java', '单条命中时不再问列表（上游 :37 的契约）')
    const miss = psiDocumentationTargets(element({ character: 0 }))
    assert.deepEqual(miss.map(entry => entry.path), ['src/List.java'])
    // 语言收窄
    assert.deepEqual(psiDocumentationTargets(element({ language: 'cpp' })), [])
    // 未知语言不收窄
    assert.equal(psiDocumentationTargets(element({ language: '' })).length, 1)
  } finally {
    provider.dispose()
  }
})

test('真实消费点：documentationTargetsFor 取到 psi 那一族的贡献，documentationFor 用它出正文', () => {
  const provider = registerPsiDocumentationTargetProvider({
    id: 'test.psi.consumed', languages: ['java'],
    documentationTarget: () => target('src/Consumed.java', 1, '来自第三方 psi provider 的文档'),
  })
  try {
    const targets = documentationTargetsFor(element())
    assert.equal(targets.length, 1)
    assert.equal(targets[0].path, 'src/Consumed.java')
    assert.equal(documentationFor(element()), '来自第三方 psi provider 的文档')
    // 语言不匹配时两条都不给
    assert.deepEqual(documentationTargetsFor(element({ language: 'cpp' })), [])
  } finally {
    provider.dispose()
  }
  assert.equal(documentationFor(element()), null, '拿掉贡献后回到「没有文档」那一档')
})

test('symbolTargetProvider：第一个非 null 说了算', () => {
  const first = registerSymbolDocumentationTargetProvider({
    id: 'test.symbol.first', languages: ['java'], documentationTarget: () => null,
  })
  const second = registerSymbolDocumentationTargetProvider({
    id: 'test.symbol.second', languages: ['java'],
    documentationTarget: input => target('src/Sym.java', 2, `符号 ${input.symbol}`),
  })
  try {
    const resolved = documentationTargetForSymbol({ ...element(), symbol: 'Foo#bar' })
    assert.equal(resolved?.path, 'src/Sym.java')
    assert.equal(resolved.computeDocumentation(), '符号 Foo#bar')
    assert.equal(documentationTargetForSymbol({ ...element({ language: 'cpp' }) , symbol: 'Foo' }), null)
  } finally {
    first.dispose()
    second.dispose()
  }
})

test('lookupElementTargetProvider：优先于服务端解析那一条链（找到即返回）', () => {
  const provider = registerLookupElementDocumentationTargetProvider({
    id: 'test.lookup.doc', languages: ['java'],
    documentationTarget: input => (input.lookupString === 'value' ? target('src/L.java', 4, '候选条目的文档') : null),
  })
  try {
    const hit = documentationTargetForLookupElement({ ...element(), lookupString: 'value', itemKind: 'property' })
    assert.equal(hit?.computeDocumentation(), '候选条目的文档')
    assert.equal(documentationTargetForLookupElement({ ...element(), lookupString: 'other' }), null)
  } finally {
    provider.dispose()
  }
})

test('linkHandler：第一个解出路径的说了算；解不出返回 null 让调用方走既有两条通道', () => {
  const handler = registerDocumentationLinkHandler({
    id: 'test.link.handler', languages: ['java'],
    resolveLink: input => (input.url.startsWith('docs:') ? {
      path: `src/${input.url.slice(5)}`, line: 7, character: 0, handlerId: '',
    } : null),
  })
  try {
    const resolved = resolveDocumentationLinkTarget({
      url: 'docs:Doc.java', path: 'src/Sample.java', line: 0, character: 0, language: 'java',
    })
    assert.equal(resolved?.path, 'src/Doc.java')
    assert.equal(resolved.line, 7)
    assert.equal(resolved.handlerId, 'test.link.handler', 'handlerId 由收集侧回填')
    assert.equal(resolveDocumentationLinkTarget({
      url: 'src/Plain.java', path: 'src/Sample.java', line: 0, character: 0, language: 'java',
    }), null)
    assert.equal(resolveDocumentationLinkTarget({
      url: 'docs:Doc.java', path: 'src/Sample.java', line: 0, character: 0, language: 'cpp',
    }), null)
  } finally {
    handler.dispose()
  }
})
