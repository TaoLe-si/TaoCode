// 保存时的两条执行体：去行尾空白 + 末行换行（`src/editorSaveTransforms.ts`）。
//
// 这批判据逐条指到上游行号（上游树在本地，`tests/source-citations.test.mjs` 会核这些引用）。
// 上游落点：
//   · `platform/platform-impl/src/com/intellij/openapi/editor/impl/TrailingSpacesStripper.java`
//     （:61-63 保存前触发、:80-109 末行换行段、:295-322 四道门、:324-399 provider 覆盖回落 IDE 设置）
//   · `platform/core-impl/src/com/intellij/openapi/editor/impl/StripTrailingSpacesUtil.java`
//     （:21-110 逐行扫描、:68-74 只认空格与制表符、:78-84 光标挡路、:100-106 倒序删除）
//   · `plugins/editorconfig/backend/src/configmanagement/EditorConfigTrailingSpacesOptionsProvider.kt`
//     （:13-23 两键至少解出一个、:39-41 changedLinesOnly = !trim、:48-56 只认 true/false）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyEditorConfigSaveOverrides, applySaveTextTransforms, changedLinesAgainstSaved,
  editorConfigSaveOverrides, editorConfigSaveOverridesFor, ensureNewLineAtEnd, isEditorConfigPath,
  lineRanges, offsetInText, saveTrimOptionsFor, saveTrimOptionsFromSettings, stripTrailingSpaces,
  STRIP_TRAILING_SPACES_CHANGED, STRIP_TRAILING_SPACES_NONE, STRIP_TRAILING_SPACES_WHOLE,
} from '../src/editorSaveTransforms.ts'
import { setCodeStyleToggles } from '../src/codeStyleSettings.ts'
import { EDITOR_CONFIG_KEYS_WITHOUT_CONSUMER, parseEditorConfig } from '../src/editorConfig.ts'

const here = dirname(fileURLToPath(import.meta.url))
const sourceOf = name => readFileSync(join(here, '..', 'src', name), 'utf8')

/** 上游默认档：清「改动过的行」的行尾空白，**不**补末行换行（EditorSettingsExternalizable.java:73-74）。 */
const UPSTREAM_DEFAULTS = saveTrimOptionsFromSettings()

// ---------------------------------------------------------------- IDE 设置那一层

test('上游默认档：STRIP=Changed / ENSURE=false / KEEP_ON_CARET=true / REMOVE_BLANK=false（:73-75,142）', () => {
  assert.deepEqual(UPSTREAM_DEFAULTS, {
    stripTrailingSpaces: true,
    changedLinesOnly: true,
    ensureNewLineAtEof: false,
    keepTrailingSpacesOnCaretLine: true,
    removeTrailingBlankLines: false,
  })
})

test('三档字面值的回落式（MyTrailingSpacesOptions:368-372 与 :387-391）', () => {
  assert.equal(saveTrimOptionsFromSettings({ stripTrailingSpaces: STRIP_TRAILING_SPACES_NONE }).stripTrailingSpaces, false)
  const changed = saveTrimOptionsFromSettings({ stripTrailingSpaces: STRIP_TRAILING_SPACES_CHANGED })
  assert.equal(changed.stripTrailingSpaces, true)
  assert.equal(changed.changedLinesOnly, true)   // 默认只清改动过的行
  const whole = saveTrimOptionsFromSettings({ stripTrailingSpaces: STRIP_TRAILING_SPACES_WHOLE })
  assert.equal(whole.changedLinesOnly, false)    // Whole = 整文件
  // None 档上游也仍然算「只清改动行」（:390 只把 Whole 排除），这条没人看得见，但它必须留在这个值上。
  assert.equal(saveTrimOptionsFromSettings({ stripTrailingSpaces: STRIP_TRAILING_SPACES_NONE }).changedLinesOnly, true)
})

test('缺字段走上游默认，不当成「用户显式关掉」（新增持久化字段的旧存档规矩）', () => {
  assert.deepEqual(saveTrimOptionsFromSettings({}), UPSTREAM_DEFAULTS)
  assert.equal(saveTrimOptionsFromSettings({ ensureNewLineAtEof: true }).ensureNewLineAtEof, true)
  assert.equal(saveTrimOptionsFromSettings({ keepTrailingSpacesOnCaretLine: false }).keepTrailingSpacesOnCaretLine, false)
})

