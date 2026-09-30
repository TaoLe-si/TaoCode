# B4 判决：`codeInsight/folding` = 69 类（platform 53 + java/xml 16）

判定依据：机械枚举（源码树里路径含 `/com/intellij/codeInsight/folding/` 的非测试类 —— 清单落在
`docs/inventory/folding.txt`，69 行）+ 逐类读上游源码 + 本仓折叠功能的真实落点核对
（`src/components/CodeEditor.vue` 的折叠 StateField、`src/editorCommands.ts`、`src/menus/editMenu.ts`、
`src/menus/editorPopupMenu.ts`）+ `$default.xml` 的键位表 + 随 IDE 发货的中文包。

> 本域按**模块**分两半：`platform/`（53 类，可移植的部分）与 `java/`+`xml/`（16 类，语言侧 builder 与
> 它们专属的设置/工具）。后一半在本仓没有宿主（本仓的折叠区间来自 **LSP**，没有 PSI），逐条记 `[-]`。
> §G 是逐条总表（69 行，机检对齐），四档计数写在表尾。

## A. 本地折叠的地基（读判决前先看这一节）

本仓的折叠不是按上游的类搬的，而是**一条真实链路**：

| 本地落点 | 干什么 | 上游对应 |
|---|---|---|
| `src/editorFolding.ts`（`foldingRanges` StateField + fold service + 区域层 + 动作族） | 折叠区间从语言服务来（`kind` 里带 `comment`/`imports`/`region`），逐个动作在"S 服务端区间 ∪ CodeMirror 语法树候选 ∪ 手工区间"上挑目标 | `FoldingBuilder` + `FoldingUpdate`/`CodeFoldingPass`（区间）+ `FoldingUtil`/`BaseFoldingHandler`/`*RegionAction` 那一族（动作） |
| `src/editorCommands.ts`（`fold`/`unfold`/`foldAll`/`unfoldAll` + 区域/递归/到级别/选区/块/切换/文档注释，一张表给键位与菜单共用） | 折叠族的**全部** 15 条命令（`fold`/`unfold` 指向 `src/editorFolding.ts` 里照 `CollapseRegionAction`/`ExpandRegionAction` 实现的挑法，不是 CodeMirror 自带的 `foldCode`/`unfoldCode`） | `BaseFoldingHandler` + `*RegionAction` 那一族，逐条对应见下面键位表 |
| `src/editorFoldingSettings.ts` + `src/components/CodeFoldingSettingsPage.vue`（设置页「编辑器 › 折叠」） | 「默认折叠」那两条开关（Import 默认开、自定义折叠区域默认关）：值进 `EditorSettings`（原生 `editor.xml` 那一段），打开文件时按 `kind` 预折叠，设置一改就重算 | `CodeFoldingConfigurable.kt:26-27`（页面）+ `BaseCodeFoldingOptionsProvider.kt:17-21`（五条复选框）+ `LspFoldingBuilder.kt:41-46`（LSP 路径只映射 imports / region） |
| `src/menus/codeMenu.ts`（`code.folding` 子菜单，13 条一行不差） | Code 菜单里的「折叠」子菜单 = 上游 `FoldingGroup` 的原样顺序与文案（展开/递归展开/全部展开 ‖ 收起/递归收起/全部收起 ‖ 展开到级别(_E) 1-5 ‖ 全部展开到级别(_L) 1-5 ‖ 展开/收起文档注释 ‖ 切换折叠 ‖ 折叠选区/移除区域 ‖ 折叠代码块） | `FoldingGroup`（`platform/platform-impl/resources/idea/LangActions.xml:270-303`），文案逐条取 `ActionsBundle.properties:623-654` |
| `src/menus/editorPopupMenu.ts`（弹层 `FoldingGroup`，标题「折叠」） | 编辑器右键里的折叠子菜单（成员与 Code 菜单同源，13 条） | `FoldingGroup`（`LangActions.xml:270-303`）—— 这一条与 Code 菜单是**同一段**菜单模型，改一处两处都变 |

