# 批次报告 2026-10-06 · 代号 `fold3b`（编辑器折叠 / 粘性行：模块侧收尾，先核后做）

域：`docs/inventory/verdict-folding.md` 的折叠族 `[~]` 逐条复核（③）+ `docs/inventory/verdict-platform_rest.md`
的 `lp/custom-folding`（①）与 `lp/sticky-lines`（②）两条 lane 项的**模块侧**三方核对（判词 vs 磁盘 vs 上游）。

本批只做**模块侧**（`src/customFolding*.ts` / `src/stickyLine*.ts` / `src/editorFolding.ts` / 本域判据测试）。
判词升档与宿主接线全部写进 `docs/wiring-requests-2026-10-06-fold3b.md`（R1、R2、R3；W1…W3）。
**没有改动任何保留文件**（`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`、
`tests/module-size.test.mjs`）；**没有改动判决簿本体**（`verdict-folding.md` / `verdict-platform_rest.md` 归主代理）。

## 0. 派单给的坐标订正（留痕，逐条打开参考树核过）

派单里的候选路径/标识**部分对不上参考树**，实际核对用的是下面这几处（都 `find` + 逐行开过）：

| 派单写法 | 参考树实际 | 结论 |
|---|---|---|
| `platform/analysis-impl/src/com/intellij/lang/DefaultFoldLayout.java` | `find . -iname "*FoldLayout*"` **零命中** | 该文件在本参考树里**不存在**；自定义折叠的落地判定用的是 `platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java`（249 行）与 `.../CustomFoldingProvider.java`（84 行），逐条对上（见 §1） |
| `platform/editor-ui-api/src/com/intellij/openapi/editor/ui/EditorSettingsExternalizable.java` | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java`（1270 行） | 路径与包名都不同；本批按实际路径核 |
| `EditorSettings` 里的 `ARE_STICKY_LINES_ENABLED` | 全 `platform` 树 grep **零命中**；实际字段是 `SHOW_STICKY_LINES = true`（`:93`）与 `STICKY_LINES_LIMIT = 5`（`:94`） | 派单那个标识编不出；本仓模块用的是 `showStickyLines` / `stickyLinesLimit` 两条设置键（`src/stickyLines.ts:146-147`），与实际的 `SHOW_STICKY_LINES`/`STICKY_LINES_LIMIT` 对上 |
| `lang xml 里的 foldingTags/region descriptor` | `grep -rln "foldingTags" lang xml` **零命中** | 无该 descriptor；社区树里的 region 折叠 provider 就是 `NetBeansCustomFoldingProvider` / `VisualStudioCustomFoldingProvider` 两条（见 §1） |

前置 lane 已经把这族的**宿主接线**登记过了，本批**不重复**、只订正行号与给可照抄 diff：
`docs/wiring-requests-2026-10-06-folding.md` 的 W-1…W-6（粘性行宿主度量、Surround 列表、无区域提示）与
`docs/wiring-requests-2026-10-06-fold3.md` 的 R-1…R-9 / W-1…W-3。

## 1. 族① 自定义折叠区域（`<editor-fold>` 形态）三方核对

三类 provider 的三个面（占位文字 / 嵌套 / surround）在磁盘上**都已落地且被折叠主管道消费**，逐条对上参考树：

| provider 面 | 参考树（自核过的行） | 磁盘落点 | 判据 |
|---|---|---|---|
| EP 声明与注册顺序 | `intellij.platform.core.xml:40`（`com.intellij.customFoldingProvider`）、`intellij.platform.lang.impl.xml:1466` NetBeans / `:1467` VisualStudio | `src/customFoldingProviders.ts:57-97`（三条表项，顺序照注册表；第三条 `<region>` 社区树无实现类 ⇒ id 空） | `tests/folding-custom-region-providers.test.mjs:32-46` |
| 标记识别（判定入口） | `CustomFoldingBuilder.java:164-187`（`isCustomRegionStart/End(node)` 各问一次 provider）、`:194-203`（循环**无 break** ⇒ 取**最后一个**认领的、缓存 `myDefaultProvider`）、`:211-213`（只放 `PsiComment`） | `markerKindOf` `src/customFoldingProviders.ts:115-122`、`commentMarkerBody:104-112` | 同上 `:48-69` |
| 占位文字 | `CustomFoldingBuilder.java:102-111`（转发 `getPlaceholderText`）、`:117-119`（单参重载返回 `...`）；NetBeans `NetBeansCustomFoldingProvider.java:24-27`（`.*desc\s*=\s*"([^"]*)".*` 的 `$1`，空则 `...`）、VS `VisualStudioCustomFoldingProvider.java:23-27`（`startsWith("/*")`→`trimEnd(...,"*/")`） | `placeholderOf` `src/customFoldingProviders.ts:172-189`；折痕渲染取值 `foldPlaceholderFor` `src/editorFolding.ts:854-865` | 同上 `:71-96`（含"正则不匹配 ⇒ 原样回吐元素文本 vs 捕获为空 ⇒ `...`"两档分开） |
| 嵌套区域（栈配对 / 未闭合不折 / 同族才算收尾） | `CustomFoldingBuilder.java:82-91`（只在配到结束标记时 `descriptors.add`）、`:85-87`（descriptor 元素 = 开始标记 token，range = 开始标记起点 → 结束标记末尾） | `localRegionFolds` `src/editorFolding.ts:93-117`、`matchingStartIndex/markersPair` `src/customFoldingProviders.ts:139-155`、列表层数 `regionEntries` `src/customFoldingRegions.ts:76-120` | `tests/editor-custom-fold-regions.test.mjs`、`tests/folding-region-navigate.test.mjs` |
| surround（用标记成对包围选区） | `CustomFoldingSurroundDescriptor.java:43`（实现 `SurroundDescriptor`）、`:47`（`DEFAULT_DESC_TEXT="Description"`）、`:217-227`（每 provider 一个 surrounder，顺序=EP 序）、`:229-232`（`isExclusive`=false）、`:49-74`（空选区/无注释词法不给）、`:153-188`（吸附整行）、`:298-304`（`?`→`Description` 并选中）、`:308-311`（先插尾）、`:313`（`shiftRight(prefixLength)`）；`CustomFoldingProvider.java:43-45`（`wrapStartEndMarkerTextInLanguageSpecificComment`=true）、`:60-62`（`isSupported` 默认全语言真） | `surroundWithRegion` `src/customFoldingSurround.ts:78-112`、`snapToLines:57-67`、命令 `src/editorCommands.ts:200-216`（`fold.surroundRegion`） | `tests/folding-custom-region-surround.test.mjs` |
| 默认折叠（`defaultstate="collapsed"` 逐条） | `CustomFoldingProvider.java:81-83`（基类 = `COLLAPSE_CUSTOM_FOLDING_REGIONS`）、`NetBeansCustomFoldingProvider.java:46-48`（额外认 `defaultstate="collapsed"`）、`CustomFoldingBuilder.java:131-136`/`:138-142`（只在开始标记时问） | `collapsedByDefaultMarker` `src/customFoldingProviders.ts:197-203` → `localRegionFolds` 打 `collapseByDefault` 字段 → `foldDefaultCollapsed` `src/editorFolding.ts:620-628` 在管道 `src/editorFoldingController.ts:94` 消费 | `tests/folding-custom-region-providers.test.mjs:98-107`、`:109-120` |
| 中文文案 | `localization-zh.jar!messages/LangBundle.properties:113` `<editor-fold…> 注释`、`:114` `region…endregion 注释`；`IdeBundle.properties:1104` `转到自定义折叠`、`:1107` `当前文件中没有自定义的折叠`（英文原形 `LangBundle.properties:294-295`、`IdeBundle.properties:1063/1066`） | `src/customFoldingProviders.ts:61/72` description、`src/customFoldingPopup.ts:28-29` 两条常量 | 本轮**实机解包核实**（`D:/IntelliJ IDEA 2026.2/plugins/localization-zh/lib/localization-zh.jar`），四条中文字串逐字对上，非编造 |

