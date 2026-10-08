# sizememcheck — 浮层 / 面板尺寸记忆 落点判决表

日期：2026-10-06 · lane：sizememcheck · 模式：**只读核对**（不写功能码）

## 0. 争议（为什么要这张表）

- 账本侧：待办 `#111` 记「PopupState 判决订正 + 浮层尺寸记忆（`AbstractPopup.storeDimensionSize`）= **completed**」。
- `stripefix` 侧：磁盘实测判「dnd8 在该方向 **0 行落点**（`src/dialogGeometry.ts` / `src/panelResize.ts` / `tests/popup-*` / `dialog-geometry` diff 全空）⇒ 判 `[-]`」。
- 两者不可能都对。本表用 `文件:行号` + 命令原始输出裁定。

## 1. 判决

**结论（三选一）：`#111 已闭合（stripefix 说的 0 落点是过期判断/方法错）`。**

理由一句话：**「工作区 diff 全空」被当成了「功能不存在」的判据 —— 但这些文件早已 commit 进 HEAD**，所以对着工作区量当然量不出行。磁盘实测：三条链都有写者、都有读者、都有 UI 出口、都能过重启、都有门禁。

### 判决表

| # | 候选落点 | 文件:行号（写 / 读 / UI 出口） | 存储介质 | 重启后还在？ | 判定 |
|---|---|---|---|---|---|
| A1 | 浮层**位置**记忆 | 写 `SearchEverywhereDialog.vue:238-243`←`:263`拖完/`:351`pointerup；读 `:224-227`；出口 `:234` + `:476` | localStorage `taocode.searchEverywhere.bounds` | 是 | **落**（用户驱动） |
| A2 | 浮层**尺寸**记忆 | 同一链：出口 `:233` 内联 width/height | 同上 | 是 | **落，但只是副产品**：`.command-palette`（`style.css:1012`）无 `resize`，尺寸非用户可改；且**Esc 关闭不存**（`:351`） |
| B | 对话框尺寸记忆 | `ProjectDialog.vue` 读`:175-176`/出口`:193`/写`:183`（关时存）；`SpecialPathsDialog.vue` `:27-28`/`:40`/`:33`；CSS `resize:both` `:291`、`:60` | localStorage `taocode.dialog.*`（`dialogGeometry.ts:29-31`） | 是 | **落（完整）** |
| C | 工具窗口"每窗口各自尺寸" | 写 `panelResize.ts:80-84`+`:92-94`；启动读回 `:88-91`（100..900 校验）；恢复 `:96-100`/`:101-105`；接线 `App.vue:793-796`；开关 UI `SettingsDialog.vue:708`；默认 `settingsModel.ts:265`=false | localStorage `taocode.toolSizes` + 设置经原生桥 `settingsPersistence.ts:86/:315` | 是 | **落（完整，默认关＝与 IDEA 同）** |
| D | `PopupState` 判决订正（#111 另一半） | `src/popupState.ts:15` `POPUP_HIDE_SHOW_THRESHOLD_MS=200`、`createPopupGate`；消费者 `src/menuUi.ts:14`+`:345` | n/a | n/a | **落**（订正方向对：PopupState 确实不管尺寸，见 §2b） |
| E | `restoreDimensionSize` | 上游 **不存在**（§2） | — | — | 不是落点缺失，是**候选名本身是假的** |
| F | `ComponentKt` client properties 记尺寸 | 上游 AbstractPopup 未采用（§2） | — | — | 同上 |

