// `src/trailingSpacesStrip.ts` 的判据 —— filter 链 / Smart filter / 光标行 / .editorconfig provider。
//
// 上游依据（相对路径:行号，逐个开文件核过）：
//   · platform/core-impl/src/com/intellij/openapi/editor/impl/StripTrailingSpacesUtil.java:27-45,112-121
//   · platform/core-api/src/com/intellij/openapi/editor/StripTrailingSpacesFilter.java:29,40,50,61
//   · platform/core-api/src/com/intellij/openapi/editor/SmartStripTrailingSpacesFilter.java:21-33
//   · platform/lang-impl/src/com/intellij/psi/codeStyle/KeepTrailingSpacesOnEmptyLinesFilterFactory.java:30-35,38-45,47-58,60-68,70-78,80-89,93-99
//   · platform/platform-impl/src/com/intellij/openapi/editor/impl/TrailingSpacesStripper.java:139-173,367-391
//   · platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:216-218
//   · plugins/editorconfig/backend/src/configmanagement/EditorConfigTrailingSpacesOptionsProvider.kt:27-45,48-56
//   · plugins/editorconfig/backend/src/configmanagement/EditorConfigTrailingSpacesFilterFactory.java:32-33
//   · platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:210-212,470-477
//
// 纯 JavaScript（package.json 的 test 脚本不带 --experimental-strip-types）。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTrailingSpacesOverride, documentFromText, documentStripFilters, effectiveTrailingSpacesMode,
  keepTrailingSpacesOnEmptyLinesFilter, modeFromTrimOverride, resolveCaretLines, stripFilterChain,
  stripTrailingSpacesForSave, trailingSpacesOptionsFromMode, trailingSpacesOverrideFromProperties,
} from '../src/trailingSpacesStrip.ts'

// ---------------------------------------------------------------- A. 三档 ↔ 两个布尔

test('三档 → (isStripTrailingSpaces, isChangedLinesOnly)：None 也是 changedLinesOnly=true（:367-391）', () => {
  assert.deepEqual(trailingSpacesOptionsFromMode('None'), { stripTrailingSpaces: false, changedLinesOnly: true })
  assert.deepEqual(trailingSpacesOptionsFromMode('Changed'), { stripTrailingSpaces: true, changedLinesOnly: true })
  assert.deepEqual(trailingSpacesOptionsFromMode('Whole'), { stripTrailingSpaces: true, changedLinesOnly: false })
})

test('trim_trailing_whitespace → 三档：true=Whole、false=None、解不出=null（provider:27-45）', () => {
  assert.equal(modeFromTrimOverride(true), 'Whole')
  assert.equal(modeFromTrimOverride(false), 'None')
  assert.equal(modeFromTrimOverride(undefined), null)
})

// ---------------------------------------------------------------- B. filter 链

test('空 filter 链 ⇒ 每行都留 0 个（getMaxSpacesToLeave 末尾 return 0，:120）', () => {
  const chain = stripFilterChain([])
  assert.equal(chain.strippingNotAllowed, false)
  assert.equal(chain.postponed, false)
  assert.equal(chain.enforcedRemoval, false)
  assert.equal(chain.trailingSpacesToLeave(0), 0)
  assert.equal(chain.trailingSpacesToLeave(99), 0)
})

test('NOT_ALLOWED 整篇否决（:29-34 + :43-45）', () => {
  const chain = stripFilterChain([{ kind: 'not-allowed' }])
  assert.equal(chain.strippingNotAllowed, true)
  assert.equal(chain.postponed, false)
  assert.equal(chain.trailingSpacesToLeave(0), -1)
})

test('POSTPONED ⇒ 稍后重试，且不是 NOT_ALLOWED（:40-45）', () => {
  const chain = stripFilterChain([{ kind: 'postponed' }])
  assert.equal(chain.postponed, true)
  assert.equal(chain.strippingNotAllowed, false)
  assert.equal(chain.trailingSpacesToLeave(0), -1)
})

