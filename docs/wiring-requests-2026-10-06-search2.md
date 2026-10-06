# 接线请求 · 桶 9 第二路（search2）· 2026-10-06

收件人：主代理（Tao）／ 桶 5「编辑器输入/折叠」那一侧（`src/editorCodeBlock.ts` + `src/editorCommands.ts`）
／ `src/App.vue` 的 owner（`appvue`）。

本路代号 `search2`。与 `docs/wiring-requests-2026-10-06-searchdiff.md` 的 **W-1** 是同一件事的**重做版**：
那一版把整段实现留在文档里等着落地（因为它的模块被当孤儿删掉了）。本路已经按派单口径
（「合并点不在我面 ⇒ 把结构化搜索真正需要的判据落进 `src/structural*`」）把模块落进
`src/structuralCodeBlock.ts`，**并且给它接上了本面的生产消费方**（结构化搜索的命中后复核），
所以它不再是需要等接线的孤儿 —— 等接线的只剩"编辑器那一侧要不要用它的 B 半"。
本文 W-1' 取代旧 W-1；旧 W-1 里"待恢复的模块原文"与"待恢复的测试原文"**作废**（模块已在树里、
测试已在 `tests/structural-code-block.test.mjs`），其余上游依据本路逐条重新核过（见 W-1' 表）。

---

## W-1' · 代码块导航补上「结构支持」那一半（`CodeBlockSupportHandler.findCodeBlockRange`）

### 判词与上游依据（**本路自己打开文件逐行核过**，不是抄旧文档）

| 上游相对路径 | 行号 | 说的是什么 | 本路核对 |
| --- | --- | --- | --- |
| `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java` | `:108-120` | `calcBlockEndOffset`：`:109` 括号扫描、`:110` 问结构支持、`:111-113` 结构是空区间 ⇒ 用括号那半、`:114-116` 括号是 -1 ⇒ 用结构那半、`:118` `Math.min(结构, 括号)` | ✔ 逐行读过，函数体到 `:120` 的 `}` 为止 |
| 同上 | `:176-188` | `calcBlockStartOffset`：同一对分支，块尾换成块首、`Math.max`（`:186`） | ✔（与 `:108-120` 同一形状，旧文档的行号一致） |
| `platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java` | `:57-66` | `findCodeBlockRange`：`:58` `TargetElementUtil.adjustOffset` → `:59` `psiFile.findElementAt(offset)` → `:60` 取不到 ⇒ `EMPTY_RANGE` → `:62-65` `EP.allForLanguage(...).stream()` 取**第一个非空**区间 | ✔ 六行逐字读过 |
| 同上 | `:47-52` | `getCodeBlockRange` 的契约：「光标所在的最小代码块区间；不在代码块里 ⇒ 空区间」 | 沿旧文，本路未复核注释原文（只核了 `:57-66` 那一段）⇒ **无法核实到行号级**，结论不受影响 |
| `platform/lang-impl/src/com/intellij/codeInsight/highlighting/AbstractCodeBlockSupportHandler.java` | `:79-83` / `:66-76` | `getCodeBlockRange` = 往上找第一个属于 `getBlockElementTypes()` 的祖先取 `getTextRange()`；`getCodeBlockMarkerRanges` 先要求光标压在一个 keyword 类型上（`:68-70` 的 `!keywordElementTypes.contains(...)` ⇒ `emptyList()`） | ✔ 两处都读过 |
| `platform/lang-impl/resources/intellij.platform.lang.impl.xml` | `:147` | EP 声明 `com.intellij.codeBlockSupportHandler`（`beanClass="com.intellij.lang.LanguageExtensionPoint"`，`dynamic="true"`） | ✔ |
| `python/pluginResources/intellij.python.community.impl.xml` | `:439` | **本树里唯一一条注册**：`<codeBlockSupportHandler language="Python" …PyControlFlowKeywordCodeBlockSupportHandler/>` | ✔ |
| `python/python-psi-impl/src/com/jetbrains/python/codeInsight/highlighting/PyControlFlowKeywordMatcher.kt` | `:48` / `:88-90` / `:119-122` / `:125-128` / `:130-137` / `:139-151` | `COMPOUND_PART_KEYWORDS` 表；"先 offset、再 offset-1"的取叶子；标记区间表；语句区间；部件归属；同一条语句的部件收集 | ✔ 六处函数签名/首行都对得上 |

