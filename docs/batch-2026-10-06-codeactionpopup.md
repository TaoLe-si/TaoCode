# batch codeactionpopup — Alt+Enter 意图/快速修复弹层组件本体

日期：2026-10-06 · lane：`codeactionpopup` · 分支：`parity/rebuild-inventory`

## 0. 范围（一句话）

只交付 **组件本体 `src/components/CodeActionPopup.vue` + 模块侧数据形状**；
`src/App.vue` 那一行挂载**留给主代理**（本文件第 6 节给出可直接粘贴的请求）。

## 1. 现场判定（是否有半成品）

`grep -rn "CodeActionPopup|codeActionPopup|intentPopup|showIntentPopup" src/ tests/ docs/` 的命中**全在文档里，src/ 与 tests/ 零命中**：

| 命中处 | 是什么 |
| --- | --- |
| `docs/wiring-requests-2026-10-06-intentw.md:21-138` | `intentw` 那条 lane 写的 **W1 挂载请求**，里面贴了一份**可粘贴的草稿组件**（`:53-105`），但**文件从未落地** |
| `docs/batch-2026-10-06-intentw.md:231`、`docs/batch-2026-10-06-lane-board.md:393` | 同一件事的登记行 |

⇒ 不是"代码落了没报告"，是"报告落了没代码"。本轮把它落成真实文件，并按 §2 的核实结果**修掉草稿里的两处与上游不符之处**（见 §4）。

宿主现状（`grep -n` 逐字核对，不是照抄派单）：

- `src/App.vue` 实测 **2706 行**，`tests/module-size.test.mjs:107-108` 登记的上限是 **2737** ⇒ 余量 **31 行**（派单说的 30 少算了一行，以实测为准）。
- 弹层那一整行：**`src/App.vue:2675`**（约 620 字符，`v-for="(action, index) in codeActions"`、`highlighted: index === 0`、无键盘导航、不可选条目照旧可点）。外壳 `src/App.vue:2674` 是 `<div v-if="actionPrompt" class="modal-backdrop" @click.self="actionPrompt = null">`，**2674 这一行没有 `@keydown`**，而 `:2675` 的 `@keydown="trapFocus"` 在 `<section>` 上 —— 搬走 `<section>` 就把 `trapFocus` 一起搬没了，所以挂载请求必须带它（§6）。
- 真实出口名核对：`codeActions`（`src/App.vue:545` `const codeActions = ref<LspCodeAction[]>([])`）、`actionPrompt`（`:546`）、`applyCodeAction`（`:973` 从 `createSemanticActions` 解构出来、`:1391` 进 ctx）——**三个名字都真实存在**，`:2675` 正在用它们。

## 2. 上游核实（intellij-community 基准树，逐字开过）

基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（`third_party` 坏树未使用）。派单点名的四个候选，**两个不存在**：

| 派单给的候选 | 结果 | 依据 |
| --- | --- | --- |
| `ShowIntentionActionsHandler` | ✔ 存在 | `platform/lang-impl/src/com/intellij/codeInsight/intention/impl/ShowIntentionActionsHandler.kt`，452 行 |
| `HighSeverityQuickFix` 的排序与分组 | ✘ **无法核实** | 全树 `grep -rln HighSeverityQuickFix --include=*.java --include=*.kt` = **0 命中**；`platform/analysis-api/src/com/intellij/codeInspection/` 实际只有 `QuickFix.java` / `BatchQuickFix.java` / `LocalQuickFix*.java` / `SuppressQuickFix.java`。⇒ 本轮**不引用它**，排序按下面真实存在的三处 |
| `ActionIntentionAction` | ✘ **无法核实** | 同样 0 命中。同族真实存在的是**反向**适配器 `IntentionActionAsAction.kt`（AnAction → IntentionAction），不是"弹层里的一行" |
| `IntentionActionList` 一族（弹层里「更多/固定/设置」那一排） | ✘ **无法核实（不存在）** | `find platform -iname "IntentionActionList*"` = 0；`show.more` 在 `lang-impl/resources/messages/` 里唯一命中是 `BuildBundle.properties:10`（构建控制台 inlay，另一个面）；`IntentionHintComponent.java`(1070 行) 里带 `AllIcons.General.ArrowDown` 的那一排是 **gutter 灯泡** `LightBulbPanel`（`:619-687`），不是弹层里的行。⇒ 本组件**不做**「更多/固定/设置」三行中的任何一行 |