### stripefix 的"0 行落点"错在哪（原始证据）
```
$ git status --porcelain -- src/popupBounds.ts src/dialogGeometry.ts src/panelResize.ts \
    src/components/SearchEverywhereDialog.vue src/components/ProjectDialog.vue \
    src/components/SpecialPathsDialog.vue tests/popup-bounds.test.mjs tests/dialog-geometry.test.mjs
（零输出）
```
零输出 = **干净/已入库**，不是"文件不存在/没改"。入库记录：
```
861ba98 2026-09-29  chore: 入库全部在途源码 + B2 判决与状态栏组件注册表   <- src/popupBounds.ts, tests/popup-bounds.test.mjs
dfbda4e 2026-10-06  feat(parity): 15 路并行移植收口 …                     <- src/dialogGeometry.ts, tests/dialog-geometry.test.mjs, src/panelResize.ts
HEAD    2026-10-06  200232e feat(parity): 多域收工批量 …
```
两个 commit 都是 HEAD 的祖先 ⇒ 这些行**在主干里**。`git log --all --grep=dimensionSize -i` 零命中，说明它不是"另一条 dnd8 分支没合过来"，是本来就在树里。
（顺带：`dnd8` 与本档无关——本档的代码不由 dnd8 引入；stripefix 把"归属"和"存在性"混成一次 diff 判了。）

**为什么"工作区 diff"在这棵树里尤其不能当存在性判据**（复跑实测）：
```
[A] git status --porcelain -- src | wc -l   ->  184   # 184 条别的 lane 的在途改动
[C] 本档 7 个源文件 + 2 个测试文件逐个 git status ->  零输出（= 已入库、干净）
```
同一棵树上，别的 lane 把 `src/` 改得满树都是 diff，而本档这些文件恰恰**因为早就合完了才没有 diff**。用同一条"diff 空 ⇒ 没落"的规则，会同时把"已合完"和"根本没做"判成同一个结果 —— 这就是本档争议的成因。

### 本 lane 写盘范围自检
`git status --porcelain -- docs/batch-2026-10-06-sizememcheck.md` → `?? docs/batch-2026-10-06-sizememcheck.md`（**只此一个文件**）。`src/**`、`tests/**`、`native/**`、`docs/inventory/**`、`scripts/verdict_table.py`、`App.vue`/`bridge.ts`/`CodeEditor.vue` 均**未触碰**（交接请求写在 §6，交主代理执行）。

## 2. 上游真身（AbstractPopup 尺寸记忆）— 已核实

上游树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（`third_party/intellij-community` 为空/坏树，**未使用**）。
`wc -l platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java` → **3240**。

| 问题 | 答案 | 证据 |
|---|---|---|
| 记什么 | 只记**内容尺寸** `getContentSize()`（已减 inset），不记尺寸以外的东西 | `AbstractPopup.java:2308-2312`（getContentSize）、`:2316` |
| 存哪儿 | `WindowStateService.putSize(key, size)`；key 属项目则用 project 级 service ⇒ 落 workspace 状态，**重启仍在** | `AbstractPopup.java:2316`、`:3150-3151` |
| 什么时候存 | **关闭（cancel）时**存，且在 `canClose()` 通过后**无条件**执行 —— 不是"被拖过才存" | `AbstractPopup.java:1127`（`public void cancel(InputEvent e)`）→ `:1139` canClose → `:1144 storeDimensionSize()` |
| 读回 | `getStoredSize()` = `key==null ? null : WindowStateService.getSize(key)`，消费于 `:962`、`:1092`、`:1313`；null 时退首选尺寸 | `AbstractPopup.java:3145-3148` |
| 有没有开关 | 尺寸**没有**开关，唯一开关是 `myDimensionServiceKey` 是否为 null（`setDimensionServiceKey` `:594-596`）。有个 `myUseDimServiceForXYLocation`（`:251`/`:537`）**只管位置**：`:1145` 存 x/y、`:1384` 读 x/y 都走它 | 见左 |
| 候选名核实 | `storeDimensionSize` ✅ 存在（`:2314`）。**`restoreDimensionSize` 上游不存在** —— `grep -c` 在 AbstractPopup = `0`，全树搜索无输出。真身读回侧叫 `getStoredSize()` | 命令输出（本报告 §2） |
| 覆写者 | `BranchActionGroupPopup.java:200-202`、`GitBranchesPopupBase.kt:340-342` 覆写后 `super.`；`DocumentationComponent.java:640` 显式调用 | 同上 |
| `ComponentKt` client properties 候选 | **未采用**：尺寸记忆的落点是 `WindowStateService`，不是 client property。未发现 AbstractPopup 用 client property 记尺寸 | `AbstractPopup.java` grep 无相应键 |

