# 批次报告 · 桶 2 补全 / 内联补全 / 意图 / 字面量预览 · 2026-10-06（代号 `completion`）

派单三件事：① 核 `docs/wiring-requests-2026-10-06-bucket2c.md` 的 W2/W3/W4 与 `docs/wiring-requests-2026-10-06-bucket2b2.md` 的 R2；
② 补 `docs/inventory/verdict-platform_rest.md` 里 `lp/completion`、`pf/inline-completion`、`lp/intention`、`lp/preview`、`an/completion`
五族的判词缺项（只挑不需要 PSI/索引的）；③ 复核 `src/cyclicWordCompletion.ts` 并检查它的挂点。
接线请求单放 `docs/wiring-requests-2026-10-06-completion.md`。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面每条坐标都是本轮亲手打开过的）。

---

## 1. 判词表

判定含义：`[x]` 已做 · `[~]` 部分 · `[ ]` 未做 · `[-]` 不适用（具体理由）。
「原判定」= 判词/接线报告写的，「实际」= 本轮打开文件核到的。

### 1.1 `lp/completion`（verdict-platform_rest.md:59）

| 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 命令补全 `completion/command/**` | `[x]`（原判词写「缺」⇒ **订正：早做过**） | `platform/lang-impl/src/com/intellij/codeInsight/completion/command/CommandCompletionProvider.kt:701-742`、`:311-326`；`CommandCompletionSuffixProvider.kt:23,28` | `src/completionCommands.ts` 全文；消费者 `src/lspCompletion.ts:235` 附近 | 模块在、消费链在，但**一条判据都没有** ⇒ 本轮补 `tests/completion-commands.test.mjs`（6 用例，见 §1.6 的两处订正） |
| 智能补全 / 类名补全的**模式** | `[x]` | `$default.xml:909-911`（SmartType）、`:843-845`（ClassName）；`CompletionParameters.java:113-115` | `src/completionModes.ts` 全档 + `src/completionUi.ts:52-91`（`startCompletionAs` / `basicCompletionKeys`） | 三条键位都落，判据 `tests/completion-mode-keys.test.mjs` |
| 智能 / 类名的**菜单行** | `[ ]`（宿主侧，非模块侧） | `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:115-147` | `src/menus/codeMenu.ts:33`（只有一条 `completion`）、`src/components/CodeEditor.vue:711`（`completion: startCompletion`） | 请求 W1′，见接线单 |
| `CamelHumpMatcher` | `[x]` | `platform/lang-impl/src/com/intellij/codeInsight/completion/impl/`（`BetterPrefixMatcher.kt`）+ `CamelHumpMatcher.java:80-87` | `src/completionCamelHump.ts`（615 行）、`src/completionSort.ts:76` | 文档词补全与命令补全各自用它 |
| 跨文件词补全（Alt+/ 换档） | `[x]` | `.../actions/HippieWordCompletionHandler.java:270-278` | `src/completionOpenEditors.ts:20,26,31,62` + 宿主 `src/App.vue:134,183,187,201` | **W2 已由宿主接上**（本轮核实并据此改了本模块的摘除语义，见 §1.5） |
| lookup 排序器扩展点 / usage 统计 | `[-]` | `LookupElementProximityWeigher.java`、`StatisticsUpdate.kt` | —— | 本仓不采集遥测（判词原话），扩展点没有宿主 |

### 1.2 `pf/inline-completion`（verdict-platform_rest.md:72）

