// IDEA-style live templates: a keyword (`sout`) or a `receiver.postfix` (`list.for`)
// that expands into a snippet with editable slots. Deliberately free of CodeMirror so
// the expansion rules are testable on their own (tests/templates.test.mjs).
//
// 槽位默认值那一段里**以已注册宏名开头**的写法是宏调用，求值在 src/templateMacros.ts
// （上游 `com.intellij.codeInsight.template.Macro` 那一族；判据、参数与回退口径都在那边）。
// 本模块只做「哪一段是宏」的取数，不重复实现宏。
import { resolveTemplateSlotValues, type TemplateMacroContext, type TemplateSlotDefinition } from './templateMacros.ts'

export type Language = 'java' | 'cpp' | 'typescript' | 'other'

export interface Template {
  key: string
  body: string
  description: string
  languages: string[]     // empty = available everywhere
  postfix?: boolean       // expands `receiver.key` instead of a bare keyword
}

export interface TemplateOverride { pattern: string; disabled: boolean }
export type CustomTemplate = Omit<Template, 'postfix'>
export interface TemplateSettings { overrides: TemplateOverride[]; customs: CustomTemplate[] }
export const defaultTemplateSettings: TemplateSettings = { overrides: [], customs: [] }

const languageNames = ['java', 'cpp', 'typescript', 'other'] as const

export function templatePattern(template: Template): string {
  return `${template.postfix ? 'postfix:' : ''}${template.key}:${languageNames.filter(language => template.languages.includes(language)).join(',')}`
}

export function customPattern(template: CustomTemplate): string {
  return `custom:${template.key}`
}

export interface Stop { start: number; end: number }   // offsets inside `text`
export interface Expansion {
  start: number     // line-local offset where the trigger begins
  end: number       // line-local offset of the caret
  text: string
  stops: Stop[]
  caret: number     // offset inside `text` when the template has no slots
}

export function languageFor(path: string): Language {
  if (/\.java$/i.test(path)) return 'java'
  if (/\.(cpp|cc|c|h|hpp|cxx)$/i.test(path)) return 'cpp'
  if (/\.(ts|tsx|js|jsx|mjs)$/i.test(path)) return 'typescript'
  return 'other'
}

// Continuation lines are written with their own relative indent in the bodies below;
// render() shifts them by the indent of the line being expanded. Two templates may
// share a key as long as their language lists are disjoint (`main` for Java and C++).
export const templates: Template[] = [
  { key: 'sout', languages: ['java'], description: '打印到控制台', body: 'System.out.println($END$);' },
  { key: 'main', languages: ['java'], description: 'main 方法', body: 'public static void main(String[] args) {\n  $END$\n}' },
  { key: 'fori', languages: ['java'], description: '索引 for 循环', body: 'for (int index = 0; index < $LIMIT:10$; index++) {\n  $END$\n}' },
  { key: 'foreach', languages: ['java', 'cpp'], description: '遍历集合', body: 'for ($TYPE$ $ITEM:item$ : $COLLECTION$) {\n  $END$\n}' },
  { key: 'ifelse', languages: ['java', 'cpp', 'typescript'], description: 'if / else', body: 'if ($CONDITION$) {\n  $END$\n} else {\n}' },
  { key: 'try', languages: ['java'], description: 'try / catch', body: 'try {\n  $END$\n} catch ($TYPE:Exception$ $NAME:e$) {\n}' },
  { key: 'todo', languages: ['java', 'cpp', 'typescript'], description: 'TODO 注释', body: '// TODO: $TEXT:待补充$' },
  { key: 'inc', languages: ['cpp'], description: '#include 头文件', body: '#include <$HEADER:vector$>' },
  { key: 'main', languages: ['cpp'], description: 'main 函数', body: 'int main(int argc, char** argv) {\n  $END$\n  return 0;\n}' },
  { key: 'fori', languages: ['cpp'], description: '索引 for 循环', body: 'for (int index = 0; index < $LIMIT:10$; ++index) {\n  $END$\n}' },
  { key: 'class', languages: ['cpp'], description: '类声明', body: 'class $NAME:Thing$ {\npublic:\n  $END$\n};' },
  { key: 'log', languages: ['typescript'], description: 'console.log', body: 'console.log($END$);' },
  { key: 'fn', languages: ['typescript'], description: '箭头函数常量', body: 'const $NAME:handler$ = ($ARGS$) => {\n  $END$\n};' },
  { key: 'interface', languages: ['typescript'], description: '接口声明', body: 'interface $NAME:Shape$ {\n  $END$\n}' },
]