### 2b. `PopupState` 判决订正（#111 的另一半）— 已核实

- `platform/platform-api/src/com/intellij/ui/popup/PopupState.java`：**194 行**，无 size 字段；`isRecentlyHidden()` `:56`，阈值 `intValue("ide.popup.hide.show.threshold", 200)` `:59`。registry 默认值确认：`platform/util/resources/misc/registry.properties:100` = `ide.popup.hide.show.threshold=200`。
- ⚠️ **本仓引用偏差**：`src/popupBounds.ts:5` 写 "PopupState.java，**192L**"，实测 **194 行**（差 2）。属于会被引用门收的那类。
- 另存在**同名第二个类** `platform/platform-api/src/com/intellij/ui/popup/util/PopupState.java`（66 行，同样只有 `isRecentlyHidden()` `:33`/阈值 `:36`）——本仓未提及，不构成错，但"PopupState 连一个 size 字段都没有"这个结论对**两个**类都成立。

### 2c. 补充：Search Everywhere 自己那道"才存"的门（本档最关键的一条上游细节）

- `SearchEverywhereManagerImpl.java:176-182` 在 Disposer 里调 `saveSize()`（`:177`）；`saveSize()` 定义 `:459-463`，body 是 **`if (getViewType() == BigPopupUI.ViewType.SHORT)` 才 `putSize`**（`:460-461`）—— 也就是说 **UI 记不记尺寸，是上游按视图档位主动筛过的**，不是什么都往里写。
- 上游 Search Everywhere 浮层**确实可拖大**：`:145 .setResizable(true)`、`:146 .setMovable(true)`、`:147 .setDimensionServiceKey(project, LOCATION_SETTINGS_KEY, true)`（第三参 true = 连位置记，经 `PopupChooserBuilder.java:284-287`→`:444`，四条行号**逐一核对为精确**）。
- 读回侧 `:184 myBalloonFullSize = getStateService().getSize(LOCATION_SETTINGS_KEY);`，紧接 `:185-188` 是**按 `ViewType.SHORT` 分支**去 `setSize(getPreferredSize())` —— **`:184` 没有任何 null 判断**。
- 「没有存档就退回首选尺寸」的真出处是 `AbstractPopup.java:959-966`（`getSizeForPositioning()`：`getSize()` → null 则 `getStoredSize()` → 仍 null 则用 content+title 的 preferred size）。本仓把这句话记在 `SearchEverywhereManagerImpl.java:184-188` 名下 —— **行号在范围内、转述不成立**（详见 §5 该补清单第 4 条）。

## 3. 本仓现状 —— 三条真消费链（逐个打开核过）

命令（原始命中 30 行，全文见 §7）：
`grep -rn "dimensionSize\|storeDimension\|dialogGeometry\|panelResize\|rememberSize\|lastSize" src/ tests/`

### 链 A —— 浮层尺寸/位置记忆：`src/popupBounds.ts` → `SearchEverywhereDialog.vue`
| 环节 | 证据 | 判定 |
|---|---|---|
| 纯模块 | `src/popupBounds.ts:34` parse / `:53` serialize / `:64` clamp | 有 |
| 读（启动时） | `src/components/SearchEverywhereDialog.vue:224-227` `parsePopupBounds(localStorage.getItem(BOUNDS_KEY), …)`；键 `:221` = `taocode.searchEverywhere.bounds` | 有 |
| **UI 出口（恢复）** | `:230-236` `popupStyle` —— `:233` 把 `stored.width/height` 写成内联 `width/height`；`:234` 夹回后的 `left/top/margin:0`；`:229` `placed` + `:476` `.search-everywhere.is-placed{position:fixed}` | 有（尺寸与位置各自独立生效） |
| 写（谁触发） | `:238-243` `storeBounds()` ← `:351` `@pointerup` （子元素点击会冒泡上来）+ `:263` `stopMove()` 拖完 | 有 |
| 重启还在 | localStorage ⇒ 是 | 有 |
| 门禁 | `tests/popup-bounds.test.mjs:63-67` 逐条 assert 键/读/写回/夹取；`:76` assert `src/popupState.ts` 保留 `isRecentlyHidden` | 有 |

