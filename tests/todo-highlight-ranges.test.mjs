// 编辑器内 TODO 高亮范围（`src/todoHighlightRanges.ts`）的判据。
//
// 上游坐标逐条见该文件头：`TodoHighlightVisitor.java`（范围来源）+ `IndexPatternSearcher.java`
// （注释区间、匹配语义、续行）+ `IndexPattern.java:80-89`（正则编译）+ `TodoDefaultPatternProvider.kt:23-24`
// （出厂模式表）。这里钉的是**行为**，不是形状。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TODO_CONTINUATION_CLASS, TODO_MARKER_CLASS, TODO_MARKER_STYLE_KEY, TODO_NAVIGATION_CLASS,
  todoHighlightClass, todoHighlightRanges, todoHighlightStyleKey, todoPatternMatchRanges,
} from '../src/todoHighlightRanges.ts'

/** 出厂两条模式（`TodoDefaultPatternProvider.kt:23-24`，正则逐字照抄）。 */
const defaults = [{ pattern: '\\btodo\\b.*' }, { pattern: '\\bfixme\\b.*' }]
const tsComment = { line: '//', block: ['/*', '*/'] }

const kinds = ranges => ranges.map(range => `${range.kind}@${range.from}-${range.to}`)
const sliceOf = (text, range) => text.slice(range.from, range.to)

test('高亮范围 = 正则命中本身，不是"只有标记词"也不是无条件整行', () => {
  // 出厂 `\btodo\b.*` 的 `.*` 吃到注释正文行尾（`TodoHighlightVisitor.java:74,81` 用的是
  // `IndexPatternSearcher.java:250-251` 的 matcher 区间）—— 于是整条 `TODO: …` 都变色。
  const text = '// TODO: 写文档\nconst x = 1\n'
  const ranges = todoHighlightRanges(text, defaults, tsComment)
  assert.deepEqual(kinds(ranges), ['marker@3-12'])
  assert.equal(sliceOf(text, ranges[0]), 'TODO: 写文档')
})

test('只扫注释：字符串字面量里的标记不着色（上游先取注释 token 区间）', () => {
  // `IndexPatternSearcher.java:89,94-103,192`：只在注释区间里跑模式。
  const text = 'const s = "TODO: 不是注释"\n// TODO: 是注释\n'
  const ranges = todoHighlightRanges(text, defaults, tsComment)
  assert.deepEqual(kinds(ranges), ['marker@26-35'])
  assert.equal(sliceOf(text, ranges[0]), 'TODO: 是注释')
})

test('块注释只画正文，不含开闭标记（getCommentStartDelta/EndDelta 各收 2）', () => {
  const text = '/* TODO: 块注释 */\n'
  const ranges = todoHighlightRanges(text, defaults, tsComment)
  // `JavaIndexPatternBuilder.java:42,48`：C 风格注释起点/终点各往内收 2。
  assert.deepEqual(kinds(ranges), ['marker@3-13'])
  // `.*` 连闭标记前的那个空格也吃掉 —— 这是上游 matcher 区间的真实结果。
  assert.equal(sliceOf(text, ranges[0]), 'TODO: 块注释 ')
})

test('纯文本（没有注释词法）按上游整份当注释区间', () => {
  // `IndexPatternSearcher.java:114-123`：`PsiPlainTextFile` 直接 `CommentRange(0, chars.length())`。
  const text = 'TODO: 裸文本也算\n第二行\n'
  const ranges = todoHighlightRanges(text, defaults, null)
  assert.deepEqual(kinds(ranges), ['marker@0-11'])
  assert.equal(sliceOf(text, ranges[0]), 'TODO: 裸文本也算')
  // 给了注释词法而这一行不在注释里 ⇒ 不画（同一条注释闸门）。
  assert.deepEqual(todoHighlightRanges(text, defaults, tsComment), [])
})

test('模式原样就是正则：不包隐式 \\b，带标点的标记照样命中', () => {
  // `IndexPattern.java:80-89` 把模式串直接交给 Pattern.compile。
  assert.deepEqual(todoPatternMatchRanges('// TODO: 带冒号', { pattern: 'TODO:' }), [{ from: 3, to: 8 }])
  assert.deepEqual(todoPatternMatchRanges('// FIXME(bob)', { pattern: 'FIXME\\(bob\\)' }), [{ from: 3, to: 13 }])
  // 出厂模式自己写了 \b：复数不算。
  assert.deepEqual(todoPatternMatchRanges('// MYTODOXX', { pattern: '\\btodo\\b' }), [])
  // 裸词按 find() 子串语义命中。
  assert.deepEqual(todoPatternMatchRanges('// TODOS 复数也命中', { pattern: 'TODO' }), [{ from: 3, to: 7 }])
})

