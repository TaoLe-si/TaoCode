// 速度搜索（IDEA `SpeedSearch`）的纯逻辑判据：匹配规则、命中定位、按键归属。
//
// 上游：`MinusculeMatcherImpl.kt`（驼峰子序列 + 硬分隔符）、`SpeedSearchBase.java`（findElement / 键盘 /
// 搜索框生命周期）、`SpeedSearch.java`（能吃进串的那 21 个标点、退到词首、比较器的分隔符集）、
// `SpeedSearchComparator.java`（默认从中间开始匹配）、`SpeedSearchActionPromoter.kt`（盖过 Find in Path）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { firstSpeedSearchHit, isSpeedSearchTypeable, isWordStartAt, lastSpeedSearchHit, nextSpeedSearchHit,
         patternSeparatorProfile, SPEED_SEARCH_HINT, SPEED_SEARCH_PUNCTUATION_MARKS, SPEED_SEARCH_STRUCTURE_SEPARATORS,
         speedSearchDeleteToWordStart, speedSearchElement, speedSearchHitForStep, speedSearchKeyAction,
         speedSearchMatches, speedSearchNextInput, speedSearchStepForKey, speedSearchWalk, stepVisibleIndex } from '../src/speedSearch.ts'

test('大小写不敏感，但大写字母必须落在词首（MinusculeMatcherImpl.kt:303-305）', () => {
  assert.equal(speedSearchMatches('abc', 'Abc'), true, '小写 pattern 命中词首大写')
  assert.equal(speedSearchMatches('ac', 'Abc'), true, '子序列也算命中')
  assert.equal(speedSearchMatches('aB', 'aBC'), true, '词首的大写 B 可以')
  assert.equal(speedSearchMatches('aB', 'abC'), false, '词中的大写 C 不能当作 B 之外的词首')
  assert.equal(speedSearchMatches('bs', 'buildSystem'), true, '驼峰缩写')
  assert.equal(speedSearchMatches('bs', 'BuildSystem'), true, '词首大写同样算')
})

test('顺序必须一致，空 pattern 放行一切', () => {
  assert.equal(speedSearchMatches('ba', 'abc'), false, '顺序反了不命中')
  assert.equal(speedSearchMatches('', 'whatever'), true)
  assert.equal(speedSearchMatches('  ', 'whatever'), true, '全是空白等于空 pattern')
  assert.equal(speedSearchMatches('*', 'whatever'), true)
})

test('默认"从中间开始"：pattern 前不必加 * 就能命中中间（SpeedSearchComparator.java:59-61）', () => {
  assert.equal(speedSearchMatches('sys', 'buildSystem'), true)
  assert.equal(speedSearchMatches('Sys', 'buildSystem'), true)
})

test('词首判定：非字母数字之后算词首，大小写切换也算', () => {
  assert.equal(isWordStartAt('buildSystem', 0), true, '下标 0 恒为词首')
  assert.equal(isWordStartAt('buildSystem', 5), true, 'S 前是小写 b 且自身大写')
  assert.equal(isWordStartAt('build_system', 6), true, '下划线之后算词首')
  assert.equal(isWordStartAt('buildSystem', 6), false, '词中的小写 y 不是词首')
})

test('定位第一条命中（findElement）；空 pattern 不选中任何东西', () => {
  const labels = ['README.md', 'buildSystem.kt', 'TestRunner.kt']
  assert.equal(firstSpeedSearchHit(labels, 'bs'), 1, 'buildSystem 是第一条命中')
  assert.equal(firstSpeedSearchHit(labels, 'zzz'), -1, '没有命中就 -1（上游 findElement 返回 null）')
  assert.equal(firstSpeedSearchHit(labels, ''), -1, '空串不该跳走 —— 焦点还在搜索框里')
})

test('下一条命中先迈一步再找、走完一圈回绕（findNextElement）', () => {
  const labels = ['a.kt', 'ab.kt', 'ac.kt']
    assert.equal(nextSpeedSearchHit(labels, 'a', 2, 1), 0, '到底回绕')
  assert.equal(nextSpeedSearchHit(labels, 'a', 0, -1), 2, '反向往上同样回绕')
  assert.equal(nextSpeedSearchHit(labels, 'zzz', 0, 1), -1)
})

