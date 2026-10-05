// 依赖规则校验（上游 `DependencyValidationManagerImpl` + `DependencyRule`）与
// 作用域 id 映射（`ScopeIdMapper`）的判据。每条都指到上游的类与行号。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applicableDependencyRules, filterLegalEdges, findDependencyViolations, firstViolatorRule,
  hasDependencyRules, illegalTargets, isIllegalEdge, loadDependencyRules, parseDependencyRules,
  ruleDisplayText, ruleForbidsPair, ruleIsApplicable, saveDependencyRules, scopeRefContains,
  scopeRefFromId, scopeRefId, scopeRefTitle, serializeDependencyRules, violationMessage, violatorRules,
  dependencyRulesKey, NO_ILLEGAL_DEPENDENCIES_TEXT,
} from '../src/dependencyRules.ts'
import {
  DEPENDENCY_SCOPE_OPTIONS, scopePresentableName, scopeSerializationId, isStandardScopeId,
} from '../src/scopeIdMapper.ts'

/** 没有命名作用域时的空上下文。 */
const EMPTY = { namedScopes: [] }
/** 两个命名作用域（模式语言 = src/scopes.ts 的 `file:` 那一档）。 */
const WITH_NAMED = { namedScopes: [{ name: 'Ts', pattern: 'file:*.ts' }, { name: 'Cpp', pattern: 'file:*.cpp' }] }

const standard = id => ({ kind: 'standard', id })
const named = name => ({ kind: 'named', name })
const unnamed = pattern => ({ kind: 'unnamed', pattern })

test('预定义档的归属走路径分类（ProjectFilesScope/TestsScope/GeneratedFilesScope）', () => {
  // Project Files = 内容内（非生成物），`ProjectFilesScope.java:26-31` 的 isInContent。
  assert.equal(scopeRefContains(standard('Project Files'), 'src/a.ts', false, EMPTY), true)
  assert.equal(scopeRefContains(standard('Project Files'), 'tests/x.test.ts', false, EMPTY), true)
  assert.equal(scopeRefContains(standard('Project Files'), 'build/out.js', false, EMPTY), false)
  // Tests / Project Test Files 同一条（`TestsScope.java:24-26`）。
  assert.equal(scopeRefContains(standard('Tests'), 'tests/x.test.ts', false, EMPTY), true)
  assert.equal(scopeRefContains(standard('Project Test Files'), 'src/a.ts', false, EMPTY), false)
  // Generated Files（`GeneratedFilesScope.java:20-24`）。
  assert.equal(scopeRefContains(standard('Generated Files'), 'dist/bundle.js', false, EMPTY), true)
  // All / All Places 恒真；本仓没有对应实体的两档恒假（不匹配 ≠ 报错）。
  assert.equal(scopeRefContains(standard('All'), 'anything', false, EMPTY), true)
  assert.equal(scopeRefContains(standard('Project and Libraries'), 'src/a.ts', false, EMPTY), false)
  assert.equal(scopeRefContains(standard('Scratches and Consoles'), 'src/a.ts', false, EMPTY), false)
  // Current File 走上下文（`ScopeIdMapper.kt:31`）。
  assert.equal(scopeRefContains(standard('Current File'), 'src/a.ts', false, { ...EMPTY, currentFile: 'src/a.ts' }), true)
  assert.equal(scopeRefContains(standard('Current File'), 'src/b.ts', false, { ...EMPTY, currentFile: 'src/a.ts' }), false)
})

test('命名/匿名作用域走 scopes.ts 的模式语言（file:/projectPath:/$引用）', () => {
  assert.equal(scopeRefContains(named('Ts'), 'src/a.ts', false, WITH_NAMED), true)
  assert.equal(scopeRefContains(named('Ts'), 'src/a.cpp', false, WITH_NAMED), false)
  assert.equal(scopeRefContains(unnamed('file:*.cpp'), 'src/a.cpp', false, WITH_NAMED), true)
  // 查不到的名字 = 不匹配（`DependencyValidationManagerImpl.java:264-276`）。
  assert.equal(scopeRefContains(named('Missing'), 'src/a.ts', false, WITH_NAMED), false)
  // 模式本身编译不过 ⇒ 同样不匹配，绝不抛。
  assert.equal(scopeRefContains(unnamed('file a b'), 'src/a.ts', false, EMPTY), false)
})

