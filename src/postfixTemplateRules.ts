// 后缀模板（postfix template）的**条件**与**动作**规则 —— 纯逻辑，零 Vue、零 PSI。
//
// 上游契约（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 编辑器接口 `platform/lang-impl/src/com/intellij/codeInsight/template/postfix/templates/editable/PostfixTemplateEditor.java:17`
//       `:26` createTemplate(id, name)、`:32` getComponent()、`:34-36` getHelpId()
//       （可编辑模板的编辑面板由**各语言**实现，本模块只落平台侧那张表与规则）。
//   · 条件契约 `.../editable/PostfixTemplateExpressionCondition.java:19`
//       —— `extends Condition<PsiElement>`：条件是**对 PSI 元素求值的谓词**，不是字符串表达式。
//       `:21` 序列化属性名 `ID_ATTR = "id"`；`:26` `getPresentableName()`（编辑器里那一列文案）；
//       `:32` `getId()`（序列化用的 id）；`:40-42` `serializeTo()` 只写一个 `id` 属性；
//       `:50` `value(T)` 返回「该元素适用与否」。
//   · 条件集合 + 求值 `.../editable/EditablePostfixTemplateWithMultipleExpressions.java`
//       `:25` `myExpressionConditions`、`:32` 构造参数、`:71-73` `getExpressionConditions()`；
//       `:89-99` `getExpressionCompositeCondition()`：**逐条 OR**，且**集合为空时返回 true**（`:97`）。
//   · 可编辑模板基类 `.../editable/EditablePostfixTemplate.java:42`
//       `:69` `expand()`；`:70` 用**真实 editor 的光标偏移**取表达式；`:72-75` 取不到就 `showErrorHint`；
//       `:117-120` `isApplicable()` = `!getExpressions(context, copyDocument, newOffset).isEmpty()`；
//       `:177` 展开时把接收者写进固定变量 `EXPR`（`template.addVariable("EXPR", ...)`）。
//   · 求值时机 `.../templates/PostfixLiveTemplate.java:373-376`
//       —— 可用性判定发生在**补全/展开的适用性检查**里：对象是**去掉了模板键的副本文件**，
//       偏移是 `newOffset`（键之前），并叠加 `isDumbEnough` 与 `template.isEnabled(provider)`。
//       `.../editable/EditableTemplateModExpander.java:56-68` 的 ModCommand 路径同样在副本上重算。
//   · 动作列 `.../settings/PostfixTemplateEditorBase.java`
//       `:45-57` `AddConditionAction`（菜单项文案 = 条件的 `getPresentableName()`）；
//       `:72` 列表单元渲染同一文案；`:95-102` 弹出菜单；`:104` `fillConditions()`（**语言侧**填动作）；
//       `:112-115` 打开时把条件灌进列表；`:116` 勾选框 = `isUseTopmostExpression()`；
//       `:106-118` `setTemplate()`。面板文案 `.../settings/PostfixTemplateEditorBaseContent.kt:23,27,33`。
//   · 存储 `.../templates/PostfixTemplatesUtils.java`
//       `:42-44` 标签/属性名（`condition` / `conditions` / `topmost`）；
//       `:138-159` 写：先写 `topmost` 布尔属性，再写 `<conditions>` 里逐个 `<condition id=…/>`；
//       `:161-177` 读：`<conditions>` 不存在 → 空集；每条读不出来（工厂返回 null）就**丢掉**（`:167-170`）；
//       `:187-189` `topmost` 用 `Boolean.parseBoolean`（缺属性 = false）。
//   · 例子（设置页 Before/After）`.../settings/EditablePostfixTemplateMetaData.java:30-31`
//       `before` = `<spot>$EXPR$</spot>` + 模板键；`after` = 模板正文里的 `$END$` 换成 `<spot/>`；
//       `:46` 描述文案。`:33-34` 判定「可编辑且非内建」才用这份例子。
//   · 文案 `platform/lang-api/resources/messages/CodeInsightBundle.properties`
//       `:99` 描述、`:322` topmost 勾选、`:378` EXPR 提示、`:379` 条件列标题、`:397` 表达式选择框标题。
//       中文取自 `D:/IntelliJ IDEA 2026.2/plugins/localization-zh/lib/localization-zh.jar` 的
//       `messages/CodeInsightBundle.properties`（规约 §1.4 允许读中文文案包）。
//
// **条件表达式是什么**（任务要求说清，照源码）：上游**没有**条件表达式语言 ——
//   既不是 Java 表达式，也不是 DSL。条件是一个**封闭的、从弹出菜单里选的谓词集合**，
//   每个元素只有 `id` + 可选的类属性，序列化成 `<condition id="…"/>`。
//   用户能「改条件」= 增删这个集合里的谓词，以及勾选「应用到最上方的表达式」（topmost）。
//
// **求值失败怎么办**（照源码，逐条）：条件谓词本身**永不抛**，只有真/假两态；
//   `fqn` 条件查不到那个类时 `InheritanceUtil.isInheritor` 走 `findClass == null` → false
//   （`java/java-psi-api/src/com/intellij/psi/util/InheritanceUtil.java:89-99`）；
//   反序列化时读不出的条件被丢弃（`PostfixTemplatesUtils.java:167-170`）；
//   整个集合过滤后为空 → `isApplicable` 假 / 展开时弹那句错误提示（`EditablePostfixTemplate.java:72-75`）。
//
// **与 `src/templateMacros.ts` 的关系**：**没有任何关系**。条件是「接收者是什么类型」的谓词，
//   宏活在模板正文 `$NAME:表达式$` 的默认值那一段（`src/templateMacros.ts` 头注）。
//   上游 `.../postfix/` 整个包对 `Macro` 只有语言侧模板类引用 `MacroCallNode` 做正文展开
//   （`java/java-impl/.../postfix/templates/ForeachPostfixTemplate.java:5` 等），
//   **条件一侧零命中**：`grep -rni macro .../postfix/templates/editable/` 无结果。
//   ⇒ 条件里不能引用宏；`tests/postfix-template-rules.test.mjs` 用「条件名与宏名不相交」把这条钉住。
//
// 本仓承接方式：本模块是**规则层**（哪些条件存在、怎么合并、怎么序列化、可用性怎么判、例子怎么生成）。
//   真正的类型事实（接收者的类型文本 / 是否基元 / 是否数组 / 超类名 / 语言专属布尔位）由宿主喂进来
//   （Java 走 LSP hover 那一档，Kotlin/Python 走语言专属布尔位）—— 见 `PostfixReceiverFacts`。
//   上游语言侧的 PSI 走查（topmost 选择、错误元素过滤、`getRangeToRemove`）**不在本模块**。

