// 实时模板宏的**注册对账门**：本仓那张表必须与上游 `com.intellij.liveTemplateMacro` 的注册清单一一对上。
//
// 为什么要有这一条：`src/templateMacros.ts` 的判据是「上游没读到的宏一律不实现、不渲染」，
// 而这句话光写在注释里防不住两件事 ——
//   · 有人（或下一批代理）往表里塞一条上游根本没有的宏，界面上就真的会出现它；
//   · 有人把上游注册过的宏**悄悄地不做**，清单既不实现也不登记，用户无从知道那一格为什么不动。
// 所以这里把两边都钉住：实现侧 21 条 + 登记侧 12 条 = 上游那 33 条，多一条红、少一条也红。
//
// 33 条的出处（逐条抄自 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1031-1063`，
// 顺序照 XML；T4 在参考树在位时再把这份抄写和文件本身核一遍）：
//   · 名字 = 各宏的 `getName()`：`MacroBase` 系走构造器第一个参数（`MacroBase.java:37-39` + 各子类构造器），
//     `SimpleMacro` 系同（`SimpleMacro.java:22-24`，`CurrentDateMacro.java:19`、`CurrentTimeMacro.java:11`、
//     `CurrentUserMacro.java:12`、`ClipboardMacro.java:15`、`CompleteMacro.java:27`、`CompleteSmartMacro.java:12`），
//     自己覆写的直接抄 return（`FilePathMacroBase.java:42/:54/:66/:78`、`EnumMacro.java:32-34`、
//     `ShowParameterInfoMacro.java:25-27`、`LineNumberMacro.java:17`、`CommentMacro.java:40/:46/:52/:58/:67`）。
//   · 下拉文案 = `getPresentableName()`：默认实现是「名字 + ()」（`Macro.java:26-28`，date/time/fileName 系就是它），
//     其余是构造器第二个参数（`MacroBase.java:42-44`）：字面量的直接抄，
//     `CodeInsightBundle.message(...)` 的抄 `platform/lang-api/resources/messages/CodeInsightBundle.properties:178-185`
//     的那八行值（`enum(...)` 是同一段的 `macro.enum`）。
//   · 空结果 marker = `getDefaultValue()`：`MacroBase.java:47-49` 的 `"a"`、`SimpleMacro.java:27-29` 的
//     `"11.11.1111"`、`Macro.java:30-32` 的 `""`（`FilePathMacroBase` 与 `EnumMacro` 都没覆写，实查为空）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFERRED_TEMPLATE_MACROS, LIVE_TEMPLATE_MACROS, templateMacroByName } from '../src/templateMacros.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const REGISTRY_XML = 'platform/lang-impl/resources/intellij.platform.lang.impl.xml'
const PKG = 'com.intellij.codeInsight.template.macro.'

/** 上游 33 条注册里**本仓已实现**的那 21 条：`impl` 是 XML 里的实现类名（去包名），后面三项是用户可见的那份文案。 */
const UPSTREAM_IMPLEMENTED = [
  { impl: 'CurrentDateMacro', name: 'date', presentableName: 'date()', defaultValue: '11.11.1111' },
  { impl: 'CurrentTimeMacro', name: 'time', presentableName: 'time()', defaultValue: '11.11.1111' },
  { impl: 'CapitalizeMacro', name: 'capitalize', presentableName: 'capitalize(String)', defaultValue: 'a' },
  { impl: 'DecapitalizeMacro', name: 'decapitalize', presentableName: 'decapitalize(String)', defaultValue: 'a' },
  { impl: 'FirstWordMacro', name: 'firstWord', presentableName: 'firstWord(String)', defaultValue: 'a' },
  { impl: 'EscapeStringMacro', name: 'escapeString', presentableName: 'escapeString(String)', defaultValue: 'a' },
  { impl: 'ReplaceUnderscoresWithSpacesMacro', name: 'underscoresToSpaces', presentableName: 'underscoresToSpaces(String)', defaultValue: 'a' },
  { impl: 'ReplaceSpacesWithUnderscoresMacro', name: 'spacesToUnderscores', presentableName: 'spacesToUnderscores(String)', defaultValue: 'a' },
  { impl: 'FilePathMacroBase$FileNameMacro', name: 'fileName', presentableName: 'fileName()', defaultValue: '' },
  { impl: 'FilePathMacroBase$FileNameWithoutExtensionMacro', name: 'fileNameWithoutExtension', presentableName: 'fileNameWithoutExtension()', defaultValue: '' },
  { impl: 'FilePathMacroBase$FilePathMacro', name: 'filePath', presentableName: 'filePath()', defaultValue: '' },
  { impl: 'ConvertToCamelCaseMacro$ReplaceUnderscoresToCamelCaseMacro', name: 'underscoresToCamelCase', presentableName: 'underscoresToCamelCase(String)', defaultValue: 'a' },
  { impl: 'ConvertToCamelCaseMacro', name: 'camelCase', presentableName: 'camelCase(String)', defaultValue: 'a' },
  { impl: 'CapitalizeAndUnderscoreMacro', name: 'capitalizeAndUnderscore', presentableName: 'capitalizeAndUnderscore(String)', defaultValue: 'a' },
  { impl: 'SplitWordsMacro$SnakeCaseMacro', name: 'snakeCase', presentableName: 'snakeCase(String)', defaultValue: 'a' },
  { impl: 'SplitWordsMacro$LowercaseAndDash', name: 'lowercaseAndDash', presentableName: 'lowercaseAndDash(String)', defaultValue: 'a' },
  { impl: 'SplitWordsMacro$SpaceSeparated', name: 'spaceSeparated', presentableName: 'spaceSeparated(String)', defaultValue: 'a' },
  { impl: 'ConcatMacro', name: 'concat', presentableName: 'concat(expressions...)', defaultValue: 'a' },
  { impl: 'SubstringBeforeMacro', name: 'substringBefore', presentableName: 'substringBefore(String, Delimiter)', defaultValue: 'a' },
  { impl: 'RegExMacro', name: 'regularExpression', presentableName: 'regularExpression(String, Pattern, Replacement)', defaultValue: 'a' },
  { impl: 'EnumMacro', name: 'enum', presentableName: 'enum(...)', defaultValue: '' },
]

