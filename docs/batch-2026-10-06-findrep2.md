# batch-2026-10-06-findrep2 — 工程内查找/替换 剩余档（窄 lane）

上游参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用；仓内 `third_party/intellij-community` 为坏树，不用）。

## 0. 计划（骨架，逐块追加）

- [x] A. 磁盘现状复核（本仓 find/replace 相关文件 + 判词来源）
- [x] B. 上游证据（自己开坐标，假坐标写"订正留痕"）
- [x] C. 三档表：①已闭环被误判 ②缺且可做 ③不等价 + 还原方案
- [x] D. 实现 1–2 项（用户可见、不动保留文件）→ D-A 编辑器保留大小写默认档、D-B 替换全部确认句四样信息
- [x] E. 反向验证 `FINDREP2-PROBE`（破坏→红→还原→绿→grep 0 残留）
- [x] F. 门控/上限复核 + 收尾

## 1. A. 磁盘现状复核

本仓 find/replace 相关文件的实测（`split('\n').length` 口径）：

| 文件 | 行数 | 实测状态 |
| --- | --- | --- |
| `src/components/SearchPanel.vue` | 898 | 工程内查找/替换面板：`replaceAllOnDisk`(:427)、`replaceSelected`(:412)、`replaceFile`(:416)、`replaceOne`(:417)、逐处 `skipOne`(:418)；开关只有 `caseSensitive`/`regex`/`wholeWord`/`structural`(:69-71,641-646)——**没有「保留大小写」**（:641-643 三个 `fs-toggle` 就是全部）。 |
| `src/findReplaceHistory.ts` | 64 | 在，且**有消费链路**（`src/components/EditorFindBar.vue:28,67,70,85`）；本地键 `taocode.findReplaceHistory`、上限 20、最新在最前。 |
| `src/findInProjectRecents.ts` | 76 | 在：300 上限(:16)、精确去重先删后追(:34-43)、最新在末尾、`mostRecent` 取末条(:46)、加载时按首次出现去重(:54-70)。 |
| `src/preserveCase.ts` | 120+ | 在：`replaceWithCaseRespect`(:24) 与 `applyCase`(:123) 两个算法都移植了。 |
| `src/searchReplaceOutcome.ts` | 35 | 在：`incompleteNote()`，被 `SearchPanel.vue:13,403,457` 消费。 |
| `src/regexReplacement.ts` | 237 | 在。 |
| `src/editorFindController.ts` | — | `state.preserveCase`(:70,113,143,198) + 替换取值 `:229` **只调 `replaceWithCaseRespect`**。 |

**证伪项**：`src/findInFiles*.ts` 确实不存在（本轮 `ls src | grep -i find` 复核，只有 `findInProjectRecents.ts`）——不去找它。

**判决簿里"已实现"的两条经磁盘复核为真**（`docs/inventory/verdict-find-diff.md:761,818`）：`src/preserveCase.ts` 与 `tests/preserve-case.test.mjs` 都在盘上、编辑器栏的「保留大小写」开关也在 `EditorFindBar.vue:212`。但两条判词的**上游路径行号**与**默认档**有错，见 B。

## 2. B. 上游证据（全部本轮自己开树核对；参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）

先记一次自我订正：本轮第一条 `find -iname "*PreserveCase*"` 只回了 test 与 svg，**没回** `PreserveCaseUtil.java` / `TogglePreserveCaseAction.java`；随后 `find -name "PreserveCaseUtil.*"` 与 `find -iname "TogglePreserve*"` 两条分别回 `platform/lang-impl/src/com/intellij/find/impl/PreserveCaseUtil.java`、`platform/lang-impl/src/com/intellij/find/editorHeaderActions/TogglePreserveCaseAction.java`。⇒ 第一条是**工具输出不完整**，不是假类名；判决簿那两个路径为真，不改判。