// ---------------------------------------------------------------- .editorconfig 覆盖

test('两键的取值域：只认真假字面值，大小写不敏感（provider:48-56）', () => {
  assert.deepEqual(editorConfigSaveOverrides({ trim_trailing_whitespace: 'FALSE' }),
    { stripTrailingSpaces: false, changedLinesOnly: true, enforcedRemoval: false })
  assert.equal(editorConfigSaveOverrides({ insert_final_newline: 'True' }).ensureNewLineAtEof, true)
  // 上游的 `getBooleanValue` 对 `yes` / `1` / `unset` 一律解不出 ⇒ 整份 options 不生效
  assert.equal(editorConfigSaveOverrides({ trim_trailing_whitespace: 'yes' }), null)
  assert.equal(editorConfigSaveOverrides({ trim_trailing_whitespace: 'unset', insert_final_newline: 'none' }), null)
  assert.equal(editorConfigSaveOverrides({}), null)
})

test('trim=true ⇒ 整文件清 + ENFORCED_REMOVAL；trim=false ⇒ 完全不清（provider:39-41、filter factory:32-33）', () => {
  const on = editorConfigSaveOverrides({ trim_trailing_whitespace: 'true' })
  assert.equal(on.stripTrailingSpaces, true)
  assert.equal(on.changedLinesOnly, false)
  assert.equal(on.enforcedRemoval, true)
  const off = editorConfigSaveOverrides({ trim_trailing_whitespace: 'false' })
  assert.equal(off.stripTrailingSpaces, false)
  assert.equal(off.enforcedRemoval, false)
})

test('provider 只覆盖解得出的字段，其余保留 IDE 档（TrailingSpacesStripper:337-365 的先设者胜）', () => {
  const base = saveTrimOptionsFromSettings({ ensureNewLineAtEof: true })
  const merged = applyEditorConfigSaveOverrides(base, editorConfigSaveOverrides({ trim_trailing_whitespace: 'true' }))
  assert.equal(merged.ensureNewLineAtEof, true)          // 没被 trim 键动到
  assert.equal(merged.changedLinesOnly, false)
  // 整份不生效（两键都解不出）⇒ 原样返回
  assert.equal(applyEditorConfigSaveOverrides(base, null), base)
})

// ---------------------------------------------------------------- 行模型

test('行区间不含行分隔符；结尾有换行时多出一个空行（上游 getLineCount 同档）', () => {
  assert.deepEqual(lineRanges('a\nb'), [{ start: 0, end: 1 }, { start: 2, end: 3 }])
  assert.deepEqual(lineRanges('a\n'), [{ start: 0, end: 1 }, { start: 2, end: 2 }])
  assert.deepEqual(lineRanges('a\r\nb'), [{ start: 0, end: 1 }, { start: 3, end: 4 }])
  assert.deepEqual(lineRanges(''), [{ start: 0, end: 0 }])
})

test('行列 → 正文偏移：CRLF 正文要按分隔符长度累加（不是 CodeMirror 的内部偏移）', () => {
  assert.equal(offsetInText('ab\r\ncd', 1, 1), 5)
  assert.equal(offsetInText('ab\ncd', 1, 1), 4)
  assert.equal(offsetInText('ab', 9, 9), 2)   // 越界钳到行尾，不越出正文
})

// ---------------------------------------------------------------- 第一段：去行尾空白

test('只认空格与制表符；`\r` 属于分隔符 ⇒ CRLF 文件也能清（StripTrailingSpacesUtil:68-74）', () => {
  assert.equal(stripTrailingSpaces({ text: 'a  \t\nb' }).text, 'a\nb')
  assert.equal(stripTrailingSpaces({ text: 'a  \r\nb' }).text, 'a\r\nb')
  // 行中间的空白不动（:68 是从行尾往回扫）
  assert.equal(stripTrailingSpaces({ text: 'a  b  ' }).text, 'a  b')
  // 非空白字符挡住就停：行尾那个空格**在反斜杠前面**，所以整行不动
  const continued = 'a\\ \\'
  assert.equal(stripTrailingSpaces({ text: continued }).text, continued)
})

