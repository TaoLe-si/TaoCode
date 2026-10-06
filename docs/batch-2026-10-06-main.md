# 主代理工作台账 · 2026-10-06（一次性全量移植批次）

> 主代理职责：**验证子代理交付** + **统一接线**。本文件记派单实况、我自己落地的改动、
> 以及等各桶交付后要做的接线清单。

## 0. 基线（派单前实测）

| 项 | 值 |
|---|---|
| 分支 / HEAD | `parity/rebuild-inventory` / `63056b7` |
| `npx vue-tsc -b --force` | **0 错** |
| `npm test` | **3723 用例 / 3706 通过 / 17 失败** |
| 工作区 | 925 处改动（269 modified + 656 untracked），全部未提交 |
| 规模 | 522 个 `src/*.ts` · 117 个组件 · 99 个 `native/*.cpp` · 463 个测试文件 |

17 条红的归属已逐条写进对应桶的任务书（桶 5 折叠 5 条 / 桶 6 状态栏与关于 2 条 / 桶 7 工具栏与 b7 判决 6 条 /
桶 8 工具窗口激活 1 条 / 桶 12 悬停求值相关 0 条 / 动效 hover 过渡 1 条 = 主代理自己处理）。

## 1. 在跑的代理（20 个，平台并发上限就是 20）

| 代理 | 范围 | 交付文件 |
|---|---|---|
| bucket1-refactor … bucket15-projectmodel | 15 个实现桶，归属见 `docs/batches-2026-10-06-buckets.md` | `docs/batch-2026-10-06-bucketN.md` + `docs/wiring-requests-2026-10-06-bucketN.md` |
| verdict-editor | `editor` 域 2551 类逐条判决（此前无判决表） | `docs/inventory/verdict-editor.md` + `tests/b8-verdict.test.mjs` |
| verdict-settings-run | `settings-run` 域 3247 类逐条判决 | `docs/inventory/verdict-settings-run.md` + `tests/b9-verdict.test.mjs` |
| verdict-vcs | `vcs` 域 1783 类逐条判决 | `docs/inventory/verdict-vcs.md` + `tests/b10-verdict.test.mjs` |
| tooling-gates | `verdict_table.py --check/--dry-run` + 引用锚点门控 | `tests/source-citation-anchors.test.mjs` 等 |
| audit-tree | 只读独立验收现有 925 处改动（证伪，不修） | `docs/audit-2026-10-06-tree.md` |

**排队等空位**：`audit-docs`（只读验收常驻文档里的数字声称 / 「目录不存在」类声称 / 60 条上游行号引用 /
本仓落点是否真存在 / 档位自洽）—— 首发时并发已满，出空位即派。

三个从未判决的域合计 **7581 类**（`docs/inventory/` 里只有 `editor.txt`/`settings-run.txt`/`vcs.txt` 三份清单，
没有对应的 `verdict-*.md`），这一批把它们补成可执行的缺口清单。

## 2. 主代理已落地的改动

| 项 | 内容 | 验证 |
|---|---|---|
| 上一批接线请求 A1/A2/A3/A6/A7/A8/F | **复核发现已全部落地**（`QuickDocPopup`、`BreadcrumbsBar`、`RefactorPreviewDialog`、`FileChooserDialog` 都挂上了；`createStickyLines` 已喂 `language`；`junitQuickFixActions` 已进 `openCodeActions`；`style.css` 里 `quickdoc-*` 24 处、`crumb-bg-*` 5 处） | grep 实况 |
| B1（`bridge.ts` 的 `LspDiagnostic.code/tags`） | **复核发现已落地**（`src/bridge.ts:118` + `native/lsp_support.cpp:148-149`） | 读两处实况 |
| B2（`problems.ts` 的 `ProblemRow.code`） | **已落地**（`src/problems.ts:46`），归桶 2 继续往下做分组 | grep 实况 |
| D1（`RunConfig.type` 加 `'jar'`） | **有意不做**，`src/settingsModel.ts:19` 已写明理由；桶 10/11 若要接，必须与 `runConfigTree.ts` + `runConfigEditors.ts` 同批改 | 读实况 |
| D2（`showMembersInNavigationBar`） | **主代理新落**：四处齐全（TS 类型与默认 / 原生默认值表 / 原生布尔键表 / 读盘白名单）。上游依据 `platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:121`（默认 **true**）、生效点 `java/java-impl/src/com/intellij/lang/java/JavaBreadcrumbsInfoProvider.java:125` 与 `.../ide/navigationToolbar/JavaNavBarExtension.java:103/107`；切换动作 `platform/navbar/frontend/src/actions/ViewNavigationBarMembersAction.java:20` 只在旧 UI 出现，本仓没有新旧 UI 之分 ⇒ 移植的是设置与行为，不是那个菜单项（已写进注释）。 | `node --test tests/navbar-members-setting.test.mjs` **5/5**，含反证（把键名从四处抠掉后同一组判据一条都不成立） |

## 4. 实况更新（派单后）

| 时刻 | 事件 | 处置 |
|---|---|---|
| T+30 min | **桶 3（bucket3-docs）撞到 150 次调用上限被切断**，报告没写 | 已核它落地的真实代码：`src/lsSessionHost.ts`（**本仓 `lspSessionStates` + 文档账唯一的生产写入方**，被 `lspCompletionStartup.ts:35` 与 `quickDocHost.ts` 消费 —— 上一轮遗留的最高价值卡点已完成）、`docHoverPolicy.ts`、`docSymbolTarget.ts`、`codeLensCache/Settings.ts`、`QuickDocPopup.vue`。拆成 **bucket3a（文档半区）** 续做；新派单一律加「**最后 ~15 次调用留给报告**」的硬预算 |
| T+32 min | **桶 9（bucket9-search）同样撞上限**，断在「要写结构化搜索 modifier 模型」那一刻 | 已落地 `src/structuralSearch{,Configs,Constraints,Filters,Results}.ts` + 4 个测试、`src/searchEverywhere{Classes,Filters,Tabs,Text,TopHit,Balancer}.ts`。拆成 **bucket9a（modifier + `ss/replace`）**、**bucket9c（diff 错引用订正）**，**bucket9b（Search Everywhere 五个孤儿模块的接线）待发空位** |
| T+34 min | **独立验收员 audit-tree 交付**：硬错 7 / 可疑 13 / 站得住 8 类（68 条上游坐标逐行核过），报告 `docs/audit-2026-10-06-tree.md` | 见下面 §5 的整改队列 |

## 5. 主代理整改队列（验收员抓出来的 + 门禁实测）