test('大小写敏感性是每条模式自己的档位（TodoPattern 的 case-sensitive）', () => {
  // `TodoPattern.java:30` 的 `Boolean.parseBoolean(state.getAttributeValue("case-sensitive"))`，
  // 缺省 false ⇒ 不区分大小写。
  assert.equal(todoPatternMatchRanges('// todo 与 TODO', { pattern: 'TODO' }).length, 2)
  assert.deepEqual(todoPatternMatchRanges('// todo 与 TODO', { pattern: 'TODO', caseSensitive: true }), [{ from: 10, to: 14 }])
  const text = '// todo: 小写\n// TODO: 大写\n'
  assert.deepEqual(kinds(todoHighlightRanges(text, [{ pattern: 'TODO', caseSensitive: true }], tsComment)), ['marker@15-19'])
})

test('模式串两端空白先 trim（TodoPattern.java:29 的 .trim()），空模式永不命中', () => {
  assert.deepEqual(todoPatternMatchRanges('// TODO', { pattern: '  TODO  ' }), [{ from: 3, to: 7 }])
  assert.deepEqual(todoPatternMatchRanges('// TODO', { pattern: '   ' }), [])
  assert.deepEqual(todoHighlightRanges('// TODO', [{ pattern: '' }], tsComment), [])
})

test('坏正则退化为字面包含（与 markerMatches 的 catch 分支同一容错口径）', () => {
  assert.deepEqual(todoPatternMatchRanges('a (b', { pattern: '(' }), [{ from: 2, to: 3 }])
  const text = '// ( TODO\n'
  assert.deepEqual(kinds(todoHighlightRanges(text, [{ pattern: '(' }], tsComment)), ['marker@3-4'])
})

test('同一注释区间内按起点去重，且模式表靠后的那条赢（倒序遍历）', () => {
  // `IndexPatternSearcher.java:97` 的 `for (j = patterns.length - 1; j >= 0; --j)` +
  // `:253` 的 `!matches.contains(start)`。
  const text = '// TODO: 两条都命中\n'
  const ranges = todoHighlightRanges(text, [{ pattern: 'TODO' }, { pattern: 'TODO:.*' }], tsComment)
  assert.equal(ranges.length, 1)
  assert.equal(ranges[0].pattern, 'TODO:.*')
})

test('空匹配跳过，不原地打转', () => {
  // `IndexPatternSearcher.java:252`（start != end）与 `PlainTextTodoIndexer.java:43`。
  assert.deepEqual(todoPatternMatchRanges('abc', { pattern: 'x*' }), [])
  assert.deepEqual(todoPatternMatchRanges('axbxc', { pattern: 'x*' }), [{ from: 1, to: 2 }, { from: 3, to: 4 }])
})

test('续行：多行条目的后续注释行也画，且从标记列往后跳空白起算', () => {
  // `TodoHighlightVisitor.java:82-88`；区间端点按 `IndexPatternSearcher.java:291,300` 现算。
  const text = ['class A {', '  // TODO: first line', '  //    continuation one', '  //    continuation two', '  return 0;', ''].join('\n')
  const ranges = todoHighlightRanges(text, defaults, tsComment)
  assert.deepEqual(kinds(ranges), ['marker@15-31', 'continuation@40-56', 'continuation@65-81'])
  // 起点是**标记列往后跳过空白**（`:291` 的 refOffset + shiftForward），不是行首也不是 `//` 之后。
  assert.equal(sliceOf(text, ranges[1]), 'continuation one')
  assert.equal(sliceOf(text, ranges[2]), 'continuation two')
  // `multiLine: false` 时只有主行（`TodoConfiguration.java:138-140` 的 myMultiLine 关掉）。
  assert.deepEqual(kinds(todoHighlightRanges(text, defaults, tsComment, { multiLine: false })), ['marker@15-31'])
})

test('块注释的 * 续行：区间不含行首空白与前导 *', () => {
  const text = ['/* TODO: 说明', ' *    第二行', ' */', ''].join('\n')
  const ranges = todoHighlightRanges(text, defaults, tsComment)
  assert.deepEqual(kinds(ranges), ['marker@3-11', 'continuation@18-21'])
  assert.equal(sliceOf(text, ranges[1]), '第二行')
})

test('续行不并代码行，也不并正文起得更早的注释行', () => {
  const code = ['  // TODO: a', '  int x = 1;', ''].join('\n')
  assert.deepEqual(kinds(todoHighlightRanges(code, defaults, tsComment)), ['marker@5-12'])
  const sameColumn = ['  // TODO: a', '  // and that', ''].join('\n')
  assert.deepEqual(kinds(todoHighlightRanges(sameColumn, defaults, tsComment)), ['marker@5-12'])
})

