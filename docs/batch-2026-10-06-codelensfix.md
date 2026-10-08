# Batch 2026-10-06 — CodeVision / CodeLens 极窄修复 lane（codelensfix）

范围：只收 Code Vision / CodeLens 域的 14 条真红 + 本域 3 条 `error TS`。
上游参考树（唯一可用）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
不改保留文件、不 commit、不跑锚点更新（锚点由主代理统一重算）。

## 0. 现场复核（自己跑，未照抄派单）

派单给的命令族里 **`tests/codeLens*.test.mjs`、`tests/codicon*.test.mjs`、`tests/cvLocalVision.test.mjs`、
`tests/anchor-limit*.test.mjs` 四个 glob 在本仓没有匹配文件**（实际文件名是 `code-lens-codicon`、
`cv-local-vision`、`code-vision-anchor-limit`）⇒ 派单的 "86 tests / 72 pass" 复现不出来。
**订正留痕**：`ls tests` 实测本域共 8 个文件，逐文件分布（node 24.18.0，`node --test --test-reporter=tap`，修前）：

| 文件 | tests | pass | fail |
| --- | --- | --- | --- |
| `tests/code-lens-codicon.test.mjs` | 8 | 8 | 0 |
| `tests/code-lens-command.test.mjs` | 6 | 6 | 0 |
| `tests/code-lens-grouping.test.mjs` | 21 | 19 | 2 |
| `tests/code-lens-refresh.test.mjs` | 5 | 1 | 4 |
| `tests/code-lens.test.mjs` | 5 | 5 | 0 |
| `tests/code-vision-anchor-limit.test.mjs` | 10 | 10 | 0 |
| `tests/code-vision-local-channel.test.mjs` | 9 | 1 | 8 |
| `tests/code-vision-providers.test.mjs` | 7 | 7 | 0 |
| （交付门）`tests/module-size.test.mjs` | 5 | 5 | 0 |

⇒ **本域 71 tests / 57 pass / 14 fail**（派单说的 `code-lens-local-channel.test.mjs` 1/8 实为
`code-vision-local-channel.test.mjs` 1/9；`code-lens-grouping` 19/2 复核一致）。
14 条红的报错栈**全部**是同一处：`TypeError: Cannot read properties of undefined (reading 'seq')`
at `src/codeLensExtension.ts:447:66`（`schedule`）—— 4 条来自 `code-lens-refresh` 的无 `state` 假 view，
8 条来自 `code-vision-local-channel` 的同款假 view，2 条来自 `code-lens-grouping` 的
`let state = null; const view = { dispatch: ... }`（**view 上没有 `state` 这一格**，
直到第一次 dispatch 才有局部变量 `state`）。

`npx vue-tsc -b --force`（本轮第一次跑）：**6 条 `error TS`，exit code 1**。归属：
- 本域 3 条：`src/codeLensExtension.ts(404,30)` TS2339 `Property 'seq' does not exist on type 'EditorState'`；
  `(447,66)` 同；`(423,36)` TS2345 `AnchoredLens[]` 不能当 `readonly CachedLens[]`（`CachedLens.item.range` 是必填，
  而 `CodeLensItem.range` 可选 —— 本地 Code Vision 条目天生不带 range）。
- 别条 lane 在飞（**不碰**）：`src/gradleHost.ts(880,74)`（gradle*，黑名单）、
  `src/runConfigTree.ts(191,36)`（execution/run 族）、`src/semanticActions.ts(507,71)`（organizeImports 参数形）。
  派单说第 6 条在 `intentionList.ts`，实测磁盘上是 `runConfigTree.ts` ⇒ 记为派单口误。

## 1. 方向判定：`editor.state.seq` 到底有没有意义 → **没有，改实现**

自己开的坐标（不采信仓内既有断言）：

- **CodeMirror 这一侧根本没有 `seq`**：`node_modules/@codemirror/state` 6.7.6，
  `grep -nE "(^|[^a-zA-Z])seq([^a-zA-Z]|$)" dist/index.d.ts` **零命中**（只有 `sequence`/`sequential` 那几个词），
  `dist/index.js` 只有 `:2423` 一个局部变量 `let seq = !!specs[i].sequential`；
  实跑 `EditorState.create({doc})` 打属性：`seq = undefined`、`version = undefined`、`doc.revision = undefined`，
  prototype 只有 `constructor,field,update,applyTransaction,replaceSelection,changeByRange,changes,toText,
  sliceDoc,facet,toJSON,tabSize,lineBreak,readOnly,phrase,languageDataAt,charCategorizer,wordAt`。
  ⇒ 生产里 `editor.state.seq` 也**恒为 `undefined`**：`beginRequest` 的 `sentForSeq === seq` 与 `accept` 的版本闸门
  全变成"和 undefined 比"，在飞期间改了正文也照收（行号是按旧文档算的）—— 不是"只有测试坏"，是实现读了一个不存在的属性。