真实核实到的排序与分组（三条，够定形状）：

1. `CachedIntentions.java:353-368` `getAllActions()` —— 串联次序 `myErrorFixes` → `myInspectionFixes` → `myIntentions`（`:356-360` 同一对象不跨半区重复列）→ `myGutters` → `myNotifications`，`:363` dumb 过滤，`:366-367` 交给 `IntentionsOrderProvider.getSortedIntentions`。**本轮逐字重开，行号与 `src/intentionList.ts:6-10` 那份一致。**
2. `IntentionGroup.java:4-13` —— 八档带**优先级数值**：ERROR 30 / INSPECTION 20 / REMOTE_ERROR 10 / NOTIFICATION 7 / OTHER 0 / GUTTER −5 / ADVERTISEMENT −10 / EMPTY_ACTION −10。
3. **`DefaultIntentionsOrderProvider.java:20-32`（本轮新核实，之前无人登记）** —— 弹层里真正的次序不是"串联次序"，而是
   `sorted(weight desc, 然后 getText() asc)`；`weight = getGroup().getPriority() + PriorityAction 权重`
   （`:40-48` 与 `:56-63`：TOP +20 / HIGH +3 / LOW −3 / BOTTOM −20 / null 0）。

   ⇒ **登记一条本仓与上游不一致**：`src/intentionList.ts` 现在只做"档位先后 + 组内保持传入顺序"（`:50-57`、`:123-136`），**组内不按 weight、也不按标题字典序**。这条不一致**本轮不改**：`intentionList.ts` 的排序同时被 `src/semanticActions.ts:477-480`（Alt+Enter 合流）与 `src/components/IntentionListMenu.vue`（行菜单）消费，那两个文件都在本 lane 的只读黑名单里；而且本仓没有 `PriorityAction` 的对应物，硬做组内排序就得**编一个权重来源**（`FixInput.preferred` 是本仓既有的"在修一个问题"口径，但把它折成 +20/+3 的权重就是自加了）。留给有真输入的那一批。

键盘可达性（弹层是通用 `ListPopup`，意图面只提供 step）：

