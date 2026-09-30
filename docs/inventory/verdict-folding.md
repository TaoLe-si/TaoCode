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
| `src/components/CodeEditor.vue`（`foldingRanges` StateField + fold service，`lsp.request` 的 `foldingRange`） | 折叠区间从语言服务来（`kind` 里带 `comment`/`imports`/`region`） | `FoldingBuilder`（语言侧算区间）+ `FoldingUpdate`/`CodeFoldingPass`（把它装进编辑器） |
| `src/editorCommands.ts`（`fold`/`unfold`/`foldAll`/`unfoldAll` = CodeMirror 命令，一张表给键位与菜单共用） | 折叠/展开；**没有**区域/递归/到级别/选区/块/切换那几档 | `BaseFoldingHandler` + `*RegionAction` 那一族 |
| `src/menus/editMenu.ts:103-104`（`foldAll` = 全部折叠，`Ctrl Shift NumPad_Subtract`；`unfoldAll` = 全部展开，`Ctrl Shift NumPad_Add`） | 「全部」两条 | `CollapseAllRegions` / `ExpandAllRegions`（键位与上游一致；**文案**上游是「全部**收起**」`ActionsBundle:237-238`） |
| `src/menus/editorPopupMenu.ts:55`（弹层 `FoldingGroup`，标题「折叠」） | 编辑器右键里的折叠子菜单（成员 `unfold/unfoldAll/fold/foldAll`） | `FoldingGroup`（`LangActions.xml:270-303`，**顺序**：展开三项 → 收起三项 → 到级别两组 → 文档注释 → 切换 → 选区/块） |

**键位表（逐条核过 `$default.xml`，本仓只有最后两条）**：

| 上游动作 | 文案（中文包） | `$default.xml` 键位 | 本仓 |
|---|---|---|---|
| `ExpandRegion` | 展开 | `control ADD` / `control EQUALS` | 缺 |
| `ExpandRegionRecursively` | 递归展开 | `control alt ADD` / `control alt EQUALS` | 缺 |
| `ExpandAllRegions` | 全部展开(_E) | `control shift ADD` / `control shift EQUALS` | ✅ `unfoldAll`（文案与键位都对） |
| `CollapseRegion` | 收起(_C) | `control SUBTRACT` / `control MINUS` | 缺（`unfold`/`fold` 只在右键弹层里，没键位） |
| `CollapseRegionRecursively` | 递归收起(_A) | `control alt SUBTRACT` / `control alt MINUS` | 缺 |
| `CollapseAllRegions` | 全部收起(_A) | `control shift SUBTRACT` / `control shift MINUS` | ⚠️ 键位 ✅，**文案写成「全部折叠」** |
| `ExpandToLevel1..5` | _1.._5 | `control MULTIPLY` | 缺 |
| `ExpandAllToLevel1..5` | _1.._5 | `control shift MULTIPLY` | 缺 |
| `ExpandDocComments` / `CollapseDocComments` | 展开文档注释 / 收起文档注释(_O) | 无 | 缺（LSP 的 `kind: comment` 可以当锚） |
| `ExpandCollapseToggleAction` | 切换折叠 | 无 | 缺 |
| `CollapseSelection` | 折叠选区/移除区域(_S) | `control PERIOD` | 缺 |
| `CollapseBlock` | 折叠代码块(_B) | `control shift PERIOD` | 缺 |

## C. 下一批该做的四条（按用户可见度）

① **动作族**：区域 / 递归 / 到级别（1–5）/ 选区 / 块 / 切换 / 文档注释 —— 现在只有"全部"两条，
    照 §A 的键位表逐个接（CodeMirror 有 `foldCode`/`unfoldCode`/`foldAll`/`unfoldAll`/`foldable`，
    递归与到级别要自己按区间嵌套算，选区/块要按选区边界找区间）；
② **`CodeFoldingSettings` 的五个开关**（`COLLAPSE_IMPORTS` 默认 true / `COLLAPSE_METHODS` /
    `COLLAPSE_FILE_HEADER` 默认 true / `COLLAPSE_DOC_COMMENTS` / `COLLAPSE_CUSTOM_FOLDING_REGIONS`）
    —— 对应 IDEA「设置 › 编辑器 › 常规 › 代码折叠」那一页；
