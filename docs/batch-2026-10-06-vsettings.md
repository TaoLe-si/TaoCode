# 批次报告 2026-10-06 · 代号 `vsettings`（`settings-run` 判决族复核 + fold3 的 R-8）

派单：落 `docs/wiring-requests-2026-10-06-fold3.md` 的 **R-8**（上一轮判决轮因编辑权没落的那条），并把 `docs/inventory/verdict-settings-run.md` 这一族做一次「先核后改」的复核。
本轮**只动了一个文件**：`docs/inventory/verdict-settings-run.md`（§G 逐类表 + §B/§C-3/§C-4/§E/§F 的和数与措辞）。源码一个字没动。

---

## 0. 动手前先核实的两件「派单给的坐标」（一条对、一条错）

| 派单/请求的说法 | 我打开文件的实际结果 | 结论 |
|---|---|---|
| fold3 R-8：`src/consoleFold.ts:1-45` 存在且被 `src/runIssues.ts:17`、`src/components/RunConsole.vue`、`ConsoleSettingsPage.vue:5` 消费 ⇒「ConsoleFolding 在 src/ 从未出现」是取证口径错 | `src/consoleFold.ts` **45 行**，导出 `foldConsoleLines`（`:22-45`）；`src/runIssues.ts:17` 确实是 `import { foldConsoleLines } from './consoleFold.ts'`（`:39-58` 消费）；`src/components/RunConsole.vue:8`、`:85`、`:88`、`:506` 渲染 `×N`；`src/components/ConsoleSettingsPage.vue:5` 写着「折叠规则本身在 `src/consoleFold.ts`」，`:23-24` 是两个列表编辑框 | **成立**。R-8 的这条硬证据是真的，不是编的 |
| fold3 R-8：「要改的那几行……若该文档由 py 生成，则改 `scripts/verdict_table.py` 里对应 tuple；本批没有核实到那一族的 py 条目键名，不写行号以免编造」 | 实测：`grep -n "settings-run" scripts/verdict_table.py` **零命中**（该族在 py 里没有任何 tuple）；`grep -c "控制台折叠" scripts/verdict_table.py` = **0**（那句假判词不在 py 里，只在 `settings-run_verdict_table.json` 的 113 条 `why` 字段里）；`python scripts/verdict_table.py settings-run`（默认写盘档）**拒绝执行**并 exit 1，输出「`verdict-settings-run.md` 里有**手写的** §G 逐类表……覆盖 = 丢掉逐类判决并让 b* verdict 门禁变红」；`--dry-run` 另报「该域生成物 4327076 字节 vs 磁盘 2410023 字节、形状两套（`[x]0 + [~]1326 + [ ]0 + [-]1921`）」 | **判决文档不是 py 生成物** ⇒ 逐条档位只能直接改 md（与 fold3 开头那条「文件归属事实」同一条路）。`scripts/verdict_table.py` 本轮**不需要改，也一个字没改**（工作区里它的 6 行 diff 是别人的：`lp/custom-folding` 的 `~`→`x` 即 fold3 的 R-1，与本轮无关） |
| fold3 R-8 的建议：「`WslDistributionConsoleFolding` 与 `StackTraceFolding*` 建议 `[-]` 并给具体理由」 | 本域 §F③ + `tests/b11-verdict.test.mjs:147-196`：`[-]` 必须带六个标记之一，且标记要与机械事实互证 —— `[平台专属]` 要求 `settings-run_verdict_table.json` 的 `os === true`（实测 `WslDistributionConsoleFolding.os = false`，§D 的 OS 口径**明确排除 WSL**）；`[控件本体]` 要求 `kind=class/object` 且 `widget|paint=true`（实测 `StackTraceFolding`/`StackTraceFoldingConfigurable`/`StackTraceFoldingSettings` 三者 `widget=false paint=false`）。`json` 我没有改权、也没有重算入口（`grep keyUniverse/settingsGaps scripts/ .tools/` 零命中） | **不能照建议判 `[-]`**：一判就红（我按门禁规则核对过机械事实才这么定）。⇒ 这三行保持 `[ ]`，但把「架构不适用」的理由**写进判词**（见下表），并在 §7 给主代理留一条「要不要扩第六类标记之外」的线 |

---

## 1. 判词表（族 = `settings-run` 的控制台折叠/超链接/过滤器那一族；每条都自己打开过上下游）

判定档：**`[~]` 部分移植**（本仓已有 + 还差那一件都写在判词里）、**`[ ]` 未移植**（写清缺哪一件）。

### 1.1 升档：`[ ]` → `[~]`（20 行）