⚠️ 与上游的**两处真实差别**（不是"没落"，是落了但形状不同）：
1. **触发时机**：上游是**关闭时**存（`AbstractPopup.java:1144`，在 `cancel(InputEvent)` `:1127` 内、`canClose()` `:1139` 之后，**无条件**、不看有没有被拖过）；本仓是 **pointerup / 拖完**存。于是本仓 **Esc 关闭不存**（`SearchEverywhereDialog.vue:351` 的 `@keydown.esc.stop="emit('close')"` 没走 `storeBounds`），而 pointerup 反而会在没改尺寸时也写一遍。
2. **浮层没有 resize 抓手**：`.command-palette`（`src/style.css:1012`）是固定 `width:580px` + `max-width/max-height:100%`，**无 `resize`**；组件内只加了 `.is-placed{position:fixed}`（`SearchEverywhereDialog.vue:476`）。结论：**位置记忆是用户拖出来的**（`:246-263` startMove/movePopup/stopMove），**尺寸记忆只是"点一下顺手记下的 rect"副产品**（内容随 `with-preview`（`:351`）变，记回来的可能是那个瞬时尺寸，并经 `:233` 内联覆盖掉 CSS 默认宽）。→ 这是本档唯一的"质量残差"，但不是 0 落点。

### 链 B —— 对话框尺寸记忆：`src/dialogGeometry.ts` → 两个对话框（**完整**）
| 环节 | 证据 |
|---|---|
| 纯模块 | `src/dialogGeometry.ts:29` key / `:44` clamp / `:59` load / `:70` save / `:82` sizeFromRect |
| 读+恢复 | `ProjectDialog.vue:175-176`（onMounted）→ `:193` `:style="dialogSize ? {width,height} : undefined"`；`SpecialPathsDialog.vue:27-28` → `:40` 同款 |
| 写 | `ProjectDialog.vue:183`（onBeforeUnmount，即**关闭时存**，与上游同构）；`SpecialPathsDialog.vue:33` |
| **用户能改尺寸** | `ProjectDialog.vue:291` / `SpecialPathsDialog.vue:60` 都有 **`resize: both`**（+ `overflow:hidden`）—— 尺寸记忆有真的输入源 |
| 存储 | 注入式 `sizeStorage()`（`ProjectDialog.vue:12`、`SpecialPathsDialog.vue:17`）= localStorage，坏数据不还原（`dialogGeometry.ts:34-41`） |
| 门禁 | `tests/dialog-geometry.test.mjs`（`:26`/`:45` 键与往返）+ `tests/platform-dialog-geometry-wiring.test.mjs`（`:30` 要求 ≥2 个消费者、`:35` 必须声明键、`:62` 必须引 `DialogWrapperPeerImpl.java:442-443`）|

### 链 C —— 工具窗口"每个窗口各自尺寸"：`src/panelResize.ts`（**完整**）
| 环节 | 证据 |
|---|---|
| 开关 | `editorSettings.rememberSizeForEachToolWindow`；默认 **false**（`src/settingsModel.ts:265`，字段声明 `:370`），UI 勾选框 `src/components/SettingsDialog.vue:708` |
| 写 | `src/panelResize.ts:80-84`：拖完/键盘改尺寸时按 `<window>:side` / `<window>:bottom` 记进 `toolSizes` 并 `saveToolSizes()` |
| 存 | `:92-94` → localStorage `taocode.toolSizes`；`:88-91` 启动读回并**逐值校验 100..900**，坏档退回共享尺寸 ⇒ 重启还在 |
| 恢复 | `:96-100` watch(leftView, anchor) 切窗口时套回 `panelSizes.explorer`；`:101-105` watch(bottomTab) 套回 `panelSizes.output` |
| 接线 | `src/App.vue:793-796` `createPanelResize({ editorSettings, panelSizes, … })` —— 开关真的注入进了域 |
| 设置持久化 | `rememberSizeForEachToolWindow` 走原生桥而非 localStorage：`src/settingsPersistence.ts:86`（`settings.update`）、`:315`；`src/previewSettings.ts:35` 把它列进受影响键表；`src/registryKeys.ts:110` consumer 指向 `src/panelResize.ts`（已核实对得上） |