test('键盘归属照 SpeedSearchBase.java:958-1002', () => {
  assert.equal(speedSearchKeyAction('Escape', 'ab'), 'hide', 'Esc 收搜索框')
  assert.equal(speedSearchKeyAction('Enter', 'ab'), 'accept', '回车把焦点交回列表（确认选中）')
  assert.equal(speedSearchKeyAction('ArrowDown', 'ab'), 'navigate', '上下键在命中项之间移动（搜索框自己处理，:684-691）')
  assert.equal(speedSearchKeyAction('ArrowUp', 'ab'), 'navigate')
  assert.equal(speedSearchKeyAction('Home', 'ab'), 'navigate', 'Home 去第一条')
  assert.equal(speedSearchKeyAction('ArrowLeft', 'ab'), 'accept', '左右键交回列表（行内导航）')
  assert.equal(speedSearchKeyAction('Backspace', ''), 'ignore', '空串上退格要吞掉，焦点不许弹出搜索框')
  assert.equal(speedSearchKeyAction('a', ''), 'ignore')
})

test('上下/Home/End 映射到命中项之间的移动（findTargetElement:695-706）', () => {
  assert.deepEqual(speedSearchStepForKey('ArrowDown'), { kind: 'next' })
  assert.deepEqual(speedSearchStepForKey('ArrowUp'), { kind: 'previous' })
  assert.deepEqual(speedSearchStepForKey('Home'), { kind: 'first' })
  assert.deepEqual(speedSearchStepForKey('End'), { kind: 'last' })
  assert.equal(speedSearchStepForKey('a'), null)
})

// 上游的可见表就是「过滤后第几行 → 原列表下标」那张表（`ListPopupModel.java:44-48` getOriginalIndex），
// 所以移动是在**原索引**之间走，而不是把可见行重新编号。
test('可见行之间走一步：只在命中行里挪、走完一圈回绕（SpeedSearchBase:476-516 / :683-706）', () => {
  const visible = [0, 2, 4] // 全量 5 条，命中第 0/2/4 条
  assert.equal(stepVisibleIndex(visible, 0, 'next'), 2, '向下越过被过滤掉的第 1 条')
  assert.equal(stepVisibleIndex(visible, 2, 'previous'), 0, '向上同样只落在命中行')
  assert.equal(stepVisibleIndex(visible, 4, 'next'), 0, '最后一条再向下回到第一条（getCycleScrolling，:479-485）')
  assert.equal(stepVisibleIndex(visible, 0, 'previous'), 4, '第一条再向上回到最后一条（:508-513）')
  assert.equal(stepVisibleIndex(visible, 2, 'first'), 0, 'Home = 第一条命中（findFirstElement，:64-72 同族）')
  assert.equal(stepVisibleIndex(visible, 2, 'last'), 4, 'End = 最后一条命中（findLastElement）')
  // 当前高亮刚被打字过滤掉（本仓的 v-for 保留原索引才会出现这种"高亮不在可见表里"）：
  // 端点起步，与同文件的 `nextSpeedSearchHit` 在 `from < 0` 时同一条口径
  // （`SpeedSearchBase.java:476-486` 的"从列表头/尾起步"）。
  assert.equal(stepVisibleIndex(visible, 3, 'next'), 0, '高亮行被过滤掉：向下从第一条可见行起')
  assert.equal(stepVisibleIndex(visible, 1, 'previous'), 4, '高亮行被过滤掉：向上从最后一条可见行起')
  // 一条都没命中 = 模型空：既不选也不挪（`ListPopupImpl.java:505` 的 size()==0 那一支）。
  assert.equal(stepVisibleIndex([], 3, 'next'), 3)
  assert.equal(stepVisibleIndex([], 3, 'previous'), 3)
  assert.equal(stepVisibleIndex([], 3, 'first'), 3)
  assert.equal(stepVisibleIndex([], 3, 'last'), 3)
})

