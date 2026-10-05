// lp/completion 的判据：循环词补全（上游 `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/`：
// `HippieCompletionAction.java:15-35` + 行为本体 `HippieWordCompletionHandler.java`）。
// 纯规则在 `src/cyclicWordCompletion.ts`；这里钉住前缀/候选/顺序/换档/恢复的每一步，
// 每条期望值后面注的是上游类与行号（2026-10-06 按上游逐条复核过，之前那版把
// 「向前第一步」与「向后第一步」给反了，也与上游的 `computeVariants` 顺序无关）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hippiePrefixAt, hippieStep, hippieVariants, hippieWords } from '../src/cyclicWordCompletion.ts'

const doc = 'const alpha = 1\nconst alpine = 2\nal'

test('前缀 = 光标前一个字符所在的那个词段（上游 computeData:388-413 从 offset-1 起走）', () => {
  assert.deepEqual(hippiePrefixAt(doc, doc.length), { prefix: 'al', from: doc.length - 2 })
  // 光标紧贴词尾：`processWords(editor, offset - 1, …)`（:393）落在词里 ⇒ 整个词就是前缀。
  assert.deepEqual(hippiePrefixAt('foo bar', 3), { prefix: 'foo', from: 0 })
  // 光标前一个字符不是词字符 ⇒ 空前缀、起点 = 光标（:408-411）。
  assert.deepEqual(hippiePrefixAt('foo + ', 6), { prefix: '', from: 6 })
  assert.deepEqual(hippiePrefixAt(doc, 0), { prefix: '', from: 0 })
  // `containsLettersOrDigits:253-260` 把纯 `_`/`$` 段判成"不是词" ⇒ 同样空前缀。
  assert.deepEqual(hippiePrefixAt('__ ', 2), { prefix: '', from: 2 })
})

test('词形 = 标识符类的极大连续段，纯符号段不算词（processWords:361-382 + :253-260）', () => {
  assert.deepEqual(hippieWords('a1b __ $$ - foo2').map(run => run.word), ['a1b', 'foo2'])
  // 数字开头的段上游也当词（首字符不要求是字母），并且数字满足 containsLettersOrDigits。
  assert.deepEqual(hippieWords('123abc x').map(run => run.word), ['123abc', 'x'])
})

test('候选顺序 = 光标前的词按末次出现升序、其余按首次出现升序（computeVariants:283-306）', () => {
  const text = 'alphaX beta alpha al'
  assert.deepEqual(hippieVariants(text, 'al', { caret: text.length }), ['alphaX', 'alpha'],
    'alpha 出现两次 ⇒ 留末次那次（:286-295 的反序去重再反序）')
  // `:331-332`：包含光标的段（正在打的那个词）自己不算候选。
  assert.deepEqual(hippieVariants(text, 'al', { caret: 6 }), ['alpha'], '光标在 alphaX 里 ⇒ 整段跳过')
  // `:334`：长度必须**严格大于**前缀 ⇒ `al` 自己不进表。
  assert.deepEqual(hippieVariants('al alx', 'al', { caret: 0 }), ['alx'])
})

test('候选按驼峰 isStartMatch，不是普通前缀（:146 的 new CamelHumpMatcher(prefix) + :336）', () => {
  assert.deepEqual(hippieVariants('getName setName', 'gN', { caret: 16 }), ['getName'])
  // 大小写档 = CodeInsightSettings 默认 FIRST_LETTER（`CamelHumpMatcher.java:80-87`）：
  // 首字母大小写不一致就不算命中。
  assert.deepEqual(hippieVariants('Foo foo food', 'foo', { caret: 0 }), ['food'])
  // 空前缀恒真（`MinusculeMatcher.kt:63-66`、`:72-76`「无片段即 start match」）⇒ 有候选。
  assert.deepEqual(hippieVariants('one two ', '', { caret: 8 }), ['one', 'two'])
})

test('向前第一步给「离光标最近的前一个词」，不是文档顺序第一个（:169-177）', () => {
  const step = hippieStep(doc, doc.length, null, 1)
  assert.equal(step.word, 'alpine')
  assert.equal(step.from, doc.length - 2)
  assert.equal(step.to, doc.length)
  assert.deepEqual(step.spans, [{ from: doc.length - 2, to: doc.length }])
  assert.equal(step.exhausted, false)
  assert.equal(step.fromOtherFiles, false, '候选出自当前文档')
  assert.deepEqual(step.state.tried, ['alpine'])
  assert.deepEqual(step.state.carets, [doc.length - 2 + 'alpine'.length],
    '上游把 caretOffsets 记在插入之后（:108）')
})

test('向后第一步给「起点之后的第一项」，没有就整表第一项（:183-189）', () => {
  const step = hippieStep(doc, doc.length, null, -1)
  assert.equal(step.word, 'alpha', 'alpine/alpha 都在起点之前 ⇒ 落回整表第一项')
  assert.deepEqual(step.state.tried, ['alpha'])
})

