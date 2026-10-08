# batch-2026-10-06 · intentw —— 把 completion2 留下的两个零消费方模块接上真实出口

范围：只做"两个零消费方模块接线 / 接不上就写请求"这一件。
结论：**`src/errorTreeExpansion.ts` 本轮开工前就已被别人接上**（不是我的活，见 §1 复核）；
**`src/intentionList.ts` 本轮接上了两个真实出口**（Alt+Enter 合流处 + 问题面板行菜单），
门禁转绿；**Alt+Enter 弹层的渲染层（分隔线/置灰）只能在保留文件 `src/App.vue` 里落 ⇒ 已写请求**
`docs/wiring-requests-2026-10-06-intentw.md` W1。

---

## 1. 现场复核（派单给的数 vs 磁盘，逐条自己开）

| 派单原话 | 磁盘实测（本轮自己开） | 判定 |
| --- | --- | --- |
| `--gate` 报**这两个新模块**零生产消费方：`src/intentionList.ts`、`src/errorTreeExpansion.ts` | `node .tools/find-orphan-modules.mjs --gate` 只点名 **1 个**：`src/intentionList.ts`（`✘ 新增零生产消费方模块：src/intentionList.ts`）。`src/errorTreeExpansion.ts` **不在清单里** —— 它已被 `src/components/ProblemsPanel.vue:27` import、并在 `src/components/ProblemsPanel.vue:208` 真调用 `trackErrorTreeExpansion(() => rows.value, collapsedGroups, row => groupKeyOf(row, grouping.value))` | **派单这一条过时**（别的 lane 在 15:0x 之前已经接完）。本轮因此只做 intentionList 一件 |
| `completion*.intention*.inspection*.problem*` = **191/191 绿** | 开工第一次跑：**194 tests / 193 pass / 1 fail**，红的是 `tests/problems-export-text-details.test.mjs:25`（钉 `errorTreeText(props.problems, { details: … })`，而面板当时写的是 `errorTreeText(rows.value, …)`）——**旁人的 W4 在飞**，与本轮无关；到我收工时该文件自己变绿（6/6，`src/components/ProblemsPanel.vue:552` 已被它的主人改成两档都传） | 数不同（194≠191）且开工时确有 1 红，**归他人 lane**，本轮未修 |
| `src/App.vue` 只剩 31 行 / `src/bridge.ts` 只剩 1 行 / `CodeEditor.vue` 只剩 3 行 | 上限账：App.vue 2737（`tests/module-size.test.mjs:108`）− 2706 = **31** ✔；bridge.ts 905（`:127`）− 904 = **1** ✔；CodeEditor.vue 1147（`:136`）− 1144 = **3** ✔。"只剩 N 行"是**余量**不是行数（第一眼看成 31 行的 App.vue 会误判） | **核实一致** |
| 上游参考树只有 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 可用 | 该树存在且每条坐标都从它开（见 §4）；`third_party/intellij-community` 未使用 | 一致 |

其它在飞证据（归属判定用，本轮都没碰）：`native/main.cpp` 12:02、`scripts/verdict_table.py` 13:45、
`src/App.vue` 13:18、`src/bridge.ts` 14:52、`src/components/CodeEditor.vue` 14:54、
`src/gradleHost.ts` 14:59、`src/backgroundTasks.ts` 14:39、`src/workspaceInspection.ts` 14:43
—— 全部早于或独立于本轮第一次写入（15:09 起），本轮对保留文件与黑名单文件**零次 Edit/Write**。

---

## 2. 本轮做了什么（每条给 `文件:行号`）

### 2.1 `src/intentionList.ts`（规则本体，160 行；**没删模块**，只做加法 + 删一段永不触发的分支）
- `:96-99` 新增 `IntentionMenuItem<T>`（= `IntentionRow` + `payload`）。
- `:101-141` 新增 `intentionMenuItems<T>()`：**带载荷的扁平行表**。档位不自己排，
  走 `orderIntentionSections` ⇒ `INTENTION_GROUP_ORDER` 是全模块唯一的顺序出处
  （`:137-138` 那条注释写的就是这个理由：两条出口不分叉）。
