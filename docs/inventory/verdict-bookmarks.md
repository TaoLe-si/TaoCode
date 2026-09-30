# B5 判决：`ide/bookmarks` = 5 类（书签那一族）

判定依据：机械枚举（`docs/inventory/projectviews_scan.md` 里路径含 `com/intellij/ide/bookmarks/` 的
非测试类 —— 清单落在 `docs/inventory/bookmarks.txt`，5 行）+ 逐类读上游源码
（`platform/bookmarks/src/com/intellij/ide/bookmarks/*`）+ 本仓书签功能的真实落点核对
（`src/bookmarks.ts`、`src/bookmarkActions.ts`、`src/bookmarksView.ts`、
`src/components/BookmarksPanel.vue`、`src/editorGutterIcons.ts`、`src/keymap.ts`）。

> 为什么挑它起 B5：它是 `projectviews` 域里**最小的一组**（5 类），而本仓的书签功能已经是一整条真实链路
> （列表代数 + 编号助记 + F11/Ctrl+F11 + 工具窗口 + 装订线图标 + 视图齿轮 + 项目级持久化）——
> 每个类都能落到真文件上，不会写出"看起来合理"的空话。
> §G 是逐条总表（5 行，机检对齐），四档计数写在表尾。本域**没有 `[-]`、也没有 `[ ]`**，所以没有 §D。

## A. 本仓书签功能的地基（读判决前先看这一节）

| 本地落点 | 干什么 | 上游对应 |
|---|---|---|
| `src/bookmarks.ts`（列表代数：`Bookmark{path,line,mnemonic?}`、`placeBookmark` 的 F11/Ctrl+F11 语义、编号唯一性、`sortedBookmarks`、`bookmarkOwner`、前后跳转） | 一个项目一份书签表；编号 0–9 只能被一条占着，所以 `Ctrl+数字` 永远指得准 | `Bookmark`（`Bookmark.java`）+ `BookmarkManager` 的增删与编号（`BookmarkManager.java:104-125` 的 `index++` 与 `myBookmarks.putValue`） |
| `src/bookmarkActions.ts` + `src/keymap.ts` | F11 / Ctrl+F11 / Ctrl+数字 的键位与动作（`$default.xml` 逐条核过） | `BookmarkManager` 上的动作包（`ToggleBookmarkAction` 等，在 `platform/bookmarks` 的 actions 包里 —— 不在本域路径上） |
| `src/components/BookmarksPanel.vue` | 书签工具窗口：编号气泡 + 文件 + 行号 + 移除按钮 + 键盘走查 | `BookmarkItem`（列表项与渲染）+ `BookmarksView`（面板本体，不在本域路径上） |
| `src/bookmarksView.ts` | 视图齿轮的三个真开关（按文件分组 / 选中时跳源 / 源变化时选中）与另外三个"没有落点就不渲染"的登记 | `BookmarksViewState`（不在本域路径上）；开关名与默认值逐条核过 |
| `src/editorGutterIcons.ts` | 装订线上的书签图标（`GutterIconRenderer` 的等价物） | `Bookmark.updateHighlighter`（`Bookmark.java:118-125`）挂的高亮器 |
| `ProjectSettings.bookmarks`（项目级） | 持久化 | `BookmarkManager implements PersistentStateComponent<Element>`（`BookmarkManager.java:62`） |

## C. 下一批该做的条目（按用户可见度）