| 项 | 判定 | 上游依据 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 悬浮操作条 `InlineCompletionTooltip*` | `[~]`（**本轮新落**） | `.../inline/completion/tooltip/InlineCompletionTooltipProvokerMouseListener.kt:11-25,35-50`；`InlineCompletionTooltip.kt:38-89,93-97`、`:68-73`、`:76-78`；`InlineCompletionTooltipComponent.kt:15-27`；`InlineCompletionTooltipActions.kt:34-47`；`platform/platform-api/resources/messages/IdeBundle.properties:3234` | 新模块 `src/inlineCompletionTooltip.ts`（181 行）+ 挂点 `src/inlineCompletionExtension.ts:75-82,121,134,161,173` | **不需要改 `CodeEditor.vue`**（W3 因此撤销）；文案「以补全」= `to complete` 直译 |
| └ 其中的**就地改快捷键** | `[-]` | `InlineCompletionTooltipActions.kt:127-156`（`KeymapManager` 派生副本 + `addShortcut`） | —— | 本仓键位是静态表（`src/keymap*.ts` 不在可改面）⇒ 没有后端就不渲染下拉，避免假控件 |
| └ 其中的**provider 名字/图标** | `[ ]` | `InlineCompletionTooltipFactory.kt:16-40` | `src/inlineCompletionTooltip.ts:88`（没有 rows 就不弹） | `InlineCompletionItem` 里没有可核实的 provider 名 ⇒ 不编一个 |
| 按词 / 按行部分接受 | `[x]` | `InsertInlineCompletionWordAction` / `…LineAction`、`InlineCompletionPartialAcceptHandlerImpl.kt:200-225` | `src/inlineCompletionExtension.ts:143-171` + `src/inlineCompletion.ts:144-172` | 判据 `tests/inline-completion-partial.test.mjs` |
| `inline/edit`（Inline Edit） | `[-]` | `.../inline/completion/`（会话侧） | —— | LSP 协议没有 inline/edit 请求，本仓宿主通道也没有 ⇒ 无供给 |
| `options` 设置页 / 按 provider 开关 | `[ ]`（宿主侧） | `.../inline/completion/options/InlineCompletionConfigurable.kt:26`（`BoundCompositeConfigurable<UnnamedConfigurable>`）、`InlineCompletionConfigurableEP.kt` | `src/settingsModel.ts` 里 `inlineCompletion` **0 命中**（本轮实测） | 请求 W4′ |
| `suppress` 抑制状态 | `[-]` | 目录只有 `InlineCompletionSuppressStateSupplier.kt`、`InlineCompletionSuppressStateByInlinePromptSupplier.kt` | —— | 两份都是「按 inline prompt 供给方」的状态源，本仓没有那个供给方 ⇒ 语义无法核实 |
| `editorLineStripeHint` 行条提示 | `[-]`／无法核实 | `.../inline/completion/editor/` 里**只有** `InlineCompletionEditorType.kt`（本轮 `ls` 实测） | —— | 判词点名的这个 hint 在本基准树里找不到本体 |
| `logs` / `statistics` | `[-]` | `.../inline/completion/logs`、`statistics` | —— | 本仓不采集遥测 |
| 多 provider 聚合 | `[-]` | `RemDevAggregatorInlineCompletionProvider.kt` | —— | 那是远程开发聚合器；本仓单供给，没有第二个 provider 可聚合 |

### 1.3 `lp/intention`（verdict-platform_rest.md:121）

| 项 | 判定 | 上游依据 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 意图预览（before/after） | `[x]`（原判词写「缺」⇒ **订正：早做过**） | `platform/lang-impl/src/com/intellij/codeInsight/intention/preview/`（`IntentionPreviewUtils`/`IntentionPreviewInfoDiff`） | `src/intentionPreview.ts:1-118`（消费方 `src/semanticActions.ts`、`src/components/ProblemsPanel.vue`） | 按 LSP 编辑载荷算改动，不跑 PSI |
| 意图启用/停用（设置面） | `[~]` | `IntentionManagerImpl`/`IntentionActionMetaData` | `src/intentionSettings.ts:1-93`（消费方 `src/localIntentions.ts`、`src/semanticActions.ts`） | 本地抑制条目每条一开关 + 总开关；Settings 树页面注册在冻结文件里 ⇒ 入口走问题面板「意图…」 |
| 每条意图的 `.description.html` | `[-]` | `platform/lang-impl/resources/intentionDescriptions/` **只有 1 个目录**（本轮 `ls \| wc -l` = 1：`OpenInWebBrowserIntention`） | —— | 社区树里没有抑制类意图的描述模板本体 ⇒ 文案无出处，不能编 |
| 问题面板逐行抑制入口 | `[ ]`（他人名下） | `ShowProblemsViewQuickFixesAction.kt:33-35,78-92` | `src/localIntentions.ts` 条目侧已就位 | = 原报告 W5，`ProblemsPanel.vue` 不在本轮可改面 |
| `AssignShortcutToIntentionAction` | `[-]`（越界） | 上游 keymap 侧 | —— | `src/keymap*.ts` 不在本轮可改面 |

### 1.4 `lp/preview`（verdict-platform_rest.md:361）与 `an/completion`（:137）