// Postfix templates. `$EXPR$` becomes the receiver and is left as fixed text; the
// remaining markers are the slots IDEA lets you tab through.
export const postfixTemplates: Template[] = [
  { key: 'var', languages: ['java'], description: '赋值给新变量', body: '$TYPE:var$ $NAME:value$ = $EXPR$;$END$', postfix: true },
  { key: 'val', languages: ['java'], description: '赋值给 final 变量', body: 'final $TYPE:var$ $NAME:value$ = $EXPR$;$END$', postfix: true },
  { key: 'var', languages: ['cpp'], description: '赋值给新变量', body: 'auto $NAME:value$ = $EXPR$;$END$', postfix: true },
  { key: 'var', languages: ['typescript'], description: 'const 赋值', body: 'const $NAME:value$ = $EXPR$;$END$', postfix: true },
  { key: 'if', languages: [], description: '包裹 if', body: 'if ($EXPR$) {\n  $END$\n}', postfix: true },
  { key: 'not', languages: [], description: '包裹取反 if', body: 'if (!$EXPR$) {\n  $END$\n}', postfix: true },
  { key: 'return', languages: [], description: '作为返回值', body: 'return $EXPR$;$END$', postfix: true },
  { key: 'nn', languages: ['java', 'cpp'], description: '非空则执行', body: 'if ($EXPR$ != null) {\n  $END$\n}', postfix: true },
  { key: 'null', languages: ['java', 'cpp'], description: '为空则执行', body: 'if ($EXPR$ == null) {\n  $END$\n}', postfix: true },
  { key: 'for', languages: ['java', 'cpp'], description: '遍历接收者', body: 'for ($TYPE$ $ITEM:item$ : $EXPR$) {\n  $END$\n}', postfix: true },
  { key: 'sout', languages: ['java'], description: '打印接收者', body: 'System.out.println($EXPR$);$END$', postfix: true },
  { key: 'await', languages: ['typescript'], description: '等待接收者', body: 'await $EXPR$$END$', postfix: true },
  { key: 'map', languages: ['typescript'], description: 'map 接收者', body: 'const $NAME:mapped$ = $EXPR$.map(($ITEM:item$) => $END$);', postfix: true },
  { key: 'try', languages: ['java', 'cpp', 'typescript'], description: '包裹 try/catch', body: 'try {\n  $EXPR$;\n} catch ($TYPE:Exception$ $NAME:e$) {\n  $END$\n}', postfix: true },
]

const allTemplates = [...templates, ...postfixTemplates]

interface EffectiveTemplate { template: Template; pattern: string }

/**
 * 插件贡献的实时模板 —— 形状与 `CustomTemplate` 一致（`plugin.json` 的 `contributes.templates`），
 * 所以直接传 `PluginInfo[]` 就行。字段都是可选的，测试里可以只给 `{ id, templates }`。
 */
export interface PluginTemplateSource {
  id: string
  /** 只有**启用的**插件贡献模板（IDEA 只加载启用的插件）；缺省视为启用。 */
  enabled?: boolean
  /** 清单读不出来的插件不贡献任何东西。 */
  error?: string
  templates: readonly CustomTemplate[]
}