| # | 条目原文（§G 里的行） | 旧档 | 新档 | 本仓证据（文件:行号） | 上游证据（相对路径:行号） | 结论（一句话） |
|---|---|---|---|---|---|---|
| 1 | `ConsoleFolding` | `[ ]` | `[~]` | `src/consoleFold.ts:22-45`；`src/runIssues.ts:17`、`:39-58`；`src/components/RunConsole.vue:506` | `platform/execution-impl/src/com/intellij/execution/ConsoleFolding.java:18`、`:25`、`:33`、`:41`、`:50`、`:59`；宿主侧 `platform/lang-impl/src/com/intellij/execution/impl/ConsoleViewImpl.kt:1104-1114` | `shouldFoldLine`+占位那一半早做过，缺的只是 EP 注册面与 FoldRegion 宿主 |
| 2 | `SubstringConsoleFolding` | `[ ]` | `[~]` | `src/consoleFold.ts:28-29`、`:34`、`:36-38` | `platform/lang-impl/src/com/intellij/execution/console/SubstringConsoleFolding.java:13-15`、`:18-20`、`:23-25`；`ConsoleViewImpl.kt:1029-1081` | 子串规则 + `×N` 已落；上游折的是「连续命中但不必全等」的整段，本仓还多要求逐字相等 |
| 3 | `ConsoleFoldingSettings` | `[ ]` | `[~]` | `native/settings_schema.hpp:114`、`native/settings_schema.cpp:159`、`:292`；`src/settingsModel.ts:147`、`:204-205`；`src/components/ConsoleSettingsPage.vue:23-24`；`src/generalSettingsTextModels.ts:26-31`；`src/runIssues.ts:57-58` | `platform/lang-impl/src/com/intellij/execution/console/ConsoleFoldingSettings.java:25`、`:26`、`:51-53`、`:55-82`、`:93`、`:125`、`:148-152` | **两键早以别名落地**（正是本档 §C-4 第三行自己承认过的那件事，§G 却还写着「无此键」）；缺差量存储与 `ConsoleLineModifier` 那一步 |
| 4 | `StackTraceFolding` | `[ ]` | `[~]` | `src/exceptionFilter.ts:178`、`:187-206`（`foldJavaStackFrames`）；`src/components/RunConsole.vue:190`、`:192`、`:399`、`:500` | `java/execution/impl/src/com/intellij/execution/filters/StackTraceFolding.kt:12`、`:14`、`:16`、`:28-37`、`:39-46`、`:41-44` | 「折叠连续 `\tat ` 帧 + …其余 N 行」本仓有实现与开关；缺持久化阈值与异步栈/`... N more` 两支 |
| 5 | `StackTraceFoldingSettings` | `[ ]` | `[~]` | `src/components/RunConsole.vue:190`（会话态 `stackExpanded`）；`src/exceptionFilter.ts:188`（`keep = 2`） | `java/execution/impl/src/com/intellij/execution/filters/StackTraceFoldingSettings.kt:19`、`:23-24`、`:27-33` | 行为在、键不在：缺 `foldJavaStackTrace`/`foldJavaStackTraceGreaterThan` 两键（含旧档缺键补默认）与阈值语义差（上游「超过 N 帧」vs 本仓「固定留首 2 帧」） |
| 6 | `UrlFilter` | `[ ]` | `[~]` | `src/terminalHyperlinks.ts:109`、`:167`、`:212`；`src/consoleHyperlinks.ts:105-117`；`src/components/RunConsole.vue:488`；判据 `tests/console-hyperlinks.test.mjs:28`、`:36`、`:45`、`:62`、`:69` | `platform/execution-impl/src/com/intellij/execution/filters/UrlFilter.java:30`、`:54-79`、`:89-92`、`:94-123`、`:152-161` | URL 过滤器本仓早做过（规则就是照这个文件抄的），缺 provider 注册面与逐浏览器子菜单 |
| 7 | `MultipleFilesHyperlinkInfo` | `[ ]` | `[~]` | `src/runHyperlinks.ts:40`、`:70`；`src/runIssues.ts:18`、`:46-51`；`src/components/RunConsole.vue:483`、`:485-486`；判据 `tests/run-filters.test.mjs:99`、`:112` | `platform/lang-impl/src/com/intellij/execution/filters/impl/MultipleFilesHyperlinkInfo.java:20`、`:36`、`:55` | 一行多位置全扫 + 逐个可点已落；缺 PSI/VirtualFile 那一半（本仓无 PSI） |
| 8 | `FileHyperlinkRawDataFinder` | `[ ]` | `[~]` | `src/runHyperlinks.ts:25`、`:31`、`:40`；`src/runIssues.ts:46-51` | `platform/execution-impl/src/com/intellij/execution/filters/FileHyperlinkRawDataFinder.java:22-24` | finder 的契约（一行 → 多个区间、保序）就是 `findRunHyperlinks`；缺 finder/filter 分层与用户自定义 pattern 表 |
| 9 | `HyperlinkWithPopupMenuInfo` | `[ ]` | `[~]` | `src/consoleHyperlinks.ts:167-185`（`ConsoleLinkMenuItem`/`consoleLinkMenuItems`）；`src/components/RunConsole.vue:488`、`:514-516` | `platform/execution-impl/src/com/intellij/execution/filters/HyperlinkWithPopupMenuInfo.java:24-26`；`UrlFilter.java:197-200` | 链接右键菜单已落两格（打开/复制 URL）；缺 `ActionGroup` 动态菜单模型（逐浏览器那几行缺宿主通道） |
| 10 | `ConsoleFilterProvider` | `[ ]` | `[~]` | `src/runHyperlinks.ts:40`；`src/consoleHyperlinks.ts:105-117`；`src/exceptionFilter.ts:42`；`src/runIssues.ts:46-51`；`src/components/RunConsole.vue:218` | `platform/lang-api/src/com/intellij/execution/filters/ConsoleFilterProvider.java:28-31` | 它的可见效果=默认挂上「文件链接/URL/异常」三类，本仓三类都有、由宿主直挂；缺 EP 注册面 |
| 11 | `ExceptionFilter` | `[ ]` | `[~]` | `src/exceptionFilter.ts:42-83`、`:85`；`src/components/RunConsole.vue:72`、`:218`、`:502`；判据 `tests/run-filters.test.mjs:21`、`:63` | `java/execution/openapi/src/com/intellij/execution/filters/ExceptionFilter.java:15`、`:29`、`:65` | 原句「只出现在对照注释」错——同名**实现模块**就在 `src/exceptionFilter.ts`；缺 refiner（PSI 校验）与点徽标跳异常类 |
| 12 | `ExceptionLineParser` | `[ ]` | `[~]` | `src/exceptionFilter.ts:172-177`；`src/buildOutput.ts:84`、`:100`；`src/runHyperlinks.ts:40`；`src/runIssues.ts:64-68` | `java/execution/openapi/src/com/intellij/execution/filters/ExceptionLineParser.java:14-19`、`:27`、`:32` | 解析面（栈帧行→方法/文件/行、`路径:行:列`、一行多位置）已落并接了跳转；缺 `ExceptionLineRefiner`/`getUClass`/`getFile` |
| 13 | `ExceptionLineParserImpl` | `[ ]` | `[~]` | 同上四条 + `src/components/RunConsole.vue:486` | `java/execution/impl/src/com/intellij/execution/filters/ExceptionLineParserImpl.java:74`、`:89`、`:94`、`:104`、`:115`、`:123` | 单行解析这一半有；缺 `ExceptionInfoCache.resolveClassOrFile`、`ExceptionFinder` 位置校验与 `$$Lambda$` 分支 |
| 14 | `ConsoleEncodingComboBox` | `[ ]` | `[~]` | `src/consoleEncoding.ts:20`、`:32`、`:35`、`:47`、`:61`、`:72`；`src/components/RunConsole.vue:77`、`:401-404`；判据 `tests/console-input.test.mjs:77`、`:96` | `platform/lang-impl/src/com/intellij/execution/console/ConsoleEncodingComboBox.kt:20`、`:25`、`:80`、`:95`、`:106` | 编码选择 + 解码消费者都在；缺「收藏 + 全部字符集 + 系统编码默认」（本仓固定列表、默认 UTF-8，差异已写在文件头） |
| 15 | `HistoryKeyListener` | `[ ]` | `[~]` | `src/consoleInputHistory.ts:69-84`；`src/runActions.ts:25`、`:85`、`:88-89`、`:514`；判据 `tests/console-input.test.mjs:50`、`:96` | `platform/lang-impl/src/com/intellij/execution/console/history/HistoryKeyListener.kt:16`、`:38`、`:47` | 上下键回看/修饰键不抢/preventDefault 全都有实现与接线；缺 `keyExactMatch` 与跳到首末条（本仓输入框单行） |
| 16 | `ConsoleHistoryModel` | `[ ]` | `[~]` | `src/consoleInputHistory.ts:15-27`、`:29-59`；`src/runActions.ts:85`、`:88-89`、`:514`；判据 `tests/console-input.test.mjs:19`、`:38` | `platform/lang-impl/src/com/intellij/execution/console/ConsoleHistoryModel.java:7`；`DefaultConsoleHistoryModel.java:49`、`:91`、`:99`、`:113`、`:120` | 模型契约（size/at/push/up/down/unfinished）已落；缺跨会话持久化与 `resetEntries`/`removeFromHistory`/游标 API |
| 17 | `DaltonizationFilter` | `[ ]` | `[~]` | `src/App.vue:1963-1965`（三张 `feColorMatrix`）；`src/appearanceActions.ts:151-153`；`src/settingsModel.ts:223`、`:352`；`src/components/SettingsDialog.vue:608-612` | `platform/editor-ui-api/src/com/intellij/ide/ui/DaltonizationFilter.java:9-29` | 这一族被塞进「控制台折叠」判词纯属类名匹配错；色觉矫正本仓有整链（键+挂载+UI），缺 weight 与第四档 |
| 18 | `MatrixFilter` | `[ ]` | `[~]` | `src/App.vue:1963-1965`；`src/appearanceActions.ts:151-153`；`src/settingsModel.ts:352` | `platform/editor-ui-api/src/com/intellij/ide/ui/MatrixFilter.java:11`、`:12-24` | 按矩阵换算 RGB 由 SVG 滤镜承担；缺 `MatrixConverter` 的 weight 插值与逐像素面 |
| 19 | `SimulationFilter` | `[ ]` | `[~]` | `src/App.vue:1963-1965`；`src/settingsModel.ts:352`；`src/previewSettings.ts:54`（值域校验） | `platform/editor-ui-api/src/com/intellij/ide/ui/SimulationFilter.java:9-27`、`:21`、`:23` | 三档模拟在；缺 `achromatopsia` 第四档与 weight，且**没有标明本仓那套矩阵属「矫正」还是「模拟」**（已写进判词） |
| 20 | `WeightFilter` | `[ ]` | `[~]` | `src/App.vue:1963-1965`；`src/appearanceActions.ts:151-153`；`src/settingsModel.ts:352` | `platform/editor-ui-api/src/com/intellij/ide/ui/WeightFilter.java:10`、`:32-38` | 抽象基类的可见结果（保 alpha 只换 RGB）有；缺 weight 这一维度 |

