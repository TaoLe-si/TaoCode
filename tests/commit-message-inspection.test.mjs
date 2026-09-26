import test from 'node:test'
import assert from 'node:assert/strict'

import {
  addBlankLineAfterSubject,
  BODY_LIMIT_MESSAGE,
  COMMIT_MESSAGE_INSPECTION_STORAGE_KEY,
  DEFAULT_INSPECTION_SETTINGS,
  DEFAULT_RIGHT_MARGIN,
  exceedingText,
  FIX_LABELS,
  inspectCommitMessage,
  MISSING_BLANK_LINE_MESSAGE,
  reformatCommitMessage,
  resolveInspectionSettings,
  SUBJECT_LIMIT_MESSAGE,
  wrapBodyLines,
  wrapLine,
  wrapOnTyping,
} from '../src/commitMessageInspection.ts'

const settings = (over = {}) => ({ ...DEFAULT_INSPECTION_SETTINGS, ...over })

test('defaults match IDEA: both margins 72, all three inspections on, wrap-on-typing off', () => {
  // SubjectLimitInspection.kt:19 / BodyLimitInspection.kt:26 (RIGHT_MARGIN = 72),
  // VcsConfiguration.java:74 (WRAP_WHEN_TYPING_REACHES_RIGHT_MARGIN = false).
  assert.equal(DEFAULT_RIGHT_MARGIN, 72)
  assert.deepEqual(DEFAULT_INSPECTION_SETTINGS, {
    subjectLimit: true,
    subjectRightMargin: 72,
    bodyLimit: true,
    bodyRightMargin: 72,
    subjectBodySeparation: true,
    wrapOnTyping: false,
  })
  assert.equal(COMMIT_MESSAGE_INSPECTION_STORAGE_KEY, 'taocode.commitMessageInspections')
})

test('the subject check fires only past the margin and reports the excess range', () => {
  // checkRightMargin (:151): `end > start + rightMargin`, range = TextRange(start + margin, end).
  const exact = 'a'.repeat(72)
  assert.deepEqual(inspectCommitMessage(exact, settings()), [])

  const over = `${exact}b`
  const problems = inspectCommitMessage(over, settings())
  assert.equal(problems.length, 1)
  assert.equal(problems[0].kind, 'subject')
  assert.equal(problems[0].line, 0)
  assert.deepEqual([problems[0].start, problems[0].end], [72, 73])
  assert.equal(problems[0].message, SUBJECT_LIMIT_MESSAGE(72))
  assert.deepEqual(problems[0].fixes, ['reformat'])
  assert.equal(exceedingText(over, problems[0]), 'b')
})

test('the subject margin is configurable and a single-line message is never a separation problem', () => {
  assert.deepEqual(inspectCommitMessage('abcdefgh', settings({ subjectRightMargin: 8 })), [])
  assert.equal(inspectCommitMessage('abcdefghi', settings({ subjectRightMargin: 8 })).length, 1)
  // SubjectBodySeparationInspection.java:32 — `document.getLineCount() > 1` guards the check.
  assert.deepEqual(inspectCommitMessage('only one line', settings()), [])
})

test('a surrogate pair counts as two characters, like IDEA’s UTF-16 document', () => {
  const subject = `${'a'.repeat(71)}😀`
  assert.equal(subject.length, 73)
  const problems = inspectCommitMessage(subject, settings())
  assert.equal(problems.length, 1)
  assert.deepEqual([problems[0].start, problems[0].end], [72, 73])
  // The range starts inside the surrogate pair, exactly as IDEA's char offsets would.
  assert.equal(exceedingText(subject, problems[0]), '\ude00')
})

test('the body check walks every line from 1 on and names the offending line', () => {
  const long = 'x'.repeat(80)
  // Line 1 stays empty so that only the body check fires here.
  const text = ['subject', '', long, 'short', long].join('\n')
  const problems = inspectCommitMessage(text, settings())
  assert.deepEqual(problems.map(problem => [problem.kind, problem.line]), [['body', 2], ['body', 4]])
  assert.equal(problems[0].message, BODY_LIMIT_MESSAGE(72))
  assert.deepEqual(problems[0].fixes, ['wrap', 'reformat'])
})

