// 参数提示的**排除列表**这一档（`src/inlayHintExcludeList.ts` + `src/inlayHintLayout.ts` 的过滤链）。
//
// 上游依据（逐行开树核过，坐标与结论见 docs/batch-2026-10-06-inlayparams.md §1）：
//   · 判定入口 `platform/lang-impl/src/com/intellij/codeInsight/hints/parameters/ParameterHintExcludeListService.kt:93-105`
//     （`isExcluded(fullyQualifiedName, parameterNames, language)`；清单经 `mapNotNull { MatcherConstructor.createMatcher(it) }`
//      编译，坏模式**静默作废**）；
//   · 模式文法 `platform/platform-impl/src/com/intellij/codeInsight/hints/filtering/MethodMatcher.kt:53-106`
//     与 glob `…/filtering/StringMatcherBuilder.kt:28-61`；
//   · 存储是「默认清单 + added/removed 差量」`platform/lang-api/src/com/intellij/codeInsight/hints/settings/ParameterNameHintsSettings.kt:26-45`，
//     折算点 `platform/lang-impl/src/com/intellij/codeInsight/hints/HintUtils.kt:87-90`；
//   · 编辑形状（一行一条 + 坏行标红 + 存差量后刷新）`platform/lang-impl/src/com/intellij/codeInsight/hints/ExcludeListPanel.kt:98-123`。
//
// 本仓的口径差（不是放松，是 LSP 与 PSI 的差别，逐条写在模块头与报告 §5）：
//   主题只有提示文本本身 ⇒ 同一条 glob 套在方法名位与参数名位；多参数形态在本仓恒不匹配；出厂默认清单为空。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PARAMETER_HINT_EXCLUDE_LIST, applyExcludeListDiff, buildExcludeListDiff, compileExcludePatterns,
  createExcludeGlob, createExcludePatternMatcher, invalidExcludePatternLines, normalizeParameterHintLabel,
  parseExcludeListText, renderExcludeListText,
} from '../src/inlayHintExcludeList.ts'
import { inlayHintToggles, inlayHintTogglesKey, INLAY_HINT_EXCLUDE_LIST_SETTING_KEY } from '../src/inlayHints.ts'
import { hiddenInlayCount, layoutInlayHints } from '../src/inlayHintLayout.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const hint = (line, character, label, kind) => ({ line, character, label, kind })

test('glob 文法与上游 StringMatcherBuilder 逐条对齐（含"星号位置不合法就整条作废"）', () => {
  assert.equal(createExcludeGlob('')('anything'), true, '上游 :29 空串 = 恒真')
  assert.equal(createExcludeGlob('*')('anything'), true, '上游 :41 单星 = 恒真')
  assert.equal(createExcludeGlob('key')('key'), true)
  assert.equal(createExcludeGlob('key')('Key'), false, '上游 :38 是精确相等（大小写敏感），不是 equalsIgnoreCase')
  assert.equal(createExcludeGlob('key')('keyX'), false)
  assert.equal(createExcludeGlob('*Exception')('MyException'), true, '上游 :45-48 首星 = 后缀')
  assert.equal(createExcludeGlob('*Exception')('ExceptionX'), false)
  assert.equal(createExcludeGlob('get*')('getValue'), true, '上游 :50-53 尾星 = 前缀')
  assert.equal(createExcludeGlob('get*')('xgetValue'), false)
  assert.equal(createExcludeGlob('a*b'), null, '上游 :50-60：星号既不在首也不在尾 ⇒ 整条 null（不是通配）')
  assert.equal(createExcludeGlob('*get*')('a.get(b)'), true, '上游 :55-58 首尾各一星 = 包含')
  assert.equal(createExcludeGlob('*get*')('set'), false)
  assert.equal(createExcludeGlob('**')('anything'), true, '上游 :55-58：`**` 也走"包含空串"⇒ 恒真（不是 null）')
  assert.equal(createExcludeGlob('a*b*c'), null, '上游 :35 星号多于 2 个 ⇒ null')
  assert.equal(createExcludeGlob('a*b'), null, '中间有星、首尾都没有 ⇒ 上游 :60 兜底 null')
})

