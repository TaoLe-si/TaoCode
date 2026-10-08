# batch-2026-10-06 foldcheck —— `verdict-folding` 三方对齐核对表（只读 lane）

范围：`docs/inventory/verdict-folding.md` §G 全部 `[~]`（18 行）与 `[x]`（22 行）条目，
与 ① 磁盘（本仓 `src/`/`native/`/`tests/` 真实出口）② 上游
（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）三方对齐。

**本 lane 不写功能码、不动 `docs/inventory/**`、不动 `scripts/verdict_table.py`。**
订正以 §8 的表格交付，由 `ledgerfix` 执行。

上游树口径：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（`third_party/intellij-community` 坏树禁用）。

---

## 0. 现场快照（核对起点，均为本 lane 实测）

mtime 排序（只有 `src/editorFolding.ts`、`src/stickyLines.ts`、`src/editorCommands.ts`、`src/customFoldingSurround.ts` 在判决簿之后动过）：

| mtime | 文件 |
|---|---|
| 09-30 18:21 | `src/editorFoldingSettings.ts`（此后未动 ⇒ 它的坐标可信） |
| 09-30 20:12 / 20:24 | `native/folding_state_schema.cpp`、`src/editorFoldingState.ts`（同上） |
| 10-06 10:51 | `src/editorFoldingController.ts`（同上） |
| 10-06 13:51 / 14:51 | `src/customFoldingRegions.ts`、`src/foldingKeymap.ts` |
| **10-06 15:30** | **`docs/inventory/verdict-folding.md`（判决簿）** |
| 10-06 15:40 / 15:43 | `src/customFoldingSurround.ts`、`src/editorCommands.ts` |
| 10-06 16:22 / **16:23** | `src/stickyLines.ts`、**`src/editorFolding.ts`** |

`src/editorFolding.ts` 相对 HEAD 净 +26 行（865 → 891），增的就是 `blockFoldPlan` 的 `remove` 那一档（见 §2.3）。
**后果**：判决簿里指到 `src/editorFolding.ts` 行 340 以下的坐标整体落后 **+14 ~ +21**；
`src/editorCommands.ts`（+折叠命令表）与 `src/menus/codeMenu.ts`（+chord 显示）另有各自的漂移。

**机检**：判决簿里 206 条 `文件:行号` 指向本仓文件的，**全部在文件行数之内**（无越界、无六位行号）；
"MISSING FILE" 的 13 条全是上游相对路径（`LangActions.xml` / `ActionsBundle.properties` /
`JavaCodeFoldingSettingsBase.java` / `LspFoldingBuilder.kt`），本 lane 逐条在
`D:\Backup\Downloads\intellij-community-master\intellij-community-master` 下实开复核为**在盘**（见 §4）。
⇒ 本域**没有**"行号越界的假坐标"，问题是**"在范围内但指错位置"的过期坐标** + **两处判词落后于代码**。

## 1. `[x]` 行逐条复核（22 行）

**结论**：22 行 `[x]` 的**行为面出口全部真实存在**，没有一行是"判词说 `[x]` 但出口不存在"。
但这 22 行里有 **11 行的本仓行号已过期**（指到同一文件里另一个符号的行上，见 §8 的 C 组）。
逐行（出口 = 2026-10-06 16:5x 磁盘实测）：

| 行（类） | 本仓出口（实测） | 判决簿写的坐标 | 判定 |
|---|---|---|---|
| `CodeFoldingManager` | `src/editorFolding.ts:274`（`areasContaining`）✓、`:258`（`isCollapsedIn`）✓、`:491`（`foldedAreasOf`）、`:496`（`candidatesOf`）、`:408`（`enclosingAreas`）、`src/editorFoldingState.ts:205`（`restorePlan`）、`src/editorFoldingController.ts`（`schedule`/`run`） | `:475`/`:480`/`:392` ✗ 过期；且把 `getFoldRegionsAtOffset:46-58` 记在本类名下（上游本类是 `:33`，`:46-58` 是 `FoldingUtil.java`） | 档位对，坐标要改 |
| `CodeFoldingManagerImpl` | `src/editorFoldingController.ts:50`/`:169` ✓、`src/editorFolding.ts:721`（`foldSelectionOutcome`，判决写 `:700`） | `:700` ✗ | 档位对，坐标要改 |
| `CodeFoldingPass` | `src/editorFolding.ts:43-47`（`foldingRanges.update` 的 `docChanged` 清空）、`src/components/CodeEditor.vue:1010`（`docChanged` → `folding.schedule()`）✓ | 无行号，形状描述 | 判词正确 |
| `CodeFoldingPassFactory` | `src/components/CodeEditor.vue:757-758`（`foldingRanges` + `lspFoldService`）✓、`:336`（`createFoldingController`）✓、`:1010` ✓、`:1049`（watch → `applyDefaults`）✓ | 全部复核准确 | 判词正确 |
| `CodeFoldingNecromancer` | `src/editorFoldingState.ts:96-112`/`:115-127`/`:131-137` ✓、`native/folding_state_schema.cpp:29-68`（`validate_folding_state:29`、`known_keys:46`、函数收尾在 `:68`，判决这条**复核准确**）、`native/settings_schema.cpp:952`/`:955` ✓、`src/settingsModel.ts:144` ✓、**`src/workspaceLifecycle.ts:323`/`:434`** | 判决写 `:305`/`:413` ✗ 过期（该文件被别的 lane 改过） | 档位对，坐标要改 |
| `CodeFoldingNecromancy` | 同上 + `src/editorFoldingController.ts:58`/`:101`/`:109` ✓、管道 `:148-185`/`:151-152`/`:183` ✓ | 复核准确 | 判词正确 |
| `CollapseExpandDocCommentsHandler` | `src/editorFolding.ts:197`（`isDocCommentLine`）、`:204`（`docCommentRanges`）、`:780-781`（两条命令）；判据 `tests/editor-folding.test.mjs:67`/`:78`/`:91` | 判决只写符号名不写行号（`:780-781` 现值） | 判词正确 |
| `DocumentFoldingInfo` | `src/editorFoldingState.ts:161`（`captureFoldState`）、`:205-228`（`restorePlan`）✓、`:151-154`（`signatureAt`）✓、`native/folding_state_schema.cpp` ✓ | 本仓侧坐标 ✓；上游 `computeExpandRanges:146-164`（实际签名在 `:128`）、`writeExternal/readExternal :260-368`（实际 `:260`/`:297`）需复核（见 §4） | 待 §4 定性 |
| `EditorFoldingInfo` | `src/editorFolding.ts:243`（`FoldArea.auto`）✓、`:430-442`（`autoAreas`）、`:445-452`（`areasOf`）、`:721-740`（`foldSelectionOutcome`）、`:811-814`（`toggleFoldSelection`）、`:509`（`perCaret`）、`:496`（`candidatesOf`）、`src/editorCommands.ts:277`（`fold.selection`） | 判决写 `:414-426`/`:429-436`/`:700-719`/`:790-793`/`:493-501`/`:480`/`:271` ✗ 全部过期 | 档位对，坐标要改 |
| `FoldingPolicy` | `src/editorFolding.ts:620-633`（`foldKinds`）、`src/editorFoldingSettings.ts:49-54`/`:57-59` ✓、`src/editorFoldingState.ts:151-154`/`:205-228` ✓、`src/editorFoldingController.ts:82-95`/`:101` ✓ | `:599-612` ✗ 过期；其余 ✓ | 档位对，坐标要改 |
| `FoldingUpdate` | `src/components/CodeEditor.vue:1010` ✓、`src/editorFolding.ts:123-133`（`mergeFoldRanges`）✓ | 符号名口径 | 判词正确 |
| `UpdateFoldRegionsOperation` | `src/editorFolding.ts:834-838`（`unfoldIntersecting`）、`src/editorFoldingController.ts:126`/`:82-95`/`:50`/`:169` ✓、`src/editorFoldingState.ts:241-243`（`caretInsideRange`）✓ | `:813` ✗ 过期；上游 `caretInsideRange:236-238` ✗ 实为 `:234-236` | 档位对，坐标要改 |
| `BaseFoldingHandler` | `src/editorFolding.ts:666-670`（`selectionScoped`）、`:680`（`foldAllCommand`）、`:697`（`unfoldAllCommand`） | `:645`/`:659`/`:676` ✗ 过期 | 档位对，坐标要改 |
| `CollapseAllRegionsAction` | `src/editorFolding.ts:680-694` → `:682` 调 `selectionScoped`（`:666`） | `:659`/`:645` ✗ | 档位对，坐标要改 |
| `ExpandAllRegionsAction` | `src/editorFolding.ts:697-701` → `:700` 调 `selectionScoped`（`:666`） | `:676`/`:645` ✗ | 档位对，坐标要改 |
| `CollapseRegionAction` | `src/editorFolding.ts:281-285`（`collapseTarget`）✓、`:522-525`（`foldAtCaret`）、`:509-517`（`perCaret`）、`:268-271`/`:274-278` ✓、判据 `tests/editor-folding.test.mjs:164`/`:147`/`:158`/`:535` | `:505-509`/`:493-501` ✗；测试 `:163`/`:146`/`:157`/`:404` ✗（各差 1–131 行） | 档位对，坐标要改 |
| `ExpandRegionAction` | `src/editorFolding.ts:288-296`（`expandTarget`）✓、`:258-260`（`isCollapsedIn`）✓、`:528-531`（`unfoldAtCaret`）、判据 `tests/editor-folding.test.mjs:173` | `:511-515` ✗、测试 `:172`/`:404` ✗ | 档位对，坐标要改 |
| `ExpandToLevel1..5`（5 行） | `src/editorFolding.ts:784-794` ✓、`:162-165` ✓、`:221-232` ✓、`:788` ✓、`src/foldingKeymap.ts:50-54` ✓、`src/components/CodeEditor.vue:882` ✓、`src/editorCommands.ts:292`（`foldingKeymap` 导出）、判据 `tests/editor-folding.test.mjs:437` | 命令表 `:277-281` → 现 `:278-282`、`foldingKeymap` `:291-295` → 现 `:292-296` ✗；**判决写"菜单那五条 `keys` 传空串"已过期**：`src/menus/codeMenu.ts:97-101` 现在传 `chordKeys('unfold.levelN')` | 档位对，两处坐标要改 + 一处遗留已清 |
| `CollapseBlockHandlerImpl`（见 §2） | —— | —— | —— |