test('可见表为空表以外的退化：单行时四个方向都停在它自己', () => {
  for (const kind of ['next', 'previous', 'first', 'last']) {
    assert.equal(stepVisibleIndex([7], 7, kind), 7, `${kind} 不该把高亮甩出唯一可见行`)
  }
})

test('提示文字来自上游那一条 bundle 键', () => {
  // editorsearch.search.hint=Search（ApplicationBundle.properties:661）
  assert.equal(SPEED_SEARCH_HINT, '搜索')
})

// ── ① 分隔符感知（MinusculeMatcherImpl.kt:286-292 + :46-89；集由站点自己传，见 :291 那句注释）──

test('硬分隔符集逐字照上游：结构弹层那一站是 " ()"', () => {
  // FileStructurePopup.java:318 `new SpeedSearchComparator(false, true, " ()")`
  assert.equal(SPEED_SEARCH_STRUCTURE_SEPARATORS, ' ()')
  assert.equal(SPEED_SEARCH_STRUCTURE_SEPARATORS.length, 3)
})

test('pattern 不带分隔符、又不混大小写时，两个 hump 之间不许跨过硬分隔符（:290-292）', () => {
  // 纯小写 pattern `ab`：默认（不传分隔符集）照旧跨空格命中 —— 树/表侧比较器的默认就是空集
  // （SpeedSearchBase.java:126 → SpeedSearchComparator.java:34-36）。
  assert.equal(speedSearchMatches('ab', 'a b'), true, '不传分隔符集 ⇒ 与本函数改动前逐字一致')
  // 传了空格 ⇒ `a` 与 `b` 之间那个空格把命中拦掉。
  assert.equal(speedSearchMatches('ab', 'a b', ' '), false, '跨过硬分隔符不算命中')
  assert.equal(speedSearchMatches('ab', 'ab', ' '), true, '同一段文本里照样命中')
  // 拦掉之后继续往右找：后面还有一对贴着写的 `ab` 就该命中它。
  assert.equal(speedSearchMatches('ab', 'a b ab', ' '), true, '候选位点逐个试，不是第一个不行就整体否')
})

test('两处豁免按上游：pattern 自己有分隔符、或 pattern 混了大小写（:73-75 / :85）', () => {
  // `hasSeparators`：用户自己把空格打进串里 ⇒ 这一档整条豁免（patternSeparatorProfile 给 true）。
  assert.deepEqual(patternSeparatorProfile('ab'), { hasSeparators: false, mixedCase: false, appliesExemption: false })
  assert.deepEqual(patternSeparatorProfile('a b'), { hasSeparators: true, mixedCase: false, appliesExemption: true })
  assert.deepEqual(patternSeparatorProfile('aB'), { hasSeparators: false, mixedCase: true, appliesExemption: true })
  // 通配（空格与 `*`，:458）之前不算"有效字符"：`* ab` 里那个空格紧跟在通配后，仍算 hasSeparators 的
  // 判据是 seenNonWildcard 已置位 —— `*` 先置位，随后那个空格就记账。
  assert.deepEqual(patternSeparatorProfile('*ab'), { hasSeparators: false, mixedCase: false, appliesExemption: false })
  // 豁免生效后跨分隔符也能命中。
  assert.equal(speedSearchMatches('a b', 'a b', ' '), true)
  assert.equal(speedSearchMatches('aB', 'a B', ' '), true, '混大小写的 pattern 不受这一档管')
})

test('硬分隔符只查两个 hump **之间**：第一个字符之前有多少分隔符都不管（:220-225 的 allowSpecialChars=true）', () => {
  // 前导 `*`（SpeedSearchComparator.java:59-61 自动补的那一个）走的是"不看特殊字符"那一支。
  assert.equal(speedSearchMatches('ab', ' x ab', ' '), true, '第一个命中之前夹着空格不算跨分隔符')
  assert.equal(speedSearchMatches('ab', ' x a b', ' '), false, '两个命中之间夹空格才算')
})

// ── ② 哪些字符能吃进串（SpeedSearch.java:25 + :96 + :109-111；树/表一支是 SpeedSearchBase.java:587）──

