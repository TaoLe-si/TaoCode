# 批次报告 · 桶 2 补全 / 内联补全 / 意图 / 字面量预览 · 2026-10-06 第二轮（代号 `completion2`）

派单三件事：① 收掉现网第 2 红「三格是真设置：模型 + native 键表/默认值 + 预览白名单都登记」；
② `docs/wiring-requests-2026-10-06-completion.md` 里属本域的请求做完；③ `lp/completion`、`pf/inline-completion`、`lp/intention`、`lp/preview` 四族判词先核后做。
交付：本报告 + `docs/wiring-requests-2026-10-06-completion.md` 的追加段（S-1 / S-2 / S-3）。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面每条上游坐标都是本轮亲手打开过的）。

**派单坐标的两处订正（留痕，不动别人的结论）**
- 原写「红在 `node --test tests/setkeys-batch.test.mjs`」⇒ **实际**：该文件本轮实测 **20 / 20 全绿**；逐字带那句判词的红在
  `tests/inlay-hints-settings.test.mjs:45`（tests 5 / pass 4 / **fail 1**，红因在 `:48`）。两处都是「三格登记」这一族判据，文件不同。
- 原写「`docs/wiring-requests-2026-10-06-completion.md` 的 **R1-R5**」⇒ **实际**：该文件的条目编号是 **C1–C6**（无 R 编号；R1-R5 是
  `docs/wiring-requests-2026-10-06-problems.md` 那一族的编号）。本轮按 C1–C6 逐条处置。

---

## 1. 判词表

判定含义：`[x]` 已做 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（具体理由）。

### 1.1 `lp/completion`（`docs/inventory/verdict-platform_rest.md:59`）

| 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 一句话 |
| --- | --- | --- | --- | --- |
| **命令名过滤的驼峰档**（本轮唯一的实现改动） | `[x]` 本轮落 | `platform/lang-impl/src/com/intellij/codeInsight/completion/command/CommandCompletionProvider.kt:237`（造 `CamelHumpMatcher(prefix, false, true)`）、`:252`（`if (!baseMatcher.prefixMatches(element)) continue`）；`platform/analysis-impl/src/com/intellij/codeInsight/completion/impl/CamelHumpMatcher.java:40-46`（第 2 参 = `caseSensitive`、第 3 参 = `typoTolerant`）、`:80-87`（`prefixMatches` = `myMatcher.matches(name)`）、`:130-147`（`caseSensitive=false` 时不套大小写档 ⇒ `platform/util/text-matching/src/com/intellij/psi/codeStyle/NameUtil.java:299-300` 的默认 `MatchingMode.IGNORE_CASE`） | `src/completionCommands.ts:36`（改 import）、`:194-202`（`collectCommands` 里换成 `camelHumpMatcher(pattern, { caseSensitiveMode: 'ignore-case' }).matches(label)`）、`:173-193`（文档注释含两处差异声明）；判据 `tests/completion-commands.test.mjs:92-115` | 旧实现「大小写不敏感前缀 \|\| `completionSort.ts` 的保守驼峰」漏掉**两个词首**那一档：现在 `cs`→`Change Signature`、`sw`→`Surround With`、`line`→`Toggle Line Comment` 都进表，`zz` 仍不进表 |
| └ 订正上一轮留的话：「该换成 `isStartMatch(label)`」 | 订正 | `CamelHumpMatcher.java:53-77`（`isStartMatch` 是「命中段贴不贴串首」的另一档查询，`CommandCompletionProvider.kt` 里**没有**用它过滤命令） | `docs/wiring-requests-2026-10-06-completion.md` 追加段 S-3 第 3 条 | 原写 `isStartMatch`、实际过滤判据是 `prefixMatches` ⇒ 本轮按 `matches` 落，并把这句划掉 |
| └ `typoTolerant=true` 那一档 | `[-]`／本仓声明不做 | `CamelHumpMatcher.java:143-145`（`builder.typoTolerant()`）⇒ 本体 `platform/util/text-matching/src/com/intellij/psi/codeStyle/TypoTolerantMatcher.kt` | `src/completionCamelHump.ts:39-41`（既有声明：键盘布局纠错不移植） | 代价是 `rn` / `rne` 这种「一个词里跳一个字母」不进表；本轮把它**钉成判据**而不是当缺陷藏着（`tests/completion-commands.test.mjs:108-115`） |
| 判词原文「缺：`completion/command/**` 的命令补全（本仓没有 contributor 把本地动作做成补全条目）」 | `[x]`（**判词陈旧**） | `CommandCompletionProvider.kt:308-326`（名字整形）、`CommandCompletionSuffixProvider.kt:23,28,30-36`（`.` / `..` / `supportFiltersWithDoublePrefix`） | `src/completionCommands.ts:194,232`；注册在 `src/lspCompletion.ts:103`；`..` 独占档在 `src/lspCompletion.ts:257-301` | 贡献者、条目形状、`..` 只留命令都在，且有判据 ⇒ 请主代理把这一句从「缺」划掉 |
| 判词原文「缺：`CamelHumpMatcher`（词补全只做前缀匹配）」 | `[x]`（**判词陈旧**） | 同上 `CamelHumpMatcher.java:80-87,149-154`（`applyMiddleMatching` 的前导星号档） | `src/completionCamelHump.ts`（615 行）、消费方 `src/lspCompletion.ts:6,379`、`src/cyclicWordCompletion.ts:47`、本轮起 `src/completionCommands.ts:36` | 匹配器早已移植，且有三处生产消费方 |
| 判词原文「缺：跨文件词补全（只搜当前文档）」 | `[x]`（**判词陈旧**） | `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/HippieWordCompletionHandler.java:271-278`（读全部打开的编辑器；本轮 `find` 实测目录是 `actions/`，不是 `action/`） | `src/completionOpenEditors.ts`（宿主登记 + 跳过但保留），上一轮 §1.5 已核 | 早于本轮做完，判词那句可销 |
| 智能 / 类名补全的**菜单行** | `[ ]`（他人面） | `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:115-147`（上一轮坐标，本轮未重开） | `src/components/CodeEditor.vue:711` 仍是 `completion: startCompletion`、`src/menus/codeMenu.ts:33` 仍只一条（**本轮重测行号，仍然成立**） | = 请求 C1，追加段 S-2 复核为「原样有效」 |
| Commands 分组标题 | `[-]` | `CommandCompletionContributor.kt:41-43` + `platform/lang-api/resources/messages/CodeInsightBundle.properties:585`（上一轮坐标） | `src/completionCommands.ts:45` 常量在、不渲染 | 本仓弹层是平铺列表（`src/completionUi.ts`），没有分组行的位置 ⇒ 不放假控件 |

