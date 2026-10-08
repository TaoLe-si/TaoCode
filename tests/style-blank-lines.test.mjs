// `KEEP_BLANK_LINES_*`（代码风格里的「连续空行最多留几个」）在本仓的落点与判据。
//
// 上游逐条（参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · 设置项默认值 —— `platform/code-style-api/src/com/intellij/psi/codeStyle/CommonCodeStyleSettings.java`
//     `:285` `KEEP_BLANK_LINES_IN_DECLARATIONS = 2`、`:290` `KEEP_BLANK_LINES_IN_CODE = 2`、
//     `:295` `KEEP_BLANK_LINES_BETWEEN_PACKAGE_DECLARATION_AND_HEADER = 2`、
//     `:298` `KEEP_BLANK_LINES_BEFORE_RBRACE = 2`；
//   · 生效的那一下 —— `platform/code-style-impl/src/com/intellij/formatting/WhiteSpace.java`
//     `arrangeLineFeeds`：`:395-400` `keepBlankLines > 0` 且换行数 `>= keep + 1` 时压到 `keep + 1`；
//     `:401-411` `keepBlankLines == 0` 那一档看 `shouldKeepLineFeeds()`；
//     `:426-429` 文件最前面那段空白（`isFirst()`）换行清 0 ⇒ 开头的空行整段删掉；
//   · `platform/code-style-impl/src/com/intellij/formatting/SpacingImpl.java:47-51`
//     `minLineFeeds - 1 > keep` 时按 `minLineFeeds - 1` 走（必插的空行赢）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultPostFormatSettings, processFormattedText, processKeepBlankLines } from '../src/postFormatProcessors.ts'
import { postFormatSettings, setPostFormatSettings } from '../src/codeStyleSettings.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = name => readFileSync(join(here, '..', 'src', name), 'utf8')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const RANGE = (text) => ({ start: 0, end: text.length })

/** 上游锚点：这三处行号漂了就要红（文档给的坐标不能当依据直接抄）。 */
test('上游锚点：KEEP_BLANK_LINES 四个默认值与 WhiteSpace 的那两档压行', (t, done) => {
  const common = join(REF, 'platform/code-style-api/src/com/intellij/psi/codeStyle/CommonCodeStyleSettings.java')
  const white = join(REF, 'platform/code-style-impl/src/com/intellij/formatting/WhiteSpace.java')
  const spacing = join(REF, 'platform/code-style-impl/src/com/intellij/formatting/SpacingImpl.java')
  if (!existsSync(common) || !existsSync(white) || !existsSync(spacing)) return done()
  const at = path => readFileSync(path, 'utf8').split('\n')
  const settings = at(common)
  assert.match(settings[284], /KEEP_BLANK_LINES_IN_DECLARATIONS = 2/)
  assert.match(settings[289], /KEEP_BLANK_LINES_IN_CODE = 2/)
  assert.match(settings[294], /KEEP_BLANK_LINES_BETWEEN_PACKAGE_DECLARATION_AND_HEADER = 2/)
  assert.match(settings[297], /KEEP_BLANK_LINES_BEFORE_RBRACE = 2/)
  const feeds = at(white)
  assert.match(feeds[395], /spaceProperty\.getKeepBlankLines\(\) > 0/, ':396 仍是 keep > 0 那一支')
  assert.match(feeds[396], /getLineFeeds\(\) >= spaceProperty\.getKeepBlankLines\(\) \+ 1/, ':397 仍是压到 keep+1 的判定')
  assert.match(feeds[397], /setLineFeeds\(spaceProperty\.getKeepBlankLines\(\) \+ 1\)/, ':398')
  assert.match(feeds[401], /getLineFeeds\(\) > spaceProperty\.getMinLineFeeds\(\)/, ':402 keep==0 那一档')
  assert.match(feeds[403], /setLineFeeds\(Math\.max\(spaceProperty\.getMinLineFeeds\(\), 1\)\)/, ':404 保留换行 ⇒ 压到 1 个换行（不并行）')
  assert.match(feeds[425], /else if \(isFirst\(\)\)/, ':426 文件开头那一支')
  assert.match(at(spacing)[46], /minLineFeeds > 1 && \(minLineFeeds - 1\) > keepBlankLines/, 'SpacingImpl.java:47')
  done()
})