### 1.2 保持 `[ ]`、但把证据句与「缺哪一件」订正（5 行）

| # | 条目 | 旧档 | 新档 | 本仓证据 | 上游证据 | 结论 |
|---|---|---|---|---|---|---|
| 21 | `CustomizableConsoleFoldingBean` | `[ ]`（句：consoleFold.ts 无对应） | `[ ]`（句已订正） | 名单只有用户自己那两条：`native/settings_schema.hpp:114` | `platform/lang-impl/src/com/intellij/execution/console/CustomizableConsoleFoldingBean.java:17`、`:19`、`:26`、`:32`；并进默认名单的监听在 `ConsoleFoldingSettings.java:33-45` | 缺「插件贡献的默认折叠名单」；本仓无 EP 宿主 ⇒ 按规约 §3 不渲染没有消费方的默认项（**不判 `[-]`**，理由见 §0 第三行） |
| 22 | `FoldLinesLikeThis` | 同上 | `[ ]`（句已订正） | 控制台只有工具条与链接菜单：`src/components/RunConsole.vue:412`、`:514-516`；`grep -rn "折叠类似\|FoldLinesLikeThis" src/` **零命中** | `platform/lang-impl/src/com/intellij/execution/console/FoldLinesLikeThis.java:20`、`:22`、`:55`、`:63` | 真缺：右键「折叠类似的行」这条动作，以及「按选区把子串写回 `foldConsoleLines`」的链路 |
| 23 | `WslDistributionConsoleFolding` | `[ ]`（句：行为主体未移植） | `[ ]`（理由已写全） | `native/` 里只有 `native/projects.cpp` 提过 wsl 字样，无启动 WSL 发行版的链路 ⇒ 无输出可折 | `platform/wsl-impl/src/com/intellij/execution/wsl/WslDistributionConsoleFolding.kt:27`、`:33`、`:59-68` | 架构上「不适用」，但 §F③ 的六个标记不允许（`os=false`、§D 的 OS 口径明确排除 WSL）⇒ 判词里把这两层都写明，留一条线给主代理（§7-a） |
| 24 | `StackTraceFoldingConfigurable` | `[ ]`（句：`settingsTreeMeta.ts` 无该节点） | `[ ]`（句已换成实读的落点） | 「编辑器 › 控制台」页实读：`src/components/ConsoleSettingsPage.vue:22-26` 只有「折叠行/例外」两个列表；会话态开关 `src/components/RunConsole.vue:190` | 两键在 `java/execution/impl/src/com/intellij/execution/filters/StackTraceFoldingSettings.kt:23-24`；`StackTraceFoldingConfigurable.kt` 本轮**未逐行读**（判词里已标注「控件形状按那两个键推得」） | 真缺：页内那一行的两个控件 + 把 `stackExpanded` 从会话态改持久化 |
| 25 | `ConsoleFoldingSettings` 的差量那一半（并入第 3 行的「缺」） | — | `[~]` 里的「还差」 | — | `ConsoleFoldingSettings.java:93`、`:125`（`getState`/`loadState` 走 added/removed 差量）、`:55-82`（`ConsoleLineModifier` 先改写再匹配） | 差量存储与行改写不写进「已做」，只留在「缺」里 |

