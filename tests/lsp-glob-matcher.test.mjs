// LSP glob 匹配与动态注册文件筛选的判据（`src/lspGlobMatcher.ts` + `src/lspDynamicCapabilities.ts`）。
//
// 上游依据（本轮逐条打开参考树核对，路径与行号都存在）：
//   · `platform/lsp-impl/src/impl/LspGlobMatcher.kt:8-27` —— `pathMatches` 的四条：
//     basePath 相等 / 前缀 / 不匹配 / 目录一律 true。
//   · `platform/util/src/com/intellij/openapi/util/globUtil.kt:36-78` —— `getPathMatcher`
//     把 `**/` 展开成 `{**/,}` 以绕开 JDK glob 对 globstar 的缺陷（`**/foo.txt` 要能匹配 `foo.txt`）。
//   · `platform/lsp-impl/src/impl/fileEvents/FileChangeInfo.kt:16-28` —— watchKind 的位语义。
//   · `platform/lsp-impl/src/impl/fileEvents/LspWatchedFiles.kt:30-45` —— 逐 watcher 先 kind 后 glob，
//     `RelativePattern` 的 baseUri 必须是真实存在的目录。
//   · `platform/lsp-impl/src/impl/LspClientImpl.kt:638-655` —— documentSelector 逐 filter：
//     `scheme` 非空且非 `file` ⇒ 跳过、language/pattern 都空 ⇒ 跳过、两条都要命中；
//     `:640` 没有 selector = 匹配任何文件。
//   · `platform/lsp-impl/src/impl/LspDynamicCapabilities.kt:110-160` —— 按 method 存、按 id 摘。
//
// 判据的口径：不止测规则本身，还驱动**真实消费链** ——
// `src/lspPerFileCapabilities.ts` 的文件级闸（静态被拒 + 动态注册命中该文件 ⇒ 仍然放行）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearGlobMatcherCache, fileEventMatchesWatchers, globMatches, pathMatchesGlob,
  watcherKindMatchesFileChangeType,
} from '../src/lspGlobMatcher.ts'
import {
  clearDynamicCapabilityRules, documentSelectorMatches, dynamicCapabilityHandlesFile,
  dynamicRegistrationCovers, lspDocumentSelectorsOf, lspRegistrationRules,
  registrationMethodFor, setDynamicCapabilityRules,
} from '../src/lspDynamicCapabilities.ts'
import { PerFileFeatureTable } from '../src/lspPerFileCapabilities.ts'
import { clearHighlightLevels } from '../src/highlightSettingsPerFile.ts'

test.after(() => { clearGlobMatcherCache(); clearDynamicCapabilityRules(); clearHighlightLevels() })

test('globstar 修的是 JDK 那个缺陷：`**/foo.txt` 命中零层与多层，`src/**/foo.txt` 命中中间', () => {
  // globUtil.kt 的类注释点名这两条：`foo.txt` 与 `src/foo.txt` 都必须命中 `**/foo.txt`。
  assert.equal(globMatches('foo.txt', '**/foo.txt'), true, '零层目录没命中 —— 就是上游要修的 JDK 缺陷')
  assert.equal(globMatches('src/foo.txt', '**/foo.txt'), true)
  assert.equal(globMatches('src/a/b/foo.txt', '**/foo.txt'), true)
  assert.equal(globMatches('src/foo.txt', 'src/**/foo.txt'), true, '中间零层')
  assert.equal(globMatches('src/a/b/foo.txt', 'src/**/foo.txt'), true, '中间多层')
  assert.equal(globMatches('other/foo.txt', 'src/**/foo.txt'), false)
})

test('`*` 段内、`?` 单字符、`{a,b}` 或组；大小写敏感、非法 pattern 不抛', () => {
  assert.equal(globMatches('src/Alpha.java', 'src/*.java'), true)
  assert.equal(globMatches('src/a/Alpha.java', 'src/*.java'), false, '`*` 不跨目录')
  assert.equal(globMatches('src/A.java', 'src/?.java'), true)
  assert.equal(globMatches('src/AB.java', 'src/?.java'), false)
  assert.equal(globMatches('src/A.java', 'src/{A,B}.java'), true, '花括号组（JDK glob 的或）')
  assert.equal(globMatches('src/B.java', 'src/{A,B}.java'), true)
  assert.equal(globMatches('src/C.java', 'src/{A,B}.java'), false)
  assert.equal(globMatches('src/alpha.java', 'src/Alpha.java'), false, '大小写敏感')
  assert.equal(globMatches('src/a.java', 'src/['), false, '非法 pattern 不抛，返回 false')
  assert.equal(globMatches('anything', ''), false, '空 pattern 不匹配任何东西')
})

