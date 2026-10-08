// `src/customFoldingRegions.ts` 的判据 —— `lp/custom-folding` 那族里
// `CustomFoldingRegionsPopup` / `GotoCustomRegionAction` 的「区域列表 + 跳到上/下一个区域」。
//
// 这一份只管**偏移坐标系**与**跳转落点**（`tests/editor-custom-fold-regions.test.mjs` 钉的是
// 排序/层数/占位文字/配对那一半，这里不重复）。
//
// 上游坐标（本轮用本地参考树 `sed -n` 逐行打开核对，参考树 =
// `D:/Backup/Downloads/intellij-community-master/intellij-community-master`，2026-10-06）：
//   · `platform/lang-impl/src/com/intellij/lang/customFolding/GotoCustomRegionAction.java`
//     `:60` 收集 descriptor、`:61` 判空、`:62` 弹 `CustomFoldingRegionsPopup.show`、
//     `:65` 一个区域都没有时是提示而不是空窗、`:74-81` 的 `update` 只看有没有编辑器与工程；
//   · `platform/lang-impl/src/com/intellij/lang/customFolding/CustomFoldingRegionsPopup.java`
//     `:26` 先 `orderByPosition`、`:57-58` 每层三个空格、`:65-69` 按**元素**起始偏移排序、
//     `:72-76` 栈算层数（`:73` 的出栈比的是**区域**末尾）、`:80-88` 的 `navigateTo`
//     （`:82` 界闸、`:84` `moveToOffset(元素起始)`、`:85` 居中、`:86` 清选区）；
//   · `platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java:85-87`
//     `new TextRange(startNode.getTextRange().getStartOffset(), child.getTextRange().getEndOffset())`
//     + `new FoldingDescriptor(startNode, range)` ⇒ 对自定义区域来说**元素起始 == 区域起始**，
//     所以 `:73` 那个出栈条件在本仓就是「新区域的开始标记偏移 ≥ 栈顶区域的结束标记行尾」；
//   · 键位 `platform/platform-resources/src/keymaps/$default.xml:535-537` = `control alt PERIOD`；
//     动作注册 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:378`；
//     文案 `platform/platform-api/resources/messages/IdeBundle.properties:1062-1066`。
//
// 「偏移落在哪个坐标系」这一条上游没有对应物（它的偏移来自 PSI），所以判据用**本仓的坐标权威**
// 当量具：CodeMirror 自己的 `doc.line(n).from/.to`。这些偏移最终的落点就是
// `view.dispatch({selection})`（`src/customFoldingPopup.ts` 的 `regionNavigateSpec`），
// 而 CM 建文档时把换行归一成一个 `\n`（`EditorState.create({doc:'a\r\nb'}).doc.length === 3`，
// `\r` 不进文档）⇒ 区域表的偏移必须与**归一后**的文档对齐，不是与原始字节串对齐。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'

import { nextCustomRegion, regionEntries } from '../src/customFoldingRegions.ts'
import { regionNavigateSpec } from '../src/customFoldingPopup.ts'
import { localRegionFolds } from '../src/editorFolding.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// 三种行尾形态的**同一份内容**：两条顶层区域 + 第二条里面套一条，中间还有一条空行
// （空行是这一族的关键词：旧写法在 CRLF 文档里对空行与非空行走的是两条不同的推进量）。
const LF = [
  '//region 构造',      // 0
  'let a = 1',          // 1
  '',                   // 2
  '//endregion',        // 3
  '#region 析构',       // 4
  '//<region 内层>',    // 5
  'let b = 2',          // 6
  '//</region>',        // 7
  '#endregion',         // 8
  '',                   // 9
].join('\n')
const CRLF = LF.split('\n').join('\r\n')
const CRLF_NO_TRAILING = CRLF.replace(/\r\n$/, '')
// 偏差最大的那一档（模块头引的就是这组的数）：标记前面 10 条 CRLF 空行 ⇒ 旧写法多记 10 个字符。
const CRLF_BLANKS = '\r\n'.repeat(10) + '//region 空行后\r\ny\r\n//endregion\r\n'

/** 把区域表换算成「CodeMirror 认为这几行在第几个字符」，逐条比对；返回对不上的那些。 */
function mismatched(text) {
  const state = EditorState.create({ doc: text })
  const bad = []
  for (const region of regionEntries(text)) {
    const start = state.doc.line(region.startLine + 1)
    const end = state.doc.line(region.endLine + 1)
    if (region.from !== start.from || region.to !== start.to || region.rangeEnd !== end.to) {
      bad.push([region.label, region.from, start.from, region.to, start.to, region.rangeEnd, end.to])
    }
  }
  return bad
}

test('区域表的三个偏移与 CodeMirror 文档逐条对齐（LF / CRLF / 无尾换行 / 标记前一串空行）', () => {
  assert.deepEqual(mismatched(LF), [])
  assert.deepEqual(mismatched(CRLF), [], 'CRLF 的 `\r` 不进 CM 文档 ⇒ 每条换行只记 1 个字符')
  assert.deepEqual(mismatched(CRLF_NO_TRAILING), [])
  assert.deepEqual(mismatched(CRLF_BLANKS), [], '10 条 CRLF 空行 ⇒ 旧算法多记 10（真值 10、原来算出 20）')
})