## 2. `[~]` 行逐条复核（18 行）

### 2.1 `CodeFoldingSettings` / `CodeFoldingSettingsImpl` ⇒ **该升档 `[x]`**
上游 `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java` 实开全文 16 行：
五个 boolean（`:7` IMPORTS=true、`:8` METHODS、`:9` FILE_HEADER=true、`:10` DOC_COMMENTS、`:11` CUSTOM_FOLDING_REGIONS）
+ `:13 getInstance()`，**没有别的成员**；`CodeFoldingSettingsImpl.java` 27 行，`@State/@Storage` 在 `:11`。
本仓两键全落：`src/editorFoldingSettings.ts:41-42`（两行设置项）+ `:49-54`（`autoCollapseKinds`）+ `:57-59`（`kindOfSetting`）、
`native/settings_schema.hpp:18`（`EDITOR_SETTING_KEYS` 含 `collapseImports`/`collapseCustomRegions`）、设置页
`src/components/CodeFoldingSettingsPage.vue`（`src/menus/codeMenu.ts` 之外，判据 `tests/editor-folding-settings.test.mjs:18`/`:23`/`:34`/`:44`）。
判决自己已把另外三键写成 `[-]`-类（语言侧 builder 独占，`JavaCodeFoldingSettingsBase.java:67/106/116` 实开复核 ✓、
`LspFoldingBuilder.kt:41-46` ✓：`Imports→COLLAPSE_IMPORTS`、`Region→COLLAPSE_CUSTOM_FOLDING_REGIONS`、`Comment→null`、`else→null`）。
⇒ 该行**已无 `[~]` 的剩余面**：可移植的都落了、不可移植的已判 `[-]`。与 `FoldingPolicy` 行升 `[x]` 的口径完全同一。
`CodeFoldingSettingsImpl` 同理（判决写"档位维持 `[~]`（fold3 R-7 已定）"，但 R-7 之后已经把三键改判 `[-]`，那个 `[~]` 的理由已经没了）。

### 2.2 `FoldingUtil` ⇒ **该升档 `[x]`**
上游 `platform/platform-impl/src/com/intellij/codeInsight/folding/impl/FoldingUtil.java` 120 行，
公开面恰好 6 个（实测行号）：`findFoldRegion:23`、`findFoldRegionStartingAtLine:28`、`getFoldRegionsAtOffset:46`、
`isHighlighterFolded:60`、`isTextRangeFolded:69`、`createFoldTreeIterator:77`。
判决行给前五（除 `isHighlighterFolded`）都指了落点、`isHighlighterFolded` 改判 `[-]` ⇒ 六个函数**没有一个还挂着缺口**，
与 `FoldingPolicy` 行"原判的两处缺都不是缺口 ⇒ 升 `[x]`"是同一套推理。坐标本身（`:23-27`/`:28-44`/`:46-58`/`:69-72`/`:77-119`）复核准确。

### 2.3 `CollapseBlockHandlerImpl` ⇒ **该升档 `[x]`（缺口已在盘上闭合）**
判决登记的真缺口是"折外层时没撤里层那条用户自建折痕"（上游 `CollapseBlockHandlerImpl.java:50` 记 `myPrevious`、
`:58-61` 与 `:66-71` 两处 `removeRegion`+`removeFoldRegion`）—— 三处坐标实开复核**都准**。
磁盘现状：`src/editorFolding.ts:344` 的 `BlockFoldPlan` 已带 `remove: readonly FoldArea[]`，
`:350-361` 的 `blockFoldPlan` 用 `swallowed`（`auto === false` 的手工折痕，`covers` 且非 `boundsEqual`）算 `remove`，
`:578-579` 把 `userFolds` 喂进去、`:582` 执行 `applyAreas(view, plan.remove, false)`。
`git show HEAD:src/editorFolding.ts:334` 的 `BlockFoldPlan` **还没有 `remove`** ⇒ 这是 15:30 之后落的（工作区未提交）。
判据：`tests/editor-folding.test.mjs:241`（正档进 remove）、`:249`（反档不撤）、`:257`（settle 在 previous 那一支也撤）、
`:328`（端到端只剩外层一条）、`:342`（里层是服务端区间 ⇒ 不撤）—— 五条新判据，全绿（§5）。
⇒ 该行剩下的只有"上游按语言注册 `CollapseBlockHandler` EP"，而判决自己已把它写成 `[-]`-类 ⇒ `[x]`。

### 2.4 `CollapseSelectionHandler` ⇒ **判词正确（`[~]` 该留）**，但坐标过期 + 漏记一个已落符号
缺口仍在：`src/editorFolding.ts:707` 的 `CANNOT_REMOVE_AUTOGENERATED_REGION`（判决写 `:686`）
与 `src/editorFolding.ts:753-777` 的 `collapseSelectionAfterOverlapConfirm` **都零生产消费方** ——
`grep -rn` 全仓只命中 `tests/folding-selection-scope.test.mjs:24`/`:125` 与 `tests/folding-selection-overlap.test.mjs:24` 等测试；
宿主 `src/components/CodeEditor.vue` 只用 `showErrorHint` 于 `:491`（no-errors）与 `:917`（自定义折叠区域空列表），折叠这两档没接。
上游坐标实开复核：hint 在 `CollapseSelectionHandler.java:44`（`HintManager.showInformationHint`）✓、
确认框 `:49-58`（`Messages.showDialog(..., 1, ...) != 0` ⇒ 默认按钮是「取消」）✓、`:39`/`:79` 两处 `getPsiElement == null` ✓。
**判决簿漏记**：`collapseSelectionAfterOverlapConfirm`（"点了确定之后"那一半已实现并有 6 条判据）——
`[~]` 剩下的实际只有"宿主弹层/hint 的接线请求"，措辞该更新。

### 2.5 `BaseExpandToLevelAction` ⇒ **该升档 `[x]`**
上游 `BaseExpandToLevelAction.java` 80 行实开：`canRun`/根挑选 `:30-41`（`:38-40` = `rootRegion == null ⇒ return`，判决引得很准）、
`rootLevel` 初始化 `:43`、循环 `:45-72`（`setExpanded(true)` `:65` / `setExpanded(false)` `:68`）、`isChild:77-79`。
本仓 `src/editorFolding.ts:221-232`（`levelPlan`，含 `:222` 的 root 深度、`:223` 的 scope = 根 + `nestedWithin`、
`:228-229` 的浅→展开 / 正→折起）+ `:162-165`（`rootAtLine` = `:30-41` 的等价物）+ `:168-170`（`nestedWithin` = `isChild`）。
该行**没有写明任何剩余缺口**，且它的两个子类行现在一档 `[x]`（caret 族）一档 `[~]`（all 族，只因 chord 不可能）——
基类不含任何键位面 ⇒ 与 `CodeFoldingPassFactory`/`CodeFoldingPass` 同口径，不该一档 `[x]` 一档 `[~]`。

