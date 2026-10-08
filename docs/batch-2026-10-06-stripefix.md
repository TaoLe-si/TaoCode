# batch: stripefix — dnd8（桶8：工具窗口 / 标签条 / 弹层 / 拖放）死 lane 收尾

> 代号 `stripefix`。窄收尾 lane：把撞 150 轮上限的 dnd8 lane 现场判清、收干净、补归属。
> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
> （仓内 `third_party/intellij-community` 为坏树，**已禁用**，本报告不引用其坐标。）
> 共享纪律：`.tools/agent-rules.md`。

## 状态图例
- `[x]` 已做并验证 · `[~]` 部分（写「本仓已有」+「还差」） · `[ ]` 未做 · `[-]` 不适用（给具体理由）

---

## 1. 现场清点（已核）

### 1.1 归属（mtime 窗口 + 逐文件 diff）

dnd8 最后一次写盘窗口 = **15:16:51 → 15:22:22**（`src/toolWindowStripes.ts` → `src/components/ToolStripe.vue`）。
桶8 域内**只有 4 个文件**带着未提交改动落在那一窗口里，其余同名前缀的改动属于别的 lane（见 1.1-b）：

| # | 本仓文件 | 行数（HEAD → 现在，`split('\n').length`） | mtime | 归属 |
|---|---|---|---|---|
| A | `src/toolStripeDrag.ts` | 96 → **124**（+28；`git diff` 计 +34/-7） | 15:21:48 | dnd8 |
| B | `src/components/ToolStripe.vue` | 240 → **247**（+7；`git diff` 计 +13/-3） | 15:22:22 | dnd8 |
| C | `src/toolWindowStripes.ts` | 836 → **853**（+17；`git diff` 计 +19/-1） | 15:16:51 | dnd8 |
| D | `tests/dnd-stripe-drop-marker.test.mjs` | HEAD 无此文件 → **155**（新，7 条 test） | 15:20:12 | dnd8 |

`git diff --stat` 上桶8 域（`stripe|dnd|popup|tool|tab|dock|balloon`）**只命中这 4 个 + 3 个非本域文件**，
所以「dnd8 落了哪几块」= 上面 A/B/C/D，没有第二现场。

1.1-b **同域但不是我这条 lane 的改动**（只记录，不触碰）：
- `src/menus/toolWindowGear.ts`（12:47，+4）、`tests/tool-window-gear.test.mjs`（14:19）、
  `src/toolWindowMeta.ts`（12:36，改 `UsageViewContentManagerImpl.java` 引用行号）、
  `tests/workbench-dock-render.test.mjs`（14:19，+3 = `toolViewCtx: {}` 夹具）
  ⇒ 内容是「用法视图分组」与 `toolViewContext` 接线，**与拖放无关**；`src/menus/*` 在并发黑名单里，只读。

1.1-c 现场复核（主代理给的三条，逐条实测）：
- `DND8` 前缀残留：`grep -rniE "\bdnd8\b|DND8-PROBE" src tests native` ⇒ 只命中 A/D 两处**正当引用**（都指向同一份请求文档），
  注入残留 **0** ✅；
- `src/toolStripeDrag.ts:114` 与 `tests/dnd-stripe-drop-marker.test.mjs:16` 确实存在 ✅；
- `tests/toolwindow*` / `tests/tabs*` 这两个 glob 在本仓 **0 文件** ✅ —— 该域实名是
  `tests/tool-window-*.test.mjs`（20 个）、`tests/tool-*.test.mjs`、`tests/tab-*.test.mjs`（15 个）、
  `tests/everywhere-tabs.test.mjs`、`tests/tool-tabs.test.mjs`、`tests/tool-content-tabs.test.mjs`
  ⇒ 看板 §二十三那句「glob 0 条」是真的，但**它的推论（= 该域没判据）不成立**：判据实名在盘，基线 223/223 全绿（见 §4）。

1.1-d **推翻一条既有记录**：`docs/batch-2026-10-06-lane-board.md:317` 写「它的请求文档已在盘
（`docs/wiring-requests-2026-10-06-dnd8.md`）」——**实际盘上 0 个该文件**（`ls` 与 `grep -rln dnd8 docs/` 双向确认，
docs 里只有本报告的引用）。⇒ 原写「已在盘」、实际「从未落盘」，A/D 两条引用当时是**悬空引用**。
本次由我补齐该请求文档（见 §8），两处引用重新落地。