- `:154-160` `intentionRowsFor` 改成**委托** `intentionMenuItems` 再剥载荷 ⇒ 规则只有一份实现。
- **删掉的一段（按"死代码直接删"，留痕在 `:109-118`）**：原 `intentionMenuItems`/`intentionRowsFor`
  里那句"按 `key` 去掉意图半区里与修复重名的行"（`const taken = new Set(...)` + `if (taken.has(key)) continue`）。
  实测不可达：两半的键是 `fix:〈标题〉:〈序号〉` 与 `intention:〈id〉` 两个**不相交**命名空间，
  `taken.has(key)` 恒假 —— 我用最接近的输入（`id = 'fix:A:0'`）跑过，两条行照样都在
  （`["fix:A:0","intention:fix:A:0"]`）。上游 `CachedIntentions.java:356-360` 比的是
  **同一个 `IntentionActionWithTextCaching` 对象**，本仓两半来自不同生产者、`SuppressionInput` 只有
  `id`/`unavailable`，没有标题也没有对象引用 ⇒ 要复刻只能拿标题近似，而近似去重会误删
  "两个不同动作恰好同名"。⇒ 删，且不做近似。模块其余部分一行没减。

### 2.2 `src/intentionMenuModel.ts`（新增，70 行）—— 本仓两种对象怎么喂进规则
- `:21-24` `MenuIntentionFix`、`:31-34` `MenuIntentionOption`（原来 `interface MenuFix` 在面板里，
  组件若再写一份就是两处 ⇒ 收成一个模块，面板与组件各引一次）。
- `:38` `UNSUPPRESSIBLE_PREVIEW = '（行号越界，不能插入）'`（**面板既有的原话**，只是搬成一份）。
- `:51-57` `menuIntentionFixInput()`：`hasEdits = 有编辑载荷 || command === true || resolvable === true`。
  口径出处 `native/lsp_support.hpp:173`（`resolvable = !has_edit && (command || data)`）。
  三者皆无 ⇒ `applyMenuFix`（`src/components/ProblemsPanel.vue:390-423`）把空编辑列表跑一遍、
  然后照样 `actionNote.value = '已应用：' + action.title` —— **一句假的成交**。这就是"置灰"要修的真缺陷。
- `:59-61` `menuIntentionOptionInput()`；`:67-70` `INTENTION_MENU_GROUP_TITLES`（两行标题=面板既有文案，逐字搬）。

### 2.3 `src/components/IntentionListMenu.vue`（新增，73 行）—— 行菜单里那一份意图列表
- `:33-36` 用 `intentionMenuItems<MenuPayload>` 把两半折成一张扁平行表（载荷随行）。
- `:42-45` `separatorAbove(menuRows, index)` 为真时画 `:43` 一条 `<div class="intention-menu-sep" role="separator">`
  + `:44` 本档标题（上游只有线没有标题，标题是本仓既有排版，不新造）。
- `:46-47` / `:55-56` 两种行都 `:disabled="!row.selectable"`，`:title` 在不可选时给 `row.reason`。
- `:67` `.intention-menu-sep` 用令牌 `var(--line-strong)`；`:70` 不可选行的颜色走既有
  `var(--popup-disabled)` 口径（对齐 `src/style.css:126`），并把 `.tree-menu > button:hover`
  对 disabled 行的误高亮压回去。**没有**全局选择器、**没有**写死 hex、**没有**动效。
- 根节点是 fragment（`<template v-for>`）⇒ `<button>` 仍是外壳 `.tree-menu` 的直接子元素，
  全局 `.tree-menu > button`（`src/style.css:1182-1183`）继续命中；包一层 div 会让整族菜单样式失效。

