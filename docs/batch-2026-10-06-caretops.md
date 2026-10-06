# 2026-10-06 · 行操作与多光标一组（caretops）

派单依据：`docs/inventory/verdict-editor.md` §C-优 第 ③ 条（排序行 / 删除重复行 / 反串行）与第 ⑥ 条
（clone caret 上下）。上游基准 = 本地 `intellij-community-master`，每条结论都给「上游相对路径:行号」。
本批**没有动** `src/App.vue`（按派单要求），要挂到保留文件的东西全在
`docs/wiring-requests-2026-10-06-caretops.md`。

## 一、族：编辑器行操作（上游 `AbstractPermuteLinesHandler` 一家）

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 说明 |
|---|---|---|---|---|
| `EditorSortLines` | `[x]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/SortLinesAction.java:14；骨架 platform/platform-impl/src/com/intellij/openapi/editor/actions/AbstractPermuteLinesHandler.java:18-101；注册 platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:262；菜单 platform/platform-impl/resources/idea/PlatformActions.xml:238、:495；文案 platform/platform-resources-en/src/messages/ActionsBundle.properties:173 | src/editorLineOps.ts:91（纯规则）、:199（命令）、src/editorCommands.ts:221、src/menus/editMenu.ts:128 | `Arrays.parallelSort` = 字符串自然序 ⇒ 本仓 `compareLinesNatural` 按 UTF-16 码元比：**大小写敏感**（`B` 排在 `a` 前）、**不 trim**（`' z'` 排在 `zz` 前）、等值行保持原次序（稳定） |
| `EditorUniqueLines`（界面上叫 **Delete Duplicate Lines**） | `[x]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/UniqueLinesAction.java:13-18；注册 …intellij.platform.ide.impl.actions.xml:264；动作组 …/idea/PlatformActions.xml:240；文案 platform/platform-resources-en/src/messages/ActionsBundle.properties:175 | src/editorLineOps.ts:98、:200、src/editorCommands.ts:221、src/menus/editMenu.ts:135 | `HashSet.add` 失败 ⇒ 该行置 null 后压缩 ⇒ **保序、留第一次出现、不排序**；整行相等才算重复（大小写/空白敏感） |
| `ReverseLinesAction`（`EditorReverseLines`） | `[x]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/ReverseLinesAction.java:11-19；注册 …intellij.platform.ide.impl.actions.xml:263；菜单 …/idea/PlatformActions.xml:239、:496；文案 platform/platform-resources-en/src/messages/ActionsBundle.properties:174 | src/editorLineOps.ts:111、:201、src/editorCommands.ts:221、src/menus/editMenu.ts:129 | 原地首尾交换 = 整段倒序 |
| 三条共用的「作用范围 / 落点」规则 | `[x]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/AbstractPermuteLinesHandler.java:88-98（取行）、:36-39（不含分隔符）、:71（写回区间）、:72-76（有选区：整块重选）、:77-84（无选区：光标跟着原来那一行走） | src/editorLineOps.ts:65（`permuteTargetRange`）、:147（`placePermutation`） | **无选区时作用范围是整篇文档**，不是当前行；块内不足两行 ⇒ `getTargetLineRange` 返回 null ⇒ 动作不可用，本仓命令相应返回 false（不吞键）；多光标时上游只用主光标（`:26`），本仓同样按 `selection.main` 走一次 |
| `EditorTranspose`（同族的下一条，`PlatformActions.xml:497`） | `[ ]` | platform/platform-impl/resources/idea/PlatformActions.xml:497 | — | 派单没点名，本批未做；菜单位置（反串行之后）已留好插入点 |
| `FillParagraph` | `[x]`（本仓已有，非本批） | …/idea/PlatformActions.xml:494 | src/editorFillParagraph.ts + src/menus/editMenu.ts:120 | 上一批已落，这里只是把它当作排序/反串两行的定位锚 |

