// cs/settings 的判据：`.editorconfig` 的解析、层级合并、键 → 缩进选项映射
// （`EditorConfigPropertiesService.kt` / `EditorConfigIndentOptionsProvider.kt` / `Utils.kt`），
// 以及「每份文件生效的缩进」这条链与 `LspFormattingService.kt:119-125` 的接线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  configValueForKey, editorConfigDirsFor, editorConfigPatternToRegExp, editorConfigSectionMatches,
  indentOptionsFromEditorConfig, mergeEditorConfigs, parseEditorConfig, relevantEditorConfigsFor,
  EditorConfigParseError,
} from '../src/editorConfig.ts'
import {
  codeStyleToggles, indentOptionsFromSettings, makeEditorConfigReader, resolveIndentOptions, setCodeStyleToggles,
  toEditorConfigText,
} from '../src/codeStyleSettings.ts'
import { detectIndentOptions, IndentUsageStatistics, lineIndentInfos } from '../src/indentDetection.ts'
import { canInsertSpaceInLineComment, processLineCommentAddSpace } from '../src/postFormatProcessors.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = name => readFileSync(join(here, '..', 'src', name), 'utf8')

const BASE = { indentSize: 4, continuationIndentSize: 4, tabSize: 4, useTabCharacter: false }

// ------------------------------------------------------------------ .editorconfig 解析

test('parseEditorConfig：section、键小写、root=true、注释与 ; 注释（Utils.kt:45 / EditorConfigSettings.java:12）', () => {
  const parsed = parseEditorConfig([
    '# 一段注释', '; 另一种注释', 'root = true', '',
    '[*.{js,ts}]', 'indent_size = 2', '; 行内注释', 'indent_style = space',
    '[*]', 'TAB_WIDTH = 8', 'indent_size=  3  ',
  ].join('\n'))
  assert.equal(parsed.isRoot, true)
  assert.equal(parsed.sections.length, 2)
  assert.equal(parsed.sections[0].pattern, '*.{js,ts}')
  // 键一律小写（`indent_size=  3  ` 那个没有空格也要能读）
  assert.deepEqual(parsed.sections[0].properties, { indent_size: '2', indent_style: 'space' })
  assert.deepEqual(parsed.sections[1].properties, { tab_width: '8', indent_size: '3' })
})

test('parseEditorConfig：语法错误照旧抛出（对应上游 ParseException → InvalidEditorConfig）', () => {
  assert.throws(() => parseEditorConfig('[a.py\nx = 1'), EditorConfigParseError)
  assert.throws(() => parseEditorConfig('[a.py]\nno_equals_sign'), EditorConfigParseError)
  assert.throws(() => parseEditorConfig('[a.py]\n= 1'), EditorConfigParseError)
  // 属性出现在任何 section 之前 = 非法
  assert.throws(() => parseEditorConfig('indent_size = 2'), EditorConfigParseError)
  // section 头是空的
  assert.throws(() => parseEditorConfig('[]'), EditorConfigParseError)
  // 合法的空文件不算错
  assert.deepEqual(parseEditorConfig(''), { isRoot: false, sections: [] })
})

test('configValueForKey：none / unset 一律当空串（Utils.kt:53,61-64）', () => {
  assert.equal(configValueForKey({ indent_size: '  4 ' }, 'indent_size'), '4')
  assert.equal(configValueForKey({ indent_size: 'unset' }, 'indent_size'), '')
  assert.equal(configValueForKey({ indent_size: 'none' }, 'indent_size'), '')
  assert.equal(configValueForKey({ indent_size: 'NONE' }, 'indent_size'), '')
  assert.equal(configValueForKey({}, 'indent_size'), '')
})

// ------------------------------------------------------------------ section 头的 glob