### 2.6 六条"纯转发"动作行：`CollapseBlockAction` / `CollapseDocCommentsAction` / `ExpandDocCommentsAction` /
### `CollapseRegionRecursivelyAction` / `ExpandRegionRecursivelyAction` / `ExpandCollapseToggleAction` ⇒ **该升档 `[x]`**
上游实开：`CollapseDocCommentsAction.java` 16 行、`ExpandDocCommentsAction.java` 16 行（通体 `return new CollapseExpandDocCommentsHandler(false/true)`，
而它们的 handler 行已是 `[x]`）；`CollapseRegionRecursivelyAction.java` 30 行、`ExpandRegionRecursivelyAction.java` 29 行
（`super(new BaseFoldingHandler(){...})`，`BaseFoldingHandler` 行已 `[x]`）；`ExpandCollapseToggleAction.kt` 34 行
（`:17-25` = 起始行优先、否则 `getFoldRegionsAtOffset(...).first()`，判决引的 `:17-25` ✓ 精确）；
`CollapseBlockAction.java` 58 行（EP 取 handler 那一段判决已判 `[-]`-类，行为半边 = `CollapseBlockHandlerImpl` 行，§2.3 已闭合）。
本仓出口逐条在盘：`src/editorFolding.ts:534-537`（`foldRecursively`）、`:540-543`（`unfoldRecursively`）、
`:308-314`（`recursiveScope` ↔ `BaseFoldingHandler:61-86` ✓）、`:780-781`（docs 两条命令）、`:546-551`（`toggleFoldAtCaret`）、
`:299-301`（`toggleTarget`）、`:559-587`（`foldBlockAtCaret`）；键位面见 §A 行（`$default.xml` 复核 ✓）；菜单位在
`src/menus/codeMenu.ts:77-121`（漂移见 §3）。⇒ 六行都"没有自己的剩余缺口"。
**唯一要留意的口径**：`CollapseSelectionAction`（下一条）不在此列。

### 2.7 `CollapseSelectionAction` ⇒ **判词正确（`[~]` 该留，但理由要重写）**
本行自己的面（命令 `src/editorCommands.ts:277`、键位 `Ctrl+.` = 上游 `$default.xml:1036`（实开：`:1036` action id、`:1037` shortcut `control PERIOD`）、
菜单 `src/menus/codeMenu.ts:120`）都在。但它的**用户可见行为仍与上游不等价**：命中自动区域时上游弹 hint、
本仓静默不动；搭界时上游弹确认框、本仓直接按取消。这不是"`[-]`-类事实"，是真缺（`CollapseSelectionHandler` 行同一条），
且 `src/editorFolding.ts:576` 的注释里"没有编辑器内模态宿主"那句已被 `src/editorHint.ts` + `CodeEditor.vue:109` 证伪。
⇒ 档位不动，判决簿该行那句"宿主侧的限制记在 …"要改成明确写出缺的是哪一面。

### 2.8 `ExpandAllToLevel1..5`（5 行）⇒ **判词正确（`[~]` 该留）**，只有本仓坐标要改
机理链逐条实测复核（判决的论证本身站得住，这是本域写得最扎实的五行）：
`node_modules/w3c-keyname/index.js:28`（`106: "*"`）、`:99`（`for (var code in base) if (!shift.hasOwnProperty(code)) shift[code] = base[code]`）
⇒ `base[106] === shift[106] === '*'`；`node_modules/@codemirror/view/dist/index.js:9106`（`function modifiers(name, event, shift)`）、
`:9251`（`modifiers(name, event, !isChar)` 首查摘 Shift）、`:9269`（Shift 回退那次查表，被前缀那次 handled 挡在前面）、
`:9164`（`key.split(/ (?!$)/)`）、`:9165-9179`（前缀 handler）、`:9222-9228`（第二段按 `storedPrefix.prefix` 拼）、
`:9154-9160`（`checkPrefix`，同一键名不能同当普通绑定与前缀）—— **九处坐标全部复核为真**。
磁盘现状：`src/foldingKeymap.ts:49-55` 只绑 caret 族（`:39` 明写理由）、`src/editorCommands.ts:278-282` 是十条命令、
`:292-296` 是 `foldingKeymap`、`src/components/CodeEditor.vue:882` 常驻 keymap ✓、判据 `tests/editor-folding.test.mjs:437-466`（caret 族）
与 `:474-489`（`Ctrl+Shift+* 3` 落 `unfold.level3`）✓ 精确。
⇒ 五行的本仓坐标里 `src/menus/codeMenu.ts:75-83` 与 `src/editorCommands.ts:277-281`/`:291-295` 已过期（§8 C 组），**档位与结论不动**。

## 3. §A / §C 叙述段的坐标复核

§A 的**键位表**与**上游坐标**（`$default.xml`、`LangActions.xml:270-303`、`ActionsBundle.properties:623-654`、各 `*Action.java:行号`）
**全部复核为真**（见 §4）。问题集中在三处叙述：

1. §A 第 3 行说 `src/editorCommands.ts` 装了"折叠族的**全部** 15 条命令"。实测命令表里折叠族是 **21 条**
   （`src/editorCommands.ts:272` 四条 + `:275` 两条 + `:276` 两条 + `:277` 三条 + `:278-282` 十条），
   另有 `:241` 的 `fold.surroundRegion`（自定义区域族，不属上游这一族）。"15"是 level 族十条进表之前的数字。
2. §A 第 6 行说弹层 `FoldingGroup`"成员与 Code 菜单同源，**13 条**"。实测
   `src/menus/editorPopupMenu.ts:56-57` 是 **11 条**（`unfold`/`unfold.recursively`/`unfoldAll`/`fold`/`fold.recursively`/`foldAll`/
   `unfold.docs`/`fold.docs`/`fold.toggle`/`fold.selection`/`fold.block`），被 `tests/editor-popup-menu.test.mjs:47-49` 与 `:99`
   （`折叠 11`）钉死；`:44-46` 写明原因：本仓 popup 的成员表是平的，两组嵌套 popup（上游 `LangActions.xml:279-292`）
   只在 Code 菜单里给。Code 菜单那侧才是 13 条（`src/menus/codeMenu.ts:77-122`：11 个动作行 + 2 个子菜单）✓。
   ⇒ 上游把同一个 `FoldingGroup` 也挂进了编辑器右键那族菜单（`LangActions.xml:576` 的 `<reference ref="FoldingGroup"/>`，
   它所在的那组经 `:578` 的 `<add-to-group group-id="EditorPopupMenu1"/>` 并进入口），所以**弹层确实少了两个"到级别"入口**，
   但这不是判词写错档位（§G 没有这一行，`FoldingGroup` 不在这 69 类里），是 §A 那句"13 条"要改。
3. §C① / §C⑤ / §A 各行的本仓坐标整体过期（`src/editorFolding.ts:700-719` → `:721-740`、`:686` → `:707`、`:645` → `:666`、
   `:813` → `:834`），见 §8 C 组。`src/editorHint.ts:29`（`createHintController`）、`src/confirmations/exitConfirmation.ts` +
   `processClose.ts`、`src/components/CodeEditor.vue:109`/`:491`/`:917` 三处**复核为真**（§C① 那句 V5 订正是对的）。

## 4. 上游坐标抽核（判决簿引用的上游侧，逐条实开）

