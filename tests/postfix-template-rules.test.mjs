// 后缀模板条件与动作规则的判据 —— 逐条对上游
// `platform/lang-impl/src/com/intellij/codeInsight/template/postfix/` 与
// `java/java-impl/src/com/intellij/codeInsight/template/postfix/` 的真实行为。
//
// 纯 JS：本仓 `npm test` 不带 `--experimental-strip-types`，混入 TS 语法会让**整个文件加载失败**。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  APPLICABLE_EXPRESSION_TYPES_LABEL_EN, APPLICABLE_EXPRESSION_TYPES_LABEL_ZH,
  APPLY_TO_TOPMOST_LABEL_EN, APPLY_TO_TOPMOST_LABEL_ZH,
  EDITABLE_POSTFIX_DESCRIPTION_EN, EDITABLE_POSTFIX_DESCRIPTION_ZH,
  JAVA_POSTFIX_CONDITIONS, JAVA_POSTFIX_PROVIDER_ID, KOTLIN_POSTFIX_CONDITIONS,
  KOTLIN_POSTFIX_PROVIDER_ID, POSTFIX_CONDITION_SETS, POSTFIX_ERROR_HINT,
  PYTHON_POSTFIX_CONDITIONS, PYTHON_POSTFIX_PROVIDER_ID, compositeCondition, editablePostfixDescription,
  evaluateCondition, expandOutcome, isApplicable, javaEditorActions, javaFqnCondition, kotlinEditorActions,
  kotlinFqnCondition, postfixConditionById, postfixExampleAfter, postfixExampleBefore,
  pythonEditorActions, pythonTypeCondition, readConditions, readTemplateState, selectExpressions,
  writeConditionElement, writeConditions, writeTemplateState,
} from '../src/postfixTemplateRules.ts'
import { LIVE_TEMPLATE_MACROS } from '../src/templateMacros.ts'

const byId = (id, set = JAVA_POSTFIX_CONDITIONS) => set.find(condition => condition.id === id)
const facts = (over = {}) => ({ typeText: undefined, ...over })

// ---------------------------------------------------------------------------
// 条件是什么：谓词集合，不是表达式语言
// ---------------------------------------------------------------------------

test('conditions are a closed predicate set serialized by id only', () => {
  // PostfixTemplateExpressionCondition.java:21,32,40-42 —— 一条条件只有 id，序列化只写 id。
  for (const condition of JAVA_POSTFIX_CONDITIONS) {
    assert.equal(typeof condition.id, 'string')
    assert.equal(typeof condition.presentableName, 'string')
    assert.equal(condition.attribute, undefined, '固定条件没有额外属性：' + condition.id)
  }
  // JavaBundle.properties:1787-1793 的七条文案，逐条对上。
  assert.deepEqual(JAVA_POSTFIX_CONDITIONS.map(c => c.presentableName),
    ['void', 'non void', 'boolean', 'number', 'not primitive type', 'array', 'array of non-primitive types'])
  assert.deepEqual(JAVA_POSTFIX_CONDITIONS.map(c => c.id),
    ['void', 'non void', 'boolean', 'number', 'notPrimitive', 'array', 'arrayReference'])
})

test('the Kotlin and Python condition sets match their upstream bundles', () => {
  // KotlinPostfixTemplatesBundle.properties:2-7
  assert.deepEqual(KOTLIN_POSTFIX_CONDITIONS.map(c => c.presentableName),
    ['Unit', 'Non-Unit', 'Boolean', 'Number', 'Nullable', 'Not-Nullable'])
  // PyBundle.properties:1356-1366 里 PUBLIC_CONDITIONS 的十条（builtin len applicable 不在其中）
  assert.deepEqual(PYTHON_POSTFIX_CONDITIONS.map(c => c.presentableName),
    ['boolean', 'number', 'string', 'iterable', 'dict', 'list', 'set', 'tuple', 'non None', 'exception'])
  // 每一条都有语言专属布尔位（这些条件的 value() 全在语言类型系统里）。
  for (const condition of [...KOTLIN_POSTFIX_CONDITIONS, ...PYTHON_POSTFIX_CONDITIONS]) {
    assert.equal(typeof condition.factKey, 'string', condition.id + ' 需要 factKey')
  }
})

