# batch-2026-10-06 · lane `stickyfold`

范围（派单原话）：**只做一件事 —— 粘性行（sticky lines）与自定义折叠占位文字的模块侧档位对齐。**
主代理只做验证与装配；宿主侧改动一律走 §5 接线请求，本 lane 不动保留文件。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一事实来源）。
仓内 `third_party/intellij-community` 为坏树，**禁用**。本地无 zh 本地化包 ⇒ 中文措辞一律登记「无法核实」。

---

## 0. 结论表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| sticky-lines | `stickyLinesLimit` 设置页档位 | `[x]` 已做（模块侧真源） | `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/configurable/StickyLinesConfigurableUI.kt:40`；`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:94` | `src/stickyLines.ts:68-85`（`STICKY_LINES_LIMIT_DEFAULT/MIN/MAX`） | 上游 5/1/**20**，本仓三处校验停在 0…**10** ⇒ 真源落到模块 + 判据钉住，改校验走请求 W-2 |
| sticky-lines | 编辑器读取侧夹取 | `[-]` 不适用（**上游不夹**，本仓也不该夹） | `EditorSettingsExternalizable.java:549-556`、`EditorSettingsState.kt:227`、`SettingsImpl.kt:729-731` | `src/stickyLines.ts:101-106`（`stickyViewRowBudget` 的「没有度量不夹」那一支）+ `tests/sticky-tier-scroll.test.mjs` 第 2 条 | 20 是设置页那一格的档；手改存档给 25 时上游就排 25 条 ⇒ 模块只按 `>0` 出层 |
| sticky-lines | 短面板时的跟随语义（视口放不下） | `[~]` 部分：本仓合成处已按「放得下的前缀」出层；还差上游「溢出边界那一条也留下」 | `VisualStickyLines.kt:125-127`、`:141-148`、`:158-160` | `src/stickyLines.ts:86-106`（`stickyViewRowBudget`）+ `src/stickyLines.ts:275-282`（`linesForView`） | 原状：面板只放得下 3 行、上限给 5 时本仓**一条都不出**；现在出最外 3 条。第 4 条（顶过界那条）要改 `src/stickyLineViewport.ts` 的循环 ⇒ 请求 W-4（那文件不在本 lane 名下） |
| sticky-lines | 多块面板各自的可视区（退化路径） | `[x]` 已做 | `StickyLinesManager.kt:15-34`、`:86-99`；`VisualStickyLines.kt:70-74` | `src/stickyLines.ts:254-263`（`fallbackScrollTop`） | 共享的那份 `firstVisibleLine` 描述不了几块面板 ⇒ 声明了 2 块以上时不参与任一栏筛选；单块/不给面板时行为逐字不变 |
| sticky-lines | 视图优先级排序（谁拥有粘性行） | `[-]` 上游无此档，**无法核实**；本仓档位由宿主给 | 两目录 `grep -rn priority` 命中文件数 **0**（`platform/platform-impl/.../editor/impl/stickyLines/`、`platform/lang-impl/.../codeInsight/stickyLines/`；本 lane 亲自复跑） | `src/stickyLineViewport.ts:51-90`（`StickyView.priority` / `orderStickyViews` / `primaryStickyView`，`stickyprio` 已落）+ `src/stickyLines.ts:284-290` 消费 | 能核实的排序只有同一块面板内的层序（`StickyLinesModelImpl.java:200-206`、`:286-296`）⇒ 模块不替宿主编「哪个分栏在上」 |
| sticky-lines | 「起始行滚出视野才算粘住」+ 文档开头那条特例 | `[x]` 等价（本仓按行、上游按像素） | `StickyLinesManager.kt:89-92`（`activeVisualArea.y < 3 ⇒ resetLines()`）、`VisualStickyLines.kt:134` | `src/stickyLines.ts:172-180`（`stickyWindowScopes` 的 `startLine + 1 < firstVisibleLine`） | 顶行 = 1 时任何层的起始行都还在视野里 ⇒ 天然为空，与上游那条特例同果；登记为「度量口径不同、结果一致」 |
| custom-folding | 占位文字取值链是否等价 | `[x]` 等价，已复核并补判据 | `UpdateFoldRegionsOperation.java:162`；`CustomFoldingBuilder.java:101-111`/`:116-119`；`NetBeansCustomFoldingProvider.java:24-27`；`VisualStudioCustomFoldingProvider.java:22-27`；`LspFoldingBuilder.kt:51/:71/:85` | `src/editorFolding.ts:873-891`（`FOLD_PLACEHOLDER_TEXT` + `foldPlaceholderFor`） | `collapsedText` 原样（不 trim、空串才退档）→ region 的 provider 说明（trim）→ `...`；三条判据见 `tests/folding-placeholder.test.mjs` 末三条 |
| custom-folding | 「用户可自定义占位符」设置项 | `[-]` 上游没有这一档 ⇒ 不造 | `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java:7-11`（整份 5 个布尔，无字符串字段） | —— | 能自定义的只有标记里那段说明文字，已由 `src/customFoldingProviders.ts` 的 `placeholderOf` 承接 |
| custom-folding | `foldPlaceholderFor` 零生产消费方 | `[~]` 收法=请求，未自判「不适用」 | `@codemirror/language` 的 `FoldConfig.preparePlaceholder`（`node_modules/@codemirror/language/dist/index.d.ts:783-786`）、默认 `placeholderText: "…"`（`dist/index.js:1517`） | 请求 W-1；形状判据 `tests/folding-placeholder.test.mjs` 末条 | 宿主没有 `codeFolding(...)` 那一句 ⇒ 用户当前看到单字符 `…`，上游是 `...`；请求代码已过 `tsc`（0 错） |
| custom-folding | `customFoldingSurround.ts` / 其测试 | `[-]` **跳过（并发）** | —— | —— | mtime 15:40/15:43 与 `docs/batch-2026-10-06-customfold.md` 15:53（开工前 13 分钟）⇒ 判定 `customfold` 在写，本 lane 未动 |
| custom-folding | provider 表条数（本仓 3 vs 上游注册 2） | `[ ]` 未做（登记，不属本 lane） | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1466-1467`；EP 声明 `platform/core-api/resources/intellij.platform.core.xml:40` | `src/customFoldingProviders.ts:67/:84/:95` 三条 provider 正则 | 那张表在 `customfold` / `foldgoto` 名下；「多一条会多认一种标记」不是占位文字档位 ⇒ 只上报 |


## 1. 坐标核对（含订正留痕）

上游 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`；下面每一条都是本 lane **自己 `sed -n` / `grep -n` 开文件**取的，行号是本轮自数。