## 二、族：多光标 clone（上游 `CloneCaretActionHandler` 一家）

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 说明 |
|---|---|---|---|---|
| `EditorCloneCaretAbove` | `[x]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretAbove.java:8-11；platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretActionHandler.java:24、:56-102；platform/platform-impl/src/com/intellij/openapi/editor/impl/CaretImpl.java:845-893；注册 platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:219；动作组 platform/platform-impl/resources/idea/PlatformActions.xml:200；文案 platform/platform-resources-en/src/messages/ActionsBundle.properties:121-122 | src/editorCaretClone.ts:117（`cloneCaretPlan`）、:183（命令）、src/editorCommands.ts:236、src/menus/editMenu.ts:178 | 本仓早有 `cursor.above`，但挂在 CodeMirror 的 `addCursorAbove` 上（按视觉行、`view.moveVertically` 要真 EditorView、反向再按继续往外长）。本批换成上游口径：逻辑行 ±1、列位按目标行截断、选区两端各挪一行、**反方向再按一次收回最外圈**（`:76-81` 的 `removeCarets`）、到顶/到底返回 null。命令名没改 ⇒ 冻结的 `src/components/CodeEditor.vue:865-866` 键位表不用动就拿到新语义 |
| `EditorCloneCaretBelow` | `[x]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretBelow.java:8-11；其余同上（注册 :218、动作组 :199、文案 :119-120） | src/editorCaretClone.ts:185、src/editorCommands.ts:236、src/menus/editMenu.ts:179 | 镜像 |
| 「重复按同一个键继续加光标」 | `[x]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretActionHandler.java:64-78（`LEVEL` 用户数据 + 取 |level| 最大那一圈）、:108-127（`isRepeatedActionInvocation`） | src/editorCaretClone.ts:88（`travelDirection`）+ tests/editor-caret-clone.test.mjs 的「重复按同一个键」「反方向再按一次」两条 | 上游把 level 挂在 caret 的 user data 上；本仓拿不到 per-caret 挂载点（装 StateField 要改保留文件 `CodeEditor.vue` 的扩展表）⇒ 改成**从选区形状推出同一条链**：一行一个光标 + 行号连续 + 列位对得上同一个原始列（或被行尾截断）+ 主光标在最外圈。这条判据在同一条克隆链上与 `:66-76` 的取值等价；不满足就按首次调用（level 全 0 ⇒ 每个光标各克隆一次） |
| 光标数上限 | `[x]` | platform/platform-impl/src/com/intellij/openapi/editor/ex/util/EditorUtil.java:1381-1390（`checkMaxCarets`）；默认值 platform/util/resources/misc/registry.properties:484（`editor.max.caret.count=1000`） | src/editorCaretClone.ts:38、:127 | 到顶就不再新增（`plan` 返回 null），不静默截断到别的行 |
| `addCaretsOnDoubleCtrl`（双击 Ctrl 那一族加光标） | `[-]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretActionHandler.java:51-54、:119-123（`isRunningAction` 的修饰键双击派发） | — | 具体理由：那是 `ModifierKeyDoubleClickHandler`（平台键盘派发层）+ `EditorLastActionTracker` 的组合，本仓没有「修饰键双击」这条派发链路，也没有全局的「上一个动作 id」记录；造它等于放假状态 |
| `EditorAddCaretPerSelectedLine`（同族剩的最后一条，有真键位） | `[ ]` | platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54；注册 platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:358；菜单 platform/platform-impl/resources/idea/PlatformActions.xml:487；键位 platform/platform-resources/src/keymaps/$default.xml:155-157（**Shift+Alt+G**）；文案 platform/platform-resources-en/src/messages/ActionsBundle.properties:130 | — | 派单没点名（判词里属 C-优 第 ⑥ 条的另一半）。上游键位事实已核好，留给下一轮 |

## 三、改动清单

- 新增 `src/editorLineOps.ts`（201 行）：`permuteTargetRange` / `compareLinesNatural` /
  `sortPermutation` / `uniquePermutation` / `reversePermutation` / `placePermutation` 六个纯规则 +
  `sortLinesCommand` / `uniqueLinesCommand` / `reverseLinesCommand` 三条命令。
- 新增 `src/editorCaretClone.ts`（185 行）：`lineAt` / `offsetAtColumn` / `cloneCaretPlan` 纯规则 +
  `cloneCaretAboveCommand` / `cloneCaretBelowCommand`；`MAX_CARET_COUNT = 1000`。
- 改 `src/editorCommands.ts`：表里新增 `line.sort` / `line.reverse` / `line.unique`；
  `cursor.above` / `cursor.below` 的实现从 CM 的 `addCursorAbove`/`addCursorBelow` 换成本仓的两个命令；
  不再从 `@codemirror/commands` 引这两个名字。
- 改 `src/menus/editMenu.ts`：EditSmartGroup 的尾巴（紧跟「填充段落」）加三行 ——
  排序行 / 反串行 / 删除重复行，**键位栏全留空**（`$default.xml` 里没有这三条的绑定）。
- 新增 `tests/editor-line-ops.test.mjs`（22 条）、`tests/editor-caret-clone.test.mjs`（14 条）。
- 消费链路：命令表 `src/editorCommands.ts` ← `src/components/CodeEditor.vue:865-866` 的键位与
  `src/menus/editMenu.ts` 的菜单行；菜单行又经 `src/menuUi.ts:322` 的 `findMenuRow` 进「查找操作」索引
  ⇒ 没有只过自己测试的死模块（`find-orphan-modules --gate` 新增 0）。

## 四、验证数字