/** 接收者固定变量名：`EditablePostfixTemplate.java:177`。 */
export const POSTFIX_EXPR_VARIABLE = 'EXPR'
/** 模板正文里的光标位变量：`EditablePostfixTemplateMetaData.java:21`。 */
export const POSTFIX_END_VARIABLE = 'END'
export const POSTFIX_EXPR_TOKEN = '$EXPR$'
export const POSTFIX_END_TOKEN = '$END$'
/** `HtmlChunk.tag("spot")`（`EditablePostfixTemplateMetaData.java:30-31`）。 */
export const POSTFIX_SPOT_TAG = 'spot'
/** 展开时取不到表达式的那句提示（`CodeInsightBundle.properties:356`）。 */
export const POSTFIX_ERROR_HINT = "Can't expand postfix template"
/** 可编辑模板的描述（`CodeInsightBundle.properties:99`；中文来自 localization-zh）。 */
export const EDITABLE_POSTFIX_DESCRIPTION_EN = 'User-defined postfix template'
export const EDITABLE_POSTFIX_DESCRIPTION_ZH = '用户定义的后缀模板'
/** 条件列标题（`CodeInsightBundle.properties:379`；中文来自 localization-zh）。 */
export const APPLICABLE_EXPRESSION_TYPES_LABEL_EN = 'Applicable expression types:'
export const APPLICABLE_EXPRESSION_TYPES_LABEL_ZH = '适用的表达式类型:'
/** topmost 勾选框（`CodeInsightBundle.properties:322`；中文来自 localization-zh）。 */
export const APPLY_TO_TOPMOST_LABEL_EN = 'Apply to the &topmost expression'
export const APPLY_TO_TOPMOST_LABEL_ZH = '应用于最上方的表达式(&T)'

/**
 * 一个后缀模板条件。`presentableName` 是编辑器弹出菜单与列表里的文案
 * （`PostfixTemplateEditorBase.java:49,72` → `PostfixTemplateExpressionCondition.java:26`）。
 */