// ---------------------------------------------------------------- 默认值

test('默认值取自上游：keepBlankLines = 2、补空格 = 关（:290 / :261）', () => {
  assert.equal(defaultPostFormatSettings.keepBlankLines, 2)
  assert.equal(defaultPostFormatSettings.lineCommentAddSpaceOnReformat, false)
  assert.equal(postFormatSettings.value.keepBlankLines, 2)
})

test('设置键缺键补默认：落盘的那份只写了一个键时 keepBlankLines 仍是 2', () => {
  setPostFormatSettings({ lineCommentAddSpaceOnReformat: true })
  assert.equal(postFormatSettings.value.lineCommentAddSpaceOnReformat, true)
  assert.equal(postFormatSettings.value.keepBlankLines, 2)
  setPostFormatSettings({ keepBlankLines: 0 })
  assert.equal(postFormatSettings.value.keepBlankLines, 0)
  setPostFormatSettings({ lineCommentAddSpaceOnReformat: false, keepBlankLines: 2 })
})

// ---------------------------------------------------------------- 压空行主规则

test('processKeepBlankLines：连续 4 个空行压到 2（keep=2，N 个空行 = N+1 个换行）', () => {
  const text = 'a\n\n\n\n\nb\n'
  const result = processKeepBlankLines(text, RANGE(text), 2, null)
  assert.equal(result.text, 'a\n\n\nb\n')
  assert.equal(result.removed, 2)
})

test('processKeepBlankLines：正好等于上限、少于上限都不动（边界）', () => {
  const exactly = 'a\n\n\nb\n'                       // 2 个空行
  assert.deepEqual(processKeepBlankLines(exactly, RANGE(exactly), 2, null), { text: exactly, removed: 0, leading: 0 })
  const fewer = 'a\n\nb\n'                           // 1 个空行
  assert.deepEqual(processKeepBlankLines(fewer, RANGE(fewer), 2, null), { text: fewer, removed: 0, leading: 0 })
})

test('processKeepBlankLines：keep=0 清空代码之间的空行，但绝不并行（上游 :403-405 那一支）', () => {
  const text = 'a\n\n\nb\n'
  const result = processKeepBlankLines(text, RANGE(text), 0, null)
  assert.equal(result.text, 'a\nb\n')
  assert.equal(result.text.includes('ab'), false, '两条语句被并成一行就是改坏代码')
  assert.equal(result.removed, 2)
})

test('processKeepBlankLines：负数与 NaN 都按 0 处理，不冒充「更大的上限」', () => {
  const text = 'a\n\nb\n'
  assert.equal(processKeepBlankLines(text, RANGE(text), -5, null).text, 'a\nb\n')
  assert.deepEqual(processKeepBlankLines(text, RANGE(text), Number.NaN, null), { text, removed: 0, leading: 0 })
})

test('processKeepBlankLines：区间末尾的尾随空行不动（两侧都有内容行才算）', () => {
  const text = 'a\nb\n\n\n\n'
  const result = processKeepBlankLines(text, RANGE(text), 0, null)
  assert.equal(result.text, 'a\nb\n\n\n\n')
  assert.equal(result.removed, 0)
})

test('processKeepBlankLines：文件开头的空行整段删掉（WhiteSpace.java:426-429 的 isFirst）', () => {
  const text = '\n\n\na\nb\n'                     // 三条空行在 'a' 之前
  const result = processKeepBlankLines(text, RANGE(text), 2, null)
  assert.equal(result.text, 'a\nb\n')
  assert.equal(result.leading, 3)
  assert.equal(result.removed, 3)
})

test('processKeepBlankLines：选区从文件中间开始时不动选区前那几行空行（区间不是整份文件）', () => {
  const text = '\n\n\na\nb\n'
  const from = text.indexOf('a')
  const result = processKeepBlankLines(text, { start: from, end: text.length }, 2, null)
  assert.deepEqual(result, { text, removed: 0, leading: 0 })
})

