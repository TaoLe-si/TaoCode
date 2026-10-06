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
| `src/editorFoldingState.ts` + `src/editorFoldingController.ts`（折叠状态的存/取 + 调度管道） | 折叠状态的存档（折着的 + "用户展开过"的覆盖；轻签名 = 起点那行的原文）、按偏移+签名恢复、重算时先存后删失效项；管道顺序 = 存 → 装区间 → 记候选 → 按默认折 → 清失效 → 恢复，且**串行** | `DocumentFoldingInfo`（每个文档的状态）+ `UpdateFoldRegionsOperation`（新算的区间怎么并进来）；上游靠 PSI 元素签名与 RangeMarker，本仓的替身写在 `src/editorFoldingState.ts` 头上 |
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
③ **折叠状态的持久化** —— ✅ **已做（第六十二批会话内 + 第六十四批落盘）**：
    会话内那份在 `src/editorFoldingState.ts`（存档 + 恢复）+ `src/editorFoldingController.ts`（调度管道），
    关标签/换文件前存、区间到手后恢复；上游那套 PSI 元素签名与 RangeMarker 的替身是「偏移 + 起点那行原文」的
    轻签名（`computeExpandRanges:146-164` 的按签名找回也照做了）。
    **落盘**照 `DocumentFoldingInfo.writeExternal`/`readExternal`（`:260-368`）：状态写进**项目级**设置
    （`ProjectSettings.foldingState`，就是上游那个"项目的 workspace 文件"在本仓的位置），前端去抖写入
    （`flushFoldState`）+ 打开工作区时读回（`importFoldState`），原生侧新增
    `native/folding_state_schema.cpp` 做形状与上限校验（整份应用状态有 1 MiB 硬上限，折叠状态是唯一随项目
    规模线性长的字段，所以前端还会按"最近动过的"裁到 20 个文件 × 30 条）。上游那道文件时间戳闸只管**手工区间**那一半（`DocumentFoldingInfo.java:326-335`，按元素签名存的那一半不看日期），
    本仓的替身是**逐条**轻签名（偏移 + 起点整行原文，`src/editorFoldingState.ts:205-228`）——比上游更细，不是缺（2026-10-06 订正，见 §G 该行）。
④ **「全部收起」的文案** —— ✅ **已做**（第六十批）：Code 菜单与弹层两处都是「全部收起」，
    13 条成员照 `FoldingGroup` 排（`src/menus/codeMenu.ts`，机检 `tests/editor-folding.test.mjs` 盯着顺序与文案）；
    早先挂在编辑菜单里的四条已删（上游在 Code 菜单）；
⑤ **文档变动后的重算** —— ✅ **已做（第六十二批）**：`UpdateFoldRegionsOperation` 的两条规矩都接上了 ——
    ①「新算的候选里没有的旧折叠要删」（`removeInvalidRegions`，先存后删，`staleFolds` + `dropStaleFolds`）；
    ②「用户展开过的块在重算里活得下来」（`shouldExpandNewRegion` 的 `oldStatus` 那一支：重算前先 `capture`，
    展开态按签名记，恢复那一步顶掉自动折叠）。边界对不上时按**签名**认块（`applyFoldPlan` 的匹配规则），
    这样"编辑把块推走"不会丢折叠。
    `caretInsideRange` 的"光标严格落在里面就不折"也接进管道了（`foldKinds` 折的时候跳过那些区间）。
    **2026-10-04 第二轮补**：下一次重算不再只等语言服务回包/诊断更新 —— `CodeEditor.vue` 的
    updateListener 在 `docChanged` 里直接 `folding.schedule()`（去抖 400ms），上游 `FoldingUpdate`
    的"文档事件直触"这一条落地，`CodeFoldingPass`/`FoldingUpdate` 两行因此改判 `[x]`。
    ~~**仍缺**：`ApplyDefaultStateMode` 的另外两种模式、`getFoldRegionsForSelection`~~ ⇒ **已落**（2026-10-06 订正，见 §G 的
    `UpdateFoldRegionsOperation` 行与 `BaseFoldingHandler`/`CollapseAllRegionsAction`/`ExpandAllRegionsAction` 三行）：
    选区作用域走 `src/editorFolding.ts:645` 的 `selectionScoped`，`ApplyDefaultStateMode` 的 `NO`/`EXCEPT_CARET_REGION`
    走 `src/editorFoldingController.ts:82-95`/`:126`，`YES` 在社区树里零调用方 ⇒ 判 `[-]`。