| 族 | 项 | 判定 | 依据 |
| --- | --- | --- | --- |
| `lp/preview` | CSS `rgb()/rgba()`、十六进制、图片路径 | `[x]` | `src/literalPreview.ts:88-127` + `src/literalPreviewExtension.ts`；判据 `tests/literal-preview.test.mjs` |
| `lp/preview` | `ElementPreviewProvider` 扩展点 | `[-]` | 全树 `grep -rln ElementPreviewProvider` 只命中 2 个文件：抽象类 `platform/lang-api/src/com/intellij/codeInsight/preview/ElementPreviewProvider.java` 与 `platform/lang-impl/src/com/intellij/codeInsight/preview/ImageOrColorPreviewService.kt` —— **社区树里没有实现者** |
| `lp/preview` | Java `new Color(...)` 非 CSS 字面量 | `[-]`／无法核实 | 同上：解析规则只存在于不在树里的 provider ⇒ 按规约不能编造命中形状 |
| `an/completion` | 插入处理器 / 尾类型、合流、排序、贡献者、命令、模式、跨文档、循环词 | `[x]` | `src/completionInsertHandlers.ts`、`src/completionMerge.ts`、`src/completionSort.ts`、`src/completionContributors.ts`、`src/completionCommands.ts`、`src/completionModes.ts`、`src/completionOpenEditors.ts`、`src/cyclicWordCompletion.ts` |
| `an/completion` | `PsiReferenceCompletionItemProvider`/`OffsetsInFile`/`LookupImpl` 命令树/序列化一族 | `[-]` | 需要 PSI 副本或 Swing 本体（判词已写，本轮确认无对等物） |

### 1.5 本轮**改掉的两处真实偏差**（都是「复核别人已做的结论」捞出来的）

| # | 偏差 | 上游依据 | 修法与本仓落点 | 判据 |
| --- | --- | --- | --- | --- |
| 1 | 循环词补全的候选表：`words` 与 `afterWords` **共用一张去重表** ⇒ 同一个词既在光标前又在光标后时，跨档那一次重复被吃掉，循环比上游少走一步 | `HippieWordCompletionHandler.java:283-303`，关键是 `:298` 的 `allWords.clear()` | `src/cyclicWordCompletion.ts:186-197`（`seenAfter` 独立一张表）+ 文件头 `:21-24` 同步 | `tests/cyclic-word-completion.test.mjs:37-45`（新增 3 条 `deepEqual`） |
| 2 | 「打开的编辑器」表：正文取不到/为空就**当场摘掉登记** | `HippieWordCompletionHandler.java:271-278` 只**读** `getAllEditors()`，从不摘；摘的时机只有关标签 | `src/completionOpenEditors.ts:62-73`（跳过但保留）+ `src/lspCompletion.ts:184-189`、`src/completionOpenEditors.ts:1-14` 两处注释留痕 | `tests/completion-open-editors.test.mjs:31-46`（原断言钉的是「生产者只有补全查询、没有关标签时机」，该前提随 W2 落地已失效 ⇒ 按规约改断言并给上游理由） |

原报告里那条「4 条待接、其中一条已订正为**非死控件**」= W1：本轮再核 `CodeEditor.vue:711` 仍是 `completion: startCompletion`（点了能开弹层，不是假控件），
且 `startCompletionAs` 在 `src/completionUi.ts:52` 已就位 ⇒ 差的只是宿主那一行，订正成立。

### 1.6 本轮补判据时发现的两条**假说法**（已划掉，留给主代理核对）

- `src/completionCommands.ts` 原文件头写「`ren` 命中 `Rename`、`rn` 也命中 `Rename`」。**实测**：`camelHumpMatch('Rename Element','rn')` 与
  `camelHumpMatch('Change Signature','cs')` 都返回 `false`（`src/completionSort.ts:76` 的实现只吃「紧接上一命中或落在词边界」），
  只有大小写不敏感的前缀那条路真的命中。⇒ 注释已改（`src/completionCommands.ts:162-172`），测试里不再钉驼峰那条，差异写进 §6。
  要对齐上游 `CamelHumpMatcher(prefix, false, true)` 该换的是 `camelHumpMatcher(prefix).isStartMatch(label)`（文档词补全那条路用的就是它），
  本轮**没有顺手换**：换过滤算法会改变用户可见候选集合，需要单独一轮判据。
- `docs/wiring-requests-2026-10-06-bucket2b2.md` 的 R2 引 `ProblemsViewState.kt:20-33` 时没给目录。实际路径是
  `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt`（不是 `.../state/`）；
  本轮打开过：`:21-33` 是 `selectedTabId`/`proportion`/`autoscrollToSource`/`showPreview`/`groupByToolId`/`sortFoldersFirst`/`sortBySeverity`/`sortByName`/`hideBySeverity`，
  **确实没有**「只看某一组」那份会话态 ⇒ R2 的前提成立，且它点名的两个落点（`src/App.vue` 状态栏、`src/components/ProblemsPanel.vue:104` 的 `focus` ref、`:489-492` 的在场标记与退出按钮）本轮逐条核过是真的。

---

## 2. 改动文件清单（`wc -l` 前 → 后）

**改（7 个，全在派单可改面内）**