**A. 归我（保留文件 / 全局门禁），现在就做**
- ✅ `.gitignore` 补 `build-sym/`（7548 个文件）、`build-symvs/`（502 个）与 `tsc.txt` / `ms.txt` / `rv.txt` / `debug-tmp.mjs`：未跟踪条数 **8857 → 695**（真实源码）。共 **1.37 GB** 产物此前会污染任何一次 `git add -A`。
- ⏳ 死模块门禁实测**是红的**：14 个新增零生产消费方模块。归属：`searchEverywhere{Filters,Tabs,Text,TopHit,Balancer}` + `structuralSearch{Filters,Results}` → 桶 9 系（9a/9b 补）；`navChooseByNameFilter`/`navWorkspaceSymbolCache` → 桶 4；`popupStack` → 桶 8；`refactorSignature` → 桶 1；`completionCamelHump` → 桶 2；`terminalTitle` → 桶 10；`testLocator` → 桶 11（都在跑，交付时逐一验消费方）。另有 5 个「✔ 已接上可以更新基线」（`aboutInfo`/`codeVisionProviders`/`statusBarLifecycle`/`lsFeaturesWidget`/`lsSessionDocuments`）⇒ **基线该更新**，但要等全绿再一次性做，别在跑的过程中改基线掩盖新问题。
- ⏳ 动效那 1 条红（4 处 `:hover` 缺底规则 `transition`）：`DebugInspectWindow.vue`（桶 12）/`EventLogPanel.vue`（桶 6）/`RefactorPreviewDialog.vue`（桶 1）/`style.css`（我）—— 等各桶收工一起做，免撞文件。

**B. 归各桶名下文件，等它们交付后我改（现在动会撞车）**
- ✅ **已修（主代理，2026-10-06）**「假无法核实」`src/jarRun.ts`：我**独立复核了验收员的说法**（他自己猜的路径 `java/execution/impl/...` 是错的，正确落点是
  `platform/execution-impl/src/com/intellij/execution/util/ProgramParametersConfigurator.java:260-261` +
  `platform/execution/resources/messages/ExecutionBundle.properties:532`，键值 `Working directory ''{0}'' doesn''t exist`）——
  **结论成立**，注释里那段「无法核实」是假的。已把注释换成真坐标、把自造串 `does not exist` 换成上游串 `doesn't exist`，
  并同步 `tests/jar-run.test.mjs:59`（**断言仍然精确到全等**，没有放松）。`node --test tests/jar-run.test.mjs` **10/10 绿**。
  ⚠️ 这条同时说明：**验收员自己的路径也会错**，所以我按「先自己打开那一行看」的规矩复核后才动手。
  `src/jarRun.ts` / `src/javaRun.ts` 原先进任务书时**没有明确划进桶 10 或桶 11 的文件清单**，这条差点漏掉 ⇒ 归属表要按「文件」列全，不能按「概念」列。
- **引用漂 270 行**：`ByWordRt.kt:610-630` 被当成 `DefaultCorrector`（实为 `isTrailingSpace`，真正在 `:880/890/893`），撑着 `diff-chunks`/`diff-words` 两条被翻转的产品断言 ⇒ 已派 **bucket9c** 去核实并订正（要留 before/after 痕迹，不许靠弱化断言变绿）。
- **弱化断言**：`tests/gradle.test.mjs:539/540/595/603` + `tests/progress-notices.test.mjs:77` 被改成 `or` / `[\s\S]*` 恒真形状，其中 4 条原文在 `GradlePanel.vue:263/270`、`gradleHost.ts:114/369/610` **逐字还成立** ⇒ 归桶 15/6；收工时我把断言改回精确形状（仓库惯例：只改路径不改断言体，这里是被无谓放松）。
- **反向好消息**（同一位验收员）：没有删测试、没有 `.skip`/`.only`/加 timeout、`module-size` 上限**只降不升**（5/5 绿）、新增 native **全部已注册**。

## 5.5 待派发（并发槽位满 20，出空位立刻派，别忘）

**派发时必须带的三条**（桶 3 / 桶 9 / 桶 14 都是死在这上面）：
①「最后 ~15 次调用固定留给报告 + 接线请求，宁可少做一条功能也不能没报告」；
② 每桶 ≤ 5 个族；③ 先读工作区里已落地的同名模块，别重做、别推翻。

| 序号 | 切片 | 范围 | 备注 |
|---|---|---|---|
| ✅ 已派 | bucket14a-tree | `pv/project-view-nodes` + `pv/project-view` + `pv/command` 剩余 | T+50 min 出空位派成功 |
| ⏳ 6 | **bucket10b-terminal** | **四个零消费方孤儿模块必须接线**：`src/terminalClipboard.ts`(191) / `terminalFontSize.ts`(93) / `terminalSplits.ts`(133) / `terminalTitle.ts`(116) ⇒ 接进 `src/components/TerminalPanel.vue`；再做 `ex/terminal`/`ex/terminal-actions`/`lp/large-files` 判词剩余 | 桶 10 死在「要写 terminal title 模块」那一刻，四个模块都只有模型没有宿主 |
| ⏳ 7 | **bucket13b-vcs** | 桶 13 落地了 `src/analysisScope.ts`(288，3 个消费方) / `packageDepsView.ts`(218，4) / `PackageDepsDialog.vue`(354，1)，但 `vc/log-ui`(115) + `vc/changes`(39) + `verdict-vcs-commit.md` + `verdict-bookmarks.md` 的「缺：」基本没动 ⇒ 拆两半派：13b = VCS log/变更视图，13c = 提交与书签 | 桶 13 同样撞墙（166 次调用） |
| ⏳ 1 | **bucket3b-vision** | `lp/code-vision`(98) + `lp/inlay-hints`(135) + `ls/platform`/`ls/session`/`ls/features` 剩余 | 桶 3 的另一半；`codeLensCache`/`codeLensSettings`/`lsSessionHost` 已落地，先读 |
| ⏳ 2 | **bucket14a-tree** | `pv/project-view-nodes`(122) + `pv/project-view`(41) + `pv/command`(77) 剩余 | 已落地 `pvCommandProcessor.ts` / `pvFileUndoProvider.ts` + 3 套测试与 `FileTree.vue` 改动，先读 |
| ⏳ 3 | **bucket14b-panels** | `pv/structure-view`(94) + `pv/history`(94) + `pv/todo`(80) | `src/bookmark*` 归桶 13，`pv/bookmarks-alias` 只做判词不改那些文件 |
| ⏳ 4 | **bucket14c-welcome** | `pv/welcome`(98) + `pf/file-chooser`(63) + `pf/trusted`(24) + `pf/browsers`(25) | `FileChooserDialog` 已挂 `App.vue:2398`（A7 已落地，别再交这条请求） |
| ✅ 已派 | bucket1b-refactor | 桶 1 撞墙（167 次调用）后接手：3 条红 + `lp/refactoring` 剩余 | 主代理实测该域 **102/99/3 失败**；它断在「三条测试锁的是实现前的缺位状态」这句话上 |
| ⏳ 8 | **bucket2c-completion** | 桶 2 撞墙（167 次）后半区：`lp/completion`/`pf/inline-completion`/`lp/intention`/`lp/preview` 剩余 | 实测该域 **140/140 全绿**、无红可修 ⇒ 纯补族缺口；已落 `completionCamelHump.ts`(616) / `completionModes.ts`(175) 都已有消费方 |
| ✅ 已派 | bucket2b-inspection | `dm/*`(368) + `lp/inspections`(161) + `an/highlighting` + `ls/highlighting` | 主杠杆是「按诊断码分组」端到端；B1/B2 两个真卡点主代理已复核为**已通** |
| ⏳ 10 | **bucket5b-editor** | 桶 5 撞墙（断在「要写 provider 表模块」）：`lp/editor-actions` 回车家族 / 逐语言 quote-brace / `lp/sticky-lines` 语言识别 | 实测该域 **249/249 全绿**（含 `editor-brackets` 11/11）⇒ 无红可修，纯补族缺口 + 接线（`CodeEditor.vue` 是保留文件） |