test('processKeepBlankLines：只含空格/制表/CR 的行算空行（CRLF 文档同一口径）', () => {
  const text = 'a\r\n   \r\n\t\r\nb\r\n'
  const result = processKeepBlankLines(text, RANGE(text), 1, null)
  assert.equal(result.text, 'a\r\n   \r\nb\r\n')
  assert.equal(result.removed, 1)
})

// ---------------------------------------------------------------- 注释与字符串里的空行

test('processKeepBlankLines：块注释里的空行不是「代码空行」，一条都不删', () => {
  const text = '/**\n *\n\n\n* doc\n */\nlet a = 1\n'
  const result = processKeepBlankLines(text, RANGE(text), 0, { line: '//', block: ['/*', '*/'] })
  assert.equal(result.removed, 0, '注释内部压行会把注释内容改掉')
  assert.equal(result.text, text)
})

test('processKeepBlankLines：模板字符串里的空行不删（JS/TS 的 ` 串可以跨行）', () => {
  const text = 'const t = `\n\n\nx\n`\nconst b = 1\n'
  const result = processKeepBlankLines(text, RANGE(text), 0, { line: '//', block: ['/*', '*/'] })
  assert.equal(result.removed, 0)
  assert.equal(result.text, text)
})

test('processKeepBlankLines：没有语言注释标记（style 为 null）时块注释里的空行仍按代码处理 —— 如实钉住这条差异', () => {
  const text = '/*\n\n\n*/\nlet a = 1\n'
  const result = processKeepBlankLines(text, RANGE(text), 0, null)
  assert.equal(result.removed, 2, '拿不到注释标记就按代码空行处理（调用方必须把 commentStyleFor 传进来）')
})

// ---------------------------------------------------------------- 总入口的两条分支

test('processFormattedText：默认设置就压空行（上游 keep=2 是默认生效，不是可选项）', () => {
  const text = 'a\n\n\n\n\nb\n'
  const result = processFormattedText(text)
  assert.equal(result.collapsed, 2)
  assert.equal(result.text, 'a\n\n\nb\n')
})

test('processFormattedText：keepBlankLines=99 时不动任何空行，只跑补空格', () => {
  const text = 'a\n\n\n\n\nb\n//x\n'
  const settings = { ...defaultPostFormatSettings, lineCommentAddSpaceOnReformat: true, keepBlankLines: 99 }
  const result = processFormattedText(text, [], settings, { line: '//' })
  assert.equal(result.collapsed, 0)
  assert.equal(result.inserted, 1)
  assert.equal(result.text, 'a\n\n\n\n\nb\n// x\n')
})

test('processFormattedText：空区间（整段被 @formatter:off 禁掉）时原样返回', () => {
  const text = 'a\n\n\n\n\nb\n'
  const result = processFormattedText(text, [{ start: 3, end: 3 }], { ...defaultPostFormatSettings, keepBlankLines: 0 })
  assert.deepEqual(result, { text, inserted: 0, collapsed: 0, leading: 0 })
})

// ---------------------------------------------------------------- 接线

test('接线：runFormatting 把合并掉的空行数报给用户，且提示里说清是本仓按风格补的', () => {
  const source = read('semanticActions.ts')
  assert.match(source, /collapsedBlanks \? `合并多余空行 \$\{collapsedBlanks\} 行` : ''/)
  assert.match(source, /已按代码风格\$\{postNote\}/)
  assert.match(source, /insertedSpaces \+= processed\.inserted/)
})

test('接线：设置面读写走同一份默认（缺键补 2，坏值不回退成 0）', () => {
  const source = read('codeStyleSettings.ts')
  assert.match(source, /function readPostFormatStored\(\): PostFormatSettings/)
  assert.match(source, /Number\.isInteger\(stored\.keepBlankLines\) && \(stored\.keepBlankLines as number\) >= 0/)
  assert.match(source, /: defaultPostFormatSettings\.keepBlankLines/)
  // 旧的「只认布尔」那一套必须彻底删掉（留着就是两份读写口径）
  assert.equal(source.includes('readStoredFlag'), false)
})