test('标点表逐字抄上游那 21 个字符，含 `>` 与 `,` 之间那一个空格', () => {
  // SpeedSearch.java:25 `PUNCTUATION_MARKS = "*_-+\"'/.#$>: ,;?!@%^&"`
  assert.equal(SPEED_SEARCH_PUNCTUATION_MARKS, '*_-+"\'/.#$>: ,;?!@%^&')
  assert.equal(SPEED_SEARCH_PUNCTUATION_MARKS.length, 21)
  assert.equal(SPEED_SEARCH_PUNCTUATION_MARKS.includes(' '), true, '表里就带着一个空格')
  assert.equal(SPEED_SEARCH_PUNCTUATION_MARKS.includes('('), false, '括号**不在**表里')
})

test('弹层档：空串上打空格不开搜，已经在搜时空格能接着打（:96 + :109-111）', () => {
  assert.equal(isSpeedSearchTypeable('a', false), true, '字母放行')
  assert.equal(isSpeedSearchTypeable('9', false), true, '数字放行')
  assert.equal(isSpeedSearchTypeable('中', false), true, 'Character.isLetter 是 Unicode 档')
  assert.equal(isSpeedSearchTypeable(' ', false), false, '没压着过滤串时空格不开搜')
  assert.equal(isSpeedSearchTypeable(' ', true), true, '已经在搜了，空格是表里的标点 ⇒ 追加')
  assert.equal(isSpeedSearchTypeable('(', false), false, '不在表里的标点不吃')
  assert.equal(isSpeedSearchTypeable('-', false), true)
  assert.equal(isSpeedSearchTypeable('&', true), true)
})

test('树/表档：空白一律不吃，没有"已经在搜"这个例外（SpeedSearchBase.java:587）', () => {
  assert.equal(isSpeedSearchTypeable(' ', null), false)
  assert.equal(isSpeedSearchTypeable('\t', null), false)
  // 原来 TodoPanel 用的是 `!/^\s$/.test(key)`：只挡 ASCII 空格，制表符与不在表里的括号照样进串。
  assert.equal(isSpeedSearchTypeable('(', null), false, '括号不在 PUNCTUATION_MARKS 里')
  assert.equal(isSpeedSearchTypeable('中', null), true)
})

// ── ③ 退格的两档（SpeedSearch.java:47-51 / :63-70；快捷键注册在 SpeedSearchBase.java:259）──

test('退到词首：一直退到最后一个空白分隔符为止，那一个空白**留着**（:65-67 的 while 条件）', () => {
  assert.equal(speedSearchDeleteToWordStart('ab cd ef'), 'ab cd ', '删掉 ef，停在那个空格前')
  assert.equal(speedSearchDeleteToWordStart('abc'), '', '整串没有空白就一路删空')
  assert.equal(speedSearchDeleteToWordStart('ab '), 'ab ', '末位本身就是空白 ⇒ 一个都不删')
  assert.equal(speedSearchDeleteToWordStart(''), '', '空串上是 :64 那条 if (isHoldingFilter()) 早退')
  // 只认空白，不认表里的别的标点：`a-b` 里那个 `-` 不是分隔符（上游用的是 isWhitespace）。
  assert.equal(speedSearchDeleteToWordStart('a-b c'), 'a-b ', '连字符不算分隔符')
})

// ── ④「下一次输入替换而不是追加」= 搜索框的生命周期，不是计时器 ──

test('框不在场时打的字是**新串**（替换），在场时才追加（:587-589 与 :758 vs SpeedSearch.java:43-45）', () => {
  const opened = speedSearchNextInput({ pattern: '', shown: false }, { kind: 'type', character: 'a' })
  assert.deepEqual(opened, { pattern: 'a', shown: true })
  assert.deepEqual(speedSearchNextInput(opened, { kind: 'type', character: 'b' }), { pattern: 'ab', shown: true })
  assert.equal(speedSearchNextInput({ pattern: 'ab', shown: true }, { kind: 'type', character: 'a' }).pattern, 'aba', '在场时是追加')
})