### 1.3 余下 95 行：假句子已摘掉，档位不动（口径留痕）

`grep -c "控制台折叠/超链接/过滤" 改前 = 113`；本轮逐条复核并改了 **18** 行（§1.1 的 20 行里有 2 行原本用的不是这句），**其余 95 行**统一把那句假判词换成：

> 缺：这一行原句「控制台折叠/超链接/过滤（`src/consoleFold.ts`/`src/runHyperlinks.ts` 无对应）」是**按类名匹配**拿到的判词（R-8 指出的取证口径错，本轮订正：控制台那一族的本仓真落点是 `src/consoleFold.ts`、`src/runHyperlinks.ts`+`src/consoleHyperlinks.ts`、`src/exceptionFilter.ts`、`src/consoleInputHistory.ts`、`src/consoleEncoding.ts` 五处）；本类在这五处之内还是之外，**本轮未逐条打开上下游复核** ⇒ 档位保持 `[ ]`、缺的那一件待按 §C-3 与 §E 的口径逐条补

这 95 行里混着明显不是控制台族的条目（`SettingsFilter`、`AdvancedSettingsFindActionOptionsFilter`、`ProxyFilters`、`TestProxyFilterProvider`、`DiffHyperlink`、`CoverageClassFilterEditor`、`JShell*` 六行、`TrigramIndexFilter`、`EditorHyperlink*` 六行、`TestProxyFilterProvider`……）⇒ **取证口径错的规模比 R-8 点名的还大**，但本轮预算内没有逐条打开上下游，所以**一律不升档、不降档**，只把假句子换成「待复核」级别的措辞（与 §C-3、§E 已有的诚实声明同一条口径）。