test('the separation check reports the whole second line when it is not empty', () => {
  // SubjectBodySeparationInspection.java:33 — line 1 with right margin 0, so the range is the line.
  const text = 'subject\nbody starts right here'
  const problems = inspectCommitMessage(text, settings())
  assert.deepEqual(problems.map(problem => problem.kind), ['separation'])
  assert.equal(problems[0].line, 1)
  assert.deepEqual([problems[0].start, problems[0].end], [0, 'body starts right here'.length])
  assert.equal(problems[0].message, MISSING_BLANK_LINE_MESSAGE)
  assert.deepEqual(problems[0].fixes, ['blankLine', 'reformat'])

  // An empty line 1 is the expected shape: no problem at all.
  assert.deepEqual(inspectCommitMessage('subject\n\nbody', settings()), [])
})

test('line 1 can carry both the separation problem and a body-limit problem', () => {
  const text = `subject\n${'y'.repeat(90)}`
  const problems = inspectCommitMessage(text, settings())
  // Deterministic order: subject → separation → body within the same line.
  assert.deepEqual(problems.map(problem => problem.kind), ['separation', 'body'])
})

test('disabled inspections report nothing', () => {
  const text = `${'a'.repeat(90)}\n${'b'.repeat(90)}`
  assert.deepEqual(inspectCommitMessage(text, settings({ subjectLimit: false, bodyLimit: false })).map(p => p.kind), ['separation'])
  assert.deepEqual(inspectCommitMessage(text, settings({ subjectBodySeparation: false })).map(p => p.kind), ['subject', 'body'])
  assert.deepEqual(inspectCommitMessage(text, settings({ subjectLimit: false, bodyLimit: false, subjectBodySeparation: false })), [])
})

test('wrapLine breaks after the last space that fits', () => {
  assert.deepEqual(wrapLine('aaa bbb', 3), ['aaa', 'bbb'])
  assert.deepEqual(wrapLine('hello world', 5), ['hello', 'world'])
  assert.deepEqual(wrapLine('short', 72), ['short'])
})

test('wrapLine hard-breaks a word longer than the margin at the margin itself', () => {
  assert.deepEqual(wrapLine('abcdefg', 3), ['abc', 'def', 'g'])
  // A margin of 0 cannot advance: the line is returned untouched rather than looping forever.
  assert.deepEqual(wrapLine('abcdefg', 0), ['abcdefg'])
})

test('addBlankLineAfterSubject inserts one blank line and never doubles it', () => {
  assert.equal(addBlankLineAfterSubject('subject\nbody'), 'subject\n\nbody')
  assert.equal(addBlankLineAfterSubject('subject\n\nbody'), 'subject\n\nbody')
  // AddBlankLineQuickFix (:64) skips an empty line 1 and a single-line message entirely.
  assert.equal(addBlankLineAfterSubject('subject'), 'subject')
  assert.equal(addBlankLineAfterSubject('subject\n'), 'subject\n')
})

test('wrapBodyLines leaves the subject alone', () => {
  const subject = 'a'.repeat(90)
  const text = `${subject}\nbbb ccc ddd`
  const wrapped = wrapBodyLines(text, 7)
  const lines = wrapped.split('\n')
  assert.equal(lines[0], subject)
  assert.equal(lines.length > 2, true)
  for (const line of lines.slice(1)) assert.equal(line.length <= 7, true)
})

