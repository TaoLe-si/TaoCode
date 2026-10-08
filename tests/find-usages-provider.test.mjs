// 查找用法的**按语言 provider 层**判据（上游 `FindUsagesProvider`/`LanguageFindUsages`/
// `DescriptiveNameUtil`/`EmptyFindUsagesProvider`，`platform/indexing-api/src/com/intellij/lang/findUsages/`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_FIND_USAGES_PROVIDER,
  EMPTY_FIND_USAGES_PROVIDER,
  SYMBOL_KIND_TYPE_LABELS,
  USAGE_SEARCH_CONTEXT,
  canFindUsagesFor,
  descriptiveNameFor,
  findUsagesElementAt,
  findUsagesHelpId,
  findUsagesNodeText,
  findUsagesType,
  providersForLanguage,
  registerFindUsagesProvider,
  symbolKindLabel,
  usageSearchContextFor,
  usageViewTarget,
} from '../src/findUsagesProvider.ts'

test('UsageSearchContext 五位逐字对上上游', () => {
  assert.equal(USAGE_SEARCH_CONTEXT.IN_CODE, 0x1)
  assert.equal(USAGE_SEARCH_CONTEXT.IN_COMMENTS, 0x2)
  assert.equal(USAGE_SEARCH_CONTEXT.IN_STRINGS, 0x4)
  assert.equal(USAGE_SEARCH_CONTEXT.IN_FOREIGN_LANGUAGES, 0x8)
  assert.equal(USAGE_SEARCH_CONTEXT.IN_PLAIN_TEXT, 0x10)
  assert.equal(USAGE_SEARCH_CONTEXT.ANY, 0xff)
})

test('EmptyFindUsagesProvider：canFindUsagesFor 恒 false、getType 空串、nodeText 取名字', () => {
  const element = { name: 'Foo', kind: 5, containerName: 'pkg' }
  assert.equal(EMPTY_FIND_USAGES_PROVIDER.canFindUsagesFor(element), false)
  assert.equal(EMPTY_FIND_USAGES_PROVIDER.getType(element), '')
  assert.equal(EMPTY_FIND_USAGES_PROVIDER.getNodeText({ name: 'Foo' }, false), 'Foo')
  // 上游 getDescriptiveName = getNodeText(element, true)。
  assert.equal(EMPTY_FIND_USAGES_PROVIDER.getDescriptiveName({ name: 'Foo', containerName: 'pkg' }), 'pkg.Foo')
})

test('类型标签：LSP SymbolKind → 中文类型名，认不出给空串', () => {
  assert.equal(SYMBOL_KIND_TYPE_LABELS[5], '类')
  assert.equal(SYMBOL_KIND_TYPE_LABELS[6], '方法')
  assert.equal(SYMBOL_KIND_TYPE_LABELS[11], '接口')
  assert.equal(findUsagesType({ name: 'Foo', kind: 5 }), '类')
  assert.equal(findUsagesType({ name: 'run', kind: 6 }), '方法')
  assert.equal(findUsagesType({ name: 'x' }), '', '认不出种类给空串（标题里就不带它）')
  assert.equal(symbolKindLabel(23), 'Struct', '与 lspSymbolBridge 同表')
})

test('描述名：短名 = 名字，长名带容器；文件那一档直接用文件名', () => {
  const element = { name: 'bar', kind: 6, containerName: 'Foo' }
  assert.equal(findUsagesNodeText(element, false), 'bar')
  assert.equal(findUsagesNodeText(element, true), 'Foo.bar')
  assert.equal(descriptiveNameFor(element), 'Foo.bar')
  // `DescriptiveNameUtil:25-27` 的 PsiFile 那一档：是文件时直接给文件名（不拼容器）。
  assert.equal(descriptiveNameFor({ name: 'Foo.java', isFile: true, containerName: 'x' }), 'Foo.java')
})