| 坐标 | 复核结论 |
|---|---|
| 派单：`StickyLinesModelImpl.java` 产出升序（外层在前） | **成立**。`platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/StickyLinesModelImpl.java:200-206` = `myMarkupModel.processRangeHighlightersOverlappingWith(startOffset, endOffset, …)`（按 range 起点升序发）；同文件 `:286-296` 的 `StickyLineImpl.compareTo` = 起点升序、**同起点时终点降序**（源码注释 `// reverse order`）。模型挂在 markupModel 的 userData 上：`:93-100`（同一文档一份模型）✓ |
| 派单：`VisualStickyLines.kt` 在 `lineLimit` 处 break | **成立，但比派单更细**。`VisualStickyLines.kt:128-150`：`break` 那一条在**收下当前行之后**（`:141-143` 先 `withYLocation.add(line)`，`:144-148` 才 `if (yOverlap > 0 \|\| withYLocation.size >= lineLimit \|\| isPanelTooBig(...)) break`）⇒ 三个停止条件，不只是一个。裁的是**最内**那条 ⇒ 本仓 `gutter-menu.test.mjs:122-126` 那条订正方向正确（未翻动） |
| 派单：要查「视图优先级排序」 | **无法核实（本 lane 亲自复跑）**：对 `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/` 与 `platform/lang-impl/src/com/intellij/codeInsight/stickyLines/` 两目录 `grep -rn priority` ⇒ 命中文件数 **0**（后者只有 `StickyLinesPass.kt`、`StickyLinesPassFactory.kt` 两个文件）。⇒ 上游不给跨视图先后，档位只能由宿主给（`StickyView.priority`），与 `stickyprio` 的留痕一致 |
| **新发现：`stickyLinesLimit` 的上限档位** | 上游 `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/configurable/StickyLinesConfigurableUI.kt:40` = `intTextField(UINumericRange(5, 1, 20).asRange())` ⇒ **默认 5 / 最小 1 / 最大 20**；默认值另见 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:94` `public int STICKY_LINES_LIMIT = 5`。本仓三处都停在 **0…10**：`src/components/SettingsDialog.vue:910`（`min="0" max="10"`）、`src/previewSettings.ts:70`（`> 10` 判非法）、`native/settings_schema.cpp:123-126`（"must be an integer between 0 and 10"）⇒ **11…20 这一档本仓拿不到**（用户可见差）。三个目标文件都是保留/别人名下 ⇒ 走 §5 请求 |
| 读取侧夹取 | 上游**不夹**：`EditorSettingsExternalizable.java:549-556` 的 `setStickyLineLimit` 只比 old/new 后直接赋值（无范围校验），`platform/platform-impl/src/com/intellij/openapi/editor/impl/EditorSettingsState.kt:227` 原样取，`SettingsImpl.kt:729-731` 原样给编辑器 ⇒ **20 是设置页那一格的档，不是编辑器的档**。⇒ 本仓模块侧不许悄悄 `Math.min(limit, 20)`（那会把「手改 projects.json 给 25」这种外来值改掉，上游在这种值下就是排 25 条），模块只把档位作为**数据**暴露给宿主与校验层 |
| `limit == 0` 那一档 | 上游 UI 最小 1 ⇒ 0 走不到；真给 0 时 `VisualStickyLines.kt:141-145` 仍会收下第一条（`lineHeight > yOverlap`）再因 `size >= 0` 立刻 break ⇒ 「0 档显示 1 条」。本仓 `createStickyLines` 的 gate 在 `!(limit > 0)` 时清空两份出口（判据：`tests/gutter-menu.test.mjs:129`、`tests/sticky-lines.test.mjs:74`）⇒ 登记为「上游不可达档 + 本仓取更保守的一档」，**不动既有断言** |
| **新发现：滚动时粘性行的跟随语义** | `StickyLinesManager.kt:86-99` `visibleAreaChanged`：①先问 `areStickyLinesShown()`；②`:89-92` **`activeVisualArea.y < 3` ⇒ `resetLines()`**（源码注释：文档开头就带粘性行时「宁可视觉跳一下，也不要一条永远粘着的行」）；③`:93` 顶行变了才 `recalculateAndRepaintLines()`，`:95` 只是 y/尺寸变了 ⇒ **只 repaint、不重算候选**。`:109-118` 重算的前置：`activeVisualLine != -1 && activeLineHeight != -1 && !isPoint(activeVisualArea)`。候选窗口 = `VisualStickyLines.kt:70-74` 从 `visibleArea.y` 往下 `lineHeight * lineLimit + 1` 像素；`:125-127` 进循环**前**先问一次 `isPanelTooBig(0)`（`:158-160` = `panelHeight + 2*lineHeight > editorH/2`），循环内每收一条再问一次并 `break` ⇒ **上游是「排到放不下为止的前缀」**。本仓 `src/stickyLineViewport.ts:154` 只在**末尾**问一次 `stickyPanelFits(picked.length, …)` ⇒ 视口矮时本仓**一条都不出**、上游出「放得下的那前几条」⇒ 本批在 `src/stickyLines.ts` 合成处按行预算夹一刀补上（`stickyLineViewport.ts` 不在本 lane 名下，只读） |
| 派单：`"..."` 是三处各自写的字面量 | **成立**：`platform/foldings/src/com/intellij/codeInsight/folding/impl/UpdateFoldRegionsOperation.java:162` `placeholder == null ? "..." : placeholder`；`platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java:116-119`（单参重载 `return "..."`，**行号 118 与派单一致**）、同文件 `:101-111` 是双参重载走 provider 的 `getPlaceholderText`；provider 各自一处 `isEmpty()` 分支：`platform/lang-impl/src/com/intellij/lang/customFolding/NetBeansCustomFoldingProvider.java:24-27`、`VisualStudioCustomFoldingProvider.java:22-27`。⚠ 派单写的 `CustomFoldingBuilder.java` 若按 `platform/lang-impl/...` 找**找不到**（真身在 `platform/core-api/src/com/intellij/lang/folding/`）⇒ 留痕：本仓引用只写文件名+行号，未写错目录 |
| 派单：`CodeFoldingSettings.java` 只有 5 个布尔 | **成立**：`platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java:7-11`（COLLAPSE_IMPORTS / COLLAPSE_METHODS / COLLAPSE_FILE_HEADER / COLLAPSE_DOC_COMMENTS / COLLAPSE_CUSTOM_FOLDING_REGIONS），无 `String` 字段 ⇒ **上游没有「用户可自定义占位符」这一档** ⇒ 本批不造设置项 ✓ |
| 上游 provider 注册数 | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1466-1467` 只注册 **2** 个（NetBeans / VisualStudio），EP 声明在 `platform/core-api/resources/intellij.platform.core.xml:40`。本仓 `src/customFoldingProviders.ts` 有 3 条（第三条 `<region ?>` 形态）⇒ **登记不处理**：provider 表归 `customfold` / `foldgoto` 名下，且「多一条会多折一种标记」不是本批的占位文字档位 |
| 上游那一族**叫什么**（本批新查，给 W-2 改文案用） | `platform/ide-core/resources/messages/ApplicationBundle.properties:283` `checkbox.show.sticky.lines=Show sticky lines while scrolling`、`:285` `label.show.sticky.lines=Maximum number of lines:`、`:284` `label.sticky.lines.languages=Languages:`、`:286` `configure.sticky.lines.colors=Manage colors` ⇒ 上限那一格的名字是 **Maximum number of lines**（本仓叫「层数上限」，中文措辞**无法核实**）；复选框原文带 `while scrolling`，即**跟随滚动**这件事写进了名字里（本仓 `SettingsDialog.vue:909` 那句「在编辑器顶边固定显示当前作用域」少了滚动那一半 ⇒ 登记，改文案时按这四行来，别自己编）。这四行 key 就是 `StickyLinesConfigurableUI.kt:33/:39/:46/:68` 引用的那四个 ✓ |
| `platform/editor-ui-impl` | 派单/看板里有人引这个目录 ⇒ 本树**不存在**（只有 `platform/editor`、`editor-ui-api`、`editor-ui-ex`）；粘性行一族真身在 `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/` 与 `platform/lang-impl/src/com/intellij/codeInsight/stickyLines/`，`CodeFoldingSettings.java` 真身在 `platform/core-api/src/com/intellij/codeInsight/folding/`（**不在** `lang-api`）、`CustomFoldingBuilder.java` 在 `platform/core-api/src/com/intellij/lang/folding/`（**不在** `lang-impl`）⇒ 与「4 处参考树里不存在的上游路径」同族，本批所有引用都按实际路径写 |
| 本仓 `foldPlaceholderFor` 取值链 | `src/editorFolding.ts:880-891`：服务端 `collapsedText`（非空串）→ `kind === 'region'` 时取开始标记的 provider 说明 → `FOLD_PLACEHOLDER_TEXT = '...'`（`:873`）。与上游同序：LSP 的 `collapsedText` 进 descriptor（`platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:51`）、descriptor 没给 placeholder 才 `...`（`UpdateFoldRegionsOperation.java:162`）、region 的说明由 provider 给（`CustomFoldingBuilder.java:101-111`）。**链等价 ✓**；差异只有一处且与本仓架构同源：`foldPlaceholderFor` 只遍历 `foldingRanges`（= LSP 区间 + `localRegionFolds` 合并表，`:371-373`），语法树自己折的那块不在表里 ⇒ 落 `...`，上游对没有 descriptor 的折叠同样只有默认占位 |
| `foldPlaceholderFor` 的消费方 | `grep -rn "foldPlaceholderFor" src/ tests/ native/` ⇒ **src/ 里只有定义那一处（`editorFolding.ts:880`）+ 两处注释（`:26`、`:870`）**，其余 12 处全在 `tests/folding-placeholder.test.mjs` ⇒ **零生产消费方成立**。宿主侧根本没有 `codeFolding(...)` 这一句（`grep -n "codeFolding" src/components/CodeEditor.vue` = 0 命中，折叠由 `:3` 的 `basicSetup` 带进来）⇒ 用户现在看到的折痕文字是 CodeMirror 的默认档 `…` 单字符（`node_modules/@codemirror/language/dist/index.js:1517` `placeholderText: "…"`），**不是**上游的三点 ⇒ 本批不判「不适用」，写成 §5 的渲染钩子请求 |