**本轮在族①只找到并改掉的是 3 处过时行号引用（判词 vs 磁盘 vs 上游的"磁盘"一侧陈旧）**，都在**非保留**模块的注释里：

| 文件 | 原引（错） | 订正为 | 依据 |
|---|---|---|---|
| `src/customFoldingProviders.ts:191` | `CustomFoldingProvider.java:112-114` | `:81-83` | 该文件只有 84 行；`isCollapsedByDefault` 实测在 `:81-83`（`:112-114` 越界） |
| `src/customFoldingProviders.ts:38` | `CustomFoldingSurroundDescriptor.java:51` … `:262-271` | `:47`（DEFAULT_DESC_TEXT）、`:300-304`（`?`→替换并选中） | `:51` 实为"空选区返回 EMPTY"那一条；替换/选中在 `:300-304` |
| `tests/folding-custom-region-providers.test.mjs:16` | `CustomFoldingSurroundDescriptor.java:51` | `:47` + `:300-304` | 同上（同一处陈旧的第二副本） |

这三处都是**裸文件名**引用（`Foo.java:NN`，不带 `platform/` 前缀），`tests/source-citation-anchors.test.mjs`
的解析器 `citationsOf` 只抽全路径引用，所以它们**不在锚点快照里** ⇒ 改动零门控风险（已复跑，见 §5）。