**键位表（逐条核过 `$default.xml`；本仓已全接）**：

| 上游动作 | 文案（中文包） | `$default.xml` 键位 | 本仓 |
|---|---|---|---|
| `ExpandRegion` | 展开 | `control ADD` / `control EQUALS` | ✅ `unfold`（`Ctrl+=`；挑法照 `ExpandRegionAction.java:43-55`：先看起始行，否则**最外层**折着的那条） |
| `ExpandRegionRecursively` | 递归展开 | `control alt ADD` / `control alt EQUALS` | ✅ `unfold.recursively`（`Ctrl+Alt+=`；照 `BaseFoldingHandler.getFoldRegionsForCaret:61-86`） |
| `ExpandAllRegions` | 全部展开(_E) | `control shift ADD` / `control shift EQUALS` | ✅ `unfoldAll`（`Ctrl+Shift+=`，浏览器报 `+`，走 Shift 回退匹配） |
| `CollapseRegion` | 收起(_C) | `control SUBTRACT` / `control MINUS` | ✅ `fold`（`Ctrl+-`；挑法照 `CollapseRegionAction.java:26-38`。数字键盘减号与主键区减号在浏览器里同名，这一条就覆盖了） |
| `CollapseRegionRecursively` | 递归收起(_A) | `control alt SUBTRACT` / `control alt MINUS` | ✅ `fold.recursively`（`Ctrl+Alt+-`） |
| `CollapseAllRegions` | 全部收起(_A) | `control shift SUBTRACT` / `control shift MINUS` | ✅ `foldAll`（`Ctrl+Shift+-`，浏览器报 `_`，走 Shift 回退匹配；文案已改回「全部收起」） |
| `ExpandToLevel1..5` | _1.._5 | `control MULTIPLY` | ⚠️ 只绑到级别 1（`Ctrl+*` = `unfold.level1`；`$default.xml` 那一条 `control MULTIPLY` 1–5 都吃它，CodeMirror 一条键对一个命令）；2–5 只在菜单里 |
| `ExpandAllToLevel1..5` | _1.._5 | `control shift MULTIPLY` | ⚠️ **没绑键位**，只在菜单里：浏览器把数字键盘乘号一律报成 `*`（Shift 不改名），`Ctrl+Shift+数字键盘*` 会先命中 `Ctrl+*` 那条 ⇒ 分不开，不编死键位（判据里钉着这条） |
| `ExpandDocComments` / `CollapseDocComments` | 展开文档注释 / 收起文档注释(_O) | 无 | ✅ `unfold.docs` / `fold.docs`（锚是 LSP 的 `kind: comment`，无键位——上游也没有） |
| `ExpandCollapseToggleAction` | 切换折叠 | 无 | ✅ `fold.toggle`（无键位，上游也没有） |
| `CollapseSelection` | 折叠选区/移除区域(_S) | `control PERIOD` | ✅ `fold.selection`（`Ctrl+.`，常驻 keymap 里那一条）；**缺**「不能移除自动生成的区域」提示与重叠确认框，见 §C |
| `CollapseBlock` | 折叠代码块(_B) | `control shift PERIOD` | ✅ `fold.block`（`Ctrl+Shift+.`，浏览器报 `>`，CodeMirror 的 Shift 回退匹配认；常驻 keymap 里那一条） |

## C. 下一批该做的条目（按用户可见度）

① **动作族** —— ✅ **已做**（第六十批）：15 条命令全在 `src/editorCommands.ts`，实现在 `src/editorFolding.ts`，
    挑目标的规则逐条照上游（`CollapseRegionAction` / `ExpandRegionAction` / `BaseFoldingHandler` /
    `BaseExpandToLevelAction` / `ExpandCollapseToggleAction` / `CollapseSelectionHandler`），
    键位与 Code 菜单落点见 §A；真机取证（`TAOCODE_DEBUG_PORT` + CDP）覆盖：收起/展开/递归/全部/选区/块。
    剩下的两处**没有宿主**：`CollapseSelectionHandler:44`（"不能移除自动生成的折叠区域"提示）要编辑器内的
    hint 通道、`:49-58`（重叠确认框）要模态框 —— 都按上游的**默认结果**处理（不动 / 视为「取消」），
    登记在 §G 的 `CollapseSelectionHandler` 行；