- 仓内**早就写下过同一条结论**：`src/completionUi.ts:106-108`「CodeMirror 的 `EditorState.doc` 是**不可变**的 `Text`：
  任何一次文档编辑都换一个新对象，所以对象身份就是那份改动号（`EditorState` 上**没有公开的 changeCount/seq 可用**）」；
  `src/docHoverContent.ts:123-130` 同一件事（并点名"按 `state.epoch` 会把改选区也算成变更"是错的）。
- **上游的刷新依据**（`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt`，338 行，自己数）：
  `:31` 类注释「Staleness is per document. The snapshot stores the `Document.modificationStamp` that the request was …」；
  `:68-71` `getHighlightings` 只有 `highlightingsSnapshot?.docModStamp != docModStamp` 才 `scheduleHighlightingsUpdate`；
  `:92` 「a response for the same document version has been applied while this trigger was settling」⇒ 直接 return；
  `:95` `fileToStampWhenRequestSent.put(...) == docModStamp` ⇒ 同一版不重发；
  `:123-131` `finally` 释放 in-flight 与去重闸（原文 "release the slot and the dedup guard, so the next
  `getHighlightings()` call can re-request"）；`:158` 取号那一句；`:161-163` `isFirstPullFor`；
  `:170-177` `responseReceived`（`if (document.modificationStamp != docModStamp) { scheduleHighlightingsUpdate(file); return null }`）；
  `:292-303` + `:313` `STALE_DOC_MOD_STAMP = -1L`（服务器强制刷新：抹闸、保内容）。
  号本身：`platform/core-api/src/com/intellij/openapi/editor/Document.java:25`（"stamp is incremented whenever the
  content changes"）、`:185`（"not related to the file modification time"）、`:192`（`long getModificationStamp();`）。
  ⇒ 上游的判据是**"正文变过一版"**，不是"派发过任何事务"。
- **本仓已有的真源（同族同一条闸门，已经在生产里用着）**：`semanticRevisionOf(doc)`
  （`src/semanticHighlighting.ts:339-354`，`WeakMap<object, number>`：Text 不可变 ⇒ 对象身份即修订，
  注释原文「与上游 `modificationStamp` 同形」）。消费点 `src/editorInlayHints.ts:230`（发请求前取号）与
  `:259`（`acceptFull(path, revision, semanticRevisionOf(target.state.doc), items)` = 上游 `:170-177` 的接受闸门）。
  `inlayHint` 与 `codeLens` 在上游是**同一个 `LspHighlightingCache` 的两条具名子类**
  （`LspInlayHintsCache` / `LspCodeLensCache`，注册表 `LspHighlightingCacheRegistry.kt`）⇒ 本仓该用同一份号源，
  不再另造第三张 WeakMap（`src/lspHighlightingCache.ts:154` 的 `contentStamp` 是**内容哈希**，
  而 `src/documentRevisions.ts:22-28` 已明文否定哈希口径：「号也不是内容哈希：改回去也算改过……哈希会在
  "改了又改回来"时不作废，那不是上游的判据」，且它要 `sliceDoc()` 整篇 O(n)）。

**结论**：读 `editor.state.seq` 无上游/工程意义 ⇒ **改实现**（不是补夹具迁就假属性）。
"原来读的是什么、为什么不对"：`codeLensExtension.ts:404`/`:447` 读 `editor.state.seq`，依据是
`codeLensCache.ts:53` 那句"上游 `Document.modificationStamp` 在 CodeMirror 这一侧的等价物是 `state.seq`
（每提交一次事务 +1，同文档单调）"—— 这句话本身是**假的**（CodeMirror 6.7.6 没这个属性，见上）。
换成 `semanticRevisionOf(view.state.doc)` 后：正文改一次换一次号、改选区/派发装饰不换号、
"改了又改回来"也换号 —— 三条与上游 `Document.java:25/:185` 逐字对齐。

## 2. 落地（改了哪 5 个文件）