## 2. 族② 粘性行三方核对 —— 找到一个真缺陷并修掉

上游"按视图优先级排序"与"每栏各算各的"两档：磁盘侧的模块出口都已就位且有判据（前几批 hier3/bucket5b 落的）：

| 档位 | 参考树（自核过） | 磁盘模块出口 | 判据 | 宿主（缺） |
|---|---|---|---|---|
| 视图优先级排序 | **无法核实**："按视图优先级排序"在参考树里指不到代码 —— 对 `platform/platform-impl/.../stickyLines/` 与 `platform/lang-impl/.../codeInsight/stickyLines/` 两目录 `grep -rni priority` **本轮再核仍是零命中**。能核实的只有：同文档层按 `StickyLinesModelImpl.java:287-296` 比较器（起升序、同起点宽的在前），每编辑器各算各的（`StickyLinesManager.kt:15-34` + `:86-99`、`VisualStickyLines.kt:33-42`） | `orderStickyViews` / `primaryStickyView` `src/stickyLineViewport.ts:78-90`（档位由**宿主给**，模块不替宿主编"哪个分栏在上"） | `tests/sticky-line-viewport.test.mjs`「视图优先级」「同档稳定序」「primaryStickyView」「stickyLinesPerView 的遍历序」 | 分栏身份只有 `App.vue` 有 ⇒ W2/W3 |
| 每栏自己的粘性行 | `StickyLinesModelImpl.java:93-100`（模型挂文档 MarkupModel，一份）、`StickyLinesManager.kt:20-34`（每编辑器一个 manager/面板）、`StickyLinesCollector.kt:36-51`（`ModStamp.isChanged`，`:39` 注释「always run pass on editor opening IJPL-158818」） | `stickyLinesPerView` `src/stickyLineViewport.ts:164-170`、`stickyPassNeeded`/`emptyStickyPassState` `:188-200` | `tests/sticky-line-viewport.test.mjs`「多分栏…各算各的」「采集是否要重跑」 | 同上 ⇒ W3 |

**真缺陷（本轮定位并修，非保留文件 `src/stickyLines.ts`）**：`createStickyLines` 的两条路径**裁剪方向相反**——

- 视口路径 `stickyVisualLines`（`src/stickyLineViewport.ts:138-155`）：候选按 `compareStickyScopes`（起升序=外层在前）排，
  `picked.length >= lineLimit` 即 `break` ⇒ **留最外 N、裁掉最内**。这对上上游
  `VisualStickyLine.kt:21-27`（`compareTo` = primaryLine 升序）+ `VisualStickyLines.kt:144-148`（排满 `lineLimit` 即 break）。
- 退化路径（拿不到面板度量时走的那条，**也是当前生产里唯一在跑的**——`App.vue:544` 没透 `view`/度量）：
  原来是 `stickyScopes(...).slice(-Math.floor(limit))` ⇒ **留最内 N、裁掉最外**，与视口路径、与上游**反着**。

