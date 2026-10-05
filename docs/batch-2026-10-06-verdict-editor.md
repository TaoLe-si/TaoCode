# 2026-10-06 · 判决批次：`editor` 域 2551 类（B12）

上游基准树（唯一判定依据，全程本地读取，未上网）：
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
切片基准：`docs/inventory/editor.txt`（2551 行，`scripts/enumerate_inventory.py` 的产物）

## 1. 交付物与状态

| 产物 | 路径 | 状态 |
|---|---|---|
| 逐类判决表 | `docs/inventory/verdict-editor.md` | §G **2551 行 / 2551 类**，一一对齐，无缺行、无重复、无多行 |
| 本域门禁 | `tests/b12-verdict.test.mjs` | **9/9 绿**（`node --test tests/b12-verdict.test.mjs`） |
| 同表旧门禁 | `tests/b8-verdict.test.mjs` | **5/5 绿**（上一版把四档数字钉死，本批改判后同步了 EXPECT 与头部和数，其余逻辑未动） |
| 本报告 | `docs/batch-2026-10-06-verdict-editor.md` | 本文件 |

未新建其它文件；未改 `scripts/verdict_table.py`、其它 `verdict-*.md`、`tests/b7-verdict.test.mjs`、任何 `src/**` / `native/**`；未跑 `verdict_table.py` 默认档；未 commit / push / checkout / reset / stash / clean。

## 2. 四档计数（自己数的，门禁逐条复核）

| 档 | 上一版（本批开始前磁盘上的版本） | **本批终值** | 差 |
|---|---:|---:|---:|
| `[x]` 已移植 | 34 | **34** | 0 |
| `[~]` 部分 | 877 | **1035** | **+158** |
| `[ ]` 未移植 | 172 | **210** | **+38** |
| `[-]` 不适用 | 1468 | **1272** | **−196** |
| 合计 | 2551 | **2551** | — |

**已判行数：2551 / 2551（100%）。剩余未判：0 条。**

但要如实说清「判完」的边界：本批**没有把 2551 个文件的行为体逐条重读**。
上游源码的全量读取是「声明形态（interface / abstract class / class）+ Swing 标记 + 测试/生成物标记 + 包路径」四件套；
行为语义只对本批改判的 196 条与 §A/§B/§C 的族代表类做过抽查。判词是**待核实的断言**，不是已证明的事实。

## 3. 本批真正做的事：抓出并修掉「机械降级」

上一任在别的域抓出的真缺陷，在本域同样存在，而且规模不小：
**196 条 `[-]` 的实际依据是「这个类是接口 / 抽象类 / 契约 / 值对象」，而不是「类本体是 Swing 控件」。**

分三趟做（每趟的痕迹都写在行内理由里，可 grep）：

| 趟 | 抓法 | 结果 |
|---|---|---|
| 第一趟（82 行写「本批撤销」） | 读上游源码，凡 `interface X` / `abstract class X` 且类体不含 Swing 标记 ⇒ 撤 `[-]` | 112 条 → `[~]`、27 条 → `[ ]`、161 条按具体架构机制保留 `[-]` |
| 第二趟（36 行写「第二趟撤销」） | 换抓法：按**判决理由的落点**抓（上一版把 final 值对象、事件类、异常类、甚至 Swing 面板都塞进同一句「API 形状」里） | 50 条 → `[~]`、7 条 → `[ ]`、3 条确认是 Swing 构件本体（理由里写实际继承）、1 条是 NLS 消息目录 |
| 第三趟（75 行写「第三趟核实落点」） | 逐条核实「这个落点文件真的承载这个概念吗」 | 73 条改指到核实过的文件、4 条核实不到承载者 ⇒ 降回 `[ ]` |

第三趟是关键的一刀，也是最容易自己骗自己的一刀：第一、二趟的落点是**按族/按关键字**给的，
其中一批其实指错了地方。中途我写过一版「全仓词频最高的文件」自动改锚点，结果把
`LogicalPosition` 指到 `native/lsp_fake_server_requests.cpp`、把 `colors` 指到 `native/project_file_colors_test.cpp`、
把 `code` 指到 `native/main.cpp` —— 全是假落点，已整批回滚重做。最终只接受**逐条 grep 核实过的概念→文件**映射：

