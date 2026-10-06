// 分析范围（`src/analysisScope.ts` + `src/workspaceInspection.ts` 的过滤）——
// 上游 `BaseAnalysisActionDialog` 的范围选择与 `AnalysisUIOptions` 的持久化口径：
// include/exclude glob、exclude 优先、空模式 = 全部、范围外报告不落诊断表；
// 本批补上「命名作用域」那一档与 `ANALYZE_TEST_SOURCES`（`BaseAnalysisActionDialog.java:100/220-222`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  analysisScope, analysisUiOptions, DEFAULT_ANALYSIS_UI_OPTIONS, filterByAnalysisScope, loadAnalysisNamedScopes,
  loadAnalysisScope, loadAnalysisUiOptions, pathInAnalysisScope, resetAnalysisScope, scopeSummary,
  setAnalysisScopeFromText, setAnalysisScopeNamed, setAnalysisScopeNamedScopes, setAnalysisUiOption,
  PROJECT_SCOPE, ANALYSIS_SCOPE_KEY, ANALYSIS_UI_OPTIONS_KEY, ANALYSIS_NAMED_SCOPES_KEY,
} from '../src/analysisScope.ts'
import { runWorkspaceInspection } from '../src/workspaceInspection.ts'

test('模式解析：空行与 `#` 注释丢掉，两段都空回到全部项目', () => {
  const custom = setAnalysisScopeFromText('src/**\n\n# 注释\n*.ts', 'build/**')
  assert.deepEqual(custom, { kind: 'custom', include: ['src/**', '*.ts'], exclude: ['build/**'] })
  assert.equal(scopeSummary(custom), '包含 src/**、*.ts；排除 build/**')
  const project = setAnalysisScopeFromText('  \n# nothing\n', '')
  assert.deepEqual(project, PROJECT_SCOPE)
  assert.equal(scopeSummary(project), '全部项目')
})

test('范围判定：exclude 先否决；include 非空时必须命中；空 include = 全收', () => {
  assert.equal(pathInAnalysisScope('anything/a.ts', PROJECT_SCOPE), true)
  const includeOnly = { kind: 'custom', include: ['src/**'], exclude: [] }
  assert.equal(pathInAnalysisScope('src/a.ts', includeOnly), true)
  assert.equal(pathInAnalysisScope('test/a.ts', includeOnly), false)
  const both = { kind: 'custom', include: ['**/*.ts'], exclude: ['**/generated/**'] }
  assert.equal(pathInAnalysisScope('src/a.ts', both), true)
  assert.equal(pathInAnalysisScope('src/generated/a.ts', both), false, 'exclude 优先')
  const excludeOnly = { kind: 'custom', include: [], exclude: ['build/**'] }
  assert.equal(pathInAnalysisScope('build/a.ts', excludeOnly), false)
  assert.equal(pathInAnalysisScope('src/a.ts', excludeOnly), true)
  assert.equal(pathInAnalysisScope('src\\win\\a.ts', { kind: 'custom', include: ['src/**'], exclude: [] }), true, '反斜杠归一')
})

test('filterByAnalysisScope 计数：留下几条、挡掉几条', () => {
  const outcome = filterByAnalysisScope(
    ['src/a.ts', 'src/generated/b.ts', 'test/c.ts'],
    path => path,
    { kind: 'custom', include: ['**/*.ts'], exclude: ['**/generated/**'] },
  )
  assert.deepEqual(outcome.kept, ['src/a.ts', 'test/c.ts'])
  assert.equal(outcome.skipped, 1)
})

