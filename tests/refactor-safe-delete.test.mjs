// 安全删除的「注释与字符串用法账」组装（桶 1 / A5 的模块侧，`src/safeDelete.ts`）。
//
// 上游权威：
//   · `platform/lang-impl/src/com/intellij/refactoring/safeDelete/SafeDeleteProcessor.java:447-464`
//     —— `addNonCodeUsages`：`searchInCommentsAndStrings` 为假就**不扫**（`:457-460`），
//     `searchNonJava` 为假就不走 `addTextOccurrences`（`:461-463`）。
//   · `platform/lang-impl/src/com/intellij/refactoring/safeDelete/UnsafeUsagesDialog.java:35/:36/:41-47/:58`
//     —— 三选一（默认项「查看用法」）、「检测到用法」标题、「发现以下问题：」抬头。
//   · `platform/refactoring/resources/messages/RefactoringBundle.properties:312/:313/:316/:317/:318`
//     —— `usages.detected` / `delete.anyway.button` / `the.following.problems.were.found` /
//     `cancel.button` / `view.usages`（本仓界面是中文，按同名键直译，助记符去掉）。
//   · `platform/lang-impl/src/com/intellij/refactoring/safeDelete/SafeDeleteDialog.java:163-165`
//     —— 两个搜索复选框的缺省档（本仓 `defaultSafeDeleteOptions()`）。
// 判据全是精确比对（deepEqual / equal / 逐条正则），没有 includes 了事。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  defaultSafeDeleteOptions, safeDeletePrompt, safeDeletePromptFromFiles, safeDeleteSearchWord,
} from '../src/safeDelete.ts'

const location = (path, line, character) => ({ path, line, character })
/** 打开着的同名文件（被删者本身）之外的一份 java 源文件。 */
const consumer = [
  { path: 'src/demo/Runner.java', text: '// 这里提到 Widget 一句话\nString s = "Widget";\n' },
]

test('safeDeleteSearchWord：取最后一段并去扩展名；没有点、纯点号开头的名字整体当词', () => {
  assert.equal(safeDeleteSearchWord('src/demo/Widget.java'), 'Widget')
  assert.equal(safeDeleteSearchWord('Widget.java'), 'Widget')
  assert.equal(safeDeleteSearchWord('Widget'), 'Widget')
  // 点文件（`.editorconfig`）去扩展名会变成空串 ⇒ 退回整个名字，不能拿空词去扫全仓。
  assert.equal(safeDeleteSearchWord('src/.editorconfig'), '.editorconfig')
  assert.equal(safeDeleteSearchWord('src/Widget.tar.gz'), 'Widget.tar')
})

test('注释账：只给 {path,text} 也要按路径认注释标记（漏了 style 就会静默漏报注释）', () => {
  const prompt = safeDeletePromptFromFiles('src/demo/Widget.java', [], consumer)
  assert.equal(prompt.nonCode.usages, 2, '一条注释 + 一条字符串')
  assert.equal(prompt.nonCode.comments, 1)
  assert.equal(prompt.nonCode.strings, 1)
  assert.equal(prompt.blocked, true)
  assert.deepEqual(prompt.details, ['注释：src/demo/Runner.java:1:9', '字符串：src/demo/Runner.java:2:13'])
})

test('没有注释标记的语言（纯文本）仍算字符串，不算注释', () => {
  const prompt = safeDeletePromptFromFiles('Widget.txt', [], [{ path: 'a/notes.txt', text: 'Widget 出现在正文里\n"Widget"\n' }])
  assert.equal(prompt.nonCode.comments, 0)
  assert.equal(prompt.nonCode.strings, 1)
  assert.deepEqual(prompt.details, ['字符串：a/notes.txt:2:2'])
})

test('勾选项缺省 = defaultSafeDeleteOptions()（searchInComments 开、searchTextOccurrences 关）', () => {
  assert.deepEqual(defaultSafeDeleteOptions(), { searchInComments: true, searchTextOccurrences: false })
  assert.deepEqual(safeDeletePromptFromFiles('src/demo/Widget.java', [], consumer).options, defaultSafeDeleteOptions())
})

test('取消勾选「搜索注释与字符串」⇒ 一个字都不扫（上游 :457-460 那个 if），只剩代码引用', () => {
  const off = { searchInComments: false, searchTextOccurrences: false }
  const prompt = safeDeletePromptFromFiles('src/demo/Widget.java', [], consumer, off)
  assert.equal(prompt.nonCode, null, '没勾就是 null（与上游"空列表"同效）')
  assert.equal(prompt.blocked, false, '只有注释/字符串里的字面出现时不拦删除')
  const withRefs = safeDeletePromptFromFiles('src/demo/Widget.java', [location('src/demo/Runner.java', 0, 6)], consumer, off)
  assert.equal(withRefs.nonCode, null)
  assert.deepEqual(withRefs.details, [
    '代码引用 1 处（1 个文件）—— 删除后这些地方会编译不过。',
    '引用：src/demo/Runner.java:1:7',
  ])
})

test('blocked 只看这笔账：只有注释里的字面出现也要弹三选一', () => {
  const commentOnly = safeDeletePromptFromFiles('src/demo/Widget.java', [], [{ path: 'r.java', text: '// Widget\n' }])
  assert.equal(commentOnly.blocked, true)
  const clean = safeDeletePromptFromFiles('src/demo/Widget.java', [], [{ path: 'r.java', text: '// Nothing here\n' }])
  assert.equal(clean.blocked, false)
  assert.deepEqual(clean.details, [])
  assert.deepEqual(clean.choices.map(choice => choice.id), ['viewUsages', 'deleteAnyway', 'cancel'])
  // 默认项永远是「查看用法」（UnsafeUsagesDialog.java:41-47 排第一 + :98 的 DEFAULT_ACTION），
  // 与这笔账里有没有代码引用无关。
  assert.deepEqual(clean.choices.filter(choice => choice.primary).map(choice => choice.id), ['viewUsages'])
})

test('三选一的次序、标题、抬头与文案都来自 safeDeletePrompt（两半共用一份模型）', () => {
  const prompt = safeDeletePromptFromFiles('src/demo/Widget.java', [location('r.java', 4, 3)], consumer)
  const direct = safeDeletePrompt('src/demo/Widget.java', [location('r.java', 4, 3)], prompt.nonCode, defaultSafeDeleteOptions())
  assert.equal(prompt.title, '检测到用法')
  assert.equal(prompt.lead, '发现以下问题：')
  assert.deepEqual(prompt.details, direct.details)
  assert.deepEqual(prompt.choices.map(choice => [choice.id, choice.label, choice.primary]), [
    ['viewUsages', '查看用法', true], ['deleteAnyway', '仍然删除', false], ['cancel', '取消', false],
  ])
  assert.deepEqual(prompt.usages, { usages: 1, files: 1 })
  assert.match(prompt.footer, /^「查看用法」会把这些结果放进引用窗口。删除「src\/demo\/Widget\.java」本身不做任何改动。$/)
})

test('空文本的文件不参与扫描；同一位置只算一条', () => {
  const prompt = safeDeletePromptFromFiles('src/demo/Widget.java', [], [
    { path: 'empty.java', text: '' },
    { path: 'a.java', text: '// Widget\n' },
    { path: 'b.java', text: '// Widget\n' },
  ])
  assert.equal(prompt.nonCode.files, 2)
  assert.deepEqual(prompt.details, ['注释：a.java:1:4', '注释：b.java:1:4'])
})