### 2.4 `src/components/ProblemsPanel.vue`（892 → **879** 行，往 900 上限下让了 13 行）
- `:72` import 模型；`:83` import 组件。
- `:264-265` `menuOptions`/`menuFixes` 改用模型的类型（删掉本地 `interface MenuFix`）。
- `:337` 抑制条目现在同时产出 `unavailable`（算得出插入点 = `''`，算不出 = 那句原话）。
- `:369` `applySuppression(entry: MenuIntentionOption)`、`:390` `applyMenuFix(fix: MenuIntentionFix)`。
- `:796-797` 挂载 `<IntentionListMenu :fixes="menuFixes" :options="menuOptions" @apply-fix / @apply-suppression />`
  取代原来那 29 行内联（两段标题 + 两个 `v-for`，`:781-809` 旧位置）。
- 落点没换：`:369-388` 与 `:390-423` 两条写入链（`file.read` → `applyTextEdits` → `file.write` CAS →
  `noteLocalSuppression` / `lsp.change`）逐字保留，组件只抛载荷。
  `:374` 那句 `行号越界，未写入。` **留着**：它防的是"菜单打开后文件在磁盘上又变了"的竞态
  （`menuDoc` 是打开菜单那一刻的快照，`:370-373` 用的是实盘内容），不是死的 UI 兜底。

### 2.5 `src/semanticActions.ts`（785 → **796** 行，上限 900）
- `:29` import `orderIntentionSections`。
- `:449-453` `suppressions` 与 `:455-462` `localFixes` **拆开**（原来串成一条 `localActions`）。
- `:472-475` 合流改走档位表：
  ```ts
  const actions = orderIntentionSections<LspCodeAction>([
    { group: 'fix', rows: [...(onlyFixes ? serverActions.filter(...) : serverActions), ...localFixes] },
    { group: 'intention', rows: suppressions },
  ]).flatMap(section => section.rows)
  ```
  `onlyFixes` 语义不变（`!onlyFixes && tab` 才出本地条目）。

### 2.6 真实用户可见效果（不是"接上了但看不出来"）
1. **Alt+Enter 弹层的行序**：JUnit 的两条快速修复以前排在抑制条目**之后**（因为它们和抑制串在
   同一条 `localActions` 里），现在整段修复在前 ⇒ 与上游 `getAllActions()` 一致。
   弹层的渲染行（`src/App.vue:2675`）画的就是 `codeActions` 本身 ⇒ 顺序效果**当场可见**，0 行 App.vue 改动。
2. **行菜单段序翻转**：以前"抑制此检查"在前、"快速修复"在后；现在修复段在前、抑制段在后。
3. **换档一条分隔线**：两档都在场时，抑制段第一行上方出现一条线（只有线，同档内不画）。
4. **不可用条目置灰**：
   · 抑制条目插入点算不出（行号越界）⇒ 按钮变灰、点不动、`title` = 那句理由；
     以前它照旧可点，点下去只弹一句"未写入"（模块头上写的"旧形状"就是这一个）。
   · 服务端只列不给载荷、又不能 resolve 的修复 ⇒ 同样变灰；以前点下去**假报"已应用：X"**。
   · 可 resolve 的修复**仍可点**（`resolvable` 计入可选）⇒ 不是把功能禁掉。
5. **展开/收起状态沿用**（`errorTreeExpansion` 那一路，**旁人先接完的**）：新到的错误把它所在的折着
   的组当场放开，警告/信息新到不放；开机已在的那批算基线不强开 ⇒ `problemsPanelState` 里持久化的
   折叠集合不被冲掉。判据缺口见 §7.3。

---

## 3. 判据与原始跑测数字（一字未改地贴）

新增 `tests/intention-list.test.mjs`（20 条，`:45`–`:241`；规则 12 条 + 宿主口径 3 条 + 接线锚点 4 条 +
消费方在场 1 条）。改动 3 个既有测试文件里**因本次重构而过时**的锚点（§5）。