test('editorConfigSectionMatches：* 不跨目录、** 跨、? 单字符、字符类、花括号（basic.json 之外的规范子集）', () => {
  // ⚠️ 模式里**不含 `/`** 时上游会补 `**/` 前缀，所以 `*.py` 也匹配 `src/main.py`：
  //    `EditorConfigAutomatonBuilder.kt:96-100`（`var prefix = "**/"`，仅当模式含 `/` 才换成目录路径）
  //    与 `EditorConfigAutomatonBuilder.kt:85`（`sanitizeGlob` 里同一份逻辑）两处独立证据。
  // 模式**含** `/` 时才不跨目录（`src/*.ts` 不匹配 `src/nested/a.ts`）。
  assert.equal(editorConfigSectionMatches('*.py', 'main.py'), true)
  assert.equal(editorConfigSectionMatches('*.py', 'src/main.py'), true)   // 补了 `**/`
  assert.equal(editorConfigSectionMatches('**/*.py', 'src/deep/main.py'), true)
  assert.equal(editorConfigSectionMatches('src/*.ts', 'src/a.ts'), true)
  assert.equal(editorConfigSectionMatches('src/*.ts', 'src/nested/a.ts'), false)
  assert.equal(editorConfigSectionMatches('a?c.py', 'abc.py'), true)
  assert.equal(editorConfigSectionMatches('a?c.py', 'abbc.py'), false)
  assert.equal(editorConfigSectionMatches('[abc].py', 'b.py'), true)
  assert.equal(editorConfigSectionMatches('[!abc].py', 'b.py'), false)
  assert.equal(editorConfigSectionMatches('*.{js,ts}', 'a.ts'), true)
  assert.equal(editorConfigSectionMatches('*.{js,ts}', 'a.py'), false)
  assert.equal(editorConfigSectionMatches('x{1..3}.txt', 'x2.txt'), true)
  assert.equal(editorConfigSectionMatches('x{1..3}.txt', 'x4.txt'), false)
  // 模式里没有 `/` 时对任意层级目录生效
  assert.equal(editorConfigPatternToRegExp('*.py').test('a/b/c.py'), true)
  assert.equal(editorConfigPatternToRegExp('src/*.py').test('other/src/a.py'), false)
})

// ------------------------------------------------------------------ 层级查找与合并

test('editorConfigDirsFor：从文件所在目录往上，不越过工作区根（EditorConfigPropertiesService.kt:78-82）', () => {
  assert.deepEqual(editorConfigDirsFor('src/a/b.py', ''), ['src/a', 'src', ''])
  assert.deepEqual(editorConfigDirsFor('src/a/b.py', 'src'), ['src/a', 'src'])
  assert.deepEqual(editorConfigDirsFor('a.py', 'a.py'), [''])
})

test('relevantEditorConfigsFor：坏文件与 root=true 都停止往上找（EditorConfigPropertiesService.kt:84-111）', () => {
  const files = {
    'src/a': parseEditorConfig('[*.py]\nindent_size = 2'),
    src: parseEditorConfig('root = true\n[*.py]\nindent_size = 8'),
  }
  const read = dir => { if (!(dir in files)) return null; return files[dir] }
  // 近的那份没有 root ⇒ 继续往上，两份都参与。
  assert.deepEqual(relevantEditorConfigsFor('src/a/b.py', read).map(item => item.dir), ['src/a', 'src'])

  // 近的那份带 root ⇒ 停。
  const withRoot = { ...files, 'src/a': parseEditorConfig('root = true\n[*.py]\nindent_size = 2') }
  assert.deepEqual(
    relevantEditorConfigsFor('src/a/b.py', dir => (dir in withRoot ? withRoot[dir] : null)).map(i => i.dir),
    ['src/a'])

  // 近的那份坏掉 ⇒ 整个查找停在上层之前（`is InvalidEditorConfig -> break`）。
  assert.deepEqual(
    relevantEditorConfigsFor('src/a/b.py', dir => { if (dir === 'src/a') throw new Error('bad'); return read(dir) }),
    [])
})