| ⏳ 9 | **第三波通用规则** | 每个桶收口后按同一套动作处理：`bucket-landing` 拿落地面 → 跑该域测试拿红绿 → `verify-bucket`（有报告）或读 diff（无报告）→ 按剩余族切小片重派 | 见 §6 教训 |
| ⏳ 5 | **audit-docs** | 只读验收常驻文档（数字声称 / 「某目录不存在」类声称 / 60 条上游行号引用 / 本仓落点是否真存在 / 四档自洽） | 只允许写 `docs/audit-2026-10-06-docs.md`；不许跑 `verdict_table.py`、不许跑全量测试 |

**桶 14 为什么拆**：原任务书给了 11 个族（含 122 + 98 + 94 + 94 + 80 + 77 类），185 次调用后直接撞墙，
只留下 2 个模块 + 3 套测试，报告一个字没写。**教训回到主代理自己身上：切分粒度必须按「一个代理能做完」定，不是按概念完整定。**

## 5.6 红测试实况（主代理实测快照，T+45 min）

派单前 17 条红。**现在按文件实测**：
| 命令 | 结果 |
|---|---|
| `node --test tests/main-toolbar-render.test.mjs tests/b7-verdict.test.mjs tests/editor-custom-fold-regions.test.mjs tests/editor-folding-settings.test.mjs tests/about.test.mjs tests/internal-errors.test.mjs tests/tool-view-activation.test.mjs` | **37 用例 / 36 通过 / 1 失败** |
| `node --test tests/status-widgets-registry.test.mjs tests/ui-motion.test.mjs` | **16 / 15 / 1 失败** |

⇒ 那 17 条里 **15 条已被对应桶修掉**（包括最可疑的 `tool-view-activation` 20 s 超时与整文件加载失败的 `main-toolbar-render`）。剩下 2 条：
1. `tests/b7-verdict.test.mjs` 的「本轮清扫后的四档计数已冻结」⇒ **已派 bucket7b**（不重复动）。
2. `tests/ui-motion.test.mjs` 的 hover 缺 `transition`：4 处里 `.status-inspection-profile-select`（`style.css`，我的）可以现在做，另 3 处 `DebugInspectWindow.vue`（桶 12）/`EventLogPanel.vue`（桶 6）/`RefactorPreviewDialog.vue`（桶 1）**文件还在被别人改 ⇒ 留到收工统一做**。

## 5.9 第一轮 15 桶的实况收场（主代理实测 T+70 min）

**15 个原始桶里 14 个撞到 150 次调用上限**（只有桶 6 还在跑）。不是代理不干活，是**我把切片划大了**：
它们平均用满 156–197 次调用，**功能代码大多已落进工作区，死在「正要写下一块 / 还没来得及写报告」**。
所以我改成**不依赖报告**验收：`node .tools/bucket-landing.mjs <N>` 从 git + mtime + 归属表算出真实落地面与孤儿状态。