| 文件 | 前 | 后 | 动了什么 |
| --- | --- | --- | --- |
| `src/cyclicWordCompletion.ts` | 343 | 349 | 跨档去重表分开（`:186-197`）+ 文件头顺序说明补 `:298` 那条（`:21-24`） |
| `src/completionOpenEditors.ts` | 63 | 73 | `otherOpenEditorTexts` 改为「跳过但保留登记」（`:62-73`）+ 头部 W2 已落地的留痕（`:1-14`） |
| `src/inlineCompletionExtension.ts` | 208 | 222 | 幽灵文本挂右键 provoker（`:71-83`）、四条绑定补 `role`（`:171-176`）、三处收浮层（`:121,134,161`） |
| `src/lspCompletion.ts` | 410 | 411 | 登记处注释订正为「兜底生产者」（`:184-189`），代码未变 |
| `src/completionCommands.ts` | 235 | 242 | 只改注释：划掉打不到的驼峰说法（`:162-172`），行为未变（`git diff --numstat` = `+9 −2`） |
| `tests/cyclic-word-completion.test.mjs` | 147 | 156 | 跨档重复 + 两档各自己去重（`:37-45`） |
| `tests/completion-open-editors.test.mjs` | 87 | 94 | 原断言换形 + 幂等那条（`:31-46`），断言体没有放松（仍是 `deepEqual`） |

**新建（2 个源 + 2 个用例）**

| 文件 | 行数 | 消费方 |
| --- | --- | --- |
| `src/inlineCompletionTooltip.ts` | 181 | `src/inlineCompletionExtension.ts`（生产代码，非测试） |
| `tests/inline-completion-tooltip.test.mjs` | 90 | —— |
| `tests/completion-commands.test.mjs` | 98 | —— |

`git diff --stat`（本轮 6 个既有文件）= `70 insertions(+), 23 deletions(-)`；`git diff` 逐文件复读过后确认 hunk 全是本轮的。

---

## 3. §5 自查命令的**前后**数字

| 命令 | 本轮前 | 本轮后 | 说明 |
| --- | --- | --- | --- |
| `node --test tests/completion-*.test.mjs tests/cyclic*.test.mjs tests/intention-*.test.mjs tests/inline-completion*.test.mjs tests/moniker.test.mjs tests/local-*.test.mjs tests/suppress-intention.test.mjs tests/literal-preview.test.mjs` | tests 143 / pass 143 / fail 0 | **tests 155 / pass 155 / fail 0** | +6（浮层）+6（命令补全） |
| `node --test tests/module-size.test.mjs` | 本轮开头跑到的是 **fail 1**（`native/git.cpp 954 > 938`，他人域），本轮收尾 **tests 5 / pass 5 / fail 0** | 5 / 5 绿 | 上限未动；新模块 181 行，远低于 900 |
| 三检测器 `find-param-props` / `find-ts-in-mjs` / `find-missing-ext` | 0 / 干净 / 干净 | **0 处参数属性 / 纯 JS / 无漏扩展名** | 中途 `tests/completion-commands.test.mjs` 被 `find-ts-in-mjs` 抓到过一次（我写了 TS 标注），已改回纯 JS |
| `node .tools/find-orphan-modules.mjs --gate` | 基线登记 9 | 门禁红：**新增 2** = `src/stickyLineViewport.ts`、`src/structuralCodeBlock.ts` | **都不是本轮的模块**（折叠域 / 搜索域在途）；本轮新模块 `inlineCompletionTooltip.ts` 没进孤儿名单 ⇒ 消费方成立 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | —— | **tests 11 / pass 10 / fail 1** | 唯一红的是 `src/fileTypeDetection.ts` 的一条锚点被移动（他人域）。本轮新增的上游引用都在 `src/inlineCompletionTooltip.ts`、`src/cyclicWordCompletion.ts`、两份新用例与本报告里，路径与行号本轮逐条打开核过（锚点门对新增只报数不拦） |
| `npx vue-tsc -b --force` | 基线 3 条（全在 `src/components/SearchPanel.vue`） | **1 条**（`src/components/TestRunnerPanel.vue:238` TS7053） | 本轮 5 次类型检查里我这批文件始终 0 错；SearchPanel 3 条被搜索域修掉、TestRunnerPanel 1 条是 JUnit 域在途 ⇒ **不是本轮引入** |
| ctest | 未跑 | 未跑 | 本轮没动 `native/` |

---

## 4. 反向验证记录（三步：注入 → 红 → 撤 → 绿）