### 1.4 汇总（`tests/b11-verdict.test.mjs` 与 `tests/b9-verdict.test.mjs` 都按 §G 实数复算）

| 档 | 改前（表头 = §G 实数） | 改后（表头 = §G 实数） | 变化 |
|---|---|---|---|
| `[x]` | 35 | 35 | 0 |
| `[~]` | 388 | **408** | +20 |
| `[ ]` | 2526 | **2506** | −20 |
| `[-]` | 298 | 298 | 0 |
| 合计 | 3247 | 3247 | 0 |

同步改掉的其它印在正文里的数字（都是按 json/§G 实数重算，不是手填）：§B 小节标题「全表 388 类」→「408 类」；§C-3 的三态拆分「`[ ]` 的 2526 条＝注释证据 304 / 名字从未出现 2196 / 真实代码引用 1 / 非专名剔除 25」→ 按 `settings-run_verdict_table.json` 逐行命中重算 = **2506 条＝299 / 2181 / 1 / 25**（`python` 现算：code 1、comment 299、never 2206，其中非专名 25 ⇒ 2206−25=2181）；§C-4 第三行的「结论」格改成「R-8 复核已升档」；§E 新增一条把本轮范围（20 升档 / 5 保 `[ ]` 改措辞 / 95 待复核 / `[-]` 一档没动 + 为什么动不了）写死；§F 末段把「本判决真源是那份 json、§G 由它渲染」改成**已核实的事实**（见 §0 第二行：json 没有仓内重算入口、py 与它形状两套、R-8 之后 `why` 字段与 §G 不再逐字同步）。

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
|---|---:|---:|---|
| `docs/inventory/verdict-settings-run.md` | 3499 | 3502 | 唯一被我改的文件：§G 20 行升档 + 5 行证据句订正 + 95 行假句子替换 + 表头/§B/§C-3/§C-4/§E/§F 的和数与措辞。行数 +3（§E 一条 bullet + §F 拆成三行）；字节数按 diff 约 +130 行改写（`git diff --stat` 当时 247 行变更） |
| `scripts/verdict_table.py` | 1034 | 1034 | **一个字没改**（本轮核实结论：这一族不由 py 管，见 §0）。工作区里它的 6 行 diff 是别的 lane 的（`lp/custom-folding` `~`→`x` = fold3 R-1） |
| `docs/inventory/settings-run_verdict_table.json` | 3247 行 rows | 未动 | 我没有改权、也没有仓内重算入口；它的 `why` 字段仍留旧措辞（已在 §F 写明「判决以 §G 为准」） |
| 其它 `src/**`、`native/**`、测试 | — | — | 未触碰（本轮是判决复核，不是实现） |