export interface PostfixExpressionCondition {
  /** 序列化 id（`PostfixTemplateExpressionCondition.java:21,32`）。 */
  readonly id: string
  /** 上游 `getPresentableName()`（英文原文；类条件时是那个类名本身）。 */
  readonly presentableName: string
  /** 中文文案（localization-zh 同名键；取不到时与英文相同）。 */
  readonly presentableNameZh: string
  /** 上游实现类（含嵌套类的 `$`），门禁用它对账。 */
  readonly upstream: string
  /** 类条件额外写进 XML 的属性名（`JavaPostfixTemplateExpressionCondition.java:22` 的 `fqn`、
   *  `PyPostfixTemplateExpressionCondition.kt:206` 的 `type`）。 */
  readonly attribute?: 'fqn' | 'type'
  /** 语言专属布尔位：非 Java 条件的 `value()` 全都靠语言类型系统，本仓只能收一个已判好的布尔。 */
  readonly factKey?: string
}

/**
 * 接收者的**类型事实** —— 宿主喂进来的输入，不是本模块推断出来的。
 * Java 走 `typeText`/`primitive`/`array`/`inherits`（`JavaPostfixTemplatesUtils.java:147-206`
 * 与 `InheritanceUtil.java:68-99` 的判据都建在这几个位上）；
 * Kotlin/Python 走 `facts` 里语言专属的布尔位（各自 `value()` 的读法见下面各表的注释）。
 */
export interface PostfixReceiverFacts {
  /** 规范化类型文本，如 `int`、`void`、`java.lang.Boolean`、`java.lang.String[]`。 */
  readonly typeText?: string
  readonly primitive?: boolean
  readonly array?: boolean
  /** 数组元素是不是基元（`isArrayReference` 用，`JavaPostfixTemplatesUtils.java:173-175`）。 */
  readonly arrayComponentPrimitive?: boolean
  /** 自身 + 全部超类名（`fqn` 条件用；上游 `isInheritorOrSelf(..., true)` 是**含自身**的深查）。 */
  readonly inherits?: readonly string[]
  /** 语言专属布尔位（Kotlin/Python 条件读它）。 */
  readonly facts?: Readonly<Record<string, boolean>>
}

// ---------------------------------------------------------------------------
// 条件表（逐条对上游类）
// ---------------------------------------------------------------------------

const JAVA_PREFIX = 'JavaPostfixTemplateExpressionCondition$'

/**
 * Java 条件全集（7 条）。文案 `java/openapi/resources/messages/JavaBundle.properties:1787-1793`，
 * 中文取自 localization-zh 的 `messages/JavaBundle.properties`。
 * 注意 `arrayReference` 存在、能被读回、被内建模板使用
 * （`JavaPostfixTemplateProvider.java:181-183`、`AsListToListPostfixTemplate.java:19`），
 * 但**不在** Java 编辑器的动作列里（`JavaPostfixTemplateEditor.java:99-105` 没有它）——照抄这个不对称。
 */
export const JAVA_POSTFIX_CONDITIONS: readonly PostfixExpressionCondition[] = [
  { id: 'void', presentableName: 'void', presentableNameZh: 'void',
    upstream: JAVA_PREFIX + 'JavaPostfixTemplateVoidExpressionCondition' },
  { id: 'non void', presentableName: 'non void', presentableNameZh: '非 void',
    upstream: JAVA_PREFIX + 'JavaPostfixTemplateNonVoidExpressionCondition' },
  { id: 'boolean', presentableName: 'boolean', presentableNameZh: '布尔',
    upstream: JAVA_PREFIX + 'JavaPostfixTemplateBooleanExpressionCondition' },
  { id: 'number', presentableName: 'number', presentableNameZh: '数字',
    upstream: JAVA_PREFIX + 'JavaPostfixTemplateNumberExpressionCondition' },
  { id: 'notPrimitive', presentableName: 'not primitive type', presentableNameZh: '非基元类型',
    upstream: JAVA_PREFIX + 'JavaPostfixTemplateNotPrimitiveTypeExpressionCondition' },
  { id: 'array', presentableName: 'array', presentableNameZh: '数组',
    upstream: JAVA_PREFIX + 'JavaPostfixTemplateArrayExpressionCondition' },
  { id: 'arrayReference', presentableName: 'array of non-primitive types', presentableNameZh: '非基元类型数组',
    upstream: JAVA_PREFIX + 'JavaPostfixTemplateArrayReferenceExpressionCondition' },
]