test('pathMatches：basePath 相等/前缀/不匹配三条，目录一律 true（LspGlobMatcher.kt:8-27）', () => {
  assert.equal(pathMatchesGlob('proj/src/a.ts', false, '**/*.ts', 'proj'), true)
  assert.equal(pathMatchesGlob('proj/src/a.ts', false, '**/*.ts', 'proj/src'), true, '裁成 a.ts 后仍命中 **/*.ts')
  assert.equal(pathMatchesGlob('other/src/a.ts', false, '**/*.ts', 'proj'), false,
    'base URI 对不上 ⇒ 直接 false（:14 那条 return）')
  assert.equal(pathMatchesGlob('proj/src', true, '*.ts', 'proj'), true, '目录一律 true（:18-21 的注释）')
  assert.equal(pathMatchesGlob('proj/src', true, '*.ts', 'other'), false, '目录也先过 base 那一条')
  assert.equal(pathMatchesGlob('proj/src/a.ts', false, '**/*.ts', 'proj/'), true, 'basePath 末尾斜杠要归一')
  assert.equal(pathMatchesGlob('proj\\src\\a.ts', false, '**/*.ts', 'proj'), true, 'Windows 分隔符要归一')
})

test('watchKind 位语义：null 三类都管，否则按位与（FileChangeInfo.kt:16-28）', () => {
  assert.equal(watcherKindMatchesFileChangeType(null, 1), true)
  assert.equal(watcherKindMatchesFileChangeType(undefined, 2), true)
  assert.equal(watcherKindMatchesFileChangeType(1, 1), true, 'Create 位管 Created')
  assert.equal(watcherKindMatchesFileChangeType(1, 2), false, 'Create 位不管 Changed')
  assert.equal(watcherKindMatchesFileChangeType(2, 2), true)
  assert.equal(watcherKindMatchesFileChangeType(4, 3), true, 'Delete 位管 Deleted')
  assert.equal(watcherKindMatchesFileChangeType(7, 1), true, '7 = 三类全开')
})

test('文件事件筛选：裸 glob 与 RelativePattern 两条，baseUri 找不到目录就跳过（LspWatchedFiles.kt:30-45）', () => {
  const created = { path: 'proj/src/a.ts', uri: 'file:///proj/src/a.ts', isDirectory: false, changeType: 1 }
  assert.equal(fileEventMatchesWatchers(created, [{ globPattern: '**/*.ts' }]), true)
  assert.equal(fileEventMatchesWatchers(created, [{ globPattern: '**/*.java' }]), false)
  assert.equal(fileEventMatchesWatchers(created, [{ globPattern: '**/*.ts', kind: 2 }]), false,
    'kind 只开 Change ⇒ Created 事件不该转给服务器')
  assert.equal(fileEventMatchesWatchers(created, [{ globPattern: '**/*.ts', kind: 1 }]), true)
  // RelativePattern：baseUri 落成目录后才判；落不出来（找不到那个目录）这条 watcher 整个跳过。
  const relative = { globPattern: { baseUri: 'file:///proj', pattern: 'src/**/*.ts' } }
  assert.equal(fileEventMatchesWatchers(created, [relative], uri => uri === 'file:///proj' ? 'proj' : undefined), true)
  assert.equal(fileEventMatchesWatchers(created, [relative], () => undefined), false,
    'baseUri 的目录不存在 ⇒ 跳过（上游 baseDir != null && isDirectory）')
  // 目录事件：base 匹配之后一律 true（glob 不参与）。
  const dir = { path: 'proj/src', uri: 'file:///proj/src', isDirectory: true, changeType: 2 }
  assert.equal(fileEventMatchesWatchers(dir, [{ globPattern: '**/*.ts' }]), true)
})

test('documentSelector：没有 selector = 匹配任何文件；scheme/language/pattern 三条闸逐条（LspClientImpl.kt:638-655）', () => {
  assert.equal(documentSelectorMatches(null, 'src/A.java', 'java'), true, ':640 没有 selector')
  assert.equal(documentSelectorMatches(undefined, 'src/A.java', 'java'), true)
  assert.equal(documentSelectorMatches([], 'src/A.java', 'java'), false, '空数组 = 一条 filter 都没有 ⇒ 不匹配')
  assert.equal(documentSelectorMatches([{ language: 'java' }], 'src/A.java', 'java'), true)
  assert.equal(documentSelectorMatches([{ language: 'java' }], 'src/A.ts', 'typescript'), false)
  assert.equal(documentSelectorMatches([{ scheme: 'untitled' }], 'src/A.java', 'java'), false,
    'scheme 非空且不是 file ⇒ 跳过')
  assert.equal(documentSelectorMatches([{ scheme: 'file', language: 'java' }], 'src/A.java', 'java'), true)
  assert.equal(documentSelectorMatches([{ pattern: '**/*.java' }], 'src/A.java', 'java'), true)
  assert.equal(documentSelectorMatches([{ pattern: '**/*.java' }], 'src/A.ts', 'typescript'), false)
  assert.equal(documentSelectorMatches([{}], 'src/A.java', 'java'), false,
    'language 与 pattern 都空 ⇒ 跳过（:645）')
  assert.equal(documentSelectorMatches([{ language: 'kotlin' }, { language: 'java' }], 'src/A.java', 'java'), true,
    '多条 filter 是「或」')
})