| # | 上游坐标（自己数的） | 实测内容 |
| --- | --- | --- |
| U1 | `platform/analysis-impl/resources/messages/FindBundle.properties:85` | `find.options.replace.preserve.case=Pr&eserve case` —— 「保留大小写」这一档确实存在，**只有英文原话**。 |
| U2 | `platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java:787-791` | 工程内查找对话框把 preserve-case 开关挂在**替换输入框**的 extra actions 上：`new MySwitchStateToggleAction("find.options.replace.preserve.case", ToggleOptionName.PreserveCase, AllIcons.Actions.PreserveCase…)` → `myReplaceTextArea.setExtraActions(...)`。`:1213` 从模型读回、`:1590` 写回模型；`:1777` `ToggleOptionName {CaseSensitive, PreserveCase, WholeWords, Regex, FileFilter}`。⇒ **工程内替换也有 preserve case**，本仓 `SearchPanel.vue` 没有。 |
| U3 | `platform/lang-impl/src/com/intellij/find/impl/FindManagerBase.java:288-296` | 替换文本的取值：`getStringToReplace()` 先按正则展开，再 `if (model.isPreserveCase()) replacement = Registry.is("ide.find.word.based.preserve.case") ? PreserveCaseUtil.applyCase(foundString, replacement) : PreserveCaseUtil.replaceWithCaseRespect(replacement, foundString);`。 |
| U4 | `platform/util/resources/misc/registry.properties:1414-1415` | `ide.find.word.based.preserve.case=true`、描述 `New word-based preserve case implementation`。⇒ **上游默认档 = 逐词的 `applyCase`**。 |
| U5 | `platform/lang-impl/src/com/intellij/find/replaceInProject/ReplaceInProjectManager.java:258,262,266` | 替换全部前的确认：`find.replace.all.confirmation` 带 `usagesCount` 与两个串，标题 `find.replace.all.confirmation.title`（`FindBundle.properties:108-109` 原文 `Replace {0} occurrences of ''{1}''<br>across {2} files with ''{3}''?`）。 |
| U6 | 同文件 `:407-412` | 结果播报 `reportNumberReplacedOccurrences()`：**`occurrences != 0` 才**往状态栏写 `FindBundle.message("0.occurrences.replaced", occurrences)`；`FindBundle.properties:115` = `{0,choice,0#No|1#{0}} … replaced`。⇒ 上游播「处数」，**不播文件数**，且 0 处时**沉默**。 |
| U7 | `platform/analysis-impl/src/com/intellij/find/impl/FindInProjectSettingsBase.java:22,39,41,69-74,81,94-103` | 三张最近表、`MAX_RECENT_SIZE = 300`（**:22**）、加载 `LinkedHashSet` 去重（`:39,41`）、`addStringToFind`/`addStringToReplace`（`:69-74`）、`getMostRecentFindString`（**:81**）、`addRecentStringToList`（**:94**，`:99 list.remove(str)`、`:102 list.remove(0)`）。 |
| U8 | `platform/lang-impl/src/com/intellij/find/SearchTextArea.java:395-409` | 编辑器栏的历史动作 `ShowHistoryAction`：标题按模式取 `find.search.history` / `find.replace.history`（`:397-398`），读的是 `findInProjectSettings.getRecentFindStrings()` / `getRecentReplaceStrings()`（`:408-409`）⇒ **编辑器栏与工程内共用同一张 300 上限表**。 |

### 订正留痕（本仓既有账本里的假/漂坐标）

1. `src/preserveCase.ts:6-7` 写「上游默认走前者：注册表项 `ide.find.word.based.preserve.case` 默认**关**」——**与磁盘相反**（U4：`=true`，默认开，默认算法是逐词 `applyCase`）。这条过头话本轮原地收回，并按 U3/U4 改正实现档（见 D）。
2. `src/findInProjectRecents.ts:5-7` 写 `MAX_RECENT_SIZE`（`:27`）、`addRecentStringToList`（`:85-93`）、`getMostRecentFindString`（`:77-79`）——实测为 `:22`、`:94`、`:81`（U7）。行号漂移，行为描述成立。
3. `src/components/EditorFindBar.vue:13` 写「开关取随 IDE 发货的中文包 `find.options.replace.preserve.case`「保留大小写」」——参考树里**没有** FindBundle 的 zh 包（`find -name "*zh*" -path "*messages*"` 只回 `AgreementsBundle_zh_CN.properties`、`UpdaterBundle_zh_CN.properties`）⇒ 中文措辞**无法核实**，见登记。
4. `docs/inventory/verdict-find-diff.md:761` 把 `TogglePreserveCaseAction.java` 判成 `[x]`「本轮已实现：查找栏替换行有…」——路径为真（`editorHeaderActions/TogglePreserveCaseAction.java:12-27` 自己核对过），但它管的是**编辑器**查找栏；工程内那一半（U2）不在该判词范围内，磁盘也确实缺。`docs/inventory/*` 是脚本生成物，本轮不改。

