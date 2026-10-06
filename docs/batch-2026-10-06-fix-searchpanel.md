# 批 · 收拾桶 9 半途中断（代号 `fix-searchpanel`）· 2026-10-06

三处红全消：`vue-tsc` 的 3 条（SearchPanel 的 `regexMode`/`replaceGuard`）、`SearchPanel.vue` 的巨型文件红、
`src/structuralCodeBlock.ts` 的零消费方孤儿红。本批只动可改面
（`src/structural*` / `src/search*` / `src/find*` / `src/components/SearchPanel.vue` / `tests/search-*` `tests/structural-*` `tests/find-*`）。

上一代理（桶 9）中断时留的形状：它给 `src/structuralSearchPanelModel.ts` 加了
`import { captureGroupCount, validateReplacement } from './regexReplacement.ts'`（文件头注释写明是给
「按下替换按钮时的校验」用的），但**没写这两个入口/出口**，只在组件里先把调用写了出来 ⇒ 类型红；
同时落了 `src/structuralCodeBlock.ts`（316 行）+ `tests/structural-code-block.test.mjs`（107 行）却接不上消费方。
本批按上游语义把那半条链补完（**没有删功能**）、把组件拆回 900 以内、把孤儿按「死代码直接删 + 原文转接线请求」处理。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 文件:行 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| 类型/模型接线 | `StructuralSearchModelInput.regexMode`（TS2353） | `[x]` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java:1520`；`platform/lang-impl/src/com/intellij/find/impl/FindManagerBase.java:284-298`（`:289` 只在正则档展开） | `src/structuralSearchPanelModel.ts:55-67`；消费点 `:183`；组件传入 `src/components/SearchPanel.vue:237` | 补的是**校验的门**：上游那条替换串校验整块挂在 `model.isRegularExpressions()` 里，非正则档 `$1` 是字面文本，硬校验会把能用的替换串挡掉；宿主同一口径（`native/search.cpp` 的 `make_template_context`：非正则档直接返回不展开） |
| 类型/模型接线 | `StructuralSearchModel.replaceGuard`（TS2339 ×2） | `[x]` | `platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java:1533`（`isReplaceState()`）、`:1547-1552`（校验并挂到替换字段）；`RegExReplacementBuilder.java:76-78`（`validate`）、`:63-66`（组数）、`:58-59`（`No group N`）、`:71`（不查组名存在性）；文案 `platform/analysis-impl/resources/messages/FindBundle.properties:96` | `src/structuralSearchPanelModel.ts:79-89`（声明）、`:190`（`patternGroups`）、`:197-206`（`replaceGuard`）、`:284`（出口）；组件 `src/components/SearchPanel.vue:368-381`（`blockedByReplaceGuard`）、调用点 `:384` 与 `:429` | 把上一代理只写了 import 的那半条链接完：查**真正发出去**的替换串（结构化模式下是折成 `$N` 的那串），文案前缀与宿主 `validate_replacement` 逐字同句；门挂在两个替换入口（逐条替换 + 全部替换），**不**挂 `canSearch`（上游把它挂在 `myReplaceComponent` 上，查找不受影响） |
| 巨型文件 | `SearchPanel.vue` 902 行 > 900 | `[x]` | 不适用（本仓架构约束：`tests/module-size.test.mjs:22` 的 900 上限） | 搬出：`src/searchPreview.ts:112-131`（`resultLineParts`）、`src/searchReplaceOutcome.ts:1-34`（新，`incompleteNote`）；组件 `src/components/SearchPanel.vue:11,13,375-381,737` | 两块纯逻辑（结果行的行内切分、替换不完整时的交代语）按职责搬出，组件只留接线；`Part` 接口并入既有 `PreviewSegment`；断言体一字未动，只把锚点改指新文件（见 §4） |
| 零消费方孤儿 | `src/structuralCodeBlock.ts`（`CodeBlockUtil.java:110`/`:178` 的 `findCodeBlockRange`） | `[-]` 不能接 ⇒ 删除 | `platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java:108-120`（`:110` 问结构支持、`:118` 取 `Math.min`）、`:176-188`（`:178` 同一问、`:186` 取 `Math.max`）；`platform/lang-impl/src/com/intellij/codeInsight/highlighting/CodeBlockSupportHandler.java:57-66`、契约 `:47-52`；EP 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:147`；**全树唯一注册** `python/pluginResources/intellij.python.community.impl.xml:439` | 删除 `src/structuralCodeBlock.ts`（316 行）与 `tests/structural-code-block.test.mjs`（107 行）；原文逐字转入 `docs/wiring-requests-2026-10-06-searchdiff.md` W-1 | 具体理由见 §6 第 1 条：唯一消费者在 `src/editorCodeBlock.ts:148-150` + `src/editorCommands.ts:176`，两个文件都不在本批可改面（后者开工时还是别的代理在途的 `M`），规约 §2 禁止越界 ⇒ 接不上；规约 §3 又不许留「只过自己测试的死模块」⇒ 删并转请求。功能没丢：模块与 8 条判据逐字在原子里，那一侧两行接线即可恢复 |
| 判据测试 | 新行为各配判据 | `[x]` | 同上（`FindPopupPanel.java:1520/:1533/:1547-1552`） | `tests/structural-search-panel-model.test.mjs:120-155`（4 条）、`tests/find-replacement-template.test.mjs:63-74`（接线：两处入口 + `regexMode` 真传进模型）、`tests/search-preview.test.mjs:134-150`（2 条）、`tests/search-replace-outcome.test.mjs:1-48`（新 6 条） | 覆盖「非正则档不挡 / 空替换框不挡 / 结构化档看编译产物与折好的替换串 / query 自己编不出来时不误判 / 面板两处入口都挡」与各模块边界 |