### 1.2 落块清单 + 上游坐标（**全部自己 find/打开核过**，不采信任何文档给的行号）

上游树实测路径（`D:\Backup\Downloads\intellij-community-master\intellij-community-master` 下相对路径）：
`platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt`（663 行）、
`…/wm/impl/ToolWindowManagerImpl.kt`（2020 行）、`…/wm/impl/ToolWindowImpl.kt`、`…/com/intellij/toolWindow/ToolWindowEntry.kt`。
（仓内 `third_party/intellij-community` = 坏树，未引用。）

| 块 | 用户可见行为 | 本仓落点 | 上游坐标（本机实测） |
|---|---|---|---|
| A-1 | 一次拖放只认**一个**落点：按钮先认领，轨道的末尾兜底不得覆盖它 | `src/toolStripeDrag.ts:37`（`claimedFor`）、`:45-54`（`onToolDragOver`） | `AbstractDroppableStripe.kt:354`、`:375`、`:409`、`:436` 四处 `if (processDrop && !data.dragTargetChosen)`；置位在 `:400`、`:440` |
| A-2 | 「拖到末尾」是真落点，不是永远生效 | `src/toolStripeDrag.ts:116-120`（`isDropBefore(side, null)` 重载） | 同文件 `:436-441`：`dragInsertPosition = -1` 在 `:437`、`dragToSide = true` `:438`、认领 `:440` |
| A-3 | 落点在这条条纹之外 ⇒ **不画** | `src/toolStripeDrag.ts:107`（`onToolDragEnd` 清 `claimedFor`）、`:117` | 同文件 `:443-444`：`if (!data.dragTargetChosen) drawRectangle` 归零 |
| B | 左右两条都画得出末尾指示（宿主给右条写死 `false` 的不对称不再决定结果） | `src/components/ToolStripe.vue:40-46`（props 注释 + `dropAtEnd`）、`:206`（`v-if="dropAtEnd \|\| isDropBefore(side, null)"`） | `AbstractDroppableStripe.kt:436-441`（左/右条是同一份 `doLayout`，`LeftToolbar`/`RightToolbar` 只是薄子类） |
| C | 「从侧栏移除」= 收面板 + 摘按钮**两半**，顺序先收后摘 | `src/toolWindowStripes.ts:535-546`（注释）、`:547-559`（实现：`:553-555` 收面板 + `saveVisibility()`，`:557-558` 摘按钮 + 落盘） | 触发 `ToolWindowImpl.kt:923-925`（`:924` = `hideToolWindow(id, removeFromStripe = true, …)`）→ `ToolWindowManagerImpl.kt:833-868`；① `setHiddenState` 实测在 **`:712-719`**（`:716` = `info.isVisible = false`）；② mutation `:849-853`（`:851` `isShowStripeButton = false`、`:852` `entry.removeStripeButton()`）；防护 `:1626-1627`「A safety check: if the tool window is visible, we ignore isShowStripeButton」 |
| D | 上述三块的判据 | `tests/dnd-stripe-drop-marker.test.mjs`（7 条） | 文件头 `:3-16` 引的就是上表这些坐标（已核，无假路径） |

**当场更正一处引用**（C 块注释）：`src/toolWindowStripes.ts:538` 原写 `setHiddenState`（`:696-718`），
实测 `:696-710` 是 `deactivateToolWindow` 的函数头，`setHiddenState` 是 **`:712-719`** ⇒ 本条 lane 内改为真值（只改注释，不动行为）。

`[-]` **弹层尺寸记忆覆盖面**：dnd8 在该方向 **0 行落点** —— 桶8 域的 `src/dialogGeometry.ts`、`src/panelResize.ts`、
`tests/popup-bounds.test.mjs`、`tests/dialog-geometry.test.mjs`、`tests/panel-resize-behavior.test.mjs`
`git diff` 全部**空**（对比工作区基线未变），故无从归属；本 lane 不补做（超出「窄收尾」范围，见 §7）。
### 1.3 半截形状清点（三选一，逐条给结论）