**Java / C++ / TypeScript 在这份树里没有注册 handler** ⇒ 上游对这三种语言 `findCodeBlockRange` 返回
`EMPTY_RANGE`，合并那一步自动退化成"只用括号扫描"。本仓 `findCodeBlockRange(text, caret, language)`
对这三种语言返回 `null`，**不是本仓少做**，是上游就没有。
无法核实：Ultimate 侧是否还有别的 `codeBlockSupportHandler` 注册项（本机参考树是 community）。

### 已经在本面落好的那一半（**不需要你写任何判据代码**）

`src/structuralCodeBlock.ts`（491 行）里的 B 半已经实现并配了判据
（`tests/structural-code-block.test.mjs` 后 8 条，逐条对着上表那批行号）：

```ts
export interface BlockRange { from: number; to: number }
export function findCodeBlockRange(text: string, caret: number, language: string): BlockRange | null
export function mergeBlockEnd(braceEnd: number | null, structural: BlockRange | null): number | null
export function mergeBlockStart(braceStart: number | null, structural: BlockRange | null): number | null
// 另外两个出口给"标记区间"用（上游 getCodeBlockMarkerRanges 的等价物），这次接不上也可以先不引：
export function pythonCompoundStatement(text: string, caret: number): { parts: number[]; range: BlockRange } | null
export function pythonCompoundKeywordRanges(text: string, caret: number): BlockRange[]
```

A 半（`depthProfile` / `listRunStartsHere` / `listRunEndsHere` / `listRunHolds`）已被
`src/structuralSearchModifiers.ts` 的命中后复核消费 ⇒ 本文件不是零消费方模块，
**你这边不接也不会让门禁变红**。不接的唯一后果是 B 半那两个出口只过自己的测试，
那种情况下请在本文件头追加一行"编辑器那一侧明确不接"的理由（规约 §3），或让主代理把它们删掉。

### 要落的两处改动（可照抄）

**① `src/editorCodeBlock.ts`** —— 在文件头那段坐标注释之后（现 `:35` 那行 `// 按 :140-174 与 :210-237 的循环原样搬。…`
之后、`const OPENERS`（`:37`）之前）加一行：

```ts
// 代码块导航的「结构支持」那一半（CodeBlockUtil.java:110/:178 问的 CodeBlockSupportHandler.findCodeBlockRange）；
// 判据与合并规则都在 src/structuralCodeBlock.ts（本仓的 Python 承接是文本 + 缩进，见那文件的头注释）。
import { findCodeBlockRange, mergeBlockEnd, mergeBlockStart } from './structuralCodeBlock.ts'
```

把现 `:147-150` 那整段 `codeBlockTarget` 换成下面这份（多一个 `language` 形参、默认空串 =
不问结构那半 ⇒ **既有调用方不改也能过类型**）：

```ts
/**
 * 光标要落到哪儿（null = 这里没有代码块，命令不吞键）。
 * 上游把两支合起来：括号扫描（`calcBlockEndOffsetFromBraceMatcher` / `…StartOffsetFrom…`）与
 * 结构支持（`CodeBlockSupportHandler.findCodeBlockRange`），块尾取 `Math.min`（`CodeBlockUtil.java:118`）、
 * 块首取 `Math.max`（`:186`），某一半没有时用另一半（`:111-116` / `:179-184`）。
 * 合并规则在 `src/structuralCodeBlock.ts` 的 `mergeBlockEnd`/`mergeBlockStart`，本函数只负责接线。
 */
export function codeBlockTarget(text: string, caret: number, forward: boolean, language = ''): number | null {
  const structural = findCodeBlockRange(text, caret, language)
  return forward
    ? mergeBlockEnd(blockEndOffset(text, caret), structural)
    : mergeBlockStart(blockStartOffset(text, caret), structural)
}
```

**② `src/editorCommands.ts:176`** —— 语言标识本仓**现成有通道**，不用新造：
`src/editorMatchBrace.ts:49` 的 `editorLanguageId` facet（`:52-54` 的 `editorLanguageIdExtension(language)`
是它的写入口，`src/editorMatchBrace.ts:188` 已经在同一层的命令里这么读语言的，
`src/enterHandlers.ts:74` 的注释也记着这一条）。在文件头的 import 区补
`import { editorLanguageId } from './editorMatchBrace.ts'`，然后把那一行换成：

```ts
    const target = codeBlockTarget(text, range.head, forward, state.facet(editorLanguageId) ?? '')
```