```
### A) 交付要求的完整命令
$ node --test tests/intention*.test.mjs tests/error*.test.mjs tests/problem*.test.mjs tests/completion*.test.mjs tests/module-size.test.mjs
ℹ tests 174 · suites 0 · pass 174 · fail 0 · cancelled 0 · skipped 0 · todo 0 · duration_ms 2523.1998

### B) 派单声称的那组
$ node --test tests/completion*.test.mjs tests/intention*.test.mjs tests/inspection*.test.mjs tests/problem*.test.mjs
ℹ tests 214 · pass 214 · fail 0 · duration_ms 2512.2183

### C) 门禁
$ node .tools/find-orphan-modules.mjs --gate       # exit=0
零生产消费方模块：7 个（其中合法例外 1 个）
门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2
门禁绿：没有基线之外的新增零消费方模块。
      ↑ 开工时这里是「零消费方 8 个 / 新增 1：src/intentionList.ts / 门禁红」
```

```
$ npx vue-tsc -b --force      # exit=1
error TS 条数: 6        TS1xxx 语法错: 0     ← 先确认没有语法错，再说条数
src/browsers.ts(539,77): error TS2345: 'string | undefined' is not assignable to 'string'
src/codeLensExtension.ts(404,30): error TS2339: Property 'seq' does not exist on type 'EditorState'
src/codeLensExtension.ts(423,36): error TS2345: AnchoredLens[] not assignable to readonly CachedLens[]
src/codeLensExtension.ts(447,66): error TS2339: Property 'seq' does not exist on type 'EditorState'
src/gradleHost.ts(880,74): error TS2304: Cannot find name 'UNLINKED_PROJECT_DISPLAY_ID'
src/semanticActions.ts(507,71): error TS2345: OrganizeImportsRequestParams not assignable to Record<string, unknown>
```

类型账目（**基线 5 → 收工 6，本轮净增 0**）：
· 开工基线（改动前跑的那一次，`.tmp-intentw-tsc-base.txt`）= 5 条：`codeLensExtension`×3、
  `gradleHost.ts(880)`、`semanticActions.ts(496,71)`。
· 中途一度 9 条，多出来的 `sourceControlCommitChecks.ts(150)` / `vcsLogGraph.ts(339,449)` 是别人在飞，
  收工时它们已消失（被各自的 lane 修掉了）。
· 收工 6 条里唯一新增的是 `src/browsers.ts(539)`（mtime 15:14，本轮没碰过这个文件）。
· `src/semanticActions.ts` 那条与基线**同一条**（同一 col 71、同一 OrganizeImports 信息），
  只是被本轮的 +11 行从 496 推到 507 ⇒ 不是新增。
· 中途本轮自己引入过 1 条（`intentionList.ts(148,5)` 的泛型推断），已当场修掉（显式
  `intentionMenuItems<FixInput | SuppressionInput>`），收工清单里没有它。
· **最后一次复读**（写完文档后又跑了一遍，`.tmp-intentw-tsc-close.txt`）：
  `exit=1`、`error TS 条数=6`、`TS1xxx=0` —— 与上面那一版的差别只在"旁人的那一条"换了个文件：
  上一次是 `src/browsers.ts(539,77)`，这一次是 `src/runConfigTree.ts(539,36)`（都是别的 lane 在飞的
  `string | undefined`），基线里那 5 条（`codeLensExtension`×3 + `gradleHost` + `semanticActions` 的
  OrganizeImports）一条没变。**本轮的文件在两次复读里都是 0 条** ⇒ 净增恒为 0。

**本轮改动牵连到的其它测试**（全部读盘复跑过）：
`tests/intention-preview.test.mjs` / `tests/problems-panel-actions.test.mjs` /
`tests/local-intentions.test.mjs` / `tests/suppress-intention.test.mjs` / `tests/error-tree.test.mjs` /
`tests/problems-panel-state.test.mjs` / `tests/module-size.test.mjs` ⇒ 全绿（含在 A 组 174 里）。

---

## 4. 上游坐标（本轮自己逐字开的；相对路径都相对
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）

