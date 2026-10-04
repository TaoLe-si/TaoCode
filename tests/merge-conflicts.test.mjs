// 合并冲突的逐条解决（B7 `merge` 域里**没有三栏工具**那条路的功能落点）。
//
// 上游要点（逐条核过）：
//   · `MergeThreesideViewer.java:333-336` `handleAcceptSide` —— 两个按钮「接受左侧 / 接受右侧」，
//     文案取 `button.merge.resolve.accept.left` / `.right`（中文包 `DiffBundle.properties:47-48`
//     就是这两句）；
//   · 上游那张三栏工具读的是 **VCS 给的三份内容**，不是文件里的标记文本；整棵上游树上唯一认
//     `<<<<<<<` 的地方是 `GitMergeUtil.java:63-67` 的 `MERGE_MARKERS`（判断文件还在不在冲突态）。
//     本仓没有索引三阶段那条路，走的是标记文本（同一场景的另一种入口，见 src/mergeConflicts.ts）；
//   · 上游**没有**「接受两者」按钮 —— 本仓也不提供（想两边都要就在缓冲区里手编）。
//
// 「只认成对标记」这条是刻意的：用户正编辑到一半（只有一个 `<<<<<<<`）时若当冲突处理，
// 导航条会插进来抢焦点、接受动作还会删掉半截内容。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ACCEPT_LEFT_TEXT, ACCEPT_RIGHT_TEXT, CONFLICTS_BANNER,
  acceptSide, caretAfterAccept, conflictAt, conflictStatus, conflictsIn,
  nextConflict, parseConflicts, unresolvedCount,
} from '../src/mergeConflicts.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 一份两处冲突的文件（第一处在头，第二处在尾）。 */
function twoConflicts() {
  return [
    'header',
    '<<<<<<< HEAD',
    'ours one',
    '=======',
    'theirs one',
    '>>>>>>> feature/a',
    'middle',
    '<<<<<<< HEAD',
    'ours two',
    '=======',
    'theirs two',
    '>>>>>>> feature/b',
    'footer',
  ].join('\n')
}

// —— parseConflicts ——

test('a two-way conflict is parsed into both sides', () => {
  const conflicts = parseConflicts(['before', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> other', 'after'].join('\n'))
  assert.equal(conflicts.length, 1)
  const [c] = conflicts
  assert.deepEqual(
    { startLine: c.startLine, middleLine: c.middleLine, baseLine: c.baseLine, endLine: c.endLine },
    { startLine: 1, middleLine: 3, baseLine: null, endLine: 5 },
  )
  assert.deepEqual(c.ours, { from: 2, to: 3 }, '左侧一行 = ours')
  assert.deepEqual(c.theirs, { from: 4, to: 5 }, '右侧一行 = theirs')
})

test('a diff3 conflict records the base line and keeps the base out of both sides', () => {
  const content = ['<<<<<<< HEAD', 'ours', '||||||| merged common ancestors', 'base', '=======', 'theirs', '>>>>>>> other'].join('\n')
  const [c] = parseConflicts(content)
  assert.equal(c.baseLine, 2)
  assert.deepEqual(c.ours, { from: 1, to: 2 }, '左侧到 base 行为止')
  assert.deepEqual(c.theirs, { from: 5, to: 6 })
})

test('an unpaired marker is not a conflict', () => {
  // 只有头、只有尾、以及夹在中间的半截标记 —— 三种都不是冲突。
  assert.deepEqual(parseConflicts(['<<<<<<< HEAD', 'ours', 'nothing else'].join('\n')), [])
  assert.deepEqual(parseConflicts(['ours', '=======', 'theirs'].join('\n')), [])
  assert.deepEqual(parseConflicts(['<<<<<<< HEAD', 'ours', '=======', 'theirs'].join('\n')), [], '没有 `>>>>>>>` 就不闭合')
  assert.deepEqual(parseConflicts('plain file\nno markers at all\n'), [])
})

test('a nested start marker aborts that conflict instead of pairing across it', () => {
  const content = ['<<<<<<< HEAD', 'ours', '<<<<<<< HEAD', 'inner', '=======', 'theirs', '>>>>>>> x'].join('\n')
  // 里层那对成对、外层没闭合 —— 只认同闭合的那一处，外层整段不算。
  const conflicts = parseConflicts(content)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].startLine, 2, '认的是里层那一处')
})

test('every conflict in the file is listed in order', () => {
  const conflicts = parseConflicts(twoConflicts())
  assert.equal(conflicts.length, 2)
  assert.deepEqual(conflicts.map(c => c.startLine), [1, 7])
  assert.equal(unresolvedCount(twoConflicts()), 2)
})

test('an empty or marker-free document has no conflicts', () => {
  assert.equal(unresolvedCount(''), 0)
  assert.equal(unresolvedCount('just\nsome\nlines\n'), 0)
})