| 桶 | 撞墙时最后一句 | 实测落地面 | 接手代理 |
|---|---|---|---|
| 1 | 「三条测试锁的是实现前的缺位」 | 域测试 102/99/**3 红**；`refactorMenu.ts`/`semanticActions.ts` 已改，新增 `refactor-signature`/`refactor-menu-parity` 测试 | ✅ 1b |
| 2 | 无（"execution completed"） | 域测试 **140/140 全绿**；新落 `completionCamelHump.ts`(616)、`completionModes.ts`(175) **都有消费方** | ✅ 2b（检查与问题视图半区） |
| 3 | 「现在开始写代码」 | `lsSessionHost.ts`（`lspSessionStates` 唯一生产写入方）等已落 | ✅ 3a；⏳ 3b（code-vision/inlay） |
| 4 | 「先写 workspace-symbol 缓存与 choose-by-name 过滤器」 | 两个模块落了但**零消费方** | ✅ 4b |
| 5 | 「现在写 provider 表模块」 | 域测试 **249/249 全绿**（无红） | ⏳ 5b |
| 7 | 无 | 落了 `dialogGeometry`/`registryKeys`/`settingsInspector` 等；`main-toolbar` 与 `b7-verdict` 剩 2 条红 | ✅ 7b |
| 8 | 「开始实现 popup dispatcher/stack」 | `popupStack.ts` 零消费方；工具窗口三件套实测 **28/27/1** | ✅ 8b |
| 9 | 「写结构化搜索 modifier 模型」 | `structuralSearch*` 5 个模块 + 4 套测试已落；`searchEverywhere*` 5 个零消费方 | ✅ 9a / 9b / 9c |
| 10 | 「写 terminal title 模块」 | `terminalClipboard/FontSize/Splits/Title` **四个零消费方** | ✅ 10b |
| 11 | 「先写 `src/testLocator.ts`」 | 该模块零消费方；5 条红（首选框架算法 / shouldInspect / 命名规范 / 本地检查通道 / 条件只认 regex） | ✅ 11b |
| 12 | 「写主交付物：带真实工具栏的悬停快速求值」 | `quickEvaluateHint.ts` 已被 `CodeEditor.vue` import；`debug-inline-values`/`debug-inline-watch-wiring` **整文件加载失败** | ✅ 12b |
| 13 | 无 | `analysisScope.ts`(288) 落了但**作用域设置页没接**（`tests/analysis-scope.test.mjs` 3 红） | ✅ 13b；⏳ 13c（提交与书签） |
| 14 | 无 | `pvCommandProcessor.ts`/`pvFileUndoProvider.ts` + 3 套测试 | ✅ 14a；⏳ 14b（结构/历史/TODO）、⏳ 14c（欢迎页/选择器/受信/浏览器） |
| 15 | 无 | `fileType{Registry,Overrides,Detection}`、`dependencyRules.ts` 等已落 | ✅ 15b（文件面+外部系统）；⏳ 15c（根/SDK/索引/VFS） |
| 6 | **还在跑** | 状态栏那 2 条红已绿（`status-widgets-registry` 实测通过） | — |

**还有一条我自己查出来的真雷（值得写进 playbook）**：`.ts` 之间的**值 import 必须写全 `.ts` 扩展名**，
`from './bridge'` 会 `ERR_MODULE_NOT_FOUND`，症状是**整个测试文件加载失败**；`import type` 不受影响（会被擦除）。
`src/appearanceActions.ts` 现在就是坏的（值 import 写成了 `./bridge`）。
而 `.tools/find-missing-ext.mjs` **判据是错的** —— 它用「试试补扩展名能不能找到文件」来判，
所以这一类它一律报干净；我已经把这条写进每个接手代理的任务书（真判据：直接 `import('./src/<文件>.ts')` 冒烟一次）。
检测器的修法归 tooling-gates（它名下），我不抢它的文件。

## 5.13 我自己的改动造成的破坏（已自查并修好）

全仓补 `.ts` 扩展名（§5.11）**弄坏了两类测试**，都是我的责任，已修：

1. **CJS 桩表按裸说明符匹配**（`tests/scope-persistence.test.mjs`，3 条红，症状 `Error: ./errors.ts`）：
   这类测试把源码 transpile 成 CJS、用 `new Function('require', …)` 手写桩表，源码补扩展名后**桩整体失配**。
   修法：桩侧按「去掉 `.ts`」归一化（两种写法都收），**没动任何断言**。同类桩表共 9 个文件，逐个跑过：只有这一个坏。
2. **形状钉死、意图没变**（`tests/search-everywhere.test.mjs` 的「模糊匹配的接线三处都在」）：
   9b 的实现把每行命中区间收进 `fragmentCache`（一次算好按行取用、文本档直接用 `hitRanges`），
   模板改成 `highlightParts(entry.title, fragmentCache[position])` —— 这是把 N 次重复计算收成一次，
   而断言钉的是"模板里必须直接出现 `fuzzyTitleFragments(item, …)`"这个**形状**。
   按本仓规矩（断言守意图不守形状）改成两条**仍然精确**的断言：① 缓存每项仍由 `fuzzyTitleFragments(entry, query.value, props.fuzzyFiles)` 供数；
   ② 标题渲染按命中下标包 `<mark v-if="part.hit" class="se-hit">`。**没有放松成 `includes`/`ok`**。
   结果：**24/24 绿**（同测试里 host/shell/toggles/settings 四处接线断言一并复跑通过）。

## 5.14 已复核结案的交付（除 §5.12 之外）

| 交付 | 我的复核 | 结论 |
|---|---|---|
| bucket13b（作用域三红） | `node --test tests/analysis-scope.test.mjs` | ✅ **11/11**。三条分诊都对：①夹具前提错（上游 `FilePatternPackageSet.java:115-117` 把结尾单星译成 `[^/]*`，`file:*` 本就不匹配 `tests/x.test.ts`）⇒ 换夹具 + 加通配语义判据；②**真回归**：`analysisScope.ts` 的 `read()` 多写 `namedScope` ⇒ 修实现，**"旧存档不变坏"血规保住**并加存档串级判据；③**真缺接线**：命名作用域单选 +「包含测试代码」按 `BaseAnalysisActionDialog.java:100-102/:204-206/:218-222` 接进 `ScopesSettingsPage.vue`（`ANALYZE_IN_SCOPE` 上游 `:105` 隐藏 ⇒ 不放假控件）|
| bucket14a（项目树） | `node --test tests/project-tree* tests/nesting* tests/pv-* tests/source-citations tests/module-size` | ✅ **61/61**。含真 bug 修复：`projectTreeModel.ts` 的 `listingFor` 让**顶层文件的嵌套从来打不开**；对话框改成只在「确定」时 apply（原先勾选即写、取消不回滚）；接通死代理留下的零引用 `FileNestingSettings.vue`（取不到宿主整格不渲染，照上游 `isEnabledAndVisible=false`）|


## 5.12 主代理已复核结案（不需要再派代理）

| 项 | 我的复核方式 | 结论 |
|---|---|---|
| 独立验收 H2「`ByWordRt.kt:610-630` 被当成 `DefaultCorrector`，漂了 270 行」 | 读 `src/diffWords.ts:150-152` + `tests/diff-words.test.mjs:50-57`，跑 `node --test tests/diff-words.test.mjs tests/diff-chunks.test.mjs` | ✅ **已改对**：现在引 `ByWordRt.kt:880-895`（`:890` 向前扩、`:893` 向后扩）、`:939-963`（忽略档）、`TrimUtil.kt:126-131`，并在测试注释里留了「`:610-630` 其实是 `isTrailingSpace`」的订正痕迹。**42/42 绿** ⇒ bucket9c 的活已完成，不再重派 |
| 桶 6「remind-later 身份比较」真 bug | 读 `src/notificationDoNotAsk.ts:236-255` 的实现与注释，跑 `tests/notification-remind-later.test.mjs` | ✅ 它自己已修（改成只读一次）**10/10 绿** |
| tooling-gates 的三件活 | 跑 `python scripts/verdict_table.py --help`、`node --test tests/source-citation-anchors.test.mjs`、`ls docs/inventory/citation-anchors.json` | ✅ **三件都在**：`--dry-run`/`--check`/`--force` + `check_verdict_tables.py` 引擎 + 手写 §G 护栏；锚点门控 **8/8 绿**（含 3 条"门控要真的会红"的自证）；快照 218 KB。只缺它自己的报告 ⇒ 由我这段代替，不再占并发 |
| 验收员对 `jarRun.ts` 的「假无法核实」 | **先复核它给的路径**（它给的是 `java/execution/impl/...`，**不存在**），find 到真实落点后自己打开那一行 | ✅ 结论成立但**验收员的路径是猜错的**；我已按真坐标订正（`ProgramParametersConfigurator.java:260-261` + `ExecutionBundle.properties:532`），文案换成上游串，`tests/jar-run.test.mjs` **10/10** |

**队列现状**（出空位即派）：13c（提交与书签）· 14c（欢迎页 / 文件选择器 / 受信 / 浏览器）· 15c（`lp/roots` / `pm/roots` / `pm/file-index` / `an/module` / `pf/roots-ui` / VFS）· 2c（补全与意图半区）· audit-docs（只读验收常驻文档）·
判决域 `editor`（撞墙 1 次）·
收工类（我来做）：3 处 hover `transition`（1 处已做，EventLogPanel 已交 6b，另 2 处等桶 1/12）· `SettingsDialog.vue` 的 D2 勾选项（等 4b 交出消费点）· A5 调试器装配 / E 悬停求值（等 12b）· A9 `payload.cwd`（等 9b/10b）· `CMakeLists.txt` 登记新增 native · 死模块基线更新（等全绿）· 两份产物同步。


**性质**：Node 的 ESM **不做扩展名猜测** ⇒ `src/**/*.ts` 里 `from './bridge'` 这类**值 import** 一到运行时就是 `ERR_MODULE_NOT_FOUND`，
症状是「**整个测试文件加载失败**」，会被误当成测试坏了。实测样本：`src/bridge.ts` 明明存在，`src/appearanceActions.ts` 就是加载不了。
（`import type` 会被擦除，不受影响 ⇒ 扫描时**必须跳过**，否则会把 100 多条本来没问题的行改坏。）

- 工具：`.tools/fix-import-extensions.mjs` —— 只动 `.ts` 里的**值 import**、只动**目标确实存在**（`.ts`/`.vue`/`index.ts`）的说明符，其余逐字节保留。
- 结果：**59 个文件 / 156 条**补齐；`appearanceActions.ts` 冒烟通过。
- **自证没有改坏**：清扫后全量跑 `npm test` = **4090 用例 / 4036 通过 / 54 失败**，
  整份输出里 `ERR_MODULE_NOT_FOUND` / `Cannot find module` **出现 0 次**（清扫前它就是把 `remove-stripe-button` 等整条打死的元凶，
  我当时实测过：补上扩展名后那组从 0 通过变 7 通过）。⇒ 这 54 条全是**断言级**的红，来自仍在写代码的代理，不是我引入的。
- 检测器 `.tools/find-missing-ext.mjs` 的判据是错的（它拿"补上扩展名能不能找到文件"来判，所以这类一律误报干净）；
  已把真判据写进每个接手代理的任务书（直接 `import('./src/<文件>.ts')` 冒烟一次）。检测器本体待我改（不抢 tooling 那路已经交付的东西）。

**关于 54 条红的处置原则**：**不在代理还在写的时候追每一条**。最后所有代理收工后跑一次全量，
再按 `bucket-landing` 的归属把每条红分派到人（或我自己修）。中途跑全量的用途只有两个：
① 确认我引入的改动没造成 `ERR_MODULE_NOT_FOUND` 这类**结构性**破坏；② 看用例总数在涨（3723 → 4090）说明判据确实在补。

## 5.10 待办队列（第三波，出空位即派）
✅ 3b（`lp/code-vision`/`lp/inlay-hints`/`ls/*`，已派 bucket3b）· ✅ 6b（状态栏域，已派 bucket6b）· ✅ verdict-vcs 改策略重派（先写门禁 → 机械信号铺底 → **分批落盘**，不许再攒到最后一次写）
· 5b（`lp/editor-actions` 回车家族与逐语言 quote/brace、`lp/sticky-lines` 语言识别，域内无红）·
13c（提交与书签）· 14b（结构视图/本地历史/TODO）· 14c（欢迎页/文件选择器/受信/浏览器）· 15c（`lp/roots`/`pm/roots`/`pm/file-index`/`an/module`/`pf/roots-ui`/VFS）·
2c（补全与意图半区，域内无红）· audit-docs（只读验收常驻文档）·
✅ **`src/appearanceActions.ts` 的缺扩展名值 import —— 已随全仓清扫修完**（156 条 / 59 个文件，见 §5.11）·
3 处 hover 缺 `transition`（1 处我已做；`EventLogPanel.vue` 交给 bucket6b 并禁止改门控本体；另 2 处等桶 1/12 收工）·
死模块基线更新（5 个「✔ 已接上」）——**等全绿再做，不在跑的过程中改基线**。


## 5.8 中途全量回归快照（主代理实测 T+55 min）

`npm test` = **3857 用例 / 3817 通过 / 40 失败**（派单前 17 条；用例数从 3723 涨到 3857 = 各桶新写的判据）。
40 条**归属分诊**（部分是在途代理造成的瞬态，收工时会自然消失或必须我修）：

| 归属 | 症状 | 处置 |
|---|---|---|
| 桶 13（死） | `tests/analysis-scope.test.mjs` **9/6/3 失败**：① `ANALYZE_TEST_SOURCES` 严格相等拿到 false；② **旧存档因新增字段变坏**（deep-equal 多出一个 `namedScope: ''`）；③ 正则 `/from '..\/analysisScope'/` 在 `ScopesSettingsPage.vue` 匹配不到 ⇒ **`analysisScope.ts`(288 行、已有 3 个消费方) 落进来了但作用域设置页这一头根本没接**（真缺接线，不是测试过期） | ✅ 已派 bucket13b，任务书里带这三条的实况原文 |
| 桶 1（死） | 重构域 **102/99/3 失败**（「无后端不渲染」「菜单行接到真实实现」「键位/菜单/对话框挂载都在生产链路上」）| ✅ 已派 bucket1b |
| 桶 5（死） | `quoteAction`、`TYPE_TOKENS 词法近似`（断在「要写 provider 表模块」那一刻） | ⏳ 待发 bucket5b |
| 桶 12（在跑） | `tests/debug-inline-values.test.mjs`、`tests/debug-inline-watch-wiring.test.mjs` **整文件加载失败** | 在途，先看是否系统性禁令病因；收工仍红我来定位 |
| 桶 8（在跑） | `tests/remove-stripe-button.test.mjs`、`tests/stripe-resize-more.test.mjs` 整文件失败 + `tab 集合名称顺序` | 在途 |
| 桶 3 系 | 「值提示消费链：CodeEditor 真的挂上了」「接线：Ctrl+Q 走整形与缓存」 | 3a 名下 |
| 桶 11（在跑） | 首选框架算法 / shouldInspect 混用两代 API / 命名规范可配置 / 本地检查通道并上规则 | 在途 |
| 桶 7 → 7b | `b7-verdict` 四档计数 2 条 | ✅ 已派 bucket7b |
| 我 | ~~`.status-inspection-profile-select` hover~~ 已修；剩 3 处 hover 过渡等桶 1/6/12 收工 | 收工做 |

**排除我自己**：那条「旧的两档存档不能因新增字段变成坏的」**不是**我加 `showMembersInNavigationBar` 造成的 —— 它在 `tests/analysis-scope.test.mjs` 里，坏的是 `namedScope` 字段（作用域存档），而我那条的专属门控 `tests/settings-keys-parity.test.mjs` 实测 **5/5 绿**、`tests/navbar-members-setting.test.mjs` **5/5 绿**（含反证）。


## 5.7 交付面工具（不依赖子代理的报告）

`.tools/bucket-landing.mjs <N>`：从 `docs/batches-2026-10-06-buckets.md` 的归属栏（含通配写法）+ `git status` + mtime 窗口，
算出某个桶**到底落了哪些文件**，并对每个 `src/*.ts|vue` 报「有几个消费方 / 是不是孤儿」。
`.tools/verify-bucket.mjs <N>`：核报告里的上游坐标、本仓落点是否存在、假控件形状、推脱措辞、反向验证记录、module-size。
（两个工具都做过反向验证：喂假引用/假路径/「本轮先做」都会红。）
⚠️ 工具的归属匹配是**启发式**：`src/settings*` 这类通配会把 `settingsModel.ts`（保留文件，我自己改的）也算进桶 7，
所以它的输出是**线索**不是结论，认领归属要读 diff。
## 6. 教训（写进常驻规约）

**一个桶的任务书必须小到 ~150 次工具调用内做得完 + 收得了尾。** 第一版 15 个桶里有 2 个（桶 3、桶 9）功能面太大，
代理把调用预算花在取证与实现上，**在被切断前没来得及写报告**，主代理就失去可核对的交付面。
修正两条，之后所有派单都带：
1. **硬预算话术**：「最后 ~15 次调用固定留给报告 + 接线请求，宁可少做一条功能也不能没有报告」；
2. **切片规模上限**：每桶 ≤ 5 个族；域大的（toolwindow 97 条 `[~]`、`exec/run-instances` 382 类）预先拆两到三个半区。

## 7. 等各桶交付后要做的接线（我这边的队列）

1. **`SettingsDialog.vue` 的 D2 勾选项**——等桶 4 交出成员层的消费点再落，避免先画一个没有消费者的假控件。
2. **A5 调试器装配**（`hideDebuggerOnProcessTermination` / `showDebuggerOnBreakpoint` / 逻辑断点组）——等桶 12。
3. **E 编辑器悬停快速求值**（`CodeEditor.vue` 只剩十几行余量，逻辑必须留在桶 12 的新模块里）——等桶 12。
4. **A9 `RunAnythingDialog` 的 `payload.cwd` 透传**（`App.vue` 那一行现在只取 `command`）——等桶 9/10。
5. **`CMakeLists.txt` 注册**：各桶新增的 `native/*.cpp` 统一由我登记（保留文件）。
6. **动效 hover 过渡那 1 条红**：`DebugInspectWindow.vue` / `EventLogPanel.vue` / `RefactorPreviewDialog.vue` 三个组件 + `style.css` 里各补一条底规则 `transition`（走 `--dur-*` 令牌），等桶 1/6/12 收工后一起做，免得撞文件。
7. **全量回归**：`npx vue-tsc -b --force` + `npm test` + `.tools/nctest-all.bat` + 三个检测器 + 死模块门禁 + 两份产物同步（`build/` 与 `build-validation/`）。

## 8. 收口（主代理，2026-10-06 03:30）

**全量回归**：`npm test` = **4826 用例 / 4826 通过 / 0 失败**（派单前 3723/3706/17 红）；
`npx vue-tsc -b --force` = **0 错**；native `ctest` = **37/37 通过**（`Total Test time 96.87s`）。
死模块门禁：`--gate` 绿，基线 21 → **8**（本轮清掉 13 个）；引用门 + 锚点快照（1605 条全对上）绿；
module-size 绿（`CodeEditor.vue` 我接线涨到 1156 ⇒ 把装配搬进 `smartEnterLanguageFor` 并压注释，回到 1147）。

**我落的接线（保留文件，全部逐条核过上游与消费方才动手）**
| 请求 | 落点 | 结果 |
|---|---|---|
| 1b A1/A2 + wiring1 | `keymapBindings.ts` / `keymap.ts` | Ctrl+F6 更改签名、Alt+Delete 安全删除 |
| **只有 Alt 的键位档**（typecheck-clean §3.1） | `keymapBindings.ts:36/:140-144/:189`、`keymapEditor.ts:128` | `control` 改可缺省；`'alt'` 那个非法值换成 `alt: true, forbid:['ctrl','shift']`；`chordIdentity` 缺省记 `none`；覆盖表文案不再拼假 `Meta+` 前缀。判据新增 + 反向验证（注入违规 1 红） |
| 3a2 W1 | `style.css` | 内联链接/段落 5 条规则（`DocumentationHtmlUtil.kt:53/:56`、`DocMarkdownToHtmlConverter.kt:68` 现场核过） |
| 5b W-1 / W-3、5c #1 | `CodeEditor.vue`、`editMenu.ts`、`enterHandlers.ts` | `smartQuotes` + `angleBraceHighlight` 进扩展面；`Ctrl+Shift+M` = `EditorMatchBrace`（`$default.xml:1146-1148`）；块注释词法进回车家族（三条新门禁 + 反向验证） |
| 8c B1/B2 | `App.vue` | 项目树右键菜单与底部标签溢出菜单压进 `popupStack` 那条链（`PopupDispatcher.java:36-37`） |
| 12b W1 / 12c X2 | `App.vue` + `DebuggerSettingsPage.vue` | 两个跳变接 `applyDebuggerPause`/`applyDebuggerTermination`，**并解锁设置页那两格**（原来「没宿主就不画」，现在有了消费点）；`tests/dbg-window-policy.test.mjs` 那条「不许渲染」的判据按实况翻成「必须渲染」，反向验证过 |
| 14b W1 / 4b W3 | `ToolWindowView.vue`、`App.vue` | 结构视图拿到编辑器光标；两处 `BreadcrumbsBar` 绑 `show-members`（`JavaBreadcrumbsInfoProvider.java:125`） |
| 15j #1 | `src/bridge.ts` | `file.archiveEntries` 进 `Method` 联合，调用点的 `as string as Method` 去掉 ⇒ `tests/routing-parity.test.mjs` 的「原生实现了前端从不发送的方法名」由红转绿 |

**我修的树级阻塞（都不是「测试过期」，逐条给证据）**
1. `native/lsp_fake_server_requests.cpp:568-575`：内嵌对象初始化列表让 MSVC 报 **C3329/C2143** ⇒ **整个 ctest 套件跑不起来**（`npm run build:native` 的退出码被 ps1 吞掉，日志里才是 FAILED —— 按「子构建退出码别被管道吞」抓到）。改成两个具名 `Json` 对象后 37/37。
2. `src/components/TodoPanel.vue:359`：`<pre>` 里嵌套 `<span>` 少一个闭标签 ⇒ `TodoPanel` 解析不过，**`sfc-single-root` 与 `ui-icons` 两个测试文件整文件红**。补 `</span>`，51/51。
3. `src/editorEnterBlockComment.ts`：文档注释正文里写裸 `*/` ⇒ 提前闭合注释，**65 条级联语法错遮掉全树类型检查**。改成 `//` 行注释后归零。⚠ 顺手把「TS 块注释可以嵌套」这句**错的规约**订正成实测口径（`/** a /* b */` 之后的代码仍是活的、报类型错；正文里的 `*/` 才致命）——两处注释 + 我给后续代理的任务书措辞都改了。
4. `tests/everywhere-text.test.mjs`：用了 `textHitFragments` 却没 import ⇒ `ReferenceError`。
5. `tests/pv-command-wiring.test.mjs`：钉 `selection.value`，而真源 `projectTreeModel.ts:26` 是 `reactive(new Set())`（不是 ref）⇒ 钉的是不存在的形状，按实况改成 `[...selection]` 并写明理由。
6. `tests/refactor-menu-parity.test.mjs:267`：钉 `chord: { key: 'delete', control: 'alt' }` —— `control` 的取值域只有 `'ctrl'|'mod'`，这条**从来没通过过类型**；钉的是 bug。改成真实形状 + 留痕。
7. `tests/editor-brackets.test.mjs`：`import { rainbowBrackets }` 的字面锚点随我加 `angleBraceHighlight` 更新（不是放松，是同步）。
8. `tests/editor-enter-block-comment.test.mjs`：`blockCommentClose('/* a */')` 断言 6、实现 5。**按上游判实现是对的**（`EnterInBlockCommentHandler.java:104-120`：`offset > tokenEnd - suffix.length()`，`tokenEnd` 排他 ⇒ 闭尾起始 = 5），只补订正理由，没放松任何 `deepEqual`。