### 1.2 `pf/inline-completion`（`docs/inventory/verdict-platform_rest.md:72`）

| 项 | 判定 | 上游依据 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 浮层里的接受键文本 | `[x]` 核实通过 | `platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/tooltip/InlineCompletionTooltipActions.kt:34-47`（浮层那几行文本来自**真实键位表**） | `src/inlineCompletionTooltip.ts:63-71`（`role === 'accept'` 过滤）+ `src/inlineCompletionExtension.ts:172-177`（绑定表逐条带 `role`） | 文本不是写死的 `Tab`，是从那份真绑定里取的 ⇒ 键位改了文案跟着改，没有假文本 |
| 按 provider 开关 / `options` 设置页 | `[ ]`（宿主面，本轮复核仍在） | `.../inline/completion/options/`（本轮 `ls` 实测目录在） | `src/settingsModel.ts` 里 `inlineCompletion` **0 命中**、`src/components/SettingsDialog.vue` 里「行内补全 / inlineCompletion」**0 命中**（本轮 grep） | = 请求 C3；模块侧本轮**不落**「按设置放行的谓词」：消费方 `CodeEditor.vue` 是保留文件，落了就是只过自己测试的死代码 |
| 多 provider 聚合 / `suppress` / `logs` / `statistics` | `[-]` | `.../inline/completion/` 本轮 `ls`：`RemDevAggregatorInlineCompletionProvider.kt` 与 `suppress/`、`logs/`、`statistics/` 目录确在 | —— | 本仓单供给（LSP `textDocument/inlineCompletion`），没有第二个 provider 可聚合；抑制态两份 supplier 按远程 prompt 供给方写，语义无对应物（上一轮取证，本轮目录复核一致） |
| 就地改接受快捷键 / provider 名字与图标 | `[-]` / `[ ]` | `InlineCompletionTooltipActions.kt:127-156`、`InlineCompletionTooltipFactory.kt:16-40`（上一轮坐标） | `src/inlineCompletionTooltip.ts:156`（没有 rows 就不弹） | `src/keymap*.ts` 与 `src/bridge.ts` 都在保留面 ⇒ 没有后端就不渲染那一格（宁可整行不出现） |

### 1.3 `lp/intention`（`docs/inventory/verdict-platform_rest.md:121`）