② **`CodeFoldingSettings` 的五个开关** —— ✅ **已做（第六十一批）**，按 LSP 路径的口径：
    `LspFoldingBuilder.kt:41-46` 只把 `Imports → COLLAPSE_IMPORTS`、`Region → COLLAPSE_CUSTOM_FOLDING_REGIONS`
    接进 `collapsedByDefault`（`Comment` 那一条上游自己写了 null：LSP 与 IDEA 语义对不上），
    另外三个（文件头 / 方法体 / 文档注释）只有**语言侧 builder** 读（`JavaCodeFoldingSettingsBase.java:67/106/116`、
    `KotlinFoldingBuilder.kt:220`、`PythonFoldingBuilder.kt:67`）—— 本仓没有语言侧 builder，
    所以设置页只渲染前两条（不渲染空壳），那三个在 §G 的 `CodeFoldingSettings` 行里写明。
    落地：`src/editorFoldingSettings.ts`（默认值/映射/文案）+ `src/components/CodeFoldingSettingsPage.vue`
    （页 = 「代码折叠」，「默认折叠:」分组，文案取本机 IDEA 2026.2 中文包）+ 原生键表与默认值
    （`native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS`、`settings_schema.cpp` 的 `editor_defaults_impl()`）；
    打开文件时预折叠、设置一改立刻重算（上游 `CodeFoldingConfigurable.Util.applyCodeFoldingSettingsChanges`）；
    真机取证：Java 文件（jdtls 给 `kind: imports` / `region`）——默认 imports 折、关掉 Import 立刻展开、
    勾上自定义折叠区域后 region 折起；
③ **折叠状态的持久化**（`EditorFoldingInfo` + necromancy：重开文件后把上次折叠的区间放回去）；
④ **「全部收起」的文案** —— ✅ **已做**（第六十批）：Code 菜单与弹层两处都是「全部收起」，
    13 条成员照 `FoldingGroup` 排（`src/menus/codeMenu.ts`，机检 `tests/editor-folding.test.mjs` 盯着顺序与文案）；
    早先挂在编辑菜单里的四条已删（上游在 Code 菜单）；
⑤ 新记的两条（本批发现，不装作有）：**文档变动后旧区间作废**（`foldingRanges` field 在 `tr.docChanged` 时清空，
    要等下一次 `foldingRange` 回来）与**折过的区间在编辑后可能对不上新算的边界**（`unfoldEffect` 只认精确边界，
    `src/editorFolding.ts` 的区域层因此按起始行去重、只留一种边界）—— 上游靠 PSI 元素身份把折叠状态挂回去
    （§D.2 的签名族），本仓没有元素身份可依，重算与恢复都只能按偏移。

## D. 不适用（`[-]`，26 类）

四类理由：

1. **语言侧 builder 与它们的专属件**（`java/` 11 + `xml/` 1）：本仓的折叠区间来自 **LSP** 的
   `textDocument/foldingRange`，没有 PSI，也没有 Java/XML 语言插件的那套 `FoldingBuilder`；
2. **语义签名族**（`ElementSignatureProvider` / `AbstractElementSignatureProvider` / `GenericElementSignatureProvider` /
   `OffsetsElementSignatureProvider` / `PsiNamesElementSignatureProvider` / `JavaElementSignatureProvider` /
   `XmlElementSignatureProvider`）：它们存的是"PSI 元素 ↔ 签名"的映射，靠元素身份把折叠状态放回去 ——
   本仓的 LSP 只给**区间**（行列范围），没有元素身份可依；
3. **注入片段**（`InjectedCodeFoldingPass` / `InjectedCodeFoldingPassFactory`）：本仓的编辑器不承载注入片段
   （模板语言里嵌另一种语言那种）；