/** 插件模板的 pattern：`plugin:<插件 id>:<key>` —— 与用户自定义模板分开，避免混进设置页那张表。 */
export function pluginTemplatePattern(id: string, template: CustomTemplate): string {
  return `plugin:${id}:${template.key}`
}

export function effectiveTemplates(
  path: string,
  settings: TemplateSettings,
  plugins: readonly PluginTemplateSource[] = [],
): EffectiveTemplate[] {
  const language = languageFor(path)
  const usable = (languages: string[]) => languages.length === 0 || languages.includes(language)
  const disabled = new Set(settings.overrides.filter(entry => entry.disabled).map(entry => entry.pattern))
  const customs = settings.customs.filter(custom => usable(custom.languages) && !disabled.has(customPattern(custom)))
    .map(custom => ({ template: custom, pattern: customPattern(custom) }))
  // 插件模板：与自定义模板同形（一个 key 一个 body），也参与"遮蔽同 key 的内建模板"，
  // 但排在最前面的是**用户自己的**模板 —— 用户能盖掉插件（IDEA 里用户模板优先级最高）。
  const contributed = plugins
    .filter(plugin => plugin.enabled !== false && !plugin.error)
    .flatMap(plugin => plugin.templates
      .filter(template => usable(template.languages))
      .map(template => ({ template, pattern: pluginTemplatePattern(plugin.id, template) })))
  const shadowed = new Set([...customs.map(entry => entry.template.key), ...contributed.map(entry => entry.template.key)])
  const builtins = allTemplates.filter(template => (template.postfix || !shadowed.has(template.key)) && usable(template.languages))
    .map(template => ({ template, pattern: templatePattern(template) }))
  return [...builtins, ...customs, ...contributed].filter(entry => !disabled.has(entry.pattern))
}

export function availableTemplates(
  path: string,
  settings: TemplateSettings = defaultTemplateSettings,
  plugins: readonly PluginTemplateSource[] = [],
): Template[] {
  return effectiveTemplates(path, settings, plugins).map(entry => entry.template)
}

function indentOf(line: string) {
  return /^ */.exec(line)![0]
}

// 槽位词法（本仓的既有契约，`$NAME$` / `$NAME:默认值$` / `$END$` / `$EXPR$`）。
// 宏只活在「默认值那一段」里，识别与求值都在 src/templateMacros.ts。
const pattern = /\$(END|EXPR|[A-Za-z_][A-Za-z0-9_]*)(?::([^$]*))?\$/g

// Re-indent continuation lines and replace `$NAME$` / `$NAME:默认值$` / `$END$`.
// `context` 只给宏用（文件路径与时间源）；不传也照常展开，文件类宏那时取不到路径就是空串。
export function render(body: string, indent: string, vars: Record<string, string>, context: TemplateMacroContext = { path: '' }) {
  const shifted = body.split('\n').map((part, index) => {
    if (index === 0) return part
    return part.length ? indent + part : part
  }).join('\n')
  const stops: Stop[] = []
  const matches = [...shifted.matchAll(pattern)]
  // 上游的取值顺序在这里保持：`vars`（预定义变量表）先命中就不算宏
  // （`TemplateStateBase.java:79-84`），剩下的槽位才交给宏表做定形迭代。
  const slots: TemplateSlotDefinition[] = []
  for (const match of matches) {
    const name = match[1]!
    if (name === 'END' || Object.prototype.hasOwnProperty.call(vars, name)) continue
    slots.push({ name, rawDefault: match[2] ?? '' })
  }
  const values = resolveTemplateSlotValues(slots, vars, context)
  let text = ''
  let end = -1
  let cursor = 0
  for (const match of matches) {
    text += shifted.slice(cursor, match.index)
    cursor = (match.index ?? 0) + match[0].length
    const name = match[1]!
    if (name === 'END') { end = text.length; continue }
    const known = Object.prototype.hasOwnProperty.call(vars, name)
    if (known) { text += vars[name]; continue }
    const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : (match[2] ?? '')
    stops.push({ start: text.length, end: text.length + value.length })
    text += value
  }
  text += shifted.slice(cursor)
  return { text, stops, caret: end >= 0 ? end : text.length }
}