| 项 | 判定 | 上游依据 | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 抑制 / 本地意图条目**按意图开关过滤** | `[x]` 核实通过 | `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19,29,44`（抽象基类：意图条目本身带 text/apply，启停在 `IntentionManagerSettings` 那一侧） | `src/semanticActions.ts:419`（`suppressionActionsFor({ ..., enabled: isIntentionEnabled })`）、`src/intentionSettings.ts:69-71`、`src/localIntentions.ts:78` | 停用的抑制形态不会从 Alt+Enter 冒出来，链路本轮逐行打开核过，不缺 |
| 判词原文「缺：意图预览」 | `[x]`（**判词陈旧**，上一轮已订正） | `platform/analysis-api/src/com/intellij/codeInsight/intention/preview/IntentionPreviewUtils.java` 与同目录 `IntentionPreviewInfo.java`（本轮 `find` 实测）—— **留痕**：上一轮报告写的是 `platform/lang-impl/src/com/intellij/codeInsight/intention/preview/`，那条目录在本基准树里不存在，实际落在 `analysis-api` 下 | `src/intentionPreview.ts` | 按 LSP 编辑载荷算 before/after，不跑 PSI；顺带把上一轮那条假路径改正 |
| 「取消抑制 / Remove 'noinspection'」那一族 | `[-]`／**无法核实** | 本轮全树取证：`grep -rl "SuppressionFixFactory" platform` ⇒ **0 命中**；`grep -rn "noinspection\|remove.suppress\|suppress.for.statement"` 在 `platform/lang-impl/resources/messages/` 与 analysis-* ⇒ **0 命中**。基准树里只有抽象基类 `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java` | —— | 具体的抑制意图本体（含「移除抑制」文案）不在这份社区树里 ⇒ 按规约不能编中文/英文文案，不做 |
| 问题面板逐行抑制入口 | `[ ]`（他人名下） | `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ShowProblemsViewQuickFixesAction.kt:33-35,78-92`（上一轮坐标） | `src/localIntentions.ts` 条目侧 API 就位 | = 请求 C4，`src/components/ProblemsPanel.vue` 不在本轮可改面 |

### 1.4 `lp/preview`（`docs/inventory/verdict-platform_rest.md:361`）

| 项 | 判定 | 上游依据（本轮重开逐条对行号） | 本仓落点 | 一句话 |
| --- | --- | --- | --- | --- |
| 判词里那三段行号 | 核实**成立** | `platform/lang-impl/src/com/intellij/codeInsight/preview/ImageOrColorPreviewService.kt:145-163`（`mouseMoved`：`elements == null && isShiftDown` ⇒ 取 offset 发 `ShowPreviewRequest`）、`:165-204`（交给 `ElementPreviewProvider` 显示）、`:206-231`（`HidePreviewRequest`：移到别的元素就收） | `src/literalPreview.ts` + `src/literalPreviewExtension.ts` | 判词写的 `:145-158 / :176-203 / :206-232` 与实测同段，不必改 |
| 判词没点名的另两条 | `[~]`／本仓差异 | 同文件 `:131-143`（**已显示时再按 Shift** ⇒ 以 `keyTriggered=true` 重发一次）、`:252-273`（`getPsiElementsAt` 只在 `documentManager.isCommitted` 时取 PSI）、`:241-250`（`isSupportedFile` 逐 provider 问） | `src/literalPreviewExtension.ts`（只有 Shift+悬停那一路，没有「按 Shift 二次触发」档） | `keyTriggered` 的差别只作用在 provider 自己的实现里（树里没有实现者 ⇒ 无法核实它到底多显示什么）⇒ 不编 |
| `ElementPreviewProvider` 扩展点 | `[-]` | `platform/lang-api/src/com/intellij/codeInsight/preview/ElementPreviewProvider.java:24-31`（接口 + `EP_NAME`）；`platform/lang-api/resources/intellij.platform.lang.xml:175`（**只有 EP 声明，没有 implementation 注册**）；全树 `grep -rln ElementPreviewProvider platform` 只命中这 3 个文件 | —— | 社区树里没有 provider 实现者 ⇒ 非 CSS 字面量（`new Color(...)` 等）的命中形状**无出处**，不做 |
| 本仓已有的 CSS 十六进制 / `rgb()` / 图片路径档 | `[x]` | `ImageOrColorPreviewService.kt:145-204` 的取位与显示时序（本仓等价物按词法命中） | `src/literalPreview.ts:88-127`、`src/literalPreviewExtension.ts`；判据 `tests/literal-preview.test.mjs` | 本轮未改（判据在跑，域测试 152 条含它） |