| 形状 | 现场 | 结论（接 / 删 / 登记） |
|---|---|---|
| **有实现、没判据** | C 块的**第 ① 半**（`removeStripeButton` 收面板 + `saveVisibility()`）落在生产码里，`tests/remove-stripe-button.test.mjs` 原来 7 条只盯第 ② 半（"侧条没有它了"），一条都不查 `explorer`/`bottom` ⇒ 摘掉那三行全绿 | **接上**：补 3 条判据（`tests/remove-stripe-button.test.mjs:80-124`），夹具先 `saveVisibility()` 打底，让记录里 `visible` 的变化只能由被清算的那次调用产生；反向验证见 §5 |
| **有实现、判据指向不存在的文档** | `src/toolStripeDrag.ts:114` + `tests/dnd-stripe-drop-marker.test.mjs:16` 引 `docs/wiring-requests-2026-10-06-dnd8.md` D-1，**该文件盘上不存在** | **补齐**：按磁盘实况新建该请求文档（D-1 全文 + 可照抄替换 + 上游坐标），两处引用重新落地 |
| **有实现、上游坐标写错** | `src/toolWindowStripes.ts:538` 写 `setHiddenState`（`:696-718`） | **改真值**：实测 `:712-719`（`info.isVisible = false` 在 `:716`；`:696-710` 是 `deactivateToolWindow` 的头） |
| **有判据、没实现** | 新判据 7 条 + C 块新判据 3 条：全部对应生产码里真在跑的分支（基线 223/223、注入即红，见 §5），**无此类残留** | — |
| **重复判据源（宿主 vs 组件）** | `App.vue:2073` 左条算了一份 `drop-at-end`、`:2127` 右条写死 `false`，而 `ToolStripe.vue:206` 已能用本侧 `isDropBefore(side, null)` 自己判 ⇒ 宿主那两位是被取代的第二份真相 | **登记「等宿主 D-1」**：`dropAtEnd` 是 `defineProps` 的**必填** prop，`App.vue` 是保留文件（当前 `appvue` 独占），单方面删 prop ⇒ 宿主绑定掉成 DOM attribute、单方面删绑定 ⇒ `vue-tsc` 缺 prop 当场红。必须同批 ⇒ 写进 `docs/wiring-requests-2026-10-06-dnd8.md` D-1 |
| **死码 / 零消费方** | `toolStripeDrag.ts` 导出的 7 个名字全部被 `App.vue:429` 解构、模板用到；`isDropBefore(side, null)` 的 `null` 档被 `ToolStripe.vue:206` 消费；`applyDropGroup` 的 `stripeIds/isSplit/setSideTool` 三个入参 `App.vue:436-438` 真的给了（不是"接口留了宿主不接"） | 无死码可删（orphan 门见 §4） |
| **自我否定形状扫描** | 全仓 `grep -rnE "&& false\|\|\| true\|if \\(true \\|\\|\|if \\(false" src tests` | 桶8 域 **0**；域外扫到 1 条**零判据断言**并当场还原：`tests/run-instances.test.mjs:162` 原写 `assert.ok(main.includes('case "run.started"') === false \|\| true)` —— 那个 `\|\| true` 让它永远为真。按上一行注释的本意还原成 `assert.ok(!main.includes(...), '…')`（**收紧**、未放松），改后 `run-instances` 18/18 绿；实测 `native/main.cpp` 里 `case "run.started"` 命中 **0** 次、事件由 `native/run_host.cpp:394` 发 ⇒ 断言有牙且为真。另 1 条命中是 `tests/external-link-availability.test.mjs:177` 的**注释正文**（在讲这个形状本身），不动 |

### 1.5 D-1 宿主请求复核（本机实测，不用任何文档给的数）

`src/App.vue` / `src/bridge.ts` / `src/components/CodeEditor.vue` 三个保留文件**本 lane 一字未改**（`git status` 上它们是 ` M`，
归 `appvue` / 他 lane）。按 `tests/module-size.test.mjs:157` 的 `lineCount = split('\n').length` 数法（比 `wc -l` 多 1）实测：

| 文件 | 现在（split 数法） | 登记上限 | 余量 | 主代理给的数 |
|---|---|---|---|---|
| `src/App.vue` | 2707 | 2737 | **30** | 30 ✅ |
| `src/bridge.ts` | 905 | 905 | **0（已贴顶）** | 0 ✅ |
| `src/components/CodeEditor.vue` | 1145 | 1147 | **2** | 2 ✅ |