`state` 就是 `codeBlockCommand` 里已有的那个 `const { state } = view`（`src/editorCommands.ts:172`）；
facet 没给值时是 `undefined` ⇒ 传空串，行为与今天**完全一致**（只有 Python 有结构那半）。
上游那一侧同一件事是按 PSI 叶子自己的 `getLanguage()` 分的（`CodeBlockSupportHandler.java:62`），
本仓按编辑器语言档分 —— 这是**架构等价**，不是照抄。

### 判据（接上时请一并落，否则这条边会无声退回单支）

`tests/editor-code-block.test.mjs` 现在钉的是"只用括号扫描"那一条链。合并边接上后要钉得住的是：
**Python 文档里光标压在 `elif` 上时，`codeBlockTarget(…, true, 'python')` 走的是 `min(结构, 括号)`
而不是括号那半**（`CodeBlockUtil.java:118`）。可照抄的一条（数值按这份样例自己数过）：

```js
import { codeBlockTarget } from '../src/editorCodeBlock.ts'

test('Python 文档里压在 elif 上：块尾走 min(结构, 括号)，不是括号那半（CodeBlockUtil.java:110/:118）', () => {
  // 括号扫描会把块尾算到**外层**函数调用的右括号上，结构那半把它收在 elif 这一块的末尾。
  const text = ['def f():', '    if a:', '        x = 1', '    elif b:', '        y = 2', 'else_marker = 3'].join('\n')
  const caret = text.indexOf('elif b') + 2               // 压在 elif 这个词里
  const structuralEnd = text.indexOf('else_marker') - 1  // 结构那半：elif 的块尾（不含换行）
  const braceEnd = text.indexOf('b:', caret)             // 括号那半：elif b: 的那个 ')' —— 本例里没有 ')'，
  // ⇒ 括号那半算到哪一格由 `src/editorCodeBlock.ts` 自己那支给；这里钉的是**不能比结构那半更远**：
  const target = codeBlockTarget(text, caret, true, 'python')
  assert.ok(target !== null)
  assert.ok(target <= structuralEnd, `块尾被括号那半带过了复合语句的边界：${target} > ${structuralEnd}`)
  assert.equal(codeBlockTarget(text, caret, true, 'java'), target === null ? null : target,
    '非 Python 语言 ⇒ 结构那半是 EMPTY_RANGE，合并结果与只用括号扫描一致（本树里只有 Python 注册了 handler）')
})
```

上面第三条断言（`'java'` 那一格的结果与 `'python'` 那一条的关系）**故意留得松**：真正的钉法要按
`blockEndOffset` 在这段样例上的实际返回值写死，那一格请桶 5 那侧跑一次再填 —— 本路不能改
`tests/editor-code-block.test.mjs`（不在派单的可改面里），**照抄前请把这条断言改成实测值**，
不要留一个恒真的断言（那是假判据）。

---

## W-2' · Run Anything 的「执行上下文（工作目录）」选择器（`lp/run-anything` 判词点名的那一条）

### 现状（本路核对）

* 模型侧**已经做完**：`src/runAnythingContext.ts`（205 行，18 个出口，含
  `allRunAnythingContexts`/`contextPath`/`resolveSelectedContext`/`pushRecentDirectory`），
  判据 `tests/run-anything-context.test.mjs`（119 行）在场。
* 它现在是**已登记的零消费方模块**（`.tools/orphan-baseline.txt` 第 19 行：
  「缺 App.vue 挂载：工作目录选择器」）。
* 宿主通道**也已经支持**：`src/runActions.ts:447` 的
  `async function runExternalTool(command: string, name: string, cwd?: string)` —— 第三参就是工作目录。
* 唯一缺口在 `src/App.vue`：那份判词写的行号是 `App.vue:2697`，**实际是 `App.vue:2611`**
  （本路 `git status` 时读到的现行内容）：

```html
    <RunAnythingDialog v-if="runAnythingOpen" :configs="runConfigs" @run-config="selectRunConfig($event.name); void runSelectedConfig(false); runAnythingOpen = false" @run-command="payload => { void runExternalTool(payload.command, payload.command); runAnythingOpen = false }" @close="runAnythingOpen = false" />
```

  这里 `runExternalTool(payload.command, payload.command)` 只给了前两参 ⇒ 第三个 `cwd` 永远是
  `undefined`，即"永远在项目根跑"。

### 为什么本路不自己接（不是懒得接）

`RunAnythingDialog.vue` 在我面上，`runAnythingContext.ts` 的模型也在判词里点名了，但
**对话框的 `emit('runCommand', { command })` 里加一个 `cwd` 字段之后，消费方那一行在 `App.vue` 里**
—— 而 `App.vue` 是派单写明的禁改文件。规约 §3「没有消费链路的 UI 一律不渲染」，
所以本路**没有**在工作目录还没人读的时候把选择器画进对话框。要接请两边同一批落。