/** Java 的类条件：`presentableName` 就是那个 FQN（`JavaPostfixTemplateExpressionCondition.java:46-48`）。 */
export function javaFqnCondition(fqn: string): PostfixExpressionCondition {
  return { id: 'fqn', presentableName: fqn, presentableNameZh: fqn, upstream: JAVA_PREFIX + 'JavaPostfixTemplateExpressionFqnCondition', attribute: 'fqn' }
}

/**
 * Kotlin 条件全集（6 条 + 类条件）。文案 `plugins/kotlin/code-insight/postfix-templates/resources/
 * messages/KotlinPostfixTemplatesBundle.properties:2-7`，中文取自 localization-zh。
 * `factKey` 逐条对应各 `value()` 里读的那个类型位
 * （`KotlinPostfixTemplateExpressionCondition.kt:101-103,114-117,127-130,145-148,158-161,171-174`）。
 */
export const KOTLIN_POSTFIX_CONDITIONS: readonly PostfixExpressionCondition[] = [
  { id: 'kotlin.unit', presentableName: 'Unit', presentableNameZh: '单位', factKey: 'unit',
    upstream: 'KotlinPostfixTemplateExpressionCondition$KotlinPostfixTemplateUnitExpressionCondition' },
  { id: 'kotlin.nonUnit', presentableName: 'Non-Unit', presentableNameZh: '非单元', factKey: 'nonUnit',
    upstream: 'KotlinPostfixTemplateExpressionCondition$KotlinPostfixTemplateNonUnitExpressionCondition' },
  { id: 'kotlin.boolean', presentableName: 'Boolean', presentableNameZh: '布尔', factKey: 'boolean',
    upstream: 'KotlinPostfixTemplateExpressionCondition$KotlinPostfixTemplateBooleanExpressionCondition' },
  { id: 'kotlin.number', presentableName: 'Number', presentableNameZh: '数字', factKey: 'number',
    upstream: 'KotlinPostfixTemplateExpressionCondition$KotlinPostfixTemplateNumberExpressionCondition' },
  { id: 'kotlin.nullable', presentableName: 'Nullable', presentableNameZh: '可为 null', factKey: 'nullable',
    upstream: 'KotlinPostfixTemplateExpressionCondition$KotlinPostfixTemplateNullableExpressionCondition' },
  { id: 'kotlin.notNullable', presentableName: 'Not-Nullable', presentableNameZh: '不可为 null', factKey: 'notNullable',
    upstream: 'KotlinPostfixTemplateExpressionCondition$KotlinPostfixTemplateNotNullableExpressionCondition' },
]

/** Kotlin 类条件：`presentableName` = fqn（`KotlinPostfixTemplateExpressionCondition.kt:43`）。 */
export function kotlinFqnCondition(fqn: string): PostfixExpressionCondition {
  return { id: 'kotlin.fqn', presentableName: fqn, presentableNameZh: fqn, attribute: 'fqn',
    upstream: 'KotlinPostfixTemplateExpressionCondition$KotlinPostfixTemplateExpressionFqnCondition' }
}

/**
 * Python 条件全集（10 条，= `PUBLIC_CONDITIONS`，`PyPostfixTemplateExpressionCondition.kt:240-251`）。
 * 文案 `python/pluginResources/messages/PyBundle.properties:1356-1366`，中文取自 localization-zh。
 * `builtin len applicable` 这个类存在（`:160-172`）但**不在** `PUBLIC_CONDITIONS` 里 ⇒ 不可选，照抄。
 */
export const PYTHON_POSTFIX_CONDITIONS: readonly PostfixExpressionCondition[] = [
  { id: 'boolean', presentableName: 'boolean', presentableNameZh: '布尔', factKey: 'boolean',
    upstream: 'PyPostfixTemplateExpressionCondition$PyBooleanExpression' },
  { id: 'number', presentableName: 'number', presentableNameZh: '数字', factKey: 'number',
    upstream: 'PyPostfixTemplateExpressionCondition$PyNumberExpression' },
  { id: 'string', presentableName: 'string', presentableNameZh: '字符串', factKey: 'string',
    upstream: 'PyPostfixTemplateExpressionCondition$PyStringExpression' },
  { id: 'iterable', presentableName: 'iterable', presentableNameZh: '可迭代对象', factKey: 'iterable',
    upstream: 'PyPostfixTemplateExpressionCondition$PyIterable' },
  { id: 'dict', presentableName: 'dict', presentableNameZh: 'dict', factKey: 'dict',
    upstream: 'PyPostfixTemplateExpressionCondition$PyDict' },
  { id: 'list', presentableName: 'list', presentableNameZh: '列表', factKey: 'list',
    upstream: 'PyPostfixTemplateExpressionCondition$PyList' },
  { id: 'set', presentableName: 'set', presentableNameZh: '集合', factKey: 'set',
    upstream: 'PyPostfixTemplateExpressionCondition$PySet' },
  { id: 'tuple', presentableName: 'tuple', presentableNameZh: '元组', factKey: 'tuple',
    upstream: 'PyPostfixTemplateExpressionCondition$PyTuple' },
  { id: 'non none', presentableName: 'non None', presentableNameZh: '非 None', factKey: 'nonNone',
    upstream: 'PyPostfixTemplateExpressionCondition$PyNonNoneExpression' },
  { id: 'exception', presentableName: 'exception', presentableNameZh: '异常', factKey: 'exception',
    upstream: 'PyPostfixTemplateExpressionCondition$PyExceptionExpression' },
]