补充留痕（规约 §1「改别人的结论要留痕」）：
- 原写「`replaceGuard` 是模板非法的那道门」（上一代理留在 `SearchPanel.vue:368` 的注释）。**实际**上游把
  `getValidationInfo` 分成了两处：模板/查询本身的错挂在搜索字段（`:1526`/`:1530`），替换串的畸形挂在**替换字段**（`:1551`），
  而模板那半在本仓已由 `structuralModel.error` → `canSearch` 承担。故本批把注释改成「替换串在这个查询下畸形」，
  并把这道门只接在替换入口。
- `tests/find-replacement-template.test.mjs` 与 `src/regexReplacement.ts` 的宿主侧坐标是上一代理落的，本批复核
  `:96`「Malformed replacement string: {0}」、`FindManagerBase.java:284-298`、`RegExReplacementBuilder.java:63-66`/`:76-78` 全部逐行核过，无假引用。

## 2. 改动文件清单（`wc -l`；括号内是 `tests/module-size.test.mjs` 用的 `split('\n')` 口径）

| 文件 | 前 | 后 | 说明 |
| --- | --- | --- | --- |
| `src/components/SearchPanel.vue` | 901（902） | 897（898） | 拆出两块纯逻辑；补 `blockedByReplaceGuard`；结果行改用 `lineParts`；删本地 `Part` 接口 |
| `src/structuralSearchPanelModel.ts` | 233 | 288 | `+regexMode` 入参、`+replaceGuard` 出口、`patternGroups`/`isRegexChannel` 两个内部量 |
| `src/searchPreview.ts` | 111 | 131 | `+resultLineParts`（与 `previewSegments` 同族：行内命中切分，区间取自宿主报的 column/length） |
| `src/searchReplaceOutcome.ts` | — | 34（新） | `incompleteNote`：`skippedFiles`/`truncated`/`skippedNonUtf8` 的三态交代 |
| `src/structuralCodeBlock.ts` | 316 | **删除** | 零消费方孤儿；原文逐字进 W-1 |
| `tests/structural-code-block.test.mjs` | 107 | **删除** | 随模块一起删（同样逐字进 W-1，接线时一起恢复） |
| `tests/search-preview.test.mjs` | 132 | 150 | +2 条（切分口径 + 面板锚点改指） |
| `tests/structural-search-panel-model.test.mjs` | 114 | 155 | +4 条 `replaceGuard` 判据；`model()` 助手加 `wholeWord`/`regexMode` 两个 pass-through（默认值与旧行为一致，旧断言未动） |
| `tests/find-replacement-template.test.mjs` | 60 | 74 | +1 条面板接线判据（上一代理新建的文件，本批只追加） |
| `tests/search-replace-outcome.test.mjs` | — | 48（新） | 6 条：三态文案、互斥优先、脏回参、面板不再自己实现 |
| `docs/wiring-requests-2026-10-06-searchdiff.md` | — | 513（新） | W-1：目标文件 + 行号 + import + 可照抄整段 + 上游依据 + 待恢复的模块与测试原文 |

锚点改指（规约 §5「断言体一字不动」）：被搬走的 `incompleteNote` 与 `parts()` 此前**没有任何** `read('src/components/SearchPanel.vue')`
的断言钉着（grep `incompleteNote`/`parts(` 在 `tests/` 里 0 命中），所以本批没改任何一条既有断言体；
只新增了指向新文件的锚点。`tests/search-preview.test.mjs:91` 那条
`/import \{[^}]*previewWindow[^}]*\} from '\.\.\/searchPreview'/` 因新函数进同一组 import 仍然成立，未改。