| 键 | 上游坐标 | 本组件 |
| --- | --- | --- |
| 初始选中 | `IntentionListStep.java:293` `getDefaultOptionIndex() { return 0; }`，但落地在 `ListPopupImpl.java:267-274` `selectFirstSelectableItem()`（`:330` 调用）——**跳过不可选项，选第一条 selectable** | ✔ 按这一条做（草稿按 `index === 0` 写死，会在"第 0 条不可选"时把高亮画在灰行上） |
| ↑ / ↓ | `ListPopupImpl.java:333` `ScrollingUtil.installActions(myList)` → `ScrollingUtil.java:348-349` `VK_UP`/`VK_DOWN` = SELECT_PREVIOUS/NEXT_ROW | ✔ 只在**可选行**之间移动；到端点不循环（同仓 `src/selectIn.ts:79-88` 的 `moveSelectIn` 既有口径） |
| Enter | `ListPopupImpl.java:337-341` `registerAction("handleSelection1", KeyEvent.VK_ENTER, 0, …)` → `handleSelect(true, …)` | ✔ 应用到宿主 `applyCodeAction` |
| Esc | `AbstractPopup.java:3038`（`VK_ESCAPE && getModifiers() == 0`） | ✔ **已有**：`src/App.vue:1954` 的 window 捕获期 `keydown` → `src/keymap.ts:223` `else if (actionPrompt.value) actionPrompt.value = null`。组件里**不再加**一个 Esc 分支（加了就是两条路关同一个弹层，且要多一个 emit） |
| ← / → | `ListPopupImpl.java:343-352`（Right = 子菜单/扩展按钮）、`:357-372`（Left = `goBack()`） | ✘ **不做**：子菜单要 `IntentionActionWithOptions` 那种"动作带子动作"的输入，本仓的载荷是 `LspCodeAction`（`src/bridge.ts:152`）—— **没有子动作字段**，画出来就是假控件 |
| Alt+Enter 重复触发循环下一条 | — | ✘ **无法核实（在这份基准树里不存在）**：`ShowIntentionActionsHandler.kt:327-368` 的 `invoke()` 通读，只有 `:340-344`（补全 Lookup 优先，转 `lookup.showElementActions`）与 `:352-355`（`HintManagerImpl.performCurrentQuestionAction()` 提前返回），**没有任何"上一次选中的动作/下一条"状态**；文件里 `grep -nE "repeat|next|cycle"` 无对应物 |
| 打字即过滤（speed search） | `IntentionListStep.java:318` `isSpeedSearchEnabled() true` + `:327-328` `getIndexedString = getTextFor` | ✘ **本轮不做**（真实存在但接不动）：过滤后 `separatorAbove` 判的是"当前列表里相邻两行的组变"（`IntentionListStep.java:300-305` 每次现算 `getValues()`），本仓 `separatorAbove`（`src/intentionList.ts:71-74`）吃的是**整张表**；要接就得先决定"过滤后第一段要不要线"，并新增一个过滤模块 —— 不在这个 lane 的范围内，且没有真判据我不敢写 |
| 助记符 | `IntentionListStep.java:311-312` `isMnemonicsNavigationEnabled() false` | ✔ 上游**关掉**了，本仓本来就没有 ⇒ 一致，不登记 |

## 3. 数据形状与判定源（新模块 `src/codeActionPopupModel.ts`，110 行）

Alt+Enter 这一路与行菜单那一路的**输入种类不同**，所以模型分开、规则不分开：

| | 行菜单（`intentionMenuModel.ts`，别的 lane 的） | Alt+Enter（本模块） |
| --- | --- | --- |
| 载荷种类 | 两种：`MenuIntentionFix`（带预览）+ `MenuIntentionOption`（带将插入的那一行） | **一种**：`LspCodeAction` —— 抑制条目在 `src/localIntentions.ts:106-121` 就已经被折成带 edits 的 codeAction |
| 规则来源 | `intentionMenuItems()` / `separatorAbove()`（`src/intentionList.ts`） | **同一份**，不复制 |
| 预览 | 有（宿主算好后传进来） | **没有**：弹层只在请求回来之后打开，`menuIntentionFixInput` 本身不读 `preview` 字段 ⇒ 传 `null` 是事实 |

出口（`src/codeActionPopupModel.ts`）：

- `SUPPRESS_ACTION_KIND = 'quickfix.suppress'` —— 全仓唯一生产者是 `src/localIntentions.ts:113`。**本仓自定的 kind，不是上游/LSP 串**（服务端给的是 `quickfix` / `source.*` / `refactor.*`）。
- `isSuppressionAction(action)` —— 意图半区**只有这一个判定源**，不按标题正则猜。
- `codeActionPopupRows(actions)` → `CodeActionPopupRow[] = IntentionMenuItem<LspCodeAction>[]`
  （key / group / selectable / reason + `payload` 就是那条动作本身）。
- `firstSelectableRow(rows)` → 第一条可选行的下标；**全不可选返回 `-1`**（上游 `ListPopupImpl.java:267-274` 那个循环此时什么都不设）。
- `moveRowSelection(rows, from, delta)` → ↑↓ 的落点，跳过不可选、**端点不循环**。

四条"这里没有东西"的登记（都属于"没有真判定源/真动作 ⇒ 不出现"）：