---

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 动了什么 |
| --- | --- | --- | --- |
| `src/completionCommands.ts` | 242（工作树本轮开始时的实测；HEAD 是 235，那 +7 是上一轮未提交的注释订正） | **250** | import 换成 `completionCamelHump.ts`（`:36`）、`collectCommands` 的过滤换成上游同档匹配器（`:194-202`）、文档注释重写并划掉 `isStartMatch` 那句（`:173-193`）、文件头上游坐标补 `:252` 与 `CamelHumpMatcher.java` 全路径（`:11-14`）。`git diff --numstat`（HEAD→现在）= **+25 −10**（含上一轮那条注释订正） |
| `tests/completion-commands.test.mjs` | 98（未跟踪，上一轮新建） | **125** | 新增 2 个 test：`:92-106`（两词首 / 大小写 / 中间匹配 / 不命中四档）、`:108-115`（typoTolerant 那档不移植 ⇒ `rne` 不进表）；原第 5 个 test 里那段「驼峰档没验通」的说明改为「前缀命中」（`:79-87`），**断言体一字未动**（`deepEqual` 仍在，没降级成 `includes`） |
| `docs/wiring-requests-2026-10-06-completion.md` | 118 | **178** | 追加「第二轮」段：S-1（现网红的唯一改动点 + 可照抄整段）、S-2（C1/C3 复核）、S-3（C6 三条现状 + 驼峰那条已做并订正） |
| `docs/batch-2026-10-06-completion2.md` | —— | 本文件 | 新建（本轮交付报告） |

**没有新建源文件、没有删文件、没有动 `native/`、没有动任何保留文件**（`src/App.vue`、`src/CodeEditor.vue`、`src/settingsModel.ts`、`src/previewSettings.ts`、`native/settings_schema.*`、`src/keymap*.ts`、`src/bridge*.ts`、`src/problems*`、`src/editorFolding*`、`src/search*` 一律只读，本轮只做 `grep` / `git show` 取证）。

---

## 3. §5 每条自查命令的**前后**数字

| 命令 | 本轮前 | 本轮后 | 说明 |
| --- | --- | --- | --- |
| `node --test tests/completion-*.test.mjs tests/cyclic*.test.mjs tests/intention-*.test.mjs tests/inline-completion*.test.mjs tests/literal-preview.test.mjs tests/local-intentions.test.mjs tests/suppress-intention.test.mjs tests/moniker.test.mjs` | tests **150** / pass 150 / fail 0 | tests **152** / pass 152 / **fail 0** | +2（本轮新判据两条），其余 150 条一条没红 ⇒ 换过滤算法没有打破 `completion-contributors` / `lsp-completion` 那两条既有判据 |
| `node --test tests/setkeys-batch.test.mjs` | 20 / 20 / 0 | **20 / 20 / 0** | 派单点名的这条**本来就是绿的**（订正见开头） |
| `node --test tests/inlay-hints-settings.test.mjs tests/setkeys-batch.test.mjs` | tests 25 / pass 24 / **fail 1** | tests 25 / pass 24 / **fail 1** | 那条红本轮**没被收掉**：改动点是 `tests/inlay-hints-settings.test.mjs:48`（不在派单可改面）与被钉的 `src/settingsModel.ts:223`（保留）⇒ 落请求 S-1 |
| `npx vue-tsc -b --force` | **0 错**（`.tmp-completion2-tsc-base.txt`，本轮开工前实测） | **1 错**（`.tmp-completion2-tsc-final2.txt`，`src/enterHandlers.ts`，回车家族那一域）；中途一次复跑是 **5 错**（`src/App.vue` / `src/bookmarkActions.ts` / `src/toolWindowStripes.ts`），那 5 条在他人随后的改动里自己消掉了 | 三次跑本域文件都是 **0 错**（completion / inlineCompletion / intention / moniker / literalPreview / cyclic）；红都在别人名下、且都发生在本轮两次检查**之间** |
| `node --test tests/module-size.test.mjs` | tests 5 / pass 5 / fail 0 | **5 / 5 / 0** | 上限一个没动；`src/completionCommands.ts` 250 行，远低于 ts 900 |
| `node .tools/find-param-props.mjs` | 1 处（`src/testTree.ts:103`，非本域） | **0 处**（`src/testTree.ts` 那条在本轮期间由该域自己改掉） | 本轮没有新增参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（`tests/*.mjs` 全纯 JS） | 新增的两条 test 只用 JS 语法 |
| `node .tools/find-missing-ext.mjs` | 干净（1273 个文件） | **干净** | 新 import `./completionCamelHump.ts` 写了扩展名 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 / **新增 1**（`src/structuralCodeBlock.ts`，搜索域） | **已登记 9 / 新增 0 ⇒ 门禁绿**（`structuralCodeBlock.ts` 在本轮期间被搜索域自己接上） | 本轮没新建模块 ⇒ 本域始终 0 条 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | tests 11 / pass 11 / fail 0 | **tests 11 / pass 9 / fail 2**（两条红 = 同一个检查被两个文件各跑一遍）| 本轮**自己**在报告里凭记忆把那条上游文件的包名写成了 `codeInsight`（正确是 `codeInspection`）⇒ 门当场抓到红 ⇒ 用 `find` 实测真路径后改正。转述这条假写法时**不再写完整形状**（派单 §5 明令：写了行号就会被当直引收集）。改正后本域文档对门禁的贡献是 0 条红；现网剩下的红在别人名下的文档（同样把这条假路径整形状带行号转述了一遍）⇒ 见请求 S-4，本面不越界代改 |
| `npm run test:native`（ctest） | 未跑 | **未跑** | 本轮没动 `native/`，按规约不跑别人的在途构建 |