## 3. C. 三档表（判词 / 磁盘 / 上游 三方对齐）

档一 = 已闭环（被误判成缺，或候选词其实早做了）；档二 = 缺且可做（含"缺但需保留文件配合"）；档三 = 不等价 + 还原方案。

| 候选 | 判词/候选词说的 | 磁盘实测 | 上游实测 | 档 | 处置 |
| --- | --- | --- | --- | --- | --- |
| 大小写敏感（工程内） | 任务描述称可能缺 | `SearchPanel.vue:70,641` `caseSensitive` + `fs-toggle`，落到 `native/main.cpp:1305 options.case_sensitive` | 同名档（`FindPopupPanel.java:1777` 的 `CaseSensitive`） | **档一** | 不动 |
| 保留大小写（编辑器栏）的**形态** | `verdict-find-diff.md:761,818` 判 `[x]` | 开关 `EditorFindBar.vue:212`、持久化 `editorFindController.ts:143,198`、算法 `src/preserveCase.ts`、判据 `tests/preserve-case.test.mjs` 全在 | U1/U3 | **档一**（判词为真，路径为真） | 不动 |
| 保留大小写（编辑器栏）的**默认算法** | 仓内注释：「上游默认走前者（`replaceWithCaseRespect`），注册表项默认**关**」（`src/preserveCase.ts:5-6`） | `editorFindController.ts:229` 两档模式都调 `replaceWithCaseRespect(text, found)` | **相反**：`registry.properties:1414` = `ide.find.word.based.preserve.case=true`，U3 默认取 `applyCase(foundString, replacement)`（逐词） | **档三** | **本轮实现 D-A**：控制器改走上游默认档，仓内那句过头话原地订正 |
| 保留大小写（**工程内**替换） | 候选①暗示缺 | `SearchPanel.vue:641-643` 只有 Aa/.*./词，无 preserve；原生替换文本由 `native/search.cpp` 的 `build_replacement` 生成 | U2：`FindPopupPanel.java:787-791` 工程内查找对话框的**替换框**就挂这一档 | **档二（缺，但本 lane 做不了）** | 入参解析在保留文件 `native/main.cpp`（`options.*` 的 JSON→Options 那一处），`SearchOptions` 在保留文件 `src/bridge.ts:192`。⇒ 不放假控件（规则⑧），写 `docs/wiring-requests-2026-10-06-findrep2.md` |
| 正则模式的上限/降级提示 | 候选②「没有可播报的提示时不许假装有」 | 有真上限且真播报：`native/search.cpp:35-37`（8 MB / `max_matches=5000` / 100k 文件）→ `truncated` 回参 → `SearchPanel.vue:704`「结果已截断」+ `src/searchReplaceOutcome.ts` 的截断句 | `FindBundle.properties` 全 175 键里**没有**任何 limit / truncat / too many 档（本轮 grep 计数）；上游走索引，没有本仓这类硬截断 | **档一 + 不加** | 播报已在（不是假装有）；**不**新增"上游没有的正则专用上限文案"，`searchReplaceOutcome.ts` 文件头已声明这三句是本仓形态等价物、不冒充上游原话 |
| 替换全部的结果播报（处数/文件数） | 候选③问是否同档 | `SearchPanel.vue:404,458` `已替换 N 处，涉及 M 个文件。` + 0 处走 `:400`「没有匹配被替换…」+ 不完整走 `incompleteNote` | U6：`ReplaceInProjectManager.java:407-412` 只在 `occurrences != 0` 时往**状态栏**写 `0.occurrences.replaced`（`FindBundle.properties:115`），**不播文件数** | **档一**（同档或更严：本仓 0 处也说、还多报文件数，"不完整不许报成功"另有判据） | 不动 |
| 替换全部前的**确认句** | 候选③的另一半 | `SearchPanel.vue:446`「将替换工作区内全部匹配（含未列出的部分）」——**无处数、无文件数、无两个串**；`:437` 作用域分支反而带处数 | U5：`find.replace.all.confirmation` = `Replace {0} occurrences of ''{1}'' across {2} files with ''{3}''?`，调用点 `ReplaceInProjectManager.java:258,262` | **档三** | **本轮实现 D-B**：确认句补上「处数 + 被查串 + 文件数 + 替换串」，纯函数落 `src/searchReplaceOutcome.ts`（没搜过时不许把 0 当结论） |
| 历史条目数与去重（工程内） | 候选④ | `src/findInProjectRecents.ts:16,34-43,46,54-70` | U7：`MAX_RECENT_SIZE=300`(`:22`)、`:99 remove`/`:102 remove(0)`、`getMostRecentFindString`(`:81`)、加载 `LinkedHashSet`(`:39,41`) | **档一**（行为逐条一致） | 只留坐标订正（B.2） |
| 历史条目数与去重（**编辑器栏**） | 候选④ | 另两张本地小表：`taocode.findHistory`（`editorFindController.ts`，上限 20）与 `taocode.findReplaceHistory`（`src/findReplaceHistory.ts:23` 上限 20、最新在**最前**） | U8：`SearchTextArea.java:395-409` 编辑器栏历史动作读的就是工程内那张 `getRecentFindStrings()`/`getRecentReplaceStrings()`（300、最新在**末尾**）——**同一张表**，不与查找历史混 | **档三** | 还原方案（本轮不做，见下） |