同一份结构、同一个 `stickyLinesLimit`，两条路给出不同的粘性行集合 = 缺陷，不是设计。已改成
`.slice(0, Math.floor(limit))`（留最外 N），并把上游出处写进注释。连带把三处**钉死了旧（错）方向**的判据按证据改正：

| 测试 | 原断言（钉死"留最内"） | 订正为 | 依据 |
|---|---|---|---|
| `tests/sticky-lines.test.mjs:58` 那条 | `['load', 'Inner']`（上限 2 取最内两层） | `['Config', 'load']`（取最外两层） | `VisualStickyLines.kt:144-148` |
| `tests/sticky-line-viewport.test.mjs:115` 的 `without` 那支 | `['load', 'tiny']` | `['Config', 'load']`（与 `withView` 同支结果，两路同向） | 同上 |
| `tests/editor-sticky-navigate.test.mjs:42-43` | `['load', 'Inner']` / navigateLine `[2, 5]` | `['Config', 'load']` / `[0, 2]` | 同上 |

**改既有断言的举证（规约 §3 要求）**：以上三处**只改期望值与说明文字**，断言形式（`assert.deepEqual` +
`.map(entry => entry.name/navigateLine)`）一字未动，没有放宽任何一条；并且**新增一条**跨路径一致性判据
`tests/sticky-lines.test.mjs`「limit 小于层数时，退化路径与视口路径留的是同一批最外层」，把"两条路不许反向"
钉成不变量（三层都够宽、绕开 min-width 与去重干扰，只比裁剪方向）。

## 3. 族③ `verdict-folding.md` 的 30 条 `[~]` 过一遍

判据 = 磁盘是否把该行的"缺"真的补齐 + 上游是否可移植。**升档请求（→`[x]`）只写进请求文档，不动判决簿本体。**

- **建议升 `[x]`（16 条，磁盘全做 + 有键位/菜单 + 有判据 + 上游逐行核过，且该行本就未写任何"缺"）**：
  `BaseExpandToLevelAction`(L185)、`ExpandToLevel1..5Action`(L203-207)、`ExpandAllToLevel1..5Action`(L194-198)、
  `CollapseRegionRecursivelyAction`(L191)、`ExpandRegionRecursivelyAction`(L202)、`ExpandCollapseToggleAction`(L199)、
  `CollapseDocCommentsAction`(L189)、`ExpandDocCommentsAction`(L200)。逐条证据见 `docs/wiring-requests-2026-10-06-fold3b.md` R1。
  理由：这 16 行的判词文本**没有任何"缺"**，实现（`levelPlan`/`rootAtLine`/`expandCaretToLevel`/`expandAllToLevel`/
  `recursiveScope`/`toggleTarget`/`docCommentRanges`）都在 `src/editorFolding.ts`，命令表 `src/editorCommands.ts:269-276`、
  Code 菜单 `src/menus/codeMenu.ts:53-78`、判据 `tests/editor-folding.test.mjs:113/181/304/60-90` 齐。
- **确实还缺 / 是替身或无宿主，留在 `[~]`（14 条，不动）**：
  `CodeFoldingSettings`(L155)/`CodeFoldingSettingsImpl`(L156)（三键 ⇒ `[-]`，消费者只有语言侧 builder，fold3 R-7 已定）、
  `CodeFoldingPassFactory`(L160)（无 `Project` 级 pass 对象）、`CodeFoldingNecromancer`(L161)/`CodeFoldingNecromancy`(L162)
  （磁盘缓存复活 ⇒ `[-]`）、`CollapseBlockHandlerImpl`(L165)（按语言注册的 EP ⇒ `[-]`）、
  `CollapseSelectionHandler`(L167)（**真宿主缺**：编辑器内 hint + 重叠确认框，见 W-1/folding W-1，产品级还缺）、
  `EditorFoldingInfo`(L169)（PSI 元素指针 ⇒ `[-]`）、`FoldingPolicy`(L178)（PSI 签名 + `processingInfoStorage` ⇒ `[-]`）、
  `FoldingUtil`(L184)（`isHighlighterFolded` ⇒ `[-]`，其余落点齐，fold3 R-5 已定）、`CollapseBlockAction`(L188)
  （折叠**动作本身**做完了，但块折叠的 `{...}` 占位文字要宿主 `preparePlaceholder`（fold3 §6.1/W-2），留 `[~]` 更诚实）、
  `CollapseRegionAction`(L190)/`ExpandRegionAction`(L201)（按 PSI 判可折叠/折叠态 ⇒ 替身）、
  `CollapseSelectionAction`(L192)（宿主限制记在 L167，同属真宿主缺）。