① **编辑后对账 + 行文本锚** —— ✅ **已做（第六十七批）**：本仓落在 `src/bookmarks.ts` 的
    `reconcileBookmarks` + `Bookmark.text`，接线在 `src/bookmarkActions.ts` 与 `src/lspNavigation.ts` 的
    `onEditorChange`。做的是上游 `documentChanged`（`:449-536`）那三条：行号越界的删掉并记进会话内的
    "丢掉表"（`:522-534`）、同一行只留一条（`isDuplicate:517-530`）、原文回到同一行号就放回去
    （`:536`，含单行移动的 `line -= 2` 特例 `:499-506`）。真机取证与"面板观感未复验"的原因写在审计 §BM。
    **自动描述 —— 已做（第七十一批）**，但上游的规则**不是**这里原来记的那条：
    · 旧记法有误：`getAutoDescription:127-139` 的截断长度是 **50**（`MAX_AUTO_DESCRIPTION_SIZE:70`），不是 200；
      而且在这个快照里它是**死代码**（全仓只有定义、没有调用点）。
    · 2026.2 真正生效的是现代实现 `platform/bookmarks/src/com/intellij/ide/bookmark/`：
      `BookmarksManagerImpl.createDescription:129-136` 对 `LineBookmark` 取
      `LineBookmarkProvider.Util.readLineText`（`:558-582`：书签带 `expectedText` 就用它，否则读文档的那一整行）
      再 `trim()`；`getDescription:579-585` 是**首次需要时才算并缓存**的。
    · 渲染在 `ui/tree/LineNode.kt:20-31`：分组在文件下时是 `"$line: "`（灰）+ 描述（常规体）；
      没有描述退回 `BookmarkNode.kt:72-77` 那一支（文件名 + ` :行号` + 位置）。
    **本仓落地**：描述 = `Bookmark.text`（行原文锚，放书签时记、编辑后对账时刷新）去掉首尾空白
    （`src/bookmarks.ts` 的 `bookmarkDescription`），面板按 `LineNode`/`BookmarkNode` 的两种形状渲染
    （`src/components/BookmarksPanel.vue`）。**行号口径**：上游存 0 基、显示 `+1`（`LineNode.kt:21`），
    本仓存的是 1 基（`placeBookmark` 收 `tab.line`，`reconcileBookmarks` 按 `lines[line - 1]` 取，
    持久化校验要求 `line >= 1`）—— 显示**不 +1**。
    **顺带修掉一个真缺陷**：`text` 是第六十七批加的，但原生校验的白名单还是 `{path, line, mnemonic}`
    （`native/settings_schema.cpp` 的 `validate_bookmarks`），于是**带锚的书签一律存不进去**
    （`Unknown field: text` → 前端弹「书签未能保存」）—— 真机被这条挡过（项目设置里 `bookmarks: []`）。
    现在白名单放行 `text` 并校验（字符串 / ≤4 KiB 字节 / 合法 UTF-8；空串合法，对应空行上的书签，
    上游 `writeExternal:329-333` 也是"非空才写 `<bookmark description>`"）；前端 `bookmarkAnchor`
    按 1024 字符截断，**存与比同一个函数**，长行不会出现"永远比不中"的假失效。
    **真机取证**：README.md 第 3 行 F11 → 气球「书签 README.md:3」且无保存失败提示；面板行
    `3: Small scratch project used to compare TaoCode against IntelliJ IDEA side by side.`；
    项目设置里 `{"line":3,"path":"README.md","text":"Small scratch project …"}`；**重启后**同一行照旧
    （读路径也通）。判据：`tests/bookmarks.test.mjs`（13 条）+ `projects_test` 的书签用例（往返含 `text`/`description`，
    外加六条拒绝：非字符串 / 4097 字节 / 孤立续字节 × 两字段 / 未知键）。
    **选中的文字 → 自定义描述（同批补）**：2026.2 的 F11 在**有非空白选中**时把那段文本设成书签的
    `description`（`actions/ToggleBookmarkAction.kt:88-93`：`selectedText` 非空白 →
    `group.setDescription(bookmark, selectedText)`），与"行原文锚"是**两个字段**（上游 XML 里是
    `<bookmark description>`，内存里的 `expectedText` 另算）。本仓新增 `Bookmark.description`
    —— 放上那一刻写一次的快照（对账只刷锚 `text`、不碰它），面板显示优先取它、没有才退回行原文
    （上游 `getDescription:579-585` 的顺序），持久化字段名与上游一致。真机取证：第 6 行 Shift+左 选中 4 个
    字符再 F11 → 项目设置 `{"line":6,"path":"README.md","text":"probe line …","description":"940"}` ——
    锚是整行、描述是选中那段，各就各位。