**④ 不做本件的边界（写清楚，不是搪塞）**：上游那两处是**共用一张 300 表**，本件要把 `EditorFindBar.vue` 的下拉与 `editorFindController.ts` 的 `taocode.findHistory` 一并换成 `src/findInProjectRecents.ts` 那张表，并**迁移**用户盘上已有的两个旧键（规则⑥：缺键补默认、旧数据不能被判损坏），同时同批改 `tests/find-replace-history.test.mjs`、`tests/search-history.test.mjs`、`tests/editor-find.test.mjs` 里钉住"20 条 / 最新在最前"的断言。改后 `src/findReplaceHistory.ts` 失去消费链路 ⇒ 按规则⑧要**删文件**而不是留着。这条规模是"跨 4 个文件 + 3 张测试 + 一次持久化迁移"，与本轮"1–2 项用户可见"的上限不符，登记为下一件；本轮只把差异与还原步骤写死在这里。

## 4. D. 实现（本轮做的 2 件，都不动保留文件）

### D-A 编辑器替换的「保留大小写」改回上游默认档（档三 → 已还原）

上游 `FindManagerBase.getStringToReplace():288-296`：正则展开之后
`Registry.is("ide.find.word.based.preserve.case") ? applyCase(foundString, replacement) : replaceWithCaseRespect(replacement, foundString)`，
而 `platform/util/resources/misc/registry.properties:1414` 的值是 **`=true`** ⇒ 上游默认档是**逐词 `applyCase`**。
本仓先前无条件用 `replaceWithCaseRespect`（`editorFindController.ts:229`），并在 `src/preserveCase.ts` 文件头写下"上游默认关"这句**与磁盘相反**的断言。