test('向前连按：表内往后一位位退，退到表头且没有别的文档就恢复原前缀（:196-208 + :85-89）', () => {
  const cycle = []
  let text = doc
  let caret = doc.length
  let state = null
  for (let round = 0; round < 4; round += 1) {
    const step = hippieStep(text, caret, state, 1)
    cycle.push([step.word, step.exhausted])
    if (step.exhausted) break
    text = text.slice(0, step.from) + step.word + text.slice(step.to)
    caret = step.from + step.word.length
    state = step.state
  }
  assert.deepEqual(cycle, [['alpine', false], ['alpha', false], ['al', true]],
    '两轮候选走完 ⇒ 写回用户原来打的 al（上游 insertStringForEachCaret(editor, oldPrefix, …)）')
})

test('向后连按：表内往后一位位进，走完同样恢复原前缀（:211-221）', () => {
  const first = hippieStep(doc, doc.length, null, -1)
  const after = doc.slice(0, first.from) + first.word
  const second = hippieStep(after, first.from + first.word.length, first.state, -1)
  assert.equal(second.word, 'alpine')
  const afterSecond = after.slice(0, second.from) + second.word
  const third = hippieStep(afterSecond, second.from + second.word.length, second.state, -1)
  assert.equal(third.exhausted, true)
  assert.equal(third.word, 'al')
  assert.equal(third.state, null)
})

test('没有候选时返回 null（首轮不编造"把原前缀重写一遍"那个空操作）', () => {
  const text = 'const value = 1\nxy'
  assert.equal(hippieStep(text, text.length, null, 1), null)
})

test('光标集合变了 = 新一轮（上游 :73 的 caretOffsets 比较）', () => {
  const first = hippieStep(doc, doc.length, null, 1)
  const after = doc.slice(0, first.from) + first.word
  const moved = hippieStep(after, first.from + first.word.length - 3, first.state, 1)
  assert.equal(moved.word, 'alpine', '光标离开插入后的词尾 ⇒ 状态作废，按「alp」这个新前缀重选第一项（起点之前最后一项仍是文档里第二个 alpine）')
  assert.deepEqual(moved.state.tried, ['alpine'])
})

test('文档改动号变了 = 新一轮（上游 :74 的 modificationStamp 比较）', () => {
  const first = hippieStep(doc, doc.length, null, 1, { revision: 7 })
  const after = doc.slice(0, first.from) + first.word
  const caret = first.from + first.word.length
  const same = hippieStep(after, caret, first.state, 1, { revision: 7 })
  assert.equal(same.word, 'alpha', '改动号没变 ⇒ 延续上一轮，走表里的下一项')
  assert.deepEqual(same.state.tried, ['alpine', 'alpha'])
  assert.equal(hippieStep(after, caret, first.state, 1, { revision: 8 }), null,
    '改动号变了 ⇒ 状态作废，前缀从**整个已插入的词**重新起算（:76-79），文档里没有更长的同前缀词 ⇒ 没候选')
})

test('多光标：每个光标各替换「它前面前缀长度个字符」（:115-122）', () => {
  const text = 'alpha al beta al'
  const carets = [8, 16]
  const step = hippieStep(text, 8, null, 1, { carets })
  assert.equal(step.word, 'alpha')
  assert.deepEqual(step.spans, carets.map(at => ({ from: at - 2, to: at })),
    '每个光标前 2 个字符（前缀 al 的长度）各被替换一次')
  // `:331-332` 用**全部**光标做跳过：任一光标落在段里就不算候选。
  assert.deepEqual(hippieVariants(text, 'al', { caret: 8, carets: [2, 8] }), [],
    '两段 al 与开头那段 alpha 都含光标 ⇒ 没有候选')
})

test('区间重叠的重光标不会产出重叠编辑（CodeMirror changes 不接受重叠）', () => {
  const step = hippieStep('alpha al', 8, null, 1, { carets: [7, 8] })
  assert.equal(step.word, 'alpha')
  assert.deepEqual(step.spans, [{ from: 5, to: 7 }], '第二个光标的区间 [6,8) 与 [5,7) 重叠 ⇒ 丢弃')
})

test('接线：completionUi 把它挂进编辑器扩展，且按物理 SLASH 判 Alt+/', () => {
  const ui = readFileSync(new URL('../src/completionUi.ts', import.meta.url), 'utf8')
  assert.match(ui, /from '\.\/cyclicWordCompletion\.ts'/)
  assert.match(ui, /hippieCompletionKeys/)
  assert.match(ui, /event\.code !== 'Slash'/)
  assert.match(ui, /\.\.\.hippieCompletionKeys/)
  assert.match(ui, /otherOpenEditorTexts/, '跨文档那一档的正文来自 completionOpenEditors')
  assert.match(ui, /revision: view\.state\.doc/, '改动号在 dispatch 之后盖进状态（上游 :107）')
})