test('第一个 special filter 说了算：NOT_ALLOWED 之后的 POSTPONED 不覆盖它（:32-34）', () => {
  const chain = stripFilterChain([{ kind: 'postponed' }, { kind: 'not-allowed' }])
  assert.equal(chain.postponed, true)
  assert.equal(chain.strippingNotAllowed, false)
})

test('普通 filter 否决 ⇒ -1；不否决 ⇒ 0（:116-118）', () => {
  const chain = stripFilterChain([{ kind: 'normal', stripSpacesAllowedForLine: line => line !== 0 }])
  assert.equal(chain.trailingSpacesToLeave(0), -1)
  assert.equal(chain.trailingSpacesToLeave(1), 0)
})

test('Smart filter 给数就定案，后面的普通 filter 否决不了（:114-115 return 在否决之前）', () => {
  const chain = stripFilterChain([
    { kind: 'smart', trailingSpacesToLeave: () => 2 },
    { kind: 'normal', stripSpacesAllowedForLine: () => false },
  ])
  assert.equal(chain.trailingSpacesToLeave(0), 2)
})

test('Smart filter 的 -1 就是「这行不动」（SmartStripTrailingSpacesFilter:21-24）', () => {
  const chain = stripFilterChain([{ kind: 'smart', trailingSpacesToLeave: line => (line === 0 ? -1 : 0) }])
  assert.equal(chain.trailingSpacesToLeave(0), -1)
  assert.equal(chain.trailingSpacesToLeave(1), 0)
})

test('ENFORCED_REMOVAL 清空已收集的 filter 并让每行留 0（:35-38）', () => {
  const chain = stripFilterChain([
    { kind: 'normal', stripSpacesAllowedForLine: () => false },
    { kind: 'enforced-removal' },
  ])
  assert.equal(chain.enforcedRemoval, true)
  assert.equal(chain.strippingNotAllowed, false)
  assert.equal(chain.trailingSpacesToLeave(0), 0)
})

test('ENFORCED_REMOVAL 也清掉先前记下的 specialFilter（:35-38 的 specialFilter = null）', () => {
  const chain = stripFilterChain([{ kind: 'not-allowed' }, { kind: 'enforced-removal' }])
  assert.equal(chain.enforcedRemoval, true)
  assert.equal(chain.strippingNotAllowed, false)
  assert.equal(chain.trailingSpacesToLeave(0), 0)
})

test('documentStripFilters：默认只装 ALL_LINES（:50-55）', () => {
  const filters = documentStripFilters({})
  assert.equal(filters.length, 1)
  assert.equal(filters[0].kind, 'normal')
  assert.equal(filters[0].stripSpacesAllowedForLine(0), true)
})

test('documentStripFilters：trim=true 只装 ENFORCED_REMOVAL（EditorConfigTrailingSpacesFilterFactory:32-33）', () => {
  const filters = documentStripFilters({ enforcedRemoval: true })
  assert.deepEqual(filters, [{ kind: 'enforced-removal' }])
})

test('documentStripFilters：开了 KEEP_INDENTS_ON_EMPTY_LINES 才装 Smart filter（:93-99）', () => {
  const document = documentFromText('    a\n  \n    b')
  const off = documentStripFilters({ document, keepIndentsOnEmptyLines: false })
  assert.equal(off[0].kind, 'normal')
  const on = documentStripFilters({ document, keepIndentsOnEmptyLines: true })
  assert.equal(on[0].kind, 'smart')
  assert.equal(on[0].trailingSpacesToLeave(1), 4)
})

// ---------------------------------------------------------------- C. Smart filter 本体

test('空白行按上下文非空行的缩进保留（:30-35 + :47-58）', () => {
  const document = documentFromText('    a\n  \n    b')
  const leave = keepTrailingSpacesOnEmptyLinesFilter(document)
  assert.equal(leave(1), 4)
})