| 门 | 结果 |
|---|---|
| `node --test tests/editor-*.test.mjs tests/module-size.test.mjs` | **329 tests / 329 pass / 0 fail**（本批新增 36 条：行操作 22 + 克隆光标 14） |
| `npx vue-tsc -b --force` | **0 错** |
| `node .tools/find-param-props.mjs` | 共 0 处参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | 干净：tests/*.mjs 全部是纯 JavaScript |
| `node .tools/find-missing-ext.mjs` | 干净：没有漏扩展名的相对 import |
| `node .tools/find-orphan-modules.mjs --gate` | 门禁绿：已登记孤儿 8 / 基线 8 / **新增 0** |
| `node --test tests/source-citations.test.mjs` | 3 tests / 3 pass / 0 fail（仓里每一条带路径的上游引用都指得到） |

未跑全量 `npm test`（派单要求在收口方跑）。既有断言**一条都没放松**。

## 五、反向验证记录（新门禁都会红）

| # | 注入的违规 | 结果 | 撤掉后 |
|---:|---|---|---|
| 1 | `src/menus/editMenu.ts:128` 给「排序行」编一个没注册过的加速键 `'Ctrl Alt Shift S'` | `tests/editor-line-ops.test.mjs` **22 条里 1 红**：`门禁：这三行不许带没注册的加速键` → 「菜单行 line.sort 写了加速键「Ctrl Alt Shift S」，但本仓键位面里没有它」 | 22/22 绿 |
| 2 | 删掉「删除重复行」那一整条菜单行（命令留在表里） | `tests/editor-line-ops.test.mjs` + `tests/editor-commands.test.mjs` **31 条里 3 红**：`接线：三条命令在命令表里，且菜单行指向它们`、`门禁：这三行不许带没注册的加速键`、既有那条 `every name the menus offer is either an editing command or owned by the editor`（「命令表里有菜单到不了的项：line.unique」） | 31/31 绿 |
| 3 | 把 `src/editorCaretClone.ts` 头里的 `CaretImpl.java:845-893` 改成 `845-9999` | `tests/editor-caret-clone.test.mjs` + `tests/source-citations.test.mjs` **17 条里 2 红**：`落点留痕：模块头引了 …`、既有那条 `仓里每一条带路径的上游引用都指得到` | 17/17 绿 |

## 六、做不到 / 无法核实 / 与上游有意的差异

1. **中文文案无法核实**：本地参考树 `intellij-community-master` 里没有随 IDE 发货的中文包
   （`plugins/localization-zh` 不在 community 源里，实测 `plugins/` 下无该目录）。
   三条新菜单行的中文（排序行 / 反串行 / 删除重复行）是
   `platform/platform-resources-en/src/messages/ActionsBundle.properties:173-175` 英文原文的直译，
   注释里已写明「不假称取自某个中文行号」。有中文包的话请改成官方译名。
2. **上游 `:73` 在去重删行时疑似 off-by-N**：`AbstractPermuteLinesHandler.java:73` 用**旧的** `endLine + 1`
   去索引**写回后**的文档；`nulls != 0`（去重删过行）时这个索引会落到块内。
   本仓按「块的下一行行首」实现（`nulls == 0` 时两者完全一致），差异写在 src/editorLineOps.ts:147-152。
3. **克隆链的 level / 原始列**：上游放在 caret 的 user data（`CloneCaretActionHandler.java:25`、
   `CaretImpl.java:888-893`）上；本仓没有 per-caret 挂载点（要装 StateField 得改保留文件
   `src/components/CodeEditor.vue` 的扩展表），改成从选区形状推出（src/editorCaretClone.ts:88 的注释）。
   已知不等价的一种形状：链上**每一行**都比原始列短时，原始列只能近似成「链上出现过的那一列」。
4. **`targetCaret != null` 那一支（`CloneCaretActionHandler.java:58-63`）何时发生 —— 无法核实**：
   我没读 `EditorActionDelegateWrapper`，只确认了 `CloneCaretActionHandler` 继承的是 `EditorActionHandler`
   而非 `ForEachCaret`（`:24`），键盘路径因此走 `:64-101` 的层级逻辑；本批实现按这一支对齐。
5. **收回最外圈之后谁是主光标 —— 上游未逐行核实**：`CaretModelImpl.removeCaret` 里主光标归属我没读，
   本仓取「离被删那圈最近的一个（新的最外圈）」，只保证不会退化成 0 个光标（src/editorCaretClone.ts:131-136）。
6. **`$default.xml` 里没有这三条行操作的键位**（全树只有 `platform/platform-resources/src/keymaps/Sublime Text.xml:105`
   给 `EditorSortLines` 绑过键）⇒ 菜单行的键位栏留空；派单里提到的 `Ctrl+Alt+Shift+J` 经核是
   `SelectAllOccurrences`（`$default.xml:138-141`），本仓早已由 `occurrence.select` 承担，与本批无关。
7. 只读文档：本仓命令先挡 `state.readOnly`；上游由 `EditorWriteActionHandler` 兜，行为一致。