test('整篇清 ⇒ 多处行尾空白倒序删除后互不串位（:100-106）', () => {
  const input = 'one   \ntwo\t\t\nthree\nfour \n'
  const result = stripTrailingSpaces({ text: input })
  assert.equal(result.text, 'one\ntwo\nthree\nfour\n')
  assert.deepEqual(result.strippedLines, [0, 1, 3])
})

test('只清改动过的行：基线里没有变的那几行保持原样（:62 的 isLineModified 档）', () => {
  const saved = 'aaa   \nbbb   \nccc   '
  const current = 'aaa X \nbbb   \nccc   '     // 只有第 0 行内容变了
  assert.deepEqual([...changedLinesAgainstSaved(saved, current)], [0])
  const only = stripTrailingSpaces({ text: current, changedLinesOnly: true, savedText: saved })
  assert.equal(only.text, 'aaa X\nbbb   \nccc   ')
  assert.deepEqual(only.strippedLines, [0])
  // 整文件档 ⇒ 三行都清
  assert.equal(stripTrailingSpaces({ text: current }).text, 'aaa X\nbbb\nccc')
})

test('只清改动过的行、但拿不到基线 ⇒ 一行都不清（不猜哪些行改过）', () => {
  const result = stripTrailingSpaces({ text: 'a   \n', changedLinesOnly: true })
  assert.equal(result.text, 'a   \n')
  assert.deepEqual(result.strippedLines, [])
})

test('光标挡路的那一行留到下次，光标在行首不影响清理（:78-84）', () => {
  const text = 'abc   \ndef   '
  const inside = stripTrailingSpaces({ text, caretOffsets: [5] })     // 光标在行尾空白里
  assert.equal(inside.text, 'abc   \ndef')
  assert.deepEqual(inside.deferredLines, [0])
  assert.deepEqual(inside.strippedLines, [1])
  const atStart = stripTrailingSpaces({ text, caretOffsets: [0] })    // 光标在行首：仍清
  assert.equal(atStart.text, 'abc\ndef')
  assert.deepEqual(atStart.deferredLines, [])
  // 同一行多个光标取最大的那个（:49-53）
  assert.deepEqual(stripTrailingSpaces({ text: 'abc   ', caretOffsets: [0, 5] }).deferredLines, [0])
})

test('语言 filter：保留 N 个（Smart filter）与否决整行（-1，:112-121）', () => {
  const text = 'a    \nb    \nc    '
  const leaveTwo = stripTrailingSpaces({ text, trailingSpacesToLeave: line => (line === 0 ? 2 : 0) })
  assert.equal(leaveTwo.text, 'a  \nb\nc')
  const vetoFirst = stripTrailingSpaces({ text, trailingSpacesToLeave: line => (line === 0 ? -1 : 0) })
  assert.equal(vetoFirst.text, 'a    \nb\nc')
  // 保留数大于实际空白数 ⇒ 不动这一行（上游 finalStart < lineEnd 才会删）
  assert.equal(stripTrailingSpaces({ text: 'a  ', trailingSpacesToLeave: () => 5 }).text, 'a  ')
})

test('ENFORCED_REMOVAL 让 filter 全部作废（StripTrailingSpacesUtil:35-38）', () => {
  const text = 'a   \nb   '
  assert.equal(stripTrailingSpaces({ text, trailingSpacesToLeave: () => 2 }).text, 'a  \nb  ')
  assert.equal(stripTrailingSpaces({ text, trailingSpacesToLeave: () => 2, enforcedRemoval: true }).text, 'a\nb')
})

test('NOT_ALLOWED 整篇否决（:43-45 的 specialFilter 短路）', () => {
  assert.equal(stripTrailingSpaces({ text: 'a   \n', strippingNotAllowed: true }).text, 'a   \n')
})