**`src/codeLensExtension.ts`（507 → 534 行，单职责上限 600）**
- `:417` 发请求前 `const revision = semanticRevisionOf(editor.state.doc)`（原来 `editor.state.seq`）。
- `:437` 接受闸门按上游 `:170-177` 传**两个号**：`cache.accept(path, revision, semanticRevisionOf(target.state.doc), merged)`
  —— 原来只传请求时那一个，于是"在飞期间正文又变了"这一档根本没在比当前文档，形同虚设。
- `:460` 取 `cache.peek(...)` 的结论、`:469` 消费它的 `shouldRequest`（上游 `:68-71` + `:92` 那一档"**正文没变不重问**"；
  这一格原来算出来**没人读**）。只压 `change` 档：`focus`（重新拿到焦点、别处的引用计数变了）与
  `open`（本地通道抓完一轮 / 服务器一句 `workspace/codeLens/refresh`）都不是"这一篇正文又改过"，
  那些在本仓**必须**还能重问（上游对它们走 `:292-303` 的 `invalidate` + `CodeVisionHost` 失效信号那条链）。
- 首拍不走去抖那一档保持原语义（无视图时仍退回 `codeLensRefreshDelay`，没加"永不发生"的新分支）。
- 新增一条 import（出处与订正留痕在 `:41-50`，语句在 `:51`）；`CodeLensDeps.path` 的注释里那句"`state.seq` 必变"改成
  "必然换一个 `Text` 对象、修订号必变"。

**`src/codeLensCache.ts`（238 → 280 行，上限 900）**
- 文件头「本仓的承接方式」第一条把假的 `state.seq` 等价物换成 `semanticRevisionOf(state.doc)`，
  并写明为什么不是 `contentStamp`（哈希）也不是每事务计数；留了**订正留痕**。
- `LensCache.accept(path, seq, currentSeq, lenses)`：两判据（① 号变了 ⇒ 整份不收并放行两格；
  ② 本槽已不属于这条请求（`invalidate`/被取代）⇒ 不收），与本仓同一条闸门的另一处
  `HighlightingSnapshotCache.acceptFull`（`src/lspHighlightingCache.ts`）逐字同形。
- `CachedLens.item.range` 改**可选**（本地 Code Vision 条目不带区间）⇒ 修掉那条 TS2345。
- `LensCacheDecision.shouldRequest` 的注释登记了真实消费点（不再是一格没人读的返回值）。

**测试夹具补成真实形状（三份，判据能失败）**
- `tests/code-lens-refresh.test.mjs`（本 lane 把它从 5 条写成 7 条；随后在飞的 hlcache300 lane 又加 1 条源码取证，
  现 8 条 —— 见 §5）：假 view 换成**真 `EditorState`**，`dispatch` 把事务真的作用回状态；
  `editDoc()` 发一次真的正文变更、`moveCaret()` 只改选区。新增/改写三条判据：
  ① 正文没变的重复触发**不重问**（含"只改选区不重问"这一子档 —— 正是 `state.seq` 那类"每事务计数"会误判的地方）；
  ② 正文真变了 ⇒ **必须再问**；③ 在飞期间改了正文 ⇒ 那份按旧行号算的答案**不落盘**、只由补跑那一次落盘
  （原来这条断的是 `dispatched.length === 2`，即旧答案照收 —— 那是假象，判据跟着号源改严）。
  另加一条：`focus` / `open` 两档在"正文没变"时**仍然要重问**（防止后来人把那一闸一刀切）。
- `tests/code-vision-local-channel.test.mjs`：同款真 `EditorState` 假 view（`fakeView`/`viewOf`），断言未放宽。
- `tests/code-lens-grouping.test.mjs`：两处假 view 补上 `get state()`（那两条用例本来就在真状态上读装饰集，
  只是漏了把状态挂到 view 上）。

未做（不在本 lane）：`CodeLensDeps.path` 的宿主接线（仍缺，接线请求 C-1 已在
`docs/wiring-requests-2026-10-06-codevision2.md`），本轮**没有**新增需要宿主配合的事，
故未新建 wiring-requests 文件；新增持久化键 **0** 个。

## 3. 收工验证（原始数字）

- 派单原文命令（4 个 glob 无匹配文件，node 24 直接跳过它们，不报错）：
  `node --test tests/code-lens*.test.mjs tests/codeLens*.test.mjs tests/cvLocalVision.test.mjs tests/code-vision*.test.mjs tests/module-size.test.mjs`
  ⇒ **tests 79 / suites 0 / pass 79 / fail 0**。
