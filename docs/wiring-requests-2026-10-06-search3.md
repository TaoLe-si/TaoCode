# 接线请求 · 桶 9 搜索/比对 · search3（2026-10-06）

只列**本代理不能动**的文件（保留文件与别人的可改面）。每条给：目标文件 + 目标行号 + import 语句 + 可照抄的整段 + 上游依据。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面所有相对路径都相对它，行号本代理已逐行打开核实）。

---

## R-1 · 把语言档挂进编辑器状态（`editorLanguageId` facet 至今没有生产写入方）

**现状**（本代理实测，不是转述）：

- facet 与建扩展的函数都在：`src/editorMatchBrace.ts:51`（`export const editorLanguageId = Facet.define<string, string | undefined>`）、
  `:54-56`（`editorLanguageIdExtension(language)`）。
- **读侧已经有两处**：`src/editorMatchBrace.ts:190`（`state.facet(editorLanguageId)` 判 Java 的 `<>`）、
  `src/editorCommands.ts:179`（本批新接的代码块导航：`codeBlockTarget(text, range.head, forward, state.facet(editorLanguageId) ?? '')`）。
- **写侧零处**：`grep -rn "editorLanguageId" src`（含 `src/components/*.vue`）只命中上面那三行 + `src/enterHandlers.ts:74` 的一句注释
  ⇒ `state.facet(editorLanguageId)` 恒为 `undefined` ⇒ 代码块导航的「结构支持」那半在**真实编辑器里永远拿到空语言档**，
  与接线前逐字一致（`tests/editor-code-block.test.mjs:150`/`:165`/`:190` 三条判据因此是直接调纯函数测的，不是编出来的）。

**要动的文件**：`src/components/CodeEditor.vue`（保留文件，本代理不许碰）。
**已有同一条请求**：`docs/wiring-requests-2026-10-06-editorinput.md:159-166`（W-3）——本条是**催**，并补一句它顺带解锁的东西：
不挂这一档，桶 9 的「代码块结构支持」半区与 Java `<>` 配对跳转都还是死的。
**留痕（规约 §1）**：`src/enterHandlers.ts:74` 写「它的挂载点已经写在 `docs/wiring-requests-2026-10-06-bucket5b.md`」——
实际那个文件里没有 `editorLanguageId` 任何一字（`grep -rn editorLanguageId docs/` 只命中 `wiring-requests-…-editorinput.md`
与 `batch-…-editorinput.md`、`batch-…-search2.md`、`wiring-requests-…-search2.md`）。原写 bucket5b、实际 editorinput W-3。

**可照抄**（在 `CodeEditor.vue` 的 `language` Compartment 里追加一条扩展，`props.language` 已是 IDE 的文件类型关联值）：

```ts
// 语言档 facet：括号配对的 `<>` 档与代码块导航的「结构支持」那半都读它（src/editorMatchBrace.ts:51）。
// 值用 props.language（关联文件类型），没关联时由扩展名推（与 src/editorLanguage.ts:15-21 同一档口径）。
import { editorLanguageIdExtension } from '../editorMatchBrace.ts'
// …… language.of(await editorLanguageExtension(props.path, props.language)), editorLanguageIdExtension(props.language),
```

---

## R-2 · 「替换全部」改走本仓已算好的逐处编辑（结构化替换的复核与定义目前只在列表侧生效）

**缺的是哪一步**：结构化搜索的命中复核（`contains` / `within` / 列表整段）只发生在**结果列表**
（`src/structuralSearchModifiers.ts:492` 的 `filterHitsByModifiers`），而真正写盘的替换是宿主拿
`std::regex` 全文件替换的：`src/components/SearchPanel.vue:393`（`search.replaceSelected`）、
`:455`（`search.replace`）。⇒ 面板上写着「N 处不满足修饰符，已剔除」，按下替换却会连那些一起改掉。
上游这两批是同一批对象：`Replacer.java:125-131` 把 `matcher.testFindMatches(sink)` 收到的**命中**逐条建成
`ReplacementInfo`，`Replacer.java:180-211` 再逐条写回；筛选与写回吃的是同一份命中列表。

**纯函数侧本批已经备好**（`src/structuralSearchReplace.ts`）：