⚠ 留痕：本轮收工前发现 `verdict-settings-run.md` 的**大部分改动已被主代理提交进 HEAD**（`200232e feat(parity): 多域收工批量 …` 里含 `docs/inventory/verdict-settings-run.md | 251 +++++++-------`），我自己**没有执行过任何 commit**；`git status` 现在只剩最后那 1 行 §F 措辞未入库（`M ` 一列）。禁 checkout/reset/stash/clean 一条也没破。

---

## 3. §5 自查命令（前后数字）

| 命令 | 改前 | 改后 | 结论 |
|---|---|---|---|
| `node --test tests/b11-verdict.test.mjs`（钉这一族四档计数的门，见 §4「我是怎么找到它的」） | 11 pass / 0 fail（首跑即在全部行改完之后） | **11 pass / 0 fail** | 绿 |
| `node --test tests/b9-verdict.test.mjs`（同一份文档的第二道门，B7 交叉核对 630 条） | 9 pass / 0 fail | **9 pass / 0 fail** | 绿（中途因我在 §F 写了字面标题串红过一次 6 条，见 §4-b） |
| `python scripts/check_verdict_tables.py` | 存在，但输出「本文件是核对引擎，不单独跑」⇒ 正确入口是 `python scripts/verdict_table.py --check <域>` | 同左 | 按它的用法跑（见下两条） |
| `python scripts/verdict_table.py settings-run`（写盘档） | — | `拒绝生成 settings-run：…有手写的 §G 逐类表…`，**exit 1**，一个字节都没写 | 证明本文档不是 py 生成物（护栏按预期工作） |
| `python scripts/verdict_table.py --check settings-run` | `--dry-run` 实测：不一致 2/2（json 生成 4327076 / 磁盘 2410023 字节；`settings-run_verdict_table.md` 磁盘缺失） | 同样 **不一致 2/2** | **改前改后一模一样**（我没动 py，也没动 json）⇒ 这条不是本轮引入的回归，属「py 与 B11 两套 json」的历史分叉，已写进 §F |
| `python scripts/verdict_table.py --check`（默认 execution+xdebugger，py 真管的族） | 未跑（本轮无关） | **一致，exit 0** | 绿 |
| `node --test tests/verdict-generated.test.mjs` | — | **5 pass / 0 fail**（`DOMAINS` 不含 settings-run：execution/xdebugger/projectviews/daemon/platform_rest） | 绿，且证明这一族的计数不由它钉 |
| `node --test tests/source-citations.test.mjs` | — | **3 pass / 0 fail**（本轮新增的上游引文全部落在真实文件、行号不越界） | 绿 |
| `node --test tests/source-citation-anchors.test.mjs` | — | **7 pass / 1 fail**：唯一红条是 `moved :: docs/wiring-requests-2026-10-06-fix-macros.md\|platform/lang-impl/resources/intellij.platform.lang.impl.xml\|1058-1062` | **不是本轮引入**：该条在别人的 wiring-requests 文档里（那条引用在那份文档中已被删/改行号，快照还是旧的）；我没碰那份文件、也没权重算共享快照 ⇒ 报给主代理（§7-e） |
| `npx vue-tsc -b --force` | — | **1 条错**：`src/components/ToolWindowView.vue(220,4): error TS2345`（`{}` 少 `rows/count/query/searching`） | **不是本轮引入**：本轮零源码改动；`ToolWindowView.vue`、`problemsView.ts`、`ProblemsPanel.vue`、`toolWindowMeta.ts` 全是别人的在途 `M` 文件 |
| `node --test tests/module-size.test.mjs` | — | **5 pass / 0 fail** | 绿（本轮没拆/合文件） |
| `node .tools/find-param-props.mjs` / `find-ts-in-mjs.mjs` / `find-missing-ext.mjs` / `find-orphan-modules.mjs --gate` | — | 未跑（本轮**只改一个 .md**，不新增/不改任何 `.ts/.vue/.mjs`，四条门检查的都是源码形状） | 见 §5 的零消费方结论 |

---

## 4. 反向验证（新门/改动必须有牙）