test('模式解析与上游 MatcherConstructor 逐条对齐（括号切分 / arity / 坏模式 null）', () => {
  const methodOnly = createExcludePatternMatcher('key')
  assert.ok(methodOnly)
  assert.equal(methodOnly.isMatching('key', []), true, '上游 :100：无括号 ⇒ 参数侧 AnyParamMatcher')
  assert.equal(methodOnly.isMatching('key2', []), false)

  const paramsOnly = createExcludePatternMatcher('(key)')
  assert.ok(paramsOnly, '上游 :63-66：开头就是括号 ⇒ 方法侧空串（恒真）')
  assert.equal(paramsOnly.isMatching('anything', ['key']), true)
  assert.equal(paramsOnly.isMatching('anything', ['value']), false)
  assert.equal(paramsOnly.isMatching('anything', ['key', 'value']), false, '上游 StringParamMatcher:35-37：arity 不等就不匹配')

  const both = createExcludePatternMatcher('*.get(key)')
  assert.ok(both)
  assert.equal(both.isMatching('map.get', ['key']), true)
  assert.equal(both.isMatching('map.put', ['key']), false)
  assert.equal(both.isMatching('map.get', ['value']), false)

  assert.equal(createExcludePatternMatcher(''), null, '上游 :57 trim 后空串 ⇒ null')
  assert.equal(createExcludePatternMatcher('   '), null)
  assert.equal(createExcludePatternMatcher('(key'), null, '上游 getParamsMatcher:74-83：有左括号没右括号 ⇒ null')
  assert.equal(createExcludePatternMatcher('()'), null, '上游 :86 paramsMatcher.length <= 2 ⇒ null')
  assert.equal(createExcludePatternMatcher('(key,)'), null, '上游 :90：列表里有空项 ⇒ null')
  assert.equal(createExcludePatternMatcher('(a*b*c)'), null, '参数位上的坏 glob 也整条作废（上游 :92-93 数量不等 ⇒ null）')
  assert.equal(createExcludePatternMatcher('a*b*c(key)'), null)
})

test('坏行号 = 上游 getExcludeListInvalidLineNumbers 的口径（空行跳过、行号从 0 起）', () => {
  assert.deepEqual(invalidExcludePatternLines('key\n(bad\n*\nget*'), [1], '第二行的括号模式编译不了')
  assert.deepEqual(invalidExcludePatternLines('key\nvalue'), [], '全合法 ⇒ 没有标红行')
  assert.deepEqual(invalidExcludePatternLines('a*b*c'), [0])
})

test('存储是「默认清单 + added/removed 差量」，不是全量（上游 Diff）', () => {
  const base = ['key', 'value']
  const updated = ['value', 'message']
  const diff = buildExcludeListDiff(base, updated)
  assert.deepEqual([...diff.added].sort(), ['message'])
  assert.deepEqual([...diff.removed].sort(), ['key'])
  assert.deepEqual(applyExcludeListDiff(base, diff).sort(), ['message', 'value'], '上游 applyOn：先加后删')
  assert.deepEqual(applyExcludeListDiff(base, { added: [], removed: [] }), base, '没改过 ⇒ 就是默认清单')
  assert.deepEqual(buildExcludeListDiff(base, base), { added: [], removed: [] }, '改回原样 ⇒ 差量为空（不写全量）')
})

test('清单文本 ⇄ 数组：一行一条、丢空行（上游 ExcludeListPanel 的编辑框）', () => {
  assert.deepEqual(parseExcludeListText(' key \n\n  \nvalue\n'), ['key', 'value'])
  assert.equal(renderExcludeListText(['key', 'value']), 'key\nvalue')
  assert.deepEqual(parseExcludeListText(''), [])
})