test('mergeEditorConfigs：离文件最近的赢，同一文件里后面的 section 赢（EditorConfigPropertiesService.kt:144-162）', () => {
  const configs = [
    // section 头 `[*]` 的方括号是 **editorconfig 的 section 语法**，不是字符类 ——
    // `parseEditorConfig`（`src/editorConfig.ts:159` 的 `line.slice(1, -1)`）会剥掉首尾方括号，
    // 传给匹配器的 glob 就是 `*`，所以 `[*]` 正是「任意文件」这一节。
    { dir: 'src', parsed: parseEditorConfig('[*]\nindent_size = 8\nindent_style = space') },
    { dir: 'src/a', parsed: parseEditorConfig('[*.py]\nindent_size = 2') },
  ]
  const merged = mergeEditorConfigs('src/a/b.py', configs)
  assert.equal(merged.indent_size, '2')   // 近层覆盖远层
  assert.equal(merged.indent_style, 'space')  // 远层没被这条覆盖，留着
  // 相对路径算的是「相对 .editorconfig 所在目录」（FileUtil.getRelativePath，:148-153）
  assert.equal(mergeEditorConfigs('src/a/b.py', configs.slice(0, 1)).indent_size, '8')
})

// ------------------------------------------------------------------ 键 → 缩进选项

test('indentOptionsFromEditorConfig：逐个键的计算（EditorConfigIndentOptionsProvider.kt:113-155）', () => {
  // `indent_size = "tab"` 时上游**设的是 INDENT_SIZE，不是 TAB_SIZE**：
  //   `calculateIndentSize`（`EditorConfigIndentOptionsProvider.kt:113-115`）
  //     = `if (indentSize == "tab") tabWidth.ifEmpty { options.TAB_SIZE.toString() } else indentSize`
  //   `calculateContinuationIndentSize`（`:117-118`）= `continuationIndentSize.ifEmpty { indentSize }`
  // `tab_width` 缺省 ⇒ 取既有 TAB_SIZE（6）；缺省的 continuation 继承 indent_size。
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_size: 'tab' }, { tabSize: 6 }),
    { indentSize: 6, continuationIndentSize: 6 })
  // 显式 tab_width=3：`calculateIndentSize` = `tabWidth.ifEmpty{TAB_SIZE}` = "3"（:113-115）；
  // 而 `calculateContinuationIndentSize` 的**第一实参是算完的 indentSize**（:76
  // `calculateContinuationIndentSize(calculatedIndentSize, continuationIndentSize)`），
  // 所以缺省的 continuation 继承 3 而不是留空；`calculateTabWidth` 有 tab_width ⇒ 3（:120-129）。
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_size: 'tab', tab_width: '3' }, { tabSize: 6 }),
    { indentSize: 3, continuationIndentSize: 3, tabSize: 3 })
  // tab_width 缺省时取 indent_size（:120-129）；continuation 缺省同样继承算完的 indent_size（:76 + :117-118）
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_size: '2' }, { tabSize: 6 }),
    { indentSize: 2, continuationIndentSize: 2, tabSize: 2 })
  // continuation 缺省继承 indent_size 算出来的值（:117-118）
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_size: '2', continuation_indent_size: '6' }, { tabSize: 4 }),
    { indentSize: 2, continuationIndentSize: 6, tabSize: 2 })
  // indent_style 决定 USE_TAB_CHARACTER，其它值算不出（:149-155）
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_style: 'tab' }, { tabSize: 4 }), { useTabCharacter: true })
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_style: 'space' }, { tabSize: 4 }), { useTabCharacter: false })
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_style: 'bogus' }, { tabSize: 4 }), {})
  // 非正整数 / 非数字一律算不出（toIntOrNull + 正数校验，:131-147）
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_size: 'x' }, { tabSize: 4 }), {})
  assert.deepEqual(indentOptionsFromEditorConfig({ indent_size: '0' }, { tabSize: 4 }), {})
  // 一条都没覆盖 ⇒ 空对象（对应上游 return null，:64-68）
  assert.deepEqual(indentOptionsFromEditorConfig({}, { tabSize: 4 }), {})
})

// ------------------------------------------------------------------ 按内容探测