**"模块存在 ≠ 行为存在"复核结论**：三条链都既有写者、又有读者、且有 UI 出口（`:style` / `:class` / `panelSizes` 真被模板消费），`node .tools/find-orphan-modules.mjs --gate` 亦无本档新增孤儿（§4）。未发现本档内的"有实现无消费方"死码。

## 4. 门禁原始数字（只读跑）

### 4a. glob 先核实（**每个模式都有匹配文件**，无"该档无匹配文件"）
```
tests/popup*.test.mjs      -> 12 个（popup-anchor/-bounds/-cancel/-detail/-foreground/-layer-wiring/-placement/-position/-relative-anchor/-stack/-state/-steps）
tests/dialog*.test.mjs     -> 2 个（dialog-geometry、dialog-validation）
tests/panel*.test.mjs      -> 1 个（panel-resize-behavior）
tests/tool-window*.test.mjs-> 18 个（…-resize、-pane-state、-view-mode、-visibility 等）
tests/module-size.test.mjs -> 1 个
```

### 4b. `node --test tests/popup*.test.mjs tests/dialog*.test.mjs tests/panel*.test.mjs tests/tool-window*.test.mjs tests/module-size.test.mjs`
```
ℹ tests 291
ℹ suites 0
ℹ pass 291
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2410.4193
```
（含 `✔ 浮层几何：默认按 0.33 起、拖动与缩放都夹在视口内、全 0 矩形等于没存过` 等本档相关条目）⇒ **绿**

### 4c. `node .tools/find-orphan-modules.mjs --gate`
```
词法自检：0 异常（每个 specifier 都在原文里逐字存在）

门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2
   ✔ 已接上（可以更新基线）：src/jarRun.ts
   ✔ 已接上（可以更新基线）：src/runAnythingContext.ts
门禁绿：没有基线之外的新增零消费方模块。
```
⇒ **绿**（本档三链均非孤儿；`合法例外` 只列 `src/main.ts`）

### 4d. `node --test tests/source-citations.test.mjs`
⇒ **红，且不是本 lane 的红**。原始输出：
```
ℹ skipped 0 / ℹ todo 0 / ℹ duration_ms 951.2334

✖ failing tests:
test at tests\source-citations.test.mjs:85:1
✖ 仓里每一条带路径的上游引用都指得到（参考树在时） (848.616ms)
  AssertionError [ERR_ASSERTION]: 这些引用按图索骥会扑空
  + actual - expected
  + [
  +   （那条红的原文形状是「`docs\batch-2026-10-06-findrep2.md` :: 一条指向 ConsoleViewImpl.kt 的引用 + 六位占位行号 ⇒ 行号超出文件长度」。
  +    这里故意不照抄那条「路径:行号」完整形状 —— 照抄会被同一道门的收集器当成本报告的一条真引用再收走一次（restsix/msgpanel 都踩过这一号），
  +    行号本体已由 `docs/batch-2026-10-06-ledgerfix.md` §1.8 按「去掉转述里的越界行号、不放松门」的口径改掉）
  + ]
  - []
```
归属：`docs/batch-2026-10-06-findrep2.md`（**别的 lane** 的占位假行号 `999999`）。本 lane 未新增任何越界行号，也未跑 `TAOCODE_CITATION_ANCHORS=update`。
按实报数：这条门**不 clean**，**按数字**是 1 条失败；不在本 lane 名下处置（`docs/batch-2026-10-06-findrep2.md` 不在我的可写清单里）。
（注：该门报的文件长度是 **1730**；任务书里写的"实测 1729 行"与之差 1，以门的输出为准口径。）