| 判决簿引的坐标 | 实开结果 |
|---|---|
| `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java:7-11`（五键 + 默认值） | ✓ 全文 16 行，`:7` IMPORTS=true、`:8` METHODS、`:9` FILE_HEADER=true、`:10` DOC_COMMENTS、`:11` CUSTOM_FOLDING_REGIONS，除 `:13 getInstance()` 外没有别的成员 |
| `platform/editor-ui-ex/.../CodeFoldingSettingsImpl.java:11`（`@State`/`@Storage("editor.xml")`） | ✓ 27 行文件，`@State` 那一行就是 `:11` |
| `java/java-psi-impl/.../JavaCodeFoldingSettingsBase.java:67/106/116` | ✓ 三处 `return CodeFoldingSettings.getInstance().COLLAPSE_METHODS / DOC_COMMENTS / FILE_HEADER` 分别就在 `:67`/`:106`/`:116`（setter 在 `:72`/`:111`/`:121`） |
| `platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:41-46`、`:51` | ✓ `Imports→COLLAPSE_IMPORTS`、`Region→COLLAPSE_CUSTOM_FOLDING_REGIONS`、`Comment→null`（原话 "LSP/IJ semantic mismatch"）、`else→null`；`collapsedText` 在 `:51` |
| `platform/foldings/.../CodeFoldingManager.java:29/31/33/35/38/44/46-58` | ✓ 除 `:46-58`：**本类的 `getFoldRegionsAtOffset` 在 `:33`**，`:46-58` 那一段是 `buildInitialFoldings` 附近；`FoldingUtil.getFoldRegionsAtOffset` 才是 `:46-58` ⇒ 判决行把两个类的同名函数坐标串到了一起 |
| `platform/foldings/.../impl/CodeFoldingNecromancer.kt:44-52`/`:54-56`/`:58-60` | ✓ 151 行文件，类声明 `:44`、`enoughMana` `:54`、`isZombieFriendly` `:58` + `Registry.is("cache.folding.model.on.disk", true)` `:59`（V1 那笔订正成立） |
| `platform/foldings/.../impl/CodeFoldingNecromancy.kt:9-11`/`:13-22`/`:24-43` | ✓ 44 行 object，`formZombie:9`、`Out.writeLimb:13`、`In.readLimb:24` |
| `platform/foldings/.../impl/EditorFoldingInfo.java:29`/`:44-51`/`:67-69`/`:71-73` | ✓ 85 行，`Map<FoldRegion, SmartPsiElementPointer<?>>` 就在 `:29` |
| `platform/foldings/.../impl/FoldingPolicy.java:25-33`/`:35-42`/`:44-50`/`:52-72`/`:61`/`:65-67`/`:69`/`:72`/`EP_NAME:18` | ✓ 74 行，全部逐条对上（这批订正是准的） |
| `platform/foldings/.../impl/CollapseBlockHandlerImpl.java:50`/`:58-61`/`:66-71` | ✓ 87 行，`:50` 记 `myPrevious`、`:58-60` 移除、`:68-70` 那一支同样移除 |
| `platform/foldings/.../impl/CollapseSelectionHandler.java:39`/`:44`/`:49-58`/`:79` | ✓ 101 行，`:44` = `HintManager.showInformationHint(...autogenerated.region)`、`:49-56` = `Messages.showDialog(..., 1, ...) != 0 ⇒ return`（默认按钮「取消」） |
| `platform/foldings/.../impl/DocumentFoldingInfo.java:128`/`:146-164`/`:198`/`:260`/`:297`/`:314-341`/`:322-324`/`:326-335`/`:333` | ✓ 424 行。`computeExpandRanges` 的签名在 `:128`、判决引的"按签名找回那一段" `:146-164` 精确（`restoreBySignature:149`、`result.add:163`）；时间戳闸 `:326-335`（`:333` 叠 `isDocumentUnsaved`）只在 `MARKER_TAG` 那一支 ✓ |
| `platform/foldings/.../impl/UpdateFoldRegionsOperation.java:47`/`:143`/`:162`/`:236-238`/`shouldExpandNewRegion:236-253` | ✗ **两处偏**：`caretInsideRange` 实为 **`:234-236`**（判决写 `:236-238`），`shouldExpandNewRegion` 实为 **`:238-255`**（判决写 `:236-253`；`tests/folding-navigate-unfold.test.mjs:139` 标题写的 `:243-255` 是对的）。`:47`（`enum ApplyDefaultStateMode { YES, EXCEPT_CARET_REGION, NO }`）/`:143`/`:162` ✓ |
| `platform/foldings/.../impl/FoldingUpdate.java:154-156` | ✓ 就在 `:154-155`（`applyDefaultState ? EXCEPT_CARET_REGION : NO`）；`ApplyDefaultStateMode.YES` 全树 grep（`--include=*.java --include=*.kt`）**零命中** ⇒ 判决那句"社区树里零调用方"成立 |
| `platform/foldings/.../impl/CodeFoldingPassFactory.java:17-19`/`:22-24` | ✓ 25 行文件，`:18` 注册 pass（`Pass.UPDATE_FOLDING`）、`:23` `return new CodeFoldingPass(...)` |
| `platform/foldings/.../actions/BaseFoldingHandler.java:37-39`/`:44-56`/`:61-86` | ✓ 87 行，`:38` 就是 `return editor.getProject() != null;`（V4 那句成立） |
| `.../BaseExpandToLevelAction.java:38-40`/`:43-70` | ✓ 80 行，`:38-40` 认不出根就 return、`:43` `root == null ? 1 : -1`、`:65`/`:68` 两支 `setExpanded` |
| `.../CollapseRegionAction.java:19-25`/`:26-38`、`ExpandRegionAction.java:43-55` | ✓ 46 / 61 行，**全文零 PSI**（V4 成立） |
| `.../CollapseAllRegionsAction.java:35-38`、`ExpandAllRegionsAction.java:70-75`/`:77-81`、`FoldingBuilder.java:65-70` | ✓ 39 / 82 行；`collapseInFirstStep:35-36`、第二步 `:70-75`、`expandInFirstStep:78-80` |
| `.../ExpandCollapseToggleAction.kt:17-25` | ✓ 34 行，`:17` 起始行、`:23-25` `getFoldRegionsAtOffset(...).first()` |
| `.../CollapseBlockAction.java:29-46`（`:38` `allForLanguage`） | ✓ 58 行，EP 取 handler 就在 `:38` |
| `platform/platform-impl/src/com/intellij/codeInsight/folding/impl/FoldingUtil.java:23-27`/`:28-44`/`:46-58`/`:60-67`/`:69-72`/`:77-119` | ✓ 120 行，六个公开成员恰好落在这六段（`isTextRangeFolded:69`、`createFoldTreeIterator:77`） |
| `platform/platform-resources/src/keymaps/$default.xml:385-404`/`:405-424`（每条 386/387、390/391、394/395、398/399、402/403 与 406/407、410/411、414/415、418/419、422/423）、`:1036-1038` | ✓ 全部逐条对上（含"每级两条：数字 + NUMPAD"那句）。**顺带**：`src/foldingKeymap.ts:46` 与 `tests/editor-folding.test.mjs:437` 的标题写的是 `:385-403`，比判决少一行的尾界，属代码侧注释的小漂移（不越界、机检不拦） |
| `platform/platform-impl/resources/idea/LangActions.xml:270-303`、`ActionsBundle.properties:621-654`（`:623-627` = `_1.._5`、`:629-633` = all 族） | ✓ 组本体 `:270-303`，两个子组 `:279-285`/`:286-292`，`EditorPopupMenu` 的引用在 **`:576`**（判决没引这条，`src/menus/editorPopupMenu.ts:16` 写的是 `:567` ⇒ 复核为真，`EditorPopupMenu.GoTo` 那个 popup 就在 `:567`；FoldingGroup 的引用在 `:576`，它所在的那组经 `:578` 的 `<add-to-group group-id="EditorPopupMenu1"/>` 并进编辑器右键那族菜单） |
| `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/configurable/StickyLinesConfigurableUI.kt:40` | ✓ `intTextField(UINumericRange(5, 1, 20).asRange())` 就在 `:40`（stickyfold 那格核得准） |
| `platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java`（249 行） | 在盘但**不在本域 69 类之内**（路径不含 `/com/intellij/codeInsight/folding/`）；`NetBeansCustomFoldingProvider.java` 在 `platform/lang-impl/src/com/intellij/lang/customFolding/`。⇒ 自定义折叠族归 `platform_rest` 域的 `lp/custom-folding`，不是本判决的漏项 |

**`docs/inventory/folding.txt` 覆盖率独立复核**：上游按 `/com/intellij/codeInsight/folding/` 扫出 72 个 `.java`/`.kt`，
`folding.txt` 69 行 ⇒ 差的三条是 `platform/lang-impl/testSources/.../FoldingUtilTest.java`、
`platform/testFramework/src/.../AbstractFoldingPolicyTest.java`、`platform/testFramework/src/.../AbstractPsiNamesElementSignatureProviderTest.java`
—— 都是测试类，按判决规则（"非测试类"）正当排除；反向差集为**空**（`folding.txt` 没有死路径）。⇒ §F 门 1 成立。

**§4 表里的省略写法 → 完整路径**（ledgerfix 直接照这条填表；上游根 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：

- `.../BaseExpandToLevelAction.java` / `.../actions/BaseExpandToLevelAction.java`
  = `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/BaseExpandToLevelAction.java`
- `.../CollapseRegionAction.java` = `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseRegionAction.java`
- `.../CollapseAllRegionsAction.java` = `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseAllRegionsAction.java`
- `.../ExpandCollapseToggleAction.kt` / `.../actions/ExpandCollapseToggleAction.kt`
  = `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/ExpandCollapseToggleAction.kt`
- `.../CollapseBlockAction.java` = `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseBlockAction.java`
- `.../CollapseSelectionAction.java` = `platform/foldings/src/com/intellij/codeInsight/folding/impl/actions/CollapseSelectionAction.java`