## 3. §5 每条自查命令的前后数字

| 命令 | 开工前 | 收工后 |
| --- | --- | --- |
| `npx vue-tsc -b --force` | 3 错，全在本域：`SearchPanel.vue(235,132) TS2353 regexMode`、`(369,23)`、`(369,75) TS2339 replaceGuard` | **本域 0 错**，且收工时**全仓 0 错（exit=0）**。中途全仓曾出现别域在途的红（`src/components/ContentComboLabel.vue` 5 条、`src/components/TestRunnerPanel.vue(238,59)` 1 条），两条都由那两个域自己随后落掉，本批未代改 |
| `node --test tests/module-size.test.mjs` | 红：`src/components/SearchPanel.vue(902 行)`（同一次运行里还有 `native/git.cpp 954 > 938`，vcs 域自己随后降下去了） | 绿 5/5（上限未抬、未登记豁免） |
| `node --test tests/search-*.test.mjs tests/structural-*.test.mjs tests/find-*.test.mjs` | 239 pass / 0 fail | 244 pass / 0 fail（净 +5 = 新增 13 条 − 随孤儿删除的 8 条） |
| 上面三条 + `tests/module-size.test.mjs` 合跑 | — | **249 pass / 0 fail** |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净 |
| `node .tools/find-missing-ext.mjs` | 干净（扫描 1242 文件） | 干净（扫描 1254 文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 红：登记 9 / 基线 9 / **新增 1** = `src/structuralCodeBlock.ts`（中途还看到别域的 `src/toolWindowFactories.ts` 一度进新增，随后它自己接上了） | 绿：登记 9 / 基线 9 / **新增 0**（"本轮清掉 0"——那条新增是**随删除一起消失**的，不是被接上的：本批把它逐字转进了 W-1，见 §1 与 §5） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 pass / 0 fail（本批开工时） | **9 pass / 2 fail**，两条红是同一个测试在两个文件里各跑一次，红的引用**全部不在本批文件面**：别域刚落的 `docs/batch-2026-10-06-runcfg.md` 把两条假路径连行号转述了进去（terminal 插件的 `META-INF` 清单、popup 包里的 `ListPopupStep` —— 正是规约 §5 警告的那个坑，本批自己的两份文档**故意不写**那种完整形状）。本批自己的引用（W-1 里那 11 条上游坐标 + 本报告全部坐标）逐条指得到，「快照区间一致性」也绿（开工时它红过一次，是别域在途改 `src/fileTypeDetection.ts` 的行号，随后复绿） |
| `npm run test:native` / ctest | 不适用 | 本批没动 `native/**`（只**读**了 `native/search.cpp:37/648-657/873/887/921` 取证），无 ctest 义务 |

## 4. 反向验证记录（注入 → 变红 → 撤掉 → 复绿）

| # | 注入了什么 | 红了几条 | 撤掉后 |
| --- | --- | --- | --- |
| R1 | `src/structuralSearchPanelModel.ts:183` 的 `isRegexChannel` 临时改成 `computed(() => true)`（即把 `regexMode` 这道上游 `:1520` 的门拆掉） | `tests/structural-search-panel-model.test.mjs` + `tests/find-replacement-template.test.mjs` 合跑 **17 条里 1 红**：「替换串畸形只在『正则档』挡：非正则档里 $3 是字面文本（FindPopupPanel.java:1520）」 | 复绿 17/17 |
| R2 | `src/components/SearchPanel.vue` 的 `replaceAllOnDisk` 里删掉 `if (blockedByReplaceGuard()) return`，同时补 4 行注释把文件抬过上限 | `tests/module-size.test.mjs` + `tests/find-replacement-template.test.mjs` 合跑 **10 条里 2 红**：①「全局搜索面板把校验接进了两个替换入口…」（计数 3 → 2，证明"两处入口"这条断言真的在数调用点）②「没有未登记的巨型源文件」——`src/components/SearchPanel.vue(901 行)` | 复绿：`node --test tests/search-*.test.mjs tests/structural-*.test.mjs tests/find-*.test.mjs tests/module-size.test.mjs` = **249/249** |
| R3 | 孤儿门这条是**天然反向验证**：开工时 `src/structuralCodeBlock.ts` 在场 ⇒ 门禁红「新增 1」；删除后同一命令 ⇒ 门禁绿「新增 0」 | 1 条 | 复绿（见 §3 同一行） |

## 5. 零消费方自查结论

- `node .tools/find-orphan-modules.mjs --gate`：**登记 9 / 基线 9 / 新增 0**，门禁绿。
- 本批新增的生产模块只有 `src/searchReplaceOutcome.ts`，消费方是 `src/components/SearchPanel.vue:13`（import）
  与 `:403`、`:457` 两处调用（逐条替换与全部替换各自取 `incompleteNote(result)`）⇒ 不是只过自己测试的死模块。