## D. 不适用（`[-]`，29 类）

四类理由：

1. **语言侧 builder 与它们的专属件**（`java/` 11 + `xml/` 1）：本仓的折叠区间来自 **LSP** 的
   `textDocument/foldingRange`，没有 PSI，也没有 Java/XML 语言插件的那套 `FoldingBuilder`；
2. **语义签名族**（`ElementSignatureProvider` / `AbstractElementSignatureProvider` / `GenericElementSignatureProvider` /
   `OffsetsElementSignatureProvider` / `PsiNamesElementSignatureProvider` / `JavaElementSignatureProvider` /
   `XmlElementSignatureProvider`）：它们存的是"PSI 元素 ↔ 签名"的映射，靠元素身份把折叠状态放回去 ——
   本仓的 LSP 只给**区间**（行列范围），没有元素身份可依；
3. **注入片段**（`InjectedCodeFoldingPass` / `InjectedCodeFoldingPassFactory`）：本仓的编辑器不承载注入片段
   （模板语言里嵌另一种语言那种）；
4. **Swing/打开期提示的宿主**（折叠轮廓区上的悬停提示也算这一类：装订线形态对不上）：`FoldingHintPostStartupActivity`（启动时给编辑器装鼠标监听的那个 `ProjectActivity`）、
   `EditorFoldingInfoWindow`（依附 `EditorWindow` 的那一半 —— 本仓每个标签一个编辑器，没有"同一文档开在多个编辑器
   窗口"的形态）、`FoldLimb`（通用复活机制的构件，本仓没有那套框架）。

## E. 未移植（`[ ]`，0 类）—— 2026-10-04 起没有留白

