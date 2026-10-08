// 判据 · daemon 域**分析侧**三条上游 EP 的宿主接线与真实消费（`src/daemonAnalysisExtensionPoints.ts`）
// + `src/daemonExtensionPoints.ts` 的声明回归闸。
//
// 上游依据（qualifiedName 逐字）：
//   · `com.intellij.daemon.externalAnnotatorsFilter` —— `platform/analysis-api/resources/intellij.platform.analysis.xml:23`
//     （`com.intellij.lang.ExternalAnnotatorsFilter.isProhibited(annotator, file)`；消费口径
//     `ExternalLanguageAnnotators.allForFile` `:20-26`：任一 filter 说 prohibited 就不跑那个 annotator）；
//   · `com.intellij.implicitUsageProvider` —— 同 XML `:25`
//     （`com.intellij.codeInsight.daemon.ImplicitUsageProvider`；消费口径 `RefUtil.java:26,36,55`：
//     任一 provider 为真即为真）；
//   · `com.intellij.contributedReferencesAnnotator` —— 同 XML `:30-32`
//     （`com.intellij.lang.annotation.ContributedReferencesAnnotator.annotate(element, references, holder)`；
//     消费口径 `HyperlinkAnnotator.java:76-86`：平台画完自己的链接后按语言取贡献者补注解）。
//
// 钉五件事：
//   ① 三条 EP 的 id 与上游逐字一致，且已在宿主里声明；
//   ② **回归闸**：调 `installPluginApi()`（插件宿主装 API 面的那条路）之后，daemon 域的十六条 EP
//      全在 `EXTENSIONS.extensionPointIds()` 里 —— 这条直接钉住「EP 声明没跟着入口走」那个缺陷；
//   ③ bundled 贡献者仍在（三条过滤器 / JUnit 5 隐式使用 / 注释文件路径链接）；
//   ④ 第三方按 id 注册的贡献被**真实消费点**拿到：过滤器 ⇒ 某个 annotator 被跳过、
//      implicitUsage ⇒ 某条 unused 注解被抑制、contributedReferences ⇒ 多出一条链接注解；
//   ⑤ 产出的链接 target 必须被判成「文件」（`src/documentLinks.ts` 的 `classifyLinkTarget`），
//      不能落在 `external` 那一档（那会走 `shell.openUrl`，见 `src/App.vue` 的 `openDocumentLink`）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXTENSIONS } from '../src/extensionPoints.ts'
import {
  CONTRIBUTED_REFERENCES_ANNOTATOR_EP, EXTERNAL_ANNOTATORS_FILTER_EP, IMPLICIT_USAGE_PROVIDER_EP,
  CHANGE_LOCALITY_DETECTOR_EP, ERROR_QUICK_FIX_PROVIDER_EP, FRONTEND_PROBLEMS_VIEW_CONTENT_PROVIDER_EP,
  HIGHLIGHT_VISITOR_EP, INSPECTION_ELEMENTS_MERGER_EP, INSPECTION_TOOL_PROVIDER_EP, INTENTION_ACTION_EP,
  LOCAL_INSPECTION_EP, PROBLEM_HIGHLIGHT_FILTER_EP, PROBLEMS_PROVIDER_EP,
  PROBLEMS_VIEW_BRIDGE_EP, PROBLEMS_VIEW_HIGHLIGHTING_PROBLEM_FACTORY_EP,
  PROBLEMS_VIEW_PANEL_PROVIDER_EP, declareDaemonExtensionPoints,
} from '../src/daemonExtensionPoints.ts'
import {
  contributedReferenceAnnotations, contributedReferencesAnnotators, externalAnnotatorsFilters,
  externalAnnotatorsFor, implicitUsageProviders, isExternalAnnotatorProhibited, isImplicitUsage,
  isImplicitRead, isImplicitWrite, isImplicitlyNotNullInitialized, registerContributedReferencesAnnotator,
  registerExternalAnnotatorsFilter, registerImplicitUsageProvider,
} from '../src/daemonAnalysisExtensionPoints.ts'
import { installPluginApi } from '../src/pluginApi.ts'
import { classifyLinkTarget } from '../src/documentLinks.ts'
import { annotatorRegistry, unusedDeclarationAnnotator, webLinkAnnotator } from '../src/annotatorHighlights.ts'
import { COMMENT_FILE_LINKS_ID, filePathLinksIn } from '../src/commentFileLinks.ts'
import { JUNIT5_IMPLICIT_USAGE_PROVIDER_ID } from '../src/junitImplicitUsage.ts'
import { implicitUsageElementOf, kindOfDeclaration, wordAt } from '../src/implicitUsageElement.ts'