- 本域 + 邻居的实际文件全集（含 `cv-local-vision`）：
  `tests/code-lens.test.mjs`+`code-lens-codicon`+`code-lens-command`+`code-lens-grouping`+`code-lens-refresh`+
  `code-vision-anchor-limit`+`code-vision-local-channel`+`code-vision-providers`+`cv-local-vision`+`module-size`
  ⇒ **tests 94 / suites 0 / pass 94 / fail 0**。
  逐文件（收工时实测）：codicon 8/8、command 6/6、grouping 21/21、refresh 8/8、code-lens 5/5、anchor-limit 10/10、
  local-channel 9/9、providers 7/7、cv-local-vision 15/15、module-size 5/5。
  另跑（只读复核，未改）：`lsp-per-file-capabilities` 12/12、`lsp-server-messages` 23/23、`setkeys-batch` 20/20。
  ⇒ 14 条真红 **全部收掉**（本域修前 71 tests / 57 pass / 14 fail → 修后 74 tests / 74 pass / 0 fail；
  refresh 一族 5 → 8 条：本 lane 新增 2 条修订号判据，在飞的 hlcache300 lane 另加 1 条"数字同源"取证，见 §5）。
- `npx vue-tsc -b --force`（收工最后一次单独测）：**exit code 1、`error TS` 1 条**，本域（`codeLens*`）命中 **0** 条
  —— 原来那 3 条全消。剩下这一条归属：`src/semanticActions.ts(509,71)`（refactor1/organizeImports 在飞）。
  **并发漂移如实记**：同一条命令在本轮中途还量到过 2 条（多出的 `src/runDashboard.ts(120,3)` 下一条就没了）、
  以及开跑前的 6 条（`gradleHost.ts(880,74)`、`runConfigTree.ts(191,36)`、`components/TestRunnerPanel.vue(327,31)`）——
  这些都是别的 lane 在飞期间自己的中间态，本 lane 一字未碰那几个文件。
- `node .tools/find-orphan-modules.mjs --gate`：本 lane 15:3x 与 15:4x 两次实测 **exit 0**
  （「门禁绿：没有基线之外的新增零消费方模块」，已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2 条，都不是本域）；
  **收工前最后一次复跑（15:54）变红 1 条**：`✘ 新增零生产消费方模块：src/usageViewTreeModel.ts` ——
  那条是别家 lane 在 15:53 新建的文件（`grep -c "codeLens\|CodeVision" src/usageViewTreeModel.ts` = **0**，
  与本域无关；本 lane 新建的文件只有本文档，没有任何新 `src/*.ts`）。归属与修法都不在本 lane 的范围内，
  按"在飞的红只记录不修"处理，写在这里给主代理收口时对上号。
- 反向验证（两条探针，注入即红、删净后回绿；探针标识不落盘）：
  | 注入 | 预期 | 实测 |
  | --- | --- | --- |
  | 把两处号源换成常量（等价于原来那个恒 `undefined` 的假属性） | ①"正文变了才再问"②"在飞期间改正文 ⇒ 旧答案不落盘" | **2 条红**（fail 2 / pass 5） |
  | 摘掉 `schedule` 里"正文没变不重问"那一档（`if (false && …)`） | ①"正文没变的重复触发不重问" | **1 条红**（`AssertionError: 正文没变还去重问一次整文档的 codeLens`） |
  两条探针均已还原；收工 grep（`--exclude-dir=node_modules --exclude-dir=.git`，全仓）：探针标识 **0 命中**，
  `editor.state.seq` 只剩 `src/codeLensExtension.ts:47` 那句"原来读的是什么"的留痕（注释，非代码）。
