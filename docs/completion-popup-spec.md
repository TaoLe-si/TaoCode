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

1. **排序与分组**（读源码后的结论）：排序不是写死在 arranger 里的，而是一条**可扩展的排序器链** ——
   接口 `platform/analysis-impl/src/com/intellij/codeInsight/completion/CompletionLookupArranger.java:16,25`
   （`arrange` 收一个 `CompletionSorter`），实现是
   `platform/analysis-impl/src/com/intellij/codeInsight/completion/impl/CompletionSorterImpl.java:18`
   （`weighingFactory:28` 把 `LookupElementWeigher` 折成 `ClassifierFactory`，
   `weighBefore:44` / `weighAfter:55` 往链里插档）；分组在 `BaseCompletionLookupArranger`（`LookupArranger` 那一路）。
   **移植口径**：做一个纯函数 `sortCompletions()`，按 IDEA 默认链的档位依次比较
   （相关性 → 大小写不敏感 → 长度 → 字母序；相关性档在 LSP 侧取 `sortText`，缺省退回 label），
   在交给 CodeMirror 之前排好 —— 这样 CodeMirror 只负责画，不参与排序语义。每一档一个纯函数、各有单测。
1b. **分组**（读源码后的结论）：分组不是另一个开关，而是**排序链的副产物** ——
   `BaseCompletionLookupArranger.groupItemsBySorter:95` 把候选按 `MultiMap<CompletionSorterImpl, LookupElement>`
   归堆（`:121`/`:402` 在堆与堆之间插分隔符，`:537-542` 也是"先分组再组内按相关性排"）。
   ⇒ 移植口径：`groupCompletions()` 复用同一条排序链 —— **用它第一档能区分开的键当组键**
   （LSP 侧就是 `sortText` 的"分组前缀"，没有 `sortText` 时整表一组），组内再用 `sortCompletions()`
   的其余档排；弹层在组之间画分隔符（`completionUi.ts` 已有逐行渲染，加一行 separator 即可）。
2. **`filterText` 契约**：LSP 的 `filterText` 是"过滤键、不一定要显示"；`src/completionPresentation.ts`
   的 `completionMatch` 已经处理了"别名不等于可见文本时不高亮无关字符"（注释里写着），
   但**过滤本身**仍要确认走的是 `filterText` 而不是 `label`（`src/lspCompletion.ts` 一线）。
3. **跳转侧配套**：`GotoDeclarationAction` 的多目标 **Choose Target** 弹层
   （上游 `platform/lang-impl/src/com/intellij/codeInsight/navigation/actions/GotoDeclarationAction.java`）
   —— 现在多目标直接取第一个，要补"选哪个"的弹层，条目按「类型/成员/文件」分组并带图标。
   这一条与刚补的 `declaration → definition` 退化链是同一个落点（`native/lsp_navigation.cpp`）。

**别破坏的两条既有契约**：`completionItem/resolve`（选中某项时才拉文档/自动导入，见
`native/lsp_host_bootstrap.cpp` 的 `resolveSupport.properties` 声明）与上面的六段整形。