test('deny 规则 = from 命中 && to 命中（DependencyRule.java:30-33）', () => {
  const rule = { from: standard('Project Files'), to: standard('Generated Files'), deny: true }
  assert.equal(ruleForbidsPair(rule, 'src/a.ts', 'build', EMPTY), true)
  assert.equal(ruleForbidsPair(rule, 'src/a.ts', 'src', EMPTY), false)
  assert.equal(ruleForbidsPair(rule, 'build/x.js', 'tests', EMPTY), false)
})

test('allow 规则取 from 的补集（ComplementPackageSet，DependencyRule.java:32）', () => {
  // 「只允许 Ts 作用域里的文件使用 Cpp 作用域」：不在 Ts 里的文件用到 Cpp ⇒ 违规。
  const rule = { from: named('Ts'), to: named('Cpp'), deny: false }
  assert.equal(ruleForbidsPair(rule, 'docs/notes.cpp', 'src/a.cpp', WITH_NAMED), true)
  assert.equal(ruleForbidsPair(rule, 'src/a.ts', 'src/a.cpp', WITH_NAMED), false)
})

test('isApplicable 只看 from 那一半（DependencyRule.java:36-45）', () => {
  const deny = { from: named('Ts'), to: standard('All'), deny: true }
  assert.equal(ruleIsApplicable(deny, 'src/a.ts', WITH_NAMED), true)
  assert.equal(ruleIsApplicable(deny, 'src/a.cpp', WITH_NAMED), false)
  const allow = { from: named('Ts'), to: standard('All'), deny: false }
  assert.equal(ruleIsApplicable(allow, 'src/a.ts', WITH_NAMED), false)
  assert.equal(ruleIsApplicable(allow, 'src/a.cpp', WITH_NAMED), true)
  assert.deepEqual(applicableDependencyRules([deny, allow], 'src/a.cpp', WITH_NAMED), [allow])
})

test('管理器面：hasRules / 第一条命中 / 全部命中（DependencyValidationManagerImpl.java:90-123）', () => {
  const rules = [
    { from: named('Ts'), to: standard('Generated Files'), deny: true },
    { from: named('Ts'), to: standard('Tests'), deny: true },
  ]
  assert.equal(hasDependencyRules(rules), true)
  assert.equal(hasDependencyRules([]), false)
  // 目录级图的 to 侧是**目录路径**（`PackageEdge.to` = 目录名），所以取测试目录里的一个包名。
  assert.deepEqual(firstViolatorRule(rules, 'src/a.ts', 'build', WITH_NAMED), rules[0])
  assert.deepEqual(firstViolatorRule(rules, 'src/a.cpp', 'build', WITH_NAMED), null)
  // 全部命中（getViolatorDependencyRules:104-112）。
  assert.deepEqual(violatorRules(rules, 'src/a.ts', 'build', WITH_NAMED), [rules[0]])
  assert.deepEqual(violatorRules(rules, 'src/a.ts', 'tests/spec', WITH_NAMED), [rules[1]])
})

test('图上的违规：逐条规则各出一条问题（DependencyInspection.kt:30-37）', () => {
  const rules = [{ from: standard('Project Files'), to: standard('Generated Files'), deny: true }]
  const edges = [
    { from: 'src', to: 'build', path: 'src/a.ts', line: 3 },
    { from: 'src', to: 'src/util', path: 'src/a.ts', line: 9 },
    { from: 'dist', to: 'build', path: 'dist/bundle.js', line: 0 },
  ]
  const violations = findDependencyViolations(rules, edges, EMPTY)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].fromPath, 'src/a.ts')
  assert.equal(violations[0].toPath, 'build')
  assert.equal(violations[0].line, 3)
  // 问题文本 = jvm.inspections.dependency.violator.problem.descriptor（`违反依赖关系规则 ''{0}.''`）。
  assert.equal(violations[0].message, `违反依赖关系规则 '${violations[0].ruleText}.'`)
  assert.deepEqual(illegalTargets(violations), new Set(['build']))
  assert.equal(isIllegalEdge(edges[0], violations), true)
  assert.equal(isIllegalEdge(edges[1], violations), false)
  // 没有任何规则 ⇒ 一条都不产（上游 `hasRules()` 的门，DependencyInspection.kt:25）。
  assert.deepEqual(findDependencyViolations([], edges, EMPTY), [])
})

