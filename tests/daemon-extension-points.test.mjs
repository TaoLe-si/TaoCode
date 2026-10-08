// 判据 · daemon 域的扩展点宿主接线（`src/daemonExtensionPoints.ts`）—— 上游本来就是 EP 的
// 那几族（HighlightVisitor / LocalInspectionEP / InspectionToolProvider / IntentionAction /
// ErrorQuickFixProvider / ProblemHighlightFilter）以及 ProblemsProvider 的同名方法面。
//
// 钉四件事：
//   ① 七条 EP 的 id 逐字等于上游 qualifiedName，且都已在宿主里声明；
//   ② 每条 EP 的贡献能按 id 注册/覆盖/注销，消费函数看得见（第三方挂的不是死代码）；
//   ③ `ProblemHighlightFilter` 的「都同意才出」语义与抛错容错；
//   ④ `ProblemHighlightFilter` + `ProblemsProvider` 在**真实消费侧**可用（`src/problems.ts` 的
//      两张表走的就是 `shouldHighlightFileByFilters`）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ERROR_QUICK_FIX_PROVIDER_EP, HIGHLIGHT_VISITOR_EP, INSPECTION_TOOL_PROVIDER_EP,
  INTENTION_ACTION_EP, LOCAL_INSPECTION_EP, PROBLEM_HIGHLIGHT_FILTER_EP, PROBLEMS_PROVIDER_EP,
  INSPECTION_ELEMENTS_MERGER_EP,
  declareDaemonExtensionPoints, errorQuickFixProviders, highlightVisitors,
  inspectionToolProviderClasses, intentionActionContributions, localInspectionContributions,
  mergedToolNamesFor, problemsFromProviders, problemsProviders, registerDaemonExtension,
  registerInspectionElementsMerger, registerProblemHighlightFilter, shouldHighlightFileByFilters,
  shouldProcessFileInBatch, unregisterDaemonExtension,
} from '../src/daemonExtensionPoints.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import { inspectionIdentityOf, inspectionKeyCandidates } from '../src/inspectionIdentity.ts'