/** Python 类条件：id `type`、属性 `type`、`presentableName` = 类名（`:174-175,199-202,206`）。 */
export function pythonTypeCondition(typeName: string): PostfixExpressionCondition {
  return { id: 'type', presentableName: typeName, presentableNameZh: typeName, attribute: 'type',
    upstream: 'PyPostfixTemplateExpressionCondition$PyClassCondition' }
}

/**
 * provider id。Java / Python 显式覆写了 `getId()`
 * （`JavaPostfixTemplateProvider.java:97-99` = `builtin.java`、`PyPostfixTemplateProvider.java:58-60` = `builtin.python`）；
 * Kotlin 的 `KotlinPostfixTemplateProvider.kt:30` **没有覆写** `getId()`，
 * 所以走接口默认值 `getClass().getName()`（`PostfixTemplateProvider.java:29-31`）= 类全名。
 */
export const JAVA_POSTFIX_PROVIDER_ID = 'builtin.java'
export const PYTHON_POSTFIX_PROVIDER_ID = 'builtin.python'
export const KOTLIN_POSTFIX_PROVIDER_ID = 'org.jetbrains.kotlin.idea.codeInsight.postfix.KotlinPostfixTemplateProvider'

/** 语言 → 条件全集（键是 provider id，见上面三个常量）。 */
export const POSTFIX_CONDITION_SETS: Readonly<Record<string, readonly PostfixExpressionCondition[]>> = {
  [JAVA_POSTFIX_PROVIDER_ID]: JAVA_POSTFIX_CONDITIONS,
  [KOTLIN_POSTFIX_PROVIDER_ID]: KOTLIN_POSTFIX_CONDITIONS,
  [PYTHON_POSTFIX_PROVIDER_ID]: PYTHON_POSTFIX_CONDITIONS,
}

/** 在某个语言的条件全集里按 id 查一条（类条件不在全集里，由各自工厂函数造）。 */
export function postfixConditionById(providerId: string, id: string): PostfixExpressionCondition | undefined {
  return (POSTFIX_CONDITION_SETS[providerId] ?? []).find(condition => condition.id === id)
}

// ---------------------------------------------------------------------------
// 动作列（`fillConditions` 往弹出菜单里填的东西）
// ---------------------------------------------------------------------------

/**
 * 动作列的一项。`condition` 项 = `AddConditionAction`（文案是条件的 `getPresentableName()`，
 * `PostfixTemplateEditorBase.java:45-57`）；`chooseClass`/`enterClass` 是选类/输入类名那一档。
 */
export type PostfixEditorAction =
  | { readonly kind: 'condition'; readonly presentableName: string; readonly presentableNameZh: string; readonly condition: PostfixExpressionCondition }
  | { readonly kind: 'chooseClass'; readonly presentableName: string; readonly presentableNameZh: string }
  | { readonly kind: 'enterClass'; readonly presentableName: string; readonly presentableNameZh: string }

const conditionAction = (condition: PostfixExpressionCondition): PostfixEditorAction =>
  ({ kind: 'condition', presentableName: condition.presentableName, presentableNameZh: condition.presentableNameZh, condition })

/**
 * Java 动作列（`JavaPostfixTemplateEditor.java:99-111`）：
 * 固定 6 条（void / non void / boolean / number / not primitive type / array，
 * **没有 arrayReference**）→ 每个打开的项目一条 `choose class in {项目名}…`
 * （`:126`，文案 `JavaBundle.properties:23`）→ 最后一条 `enter class name…`（`:25`）。
 */