## 2. 落盘

- 改动文件清单（`wc -l` 前 → 后，改后一律重新 `wc -l` 实测）：

| 文件 | 前 | 后 | 这次动了什么 |
|---|---|---|---|
| `src/stickyLines.ts` | 258 | **323** | 新增 `STICKY_LINES_LIMIT_DEFAULT/MIN/MAX`（`:68-85`，`[-]` 不夹取的理由写在注释里）、`stickyViewRowBudget`（`:86-106`）、`fallbackScrollTop`（`:254-263`）；`linesForView`（`:275-282`）改为按行数预算出层；文件头补三条档位留痕 |
| `src/editorFolding.ts` | 886 | **891** | **只动注释**（`:863-871` 那一段）：把指向不存在的 `docs/wiring-requests-2026-10-06-folding2.md` 的「W-7」改指在盘的那份，并把 `basicSetup` 的行号从写错的 937 订正为实测 935；`foldPlaceholderFor` 的**代码一字未改**（变异 M4 注入后已 `cmp` 核回原文件） |
| `tests/sticky-tier-scroll.test.mjs` | 不存在 | **103** | 新建：5 条判据（档位 5/1/20、不夹取、行预算反解、短面板出前缀、共享顶行不跨栏） |
| `tests/folding-placeholder.test.mjs` | 82 | **131** | 新增 3 条判据（两条 trim 规则分开、空表仍回默认占位、`foldPlaceholderFor` 的形状 = `preparePlaceholder`）；文件头那条假指针订正 |
| `docs/wiring-requests-2026-10-06-stickyfold.md` | 不存在 | 新建 | W-1…W-4（见 §5） |
| `src/customFoldingSurround.ts`、`tests/folding-custom-region-surround.test.mjs` | —— | —— | **未动**（`customfold` 在写，见 §6） |