1. **抑制半区的 `unavailable` 恒为空串（= 可选）**，不是偷懒的默认值：`src/localIntentions.ts:105-106` 在算不出插入点时 `if (!edit) continue` ⇒ 越界的抑制条目根本进不到 Alt+Enter 的列表。置灰那一档在本仓只有行菜单有真实输入。
2. **子菜单（← / →）**：`LspCodeAction`（`src/bridge.ts:152`）没有子动作字段 ⇒ 上游 `IntentionActionWithOptions` / `hasSubstep()` 那一档在本仓**无输入**。
3. **速度搜索（打字过滤）**：上游真实存在（`IntentionListStep.java:318` + `:327-328`），但过滤会改掉 `separatorAbove` 判的"相邻两行的组变"（上游每次现算 `getValues()`，`IntentionListStep.java:300-305`），本仓那份吃整张表 ⇒ 要接得先新增过滤模块并决定"过滤后第一段要不要线"。没有真判据就不写。
4. **空态行（`.palette-empty`）**：`src/semanticActions.ts:481-486` —— 0 条走提示、1 条直接应用 ⇒ 弹层只可能在 **≥2 条**时打开，加空态就是假控件。

## 4. 组件本体（`src/components/CodeActionPopup.vue`，102 行）

不请求、不写盘、不解释动作：`props { actions, path }` → `emit('apply', action)`，落点还是宿主的 `applyCodeAction`（`src/semanticActions.ts:522`）。

对 `docs/wiring-requests-2026-10-06-intentw.md:53-105` 那份草稿的**三处修正**（草稿没落地过，所以是改需求不是改代码）：

| 草稿 | 本组件 | 依据 |
| --- | --- | --- |
| `:class="{ highlighted: index === 0 }"`（照抄旧 App.vue 那一行） | `highlighted: index === selected`，`selected` 初始 = `firstSelectableRow(rows)` | `ListPopupImpl.java:267-274` 选的是**第一条 selectable**；写死 0 会在"第 0 条不可选"时把选中底画在灰行上 |
| 只有鼠标（`@click`） | ↑ / ↓ / Enter 三档，根节点 `tabindex="-1"` + `nextTick(focus)` | `ListPopupImpl.java:337-341`（Enter）、`:333` → `ScrollingUtil.java:348-349`（↑↓）。焦点写法沿用本仓两个既有弹层（`TargetChooserPopup.vue:32`、`SelectInPopup.vue:23`） |
| 抑制行画成"照样可点、无置灰" | 与修复同一张表、同一个 `:disabled` 通道；理由进 `title` | 保持 `IntentionListStep.java:101-104` 的"列出来但不能选中"形状 |

样式纪律的落点：

- 只有两条 scoped 规则：`.code-action-sep`（`background: var(--line-strong)`，与 `IntentionListMenu.vue:67` / `.log-menu-separator` 同口径）+ `.code-action-row:disabled, .code-action-row:disabled:hover`（`color: var(--popup-disabled); background: transparent`）。
  第二条是**必需的**：全局 `src/style.css:1020` 的 `.palette-results > button:hover` 会把灰行照样点亮，读起来像"能点"（`IntentionListMenu.vue:69-71` 已经踩过并登记过）。
- 行的排版继续吃全局 `.palette-results > button`（`src/style.css:1019`），组件**不新增任何全局选择器**。
- 零硬编码 hex / 毫秒 / 贝塞尔、零 `transition` / `animation` / `@keyframes`、图标只从 `iconSize` 取（`:size="iconSize.toolbar"`，与旧行一致）。
- **一条 `watch(rows, …)`**：弹层开着的时候列表会被换掉（连按两次 Alt+Enter：`v-if="actionPrompt"` 不变、
  只换 `codeActions` ⇒ 组件**不重建**，`selected` 会指向一条已经不存在的行），选中要压回有效行。
  本仓既有写法 `SelectInPopup.vue:25-28`，上游对应 `ListPopupImpl.java:700-704`（模型 sync 之后重判选中）。
  这一条单独跑过注入（§5 的 F）。

## 5. 判据与门禁原始数字

判据文件：**`tests/code-action-popup.test.mjs`**（206 行 / 15 条）。分两组，证据等级写在文件头：