test('出厂默认清单是空的，且这一条要**明说**（上游默认全是方法 FQN 形态，本仓主题没有 FQN）', () => {
  assert.deepEqual([...DEFAULT_PARAMETER_HINT_EXCLUDE_LIST], [],
    '上游默认清单（JavaInlayParameterHintsProvider.kt:67-… / KtParameterHintsProvider.kt:449-…）是方法 FQN 形态，'
    + '本仓主题是提示文本 ⇒ 搬进来就是"看着有默认值、实际恒不匹配"的假数据，所以取空（报告 §1.3、§5）')
})

test('提示文本的主题化：去掉 LSP 的分隔符，大小写照旧敏感', () => {
  assert.equal(normalizeParameterHintLabel('key:'), 'key')
  assert.equal(normalizeParameterHintLabel('key='), 'key')
  assert.equal(normalizeParameterHintLabel('  key  '), 'key')
  assert.equal(normalizeParameterHintLabel('a:b'), 'a:b', '只剥**尾部一个**分隔符，中间的不动')
  assert.equal(normalizeParameterHintLabel('Key:'), 'Key')
})

test('编译后的判定：坏模式静默丢弃、非字符串忽略、空清单恒假', () => {
  assert.equal(compileExcludePatterns([])('key'), false)
  assert.equal(compileExcludePatterns(undefined)('key'), false)
  const mixed = compileExcludePatterns(['a*b*c', 'key', 42, '', '(message)'])
  assert.equal(mixed('key:'), true, '合法条目生效')
  assert.equal(mixed('message='), true, '参数名形态也生效')
  assert.equal(mixed('other:'), false)
  assert.equal(mixed(''), false, '空文本不参与匹配（否则恒真 glob 会把所有提示藏掉）')
  assert.equal(mixed(null), false)
  assert.equal(compileExcludePatterns(['*'])('anything'), true, '单星 = 全藏（上游的"清空这一族"写法）')
})

test('归位链里那一档：只藏参数提示，类型/其它照旧，计数进 hidden.exclude', () => {
  const toggles = { type: true, parameter: true, other: true, parameterHintExcludeList: ['key', '(value)'] }
  const result = layoutInlayHints([
    hint(0, 0, 'key:', 2), hint(0, 5, 'value:', 2), hint(0, 9, 'int', 1), hint(0, 13, 'hidden', 1),
    hint(0, 17, 'tip'), hint(1, 0, 'key', 1),
  ], toggles)
  assert.deepEqual(result.hints.map(item => item.label), ['int', 'hidden', 'tip', 'key'])
  assert.equal(result.hidden.exclude, 2, '两条参数提示被清单藏掉')
  assert.equal(result.hidden.toggle, 0, '开关一档没动')
  assert.equal(hiddenInlayCount(result), 2, '总数里要算上这一档，否则"谁被藏了"看不见')
  // 上游那份清单就叫 parameter hints exclude list（`settings.inlay.parameter.hints.exclude.list`）：
  // 同名 label 的**类型**提示不受它管辖（第 4 行末尾那条 `key` 是 kind=1）。
  assert.equal(result.hints.some(item => item.label === 'key' && item.kind === 1), true, '类型提示被参数清单误藏')
})

test('清单为空 / 缺项 ⇒ 这一档完全不影响旧行为', () => {
  const hints = [hint(0, 0, 'key:', 2), hint(0, 5, 'int', 1)]
  assert.deepEqual(layoutInlayHints(hints).hints.map(item => item.label), ['key:', 'int'])
  assert.deepEqual(layoutInlayHints(hints, { type: true, parameter: true, other: true }).hints.map(item => item.label), ['key:', 'int'],
    '老调用点没传清单（InlayHintToggles 的那个字段是可选的）⇒ 不排除任何东西')
  assert.equal(layoutInlayHints(hints, { type: true, parameter: true, other: true, parameterHintExcludeList: ['a*b*c'] }).hidden.exclude, 0,
    '全是坏模式 ⇒ 一条都不藏（上游 mapNotNull）')
})