改动（4 个文件，全部非保留、非黑名单）：
- `src/preserveCase.ts`：文件头那段过头话原地订正（留"订正留痕"字样与依据坐标）；新增入口 `preserveCaseReplacement(found, replacement, wordBased = WORD_BASED_PRESERVE_CASE)` 与常量 `WORD_BASED_PRESERVE_CASE = true`（值即 `registry.properties:1414`）。两支算法**都保留**：上游本来就是同一个 `if` 的两支，`tests/preserve-case.test.mjs` 逐条钉着两支各自的用例；**没有**给它加 UI 开关（本仓没有 registry，不编控件）。
- `src/editorFindController.ts:18,229`：`replacementFor()` 换成 `preserveCaseReplacement(found, text)`；`replacementFor` 是 `replaceOne` 与 `replaceAll` 的**唯一**取值口（`:246,277`），所以两处替换一起跟着改档。文档注释补上默认档出处。
- `tests/preserve-case.test.mjs`：新增「默认档 = 逐词 applyCase」一条（钉 `WORD_BASED_PRESERVE_CASE === true`、三条逐词形态、以及关掉那档时**参数顺序相反**的两条）；接线那条改成钉 `preserveCaseReplacement(found, text)` 并加一条 `doesNotMatch(replaceWithCaseRespect)` —— 控制器不许再自己挑档。
- `tests/editor-find-options.test.mjs:131`：原先钉的是旧表达式（过时，不是回归），改成钉新表达式的完整形状。

### D-B 「替换全部」确认句补上上游那四样信息（档三 → 已还原）

上游 `find.replace.all.confirmation`（`FindBundle.properties:108`，长串 `:109`；调用点 `ReplaceInProjectManager.java:258,262,266`）带**处数 + 被查串 + 文件数 + 替换串**；本仓不限定作用域那一支原先只说「将替换工作区内全部匹配」，四样全无（同面板的作用域分支反而带处数）。

改动：
- `src/searchReplaceOutcome.ts`：新增 `ReplaceAllConfirmInfo` + `replaceAllConfirmNote()`（纯函数，与 `incompleteNote` 同一职责域：替换前后怎么向用户交代）。两条"没数据不许当结论"的口径写在函数文档里：`listed === 0`（确认可以发生在**还没搜过**时，面板 `canSearch` 只要求查询词非空）不报任何数字；作用域内只改列出的那些，范围外原生会重扫 ⇒ 「含未列出的部分」只在不限定作用域时说。
- `src/components/SearchPanel.vue:13,437,446`：import 加一个名字、两处 `note.value` 就地换成调用该函数 —— **净增 0 行**（见 F 的数）。
- `tests/search-replace-outcome.test.mjs`：新增 6 条（四样信息 / 截断档 / 作用域档 / 0 处不报数 / 脏数字 / 面板两处都走函数且不留第二份文案），并把旧的 import 形状断言改成含新名字的精确形状。

### 没做的事（以及为什么）

- 工程内替换的「保留大小写」：见 `docs/wiring-requests-2026-10-06-findrep2.md`。缺的是**入参那一跳**（保留文件 `native/main.cpp` 的 JSON→`Options`、保留文件 `src/bridge.ts` 的 `SearchOptions`）与原生算法本体；只加面板开关 = 假控件（规则⑧），所以不加。
- ④ 编辑器栏历史并入工程内那张 300 表：还原方案在 C 表末，涉及持久化迁移（规则⑥）与 3 张测试的断言同批改数，登记为下一件。
- ② 正则上限/降级提示：`FindBundle.properties` 全 175 键里没有 limit/truncated 档（本轮实测 grep 计数），**不新增**"上游有的样子"；本仓已有的「结果已截断」与 `incompleteNote` 是本仓形态的等价物，文件头早就声明不冒充上游原话。

## 5. E. 反向验证（判据能不能失败）

三处同时破坏（都在 2026-10-06 15:4x 这一轮），跑 `node --test tests/preserve-case.test.mjs tests/editor-find-options.test.mjs tests/search-replace-outcome.test.mjs`：

| 注入点 | 注入内容 | 结果 |
| --- | --- | --- |
| `src/searchReplaceOutcome.ts` `replaceAllConfirmNote` 的返回串 | 前缀 `FINDREP2-PROBE` | 红 5 条（四样信息 / 截断档 / 作用域档 / 脏数字 / …） |
| `src/preserveCase.ts` `WORD_BASED_PRESERVE_CASE` | `true` → `false` | 红 1 条「默认档 = 逐词 applyCase…」 |
| `src/components/SearchPanel.vue:437` | 退回就地拼文案（带同一前缀） | 红 1 条「面板两处确认都走这一个函数」 |