- 坐标换算（`coordsAtPos` / `posFromChar` / 视觉行偏移）全仓只在 `src/components/CodeEditor.vue`；
- 换行档（`lineWrapping`）全仓只在 `src/editorTheme.ts`；
- 可变区间标记在 `src/editorDiagnosticMarkers.ts`、折叠在 `src/editorFolding.ts` + `src/editorFoldingSettings.ts`、
  内联在 `src/editorInlayHints.ts`、参数信息在 `src/semanticActions.ts`、剪贴板在 `src/editorClipboard.ts`；
- `src/editorText.ts` 只有 `wordAt` / `offsetOf` / `applyTextEdits`，**没有**坐标换算，所以位置值对象族不再指它。

核实不到承载者而降回 `[ ]` 的 4 条（不是偷懒，是真没有）：
`SmartStripTrailingSpacesFilter`、`StripTrailingSpacesFilter`、`StripTrailingSpacesFilterFactory`、`XCorrector`。
前三条的证据就在本仓自己的代码里：`src/editorConfig.ts:334` 解析了 `trim_trailing_whitespace` 这个键，
注释自陈「需要在格式化后跑一遍纯文本 pass（本批未做）」，全仓没有任何执行体。

另外两件同批修的：

- **24 条「同上 / 理由过短」的 `[-]` 就地展开**（折叠与签名族为主：`JavaCodeFoldingSettingsBase`、
  `ElementSignatureProvider`、`InjectedCodeFoldingPassFactory` 等）。`[-]` 行不留「同上」，现在门禁会直接判红。
- **跨表一致性**：196 条里只有 **4** 条落在 `codeInsight/daemon` / `codeInsight/folding`（与
  `docs/inventory/daemon_verdict_table.json`、`docs/inventory/verdict-folding.md` 同源）。
  本表选择按行为改判，没有跟着母表留 `[-]`；母表侧的同一缺陷留给各自属主跟进（本批没有改它们的文件）。
  这是本批**唯一一处明知会与另一张表不一致**的地方，写在 §E-7。

## 4. 门禁形状与反向验证记录

`tests/b12-verdict.test.mjs`（9 条，纯 JavaScript，无 TS 语法）：

1. §G 逐条覆盖：`editor.txt` 每个类恰好一行（名字 + 路径双检，不多不漏不重）
2. 四档自洽：逐条统计 == 头部「四档合计 a + b + c + d = N」== 表尾「当前已判 N 行」
3. `[x]`/`[~]` 必须指到磁盘上真实存在的 `src/` 或 `native/` 文件（引用总数下限 400，防空转）
4. 落点文件剥掉注释后仍有真实代码（防「空壳注释文件」当落点）
5. 每条 `[-]` 带具体理由（≥18 字，禁空串，**禁以「同上/同前」开头**）
6. **机械降级守卫**：`[-]` 理由里出现「接口/抽象/契约/值对象/形状/监听器接口」而没有点名 Swing 控件本体
   或具体架构机制（PSI、共享索引、JVM 弱引用取证、ELF/MagicCore、RD 通道、语言侧生成物、NLS 消息目录）⇒ 判红
7. 上游 `/tests/`、`testSources`、`/gen/`、`*Test`/`*Tests`/`*TestCase`/`*Benchmark` ⇒ 必须 `[-]`
8. §C 的「按用户可见度排序的待办前 20 条」每条都要有上游 `路径:行号` + 本仓建议落点；§E 不许空
9. 文档必须写明四档口径、三态口径、「无法核实」的处理、以及「接口按行为判」这条边界

反向验证（表头不写死 2551；副本走 `B12_VERDICT` 环境变量喂进同一份门禁，不动真表）：

| 破坏 | 结果 |
|---|---|
| 基线（真表） | b12 **9/9 绿**、b8 **5/5 绿** |
| 造假引用（`RangeMarker` 的落点改成 `src/notThere12345.ts`） | 红 2 条，首条即「指到磁盘上真实存在的文件」 |
| 删一行（删掉 `FoldingGroup`） | 红 4 条，首条即「§G 逐条覆盖」 |
| 四档不自洽（`SweepProcessor` 悄悄改 `[ ]`，头部不动） | 红 2 条，首条即「四档自洽 == 头部和数 == 表尾 N 行」 |
| 形状降级回归（`FoldingGroup` 改回 `[-]` 且理由只写「接口与值对象形状」） | 红 4 条，含「机械降级守卫」 |
| 「同上」回归（`ModificationTree` 的理由换成「同上」） | 红 2 条，首条即「每条 `[-]` 带具体理由」 |