test('七条 EP 的 id 逐字取自上游 qualifiedName，且已声明', () => {
  assert.equal(HIGHLIGHT_VISITOR_EP, 'com.intellij.highlightVisitor')
  assert.equal(LOCAL_INSPECTION_EP, 'com.intellij.localInspection')
  assert.equal(INSPECTION_TOOL_PROVIDER_EP, 'com.intellij.inspectionToolProvider')
  assert.equal(INTENTION_ACTION_EP, 'com.intellij.intentionAction')
  assert.equal(ERROR_QUICK_FIX_PROVIDER_EP, 'com.intellij.errorQuickFixProvider')
  assert.equal(PROBLEM_HIGHLIGHT_FILTER_EP, 'com.intellij.problemHighlightFilter')
  assert.equal(PROBLEMS_PROVIDER_EP, 'com.intellij.problemsProvider')
  for (const id of [HIGHLIGHT_VISITOR_EP, LOCAL_INSPECTION_EP, INSPECTION_TOOL_PROVIDER_EP,
                    INTENTION_ACTION_EP, ERROR_QUICK_FIX_PROVIDER_EP, PROBLEM_HIGHLIGHT_FILTER_EP,
                    PROBLEMS_PROVIDER_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 应已声明`)
  }
  // 声明幂等：重复调用不抛错。
  declareDaemonExtensionPoints()
})

test('HighlightVisitor：按上游方法面注册，消费函数看得见，注销后消失', () => {
  const visitor = {
    id: 'test.visitor', languages: ['ts'],
    suitableForFile: () => true,
    visit: () => {},
    analyze: () => true,
    needAdditionalPass: () => false,
  }
  const handle = registerDaemonExtension(HIGHLIGHT_VISITOR_EP, visitor.id, visitor)
  assert.deepEqual(highlightVisitors().map(item => item.id), ['test.visitor'])
  assert.equal(highlightVisitors()[0].analyze({ path: 'a.ts', text: '', batchMode: false }), true)
  assert.equal(handle.dispose(), true)
  assert.deepEqual(highlightVisitors(), [])
})

test('InspectionToolProvider：getInspectionClasses 的并集被收拢（同名方法面）', () => {
  const tool = {
    id: 'test.tool',
    getShortName: () => 'TestTool', getDisplayName: () => '测试检查',
    getGroupDisplayName: () => '测试', isEnabledByDefault: () => true,
  }
  const handle = registerDaemonExtension(INSPECTION_TOOL_PROVIDER_EP, 'test.provider', {
    id: 'test.provider', getInspectionClasses: () => [tool],
  })
  assert.deepEqual(inspectionToolProviderClasses().map(item => item.getShortName()), ['TestTool'])
  assert.deepEqual(localInspectionContributions().map(item => item.id), [])
  // LocalInspectionEP 一档单独注册也能被查（与 provider 并集是两条路）。
  registerDaemonExtension(LOCAL_INSPECTION_EP, tool.id, tool)
  assert.deepEqual(localInspectionContributions().map(item => item.getShortName()), ['TestTool'])
  unregisterDaemonExtension(LOCAL_INSPECTION_EP, tool.id)
  handle.dispose()
})

test('IntentionAction / ErrorQuickFixProvider：同名方法面按 id 注册', () => {
  const action = {
    id: 'test.intention',
    getText: () => '抑制此检查', getFamilyName: () => 'Suppress',
    isAvailable: input => input.line === 3,
    invoke: input => ({ path: input.path, newText: '//noinspection\n' + input.text }),
    startInWriteAction: () => true,
  }
  const handle = registerDaemonExtension(INTENTION_ACTION_EP, action.id, action)
  assert.equal(intentionActionContributions()[0].isAvailable({ path: 'a.ts', line: 3, text: '' }), true)
  assert.equal(intentionActionContributions()[0].isAvailable({ path: 'a.ts', line: 4, text: '' }), false)

  const fixes = []
  const provider = {
    id: 'test.fix', registerErrorQuickFix: (_diagnostic, registrar) => registrar(action),
  }
  const fixHandle = registerDaemonExtension(ERROR_QUICK_FIX_PROVIDER_EP, provider.id, provider)
  errorQuickFixProviders()[0].registerErrorQuickFix({ path: 'a.ts', line: 3, message: 'x' }, fix => fixes.push(fix))
  assert.deepEqual(fixes.map(item => item.getText()), ['抑制此检查'])
  handle.dispose()
  fixHandle.dispose()
})

test('ProblemHighlightFilter：都同意才出，第三方抛错不拖垮其它文件', () => {
  const always = registerProblemHighlightFilter({
    id: 'test.always', shouldHighlightFile: () => true, shouldProcessFileInBatch: () => true,
  })
  assert.equal(shouldHighlightFileByFilters('a.ts'), true)
  assert.equal(shouldProcessFileInBatch('a.ts'), true)

  const deny = registerProblemHighlightFilter({
    id: 'test.deny', shouldHighlightFile: path => path !== 'skip.ts', shouldProcessFileInBatch: () => true,
  })
  assert.equal(shouldHighlightFileByFilters('skip.ts'), false)
  assert.equal(shouldHighlightFileByFilters('a.ts'), true)

  const boom = registerProblemHighlightFilter({
    id: 'test.boom',
    shouldHighlightFile: () => { throw new Error('bad plugin') },
    shouldProcessFileInBatch: () => true,
  })
  // 抛错的过滤器当作「同意」跳过，不把整份文件的诊断吃掉。
  assert.equal(shouldHighlightFileByFilters('a.ts'), true)
  always.dispose(); deny.dispose(); boom.dispose()
})

test('ProblemsProvider：pull 出提供者的问题，坏提供者不吞别人的', () => {
  const handle = registerDaemonExtension(PROBLEMS_PROVIDER_EP, 'test.problems', {
    id: 'test.problems', project: 'root',
    getProblems: () => [{ path: 'a.ts', line: 1, severity: 2, message: 'warn' }],
  })
  assert.deepEqual(problemsProviders().map(item => item.project), ['root'])
  assert.deepEqual(problemsFromProviders().map(item => item.message), ['warn'])

  registerDaemonExtension(PROBLEMS_PROVIDER_EP, 'test.bad', {
    id: 'test.bad', project: 'root', getProblems: () => { throw new Error('boom') },
  })
  assert.deepEqual(problemsFromProviders().map(item => item.message), ['warn'])
  unregisterDaemonExtension(PROBLEMS_PROVIDER_EP, 'test.bad')
  handle.dispose()
})

test('InspectionElementsMerger：真名 id（协调单的 inspectionElementsProvider 上游不存在）、静态查询与真实消费点', () => {
  assert.equal(INSPECTION_ELEMENTS_MERGER_EP, 'com.intellij.inspectionElementsMerger')
  assert.ok(EXTENSIONS.hasExtensionPoint(INSPECTION_ELEMENTS_MERGER_EP))
  declareDaemonExtensionPoints()

  // 没有登记合并器时，展开版候选键 = 原候选键（行为与展开前完全一致）。
  const identity = inspectionIdentityOf({ source: 'eslint', code: 'no-unused-vars' })
  assert.deepEqual(inspectionKeyCandidates(identity), [...identity.keys])

  const handle = registerInspectionElementsMerger({
    id: 'test.merger',
    getMergedToolName: () => 'UnusedDeclaration',
    getSourceToolNames: () => ['eslint', 'TSLint'],
  })
  // 上游 getMergedToolNames(id)：源短名命中即返回新短名。
  assert.deepEqual(mergedToolNamesFor('eslint'), ['UnusedDeclaration'])
  assert.deepEqual(mergedToolNamesFor('TSLint'), ['UnusedDeclaration'])
  assert.deepEqual(mergedToolNamesFor('other'), [])
  // 真实消费点（src/inspectionProfile.ts 的门控用的就是它）：老键之外补上新合并短名。
  assert.deepEqual(inspectionKeyCandidates(identity), ['eslint::no-unused-vars', 'eslint', 'UnusedDeclaration'])
  handle.dispose()
  assert.deepEqual(mergedToolNamesFor('eslint'), [])

  // suppressIds 与 sourceToolNames 两列**任一**命中都算（上游 getMergedToolNames 的 OR 语义）。
  const suppress = registerInspectionElementsMerger({
    id: 'test.suppress',
    getMergedToolName: () => 'Merged',
    getSourceToolNames: () => ['old'],
    getSuppressIds: () => ['legacy-id'],
  })
  assert.deepEqual(mergedToolNamesFor('legacy-id'), ['Merged'])
  assert.deepEqual(mergedToolNamesFor('old'), ['Merged'])
  suppress.dispose()
})