test('CRLF 文档里从列表跳过去，光标落在开始标记那一行（:84 的 moveToOffset）', () => {
  for (const text of [LF, CRLF]) {
    const base = EditorState.create({ doc: text })
    const regions = regionEntries(text)
    assert.equal(regions.length, 3)
    // 从文档末尾往后一条（绕回第一条）与从第一条往前一条（绕回最后一条）都跑一遍。
    const hops = [[0, true], [4, true], [8, true], [0, false], [5, false]]
    for (const hop of hops) {
      const fromLine = hop[0]
      const forward = hop[1]
      const target = nextCustomRegion(regions, fromLine, forward)
      assert.ok(target, '有区域就一定挑得出一条')
      const spec = regionNavigateSpec(target, base.doc.length)
      assert.ok(spec, '落点在文档内（:82 的界闸）')
      const caret = base.update(spec).state.selection.main.head
      assert.equal(caret, base.doc.line(target.startLine + 1).from,
        `必须落在开始标记那一行的**行首**（行尾形态=${text.includes('\r') ? 'CRLF' : 'LF'}，从第 ${fromLine} 行${forward ? '后' : '前'}跳 → 目标第 ${target.startLine + 1} 行）`)
      assert.equal(base.doc.lineAt(caret).number, target.startLine + 1, '同一行的行首 —— 落在标记本体上而不是标记之后')
    }
  }
})

test('偏移对上的是标记本体的行首与行尾（不是标记之后几个字符）', () => {
  const state = EditorState.create({ doc: CRLF })
  for (const region of regionEntries(CRLF)) {
    assert.equal(state.doc.sliceString(region.from, region.to), state.doc.line(region.startLine + 1).text,
      'from…to 就是开始标记那一行的整行正文')
    // rangeEnd 是**结束标记那一行的行尾**（`CustomFoldingBuilder.java:86` 的 `child.getTextRange().getEndOffset()`）。
    assert.equal(state.doc.lineAt(region.rangeEnd).number, region.endLine + 1)
    assert.match(state.doc.lineAt(region.rangeEnd).text, /endregion|<\/region/, '落在收尾标记那一行上')
  }
  const first = regionEntries(CRLF)[0]
  assert.equal(state.doc.sliceString(first.from, first.from + 8), '//region')
})

test('嵌套层数不随行尾形态变化（:72-76 的栈只比区间，不数换行符）', () => {
  const asDepths = text => regionEntries(text).map(region => [region.label, region.depth])
  assert.deepEqual(asDepths(CRLF), asDepths(LF))
  assert.deepEqual(asDepths(LF), [['构造', 0], ['析构', 0], ['内层', 1]])
})

test('没有区域时 nextCustomRegion 返回 null（对应 GotoCustomRegionAction.java:65 的提示分支）', () => {
  assert.equal(nextCustomRegion(regionEntries('let a = 1\n'), 0, true), null)
  assert.equal(nextCustomRegion(regionEntries('let a = 1\r\n'), 0, false), null)
})

// 旧版这里数的是「原始字节串里的换行符个数」：判据 `text.startsWith('\r\n', at)` 量的是**行首**，
// 而 CRLF 的 `\r` 在行尾 ⇒ 非空行 +1、空行 +2 ⇒ 同一份文档里两套坐标系。
// 这一条钉住修完的那个形状，防止把「按原始字节算」那一支再挪回来。
test('锚点：行内累加只 +1，没有「按行尾形态改推进量」的那一支', () => {
  const source = read('src/customFoldingRegions.ts')
  assert.match(source, /\n {4}at \+= lines\[index\]!\.length \+ 1\n/)
  assert.ok(!/\? 2 : 1/.test(source), 'CRLF 记 2 那一支判的是行首，量不到行尾的 `\r`，且 CM 文档里根本没有 `\r`')
})

// 已登记的偏离（不是这一族的回归）：lone `\r`（旧 Mac 行尾）在**行模型**里就不是一行 ——
// 本仓的区域表与折叠区间共用 `split(/\r?\n/)`（`src/editorFolding.ts` 的 `localRegionFolds` 同一条），
// CM 会把这种文档切成多行，而两侧都不切 ⇒ 整份文件读作一行、认不出标记。
// 改它要同时动折叠那一族的共用规则，不在本模块单方面收紧，这里只把**当前实测值**钉住。
test('lone `\\r` 行尾：区域表与折叠区间同一口径（都不产生区域，实测）', () => {
  const mac = '//region a\rx\r//endregion\r'
  assert.deepEqual(regionEntries(mac), [])
  assert.deepEqual(localRegionFolds(mac), [])
  assert.equal(EditorState.create({ doc: mac }).doc.lines, 4, 'CM 自己会切成 4 行（3 个 `\r` 断行 + 末尾空行）—— 偏离所在')
})