test('整工程检查按范围过滤：范围外报告不落表，但 resultId 仍然记下供下一轮 unchanged', async () => {
  setAnalysisScopeFromText('src/**', '')
  const diagnostics = new Map()
  const resultIds = new Map()
  const outcome = await runWorkspaceInspection({
    query: async () => ({
      available: true,
      items: [
        { path: 'src/a.ts', kind: 'full', diagnostics: [{ message: 'x' }], resultId: 'r1' },
        { path: 'test/b.ts', kind: 'full', diagnostics: [{ message: 'y' }], resultId: 'r2' },
      ],
    }),
    diagnostics,
    resultIds,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.skipped, 1)
  assert.equal(outcome.scanned, 1)
  assert.equal(outcome.found, 1)
  assert.deepEqual([...diagnostics.keys()], ['src/a.ts'], '范围外的文件不进诊断表')
  assert.deepEqual([...resultIds.entries()], [['src/a.ts', 'r1'], ['test/b.ts', 'r2']], 'id 全记，下一轮这些文件可以回 unchanged')
  assert.match(outcome.message, /范围.*跳过了 1 个范围外文件/)
  resetAnalysisScope()
  assert.deepEqual(analysisScope.value, PROJECT_SCOPE)
})

// ---------------------------------------------------------------- 本批新增：命名作用域 + 测试源码那一档

test('命名作用域那一档：按 scopes.ts 的模式求值，存的是名字（id）不是显示名', () => {
  setAnalysisScopeNamedScopes([
    { name: 'Core', pattern: 'file:src/**.ts' },
    { name: 'Broken', pattern: 'file a b' },
  ])
  const named = setAnalysisScopeNamed('Core')
  assert.deepEqual(named, { kind: 'named', include: [], exclude: [], namedScope: 'Core' })
  assert.equal(pathInAnalysisScope('src/a.ts', named), true)
  assert.equal(pathInAnalysisScope('docs/a.md', named), false)
  assert.equal(scopeSummary(named), '命名作用域「Core」')
  // 查不到的名字与编译不过的模式都算"不在范围内"（与 `scopes.ts:519-526` 的兜底一致，不抛）。
  assert.equal(pathInAnalysisScope('src/a.ts', { kind: 'named', include: [], exclude: [], namedScope: 'Missing' }), false)
  assert.equal(pathInAnalysisScope('src/a.ts', { kind: 'named', include: [], exclude: [], namedScope: 'Broken' }), false)
  // 传空串 = 回到"全部项目"。
  assert.deepEqual(setAnalysisScopeNamed(''), PROJECT_SCOPE)
})

test('ANALYZE_TEST_SOURCES（AnalysisUIOptions.java:39 默认 true）：关掉后测试文件不进范围', () => {
  assert.equal(analysisUiOptions.value.analyzeTestSources, true, '缺省值照上游')
  assert.deepEqual(analysisUiOptions.value, DEFAULT_ANALYSIS_UI_OPTIONS)
  assert.equal(pathInAnalysisScope('tests/x.test.ts', PROJECT_SCOPE), true)
  setAnalysisUiOption('analyzeTestSources', false)
  assert.equal(pathInAnalysisScope('tests/x.test.ts', PROJECT_SCOPE), false)
  assert.equal(pathInAnalysisScope('src/a.ts', PROJECT_SCOPE), true)
  // 自定义范围同样受这一档管辖（上游它是范围本身的一部分：`scope.setIncludeTestSource`）。
  const custom = { kind: 'custom', include: ['**/*.ts'], exclude: [] }
  assert.equal(pathInAnalysisScope('tests/x.test.ts', custom), false)
  assert.equal(scopeSummary(PROJECT_SCOPE), '全部项目，不含测试代码')
  // 命名作用域那一档也要过这道门。
  // 夹具用 `file:*.ts`（`FilePatternPackageSet.java:73-118` 把结尾的 `*` 译成 `[^/]*`，
  // 而 `*.ts` 译成 `.*\.ts` ⇒ 只有后者能命中带目录分隔的 `tests/x.test.ts`）。
  setAnalysisScopeNamedScopes([{ name: 'Ts', pattern: 'file:*.ts' }])
  const named = { kind: 'named', include: [], exclude: [], namedScope: 'Ts' }
  assert.equal(pathInAnalysisScope('tests/x.test.ts', named), false, '关掉测试源码这一档：命名作用域也挡')
  assert.equal(pathInAnalysisScope('src/a.ts', named), true, '非测试文件不受这一档影响')
  setAnalysisUiOption('analyzeTestSources', true)
  assert.equal(pathInAnalysisScope('tests/x.test.ts', named), true)
  assert.equal(pathInAnalysisScope('src/a.ts', named), true)
  assert.equal(scopeSummary(PROJECT_SCOPE), '全部项目')
})

test('命名作用域的匹配沿用 scopes.ts 的上游通配符：结尾单星不跨目录，`*.ts` 跨目录', () => {
  setAnalysisScopeNamedScopes([
    { name: 'Root', pattern: 'file:*' },        // → `[^/]*`：只有根层文件
    { name: 'Any', pattern: 'file:*.ts' },      // → `.*\.ts`：任意深度
    { name: 'Deep', pattern: 'file:src//*' },   // → `src/(.*\/)?[^/]*`：src 下递归
  ])
  const root = { kind: 'named', include: [], exclude: [], namedScope: 'Root' }
  const any = { kind: 'named', include: [], exclude: [], namedScope: 'Any' }
  const deep = { kind: 'named', include: [], exclude: [], namedScope: 'Deep' }
  assert.equal(pathInAnalysisScope('a.ts', root), true, '根层文件进 `file:*`')
  assert.equal(pathInAnalysisScope('tests/x.test.ts', root), false, '带分隔符的不进 `file:*`')
  assert.equal(pathInAnalysisScope('a.ts', any), true)
  assert.equal(pathInAnalysisScope('tests/x.test.ts', any), true)
  assert.equal(pathInAnalysisScope('tests/x.test.md', any), false, '模式不认的就出局')
  assert.equal(pathInAnalysisScope('src/a.ts', deep), true)
  assert.equal(pathInAnalysisScope('src/sub/b.ts', deep), true, '`//` 是递归')
  assert.equal(pathInAnalysisScope('docs/a.md', deep), false)
  resetAnalysisScope()
})

test('其余四项的缺省值照上游（AUTOSCROLL/GROUP_BY_SEVERITY/FILTER_RESOLVED_ITEMS/SPLITTER_PROPORTION）', () => {
  assert.deepEqual({ ...DEFAULT_ANALYSIS_UI_OPTIONS }, {
    autoScrollToSource: false,   // AnalysisUIOptions.java:35
    splitterProportion: 0.5,     // :36
    groupBySeverity: false,      // :37
    filterResolvedItems: true,   // :38
    analyzeTestSources: true,    // :39
    analyzeInjectedCode: true,   // :40
  })
  setAnalysisUiOption('groupBySeverity', true)
  assert.equal(analysisUiOptions.value.groupBySeverity, true)
  setAnalysisUiOption('groupBySeverity', false)
})

test('存档往返 + 坏存档/旧存档退回缺省（旧的两档存档不能因新增字段变成坏的）', () => {
  const map = new Map()
  const storage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
  }
  assert.deepEqual(loadAnalysisScope(storage), PROJECT_SCOPE, '没有存档 = 全部项目')
  assert.deepEqual(loadAnalysisUiOptions(storage), DEFAULT_ANALYSIS_UI_OPTIONS)
  setAnalysisScopeFromText('docs/**', '', storage)
  assert.deepEqual(loadAnalysisScope(storage), { kind: 'custom', include: ['docs/**'], exclude: [] })
  // 往返幂等：写进存档的那串与读出来的那个形状一一对应 —— 读的时候不许补出新的键。
  assert.equal(map.get(ANALYSIS_SCOPE_KEY), '{"kind":"custom","include":["docs/**"],"exclude":[]}')
  assert.deepEqual(loadAnalysisScope(storage), loadAnalysisScope(storage))
  setAnalysisScopeNamed('Core', storage)
  assert.deepEqual(loadAnalysisScope(storage), { kind: 'named', include: [], exclude: [], namedScope: 'Core' })
  setAnalysisUiOption('analyzeTestSources', false, storage)
  assert.deepEqual(loadAnalysisUiOptions(storage), { ...DEFAULT_ANALYSIS_UI_OPTIONS, analyzeTestSources: false })
  // 旧形状（只有 custom，没有 namedScope 键）照旧读得出来。
  map.set(ANALYSIS_SCOPE_KEY, JSON.stringify({ kind: 'custom', include: ['src/**'], exclude: [] }))
  assert.deepEqual(loadAnalysisScope(storage), { kind: 'custom', include: ['src/**'], exclude: [] })
  // 坏 JSON 与认不出的 kind 退回缺省，不抛。
  map.set(ANALYSIS_SCOPE_KEY, '{oops')
  assert.deepEqual(loadAnalysisScope(storage), PROJECT_SCOPE)
  map.set(ANALYSIS_SCOPE_KEY, JSON.stringify({ kind: 'module', include: [], exclude: [] }))
  assert.deepEqual(loadAnalysisScope(storage), PROJECT_SCOPE)
  map.set(ANALYSIS_UI_OPTIONS_KEY, '{"splitterProportion":9,"groupBySeverity":"yes"}')
  assert.deepEqual(loadAnalysisUiOptions(storage), DEFAULT_ANALYSIS_UI_OPTIONS, '越界/错类型的值退回缺省档')
  map.set(ANALYSIS_UI_OPTIONS_KEY, 'null')
  assert.deepEqual(loadAnalysisUiOptions(storage), DEFAULT_ANALYSIS_UI_OPTIONS)
})

