// 「跟随编辑器光标」这一条的**口径**判据（接线请求 W1 落地之后才算真的生效）。
//
// 为什么要单独一条：W1 把 `:source="ctx.todoSource"` 补上之后，链路看起来是通的
// （开关会画、watch 会跑），但两边给的行号不是同一个基准 ——
//   · 编辑器给的行/列是 **1 基**：`src/components/CodeEditor.vue:1022`
//     `emit('cursor', line.number, pos - line.from + 1)`（CodeMirror 的 `line.number` 从 1 起），
//     `src/App.vue:208` 的 `todoSource` 就是这两值的搬运（`{ path, line }`）；
//   · 符号区间是 **0 基**：`native/lsp_support.cpp:174-175` 把 LSP `documentSymbol` 的
//     `line`/`character` 原样透传（LSP 位置一律 0 基；本仓跳转同一口径，
//     `src/components/CodeEditor.vue:815` 的 `applyReveal` 用 `target.line + 1`）。
// 不换算 ⇒ 光标每动一次，树里选中的都是**下一行**那个符号（差一整行）。
// 上游那一步是「按光标的偏移量取 PSI 元素」（`StructureViewComponent.java:804-849` 的
// `MyAutoScrollFromSourceHandler` → `:655` 的 `scrollToSelectedElement`），基准天然一致。
//
// 这些用例同时钉住「挂载点确实把光标喂进来了」，免得 W1 被后续改动悄悄摘掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { caretSymbolInTree, outlineKey, treeOf } from '../src/outlineView.ts'
import { caretCharacterInSymbolBasis, caretSourceWithCharacter } from '../src/structureFollow.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const sym = (name, kind, startLine, endLine, startChar = 0, detail = '') => ({
  name, kind, detail, startLine, startChar, endLine, endChar: startChar + name.length,
})

// LSP 0 基：类占第 0-20 行，方法 `pub` 占第 5-6 行、`calc` 占第 12-15 行（声明名从第 4 列开始）。
const symbols = [
  sym('Class', 5, 0, 20, 0, 'public class Class'),
  sym('pub', 6, 5, 6, 4, 'public void pub()'),
  sym('calc', 6, 12, 15, 4, 'int calc()'),
]
const tree = treeOf(symbols)

test('编辑器列（1 基）换算成符号列（0 基）：缺列就是行首', () => {
  assert.equal(caretCharacterInSymbolBasis(undefined), 0, '宿主还没给列时按行首算')
  assert.equal(caretCharacterInSymbolBasis(1), 0, '第 1 列 = 0 基的 0')
  assert.equal(caretCharacterInSymbolBasis(5), 4, '第 5 列 = 0 基的 4')
  assert.equal(caretCharacterInSymbolBasis(0), 0, '脏值不会给出负列')
})

test('编辑器行（1 基）换算后命中的是光标所在那一行，不是下一行', () => {
  // 光标在编辑器第 6 行（= 0 基第 5 行）——那正是 `pub` 声明所在行。
  const hit = caretSymbolInTree(tree, 6 - 1, caretCharacterInSymbolBasis(undefined))
  assert.ok(hit, '换算后必须命中')
  assert.equal(hit.key, outlineKey(symbols[1]), '选中的是 pub')
  assert.deepEqual(hit.ancestors, [outlineKey(symbols[0])], '父级一路给出，供折叠展开')
})

test('不换算就会选到光标**下面**那个符号（本次修的就是这一条）', () => {
  // 光标在编辑器第 12 行 = 0 基第 11 行：`calc` 从 0 基第 12 行才开始 ⇒ 正确答案是外层 Class。
  const editorLine = 12
  assert.equal(caretSymbolInTree(tree, editorLine - 1, 0)?.key, outlineKey(symbols[0]), '换算后 = Class')
  // 把 1 基行直接当 0 基用，命中的就是下一行的 calc：树会跳到光标下面那一行。
  assert.equal(caretSymbolInTree(tree, editorLine, 0)?.key, outlineKey(symbols[2]), '不换算 = calc')
})

test('同一行两个符号时选光标包住的那一个（偏移锚定，不是恒选最后一个）', () => {
  // `    int alpha; int beta;` 全在第 5 行（0 基）：alpha 名起 8 列、beta 名起 18 列。
  const sameLine = [
    sym('Class', 5, 0, 9, 0, 'public class Class'),
    sym('alpha', 8, 5, 5, 8, 'int alpha'),
    sym('beta', 8, 5, 5, 18, 'int beta'),
  ]
  const lineTree = treeOf(sameLine)
  // 光标在 alpha 的区间里（0 基第 10 列）：上游按偏移取元素 ⇒ alpha；旧实现会被后面的 beta 覆盖。
  assert.equal(caretSymbolInTree(lineTree, 5, 10)?.key, outlineKey(sameLine[1]))
  // 光标在 beta 里（第 20 列）：alpha 已越过终点，beta 从左边开始 ⇒ beta。
  assert.equal(caretSymbolInTree(lineTree, 5, 20)?.key, outlineKey(sameLine[2]))
  // 光标停在这一行的行首（宿主还没给列时的口径）：两个都没有从左边开始 ⇒ 文档序第一个。
  assert.equal(caretSymbolInTree(lineTree, 5, 0)?.key, outlineKey(sameLine[1]))
})