test('非空白行一律留 0（:34 的三元）', () => {
  const document = documentFromText('  a\n  \nb')
  const leave = keepTrailingSpacesOnEmptyLinesFilter(document)
  assert.equal(leave(0), 0)
})

test('取上下两个非空行缩进的较大者（:52-56 的 Math.max）', () => {
  const document = documentFromText('a\n  \n        b')
  const leave = keepTrailingSpacesOnEmptyLinesFilter(document)
  assert.equal(leave(1), 8)
})

test('没有非空邻居 ⇒ -1（整行不动，:49-57 的初值）', () => {
  const document = documentFromText('   ')
  const leave = keepTrailingSpacesOnEmptyLinesFilter(document)
  assert.equal(leave(0), -1)
})

test('全是空白行时，每一行都取不到非空邻居 ⇒ -1（:60-78）', () => {
  const document = documentFromText('\n  \n\t\n')
  const leave = keepTrailingSpacesOnEmptyLinesFilter(document)
  assert.equal(leave(1), -1)
  assert.equal(leave(2), -1)
})

test('缩进只数空格与制表符，遇到别的字符就停（:80-89）', () => {
  const document = documentFromText('\t\tx\n  \ny')
  const leave = keepTrailingSpacesOnEmptyLinesFilter(document)
  assert.equal(leave(1), 2)
})

test('containsWhitespacesOnly 把 \\r 也算空白（:41）', () => {
  const document = documentFromText('a\r\n  \r\nb')
  const leave = keepTrailingSpacesOnEmptyLinesFilter(document)
  // 行 1 内容含 \r 时不算空白行；本仓行模型把 \r 归给分隔符，所以它确实是空白行。
  assert.equal(leave(1), 0)
})

// ---------------------------------------------------------------- D. 文档投影

test('documentFromText：行数 / 偏移 / 行号与上游 getLineCount / getLineStartOffset 同形', () => {
  const document = documentFromText('ab\ncde\n')
  assert.equal(document.lineCount, 3)
  assert.equal(document.textLength, 7)
  assert.equal(document.getLineStartOffset(0), 0)
  assert.equal(document.getLineEndOffset(0), 2)
  assert.equal(document.getLineStartOffset(1), 3)
  assert.equal(document.getLineEndOffset(1), 6)
  assert.equal(document.getLineNumber(4), 1)
})

test('documentFromText：CRLF 的 \\r 归给分隔符，不算进行内容（与 editorConfig 同源）', () => {
  const document = documentFromText('ab\r\ncd')
  assert.equal(document.getLineEndOffset(0), 2)
  assert.equal(document.getLineStartOffset(1), 4)
})

test('documentFromText：缺省一行都没改；给了脏行就只认那几行（DocumentImpl:210-212）', () => {
  const document = documentFromText('a\nb\nc', [1])
  assert.equal(document.isLineModified(0), false)
  assert.equal(document.isLineModified(1), true)
  assert.equal(document.isLineModified(2), false)
})

// ---------------------------------------------------------------- E. 光标行判据

test('clearLineModificationFlags：光标行保留脏、其余改动行清脏（TrailingSpacesStripper:162-172）', () => {
  const document = documentFromText('a\nb  \nc', [0, 1, 2])
  const judged = resolveCaretLines({ document, caretOffsets: [2], virtualSpace: false })
  assert.deepEqual(judged.stripLines, [0, 2])
  assert.deepEqual(judged.caretLines, [1])
})

test('虚拟空格开着时一个光标行都不收集（:153-158 的注释原文）', () => {
  const document = documentFromText('a\nb\nc', [0, 1, 2])
  const judged = resolveCaretLines({ document, caretOffsets: [2], virtualSpace: true })
  assert.deepEqual(judged.stripLines, [0, 1, 2])
  assert.deepEqual(judged.caretLines, [])
})

