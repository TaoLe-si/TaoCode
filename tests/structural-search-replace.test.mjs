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
//   · 命中计数文案 `platform/structuralsearch/resources/messages/SSRBundle.properties:48`；
//   · 整份文件那一侧的三步骨架：`Replacer.java:125-131`（`CollectingMatchResultSink` 收**全部**命中，
//     逐条建 `ReplacementInfo`）、`ReplacementBuilder.java:132-163`（`process` 逐处展开，参数位按
//     `getStartIndex` **逆序**插，`:140-141`）、`Replacer.java:180-211`（`doReplaceAll` 逐处写回，
//     `:219-221` 写回前查元素还有效吗）；
//   · 命中不重叠/不嵌套 `…/impl/matcher/handlers/TopLevelMatchingHandler.java:22-34`
//     （匹配成功且没开递归档 ⇒ 不往子节点里钻）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compileStructuralPattern, compileStructuralReplacement } from '../src/structuralSearch.ts'
import {
  UNAVAILABLE_REPLACE_OPTIONS, buildReplacementTemplate, checkDefinitions, compileStructuralReplacementWithDefinitions,
  defineReplacementVariable,
  definitionMap, danglingDefinitions, expandStructuralReplacement, previewMany, previewStructuralReplacement,
  applyStructuralReplacements, replacementSummary, structuralReplacementPlan, unknownReplacementNames, validateReplacement,
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

// ── 桶 9 派单点名的 matcher 纯函数半区：模板解析 → 匹配 → 替换文本生成 ──────────
// 上游那三步：`Replacer.java:125-131`（收全部命中，逐条建 ReplacementInfo）→
// `ReplacementBuilder.java:132-163`（逐处展开，参数位逆序插 `:140-141`）→
// `Replacer.java:180-211`（逐处写回）。命中不重叠：`TopLevelMatchingHandler.java:22-34`。
const eqPattern = compileStructuralPattern('$x$ == null')
const eqLine = 'a == null && b == null'

test('整份文件一次替换：拿全部命中、按文档顺序、互不重叠（Replacer.java:125-131）', () => {
  const plan = structuralReplacementPlan(eqPattern, eqLine, '$x$ != null')
  assert.deepEqual(plan.edits.map(edit => [edit.from, edit.to, edit.text]),
    [[0, 9, 'a != null'], [13, 22, 'b != null']], '一处命中一条 ReplacementInfo')
  assert.deepEqual(plan.edits.map(edit => edit.values.x), ['a', 'b'], '逐处的捕获值跟着这一处走')
  assert.equal(applyStructuralReplacements(eqLine, plan.edits), 'a != null && b != null')
  for (let i = 1; i < plan.edits.length; ++i) {
    assert.ok(plan.edits[i - 1].to <= plan.edits[i].from, '编辑互不重叠（上游由 PSI 节点整块吃掉保证）')
  }
})

test('逆序写回：给出的顺序不影响结果（ReplacementBuilder.java:140-141）', () => {
  // 用"越换越短"的替换串：`== null` 整个吃掉。正序写回会让第二处的下标落在**已经被改过**的文本上
  // （上游 `Replacer.java:185-207` 是正序，但它每写一处都重解析 PSI，本仓没有这一条 ⇒ 只能逆序）。
  const plan = structuralReplacementPlan(eqPattern, eqLine, '$x$')
  assert.deepEqual(plan.edits.map(edit => [edit.from, edit.to, edit.text]), [[0, 9, 'a'], [13, 22, 'b']])
  assert.equal(applyStructuralReplacements(eqLine, plan.edits), 'a && b')
  assert.equal(applyStructuralReplacements(eqLine, [...plan.edits].reverse()),
    applyStructuralReplacements(eqLine, plan.edits), '先算下标再一次性写 ⇒ 前面的编辑不许挪动后面的位置')
  assert.notEqual(applyStructuralReplacements(eqLine, plan.edits), eqLine, '判据不能是"改了等于没改"')
})

test('前后一样的与复核判掉的都不写回，但要分开计数', () => {
  // 定义把变量写回原文 ⇒ 不产生编辑（面板那句"N 处替换前后一样"的口径）。
  const noop = structuralReplacementPlan(eqPattern, eqLine, '$x$ == null')
  assert.deepEqual(noop.edits, [])
  assert.equal(noop.unchanged, 2)
  // accept = 复核（`verdictForHit` 那一层）：判掉的计入 skipped，不写回。
  const half = structuralReplacementPlan(eqPattern, eqLine, '$x$ != null', new Map(), '',
    spans => spans.whole.start !== 13)
  assert.deepEqual(half.edits.map(edit => edit.from), [0])
  assert.equal(half.skipped, 1)
  assert.equal(half.unchanged, 0)
})

test('替换成空 = 删掉这一段（Replacer.java:70-76 的空文本不插）', () => {
  const plan = structuralReplacementPlan(eqPattern, 'if (a == null) {}', '')
  assert.deepEqual(plan.edits.map(edit => [edit.from, edit.to, edit.text]), [[4, 13, '']])
  assert.equal(applyStructuralReplacements('if (a == null) {}', plan.edits), 'if () {}')
})

test('一行两处：预览按列号取"这一处"，与 verdictForHit 的起点同一档', () => {
  // 复核那一步早就按列号取命中（`src/structuralSearchModifiers.ts:416-417` + `:426`），
  // 预览原先固定从 0 起 ⇒ 第二条结果行的预览显示的是第一条的前后文本。
  const first = previewStructuralReplacement(eqPattern, eqLine, '$x$ != null', new Map(), '', 0)
  const second = previewStructuralReplacement(eqPattern, eqLine, '$x$ != null', new Map(), '', 13)
  assert.equal(first.before, 'a == null')
  assert.equal(second.before, 'b == null', '第二条结果行预览的是压在 column 13 上的那一处')
  assert.equal(second.values.x, 'b')
  // 取不到正好压在列号上的命中时退回行内第一处（老调用方传 0 / 传任意列都不至于变成"算不出"）。
  assert.equal(previewStructuralReplacement(eqPattern, eqLine, '$x$ != null', new Map(), '', 7).before, 'a == null')
  // previewMany 把行上的列号一路传下去。
  const many = previewMany(eqPattern, [
    { path: 'a.ts', line: 1, column: 0, text: eqLine },
    { path: 'a.ts', line: 1, column: 13, text: eqLine },
  ], '$x$ != null')
  assert.deepEqual([...many.previews.values()].map(preview => preview.before), ['a == null', 'b == null'])
  assert.equal(many.unverifiable, 0)
  assert.equal(many.unchanged, 0)
})

test('零宽命中不死循环、不重叠（本仓给 `{0,}` 那类模板加的保险）', () => {
  // 上游一次匹配吃掉一个完整 PSI 节点，不存在"零个字符"的命中；本仓的正则能编出可空捕获组
  // （`$x$*`），推进规则必须自己挡住，否则一次搜索就挂死在这里。
  const pattern = compileStructuralPattern('$x$*')
  const plan = structuralReplacementPlan(pattern, 'zz', 'E')
  assert.deepEqual(plan.edits.map(edit => [edit.from, edit.to]), [[0, 2], [2, 2]])
  assert.equal(applyStructuralReplacements('zz', plan.edits), 'EE')
  assert.equal(plan.edits.length, 'zz'.length + 1 - 1, '每处至多推进一格 ⇒ 处数不会超过字符数')
})