test('续行里再出现标记就停：那是另一条 TODO（findContinuation 的 break outer）', () => {
  const text = ['  // TODO: a', '  //      plain tail', '  //      FIXME: b', '  //      more', ''].join('\n')
  const ranges = todoHighlightRanges(text, defaults, tsComment)
  assert.deepEqual(kinds(ranges), ['marker@5-12', 'continuation@23-33', 'marker@44-52'])
  assert.equal(sliceOf(text, ranges[1]), 'plain tail')
  assert.equal(sliceOf(text, ranges[2]), 'FIXME: b')
})

test('CRLF 里续行偏移不漂（行首表只认 \\n）', () => {
  const text = ['class A {', '  // TODO: first', '  //    tail', ''].join('\r\n')
  const ranges = todoHighlightRanges(text, defaults, tsComment)
  assert.deepEqual(kinds(ranges), ['marker@16-27', 'continuation@37-41'])
  assert.equal(sliceOf(text, ranges[1]), 'tail')
})

test('标记词链接默认不产出，开了才产出且只覆盖词面段', () => {
  // registry `todo.navigation`：`TodoHighlightVisitor.java:65` + `ide.core.impl.xml:382` 默认 false。
  const text = '// TODO: 写文档\n'
  assert.deepEqual(kinds(todoHighlightRanges(text, defaults, tsComment)), ['marker@3-12'])
  assert.deepEqual(kinds(todoHighlightRanges(text, defaults, tsComment, { navigation: true })),
    ['marker@3-12', 'navigation@3-7'])
  assert.equal(sliceOf(text, { from: 3, to: 7 }), 'TODO')
  // 匹配串开头不是词字符 ⇒ 没有"标记词"可画（上游 `IndexPattern.java:61-65` 拿不到字面词）。
  assert.deepEqual(kinds(todoHighlightRanges('// :TODO x\n', [{ pattern: ':TODO' }], tsComment, { navigation: true })),
    ['marker@3-8'])
})

test('limit 截断（防病态模式画满整篇）', () => {
  const text = `${Array.from({ length: 50 }, () => '// TODO: x').join('\n')}\n`
  assert.equal(todoHighlightRanges(text, defaults, tsComment, { multiLine: false, limit: 7 }).length, 7)
})

test('输出有序：按起点升序，同起点主范围在导航链接之前', () => {
  const text = '// FIXME: a\n// TODO: b\n'
  const ranges = todoHighlightRanges(text, defaults, tsComment, { multiLine: false })
  assert.deepEqual(ranges.map(range => range.from), [...ranges.map(range => range.from)].sort((a, b) => a - b))
  const withNav = todoHighlightRanges(text, defaults, tsComment, { multiLine: false, navigation: true })
  const markerAt = withNav.findIndex(range => range.kind === 'marker')
  const navAt = withNav.findIndex(range => range.kind === 'navigation')
  assert.ok(markerAt >= 0 && navAt > markerAt, '同起点时主范围排在导航链接前面')
})

test('模式表为空 ⇒ 什么都不产出（没有定义任何标记就没有任何 TODO）', () => {
  assert.deepEqual(todoHighlightRanges('// TODO: x\n', [], tsComment), [])
})

test('外观映射：默认走方案色键，模式自带自定义色就用它；编辑器不画图标', () => {
  // `TodoAttributes.java:41-42` 的 useCustomColors 分支；出厂两条都是
  // `TodoAttributesUtil.createDefault()`（`TodoDefaultPatternProvider.kt:23-24`）⇒ 同色。
  assert.equal(todoHighlightStyleKey({ pattern: 'TODO' }), TODO_MARKER_STYLE_KEY)
  assert.equal(todoHighlightStyleKey({ pattern: 'TODO', color: '#4a86e8' }), '#4a86e8')
  // 非法色值不冒充自定义色。
  assert.equal(todoHighlightStyleKey({ pattern: 'TODO', color: 'red' }), TODO_MARKER_STYLE_KEY)
  // 三档 class（图标只出现在 TODO 工具窗口：`TodoItemNode.java:127`，编辑器这一层不画）。
  assert.equal(todoHighlightClass('marker'), TODO_MARKER_CLASS)
  assert.equal(todoHighlightClass('continuation'), TODO_CONTINUATION_CLASS)
  assert.equal(todoHighlightClass('navigation'), TODO_NAVIGATION_CLASS)
})

test('范围计算复用既有模块，不重写注释区间与续行规则', () => {
  const source = readFileSync('src/todoHighlightRanges.ts', 'utf8')
  assert.match(source, /export function todoHighlightRanges\(/, '范围计算是本模块的主导出')
  assert.match(source, /import \{ commentRanges \} from '\.\/usageHighlight\.ts'/, '注释区间复用 usageHighlight（不重写）')
  assert.match(source, /import \{ todoContinuationLines \} from '\.\/todoMultiLine\.ts'/, '续行规则复用 todoMultiLine（不重写）')
})