test('同一行多个光标只记一次（落在分隔符上的偏移归前一行）', () => {
  const document = documentFromText('abc\ndef', [0])
  const judged = resolveCaretLines({ document, caretOffsets: [0, 2, 4], virtualSpace: false })
  assert.deepEqual(judged.caretLines, [0, 1])
})

test('没有光标 ⇒ 不改动行全清', () => {
  const document = documentFromText('a\nb', [0, 1])
  const judged = resolveCaretLines({ document, caretOffsets: [], virtualSpace: false })
  assert.deepEqual(judged.stripLines, [0, 1])
  assert.deepEqual(judged.caretLines, [])
})

// ---------------------------------------------------------------- F. .editorconfig provider

test('trim_trailing_whitespace=true ⇒ 整文件清 + ENFORCED_REMOVAL（provider:39-41 + factory:32-33）', () => {
  const override = trailingSpacesOverrideFromProperties({ trim_trailing_whitespace: 'true' })
  assert.equal(override.stripTrailingSpaces, true)
  assert.equal(override.changedLinesOnly, false)
  assert.equal(override.mode, 'Whole')
  assert.equal(override.enforcedRemoval, true)
})

test('trim_trailing_whitespace=false ⇒ 完全不清 + 不是 enforced（:39-41）', () => {
  const override = trailingSpacesOverrideFromProperties({ trim_trailing_whitespace: 'false' })
  assert.equal(override.stripTrailingSpaces, false)
  assert.equal(override.changedLinesOnly, true)
  assert.equal(override.mode, 'None')
  assert.equal(override.enforcedRemoval, false)
})

test('insert_final_newline 单独解出：只覆盖末行换行（:18-20 + :31-33）', () => {
  const override = trailingSpacesOverrideFromProperties({ insert_final_newline: 'true' })
  assert.equal(override.ensureNewLineAtEof, true)
  assert.equal(override.stripTrailingSpaces, undefined)
  assert.equal(override.mode, null)
})

test('两键都解不出 ⇒ 整份 override 为 null（:18-22）', () => {
  assert.equal(trailingSpacesOverrideFromProperties({}), null)
  assert.equal(trailingSpacesOverrideFromProperties({ trim_trailing_whitespace: 'unset' }), null)
  assert.equal(trailingSpacesOverrideFromProperties({ trim_trailing_whitespace: 'none' }), null)
})

test('取值域只认大小写不敏感的 true/false（:50-54）', () => {
  assert.equal(trailingSpacesOverrideFromProperties({ trim_trailing_whitespace: 'TRUE' }).stripTrailingSpaces, true)
  assert.equal(trailingSpacesOverrideFromProperties({ insert_final_newline: 'False' }).ensureNewLineAtEof, false)
})

test('provider 的 removeTrailingBlankLines / keepTrailingSpacesOnCaretLine 恒 null ⇒ 不覆盖回落值（:35-37,:43-45）', () => {
  const base = {
    stripTrailingSpaces: true, changedLinesOnly: true, ensureNewLineAtEof: false,
    keepTrailingSpacesOnCaretLine: true, removeTrailingBlankLines: false,
  }
  const override = trailingSpacesOverrideFromProperties({ trim_trailing_whitespace: 'true' })
  const merged = applyTrailingSpacesOverride(base, override)
  assert.equal(merged.keepTrailingSpacesOnCaretLine, true)
  assert.equal(merged.removeTrailingBlankLines, false)
  assert.equal(merged.changedLinesOnly, false)
  assert.equal(merged.stripTrailingSpaces, true)
})