// `conflictsIn` 是编辑器那条热路径的入口：没有标记的文件里必须一次 split 都不做。
test('conflictsIn returns the same list as parseConflicts when markers exist', () => {
  const content = twoConflicts()
  assert.deepEqual(conflictsIn(content), parseConflicts(content))
  assert.equal(conflictsIn(content).length, 2)
})

test('conflictsIn short-circuits on files without markers', () => {
  assert.deepEqual(conflictsIn(''), [])
  assert.deepEqual(conflictsIn('no markers here\n'), [])
  // 预检只认整串 `<<<<<<<`（短一个字符就不该进解析）。
  assert.deepEqual(conflictsIn('a <<<<< b\n=======\n'), [])
  // 预检命中但没闭合时，结果还是空 —— 预检只是省一次 split，判定仍归 parseConflicts。
  assert.deepEqual(conflictsIn('<<<<<<< HEAD\nours\n'), [])
})

// —— acceptSide ——

test('accepting the left side keeps ours and drops the markers', () => {
  const content = ['before', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> other', 'after'].join('\n')
  const [c] = parseConflicts(content)
  assert.equal(acceptSide(content, c, 'left'), ['before', 'ours', 'after'].join('\n'))
})

test('accepting the right side keeps theirs and drops the markers', () => {
  const content = ['before', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> other', 'after'].join('\n')
  const [c] = parseConflicts(content)
  assert.equal(acceptSide(content, c, 'right'), ['before', 'theirs', 'after'].join('\n'))
})

test('a multi-line side is kept whole', () => {
  const content = ['<<<<<<< HEAD', 'a1', 'a2', '=======', 'b1', 'b2', 'b3', '>>>>>>> x'].join('\n')
  const [c] = parseConflicts(content)
  assert.equal(acceptSide(content, c, 'left'), ['a1', 'a2'].join('\n'))
  assert.equal(acceptSide(content, c, 'right'), ['b1', 'b2', 'b3'].join('\n'))
})

test('accepting diff3 keeps only the chosen side, never the base', () => {
  const content = ['<<<<<<< HEAD', 'ours', '||||||| base', 'base', '=======', 'theirs', '>>>>>>> x'].join('\n')
  const [c] = parseConflicts(content)
  assert.equal(acceptSide(content, c, 'left'), 'ours')
  assert.equal(acceptSide(content, c, 'right'), 'theirs')
})

// 一次只解决一处：第二处原样留着（用户逐条过）。
test('accepting one conflict leaves the others alone', () => {
  const content = twoConflicts()
  const first = parseConflicts(content)[0]
  const after = acceptSide(content, first, 'right')
  assert.equal(unresolvedCount(after), 1, '还剩一处')
  const rest = parseConflicts(after)
  // 前面那 5 行（4 行标记+内容 + 原 `>>>>>>>`）换成了 1 行，后面的整体上移 4 行。
  assert.equal(rest[0].startLine, 3)
  assert.deepEqual(rest[0].ours, { from: 4, to: 5 }, '第二处的行号已经随着删除前移')
})

// 接受之后 **标记必须没了**（否则计数不会减，导航会原地打转）。
test('an accepted conflict no longer contains its markers', () => {
  const content = ['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> x'].join('\n')
  const [c] = parseConflicts(content)
  const after = acceptSide(content, c, 'left')
  assert.ok(!after.includes('<<<<<<<') && !after.includes('=======') && !after.includes('>>>>>>>'))
})

test('the caret lands on the first line of what was accepted', () => {
  const content = ['before', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> other', 'after'].join('\n')
  const [c] = parseConflicts(content)
  assert.equal(caretAfterAccept(c), 1, '接受后这一块的第一行就是原来 `<<<<<<<` 的位置')
})

// —— nextConflict / conflictAt / conflictStatus ——

test('next jumps forward and wraps around at the end', () => {
  const conflicts = parseConflicts(twoConflicts())
  assert.equal(nextConflict(conflicts, 0)?.startLine, 1)
  assert.equal(nextConflict(conflicts, 1)?.startLine, 7, '在第一条上再按"下一个"去第二条')
  assert.equal(nextConflict(conflicts, 7)?.startLine, 1, '到底了回绕到第一条')
})

test('previous jumps backward and wraps around at the top', () => {
  const conflicts = parseConflicts(twoConflicts())
  assert.equal(nextConflict(conflicts, 7, true)?.startLine, 1)
  assert.equal(nextConflict(conflicts, 1, true)?.startLine, 7, '在第一条上往回 = 最后一条')
  assert.equal(nextConflict(conflicts, 99, true)?.startLine, 7)
})

test('navigation on a file without conflicts does nothing', () => {
  assert.equal(nextConflict([], 3), null)
  assert.equal(nextConflict([], 3, true), null)
})

test('conflictAt reports the conflict the caret sits in', () => {
  const conflicts = parseConflicts(twoConflicts())
  assert.equal(conflictAt(conflicts, 0), null, '标记之前不算')
  assert.equal(conflictAt(conflicts, 1)?.startLine, 1, '`<<<<<<<` 那一行算')
  assert.equal(conflictAt(conflicts, 5)?.startLine, 1, '`>>>>>>>` 那一行也算')
  assert.equal(conflictAt(conflicts, 6), null, '两块中间的空档不算')
  assert.equal(conflictAt(conflicts, 7)?.startLine, 7)
})

test('the status reads as 第几条/共几条 and follows the caret', () => {
  const conflicts = parseConflicts(twoConflicts())
  assert.equal(conflictStatus(conflicts, 2), '1/2')
  assert.equal(conflictStatus(conflicts, 8), '2/2')
  assert.equal(conflictStatus(conflicts, 0), '1/2', '不在任何一块里时显示第一条')
  assert.equal(conflictStatus([], 0), '', '没有冲突就不显示计数')
})

// —— 文案（取随 IDE 发货的中文包）——

test('the accept labels are the shipped Chinese strings', () => {
  assert.equal(ACCEPT_LEFT_TEXT, '接受左侧')
  assert.equal(ACCEPT_RIGHT_TEXT, '接受右侧')
  assert.equal(CONFLICTS_BANNER, '合并冲突')
})

// —— 接线 ——

test('the editor renders the merge bar and routes its two actions', () => {
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /import MergeBar from '\.\/MergeBar\.vue'/, '导航条要进编辑器')
  assert.match(editor, /<MergeBar/, '模板里要有它')
  assert.match(editor, /:line="cursorLine"/, '计数要跟着光标')
  assert.match(editor, /@accept="acceptConflict"/, '接受动作接到条上')
  assert.match(editor, /@next="jumpConflict"/, '导航接到条上')
})

// 真机抓到的缺陷：条上的清单原来自解析 props.content，而父级的 tab.content 只在读盘/存盘时更新 ——
// 接受了一侧之后缓冲区对了、计数却停在 2/2。清单必须来自实时文档。
test('the conflict list comes from the live document, never from props.content', () => {
  const editor = read('src/components/CodeEditor.vue')
  const destructure = editor.match(/const \{ conflicts: mergeConflicts[\s\S]{0,120}\} = createMergeState\(\(\) => view, props\.content\)/)
  assert.ok(destructure, '状态域在 setup 期建好，初始值取打开时那份内容')
  assert.match(editor, /if \(update\.docChanged\) refreshMerge\(update\.state\.doc\.toString\(\)\)/, '每次改字都从实时文档重算')
  assert.match(editor, /:conflicts="mergeConflicts"/, '条上读的是这份清单')
  assert.ok(!/:content="props\.content"[\s\S]{0,80}<MergeBar|<MergeBar[\s\S]{0,120}:content="props\.content"/.test(editor),
    'MergeBar 不能再吃 props.content')
})

test('the host module owns the list and re-parses after every accept', () => {
  const host = read('src/editorMergeHost.ts')
  assert.match(host, /export function createMergeState/, '状态域与两个动作同处一地')
  assert.match(host, /refresh: \(text: string\) => \{ conflicts\.value = conflictsIn\(text\) \}/, '刷新走 conflictsIn（带预检）')
  assert.match(host, /const conflicts = ref<Conflict\[\]>\(conflictsIn\(initialContent\)\)/, '初始值取打开时那份内容')
  assert.match(host, /parseConflicts\(text\)/, '接受前重新解析')
  assert.match(host, /find\(conflict => line >= conflict\.startLine && line <= conflict\.endLine\)/, '先认光标所在那一条')
})

test('the merge bar renders whatever the host parsed and parses nothing itself', () => {
  const bar = read('src/components/MergeBar.vue')
  // 只看模板：文件头的注释里**提到**了「接受两者」是用来解释为什么不做的，不算按钮。
  const template = bar.slice(bar.indexOf('<template>'))
  assert.ok(!template.includes('接受两者'), '上游没有这个按钮，做了就是发明')
  assert.equal((template.match(/merge-bar-action/g) ?? []).length, 2, '动作按钮就是接受左侧/接受右侧两个')
  assert.match(bar, /ACCEPT_LEFT_TEXT/) // 两个按钮都取常量，别写死
  assert.match(bar, /ACCEPT_RIGHT_TEXT/)
  assert.match(bar, /conflicts: readonly Conflict\[\]/, '吃宿主解析好的清单')
  assert.ok(!bar.includes('parseConflicts'), '解析只有一处真源（宿主/模块），组件别再来一份')
})

test('the merge bar is styled like the find bar it sits next to', () => {
  const css = read('src/style.css')
  for (const cls of ['.merge-bar', '.merge-bar-title', '.merge-bar-count', '.merge-bar-action'])
    assert.ok(css.includes(cls), `少了样式 ${cls}`)
})