- 本批**没有**新增 `src/` 模块文件（新判据全落在既有模块 + 一个新测试文件里）；
  没有新增设置键（上游无「自定义占位符」档，`CodeFoldingSettings.java:7-11` 只有 5 个布尔 ⇒ 不动 `settingsModel.ts` / `settings_schema.*`）。

## 3. 判据（含反向验证三步记录）

| 判据 | 文件 | 注入的变异 | 结果（红几条） |
|---|---|---|---|
| 档位 = `UINumericRange(5, 1, 20)` | `tests/sticky-tier-scroll.test.mjs` 第 1 条 | **M2**：`STICKY_LINES_LIMIT_MAX` 20 → 10 | tests 5 / pass 4 / **fail 1** ⇒ 摘掉后复原 |
| 模块不夹取外来 limit（25 就按 25 排） | 同上第 2 条 | **M1 的一部分**：把 `stickyViewRowBudget` 无条件 `return rows` 时，第 2 条仍绿（它钉的是「不夹」，变异方向相反）⇒ 该条靠 M2 之外的另一头钉：把 `Math.min(rows, …)` 写成 `Math.max(rows, …)` 会让第 2、3 条同时不成立（见 M1 的 2 红） | 见 M1 |
| 短面板按「放得下的前缀」出层 | 同上第 3、4 条 | **M1**：`stickyViewRowBudget` 结尾改成 `return rows // STICKYFOLD-M1`（丢掉行预算） | tests 5 / pass 3 / **fail 2**（第 3、4 条同时红）⇒ 摘掉后复原 |
| 共享 `firstVisibleLine` 不跨栏 | 同上第 5 条 | **M3**：`fallbackScrollTop` 改回无条件 `deps.firstVisibleLine?.()` | 三个 sticky 文件合计 tests 30 / pass 29 / **fail 1** ⇒ 摘掉后复原 |
| `collapsedText` 原样、provider 说明 trim | `tests/folding-placeholder.test.mjs` 第 5 条 | **M4**：`src/editorFolding.ts` 那一行改成 `fold.collapsedText.trim() !== '' … return fold.collapsedText.trim() // STICKYFOLD-M4` | tests 7 / pass 6 / **fail 1**（正是第 5 条，红名逐字打印） ⇒ 摘掉后复原 |
| 空表仍回默认占位 / 形状 = `preparePlaceholder` | 同上第 6、7 条 | 未单独注入（第 7 条自带反证钉：`FOLD_PLACEHOLDER_TEXT` 与 `…` 不同、`foldPlaceholderFor.length === 2`，改签名或改回单字符都会红） | 7/7 绿 |