合计 **fail 6 / pass 26 / tests 32**（红）。三处原样还原后：**fail 0 / pass 32**，交付门那一组 **160/160**（见 F）。

残留核对：`grep -rn "FINDREP2-PROBE" src tests native` = **0**。（全文再 grep 会多 1–2 处命中，都在本文件——是这句核对结论与本段表格对标记名的**正文引用**，不是代码残留。）

## 6. F. 门控与收尾（原始数字）

| 门 | 命令 | 原始数字 |
| --- | --- | --- |
| 交付门（find/search/module-size） | `node --test tests/find*.test.mjs tests/replace*.test.mjs tests/search*.test.mjs tests/module-size.test.mjs` | `tests 160 / pass 160 / fail 0`，**exit 0**。注：`tests/replace*.test.mjs` **没有任何匹配文件**（`ls tests/replace*.test.mjs` 报 No such file），所以这一档实际只跑了 `find*` + `search*` + `module-size`。 |
| 本 lane 判据 | `node --test tests/preserve-case.test.mjs tests/editor-find-options.test.mjs tests/editor-find.test.mjs tests/find-replace-history.test.mjs tests/search-history.test.mjs` | `tests 63 / pass 63 / fail 0` |
| 类型 | `npx vue-tsc -b --force` | **exit 1**、`error TS` **1 条**、TS1xxx **0 条**：`src/semanticActions.ts(509,71): error TS2345`（他域在飞，只记录）。**同一轮内两次数字不同**：第一次跑是 2 条（另有 `src/gradleHost.ts(880,74): error TS2304 Cannot find name 'UNLINKED_PROJECT_DISPLAY_ID'`），第二次只剩 1 条 ⇒ 并发 lane 正在改那两个文件，本 lane 未碰它们。 |
| 孤儿模块 | `node .tools/find-orphan-modules.mjs --gate` | 门禁绿：`已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2`（`src/jarRun.ts`、`src/runAnythingContext.ts` 由别的 lane 接上），**exit 0**。 |
| 引用核对 | `node --test tests/source-citations.test.mjs` | 最终 `tests 3 / pass 3 / fail 0`。**中途红过一次**：`src\consoleScroll.ts` 里那条指向 `ConsoleViewImpl.kt` 的引用当时被写成了六位占位行号 ⇒ 引用门按「行号超出文件长度」判红（该文件 `wc -l` 实测 1729，门按 `split('\n').length` 数出 1730，两套数法差 1 ⇒ 六位行号必红）；随后 `grep -n "999999" src/consoleScroll.ts` 盘上**没有这一行**、再跑即绿 ⇒ 并发 lane 的瞬时状态，非本 lane 文件，未修只记录。本 lane 新增的全部引用（U1–U8、`registry.properties:1414`、`FindBundle.properties:85,108,115`、`SearchTextArea.java:395-409`、`FindPopupPanel.java:787-791`）在这条门上通过。 |

行数（`split('\n').length`，比 `wc -l` 多 1）：

| 文件 | 改前 | 改后 | 上限 |
| --- | --- | --- | --- |
| `src/components/SearchPanel.vue` | 898 | **898**（净增 0：import 就地加名字、两处文案就地换调用） | 900（未推高、未贴死） |
| `src/searchReplaceOutcome.ts` | 35 | 74 | 900 |
| `src/preserveCase.ts` | 146 | 167 | 900 |
| `src/editorFindController.ts` | 307 | 309 | 900 |