test('纯空白行按普通行处理：整行清成空行（上游没有装 KEEP_INDENTS_ON_EMPTY_LINES 档）', () => {
  assert.equal(stripTrailingSpaces({ text: 'a\n   \nb\n' }).text, 'a\n\nb\n')
})

// ---------------------------------------------------------------- 第二段：末行换行

test('末行非空 ⇒ 补一个换行；已经有末行换行 ⇒ 原样（TrailingSpacesStripper:81-95）', () => {
  assert.deepEqual(ensureNewLineAtEnd({ text: 'a\nb', stripTrailingSpaces: false, keepTrailingSpacesOnCaretLine: true }),
    { text: 'a\nb\n', action: 'added' })
  assert.equal(ensureNewLineAtEnd({ text: 'a\nb\n', stripTrailingSpaces: false, keepTrailingSpacesOnCaretLine: true }).action, 'unchanged')
  assert.equal(ensureNewLineAtEnd({ text: '', stripTrailingSpaces: false, keepTrailingSpacesOnCaretLine: true }).action, 'unchanged')
})

test('末行是纯空白 + 开了行尾清理 ⇒ **删掉末行**而不是补换行（:89-92）', () => {
  assert.deepEqual(ensureNewLineAtEnd({ text: 'a\n   ', stripTrailingSpaces: true, keepTrailingSpacesOnCaretLine: true }),
    { text: 'a\n', action: 'last-line-cleared' })
  // 没开行尾清理 ⇒ 走 else 分支补换行（同一行的两个分支都由 stripTrailingSpaces 决定）
  assert.deepEqual(ensureNewLineAtEnd({ text: 'a\n   ', stripTrailingSpaces: false, keepTrailingSpacesOnCaretLine: true }),
    { text: 'a\n   \n', action: 'added' })
})

test('光标落在末行 + keepTrailingSpacesOnCaretLine ⇒ 不删末行，改走补换行（:90 + :98-106）', () => {
  const base = { text: 'a\n  ', stripTrailingSpaces: true, caretOffsets: [3] }
  assert.equal(ensureNewLineAtEnd({ ...base, keepTrailingSpacesOnCaretLine: true }).action, 'added')
  assert.equal(ensureNewLineAtEnd({ ...base, keepTrailingSpacesOnCaretLine: false }).action, 'last-line-cleared')
})

// ---------------------------------------------------------------- 保存入口

test('四道门：不可写 / 没有文件 / 文件已失效 / 被临时禁用 ⇒ 整条 pass 不做（:295-322）', () => {
  const options = { ...UPSTREAM_DEFAULTS, changedLinesOnly: false }
  const cases = [
    [{ writable: false }, 'document-not-writable'],
    [{ backedByFile: false }, 'no-backing-file'],
    [{ fileValid: false }, 'file-invalid'],
    [{ strippingDisabledForFile: true }, 'stripping-disabled-for-file'],
  ]
  for (const [gate, reason] of cases) {
    const result = applySaveTextTransforms({ path: 'a.txt', text: 'a  \n', options, ...gate })
    assert.equal(result.text, 'a  \n', `门 ${reason} 不过时正文必须原样`)
    assert.equal(result.skipped, reason)
    assert.equal(result.changed, false)
  }
  assert.equal(applySaveTextTransforms({ path: 'a.txt', text: 'a  \n', options }).skipped, null)
})

test('执行顺序：先清行尾、再判末行 ⇒ "x   " 结尾落成 "x\\n"（strip() 的 :69-110 先后）', () => {
  const options = { ...UPSTREAM_DEFAULTS, changedLinesOnly: false, ensureNewLineAtEof: true }
  const result = applySaveTextTransforms({ path: 'a.txt', text: 'a\nx   ', options })
  assert.equal(result.text, 'a\nx\n')
  assert.equal(result.finalNewLine, 'added')
  assert.deepEqual(result.strippedLines, [1])
  assert.equal(result.changed, true)
})