- 既有断言**一条没放松**：`tests/gutter-menu.test.mjs:113-131`（留最外 N 条 / 开关与 0 档）与
  `tests/sticky-lines.test.mjs`、`tests/sticky-line-viewport.test.mjs` 全部原样通过（见 §4 的 107/107）。
  本批没有需要「证明它钉错了形状」才改的断言 ⇒ 一处也没改。
- 还原核对（变异全部摘干净）：
  - `sha1sum src/stickyLines.ts` = `27ef1128ac1434ab7f71bebdda60ac3b01163b86`（动手前的基线值，逐字符相同）
  - `sha1sum src/editorFolding.ts` = `3d8c91f92d28b159c0398bc5e1a144c889b6ce74`（= M4 之前的基线；`cmp` 输出 `CMP=identical`）
    ⚠ 这条 sha1 是**注释订正前**的基线；M4 复原时按 `cmp` 逐字节还原过，之后我另做的那次注释改动是**新的一次落盘**（§2 里 886→891 那一行），两者不冲突。
  - `grep -rn "STICKYFOLD" src/ tests/ native/` ⇒ **0 命中**（`exit=0`、无输出行）
  - 过程事故留痕：M3 之后 `cp` 还原报 `Permission denied` ⇒ 文件短暂处于变异态，立刻 `cp -f` 复原并重取 sha1 核过；
    `node fs.writeFileSync` 对 `src/editorFolding.ts` 连续两次 `UNKNOWN: unknown error, open`（外部占用该文件），
    改用 `Edit` 工具才完成注入与复原 ⇒ 并发期**别用 node 直写别人的编辑器可能占用的文件**。