test('effectiveTrailingSpacesMode：.editorconfig 解出就压过 IDE 设置（TrailingSpacesStripper:304-317）', () => {
  const whole = trailingSpacesOverrideFromProperties({ trim_trailing_whitespace: 'true' })
  assert.equal(effectiveTrailingSpacesMode('None', whole), 'Whole')
  const none = trailingSpacesOverrideFromProperties({ trim_trailing_whitespace: 'false' })
  assert.equal(effectiveTrailingSpacesMode('Whole', none), 'None')
  const onlyNewline = trailingSpacesOverrideFromProperties({ insert_final_newline: 'true' })
  assert.equal(effectiveTrailingSpacesMode('Changed', onlyNewline), 'Changed')
  assert.equal(effectiveTrailingSpacesMode('Whole', null), 'Whole')
})

// ---------------------------------------------------------------- G. 合成入口

test('Whole 档：不需要基线，整篇清（DocumentImpl:470-477 的 inChangedLinesOnly=false）', () => {
  const result = stripTrailingSpacesForSave({
    text: 'a  \nb\t\t\nc  ',
    settings: { stripTrailingSpaces: 'Whole' },
  })
  assert.equal(result.text, 'a\nb\nc')
  assert.deepEqual(result.strippedLines, [0, 1, 2])
  assert.equal(result.mode, 'Whole')
  assert.equal(result.changed, true)
})

test('Changed 档（默认）：只清与上次落盘不同的行（:387-391 + :62）', () => {
  const result = stripTrailingSpacesForSave({
    text: 'a  \nb  \nc  ',
    settings: { stripTrailingSpaces: 'Changed' },
    savedText: 'x\nb  \nc  ',
  })
  assert.equal(result.text, 'a\nb  \nc  ')
  assert.deepEqual(result.strippedLines, [0])
})

test('Changed 档没有基线 ⇒ 一行都不清（宁少清不误清）', () => {
  const result = stripTrailingSpacesForSave({ text: 'a  \nb  ', settings: { stripTrailingSpaces: 'Changed' } })
  assert.equal(result.text, 'a  \nb  ')
  assert.equal(result.changed, false)
  assert.deepEqual(result.strippedLines, [])
})

test('None 档：一行都不清', () => {
  const result = stripTrailingSpacesForSave({ text: 'a  \n', settings: { stripTrailingSpaces: 'None' } })
  assert.equal(result.text, 'a  \n')
  assert.equal(result.changed, false)
})

test('.editorconfig 的 trim=true 压过 IDE 的 None 档（provider 覆盖，:304-317）', () => {
  const result = stripTrailingSpacesForSave({
    text: 'a  \nb  ',
    settings: { stripTrailingSpaces: 'None' },
    properties: { trim_trailing_whitespace: 'true' },
  })
  assert.equal(result.text, 'a\nb')
  assert.equal(result.mode, 'Whole')
  assert.equal(result.chain.enforcedRemoval, true)
})

test('.editorconfig 的 trim=false 压过 IDE 的 Whole 档', () => {
  const result = stripTrailingSpacesForSave({
    text: 'a  \n',
    settings: { stripTrailingSpaces: 'Whole' },
    properties: { trim_trailing_whitespace: 'false' },
  })
  assert.equal(result.text, 'a  \n')
  assert.equal(result.mode, 'None')
})

test('.editorconfig 只给 insert_final_newline 时，行尾档仍是 IDE 设置那一格', () => {
  const result = stripTrailingSpacesForSave({
    text: 'a  \n',
    settings: { stripTrailingSpaces: 'Whole' },
    properties: { insert_final_newline: 'true' },
  })
  assert.equal(result.text, 'a\n')
  assert.equal(result.mode, 'Whole')
  assert.equal(result.options.ensureNewLineAtEof, true)
})

test('光标挡路的那一行延后，其余照清（:78-84 + :229）', () => {
  const text = 'a  \nb  '
  const document = documentFromText(text)
  const result = stripTrailingSpacesForSave({
    text,
    settings: { stripTrailingSpaces: 'Whole' },
    document,
    caretOffsets: [document.getLineEndOffset(0)],
  })
  assert.equal(result.text, 'a  \nb')
  assert.deepEqual(result.strippedLines, [1])
  assert.deepEqual(result.deferredLines, [0])
})