/** 上游注册了、本仓**没有**求值原料的那 12 条：只要求名字对上，落点与理由在 `DEFERRED_TEMPLATE_MACROS` 里。 */
const UPSTREAM_UNIMPLEMENTED = [
  { impl: 'CurrentUserMacro', name: 'user' },
  { impl: 'ClipboardMacro', name: 'clipboard' },
  { impl: 'LineNumberMacro', name: 'lineNumber' },
  { impl: 'FilePathMacroBase$FileRelativePathMacro', name: 'fileRelativePath' },
  { impl: 'CompleteMacro', name: 'complete' },
  { impl: 'ShowParameterInfoMacro', name: 'showParameterInfo' },
  { impl: 'CompleteSmartMacro', name: 'completeSmart' },
  { impl: 'CommentMacro$LineCommentStart', name: 'lineCommentStart' },
  { impl: 'CommentMacro$BlockCommentStart', name: 'blockCommentStart' },
  { impl: 'CommentMacro$BlockCommentEnd', name: 'blockCommentEnd' },
  { impl: 'CommentMacro$AnyCommentStart', name: 'commentStart' },
  { impl: 'CommentMacro$AnyCommentEnd', name: 'commentEnd' },
]


test('宏表与登记清单合起来正好是上游那 33 条注册，一条不多一条不少', () => {
  assert.equal(LIVE_TEMPLATE_MACROS.length, 21, '实现侧条数')
  assert.equal(DEFERRED_TEMPLATE_MACROS.length, 12, '登记侧条数')
  const table = LIVE_TEMPLATE_MACROS.map(macro => macro.upstream).sort()
  const deferred = DEFERRED_TEMPLATE_MACROS.map(macro => macro.upstream).sort()
  const expected = UPSTREAM_IMPLEMENTED.concat(UPSTREAM_UNIMPLEMENTED).map(entry => entry.impl).sort()
  assert.deepEqual(table.concat(deferred).sort(), expected, '两边并起来必须等于 XML 里那 33 条')
  assert.deepEqual(table.filter(name => deferred.includes(name)), [], '同一条宏不许既实现又登记')
  assert.equal(new Set(table.concat(deferred)).size, 33, '33 条里不许有重复类名')
})

test('本仓没有实现上游没注册的宏；名字、下拉文案与空结果 marker 都是上游那一份', () => {
  const registered = new Set(UPSTREAM_IMPLEMENTED.concat(UPSTREAM_UNIMPLEMENTED).map(entry => entry.impl).sort())
  for (const macro of LIVE_TEMPLATE_MACROS) {
    assert.ok(registered.has(macro.upstream), `上游没有注册过 ${macro.upstream}，表里不许有它`)
  }
  for (const expected of UPSTREAM_IMPLEMENTED) {
    const found = LIVE_TEMPLATE_MACROS.find(macro => macro.upstream === expected.impl)
    assert.ok(found, `上游注册的 ${expected.impl} 既没实现也没登记在实现侧`)
    assert.equal(found.name, expected.name, `${expected.impl} 的 getName()`)
    assert.equal(found.presentableName, expected.presentableName, `${expected.impl} 的 getPresentableName()`)
    assert.equal(found.defaultValue, expected.defaultValue, `${expected.impl} 的 getDefaultValue()`)
    assert.equal(templateMacroByName(expected.name), found, `${expected.name} 查表要命中的就是这条`)
  }
})