test('arrayReference exists upstream but is not offered in the Java action list', () => {
  // JavaPostfixTemplateProvider.java:181-183 能读回它；AsListToListPostfixTemplate.java:19 在用它；
  // 但 JavaPostfixTemplateEditor.java:99-105 的 fillConditions 里没有它 —— 照抄这个不对称。
  assert.ok(postfixConditionById(JAVA_POSTFIX_PROVIDER_ID, 'arrayReference'))
  const actions = javaEditorActions([])
  const conditionNames = actions.filter(a => a.kind === 'condition').map(a => a.presentableName)
  assert.deepEqual(conditionNames, ['void', 'non void', 'boolean', 'number', 'not primitive type', 'array'])
  assert.equal(conditionNames.includes('array of non-primitive types'), false)
})

// ---------------------------------------------------------------------------
// 动作列
// ---------------------------------------------------------------------------

test('the action column lists conditions then class pickers', () => {
  // JavaPostfixTemplateEditor.java:99-111：6 条条件 → 每项目一条 → 最后一条 enter class name…
  const java = javaEditorActions(['p1', 'p2'])
  assert.deepEqual(java.map(a => a.kind), ['condition', 'condition', 'condition', 'condition', 'condition', 'condition', 'chooseClass', 'chooseClass', 'enterClass'])
  assert.equal(java.at(-1).presentableName, 'enter class name\u2026')   // JavaBundle.properties:25
  assert.equal(java.at(-2).presentableName, 'choose class in p2\u2026') // JavaBundle.properties:23

  // KotlinPostfixTemplateEditor.kt:35-46：6 条条件 → 每项目一条 → enter class name…
  const kotlin = kotlinEditorActions(['p1'])
  assert.deepEqual(kotlin.map(a => a.kind), ['condition', 'condition', 'condition', 'condition', 'condition', 'condition', 'chooseClass', 'enterClass'])
  assert.equal(kotlin.at(-2).presentableName, 'Choose Class in p1')

  // PyPostfixTemplateEditor.kt:33-42：10 条条件 →（有项目时）**一条** choose class… → enter class name…
  const python = pythonEditorActions(['p1', 'p2'])
  assert.equal(python.filter(a => a.kind === 'condition').length, 10)
  assert.equal(python.filter(a => a.kind === 'chooseClass').length, 1, 'Python 的选类是一个动作，不是每项目一条')
  assert.deepEqual(pythonEditorActions([]).map(a => a.kind).at(-1), 'enterClass')

  // 每条动作都有中文文案（localization-zh 同名键）。
  for (const action of [...java, ...kotlin, ...python]) {
    assert.equal(typeof action.presentableNameZh, 'string')
    assert.ok(action.presentableNameZh.length > 0)
  }
})

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

test('conditions round-trip through <condition id=…/> elements', () => {
  // PostfixTemplatesUtils.java:138-159 写、:161-177 读。
  const fqn = javaFqnCondition('java.util.List')
  assert.deepEqual(writeConditionElement(fqn), { id: 'fqn', fqn: 'java.util.List' }) // FQN_ATTR = "fqn"
  assert.deepEqual(writeConditionElement(byId('array')), { id: 'array' })
  assert.deepEqual(writeConditionElement(pythonTypeCondition('dict')), { id: 'type', type: 'dict' }) // TYPE_ATTR = "type"
  assert.deepEqual(writeConditionElement(kotlinFqnCondition('kotlin.Unit')), { id: 'kotlin.fqn', fqn: 'kotlin.Unit' })

  const conditions = [byId('non void'), fqn]
  const state = writeTemplateState(conditions, true)
  assert.equal(state.topmost, true)
  assert.deepEqual(state.conditions, [{ id: 'non void' }, { id: 'fqn', fqn: 'java.util.List' }])
  const reloaded = readTemplateState(JAVA_POSTFIX_PROVIDER_ID, { topmost: 'true', conditions: state.conditions })
  assert.equal(reloaded.topmost, true)
  assert.deepEqual(reloaded.conditions.map(c => c.id), ['non void', 'fqn'])
  assert.equal(reloaded.conditions[1].presentableName, 'java.util.List')
})