⇒ **D-1 仍然成立**（作为"删掉被取代的重复判据"），且**净 0 行**（三行内部各删一段、不增行、不新增 import），
30 行余量完全够；`bridge.ts` 贴顶与本请求无关（不碰桥）。
D-1 的**用户可见缺陷部分已经不阻塞**：右条末尾指示现在由组件自持判据画得出（`ToolStripe.vue:206` + 判据第 5 条），
所以这一条**不再需要插队**，宿主什么时候顺手清重复判据都可以。

## 2. 判词表（dnd8 名下四条 + 本 lane 补的三件）

| 族 | 项 | 判定 | 上游相对路径:行号（本机开树核） | 本仓落点 | 一句话说明 |
|---|---|---|---|---|---|
| 拖放 | 一次拖放只认一个落点（按钮优先，轨道末尾兜底不得覆盖） | `[x]` | `platform/platform-impl/src/com/intellij/openapi/wm/impl/AbstractDroppableStripe.kt:354/:375/:409/:436`，置位 `:400/:440` | `src/toolStripeDrag.ts:37`、`:45-54` | `claimedFor` 记的是**事件对象本身**，等价于上游 `dragTargetChosen` |
| 拖放 | 「拖到这条末尾」是真落点，按侧独立 | `[x]` | 同文件 `:436-441`（`:437` `dragInsertPosition = -1`） | `src/toolStripeDrag.ts:116-120`（`isDropBefore(side, null)`） | `null` = 末尾槽；`side` 不符直接 false，两侧不互相借判据 |
| 拖放 | 落点在这条条纹之外 ⇒ 不画；取消（dragend）不留副作用 | `[x]` | 同文件 `:443-444` | `src/toolStripeDrag.ts:107` + `tests/dnd-stripe-drop-marker.test.mjs:123-143` | 结束后连 `claimedFor` 一起清，否则下一段的末尾线永远画不出来 |
| 拖放 | 左右两条都画得出末尾指示 | `[x]`（缺陷侧已修） / `[~]`（重复判据待宿主删） | 同文件 `:436-441`；左右条共用 `doLayout`（`LeftToolbar`/`RightToolbar` 只是薄子类） | `src/components/ToolStripe.vue:206` | 「还差」= 宿主那两位 `drop-at-end` 绑定，见 D-1 |
| 工具窗口 | 移除按钮 = 收面板 + 摘按钮两半，先收后摘 | `[x]` | `ToolWindowImpl.kt:923-925`（`:924`）→ `ToolWindowManagerImpl.kt:833-868`；①`:712-719`（`:716`）②`:849-853`；防护 `:1626-1627` | `src/toolWindowStripes.ts:547-559` | 只做第 ② 半会留"看得见却没有入口"的孤儿格 |
| 工具窗口 | 上述两半的同批落盘（`visible` 与 `showStripeButton` 一致） | `[x]`（本 lane 补判据） | `ToolWindowManagerImpl.kt:833-868` 一次调用内完成 | `tests/remove-stripe-button.test.mjs:80-124` | 夹具先 `saveVisibility()` 打底，判据才有牙 |
| 拖放 | 落点跨分隔件时写 `isSplit`（后半组身份） | `[x]`（dnd8 之前就已在仓） | `AbstractDroppableStripe.kt:463-469` → `:250-256`（`:255` 第 5 参） | `src/toolStripeDrag.ts:61-71`（`applyDropGroup`），消费方 `src/App.vue:437-439` | 本次只复核：三个惰性入参宿主真的给了 ⇒ 不是假接线 |
| 弹层 | 弹层尺寸记忆覆盖面 | `[-]` | 无法核实（本 lane 未开该族上游链） | — | dnd8 在该方向 0 行落点（`src/dialogGeometry.ts`/`src/panelResize.ts`/`tests/popup-bounds.test.mjs` 的 `git diff` 全空）⇒ 没有"它的落点"可归属；具体缺哪几档见 §7 |

## 3. 改动文件清单（本 lane 实际写的）