下面这份清单是**历史记录**：第六十至六十五批逐条处置后本域 `[ ]` 归零（可移植的都有落点，
语言侧 builder / 注入片段 / Swing 与打开期提示的宿主逐条判 `[-]`）。逐条现状以 §G 与表尾四档为准。

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
| `CodeFoldingSettings` | `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java` | `[~]` | 本仓按 LSP 路径实现：`COLLAPSE_IMPORTS` 默认 true、`COLLAPSE_CUSTOM_FOLDING_REGIONS` 默认 false 两条（`src/editorFoldingSettings.ts` + 设置页 `src/components/CodeFoldingSettingsPage.vue`，预折叠在 `src/editorFolding.ts` 的 `foldKinds`）；**缺** `COLLAPSE_METHODS` / `COLLAPSE_FILE_HEADER` / `COLLAPSE_DOC_COMMENTS` —— 这三个在上游由语言侧 builder 消费（`JavaCodeFoldingSettingsBase.java:67/106/116`），上游自己的 LSP 路径对它们也传 null（`LspFoldingBuilder.kt:41-46`），本仓没有语言侧 builder ⇒ 设置页不渲染这三行。**这三键 ⇒ `[-]`（2026-10-06 订正，原写「缺」）**：消费方只有语言侧 builder —— `JavaCodeFoldingSettingsBase.java:67` 读 `COLLAPSE_METHODS`、`:106` 读 `COLLAPSE_DOC_COMMENTS`、`:116` 读 `COLLAPSE_FILE_HEADER`，上游自己的 LSP 路径对 `Comment` 与其余 kind 直接传 null（`LspFoldingBuilder.kt:41-46` 只映射 `Imports`/`Region`）；渲染出来就是零消费方的空壳（规约 §3），故不是缺口而是不适用。默认值表在 `CodeFoldingSettings.java:7-11` |
| `CodeFoldingSettingsImpl` | `platform/editor-ui-ex/src/com/intellij/codeInsight/folding/CodeFoldingSettingsImpl.java` | `[~]` | 落盘那一段：上游 `@State(name = "CodeFoldingSettings", storages = @Storage("editor.xml"))`（`:11`），本仓两个键进编辑器设置那一段（`native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS` + `settings_schema.cpp` 的 `editor_defaults_impl()`，`src/settingsModel.ts` 的 `EditorSettings`）；**这三键 ⇒ `[-]`（2026-10-06 订正，原写「缺」）**：上游也没有面向它们的存储或读取方，除语言侧 builder 外没有消费者（`JavaCodeFoldingSettingsBase.java:67/106/116`；LSP 路径传 null `LspFoldingBuilder.kt:41-46`），本仓没有语言侧 builder ⇒ 不建这三条落盘键（规约 §3 不放假设置面） |
| `CodeFoldingManager` | `platform/foldings/src/com/intellij/codeInsight/folding/CodeFoldingManager.java` | `[x]` | 折叠的查询/变更面**整张都落**（2026-10-06 订正：原写「缺按偏移查询折叠区间这类公开面」不成立）：`getFoldRegionsAtOffset:46-58` ↔ `src/editorFolding.ts:274` 的 `areasContaining`（含端点 + 起点降序）、`:31` 的 `findFoldRegion` ↔ 同文件 `applyFoldPlan` 的精确匹配、`:35` 的 `saveFoldingState` ↔ `src/editorFolding.ts:475` 的 `foldedAreasOf`、`:38` 的 `restoreFoldingState` ↔ `src/editorFoldingState.ts:205` 的 `restorePlan`、`:29` 的 `updateFoldRegionsAsync` ↔ `src/editorFoldingController.ts` 的 `schedule`/`run`、`:44` 的 `releaseFoldings` ↔ 该控制器的 `dispose`；再往外还有 `src/editorFolding.ts:392`（`enclosingAreas`，按偏移取祖先链）、`:480`（`candidatesOf`，`isCollapsedByDefault` 的入参那一半）、`:258`（`isCollapsedIn` ↔ `FoldingUtil.java:69-72` 的用途）。消费方都在生产链路上（控制器与命令表调它们，判据 `tests/editor-folding.test.mjs`、`tests/folding-selection-scope.test.mjs`） |
| `CodeFoldingManagerImpl` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingManagerImpl.java` | `[x]` | 同上（2026-10-06 升档：这一族的公开面在 `src/editorFolding.ts` / `src/editorFoldingState.ts` / `src/editorFoldingController.ts` 三处都有真实实现与消费方）。对象本身没有（本仓每个标签一个 CodeMirror 视图，没有 `Project` 级 manager），行为分散：调度与 `myEditorsWithFolding` 那个"这份文件建过折叠"的标记 ↔ `src/editorFoldingController.ts:50` 的 `builtFor` + `:169`（真拿到区间才打标记，异步回包的差别写在 `:78-80`）；`isCollapsedByDefault`/`keepExpandedOnFirstCollapseAll` 的转发 ↔ `src/editorFolding.ts` 的 `foldKinds` + `src/editorFoldingSettings.ts` 的 kind 映射（`keepExpandedOnFirstCollapseAll` 是语言侧钩子、上游 LSP 路径没覆盖，退化写在 `CollapseAllRegionsAction` 行）；`markAsAutoCreated` ↔ `src/editorFolding.ts:700` 的 `foldSelectionOutcome` 里 `autogenerated` 那一档 |
| `CodeFoldingPass` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingPass.java` | `[x]` | 重建折叠区间的 pass：本仓在打开/更新文档时用 LSP `foldingRange` 建区间（`src/components/CodeEditor.vue`）。文档一变 `foldingRanges` 的 `update` 先把旧区间清空（行号对不上了，`src/editorFolding.ts`），**同一次 `docChanged` 直接触发** `folding.schedule()`（`CodeEditor.vue` 的 updateListener，去抖 400ms），重取后走 `src/editorFoldingController.ts` 的六步管道（存档 → 装区间 → 记候选 → 折默认 → 清失效 → 恢复）；语言服务回包/诊断更新（`lspDiagnostics` watcher）是另一条触发，两条都进同一条管道。**2026-10-04 第二轮补齐**：上游 PSI 变更直触 `FoldingUpdate` 的那条独立触发已接上（服务端不推诊断时编辑也会重算），判据是 `tests/editor-folding.test.mjs` 的触发接线断言。上游的 per-editor pass 框架与 `FirstFoldingPass` 标记在本仓没有对应对象（每个标签一个 CodeMirror 视图，首跑/常规跑都归这一条管道），行为等价。 |
| `CodeFoldingPassFactory` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingPassFactory.java` | `[~]` | 按语言给 pass 的工厂：本仓等价的是编辑器装配时装折叠扩展（`src/components/CodeEditor.vue`） |
| `CodeFoldingNecromancer` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingNecromancer.kt` | `[~]` | "重开后把折叠放回去"这件事在 `src/editorFoldingController.ts`（`capture`/`restore`）里；**缺** 上游那套把折叠模型**从磁盘缓存**复活（`cache.folding.model.on.disk` 的 `CleaverNecromancer`，`:44-56`）—— 本仓区间来自 LSP，重开时重新问一遍即可，不需要那份缓存 |
| `CodeFoldingNecromancy` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingNecromancy.kt` | `[~]` | 同上（编排）；本仓的等价物是 `src/editorFoldingController.ts` 的管道顺序 |
| `CodeFoldingZombie` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CodeFoldingZombie.kt` | `[-]` | 折叠**模型**的磁盘缓存载荷（§D.4 的性能件）：上游把它挂在注册表开关 `cache.folding.model.on.disk` 后面（`CodeFoldingNecromancer.kt:52-56` 的 `isZombieFriendly`），缓存的是"区间对象"免得重算 —— 本仓的模型是服务端一次 `foldingRange` 请求就回来的列表，而**状态**已经落盘（`ProjectSettings.foldingState`，第六十四批），再造一层模型缓存没有可见收益 |
| `FoldLimb` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldLimb.kt` | `[-]` | 通用复活机制的构件（§D.4）：本仓没有那套框架 |
| `CollapseBlockHandlerImpl` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseBlockHandlerImpl.java` | `[~]` | `fold.block` = `src/editorFolding.ts` 的 `foldBlockAtCaret`（`blockAt` 跳过 `kind` 为 comment/imports/region 的区间，取光标处最内层；没有服务端区间时用 `syntaxArea` 的语法树候选顶上）；**缺**上游按语言注册的 `CollapseBlockHandler` EP（`CollapseBlockAction.java:29-46`） |
| `CollapseExpandDocCommentsHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseExpandDocCommentsHandler.java` | `[x]` | `fold.docs`/`unfold.docs` = `src/editorFolding.ts` 的 `foldDocComments`/`unfoldDocComments`；**2026-10-04 本轮补上"文档注释 vs 普通注释"的区分**：`docCommentRanges` + `isDocCommentLine` 按起始行记号过滤（Java/Kotlin/JS/TS/PHP/C 系的 `/**` 且不是空注释、Python 的 `"""`/`'''`），`kind === 'comment'` 的普通注释不再被这组动作碰到 —— 上游 `CollapseExpandDocCommentsHandler:46-52` 的 `PsiDocCommentBase` / `CodeDocumentationAwareCommenter` 判定用词法近似替代，认不出的语言按"不动作"处理（保守，不误伤普通注释）；判据 `tests/editor-folding.test.mjs` 的三条（词法判定 / 区间筛选 / 命令端到端只折文档注释那块） |
| `CollapseSelectionHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseSelectionHandler.java` | `[~]` | `fold.selection` = `src/editorFolding.ts` 的 `toggleFoldSelection`，照 `CollapseSelectionHandler.java:24-87`：有选区时精确匹配就移除（手工区间）、搭界就按上游默认「取消」不动、否则折起选区那几行；无选区时切换光标处最内层区域；**缺** `:44` 的提示与 `:49-58` 的模态确认框（本仓没有编辑器内 hint / 模态框宿主） |
| `DocumentFoldingInfo` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/DocumentFoldingInfo.java` | `[x]` | 存档与恢复都在：`src/editorFoldingState.ts` 的 `captureFoldState`（`:91-110` 的"折着的都记 + 本该默认折着却展开着的按签名记"）与 `restorePlan`（`setToEditor:198-220` + `computeExpandRanges:146-164` 的按签名找回），落盘照 `writeExternal`/`readExternal`（`:260-368`）写进项目级设置（`native/folding_state_schema.cpp` 校验）（2026-10-06 订正，原写「**缺**上游用文件时间戳挡"磁盘上改过"」）：上游那道时间戳闸**只管手工区间那一半** —— `:314-341` 里 `date` 只在 `MARKER_TAG` 那一支才问（`:326-335`，`:333` 还叠加 `isDocumentUnsaved`），按元素签名存的 `ELEMENT_TAG`（`:322-324`）根本不看日期。本仓对**每一档**都验「偏移 + 起点那行的原文」（`src/editorFoldingState.ts:205-228` 的 `restorePlan`：两者都对得上才原处放回，否则拿签名去候选里认回，认不回就放弃）⇒ 替身比上游那道闸更细，不是缺。真 mtime 前端拿不到（`src/editorFoldingState.ts` 文件头写明），要 mtime 得宿主随 `foldingState` 一起回 = 新设置键，见 `docs/wiring-requests-2026-10-06-fold3.md` 的 W-3（本轮结论：不做，只订正判词） |
| `EditorFoldingInfo` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/EditorFoldingInfo.java` | `[~]` | 折叠状态与"谁建的折叠"的记录：本仓在 `src/editorFoldingState.ts`（存档）与 `src/editorFolding.ts` 的区域层（手工 vs 自动，`auto` 标记）里；**缺** PSI 元素指针那一层（`addRegion(region, pointer)`）—— 没有 PSI，映射只能按偏移+签名 |
| `EditorFoldingInfoWindow` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/EditorFoldingInfoWindow.java` | `[-]` | 依附 `EditorWindow` 的那一半（§D.4）：本仓没有"同一文档开在多个编辑器窗口"的形态 |
| `ElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/ElementSignatureProvider.java` | `[-]` | 语义签名族（§D.2） |
| `AbstractElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/AbstractElementSignatureProvider.java` | `[-]` | 同上 |
| `GenericElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/GenericElementSignatureProvider.java` | `[-]` | 同上（通用签名） |
| `OffsetsElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/OffsetsElementSignatureProvider.java` | `[-]` | 同上（按偏移的签名） |
| `PsiNamesElementSignatureProvider` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/PsiNamesElementSignatureProvider.java` | `[-]` | 同上（按 PSI 名字的签名） |
| `FoldingHintMouseMotionListener` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingHintMouseMotionListener.java` | `[-]` | 触发条件是鼠标落在**装订线折叠轮廓区**（`EditorMouseEventArea.FOLDING_OUTLINE_AREA`，`:47-53`）且该折叠区的**起始行已滚出视口上沿**（`:71-88`），此时弹一段"被挡住的头部"的片段提示（`:88-110`）。本仓的 CodeMirror 装订线只在折叠区的**起始行**画标记：起始行滚出视口后那一带没有可悬停的元素 ⇒ 这条交互的形态对不上（§D.4 的 Swing 宿主） |
| `FoldingHintPostStartupActivity` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingHintPostStartupActivity.kt` | `[-]` | 打开期提示的宿主（§D.4） |
| `FoldingPolicy` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingPolicy.java` | `[~]` | 三个职责都有落点：`isCollapsedByDefault`（`:25-28`）/`keepExpandedOnFirstCollapseAll`（`:35-42`）转发给**语言侧** `FoldingBuilder`，本仓的等价物是 LSP `kind` → 设置那套映射（`src/editorFolding.ts` 的 `foldKinds` + `src/editorFoldingSettings.ts`，依据 `LspFoldingBuilder.kt:41-46`；"首次全收起的例外"退化见 `CollapseAllRegionsAction` 行）；`getSignature`/`restoreBySignature`（`:44-70`，带 `ElementSignatureProvider` EP）↔ `src/editorFoldingState.ts` 的轻签名 `signatureAt` 与 `restorePlan` 的按签名认回。**缺** PSI 元素签名（§D.2）与 `processingInfoStorage` 那套诊断输出 |
| `FoldingUpdate` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/FoldingUpdate.java` | `[x]` | 按语言重算折叠区间：本仓在打开文档与**每次文档变更**时请求 LSP `foldingRange`（`src/components/CodeEditor.vue` 的 updateListener 直接调 `folding.schedule()`；编辑后区间在 `src/editorFolding.ts` 的 `foldingRanges` 里被清空），重取后走 `src/editorFoldingController.ts` 的同一条管道，含 `UpdateFoldRegionsOperation` 的三条规矩（清失效先存后删、用户展开过的块按签名活下来、默认折叠跳过光标所在区间）。**2026-10-04 第二轮补齐**：文档事件直触的独立触发已接上（与 `CodeFoldingPass` 行同一条），上游 PSI 侧的按文件缓存与注入片段分支在本仓没有对应物（注入见 §D.3），替换物是服务端一次 `foldingRange` 与服务端/本地 region 区间的合并（`src/editorFolding.ts` 的 `mergeFoldRanges`）。 |
| `InjectedCodeFoldingPass` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/InjectedCodeFoldingPass.java` | `[-]` | 注入片段的折叠（§D.3） |
| `InjectedCodeFoldingPassFactory` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/InjectedCodeFoldingPassFactory.java` | `[-]` | 同上 |
| `UpdateFoldRegionsOperation` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/UpdateFoldRegionsOperation.java` | `[x]` | 三条都接了：失效项先存后删（`removeInvalidRegions`）、用户展开过的块活在重算里（`shouldExpandNewRegion` 的 `oldStatus`）、**默认折叠时跳过光标严格落在里面的那几条**（`caretInsideRange:236-238`，见 `src/editorFolding.ts` 的 `foldKinds`），管道在 `src/editorFoldingController.ts`；**`ApplyDefaultStateMode` 三档也已全判掉**（2026-10-06 订正，原写「缺另外两种模式」）：`EXCEPT_CARET_REGION` ↔ `src/editorFolding.ts:813` 的 `unfoldIntersecting` + `src/editorFoldingController.ts:126` 的 `applyNavigation`（管道 ⑦，导航落点是折着的就打开）；`NO` ↔ `src/editorFoldingController.ts:82-95`（重算轮次只展开"关着的那一族"、不再按默认折）配 `:50` 的 `builtFor` 与 `:169`（真拿到区间才打"建过折叠"的标记），判据 `tests/folding-navigate-unfold.test.mjs:139-181`；`YES` ⇒ **`[-]`**：社区树里零调用方（全树只命中枚举定义 `UpdateFoldRegionsOperation.java:47` 那一行本身），`FoldingUpdate.java:154-156` 永远在 `NO` 与 `EXCEPT_CARET_REGION` 之间二选一 ⇒ 没有用户可见行为可还原 |
| `CollapseBlockHandler` | `platform/lang-api/src/com/intellij/codeInsight/folding/CollapseBlockHandler.java` | `[-]` | 语言插件实现的扩展点接口（EP `com.intellij.collapseBlockHandler`，`CollapseBlockAction.java:29-46` 按文件语言取 handler）—— 本仓没有语言插件，判定同 §D.1 的 `JavaCollapseBlockHandler`；**行为**那一半在 `CollapseBlockAction` 行（`src/editorFolding.ts` 的 `blockAt` + 语法树退路） |
| `FoldingUtil` | `platform/platform-impl/src/com/intellij/codeInsight/folding/impl/FoldingUtil.java` | `[~]` | 逐函数有落点，都在 `src/editorFolding.ts`（`applyFoldPlan` 的精确匹配 ↔ `findFoldRegion:23-27`、`areaStartingAtLine` ↔ `findFoldRegionStartingAtLine:28-44`、`areasContaining` ↔ `getFoldRegionsAtOffset:46-58` 的按起点降序、`foldedBounds`/`isCollapsedIn` ↔ `isTextRangeFolded:69-72`、`depthOf`/`levelPlan` ↔ `createFoldTreeIterator:77-` 的层数，本仓按行区间算层、不建迭代器）与 `src/editorFoldingState.ts`（`signatureAt`）。`isHighlighterFolded`（`:60-67`）与 PSI 版重载 ⇒ **`[-]`**（2026-10-06 订正，原写「缺」）：那两个重载的入参是 `RangeHighlighterEx`/`PsiElement`，读的是 highlighter 的 affected-area 起止偏移（`:61-65` 那两个 `getAffectedArea*Offset`），本仓既没有注入/markdown 高亮那一层也没有 PSI ⇒ 没有可判折的对象。**两处行号订正**：`isTextRangeFolded` 是 `:69-72`（原文写 `:69-76`，该文件只有 120 行），`createFoldTreeIterator` 是 `:77-119` |
| `BaseExpandToLevelAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseExpandToLevelAction.java` | `[~]` | `src/editorFolding.ts` 的 `levelPlan`，照 `BaseExpandToLevelAction.java:43-70` 的相对层级：比第 N 层浅的展开、正好第 N 层的**折起**、更深的原样不动；`expandCaretToLevel`/`expandAllToLevel` 分别对应 `expandAll=false/true`（根 = `rootAtLine`） |
| `BaseFoldingHandler` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseFoldingHandler.java` | `[x]` | handler 基类：本仓的等价物是 `src/editorCommands.ts` 的命令表 + `src/editorFolding.ts` 的区域层，`getFoldRegionsForCaret`（递归那两条的根挑法）照 `:61-86` 实现了；`getFoldRegionsForSelection`（`:44-56`：有选区时取「与选区搭界 **且** 整条落在选区里」的那些，一条都没有就退回 `getAllFoldRegions()`）**已落** —— `src/editorFolding.ts:645` 的 `selectionScoped` 逐条对上（`from >= to` 空选区给 null = 全集、`area.to > from && area.from < to` 是搭界、`area.from >= from && area.to <= to` 是 `selectionRange.contains(region)`、空结果给 null 走全集），消费方是 `:659` 的 `foldAllCommand` 与 `:676` 的 `unfoldAllCommand`，判据 `tests/folding-selection-scope.test.mjs`（`:60-71` 逐条对四档边界、`:96-134` 端到端「只展开选区里那条」+ 命令表接线） |
| `CollapseAllRegionsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseAllRegionsAction.java` | `[x]` | `src/editorCommands.ts` 的 `foldAll`（`Ctrl+Shift+-`/`Ctrl+Shift+NumPad-`），Code 菜单文案「全部收起」。**两段式在本仓退化成一段**（分析，不是偷懒）：第一步只折"展开着且不 keep 的"（`collapseInFirstStep:35-38`），而 `keepExpandedOnFirstCollapseAll` 是**语言侧 FoldingBuilder 的钩子**（`FoldingBuilder.java:65-70` 默认 false），上游的 LSP builder 也没覆盖它 ⇒ 第一步就等于"折全部展开着的"，第二步（全折一遍，`ExpandAllRegionsAction.java:70-75`）只在"什么都没折着"时跑、那时是空操作；**「全部」的选区作用域已落**（2026-10-06 订正，原写「缺 `getFoldRegionsForSelection`」）：`src/editorFolding.ts:659` 先问 `:645` 的 `selectionScoped`，选区里有完整落在其中的区间就只折那几条，否则整篇 —— 与 `BaseFoldingHandler.java:44-56` 同果，判据 `tests/folding-selection-scope.test.mjs` |
| `CollapseBlockAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseBlockAction.java` | `[~]` | `fold.block`，命令表与键位见 §A；实现见 `src/editorFolding.ts` |
| `CollapseDocCommentsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseDocCommentsAction.java` | `[~]` | `fold.docs`，Code 菜单 `code.folding` 里那一条（`src/menus/codeMenu.ts`）；实现见 `src/editorFolding.ts` |
| `CollapseRegionAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseRegionAction.java` | `[~]` | `fold` = `src/editorFolding.ts` 的 `foldAtCaret`，照 `CollapseRegionAction.java:26-38` 挑目标：先看"起始行落在光标行"的区域，否则光标处最内层**未折叠**的那条；键位 `Ctrl+-`/`Ctrl+NumPad-`，菜单在 Code 菜单（`src/menus/codeMenu.ts`）；**缺** 上游按 PSI 判"是否可折叠"的那层 |
| `CollapseRegionRecursivelyAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseRegionRecursivelyAction.java` | `[~]` | `fold.recursively` = `src/editorFolding.ts` 的 `foldRecursively`（`recursiveScope`，照 `BaseFoldingHandler.java:61-86`：根 + 套在里面的全部） |
| `CollapseSelectionAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseSelectionAction.java` | `[~]` | `fold.selection`，键位 `Ctrl+.`（`$default.xml:1036-1038`），实现在 `src/editorFolding.ts`；宿主侧的限制记在 `CollapseSelectionHandler` 行 |
| `ExpandAllRegionsAction` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandAllRegionsAction.java` | `[x]` | `src/editorCommands.ts` 的 `unfoldAll`（`Ctrl+Shift+=`，Code 菜单「全部展开」）——键位与文案与上游一致；两段式同样退化成一段（`expandInFirstStep:77-81` 只认"折着且不含 shouldNeverExpand 且不 collapsedByDefault 的"，本仓没有 `shouldNeverExpand` 那一类）；**"只作用于选区"已落**（2026-10-06 订正，原写「缺 `getFoldRegionsForSelection`」）：`src/editorFolding.ts:676` 的 `unfoldAllCommand` 把目标换成正折着的那些后走 `:645` 的 `selectionScoped`，选区里有整条落在其中的折痕就只展开那几条；判据 `tests/folding-selection-scope.test.mjs:96-134`（「只有选区里那条展开了」） |
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

**四档合计**：`[x]` 10 + `[~]` 30 + `[ ]` 0 + `[-]` 29 = 69。（2026-09-30 第六十批：折叠动作族；第六十一批：设置页两条开关；第六十二批：状态存/取与重算；第六十三批：`caretInsideRange`；第六十四批：状态落盘；**第六十五批：最后 5 条 `[ ]` 判掉**（`FoldingPolicy`/`FoldingUtil` 逐函数有落点 → `[~]`；`CodeFoldingZombie` 是注册表后的模型缓存、`CollapseBlockHandler` 是语言侧 EP、`FoldingHintMouseMotionListener` 要装订线折叠轮廓区 —— 本仓都没有宿主 → `[-]`）。**B4 至此没有 `[ ]`。** 2026-10-04 本轮复核：`FoldingPolicy`/`FoldingUtil` 的逐函数落点与 `CollapseBlockHandler` 的 `[-]` 判定不变；`FoldingUpdate`/`CodeFoldingPass` 两条 `[~]` 的"缺编辑后重算"改写精确（重算走 `src/editorFoldingController.ts`，触发点是语言服务回包而非文档事件）。**2026-10-04 本轮改判**：`CollapseExpandDocCommentsHandler` `[~]` → `[x]` —— 文档注释与普通注释的区分已落（`src/editorFolding.ts` 的 `docCommentRanges`/`isDocCommentLine`，判据 `tests/editor-folding.test.mjs`），四档因此从 0/40/0/29 变成 1/39/0/29。**2026-10-04 第二轮改判**：`CodeFoldingPass`/`FoldingUpdate` `[~]` → `[x]` —— CodeEditor 独占放行后把"文档事件直触重算"接上（`CodeEditor.vue` 的 updateListener 在 `docChanged` 里 `folding.schedule()`，去抖在 `src/editorFoldingController.ts`），四档从 1/39/0/29 变成 3/37/0/29。**2026-10-06 第三批改判（fold3 lane，逐条开过本仓与上游两侧坐标）**：`BaseFoldingHandler`/`CollapseAllRegionsAction`/`ExpandAllRegionsAction` 的「缺 `getFoldRegionsForSelection`」与 `UpdateFoldRegionsOperation` 的「缺 `ApplyDefaultStateMode` 另外两档」都已落（`src/editorFolding.ts:645`/`:659`/`:676`/`:813`、`src/editorFoldingController.ts:82-95`/`:126`；上游 `BaseFoldingHandler.java:44-56`、`FoldingUpdate.java:154-156`，`ApplyDefaultStateMode.YES` 全树零调用方 ⇒ `[-]`），`CodeFoldingManager`/`CodeFoldingManagerImpl` 的「缺按偏移查询的公开面」不成立（`src/editorFolding.ts:258`/`:274`/`:392`/`:475`/`:480` ↔ `CodeFoldingManager.java:31/33/35/38/44`），`DocumentFoldingInfo` 的时间戳那一半由逐条轻签名替身覆盖且更细（`src/editorFoldingState.ts:205-228` ↔ `DocumentFoldingInfo.java:314-341`）⇒ 这 7 行 `[~]` → `[x]`，四档从 3/37/0/29 变成 **10/30/0/29**。同批两处**措辞订正、档位不动**：`CodeFoldingSettings`/`CodeFoldingSettingsImpl` 那三个键改判 `[-]`（消费者只有语言侧 builder：`JavaCodeFoldingSettingsBase.java:67/106/116`；LSP 路径传 null `LspFoldingBuilder.kt:41-46`），`FoldingUtil` 行的 `isHighlighterFolded` 改判 `[-]`（入参是 `RangeHighlighterEx`/`PsiElement`）并把 `isTextRangeFolded` 的行号从 `:69-76` 订正为 `:69-72`（`createFoldTreeIterator` 是 `:77-119`）。`CollapseSelectionHandler` 行的两处宿主缺口（编辑器内 hint、重叠确认框）**仍是缺**，登记在 `docs/wiring-requests-2026-10-06-fold3.md` 的 W-1，故该行不动。）