export function javaEditorActions(projectNames: readonly string[] = []): readonly PostfixEditorAction[] {
  const fixed = JAVA_POSTFIX_CONDITIONS.filter(condition => condition.id !== 'arrayReference').map(conditionAction)
  const choose = projectNames.map(name => ({
    kind: 'chooseClass' as const, presentableName: `choose class in ${name}\u2026`, presentableNameZh: `选择 ${name} 中的类\u2026`,
  }))
  return [...fixed, ...choose, { kind: 'enterClass', presentableName: 'enter class name\u2026', presentableNameZh: '输入类名\u2026' }]
}

/**
 * Kotlin 动作列（`KotlinPostfixTemplateEditor.kt:35-46`）：6 条固定条件 →
 * 每个项目一条 `Choose Class in {项目名}`（`:50`）→ 一条 `Enter Class Name…`（`:52`）。
 */
export function kotlinEditorActions(projectNames: readonly string[] = []): readonly PostfixEditorAction[] {
  const fixed = KOTLIN_POSTFIX_CONDITIONS.map(conditionAction)
  const choose = projectNames.map(name => ({
    kind: 'chooseClass' as const, presentableName: `Choose Class in ${name}`, presentableNameZh: `选择 ${name} 中的类`,
  }))
  return [...fixed, ...choose, { kind: 'enterClass', presentableName: 'Enter Class Name\u2026', presentableNameZh: '输入类名…' }]
}

/**
 * Python 动作列（`PyPostfixTemplateEditor.kt:33-42`）：`PUBLIC_CONDITIONS` 全部 10 条 →
 * （有打开的项目时）一条 `Choose Class…`（`:56`）→ 一条 `Enter Class Name…`（`:137`）。
 * 与 Java/Kotlin 不同：Python 的选类是**一个**动作（内部遍历所有项目），不是每项目一条。
 */
export function pythonEditorActions(projectNames: readonly string[] = []): readonly PostfixEditorAction[] {
  const fixed = PYTHON_POSTFIX_CONDITIONS.map(conditionAction)
  const choose = projectNames.length
    ? [{ kind: 'chooseClass' as const, presentableName: 'Choose Class\u2026', presentableNameZh: '选择类…' }] : []
  return [...fixed, ...choose, { kind: 'enterClass', presentableName: 'Enter Class Name\u2026', presentableNameZh: '输入类名…' }]
}

// ---------------------------------------------------------------------------
// 序列化：`<conditions><condition id="…"/></conditions>` + `topmost` 属性
// ---------------------------------------------------------------------------

/** 一条 `<condition>`：只有 id，类条件多一个属性（`JavaPostfixTemplateExpressionCondition.java:64-67`）。 */
export interface PostfixConditionElement {
  readonly id: string
  readonly fqn?: string
  readonly type?: string
}

/** 上游写出去的一份模板状态（`PostfixTemplatesUtils.java:138-159`）。 */
export interface PostfixTemplateState {
  /** `topmost` 属性；`writeExternalTemplate` 一定写它（`:140`）。 */
  readonly topmost: boolean
  readonly conditions: readonly PostfixConditionElement[]
}

/** 条件 → `<condition>`（`:148-152`：逐个 `serializeTo`）。 */
export function writeConditionElement(condition: PostfixExpressionCondition): PostfixConditionElement {
  if (condition.attribute === 'fqn') return { id: condition.id, fqn: condition.presentableName }
  if (condition.attribute === 'type') return { id: condition.id, type: condition.presentableName }
  return { id: condition.id }
}

export function writeConditions(conditions: readonly PostfixExpressionCondition[]): readonly PostfixConditionElement[] {
  return conditions.map(writeConditionElement)
}

export function writeTemplateState(conditions: readonly PostfixExpressionCondition[], topmost: boolean): PostfixTemplateState {
  return { topmost, conditions: writeConditions(conditions) }
}

/**
 * `<condition>` → 条件。读不出来就返回 `null`（上游工厂返回 null 后被 `addIfNotNull` 丢掉，
 * `PostfixTemplatesUtils.java:167-170`）：未知 id、或类条件的属性缺失/为空
 * （`JavaPostfixTemplateProvider.java:199-204` 的 `StringUtil.isNotEmpty(fqn)`、
 * `PyPostfixTemplateExpressionCondition.kt:207-210` 的 `value != null`）。
 */