test('设置项「光标所在行保留行尾空白」= 关 ⇒ 光标那一行照样清、且不记延后行（TrailingSpacesStripper.java:70 → :229 的 skipCaretLines）', () => {
  // 上游这一格不是「判不判」，是「传不传光标」：`:70` 把 `isKeepTrailingSpacesOnCaretLine()` 当第三个实参，
  // `:229` 的 `skipCaretLines ? caretOffsets : null` 关掉时直接不传 ⇒ `StripTrailingSpacesUtil.java:78-84` 走不到。
  for (const [keep, expected, stripped, deferred] of [
    [true, 'abc   \ndef', [1], [0]],
    [false, 'abc\ndef', [0, 1], []],
  ]) {
    const result = applySaveTextTransforms({
      path: 'a.txt', text: 'abc   \ndef   ', caretOffsets: [5],   // 光标落在第 0 行的行尾空白里
      options: { ...UPSTREAM_DEFAULTS, changedLinesOnly: false, keepTrailingSpacesOnCaretLine: keep },
    })
    assert.equal(result.text, expected, `keepTrailingSpacesOnCaretLine=${keep} 时的正文`)
    assert.deepEqual(result.strippedLines, stripped)
    assert.deepEqual(result.deferredLines, deferred)
  }
})

test('两条都关 ⇒ 正文一字不动（None 档 + 不补末行换行）', () => {
  const options = saveTrimOptionsFromSettings({ stripTrailingSpaces: STRIP_TRAILING_SPACES_NONE })
  const result = applySaveTextTransforms({ path: 'a.txt', text: 'a   \nb', options })
  assert.deepEqual(result, {
    text: 'a   \nb', changed: false, skipped: null, strippedLines: [], deferredLines: [], finalNewLine: 'not-requested',
  })
})

test('removeTrailingBlankLines 只有契约字段、没有执行体（本批只点名两条）', () => {
  const options = { ...UPSTREAM_DEFAULTS, changedLinesOnly: false, removeTrailingBlankLines: true }
  assert.equal(applySaveTextTransforms({ path: 'a.txt', text: 'a\n\n\n', options }).text, 'a\n\n\n')
})