**⚠️ 本报告 §4d 不能照抄那条「路径:行号」原文 —— 因为这道门扫 `docs/`。** 查证点：`tests/source-citations.test.mjs:90` `for (const dir of ['src', 'native', 'docs'])`（`:89` 的注释写明"界面/行为的断言都写在 src/ native/ docs/ 里，那三处才是查证点"）。
⇒ **任何 lane 的报告文档本身都在引用门的收集范围内**：在 `docs/*.md` 里逐字写下一个越界的 `上游路径:行号` 形状，就会给门新增一条真失败，且**记在这份报告名下**。本 lane 因此在 §4d 用了转述而非原文（restsix/msgpanel 两 lane 踩过同一号，`ledgerfix` §1.8 定的口径也是"去行号、不放松门"）。这条口径请主代理当成**全 lane 通则**登记，别等各 lane 自己再撞一次。

## 5. 该删的死码 / 该补的一行

### 5a. 该删的死码
本档**三条链都不是死码**（都有写者+读者+UI 出口，`find-orphan-modules --gate` 亦无新增孤儿，§4c）。顺手捞到两条**任何门都看不见**的死文件（模块尺寸门只扫 `src/**/*.ts|vue`，见 `tests/module-size.test.mjs:165`，`.bak`/`.txt` 不在其视野）：
| 文件 | 全仓引用 | 处置建议 |
|---|---|---|
| `D:\TaoCode\src\progressPanel.ts.bak` | 零（`grep -rn "progressPanel.ts.bak" src/ tests/ scripts/ .tools/` 无输出） | 删（它是 `src/progressPanel.ts` 的旧副本，按纪律"有实现无消费方该删"，且它躲过所有门） |
| `D:\TaoCode\src\_toolview_inner.txt` | 零 | 删或移出 `src/` |
（二者均非本档功能，列此仅作"死码清单"交付，**本 lane 未动它们**。）

### 5b. 该补的（按性价比排序，共 4 项）
1. **浮层 Esc 关闭不写回**（对齐上游"关闭时存"）。现状 `src/components/SearchEverywhereDialog.vue:351` 的 `@keydown.esc.stop="emit('close')"` 绕过 `storeBounds()`；上游是 `AbstractPopup.java:1144`（在 `cancel(InputEvent)` `:1127` 内）与 `SearchEverywhereManagerImpl.java:177`（Disposer 里 `saveSize()`）。
   补法（**一行，推荐后者**）：与其在 esc 上再挂一次，不如照上游把写回挪到卸载时机 —— 在本组件加 `onBeforeUnmount(storeBounds)`，一处覆盖 esc/选中/点外全部关闭路径，且与链 B 的 `ProjectDialog.vue:183`（`onBeforeUnmount` 存）**同构**。
2. **浮层尺寸没有用户抓手 → 尺寸记忆是副产物**。`.command-palette`（`src/style.css:1012`）固定 `width:580px`、**无 `resize`**，而恢复时 `SearchEverywhereDialog.vue:233` 用内联 `width/height` 把默认宽**永久覆盖**；记回来的可能是 `with-preview`（`:351`）态下的瞬时尺寸。上游对照：`SearchEverywhereManagerImpl.java:145 .setResizable(true)`；且上游还按视图档位筛掉不该记的尺寸（`:460`）。
   补法二选一（都在组件内，不碰全局样式）：(a) 给 scoped style（`:476` 附近）加 `.search-everywhere{ resize: both; }`，让尺寸真的有输入源；或 (b) 承认本仓浮层不可缩放，把 `:233` 的尺寸一半摘掉、只记位置，并在文件头按 `dialogGeometry.ts:12` 那种写法**明写取舍**（"与上游的差别：不记尺寸"）。**别用 (c) 什么都不说**——现在就是这个状态。
