// 判据 · **重命名/重构的扩展点**（`src/refactorRenameExtensionPoints.ts`，上游
// `com.intellij.refactoring.rename.*` / `RefactoringHelper` / `QualifiedNameProvider` 一族）。
//
// 钉四件事：
//   ① 七条 EP 的 id 与上游各自的 `ExtensionPointName.create`（文件头逐行出处）逐字一致，且已在宿主里声明；
//   ② 贡献者按 id 注册/注销生效，按语言过滤（`languages` 空视为通吃）；
//   ③ 消费面真的读 EP：`validateRenameInput` 收全表按序取首条错误、`suggestedNamesFor` 合并去重、
//      `renameVetoedBy` 任一为真即拦、`companionRenamesFor` 收派生改名对；
//   ④ bundled 四条贡献（校验器 / 建议器 / 两个限定名）真的能被消费点拿到。
import test from 'node:test'
import assert from 'node:assert/strict'

import { APPLICATION_SCOPE, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  AUTOMATIC_RENAMER_FACTORY_EP,
  BUILTIN_NAME_VALIDATOR_ID,
  NAME_SUGGESTION_PROVIDER_EP,
  QUALIFIED_NAME_PROVIDER_EP,
  REFACTORING_HELPER_EP,
  RENAME_HANDLER_EP,
  RENAME_INPUT_VALIDATOR_EP,
  VETO_RENAME_CONDITION_EP,
  VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP,
  automaticRenamerFactories,
  builtinFileQualifiedNameProvider,
  builtinNameSuggestionProvider,
  builtinRenameInputValidator,
  companionRenamesFor,
  fileQualifiedNameOf,
  nameSuggestionProviders,
  qualifiedNameOf,
  refactoringHelpers,
  registerAutomaticRenamerFactory,
  registerBundledRefactorRenameContributions,
  registerNameSuggestionProvider,
  registerQualifiedNameProvider,
  registerRefactoringHelper,
  registerRenameHandler,
  registerRenameInputValidator,
  registerVetoRenameCondition,
  registerVirtualFileQualifiedNameProvider,
  renameHandlers,
  renameInputValidators,
  renameVetoedBy,
  suggestedNamesFor,
  validateRenameInput,
  vetoRenameConditions,
} from '../src/refactorRenameExtensionPoints.ts'

const subject = (over = {}) => ({ path: 'src/Sample.java', language: 'java', currentName: 'MyClass', kind: 'class', ...over })
const context = { locations: [{ path: 'src/Sample.java', line: 1, character: 6 }], searchInComments: true }

test('八条 EP 已声明，id 与上游 qualifiedName 逐字一致', () => {
  assert.equal(RENAME_INPUT_VALIDATOR_EP, 'com.intellij.renameInputValidator')
  assert.equal(NAME_SUGGESTION_PROVIDER_EP, 'com.intellij.nameSuggestionProvider')
  assert.equal(RENAME_HANDLER_EP, 'com.intellij.renameHandler')
  assert.equal(VETO_RENAME_CONDITION_EP, 'com.intellij.vetoRenameCondition')
  assert.equal(AUTOMATIC_RENAMER_FACTORY_EP, 'com.intellij.automaticRenamerFactory')
  assert.equal(REFACTORING_HELPER_EP, 'com.intellij.refactoring.helper')
  assert.equal(QUALIFIED_NAME_PROVIDER_EP, 'com.intellij.qualifiedNameProvider')
  assert.equal(VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP, 'com.intellij.virtualFileQualifiedNameProvider')
  for (const id of [
    RENAME_INPUT_VALIDATOR_EP, NAME_SUGGESTION_PROVIDER_EP, RENAME_HANDLER_EP, VETO_RENAME_CONDITION_EP,
    AUTOMATIC_RENAMER_FACTORY_EP, REFACTORING_HELPER_EP, QUALIFIED_NAME_PROVIDER_EP, VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP,
  ]) {
    assert.equal(EXTENSIONS.hasExtensionPoint(id), true, `${id} 未声明`)
  }
})

test('第三方校验器按 id 注册后被 validateRenameInput 拿到；按语言过滤', () => {
  const java = registerRenameInputValidator({
    id: 'demo.javaOnly', languages: ['java'],
    isInputValid: newName => newName === 'Bad' ? '演示校验器拒绝 Bad。' : '',
  })
  const ts = registerRenameInputValidator({
    id: 'demo.tsOnly', languages: ['typescript'],
    isInputValid: () => '只在 TypeScript 生效。',
  })
  try {
    assert.ok(renameInputValidators('java').some(v => v.id === 'demo.javaOnly'))
    assert.equal(renameInputValidators('java').some(v => v.id === 'demo.tsOnly'), false)
    assert.equal(validateRenameInput('Bad', subject({ language: 'java' }), context), '演示校验器拒绝 Bad。')
    assert.equal(validateRenameInput('Good', subject({ language: 'java' }), context), '')
    // 只在 TS 的那条不进 java 的账
    assert.equal(validateRenameInput('Any', subject({ language: 'java' }), context), '')
    assert.equal(validateRenameInput('Any', subject({ language: 'typescript' }), context), '只在 TypeScript 生效。')
  } finally {
    java.dispose()
    ts.dispose()
  }
  assert.equal(renameInputValidators('java').some(v => v.id === 'demo.javaOnly'), false)
})

