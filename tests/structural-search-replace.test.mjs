// 结构化**替换**的文本层模型（`src/structuralSearchReplace.ts`）——判词 `ss/replace` 的
// 「`ReplacementVariableDefinition` 的逐变量替换定义」与「替换预览」两条待办的落点。
//
// 上游依据（基准树 `D:/Backup/Downloads/intellij-community-master`）：
//   · 定义模型 `platform/structuralsearch/source/com/intellij/structuralsearch/ReplacementVariableDefinition.java:9-24`
//     + 基类字段与 `""` 哨兵 `…/NamedScriptableDefinition.java:16-17,43-45`；
//   · 展开与逆序 `…/plugin/replace/impl/ReplacementBuilder.java:132-163`（`:141` 逆序、`:147-151` 取值）；
//   · 空文本不插（=删除）`…/plugin/replace/impl/Replacer.java:70-76`；
//   · 不改文档的预览 `…/plugin/replace/impl/Replacer.java:78-92` 的 `testReplace`；
//   · 三个替换开关 `…/plugin/replace/ReplaceOptions.java:27-29`（getter `:72`/`:80`/`:92`）；
//   · 命中计数文案 `platform/structuralsearch/resources/messages/SSRBundle.properties:48`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compileStructuralPattern, compileStructuralReplacement } from '../src/structuralSearch.ts'
import {
  UNAVAILABLE_REPLACE_OPTIONS, buildReplacementTemplate, checkDefinitions, compileStructuralReplacementWithDefinitions,
  defineReplacementVariable,
  definitionMap, danglingDefinitions, expandStructuralReplacement, previewMany, previewStructuralReplacement,
  replacementSummary, unknownReplacementNames, validateReplacement,
} from '../src/structuralSearchReplace.ts'

test('定义表的 `""` 哨兵与上游同名规则：写两个引号就是空串', () => {
  // `NamedScriptableDefinition.java:44`：`"\"\"".equals(scriptCodeConstraint) ? "" : …`
  assert.deepEqual(defineReplacementVariable('x', '""'), { name: 'x', text: '' })
  assert.deepEqual(defineReplacementVariable('x', 'foo'), { name: 'x', text: 'foo' })
  assert.deepEqual([...definitionMap([defineReplacementVariable('x', 'a'), defineReplacementVariable('x', 'b')])], [['x', 'b']],
    '同名后写的覆盖先写的')
})

test('有定义的变量用定义文本，没定义的用捕获值，模板外的名字原样留着', () => {
  const pattern = compileStructuralPattern('$x$ == null')
  const defs = definitionMap([defineReplacementVariable('x', 'EMPTY')])
  assert.equal(expandStructuralReplacement('$x$ ?? 0', pattern.variables, ['a'], defs, 'a == null'), 'EMPTY ?? 0')
  assert.equal(expandStructuralReplacement('$x$ ?? 0', pattern.variables, ['a'], new Map(), 'a == null'), 'a ?? 0')
  // `$0` 是整段命中（上游 `$0` 语义，展开器复用 src/regexReplacement.ts 那一份）。
  assert.equal(expandStructuralReplacement('/* $0 */', pattern.variables, ['a'], new Map(), 'a == null'), '/* a == null */')
  // 模板里没有的名字保留字面，不动其它文本。
  assert.equal(expandStructuralReplacement('$z$ and $x$', pattern.variables, ['a'], new Map()), '$z$ and a')
  assert.deepEqual(unknownReplacementNames('$z$ and $x$', pattern.variables), ['z'])
})

test('定义文本是纯文本，不二次解释成组引用', () => {
  // 上游 `Replacer.java:70-76` 的 insertSubstitution 插的是字符串，不再过一遍替换语义。
  const defs = definitionMap([defineReplacementVariable('x', '$1')])
  assert.equal(expandStructuralReplacement('$x$', ['x'], ['a'], defs), '$1')
})

test('替换成空 = 删掉那一段（上游 insertSubstitution 的空文本分支）', () => {
  const pattern = compileStructuralPattern('$x$ == null')
  const defs = definitionMap([defineReplacementVariable('x', '')])
  const preview = previewStructuralReplacement(pattern, 'if (a == null) {}', '$x$ != null', defs)
  assert.equal(preview.before, 'a == null')
  assert.equal(preview.after, ' != null')
  assert.equal(preview.removes, false)
  const removed = previewStructuralReplacement(pattern, 'a == null', '', new Map())
  assert.equal(removed.after, '')
  assert.equal(removed.removes, true)
  // 复核不上（那一行按 JS 正则配不出区间）⇒ null，不编一个 after。
  assert.equal(previewStructuralReplacement(pattern, '这里没有命中', 'x', new Map()), null)
})