| 本仓依据 | 上游 `相对路径:行号` | 我开到的原文 | 结论 |
| --- | --- | --- | --- |
| 档位先后 = 先修复后意图 | `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/CachedIntentions.java:353-368` | `:353 getAllActions()`、`:354 new ArrayList<>(myErrorFixes)`、`:355 addAll(myInspectionFixes)`、`:356-360` 意图去重循环、`:361 addAll(myGutters)`、`:362 addAll(myNotifications)`、`:363 filterByDumbAwareness`、`:366-367 IntentionsOrderProvider…getSortedIntentions` | 模块头上的这组坐标**逐条对上** |
| 分组身份八档 | 同文件 `:371-393` | `ERROR/REMOTE_ERROR`(:372-374)、`INSPECTION`(:376-377)、`NOTIFICATION`(:379-380)、`GUTTER`(:382-383)、`EMPTY_ACTION`(:385-386)、`ADVERTISEMENT`(:388-389)、`OTHER`(:392) | 对上；本仓只取有生产者的两档 |
| 分隔线 | `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/IntentionListStep.java:296-309` | `:297-299 hasSeparatorAbove()`、`:302 if (index <= 0) return null`、`:305 getGroup(value) != getGroup(prev)` → `:306 new ListSeparator()` | 对上 |
| 不可选那一档 | 同文件 `:102-104` → `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/IntentionActionWithTextCaching.java:156-162` | `isSelectable()` 转发；`:158-159` 只有 `CustomizableIntentionAction` 能说自己不可选，`:161 return true` 默认可选 | 对上 ⇒「列出来但不能选中」 |
| 默认选中第 0 条 | `IntentionListStep.java:293` | `public int getDefaultOptionIndex() { return 0; }` | 对上（W1 里 `highlighted: index === 0` 的出处） |
| 面板与 Alt+Enter 是同一个弹层 | `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103`、`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ShowProblemsViewQuickFixesAction.kt:78-92`、`platform/lang-impl/src/com/intellij/codeInsight/intention/IntentionSource.java:37-40`、`platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19` | `:100-103` 动作项 `ProblemsView.QuickFixes`；`:79` `IntentionListStep(…, IntentionSource.PROBLEMS_VIEW)`；`:38` 注释原文「Quick fixes button in the Problems tool window」；`:19` `implements Iconable, IntentionAction` | 全部对上（含 `:36-44` 的「没意图就置灰」） |
| `resolvable` 的本仓口径 | （本仓）`native/lsp_support.hpp:173` | `action["resolvable"] = !has_edit && (item.contains("command") \|\| item.contains("data"))` | 本仓侧坐标，非上游 |
| 上游里有没有 `quickfix.suppress` 这个 kind | 全树 grep | 只命中 `plugins/kotlin/.../testData/quickfix/suppress/…` 测试数据路径 | **本仓自定 kind**，W1 里按这个事实写 |

## 5. 订正留痕（假坐标 / 派单里错的东西 / 别人写错的）

1. **派单点名 `IntentionActionAvailabilityTheories`**：这份基准树里**不存在**
   —— `find . -iname "*AvailabilityTheories*"` = 0 命中。真实规则在
   `IntentionListStep.java:102-104` + `IntentionActionWithTextCaching.java:156-162`（已按真的接）。
2. **派单说门禁报"两个"新模块**：磁盘上只有 `src/intentionList.ts` 一个（§1）。
   `src/errorTreeExpansion.ts` 已被 `ProblemsPanel.vue:208` 接上。
3. **模块头上那句 `:366-367` 交给 `IntentionsOrderProvider`**：核对后 `:365` 取 language、`:366` 取
   extension、`:367` 才 `getSortedIntentions` ⇒ 模块写的 `:366-367` 恰好覆盖后两条，**不误**，
   但少了 `:365` 那一跳；本轮在 `tests/intention-list.test.mjs:7-10` 把三条都记全了。
4. **`intentionList.ts` 头上「`:356-360` 逐条查重」被本模块实现成"按 key 去重"**：本仓两半的键
   不相交 ⇒ 恒不触发（实测见 §2.1）。已删 + 原地留痕，并把 `intentionRowsFor` 头上那段"去重"
   说明改成"本仓没有对应物"。