4. **Swing/打开期提示的宿主**：`FoldingHintPostStartupActivity`（启动时给编辑器装鼠标监听的那个 `ProjectActivity`）、
   `EditorFoldingInfoWindow`（依附 `EditorWindow` 的那一半 —— 本仓每个标签一个编辑器，没有"同一文档开在多个编辑器
   窗口"的形态）、`FoldLimb`（通用复活机制的构件，本仓没有那套框架）。

## E. 未移植（`[ ]`，33 类）

可移植、本仓**确实还没有**的（都在 §G 里逐条标了落点或"还没有"）：

- **设置**：`CodeFoldingSettings` / `CodeFoldingSettingsImpl`（五个开关与持久化）；
- **状态与持久化**：`DocumentFoldingInfo` / `EditorFoldingInfo` / `CodeFoldingNecromancy` /
  `CodeFoldingNecromancer` / `CodeFoldingZombie`（重开文件恢复折叠）；
- **区间更新**：`UpdateFoldRegionsOperation`（把新算的区间应用到文档：合并/移除旧区间）；
- **工具**：`FoldingUtil`（按偏移/行找折叠区间、折叠树迭代器）、`FoldingPolicy`（默认折叠/首次全部折叠时的例外）；
- **handler**：`CollapseBlockHandler`（接口）/ `CollapseBlockHandlerImpl` / `CollapseExpandDocCommentsHandler` /
  `CollapseSelectionHandler`；
- **提示**：`FoldingHintMouseMotionListener`（鼠标悬停在折叠处按住修饰键看内容）；
- **动作**：`BaseExpandToLevelAction` 与到级别那 10 个、`CollapseBlockAction` / `CollapseDocCommentsAction` /
  `CollapseRegionRecursivelyAction` / `CollapseSelectionAction` / `ExpandCollapseToggleAction` /
  `ExpandDocCommentsAction` / `ExpandRegionRecursivelyAction`。

## F. 判据（本判决文件自身的门控）

`tests/b4-verdict.test.mjs`：

1. **覆盖 69 类，不多不少**：从 `docs/inventory/editor_scan.md` 里按 `/codeInsight/folding/` 重新推导，
   与 `docs/inventory/folding.txt`（69 行）逐条对齐，且每个类名在 §G 表里恰有一行。
2. **`[x]`/`[~]` 行的依据必须指到真实文件**：§G 里所有 `[x]`/`[~]` 行反引号里的每个 `src/`/`native/` 路径都要在磁盘上存在。
3. **§C 的四条理由必须真的在文件里**（语言侧 builder / 语义签名 / 注入片段 / Swing 与打开期提示的宿主）。
4. **四档计数自洽**：§G 四档行数等于 69，且与表尾写的一致。

## G. 逐条总表（69 类，与 `docs/inventory/folding.txt` 一一对齐）