- **A 组 9 条 = 真执行**（`node --test` 直接 import `src/codeActionPopupModel.ts`）：档位顺序、kind 唯一判定源（含三条负例）、不可选三输入、抑制半区恒可选、v-for 键不撞、分隔线只在换档处、初始选中第一条可选、↑↓ 跳灰行且端点不循环、键盘落点与行表同源。
- **B 组 6 条 = 源码形状断言** ⇒ **没有真机渲染证据**（本仓 .mjs 门禁没有 DOM、没有 Vue 渲染器）。钉的是：组件确实调用那份规则与三个键盘落点、`highlighted` 不写死 0、`tabindex="-1"`+focus、不吃 Tab/Esc、样式纪律（无 hex/ms/贝塞尔/动效/全局元素选择器）、图标与文案沿用既有出口、假控件反向门禁（模板里不许出现「更多/固定/设置」、`<Pin|<Settings|<Gear|<MoreHorizontal`、←/→、filter、`palette-empty`）、不请求不写盘。
  真机验收（灰行发灰点不动 + 悬停出理由 + 换档有线 + ↑↓Enter 走得动）归 §6 挂载落地后的那一批。

### 注入 → 红 → 还原（判据能失败的正证）

一次注入 5 处（`CODEACTIONPOPUP-PROBE-A…E`），跑 `node --test tests/code-action-popup.test.mjs`：

| 注入 | 后果 | 红掉的判据 |
| --- | --- | --- |
| A `:disabled="!row.selectable"` → `:disabled="false"` | 灰行变成可点 | 「组件真的用那份规则与那三个键盘落点」 |
| B `firstSelectableRow(rows.value)` → `0` | 初始选中写死第 0 行 | 同上（同一文件内两条断言一起命中） |
| C 模板里加 `<span>更多</span>` | 假控件 | 「不放假的东西：…」（报的就是 `更多`） |
| D `.code-action-sep` 前加 `color:#ff0000; transition: all 200ms cubic-bezier(.4,0,.2,1)` | 硬编码 + 自加动效 | 「样式纪律…」 |
| E `moveRowSelection` 端点改成循环 | 自加没有判定源的规则 | 「↑↓ 跳过不可选的行，端点不循环」 |

注入后：**`pass 11 / fail 4`**。还原（`mv` 回备份）后：

```
sha1sum -c .tmp-cap-sha1-before.txt
src/components/CodeActionPopup.vue: OK
src/codeActionPopupModel.ts: OK
grep -rn "CODEACTIONPOPUP" src/ tests/ native/     → 零命中（exit=1）
node --test tests/code-action-popup.test.mjs       → pass 15 / fail 0
```

**注入往返之后组件又有意改了一次**（补上"弹层开着时换列表 ⇒ 选中压回有效行"那条 `watch`，见 §4），
所以那份 `.tmp-cap-sha1-before.txt` 现在对 `.vue` 报 FAILED 是**预期的**，不是残留：
`src/codeActionPopupModel.ts` 仍是 `OK`（`54f02e56…`），组件的当前指纹是

```
9807a3d2d6fa96c6231ca37b750f49d21c43fd5c  src/components/CodeActionPopup.vue   （收工实测）
54f02e560f130dd7410da12093492fa077941a26  src/codeActionPopupModel.ts
```

新加的那两条断言**也单独跑了一轮注入**（第 6 处，同一套纪律）：

| 注入 | 结果 |
| --- | --- |
| F 删掉整段 `watch(rows, list => …)` | `pass 14 / fail 1` —— 红的正是「组件真的用那份规则与那三个键盘落点」 |
| 还原（`mv` 回备份） | 组件 sha1 = `9807a3d2…` 与上面登记的当前指纹逐字一致；`grep -rn "CODEACTIONPOPUP" src/ tests/ native/` **零命中**；`pass 15 / fail 0` |

### 门禁原始数字