| 新判据 | 注入的违规 | 结果 | 撤掉后 |
| --- | --- | --- | --- |
| 跨档去重（`tests/cyclic-word-completion.test.mjs:37-45`） | 把 `afterUnique` 那圈的去重表换回与 `words` 共用的 `seenBefore`（= 上游 `:298` clear 之前的旧写法） | `node --test tests/cyclic-word-completion.test.mjs` ⇒ **tests 14 / pass 13 / fail 1** | 换回 `seenAfter` ⇒ 14 / 14 绿，随后全量域测试 155 / 155 |
| 打开编辑器表不摘登记（`tests/completion-open-editors.test.mjs:38-45`） | 未单独注入（改动本身是把 `openEditors.delete(path)` 删掉，红的那条断言就是「登记面不动」） | —— | 这轮的三步没跑成，**如实记为未做**（§6 第 4 条） |
| 浮层接线（`tests/inline-completion-tooltip.test.mjs` 最后一条） | 未单独注入 | —— | 同上，未做 |

> 预算说明：本轮在 ~90 次调用处收口，两次未做的注入式反向验证写在 §6，不当成已完成。

---

## 5. 零消费方自查

- 新增 `src/inlineCompletionTooltip.ts`：生产消费方 = `src/inlineCompletionExtension.ts:16`（import）与 `:75-82`（右键挂点）、`:121,134,161`（收起），
  `inlineCompletionExtension` 本身由 `src/components/CodeEditor.vue:55` 引入 ⇒ 链路到宿主，**不是只过自己测试的死模块**。
- `orphan --gate` 报的 2 个新增孤儿（`stickyLineViewport.ts` / `structuralCodeBlock.ts`）都在别人的域里，本轮未接、也不该接（可改面外）。
- 本轮没有留下只被测试引用的新导出：`inlineCompletionTooltip` 的 6 个导出里 `isInlineTooltipShown`/`hideInlineCompletionTooltip` 由扩展文件消费，
  `INLINE_TOOLTIP_GAP_PX` 被定位函数与用例双向引用，其余四个是挂点直接调用的。

---

## 6. 做不到 / 无法核实

1. **就地改接受快捷键**：上游那份浮层的核心是 `InplaceChangeInlineCompletionShortcutAction`（`InlineCompletionTooltipActions.kt:127-156`，改 `KeymapManager` 活动 keymap）。
   本仓 `src/keymap*.ts` 是静态判定表且在主代理名下 ⇒ 没有写键位的通道，就不渲染那个下拉（宁可那一格不出现）。
2. **provider 名字/图标**：`InlineCompletionItem`（LSP `textDocument/inlineCompletion`）只有 `insertText`/`filterText`/`range`，
   本仓没有任何可核实的来源名字段 ⇒ 浮层只有「Tab 以补全」一行。要补就得给 `src/bridge.ts` / `native/lsp_session.cpp` 加字段（越界）。
3. **`lp/preview` 的 Java `new Color(...)`**：本基准树里 `ElementPreviewProvider` 没有实现者（`grep` 只命中抽象类与 `ImageOrColorPreviewService.kt`），
   非 CSS 字面量的识别形状**无出处** ⇒ 不做，不编。
4. **两次未做的反向注入**（浮层接线断言、打开编辑器表登记保留断言）：见 §4，预算收口。
5. **命令补全的驼峰档**：本轮证明本仓 `camelHumpMatch` 吃不下两词首形状（§1.6）。换 `camelHumpMatcher(prefix).isStartMatch` 是对齐上游的正路，
   但它会改变候选集合，需要独立一轮判据 + 可能牵动 `tests/completion-contributors.test.mjs` ⇒ 本轮只把假注释划掉、不动算法。
6. **`editorLineStripeHint` / `suppress` 状态**：基准树里 respectively 找不到本体（`editor/` 目录只有 `InlineCompletionEditorType.kt`）
   与只有远程 prompt 供给方的两份 supplier ⇒ 无法核实用户可见语义。
7. **`CodeEditor.vue` 只读检查**（派单第 3 条要求的挂点复核）：`completionUi([mergeCompletion])` 在 `:772`，
   `completionUi.ts:325` 的 `completionUi()` 里 `:314` 展开 `hippieCompletionKeys` ⇒ **Alt+/ 与 Alt+Shift+/ 确实已挂**，不需要为循环词补全写接线请求；
   `cyclicWordCompletion.ts` 逐函数复核结论见 §1.5（只找到去重表这一处偏差，其余 `computeData:388-413`、`processWords:361-382`、`addWordsForEditor:312-350`、
   `computeVariants:283-306`、`:165-190`、`:196-223`、`:270-278`、`:72-74`、`:115-122`、`:85-89` 与实现一一对上）。