- 保留文件未动：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`、
  `scripts/verdict_table.py`、`docs/inventory/*`（本轮编辑清单：`src/codeLensCache.ts`、`src/codeLensExtension.ts`、
  `tests/code-lens-refresh.test.mjs`、`tests/code-vision-local-channel.test.mjs`、`tests/code-lens-grouping.test.mjs`、
  本文件）。黑名单文件全部**只读**（`documentRevisions.ts`、`lspHighlightingCache.ts`、`editorFoldingState.ts`
  只作为号源/形状的参考，未改一字）。
- ④ 白名单只读复核：`native/settings_editor_keys.hpp:95` 仍是**四组**
  `LspCodeVisionProvider`/`problems`/`references`/`inheritors`，本轮一字未改；
  `tests/code-lens-grouping.test.mjs` 里那条"原生白名单 = 前端白名单 = 上游那四个组键"现在 **21/21 全绿**
  （原来它被同一条 `seq` 崩掉两条，整族看起来像"白名单要塌"，实际白名单无恙）。

## 4. 假坐标 / 无法核实登记

- 派单命令族的 4 个 glob 无匹配文件（见 §0/§3，按实际文件名复跑）。
- 派单说第 6 条 TS 错在 `src/intentionList.ts`，磁盘实测在 `src/runConfigTree.ts`（见 §0）。
- 派单说的 `tests/code-lens-local-channel.test.mjs` 不存在，实为 `tests/code-vision-local-channel.test.mjs`（1/9 而非 1/8）。
- 无法核实：`codeLensExtension.ts`/`codeLensCache.ts` 14:40-14:41 那一次改动出自哪条历史 lane（hlfeat / codelens3）——
  仓里没有 per-lane 的落盘账（`git status` 只有工作区脏、`git log` 三个提交把这批文件整体收过），
  本轮**不**据此判定归属，只按磁盘现状修。
- 上游 `LspHighlightingCache.kt` 的行号与仓内 `codeLensCache.ts` 头部既有引用逐条对过（`:31`/`:68-71`/`:92`/`:95`/
  `:123-131`/`:158`/`:161-163`/`:170-177`/`:292-303`/`:313` 全部实测命中），未发现新的假坐标；
  `Document.java:25/:185/:192` 亦实测命中。仓内既有引用里 `:50-51`/`:146`/`:98-107`/`:108-111`/`:170-180`/`:192-210`
  本轮只沿用未逐条重开（除 §1 列出的那些），如与主代理收口时的锚点表不符，以锚点表为准。
- `settings_editor_keys.hpp` 的**四组**白名单（实测判据在 `:95`，`fail(...)` 在 `:96`）完好，未改动。

## 5. 并发在飞记录（本 lane 之外落进本域文件的改动）

本轮收工前约 15:46-15:47，另一条在飞 lane（自记 `hlcache300`）改了**本域两个文件**，不是本 lane 做的：

- `src/codeLens.ts`（mtime 15:46）：`CODE_LENS_REFRESH.changeMs` 由 `400` 改为复用
  `src/lspHighlightingCache.ts:188` 的 `LOW_PRIORITY_QUIESCENCE_MS`（=300），并把 `focus:700`
  标注为"上游没有这一档、本仓自定"。
- `tests/code-lens-refresh.test.mjs`（mtime 15:47，正是本 lane 刚重写过的夹具）：那条"分档"用例的
  `changeMs` 断言从字面 400 改成钉 `LOW_PRIORITY_QUIESCENCE_MS`，并新增一条"数字与上游同源"取证。
  本 lane 的 7 条用例（含两条修订号判据）**逐条复读盘上仍在**（`grep -n` 实测断言在
  `:113`/`:119`/`:125`/`:139`/`:159` 等行），未被放宽。

本 lane 自己开上游复核了那个数（不采信来路不明的在飞改动）：
`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:321` =
`DIAGNOSTICS_QUIESCENCE_DELAY = 250.milliseconds`、`:328` = `LOW_PRIORITY_QUIESCENCE_DELAY = 300.milliseconds`、
`:323-326` 那段注释（正文在 `:324`）把这一族点名成 "Semantic tokens, document links, folding, **code lens**, inlay hints, and colors"、
`:52` 的 `quiescenceDelay` 缺省就取 `LOW_PRIORITY_QUIESCENCE_DELAY` ⇒ **上游确实是 300，参考树里没有 400 这个数**
（`grep -n "milliseconds"` 全量：只有 250/300 两个）。所以那条改动对本域是"过时断言跟上新数值"，不是回归；
本 lane 没有回退它，也没有替它写账。

**同一 lane 的三次半路现场（只记录，未修）**：`src/codeLens.ts`（现 mtime 15:53）在本 lane 收工窗口里被读到三次中间态 ——
15:51 那一次整族 7 个测试文件加载失败（`SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expected ';', '}' or <eof>`，
指针落在那段引用上游注释的行上）；15:52 那一次语法已通，但它自己那条"编辑档与上游同源"的源码取证用例
（`tests/code-lens-refresh.test.mjs:82`）红了一次（`编辑档没钉上游坐标 ⇒ "同源"无取证`）；
15:54 那一次整族量到 79 tests / 77 pass / 2 fail。三次都在下一次复跑里自愈
（15:52 之后 `:237` 的
`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:328` 在位，那条用例 ✔；
15:54 之后实测 79/79、94/94 全绿，即 §3 的数），
本 lane 全程**未编辑 `src/codeLens.ts`**，也没动过那几条断言。