test('收起即丢串 ⇒ 下一次输入替换（:965-975 + :1059-1061 只有 sticky 才留存）', () => {
  const hidden = speedSearchNextInput({ pattern: 'ab', shown: true }, { kind: 'hide' })
  assert.deepEqual(hidden, { pattern: '', shown: false }, '非 sticky：旧串不留存')
  assert.deepEqual(speedSearchNextInput(hidden, { kind: 'type', character: 'c' }), { pattern: 'c', shown: true }, '不是 "abc"')
  // sticky（表侧过滤档，TableSpeedSearchBase.java:83-85）收起时把串留在状态里；
  // 上游"重新拿到焦点才接回来"那一步住在 SpeedSearchBase.java:194-204，是宿主的事。
  assert.deepEqual(speedSearchNextInput({ pattern: 'ab', shown: true }, { kind: 'hide' }, true), { pattern: 'ab', shown: false })
})

test('Esc 清串并收起（:976-980 → hidePopup:570-573 先 setText("") 再 manageSearchPopup(null)）', () => {
  assert.deepEqual(speedSearchNextInput({ pattern: 'ab', shown: true }, { kind: 'escape' }), { pattern: '', shown: false })
  assert.deepEqual(speedSearchNextInput({ pattern: '', shown: true }, { kind: 'escape' }), { pattern: '', shown: false })
})

test('退格：空串不改串、非空退一格（SpeedSearch.java:47-51）', () => {
  assert.equal(speedSearchNextInput({ pattern: '', shown: true }, { kind: 'backspace' }).pattern, '')
  assert.equal(speedSearchNextInput({ pattern: 'ab', shown: true }, { kind: 'backspace' }).pattern, 'a')
  assert.equal(speedSearchNextInput({ pattern: 'ab cd', shown: true }, { kind: 'deleteWord' }).pattern, 'ab ', '退到词首走的是 :63-70 那一支：停在空格前')
  assert.equal(speedSearchNextInput({ pattern: 'ab', shown: true }, { kind: 'deleteWord' }).pattern, '', '整串没有空白就一路删空')
})

// ── ⑤「输入串 → 命中哪一行」收成一份：一圈的回绕数学只有一处（:476-555 / :519-537）──

test('speedSearchWalk：四个方向 + 端点退化，且回绕数学只在这里', () => {
  // from<0：按方向挑端点，整圈扫。
  assert.equal(speedSearchWalk(3, -1, 1, i => i === 2), 2)
  assert.equal(speedSearchWalk(3, -1, -1, i => i === 0), 0)
  // skipFirst=true：先迈一步再判。
  assert.equal(speedSearchWalk(3, 0, 1, i => i === 0, true), 0, '绕完一圈仍回到它自己')
  assert.equal(speedSearchWalk(3, 0, 1, i => i === 0, false), 0, '含当前行时第一格就中')
  assert.equal(speedSearchWalk(3, 2, 1, i => i === 0, true), 0, '越界回绕')
  assert.equal(speedSearchWalk(0, 0, 1, () => true), -1, '空表给 -1（上游的"一条都没命中"）')
  assert.equal(speedSearchWalk(3, -1, 1, () => false), -1)
})

test('打字那一档把当前行自己也算进候选（findElement:519-527），与方向键那一档不同', () => {
  const labels = ['a', 'x', 'a']
  // 光标停在最后一条命中行上：打字不该把它甩走（上游第一个候选就是选中行本身）。
  assert.equal(speedSearchElement(labels, 'a', 2), 2, 'findElement 含当前行')
  assert.equal(nextSpeedSearchHit(labels, 'a', 2, 1), 0, 'findNextElement 先迈一步 ⇒ 去下一条')
  // 从中间起步：向上包含自己，向下也是。
  assert.equal(speedSearchElement(labels, 'a', 0), 0)
  assert.equal(speedSearchElement(labels, 'a', 1), 2, '当前行不命中就往后找')
  assert.equal(speedSearchElement(labels, 'a', -1), 0, '没有当前项时上游把 selectedIndex 当 0（:520-523）')
  assert.equal(speedSearchElement(labels, '', 2), -1, '空串不选中任何东西')
})