## 5. 门禁原始数字（只读跑，未 `git add`、未跑 `--anchors=update`）

| 命令 | 原始结果 |
|---|---|
| `node --test tests/folding*.test.mjs tests/sticky*.test.mjs tests/editor-folding*.test.mjs tests/custom-folding*.test.mjs tests/module-size.test.mjs` | **tests 165 / suites 0 / pass 165 / fail 0 / cancelled 0 / skipped 0**（4921 ms） |
| `node --test tests/source-citations.test.mjs` | tests 3 / pass 2 / **fail 1** —— 唯一违规是 `docs/batch-2026-10-06-sizememcheck.md` 里一条指向 `ConsoleViewImpl.kt` 的引用被写成六位占位行号 ⇒ 门判「行号超出文件长度」。**不是本域**（别的 lane 的文档在飞）。这里故意不复现那条「路径:行号」完整形状：抄进本报告就会被同一道门当成本报告的一条 live 引用（`docs/batch-2026-10-06-searchdiff.md` §6.1 已把这条规则连门的自检用例一起核过）。顺带一条数据：这道门实测该文件是 **1730 行**（`split('\n').length` 口径），`wc -l` 是 1729 ⇒ 写行号一律 ≤ 1729。**第二跑（本报告 §6-§8 落盘之后）：tests 3 / pass 3 / fail 0** —— 那条已被它自己的 lane 收掉，同时说明**本报告里每一条带完整路径的上游坐标都过了这道门**（门扫 `src`/`native`/`docs` 三处） |
| `python scripts/verdict_table.py --check` | 不一致 4 / 7 条产物：`execution_verdict_table.json`、`xdebugger_verdict_table.json`、`verdict-xdebugger.md`、`verdict-execution-debug.md`。**都不是 folding** —— 且 `verdict-folding.md` 本来就不在这 7 条生成物里（`scripts/verdict_table.py` 只在 `lp/custom-folding`/`ls/features` 两族的文案里提到 `src/editorFolding.ts`，见 §7 的 S-4） |
| `node --test tests/b4-verdict.test.mjs`（本判决自己的门） | tests 6 / **pass 6 / fail 0**。门 4 的硬编码在 `tests/b4-verdict.test.mjs:110-113`（`[x]` 22 / `[~]` 18 / `[ ]` 0 / `[-]` 29）—— 若按 §8 执行升档，这四个数与表尾那句必须同批改，否则这道门红 |

**收尾复跑（本报告写完之后，同一台机器）**：

- `node --test tests/b4-verdict.test.mjs tests/source-citations.test.mjs` → tests 9 / **pass 9 / fail 0**（两跑之间那条 `ConsoleViewImpl.kt` 已被它自己的 lane 收掉，见上面第二跑）。
- `node --test tests/module-size.test.mjs` → tests 5 / pass 4 / **fail 1**：`native/history.cpp 现在 935 行 > 上限 910`。
  **不是本域**（本地历史那条 lane 在飞；同一道门在本 lane 第一次跑（16:5x，165/165 全绿）时还是绿的 ⇒ 是这两三十分钟里长出来的）。
  按禁则只登记不修。
- **自核**：把本报告的每一条 `路径:行号` 用同一套办法扫了一遍 —— 189 条，全部**在盘且行号在范围内**
  （其中 14 条在 §4 的表里用了 `platform/foldings/.../impl/Xxx.java:NN` 这种省略写法，是为了表格宽度；
  引用门只收完整路径，所以那 14 条不会被门收，但每条的完整路径都在同一张表的另一列里出现过一次）。


## 6. 判词落后于代码的实例（本域新增 5 例）

1. **`CollapseBlockHandlerImpl` 的"真缺口"已经落盘**。判决 §G 那行写"本仓 `blockFoldPlan` 原样留着里层折痕，
   连按两次 `Ctrl+Shift+.` 得到套娃两条而 IDEA 只给一层"。磁盘现状：`src/editorFolding.ts:344` 的
   `BlockFoldPlan` 带 `remove`、`:350-361` 按 `swallowed`（`auto === false` 且被落点整条含住）算出要撤的里层折痕、
   `:578-579`+`:582` 在 `foldBlockAtCaret` 里真的撤。`git show HEAD:src/editorFolding.ts` 的第 334 行**还没有这个字段**
   ⇒ 落在 15:30 之后（`docs/batch-2026-10-06-foldchord.md:11-25` 认领了这一改动，正是 foldverdict 报告表二 T1 那条"要动 `src/`、本批禁止"的欠账）。
   判据五条：`tests/editor-folding.test.mjs:241`/`:249`/`:257`/`:328`/`:342`，全绿。
2. **caret 族五条菜单行已经印键位**。判决（`ExpandToLevel1..5Action` 五行 + 第五批末尾"如实登记两处遗留"）写
   "`src/menus/codeMenu.ts:68-72` 的 `keys` 列仍传空串 ⇒ 键位可用而菜单不印"。磁盘现状：`src/menus/codeMenu.ts:97-101`
   传的是 `chordKeys('unfold.levelN')`，而 `chordKeys()` 在 `:47-48` 从 `foldingLevelChords` 那张权威表推导（`:89` 注释："不在菜单里手抄"），
   判据 `tests/menukeys-probe.test.mjs`（`src/menus/codeMenu.ts:94` 指它）。⇒ 这条"遗留"已清；
   另一半（上游子菜单会不会反推显示 chord）判决自己写了**无法核实**，本 lane 也没开 `ActionPresentation` 那条链 ⇒ 维持无法核实。
3. **六个"纯转发"动作行 + 基类行还挂着 `[~]`**（`CollapseBlockAction`/`CollapseDocCommentsAction`/`ExpandDocCommentsAction`/
   `CollapseRegionRecursivelyAction`/`ExpandRegionRecursivelyAction`/`ExpandCollapseToggleAction`/`BaseExpandToLevelAction`）。
   上游这几个类本体 16-58 行、通体是 handler 转发（§4 逐条实开），而它们各自指向的 handler 行
   （`CollapseExpandDocCommentsHandler` `[x]`、`BaseFoldingHandler` `[x]`、`CollapseBlockHandlerImpl` 见本节第 1 条）都已经是 `[x]`；
   本仓的命令、键位、菜单、行为四个面也都在盘上。⇒ 典型的"按英文类名在本仓搜不到同名对象 ⇒ 留 `[~]`"，
   与 foldverdict 自己升 `CodeFoldingPassFactory` 的理由（"工厂与 pass 说的是同一件事，不该一档 `[x]` 一档 `[~]`"）同形。
4. **两条设置行（`CodeFoldingSettings`/`CodeFoldingSettingsImpl`）的 `[~]` 已经没有承载物**：三键改判 `[-]` 之后，
   这俩行剩下的只有"两键全落"（§2.1）—— 判决却仍写"档位维持 `[~]`（fold3 R-7 已定）"，把一个已经消化掉的结论当挡箭牌。
5. **`collapseSelectionAfterOverlapConfirm` 从没进过判决簿**：`src/editorFolding.ts:753-777`（HEAD 里就在 `:732`），
   六条判据在 `tests/folding-selection-overlap.test.mjs:66`/`:77`/`:86`/`:107`/`:116`/`:123`。
   §G 的 `CollapseSelectionHandler` 行只写"重叠确认框……按上游的默认结果处理（视为「取消」）"，读起来像"点了确定也没有下一步"，
   实际"确定那一步"已经实现且行为对上游 —— **缺的只是宿主那个确认框本身**。

## 7. 建议实现（今天就能落；本 lane 不动码）

