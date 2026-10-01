# 代码提示框（补全弹层）的对齐规格 —— 照 IDEA 的 `LookupElementPresentation`

> 这份是**重做补全弹层**的靶子（用户 2026-10-01 要求「严格对齐 IDEA」）。先记形态与字段映射，
> 再动代码；每条都指到本地参考源码的 `file:line`，不引网页。

## 一、IDEA 一行候选里有几段

`platform/analysis-api/src/com/intellij/codeInsight/lookup/LookupElementPresentation.java`：

| 段 | API | 位置与体例 |
|---|---|---|
| 图标 | `setIcon`（`:35`） | 行首 |
| 主文本 | `setItemText`（`:40`）+ `setItemTextBold`（`:50`）/`setItemTextItalic`（:55） | 就是"名字"，可加粗/斜体 |
| 主文本的局部装饰 | `decorateItemTextRange`（`:64`） | **匹配到的字母要单独高亮**（前缀/驼峰/子串三种匹配各有装饰） |
| 灰尾文本 | `setTailText`（`:84`）/`appendTailText`（`:93`，可灰可不灰）/`appendTailTextItalic`（`:97`） | 名字后面的"类型参数、包名、容器名"等 |
| 类型文本 | `setTypeText`（`:125`，可带 `setTypeText(text, icon)` 的第二图标 `:129`） | **右对齐**的类型标注（`String`、`int`…），有独立前景色 |
| 删除线 | `setStrikeout`（`:45`） | 已废弃/不可用的候选 |

**本仓现状（核过代码，别再重做）**：上面六段**已经落地** ——
`src/completionPresentation.ts` 照 `platform/lsp/src/api/customization/LspCompletionCustomizer.kt:128-184`
把 `labelDetails.detail` 当**灰尾**、`labelDetails.description`/`detail` 当**右对齐类型文本**、
`keyword` 加粗、`deprecated`/`tags` 含 1 出删除线、`kind` 出图标（缺图标**故意留空**，不发明字形）；
`src/completionUi.ts:77-86` 把这三段和删除线画出来（行首图标 + 名字 + 灰尾 + 右对齐类型 +
`tc-completion-deprecated` 类）。**所以差距不在这六段**，而在下面三件。

## 二、LSP `CompletionItem` → 上面六段

| IDEA 段 | LSP 字段（`CompletionItem`） | 备注 |
|---|---|---|
| 主文本 | `label`（或 `labelDetails.name`） | 有 `labelDetails` 时它才是名字 |
| 灰尾文本 | `labelDetails.detail`（括号里那截，如 `(int)`）+ `labelDetails.description`（灰尾，如包名/容器名） | 对应 `tailText` 的两段 |
| 类型文本 | `detail`（多数服务器也在这里给类型或签名） | 需要**右对齐**、另一档前景色 |
| 图标 | `kind`（1..25，我们已声明 valueSet）+ `tags` | 已实现 |
| 删除线 | `tags` 含 `1`（Deprecated） | 待做 |
| 匹配高亮 | 无直接字段；用 `filterText` 决定匹配，**高亮由客户端自己算**（前缀 → 驼峰 → 子串） | 待做 |

## 三、真正的差距（三件，按顺序）

1. **排序**（✅ 已落地，`8a70e95` + `src/completionSort.ts`）：排序不是写死在 arranger 里的，而是一条
   **可扩展的排序器链** —— 接口
   `platform/analysis-impl/src/com/intellij/codeInsight/completion/CompletionLookupArranger.java:16,25`
   （`arrange` 收一个 `CompletionSorter`），实现是
   `platform/analysis-impl/src/com/intellij/codeInsight/completion/impl/CompletionSorterImpl.java:18`
   （`weighingFactory:28` 把 `LookupElementWeigher` 折成 `ClassifierFactory`，
   `weighBefore:44` / `weighAfter:55` 往链里插档）。**LSP 这一路的真实档位**（后补的核对，
   比第一版写得更准）：默认链在 `platform/analysis-impl/src/com/intellij/codeInsight/completion/BaseCompletionService.java:204-240`
   （`PreferStartMatching` → 注册表里的各档 weigher → 收尾的 `priority`/`LiftShorterItemsClassifier`），
   而 LSP 的 `sortText` 是**其中一档 weigher**，注册在
   `platform/lsp-impl/resources/intellij.platform.lsp.impl.xml:86-88`
   （`order="after priority, before prefix"`），实现
   `platform/lsp-impl/src/impl/features/completion/LspCompletionWeigher.kt:30-36`。
   本仓把它落成纯函数 `sortCompletions()`：预选 → `sortText`（缺省退回 label）→ 大小写不敏感 → 长度 → 字母序。