test('usageViewTarget：短名/长名/类型标签三格，缺名字时退回', () => {
  const target = usageViewTarget({ name: 'bar', kind: 6, containerName: 'Foo' })
  assert.deepEqual(target, { shortName: 'bar', longName: 'Foo.bar', typeLabel: '方法' })
  // 没有容器名时长名 = 短名。
  assert.equal(usageViewTarget({ name: 'Foo', kind: 5 }).longName, 'Foo')
})

test('providersForLanguage：语言专属在前，通用兜底总在最后', () => {
  registerFindUsagesProvider({ id: 'python-test', languages: ['python'], getType: () => 'python 元素' })
  const providers = providersForLanguage('python')
  assert.equal(providers[0].id, 'python-test')
  assert.equal(providers[providers.length - 1].id, 'lsp', '通用 provider 总在最后')
  // 没有专属 provider 的语言只给通用那份（上游是退 EmptyFindUsagesProvider；本仓的通用 provider
  // 就是本仓的 Empty —— 它按 LSP kind 出标签，认不出时 getType 给空串）。
  const java = providersForLanguage('java')
  assert.equal(java.length, 1)
  assert.equal(java[0].id, 'lsp')
  assert.equal(providersForLanguage(undefined)[0].id, 'lsp')
})

test('canFindUsagesFor / helpId / searchContext 的问法', () => {
  assert.equal(canFindUsagesFor({ name: 'Foo' }), true)
  assert.equal(canFindUsagesFor({ name: '' }), false, '没有名字不值得搜')
  assert.equal(findUsagesHelpId({ name: 'Foo' }), null, '本仓没有帮助主题')
  assert.equal(usageSearchContextFor({ name: 'Foo' }), DEFAULT_FIND_USAGES_PROVIDER.searchContext)
  assert.equal(usageSearchContextFor({ name: 'Foo' }), USAGE_SEARCH_CONTEXT.IN_CODE | USAGE_SEARCH_CONTEXT.IN_COMMENTS | USAGE_SEARCH_CONTEXT.IN_STRINGS)
})

test('findUsagesElementAt：包住位置的最内层符号 + 祖先名当容器', () => {
  const symbols = [
    { name: 'Foo', kind: 5, startLine: 0, startChar: 0, endLine: 9, endChar: 1 },
    { name: 'bar', kind: 6, startLine: 2, startChar: 2, endLine: 4, endChar: 3 },
    { name: 'baz', kind: 13, startLine: 3, startChar: 4, endLine: 3, endChar: 7 },
  ]
  // 光标在 baz（第 3 行第 5 列）⇒ 最内层 baz，容器 Foo.bar。
  assert.deepEqual(findUsagesElementAt(symbols, 3, 5), { name: 'baz', kind: 13, containerName: 'Foo.bar', language: undefined })
  // 光标在 bar 的方法签名行（第 2 行第 2 列，baz 还没开始）⇒ bar，容器 Foo。
  assert.deepEqual(findUsagesElementAt(symbols, 2, 2), { name: 'bar', kind: 6, containerName: 'Foo', language: undefined })
  // 光标落在符号外 ⇒ null。
  assert.equal(findUsagesElementAt(symbols, 20, 0), null)
  assert.equal(findUsagesElementAt([], 0, 0), null)
})

test('接线：文件树的「查找用法」把 provider 算出的标题带进语义请求', () => {
  const tree = readFileSync(new URL('../src/treeActions.ts', import.meta.url), 'utf8')
  assert.match(tree, /import \{ findUsagesElementAt, usageViewTarget \} from '\.\/findUsagesProvider\.ts'/)
  assert.match(tree, /const element = findUsagesElementAt\(outline\.value, line, character\)/)
  assert.match(tree, /void onSemantic\(\{ kind: 'references', path, line, character, usage \}\)/)
  const semantic = readFileSync(new URL('../src/semanticActions.ts', import.meta.url), 'utf8')
  assert.match(semantic, /startReferences\(payload\.usage\?\.shortName \|\| symbol, payload\.usage\?\.longName \|\|/)
})