② **书签类型（= 助记键）—— ✅ 已做（第七十三批）；文件书签未做**。
   **先更正"书签类型"是什么**：2026.2 的 `BookmarkType` 就是**助记键枚举** ——
   `platform/lang-api/src/com/intellij/ide/bookmark/BookmarkType.kt:24-45`：
   `DIGIT_1..DIGIT_0`、`LETTER_A..LETTER_Z`、`DEFAULT(mnemonic = 0)`，外加 `BookmarkIcon`
   把字符画在书签图标上（`:80-115`）——**不是**颜色/图标类型体系（旧记法把它想复杂了）。
   于是"类型"这一条的用户可见面是：
   · 助记键可选 **0-9 与 A-Z 共 36 个**，选择器是 `ToggleBookmarkWithMnemonic` →
     `ChooseBookmarkTypeAction`（`resources/intellij.platform.bookmarks.xml:67`）→
     `BookmarkTypeChooser`（两块网格按 `isDigit()`/`isLetter()` 分栏 `:151-166`、说明行、描述输入框、
     两个图例点 `:205-222`），标题随状态三段（`ChooseBookmarkTypeAction:33-41`）；
   · 摘掉助记键 = `DeleteMnemonicFromBookmark` → `DeleteBookmarkTypeAction`（`:68`，`setType(DEFAULT)`）；
   · 跳转 = 每个助记键一个动作（`xml:81-117` 的 `GotoBookmark0..9/A..Z`，菜单文案「转到书签 {0}」），
     **只有 0-9 有默认键位**（`keymaps/$default.xml:173-197` 的 `control 0..9`），字母没有全局键
     （书签窗口内的裸键 `actions/extensions.kt:126-135`）；
   · 改贴一个**已被占用**的助记键：`BookmarksManagerImpl.canRewriteType:262-283` 先问
     （`rewriteBookmarkType` 开着就直接改；确认框带"不再询问"回写这个开关），同意后
     `rewriteType:285-295` 把老的那条**行书签整条删掉**（不是摘它的编号）。
   **本仓落地**：`Bookmark.mnemonic` 由数字改成单个字符（上游 XML 存的也是字符：
   `BookmarkManager.writeExternal:337-340`），`src/bookmarks.ts` 的 `BOOKMARK_MNEMONICS` /
   `normalizeMnemonic` / 重写语义（`placeBookmark(..., rewrite)`）；
   选择器拆成 `src/components/BookmarkMnemonicChooser.vue`（数字+字母两栏、描述输入、图例、状态标题、
   重写确认、「移除助记键」，文案逐条取本机 IDEA 2026.2 中文包）；导航菜单 36 行「转到书签 {0}」；
   齿轮补上「重写助记键之前询问」（选中态取反，默认选中 —— `RewriteBookmarkTypeToggleAction:17-27`）；
   持久化白名单放行字符形式并**兼容旧整数**（老状态文件不因这次扩展变成坏的）。
   **真机取证（本轮）**：选择器标题随状态（「指定助记符…」）、两栏 `10 + 26`、说明/图例/「描述(可选)」
   都在；敲 `A` 直接落盘 `{"line":8,"mnemonic":"A"}`；改贴已占用的 A 时弹
   「A 助记键已被占用（README.md:8）。是否要重写?」（重写 / 重写且不再询问 / 取消），点「重写」后
   老的从持久化里消失、新的拿到 A；气球按"有没有全局键"分别说「Ctrl+3 跳转」与「导航菜单：转到书签 A」。
   **仍未做**：`FileBookmark`（文件书签，行 `-1`；上游由 `manager.createBookmark(file)` 从项目树/编辑器
   标签右键产生，见 `actions/extensions.kt:58-72`）、命名/分组书签列表（`BookmarkGroup`、
   `GroupCreateDialog`、把某个列表标为默认）、`EditBookmark`（F2 改描述）、`AddAnotherBookmark`、
   `BookmarkOpenTabs`。