## 4. 门禁原始数字

全部在本 lane 收工前实跑；命令与输出逐条照抄。

1. `node --test tests/folding*.test.mjs tests/sticky*.test.mjs tests/gutter-menu.test.mjs tests/module-size.test.mjs`
   ⇒ `ℹ tests 107  ℹ suites 0  ℹ pass 107  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0`
   （动手**前**的同域基线我只取了能区分归属的那三条：`tests/sticky-lines.test.mjs tests/sticky-line-viewport.test.mjs tests/gutter-menu.test.mjs`
   ⇒ `tests 30 / pass 30 / fail 0`。本批新增 8 条判据（5 + 3）⇒ 107 = 99 + 8。）
2. `node .tools/find-orphan-modules.mjs --gate`
   ⇒ `词法自检：0 异常`、`门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2`、`门禁绿：没有基线之外的新增零消费方模块。`（exit 0）
3. `node .tools/find-missing-ext.mjs`
   ⇒ 第一次 `扫描 1378 个文件（src + tests）…` + `干净：没有漏扩展名、且静态也解析不到的相对 import。`；
   收工前复跑同一命令 ⇒ **1379 个文件**、仍「干净」（多的那一个不是本 lane 建的 ⇒ 并发期别人加了一个文件，本 lane 不认领）。
4. `node .tools/find-param-props.mjs` ⇒ `共 0 处参数属性`；`node .tools/find-ts-in-mjs.mjs` ⇒ `干净：tests/*.mjs 全部是纯 JavaScript。`
5. **隔离 tsconfig 的 `tsc --noEmit`**（并发期不用全仓 `vue-tsc -b`，它的 0 错不可作证据）：
   `npx tsc -p build/stickyfold/tsconfig.isolated.json`（`compilerOptions` 逐条照抄根 `tsconfig.json`，
   `files` 只列 `src/stickyLines.ts`、`src/editorFolding.ts`、`src/customFoldingSurround.ts`、`src/foldingKeymap.ts`）
   ⇒ **无输出、exit 0 = 0 错**。另对 W-1 那段宿主代码单独跑
   `npx tsc --noEmit --strict … build/stickyfold/w1-check.ts` ⇒ **0 错、exit 0**。