**(a) 四档和数门（本轮改的就是这个数）**
1. 注入违规：`sed` 把表头 `四档合计 **[x] 35 + [~] 408 …` 改成 `[~] 407`（差 1）。
2. 结果：`node --test tests/b11-verdict.test.mjs` ⇒ **10 pass / 1 fail**，失败用例「表头『当前已判 N 行』与四档和数都等于 §G 真实行数」，`AssertionError: \`[~]\` 计数与 §G 不符`。**变红 = 门有牙**。
3. 撤回：改回 408 ⇒ `b11` **11 pass / 0 fail**、`b9` **9 pass / 0 fail** 复绿。

**我是怎么定位「哪个测试钉了这一族四档计数」的**：`grep -rln "settings-run" tests/*.mjs` ⇒ 只有 `tests/b9-verdict.test.mjs`、`tests/b11-verdict.test.mjs`；再 `grep -n "四档合计\|3247" tests/b9-verdict.test.mjs` ⇒ b9 的 `四档相加等于总数，且文档头部的和数与表一致` 用同一条 labeled 正则逐个档核数；`grep -n "四档合计" tests/b11-verdict.test.mjs` ⇒ b11 的门禁 ② 同样核数。**两处都没有把 388/2526 写死**（b11 只写死 3247 行数与 `[x]/[~] >= 40` 的下限），所以本轮**没有任何断言需要改数字**，只改了文档里的印数 —— 没有放松任何断言。

**(b) 一次「意外自证」（记下来当教训，不是设计好的）**
我在 §F 写了字面量 `## G. 逐条总表`（在反引号里）⇒ `tests/b9-verdict.test.mjs` 当场 **6 fail**（`§G 应有 3247 行，实为 0` 等，因为 b9 按这个字面串切 §G，被我提前命中）。改成「§G 的标题」这种不含字面标题的写法 ⇒ 复绿 **9 pass / 0 fail**。结论：两道门对 §G 的切分方式不同（b11 切到文末、b9 有界），**文档里不能出现字面的 §G 标题**（这条已在 §F 的措辞里避开，并写进本报告）。

---

## 5. 零消费方自查

本轮**没有新增任何模块/文件**（只改一份 markdown 判决），`.tools/find-orphan-modules.mjs --gate` 关心的「新增零消费方」面为零。为避免空口，把 §1.1 引用的六个本仓模块的消费链路逐条列出（本轮全部实读过）：
`src/consoleFold.ts` ← `src/runIssues.ts:17`（`:39-58` 调用）← `src/components/RunConsole.vue`（`:506` 渲染 `×N`）；
`src/exceptionFilter.ts` ← `src/components/RunConsole.vue:72`（`:218` 分类、`:502` 徽标、`:192` 栈折叠）+ `src/testFilters.ts:24` + `tests/run-filters.test.mjs:15`；
`src/consoleHyperlinks.ts` ← `src/components/RunConsole.vue:74`（`:488` 渲染、`:514-516` 菜单）；
`src/runHyperlinks.ts` ← `src/runIssues.ts:18`、`src/consoleHyperlinks.ts:62`；
`src/consoleInputHistory.ts` ← `src/runActions.ts:25`、`:88-89`、`:514`；
`src/consoleEncoding.ts` ← `src/components/RunConsole.vue:77`、`:401-404` + `src/runInstances.ts`（解码）。
⇒ 判词里指到的每个文件都存在且都在生产链上（b11 门禁 ③ 也把「`[x]/[~]` 行必须指到磁盘真实文件」跑过了，11/11 绿）。

---

## 6. 做不到 / 无法核实