③ **列表项的富渲染**：`BookmarkItem.setupRenderer`（`:46-86` 图标 + 描述 + 行的文本）、
   `speedSearchText`（`:104`）、`footerText`（`:109`）—— 本仓面板只有编号/文件/行号。

## G. 逐条总表（5 类，与 `docs/inventory/bookmarks.txt` 一一对齐）

| 类 | 源码 | 判决 | 依据（有实现点的指到真实 `src/` 文件） |
|---|---|---|---|
| `Bookmark` | `platform/bookmarks/src/com/intellij/ide/bookmarks/Bookmark.java` | `[~]` | 本仓的 `src/bookmarks.ts` 有 `Bookmark{path,line,mnemonic?}`（`Navigatable` 那一面 = 面板/动作跳到 `path:line`；`Comparable` 那一面 = `sortedBookmarks` 按路径+行）；`description` 已有（本仓 `Bookmark.description`：选中文字再 F11 时记下，持久化字段名与上游一致）、`BookmarkType`（`:181`，行/文件书签）、`getBookmarkFont`（`:95`，编号书签的粗体）、`release`/`updateHighlighter`（`:118-126`，高亮器生命周期 —— 本仓的图标由 `src/editorGutterIcons.ts` 统一重算，没有"每条书签自己持一个高亮器"的形态） |
| `BookmarkBundle` | `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkBundle.java` | `[~]` | 资源包只是取文案的机制（`:21-28` 的 `message`/`messagePointer`）；本仓的对应物是面板与动作里的字面量（文案逐条核过本机 IDEA 2026.2 中文包），见 `src/components/BookmarksPanel.vue`；**缺** `messagePointer` 那半（延迟取文案的 `Supplier` 形态 —— 本仓直接取字符串，没有它要解决的问题） |
| `BookmarkItem` | `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkItem.java` | `[~]` | 列表项在 `src/components/BookmarksPanel.vue`（编号气泡 + 文件 + 行号 + 移除按钮 + 键盘走查）；**缺** `setupRenderer`（`:46-86`：图标 + 描述 + 行文本）、`speedSearchText`（`:104`，快速搜索命中串）、`footerText`（`:109`）、`updateAccessoryView`（`:92`，编号在右侧附件位）、`allowedToRemove`/`removed`（`:119-127`，类型化书签才有的"许可删除"） |
| `BookmarkManager` | `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkManager.java` | `[~]` | 表与持久化：`ProjectSettings.bookmarks`（项目级）+ `src/bookmarks.ts` 的 `placeBookmark`（编号移动/取消）+ F11/Ctrl+F11（`src/keymap.ts`、`src/bookmarkActions.ts`）+ `getValidBookmarks` 的"按位置排序"那一支（`src/bookmarks.ts` 的 `sortedBookmarks`）；**缺** 编辑后按行文本重锚与失效/查重（`:439-495`）、自动描述（`:127-139`，已按 2026.2 的 `createDescription` 实现；旧记法的 200 字符是错的，实为 50 且在快照里是死代码）、`UISettings.sortBookmarks` 的"按加入顺序"排序（`:141-150` 的另一支）、`addFileBookmark`（`:120-125`） |
| `BookmarksListener` | `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarksListener.java` | `[~]` | 事件面（`:10-16` 的 added/removed/changed/orderChanged）在本仓是 Vue 响应式：书签表一变，面板、装订线图标（`src/editorGutterIcons.ts`）与跳转动作自己跟着重算；**缺** 给他人用的监听接口（本仓没有插件，也没有第二个消费者需要订阅） |

**四档合计**：`[x]` 0 + `[~]` 5 + `[ ]` 0 + `[-]` 0 = 5。