test('lspRegistrationRules 从宿主原样转出来的形状里抽规则；坏条目不登记', () => {
  const rules = lspRegistrationRules([
    { id: 'r1', method: 'textDocument/inlayHint', registerOptions: { documentSelector: [{ language: 'java' }] } },
    { id: 'r2', method: 'textDocument/hover' },
    { method: 'no-id' }, { id: 'no-method' }, null, 'str',
  ])
  assert.deepEqual(rules.map(rule => rule.id), ['r1', 'r2'])
  assert.deepEqual(rules[0].documentSelector, [{ language: 'java' }])
  assert.equal(rules[1].documentSelector, null, '没有 registerOptions ⇒ 按「没有 selector」= 匹配任何文件')
  assert.equal(lspDocumentSelectorsOf('not-an-array'), null)
  assert.deepEqual(lspDocumentSelectorsOf([{ language: 1, pattern: 'x' }]), [{ pattern: 'x' }],
    '非字符串字段丢掉，剩下的仍认')
})

test('registrationMethodFor：两边名字不同的那几条映射对，其余按 textDocument/<kind> 兜底', () => {
  assert.equal(registrationMethodFor('diagnostic'), 'textDocument/diagnostic')
  assert.equal(registrationMethodFor('workspaceSymbol'), 'workspace/symbol')
  assert.equal(registrationMethodFor('executeCommand'), 'workspace/executeCommand')
  assert.equal(registrationMethodFor('completionItemResolve'), 'textDocument/completion',
    'resolve 归 completion 那一族')
  assert.equal(registrationMethodFor('inlayHint'), 'textDocument/inlayHint')
  assert.equal(registrationMethodFor('someNewKind'), 'textDocument/someNewKind')
})

test('dynamicCapabilityHandlesFile：只认命中的 method + selector 两条', () => {
  const rules = [
    { id: 'a', method: 'textDocument/inlayHint', documentSelector: [{ language: 'java' }] },
    { id: 'b', method: 'textDocument/inlayHint', documentSelector: [{ language: 'kotlin' }] },
  ]
  assert.equal(dynamicCapabilityHandlesFile(rules, 'textDocument/inlayHint', 'src/A.java', 'java'), true)
  assert.equal(dynamicCapabilityHandlesFile(rules, 'textDocument/inlayHint', 'src/A.kt', 'kotlin'), true)
  assert.equal(dynamicCapabilityHandlesFile(rules, 'textDocument/inlayHint', 'src/A.ts', 'typescript'), false)
  assert.equal(dynamicCapabilityHandlesFile(rules, 'textDocument/hover', 'src/A.java', 'java'), false,
    'method 对不上')
})

test('消费链：静态被拒 + 动态注册命中该文件 ⇒ 文件级闸仍然放行（LspClientImpl 的「或」）', async () => {
  clearDynamicCapabilityRules()
  clearHighlightLevels()
  const table = new PerFileFeatureTable()
  // 先让服务器把 inlayHint 记成「这台服务器不支持」（一次确定的拒绝）。
  table.noteServerDeclined('inlayHint', 'src/A.java')
  assert.equal(table.plan('inlayHint', 'src/A.java').ask, false, '没有动态注册时仍然按静态拒绝挡住')
  // 服务器随后给 java 文件动态注册了 inlayHint —— 上游的 supportsInlayHints(file) 是「或」，
  // 这一支命中就该放行。
  setDynamicCapabilityRules([
    { id: 'r1', method: 'textDocument/inlayHint', documentSelector: [{ language: 'java' }] },
  ])
  assert.equal(table.plan('inlayHint', 'src/A.java').ask, true,
    '动态注册命中了这个文件，却仍被静态那一格连坐 —— 上游是「静态 or 动态」')
  // selector 只给 java 注册：ts 文件这一支**不**命中（ts 从没被拒过，所以表放行是它本来的状态，
  // 这里直接问规则层，确认 selector 真的按语言收窄了）。
  assert.equal(dynamicRegistrationCovers('inlayHint', 'src/B.ts', 'typescript'), false,
    'selector 只给 java 注册，ts 文件不该命中这条动态注册')
  // 注销（整批清）之后回到静态拒绝那一档。
  clearDynamicCapabilityRules()
  assert.equal(table.plan('inlayHint', 'src/A.java').ask, false)
})

test('动态注册命中但静态没拒过：本来就是放行的（这一支不动原行为）', () => {
  clearDynamicCapabilityRules()
  const table = new PerFileFeatureTable()
  setDynamicCapabilityRules([{ id: 'r1', method: 'textDocument/inlayHint', documentSelector: null }])
  assert.equal(table.plan('inlayHint', 'src/A.java').ask, true)
  assert.equal(dynamicRegistrationCovers('inlayHint', 'src/A.java', 'java'), true)
  assert.equal(dynamicRegistrationCovers('inlayHint', 'src/A.java', 'java'), true)
  clearDynamicCapabilityRules()
  assert.equal(dynamicRegistrationCovers('inlayHint', 'src/A.java', 'java'), false)
})