| 门禁 | 结果 |
| --- | --- |
| `node --test tests/intention*.test.mjs tests/code-action*.test.mjs tests/module-size.test.mjs` | **tests 50 / pass 50 / fail 0**（glob 实测命中：`intention-list` `intention-preview` `intention-settings` + `code-action-popup` + `module-size`；`tests/code-action*.test.mjs` 在落本文件之前是 0 命中） |
| `node .tools/find-missing-ext.mjs` | 干净（扫描 1386 个文件，「没有漏扩展名、且静态也解析不到的相对 import」） |
| `node .tools/find-param-props.mjs` | `共 0 处参数属性` |
| `npx vue-tsc --noEmit -p tsconfig.json` | **`error TS` 条数 = 0**（含新组件与 `CodeEditor.vue` 等全部 .vue） |
| `npx tsc --noEmit -p tsconfig.json` | 12 条 `error TS`，**本 lane 三个文件 0 条**：`src/toolViewContext.ts` 10 + `src/workspaceLifecycle.ts` 1 + `src/main.ts` 1（后两条是"裸 tsc 解析不到 .vue"，`toolViewContext.ts` 是在飞的别的 lane） |
| `node .tools/find-orphan-modules.mjs --gate` | **红，exit=1**：`已登记孤儿 6 / 基线 8 · 新增 1 · 本轮清掉 2` → `✘ 新增零生产消费方模块：src/components/CodeActionPopup.vue`。⇒ **必须与宿主那一行同批落**（§6），落完即回 `新增 0`。`src/codeActionPopupModel.ts` **没进**孤儿清单（组件已经 import 它），所以变红只有这一个点，也就只需要那一行 |

### 收尾复读（收工前又跑了一遍，两条数字要分开看）

| 组合 | 结果 |
| --- | --- |
| `node --test tests/code-action-popup.test.mjs tests/intention-list.test.mjs tests/intention-preview.test.mjs tests/intention-settings.test.mjs` | **45 / 45 / 0 fail** |
| `node --test tests/module-size.test.mjs` | **5 tests / 4 pass / 1 fail** —— 红的那条是 `已登记的 native 大文件不许继续变大`：`native/history.cpp` 935 行 > 上限 910。**不是本 lane 的**：`git status --short native/history.cpp` = `M`（别的 lane 正在写它，两次读到的行数还从 935 跳到 934），而 `native/**` 在本 lane 的禁写清单里。⇒ 按"在飞红只记录不修"处理，登记在此，等那条 lane 自己收 |


## 6. 宿主挂载请求（交主代理）

全文在 **`docs/wiring-requests-2026-10-06-codeactionpopup.md`**（三处要点：真实出口名、净行数、退化路径）。摘要：

- 宿主出口名逐个 `grep -n` 核过、**都真实存在**：`codeActions`（`src/App.vue:545`）、`actionPrompt`（`:546`）、
  `applyCodeAction`（`:973` 解构 / `:1391` 进 ctx / 本体 `src/semanticActions.ts:522`）；组件的
  `defineProps<{ actions, path }>` + `defineEmits<{ apply: [action: LspCodeAction] }>` 与它们一一对上。
- 目标行**已经不是派单说的 `:2675`**：落码期间 App.vue 从 2706 涨到 **2713 行**（别的 lane 在写它），
  弹层那一行现在在 **`src/App.vue:2682`**，余量 **2737 − 2713 = 24 行**。
- **净 +1 行**（一行换一行 + 一条 import）。余量真掉到 0 时的零行兜底：把 import 拼进既有那一行
  （`src/App.vue:125` 就是 `import A; import B` 两条挤一行的既有写法）。
- ⚠ **orphan 门要变绿必须与宿主同批落**：`node .tools/find-orphan-modules.mjs --gate` 现在是
  `新增 1 · ✘ src/components/CodeActionPopup.vue`（exit 1）。`src/codeActionPopupModel.ts` 不在清单里
  （组件已经 import 它），所以红点只有那一个 ⇒ 那一行落地即回 `新增 0`。**不要**为此抬
  `tests/module-size.test.mjs:108` 的 2737。
- 挂不上就**本轮不落**：弹层维持旧形状（换档无线、"服务端只列不给编辑"的条目照旧可点、
  没有 ↑↓/Enter —— 旧行只有 `@keydown="trapFocus"`，那是 Tab 焦点圈不是选行）。