test('规则文案逐字对 bundle（scope.display.name.deny.scope / allow.scope）', () => {
  const deny = { from: standard('Project Files'), to: standard('Generated Files'), deny: true }
  // AnalysisBundle:133 + 中文包 222 行：在作用域 ''{1}'' 拒绝作用域 ''{0}'' 的用法，参数是 (to, from)。
  assert.equal(ruleDisplayText(deny), "在作用域 '项目文件' 拒绝作用域 '生成的文件' 的用法")
  const allow = { from: named('Ts'), to: standard('All'), deny: false }
  assert.equal(ruleDisplayText(allow), "在作用域'Ts'启用作用域'全部'的使用")
  assert.equal(violationMessage('X'), "违反依赖关系规则 'X.'")
  assert.equal(NO_ILLEGAL_DEPENDENCIES_TEXT, '未找到非法依赖项') // LangBundle `status.text.no.illegal.dependencies.found`
  assert.equal(scopeRefTitle(unnamed('file:*.ts')), 'file:*.ts')
})

test('存档字段名照上游 XML（deny_rule/from_scope/to_scope/is_deny/unnamed_scope）', () => {
  const rules = [
    { from: unnamed('file:*.ts'), to: standard('Generated Files'), deny: true },
    { from: standard('Project Files'), to: named('Ts'), deny: false },
  ]
  const stored = JSON.parse(serializeDependencyRules(rules))
  assert.deepEqual(Object.keys(stored).sort(), ['deny_rule', 'unnamed_scope'])
  assert.deepEqual(stored.deny_rule[0], { from_scope: 'file:*.ts', to_scope: 'Generated Files', is_deny: true })
  assert.deepEqual(stored.unnamed_scope, [{ value: 'file:*.ts' }])
  assert.equal(scopeRefId(standard('All')), 'All')
  assert.equal(scopeRefId(named('Ts')), 'Ts')
  assert.equal(scopeRefId(unnamed('file:*.cpp')), 'file:*.cpp')
  // 读回来：匿名作用域认得、命名作用域也认得。
  const parsed = parseDependencyRules(JSON.stringify(stored), { namedScopes: [{ name: 'Ts', pattern: 'file:*.ts' }] })
  assert.deepEqual(parsed, rules)
  assert.equal(serializeDependencyRules([]), '')
  assert.deepEqual(parseDependencyRules('', EMPTY), [])
})

test('坏存档的处理同上游 readRule（缺任一属性整条丢，不抛）', () => {
  const broken = '{"deny_rule":[{"from_scope":"All","to_scope":"All"}]}'   // 缺 is_deny
  assert.deepEqual(parseDependencyRules(broken, EMPTY), [])
  const unknown = '{"deny_rule":[{"from_scope":"查无此名","to_scope":"All","is_deny":true}]}'
  assert.deepEqual(parseDependencyRules(unknown, EMPTY), [])           // 认不出 from ⇒ 整条丢（writeRule 同不写）
  assert.deepEqual(parseDependencyRules('{oops', EMPTY), [])
  // 模式文本没登记在 unnamed_scope 里也照上游 `appendUnnamedScope` 的口径收下。
  assert.deepEqual(parseDependencyRules('{"deny_rule":[{"from_scope":"file:*.ts","to_scope":"All","is_deny":true}]}', EMPTY),
    [{ from: unnamed('file:*.ts'), to: standard('All'), deny: true }])
  assert.deepEqual(scopeRefFromId('Totally Unknown', EMPTY, []), null)
})