test('lineIndentInfos / IndentUsageStatistics：相对缩进与亲本栈（IndentUsageStatisticsImpl.java:47-92）', () => {
  const infos = lineIndentInfos(['a = 1', '  b = 2', '    c = 3', '  d = 4', ''].join('\n'))
  assert.deepEqual(infos.map(i => [i.kind, i.indentSize]), [['normal', 0], ['normal', 2], ['normal', 4], ['normal', 2]])
  const stats = new IndentUsageStatistics(infos)
  assert.equal(stats.totalLinesWithLeadingTabs, 0)
  assert.equal(stats.totalLinesWithLeadingSpaces, 3)   // currentIndent > 0 才计（:89-91）
  // 直方图按**相对缩进**计数，不是绝对缩进（`IndentUsageStatisticsImpl.handleNormalIndent`，
  //   `EditorConfigIndentOptionsProvider` 之外的 `platform/lang-impl/.../IndentUsageStatisticsImpl.java:68-92`）：
  //   `relativeIndent = currentIndent - myPreviousLineIndent`（:69），负则回退到亲本栈重算（:70-75），
  //   为 0 则沿用上一次（:77-79），否则压入亲本栈（:81）；最后 `myIndentToUsagesMap.addTo(relativeIndent, 1)`（:84）。
  // 这段文本逐行：0 → +2 → +2 →（2 比 4 小，回退到亲本栈的 2）0，沿用上次的 2。
  // 所以**相对**缩进 2 记了 3 次（第 2/3/4 行），不是按绝对缩进数的 2 次。
  assert.equal(stats.kMostUsedIndentInfo(0).indentSize, 2)
  assert.equal(stats.kMostUsedIndentInfo(0).timesUsed, 3)
  assert.equal(stats.totalIndentSizesDetected, 2)   // 相对缩进只有 {0, 2} 两种
})

test('detectIndentOptions：探测出 2 格缩进（IndentOptionsAdjusterImpl.java:54-76）', () => {
  const text = ['a = 1', '  b = 2', '    c = 3', '  d = 4', '    e = 5', '    f = 6', '    g = 7', '    h = 8'].join('\n')
  const detected = detectIndentOptions({ text, options: { ...BASE } })
  assert.equal(detected.indentSize, 2)
  assert.equal(detected.useTabCharacter, false)
})

test('detectIndentOptions：制表符优先（adjustForTabUsage，:34-42）', () => {
  const text = ['\ta = 1', '\t\tb = 2', '\tc = 3', '\t\td = 4'].join('\n')
  const detected = detectIndentOptions({ text, options: { ...BASE } })
  assert.equal(detected.useTabCharacter, true)
  // 本来就是制表符 ⇒ 原样返回，缩进宽度不动
  const already = detectIndentOptions({ text, options: { ...BASE, useTabCharacter: true } })
  assert.equal(already.indentSize, 4)
})

test('detectIndentOptions：行数 < 3 或超大文件不探测（IndentOptionsDetectorImpl.java:71-72,93-98）', () => {
  assert.equal(detectIndentOptions({ text: 'a\n  b', options: { ...BASE } }), null)
  assert.equal(detectIndentOptions({ text: 'a\n  b\n  c', options: { ...BASE, autodetect: undefined } }) !== null, true)
  assert.equal(detectIndentOptions({ text: 'x'.repeat(1024 * 1024 + 1), options: { ...BASE } }), null)
  // 开关关掉
  assert.equal(detectIndentOptions({ text: 'a\n  b\n  c', options: { ...BASE }, enabled: false }), null)
})

// ------------------------------------------------------------------ 每份文件的生效缩进

test('resolveIndentOptions：整文件重排不吃按内容探测，选区重排吃（DetectableIndentOptionsProvider.java:90-92）', async () => {
  const twoSpace = ['a = 1', '  b = 2', '    c = 3', '  d = 4', '    e = 5', '    f = 6', '    g = 7', '    h = 8'].join('\n')
  const full = await resolveIndentOptions({ path: 'x.py', text: twoSpace, base: BASE, isFullReformat: true })
  assert.equal(full.options.indentSize, 4)   // 保持全局设置
  assert.equal(full.detected, false)

  const range = await resolveIndentOptions({ path: 'x.py', text: twoSpace, base: BASE, isFullReformat: false })
  assert.equal(range.options.indentSize, 2)
  assert.equal(range.detected, true)
})

