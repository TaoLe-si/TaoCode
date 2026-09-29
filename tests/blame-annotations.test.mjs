// 「追溯」（Annotate）的注解文本 —— 纯逻辑，对照 IDEA 的 `TextAnnotationGutterProvider`。
//
// 这一层要钉住三件事：
//   1. Git 注解默认 Date / Author 两列，缺字段时不留空分隔符；
//   2. 非法行号 / 空文本的行**不画**（IDEA 在 provider 返回 null 时同样不画）；
//   3. 「追溯」是一个 Toggle（`AnnotateToggleAction extends ToggleAction`），关掉或没数据时整列不显示。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SHORT_HASH_LENGTH,
  blameAnnotationText,
  blameAuthorName,
  blameAnnotationTooltip,
  blameAnnotations,
  blameAnnotationsVisible,
  shortHash,
} from '../src/blameAnnotations.ts'

test('the short hash keeps IDEA short-revision length', () => {
  assert.equal(SHORT_HASH_LENGTH, 7)
  assert.equal(shortHash('0123456789abcdef'), '01234567'.slice(0, 7))
  // Shorter than the limit is passed through, not padded.
  assert.equal(shortHash('abc'), 'abc')
})

// GitFileAnnotation.java:84-106,126-128: Date precedes Author; Revision is hidden by default.
test('Git annotation defaults to date then author, retaining revision in the tooltip', () => {
  const text = blameAnnotationText({ line: 3, author: '桃', hash: '0123456789abcdef', date: '2026-09-27' })
  assert.equal(text, '2026-09-27  桃')
})

test('Git authors use the source LASTNAME policy without a fabricated length cap', () => {
  assert.equal(blameAuthorName('  Ada   Lovelace  '), 'Lovelace')
  assert.equal(blameAuthorName('Ada <ada.lovelace@example.com> Lovelace'), 'Lovelace')
  assert.equal(blameAuthorName('<ada.lovelace@example.com>'), 'Lovelace')
  assert.equal(blameAuthorName('first_last@example.com'), 'Last')
  assert.equal(blameAuthorName('张三'), '张三')
  const longName = 'X'.repeat(100)
  assert.equal(blameAuthorName(longName), longName)
})

// 缺哪一段就少哪一段 —— 界面上绝不允许出现 "undefined" 或悬空的分隔符。
test('missing fields drop out of the text instead of leaving separators', () => {
  assert.equal(blameAnnotationText({ line: 1, author: 'A', hash: '', date: '' }), 'A')
  assert.equal(blameAnnotationText({ line: 1, author: '', hash: 'abcdef1234', date: '' }), '')
  assert.equal(blameAnnotationText({ line: 1, author: '', hash: '', date: '2026-09-27' }), '2026-09-27')
  assert.equal(blameAnnotationText({ line: 1, author: '  ', hash: '', date: '' }), '')
})

test('the tooltip carries the full hash, the mail and the summary', () => {
  const tooltip = blameAnnotationTooltip({
    line: 1, author: '桃', email: 'tao@example.com', hash: '0123456789abcdef',
    date: '2026-09-27', summary: '修好运行配置',
  })
  assert.equal(tooltip, '桃 <tao@example.com>\n0123456789abcdef\n2026-09-27\n修好运行配置')
  // No mail, no angle brackets.
  assert.equal(blameAnnotationTooltip({ line: 1, author: '桃', hash: 'h', date: '' }), '桃\nh')
})

test('invalid line numbers and empty texts produce no annotation', () => {
  const lines = [
    { line: 0, author: 'A', hash: 'h', date: 'd' },
    { line: -1, author: 'A', hash: 'h', date: 'd' },
    { line: 1.5, author: 'A', hash: 'h', date: 'd' },
    { line: 2, author: '', hash: '', date: '' },
    { line: 3, author: 'B', hash: 'abcdef1234', date: '2026-01-01' },
  ]
  assert.deepEqual(blameAnnotations(lines), [
    { line: 3, text: '2026-01-01  B', tooltip: 'B\nabcdef1234\n2026-01-01', date: '2026-01-01', author: 'B' },
  ])
})

// ToggleAction 的语义：关掉就是关掉，没数据也不该留一列空白装订线。
test('the annotation column shows only while the toggle is on and there is data', () => {
  const one = [{ line: 1, text: 'A · abcdef1', tooltip: '' }]
  assert.equal(blameAnnotationsVisible(true, one), true)
  assert.equal(blameAnnotationsVisible(false, one), false)
  assert.equal(blameAnnotationsVisible(true, []), false)
})

// 「Annotate 不是底部面板的 tab」这件事必须留在代码里：它曾经是底部的一个 tab，
// 回退成 tab 就等于把 IDEA 的装订线注解又错放一次。
test('annotate is an editor gutter, not a bottom-dock content', () => {
  const meta = readFileSync('src/toolWindowMeta.ts', 'utf8')
  const strip = meta.split('\n').find(l => l.includes('const BOTTOM_TABS'))
  assert.ok(strip, 'BOTTOM_TABS moved; revisit this assertion')
  assert.equal(strip.includes("'blame'"), false, 'blame is back in the bottom tab strip')

  const actions = readFileSync('src/toolWindowActions.ts', 'utf8')
  assert.equal(actions.includes('blameLines'), false, 'the bottom dock still model blame content')

  // 编辑器侧必须真的接上注解 gutter，否则这一列根本不会出现。
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  assert.ok(editor.includes('blameAnnotationsExtension()'), 'the editor no longer installs the annotation gutter')
  assert.ok(editor.includes(':blame=') || editor.includes('blame?: BlameAnnotation[]'), 'the editor lost its blame prop')

  const vcs = readFileSync('src/vcsActions.ts', 'utf8')
  assert.ok(vcs.includes('blameEnabled'), 'the annotate toggle state is gone')
  assert.equal(/bottom\.value = true\s*\n\s*showOutput\('blame'\)/.test(vcs), false, 'showBlame opens the bottom dock again')
})