test('面板换算的是入参行号，不是把编辑器行直接交给判定', () => {
  const panel = read('../src/components/OutlinePanel.vue')
  assert.match(panel, /caretSymbolInTree\(tree\.value, props\.source\.line - 1/, '行号按 1 基 → 0 基换算')
  assert.match(panel, /caretCharacterInSymbolBasis\(props\.source\.character\)/, '列号走同一个换算口径')
  // 钉的是「这两个函数同源、不在面板里再抄一份」，不是那一行 import 的字面成员表
  // （2026-10-06 pvtree4 往同一行里加了 `rememberCollapsed`/`restoredCollapsed`，
  //  按字面比的那一版判据当场变红 —— 意图没变，形状多了两个名字）。
  assert.match(panel, /import \{[^}]*\bcaretCharacterInSymbolBasis\b[^}]*\bshouldRevealInEditor\b[^}]*\} from '\.\.\/structureFollow'/,
    '换算函数与跟随判定同源，不在面板里再抄一份')
})

test('挂载点确实把编辑器光标喂给了结构视图（接线请求 W1 已落）', () => {
  const mount = read('../src/components/ToolWindowView.vue')
  const row = mount.split('\n').find(line => line.includes('<OutlinePanel'))
  assert.ok(row, '结构视图挂在工具窗口里')
  assert.match(row, /:source="ctx\.todoSource"/, 'W1：光标数据源已接上')
  // 数据源本身在他人文件里（App.vue 保留），这里只钉「它给的是编辑器的行」这一事实。
  // 前缀匹配：宿主按接线请求 R1 补 `character`（列）字段时这条不许变红，也不许宿主摘掉 path/line。
  const host = read('../src/App.vue')
  assert.match(host, /const todoSource = computed\(\(\) => active\.value \? \{ path: active\.value\.path, line: active\.value\.line/,
    '宿主那份 = 编辑器 1 基行（列由接线请求 R1 补，见 docs/wiring-requests-2026-10-06-welcome2.md）')
  const ctx = read('../src/toolViewContext.ts')
  // 订正留痕（2026-10-06 hier3）：这里原写 `assert.match(ctx, /todoSource: todoSource\.value/)`，
  // 而 welcome2 的 R-1 早写明「宿主补 `character` 时这条不许变红」—— 列这一栏最后是在**上下文层**
  // 补的（`src/toolViewContext.ts` 不是保留文件），所以那条字面量必然要动。这里换成**更严**的形状：
  // 仍然钉住「透传的是同一份 `todoSource.value`」（不是另起一个数据源），只是多要求它过一道补列。
  assert.match(ctx, /todoSource: caretSourceWithCharacter\(todoSource\.value/, '上下文透传同一份，并补上编辑器给的列')
})

// ——— welcome2 R-1 的「列」那一栏：不必等宿主改 `src/App.vue` ———
//
// 上游选的是光标**偏移量**底下那个元素（`StructureViewComponent.java:655-661` 的
// `scrollToSelectedElement()`，光标监听在 `:805-849` 的 `MyAutoScrollFromSourceHandler` 里装）。
// 宿主那份 `todoSource`（`src/App.vue` 的 `const todoSource = computed(...)`）只有 `{path, line}`，
// 而**列**就挂在同一个活动标签页对象上：`src/App.vue:2147` 的
// `@cursor="(line, column) => { tab.line = line; tab.column = column }"`，
// 值来自 `src/components/CodeEditor.vue:1022` 的 `emit('cursor', line.number, pos - line.from + 1)`
// （CodeMirror 行/列都 1 基）。⇒ 上下文层从同一份 `active` 里取那一栏补第三个键，
// 结构面板与 TODO 面板看的还是**同一个**光标源（TodoPanel 只读 path/line，多一个键不影响它）。
test('caretSourceWithCharacter：光标源补上编辑器给的列，缺列时不写那个键', () => {
  assert.deepEqual(caretSourceWithCharacter({ path: 'a/Sample.java', line: 12 }, 7),
    { path: 'a/Sample.java', line: 12, character: 7 }, '列进来就是 {path, line, character}')
  assert.deepEqual(caretSourceWithCharacter({ path: 'a/Sample.java', line: 12 }, undefined),
    { path: 'a/Sample.java', line: 12 }, '没有列 ⇒ 保持宿主原来的形状（不是塞一个 0 假装在第 0 列）')
  assert.equal(caretSourceWithCharacter(null, 3), null, '没有打开的文件 ⇒ 还是 null（面板据此不画那个开关）')
  assert.equal(caretSourceWithCharacter(undefined, 3), null)
})

test('补上列之后：同一行两个符号时选中的是光标底下那一个（端到端）', () => {
  const sameLine = [
    sym('Class', 5, 5, 9, 0, 'public class Class'),
    sym('alpha', 8, 5, 5, 8, 'int alpha'),
    sym('beta', 8, 5, 5, 18, 'int beta'),
  ]
  const lineTree = treeOf(sameLine)
  // 编辑器第 6 行（1 基）、第 21 列（1 基，= 0 基 20）正压在 `beta` 的名字上。
  const withColumn = caretSourceWithCharacter({ path: 'Sample.java', line: 6 }, 21)
  assert.equal(caretSymbolInTree(lineTree, withColumn.line - 1, caretCharacterInSymbolBasis(withColumn.character))?.key,
    outlineKey(sameLine[2]), '有列 ⇒ 按偏移选中 beta')
  // 只有行（补列之前宿主给的那一份）时判定退化成「同一行取文档序第一个」⇒ 选中 alpha，光标在 beta 上却亮着 alpha。
  const withoutColumn = caretSourceWithCharacter({ path: 'Sample.java', line: 6 }, undefined)
  assert.equal(withoutColumn.character, undefined, '缺列时那个键根本不出现')
  assert.equal(caretSymbolInTree(lineTree, withoutColumn.line - 1, caretCharacterInSymbolBasis(withoutColumn.character))?.key,
    outlineKey(sameLine[1]), '没列 ⇒ 退化档（这一对比就是补这一栏的理由）')
})