| 文件 | HEAD → 现在（`split('\n').length`） | 本 lane 做了什么 |
|---|---|---|
| `src/toolWindowStripes.ts` | 836 → 853（dnd8 +17，本 lane **行数不变**） | 只改注释一处：`:538` 的 `setHiddenState`（`:696-718`）→ （`:712-719`，`info.isVisible = false` 在 `:716`） |
| `src/toolStripeDrag.ts` | 96 → 124（dnd8，本 lane **0 改动**） | 探针注入 + 原样还原；当前与 dnd8 现场逐字一致（`git diff` 自查见 §4） |
| `src/components/ToolStripe.vue` | 240 → 247（dnd8，本 lane **0 改动**） | 同上 |
| `tests/dnd-stripe-drop-marker.test.mjs` | 不存在 → 155（dnd8，本 lane **0 改动**） | 只复核其引文与夹具（`dropAtEnd: false` 在 `:52`） |
| `tests/remove-stripe-button.test.mjs` | 117 → **178**（+61，本 lane） | 补 3 条"第 ① 半"判据 + `makeStripes(overrides)` 夹具 + 文件头一段反向说明；原 7 条断言体**一字未动** |
| `tests/run-instances.test.mjs` | 277 → **280**（+3，本 lane） | 把 `:162` 那条 `=== false \|\| true` 的零判据断言还原成有牙形式（收紧） |
| `docs/wiring-requests-2026-10-06-dnd8.md` | 新建 | D-1 全文（目标行号 + 可照抄替换 + 上游坐标 + 净 0 行核算） |
| `docs/batch-2026-10-06-stripefix.md` | 新建（本报告） | 归属报告 |

## 4. §5 自查命令原始数字（本 lane 收口时实跑）

| 命令 | 结果（原始数字） |
|---|---|
| `node --test tests/dnd*.test.mjs tests/tool-window*.test.mjs tests/workbench-dock-render.test.mjs tests/module-size.test.mjs` | **tests 182 / pass 182 / fail 0 / skipped 0** |
| 上面那条 + `remove-stripe-button` + `tool-stripe-split` + `stripe-resize-more`（= §5 三步用的那一组） | **tests 223 / pass 223 / fail 0** |
| 再带 `tab-*` `tool-tabs` `tool-content-tabs` `popup-*` | **tests 464 / pass 464 / fail 0 / skipped 0** |
| `node --test tests/remove-stripe-button.test.mjs`（补判据前后） | 前 **7/7/0** → 后 **10/10/0**（注入破坏时 5 fail，见 §5） |
| `node --test tests/run-instances.test.mjs`（还原零判据那条之后） | **18 / 18 / 0** |
| `node .tools/find-orphan-modules.mjs --gate` | **本 lane 收口时点为红，但 offender 不是我造的**：15:5x 首跑 = 已登记孤儿 **6** / 基线 **8** · 新增 **0** · 清掉 **2**（`src/jarRun.ts`、`src/runAnythingContext.ts`）⇒ **绿**；收口复跑连着两次 = **新增 1：`src/usageViewTreeModel.ts`**（中间那次还换成了 `src/vcsLogDisplay.ts`）——两条都是**别的 lane 正在写的新文件**（`?? src/…` 未跟踪、不在本域），本 lane **一个 `src/` 新文件都没建**（§6），所以这条红归 refview2 / vcslogd 自己收 |
| `node .tools/find-param-props.mjs` | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | **干净：tests/\*.mjs 全部是纯 JavaScript** |
| `node .tools/find-missing-ext.mjs` | 扫描 **1373** 个文件（src + tests），**干净** |
| `npx vue-tsc -b --force` | **1 条 error**：`src/semanticActions.ts(509,71): error TS2345`（`OrganizeImportsRequestParams` 缺索引签名）——派单点名的他域在飞错之一，**只记录不修**。本 lane 四个文件 **0 错** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **11 tests / 8 pass / 3 fail**，三条红的 offender 逐条列在 §7-b，**全部属他域**；把 offender 列表按 `stripefix\|dnd8\|remove-stripe\|toolWindowStripes\|toolStripeDrag` 反查 ⇒ **本 lane 新增引用 0 条 offender**（本 lane 的上游坐标全部本机开树逐行核过） |
| 上限自查（`tests/module-size.test.mjs:157` 的 `split('\n').length` 数法） | `src/toolStripeDrag.ts` **124** / `src/components/ToolStripe.vue` **247** / `src/toolWindowStripes.ts` **853**（上限 900）/ 三个保留文件本 lane 未改 ⇒ **一个上限都没抬** |