test('unreadable conditions are dropped, not fatal', () => {
  // PostfixTemplatesUtils.java:167-170：工厂返回 null 就 addIfNotNull 丢掉。
  assert.deepEqual(readConditions(JAVA_POSTFIX_PROVIDER_ID, [{ id: 'no-such-id' }]), [])
  assert.deepEqual(readConditions(JAVA_POSTFIX_PROVIDER_ID, [{ id: 'fqn' }]), [], 'fqn 缺属性 → 丢掉（JavaPostfixTemplateProvider.java:199-204）')
  assert.deepEqual(readConditions(JAVA_POSTFIX_PROVIDER_ID, [{ id: 'fqn', fqn: '' }]), [], '空 fqn 也丢掉')
  assert.deepEqual(readConditions(PYTHON_POSTFIX_PROVIDER_ID, [{ id: 'type' }]), [], 'type 缺属性 → 丢掉')
  assert.deepEqual(readConditions(KOTLIN_POSTFIX_PROVIDER_ID, [{ id: 'kotlin.fqn', fqn: '' }]), [])
  // 未知 id 与可读 id 混在一起时只丢坏的那条。
  assert.deepEqual(readConditions(JAVA_POSTFIX_PROVIDER_ID, [{ id: 'bogus' }, { id: 'void' }]).map(c => c.id), ['void'])
})

test('the topmost flag uses Boolean.parseBoolean semantics', () => {
  // PostfixTemplatesUtils.java:187-189：缺属性 = false，只有 "true"（忽略大小写）才是真。
  assert.equal(readTemplateState(JAVA_POSTFIX_PROVIDER_ID, {}).topmost, false)
  assert.equal(readTemplateState(JAVA_POSTFIX_PROVIDER_ID, { topmost: 'TRUE' }).topmost, true)
  assert.equal(readTemplateState(JAVA_POSTFIX_PROVIDER_ID, { topmost: 'yes' }).topmost, false)
  assert.equal(readTemplateState(JAVA_POSTFIX_PROVIDER_ID, { topmost: true }).topmost, true)
})

// ---------------------------------------------------------------------------
// 求值
// ---------------------------------------------------------------------------

test('the Java conditions follow JavaPostfixTemplatesUtils exactly', () => {
  // number 只认 int/byte/long 与它们的包装类（JavaPostfixTemplatesUtils.java:188-200）——
  // 不含 double/float/short/char，这是上游的原样口径，不是漏写。
  assert.equal(evaluateCondition(byId('number'), facts({ typeText: 'int' })), true)
  assert.equal(evaluateCondition(byId('number'), facts({ typeText: 'java.lang.Byte' })), true)
  for (const other of ['double', 'float', 'short', 'char', 'java.lang.Double', 'java.lang.Short']) {
    assert.equal(evaluateCondition(byId('number'), facts({ typeText: other })), false, 'number 不认 ' + other)
  }
  // boolean 认基元与 java.lang.Boolean（:178-181）。
  assert.equal(evaluateCondition(byId('boolean'), facts({ typeText: 'boolean' })), true)
  assert.equal(evaluateCondition(byId('boolean'), facts({ typeText: 'java.lang.Boolean' })), true)
  assert.equal(evaluateCondition(byId('boolean'), facts({ typeText: 'int' })), false)
  // void / non void（:74-77、:183-185）。
  assert.equal(evaluateCondition(byId('void'), facts({ typeText: 'void' })), true)
  assert.equal(evaluateCondition(byId('non void'), facts({ typeText: 'void' })), false)
  assert.equal(evaluateCondition(byId('non void'), facts({ typeText: 'int' })), true)
  // type 取不到时 void 与 non void 都是假（type == null）。
  assert.equal(evaluateCondition(byId('void'), facts()), false)
  assert.equal(evaluateCondition(byId('non void'), facts()), false)
  // notPrimitive 要 type != null（:147-155）。
  assert.equal(evaluateCondition(byId('notPrimitive'), facts()), false)
  assert.equal(evaluateCondition(byId('notPrimitive'), facts({ typeText: 'java.lang.String', primitive: false })), true)
  assert.equal(evaluateCondition(byId('notPrimitive'), facts({ typeText: 'int', primitive: true })), false)
  // array / arrayReference（:168-175）。
  assert.equal(evaluateCondition(byId('array'), facts({ array: true })), true)
  assert.equal(evaluateCondition(byId('arrayReference'), facts({ array: true, arrayComponentPrimitive: false })), true)
  assert.equal(evaluateCondition(byId('arrayReference'), facts({ array: true, arrayComponentPrimitive: true })), false)
  assert.equal(evaluateCondition(byId('arrayReference'), facts({ array: false })), false)
})