// ---------------------------------------------------------------- 「光标所在行」那条格子的端到端链
//
// 派单第 3 条要核的就是这一条：**设置页 → 存 → 读 → 执行** 四段一段都不能缺。
// 每一段单独都有别人家的判据（`tests/setkeys-batch.test.mjs` 钉键、本文件钉执行），
// 这里钉的是「链」：任何一段被摘掉，本条就红。
test('端到端：keepTrailingSpacesOnCaretLine 从设置页一路走到执行体（四段齐全）', () => {
  const key = 'keepTrailingSpacesOnCaretLine'
  // ① 设置页那一格（控件绑的是模型字段，不是自造的状态）。
  const dialog = sourceOf(join('components', 'EditorSavePassesFields.vue'))
  assert.match(dialog, new RegExp(`v-model="settings\\.${key}"`), '① 设置页没有这一格')
  // ② 存：对话框的「应用」把整份 editor 设置发 `settings.update`，宿主白名单里有这个键。
  const app = sourceOf('App.vue')
  assert.match(app, /request<EditorSettings>\('settings\.update'/, '② 前端没有把 editor 设置发给宿主')
  assert.match(sourceOf(join('..', 'native', 'settings_schema.hpp')), new RegExp(`"${key}"`), '② 宿主白名单里没有这个键')
  // ③ 读：旧存档缺键按上游默认补（`EditorSettingsExternalizable.java:142` = true），不判损坏。
  assert.match(sourceOf(join('..', 'native', 'settings_schema.cpp')), new RegExp(`\\{"${key}", true\\}`), '③ 宿主默认值不是上游的 true')
  assert.match(sourceOf('settingsModel.ts'), new RegExp(`${key}: true`), '③ 前端默认值不是 true')
  // ④ 执行：真值被喂进 pass，并且执行体真的按它决定「传不传光标」（TrailingSpacesStripper.java:70 → :229）。
  const fileOps = sourceOf('editorFileOps.ts')
  assert.match(fileOps, new RegExp(`${key}: editorSettings\\.value\\.${key}`), '④ editorFileOps 没把真值喂给 saveTrimOptionsFor')
  assert.match(sourceOf('editorSaveTransforms.ts'),
    new RegExp(`caretOffsets: input\\.options\\.${key} \\? input\\.caretOffsets : undefined`),
    '④ 执行体没按这一格决定传不传光标 ⇒ 关了设置还是不清光标行')
  // ⑤ 消费链的最后一环：这一格的真值**改变了落盘正文**（两段 pass 都受它管：
  //   `:70 → :229` 决定清不清光标行，`:89-92` 决定末行纯空白时删掉还是补换行）。
  const off = applySaveTextTransforms({
    path: 'a.txt', text: 'a\n  ', caretOffsets: [3],
    options: { ...UPSTREAM_DEFAULTS, changedLinesOnly: false, ensureNewLineAtEof: true, keepTrailingSpacesOnCaretLine: false },
  })
  assert.equal(off.text, 'a\n', '关掉这一格 ⇒ 光标那行的两个空格被清掉，于是末行已经空了，没有东西可补')
  assert.equal(off.finalNewLine, 'unchanged')
  assert.deepEqual(off.strippedLines, [1])
  const on = applySaveTextTransforms({
    path: 'a.txt', text: 'a\n  ', caretOffsets: [3],
    options: { ...UPSTREAM_DEFAULTS, changedLinesOnly: false, ensureNewLineAtEof: true },
  })
  assert.equal(on.text, 'a\n  \n', '默认档（true）⇒ 光标行被挡着不删（:78-84），末行改走补换行（:94）')
  assert.equal(on.finalNewLine, 'added')
  assert.deepEqual(on.deferredLines, [1])
})

// ---------------------------------------------------------------- .editorconfig 的层级

const configReader = files => async dir => {
  const content = files[dir]
  if (content === undefined) return null
  if (content === 'BAD') throw new Error('坏文件')
  return parseEditorConfig(content)
}

test('editorconfig：trim 与 insert_final_newline 都能从配置里生效（saveTrimOptionsFor）', async () => {
  const read = configReader({ '': '[*]\ntrim_trailing_whitespace = false\ninsert_final_newline = true\n' })
  const resolved = await saveTrimOptionsFor({ path: 'src/a.py', read })
  assert.equal(resolved.options.stripTrailingSpaces, false)
  assert.equal(resolved.options.ensureNewLineAtEof, true)
  assert.equal(resolved.enforcedRemoval, false)
})

test('editorconfig：离文件最近的赢（两层的生效顺序）', async () => {
  const read = configReader({
    '': '[*]\ninsert_final_newline = false\ntrim_trailing_whitespace = true\n',
    'src': '[*]\ninsert_final_newline = true\n',
  })
  const resolved = await saveTrimOptionsFor({ path: 'src/a.py', read })
  assert.equal(resolved.options.ensureNewLineAtEof, true, '近层的 insert_final_newline 必须压过远层')
  assert.equal(resolved.options.stripTrailingSpaces, true)
  assert.equal(resolved.enforcedRemoval, true)
})

test('editorconfig：坏文件停止往上找、root=true 收口（EditorConfigPropertiesService.kt:95-103）', async () => {
  const broken = await saveTrimOptionsFor({
    path: 'src/a/b.py',
    read: configReader({ 'src/a': 'BAD', '': '[*]\ninsert_final_newline = true\n' }),
  })
  assert.equal(broken.options.ensureNewLineAtEof, false, '坏文件之上的层不该被读到')
  const rooted = await saveTrimOptionsFor({
    path: 'src/a/b.py',
    read: configReader({ 'src/a': 'root = true\n[*]\ninsert_final_newline = true\n', '': '[*]\ntrim_trailing_whitespace = false\n' }),
  })
  assert.equal(rooted.options.ensureNewLineAtEof, true)
  assert.equal(rooted.options.stripTrailingSpaces, true, 'root=true 之外的远层不再参与合并')
})

test('editorconfig：.editorconfig 自己不被这些键覆盖；总开关关掉 ⇒ 整层不生效（Utils.kt:243-253）', async () => {
  const read = configReader({ '': '[*]\ntrim_trailing_whitespace = false\n' })
  assert.equal((await saveTrimOptionsFor({ path: '.editorconfig', read })).options.stripTrailingSpaces, true)
  assert.equal((await saveTrimOptionsFor({ path: 'sub/.EditorConfig', read })).options.stripTrailingSpaces, true)
  const noReader = await saveTrimOptionsFor({ path: 'src/a.py' })
  assert.equal(noReader.options.ensureNewLineAtEof, false, '没有 reader 时这一层不覆盖')
  assert.equal(noReader.enforcedRemoval, false)
  const toggles = { editorConfigEnabled: false }
  setCodeStyleToggles(toggles)
  try {
    assert.equal((await saveTrimOptionsFor({ path: 'src/a.py', read })).options.stripTrailingSpaces, true)
  } finally {
    setCodeStyleToggles({ editorConfigEnabled: true })
  }
})

test('isEditorConfigPath：只认文件名，目录里出现的同名文件也算（Utils.kt:243-247）', () => {
  assert.equal(isEditorConfigPath('a/.editorconfig'), true)
  assert.equal(isEditorConfigPath('a\\.EDITORCONFIG'), true)
  assert.equal(isEditorConfigPath('.editorconfig.local'), false)
  assert.equal(isEditorConfigPath('src/main.py'), false)
})

// ---------------------------------------------------------------- 缺口收口与接线（不许放松）

test('editorConfig.ts 的「没有消费方」清单不再包含这两个键（§C 缺口第 ① 条的自陈行）', () => {
  assert.deepEqual([...EDITOR_CONFIG_KEYS_WITHOUT_CONSUMER], ['end_of_line', 'charset', 'max_line_length'])
  const config = sourceOf('editorConfig.ts')
  assert.ok(!config.includes('本批未做'), '自陈「解析了但没执行」的句子必须删掉，否则缺口还挂着')
})

test('保存 pass 有真实生产消费方（不是只有模型的死模块）', () => {
  const fileOps = sourceOf('editorFileOps.ts')
  assert.match(fileOps, /from '\.\/editorSaveTransforms\.ts'/)
  assert.match(fileOps, /applySaveTextTransforms\(/)
  assert.match(fileOps, /transformOnSave,/)     // 出口在 createEditorFileOps 的返回值里
})

test('设置页没有渲染还没有消费链路的格子（不放假控件）', () => {
  // 原写「这一格不该出现」（键还没落地）、实际 2026-10-06 键已落地：
  // `docs/wiring-requests-2026-10-06-saveops.md` ②/③ 要的就是「键与格子同批落」，
  // 并写明落完后把本条改成**反向**判据（渲染了就必须有消费链路），不许删。
  // 四处登记与旧存档补默认的逐键判据在 `tests/setkeys-batch.test.mjs`。
  const dialog = sourceOf(join('components', 'EditorSavePassesFields.vue'))
  const model = sourceOf('settingsModel.ts')
  for (const key of ['stripTrailingSpaces', 'ensureNewLineAtEof', 'keepTrailingSpacesOnCaretLine']) {
    assert.match(dialog, new RegExp(`v-model(\\.number)?="settings\\.${key}"`), `设置页没有绑 ${key}`)
    assert.match(model, new RegExp(`\\b${key}: `), `设置模型里没有 ${key}`)
  }
  // 三档字面值必须是上游那三个常量（EditorSettingsExternalizable.java:216-218），不许自造。
  assert.match(dialog, /value: 'None'/)
  assert.match(dialog, /value: 'Changed'/)
  assert.match(dialog, /value: 'Whole'/)
  // 消费链路两头都在：执行体读这三条，宿主把设置真值喂进去。
  const transforms = sourceOf('editorSaveTransforms.ts')
  assert.match(transforms, /settings\.stripTrailingSpaces/)
  assert.match(transforms, /settings\.ensureNewLineAtEof/)
  assert.match(transforms, /settings\.keepTrailingSpacesOnCaretLine/)
  assert.match(sourceOf('editorFileOps.ts'), /stripTrailingSpaces: editorSettings\.value\.stripTrailingSpaces/)
  // **仍然不许**出现 `removeTrailingBlankLines` 那一格：它只有契约字段、没有执行体。
  assert.ok(!/removeTrailingBlankLines/.test(dialog), '那一条没有执行体，落了就是假控件')
})