### 可照抄的整段（两处，一前一后，缺一条都会红）

**① `src/App.vue:2611`**（`@run-command` 那个处理器改三行形；`payload.cwd` 为 `undefined` 时
`runExternalTool` 走它自己的默认值 ⇒ 与今天一致，可以先只改 App.vue 而不动对话框）：

```html
    <RunAnythingDialog v-if="runAnythingOpen" :configs="runConfigs" :modules="runConfigModuleRoots" :project-root="workspace.root ?? ''"
      @run-config="selectRunConfig($event.name); void runSelectedConfig(false); runAnythingOpen = false"
      @run-command="payload => { void runExternalTool(payload.command, payload.command, payload.cwd); runAnythingOpen = false }"
      @close="runAnythingOpen = false" />
```

`runConfigModuleRoots` / `workspace.root` 这两个名请那一侧按自己现成的上下文填
（`src/runAnythingContext.ts:80` 的 `contextPath(context, moduleRoots)` 要的是
「模块名 → 绝对根」那张表，`AllContextsInput`（`:100`）要的是项目根、模块根列表与最近目录表）。
**没有现成表就整块先不接**，只接第二行也行：那时 `payload.cwd` 是 `undefined`，行为不变。

**② `src/components/RunAnythingDialog.vue`**（我这侧等 ① 落地后同批改；先把要改的形状写清楚，
免得两边各写一套）：

```ts
const props = defineProps<{
  configs: Array<{ name: string; type?: string }>
  /** 项目根（`RunAnythingContext` 的 Project 档要的那一条）。 */
  projectRoot?: string
  /** 模块名 → 绝对根（Module 档；只有一个模块时上游整组不列，见 runAnythingContext.ts）。 */
  modules?: Readonly<Record<string, string>>
}>()
const emit = defineEmits<{
  (event: 'runConfig', payload: { name: string }): void
  (event: 'runCommand', payload: { command: string; cwd?: string }): void
  (event: 'close'): void
}>()
```

选择器本身用 `allRunAnythingContexts({ … })` 出列表、`resolveSelectedContext` 解析用户选的那一条、
`pushRecentDirectory` 记最近目录（三个出口都在 `src/runAnythingContext.ts`），
行标签走 `CONTEXT_LABEL_*`/`CONTEXT_SEPARATOR_*`/`CONTEXT_TOOLTIP` ——
**这些文案全部来自那份模块**（它自己按上游 `$default.xml`/`RunAnythingContext` 一族登记过），
不要另编一套。上游对应关系与"只有一个模块时整组不列"那条规则写在
`src/runAnythingContext.ts` 的头注释里（它引的 `:235-240`/`:242-249`/`:139-147`/`:214` 本路**未逐行复核**，
需要时请接的那一侧自己核一遍再信）。

接上之后请把 `.tools/orphan-baseline.txt` 里 `src/runAnythingContext.ts` 那一行删掉
（门禁会自动报「已接上」，那行留着会挡住后来人）。

---

## 附：本路核过但**不**需要接线的两条（免得重复劳动）

1. **`lp/text-search` 的「默认排除目录表 / glob 切分规则」坐标是旧的**：判词写
   `native/search.cpp:370-382`（`parse_patterns`）与 `:46-49`（默认排除表）。实际：
   `parse_patterns` 在 **`:660-674`**，默认表在 **`:46-50`**。功能本身在（不在缺项里），
   只是账本里的行号指不到 —— 请账本 owner 订正，本路没改 `docs/inventory/*`（不在可改面）。
2. **`se/ui` 的三条"缺"其实早做过**：Files/Symbols 独立档（`src/searchEverywhere.ts:54` 的
   `SearchEverywhereTab` 里 `project` 与 `symbols` 是**两个档**）、每档自己的 `SeFilterEditor`
   （`src/searchEverywhereFilters.ts` 的类型可见性表 + `src/components/SearchEverywhereDialog.vue:269,307`
   的「按 tab 一个键」「换档关掉另一档的漏斗」）、跨供给者配额与 Top Hit 分组
   （`src/searchEverywhereBalancer.ts`、`src/searchEverywhereTopHit.ts`）。
   仍然真缺的是：IDE / Autocompletion 两个档、`SeTabsCustomizer`/`SeAsyncTabsProvider` 的
   tab 定制与异步供给、`SeUsageEventsLogger`（本仓不收集遥测，故意的）。