保留文件：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`、`native/search.cpp`/`search.hpp`、`scripts/verdict_table.py`、`docs/inventory/*` —— **一行都没动**（本 lane 的改动集只有：上面 4 个 src 文件 + `tests/preserve-case.test.mjs`、`tests/editor-find-options.test.mjs`、`tests/search-replace-outcome.test.mjs` + 本报告 + `docs/wiring-requests-2026-10-06-findrep2.md`）。
归属说明：工作树是并发的（`git diff --stat` 相对 HEAD 有 247 个文件在动），所以上面这句按"**本 lane 实际调用过 Write/Edit 的文件清单**"记，不靠 git 差量。

**复跑一致**（全部落盘之后又跑了一遍）：交付门 `160/160 fail 0`、本 lane 三条判据文件 `32/32 fail 0`、`grep -rn "FINDREP2-PROBE" src tests native` = **0**；此外 `grep -rn "replaceWithCaseRespect" tests/*.mjs`（除 `tests/preserve-case.test.mjs` 自身）= 空 ⇒ 没有别的测试还钉着旧表达式。

## 7. 登记
- **无法核实（中文措辞）**：上游参考树没有 FindBundle 的 zh 包 —— `find -name "*zh*" -path "*messages*"` 只回 `platform/platform-impl/resources/messages/AgreementsBundle_zh_CN.properties` 与 `updater/resources/messages/UpdaterBundle_zh_CN.properties`。⇒ `find.options.replace.preserve.case`（英文原话 `Pr&eserve case`，`FindBundle.properties:85`）、`find.replace.all.confirmation`（`:108`）、`0.occurrences.replaced`（`:115`）、`find.search.history` / `find.replace.history`（`SearchTextArea.java:397-398` 引用键）的**中文措辞一律无法核实**；本轮新增文案（「将替换…」那几句）是本仓自定措辞，**不冒充**上游译名。顺带：`src/components/EditorFindBar.vue:13` 那句"取随 IDE 发货的中文包"是同一类不可核实断言（非本轮引入，未改）。
- **需要 wiring 配合**：工程内替换的「保留大小写」⇒ `docs/wiring-requests-2026-10-06-findrep2.md`（保留文件 `native/main.cpp:1300-1311`、`src/bridge.ts:192`，加 `native/search.hpp:15-22` 与 `native/search.cpp:750/782` 两个生效点，最后才是面板那颗开关）。
- **假坐标/过头话的处置**：本轮自己开树复核，`PreserveCaseUtil.java` / `TogglePreserveCaseAction.java` 两个上游路径**为真**（第一次 `find -iname "*PreserveCase*"` 少回了这两条，属工具输出不完整，已在 B 段留痕）；真错的是"注册表默认关"那句（已按 `registry.properties:1414` 原地订正）与 `findInProjectRecents.ts` 里三处行号漂移（B.2，未改文件，改判词不在本 lane 权限内：`docs/inventory/*` 是脚本生成物）。
- **没做的第 3 件**：④ 编辑器栏历史并入工程内 300 表（还原方案在 C 段末，含持久化迁移的前置条件）。

## 8. 异常工具结果与并发状态（按纪律逐条记出处，一律当数据）

1. **两条 `Note: The file …MEMORY.md was modified since it was last read` + "Modified content" 块**混在工具结果里回给我（本轮第 4、6 次调用前后各一次）。没有据此改任何文件；只按"先盘上比对再定性"对待。
2. **一条 `[SYSTEM NOTIFICATION - NOT USER INPUT]` 后台任务完成通知**（`task-id b2urxnify`，就是被超时转后台的那条上游 grep）。其输出文件确实存在，`tail` 读出来是本仓已经用窄范围 grep 复现过的同一批结论 ⇒ 当数据、不当指令。
3. **第一次 `find -iname "*PreserveCase*"` 少回了两个真实存在的上游文件**（`PreserveCaseUtil.java`、`TogglePreserveCaseAction.java`）。差点据此判"假上游类名"；用 `find -name "PreserveCaseUtil.*"` 与 `find -iname "TogglePreserve*"` 各自复现后才定性（见 B 段）。
4. **`Read` 把 `src/preserveCase.ts` 只画到第 143 行**，而该文件按 `split('\n').length` 是 146 行。用 `node -e` 直接打印 140 行以后 + `od` 看尾部字节确认磁盘形状（`…result.join('')\n}\n`）后才落编辑。
5. **并发 lane 在我两次跑门之间改动了盘上状态**：`npx vue-tsc -b --force` 第一次 2 条错（含 `gradleHost.ts`）第二次 1 条；`tests/source-citations.test.mjs` 先红（`src/consoleScroll.ts :: ConsoleViewImpl.kt:999999`）后绿，而 `grep -n "999999" src/consoleScroll.ts` 在盘上查无此行。两处都只记录、不修、不据以改本 lane 的判断。