export function readConditionElement(providerId: string, element: PostfixConditionElement): PostfixExpressionCondition | null {
  const known = postfixConditionById(providerId, element.id)
  if (known) return known
  if (element.id === 'fqn' && providerId === JAVA_POSTFIX_PROVIDER_ID) return element.fqn ? javaFqnCondition(element.fqn) : null
  if (element.id === 'kotlin.fqn' && providerId === KOTLIN_POSTFIX_PROVIDER_ID) return element.fqn ? kotlinFqnCondition(element.fqn) : null
  if (element.id === 'type' && providerId === PYTHON_POSTFIX_PROVIDER_ID) return element.type ? pythonTypeCondition(element.type) : null
  return null
}

export function readConditions(providerId: string, elements: readonly PostfixConditionElement[]): readonly PostfixExpressionCondition[] {
  const result: PostfixExpressionCondition[] = []
  for (const element of elements) {
    const condition = readConditionElement(providerId, element)
    if (condition) result.push(condition)
  }
  return result
}

/** 读一份模板状态。`topmost` 走 `Boolean.parseBoolean`（`:187-189`）：缺属性 = false。 */
export function readTemplateState(providerId: string, state: { readonly topmost?: boolean | string; readonly conditions?: readonly PostfixConditionElement[] }): { topmost: boolean; conditions: readonly PostfixExpressionCondition[] } {
  const topmost = typeof state.topmost === 'string' ? state.topmost.toLowerCase() === 'true' : state.topmost === true
  return { topmost, conditions: readConditions(providerId, state.conditions ?? []) }
}

// ---------------------------------------------------------------------------
// 求值
// ---------------------------------------------------------------------------

/** 类型文本相等（上游 `PsiTypes.xType().equals(type)` / `equalsToText` 的等价物，逐字面量比）。 */
const typeIs = (facts: PostfixReceiverFacts, text: string): boolean => facts.typeText === text
const factIs = (facts: PostfixReceiverFacts, key: string): boolean => facts.facts?.[key] === true

/**
 * 单条条件的求值。Java 走本模块的判据（`JavaPostfixTemplatesUtils.java:147-206`），
 * 其余语言走 `factKey`（宿主喂的布尔位）。
 *
 * Java 判据逐条：
 *   · `void`（`JavaPostfixTemplateExpressionCondition.java:74-77`）`type == void`；
 *   · `non void`（`:106-108` → `JavaPostfixTemplatesUtils.java:183-185`）`type != null && != void`；
 *   · `boolean`（`:136-138` → `:178-181`）基元 `boolean` 或 `java.lang.Boolean`；
 *   · `number`（`:166-168` → `:188-200`）基元 `int`/`byte`/`long` 或 `Integer`/`Long`/`Byte`
 *     —— **不含** double/float/short/char，这是上游的原样口径；
 *   · `notPrimitive`（`:196-198` → `:147-155`）`type != null && 非基元`；
 *   · `array`（`:226-228` → `:168-170`）数组；
 *   · `arrayReference`（`:256-258` → `:173-175`）数组且元素非基元；
 *   · `fqn`（`:35-38` → `InheritanceUtil.java:68-99`）自身或某个超类名等于该 FQN。
 */
export function evaluateCondition(condition: PostfixExpressionCondition, facts: PostfixReceiverFacts): boolean {
  if (condition.factKey) return factIs(facts, condition.factKey)
  switch (condition.id) {
    case 'void': return typeIs(facts, 'void')
    case 'non void': return facts.typeText !== undefined && !typeIs(facts, 'void')
    case 'boolean': return typeIs(facts, 'boolean') || typeIs(facts, 'java.lang.Boolean')
    case 'number':
      return typeIs(facts, 'int') || typeIs(facts, 'byte') || typeIs(facts, 'long')
        || typeIs(facts, 'java.lang.Integer') || typeIs(facts, 'java.lang.Long') || typeIs(facts, 'java.lang.Byte')
    case 'notPrimitive': return facts.typeText !== undefined && facts.primitive !== true
    case 'array': return facts.array === true
    case 'arrayReference': return facts.array === true && facts.arrayComponentPrimitive !== true
    case 'fqn': return (facts.inherits ?? []).includes(condition.presentableName)
    default: return false
  }
}

/**
 * 复合条件（`EditablePostfixTemplateWithMultipleExpressions.java:89-99`）：**逐条 OR**；
 * 集合为空时返回 **true**（`:97` —— 没配条件 = 处处适用）。
 */