## 7. 「无法核实」登记

一律**不编控件、不编快捷键、不编措辞**（本仓无 zh 本地化包 ⇒ 上游任何英文串都抄不到中文，
中文措辞只允许沿用本仓既有出口里已有的字）。

| 派单点名的东西 | 结论 | 依据 / 处置 |
| --- | --- | --- |
| `HighSeverityQuickFix` 的排序与分组 | **无法核实（类不存在）** | 全树 `grep -rln HighSeverityQuickFix --include=*.java --include=*.kt` = 0 命中；`platform/analysis-api/src/com/intellij/codeInspection/` 目录实测只有 `QuickFix.java` / `BatchQuickFix.java` / `LocalQuickFix*.java` / `SuppressQuickFix.java`。⇒ 排序改用真实存在的三处：`CachedIntentions.java:353-368` + `IntentionGroup.java:4-13` + `DefaultIntentionsOrderProvider.java:20-32` |
| `ActionIntentionAction` | **无法核实（类不存在）** | 0 命中；同族真实存在的是反向适配器 `IntentionActionAsAction.kt`，不是弹层里的行 ⇒ 不引用 |
| 弹层里「更多 / 固定 / 设置」那一排（`IntentionActionList` 一族） | **无法核实（不存在）** | `find platform -iname "IntentionActionList*"` = 0；`show.more` 在 `lang-impl/resources/messages/` 唯一命中是 `BuildBundle.properties:10`（构建控制台 inlay，另一个面）；`IntentionHintComponent.java:619-687` 那条带 `AllIcons.General.ArrowDown` 的是 **gutter 灯泡**、不是弹层行。⇒ 组件里三行一行都没做，并在 B 组判据里加了反向门禁 |
| **Alt+Enter 重复触发循环到下一条** | **无法核实（不存在）** | `ShowIntentionActionsHandler.kt:327-368` 通读：只有 `:340-344`（补全 Lookup 优先 → `lookup.showElementActions`）与 `:352-355`（`HintManagerImpl.performCurrentQuestionAction()` 提前返回），**没有任何"上一次选中的动作 / 下一条"的状态** ⇒ 不做 |
| 上游中文措辞（弹层标题、行内提示） | **无法核实（无 zh 包）** | 组件里的三段文案（`代码操作 / 快速修复`、`由语言服务执行`、`需解析`）与 `aria-label="代码操作"` **全部是从 `src/App.vue:2682` 原样搬过来的既有字**，不新造（判据钉着"丢了既有文案"） |
| 子菜单 ← / → | 上游**有**（`ListPopupImpl.java:343-352` / `:357-372`），本仓**接不动** | 载荷 `LspCodeAction`（`src/bridge.ts:152`）无子动作字段 ⇒ 无输入，不做 |
| 速度搜索（打字过滤） | 上游**有**（`IntentionListStep.java:318` + `:327-328`），本仓**本轮不接** | 过滤会改掉 `separatorAbove` 的"相邻两行组变"语义（上游每次现算 `getValues()`），要接需先新增过滤模块并决定"过滤后第一段要不要线"；无真判据不写 |
| 组内次序（weight 降序 + 标题字典序） | 上游**已核实**（`DefaultIntentionsOrderProvider.java:20-32`、`:40-48`、`:56-63`），本仓**有意不一致** | 见 §2 第 3 条。本仓 `intentionList.ts` 组内保持传入顺序；要对齐得有 `PriorityAction` 的对应物 —— 没有，硬折 `FixInput.preferred` 就是自加权重 ⇒ 登记，留给有真输入的那一批 |
| `IntentionListStep` 的助记符 | 上游**关着**（`:311-312` `isMnemonicsNavigationEnabled() false`） | 本仓本来就没有 ⇒ 一致，不算欠账 |
| 组件的真机渲染 | **无证据，明说** | .mjs 门禁无 DOM、无 Vue 渲染器 ⇒ B 组 6 条是**源码形状断言**；真机验收清单在 wiring 请求 §4 |