/** 上游 `<extensionPoint qualifiedName="…">` 的字面量（逐字抄，写错一个字符插件就挂不上）。 */
const UPSTREAM_IDS = [
  // platform/analysis-api/resources/intellij.platform.analysis.xml:23
  'com.intellij.daemon.externalAnnotatorsFilter',
  // 同文件 :25
  'com.intellij.implicitUsageProvider',
  // 同文件 :30-32
  'com.intellij.contributedReferencesAnnotator',
]

/** daemon 域全部十六条 EP（十三条原有 + 本批三条），供回归闸逐条核。 */
const ALL_DAEMON_EPS = [
  HIGHLIGHT_VISITOR_EP, LOCAL_INSPECTION_EP, INSPECTION_TOOL_PROVIDER_EP, INTENTION_ACTION_EP,
  ERROR_QUICK_FIX_PROVIDER_EP, PROBLEM_HIGHLIGHT_FILTER_EP, PROBLEMS_PROVIDER_EP,
  INSPECTION_ELEMENTS_MERGER_EP, CHANGE_LOCALITY_DETECTOR_EP, PROBLEMS_VIEW_PANEL_PROVIDER_EP,
  PROBLEMS_VIEW_HIGHLIGHTING_PROBLEM_FACTORY_EP, FRONTEND_PROBLEMS_VIEW_CONTENT_PROVIDER_EP,
  PROBLEMS_VIEW_BRIDGE_EP, EXTERNAL_ANNOTATORS_FILTER_EP, IMPLICIT_USAGE_PROVIDER_EP,
  CONTRIBUTED_REFERENCES_ANNOTATOR_EP,
]

/** 一条 `tags: [1]`（Unnecessary）的未使用声明诊断。 */
const unusedDiagnostic = (line, character, endCharacter) => ({
  line, character, endLine: line, endCharacter, severity: 2, message: 'never used', tags: [1],
})

/** 跑一次 `unusedDeclarationAnnotator`（只它一个，方便数条数）。 */
const annotateUnused = (text, diagnostics, language = 'java') =>
  unusedDeclarationAnnotator.annotate({
    path: 'src/A.java', language, text, dirtyLines: null, batchMode: false,
    external: { diagnostics },
  })