3. **上游 Search Everywhere 会记位置、且 `setLocateWithinScreenBounds(false)`（`:148`）**；本仓 `clampPopupLocation`（`src/popupBounds.ts:64-70`）始终夹回 —— 本仓是 WebView，这个偏离是**正确的**，`popupBounds.ts:60-63` 已自述理由。**此项不需要动**，登记以免下一个人误"补"成不夹。
4. **引用更正 5 条**（全在注释/文档里，零行为风险；`#111` 的"判决订正"结论方向是对的，只是行号有偏差）：
   | 位置 | 现在写的 | 实测 |
   |---|---|---|
   | `src/popupBounds.ts:5` | `PopupState.java`，`192L` | **194 行**（`wc -l`） |
   | `src/popupState.ts:4` | 类注释在 `PopupState.java:23-26` | 注释块 `:20-23`，被引的那句在 **`:21-22`**；`:23-26` 落在 `*/`、`@ApiStatus.Experimental`、类声明、字段上 |
   | `src/popupState.ts:5` | 判据 `:56-61` | 方法体 **`:56-60`**（61 是空行；语义"问一次就复位 `hiddenLongEnough`"核对为**真**，`:57-58`） |
   | `src/popupBounds.ts:19` + `SearchEverywhereDialog.vue:220` | `SearchEverywhereManagerImpl.java:184-188` = "`getSize` 为 null 才用 `getPreferredSize()`" | `:184` 无 null 判断；`:185-188` 是按 **`ViewType.SHORT`** 分支。正确出处 = **`AbstractPopup.java:959-966`** |
   | `src/components/ProjectDialog.vue:289` | "关时 `DialogWrapperPeerImpl :1161-1172` 存" | `:1161-1163` 是 guard、`:1172` 是 **putLocation**；**putSize 在 `:1179`**（范围该写成 `:1161-1179`） |
   核对为**精确**、无需改的：`AbstractPopup.java:3145-3148` / `:2314-2318` / `:3140-3143` / `:2320-2324` / `:594-596`、`DialogWrapper.java:1316-1321` / `:1784-1787` / `:1095`、`DialogWrapperPeerImpl.java:442-443`（setResizable）与 `:946-958`（开时读）、`PopupChooserBuilder.java:284-287` / `:444`、`SearchEverywhereManagerImpl.java:147`、`registry.properties:100`。

## 6. 交接请求（给主代理）

**本 lane 未改任何 `src/`**；以下四项请主代理落（都在 `.vue`/`.ts` 注释与 scoped style 内）：

| # | 要动的文件 | 动作 | 是否碰紧箍文件 / 腾位方案 |
|---|---|---|---|
| R1 | `src/components/SearchEverywhereDialog.vue`（现 **508 行**） | 加 `onBeforeUnmount(storeBounds)`，使关闭即存（覆盖 esc/选中/点外）；若同时做 R2，把 `:351` 上的 `@pointerup="storeBounds"` 撤掉以免无谓重复写 | **不碰 `App.vue`/`bridge.ts`/`CodeEditor.vue`**。模块尺寸上限 900（`tests/module-size.test.mjs:22`），508 行余量充足，**无需腾位** |
| R2 | 同上（scoped style，`:476` 附近） | 二选一：`.search-everywhere{resize:both}` **或** 去掉 `:233` 的尺寸一半并在 `:217-221` 注释明写"只记位置，不记尺寸" | 同上，**无需腾位**。⚠️ **别动全局 `.command-palette`（`src/style.css:1012`）—— `grep -rln "command-palette" src/components/` 实测 **18 个**组件共用这个类**（AboutDialog/BreakpointsDialog/KeymapDialog/RunAnythingDialog/SearchEverywhereDialog/SpecialPathsDialog…），给它加 `resize` 会一次改到 18 个浮层 |
| R3 | `src/popupBounds.ts`(70L) / `src/popupState.ts`(35L) / `SearchEverywhereDialog.vue` / `src/components/ProjectDialog.vue` | §5b-4 的 5 条引用更正（纯注释/文本） | 三个源文件都远小于 900，**无需腾位**；`ProjectDialog.vue` 同理 |
| R4 | 账本 | 把 `#111` 保持 **completed**；把 `stripefix` 对本档的 `[-]` **撤掉/改注为"方法错：用工作区 diff 空判定未落，实际已在 HEAD（`861ba98` / `dfbda4e`）"**。另：`docs/batch-2026-10-06-findrep2.md` 里的 `ConsoleViewImpl.kt:999999-999999` 是**引用门当前唯一的红**（§4d），归 findrep2 lane，不在本档 | 不涉及 |