| 类 | 源码 | 判决 | 依据（有实现点的指到真实 `src/` 文件） |
|---|---|---|---|
| `IdeJavaFoldingBuilderBase` | `java/java-frontback-impl/src/com/intellij/codeInsight/folding/impl/IdeJavaFoldingBuilderBase.kt` | `[-]` | Java 语言侧 builder（§D.1）：本仓的折叠来自 LSP |
| `JavaBackendFoldings` | `java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/JavaBackendFoldings.java` | `[-]` | 同上（Java 的折叠区间从 PSI 算） |
| `JavaCodeFoldingRemoteSettingProvider` | `java/java-frontback-impl/src/com/intellij/codeInsight/folding/impl/JavaCodeFoldingRemoteSettingProvider.kt` | `[-]` | Java 折叠设置的前后端分离同步，本仓没有这条链路 |
| `JavaCodeFoldingSettings` | `java/java-psi-api/src/com/intellij/codeInsight/folding/JavaCodeFoldingSettings.java` | `[-]` | Java 专属折叠设置（一行方法/闭包/注释…），本仓无 Java 语言折叠 |
| `JavaCodeFoldingSettingsBase` | `java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/JavaCodeFoldingSettingsBase.java` | `[-]` | 同上 |
| `JavaCodeFoldingSettingsImpl` | `java/java-frontback-impl/src/com/intellij/codeInsight/folding/impl/JavaCodeFoldingSettingsImpl.java` | `[-]` | 同上 |
| `JavaCollapseBlockHandler` | `java/java-impl/src/com/intellij/codeInsight/folding/impl/JavaCollapseBlockHandler.java` | `[-]` | Java 的「折叠代码块」边界判定，靠 PSI |
| `JavaElementSignatureProvider` | `java/java-impl/src/com/intellij/codeInsight/folding/impl/JavaElementSignatureProvider.java` | `[-]` | 语义签名族（§D.2）：Java 元素签名 |
| `JavaFoldingBuilder` | `java/java-impl/src/com/intellij/codeInsight/folding/impl/JavaFoldingBuilder.java` | `[-]` | Java 语言侧 builder（§D.1） |
| `JavaFoldingBuilderBase` | `java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/JavaFoldingBuilderBase.java` | `[-]` | 同上 |
| `JavaFoldingUtil` | `java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/JavaFoldingUtil.java` | `[-]` | Java 语言侧的工具（PSI 节点边界） |
| `JavaFrontendFoldingBuilder` | `java/java-frontback-impl/src/com/intellij/codeInsight/folding/impl/JavaFrontendFoldingBuilder.java` | `[-]` | Java 前端侧 builder（§D.1） |
| `JavaFrontendFoldings` | `java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/JavaFrontendFoldings.java` | `[-]` | 同上 |
| `BackendClosureFolding` | `java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/BackendClosureFolding.java` | `[-]` | Java 闭包折叠的区间计算（PSI） |
| `CommentFoldingUtil` | `java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/CommentFoldingUtil.java` | `[-]` | Java 注释折叠的判定（PSI 注释节点） |
| `XmlElementSignatureProvider` | `xml/impl/src/com/intellij/codeInsight/folding/impl/XmlElementSignatureProvider.java` | `[-]` | 语义签名族（§D.2）：XML 元素签名 |
| `CodeFoldingSettings` | `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java` | `[~]` | 本仓按 LSP 路径实现：`COLLAPSE_IMPORTS` 默认 true、`COLLAPSE_CUSTOM_FOLDING_REGIONS` 默认 false 两条（`src/editorFoldingSettings.ts` + 设置页 `src/components/CodeFoldingSettingsPage.vue`，预折叠在 `src/editorFolding.ts` 的 `foldKinds`）；**缺** `COLLAPSE_METHODS` / `COLLAPSE_FILE_HEADER` / `COLLAPSE_DOC_COMMENTS` —— 这三个在上游由语言侧 builder 消费（`JavaCodeFoldingSettingsBase.java:67/106/116`），上游自己的 LSP 路径对它们也传 null（`LspFoldingBuilder.kt:41-46`），本仓没有语言侧 builder ⇒ 设置页不渲染这三行 |
| `CodeFoldingSettingsImpl` | `platform/editor-ui-ex/src/com/intellij/codeInsight/folding/CodeFoldingSettingsImpl.java` | `[~]` | 落盘那一段：上游 `@State(name = "CodeFoldingSettings", storages = @Storage("editor.xml"))`（`:11`），本仓两个键进编辑器设置那一段（`native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS` + `settings_schema.cpp` 的 `editor_defaults_impl()`，`src/settingsModel.ts` 的 `EditorSettings`）；**缺**另外三个键（同上） |
| `CodeFoldingManager` | `platform/foldings/src/com/intellij/codeInsight/folding/CodeFoldingManager.java` | `[~]` | 折叠的查询/变更面：本仓落在 `src/components/CodeEditor.vue` 的折叠 StateField 与 `src/editorCommands.ts` 的命令表；**缺**按偏移查询折叠区间这类公开面 |
| `CodeFoldingManagerImpl` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingManagerImpl.java` | `[~]` | 同上（本仓没有这个对象，行为分散在 `src/components/CodeEditor.vue` 与 `src/editorCommands.ts`） |
| `CodeFoldingPass` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingPass.java` | `[~]` | 重建折叠区间的 pass：本仓在打开/更新文档时用 LSP `foldingRange` 建区间（`src/components/CodeEditor.vue`）；**缺**文档变更后的重算 |
| `CodeFoldingPassFactory` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingPassFactory.java` | `[~]` | 按语言给 pass 的工厂：本仓等价的是编辑器装配时装折叠扩展（`src/components/CodeEditor.vue`） |
| `CodeFoldingNecromancer` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingNecromancer.kt` | `[ ]` | 重开文件后异步恢复折叠状态（§C③） |
| `CodeFoldingNecromancy` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingNecromancy.kt` | `[ ]` | 同上（复活机制的编排） |
| `CodeFoldingZombie` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingZombie.kt` | `[ ]` | 被复活的折叠状态载荷（§C③） |
| `FoldLimb` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldLimb.kt` | `[-]` | 通用复活机制的构件（§D.4）：本仓没有那套框架 |
| `CollapseBlockHandlerImpl` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseBlockHandlerImpl.java` | `[~]` | `fold.block` = `src/editorFolding.ts` 的 `foldBlockAtCaret`（`blockAt` 跳过 `kind` 为 comment/imports/region 的区间，取光标处最内层；没有服务端区间时用 `syntaxArea` 的语法树候选顶上）；**缺**上游按语言注册的 `CollapseBlockHandler` EP（`CollapseBlockAction.java:29-46`） |
| `CollapseExpandDocCommentsHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseExpandDocCommentsHandler.java` | `[~]` | `fold.docs`/`unfold.docs` = `src/editorFolding.ts` 的 `foldDocComments`/`unfoldDocComments`（`commentRanges` 取 `kind === 'comment'` 的区间）；**缺** PSI 侧"文档注释"与普通注释的区分（上游 `CollapseExpandDocCommentsHandler` 只认 doc comment） |
| `CollapseSelectionHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseSelectionHandler.java` | `[~]` | `fold.selection` = `src/editorFolding.ts` 的 `toggleFoldSelection`，照 `CollapseSelectionHandler.java:24-87`：有选区时精确匹配就移除（手工区间）、搭界就按上游默认「取消」不动、否则折起选区那几行；无选区时切换光标处最内层区域；**缺** `:44` 的提示与 `:49-58` 的模态确认框（本仓没有编辑器内 hint / 模态框宿主） |
| `DocumentFoldingInfo` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/DocumentFoldingInfo.java` | `[ ]` | 每个文档的折叠状态记录（§C③） |
| `EditorFoldingInfo` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/EditorFoldingInfo.java` | `[ ]` | 折叠状态 ↔ 元素映射与存盘/恢复（§C③） |
| `EditorFoldingInfoWindow` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/EditorFoldingInfoWindow.java` | `[-]` | 依附 `EditorWindow` 的那一半（§D.4）：本仓没有"同一文档开在多个编辑器窗口"的形态 |
| `ElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/ElementSignatureProvider.java` | `[-]` | 语义签名族（§D.2） |
| `AbstractElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/AbstractElementSignatureProvider.java` | `[-]` | 同上 |
| `GenericElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/GenericElementSignatureProvider.java` | `[-]` | 同上（通用签名） |
| `OffsetsElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/OffsetsElementSignatureProvider.java` | `[-]` | 同上（按偏移的签名） |
| `PsiNamesElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/PsiNamesElementSignatureProvider.java` | `[-]` | 同上（按 PSI 名字的签名） |
| `FoldingHintMouseMotionListener` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingHintMouseMotionListener.java` | `[ ]` | 悬停在折叠处按住修饰键看被折叠的内容（§C①） |
| `FoldingHintPostStartupActivity` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingHintPostStartupActivity.kt` | `[-]` | 打开期提示的宿主（§D.4） |
| `FoldingPolicy` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingPolicy.java` | `[ ]` | 默认折叠与"首次全部收起时的例外"（`:25-35`） |
| `FoldingUpdate` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingUpdate.java` | `[~]` | 按语言重算折叠区间：本仓在打开文档时请求 LSP `foldingRange`（`src/components/CodeEditor.vue`）；**缺**编辑后重算 |
| `InjectedCodeFoldingPass` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/InjectedCodeFoldingPass.java` | `[-]` | 注入片段的折叠（§D.3） |
| `InjectedCodeFoldingPassFactory` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/InjectedCodeFoldingPassFactory.java` | `[-]` | 同上 |
| `UpdateFoldRegionsOperation` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/UpdateFoldRegionsOperation.java` | `[ ]` | 把新算的区间应用到文档（合并/移除旧区间）（§C③） |
| `CollapseBlockHandler` | `platform/lang-api/src/com/intellij/codeInsight/folding/CollapseBlockHandler.java` | `[ ]` | 「折叠代码块」的 handler 接口（§C①） |
| `FoldingUtil` | `platform/platform-impl/src/com/intellij/codeInsight/folding/impl/FoldingUtil.java` | `[ ]` | 折叠区间工具：按偏移/行找区间、折叠树迭代器、`isTextRangeFolded`（§C①） |
| `BaseExpandToLevelAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseExpandToLevelAction.java` | `[~]` | `src/editorFolding.ts` 的 `levelPlan`，照 `BaseExpandToLevelAction.java:43-70` 的相对层级：比第 N 层浅的展开、正好第 N 层的**折起**、更深的原样不动；`expandCaretToLevel`/`expandAllToLevel` 分别对应 `expandAll=false/true`（根 = `rootAtLine`） |
| `BaseFoldingHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseFoldingHandler.java` | `[~]` | handler 基类：本仓的等价物是 `src/editorCommands.ts` 的命令表 + `src/editorFolding.ts` 的区域层，`getFoldRegionsForCaret`（递归那两条的根挑法）照 `:61-86` 实现了；**缺** `getFoldRegionsForSelection`（带选区时"全部收起/展开只作用于选区内的区间"——本仓的 `foldAll`/`unfoldAll` 是整篇） |
| `CollapseAllRegionsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseAllRegionsAction.java` | `[~]` | `src/editorCommands.ts` 的 `foldAll`（`Ctrl+Shift+-`/`Ctrl+Shift+NumPad-`），Code 菜单文案「全部收起」；**缺** `twoStepFoldToggling`（`ExpandAllRegionsAction.java:39-70` 的两段式：先折"该折的"，若没折成再折全部）与 `keepExpandedOnFirstCollapseAll`（`FoldingPolicy`，见那一行） |
| `CollapseBlockAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseBlockAction.java` | `[~]` | `fold.block`，命令表与键位见 §A；实现见 `src/editorFolding.ts` |
| `CollapseDocCommentsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseDocCommentsAction.java` | `[~]` | `fold.docs`，Code 菜单 `code.folding` 里那一条（`src/menus/codeMenu.ts`）；实现见 `src/editorFolding.ts` |
| `CollapseRegionAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseRegionAction.java` | `[~]` | `fold` = `src/editorFolding.ts` 的 `foldAtCaret`，照 `CollapseRegionAction.java:26-38` 挑目标：先看"起始行落在光标行"的区域，否则光标处最内层**未折叠**的那条；键位 `Ctrl+-`/`Ctrl+NumPad-`，菜单在 Code 菜单（`src/menus/codeMenu.ts`）；**缺** 上游按 PSI 判"是否可折叠"的那层 |
| `CollapseRegionRecursivelyAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseRegionRecursivelyAction.java` | `[~]` | `fold.recursively` = `src/editorFolding.ts` 的 `foldRecursively`（`recursiveScope`，照 `BaseFoldingHandler.java:61-86`：根 + 套在里面的全部） |
| `CollapseSelectionAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseSelectionAction.java` | `[~]` | `fold.selection`，键位 `Ctrl+.`（`$default.xml:1036-1038`），实现在 `src/editorFolding.ts`；宿主侧的限制记在 `CollapseSelectionHandler` 行 |
| `ExpandAllRegionsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllRegionsAction.java` | `[~]` | `src/editorCommands.ts` 的 `unfoldAll`（`Ctrl+Shift+=`/`Ctrl+Shift+NumPad+`，Code 菜单「全部展开」）——键位与文案与上游一致；**缺**同上那条两段式与"只作用于选区"（`getFoldRegionsForSelection`） |
| `ExpandAllToLevel1Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel1Action.java` | `[~]` | `unfold.all.level1` = `src/editorFolding.ts` 的 `expandAllToLevel(1)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「全部展开到级别 1」） |
| `ExpandAllToLevel2Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel2Action.java` | `[~]` | `unfold.all.level2` = `src/editorFolding.ts` 的 `expandAllToLevel(2)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「全部展开到级别 2」） |
| `ExpandAllToLevel3Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel3Action.java` | `[~]` | `unfold.all.level3` = `src/editorFolding.ts` 的 `expandAllToLevel(3)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「全部展开到级别 3」） |
| `ExpandAllToLevel4Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel4Action.java` | `[~]` | `unfold.all.level4` = `src/editorFolding.ts` 的 `expandAllToLevel(4)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「全部展开到级别 4」） |
| `ExpandAllToLevel5Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel5Action.java` | `[~]` | `unfold.all.level5` = `src/editorFolding.ts` 的 `expandAllToLevel(5)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「全部展开到级别 5」） |
| `ExpandCollapseToggleAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandCollapseToggleAction.kt` | `[~]` | `fold.toggle` = `src/editorFolding.ts` 的 `toggleFoldAtCaret`（`toggleTarget`，照 `ExpandCollapseToggleAction.kt:17-25`：起始行那条优先，否则光标处最内层），Code 菜单里那一条 |
| `ExpandDocCommentsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandDocCommentsAction.java` | `[~]` | `unfold.docs`，Code 菜单 `code.folding` 里那一条；实现见 `src/editorFolding.ts` |
| `ExpandRegionAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandRegionAction.java` | `[~]` | `unfold` = `src/editorFolding.ts` 的 `unfoldAtCaret`，照 `ExpandRegionAction.java:43-55`：先看起始行那条（折着才算），否则光标处**最外层**折着的那条；键位 `Ctrl+=`/`Ctrl+NumPad+`，菜单在 Code 菜单；**缺** 上游按 PSI 判折叠态的那层 |
| `ExpandRegionRecursivelyAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandRegionRecursivelyAction.java` | `[~]` | `unfold.recursively` = `src/editorFolding.ts` 的 `unfoldRecursively` |
| `ExpandToLevel1Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel1Action.java` | `[~]` | `unfold.level1` = `src/editorFolding.ts` 的 `expandCaretToLevel(1)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「展开到级别 1」） |
| `ExpandToLevel2Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel2Action.java` | `[~]` | `unfold.level2` = `src/editorFolding.ts` 的 `expandCaretToLevel(2)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「展开到级别 2」） |
| `ExpandToLevel3Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel3Action.java` | `[~]` | `unfold.level3` = `src/editorFolding.ts` 的 `expandCaretToLevel(3)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「展开到级别 3」） |
| `ExpandToLevel4Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel4Action.java` | `[~]` | `unfold.level4` = `src/editorFolding.ts` 的 `expandCaretToLevel(4)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「展开到级别 4」） |
| `ExpandToLevel5Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel5Action.java` | `[~]` | `unfold.level5` = `src/editorFolding.ts` 的 `expandCaretToLevel(5)`（`levelPlan` 照 `BaseExpandToLevelAction.java:43-70`）（「展开到级别 5」） |

**四档合计**：`[x]` 0 + `[~]` 33 + `[ ]` 10 + `[-]` 26 = 69。（2026-09-30 第六十批：折叠动作族落地，21 行由 `[ ]` 进 `[~]`；第六十一批：`CodeFoldingSettings`/`Impl` 两行进 `[~]`。）