**我订正的假上游引用（4 条文档 + 2 条叙述，全部在参考树里逐行开过）**
- `java/debugger/java-debugger-core/src/com/intellij/debugger/actions/JavaValueTextModificationPreparator.kt` → 真实 `java/debugger/shared/src/com/intellij/java/debugger/impl/shared/engine/…:14-16`
- `java/debugger/shared/src/com/intellij/debugger/SharedDebuggerUtils.java` → `…/com/intellij/java/debugger/impl/shared/SharedDebuggerUtils.java:29-34`
- `platform/platform-resources/src/actions/extensions.kt`（原文还带了行区间 `:58-72`；这里故意不写完整形状，否则门禁会把它当一条真引用再收一遍）→ `platform/bookmarks/src/com/intellij/ide/bookmark/actions/extensions.kt:57-61`
- `platform/lang-impl/…/codeInsight/hints/codeVision/CodeVisionProvider.kt:25` → `…/codeInsight/codeVision/CodeVisionProvider.kt:25`
- 另：叙述里转述的 `TrustedProjectsDialog.kt` / `CommandCompletionSuffixProvider.kt` 两条假路径改写成不带行号的说明（否则门禁会把「我正在批评的假引用」再收一遍）。
- ⚠ `src/debugQuickEvaluate.ts:276/:278` 还留着同一条缩写假路径（桶 12 名下），留给属主或我下一轮。