test('读侧：清单从设置键折算进来，坏值不崩，且改清单会变比较键（同一条重画链）', () => {
  assert.equal(INLAY_HINT_EXCLUDE_LIST_SETTING_KEY, 'parameterHintExcludeList')
  assert.deepEqual([...inlayHintToggles({ [INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]: ['key', 'value'] }).parameterHintExcludeList], ['key', 'value'])
  assert.deepEqual(inlayHintToggles({ [INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]: 'key' }).parameterHintExcludeList, [], '不是数组 ⇒ 整个忽略')
  assert.deepEqual(inlayHintToggles({ [INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]: ['key', 7, '  '] }).parameterHintExcludeList, ['key'], '非字符串与空条目丢掉')
  assert.equal(inlayHintTogglesKey(inlayHintToggles({})), 'true,true,true', '空清单不追加后缀 ⇒ 老 state 不会每拍重画')
  assert.notEqual(inlayHintTogglesKey(inlayHintToggles({ [INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]: ['key'] })), inlayHintTogglesKey(inlayHintToggles({})),
    '清单变了比较键就要变 —— 上游是"存完差量立刻刷新提示"（ExcludeListPanel.kt:122）')
})

test('消费链与"不放假控件"：过滤只有一处、编辑器那一拍带清单、页面仍不渲染排除控件', () => {
  // ① 过滤链：排除那一档必须在开关之后、进 valid 之前，且只对参数组生效。
  const layout = read('src/inlayHintLayout.ts')
  assert.match(layout, /if \(!shouldShowInlayHint\(hint, toggles\)\) \{ \+\+hidden\.toggle; continue \}\n\s*if \(inlayHintGroup\(hint\.kind\) === 'parameter' && excluded\(hint\.label\)\) \{ \+\+hidden\.exclude; continue \}/,
    '排除必须紧跟在开关过滤之后、且在 valid.push 之前（放到别处就是"数了却没藏"）')
  assert.match(layout, /const excluded = compileExcludePatterns\(toggles\.parameterHintExcludeList\)/, '清单在归位入口编译一次（上游 getMatchers 的缓存口径）')
  // ② 编辑器那一拍：控制器把 toggles 整份交给归位 ⇒ 清单顺着同一条链落到渲染前（不改冻结的 CodeEditor.vue）。
  const host = read('src/editorInlayHints.ts')
  assert.match(host, /const layout = layoutInlayHints\(stored\.map\(item => item\.highlightingInfo\), toggles, \{ maxPerLine: NO_INLAY_HINT_LINE_LIMIT \}\)/)
  assert.match(host, /const toggles = deps\.toggles\?\.\(\) \?\? DEFAULT_INLAY_HINT_TOGGLES/)
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /toggles: \(\) => inlayHintToggles\(props\.settings\)/, '编辑器把整份设置折成 toggles —— 清单键登记后无需改这一行')
  assert.match(editor, /watch\(\(\) => inlayHintTogglesKey\(inlayHintToggles\(props\.settings\)\), \(\) => inlayHints\.schedule\(\)\)/)
  // ③ 设置页**不放**排除控件：那把键还没进 `src/settingsModel.ts` 与 native 键表（六处成对，本 lane 禁写那些文件）。
  //    放上就是一个写了不记账、重启就没的假控件 ⇒ 登记原因，等接线（报告 §6）。
  const page = read('src/components/InlayHintsSettingsPage.vue')
  for (const label of ['排除', 'Exclude', '排除清单'])
    assert.ok(!new RegExp(`<span>\\s*${label}`).test(page), `${label} 在键登记之前不该被渲染成控件（假控件）`)
  assert.match(page, /排除清单/, '页面注释里要写清这一档为什么还没上（不是"忘了"）')
  assert.match(page, /ParameterHintsSettingsPanel\.kt:18-22/, '页面注释要给出上游那一格的坐标')
})