| 编号 | 建议 | 落点（实测） | 归属/状态 |
|---|---|---|---|
| S-1 | 编辑器右键的 `FoldingGroup` 补两个"到级别"子组（上游那两个子组 `LangActions.xml:279-292` 就在 `FoldingGroup` 里，而 `:576` 的 `<reference ref="FoldingGroup"/>` 经 `:578` 并进编辑器右键那族 ⇒ 上游右键能摸到"展开到级别"，本仓右键摸不到） | `src/menus/editorPopupMenu.ts:56-57`（成员表加两组，需让 popup 成员表支持嵌套）+ 同批改判据 `tests/editor-popup-menu.test.mjs:44-49`（`11 条`）与 `:99`（`折叠 11`）| **不在他人在飞**；`editorPopupMenu.ts` 不在保留名单（保留 = `App.vue`/`CodeEditor.vue`/`style.css`/`tokens.css`/`uiIcons.ts`/`settingsModel.ts`/`settingsTreeMeta.ts`，见 `docs/agent-playbook-parity.md:37-40`）。判决 §A 第 6 行那句"13 条"要么改成"11 条 + 少两组的原因"，要么等这条落地后不用改 |
| S-2 | `blockAt` 死导出（零生产消费方，只有测试在用）| `src/editorFolding.ts:180-182`；命中点现为 `tests/editor-folding.test.mjs:14`/`:56-58`/`:273-274` | foldverdict 报告已写"顺带处理"，仍未处理 |
| S-3 | `stickyLinesLimit` 的校验从 `0..10` 放宽到设置页档 `1..20`（上游 `StickyLinesConfigurableUI.kt:40` 的 `UINumericRange(5, 1, 20)`，本 lane 实开复核 ✓；本仓真源已经在 `src/stickyLines.ts:85`（`STICKY_LINES_LIMIT_MAX = 20`），但校验三处仍停在 10）| `native/settings_schema.cpp:123-126` 与 `:238-240`（两句 `must be an integer between 0 and 10`）、`src/previewSettings.ts:70`（`> 10` 判坏）、`src/components/SettingsDialog.vue:910`（`min="0" max="10"`）；回归面 `native/projects_test.cpp:464`（`{{"stickyLinesLimit", 11}}` 现在是**期望被拒**的用例，放宽后它要改）+ `tests/sticky-tier-scroll.test.mjs:22-25`（判据标题已经写着"本仓三处校验停在 10 ⇒ 差 10 档"）| **已登记**：`docs/wiring-requests-2026-10-06-stickyfold.md` R-1。本 lane 只复核并确认那三处位置，不重复实现。改范围属"持久化设置变更"：旧值 1..10 必须照旧接受 |
| S-4 | `scripts/verdict_table.py` 的 `lp/custom-folding` 文案里两处本仓坐标过期 | `src/customFoldingSurround.ts:57-112` ⇒ `surroundWithRegion` 的签名实测在 **`:79`**（`:58` 现在是 `snapToLines`；该文件 15:40 长了 99 行）；`src/components/CodeEditor.vue:913-919` ⇒ `Ctrl-Alt-.` 那条绑定实测 `:916-919`（`:913` 是 `moveStatement(true)`）| **ledgerfix 的活**（本 lane 禁改 `scripts/verdict_table.py`）。`src/customFoldingRegions.ts:143`/`:153` 与 `$default.xml:535-537` 复核为准，不用动 |
| S-5 | 折叠选区的 hint / 重叠确认框接进既有宿主通道（`foldSelectionOutcome` 的 `autogenerated`、`overlapping` 两档）| `src/editorFolding.ts:707`（`CANNOT_REMOVE_AUTOGENERATED_REGION`）与 `:753-777`（`collapseSelectionAfterOverlapConfirm`）至今**零生产消费方**（全仓 grep 只命中 `tests/folding-selection-scope.test.mjs:24`/`:125` 与 `tests/folding-selection-overlap.test.mjs:24`）；宿主侧通道在 `src/components/CodeEditor.vue:109`（`createHintController`）/`:491`/`:917` | **已登记**：`docs/wiring-requests-2026-10-06-fold3.md` W-1（保留文件，等主代理）。这一条落不成 ⇒ §8 里 `CollapseSelectionHandler`/`CollapseSelectionAction` 两行的 `[~]` 就不动 |

## 8. 订正表（交付物，四栏：判词档位 → 本仓真实出口 → 上游坐标 → 结论）

### 8.1 档位订正：11 行 `[~]` → `[x]`

| 判词原文档位 | 本仓真实出口（本 lane 打开确认存在） | 上游坐标（本 lane 实开） | 结论 |
|---|---|---|---|
| `CollapseBlockHandlerImpl` `[~]`（"真缺口 = 折外层时没撤里层用户自建折痕"） | `src/editorFolding.ts:344`（`BlockFoldPlan.remove`）、`:350-361`（`blockFoldPlan` 的 `swallowed`/`inside`）、`:578-579`+`:582`（`foldBlockAtCaret` 执行撤除）；判据 `tests/editor-folding.test.mjs:241`/`:249`/`:257`/`:328`/`:342` | `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseBlockHandlerImpl.java:50`、`:58-61`、`:66-71` ✓ | **该升档 `[x]`**（EP 那一半判决自己已判 `[-]`-类） |
| `FoldingUtil` `[~]` | `src/editorFolding.ts:258`（`isCollapsedIn`）、`:268`（`areaStartingAtLine`）、`:274`（`areasContaining`）、`:138`（`depthOf`）、`:221`（`levelPlan`）、`src/editorFoldingState.ts:151`（`signatureAt`） | `platform/platform-impl/src/com/intellij/codeInsight/folding/impl/FoldingUtil.java` 120 行，公开面 `:23`/`:28`/`:46`/`:60`/`:69`/`:77` 六个 —— 除 `isHighlighterFolded`（判决已改 `[-]`）全有落点 | **该升档 `[x]`** |
| `BaseExpandToLevelAction` `[~]`（无写明缺口） | `src/editorFolding.ts:221-232`（`levelPlan`）、`:162-165`（`rootAtLine`）、`:168-170`（`nestedWithin` = `isChild`）、`:784-794`/`:797-803` | `.../actions/BaseExpandToLevelAction.java:38-40`（认不出根就 return）、`:43`（`root == null ? 1 : -1`）、`:45-72`（循环 + `:65`/`:68` 两支 `setExpanded`）、`:77-79`（`isChild`）✓ | **该升档 `[x]`**（子类 caret 族已 `[x]`，基类不含键位面） |
| `CollapseRegionRecursivelyAction` `[~]` | `src/editorFolding.ts:308-314`（`recursiveScope`）、`:534-537`（`foldRecursively`）、`src/editorCommands.ts:275`、`src/menus/codeMenu.ts:83`、键位见 §A 那行 | `.../actions/CollapseRegionRecursivelyAction.java` 30 行，通体 `super(new BaseFoldingHandler(){…})`（`:15`/`:17`）；根挑法 = `.../actions/BaseFoldingHandler.java:61-86` ✓ | **该升档 `[x]`** |
| `ExpandRegionRecursivelyAction` `[~]` | `src/editorFolding.ts:308-314`、`:540-543`（`unfoldRecursively`）、`src/editorCommands.ts:275`、`src/menus/codeMenu.ts:79` | `.../actions/ExpandRegionRecursivelyAction.java` 29 行，同上形状（`:15`/`:17`）✓ | **该升档 `[x]`** |
| `CollapseDocCommentsAction` `[~]` | `src/editorFolding.ts:780`（`foldDocComments`）、`src/editorCommands.ts:277`、`src/menus/codeMenu.ts:116`、判据 `tests/editor-folding.test.mjs:91` | `.../actions/CollapseDocCommentsAction.java` 16 行，`getHandler()` = `return new CollapseExpandDocCommentsHandler(false)`（`:13-14`）—— 该 handler 行已 `[x]` | **该升档 `[x]`** |
| `ExpandDocCommentsAction` `[~]` | `src/editorFolding.ts:781`（`unfoldDocComments`）、`src/editorCommands.ts:277`、`src/menus/codeMenu.ts:115` | `.../actions/ExpandDocCommentsAction.java` 16 行，`return new CollapseExpandDocCommentsHandler(true)`（`:13-14`）✓ | **该升档 `[x]`** |
| `ExpandCollapseToggleAction` `[~]` | `src/editorFolding.ts:299-301`（`toggleTarget`）、`:546-551`（`toggleFoldAtCaret`）、`src/editorCommands.ts:276`、`src/menus/codeMenu.ts:118` | `.../actions/ExpandCollapseToggleAction.kt:17-25`（起始行优先，否则 `getFoldRegionsAtOffset(...).first()`）✓；上游无键位、本仓也无键位 ✓ | **该升档 `[x]`** |
| `CollapseBlockAction` `[~]` | `src/editorFolding.ts:559-587`（`foldBlockAtCaret`）、`:176-178`（`blockRanges`）、`src/editorCommands.ts:276`、`src/menus/codeMenu.ts:121`、判据 `tests/editor-folding.test.mjs:195`/`:204`/`:212`/`:220`/`:300`/`:310` | `.../actions/CollapseBlockAction.java` 58 行；EP 取 handler 在 `:38`（`allForLanguage`）、`:29-46` ✓ ⇒ 判决已把这一半判 `[-]`-类；行为一半 = 本节第一行的 `CollapseBlockHandlerImpl`，缺口已闭 | **该升档 `[x]`** |
| `CodeFoldingSettings` `[~]`（判决写"档位维持 `[~]`（fold3 R-7 已定）"） | `src/editorFoldingSettings.ts:41-42`（两行设置）、`:49-54`（`autoCollapseKinds`）、`:57-59`（`kindOfSetting`）、`src/editorFolding.ts:620-633`（`foldKinds` 预折叠）、`src/components/CodeFoldingSettingsPage.vue`、判据 `tests/editor-folding-settings.test.mjs:18`/`:23`/`:34`/`:44` | `platform/core-api/src/com/intellij/codeInsight/folding/CodeFoldingSettings.java` 16 行：五键 `:7-11` + `:13 getInstance()`，**没有别的成员**；三键的独占消费者 `java/java-psi-impl/src/com/intellij/codeInsight/folding/impl/JavaCodeFoldingSettingsBase.java:67/106/116` ✓；LSP 路径 `platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:41-46` ✓ | **该升档 `[x]`**（可移植面全落、其余已判 `[-]`） |
| `CodeFoldingSettingsImpl` `[~]` | `native/settings_schema.hpp:13`/`:18`（`EDITOR_SETTING_KEYS` 含两键）、`native/settings_schema.cpp:348`（`editor_defaults_impl()` 里那条 `{"collapseImports", true}, {"collapseCustomRegions", false}`，函数起 `:305`，`:345-347` 的注释正对着上游 `CodeFoldingSettings.java:7-11`）、`src/settingsModel.ts:265`（`collapseImports: true, collapseCustomRegions: false`）、判据 `tests/editor-folding-settings.test.mjs:67` | `platform/editor-ui-ex/src/com/intellij/codeInsight/folding/CodeFoldingSettingsImpl.java:11`（`@State(name = "CodeFoldingSettings", storages = @Storage("editor.xml"))`）✓ 27 行 | **该升档 `[x]`** |