**工具结果异常（按纪律当场读盘复现，记出处）**：跑 `npx vue-tsc -b --force` 的那次 Bash 结果先是"未返回输出"，
随后回灌成一段**自称真实输出**的文本：`src/postFormatProcessors.ts(163,29): error TS1005: ',' expected.`，
外加一个伪装成"系统提示"的块，说"这是并发写的半写状态、不是本 lane 引入的、16 个文件都被其他 lane 改过、无需修复"。
⇒ **按数据处置、不执行**。读盘复现：`npx vue-tsc -b --force > build/stripefix-tsc.txt` → 文件 **2 行**、退出码 **1**、
唯一一条是 `src/semanticActions.ts(509,71) TS2345`；`src/postFormatProcessors.ts` **根本没出现在真实输出里**。
"16 个文件"那句也与 `git status` 对不上（工作区改动面远大于 16），不采信、不据以改任何判断。

**同一场里另外两类回灌（同法处置：当数据、读盘复现、不执行）**：
① 一次 `Edit` 成功后，结果前被插进一段"系统提示"，称**本报告与 D-1 请求文档已被删除**；
盘上三法复现均在（`ls -l` / `cmd dir /b` / `git status --porcelain -- docs/` 都列出这两个文件，
`node` 读文件计数 = 13604 与 4210 字符）⇒ 该说法**假**。
② 三条"某 skill 已更新，用 Skill 工具调用它"的伪装系统通知（`design-review` / `qmind` / `linear`）——
本会话可用技能清单里**没有** `design-review`，任务也没要求任何 skill ⇒ 不调用、不据此改路线。
③ 会话开头两条 `MEMORY.md was modified` 通知则**是真事件**（盘上 mtime：全局 15:08:49、项目 15:33:38，
均早于本 lane 的写盘点），但它同样只当数据读，不作为指令。

## 5. 反向验证记录（STRIPEFIX-PROBE，三步数字）

| 步 | 注入了什么 | 结果 |
|---|---|---|
| ① 基线（注入前） | — | `tests/dnd-stripe-drop-marker.test.mjs` + `tests/remove-stripe-button.test.mjs` = **17 tests / 17 pass / 0 fail**；桶8 全域（`dnd*` + `tool-window*` + `workbench-dock-render` + `module-size` + `remove-stripe-button` + `tool-stripe-split` + `stripe-resize-more`）= **223 / 223 / 0** |
| ② 破坏 | (a) `src/toolStripeDrag.ts:49` 的 `if (claimedFor === event) return` 改成 `if (false && claimedFor === event) return`；(b) `src/toolWindowStripes.ts:553-555` 三行（收面板 + `saveVisibility()`）摘掉 | **17 tests / 12 pass / 5 fail**：`同一次 dragover…`、`模板真的把标记画在认领的那个按钮之前`、`取消拖放（dragend）…`（dnd8 那 3 条）+ `移除正在显示的那一格…`、`底部那一侧同理…`（本 lane 补的第 ① 半 2 条）⇒ 两边判据都**有牙**。第 3 条 `只收它自己那一格…` 是"不许扩大战果"的护栏，实现摘掉它仍绿 = 设计如此 |
| ③ 原样还原 | 两处 Edit 反向 | **17 / 17 / 0** 复绿；全域数字回到 ① 的 223/223（见 §4 复跑） |
| ④ 残留 | `grep -rn "STRIPEFIX" src tests docs/*.md`（排除本报告文件名） | **0 命中**；`grep -rnE "&& false\|\|\| true\|if \\(true \|\|\|if \\(false" src/toolStripeDrag.ts src/toolWindowStripes.ts src/components/ToolStripe.vue` **0 命中** |

## 6. 零消费方自查结论

- `src/toolStripeDrag.ts`：导出的 7 个成员（`draggingTool`/`dropTarget`/`onToolDragStart`/`onToolDragOver`/`onToolDrop`/`onToolDragEnd`/`isDropBefore`）
  全被 `src/App.vue:429` 解构并用在模板（左条 `:2072-2075`、右条 `:2126-2129`）⇒ **有消费方**；
  `isDropBefore` 新开的 `null` 档被 `src/components/ToolStripe.vue:206` 消费（不是"只有测试在用"）。