test('建议器合并去重；否决条件任一为真即拦；重命名处理器按可用性过滤', () => {
  const a = registerNameSuggestionProvider({ id: 'demo.a', getSuggestedNames: (_s, result) => { result.push('alpha') } })
  const b = registerNameSuggestionProvider({ id: 'demo.b', getSuggestedNames: (_s, result) => { result.push('alpha', 'beta') } })
  const veto = registerVetoRenameCondition({ id: 'demo.veto', veto: s => s.currentName === 'Forbidden' })
  const handler = registerRenameHandler({
    id: 'demo.handler', isAvailableOnDataContext: s => s.path.endsWith('.java'),
  })
  try {
    assert.deepEqual(suggestedNamesFor(subject({ language: 'javascript' })).filter(n => n === 'alpha' || n === 'beta'), ['alpha', 'beta'])
    assert.equal(nameSuggestionProviders('javascript').some(p => p.id === 'demo.a'), true)
    assert.equal(renameVetoedBy(subject())?.id, undefined)
    assert.equal(renameVetoedBy(subject({ currentName: 'Forbidden' }))?.id, 'demo.veto')
    assert.ok(vetoRenameConditions().some(c => c.id === 'demo.veto'))
    assert.ok(renameHandlers(subject()).some(h => h.id === 'demo.handler'))
    assert.equal(renameHandlers(subject({ path: 'src/a.ts' })).some(h => h.id === 'demo.handler'), false)
  } finally {
    a.dispose(); b.dispose(); veto.dispose(); handler.dispose()
  }
})

test('自动重命名工厂与重构助手真的被消费点读到', () => {
  const factory = registerAutomaticRenamerFactory({
    id: 'demo.renamer', isApplicable: s => s.kind === 'field',
    suggestedNames: () => ['m_value'],
    companionRenames: (from, to) => [{ from: `get${from}`, to: `get${to}` }],
  })
  const helper = registerRefactoringHelper({
    id: 'demo.helper',
    prepareOperation: usages => usages.map(u => `${u.path}:${u.line}`),
    performOperation: (data, sink) => { for (const entry of data) sink.replace(entry.split(':')[0], 1, 'X') },
  })
  const sinkCalls = []
  try {
    assert.ok(automaticRenamerFactories(subject({ kind: 'field' })).some(f => f.id === 'demo.renamer'))
    assert.equal(automaticRenamerFactories(subject({ kind: 'class' })).some(f => f.id === 'demo.renamer'), false)
    assert.deepEqual(companionRenamesFor(subject({ kind: 'field' }), 'value', 'amount'), [{ from: 'getvalue', to: 'getamount' }])

    const helpers = refactoringHelpers()
    const target = helpers.find(h => h.id === 'demo.helper')
    assert.ok(target)
    const data = target.prepareOperation([{ path: 'src/A.java', line: 3, text: 'x' }], subject())
    target.performOperation(data, { replace: (path, line, text) => sinkCalls.push([path, line, text]) })
    assert.deepEqual(sinkCalls, [['src/A.java', 1, 'X']])
  } finally {
    factory.dispose(); helper.dispose()
  }
})

test('限定名提供方按语言取第一条；文件限定名按源根取相对路径', () => {
  const java = registerQualifiedNameProvider({
    id: 'demo.qn.java', languages: ['java'], getQualifiedName: s => `com.demo.${s.currentName}`,
  })
  try {
    assert.equal(qualifiedNameOf(subject({ language: 'java' })), 'com.demo.MyClass')
    assert.equal(qualifiedNameOf(subject({ language: 'typescript' })), '')
  } finally { java.dispose() }

  const file = registerVirtualFileQualifiedNameProvider({
    id: 'demo.vfqn', getQualifiedName: (path, root) => `${root}|${path}`,
  })
  try {
    assert.equal(fileQualifiedNameOf('src/a.ts', '/ws'), '/ws|src/a.ts')
  } finally { file.dispose() }
})

test('bundled 四条贡献挂上后消费点真的拿到', () => {
  const dispose = registerBundledRefactorRenameContributions(
    language => language === 'java' ? ['class', 'void'] : [],
  )
  try {
    assert.ok(renameInputValidators('java').some(v => v.id === BUILTIN_NAME_VALIDATOR_ID))
    assert.equal(validateRenameInput('', subject(), context), '名字不能为空。')
    assert.equal(validateRenameInput('class', subject({ language: 'java' }), context), '「class」是java关键字，不能用作名字。')
    assert.equal(validateRenameInput('class', subject({ language: 'kotlin' }), context), '')

    const candidates = suggestedNamesFor(subject({ currentName: 'MyClassName', language: 'javascript' }))
    assert.ok(candidates.includes('my_class_name'), `驼峰未切出蛇形：${candidates.join(',')}`)
    assert.ok(candidates.includes('myClassName'))
    assert.ok(candidates.includes('MyClassName'))

    assert.equal(qualifiedNameOf(subject({ path: 'src/Sample.java', currentName: 'Foo' })), 'src/Sample#Foo')
    assert.equal(fileQualifiedNameOf('D:/ws/src/a.ts', 'D:/ws'), 'src/a.ts')
  } finally { dispose() }

  // 注销后内建贡献不再出现
  assert.equal(renameInputValidators('java').some(v => v.id === BUILTIN_NAME_VALIDATOR_ID), false)
})

test('内建校验器与建议器/限定名可单独构造（白盒）', () => {
  const validator = builtinRenameInputValidator(() => ['reserved'])
  assert.equal(validator.isInputValid('ok_name', subject(), context), '')
  assert.equal(validator.isInputValid('1bad', subject(), context).includes('标识符'), true)
  assert.equal(validator.isInputValid('reserved', subject(), context).includes('关键字'), true)

  const result = []
  builtinNameSuggestionProvider().getSuggestedNames(subject({ currentName: 'single' }), result)
  assert.deepEqual(result, [], '单词名不给候选（切词少于两段）')

  assert.equal(builtinFileQualifiedNameProvider().getQualifiedName('src/a.ts', 'src/'), 'a.ts')
})