test('the fqn condition is an inherits-or-self deep check', () => {
  // JavaPostfixTemplateExpressionCondition.java:35-38 → InheritanceUtil.java:89-99
  // （isInheritorOrSelf(..., true)：含自身、深查）。
  const condition = javaFqnCondition('java.lang.CharSequence')
  assert.equal(evaluateCondition(condition, facts({ inherits: ['java.lang.String', 'java.lang.CharSequence'] })), true)
  assert.equal(evaluateCondition(condition, facts({ inherits: ['java.lang.String'] })), false)
  assert.equal(evaluateCondition(condition, facts()), false, '没有超类信息 → 假（findClass == null 那一档）')
})

test('language-specific conditions read the host boolean, never a macro', () => {
  const unit = byId('kotlin.unit', KOTLIN_POSTFIX_CONDITIONS)
  assert.equal(evaluateCondition(unit, { facts: { unit: true } }), true)
  assert.equal(evaluateCondition(unit, { facts: { unit: false } }), false)
  assert.equal(evaluateCondition(unit, {}), false, '缺布尔位 = 假')
  const iterable = byId('iterable', PYTHON_POSTFIX_CONDITIONS)
  assert.equal(evaluateCondition(iterable, { facts: { iterable: true } }), true)
  assert.equal(evaluateCondition(iterable, {}), false)
})

test('the composite condition ORs the entries and is true when empty', () => {
  // EditablePostfixTemplateWithMultipleExpressions.java:89-99，空集那条在 :97。
  const conditions = [byId('boolean'), byId('array')]
  assert.equal(compositeCondition(conditions, facts({ typeText: 'boolean' })), true)
  assert.equal(compositeCondition(conditions, facts({ array: true })), true)
  assert.equal(compositeCondition(conditions, facts({ typeText: 'java.lang.String' })), false)
  assert.equal(compositeCondition([], facts({ typeText: 'anything' })), true, '没配条件 = 处处适用')
})

// ---------------------------------------------------------------------------
// 可用性：isApplicable = 过滤后还有表达式
// ---------------------------------------------------------------------------

const candidate = (over = {}) => ({ text: 'value', endOffset: 5, facts: facts({ typeText: 'int' }), ...over })

test('isApplicable mirrors the upstream filter chain', () => {
  // EditablePostfixTemplate.java:117-120 + JavaEditablePostfixTemplate.java:80-99
  // + PostfixLiveTemplate.java:373-376（dumb / enabled / 副本上的偏移）。
  const conditions = [byId('number')]
  assert.equal(isApplicable(conditions, { offset: 5, candidates: [candidate()] }), true)
  assert.equal(isApplicable(conditions, { offset: 6, candidates: [candidate()] }), false, '末尾偏移必须等于 newOffset')
  assert.equal(isApplicable(conditions, { offset: 5, candidates: [candidate({ hasError: true })] }), false, 'PSI_ERROR_FILTER')
  assert.equal(isApplicable(conditions, { offset: 5, candidates: [candidate({ facts: facts({ typeText: 'java.lang.String' }) })] }), false, '条件不过')
  assert.equal(isApplicable(conditions, { offset: 5, candidates: [] }), false)
  assert.equal(isApplicable(conditions, { offset: 5, candidates: [candidate()], dumbUsable: false }), false, 'DumbService 挡下')
  assert.equal(isApplicable(conditions, { offset: 5, candidates: [candidate()], languageLevelOk: false }), false, '语言级别挡下')
})

test('selectExpressions keeps every applicable candidate, in input order', () => {
  const conditions = [byId('number')]
  const selected = selectExpressions(conditions, {
    offset: 5,
    candidates: [candidate({ text: 'a' }), candidate({ text: 'b', endOffset: 9 }), candidate({ text: 'c' })],
  })
  assert.deepEqual(selected.map(c => c.text), ['a', 'c'])
})

test('expansion failure is the upstream error hint', () => {
  // EditablePostfixTemplate.java:72-75 → PostfixTemplatesUtils.java:113-116
  // （CodeInsightBundle.properties:356）。
  const failed = expandOutcome([byId('void')], { offset: 5, candidates: [candidate()] })
  assert.equal(failed.ok, false)
  assert.equal(failed.errorHint, POSTFIX_ERROR_HINT)
  assert.equal(failed.errorHint, "Can't expand postfix template")
  const ok = expandOutcome([byId('number')], { offset: 5, candidates: [candidate()] })
  assert.deepEqual(ok, { ok: true, errorHint: '' })
})

// ---------------------------------------------------------------------------
// 例子（Before / After）
// ---------------------------------------------------------------------------