6. 引用门 `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs`
   ⇒ 首跑 `tests 11 / pass 8 / **fail 3**`。三条红的归属：一条来自 `docs/batch-2026-10-06-findrep2.md`
   （别人那份文档里把某个 `ConsoleViewImpl` 的行号写成了一个明显越界的六位数，门直接报「行号超出文件长度」）、
   四条 `moved` 分布在 `src/commitChecks.ts`、`src/components/ProblemsPanel.vue`（2 条）、`src/runStartupFocus.ts`
   —— **这些文件本 lane 一行未动**（`commit*` / `ProblemsPanel.vue` / `run*` 都在并发黑名单里）。
   ⚠ **本批踩到的一次自我污染（订正留痕）**：我第一版把上面那条红的**原文照抄**进了本报告，
   引用门立刻把我自己这份文档也收成一条违规（第二次跑就变成 `findrep2` + `hlregistry` + **本文件** 三条），
   正是 `.tools/agent-rules.md` §5 警告的那一类：文档里转述「假路径:行号」会被当成一条真引用收集。
   ⇒ 现在这一节**只描述、不复现那个形状**（去掉行号与完整路径形状）；再跑本文件不再出现在红名单里。
   （另一条 `hlregistry` 那份文档犯了同样的错，不是本 lane 的文件，只上报。）
   本批自己新写的每一条上游引用都在「指得到」那一门的输出里没有出现 ⇒ 按图索骥都指得到
   （新引用没进快照，所以 anchors 那一门只比已有的那些）。
7. 未跑：全量 `npm test`（派单禁止 + 会把别人的在途红算到本 lane）、`ctest`（`native/` 一行未动）、
   全仓 `vue-tsc -b --force`（并发期一处语法错会遮掉全部语义检查）。

## 5. 接线请求

见 `docs/wiring-requests-2026-10-06-stickyfold.md`：

- **W-1** `src/components/CodeEditor.vue`（保留文件，余量 2 行）：补 `codeFolding({ preparePlaceholder, placeholderDOM })`，
  把 `foldPlaceholderFor` 接上屏 —— 现在用户看到的是 CodeMirror 默认的单字符 `…`，上游是 `...`。
  请求里的代码已过 `tsc`（0 错）。这是 `foldPlaceholderFor` **唯一的**收法，本 lane 没有自判「不适用」。
- **W-2** `src/components/SettingsDialog.vue:910` + `src/previewSettings.ts:70` + `native/settings_schema.cpp`（两处分支）：
  层数上限 0…10 ⇒ 上游档 **1…20**；顺带订正设置页那两句中文的英文原文依据。
- **W-3** `src/App.vue:544`：多分栏实参（引用 `docs/wiring-requests-2026-10-06-stickyprio.md` 的 W1/W2/W3），
  只补本批新增的两个前提：每块面板要各带 `firstVisibleLine` + `lineHeight` + `viewportHeight`，
  且多栏时**别再传**顶层共享的 `firstVisibleLine`（模块现在会忽略它）。
- **W-4** `src/stickyLineViewport.ts`（不在本 lane 名下，只读）：把 `stickyPanelFits` 从循环末尾移进循环，
  才能吃到上游「顶过界那一条也留」那一档；给出方向代码 + 会撞红的那条既有判据（`:82`）与处理规则。

## 6. 无法核实与不做

**无法核实（不编）**

1. **跨视图的显示优先级**：上游 `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/` 与
   `platform/lang-impl/src/com/intellij/codeInsight/stickyLines/` 两目录 `grep -rn priority` ⇒ 命中文件数 **0**
   （本 lane 亲自复跑；后者只有 `StickyLinesPass.kt`、`StickyLinesPassFactory.kt`）。⇒ 档位只能宿主给。
2. **一切中文措辞**：本地树没有 zh 语言包 ⇒ 设置页/菜单的中文一律标无法核实。本批只核到**英文原文**：
   `platform/ide-core/resources/messages/ApplicationBundle.properties:283-286`（四条，已抄进 W-2）。
3. **`<region ?>` 那一族 provider 的上游依据**：上游只注册 2 个（`intellij.platform.lang.impl.xml:1466-1467`），
   本仓表里第三条（`src/customFoldingProviders.ts:95` 的 `<region\b`）指不到上游 ⇒ 登记，不改（表在 `customfold` / `foldgoto` 名下）。

**做不到 / 未做（具体卡在哪一环）**