破坏副本用完即撤（写在 `%TEMP%`，未进仓库）。

## 5. §C 按用户可见度排序的待办前 20 条（上游依据 + 本仓建议落点）

这张表原本就在判决表 §C-优 里，本批逐条把上游行号与本仓落点又核了一遍形状（路径存在性由门禁核，行号未逐条重读）。

| # | 待办 | 上游依据（相对路径:行号） | 本仓建议落点 | 本批核实到的现状 |
|---:|---|---|---|---|
| 1 | 保存时去行尾空白 | `platform/platform-impl/src/com/intellij/openapi/editor/impl/TrailingSpacesStripper.java:46,52,61`；`platform/core-api/src/com/intellij/openapi/editor/SmartStripTrailingSpacesFilter.java:21,23`；`StripTrailingSpacesFilterFactory.java:12` | `src/editorFileOps.ts` 保存链路 + `src/editorConfig.ts` 已解析的键 | **确认没做**：`src/editorConfig.ts:334` 只解析键，全仓无执行体（`grep stripTrailing` = 0） |
| 2 | 实时模板纯文本宏（cap/camel/snake/date/clipboard） | `platform/lang-impl/src/com/intellij/codeInsight/template/macro/CapitalizeMacro.java:18,24` 等同目录 | `src/templates.ts` 的变量求值处（现在只认字面量默认值） | 确认没做：`CapitalizeMacro`/`decapitalize` 全仓 0 命中 |
| 3 | 排序行 / 去重行 / 反串行 / 复制行 | `platform/platform-impl/src/com/intellij/openapi/editor/actions/SortLinesAction.java:9,13`；`UniqueLinesAction.java:9,13`；`ReverseLinesAction.java:7,11`；`DuplicateLinesAction.java:17,24,43` | `src/editorCommands.ts` 命令单表 + `src/menus/editMenu.ts` + `src/keymapBindings.ts` | 确认没做：四个名字全仓 0 命中 |
| 4 | 配色方案设置页（Editor ▸ Color Scheme） | `platform/platform-impl/src/com/intellij/application/options/colors/ColorAndFontOptions.java:113,122,152`（整文件 1952 行）；`platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsManager.java:13,32,40` | 新组件页 + `src/settingsTreeMeta.ts` 新节点，着色数据从 `src/editorSemanticColors.ts` 升级成可编辑方案 | 确认没做：`colorScheme`/`ColorScheme` 在 `src`/`native` 0 命中 |
| 5 | Emmet 缩写展开与预览 | `xml/emmet/src/com/intellij/codeInsight/template/emmet/XmlEmmetParser.java:44,207,213`；`EmmetPreviewTypedHandler.java:22,28` | 新 `src/emmet*.ts` + `src/components/CodeEditor.vue` 接线 | 确认没做：全仓 `emmet` 0 命中（该族 59 类同判 `[ ]`） |
| 6 | 多光标补齐：按行加光标 / 上下克隆 / 一次选中全部出现 | `.../actions/AddCaretPerSelectedLineAction.java:17,24`；`CloneCaretAbove.java:8`；`platform/lang-impl/src/com/intellij/openapi/editor/actions/SelectAllOccurrencesAction.java:25,32,40` | `src/editorCommands.ts`（已有 selectNextOccurrence / unselectPreviousOccurrence 同一条路） | 确认没做：`cloneCaret`/`addCaretPerSelectedLine` 0 命中 |
| 7 | 参数信息里的重载切换与当前实参高亮 | `platform/lang-impl/src/com/intellij/codeInsight/hint/actions/NextParameterAction.java:11`；`hint/ParameterInfoComponent.java:91,136,144`（整文件 920 行） | `src/semanticActions.ts` 的 signaturePopup 状态 + `src/lspFeatureMatrix.ts` | LSP 数据里本来就有 `activeSignature`/`activeParameter`，只是没做切换与高亮 |
| 8 | 驼峰分段的词导航与删除 | `.../actions/NextPrevWordHandler.java:12,24`；`DeleteToWordEndInDifferentHumpsModeAction.java:6` | `src/keymapBindings.ts` 加 Ctrl+Shift+←/→ + 纯函数停点表（现成规则在 `src/completionSort.ts`） | 补全侧已实现驼峰匹配，编辑区没有同一套词的停点 ⇒ 行为不一致 |
| 9 | 手工换行标记（Ctrl+Shift+Enter） | `platform/editor-ui-api/src/com/intellij/openapi/editor/CustomWrap.kt:14`；`.../impl/customwrap/CustomWrapImpl.kt` | 新模块 + `src/gutterMenu.ts` 的删除档 | 需要自建视觉行映射；换行开关本身在 `src/editorTheme.ts` |
| 10 | 编辑器浮动工具条（选区上方） | `platform/platform-impl/src/com/intellij/openapi/editor/toolbar/floating/EditorFloatingToolbar.kt:38,64`；`FloatingToolbarProvider.kt:16` | 新组件 + `src/components/CodeEditor.vue` 选区监听（定位复用 `src/popupPosition.ts`） | 本仓只有右键菜单承接同一批动作 |
| 11 | 带格式复制（HTML 片段进剪贴板） | `platform/lang-impl/src/com/intellij/openapi/editor/richcopy/settings/RichCopySettings.java:16,41,49` | `src/editorClipboard.ts` 加 HTML 通道 + 宿主剪贴板（`src/bridge.ts` 侧） | 已有整篇 Export to HTML 的着色 DOM，只差片段级那一路 |
| 12 | 选中文本另存为实时模板 | `platform/lang-impl/src/com/intellij/codeInsight/template/actions/SaveAsTemplateAction.java:51,124,154` | `src/components/EditorPopupMenu.vue` + `src/templates.ts` 的 CustomTemplate 存储 | 存储与编辑页都在，缺入口那一步 |
| 13 | 后缀模板的编辑页与条件表达式 | `.../postfix/templates/editable/PostfixTemplateEditor.java:17`；`EditablePostfixTemplate.java:42,69,93` | `src/components/TemplateSettingsPage.vue`（postfix 档已渲染）扩条件与动作列 | 后缀触发能用，改条件就撞墙 |
| 14 | 代码风格其余面板（空格/换行/空行/注释） | `platform/lang-impl/src/com/intellij/application/options/codeStyle/WrappingAndBracesPanel.java`；`CodeStyleSpacesPanel.java`；`CodeStyleBlankLinesPanel.java`；`CommenterForm.java` | `src/codeStyleSettings.ts` 扩字段 + `src/components/SettingsDialog.vue` 新段 | **刻意不造控件**：没有格式化引擎消费时画出来是假控件，必须与格式化链路一起做 |
| 15 | import 布局（arrangement）与重排动作 | `.../codeStyle/arrangement/ArrangementSettingsPanel.java:46,115,124`；`arrangement/action/RearrangeCodeAction.java:23,26,38` | 新模块（规则模型 + 设置页）；卡点：重排引擎在语言侧 | 同上，本仓 LSP 不提供这一档 |
| 16 | 配色/代码风格方案的导入导出 | `.../options/colors/ColorSchemeImporter.java:22`；`ColorSchemeExporter.java:12,15` | `src/settingsTransfer.ts` + `native/settings_transfer.cpp` 增按方案粒度条目 | 整体迁移已有，缺方案粒度 |
| 17 | BOM 的两条独立动作 | `.../actions/AddBomAction.java:24,31,46`；`RemoveBomAction.java` | `src/editorFileOps.ts`（已有 bom 位与编码对话框）+ `src/menus/fileMenu.ts` | 行为通道在，只差动作与菜单两行 |
| 18 | 转置 / 交换选区锚点 / 在当前行之前插行 | `.../actions/TransposeAction.kt:13`；`SwapSelectionBoundariesAction.java:18,26`；`StartNewLineBeforeAction.java:17,25` | `src/editorCommands.ts` 命令单表 | 三条纯文本命令，与已落地的合并行/大小写同一形状 |
| 19 | 列表拆行 / 合行意图 | `platform/lang-impl/src/com/intellij/openapi/editor/actions/lists/ListSplitJoinIntentions.kt:19,22` | 新模块 + `src/menus/codeMenu.ts` | 纯文本档可做；Java 元素识别那半仍 `[-]` |
| 20 | 路径宏表（`$PROJECT_DIR$` 一类） | `platform/platform-impl/src/com/intellij/application/options/pathMacros/PathMacroConfigurable.java:15,25,31` | `src/runConfigurations.ts` + `src/projectPath.ts` | 运行配置现在直接写死路径 |