⇒ 四档从 **22/18/0/29** 变 **33/7/0/29**（`tests/b4-verdict.test.mjs:110-113` 的四个数与表尾那句要同批改）。

### 8.2 档位不动、判词文字要改（7 行 `[~]` 保持）

| 判词原文档位 | 本仓真实出口 | 上游坐标 | 结论 |
|---|---|---|---|
| `CollapseSelectionHandler` `[~]` | `src/editorFolding.ts:721-740`（`foldSelectionOutcome`，判决写 `:700-719`）、`:707`（`CANNOT_REMOVE_AUTOGENERATED_REGION`，判决写 `:686`）、`:811-814`（`toggleFoldSelection`，判决写 `:790-793`）、**`:753-777`（`collapseSelectionAfterOverlapConfirm`，判决没登记）**；两档提示至今零生产消费方 | `.../impl/CollapseSelectionHandler.java:39`、`:44`（`HintManager.showInformationHint`）、`:49-58`（默认按钮「取消」）、`:79` ✓ 全部实开对上 | **判词正确**（`[~]` 留）；补记"确定那一步已实现"、改坐标 |
| `CollapseSelectionAction` `[~]` | `src/editorCommands.ts:277`（判决写 `:271`）、`src/menus/codeMenu.ts:120`、键位 `Ctrl+.` | `$default.xml:1036-1038` ✓（`:1036` id、`:1037` `control PERIOD`）；`.../actions/CollapseSelectionAction.java:30` 的 `isEnabled` 是上游的启用门 | **判词正确**（用户可见的提示/确认框仍缺，与上一行同源）；把理由从"宿主侧的限制记在 … 行"改成明确"缺 hint + 确认框接线" |
| `ExpandAllToLevel1..5Action` `[~]` ×5 | `src/editorFolding.ts:797-803`（判决这条是对的）、`src/editorCommands.ts:278-282`（判决写 `:277-281`）、`src/menus/codeMenu.ts:104-112`（判决写 `:75-83`；本级五条 `:106-110`，判决写 `:77-81`）、`src/foldingKeymap.ts:39-40`（明写本表只绑 caret 族）；判据 `tests/editor-folding.test.mjs:474-489` ✓ | `$default.xml:405-424`（本级 `:406/410/414/418/422` + NUMPAD `:407/411/415/419/423`）✓；`node_modules/w3c-keyname/index.js:28`/`:99`、`@codemirror/view/dist/index.js:9106`/`:9154-9160`/`:9164`/`:9165-9179`/`:9222-9228`/`:9251`/`:9269` ✓ 九处全真 | **判词正确**（"永不可命中的死绑定"这个论证站得住）；只改本仓坐标 |

### 8.3 纯坐标订正（档位与结论都不动；对象是 `docs/inventory/verdict-folding.md`）

**A. `src/editorFolding.ts`（现 891 行；HEAD 是 865 行，15:30 之后长了一次）**

| 判决写的 | 实测 | 出现在哪些行 |
|---|---|---|
| `:336-345`（`blockFoldPlan`） | **`:350-361`**（接口 `BlockFoldPlan` 在 `:344`） | `CollapseBlockHandlerImpl` |
| `:543-566`（`foldBlockAtCaret`） | **`:559-587`** | `CollapseBlockHandlerImpl`、`CollapseBlockAction` |
| `:559`（`areasContaining(blocks, pos)`） | **`:579`** | `CollapseBlockHandlerImpl` |
| `:550-558`（语法树退路） | **`:566-574`** | `CollapseBlockHandlerImpl` |
| `:414-426`（`autoAreas`） | **`:430-442`** | `EditorFoldingInfo`、`CollapseBlockHandlerImpl`（"`auto` 标记把 builder 与语法树混成一档"那句） |
| `:429-436`（`areasOf`） | **`:445-452`** | `EditorFoldingInfo` |
| `:475`（`foldedAreasOf`） | **`:491-493`** | `CodeFoldingManager` |
| `:480`（`candidatesOf`） | **`:496-498`** | `CodeFoldingManager`、`EditorFoldingInfo` |
| `:392`（`enclosingAreas`） | **`:408-423`** | `CodeFoldingManager` |
| `:493-501`（`perCaret`） | **`:509-517`** | `CollapseRegionAction`、`EditorFoldingInfo` |
| `:505-509`（`foldAtCaret`） | **`:522-525`** | `CollapseRegionAction` |
| `:511-515`（`unfoldAtCaret`） | **`:528-531`** | `ExpandRegionAction` |
| `:599-612`（`foldKinds`） | **`:620-633`** | `FoldingPolicy`、`CodeFoldingSettings` |
| `:645`（`selectionScoped`） | **`:666-670`** | §C⑤、`BaseFoldingHandler`、`CollapseAllRegionsAction`、`ExpandAllRegionsAction` |
| `:659`（`foldAllCommand`） | **`:680-694`** | `BaseFoldingHandler`、`CollapseAllRegionsAction` |
| `:676`（`unfoldAllCommand`） | **`:697-701`** | `BaseFoldingHandler`、`ExpandAllRegionsAction` |
| `:686`（`CANNOT_REMOVE_AUTOGENERATED_REGION`） | **`:707`** | `CollapseSelectionHandler` |
| `:700-719`（`foldSelectionOutcome`） | **`:721-740`** | `CodeFoldingManagerImpl`、`CollapseSelectionHandler`、`EditorFoldingInfo`、§C① |
| `:790-793`（`toggleFoldSelection`） | **`:811-814`** | `CollapseSelectionHandler`、`EditorFoldingInfo` |
| `:813`（`unfoldIntersecting`） | **`:834-838`** | §C⑤、`UpdateFoldRegionsOperation` |
| （没登记）`collapseSelectionAfterOverlapConfirm` | **`:753-777`** | 建议补进 `CollapseSelectionHandler` 行 |

**B. `src/editorCommands.ts` / `src/menus/codeMenu.ts` / `src/workspaceLifecycle.ts`**

| 判决写的 | 实测 |
|---|---|
| `src/editorCommands.ts:266`（`fold`/`unfold`） | **`:272`** |
| `src/editorCommands.ts:271`（`fold.selection`） | **`:277`** |
| `src/editorCommands.ts:277-281`（十条 level 命令） | **`:278-282`** |
| `src/editorCommands.ts:291-295`（`foldingKeymap`） | **`:292-296`** |
| `src/menus/codeMenu.ts:57`（`unfold`）/ `:61`（`fold`） | **`:78`** / **`:82`** |
| `src/menus/codeMenu.ts:66-74`（caret 族子菜单） | **`:95-103`**（五条 `:97-101`，判决写 `:68-72`） |
| `src/menus/codeMenu.ts:75-83`（all 族子菜单） | **`:104-112`**（五条 `:106-110`，判决写 `:77-81`） |
| `src/menus/codeMenu.ts:57-63`（"八条单段是印键位的"） | **`:78-84` + `:120-121`** |
| `src/workspaceLifecycle.ts:305`（打开工作区读回） | **`:323`** |
| `src/workspaceLifecycle.ts:413`（关项目清空） | **`:434`** |