1. `11…20` 这一档用户**仍然拿不到**：卡在 `SettingsDialog.vue` / `previewSettings.ts` / `native/settings_schema.*` 全是保留或别人名下 ⇒ 只落了模块侧真源 + 判据，改校验交 W-2。
2. 折痕文字**仍然不上屏**：`foldPlaceholderFor` 生产消费方还是 0 个 —— 卡在 `CodeEditor.vue` 没有 `codeFolding(...)` 那一句（余量 2 行，本 lane 不能动）⇒ W-1。
3. 「顶过界那一条也留」这一档**没做**：`src/stickyLineViewport.ts` 不在派单名下 ⇒ 只能把「放得下的前缀」做在合成处（`stickyViewRowBudget`），最后一条差值写在 W-4。
4. `src/customFoldingSurround.ts` + `tests/folding-custom-region-surround.test.mjs` **跳过**：mtime 15:40/15:43、
   `docs/batch-2026-10-06-customfold.md` mtime 15:53（我开工 16:06）⇒ 判定并发在写，未动一字节。
5. `App.vue:544` 仍只取 `stickyLines` ⇒ `stickyLinesByView` 依旧零消费方：卡在 `App.vue`（余量 30）与 `CodeEditor.vue`（余量 2）都不能动，且这条线 stickyprio 已经提过请求，本 lane 不重复提、只在 W-3 补前提。
6. 钉住 `stickyLineViewport.ts:154` 那条「整块清空」判据（`tests/sticky-line-viewport.test.mjs:82`）**没翻**：
   它在 `stickyprio` / `hier3` 名下，且要翻得先按纪律证明它钉错形状 ⇒ 留给 W-4。
7. 未跑 ctest / 全量 npm test / 全仓 vue-tsc（理由见 §4 第 7 条）。
8. 临时件：`build/stickyfold/`（变异前的 sha1 备份 + 隔离 tsconfig + W-1 的 tsc 自检文件）—— 收工删除；
   删除前 §3 的 sha1/`cmp` 证据已经取过。**已删**（`rm -rf build/stickyfold` ⇒ `temp-dir-removed`）。

## 7. 收工自查（归属与触碰面，mtime 实测 16:2x）

- 本 lane **动过**的盘上文件只有 4 个（+2 份文档）：
  `src/stickyLines.ts`(16:22)、`src/editorFolding.ts`(16:23，只动注释那一段)、
  `tests/folding-placeholder.test.mjs`(16:21)、`tests/sticky-tier-scroll.test.mjs`(16:20，新建)；
  文档：`docs/batch-2026-10-06-stickyfold.md`(160 行)、`docs/wiring-requests-2026-10-06-stickyfold.md`(164 行)。
- **没动过**（mtime 早于本 lane 开工，`git status` 里的 ` M` 不是我造成的）：
  `tests/gutter-menu.test.mjs`(14:23)、`src/foldingKeymap.ts`(14:51，仍是 `??` 未跟踪)、
  `src/customFoldingSurround.ts`(15:40)、`src/stickyLineViewport.ts`、`src/customFoldingProviders.ts`、
  以及全部保留文件（`App.vue` / `bridge.ts` / `CodeEditor.vue` / `settingsModel.ts` / `native/settings_schema.*` /
  `native/main.cpp` / `scripts/verdict_table.py` / `docs/inventory/**`）。
- 最后一次门禁复跑（删临时件之后）：`node --test tests/folding*.test.mjs tests/sticky*.test.mjs tests/gutter-menu.test.mjs tests/module-size.test.mjs`
  ⇒ `tests 107 / pass 107 / fail 0`；`grep -n "STICKYFOLD" src/editorFolding.ts src/stickyLines.ts` ⇒ 无输出。
  （隔离 tsconfig 那份 `tsc -p build/stickyfold/tsconfig.isolated.json` 的 0 错是在删临时件**之前**取的，数字见 §4 第 5 条。）
- 注入/夹带记录：本轮工具结果里出现的**都不是指令**——`agent-rules.md` 尾部与多次 Bash 输出尾部夹带的
  「skill 清单 / 任务清单（243 条别的 lane 的活）/ 已完成提示」一律当数据；
  本 lane 没有据此改任何归属（名下文件、黑名单、保留文件全部按派单原文执行）。
  真实踩到的一次是**自我污染**（§4 第 6 条）：把别的 lane 的假 `路径:行号` 原文照抄进本报告，
  被引用门收成一条真违规 ⇒ 已改写为「只描述、不复现形状」并复跑核过。