test('first/last/next 三个入口现在都建在同一张 walk 上，结果与改动前逐字一致', () => {
  const labels = ['README.md', 'buildSystem.kt', 'TestRunner.kt']
  assert.equal(firstSpeedSearchHit(labels, 'bs'), 1)
  assert.equal(lastSpeedSearchHit(labels, 'r'), 2, '从尾部起第一个命中')
  assert.equal(nextSpeedSearchHit(labels, 'r', 2, 1), 0, '回绕')
  assert.equal(nextSpeedSearchHit(labels, 'r', 0, -1), 2, '反向回绕')
  assert.equal(firstSpeedSearchHit([], 'bs'), -1)
  assert.equal(lastSpeedSearchHit([], 'bs'), -1)
})

test('speedSearchHitForStep = 各面板原先自己拼的那段三元，四个方向一条不差', () => {
  const labels = ['a', 'ab', 'b', 'ac']
  for (const from of [-1, 0, 1, 2, 3]) {
    assert.equal(speedSearchHitForStep(labels, 'a', from, 'first'), firstSpeedSearchHit(labels, 'a'), `from=${from}`)
    assert.equal(speedSearchHitForStep(labels, 'a', from, 'last'), lastSpeedSearchHit(labels, 'a'), `from=${from}`)
    assert.equal(speedSearchHitForStep(labels, 'a', from, 'next'), nextSpeedSearchHit(labels, 'a', from, 1), `from=${from}`)
    assert.equal(speedSearchHitForStep(labels, 'a', from, 'previous'), nextSpeedSearchHit(labels, 'a', from, -1), `from=${from}`)
  }
  // 书签面板原来把 last 写成 `nextSpeedSearchHit(labels, q, 0, -1)` —— 与 lastSpeedSearchHit 同值，
  // 这里是那条口径的断言（两种写法都得给出同一条命中，收成一份后不会变味）。
  assert.equal(speedSearchHitForStep(labels, 'a', 1, 'last'), nextSpeedSearchHit(labels, 'a', 0, -1))
  assert.equal(speedSearchHitForStep(labels, '', 1, 'next'), -1, '空串一律不跳')
  // 分隔符参数一路透传到命中定位（结构弹层那一站的口径）。
  assert.equal(speedSearchHitForStep(['a b', 'ab'], 'ab', -1, 'first', ' '), 1)
  assert.equal(speedSearchHitForStep(['a b', 'ab'], 'ab', -1, 'first'), 0)
})

test('step 档的四个方向与 speedSearchStepForKey 的映射对得上', () => {
  const labels = ['x', 'a', 'y', 'a2']
  assert.equal(speedSearchHitForStep(labels, 'a', 1, speedSearchStepForKey('ArrowDown').kind), 3)
  assert.equal(speedSearchHitForStep(labels, 'a', 3, speedSearchStepForKey('ArrowUp').kind), 1)
  assert.equal(speedSearchHitForStep(labels, 'a', 3, speedSearchStepForKey('Home').kind), 1)
  assert.equal(speedSearchHitForStep(labels, 'a', 1, speedSearchStepForKey('End').kind), 3)
})

// ── ⑥ SSMATCH 分隔符感知的**另外三档**（`MinusculeMatcherImpl.kt:286-299` 一个函数里就有两条独立档，
//    `:178-180`/`:458` 的通配档，以及 `:65-67` 那颗前导 `*`；上游两处实现互证：
//    `platform/jewel/foundation/.../PatternSpeedSearchMatcher.kt:55-58`/`:190-202`/`:360-364`）──

test('SSMATCH 空格是通配符，不是"要求文本里真有一个空格"（isWildcard :458 + matchWildcards :178-180）', () => {
  // 上游文档注释原话："After a wildcard (* or space)" ⇒ pattern `a b` 与 `a*b` 同一条档。
  assert.equal(speedSearchMatches('a b', 'acb'), true, '通配可以吃掉任意一段，也可以吃零格')
  assert.equal(speedSearchMatches('a b', 'ab'), true, '吃零格也成立（上游通配不要求跳过字符）')
  // 反面对照（防"恒真"）：通配不等于"任意顺序"。
  assert.equal(speedSearchMatches('a b', 'ba'), false, '顺序反了照样不命中')
  assert.equal(speedSearchMatches('a b', 'cb'), false, '第一个字符找不到就不命中')
})