export function compositeCondition(conditions: readonly PostfixExpressionCondition[], facts: PostfixReceiverFacts): boolean {
  if (!conditions.length) return true
  return conditions.some(condition => evaluateCondition(condition, facts))
}

// ---------------------------------------------------------------------------
// 可用性：`isApplicable` = 过滤后还有表达式
// ---------------------------------------------------------------------------

/** 一个候选接收者。`endOffset` 对应上游 `getTextRange().getEndOffset() == offset` 那条判据。 */
export interface PostfixExpressionCandidate {
  readonly text: string
  readonly endOffset: number
  readonly facts: PostfixReceiverFacts
  /** 上游 `PSI_ERROR_FILTER`（`JavaEditablePostfixTemplate.java:35`）：有错误元素的不算候选。 */
  readonly hasError?: boolean
}

export interface PostfixApplicabilityContext {
  /** 键之前的偏移（`isApplicable(context, copyDocument, newOffset)` 的 `newOffset`）。 */
  readonly offset: number
  readonly candidates: readonly PostfixExpressionCandidate[]
  /** `DumbService.isUsableInCurrentContext`（`JavaEditablePostfixTemplate.java:82`）；缺省 = 可用。 */
  readonly dumbUsable?: boolean
  /** `PsiUtil.getLanguageLevel(context).isAtLeast(minimum)`（`:83-85`）；缺省 = 满足。 */
  readonly languageLevelOk?: boolean
}

/**
 * 取适用表达式（`JavaEditablePostfixTemplate.java:80-99` 的顺序）：
 * ① dumb 不可用 → 空；② 语言级别不够 → 空；③ 去掉有错误的；
 * ④ 末尾偏移必须等于 `offset`；⑤ 过复合条件。Kotlin/Python 的 `getExpressions` 是同一形状
 * （`KotlinEditablePostfixTemplate.kt:102-105`、`PyEditablePostfixTemplate.kt:37-38`）。
 */
export function selectExpressions(conditions: readonly PostfixExpressionCondition[], context: PostfixApplicabilityContext): readonly PostfixExpressionCandidate[] {
  if (context.dumbUsable === false || context.languageLevelOk === false) return []
  return context.candidates.filter(candidate =>
    candidate.hasError !== true && candidate.endOffset === context.offset && compositeCondition(conditions, candidate.facts))
}

/** `EditablePostfixTemplate.java:117-120`：`isApplicable` = 取到的表达式非空。 */
export function isApplicable(conditions: readonly PostfixExpressionCondition[], context: PostfixApplicabilityContext): boolean {
  return selectExpressions(conditions, context).length > 0
}

/** 展开取不到表达式时的收场：弹那句提示（`EditablePostfixTemplate.java:72-75` → `PostfixTemplatesUtils.java:113-116`）。 */
export function expandOutcome(conditions: readonly PostfixExpressionCondition[], context: PostfixApplicabilityContext): { readonly ok: boolean; readonly errorHint: string } {
  const expressions = selectExpressions(conditions, context)
  return expressions.length ? { ok: true, errorHint: '' } : { ok: false, errorHint: POSTFIX_ERROR_HINT }
}

// ---------------------------------------------------------------------------
// 例子（设置页 Before / After）
// ---------------------------------------------------------------------------

/** `EditablePostfixTemplateMetaData.java:30`：`<spot>$EXPR$</spot>` + 模板键（键含前导点）。 */
export function postfixExampleBefore(templateKey: string): string {
  return `<${POSTFIX_SPOT_TAG}>${POSTFIX_EXPR_TOKEN}</${POSTFIX_SPOT_TAG}>${templateKey}`
}

/**
 * `EditablePostfixTemplateMetaData.java:31`：正文里的 `$END$` 换成 `<spot/>`
 * （`StringUtil.replace(text, END, spot, true)` 是**忽略大小写、替换全部**；
 * `<spot/>` 的写法来自 `HtmlChunk.Element.appendTo` 对空子节点输出 `/>`）。
 */
export function postfixExampleAfter(body: string): string {
  return body.replace(/\$END\$/gi, `<${POSTFIX_SPOT_TAG}/>`)
}

/** 设置页描述：可编辑且非内建才用这一份（`PostfixTemplateMetaData.java:33-34`）。 */
export function editablePostfixDescription(zh: boolean): string {
  return zh ? EDITABLE_POSTFIX_DESCRIPTION_ZH : EDITABLE_POSTFIX_DESCRIPTION_EN
}