test('resolveIndentOptions：.editorconfig 覆盖前面的所有层（整文件重排也吃）', async () => {
  const reader = makeEditorConfigReader(async path => {
    if (path === '.editorconfig') return { content: 'root = true\n[*.py]\nindent_size = 3\nindent_style = space\n' }
    throw new Error('不存在')
  })
  const twoSpace = ['a = 1', '  b = 2', '    c = 3', '  d = 4', '    e = 5', '    f = 6', '    g = 7', '    h = 8'].join('\n')
  const resolved = await resolveIndentOptions({
    path: 'src/x.py', text: twoSpace, base: BASE, isFullReformat: false, readEditorConfig: reader,
  })
  assert.equal(resolved.options.indentSize, 3)          // .editorconfig 赢过按内容探测的 2
  assert.equal(resolved.fromEditorConfig, true)
  assert.equal(resolved.editorConfigDirs.length, 1)
})

test('resolveIndentOptions：开关关掉就两段都不走（CodeStyleSettings.AUTODETECT_INDENTS / EditorConfigSettings.ENABLED）', async () => {
  const reader = makeEditorConfigReader(async () => ({ content: '[*]\nindent_size = 3\n' }))
  const toggles = { autodetectIndents: false, editorConfigEnabled: false }
  const resolved = await resolveIndentOptions({
    path: 'x.py', text: 'a\n  b\n  c\n  d\n', base: BASE, isFullReformat: false,
    readEditorConfig: reader, toggles,
  })
  assert.equal(resolved.options.indentSize, 4)
  assert.equal(resolved.fromEditorConfig, false)
  assert.equal(resolved.detected, false)
})

test('codeStyleToggles / setCodeStyleToggles：默认两个都开（CodeStyleSettings.java:193 / EditorConfigSettings.java:12）', () => {
  const before = { ...codeStyleToggles.value }
  try {
    assert.equal(setCodeStyleToggles({}).autodetectIndents, true)
    assert.equal(setCodeStyleToggles({}).editorConfigEnabled, true)
    assert.equal(setCodeStyleToggles({ editorConfigEnabled: false }).editorConfigEnabled, false)
  } finally {
    setCodeStyleToggles(before)
  }
})

test('indentOptionsFromSettings：起步值来自全局 tabSize / useTabCharacter', () => {
  assert.deepEqual(indentOptionsFromSettings({ tabSize: 2, useTabCharacter: true }),
    { indentSize: 2, continuationIndentSize: 2, tabSize: 2, useTabCharacter: true })
})

// ------------------------------------------------------------------ 格式化后处理

test('processLineCommentAddSpace：默认关（LINE_COMMENT_ADD_SPACE_ON_REFORMAT = false，CommonCodeStyleSettings.java:261）', () => {
  const text = 'x = 1 //注释\n'
  assert.deepEqual(processLineCommentAddSpace(text, { start: 0, end: text.length }), { text, inserted: 0 })
})

test('processLineCommentAddSpace：给行注释前缀后补一个空格（LineCommentAddSpacePostFormatProcessor.kt:68-84）', () => {
  const settings = { lineCommentAddSpaceOnReformat: true, lineCommentPrefixes: ['//', '#'] }
  const text = '//注释\n  #另一个\n//\nconst s = "//不是注释"\n'
  const result = processLineCommentAddSpace(text, { start: 0, end: text.length }, settings)
  assert.equal(result.text, '// 注释\n  # 另一个\n//\nconst s = "//不是注释"\n')
  // 空注释（`//` 后面没东西）不加（:74 的 takeUnless）
  assert.equal(result.inserted, 2)
})

test('processLineCommentAddSpace：只处理落在待重排区间内的位置（:36 的 filter contains）', () => {
  const settings = { lineCommentAddSpaceOnReformat: true, lineCommentPrefixes: ['//'] }
  const text = '//甲\nbody\n//乙'
  const result = processLineCommentAddSpace(text, { start: 0, end: text.length - 1 }, settings)
  assert.equal(result.text, '// 甲\nbody\n//乙')
})