test('同一变量在替换串里出现多次都拿同一个值（上游逆序展开的等价结果）', () => {
  // `ReplacementBuilder.java:141` 按 startIndex **逆序**排再插，就是为了"前一次插入不挪后一次的下标"；
  // 本仓把每个来源先编成槽位再单趟展开，同一条结果：两处 `$x$` 都是同一个捕获值。
  const pattern = compileStructuralPattern('$x$ + $x$')
  const out = expandStructuralReplacement('$x$ * $x$', pattern.variables, ['a', 'a'], new Map(), 'a + a')
  assert.equal(out, 'a * a')
})

test('buildReplacementTemplate 的槽位表：整段在 0、捕获在前、定义与字面量往后追加', () => {
  const variables = ['x', 'y']
  const defs = definitionMap([defineReplacementVariable('y', 'FIXED')])
  const built = buildReplacementTemplate('$x$-$y$-$x$-$z$', variables, defs)
  // `$y$` → 定义槽 3，`$z$`（模板里没有）→ 文本槽 4；捕获槽 1/2 与变量顺序一致。
  assert.equal(built.template, '$1-$3-$1-$4')
  assert.deepEqual(built.groups, ['', '', '', 'FIXED', '$z$'])
})

test('预览一批行时把"改不了"和"复核不上"分开计数', () => {
  const pattern = compileStructuralPattern('$x$ == null')
  const rows = [
    { path: 'a.ts', line: 1, column: 0, text: 'a == null' },
    { path: 'a.ts', line: 2, column: 0, text: 'b == null' },
    { path: 'a.ts', line: 3, column: 0, text: '没有命中的一行' },
  ]
  // 替换串与模板本身一样 ⇒ 前两处 after 与 before 相同，算"改不了"，第三处是"复核不上"。
  const out = previewMany(pattern, rows, '$x$ == null')
  assert.equal(out.previews.size, 2)
  assert.equal(out.unverifiable, 1)
  assert.equal(out.unchanged, 2)
  assert.equal(out.previews.get('a.ts:1:0').after, 'a == null')
  assert.equal(out.previews.get('a.ts:2:0').values.x, 'b')
  const changed = previewMany(pattern, rows, '$x$ != null')
  assert.equal(changed.unchanged, 0)
})

test('定义必须指向模板里真实存在的变量（否则面板提示，不悄悄忽略）', () => {
  const pattern = compileStructuralPattern('$x$ == null')
  assert.deepEqual(danglingDefinitions(pattern, [defineReplacementVariable('zz', 'a')]), ['zz'])
  assert.match(checkDefinitions(pattern, [defineReplacementVariable('zz', 'a')])[0], /在模板里不存在/)
  assert.deepEqual(checkDefinitions(pattern, [defineReplacementVariable('x', 'a')]), [])
  assert.deepEqual(validateReplacement('$x$ == null', '', []), [])
  assert.match(validateReplacement('', '', [])[0], /模板不能为空/)
})

test('折进宿主替换串：没有定义表时与既有实现逐字相同', () => {
  // 这条是"接线不许改坏既有行为"的判据：面板在**没有定义**时走的仍然是 `compileStructuralReplacement`。
  const variables = ['x', 'y']
  for (const text of ['$x$ != null', '$y$ && $x$', '$z$ 保持字面', '没有变量']) {
    assert.equal(
      compileStructuralReplacementWithDefinitions(text, variables, []).replacement,
      compileStructuralReplacement(text, variables),
      text,
    )
  }
  // 有定义 ⇒ 定义文本写在原来 `$Var$` 的位置上，未定义的仍然翻成 `$N`。
  const defs = [defineReplacementVariable('x', 'EMPTY')]
  assert.equal(compileStructuralReplacementWithDefinitions('$x$($y$)', variables, defs).replacement, 'EMPTY($2)')
  // 定义文本含 `$` ⇒ 挡住（原生 ECMAScript 格式化器没有"字面 $"的写法，发下去会变形）。
  assert.match(compileStructuralReplacementWithDefinitions('$x$', variables, [defineReplacementVariable('x', 'a$b')]).error ?? '', /会被当成捕获标记/)
})

test('命中计数口径取自上游 found.progress.message', () => {
  // `SSRBundle.properties:48` `found.progress.message=Found {0} matches`。
  assert.equal(replacementSummary(12, 3, 10), '12 处命中 · 3 个文件 · 10 处将替换')
  assert.equal(replacementSummary(0, 0, 0), '0 处命中 · 0 处将替换')
})

test('三个替换开关登记为"没有落点"，不画成可点的控件', () => {
  assert.deepEqual(UNAVAILABLE_REPLACE_OPTIONS.map(item => item.name), [
    '替换后重排（Reformat）', '使用静态导入（Use static imports）', '缩短全限定名（Shorten FQN）',
  ])
  for (const item of UNAVAILABLE_REPLACE_OPTIONS) assert.ok(item.reason.length > 20, item.name)
  // 理由里点名了上游的字段（`ReplaceOptions.java:27-29`），核对得上才不算空话。
  assert.match(UNAVAILABLE_REPLACE_OPTIONS.map(item => item.reason).join('|'), /ReplaceOptions\.java:28/)
})