1b. **分组：更正 —— 普通补全没有组间分隔行**（上一版这一条写错了，2026-10-01 复查删除）。
   事实：`BaseCompletionLookupArranger.java` 里**没有任何** Separator（上一版写的"`:121`/`:402` 在堆与堆之间插分隔符"是错的，
   那两处只是分组后按相关性排）。真正的分隔行（带标题的一条）只长在**分组贡献者**那条路上：
   `GroupedCompletion` 服务开关默认关（`platform/analysis-impl/src/com/intellij/codeInsight/completion/group/GroupedCompletionImpl.kt:15-17`
   读 `ide.completion.group.enabled`，默认 `false`），开着时 arranger 才换成
   `GroupCompletionLookupArrangerImpl`（`platform/lang-impl/src/com/intellij/codeInsight/completion/CompletionProgressIndicator.java:208-209`），
   它给每个组造一个 `SeparatorLookupElement`（`.../GroupCompletionLookupArrangerImpl.java:51-56`），
   渲染成带标题的分隔条 `platform/lang-impl/src/com/intellij/codeInsight/lookup/impl/LookupCellRenderer.kt:357-376`；
   而实现 `GroupedCompletionContributor` 的只有 postfix 模板与命令补全两类 —— Java/LSP 的普通补全一个都不沾。
   ⇒ 本仓的落点就是"排序本来就是分组的全部"：`src/completionGroup.ts` 与其单测**已删**（它们编码的是一个不存在的 UI），
   弹层不加分隔行。
2. **`filterText` 契约**（✅ 已落地，`81d2c95`）：LSP 的 `filterText` 是"过滤键、不一定要显示"；
   `src/lspCompletion.ts` 有它时把 `label` 设成它、可见文本交给 `displayLabel`（高亮范围由
   `src/completionPresentation.ts` 的 `completionMatch` 搬回去）。
3. **跳转侧配套：Choose Declaration**（✅ 已落地，见下）。上游**不是** `GotoDeclarationAction.java`
   （本源码树里那个类已经改名/搬位置），多目标弹层在
   `platform/lang-impl/src/com/intellij/codeInsight/navigation/actions/GotoDeclarationOnlyHandler2.kt:60-76`：
   一个目标 → 直接跳；多个 → `buildTargetPopup` 开弹层，标题取
   `platform/lang-api/resources/messages/CodeInsightBundle.properties:146`（"Choose Declaration"）。
   一行三段照 `platform/platform-impl/src/com/intellij/ui/list/TargetPresentationMainRenderer.kt:30-44`
   （图标 + 主文本 + 灰的 `" ("+containerText+")"`，前后缀来自
   `platform/core-api/src/com/intellij/navigation/LocationPresentation.java:26-27`）与右对齐的位置列
   （`.../TargetPresentationRenderer.kt:70-83`）；过滤用的名字 = `presentableText + " " + containerText`
   （`.../targetPopup.kt:62-81`）。**本仓落点**：`src/chooseTarget.ts`（行模型/过滤/移动，纯函数）、
   `src/components/ChooseTargetPopup.vue`（弹层）、`CodeEditor.vue` 的 `revealDefinition` 两个分支；
   三段取自 LSP 的真数据（声明点标识符 / 所在文件 / `行:列`），退化链写在该文件头。
   这一条与 `declaration → definition` 退化链是同一个落点（`native/lsp_navigation.cpp`，它本来就回**全部**目标，
   多出来的位置此前被前端丢掉）。

**别破坏的两条既有契约**：`completionItem/resolve`（选中某项时才拉文档/自动导入，见
`native/lsp_host_bootstrap.cpp` 的 `resolveSupport.properties` 声明）与上面的六段整形。