③ **折叠状态的持久化**（`EditorFoldingInfo` + necromancy：重开文件后把上次折叠的区间放回去）；
④ **「全部收起」的文案**（现在是「全部折叠」）与弹层成员顺序照 `FoldingGroup` 排。

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
| `CodeFoldingSettings` | `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java` | `[ ]` | 五个开关（`COLLAPSE_IMPORTS` 默认 true、`COLLAPSE_METHODS`、`COLLAPSE_FILE_HEADER` 默认 true、`COLLAPSE_DOC_COMMENTS`、`COLLAPSE_CUSTOM_FOLDING_REGIONS`，`:8-12`）本仓都没有（§C②） |
| `CodeFoldingSettingsImpl` | `platform/editor-ui-ex/src/com/intellij/codeInsight/folding/CodeFoldingSettingsImpl.java` | `[ ]` | 那五个开关的持久化（`@State`）；本仓的设置持久化里没有这几个字段（§C②） |
| `CodeFoldingManager` | `platform/foldings/src/com/intellij/codeInsight/folding/CodeFoldingManager.java` | `[~]` | 折叠的查询/变更面：本仓落在 `src/components/CodeEditor.vue` 的折叠 StateField 与 `src/editorCommands.ts` 的命令表；**缺**按偏移查询折叠区间这类公开面 |
| `CodeFoldingManagerImpl` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingManagerImpl.java` | `[~]` | 同上（本仓没有这个对象，行为分散在 `src/components/CodeEditor.vue` 与 `src/editorCommands.ts`） |
| `CodeFoldingPass` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingPass.java` | `[~]` | 重建折叠区间的 pass：本仓在打开/更新文档时用 LSP `foldingRange` 建区间（`src/components/CodeEditor.vue`）；**缺**文档变更后的重算 |
| `CodeFoldingPassFactory` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingPassFactory.java` | `[~]` | 按语言给 pass 的工厂：本仓等价的是编辑器装配时装折叠扩展（`src/components/CodeEditor.vue`） |
| `CodeFoldingNecromancer` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingNecromancer.kt` | `[ ]` | 重开文件后异步恢复折叠状态（§C③） |
| `CodeFoldingNecromancy` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingNecromancy.kt` | `[ ]` | 同上（复活机制的编排） |
| `CodeFoldingZombie` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingZombie.kt` | `[ ]` | 被复活的折叠状态载荷（§C③） |
| `FoldLimb` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldLimb.kt` | `[-]` | 通用复活机制的构件（§D.4）：本仓没有那套框架 |
| `CollapseBlockHandlerImpl` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseBlockHandlerImpl.java` | `[ ]` | 「折叠代码块」的通用实现（§C①） |
| `CollapseExpandDocCommentsHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseExpandDocCommentsHandler.java` | `[ ]` | 文档注释的收起/展开（§C①；LSP 的 `kind: comment` 可当锚，`src/bridge.ts`） |
| `CollapseSelectionHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseSelectionHandler.java` | `[ ]` | 「折叠选区/移除区域」的实现（§C①） |
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
| `BaseExpandToLevelAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseExpandToLevelAction.java` | `[ ]` | 到级别那 10 个动作的基类（§C①） |
| `BaseFoldingHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseFoldingHandler.java` | `[~]` | handler 基类：本仓的等价物是 `src/editorCommands.ts` 那张"键位与菜单共用"的命令表；**缺**按动作区分的能力（选区/递归） |
| `CollapseAllRegionsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseAllRegionsAction.java` | `[~]` | 键位已接（`src/menus/editMenu.ts` 的 `Ctrl Shift NumPad_Subtract`，与 `$default.xml` 一致）；**文案写成「全部折叠」**，上游是「全部收起」 |
| `CollapseBlockAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseBlockAction.java` | `[ ]` | 「折叠代码块(_B)」`Ctrl Shift .`（§C①） |
| `CollapseDocCommentsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseDocCommentsAction.java` | `[ ]` | 「收起文档注释(_O)」（§C①） |
| `CollapseRegionAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseRegionAction.java` | `[~]` | 已有 `fold`（CodeMirror `foldCode`，在 `src/menus/editorPopupMenu.ts` 的折叠弹层里）；**缺** `Ctrl+-` 键位与 Code 菜单里的位置 |
| `CollapseRegionRecursivelyAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseRegionRecursivelyAction.java` | `[ ]` | 「递归收起(_A)」`Ctrl Alt -`（§C①） |
| `CollapseSelectionAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseSelectionAction.java` | `[ ]` | 「折叠选区/移除区域(_S)」`Ctrl .`（§C①） |
| `ExpandAllRegionsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllRegionsAction.java` | `[~]` | `src/menus/editMenu.ts` 的 `unfoldAll`（全部展开，`Ctrl Shift NumPad_Add`）——**文案与键位都与上游一致** |
| `ExpandAllToLevel1Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel1Action.java` | `[ ]` | 「全部展开到级别 1」`Ctrl Shift *`（§C①） |
| `ExpandAllToLevel2Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel2Action.java` | `[ ]` | 同上（级别 2） |
| `ExpandAllToLevel3Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel3Action.java` | `[ ]` | 同上（级别 3） |
| `ExpandAllToLevel4Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel4Action.java` | `[ ]` | 同上（级别 4） |
| `ExpandAllToLevel5Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllToLevel5Action.java` | `[ ]` | 同上（级别 5） |
| `ExpandCollapseToggleAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandCollapseToggleAction.kt` | `[ ]` | 「切换折叠」（展开或收起当前代码块）（§C①） |
| `ExpandDocCommentsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandDocCommentsAction.java` | `[ ]` | 「展开文档注释」（§C①） |
| `ExpandRegionAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandRegionAction.java` | `[~]` | 已有 `unfold`（CodeMirror `unfoldCode`，在 `src/menus/editorPopupMenu.ts` 的折叠弹层里，命令表在 `src/editorCommands.ts`）；**缺** `Ctrl+=` 键位与 Code 菜单里的位置 |
| `ExpandRegionRecursivelyAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandRegionRecursivelyAction.java` | `[ ]` | 「递归展开」`Ctrl Alt =`（§C①） |
| `ExpandToLevel1Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel1Action.java` | `[ ]` | 「展开到级别 1」`Ctrl *`（§C①） |
| `ExpandToLevel2Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel2Action.java` | `[ ]` | 同上（级别 2） |
| `ExpandToLevel3Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel3Action.java` | `[ ]` | 同上（级别 3） |
| `ExpandToLevel4Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel4Action.java` | `[ ]` | 同上（级别 4） |
| `ExpandToLevel5Action` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandToLevel5Action.java` | `[ ]` | 同上（级别 5） |

**四档合计**：`[x]` 0 + `[~]` 10 + `[ ]` 33 + `[-]` 26 = 69。