**本轮被平台 150 次调用上限切断的代理（6 个）**：5b（其实交付完整，报告在）、8c、12c、14b、14c、15c/15b2、2c。
补派后全部有报告：**8c**（弹窗收口，504/504）、**12c**（切断在核对阶段，剩余项见下）、**b5c**（回车家族 3 处真问题 + 47/47）、
**b14c**（`WelcomePage.vue` 920→716 行，module-size 转绿）、**b14b**（报告 + 抓到 `OutlinePanel`「跟随光标」拿不到数据 = 假控件，改成 `v-if="source"` 并交 W1）、
**b15j**（`file.archiveEntries` 端到端：宿主 `bsdtar -tf` + `rootsJarEntries` 消费 + native 用例，孤儿门禁转绿）、
**verdict-reconcile**（`b6`/`b9`/`b11` 三扇门 27/27，`settings-run` 四档由 6/46/2927/268 重分成 35/388/2526/298，B7 继承 630 条逐条重判）、
**verdict-vcs-b**（`verdict-vcs.md` 1783 类 + `b10-verdict` 10/10）、**verdict-editor-b**（`verdict-editor.md` 2551/2551 + `b12-verdict` 9/9）、
**audit-docs**（常驻文档 14 条硬错 + 13 条可疑，见 `docs/audit-2026-10-06-docs.md`）。