test('the settings example is built like EditablePostfixTemplateMetaData', () => {
  // EditablePostfixTemplateMetaData.java:30-31。
  assert.equal(postfixExampleBefore('.var'), '<spot>$EXPR$</spot>.var')
  assert.equal(postfixExampleAfter('var $NAME$ = $EXPR$;$END$'), 'var $NAME$ = $EXPR$;<spot/>')
  // StringUtil.replace(text, "$END$", "<spot/>", true) 忽略大小写、替换全部。
  assert.equal(postfixExampleAfter('$end$ then $END$'), '<spot/> then <spot/>')
  assert.equal(postfixExampleAfter('no marker'), 'no marker')
})

test('the editable-template description comes from the bundle', () => {
  // CodeInsightBundle.properties:99 + localization-zh messages/CodeInsightBundle.properties:527
  assert.equal(editablePostfixDescription(false), EDITABLE_POSTFIX_DESCRIPTION_EN)
  assert.equal(editablePostfixDescription(true), EDITABLE_POSTFIX_DESCRIPTION_ZH)
  assert.equal(EDITABLE_POSTFIX_DESCRIPTION_EN, 'User-defined postfix template')
  assert.equal(EDITABLE_POSTFIX_DESCRIPTION_ZH, '用户定义的后缀模板')
  // 条件列标题与 topmost 勾选框：CodeInsightBundle.properties:379 / :322
  assert.equal(APPLICABLE_EXPRESSION_TYPES_LABEL_EN, 'Applicable expression types:')
  assert.equal(APPLICABLE_EXPRESSION_TYPES_LABEL_ZH, '适用的表达式类型:')
  assert.equal(APPLY_TO_TOPMOST_LABEL_EN, 'Apply to the &topmost expression')
  assert.equal(APPLY_TO_TOPMOST_LABEL_ZH, '应用于最上方的表达式(&T)')
})

// ---------------------------------------------------------------------------
// 与 templateMacros.ts 的关系：没有关系
// ---------------------------------------------------------------------------

test('conditions never reference live-template macros', () => {
  // 上游 .../postfix/templates/editable/ 对 Macro 零命中；条件是类型谓词，宏活在模板正文的
  // `$NAME:表达式$` 那一段（src/templateMacros.ts 头注）。两边名字也不相交。
  const macroNames = new Set(LIVE_TEMPLATE_MACROS.map(macro => macro.name))
  for (const set of Object.values(POSTFIX_CONDITION_SETS)) {
    for (const condition of set) {
      assert.equal(macroNames.has(condition.id), false, condition.id + ' 不该是宏名')
      assert.equal(macroNames.has(condition.presentableName), false)
    }
  }
  // 条件的 id 里没有 `(`（宏调用才有参数表）；也没有 `$`（那是模板正文的词法）。
  for (const set of Object.values(POSTFIX_CONDITION_SETS)) {
    for (const condition of set) {
      assert.equal(condition.id.includes('('), false)
      assert.equal(condition.id.includes('$'), false)
    }
  }
})

test('the condition sets are keyed by the upstream provider ids', () => {
  // JavaPostfixTemplateProvider.java:98 / PyPostfixTemplateProvider.java:59 /
  // KotlinPostfixTemplateProvider 的 provider id 由 EP 语言键派生。
  assert.deepEqual(Object.keys(POSTFIX_CONDITION_SETS).sort(), [JAVA_POSTFIX_PROVIDER_ID, KOTLIN_POSTFIX_PROVIDER_ID, PYTHON_POSTFIX_PROVIDER_ID].sort())
  // Kotlin 的 provider 没有覆写 getId()（PostfixTemplateProvider.java:29-31 的默认值 = 类全名）。
  assert.equal(KOTLIN_POSTFIX_PROVIDER_ID, 'org.jetbrains.kotlin.idea.codeInsight.postfix.KotlinPostfixTemplateProvider')
  assert.equal(postfixConditionById(JAVA_POSTFIX_PROVIDER_ID, 'arrayReference').presentableName, 'array of non-primitive types')
  assert.equal(postfixConditionById(PYTHON_POSTFIX_PROVIDER_ID, 'non none').presentableNameZh, '非 None')
  assert.equal(postfixConditionById(KOTLIN_POSTFIX_PROVIDER_ID, 'kotlin.nullable').presentableName, 'Nullable')
  assert.equal(postfixConditionById(JAVA_POSTFIX_PROVIDER_ID, 'iterable'), undefined, 'Python 的 iterable 不在 Java 集里')
})