// IDEA's "Surround With" (Ctrl+Alt+T): wrap the selection — or the line under the caret
// when nothing is selected — in a template. Block surrounds re-indent the wrapped lines
// one level and put the caret where the person has to type next (inside an empty `()`
// when the template opens a condition, otherwise just after the code), so the next
// keystroke can never replace what was just wrapped.
import { customFoldingSurroundRows } from './customFoldingSurround.ts'

export interface SurroundTemplate {
  title: string
  keywords: string
  prefix: string
  suffix: string
  block: boolean
}

export const surroundTemplates: SurroundTemplate[] = [
  { title: 'if 条件', keywords: 'if condition branch 条件 判断', prefix: 'if () {', suffix: '}', block: true },
  { title: 'if / else', keywords: 'if else branch 条件 分支', prefix: 'if () {', suffix: '} else {\n\n}', block: true },
  { title: 'for 索引循环', keywords: 'for loop index 循环', prefix: 'for (let i = 0; i < ; i++) {', suffix: '}', block: true },
  { title: 'while 循环', keywords: 'while loop 循环', prefix: 'while () {', suffix: '}', block: true },
  // `do { … } while ()` 与 `try { … } catch { … } finally { … }`：上游 `Surround With` 那一张表里的
  // 两项（`java/java-impl/src/com/intellij/codeInsight/generation/surroundWith/JavaStatementsSurroundDescriptor.java:26-40`
  // —— `JavaWithDoWhileSurrounder`(:30) 与 `JavaWithTryCatchFinallySurrounder`(:35)）。
  // 同一张表里剩下的 `synchronized`(:36) 与 `Runnable`(:37) 是 Java 专有构造，本仓的编辑器档
  // （TS/JS/Python…）没有对应写法 ⇒ 不列（列了点下去就是坏代码）。
  { title: 'do / while 循环', keywords: 'do while loop repeat 循环 至少一次', prefix: 'do {', suffix: '} while ()', block: true },
  { title: 'try / catch', keywords: 'try catch exception 异常 捕获', prefix: 'try {', suffix: '} catch (error) {\n\n}', block: true },
  { title: 'try / catch / finally', keywords: 'try catch finally exception 异常 捕获 兜底', prefix: 'try {', suffix: '} catch (error) {\n\n} finally {\n\n}', block: true },
  { title: 'try / finally', keywords: 'try finally cleanup 清理 兜底', prefix: 'try {', suffix: '} finally {\n\n}', block: true },
  { title: '代码块 { }', keywords: 'block braces scope 代码块 作用域', prefix: '{', suffix: '}', block: true },
  { title: '文档注释 /* */', keywords: 'comment block doc 注释', prefix: '/*', suffix: '*/', block: true },
  { title: '行注释 //', keywords: 'comment line 注释', prefix: '// ', suffix: '', block: false },
  { title: '括号 ( )', keywords: 'parentheses group 括号', prefix: '(', suffix: ')', block: false },
  { title: '方括号 [ ]', keywords: 'brackets array 方括号', prefix: '[', suffix: ']', block: false },
  // 自定义折叠区域：**每个 provider 一行**，标题与标记文字都取自 `src/customFoldingProviders.ts`
  // 那张表，不再在这里手写（上游 `CustomFoldingSurroundDescriptor.java:217-227` `getSurrounders()`
  // = 逐个 `CustomFoldingProvider.getAllProviders()` 造一个 surrounder，`:244-246` 标题 =
  // `getDescription()`；`VisualStudioCustomFoldingProvider.java:36-42` 与
  // `NetBeansCustomFoldingProvider.java:36-42` 各给 `getStartString`/`getEndString`）。
  // 上一版在这里手写的是四行 `//<region>` / `//region` / `#region` / `//<editor-fold desc="Description">`：
  // 注释前缀写死 `//`，而 `CustomFoldingSurroundDescriptor.java:275-289` + `:306-307` 是拿
  // **这门语言的 `Commenter`** 去包标记的（`:52-56` 那道门：连注释词法都没有就一条都不给）
  // ⇒ 在 Python / Shell / SQL / Lua 里点这一行插进去的是**不成注释的裸文本**，既编译不过，
  // `src/customFoldingProviders.ts` 的 `commentMarkerBody` 也不认（它按注释前缀剥壳）。
  // 现在静态给的是 `//` 那一档，落地前由 `surroundRowForFile` 按目标文件的注释词法重包。
  ...customFoldingSurroundRows(),
]

export interface Wrapped {
  text: string
  /** Offset inside `text` where the caret belongs after the wrap. */
  caret: number
}

const leadOf = (value: string) => /^\s*/.exec(value)?.[0] ?? ''

/** One indent unit deeper than `indent`; blank lines lose their trailing spaces. */
function reindent(body: string, indent: string, unit: string): string {
  return body.split('\n').map((line, index) => {
    if (!line.trim()) return ''
    // The first line starts at the caret, so it never carries the base indent itself.
    const cut = index === 0 ? leadOf(line).length : Math.min(leadOf(line).length, indent.length)
    return indent + unit + line.slice(cut)
  }).join('\n')
}

export function wrapSelection(template: SurroundTemplate, body: string, indent: string, unit: string): Wrapped {
  if (!template.block) {
    const text = template.prefix + body + template.suffix
    return { text, caret: text.length - template.suffix.length }
  }
  const inner = reindent(body, indent, unit)
  const text = indent + template.prefix + '\n' + inner + '\n' + indent + template.suffix
  const afterBody = indent.length + template.prefix.length + 1 + inner.length
  // 要填条件的 `()` 在前缀里（`if (|) {`）就落在那儿；只出现在后缀里
  // （`do { … } while (|)`）也一样 —— 同一条理由：光标停在下一步要敲的字上。
  const inPrefix = template.prefix.indexOf('()')
  if (inPrefix >= 0) return { text, caret: indent.length + inPrefix + 1 }
  const inSuffix = template.suffix.indexOf('()')
  if (inSuffix >= 0) return { text, caret: afterBody + 1 + indent.length + inSuffix + 1 }
  return { text, caret: afterBody }
}