test('SSMATCH 头一个大写不计入 mixedCase（:65-67 那一档：上游靠前导 `*`，本仓靠语句顺序）', () => {
  // 用户打的 `Ab` 到了匹配器那里是 `*Ab` —— 'A' 紧跟通配 ⇒ `seenUpperCaseNotImmediatelyAfterWildcard` 不置位。
  assert.deepEqual(patternSeparatorProfile('Ab'), { hasSeparators: false, mixedCase: false, appliesExemption: false })
  // 对照：小写在前的 `aB` 里那个 'B' 不是紧跟通配 ⇒ 仍算混大小写（上面第 ① 组那条断言口径不变）。
  assert.equal(patternSeparatorProfile('aB').mixedCase, true)
  // 看得见的影响：`Ab` 现在**受**硬分隔符那一档管了（旧写法豁免掉，跨空格的假命中会留在结果里）。
  assert.equal(speedSearchMatches('Ab', 'a b', ' '), false, '大写打头的小驼峰缩写照样不许跨空格')
  assert.equal(speedSearchMatches('Ab', 'Ab', ' '), true, '同一段里照常命中')
})

test('SSMATCH 点号那一档与硬分隔符集无关：pattern 里有 `.` 就不许再跨一个 `.`（:293-297）', () => {
  // 不传 hardSeparators（文件树/书签/日志那些站点的默认档）也一样生效 —— 上游这两条在同一个函数里，
  // 但第二条只看 `myHasDots`（`:51-52`/`:62-64`/`:84`）。
  assert.equal(speedSearchMatches('a.bc', 'a.b.c'), false, '两个 hump 之间多出来的那个点拦掉')
  // 阳性对照（上游后半句："one pattern dot may match several name dots"）：
  // pattern 的上一个字符自己就是 `.` ⇒ 这一个点正在吃连续的 name 点，放行。
  assert.equal(speedSearchMatches('a.b', 'a..b'), true, '一个 pattern 点可以吃两个 name 点')
  assert.equal(speedSearchMatches('a.b.c', 'a.b.c'), true, '逐点对齐的常规用法不许被误伤')
  // pattern 里没有点 ⇒ 这一档整条不存在（不许顺手拦掉别的东西）。
  assert.equal(speedSearchMatches('abc', 'a.b.c'), true, '没打点就不查点号')
})

test('SSMATCH pattern 里的通配让这一段检查整段跳过：`a*b` 能跨硬分隔符，`ab` 不能（:216-224 allowSpecialChars=true）', () => {
  // `*` 在 `SPEED_SEARCH_PUNCTUATION_MARKS` 里（是打得进搜索框的字符），所以这一档用户能直接触发。
  assert.equal(speedSearchMatches('a*b', 'a b', ' '), true, '通配之后那一跳不查分隔符')
  assert.equal(speedSearchMatches('ab', 'a b', ' '), false, '紧挨着的两个字符才查')
})

test('SSMATCH 命中集合跟着点号那一档走（firstSpeedSearchHit / speedSearchHitForStep）', () => {
  const labels = ['a.b.c', 'a.bc']
  assert.equal(firstSpeedSearchHit(labels, 'a.bc'), 1, '第一条命中的是贴着写的那一枚')
  assert.equal(speedSearchHitForStep(labels, 'a.bc', 0, 'last'), 1, '从尾往前扫也是它')
  assert.equal(speedSearchHitForStep(labels, 'a.bc', 1, 'next'), 1, '绕一圈回到自己（唯一命中）')
  // 两档**互不相干**，这一条把它们各自的边界钉住：
  // ① pattern 里打了 `.` ⇒ `isWordSeparator('.')` 为真（`:505-507`）⇒ `hasSeparators` ⇒
  //    硬分隔符那一档整条豁免（`:290` 的 `!myHasSeparators`），空格的拦截让位。
  assert.equal(speedSearchMatches('a.bc', 'a.b c', ' ()'), true, 'pattern 自己带分隔符 ⇒ 硬分隔符档豁免')
  // ② 同一个文本、pattern 不带点 ⇒ 硬分隔符档回来（而点号档因为 pattern 没点，整条不存在）。
  assert.equal(speedSearchMatches('abc', 'a.b c', ' ()'), false, '不带点时空格照样拦')
})