- `:171` `hitsWithin` —— 全部互不重叠命中（推进规则 + 零宽保险）；
- `:288` `structuralReplacementPlan(pattern, text, replacement, definitions, flags, accept?)` → `{edits, unchanged, skipped}`，
  `accept` 就是给 `verdictForHit` 留的口；
- `:320` `applyStructuralReplacements(text, edits)` —— 逆序拼接（`ReplacementBuilder.java:140-141`）。

**要动的文件**：`src/components/SearchPanel.vue`（UI 挂载，按派单「UI 挂载一律写请求」）。
**可照抄的形状**（片段，替换按钮的 handler 里；`pattern` 来自 `structuralSearchPanelModel.ts` 的 `compiled`）：

```ts
import { structuralReplacementPlan, applyStructuralReplacements } from '../structuralSearchReplace.ts'
import { verdictForHit } from '../structuralSearchModifiers.ts'
// 逐处复核 + 逐处编辑 ⇒ 列出来的命中与写下去的命中是同一批（上游 Replacer.java:125-131 的同一份列表）。
const plan = structuralReplacementPlan(pattern, fileText, replacement, definitions, flags,
  spans => verdictForHit(pattern, scope, { text: fileText, column: spans.whole.start }, flags, spans.whole.start).keep)
const next = applyStructuralReplacements(fileText, plan.edits)   // 一次事务写回，plan.edits 已是文档顺序
```

**落差要说清**：`applyStructuralReplacements` 是「一次算全部 + 逆序写」，上游是「逐处写 + 每次重解析 PSI、
失效的跳过」（`Replacer.java:185-207`、`:219-221`）。本仓没有语法树可重解析，所以调用方必须在**同一个文档事务**里
写完，中途不许有别人改这块文本；这条差异已写在函数头（`src/structuralSearchReplace.ts:310-319`）。

---

## R-3 · Python 的语法数据没装，结构那半在编辑器里到不了（package.json 是保留文件）

`src/editorLanguage.ts:15-21` 只装 Java / C++ / JS+TS / JSON / HTML / CSS，`package.json:17-22` 里也没有
`@codemirror/lang-python`。而上游唯一注册了 `codeBlockSupportHandler` 的语言就是 Python
（`python/pluginResources/intellij.python.community.impl.xml:439`，EP 声明
`platform/lang-impl/resources/intellij.platform.lang.impl.xml:147`）⇒ 本仓那份 Python 复合语句判据
（`src/structuralCodeBlock.ts:353` 的 `pythonCompoundStatement`）在生产里今天**触发不了**：
既没有语言档（R-1），也没有 `.py` 的词法（这条）。
**要做的事**：加依赖 `@codemirror/lang-python`，并在 `editorLanguage.ts` 里补一条 `.py` 分支。
**为什么这条值得做**：不装的话，「先向内找更小的块、再向外扩」这条链在界面上永远只能演示到"退回括号扫描"那一档。
**无法核实**：Ultimate 树里是否还有别的语言注册了这个 EP（本机参考树是 community）。

---

## R-4 · 找不到块时右手边那一支的选区语义与上游不同（要改的是 `src/editorCommands.ts`）

上游 `CodeBlockUtil.java`：
- `moveCaretToCodeBlockEnd:35-69` —— `endOffset == -1` 时**不挪光标**（`:55-57`），但**仍然** `scrollToCaret`（`:61`）
  并按 `isWithSelection` 清掉/重设选区（`:63-68`）；
- `moveCaretToCodeBlockStart:71-106` —— `start < 0` 时整段 `return`（`:92`），连选区都不动。

本仓 `src/editorCommands.ts:174-190` 两支都是「一个都没动 ⇒ `return false`（不吞键、不清选区、不滚）」。
⇒ 与上游的**唯一**差别在右手边那一支：上游会清选区，本仓不会。
不改的理由：这条改动会把 `block.end` 从"没块时把键让给别人"变成"没块时吞掉键并清掉用户选区"，
是用户可见的退化风险，且 `tests/editor-code-block.test.mjs:78-82`/`:150-163` 钉的就是现在这条（不吞键）。
要按上游收口的话，动的是 `src/editorCommands.ts`（非本代理可改面），所以交到这里。
