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

我们的弹层现在只用 LSP 的 `label` + `detail` + `kind` 图标（`src/lspCompletion*.ts` 一线），
上面六段里**只落了一段半**，所以「严格对齐」的差距主要在：灰尾、类型文本（右对齐）、匹配高亮、
删除线。

## 二、LSP `CompletionItem` → 上面六段

| IDEA 段 | LSP 字段（`CompletionItem`） | 备注 |
|---|---|---|
| 主文本 | `label`（或 `labelDetails.name`） | 有 `labelDetails` 时它才是名字 |
| 灰尾文本 | `labelDetails.detail`（括号里那截，如 `(int)`）+ `labelDetails.description`（灰尾，如包名/容器名） | 对应 `tailText` 的两段 |
| 类型文本 | `detail`（多数服务器也在这里给类型或签名） | 需要**右对齐**、另一档前景色 |
| 图标 | `kind`（1..25，我们已声明 valueSet）+ `tags` | 已实现 |
| 删除线 | `tags` 含 `1`（Deprecated） | 待做 |
| 匹配高亮 | 无直接字段；用 `filterText` 决定匹配，**高亮由客户端自己算**（前缀 → 驼峰 → 子串） | 待做 |

## 三、重做的动作（按顺序，每步都能单测）

1. **整形层**（纯函数、先测）：把 `CompletionItem` 折成一个 `{icon, name, tail, tailGray, type, deprecated}`
   结构 —— 与弹层解耦，判据直接喂 JSON。
2. **弹层渲染**：三段文本（名字 / 灰尾 / 右对齐类型）+ 删除线 + 匹配高亮（高亮范围由第 1 步一起算出来，
   渲染只画 `decorations`）—— 与上游 `CompletionLookupArranger`（排序/分组，另一步）分开做。
3. **两个已有契约别破坏**：`completionItem/resolve`（选中某项时才拉文档/自动导入，见 `native/lsp_host_bootstrap.cpp`
   的 `resolveSupport.properties` 声明）与 `filterText`/`sortText` 的用法（现在按 label 过滤 ✗ 需改成 filterText）。
4. **跳转侧配套**：`GotoDeclarationAction` 的多目标 **Choose Target** 弹层（上游
   `platform/lang-impl/src/com/intellij/codeInsight/navigation/actions/GotoDeclarationAction.java`
   的 `showUsages`/`ChooseTargetAction` 那一路）—— 现在多目标直接取第一个，要补"选哪个"的弹层，
   条目按「类型/成员/文件」分组并带图标。