## 6. 编辑器域里最影响「像不像 IDEA」的 5 个缺口（我的判断，非表内原话）

排序按「用户第一天就会撞上」：

1. **保存/格式化收尾的空白纪律（§C-优 1）** —— IDEA 用户改完文件按 Ctrl+S，行尾不留一个空格、
   文件末尾按 `insert_final_newline` 收尾，这是肌肉记忆级的差异。本仓**已经把 `.editorconfig` 的键读进来了**
   （`src/editorConfig.ts:334`，注释自陈未做）却没用它，等于把最便宜的一条 IDEA 感让掉了。
2. **多光标与行操作的四件套（§C-优 3 + 6）** —— Ctrl+D 复制行、按行加光标、上下克隆光标、
   Sort/Unique/Reverse Lines。本仓多光标只有「选中下一个出现处/取消上一个」两条，
   而 IDEA 用户的日常是「一次选中全部出现处然后一起改」，这是编辑器的**人格**差异。
3. **Editor ▸ Color Scheme 这一整页（§C-优 4）** —— 打开 Settings 的第一屏就能看出不是 IDEA。
   它同时卡住另外三族（彩虹括号逐档改色、文件颜色、内联高亮档），是「一处空白造三处不像」。
4. **实时模板宏 + Emmet（§C-优 2 + 5）** —— 打 `sout`/`fori` 能展开是 IDEA 的招牌手感；
   本仓后缀模板只能触发键，宏一律不展开（`src/templates.ts` 只认字面量默认值），HTML 侧 Emmet 全仓 0 命中。
   这两族合计 382 个上游类，是「一表吃一类」的最高杠杆点。