- `src/searchPreview.ts` 的新导出 `resultLineParts` 消费方 `src/components/SearchPanel.vue:11`（`:737` 渲染结果行）。
- 被删的 `src/structuralCodeBlock.ts` 原本唯一"消费方"是它自己的测试 ⇒ 按规约删除，原文与 8 条判据逐字转进
  `docs/wiring-requests-2026-10-06-searchdiff.md` W-1（含目标文件、目标行号、import 语句、可照抄整段、上游依据）。
- 本批没启动任何图形界面、没上网、没跑 `npm test` 全量（12 路并行，只跑自己域的测试）。

## 6. 做不到 / 无法核实

1. **把 `findCodeBlockRange` 接进真实链路**：做不到，卡在哪一环写清了 —— 合并点是
   `src/editorCodeBlock.ts:148-150` 的 `codeBlockTarget(text, caret, forward)`（它连 `language` 形参都没有），
   调用方 `src/editorCommands.ts:176`。这两个文件都不在本批可改面（`editorCommands.ts` 在派单的「不许碰」清单里，
   且开工时 `git status` 显示它是别的代理在途的 `M` 文件）。要改的两处已经写成 W-1（含可照抄的
   `codeBlockTarget` 整段与新形参、以及调用点那一行），本批只能删孤儿。
2. **替他域的红负责/代改**：做不到，也不该做 —— 本批开工与中途看到过别域在途的红
   （`src/components/ContentComboLabel.vue` 5 条类型错、`src/components/TestRunnerPanel.vue(238,59)` 1 条、
   `src/fileTypeDetection.ts` 的一条快照锚点、别域文档带进引用门的假路径若干条）。这些文件都不在本批可改面，
   按规约 §5「只跑自己域的测试」处理：本批一条都没代改。收工时**类型侧已全部复绿**（全仓 `vue-tsc` exit=0），
   引用门仍红 2 条，来源是别域刚落盘的 `docs/batch-2026-10-06-runcfg.md`（见 §3 同一行与 §7）。
3. **无法核实**：Ultimate 侧是否还有别的 `codeBlockSupportHandler` 注册项（本机参考树是 community）——
   这条结论（"只有 Python 注册"）只在这份树内成立，已写进 W-1 的文件头。
4. **替上一代理复核它留下的引用（不是"做不到"，是交接留痕）**：被删模块头里的三处 Python 侧引用本批**已逐行核过**，不是假引用 ——
   `PyControlFlowKeywordMatcher.kt:34-35`（多段复合语句那一份清单）、`:84-86`（三元 `if`/`else`、推导式 `for` 明确忽略）、
   `:134-135`（"the bare `match` keyword is a direct token child of the match statement" 原话）三处都逐字对得上，
   连同 `CodeBlockUtil.java:108-120`/`:176-188`、`CodeBlockSupportHandler.java:57-66`/`:47-52`、
   `intellij.platform.lang.impl.xml:147`、`intellij.python.community.impl.xml:439` 一起复核后才转进 W-1。
   唯一留给接线那一侧确认的是上面第 3 条（Ultimate 树）。

## 7. 需要主代理接的线

- `docs/wiring-requests-2026-10-06-searchdiff.md` W-1：把 `src/editorCodeBlock.ts` 的 `codeBlockTarget`
  补上「结构支持」那半条边（含待恢复的 `src/structuralCodeBlock.ts` 与 `tests/structural-code-block.test.mjs` 原文）。
  接上时请顺手补一条 `tests/editor-code-block.test.mjs` 的判据：Python 文档里光标压在 `elif` 上时走的是
  `min(结构, 括号)`（`CodeBlockUtil.java:118`）而不是括号那半 —— 否则这条边会无声退回单支。
- 另有**一条不在本批 file face 里的红**请转给桶 11c（runcfg）：`docs/batch-2026-10-06-runcfg.md` 把两条
  参考树里不存在的上游路径**连行号**写了进去（terminal 插件的 `META-INF` 那一份清单、popup 包里的
  `ListPopupStep`），引用门因此 2 红。规约 §5 的原话是「要批评某个假写法就去掉行号，别写完整形状」——
  本批自己的两份文档都按这条写，没给它添红。
- 本批**没有**留下其他需要主代理替他域修的线：中途看到过的别域类型红（§6 第 2 条）在收工时都已由各自域复绿
  （全仓 `vue-tsc` exit=0、`find-orphan-modules --gate` 新增 0、三个检测器干净、本域 249/249）。