test('reformatCommitMessage is IDEA’s ReformatCommitMessageAction: blank line + wrapped body', () => {
  // ReformatCommitMessageAction.java:54-59 runs each enabled inspection's reformat.
  const text = `subject\n${'word '.repeat(20).trim()}`
  const reformatted = reformatCommitMessage(text, settings({ bodyRightMargin: 20 }))
  const lines = reformatted.split('\n')
  assert.equal(lines[0], 'subject')
  assert.equal(lines[1], '')
  for (const line of lines.slice(2)) assert.equal(line.length <= 20, true)

  // With both reformatters disabled the action is a no-op (no enabled inspection can reformat).
  assert.equal(reformatCommitMessage(text, settings({ bodyLimit: false, subjectBodySeparation: false })), text)
  // The subject is never rewritten: SubjectLimitInspection has no reformat of its own.
  const longSubject = `${'s'.repeat(80)}\nbody`
  assert.equal(reformatCommitMessage(longSubject, settings()).split('\n')[0], 's'.repeat(80))
})

test('wrapOnTyping wraps the caret line and moves the caret with the text', () => {
  const text = 'aaaa bbbb cccc'
  const result = wrapOnTyping(text, text.length, 9)
  assert.equal(result.text, 'aaaa bbbb\ncccc')
  assert.equal(result.caret, 'aaaa bbbb\ncccc'.length)

  // Short line: nothing happens, the caret is left exactly where it was.
  const short = 'aaaa'
  assert.deepEqual(wrapOnTyping(short, 2, 72), { text: short, caret: 2 })
  // A caret before the break keeps its position (the break is inserted after it).
  assert.deepEqual(wrapOnTyping(text, 3, 9), { text: 'aaaa bbbb\ncccc', caret: 3 })
  // Right after the dropped space the caret lands at the same logical spot.
  assert.deepEqual(wrapOnTyping(text, 5, 9), { text: 'aaaa bbbb\ncccc', caret: 5 })
  // Margin 0 disables the wrap (the setting’s 0..10000 range allows it).
  assert.deepEqual(wrapOnTyping(text, text.length, 0), { text, caret: text.length })
})

test('wrapOnTyping only touches the line the caret is on', () => {
  const text = `first line that is long\n${'z'.repeat(30)}\ntail`
  const caret = 'first line that is long\n'.length + 30
  const result = wrapOnTyping(text, caret, 10)
  const lines = result.text.split('\n')
  assert.equal(lines[0], 'first line that is long')
  assert.equal(lines[lines.length - 1], 'tail')
  assert.deepEqual(lines.slice(1, -1), ['z'.repeat(10), 'z'.repeat(10), 'z'.repeat(10)])
  // Only breaks are inserted — no character of the message is lost.
  assert.equal(result.text.replace(/\n/g, ''), text.replace(/\n/g, ''))
  assert.equal(result.caret, 'first line that is long\n'.length + 32)
})

test('resolveInspectionSettings falls back per field and clamps the margins', () => {
  assert.deepEqual(resolveInspectionSettings(null), DEFAULT_INSPECTION_SETTINGS)
  assert.deepEqual(resolveInspectionSettings('nonsense'), DEFAULT_INSPECTION_SETTINGS)
  assert.deepEqual(resolveInspectionSettings({ subjectRightMargin: 100 }), {
    ...DEFAULT_INSPECTION_SETTINGS,
    subjectRightMargin: 100,
  })
  // Out of the spinner’s 0..10000 range or not an integer → the default is kept.
  assert.equal(resolveInspectionSettings({ subjectRightMargin: 10001 }).subjectRightMargin, 72)
  assert.equal(resolveInspectionSettings({ subjectRightMargin: -1 }).subjectRightMargin, 72)
  assert.equal(resolveInspectionSettings({ bodyRightMargin: 72.5 }).bodyRightMargin, 72)
  assert.equal(resolveInspectionSettings({ bodyRightMargin: 0 }).bodyRightMargin, 0)
  // Booleans are only accepted as booleans.
  assert.equal(resolveInspectionSettings({ bodyLimit: false }).bodyLimit, false)
  assert.equal(resolveInspectionSettings({ bodyLimit: 'no' }).bodyLimit, true)
  assert.equal(resolveInspectionSettings({ wrapOnTyping: true }).wrapOnTyping, true)
})

test('fix labels come from the VcsBundle family names', () => {
  assert.deepEqual(FIX_LABELS, {
    reformat: '重新格式化提交信息',
    wrap: '换行',
    blankLine: '插入空行',
  })
})