---

## 4. 反向验证记录（注入 → 红 → 撤 → 复绿，三条都跑了）

| # | 新判据 | 注入的违规 | 红 | 撤掉后 |
| --- | --- | --- | --- | --- |
| 1 | `tests/completion-commands.test.mjs:92-106`「驼峰两档真的进表」 | 把 `src/completionCommands.ts:202` 的 `matcher.matches(label)` 临时换成**只按大小写不敏感前缀**（`= 本轮之前的旧形状`） | `node --test tests/completion-commands.test.mjs` ⇒ tests **8 / pass 7 / fail 1**（红的就是这一条） | 换回 `matcher.matches(label)` ⇒ **8 / 8 绿**，随后域测试 **152 / 152** 绿 |
| 2 | 同一批判据里的「空前缀不过滤 / 全不命中就是空表」（`:84-87`，既有断言） | 未注入：这条不是本轮新增，且 #1 的注入体（前缀档）本身就没把它打红 ⇒ 如实记「未做反向注入」 | —— | —— |
| 3 | S-1 请求那条（本轮**没有**代码改动） | 请求里已写好由改动者跑的三步：把 `native/settings_schema.hpp:87` 的 `"showOtherInlayHints"` 删掉 ⇒ 应红 1 条；补回 ⇒ 复绿。本轮另用临时脚本按建议的 12 条逐键断言取现树 ⇒ **12 / 12 命中**（脚本用完即删，不在仓里留件） | —— | —— |

另外做了两项「非注入」的反证核对：
- **既有门禁的自证（本轮亲身踩到）**：报告 §1.3 起初按记忆把那条上游文件的包名写成 `codeInsight`，
  `node --test tests/source-citations.test.mjs` 当场把它报成「参考树里没有这个文件」（红）⇒ 用 `find` 实测真路径是 `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java`（`:19,29,44` 三条行号本身对）⇒ 改正后**本域文档 0 条红**。这一条按规约记成「门禁反向验证」而不是「不适用」。
- **旧形状 vs 新形状的实际差集**：`collectCommands` 的过滤换成上游同档后，12 个动作名 × 37 个前缀逐格比对新旧 ⇒ 新增命中 14 格（`cs`/`CS`/`Cs`/`sw`/`lc`/`gn`/`gN`/`line`/`me`/`od` 这类两个词首或中间匹配的形状），丢失 2 格且都落在 `_privateName` 这种**不在真实动作表里**的名字上（`rn` / `in`）。
- 旧注释里「`rn` 也命中 `Rename`」那句：本轮实测 `rn` → `Rename Element` 与 `rne` → 空 ⇒ 该说法**错**（上游放行它靠的是 `typoTolerant`，本仓不移植），已从注释与请求里订正，并钉成判据。

---

## 5. 零消费方自查

- 本轮**没有新建模块** ⇒ `find-orphan-modules.mjs --gate` 的本域新增 = **0**（现网那 1 条新增是搜索域的 `src/structuralCodeBlock.ts`）。
- 本轮改的这条链是生产链，不是「只过自己测试」：`src/completionCommands.ts:232 commandCompletionContributor` → 注册在 `src/lspCompletion.ts:103`（贡献者列表）→ 补全弹层消费；
  新引入的 `camelHumpMatcher`（`src/completionCamelHump.ts:561`）在本仓有 **3 处生产消费方**：`src/lspCompletion.ts:6,379`、`src/cyclicWordCompletion.ts:47`、本轮起 `src/completionCommands.ts:36`。