// `LanguageCodeStyleProvider.canInsertSpaceInLineComment`（`:77-81`，社区树里没有任何语言覆写它 ⇒
// 默认实现就是上游用户可见的行为）。旧实现把它当「本仓没有 ⇒ 恒真」，于是
// `// 已有空格` 被补成两个空格、`//----` 分节线被拆开 —— 下面三条钉的是那个钩子本身。
test('canInsertSpaceInLineComment：空白内容与首字符非字母数字都不加（LanguageCodeStyleProvider.java:77-81）', () => {
  assert.equal(canInsertSpaceInLineComment(''), false)           // takeUnless { commentText.length == it } 的那一档
  assert.equal(canInsertSpaceInLineComment('   '), false)        // isBlank() → false（:78）
  assert.equal(canInsertSpaceInLineComment('\t注释'), false)     // 首字符是制表符 → 不是字母数字（:79）
  assert.equal(canInsertSpaceInLineComment(' foo'), false)       // 已有空格 ⇒ 上游不再补第二个
  assert.equal(canInsertSpaceInLineComment('---- 分节'), false)  // 分隔线不动
  assert.equal(canInsertSpaceInLineComment('/* 嵌套 */'), false)
})

test('canInsertSpaceInLineComment：字母 / 数字 / 中日韩文字开头才加（:79 的 isLetterOrDigit）', () => {
  assert.equal(canInsertSpaceInLineComment('TODO 后面补空格'), true)
  assert.equal(canInsertSpaceInLineComment('1 号用例'), true)
  assert.equal(canInsertSpaceInLineComment('注释'), true)        // CJK 是 \p{L}
  assert.equal(canInsertSpaceInLineComment('Ωmega'), true)       // 非 ASCII 字母也算
})

test('processLineCommentAddSpace：钩子挡住的那些一行都不补（旧「恒真」写法会补出两个空格）', () => {
  const settings = { lineCommentAddSpaceOnReformat: true, lineCommentPrefixes: ['//', '#'] }
  const text = '// 已经有了\n//---- 分节 ----\n//\n//\n  \n//TODO 补\n'
  const result = processLineCommentAddSpace(text, { start: 0, end: text.length }, settings)
  assert.equal(result.text, '// 已经有了\n//---- 分节 ----\n//\n//\n  \n// TODO 补\n')
  assert.equal(result.inserted, 1, '只有字母开头的那一条该补空格')
})