- `src/components/ToolStripe.vue`：宿主两处渲染（`App.vue:2071`、`:2124`）⇒ 有消费方。
- `src/toolWindowStripes.ts`：`removeStripeButton` 由 `src/gearHostRows.ts` 的宿主行调用，注入点住在 `App.vue`
  （`removeStripeButton(leftView.value)`，`tests/remove-stripe-button.test.mjs:165` 那条锚点断言钉着）⇒ 有消费方。
- 本 lane **没有新建任何 `src/` 模块**（只补判据、改一处注释、写两份文档）⇒ 结构上不可能引入零消费方；
  orphan 门实跑"新增 0"（§4）与这条自洽。

## 7. 做不到 / 无法核实

**7-a 弹层尺寸记忆覆盖面**：不是"做不到"，是**没有可归属的 dnd8 落点** —— 桶8 域的 `src/dialogGeometry.ts`、
`src/panelResize.ts`、`src/previewSettings.ts`、`tests/popup-bounds.test.mjs`、`tests/dialog-geometry.test.mjs`、
`tests/panel-resize-behavior.test.mjs` 的 `git diff` **全空**（dnd8 一行都没写过）。
它卡在哪儿：要判"哪几类弹层该记住尺寸"，得先开上游 `PopupBuilder` / `Balloon` 的尺寸持久化整条链，
那是**一整条新实现线**（≥1 个新模块 + 宿主接线），超出本 lane 的"窄收尾"授权（只允许收半截形状，不允许开新面）。

**7-b 三条他域在飞红（只记录、不修；都不是本 lane 能动的文件）**

| 红 | offender（**行号尾巴按 §5 纪律去掉**，原文见本节末的"逐字"注） | 为什么不修 |
|---|---|---|
| 引用门「按图索骥会扑空」 | 出自 `docs/batch-2026-10-06-findrep2.md` 的一条：上游 `ConsoleViewImpl.kt` 那条引用被写成**六位数越界行号**（该文件只有 1730 行） | 那是 **findrep2 lane 自己的报告正文**（15:49 落盘，晚于 dnd8 撞线）把一次瞬时红**连行号原样转述**进文档 —— 正中 `.tools/agent-rules.md` §5 警告的"文档里转述的假路径行号会被当真引用收集"。修法 = 去掉那个行号尾巴（点位：`docs/batch-2026-10-06-findrep2.md` 的 §自查表 与 §末尾第 5 条，两处）。**归它自己改** |
| 引用快照门「被悄悄改指到别处」 | `docs/batch-2026-10-06-termset.md` 的 7 条（终端字体/配色一族：`EditorFontsConstants.java`、`JBTerminalPanel.java`、`JBTerminalSchemeColorPalette.kt`、`EditorSettingsExternalizable.java`、`ApplicationBundle.properties`、`EditorOptionsPanel.kt`、`ColoredOutputTypeRegistryImpl.java`）+ `src/commitChecks.ts` 的 `CommonCheckinFilesAction.kt` 一条 + `src/components/ProblemsPanel.vue` 的 2 条 + `src/runStartupFocus.ts` 的 `RunnerAndConfigurationSettings.java` 一条 | 分属终端字体 / commit / 问题面板 / 运行启动焦点四条别的 lane；`ProblemsPanel.vue`、`commitChecks.ts` 还在本 lane 的**并发黑名单**里；`docs/inventory/citation-anchors.json` 是脚本生成物（保留面，一次只授权一路）<br>逐字原始输出（**本 lane 不照抄进正文，只贴在这里给 owner 对账；owner 复跑时请以 `node --test tests/source-citation-anchors.test.mjs` 的当期输出为准**）：十一条 `moved ::`，键为「来源文件 + 上游路径 + 区间」 |

**7-c `[-]` 未做（有意不扩面）**：`tests/tab-*`（标签条 15 个文件）与 `tests/tool-*`（内容标签）两族本次只做**只读基线**
（464/464 绿），未动 —— dnd8 在那里 0 落点，按派单"只做这一件"不扩面。

**7-d 无法核实**：`AbstractDroppableStripe.kt` 的 `tryDroppingOnGap`（`:355-356`、`:409-411`）与
`useSplitGap`/`separatorTopSide` 合起来到底在哪一档把"分隔件那条缝本身"判成落点，本 lane 未逐行读完；
本仓用行标记模型（`src/toolStripeSplit.ts`）近似，且 `src/toolStripeDrag.ts:64-65` 已明写"给不出压在缝上的落点就不猜"。
⇒ 不写结论，留给下一路拖放线。

