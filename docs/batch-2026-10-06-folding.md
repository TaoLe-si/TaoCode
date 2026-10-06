# 批次报告 2026-10-06 · 代号 `folding`（折叠族模块侧收口）

域：`docs/inventory/verdict-folding.md` 全域 + `docs/inventory/verdict-platform_rest.md` 的
`lp/custom-folding`（`:325`）与 `lp/sticky-lines`（`:362`）。
本批只做**模块侧**缺项；一切挂点/键位/设置键写在 `docs/wiring-requests-2026-10-06-folding.md`（W-1…W-6）。
上游基准：本地参考树 `intellij-community-master`，下面每条坐标都逐行打开核过。

## 1. 判词表

### 1.1 `lp/custom-folding`（自定义折叠区域）

| 族 / 项 | 判定 | 上游相对路径:行号 | 本仓落点（文件:行） | 一句话说明 |
|---|---|---|---|---|
| provider 的 `getPlaceholderText`：正则命中且捕获非空 | `[x]` | `platform/lang-impl/src/com/intellij/lang/customFolding/VisualStudioCustomFoldingProvider.java:23-27`、`.../NetBeansCustomFoldingProvider.java:24-27` | `src/customFoldingProviders.ts:172-185`（`placeholderOf`） | 取标记之后的说明 / `desc="…"` 的值，两条正则与表一一对应 |
| provider 的 `getPlaceholderText`：**正则不匹配**那一档 | `[x]`（本批补） | `.../NetBeansCustomFoldingProvider.java:25`（Java 的 `replaceFirst` 不匹配时原样返回入参） | `src/customFoldingProviders.ts:157-179`（新增第二实参 `elementText` 与 `!matched` 分支） | 没有 `desc` 属性时上游折出来是**整段注释文本**，不是 `...`；只有去空白后为空才是 `...` |
| `getPlaceholderText` 的单参数重载 | `[x]` | `platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java:116-119` | `src/customFoldingProviders.ts:179`、`:185` 的 `...` 字面量 | 该重载直接返回三点，与本仓空值分支同值 |
| 只对**开始**标记问 provider | `[x]` | `CustomFoldingBuilder.java:102-111`（`isCustomRegionStart` 才转发） | `src/customFoldingProviders.ts:173-174` | 结束标记没有占位可取 |
| 区域嵌套：同族配对 | `[x]`（本批补） | `CustomFoldingBuilder.java:79-92`（栈式配对）+ `:164-187` + `:194-203`（一次构建问同一份 provider） | `src/customFoldingProviders.ts:133-152`（`markersPair`/`matchingStartIndex`）、`src/editorFolding.ts:82-111`（`localRegionFolds`）、`src/customFoldingRegions.ts:86-108`（`regionEntries`） | `//<region>` 不再被 `//endregion` 关掉，反之亦然；压在中间没闭合的异族开始标记不产生区域 |
| 区域嵌套：未闭合不折 | `[x]` | `CustomFoldingBuilder.java:82-91`（只有配到 end 才 `descriptors.add`） | `src/editorFolding.ts:101-109`、`src/customFoldingRegions.ts:100-106` | 上一批已有，本批改写成「按同族找栈顶」后行为不变 |
| 层数缩进三个空格 / 按元素起始偏移排序 | `[x]` | `platform/lang-impl/src/com/intellij/lang/customFolding/CustomFoldingRegionsPopup.java:56-59`、`:65-69`、`:72-76` | `src/customFoldingRegions.ts:111-124`（排序与层数）、`:138`（`regionIndent`） | 上一批已有，本批的配对改动没动排序口径（判据仍在） |
| `defaultstate="collapsed"` 默认折 | `[x]` | `.../NetBeansCustomFoldingProvider.java:46-48` | `src/customFoldingProviders.ts:197-203`（`collapsedByDefaultMarker`） | 全局开关关着也折 |
| `isCollapsedByDefault` 的基类那一半 = 设置项 | `[x]` | `platform/core-api/src/com/intellij/lang/folding/CustomFoldingProvider.java:81-83`（读 `COLLAPSE_CUSTOM_FOLDING_REGIONS`） | `src/editorFoldingSettings.ts` 的 kind 映射（既有） | 表里注释已写明；不新增设置键 |
| `wrapStartEndMarkerTextInLanguageSpecificComment` / `isSupported` / `isSupportedBy` | `[-]` | `CustomFoldingProvider.java:43-45`、`:50-58`、`:60-62` | 判定写在 `src/customFoldingSurround.ts:21-24` | 两个真 provider 都用默认值（包注释 + 对所有语言为真），本仓每种语言都本地扫标记 ⇒ 三条门槛恒成立，不造没有区分度的开关 |
| `surroundWithRegion`：三种 provider 各一行 | `[~]` | `platform/lang-impl/src/com/intellij/lang/folding/CustomFoldingSurroundDescriptor.java:218`、`:226` | `src/customFoldingSurround.ts:123-131`（`customFoldingSurrounders`）+ 判据 `tests/folding-custom-region-surround.test.mjs:63-74` | 模块侧三项齐（标题=中文包、标记文本=表、说明占位选中）；**列表侧**仍是 `src/surround.ts:34-37` 的四条硬编码 ⇒ W-4/W-5 |
| `surroundWithRegion`：空/纯空白选区不给包围 | `[x]` | `CustomFoldingSurroundDescriptor.java:51`、`:56-61` | `src/customFoldingSurround.ts:48-71`（`snapToLines`） | 本批先加了一条「整段空白」显式判据，实测**不可达**（被 `end <= snappedFrom` 完全覆盖）⇒ 删掉死代码，只留行为断言 |
| `surroundWithRegion`：落地后调 `adjustLineIndent` | `[-]` | `CustomFoldingSurroundDescriptor.java:316-317`、`:323-329` | 无 | 上游调 `CodeStyleManager.adjustLineIndent`；本仓格式化只有 LSP 的整篇 `textDocument/formatting`，没有「按范围调缩进」的可独立调用面 ⇒ 两行标记沿用选区首行缩进（文件头已登记） |
| `GotoCustomRegionAction` / 列表弹层 / 无区域提示 | `[x]`（宿主文案除外） | `.../customFolding/GotoCustomRegionAction.java:60-66`、`CustomFoldingRegionsPopup.java:23-41` | `src/customFoldingPopup.ts:38-134` | 弹层、键位、无区域分支都有宿主；**唯一没接上的是模块导出的那条中文文案**（宿主另写了一句）⇒ W-6 |
| 「按 provider 的标记配置面」（设置页） | `[-]` | EP 声明 `platform/core-api/resources/intellij.platform.core.xml:40`；注册 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1466-1467` | `src/customFoldingProviders.ts:57-97`（数据表） | 上游没有 provider 设置页（三条路搜过），本仓不造空壳页；四处消费同一张表 |
| `CustomFoldingSettings`（派单点名的上游件） | `[-]`（**参考树里不存在**） | 无：`find . -iname "*CustomFoldingSettings*"` 与对 `platform/` 的 grep 均零命中 | — | 能核实的最近亲是 `CodeFoldingSettings.COLLAPSE_CUSTOM_FOLDING_REGIONS`（`CustomFoldingProvider.java:82` 读的就是它），本仓早接 |
| `custom.folding.max.lookup.depth` / `isCustomFoldingRoot` 的 PSI 层级 | `[-]` | `CustomFoldingBuilder.java:29`、`:94-96`、`:228-230` | 无 | 那是「注释节点在不同 PSI 层级不互配」的层级门槛；本仓按行扫、没有 PSI 层级，等价物就是上面那条同族栈 |

### 1.2 `lp/sticky-lines`（粘性行）

| 族 / 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|
| 语言 provider 表（哪些 kind 算作用域） | `[x]` | `platform/lang-impl/src/com/intellij/codeInsight/stickyLines/StickyLinesPass.kt:13-33`（pass 交给 collector）、`platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLinesCollector.kt:101`（`findBreadcrumbsCollector` 按语言取） | `src/stickyLineProviders.ts:33-54` | 上一批已有；判词 `verdict-platform_rest.md:362`「现路径只过通用表」一句**已过期**（见 §6 留痕） |
| 候选 = 与可视区顶部那一段**相交**（不是包含光标） | `[x]`（模块侧，本批补） | `VisualStickyLines.kt:66-87`（`:70` 面板高 = `lineHeight*limit+1`、`:83` 走 `processStickyLines(startOffset,endOffset)`） | `src/stickyLineViewport.ts:75-90`（`stickyPanelWindow`/`overlapsStickyWindow`） | 相交判据 + 窗口行数；宿主没给顶行时保留按光标行的退化路径 |
| 作用域至少 5 行才算一层 | `[x]`（本批补） | `VisualStickyLines.kt:18-19`（默认 5）、`:21-23`（`require>=2`）、`:102`+`:162-163` | `src/stickyLineViewport.ts:60-68`（`scopeNotNarrow`/`stickyScopeSpan`） | 一屏塞进三个 3 行的 lambda 是上游不会做的 |
| 零宽作用域不是层 | `[x]`（本批补） | `StickyLinesModelImpl.java:112-117`（`startOffset >= endOffset` 抛）、`StickyLinesCollector.kt:157-160`（打字打成零长的旧层删掉） | `src/stickyLineViewport.ts:105`（流水线里的那条 filter） | 流水线里先丢零宽 |
| 比较器：起始升序、同起点**宽的在前** | `[x]`（本批补） | `StickyLinesModelImpl.java:287-296`（注释就写着 reverse order） | `src/stickyLineViewport.ts:70-73`（`compareStickyScopes`） | 既有 `stickyScopes` 的「同行留最内层」是**去重**那一档（判据 `tests/sticky-lines.test.mjs:49-56` 钉着），本批没动它；上游去重发生在排序**之前**（`VisualStickyLines.kt:96-100`，按 highlighter 遍历顺序），所以那一条不是本比较器的后果 |
| 按主行去重 | `[x]`（本批补） | `VisualStickyLines.kt:96-100` | `src/stickyLineViewport.ts:115-121` | 同一视觉行只钉一条 |
| 排满 `stickyLinesLimit` 即停（从外层起） | `[x]`（本批补） | `VisualStickyLines.kt:144-148` | `src/stickyLineViewport.ts:115-124` | 被裁掉的是**最内**那些；与退化路径（`slice(-limit)` 留最内 N 层）方向不同，文件头写明差别 |
| 面板放不下就一条都不画 | `[x]`（本批补） | `VisualStickyLines.kt:125-127`+`:158-159`（`panelHeight + 2*lineHeight > height/2`） | `src/stickyLineViewport.ts:92-96`（`stickyPanelFits`） | 没有像素度量时跳过这一档，不误判 |
| 多分栏：层在文档、显示在各编辑器，各算各的 | `[~]`（模块侧 `[x]`） | `StickyLinesModelImpl.java:93-100`、`StickyLinesManager.kt:20-34`、`:86-99` | `src/stickyLineViewport.ts:127-134`（`stickyLinesPerView`） | 判据与出口齐；**面板身份只有 `App.vue` 有** ⇒ W-1/W-2/W-3 |
| 新编辑器第一次必跑采集；修订号 = 结构 + 文档两段 | `[x]`（本批补） | `StickyLinesCollector.kt:36-51`（`:39` 的 IJPL-158818 注释）、`:77-79` | `src/stickyLineViewport.ts:136-163`（`stickyPassNeeded`/`stickyRevisionStamp`/`emptyStickyPassState`） | 纯函数返回下一份状态，不改入参 |
| 「按视图优先级排序」（判词原文） | `[-]`（**指不到代码**） | 对整个 `stickyLines` 目录搜 priority 零命中；`StickyLinesPass.kt` 全文 33 行没有排序 | `src/stickyLineViewport.ts` 头部「无法核实」段 | 能核实的只有比较器 + 每视图独立算两条，都已实现；若主代理另有出处请给路径 |
| daemon 合帧（判词原文的另一半） | `[-]` | `TextEditorHighlightingPass` 框架（`StickyLinesPass.kt:16` 的基类） | 无 | 本仓粘性行是 Vue `computed`，重算由响应式依赖驱动，没有 pass 合帧这一层 |
| 点击跳转（`navigateOffset`） | `[x]` | `StickyLine.kt:36-41`、`ui/StickyLineComponent.kt:44-50` | `src/stickyLines.ts:136-138`（`stickyRevealTarget`）+ 宿主 `src/App.vue:2191` | 上一批已接（判据 `tests/editor-sticky-navigate.test.mjs`） |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 |
|---|---|---|
| `src/customFoldingProviders.ts` | 155 | 203 |
| `src/customFoldingRegions.ts` | 128 | 140 |
| `src/customFoldingSurround.ts` | 124 | 132 |
| `src/editorFolding.ts` | 688 | 698 |
| `src/stickyLines.ts` | 123 | 138 |
| `src/stickyLineViewport.ts` | —（新建） | 163 |
| `tests/editor-custom-fold-regions.test.mjs` | 95 | 144 |
| `tests/folding-custom-region-providers.test.mjs` | 108 | 120 |
| `tests/folding-custom-region-surround.test.mjs` | 85 | 105 |
| `tests/sticky-line-viewport.test.mjs` | —（新建） | 124 |
| `docs/wiring-requests-2026-10-06-folding.md` | —（新建） | 本批交付 |

没动 `native/folding_state_*.cpp`（本批没有落盘侧缺项：`verdict-folding.md` §C③ 那条已完成）
⇒ 不跑 ctest（无 native 改动）。

## 3. §5 自查命令的前后数字

| 检查 | 本批开始前 | 本批结束后 | 备注 |
|---|---|---|---|
| 派单给的域内命令（`node --test tests/folding-*.test.mjs tests/custom-fold*.test.mjs tests/editor-sticky*.test.mjs tests/sticky-*.test.mjs tests/editor-fold*.test.mjs tests/module-size.test.mjs`） | 未跑基线（工作区有他人在途） | **93 tests / 93 pass / 0 fail**（加判据前）→ 最终见下 | 新判据在两个新/改文件里，`sticky-line-viewport` 不在该 glob 内 |
| 域内全量（上面那条 + `tests/editor-custom-fold-regions.test.mjs` + `tests/editor-region-folding.test.mjs` + `tests/diff-fold.test.mjs` + `tests/sticky-line-viewport.test.mjs`） | — | **136 tests / 136 pass / 0 fail** | 收工前复跑同一条：见 §4 末行 |
| `npx vue-tsc -b --force` | 1 条：`src/components/TestRunnerPanel.vue(238,59) TS7053` | **1 条，同一处**（他人在途；派单说的 `SearchPanel.vue` 3 条本次不在） | 我改的 6 个 `.ts` **0 错** |
| `node --test tests/module-size.test.mjs` | 绿 | **绿**（上限未动；最大文件 `src/editorFolding.ts` 698 < 900） | 未拆文件 ⇒ 无锚点搬迁 |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** | |
| `node .tools/find-ts-in-mjs.mjs` | 干净（0） | **1 个文件**：`tests/completion-commands.test.mjs` 第 63-65 行参数类型标注 | **不是我名下文件**（补全族在途）；本批四个测试文件都是纯 JS |
| `node .tools/find-missing-ext.mjs` | 干净（1253 个文件） | **干净**（1254 个文件，多的那个是 `src/stickyLineViewport.ts`） | |
| `node .tools/find-orphan-modules.mjs --gate` | 新增 2（`externalTaskSettings`/`structuralCodeBlock`，他人） | **门禁绿：新增 0**（基线 9 不变） | 新建的 `src/stickyLineViewport.ts` 有生产消费方（`src/stickyLines.ts` → `src/App.vue:513`） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 tests / 10 pass / **1 fail**（`src/fileTypeDetection.ts` 的快照引用，他人在途；中途一度变成 2 fail，来自别人的 toolwindow 请求文档） | **11 tests / 11 pass / 0 fail**（收工时复跑，含本批两份新文档） | 我这批新增的引用都在参考树里逐行存在；按规约，转述别人的假写法时刻意不带行号、不写完整形状（见 §6 第一行） |

## 4. 反向验证（注入违规 → 红 → 撤 → 绿）

1. **同族配对**（`markersPair` 去掉 provider 相等判据）+ **最小宽度门槛**（`scopeNotNarrow` 把下限夹到 1）
   同时注入 ⇒ `tests/`（folding 族 + sticky 族 + editor-sticky 族）61 个用例里 **3 红**：
   `异族标记不互相收尾…`、`provider 表里那两条配对判据…`、`最小宽度那一档…`；
   撤销两处注入 ⇒ 复绿。
2. **占位文字的「正则不匹配 ⇒ 元素文本」退回成 `...`** ⇒ 24 个用例里 **2 红**
   （`占位文字取 marker 之后的说明…`、`占位文字：两个 provider 的取法…`）；撤销 ⇒ 复绿。
3. **一条注入没变红，据此删掉了死代码**：给 `snapToLines` 加「吸附完整段都是空白 ⇒ 不给包围」后，
   把它关掉**没有用例会红** ⇒ 说明这条判据不可达（`body.trimStart()` 会把跨行空白一路剥到底，
   纯空白选区已经由既有的 `end <= snappedFrom` 挡住）。那行新增已删除，
   只保留行为断言（`tests/folding-custom-region-surround.test.mjs:59-67`），并在模块头写明「判据钉行为不钉代码」。
4. 收工复跑：域内 136/136 绿、三检测器与孤儿门未见新增红、类型仍只有他人那 1 条。

## 5. 零消费方自查

- `src/stickyLineViewport.ts`：被 `src/stickyLines.ts` import 并在 `createStickyLines` 里真正调用
  （`view` 给了就走它）⇒ 有生产链路；`orphan --gate` 新增 0。
- 新增导出的消费点逐个核：`markersPair`/`matchingStartIndex`（`src/editorFolding.ts` + `src/customFoldingRegions.ts`）、
  `placeholderOf` 第二实参（`src/customFoldingRegions.ts`）、`stickyLinesPerView`/`stickyPassNeeded`/`stickyRevisionStamp`
  目前是**判据 + 待接宿主**，文件头写明接不上的原因（面板身份/像素度量只有 `App.vue` 与 `CodeEditor.vue` 有，
  两者都在别人名下）⇒ 对应 W-1/W-2/W-3。
- 已知的一处真孤儿是**文案常量** `NO_CUSTOM_REGIONS_IN_FILE`（宿主另写了一句）⇒ 交 W-6，不自己动别人的组件。

## 6. 留痕（改别人结论的地方）与原派单偏差

| 原写法 | 实际 |
|---|---|
| 派单：上游在 lang-impl 的 `codeInsight` 下的 `folding/impl` 那一段目录 | 参考树里 lang-impl 下**没有**这一段；自定义折叠实现分散在 `platform/core-api/src/com/intellij/lang/folding/`（provider 与 builder）与 `platform/lang-impl/src/com/intellij/lang/customFolding/`（两个 provider 实现 + 弹层/动作）、`platform/lang-impl/src/com/intellij/lang/folding/`（surround 描述符）。lang-impl 的 `codeInsight` 下与本域相关的只有 `stickyLines/`（本域 pass 工厂） |
| 派单：`CustomFoldingSettings` | 参考树里不存在（按文件名与按符号名两条路都零命中）；能核实的只有 `CodeFoldingSettings.COLLAPSE_CUSTOM_FOLDING_REGIONS`，`CustomFoldingProvider.java:81-83` 读的就是它 |
| 本仓旧注释（`src/customFoldingProviders.ts` 文件头）：「provider 的挑选按注册顺序问过去，取**第一个**认领的」 | 实际 `CustomFoldingBuilder.java:196-200` 的循环**没有 break** ⇒ 取**最后一个**认领的，且结果缓存在 `myDefaultProvider` 字段给整次构建复用（`:38` 才清空）。已改注释并据此实现「同族才配对」 |
| 判词 `verdict-platform_rest.md:362`「缺：把 provider 接进 `App.vue` 的顶边渲染，现路径只过通用表」 | **已过期**：`src/stickyLineProviders.ts` 的语言表接在 `stickyScopes` 前，`src/App.vue:513` 传了 `language`，判据在 `tests/tab-sticky-lines.test.mjs`。（本轮复核，未改判词文件本身——不在我名下） |
| `tests/editor-custom-fold-regions.test.mjs` 旧断言：`regionLabel('//<editor-fold>') === '...'` | **钉错了值**：上游 `NetBeansCustomFoldingProvider.java:25-26` 的 `replaceFirst` 在正则不匹配时原样返回入参 ⇒ 应为整段注释文本。已改判并写清理由（§1.1 第一、二行），断言仍是 `assert.equal` 严格相等，没有放松 |

## 7. 做不到 / 无法核实

1. **三种 provider 到得了用户手里**：卡在 `src/surround.ts`（四条硬编码模板）+ `src/surroundTemplates.ts`
   （列表与 `applySurround`）+ `src/editorCommands.ts:194-210`（写死 id 为空的 provider）
   + `src/menus/editMenu.ts:151`（只有一行菜单）—— 四个文件都不在我名下 ⇒ W-4/W-5。
2. **视口/多分栏真正生效**：卡在三处宿主 —— `src/App.vue:513`（不传 `view`）、
   `src/App.vue:2119`（`pane === focusedPane` 只画聚焦分栏）、`src/components/CodeEditor.vue`（没透出
   `firstVisibleLine`/`lineHeight`/`viewportHeight`）⇒ W-1/W-2/W-3。模块与判据齐了。
3. **`adjustLineIndent`**：本仓没有「按范围调整缩进」的独立格式化面（LSP 只有整篇 formatting）⇒ 两行标记沿用首行缩进。
4. **上游「一次构建一份 provider」的缓存语义**：不复制 —— 那会让混用两族标记的文件只认其中一族
   （`CustomFoldingBuilder.java:194-203` 无 break + 字段缓存的后果），是上游的取巧不是行为目标；
   保留可核实的那一条后果（异族不互配）。
5. **PSI 层级门槛**（`isCustomFoldingRoot:228-230`、`custom.folding.max.lookup.depth:29`）：没有 PSI，
   按行扫；等价物是同族栈。
6. **「按视图优先级排序」**：参考树里指不到对应代码（该目录搜 priority 零命中）⇒ 判 `[-]` 并保留
   `stickyLinesPerView` 的入参顺序给宿主，不替宿主编一个优先级。
7. **`<region>` 那一族 provider 的 `getDescription`/`getPlaceholderText`**：社区树里没有实现类
   （EP 注册只有两条，全树搜不到 `<region` 字面量）⇒ 无法核实；本仓按两个能核实的 provider 共用的最窄规则处理，
   并在表里把 `id` 留空作标记。
8. **ctest**：本批没改 `native/` ⇒ 未跑。

## 8. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-folding.md`：W-1（App.vue 传 `view`）、W-2（CodeEditor.vue 透出三个度量）、
W-3（多分栏各算一份）、W-4（Surround With 列表改表驱动）、W-5（`fold.surroundRegion` 参数化到三条 provider）、
W-6（无区域提示用模块导出的文案）。

## 9. 注释词法（派单第 3 条，本批执行方式）

本批所有模块头/判据注释一律 `//` 行注释；需要写「块注释收尾那两个字符」时（例如
`VisualStudioCustomFoldingProvider.java:25` 的 `startsWith("/*")` → `trimEnd(…, "*/")` 那一条）
只出现在 `//` 行注释与正则字面量里（`blockCommentTail: /\s*\*\/\s*$/`），
不落进任何块注释正文 —— 本仓的 `find-ts-in-mjs` / `vue-tsc` 今晚各被这种写法打断过一次全量验证。
自查：`find-missing-ext` 与 `find-ts-in-mjs` 对本批 10 个文件均无命中（§3），
`vue-tsc` 仍只有他人那 1 条（语法错会中断整棵树的语义检查，若犯过会看到条数暴涨）。