// ── ⑦ SSMATCH「退格退到空串」那一档：上游**没有计时器**，只有"同步 + 注册表开关"（
//    SpeedSearchBase.java:890-894 + registry.properties:106-107，默认 false）──

test('SSMATCH 默认档：退空即停过滤、框不收（= 上游注册表默认 false）', () => {
  assert.deepEqual(speedSearchNextInput({ pattern: 'a', shown: true }, { kind: 'backspace' }), { pattern: '', shown: true })
  // 空串上继续退格：不改串、不收框（SpeedSearchBase.java:960-962 那一档只吞键）。
  assert.deepEqual(speedSearchNextInput({ pattern: '', shown: true }, { kind: 'backspace' }), { pattern: '', shown: true })
})

test('SSMATCH 开关档（ide.speed.search.close.when.empty=true）：退到空串那一下同步收起', () => {
  assert.deepEqual(speedSearchNextInput({ pattern: 'a', shown: true }, { kind: 'backspace' }, false, true), { pattern: '', shown: false })
  // 退到词首那一条（Ctrl+Backspace，SpeedSearch.java:63-70 的 while 一路退到空白）也算"结果串为空"。
  assert.deepEqual(speedSearchNextInput({ pattern: 'ab', shown: true }, { kind: 'deleteWord' }, false, true), { pattern: '', shown: false })
  // 结果串非空 ⇒ 不收（查的是 Strings.isEmpty(pattern)，不是"这一键删了什么"）。
  assert.deepEqual(speedSearchNextInput({ pattern: 'ab', shown: true }, { kind: 'backspace' }, false, true), { pattern: 'a', shown: true })
  assert.deepEqual(speedSearchNextInput({ pattern: 'ab cd', shown: true }, { kind: 'deleteWord' }, false, true), { pattern: 'ab ', shown: true })
  // 框本来不在场 ⇒ 没什么可收，状态原样。
  assert.deepEqual(speedSearchNextInput({ pattern: '', shown: false }, { kind: 'backspace' }, false, true), { pattern: '', shown: false })
  // 收起之后下一次输入走"替换"那一档（:587-589 + :758）。
  assert.deepEqual(speedSearchNextInput({ pattern: '', shown: false }, { kind: 'type', character: 'c' }), { pattern: 'c', shown: true })
  // sticky 与这一档互不相干：sticky 管的是"收起后旧串留不留"（:1059-1061）。
  assert.deepEqual(speedSearchNextInput({ pattern: 'a', shown: true }, { kind: 'hide' }, true), { pattern: 'a', shown: false })
})

test('SSMATCH 大写字母落点有四条放行（seemsLikeFragmentStart:301-314），旧写法只搬了第③条', () => {
  // ④ pattern 里没有小写（mixedCase=false）⇒ 大写可以落在词中：`:308` 的注释
  // "accept uppercase matching lowercase if the whole prefix is uppercase"。
  assert.equal(speedSearchMatches('C', 'abc'), true, '全大写 pattern 不要求词首')
  assert.equal(speedSearchMatches('AC', 'abc'), true, '两颗大写同样不要求')
  // 阳性对照：pattern 混了大小写 ⇒ 词首那一条回来（与文件头第 13-20 行那组断言同口径，不许动）。
  assert.equal(speedSearchMatches('aC', 'abc'), false, '混大小写时词中小写不算词首')
  // ② 文本那一格自己是大写就放行（:303）：`bA` 撞 `fooBARS` 里那个 'A'，
  // 它前面是 'B'（本仓 isWordStartAt 给假），但 name 自己大写 ⇒ 上游照样算。
  assert.equal(isWordStartAt('fooBARS', 4), false, '先钉住"第③条这里给假"')
  assert.equal(speedSearchMatches('bA', 'fooBARS'), true, '靠第②条放行')
  assert.equal(speedSearchMatches('bA', 'fooBar'), false, 'name 那格是小写 ⇒ ②③④ 全假 ⇒ 不命中')
})