1. **「该族所有 `[~]`/`[ ]` 条目逐条对照」在预算内不可能**：本族 `[~]`+`[ ]` = 388+2526 = **2914 行**，本轮预算 ~90 次调用。我把范围收到 R-8 点名的那一族（113 行带假句子的）：**20 行升档 + 5 行改判词**（这 25 行每条都自己打开过上下游源码，坐标见 §1）+ **95 行只摘掉假句子、档位不动并明确写「本轮未逐条复核」**。剩下 2800+ 行按 §C-3/§E 原口径仍是待复核。
2. **`[-]` 这一档本轮动不了**：§F③/`tests/b11-verdict.test.mjs:147-196` 只认六个机械标记，而 `settings-run_verdict_table.json` 里 WSL/EP 宿主/色觉那几族的 `os`/`widget`/`paint` 全为 `false`（我逐条读过 json 的这三个字段），json 我没有改权、也没有仓内重算入口（`keyUniverse`/`settingsGaps` 在 `scripts/`、`.tools/` 零命中）。⇒ 架构不适用只能写在 `[ ]` 的判词里（第 §1.2 表第 23 行）。
3. **`StackTraceFoldingConfigurable.kt` 未逐行读**（只读了它对应的两键 `StackTraceFoldingSettings.kt:23-24`）⇒ 判词里控件形状标为「按那两个键推得」。
4. **本仓 `feColorMatrix` 三张矩阵属于「矫正」还是「模拟」未核实**（上游 `ColorBlindnessMatrix.Protanopia.MATRIX` 那张表本轮没打开）⇒ 已写进 `SimulationFilter` 行的「缺」。
5. **`PatternBasedFileHyperlinkFilter`/`AbstractFileHyperlinkFilter`/`RegexpFilter`（用户自定义正则→链接）本仓确实没有对应设置表**，但这一行落在 95 行待复核桶里（`src/` 里没有同名实现我只做到「名字与键都不命中」级别的核对），没有单独成行升/降。
6. **`source-citation-anchors` 1 条红、`vue-tsc` 1 条红都在别人的文件面**（§3 表里已给出处），本轮无改权、也不该顺手改别人的在途现场。

---

## 7. 需要主代理接的线（不另开 wiring-requests 文件，按派单「最后 ~15 次只写这份报告」的要求集中在这里）

- **a. `[-]` 的第七类标记要不要开**：`WslDistributionConsoleFolding`（`platform/wsl-impl/...:27`、`:33`、`:59-68`）、`CustomizableConsoleFoldingBean`（`...:19`、`:26`、`:32`）这类「本仓无宿主链路/无插件 EP」的架构不适用，现在被 §F③ 六标记规则堵在 `[ ]`。要么在 `tests/b11-verdict.test.mjs:147-196` 扩一个带机械事实的标记（例如 `[无宿主链路]` + 要求给出 `native/` 里确实没有那条通道的证据），要么重算 `settings-run_verdict_table.json` 的 `os` 口径（把 WSL 纳入）。两条都**不是我的文件面**。
- **b. 右键「折叠类似的行」**（`FoldLinesLikeThis.java:20`、`:22`、`:55`、`:63`）：消费链现成（`src/consoleFold.ts` 的规则来自 `generalSettings.foldConsoleLines`，`native/settings_schema.hpp:114` 已有键），缺的是 `src/components/RunConsole.vue` 的选区动作 + 写回。要动 `RunConsole.vue`（appvue/主代理面）。
- **c. 栈折叠两键**（`StackTraceFoldingSettings.kt:23-24`，默认 `true`/`8`）：要同时动 `native/settings_schema.hpp`/`.cpp`、`src/settingsModel.ts`、`src/components/ConsoleSettingsPage.vue`（**四个保留文件**）⇒ 只有主代理能落；落时按规约「旧存档缺键补默认、不得按键数判损坏」（同文件 `:292` 那一类数组校验分支就是现成范式）。另外阈值语义要统一：上游「超过 N 帧才折」vs 本仓 `src/exceptionFilter.ts:188` 的「固定留首 `keep=2`」。
- **d. `ConsoleFoldingSettings` 的差量存储 + `ConsoleLineModifier`**（`ConsoleFoldingSettings.java:93`、`:125`、`:55-82`）：本仓两键是「全量名单」，没有 added/removed 差量；若产品要「恢复默认折叠项」就得先做这条（也牵扯 `native/settings_schema.cpp`）。
- **e. 快照里那条死锚点**：`docs/inventory/citation-anchors.json` 还记着 `docs/wiring-requests-2026-10-06-fix-macros.md` 的 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1058-1062`，而那条引用在那份文档里已指不到 ⇒ 由 fix-macros 那条 lane 补回引用，或主代理统一 `TAOCODE_CITATION_ANCHORS=update` 重算（重算会把本轮新增的 ~60 条引文一并入快照）。
- **f. `src/components/ToolWindowView.vue(220,4)` 的 TS2345**（`{}` 少 `rows/count/query/searching`）：与 `problemsView.ts`/`toolWindowMeta.ts` 的在途改动同一片，属另一条 lane；本轮 `npx vue-tsc -b --force` 因此**不是 0 错**。
- **g. py 与 B11 的两套 `settings-run_verdict_table.json`**：`python scripts/verdict_table.py settings-run` 现在会拒绝写文档、但 `--check` 永远报「不一致 2/2」。要么给这一族补一个真正的仓内重算入口（§F 已写明它不存在），要么把 `settings-run` 从 py 的域清单里显式排除并让 `verdict-generated.test.mjs` 的注释跟着（现在 `DOMAINS` 里没有它，行为上已经是排除的，只是缺一句成文说明）。