- `completionCommands.ts` 里被换掉的 `camelHumpMatch`（`src/completionSort.ts:76`）没有因此变成死出口：`src/completionContributors.ts:14,87`（文档词补全那一档）仍在用它 ⇒ 未删未挪。

---

## 6. 做不到 / 无法核实

1. **派单 ①「收掉现网第 2 红」本轮没收掉**：红因唯一落点是 `tests/inlay-hints-settings.test.mjs:48` 那条**钉形**断言（要求三把键是 `defaultEditorSettings` 的最后三项），
   被钉的数据在保留文件 `src/settingsModel.ts:223`。两处都不在本轮可改面（可改面只给了 completion / intention / cyclic / inline-completion / literal-preview 那几族用例）。
   ⇒ 已落请求 S-1（含可照抄整段、现树 12/12 取证、落地后的三步反向验证）。本轮在本面**能改的对齐项 = 0**：那三把键与补全/意图/预览域都没有交集（本域代码 0 处引用它们）。
2. **`typoTolerant` 那一档**：上游命令补用的 `CamelHumpMatcher(prefix, false, true)` 第三参在 `CamelHumpMatcher.java:143-145` 走 `TypoTolerantMatcher`；
   `src/completionCamelHump.ts:39-41` 明确不移植键盘布局纠错 ⇒ `rn` / `rne` 这类形状不吃。本轮把它写成判据而不是假装对上。
3. **`prefixMatches` 里 `_` 开头 + FIRST_LETTER 那条否决**（`CamelHumpMatcher.java:80-84`）依赖 `CodeInsightSettings.COMPLETION_CASE_SENSITIVE` 的全局档；
   本仓没有这条设置（且它在保留面），⇒ 不模拟，差异写在 `src/completionCommands.ts:188-192`。
4. **`keyTriggered` 那一档（`ImageOrColorPreviewService.kt:131-143`）**：已显示时再按 Shift 会以 `keyTriggered=true` 重发；它到底多显示什么由 provider 决定，
   而 provider 实现者不在社区树里（`intellij.platform.lang.xml:175` 只有 EP 声明）⇒ **无法核实**，不编。
5. **「取消抑制 / Remove 'noinspection'」**：本轮三条路各搜过（`SuppressionFixFactory` 全树 0 命中、`noinspection` / `remove.suppress` / `suppress.for.statement` 在 messages 与 analysis-* 0 命中、
   只剩抽象基类 `SuppressIntentionAction.java`）⇒ 文案与形状无出处，不做。
6. **请求 C1 / C3 的宿主那一行**：`src/components/CodeEditor.vue:711`、`src/menus/codeMenu.ts:33`、`src/settingsModel.ts`（`inlineCompletion` 0 命中）、`src/components/SettingsDialog.vue`（0 命中）
   全部重测过、仍在别人名下 ⇒ 见 S-2。
7. **`npx vue-tsc -b --force` 本轮收尾时是 1 条红**（`src/enterHandlers.ts`，回车家族那一域；开工前基线 0 错、中途一次 5 错已被他域自己收掉）⇒ 全都不是本域文件，本面无法修也不该修。
   另：本轮收尾期间观察到 `tests/problems-panel.test.mjs` 一度因 `src/problems.ts` 的语法错整文件加载失败，随后该测试路径已不存在 ⇒ 判为 `problems` 域的在途过程态，只留痕不代改（见请求 S-4 第 2 条）。
8. **按规约没跑全量 `npm test`**（12 路并行，全量会把别人的在途红算到本头上来），只跑了本域 glob + 三条门禁测试。

---

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-completion.md` 的追加段：
**S-1**（现网那条红的唯一改动点，1 行判据换形，含可照抄整段 + 现树 12/12 取证）、
**S-2**（C1 / C3 复核：行号重测、原样有效）、
**S-3**（C6 三条现状：orphan 归零、参数属性归零、命令名驼峰档本轮已做并订正旧说法）、
**S-4**（引用门现网红全在别人名下的文档：同那条上游文件的包名被写成 `codeInsight`（正确 `codeInspection`）的**整形状 + 行号**转述，被门当直引收集 ⇒ 给了两种改法）。