5. **选中文本上方那圈浮动工具条（§C-优 10）** —— IDEA 选中即浮出操作条，本仓只有右键菜单。
   它不改变能力集合，但**改变「这台编辑器在看着我」**的观感，是可见度最高、能力最低的一条。

第 5 条与「参数信息重载切换」（§C-优 7）之间我犹豫过：重载切换更影响写代码的效率，
但只有 LSP 给出多个签名时才看得见；浮动工具条每个选区都看得见。按「像不像」这个尺子选了后者。

## 7. 剩余工作（诚实版）

- **判决覆盖**：0 条未判。
- **判词可信度**：158 条新 `[~]` 的落点是**概念级核实**（该文件确实持有这个概念），不是行为等价证明；
  逐条对照上游 API 面做二次核对是下一批的活，入口就是每行「缺：」那半句。
- **保留 `[-]` 的边界**：1272 条里有 161 条的形状类是按「具体架构机制」保留的（PSI/共享索引/JVM 弱引用取证/
  ELF·MagicCore 第二套文档内核/RD 通道/语言侧生成物与词法器/NLS 消息目录），3 条点名 Swing 控件本体。
  如果有人认为这条线画宽了，正确的反驳形式是改 §G 那一行的档位并给出上游行号，不是恢复「它是接口所以不适用」。
- **跨表**：4 条与 daemon/folding 母表不同档（本批按行为优先），母表侧待各自属主跟进。
- **§0 的机械信号表**：三态计数（真实代码引用 31 / 只在注释里 94 / 从未出现 2426）与本域的若干分布数字
  是**本批改判前的快照**，未重算；判决以 §G 与头部和数为准，这一点已在 §E-10 声明。
- **门禁**：`tests/b8-verdict.test.mjs` 与 `tests/b12-verdict.test.mjs` 现在覆盖同一张表，
  前者钉数字（已同步到 34 + 1035 + 210 + 1272），后者动态核数；两把都在，改判时必须同时动。