test('三条 EP 的 id 与上游逐字一致，且已声明', () => {
  assert.equal(EXTERNAL_ANNOTATORS_FILTER_EP, UPSTREAM_IDS[0])
  assert.equal(IMPLICIT_USAGE_PROVIDER_EP, UPSTREAM_IDS[1])
  assert.equal(CONTRIBUTED_REFERENCES_ANNOTATOR_EP, UPSTREAM_IDS[2])
  for (const id of UPSTREAM_IDS) assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 应已声明`)
  // 声明幂等（重复调用只覆盖同名声明，不抛错）。
  declareDaemonExtensionPoints()
})

test('回归闸：installPluginApi() 之后 daemon 域十六条 EP 全在 extensionPointIds() 里', () => {
  installPluginApi()
  const ids = EXTENSIONS.extensionPointIds()
  const missing = ALL_DAEMON_EPS.filter(id => !ids.includes(id))
  assert.deepEqual(missing, [], `这些 daemon EP 在插件 API 装配后仍没声明：${missing.join('、')}`)
})

test('bundled 贡献者仍在：三条过滤器 + JUnit5 隐式使用 + 注释文件路径链接', () => {
  const filters = externalAnnotatorsFilters()
  const filterIds = filters.map(filter => filter.id)
  for (const id of ['taocode.largeFile', 'taocode.analysisIgnore', 'taocode.fileTypeOverride']) {
    assert.ok(filterIds.includes(id), `bundled 过滤器 ${id} 应已注册（现在：${filterIds.join('、')}）`)
  }
  // 大文件那条：阈是 `src/largeFileMode.ts` 的 LARGE_FILE_LIMIT（同一条判定，不重写）。
  const large = filters.find(filter => filter.id === 'taocode.largeFile')
  assert.equal(large.isProhibited({ id: 'x', languages: ['*'] }, { path: 'a.ts', text: 'a'.repeat(5 * 1024 * 1024) }), true)
  assert.equal(large.isProhibited({ id: 'x', languages: ['*'] }, { path: 'a.ts', text: 'short' }), false)

  assert.ok(implicitUsageProviders().some(provider => provider.id === JUNIT5_IMPLICIT_USAGE_PROVIDER_ID),
    'JUnit5 隐式使用那支应是 bundled 贡献')
  assert.ok(contributedReferencesAnnotators().some(contributor => contributor.id === COMMENT_FILE_LINKS_ID),
    '注释文件路径链接那支应是 bundled 贡献')
  // source 标成 bundled（第三方挂进来的是 user）。
  const entries = EXTENSIONS.entriesFor(IMPLICIT_USAGE_PROVIDER_EP)
  const junit = entries.find(entry => entry.id === JUNIT5_IMPLICIT_USAGE_PROVIDER_ID)
  assert.equal(junit.source, 'bundled')
})

// ── ④ 真实消费点之一：`externalAnnotatorsFilter` 拦下注解器 ──────────────────────────────────

test('第三方过滤器按 id 注册后，AnnotatorRegistry.run 真的跳过那个注解器', () => {
  const text = '// see https://example.com\nconst a = 1\n'
  const run = () => annotatorRegistry.run('typescript', {
    path: 'src/a.ts', text, batchMode: false,
    external: { diagnostics: [], commentStyle: { line: '//' } },
  })
  // 没有过滤器时：两条内建注解器都跑。
  assert.deepEqual(run().ran.sort(), ['comment.webLink', 'lsp.diagnosticTags'])

  const handle = registerExternalAnnotatorsFilter({
    id: 'test.prohibit.webLink',
    isProhibited: annotator => annotator.id === 'comment.webLink',
  })
  try {
    const result = run()
    assert.deepEqual(result.ran, ['lsp.diagnosticTags'], '被拦的注解器不该出现在 ran 里')
    assert.deepEqual(result.skippedProhibited, ['comment.webLink'])
  } finally {
    handle.dispose()
  }
  assert.deepEqual(run().ran.sort(), ['comment.webLink', 'lsp.diagnosticTags'], '注销后应恢复')
})

test('过滤器的消费口径照上游 allForFile：任一为真即拦；坏过滤器不拦（不吞掉分析）', () => {
  const file = { path: 'src/a.ts', text: 'x', language: 'typescript' }
  const annotators = [{ id: 'a', languages: ['*'] }, { id: 'b', languages: ['*'] }]
  const explode = registerExternalAnnotatorsFilter({
    id: 'test.explode',
    isProhibited: () => { throw new Error('坏过滤器') },
  })
  const onlyB = registerExternalAnnotatorsFilter({
    id: 'test.onlyB',
    isProhibited: annotator => annotator.id === 'b',
  })
  try {
    assert.equal(isExternalAnnotatorProhibited(annotators[1], file), true)
    assert.deepEqual(externalAnnotatorsFor(annotators, file).map(item => item.id), ['a'])
  } finally {
    explode.dispose()
    onlyB.dispose()
  }
  assert.deepEqual(externalAnnotatorsFor(annotators, file).map(item => item.id), ['a', 'b'])
})

// ── ④ 真实消费点之二：`implicitUsageProvider` 抑制未使用注解 ────────────────────────────────

test('bundled 词法子集：@Nested 类 / @TempDir 字段 / @MethodSource 的标签都被认成隐式使用', () => {
  const nested = '@Nested\nclass Inner {\n  void t() {}\n}\n'
  assert.equal(annotateUnused(nested, [unusedDiagnostic(1, 6, 11)]).length, 0, '被 @Nested 标注的类不报未使用')

  const tempDir = 'class A {\n  @TempDir\n  Path tmp;\n}\n'
  const tempElement = implicitUsageElementOf({ path: 'src/A.java', language: 'java', text: tempDir, line: 2, column: 2 })
  assert.equal(tempElement.kind, 'field')
  assert.equal(isImplicitWrite(tempElement), true, '@TempDir 字段是隐式写入')
  assert.equal(isImplicitlyNotNullInitialized(tempElement), true, '上游 isImplicitlyNotNullInitialized = isImplicitWrite')

  const methodSource = 'class A {\n  @ParameterizedTest\n  @MethodSource("values")\n  void t(String s) {}\n\n  static List<String> values() { return null; }\n}\n'
  assert.equal(annotateUnused(methodSource, [unusedDiagnostic(5, 22, 28)]).length, 0, '@MethodSource 指向的方法不报未使用')
  // 对照：没有数据源注解时照报。
  const plain = 'class A {\n  void t() {}\n}\n'
  assert.equal(annotateUnused(plain, [unusedDiagnostic(1, 6, 7)]).length, 1)
})

test('第三方 provider 按 id 注册后被 unusedDeclarationAnnotator 拿到（抑制那一条注解）', () => {
  const text = 'class A {\n  int injectedByName;\n}\n'
  const diagnostics = [unusedDiagnostic(1, 6, 22)]
  assert.equal(annotateUnused(text, diagnostics).length, 1, '先确认没有 provider 时是报的')

  const handle = registerImplicitUsageProvider({
    id: 'test.frameworkInjected',
    isImplicitUsage: element => element.name === 'injectedByName',
    isImplicitRead: () => false,
    isImplicitWrite: () => false,
  })
  try {
    assert.equal(annotateUnused(text, diagnostics).length, 0, '第三方说隐式使用时这条注解被抑制')
    const element = implicitUsageElementOf({ path: 'src/A.java', language: 'java', text, line: 1, column: 6 })
    assert.equal(isImplicitUsage(element), true)
    assert.equal(isImplicitRead(element), false)
  } finally {
    handle.dispose()
  }
  assert.equal(annotateUnused(text, diagnostics).length, 1, '注销后应恢复')
})

test('元素形状的词法归类（本仓没有 PSI，靠 `src/implicitUsageElement.ts` 的规则）', () => {
  assert.equal(kindOfDeclaration('class Inner {', 'Inner', 6), 'class')
  assert.equal(kindOfDeclaration('  void t(String s) {', 's', 12), 'parameter')
  assert.equal(kindOfDeclaration('  void t(String s) {', 't', 7), 'method')
  assert.equal(kindOfDeclaration('  int count = 0;', 'count', 6), 'field')
  assert.equal(kindOfDeclaration('  const x = 1', 'x', 8), 'local')
  assert.equal(kindOfDeclaration('  RED,', 'RED', 2), 'enumConstant')
  assert.equal(wordAt('  int count = 0;', 6), 'count')
})

// ── ④ 真实消费点之三：`contributedReferencesAnnotator` 多出一条链接注解 ──────────────────────

test('bundled 贡献者：注释里的文件路径产出一条 hyperlink 注解，且 target 被判成「文件」', () => {
  const text = '// see src/foo/bar.ts and https://example.com/x.ts for details\nconst a = 1\n'
  const marks = webLinkAnnotator.annotate({
    path: 'src/a.ts', language: 'typescript', text, dirtyLines: null, batchMode: false,
    external: { diagnostics: [], commentStyle: { line: '//' } },
  })
  const links = marks.filter(mark => mark.kind === 'hyperlink')
  const urls = links.filter(mark => mark.target.startsWith('http'))
  const files = links.filter(mark => !mark.target.startsWith('http'))
  assert.equal(urls.length, 1, '网页链接那一条由平台自己画（webUrlsIn）')
  assert.deepEqual(files.map(mark => mark.target), ['src/foo/bar.ts'])
  // target 必须落进 `classifyLinkTarget` 的 file 档：落 external 会走 shell.openUrl。
  assert.equal(classifyLinkTarget(files[0].target).kind, 'file')
  assert.equal(text.slice(files[0].from, files[0].to), 'src/foo/bar.ts')
})

test('URL 的尾巴不会被误判成文件路径（https://x/y.ts 不产出第二条链接）', () => {
  assert.deepEqual(filePathLinksIn('see https://example.com/a/b.ts now'), [])
  assert.deepEqual(filePathLinksIn('see ./a/b.ts now').map(hit => hit.path), ['./a/b.ts'])
  assert.deepEqual(filePathLinksIn('see C:\\repo\\a\\b.ts now').map(hit => hit.path), ['C:\\repo\\a\\b.ts'])
})

test('第三方贡献者按 id 注册后，webLinkAnnotator 真的多出一条链接注解', () => {
  const text = '// nothing to see here\nconst a = 1\n'
  const run = () => webLinkAnnotator.annotate({
    path: 'src/a.ts', language: 'typescript', text, dirtyLines: null, batchMode: false,
    external: { diagnostics: [], commentStyle: { line: '//' } },
  })
  assert.equal(run().length, 0, '先确认基线：这段注释里没有任何链接')

  const handle = registerContributedReferencesAnnotator({
    id: 'test.extraLink',
    annotate: (element, references, holder) => {
      assert.equal(element.from, 0)
      assert.ok(element.to > element.from)
      assert.deepEqual(references, [], '这一段没有平台自己找到的引用')
      holder.add({ from: element.from, to: element.from + 12, kind: 'hyperlink', target: 'C:/repo/a.ts', description: '第三方补的' })
    },
  })
  try {
    const marks = run()
    assert.equal(marks.length, 1)
    assert.equal(marks[0].kind, 'hyperlink')
    assert.equal(marks[0].target, 'C:/repo/a.ts')
    assert.equal(marks[0].description, '第三方补的')
    // 直调注解器时 `annotator` 那一格由注册表补（`AnnotatorRegistry.run`），所以这里不判它 ——
    // 走注册表那条路的归属判定见 `tests/annotator-highlight-layer.test.mjs`。
    assert.deepEqual([marks[0].from, marks[0].to], [0, 12])
  } finally {
    handle.dispose()
  }
  assert.equal(run().length, 0, '注销后应恢复')
})

test('贡献面：越界/零宽的注解被收口丢掉，坏贡献者只跳自己', () => {
  const host = { path: 'src/a.ts', text: '// abc\n', from: 3, to: 6, language: 'typescript' }
  const bad = registerContributedReferencesAnnotator({
    id: 'test.badBounds',
    annotate: (_element, _references, holder) => {
      holder.add({ from: 5, to: 5, kind: 'hyperlink' })           // 零宽
      holder.add({ from: 0, to: 1, kind: 'hyperlink' })           // 落在宿主之外（这里是文件头，文本内但不在宿主内）
      holder.add({ from: 3, to: 999, kind: 'hyperlink' })         // 越过文本长度
      holder.add({ from: 3, to: 5, kind: 'hyperlink' })           // 合法
    },
  })
  const explode = registerContributedReferencesAnnotator({
    id: 'test.explode',
    annotate: () => { throw new Error('坏贡献者') },
  })
  try {
    const out = contributedReferenceAnnotations(host, [])
    assert.deepEqual(out.map(annotation => [annotation.from, annotation.to]), [[3, 5]])
  } finally {
    bad.dispose()
    explode.dispose()
  }
})