test('命名作用域表的解析缓存：注入即落盘，下一次启动没进设置页也解得开；坏缓存退回空表且不擦已解析的表', () => {
  const map = new Map()
  const storage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
  }
  const named = { kind: 'named', include: [], exclude: [], namedScope: 'Ts' }
  assert.deepEqual(loadAnalysisNamedScopes(storage), [], '没有缓存 = 空表')
  assert.equal(pathInAnalysisScope('src/a.ts', named), false, '空表时那个名字查不到 ⇒ 恒不在范围内（不抛）')
  setAnalysisScopeNamedScopes([{ name: 'Ts', pattern: 'file:*.ts' }], storage)
  assert.equal(map.get(ANALYSIS_NAMED_SCOPES_KEY), JSON.stringify([{ name: 'Ts', pattern: 'file:*.ts' }]),
    '注入真表的同时把解析用的表缓存下来')
  // 换一个"进程"：内存里的表被清空（setItem 是 no-op，存档保持原样），只从缓存读回。
  const restarted = { getItem: key => (map.has(key) ? map.get(key) : null), setItem: () => {} }
  setAnalysisScopeNamedScopes([], restarted)
  assert.equal(pathInAnalysisScope('src/a.ts', named), false, '没读缓存之前：named 档一个文件都不命中')
  assert.deepEqual(loadAnalysisNamedScopes(restarted), [{ name: 'Ts', pattern: 'file:*.ts' }])
  assert.equal(pathInAnalysisScope('src/a.ts', named), true, '读回缓存后 named 档照常解析')
  // 坏缓存 = 没有缓存：退回空表，且**不许**把已经解析好的那张表擦掉。
  map.set(ANALYSIS_NAMED_SCOPES_KEY, '{oops')
  assert.deepEqual(loadAnalysisNamedScopes(restarted), [])
  assert.equal(pathInAnalysisScope('src/a.ts', named), true, '坏缓存不覆盖真表')
  // 形状不对的条目逐条丢掉（缺 pattern 的那条不进表）。
  map.set(ANALYSIS_NAMED_SCOPES_KEY, '[{"name":"A","pattern":"file:*.ts"},{"name":"B"},"x",42,null]')
  assert.deepEqual(loadAnalysisNamedScopes(restarted), [{ name: 'A', pattern: 'file:*.ts' }])
  setAnalysisScopeNamedScopes([])
})

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
test('设置 › 作用域页接上了「分析」那一节（命名作用域单选 + 包含测试代码）', () => {
  const page = source('src/components/ScopesSettingsPage.vue')
  assert.match(page, /from '\.\.\/analysisScope'/)
  assert.match(page, /setAnalysisScopeNamed\(/)
  assert.match(page, /setAnalysisUiOption\('analyzeTestSources'/)
  assert.match(page, /setAnalysisScopeNamedScopes\(/)
  assert.match(page, /包含测试代码/)   // scope.option.include.test.sources（CodeInsightBundle:474 / 中文包 464）
  // 光在注释里提一句不算接线：控件必须真的在 <template> 里，并且绑到上面那两个 setter 的 computed。
  const template = page.slice(page.indexOf('<template>'))
  assert.ok(template.length > 0, '页面没有 <template> 段')
  assert.match(template, /v-model="analysisChoice"/)
  assert.match(template, /v-model="includeTestSources"/)
  assert.match(template, /包含测试代码/)
  assert.match(template, /role="radiogroup"/)
})

// ---------------------------------------------------------------- 标准（预定义）分析范围
// 上游这一组不是项目设置里的表，而是代码级 GlobalSearchScope：
//   · `Project Files`         —— ProjectFilesScope.java:19-31（contains = fileIndex.isInContent）
//   · `Project Production Files` —— GlobalSearchScopesCore.java:152（isInSourceContent 且非测试）
//   · `Project Test Files`       —— GlobalSearchScopesCore.java:188（TestSourcesFilter.isTestSources）
// 序列化 id = ScopeIdMapper.kt:24-26，显示名过 ScopeIdMapperImpl.kt:20-21（本仓同一份映射在 src/scopeIdMapper.ts）。

test('标准范围不需要项目设置里那张表就能判定（三档各收该收的）', () => {
  setAnalysisScopeNamedScopes([])              // 用户表空着：标准档照样解得开（这正是"提供者"那一半缺口）
  setAnalysisUiOption('analyzeTestSources', true)   // 显式设初值：上一条用例用过带 storage 的 setter，会把全局那一档留在 false
  const files = { kind: 'named', include: [], exclude: [], namedScope: 'Project Files' }
  const production = { kind: 'named', include: [], exclude: [], namedScope: 'Project Production Files' }
  const tests = { kind: 'named', include: [], exclude: [], namedScope: 'Project Test Files' }
  assert.equal(pathInAnalysisScope('src/a.ts', files), true)
  assert.equal(pathInAnalysisScope('tests/x.test.ts', files), true, '本仓工作区清单就是内容根里的文件')
  assert.equal(pathInAnalysisScope('build/out.js', files), true)
  assert.equal(pathInAnalysisScope('src/a.ts', production), true)
  assert.equal(pathInAnalysisScope('tests/x.test.ts', production), false, 'isTestSources 出局（:152 那个取反）')
  assert.equal(pathInAnalysisScope('build/out.js', production), false, '生成目录不在源码根里')
  assert.equal(pathInAnalysisScope('tests/x.test.ts', tests), true)
  assert.equal(pathInAnalysisScope('src/a.ts', tests), false)
  // 反斜杠路径同样归一后再判（与 custom 档一条口径）。
  assert.equal(pathInAnalysisScope('tests' + String.fromCharCode(92) + 'x.test.ts', tests), true)
  // 认不出的名字仍然恒不在范围内（标准表不是"兜底全收"）。
  assert.equal(pathInAnalysisScope('src/a.ts', { kind: 'named', include: [], exclude: [], namedScope: 'Nope' }), false)
})

test('用户作用域优先于同名的标准档（上游两张表各是各的来源）', () => {
  setAnalysisScopeNamedScopes([{ name: 'Project Test Files', pattern: 'file:src//*' }])
  const scope = { kind: 'named', include: [], exclude: [], namedScope: 'Project Test Files' }
  assert.equal(pathInAnalysisScope('src/a.ts', scope), true, '用户那条 pattern 说了算')
  assert.equal(pathInAnalysisScope('tests/x.test.ts', scope), false, '标准档那套判定不参与（名字已被占用）')
  setAnalysisScopeNamedScopes([])
})

test('标准档的显示名过 ScopeIdMapper：存档是 id、那句话是中文', () => {
  const named = setAnalysisScopeNamed('Project Production Files')
  assert.deepEqual(named, { kind: 'named', include: [], exclude: [], namedScope: 'Project Production Files' },
    '存的是序列化 id 本身（ScopeIdMapper.kt:21 的注释：id = 英文显示名）')
  assert.equal(scopeSummary(named), '命名作用域「项目生产文件」', '显示时才映射（ScopeIdMapperImpl.kt:20）')
  // 旧存档里那句 namedScope 原样读回，不多不少键。
  const map = new Map()
  const storage = { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)) } }
  setAnalysisScopeNamed('Project Test Files', storage)
  assert.equal(map.get(ANALYSIS_SCOPE_KEY), '{"kind":"named","include":[],"exclude":[],"namedScope":"Project Test Files"}')
  assert.deepEqual(loadAnalysisScope(storage), { kind: 'named', include: [], exclude: [], namedScope: 'Project Test Files' })
  // 关掉「包含测试代码」时，选了测试范围就是**全空** —— 上游 `getScope():218-222` 对选中的任何范围都套这一档。
  const tests = { kind: 'named', include: [], exclude: [], namedScope: 'Project Test Files' }
  setAnalysisUiOption('analyzeTestSources', false)
  assert.equal(pathInAnalysisScope('tests/x.test.ts', tests), false, '先过范围、再过测试源码这一档')
  setAnalysisUiOption('analyzeTestSources', true)
  assert.equal(pathInAnalysisScope('tests/x.test.ts', tests), true)
  resetAnalysisScope()
})

test('作用域页把标准档也列进单选组（不是只在注释里提一句）', () => {
  const page = source('src/components/ScopesSettingsPage.vue')
  assert.match(page, /STANDARD_ANALYSIS_SCOPES/, '页面要拿到那张表')
  assert.match(page, /isStandardAnalysisScope\(/, '选中标准档时不许报"作用域已不在项目里"')
  const template = page.slice(page.indexOf('<template>'))
  assert.match(template, /v-for="scope in STANDARD_ANALYSIS_SCOPES"/)
  assert.match(template, /:value="scope\.id"/, '单选值 = 序列化 id（存档里存的就是它）')
  assert.match(template, /\{\{ scope\.title \}\}/, '文案 = scopePresentableName 的结果，不在组件里另写一份')
})