**C. `tests/editor-folding.test.mjs`（现 583 行）**

| 判决写的 | 实测（测试标题） |
|---|---|
| `:146` / `:157` / `:163` / `:172` | **`:147`**（起始行那条）/ **`:158`**（最内层在前）/ **`:164`**（收起）/ **`:173`**（展开） |
| `:194` / `:203` / `:211` / `:219` | **`:195` / `:204` / `:212` / `:220`**（折叠代码块四条挑法） |
| `:240-241`（`blockAt` 的 grep 命中） | **`:273-274`**（另 `:14` 是 import、`:56-58` 在 `blockRanges` 那条里） |
| `:267` / `:277` | **`:300`**（`fold.block` 端到端）/ **`:310`**（再按一次往外一层） |
| `:404`（"走的是本仓 `foldAtCaret` 不是 `foldCode`"） | **`:535`** |
| `:422-434`（`foldingRanges` + `lspFoldService` 产出候选） | **`:553-565`**（"服务端的区间真的接到了 CodeMirror 的折叠服务上"） |
| `:362`（第四批登记的标题漂移） | 现 **`:391-426`**（"键位在浏览器的键名规则下真的对得上"） |
| `:114-128`、`:130-136`、`:437-466`、`:474-489` | ✓ **不用改**（本 lane 逐条开过边界，四条都精确对上） |

**D. 上游侧（本域唯一三处真偏）**

| 判决写的 | 实测 |
|---|---|
| `UpdateFoldRegionsOperation.java` 的 `caretInsideRange:236-238` | **`:234-236`**（签名 `:234`、`return` `:235`、`}` `:236`）；`src/editorFolding.ts:624`/`:639` 与 `src/editorFoldingState.ts:18` 的注释同错，一并改 |
| `shouldExpandNewRegion:236-253`（`src/editorFolding.ts:624` 注释） | **`:238-255`**（判决 §G 没引它；`tests/folding-navigate-unfold.test.mjs:139` 写的 `:243-255` 是对的） |
| `CodeFoldingManager.java:46-58` ↔ `getFoldRegionsAtOffset` | 本类该抽象方法在 **`:33`**；`:46-58` 是 `FoldingUtil.java` 的同名实现 ⇒ `CodeFoldingManager` 行要么改 `:33`，要么把 `:46-58` 标成 `FoldingUtil.java` |

### 8.4 复核为真、不动的行（免得 ledgerfix 重复劳动）

- `[x]` 里坐标也全部准确的 7 行：`CodeFoldingPass`、`CodeFoldingNecromancy`、`CollapseExpandDocCommentsHandler`、
  `DocumentFoldingInfo`（上游 `:128`/`:146-164`/`:198`/`:260`/`:297`/`:314-341`/`:326-335`/`:333` 与本地
  `src/editorFoldingState.ts:151`/`:205-228` 全部对上，§4 已定性 ⇒ **判词正确**）、`FoldingUpdate`、
  `CodeFoldingPassFactory`（只有 `tests/editor-folding.test.mjs:422-434` 一条要挪，见 C 组）、
  `CodeFoldingNecromancer`（只有 `workspaceLifecycle` 两条，见 B 组；`native/folding_state_schema.cpp:29-68` 复核为真 ——
  `validate_folding_state` 起 `:29`、收尾 `:68`，文件 70 行）。
- 判决簿 §D 的四类 `[-]` 理由、§F 的四道门、`docs/inventory/folding.txt` 的 69 类覆盖 ⇒ **本 lane 独立复核成立**（§4 末）。
- 上游 `EditorFoldingInfo.java` / `FoldingPolicy.java` / `DocumentFoldingInfo.java` / `FoldingUtil.java` / `$default.xml` /
  `LangActions.xml` / `ActionsBundle.properties` / `CodeFoldingSettings*.java` / `LspFoldingBuilder.kt` /
  `JavaCodeFoldingSettingsBase.java` / `CodeFoldingNecromancer.kt` + `CodeFoldingNecromancy.kt` / 九个 `node_modules` 坐标
  ⇒ **抽核无一处假坐标**；本域已登记的 V1/V4/V5/V9/V10 五笔订正都是准的。
- **本域没有"判词说 `[x]` 但出口不存在"的假出口**；错误全在反方向（早做了、判词还说缺 / 行号过期）。
- 任务书给的"本族现场"四条独立复核结果：`src/customFoldingSurround.ts` + `tests/folding-custom-region-surround.test.mjs`
  在盘，且判词在 `platform_rest` 域的 `lp/custom-folding`（`scripts/verdict_table.py:331`）里而不是本判决 §G
  （`CustomFoldingBuilder.java` 在 `platform/core-api/src/com/intellij/lang/folding/`，路径不含 `/com/intellij/codeInsight/folding/` ⇒ 不属本域 69 类，不是漏项），
  只是那两处坐标过期（S-4）；`src/stickyLines.ts` 的 `UINumericRange(5,1,20)` 复核为真、"本仓校验停在 10"复核为真（S-3）；
  `src/editorFolding.ts` **不是**"只改了注释"——16:23 那次带了功能改动（`remove` 那一档，§6.1）；
  `src/foldingKeymap.ts` 复核无误；任务书写的 `src/codeFoldingSettings*` 在本仓**没有这个文件名**（实名 `src/editorFoldingSettings.ts`，09-30 之后未动，判决引的 `:49-54`/`:57-59` 精确）。
- §A 那两行键位表与 `src/editorFolding.ts`/`src/foldingKeymap.ts` 头注里的 `node_modules` 机理坐标**互相对得上**，
  且 `src/foldingKeymap.ts:46` 与 `tests/editor-folding.test.mjs:437` 的标题写的 `$default.xml:385-403` 比判决的 `:385-404` 少一行尾界
  （代码侧注释的小漂移，不越界、机检不拦，本 lane 不改）。

### 8.5 本 lane 未能核实的（如实登记，不当结论用）

- **上游子菜单会不会把 chord 反推显示出来**：要开 `ActionPresentation` 那条链，本 lane 没开 ⇒ 判决在 `ExpandToLevel1..5Action`
  五行写的"**无法核实**"维持原判（本仓这一侧的事实已核实：`src/menus/codeMenu.ts:97-101` 现在印 `Ctrl+* N`）。
- **中文文案**：判决 §A 与 `src/editorFoldingSettings.ts`/`src/menus/codeMenu.ts` 的中文串取自本机 IDE 的 `localization-zh.jar`，
  社区树里没有那个 jar ⇒ 本 lane 只能核英文原名与 mnemonic 位置
  （`ActionsBundle.properties:621`-`:655` 逐条 ✓、`group.ExpandToLevel.text=Expand to L_evel` `:622`、
  `group.ExpandAllToLevel.text=Expand All to _Level` `:628`、`action.ExpandRegion.text=E_xpand` `:636` 等），
  中文本身**无法核实**（不影响档位）。
- **`ConsoleViewImpl.kt` 的行数口径**（第一跑引用门那条给的 1730 vs `wc -l` 的 1729）：属别的域，本 lane 只记数不裁。
- 任务书说 `src/editorFolding.ts` 那条"stickyfold 只改了注释"——**与磁盘不符**：16:23 那次改动带功能
  （`BlockFoldPlan.remove` 那一档，§6.1）。归属看 `docs/batch-2026-10-06-foldchord.md:11-25`，不是 stickyfold。
  这条不影响档位，但影响"谁在飞这个文件"的判断，故登记。

## 9. 一句话结论

`verdict-folding` 的**上游侧与 `node_modules` 侧坐标经得起逐条实开**（抽核无假），错误集中在**本仓侧行号漂移**
（`src/editorFolding.ts` +14~+21、`src/editorCommands.ts` +1、`src/menus/codeMenu.ts` +20~+37、`src/workspaceLifecycle.ts` +18/+21、
`tests/editor-folding.test.mjs` +1~+131）**与两处"已经做完但判词还说缺"**（`CollapseBlockHandlerImpl` 的撤里层折痕、
caret 族五条菜单行的键位显示）；**22 行 `[x]` 没有一行是假出口**，18 行 `[~]` 里 **11 行该升 `[x]`**、
7 行该留（其中 4 行只需改坐标/措辞）。执行归 `ledgerfix`：§8.1 的 11 行升档 + §8.2 的 7 行改写 + §8.3 的 D 组三处上游坐标，
四档从 22/18/0/29 变 **33/7/0/29**，`tests/b4-verdict.test.mjs:110-113` 与表尾那句要同批改。