test('登记侧的 12 条：有名字、有具体理由、且真的没被实现', () => {
  for (const expected of UPSTREAM_UNIMPLEMENTED) {
    const found = DEFERRED_TEMPLATE_MACROS.find(macro => macro.upstream === expected.impl)
    assert.ok(found, `${expected.impl} 应当登记在 DEFERRED_TEMPLATE_MACROS 里`)
    assert.equal(found.name, expected.name, `${expected.impl} 的 getName()`)
    assert.ok(found.reason.length >= 10, `${expected.name} 的理由必须是具体的一句话，不是「待定」`)
    assert.equal(templateMacroByName(found.name), undefined,
      `${found.name} 登记为「接不上」，宏表里就不许有它（否则界面上的清单和求值会两套口径）`)
  }
})

test('设置页里的宏清单 = 上游 Expression 下拉那份（去重 + 排序），不含登记侧的 12 条', () => {
  // EditVariableDialog.java:103-111：全量宏 → 按上下文过滤 → getPresentableName() → sorted() → 去重。
  // 本仓没有上下文表（isAcceptableInContext 的默认档恒为 true，Macro.java:44-46），于是只剩后三步。
  const derived = [...new Set(LIVE_TEMPLATE_MACROS.map(macro => macro.presentableName))].sort()
  assert.deepEqual(derived, UPSTREAM_IMPLEMENTED.map(entry => entry.presentableName).sort())
  const deferredNames = new Set(UPSTREAM_UNIMPLEMENTED.map(entry => entry.name))
  assert.deepEqual(derived.filter(text => deferredNames.has(text.split('(')[0])), [],
    '登记侧的宏不许出现在下拉文案里（没有后端就不要渲染）')
})

test('参考树在位时：抄写的 33 条与 XML 里的注册逐字相同', () => {
  const file = join(REF, REGISTRY_XML)
  if (!existsSync(file)) return
  const lines = readFileSync(file, 'utf8').split('\n')
  // 只取那一段区间（1031-1063 是 1 起的行号），别把整份 XML 里别处的同名 token 算进来。
  const block = lines.slice(1030, 1063)
  const found = []
  for (const line of block) {
    const match = /<liveTemplateMacro implementation="([^"]+)"\/>/.exec(line)
    if (match) found.push(match[1].slice(PKG.length))
  }
  assert.equal(found.length, 33, `那 33 行里应当有 33 条注册，实得 ${found.length}`)
  assert.deepEqual(found.sort(), UPSTREAM_IMPLEMENTED.concat(UPSTREAM_UNIMPLEMENTED).map(entry => entry.impl).sort())
})

test('消费链路：宏真的进展开、设置页真的读同一张表', () => {
  const templates = readFileSync(join(root, 'src', 'templates.ts'), 'utf8')
  const page = readFileSync(join(root, 'src', 'components', 'TemplateSettingsPage.vue'), 'utf8')
  assert.match(templates, /from '\.\/templateMacros\.ts'/, 'render 没引宏表 ⇒ 宏只是注释')
  assert.match(templates, /resolveTemplateSlotValues\(slots, vars, context\)/, '槽位没交给宏表求值')
  assert.match(templates, /const macroContext: TemplateMacroContext = \{ path \}/, 'expand 没把文件路径传给宏')
  // 正文词法只许有一份：`render()` 用的那份必须可复用，设置页读的就是它。
  // （上游那份是 TemplateTextLexer.flex 的 VARIABLE / ESCAPE_DOLLAR 两个 token。）
  assert.match(templates, /export const TEMPLATE_TEXT_TOKEN = /, '槽位词法没有可复用的导出源')
  assert.match(page, /TEMPLATE_TEXT_TOKEN/, '设置页的槽位预览不是引擎那份词法')
  assert.doesNotMatch(page, /const VARIABLE =/, '设置页不许再留第二份槽位词法（预览与展开会两套口径）')
  assert.match(page, /from '\.\.\/templateMacros\.ts'/)
  assert.match(page, /LIVE_TEMPLATE_MACROS[\s\S]{0,200}presentableName/, '设置页渲染的清单不是宏表本身')
  assert.match(page, /unknownMacroCall/, '看着像宏调用但没注册的那一格要提示用户')
  assert.ok(!page.includes('DEFERRED_TEMPLATE_MACROS as ') && !/import \{[^}]*DEFERRED_TEMPLATE_MACROS/.test(page),
    '登记侧的 12 条不许被渲染成可用宏')
})