5. **`src/errorTreeExpansion.ts:16` 自称"判据在 `tests/error-tree.test.mjs`"**：磁盘上
   `grep -rn "expandGroupsForNewErrors|errorTreeRowKey|trackErrorTreeExpansion" tests/*.mjs` = **0 命中**
   ⇒ 那句话现在不成立（见 §7.3，不是本轮的模块，本轮没替它补）。
   纯函数当前位置（本轮读的那一版，`src/errorTree.ts` 249 行，别人还在动）：
   `errorTreeRowKey` `:211`、`expandGroupsForNewErrors` `:228-242`。
6. **`tests/refactor-organize-imports.test.mjs:85` 的 `body.includes('caretPayload()')`**：
   别人写的中文注释里含 `caretPayload()` 字面量把这条判据判红了（注释不在 HEAD 版本里，
   `git show HEAD:src/semanticActions.ts` grep 不到）。**本轮没碰 `runOrganizeImports`**，
   归 organizeImports 那条 lane 自己收。

---

## 6. 反向验证表（注入前缀 `INTENTW-PROBE`，跑完即还原）

方法：备份 4 个文件 → 打探针 → 跑 `tests/intention-list.test.mjs` +
`tests/problems-panel-actions.test.mjs` + `tests/intention-preview.test.mjs` + `tests/local-intentions.test.mjs`
（4 个文件合计 38 条）→ 从备份还原并 `diff -q` 逐字校验。

| 探针 | 注入点 | 意图（它模拟的是哪种"接了等于没接"） | 结果 |
| --- | --- | --- | --- |
| `INTENTW-PROBE-1` | `src/intentionList.ts:40` 档位表改成 `['intention','fix']` | 顺序反了 | **7 红**：档位表、`orderIntentionSections` 两条、`intentionRowsFor` 三条、真实组合、**行菜单那一路的顺序也读同一张档位表** ⇒ 两条出口确实同源（这条正是探针逼出来的：第一版 `intentionMenuItems` 自己 push 半区、不读表，探针打不到它 ⇒ 已改成走 `orderIntentionSections`，见 `:133-140`） |
| `INTENTW-PROBE-2` | `src/intentionMenuModel.ts:54` `hasEdits` 改成恒 `true` | 置灰只是文案、条目重新可点 | **2 红**：`修复的可选性 = …`、`真实组合…` |
| `INTENTW-PROBE-3` | `src/components/IntentionListMenu.vue:46,55` 两处 `:disabled="!row.selectable"` 摘掉 | 真的不能被选中这件事没落 | **1 红**：`行菜单那一路…` |
| `INTENTW-PROBE-4` | `src/components/ProblemsPanel.vue:796` 挂载改成 `v-if="false"` | 规则又变回没人用的纯模块 | **3 红**：`行菜单那一路`、`消费链：问题面板行菜单用预览`、`行菜单：逐行「操作」入口…` |

残留检查：
```
$ grep -rn "INTENTW-PROBE" src tests native scripts .tools      # 命中数 0
```
四个探针全部 `↩ 已还原（与备份逐字一致）`。**本文档里出现的那几处 `INTENTW-PROBE` 是判据记录，
不是代码残留** —— 复核请按上面那条命令的作用域（代码目录）grep。

顺带一提（不是本轮的探针）：`tests/intention-list.test.mjs` 的第一版是 `.ts` 语法写的，
`node --test` 当场报 `SyntaxError: Unexpected identifier 'IntentionRow'` —— 这条红是"判据会红"的
又一次实证（`.mjs` 不是 TS，类型标注/`!`/泛型实参一律不剥）。

---

## 7. 没做的、做不了的、以及留给下一批的