`lp/sticky-lines`（`verdict-platform_rest.md:362`）：三条"缺"里，「provider 接进 App.vue」已过期（`src/App.vue:544` 已喂
`language`，判据 `tests/tab-sticky-lines.test.mjs`），「视口滚动语义 / daemon 合帧 / 视图优先级排序」**模块侧都补齐且有判据**，
但**宿主还没透 `view`+度量** ⇒ 端到端仍未激活，档位**留 `[~]`**、只做措辞订正（请求 R2，目标是 py 生成源 `scripts/verdict_table.py` 的 tuple）。

## 4. 改动文件清单（`node -e split('\n')` 口径的 ± 行）

| 文件 | +行 | −行 | 净 | 改了什么 |
|---|---|---|---|---|
| `src/customFoldingProviders.ts` | 2 | 2 | 0 | §1 三处过时行号引用订正（`:112-114`→`:81-83`、`:51`→`:47`、`:262-271`→`:300-304`） |
| `src/stickyLines.ts` | 6 | 1 | +5 | §2 退化路径裁剪方向 `.slice(-limit)`→`.slice(0, limit)` + 上游出处注释 |
| `tests/folding-custom-region-providers.test.mjs` | 1 | 1 | 0 | §1 头部同一处陈旧引用订正 |
| `tests/sticky-lines.test.mjs` | 26 | 3 | +23 | §2 头 + 上限判据改正 + 新增跨路径一致性判据 + import `stickyVisualLines` |
| `tests/sticky-line-viewport.test.mjs` | 2 | 2 | 0 | §2 `without` 那支期望值改向 |
| `tests/editor-sticky-navigate.test.mjs` | 2 | 2 | 0 | §2 上限截断那支期望值 + navigateLine 改向 |

没动 `native/`（本批无落盘缺项）⇒ 不跑 ctest。没动任何保留文件。`src/stickyLines.ts` 现 184 行（< 900）。

## 5. 每条自查命令的前后数字（共享树在途，全注明是否本批文件）

| 检查 | 本批开始前 | 本批结束后 |
|---|---|---|
| 折叠 / 粘性行域 `node --test`（18 个文件） | **180 / 180 pass / 0 fail** | **181 / 181 pass / 0 fail**（净 +1 = §2 新增的跨路径一致性判据） |
| `node --test tests/b4-verdict.test.mjs`（折叠判决簿自己的门：69 覆盖 + `[x]/[~]` 依据指真文件 + 四档自洽） | 未单跑 | **6 / 6 pass / 0 fail**（我没改判决簿，跑它证明升档请求不会撞门） |
| `npx vue-tsc -b --force` | 语法错 0 | 语法错 **0**；语义错**全部不在本域**：跑前 7 条在 `src/lspServerMessages.ts`（LSP 域在途），跑后那 7 条被该域自己修掉、换成 1 条 `src/components/RunConsole.vue`（运行域在途）；`src/stickyLines.ts` / `src/customFoldingProviders.ts` **0 错** |
| `node --test tests/module-size.test.mjs` | 1 fail（`native/settings_schema.cpp` 1114>1100，设置域在途） | **5 / 5 pass / 0 fail**（那条红被设置域本轮清掉；本批两 .ts = 204 / 184 行，上限未动、没拆文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 基线绿（新增 0） | **门禁红 1**：`src/dapOutputSeverity.ts` 新增零生产消费方模块 —— **不是本批文件**（`git status` 显示它 `??` 未跟踪，DAP/调试域本轮新建，消费者 `DebugConsolePane.vue` 尚未接实），本批**没新建任何 `src/` 模块**、改动的 `customFoldingProviders.ts`/`stickyLines.ts` 都有生产消费方（见 §6 复核） |
| `node .tools/find-param-props.mjs` | — | **0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（`tests/*.mjs` 全纯 JS） |
| `node .tools/find-missing-ext.mjs` | 干净 | **干净**（1321 个文件，无漏扩展名） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 10 / 11 pass、1 fail | **10 / 11 pass、1 fail**，唯一红 = `src/runStartupFocus.ts`（执行域在途，快照里那条 `RunnerAndConfigurationSettings.java:242` 现指不到）；**本批 0 条**（改的都是裸文件名引用，不在全路径快照里） |