const postfixTrigger = /(.*)\.([A-Za-z][A-Za-z0-9]*)?$/
const wordTrigger = /([A-Za-z][A-Za-z0-9]*)$/

// The receiver of a postfix trigger: the expression that ends just before the dot.
// Walking back keeps identifiers, member access and balanced call/bracket groups and
// stops at anything else, so `x = value.nn` expands `value` and not the statement.
function receiverBefore(text: string) {
  let index = text.length, depth = 0
  while (index > 0) {
    const before = text[index - 1]
    if (depth > 0) {
      if (before === ')' || before === ']') depth++
      else if (before === '(' || before === '[') depth--
    } else if (before === ')' || before === ']') depth++
    else if (!/[A-Za-z0-9_$.]/.test(before)) break
    index--
  }
  const receiver = text.slice(index)
  return receiver.startsWith('.') || receiver.startsWith(')') || receiver.startsWith(']') ? '' : receiver
}

// Split `receiver.key` at the caret: the last dot, the (possibly empty, while the
// user is still typing) key after it, and the expression before that dot — empty when
// the dot does not follow an expression, which makes it not a trigger at all.
function postfixAt(prefix: string) {
  const match = postfixTrigger.exec(prefix)
  if (!match) return null
  const key = match[2] ?? ''
  const receiver = receiverBefore(match[1]!)
  return receiver ? { key, receiver, length: receiver.length + key.length + 1 } : null
}

// Expand the template the caret sits on: `receiver.postfix` first, then a keyword.
export function expand(
  line: string,
  caret: number,
  path: string,
  settings: TemplateSettings = defaultTemplateSettings,
  plugins: readonly PluginTemplateSource[] = [],
): Expansion | null {
  const prefix = line.slice(0, caret)
  const indent = indentOf(line)
  const usable = effectiveTemplates(path, settings, plugins)
  const macroContext: TemplateMacroContext = { path }
  const trigger = postfixAt(prefix)
  // Nothing to expand until the user has typed the key after the dot.
  if (trigger?.key) {
    const found = usable.find(entry => entry.template.postfix && entry.template.key === trigger.key)
    if (found) {
      const result = render(found.template.body, indent, { EXPR: trigger.receiver }, macroContext)
      return { start: caret - trigger.length, end: caret, ...result }
    }
  }
  const word = wordTrigger.exec(prefix)
  if (!word) return null
  const found = usable.find(entry => !entry.template.postfix && entry.template.key === word[1])
  if (!found) return null
  const result = render(found.template.body, indent, {}, macroContext)
  return { start: caret - word[1]!.length, end: caret, ...result }
}

export interface Candidate { key: string; description: string; detail: string }

// What the completion popup offers for the text before the caret: keyword templates
// matching the typed word, and postfix templates matching what follows `expr.`.
export function candidates(
  line: string,
  caret: number,
  path: string,
  settings: TemplateSettings = defaultTemplateSettings,
  plugins: readonly PluginTemplateSource[] = [],
): Candidate[] {
  const prefix = line.slice(0, caret)
  const usable = effectiveTemplates(path, settings, plugins)
  const trigger = postfixAt(prefix)
  if (trigger) {
    return usable.filter(entry => entry.template.postfix && entry.template.key.startsWith(trigger.key))
      .map(entry => ({ key: entry.template.key, description: '后置模板：' + entry.template.description, detail: 'postfix' }))
  }
  const word = wordTrigger.exec(prefix)?.[1] ?? ''
  return usable.filter(entry => !entry.template.postfix && entry.template.key.startsWith(word) && entry.template.key !== word)
    .map(entry => ({ key: entry.template.key, description: entry.template.description, detail: 'live template' }))
}