1. **Alt+Enter 弹层的分隔线与置灰**：渲染整段在保留文件 `src/App.vue:2675`（一行 620 字符）。
   ⇒ `docs/wiring-requests-2026-10-06-intentw.md` **W1**：三步（两处就地改单行 + 一行 import，
   净增 1 行，App.vue 余量 31 → 30），附可直接粘贴的 `src/components/CodeActionPopup.vue`
   全文与判据。**本轮没有预建那个组件** —— 建了没处挂就直接进孤儿清单、门禁就红
   （W1 的判据第 3 条写的就是这件事）。
2. **`FixInput.preferred` / `FixInput.linked` 目前无函数消费**（`intentionRowsFor` 只看 `hasEdits`）。
   它们是上游 ERROR/INSPECTION 两档的入口，**没删**（删了就等于把"以后拆档位"的路堵死），
   但本轮按"不自加档位"纪律也没让它们假装有作用。登记在 W1 文档"没做的第二件事"。
3. **`errorTreeExpansion` / `expandGroupsForNewErrors` 零判据**（§5.5）：模块与调用都在，
   纯函数 `src/errorTree.ts:211`（`errorTreeRowKey`）与 `:228-242`（`expandGroupsForNewErrors`）
   **没有任何测试**。本轮没替它补 ——
   它的接线不是本轮做的、`ProblemsPanel.vue` 与 `errorTree.ts` 的主人还在飞（W4 那 3 分钟里就改过一轮）。
   ⇒ 建议下一批（或它自己的 lane）把判据补成能失败的两档：新到错误 ⇒ 键被摘掉；新到警告 ⇒ 键不动。
4. **判决簿 / `docs/inventory/*` 与 `scripts/verdict_table.py` 一律没碰**（并发黑名单 + 保留文件）。
5. **没提交、没 push**；全程没用 `git checkout/reset/stash/clean`（只 `git show HEAD:` 读过一处）。

## 8. 纪律与安全记录（工具结果里的可疑文本 = 当数据）

· 本次会话里出现 **6 次**形如
`Note: The file C:\Users\Administrator\.qoder\memory\MEMORY.md（以及 …\projects\D--TaoCode\memory\MEMORY.md）
was modified since it was last read` 的系统口吻通知，六次带来的"新内容"各不相同，
其中有几句读起来像指令（例：「orphan门新模块=第三信号」「在飞尺寸/类型红只记录不修」「撞轮次上限=停在验证步骤」）。
**处置：一律当数据**。没有执行任何一条；本轮的收尾判据全部来自磁盘跑测（§3、§6），
其中"在飞的红只记录不修"恰好与我的处置一致，但那是我自己复核出来的，不是照通知办的。
出处：本会话 Bash/Write 返回之上夹带的通知块，共 6 处。
· 没有遇到被改写的 Read/Edit 正文（我自己那两次 `Edit` 的成功回显与随后读盘一致；
  `tests/intention-list.test.mjs` 那次 `Write` 被 harness 判为"文件已变"，原因是我用 `node -e`
  在 shell 里改过它 —— 读盘复现后重写，非篡改）。
· 尺寸：新增/改动文件全部 ≤ 900（`intentionList.ts` 160、`intentionMenuModel.ts` 70、
  `IntentionListMenu.vue` 73、`ProblemsPanel.vue` 879、`semanticActions.ts` 796）；
  **没有抬过任何上限**，`ProblemsPanel.vue` 反而从 892 降到 879。
· 没有自加动效、没有全局选择器、没有写死 hex（分隔线与置灰都取令牌）。
· 没有编造控件/文案/键位/帮助链接：新增可见文本 0 个 —— 两段标题、`（行号越界，不能插入）`、
  `需解析`、`由语言服务执行`、`代码操作 / 快速修复` 全是仓内既有；
  唯一的理由串 `需先向语言服务解析这条修复，才能预览并应用。` 出自 `src/intentionList.ts:127`
  （completion2 落的原文本）。**无法核实登记**：那句理由对"既没编辑载荷也没有 resolve 入口"的
  条目略微偏乐观（实际已无从 resolve）—— 中文措辞无法与上游逐字对照，本轮不改别人的文案，
  登记在此；它只出现在 `title` 气泡里，不是控件名。