test('keepTrailingSpacesOnCaretLine=false ⇒ 光标行照样清，且没有延后（:229 传 null）', () => {
  const text = 'a  \nb  '
  const document = documentFromText(text)
  const result = stripTrailingSpacesForSave({
    text,
    settings: { stripTrailingSpaces: 'Whole', keepTrailingSpacesOnCaretLine: false },
    document,
    caretOffsets: [document.getLineEndOffset(0)],
  })
  assert.equal(result.text, 'a\nb')
  assert.deepEqual(result.deferredLines, [])
})

test('Changed 档 + 光标行：光标行由 resolveCaretLines 收集，再折成行尾偏移（:152-159）', () => {
  const text = 'a  \nb  '
  const document = documentFromText(text, [0, 1])
  const result = stripTrailingSpacesForSave({
    text,
    settings: { stripTrailingSpaces: 'Changed' },
    savedText: text,
    document,
    caretOffsets: [document.getLineEndOffset(0)],
  })
  // savedText 与正文相同 ⇒ 按行差异没有一行「改过」；但上游此时用文档脏标记，
  // 本仓承接物是 savedText 的行差异，所以这里一行都不清 —— 保守方向（模块头已写明）。
  assert.equal(result.text, text)
})

test('Changed 档 + 光标行 + 真实改动行：改动行里光标那一行延后', () => {
  const text = 'a  \nb  '
  const document = documentFromText(text, [0, 1])
  const result = stripTrailingSpacesForSave({
    text,
    settings: { stripTrailingSpaces: 'Changed' },
    savedText: 'x\ny  ',
    document,
    caretOffsets: [document.getLineEndOffset(0)],
  })
  assert.equal(result.text, 'a  \nb')
  assert.deepEqual(result.deferredLines, [0])
})

test('Smart filter 接进合成入口：空白行按上下文缩进保留（KeepTrailingSpacesOnEmptyLinesFilterFactory:30-35）', () => {
  const text = '    a\n  \n    b\n'
  const document = documentFromText(text)
  const result = stripTrailingSpacesForSave({
    text,
    settings: { stripTrailingSpaces: 'Whole' },
    document,
    filters: documentStripFilters({ document, keepIndentsOnEmptyLines: true }),
  })
  // 行 1 的空白少于「应保留的 4 个」⇒ finalStart >= end ⇒ 不动它。
  assert.equal(result.text, text)
  assert.deepEqual(result.strippedLines, [])
})

test('Smart filter 保留数小于实际空白 ⇒ 只清多余的（:85-89）', () => {
  const text = '    a\n      \n    b\n'
  const document = documentFromText(text)
  const result = stripTrailingSpacesForSave({
    text,
    settings: { stripTrailingSpaces: 'Whole' },
    document,
    filters: documentStripFilters({ document, keepIndentsOnEmptyLines: true }),
  })
  assert.equal(result.text, '    a\n    \n    b\n')
  assert.deepEqual(result.strippedLines, [1])
})

test('纯函数：不改输入、返回新对象', () => {
  const text = 'a  \n'
  const result = stripTrailingSpacesForSave({ text, settings: { stripTrailingSpaces: 'Whole' } })
  assert.equal(text, 'a  \n')
  assert.equal(result.text, 'a\n')
  assert.notEqual(result.text, text)
})

test('四道门之一：strippingNotAllowed 时不落任何删除（:43-45）', () => {
  const result = stripTrailingSpacesForSave({
    text: 'a  \n',
    settings: { stripTrailingSpaces: 'Whole' },
    filters: [{ kind: 'not-allowed' }],
  })
  assert.equal(result.text, 'a  \n')
  assert.equal(result.chain.strippingNotAllowed, true)
  assert.deepEqual(result.strippedLines, [])
})