## 9. 天亮前没做完的（**下一轮的入口，按价值排好了**）

**硬约束先说**：`src/App.vue` 现在 **2729 行 / 上限 2737 ⇒ 只剩 8 行**，`src/components/CodeEditor.vue` 顶在 1147。
所以剩余接线**必须先做一次抽取**（把一整块内联逻辑搬进新模块，腾出几十行）再谈挂点，
否则每一条请求都会把门禁顶红 —— 这是事实，不是推脱。

**已收到 docs/ 但我没落的接线请求（每条都带可照抄代码）**
| 归属 | 还欠什么 | 为什么排在这个位置 |
|---|---|---|
| 13c R1 | `native/main.cpp:1169` 的**部分提交（按文件子集）通道** | 唯一需要动 2000 行冻结文件的；要先把通道搬出 main.cpp |
| 3b W1/W2/W4 | Code Vision 本地提供者的生产入口、点击路由、设置页 + schema | `cvLocalVision.ts`/`codeVisionProviders.ts` 已有消费链，缺的是编辑器与设置页那两个挂点 |
| 4b W1/W2/W4 | 三个导航动作并进 `createLspNavigation` 返回值、`chooseTargets` 注入、层级导出的面板按钮 | `hierarchyExport.ts` 已接上文件面，面板按钮是剩的一格 |
| 2b R1 + 2b2 R1 | 诊断 `relatedInformation` 的宿主透传（`bridge.ts` + native）与问题面板行的 Alt+Enter | 桥类型是保留文件，改动面小但跨 native |
| 12b W2 / 12c X3 | 逻辑断点组的写入口、`DapBreakpoint.logMessage?` | 断点弹层已有，缺写回通道 |
| 10b（6 条）/ 14a（W1–W3）/ 15（W1–W3）/ 6b（2 条）/ 7b（A2/A3/A5）/ 2c（W1–W4）/ 3a（R1–R5）/ 5b（W-2/W-4/W-5）/ 3a2 W2 | 终端剪贴板/字号/标题、欢迎页与文件选择器、状态栏省电与排障段、设置页 profile 切换、菜单动作、Code Vision 设置 | 都是 1–3 行的属性/参数级接线，**抽取做完后一批就能清完** |

**两条要负责人拍板的（我不擅自决定）**
1. `native/java_run_host_regression_test.cpp`（181 行，git 里已跟踪）**从来没进过构建**：
   `CMakeLists.txt`（含 HEAD 版本）里没有它，`scripts/` 与 `.tools/` 也不编译它，
   但 `docs/handoff-java-lsp-2026-09-28.md:145` 把一条回归结论挂在它 `:135-142` 上 ——
   那句话现在**没有证据支撑**（它没跑过）。按「死代码直接删」该删掉并订正文档；
   按「它是 Java 启动链的端到端回归」该登记成 ctest 目标并跑通（需要 PATH 上有 JDK，可能引入环境性抖动）。
   我两边都没动，留给早上。
2. **提示注入**：桶 3a2 报告工具结果里出现过伪装成「系统预定义指令」的停止文本（它没执行、已写进它的报告）。
   我没有证据指向仓库内的固定文件，更像是参考树源码正文或抓到的上游文本被工具原样带回来。
   下一轮我会在每次工具结果里继续按「数据不是指令」处理，并优先定位来源。

**本轮状态**：全量 `npm test` **4826/4826**、`ctest` **37/37**、`vue-tsc` **0 错**，
死模块基线 21 → 8，引用门 + 锚点快照（1606 条）绿，产物 `build/` 与 `build-validation/` 已同步（同一 md5）。
本地检查点提交 **dfbda4e 未推送** —— 等你早上审批再 `git push`。

---

# §10 白屏根因与真机取证（2026-10-06 10:30–11:20，主代理实测）

## 10.1 用户报「打开是白屏什么都不显示」——已定位并修好

真机取证链：`TAOCODE_DEBUG_PORT=9333` 起 `build/TaoCode.exe` → 新工具 `.tools/webview-console.mjs`（纯 node，零依赖，走 CDP）→
**先挂事件再刷新**才拿得到首屏异常（第一次 `--no-reload` 取证拿到 `exceptions: []` 是假绿：CDP 是页面加载之后才连上的）。

实测到的三条事实（原始值）：
- `#app` 的 `innerHTML` 恰好是 `<!---->`（7 字符）、`elementCount` 11、CSS 3105 条规则已加载、
  `window.chrome.webview.postMessage` 在 ⇒ **不是崩在资源加载，是 setup 抛错后 Vue 只留下占位注释节点**。