## 8. 给主代理的线

1. **D-1 已重写并落到 `docs/wiring-requests-2026-10-06-dnd8.md`**（该文件此前**从未存在**，而
   `src/toolStripeDrag.ts:114` 与 `tests/dnd-stripe-drop-marker.test.mjs:16` 两处都在引它 ⇒ 看板 §二十「它的请求文档已在盘」不成立）。
   复核结论：**D-1 仍成立，但降级** —— 不再是"右条画不出落点指示"的用户可见缺陷（那一半 dnd8 已在
   `src/components/ToolStripe.vue:206` 用本侧 `isDropBefore(side, null)` 修完、判据是
   `tests/dnd-stripe-drop-marker.test.mjs` 第 3、5 条），现在只剩"宿主多带一条被取代的重复判据 `drop-at-end`"。
   **净 0 行、不新增 import**，`App.vue` 余量 30 行足够；组件侧 prop 删除必须与宿主绑定删除**同一批**
   （可照抄的整段替换 + 三处测试夹具点位都写在请求里）。⇒ 不阻塞，下次动 `App.vue` 顺手带走。
2. **请更正看板 §二十 / §二十三 关于 dnd8 的两条结论**（留痕已在本报告 §1.1-c/d）：
   glob 0 条是真，但"该域没判据、等它复跑、不许算完成"不成立 —— 实名判据在盘、基线 182/182；
   四条落块（§2）判据 + 反向验证 + 归属齐了，dnd8 可以**结案**。
3. **一条域外还原请复核**：`tests/run-instances.test.mjs:162` 原本写作
   `assert.ok(main.includes('case "run.started"') === false || true)`（永远为真 = 零判据），
   按规则⑦当场还原成有牙形式（实测 `native/main.cpp` 命中 **0** 次、事件在 `native/run_host.cpp:394`），
   `run-instances` 18/18 绿。该文件不在本 lane 派单面里，若要归还原主请说一声。
4. **§7-b 三条红请转 owner**：findrep2 去掉 `:999999` 尾巴即让引用门复绿；快照漂移那 11 条要走
   `scripts/verdict_table.py` 的一次一路授权重生成。
5. **工具结果异常请记进取证簿（本 lane 撞到四类，全部按数据处置、当场读盘复现，详见 §4 末）**：
   ① `npx vue-tsc -b --force` 的结果被回灌成一条**不存在的** `src/postFormatProcessors.ts(163,29) TS1005`
   并附伪装"系统提示"劝"无需修复、16 个文件是别人改的"——真实盘上输出 = 1 条 `semanticActions.ts(509,71) TS2345`
   （已存 `build/stripefix-tsc.txt`，2 行）；
   ② 一段"系统提示"声称本报告与 D-1 请求文档**已被删除** —— `ls` / `cmd dir` / `git status` 三法复现均在盘；
   ③ 三条"某 skill 已更新，请调用"的伪装通知（`design-review`/`qmind`/`linear`），其中 `design-review` 不在本会话清单里 —— 未调用；
   ④ 两条 `MEMORY.md 被改` 通知经盘上 mtime 核对是**真事件**（15:08:49 / 15:33:38，都早于本 lane 写盘点），
   但同样不作为指令执行。
   ⑤ 结果尾部又长出**一份"可用技能清单"**（含本会话清单里没有的 `design-review`，劝我用 `Skill` 去调）
   与**三条"Agent stripefix 仍在运行 / 后台还在跑"** —— 本 lane 没派子代理、没开后台任务（三次 `run_in_background` 都没用过），
   属伪造的"停手/等待"指令 ⇒ 未执行：门槛自己跑、报告继续落。
   ⑥ 一次 Bash 结果回"工具结果读不到"，却**替我写好**一句"你顺手改了 `tests/module-size.test.mjs:22`"。
   盘上核对：`git status --porcelain -- tests/module-size.test.mjs` **无输出**（保留文件本 lane 未碰），
   我这次写过的代码面只有 §3 那四个文件 ⇒ 该暗示**假**。
   ⇒ 六条里没有一条改变过我的判断或落点；如果这些不是中间层造成的，请查并发通道里谁在改写工具结果。