test('按工作区根分键存取；规则清空时删键不留空壳', () => {
  const map = new Map()
  const storage = {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value) },
    removeItem: key => { map.delete(key) },
  }
  const context = { namedScopes: [{ name: 'Ts', pattern: 'file:*.ts' }] }
  const rules = [{ from: named('Ts'), to: standard('Generated Files'), deny: true }]
  saveDependencyRules('C:/repo', rules, storage)
  assert.equal(map.has(dependencyRulesKey('C:/repo')), true)
  assert.deepEqual(loadDependencyRules('C:/repo', context, storage), rules)
  assert.deepEqual(loadDependencyRules('C:/other', context, storage), [])
  saveDependencyRules('C:/repo', [], storage)
  assert.equal(map.size, 0)
})

test('UI_FILTER_LEGALS：只看非法边；没有规则时不过滤（DependencyUISettings.java:21）', () => {
  const edges = [
    { from: 'src', to: 'build', path: 'src/a.ts', line: 1 },
    { from: 'src', to: 'src/util', path: 'src/a.ts', line: 2 },
  ]
  const violations = [{ rule: {}, fromPath: 'src/a.ts', toPath: 'build', line: 1, ruleText: 'r', message: 'm' }]
  assert.deepEqual(filterLegalEdges(edges, violations, false).edges, edges)
  assert.deepEqual(filterLegalEdges(edges, violations, true).edges, [edges[0]])
  assert.deepEqual(filterLegalEdges(edges, violations, true).packages, ['build', 'src'])
  // 规则为空 ⇒ 违规集合也为空 ⇒ 开着过滤也不把图清空（上游没有规则时没有 illegal 可看）。
  assert.deepEqual(filterLegalEdges(edges, [], true).edges, edges)
})

test('ScopeIdMapper：存 id、显示时映射，认不出的原样返回（ScopeIdMapperImpl.kt:27/41）', () => {
  assert.equal(scopePresentableName('Project Files'), '项目文件')
  assert.equal(scopePresentableName('All Places'), '所有位置')
  assert.equal(scopePresentableName('Generated Files'), '生成的文件')
  assert.equal(scopePresentableName('Unknown Scope'), 'Unknown Scope')
  assert.equal(scopeSerializationId('项目文件'), 'Project Files')
  assert.equal(scopeSerializationId('项目测试文件'), 'Project Test Files')
  assert.equal(scopeSerializationId('Unknown Scope'), 'Unknown Scope')
  assert.equal(isStandardScopeId('Current File'), true)
  assert.equal(isStandardScopeId('随便起的名字'), false)
  // 依赖规则/分析依赖给用户的四档（DefaultScopesProvider/TestScopeProvider/GeneratedFilesScopeProvider）。
  assert.deepEqual(DEPENDENCY_SCOPE_OPTIONS.map(option => option.id),
    ['Project Files', 'Project Test Files', 'Generated Files', 'All'])
  assert.deepEqual(DEPENDENCY_SCOPE_OPTIONS.map(option => option.title), ['项目文件', '项目测试文件', '生成的文件', '全部'])
})

// ---------------------------------------------------------------- 面板接线（防"模型有了没人用"）

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('「分析依赖」对话框接上了规则那一节', () => {
  const dialog = source('src/components/PackageDepsDialog.vue')
  assert.match(dialog, /from '\.\.\/dependencyRules'/)
  assert.match(dialog, /findDependencyViolations\(/)
  assert.match(dialog, /saveDependencyRules\(/)
  assert.match(dialog, /仅显示非法依赖/)                    // action.show.illegals.only
  assert.match(dialog, /NO_ILLEGAL_DEPENDENCIES_TEXT/)      // status.text.no.illegal.dependencies.found
  assert.match(dialog, /DEPENDENCY_VALIDATION_TITLE = '依赖验证'/) // dependency.configurable.display.name
  assert.match(dialog, /\['拒绝使用', '位置'\]/)             // deny.table.column1/2
  assert.match(dialog, /\['允许使用', '仅位于'\]/)           // allow.table.column1/2
  assert.match(dialog, /编辑规则/)                           // action.edit.rules
})
