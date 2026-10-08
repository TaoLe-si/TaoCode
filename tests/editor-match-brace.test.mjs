// 「移动到配对的括号」（上游 `EditorMatchBrace` / `MatchBraceAction`）的判据。
// 实现 `src/editorMatchBrace.ts`；上游三条规则在那个文件头注释里逐行核过：
//   · `platform/lang-impl/src/com/intellij/codeInsight/editorActions/MatchBraceAction.java:25-31` 的三条规则、
//     `:40-51` 的执行、`:82-84`（走 `BraceMatcher` 的 navigationOffset）、
//     `:88-110` 的 `tryFindPreviousUnclosedOpeningBraceOffset`（`:91` 返回的是**开括号**的起始 offset）；
//   · 动作注册 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:23`；
//   · 键位 `platform/platform-resources/src/keymaps/$default.xml:1146-1148`（Ctrl+Shift+M），
//     另两个 scheme 在同一动作名下：`Mac OS X 10.5+.xml:642`、`Sublime Text.xml:231`，
//     交叉核对 `platform/testFramework/extensions/src/com/intellij/keymap/KeymapsTestCase.java:154`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  braceTokens, innermostUnclosedOpener, matchBraceTarget, pairedBraceIndex,
} from '../src/editorMatchBrace.ts'
import { hasAngleBraces, matchingAnglePair } from '../src/editorBrackets.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('braceTokens：字符串、行注释、块注释里的括号不算结构括号', () => {
  const structural = text => braceTokens(text).filter(index => index >= 0)
  assert.deepEqual(structural('f(")")'), [1, 5], '字符串里那对不算')
  assert.deepEqual(structural('// (a)\nb(c)'), [8, 10], '行注释里那对不算')
  assert.deepEqual(structural('/* ( */ (x)'), [8, 10], '块注释里那对不算')
  assert.deepEqual(structural("'{'"), [], '字符字面量里的花括号不算')
})

test('规则一：光标在开括号上 ⇒ 移到配对闭括号的末尾（MatchBraceAction.java:29）', () => {
  assert.equal(matchBraceTarget('(a)', 0), 3, '跳到 ) 之后')
  assert.equal(matchBraceTarget('f(g(x))', 1), 7, '嵌套时跳到**自己那一对**的闭括号')
  assert.equal(matchBraceTarget('{ a }', 0), 5)
})

test('规则二：光标在闭括号上 ⇒ 移到配对开括号的开头（:28）', () => {
  assert.equal(matchBraceTarget('(a)', 2), 0, '光标右边就是闭括号（:96 读的是右边那个 token）')
  assert.equal(matchBraceTarget('{}', 1), 0)
  assert.equal(matchBraceTarget('f(g(x))', 6), 1, '嵌套的闭括号 ⇒ 配到自己那一层的开括号')
})

test('规则三：光标不在括号上 ⇒ 最内层未闭合左括号的起始位置（:30 + :91）', () => {
  const text = 'if (x) {\n  y();\n}\n'
  // 光标在 `y();` 那一行里：()` 已经配对，剩下未闭合的是第 7 位那个 {
  assert.equal(innermostUnclosedOpener(braceTokens(text), text, 14), 7)
  assert.equal(matchBraceTarget(text, 14), 7)
  // 全部配平了 ⇒ 没有未闭合的左括号，不动光标
  assert.equal(matchBraceTarget('f(x) { y(); }', 'f(x) { y(); }'.length), null, '全配平 ⇒ 没有未闭合的左括号')
})

test('配不上对时返回 null，不猜（多余括号 / 跨不到）', () => {
  assert.equal(matchBraceTarget('x = "(a)"', 5), null, '那对括号在字符串里')
  assert.equal(matchBraceTarget('', 0), null)
  assert.equal(matchBraceTarget('foo(', 4), 3, '刚敲完左括号：走第三条回到它自己（:93-110）')
  const marks = braceTokens('foo)')
  assert.equal(pairedBraceIndex(marks, 'foo)', 4), null, '落单的右括号配不出来')
})

test('尖括号那一档只给能核到的语言（Java）；其它语言一律不接管', () => {
  assert.equal(hasAngleBraces('java'), true, 'JavaPairedBraceMatcher.java:26-34')
  assert.equal(hasAngleBraces('cpp'), false, 'CLion 的 matcher 不在社区树 ⇒ 无法核实')
  assert.equal(hasAngleBraces('typescript'), false)
  assert.equal(hasAngleBraces(undefined), false)
  // Java 的泛型：光标在 `<` 上 ⇒ 跳到 `>` 之后；在那一侧之外 ⇒ 回到 `<`
  assert.equal(matchBraceTarget('List<String> x', 4, true), 12)
  assert.equal(matchBraceTarget('List<String> x', 12, true), 4)
  assert.equal(matchBraceTarget('List<String> x', 4), null, '没给 angle ⇒ 不认 <>（非 Java 语言）')
  // 比较表达式不该被当成一对括号
  assert.equal(matchBraceTarget('a > b && c < d', 2, true), null)
})

// ── 接线：命令表与菜单行必须同名（菜单点得到 = 键盘也做得到，不是放假行） ──────────────
test('brace.match 进了 editingCommands，编辑菜单用同一个名字', () => {
  const commands = read('src/editorCommands.ts')
  assert.match(commands, /import \{[^}]*\bmatchBraceCommand\b[^}]*\} from '\.\/editorMatchBrace\.ts'/)
  assert.match(commands, /'brace\.match': matchBraceCommand,/, '命令表里没有这一条 ⇒ 菜单行是假的')
  const menu = read('src/menus/editMenu.ts')
  assert.match(menu, /ctx\.editable\('brace\.match', '移动到配对的括号', 'Ctrl Shift M',/,
    '菜单行与命令表不同名，或键位栏与真实绑定不一致')
  // 键位栏不留空了：Ctrl+Shift+M 绑在编辑器的常驻 keymap 上
  // （上游 `EditorMatchBrace` = `$default.xml:1146-1148`，Mac 那份 `:642` 同样是 shift control M）。
  // 那张表 2026-10-06 搬进 src/editorKeymap.ts（CodeEditor.vue 贴着机检上限，拆一次降一次）；
  // 判据跟着搬到新落点，并确认宿主真的把这张表装进编辑器。
  const keymap = read('src/editorKeymap.ts')
  assert.match(keymap, /key: 'Ctrl-Shift-m', preventDefault: true, run: editingCommands\['brace\.match'\]!/,
    '菜单写了 Ctrl Shift M 但编辑器没绑 ⇒ 又变成「有行无动作」')
  const view = read('src/components/CodeEditor.vue')
  assert.ok(view.includes('keymap.of(editorKeymap)'), '常驻 keymap 要真的装进编辑器')
})

test('语言 id 是编辑器状态里的 facet（没挂上时 Java 的 <> 那一档自动不接管）', () => {
  const source = read('src/editorMatchBrace.ts')
  assert.match(source, /export const editorLanguageId = Facet\.define/, 'facet 被搬走了')
  // 语言 id 从 facet 取出来存进 `language`，再喂给 `hasAngleBraces` —— 命令读的就是状态里挂的
  // 那门语言（没挂时 undefined ⇒ Java 的 `<>` 档不接管）。
  assert.match(source, /const language = state\.facet\(editorLanguageId\)/, '命令没读 facet 里的语言')
  assert.match(source, /hasAngleBraces\(language\)/, '语言没喂进 hasAngleBraces（Java 的 <> 档就不接管了）')
})