**明确不需要动**：`src/bridge.ts`（0 贴顶）、`src/App.vue`（余量 30）、`src/components/CodeEditor.vue`（余量 2）—— 本档四项补丁全部落在别处，**没有任何一项要求给这三个文件腾位**。若 R1/R2 后续要把开关暴露成设置项，才会回到 `App.vue`/`bridge.ts` 那一侧；届时请另开 lane，本请求不预设。

## 7. 附录：本 lane 跑过的命令（全部只读）
```
grep -rn "dimensionSize\|storeDimension\|dialogGeometry\|panelResize\|rememberSize\|lastSize" src/ tests/
grep -rn "popupBounds" src/ tests/ ; grep -rn "storeBounds\|parsePopupBounds\|serializePopupBounds\|clampPopupLocation\|PopupBounds" src/ tests/
grep -rn "BOUNDS_KEY" src/ tests/
grep -n "dialogSize" src/components/ProjectDialog.vue src/components/SpecialPathsDialog.vue
grep -rn "sizeStorage" src/
grep -n "loadDialogSize|saveDialogSize|sizeFromRect|clampDialogSize|KEY|resize" 两个对话框
grep -n "createPanelResize" -A8 src/App.vue ; grep -rn "rememberSizeForEachToolWindow" src/previewSettings.ts src/settingsPersistence.ts
grep -n "command-palette" src/components/SearchEverywhereDialog.vue ; grep -rn "\.command-palette" src/*.css
grep -rn "popupState\|createPopupGate" src/ tests/
wc -l AbstractPopup.java(3240) DialogWrapper.java(2436) DialogWrapperPeerImpl.java(1391) PopupState.java(194) PopupChooserBuilder.java(683) SearchEverywhereManagerImpl.java(494)
grep -n "storeDimensionSize\|getStoredSize\|storeLocation\|getStoredLocation\|setDimensionServiceKey\|dimensionServiceKey" AbstractPopup.java
grep -rn "restoreDimensionSize" <popup dir>            -> 无命中（AbstractPopup 内 grep -c = 0）
grep -rn "storeDimensionSize" <整树>                    -> AbstractPopup:1144/2314, DocumentationComponent:640, BranchActionGroupPopup:200/202, GitBranchesPopupBase.kt:340/342, api-dump*
grep -rn "ide.popup.hide.show.threshold" <platform>     -> PopupState.java:59, util/PopupState.java:36, registry.properties:100-101
git status --porcelain -- <8 个本档文件>                 -> 零输出
git log --oneline -3 -- src/popupBounds.ts src/dialogGeometry.ts tests/popup-bounds.test.mjs tests/dialog-geometry.test.mjs
git log -1 --format / --all --grep=dimensionSize -i     -> 零命中
node --test tests/popup*… tests/module-size.test.mjs    -> 291/291 pass（§4b）
node .tools/find-orphan-modules.mjs --gate              -> 绿（§4c）
node --test tests/source-citations.test.mjs             -> 1 红，属 findrep2 lane（§4d）
```
未使用 `third_party/intellij-community`（空/坏树，禁用）；未跑 `TAOCODE_CITATION_ANCHORS=update`；未做任何 `git add/commit/checkout/reset/stash/clean/push`；`src/**`、`tests/**`、`native/**`、`docs/inventory/**` 一字未动。