test('接线：补空格的判定走 canInsertSpaceInLineComment，不是无条件插', () => {
  const source = read('postFormatProcessors.ts')
  assert.match(source, /export function canInsertSpaceInLineComment\(/, '钩子的等价物得是导出的（判据直接引它）')
  assert.match(source, /if \(!canInsertSpaceInLineComment\(rest\.slice\(prefix\.length\)\)\) continue/,
    '收集偏移时必须逐条问过这个钩子（上游 :79-81 的 if）')
})

// ------------------------------------------------------------------ 导出 .editorconfig

test('toEditorConfigText：用制表符写 tab_width，用空格写 indent_size（Utils.kt:198-217）', () => {
  assert.equal(toEditorConfigText({ indentSize: 4, continuationIndentSize: 4, tabSize: 4, useTabCharacter: false }),
    '[*]\nindent_style = space\nindent_size = 4\n')
  assert.equal(toEditorConfigText({ indentSize: 4, continuationIndentSize: 4, tabSize: 8, useTabCharacter: true }),
    '[*]\nindent_style = tab\ntab_width = 8\n')
  assert.equal(toEditorConfigText({ indentSize: 4, continuationIndentSize: 4, tabSize: 8, useTabCharacter: false }, '{*.js,*.ts}'),
    '[{*.js,*.ts}]\nindent_style = space\nindent_size = 4\n')
})

// ------------------------------------------------------------------ 接线

test('接线：runFormatting 把生效缩进当 FormattingOptions 发出去（LspFormattingService.kt:119-125）', () => {
  const source = read('semanticActions.ts')
  assert.match(source, /tabSize: indent\.indentSize, insertSpaces: !indent\.useTabCharacter/)
  assert.match(source, /await formattingIndentOptions\(path, Boolean\(range\)/)
  // 上游 createFormattingOptions 也只发这两个字段，别顺手加别的
  const optionsLine = source.split('\n').find(line => line.includes('tabSize: indent.indentSize'))
  assert.equal(optionsLine.includes('trimTrailingWhitespace'), false)
})

// 后处理（`PostFormatProcessor` 那一环）挂在哪、拿的是哪一份文本 —— 这一条本轮**订正**过。
//
// 订正留痕（2026-10-06 refactorfix）：原判据钉的是
//   `processLineCommentAddSpace(next, { start: 0, end: next.length }, postFormatSettings.value)`
//   + `import { processLineCommentAddSpace } from './postFormatProcessors.ts'`
// 即「调用点自己把整份文本交给单个处理器」。上游不是这个形状：
//   · `platform/code-style-api/src/com/intellij/psi/impl/source/codeStyle/PostFormatProcessor.java`
//     是**扩展点接口**（每个处理器一个 `processText(text, rangeToReformat, context)`，
//     `CodeStyleSettings` 决定谁启用），调用方从不逐个挑处理器；
//   · `platform/code-style-impl/src/com/intellij/psi/impl/source/codeStyle/CoreCodeStyleUtil.java:101-118`
//     `postProcessRanges` 收的是**格式化区间**（`RangeFormatInfo` 重取到的改动后偏移），
//     `:121-142` `postProcessText` 再把区间按 `FormatterTagHandler.getEnabledRanges` 切成启用段、
//     逐段跑**整串**处理器并靠 `delta` 平移 —— 所以「整份文本 + 单个处理器」既越界又漏段。
// 本仓的对齐形状是 `processFormattedText()`（一条链跑完所有已落地的处理器）+
// `postFormatRegions()`（把请求侧区间换算到改动后坐标系）。判据改成钉这一件事，且仍是逐字符：
test('接线：postFormatProcessor 挂在 runFormatting 套完编辑之后（PostFormatProcessor）', () => {
  const source = read('semanticActions.ts')
  // ① 总入口与区间换算都从那个模块来（本仓不许有第二份后处理实现）。
  assert.match(source, /import \{ postFormatRegions, processFormattedText \} from '\.\/postFormatProcessors\.ts'/)
  assert.equal((source.match(/from '\.\/postFormatProcessors\.ts'/g) ?? []).length, 1,
    '对那个模块只许一条 import（抄第二份入口就是两份规则）')
  assert.equal(/import \{[^}]*processLineCommentAddSpace[^}]*from '\.\/postFormatProcessors\.ts'/.test(source), false,
    '调用点不许再直接引单个处理器（那是上游扩展点自己该挑的事）')
  // ② 设置来自代码风格那一层（`LINE_COMMENT_ADD_SPACE_ON_REFORMAT` / `KEEP_BLANK_LINES_IN_CODE`）。
  assert.match(source, /postFormatSettings\.value/, '后处理读的是 codeStyleSettings 的那份生效设置')
  // ③ 顺序才是这条判据的本体：后处理必须跑在**套完编辑之后**的那份文本上，且在写回缓冲区之前。
  const applyAt = source.indexOf('const formatted = snapshot === undefined ? applyTextEdits(base, edits)')
  const postAt = source.indexOf('processFormattedText(')
  const setDraftAt = source.indexOf('editorFor(file.path)?.setDraft(next)')
  assert.ok(applyAt > 0 && postAt > 0 && setDraftAt > 0, 'runFormatting 里找不到「套编辑 / 后处理 / 写回」这三步')
  assert.ok(postAt > applyAt, '后处理必须在套用语言服务编辑**之后**（上游是格式化落文档之后才跑 PostFormatProcessor）')
  assert.ok(postAt < setDraftAt, '后处理的结果必须写回缓冲区，不是算完就丢')
  assert.match(source, /const processed = processFormattedText\(next, regions, postFormatSettings\.value, commentStyleFor\(undefined, file\.path\)\)/,
    '后处理拿的是 `next`（改动后的文本）与换算后的 `regions`')
  // ④ 区间口径：请求侧的区间按**已套用的编辑**换算到改动后坐标系；快照那一档（用户在格式化期间改过文档）
  //    退回空区间 = 「整份文本 ∩ 启用段」，不假装换算准确 —— 两条一起钉在同一段正则里。
  assert.match(source, /const regions = snapshot === undefined\s*\?\s*postFormatRegions\(base, edits, range \? \(subRanges\.length \? subRanges : \[range\]\) : \[\]\)\s*:\s*\[\]/)
})

test('接线：App.vue 把 editorSettings 传进 createSemanticActions（缩进起步值）', () => {
  assert.match(read('App.vue'), /createSemanticActions\(\{\s*\n\s*notify, isDesktop, generalSettings, editorSettings,/)
})