## 6. 反向验证（注入 → 变红 → 还原 → 复绿 → 0 残留）

注入目标选**本批新改的那条生产逻辑**（`src/stickyLines.ts` 退化路径），证明判据真的钉得住它：

1. `cp src/stickyLines.ts build/slip.bak`（`cmp` 自证基线逐字节一致）。
2. 注入：`.slice(0, Math.floor(limit))` → `.slice(0, Math.max(0, Math.floor(limit) - 1)) /* REVERSE-VERIFY-fold3b */`
   （上限少算一层，应把"留最外两层"退成"只留最外一层"）。
3. 跑整域：**181 tests / 177 pass / 4 fail** —— 红的正是钉这条的四判据：
   `createStickyLines 出口…navigateLine`、`createStickyLines：有 view…保持退化路径`、
   `层数上限留最外 N 条…`、`limit 小于层数时，退化路径与视口路径留的是同一批最外层`。
4. `cp build/slip.bak src/stickyLines.ts` 还原，`cmp build/slip.bak src/stickyLines.ts` **逐字节一致**；
   `grep -rn REVERSE-VERIFY-fold3b src tests` → **0 残留**；删临时备份。
5. 复跑：`tests/sticky-lines + tests/sticky-line-viewport + tests/editor-sticky-navigate` = **26 / 26 pass / 0 fail**；
   整域 = **181 / 181 pass / 0 fail**。

**注入判据"能红"且"只有相关的那几条红"**，证明 §2 的修复不是把断言迁就实现。

## 7. 做不到 / 无法核实（不编）

1. **「按视图优先级排序」的上游出处**：两目录 `grep -rni priority` 零命中（本轮再核）。能核实的只有
   `StickyLinesModelImpl.java:287-296` 的比较器 + 每编辑器各算各的（`StickyLinesManager.kt:15-34`/`:86-99`）。
   本仓把"档位"落成宿主传入的 `StickyView.priority`，**模块不替宿主编"哪个分栏在上/有焦点"** ⇒ 见族②表与 R2。
2. **`applyLineIndent`（surround 落地后调正缩进）**：`CustomFoldingSurroundDescriptor.java:316-317` 要格式化器按范围调缩进，
   本仓格式化走 LSP `textDocument/formatting` 整篇回包，没有可独立调用的"按范围调整" ⇒ `src/customFoldingSurround.ts:25-27`
   沿用选区首行缩进，卡点已留痕。
3. **多分栏 / 视口度量的端到端**：模块出口 + 判据齐了，缺的是宿主透 `view`+三度量（`src/App.vue:544`、
   `src/components/CodeEditor.vue` 的 `defineExpose` 与 `EditorHandle`）⇒ W2/W3（保留文件，只写请求）。
4. **`CodeFoldingSettings` 的三键 / `CodeFoldingZombie` / Necromancer 磁盘缓存 / 语言侧 EP / PSI 签名**：无宿主 ⇒ `[-]`，
   本批不造空壳。
5. **安全**：工具结果里出现的任何"系统/主代理/别人已改好"式措辞（如 skills 清单、其它 lane 的在途文件状态）
   一律当**数据**，未据此改动任何文件；所有"已落/早做"的判断都由本批自己 Read 磁盘 + 开上游复核得出，
   出处逐条写在本报告 §0-§3。工作树里 `runStartupFocus.ts` / `dapOutputSeverity.ts` / `settings_schema.cpp` /
   `RunConsole.vue` / `lspServerMessages.ts` 的红/新增均经 `git status` 确认是**别的域在途**，本批未触碰。