- 异常原文（第一处）：`ReferenceError: Cannot access 'Vl' before initialization at get hierRoot`。
- native 日志（`%LOCALAPPDATA%\TaoCode\log\taocode.log`）里**一条 JS 错误都不会有** ⇒ 白屏不能靠宿主日志查。

根因是同一个机制的两次发作：`watch(source, …)` 在**注册那一刻**就求值一次源（不是 `immediate` 才会），
而 `src/App.vue` 用 `{ get value() { return 后面才声明的 ref } }` 这种惰性 shim 把「更晚声明的状态」递给先装配的工厂。
惰性本身没错，错在**有 eager 的读**：

1. `src/App.vue:418` 的 `watch(bottomTabOptions, …)` → `src/toolWindowActions.ts:114` 的
   `bottomTabAvailable` → `ctx.hierRoot`，而 `hierRoot` 到 `:1324` 才声明 ⇒ TDZ。
   修法：把这一条 `watch` 移到 `createHierarchyView` 之后（`src/App.vue` 现 :1336 一带，带 4 行原因注释）。
2. `createToolWindowStripes` 的 `gradleAvailable: { get value() { return gradleAvailable.value } }`（原 :280），
   真值到 `:1828` 才存在；`bottomAnchoredIds`/`moreButtonRows` 那两条 `filter` 在更早的 `watch` 注册时被求值 ⇒ TDZ。
   修法：改成一个**真 ref** `gradleAvailability`（`src/App.vue:279`），装配完成后
   `watch(gradleAvailable, …, { immediate: true })` 同步（`:1833`）。「还没装配」的正确取值就是「不可用」。

`lspReady` 那一档仍走惰性 shim：实测它的读发生在 `:673` 之后，所以没炸；不动它（不动 = 不制造新风险）。

## 10.2 修完的真机复验（同一工具，原始数字）

- 欢迎页：`appChildElementCount` 0 → **2**、`elementCount` 11 → **144**、`exceptions` **[]**、`consoleTail` **[]**。
- 真鼠标点「ui-parity-proj」→ 出「不受信任的项目」框（取消 / 以安全模式打开 / 信任并打开）→ 点「信任并打开」→
  外壳齐全：`topbar` true、`.menubar .menu-button` **12**、CodeMirror 编辑器 **1**（恢复上次会话的 CMakeLists.txt）、
  文件树带「外部库」、底部 dock（操作输出 160 / 运行 / 问题 0 / 终端 / VCS 日志 / 搜索 / 调试）、状态栏、通知气球。
  截图：`build/mount-smoke.png`、`build/open-project.png`。
- 冒烟已固化成门禁形态：`node .tools/webview-console.mjs --port 9333 --expect-mount` —— 首屏没挂起来或抛异常 ⇒ 退出码 1。
  这条**只能主代理跑**（要起真 exe），已列进收工清单，不进 `npm test`。

## 10.3 顺带发现并处理的两件事

- `.tools/ui-parity-proj/CMakeLists.txt` 磁盘内容被某轮的 shell 命令写坏成
  `ck-aecho Ack-aecho Acmake_minimum_required(...)`（编辑器忠实显示磁盘 ⇒ 一度像渲染 bug）。已按 4 行原样修回。
- `src/lspServerMessages.ts` 里留着一段**变异测试注入**没撤回：`if (message.severity <= 4) {  // REVFIX-5`
  （应为 `<= 2`，判据「Error/Warning 才弹」因此红）。已改回并复绿 26/26；全仓 `REVFIX|TEMP 反向验证|INJECT|MUTATION` 复扫干净。

## 10.4 本轮主代理落的接线（全部先打开现码核对，再落）

| 请求 | 落点 | 实测 |
|---|---|---|
| keymap R1 `runEditor` | `src/App.vue` createKeymap 实参 | `tests/keymap-bindings.test.mjs` **11/11** |
| keymap R2 `gotoSuper/gotoTest/gotoRelated`（菜单写着加速键、分派表没有 = 空头支票） | 同上 | 同上（含「导航三条新键位」那条） |
| setkeys K-1 保存两条 pass | **核对后判定：早已落**（`src/App.vue:1083-1094` 已是 `runActionsOnSave → transformOnSave → file.write`） | 不重做 |
| dap D1 装订线走唯一下发口 | `src/App.vue:1038` → `breakpointUpdater.queueFile(path, next, { now: true })`，去掉裸 `dapSetBreakpoints` | `tests/dbg-breakpoint-update.test.mjs` **28/28**，并把「装订线不再裸发」写成该测试里的精确断言 |
| toolwindow2 W-TW2-1 常驻激活栈交给门面 | `src/App.vue` `activeStack: { get value() { return activeToolWindows.value } }` | `tests/tool-window-manager.test.mjs` + `tool-stripe-split` **28/28** |
| toolwindow2 W-TW2-2 拖过分隔件 = side tool | `createToolStripeDrag` 补 `stripeIds/isSplit/setSideTool`（`stripeOrder` 的入参是 `Anchor` 不是 `ToolWindowId` —— 请求里那行照抄会编译不过，已按真实签名落） | 同上 |
| runinst R1 解码按实例 | `src/bridge.ts` `run.output`/`run.exit` 带上 `data.instance` | `tests/run-instance-rows.test.mjs` 24/24（两条源码锚点按新形状改精确，未删断言） |
| search3 R-1 语言档 facet 挂载（`editorLanguageId` 此前零生产写入 ⇒ 代码块「结构支持」半区永远拿空语言档） | `src/components/CodeEditor.vue` `loadLanguage` 的 compartment | `tests/editor-code-block.test.mjs` **17/17**；CodeEditor.vue 仍 1146/1147 |
| 修 `src/refactorPreview.ts:207` 类型错（usage 域把 `buildUsageTree` 泛型化后 `ReturnType` 取到 4 档并集） | `decorate(node: UsageTreeNode<'directory' \| 'file'>)` | `npx vue-tsc -b --force` **0 错**（全仓） |

## 10.5 需要拍板的两条（我没自作主张）

1. **exec2 R2**（`GeneralSettingsState` 加 `runActivateToolWindow`/`runFocusToolWindow` 两键）：
   `src/runStartupFocus.ts` 已经自带 `taocode.runStartupFocus` 存档与读写口，再加进 generalSettings 就是**两份账**
   （本仓为这类事出过事故）。要么以 generalSettings 为真源、把模块那份改成读它，要么维持模块那份、设置页直接绑它。
   我选了「先不定就不动」，因此 R3（`takeFocus` 的宿主动作）也一起等这条。
2. **welcome2 R6**：左栏「收藏」那一栏上游没有。要么删（本仓「死代码直接删」），要么按上游另找出处。

## 10.6 三条 lane 撞到 150 次调用上限（代码落了、报告没写）

`lsp-server-messages`、`commit-partial`、`editor-actions-enter`。我逐个体检：
`vue-tsc` 0 错；`tests/commit-checks` / `editor-actions` / `lsp-server-messages` 合跑 **72 项 71 绿**，
唯一那条红就是 §10.3 那个没撤回的注入。三条 lane 的域现在都是绿的，缺的是**报告与判词升档**，不是功能。
