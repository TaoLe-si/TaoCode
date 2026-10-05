# 批次报告 · 2026-10-06 · 桶 7b（平台外壳 / 生命周期 / 对话框 / 注册表 / 向导）

接手对象：前一个「平台外壳」代理（撞 150 次上限被切断，名下 6 条红、零报告）。
本篇只覆盖 **桶 7 名下**那 6 条红 + 任务 2 的 `platform_rest` 四族判词复算。**验证只跑自己域**。

---

## 0. 实况 vs 派单（先说清哪句话与磁盘不符）

| 派单里的说法 | 磁盘实况 | 影响 |
|---|---|---|
| 「b7 域 = `docs/inventory/actions.txt` 那 317 类」 | `tests/b7-verdict.test.mjs` 读的是 **`docs/inventory/verdict-find-diff.md` + `find-diff.txt` + `find-diff_signals.json` = 630 类**（find+diff 域）。`actions` 域 317 类的门控不在 b7-verdict 里（`tests/` 全仓无一处引用 `verdict-actions.md` 的门禁，只有 `actions_verdict_table.json` 产物）。 | 我以 **b7-verdict.test.mjs 的真实读入路径**为准修；没按 317 类去动 actions 域一个字。 |
| 「判词文件被 `scripts/verdict_table.py` 重写后与门禁失配」 | 护栏**已经在** `scripts/verdict_table.py:933-950`（2026-10-06 事故之后加的）：默认**拒绝**就地重写含手写 §G 的 `verdict-find-diff.md` / `verdict-actions.md`，只有 `--force` 才覆盖。失配的成因不是这个脚本，是**按快照重写**（见 §1 根因）。 | 修法因此是「把判词按已复核产物恢复」，不是「再去跑一次生成器」。 |
| 「6 条红，报告一个字没写」 | 接手时实测：**13 条用例里 12 绿 1 红**。`main-toolbar-render.test.mjs` 3/3 已绿（前代理已修完），`b7-verdict.test.mjs` 10 条里 9 绿 1 红。 | before/after 以实测数写，不抄派单里的旧基线。 |

---

## 1. 那 6 条红：逐条根因 + 改了哪里 + before→after

接手时第一条命令的实况（`node --test tests/main-toolbar-render.test.mjs tests/b7-verdict.test.mjs`）：
**tests 13 / pass 12 / fail 1**，耗时 1113 ms（对照旧基线「整文件失败 ~2 s」已经不成立）。

### 1.1 `tests/main-toolbar-render.test.mjs`（旧基线：整文件加载失败）

- **病因**：三条系统性病因里**第三条的变体**。`find-param-props` / `find-ts-in-mjs` / `find-missing-ext` 三个检测器在本仓当前树**都是干净的**（收工前又跑了一遍，见 §4），所以既不是参数属性也不是 TS-in-`.mjs`。真因是 **编译出的 CJS 里 `require('../xxx.ts')` 以组件目录为基准**，而测试的 `createRequire` 以测试文件为基准；前一批把运行仪表盘接进 `MainToolbar.vue`（新增 `../bridge` / `../runInstances.ts` / `../runDashboard.ts` 三个兄弟 import），**逐个点名映射**的写法立刻 `Cannot find module`，整文件红。次因：工具栏里两处真 `window` 用法（仪表盘心跳 `setInterval`、选择器宽度 `pointermove`）在无 DOM 的自搭渲染器里卸载钩子抛 `ReferenceError`。
- **谁改的**：**前代理已经改完**（工作区里是未提交改动）。我做的是复跑确认 + 逐条核对**没有放松断言**：
  - `const require = createRequire(import.meta.url)` → `require_` + 一个按 `src/` 解析的 wrapper（`MODULE_NOT_FOUND` 才回退原样解析，**模块自身抛的错原样冒出来**，不许掩盖真缺陷）；
  - 加最小 `globalThis.window` 桩（只记调用，不替组件做决定，套路与 `tests/tab-behavior` 一致）；
  - 新增 3 个 require 分支（`../bridge` 给只认 `run.stop` 的 request 桩，实例清单用**真模块**）。
- **before→after**：整文件加载失败（0 跑）→ **3/3 绿**（`rendered toolbar places NewUiRunWidget …` / `compiled Escape handler …` / `rendered run controls retain …`）。
- 三条断言体一个字未动（`git diff -- tests/main-toolbar-render.test.mjs` 只有上面那几处 fixture 变化 + 注释，**无删除断言**）。

### 1.2 `tests/b7-verdict.test.mjs`（旧基线：5 条红）

接手时 10 条断言里 9 条已绿。逐条：

| 断言 | 接手时 | 收工 | 根因 / 处置 |
|---|---|---|---|
| `§G 逐条覆盖切片里的每一个类，且不引入切片外的类` | 绿 | 绿 | — |
| `§G 恰好 630 行` | 绿 | 绿 | — |
| `每条 [x]/[~] 都指着一个真实存在的本仓文件` | 绿 | 绿 | 恢复判决后**重新成立**（恢复脚本自己 `existsSync` 逐条验，见 §2） |
| `上游测试源码一律 [-]` | 绿 | 绿 | 13 个 test 类在恢复产物里全是 `[-]` |
| `四档算术与页脚一致` | 绿 | 绿 | 页脚那句随 §G 实际行数重算 |
| `每条 [-] 都带上游 文件:行号 依据` | 绿 | 绿 | 前代理给当时那 86 条 `[-]` 补了 `（上游声明 path:line）`；恢复产物 247 条 `[-]` 全部带 `依据：path:line 的 <marker>` |
| **`本轮清扫后的四档计数已冻结`** | **红** | **绿** | 真因见下 |
| `src/diffAlign.ts 引的上游行号没有漂` | 绿 | 绿 | — |
| `§E 差异表没有缩水 …` | 绿 | 绿 | — |
| `§0 的机械信号与扫描产物一致` | 绿 | 绿 | — |

**唯一真红的那条，根因不是断言坏，是判词文件被写回了清扫前**：

- 门禁冻的数是 `[x]31 / [~]352 / [ ]0 / [-]247`；磁盘上 §G 是 `[x]12 / [~]77 / [ ]455 / [-]86`（`git show HEAD:docs/inventory/verdict-find-diff.md` 与 `git show 6db59c4:…` 复算，两版分别是 12/77/455/86 与 11/40/498/81 —— **`[ ]` 归零那版从来没进过 git**）。
- 455 条 `[ ]` 的去向是 284→`[~]`、161→`[-]`、10→`[x]`，再加 9 条 `[~]`→`[x]`（§A9–A14 那批）与 2026-10-04 的 `FindInPathAction`、`CombinedDiffSearch` 两条改判 —— 与冻结核 `31/352/0/247` 逐档对得上。
- 清扫产物还在：`build/b7-sweep/sweep.mjs`（清扫器，`--check` 打印 20/363/0/247 = 纯清扫那一档）+ **`build/b7rows.json`（630 行逐类判决，含 9 条升级）** + `build/b7-sweep/verdict-original.md`（快照）。我逐行验过 `b7rows.json` 与磁盘 §G **类集/行序 0 漂移**（630 行 `name|path` 全对齐），`[x]/[~]` 指的本仓文件 **0 个不存在**，`[-]` **0 条缺上游 file:line**。
- **修法 = 允许的类型 ①**（判词与源码不符 ⇒ 按真实源码/已复核产物订正）：新增 `build/b7-sweep/restore-rows.mjs`，把 §G 的 630 行按 `b7rows.json` 落回，再补 2 条**有磁盘依据**的改判，页脚按实际行数重算。它默认只打印，`--write` 才写盘；落盘前自己再跑一遍门禁同款校验（`[-]` 必须有上游 `file:line`，`[x]/[~]` 必须有磁盘上真实的 `src|native` 路径），任一条不满足直接抛错不写。
- **before→after（文件级）**：`12 / 77 / 455 / 86` → **`31 / 352 / 0 / 247`**；改了 552 行判决格 + 1 行页脚；文件行数 931 → 941（只多了 §A7/§C/§F 三处说明，没删任何行）。

**没有做的（明确写出来免得被当成偷工）**：没删任何断言、没把 `equal`/`deepStrictEqual` 放松成 `ok`/`match`、没把任何目录从门控里排除、没动 `tests/b7-verdict.test.mjs` 与 `tests/main-toolbar-render.test.mjs` 的**一个字**（见 §3 自证）。

---

## 2. 判词订正的 before/after

### 2.1 find-diff 域（`docs/inventory/verdict-find-diff.md`，手写 + 清扫器产物）

| 位置 | before | after |
|---|---|---|
| §G 四档 | `[x]12 / [~]77 / [ ]455 / [-]86` | `[x]31 / [~]352 / [ ]0 / [-]247` |
| 页脚 `合计 630 类：…` | 12/77/455/86 | 31/352/0/247（由脚本按实际行数重算） |
| `FindInPathAction` | `[~]`「…但没有打开查找工具窗 + 最近搜索历史」 | `[x]` 入口 `src/menus/editMenu.ts:96`（`edit.findInPath`，`Ctrl Shift F`）+ 最近搜索 `src/findInProjectRecents.ts`，记录点 `src/components/SearchPanel.vue:122`、预填点 `:601-602` |
| `CombinedDiffSearch` | `[~]`「…缺在差异视图内部搜索片段」 | `[x]` 规则 `src/diffSearch.ts`、接线 `src/components/DiffView.vue:171` + `:230-247`、判据 `tests/diff-search.test.mjs` |
| §A 新增 `A7` | 无 | 「`[x]` 12→31 的来路」：逐档去向 + 产物路径 + 谁在什么时候把它写回快照 |
| §C 表头 | 「这些是本仓确实没有…」 | 加一行说明：这一档已被第一百一十七批清空，族级表保留为「为什么只能到 `[~]`/`[-]`」 |
| §F 门控清单 | 7 条（与测试里 9 条对不上） | 补第 8（计数冻结）/第 9（`[-]` 必须带 `file:line`） |

### 2.2 platform_rest 域（真源 `scripts/verdict_table.py`，产物 `docs/inventory/verdict-platform_rest.md`）

**四族逐条复算**（「判词说缺」→ 磁盘真相）。改的是 `.py` 的 `PLATFORM_FAMILIES` 表，再 `python scripts/verdict_table.py platform_rest` 重新生成，**没手改 `.md`**；`--check` 复核 **3/3 产物一致**。域级计数不受影响（`total=20574 [x]=22 [~]=5423 [ ]=0 [-]=15129`，改的是族级散文）。

| 族 | 项（判词里的「缺」） | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| `pf/platform-ide` | 启动失败的上报面 `StartupErrorHandler`/`StartupErrorReporter` | **缺 → 已落**（订正） | `platform/platform-impl/src/com/intellij/platform/ide/bootstrap/StartupErrorReporter.java:353-409`（先分类再挑标题）、`:122-141`（前缀+栈+`-----`+运行时附录）、`:143-150`（`jreDetails` 四个 `(unknown …)` 兜底）、`:191`（四个选项）；`.../StartupErrorHandler.java:11-13`（`uploadLogs(Throwable, Path logs)`）—— **四个行号我都打开上游文件核过** | `src/platformIdeStartupFailure.ts`（`STARTUP_FAILURE_*`/`detectStartupRuntime:83`/`startupRuntimeLine:96`/`startupFailureReport:126`/`renderStartupFailure:177`/`showStartupFailure:218`）+ 入口 `src/main.ts:5`、`:23`；判据 `tests/crash-startup-failure.test.mjs` | 只落 `start.failed` 一支（安装损坏/插件初始化两支的**前提不成立**：没有安装器、插件只是配置目录下的文件夹）；四个选项只渲染真能干活的两个（复制报告 / 打开日志目录），`Reset Settings&Plugins`（要 `ConfigBackup`）与 `Report Problem`（要 JetBrains 上报后端）**不渲染**；退出码层不做（宿主 `native/main.cpp` 禁改）。**真缺口**：`uploadLogs` 的上报通道（上游 `StartupErrorReporter.java:286-310` 把 `idea.log`+`product-info.json` 打 zip） |
| `pf/platform-ide` | `PresentationAssistantConfigurable` 设置页「设置库没有空位（`SettingsDialog.vue` 顶在 1356 行上限）」 | **数字过期 → 订正** | —（本仓事实） | `src/components/SettingsDialog.vue` 实测 **1176 行**，`tests/module-size.test.mjs:116-124` 登记上限 **1182** | 结论不变（只剩 6 行余量，新挂一页得先搬一块出去），但 1356 是 2026-09-27 拆页之前的旧数 |
| `ic/dialogs` | 缺 ②「尺寸记忆与校验没接进真实对话框（`src/dialogGeometry.ts` 没有消费者）」 | **缺 → 已落**（订正） | `DialogWrapperPeerImpl.java:442-443`（可拖角）、`:946-958`（读 DimensionService）、`:1161-1172`（写）—— 已由 `src/dialogGeometry.ts` 头注释引着、引用门控在跑 | `src/components/ProjectDialog.vue:6`、`:11`、`:175-176`（还原）、`:182-183`（写回）+ 校验 `:7`、`:93-97`；`src/components/SpecialPathsDialog.vue:13`、`:16`、`:26-34`、`:60`（`resize: both`）；`src/wizard.ts:15`、`:97`、`:112`、`:130`；判据 `tests/dialog-geometry.test.mjs` + `tests/platform-dialog-geometry-wiring.test.mjs` + `tests/dialog-validation.test.mjs` + `tests/wizard-steps.test.mjs` | 同一份事实在 `pf/openapi-ui` 判词里已经写了（两族口径不一致），这次把 `ic/dialogs` 与 `src/dialogGeometry.ts` 那句「**尚无对话框消费**」一起订正。**仍缺的是基座层**：本仓各对话框仍是逐处手写 `<dialog>`，没有 `DialogWrapper.createCenterPanel` 那种统一基座，新对话框要自己接 |
| `ic/dialogs` | 缺 ⑤「`ListPopup`/`ListPopupStep`/`ListSeparator`/`PopupShowOptions` 的步骤式列表弹层与显示选项模型（本仓各弹层自己写列表渲染与定位）」 | **一半已落 / 一半零消费方**（订正 + 登记未完成） | 显示选项：`platform/ide-core/src/com/intellij/openapi/ui/popup/PopupShowOptions.kt:16-48`（`screenX`/`screenY`/`popupComponentGap`/`withMinimumHeight`/`withRelativePosition`）、`:121-128`（builder 初值）、`:194-205`（`PopupShowOptionsImpl` 字段）—— 注意它是 **`.kt`**，按文件名 `PopupShowOptions.java` 搜不到（本仓踩过的那条坑）。步骤模型：`.../ListPopupStep.java:21`/`:29`/`:38`/`:40-42`/`:62`/`:70`/`:75`、`.../ListSeparator.java:22-44`（两个文件都打开核过成员与行号） | 已落的一半：`src/popupSteps.ts` 的 `PopupShowOptions`/`showOptionsPoint` ← 生产消费点 `src/popupAnchor.ts:11`（再往下是 `AnchoredMenu.vue`/`EditorPopupMenu.vue`/`SearchEverywhereDialog.vue`）。未完成的一半：`listStepRows`/`isClosableOnExecute`/`isFinalStepValue`/`shouldBeShowing`/`listSeparator` **除 `tests/popup-steps.test.mjs` 外全仓无人引用** | 步骤弹层的宿主组件在**桶 8 名下**（弹层族），不在我的所有权 ⇒ 按规约**不自己动**，交接线请求 A1。接上之前判词按「未完成」算，不放行、不改档 |
| `pf/openapi-ui` | 尺寸记忆/校验两条基座行为（判词已写「本轮补了」） | **已落**（复核 + 补第二消费者） | 同上 `DialogWrapperPeerImpl.java` 三处 | 同 `ic/dialogs` 那一行；另外把「第二个消费者 `SpecialPathsDialog.vue`」补进判词 | 其余 4 条「缺」逐条复核后**仍成立**，未改档：`FrameWrapper`/`NonModalWindowWrapper`/`WindowWrapperBuilder`（本仓工具窗口自带布局，没有可包装的浮动窗口栈）、`DialogWrapperPeer`/`ShadowPainter`（Swing 组件树 + 阴影绘制本体）、`MessagesEx`/`MultiLineLabel`/`VerticalSeparatorComponent`、`playback/`（要驱动 Swing 组件树）、`RelativeLineNumberConverter`/`HybridLineNumberConverter`（要有 gutter 行号格式化入口，落点在禁改文件 `src/components/CodeEditor.vue`） |
| `pf/lifecycle` | 8 条「缺」 | **逐条复核，全部仍未落**（判词不改档） | `ConfigBackup`/`CustomConfigMigrationOption`、`SharedConfigFolderUtil`、`ProjectFrameAllocator`、`MultipleFileOpener`、`PermanentInstallationID`、`JBProtocolHandler`、`ExitStarter`/`SaveStarter`、`ConstrainedExecution`、`DumbServiceImpl` | 全仓 grep 这些符号：除 `src/platformIdeStartupFailure.ts` 里「为什么不渲染」的说明性引用外**零命中** | 具体卡点：本机级存储要三处同时动（`native/settings_schema.cpp` 加第二份键表 + `src/settingsModel.ts` 把三键搬走 = 保留文件 + `App.vue` 消费点），单搬任何一处都会造成两份真相；协议唤起/退出码在 `native/main.cpp`（禁改）；索引态与遥测本仓前提不成立。零消费方的 `src/generalSettingsLocal.ts` 见接线请求 A2 |

---

## 3. 「没有 weakened 任何断言」的自证

- 本次会话**没有编辑过任何 `tests/*` 文件**。`git diff --numstat -- tests/` 那 55 个测试文件的改动是这棵树里**别的代理**的在途现场（我没碰），我名下两个的 hunk 归属可逐条读：
  - `tests/b7-verdict.test.mjs`：`22 增 / 0 删` —— 全部是前代理**加**的两条门禁（`本轮清扫后的四档计数已冻结` = `deepStrictEqual` 到 `[31,352,0,247]`；`每条 [-] 都带上游 文件:行号 依据` = `deepEqual(bad.map(...), [])`）+ 注释。**新增门禁 = 收紧，不是放松**，两条我一条没删、没改期望值。
  - `tests/main-toolbar-render.test.mjs`：`33 增 / 1 删` —— 唯一那行删除是 `const require = createRequire(import.meta.url)`，被换成同义的 `require_` + 按 `src/` 解析的 wrapper；**断言体（3 条）0 改动**。
- 冻结计数那条我是**把判词改到与门禁一致**，不是把门禁改到与判词一致（若走后者就是把 `deepStrictEqual` 的期望值抄成当前错账，规约明令禁止）。
- 恢复脚本 `build/b7-sweep/restore-rows.mjs` 在 `--write` 前跑的是**门禁同款的更严版本**（额外要求 `[x]/[~]` 至少指到一个真实文件、630 行逐行 `name|path` 对齐、四档和必须 = 630），任一条不过就抛错不落盘。

---

## 4. 验证数字

| 命令 | 结果 |
|---|---|
| `node --test tests/main-toolbar-render.test.mjs tests/b7-verdict.test.mjs`（接手时） | tests 13 / **pass 12 / fail 1**，1113 ms |
| 同上（收工） | tests 13 / **pass 13 / fail 0**，1167 ms |
| `node --test tests/icon-glyph-role.test.mjs`（唯一另一个读 verdict-find-diff.md 的门禁） | **5/5 绿**（它在注释里引 `verdict-find-diff.md:879`，我核对过该行仍是 `SnippetRenderingData` 那条 `[-]`，行号没漂） |
| 自己域：`tests/platform-dialog-geometry-wiring / crash-startup-failure / dialog-geometry / dialog-validation / message-dialog / wizard / wizard-steps / platform-general-registry-panel` | **47/47 绿** |
| `python scripts/verdict_table.py platform_rest` + `--check` | 生成后 **一致 3/3**；域计数 `total=20574 [x]=22 [~]=5423 [ ]=0 [-]=15129`（散文改动不动档） |
| `node .tools/find-param-props.mjs` | **0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | **干净：tests/*.mjs 全部纯 JS**（会话中途曾报 `tests/junit-rules.test.mjs:14` 一处 `as` 断言 —— 桶 11 名下、非我文件，收工前它已被该域修掉） |
| `node .tools/find-missing-ext.mjs` | 扫描 1075 个文件，**没有漏扩展名**的相对 import |
| `npx vue-tsc -b --force` | **1 个错误**：`src/customFoldingProviders.ts(48,103): error TS1002: Unterminated string literal.`。判定依据：该文件不在桶 7 名下（折叠域），我没有一次写操作落在它上面（本会话改过的文件清单见 §5），且错误形态是字符串字面量未闭合 —— 是别人写到一半的现场。基线派单说「全仓 0 错」，因此这条不是我引入的回归。 |
| native | **无 native 改动** ⇒ 不跑 ctest（`native/dialogs*.cpp`、`native/settings_schema.*`、`native/settings_transfer.cpp`、`native/projects*.cpp` 一个字未动） |

**没有跑全量 `npm test`**（按规约，父代理统一跑）。

---

## 5. 我改的文件（全清单）

| 文件 | 动作 | 说明 |
|---|---|---|
| `docs/inventory/verdict-find-diff.md` | 修改（git 跟踪中，`+563/-553`） | §G 630 行判决恢复 + 页脚重算 + §A7/§C/§F 三处说明。未删任何行。 |
| `scripts/verdict_table.py` | 修改（该文件**未被 git 跟踪**，`??` ⇒ 无 diff 可出示，证据用 grep：`2026-10-06 复算补` / `零消费方` 各 1 处命中） | 只动我四族的族级散文（`pf/openapi-ui`、`pf/platform-ide`、`ic/dialogs`、`pf/lifecycle` **未改**）；没碰 `FAMILIES`/`OVERRIDES`/域表/护栏逻辑。 |
| `docs/inventory/verdict-platform_rest.md` | 重新生成（产物） | 与 `.py` 一致（`--check` 3/3） |
| `docs/inventory/platform_rest_verdict_table.json` | 重新生成（产物） | 同上 |
| `build/b7-sweep/restore-rows.mjs` | 新增（`build/` 不在版本控制内，是复核工具的落点，与既有 `build/b7-sweep/sweep.mjs` 同一目录） | §G 恢复器：默认打印、`--write` 才落盘、落盘前自检 |
| `docs/batch-2026-10-06-bucket7b.md` | 新增 | 本报告 |
| `docs/wiring-requests-2026-10-06-bucket7b.md` | 新增 | 接线请求 |

**未动**：`src/App.vue`、`src/components/CodeEditor.vue`、`src/style.css`、`src/tokens.css`、`src/uiIcons.ts`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`src/bridge*.ts`、`src/keymap*.ts`、`src/actionRegistry.ts`、`src/menus/types.ts`、`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`、`CMakeLists.txt`、任何 `native/*`、任何 `tests/*`、桶 1/2/4/5/6/8/10/11/12/15 名下文件、`tests/b8~b10-verdict.test.mjs` 与 `verdict-{editor,settings-run,vcs}.md`。没有 `git checkout/reset/stash/clean`，没有 commit/push。

---

## 6. 做不到 / 具体卡点（不是「太复杂」）

1. **`ic/dialogs` 缺 ⑤ 的步骤弹层那一半**：模型已完成且有独立判据（`tests/popup-steps.test.mjs`），但**宿主组件不属我**（`src/components/AnchoredMenu.vue`、`src/components/EditorPopupMenu.vue`、`src/searchEverywhere*` 一族在桶 8 名下）。规约禁止我动别人名下文件 ⇒ 只能交接线请求（A1）。我**没有**把它判成「已落」。
2. **`pf/lifecycle` / `pf/general-settings` 的本机级存储**：`src/generalSettingsLocal.ts`（规则侧，82 行）**零生产消费方**（只有 `tests/general-settings-local.test.mjs` 引用它）。复算后的真实卡点比判词写的更窄也更硬：上游那三个键里**本仓只有一个真的存在** —— `defaultProjectDirectory` 在 `src/settingsModel.ts:112`/`:183` 与 `native/settings_schema.cpp:154`/`:204-206`；`useDefaultBrowser`/`browserPath` 在 `src/settingsModel.ts` 与 native 白名单里**按名字都搜不到**（全仓 `src/**` grep `useDefaultBrowser|browserPath` 只命中 `generalSettingsLocal.ts` 自己），也就是说这两半连"要搬走的源"都还没有。补齐要同时动三处：`src/settingsModel.ts`（**保留文件**，加两个键 + 把 `defaultProjectDirectory` 标成本机级）、`native/settings_schema.cpp`（我名下，但要与 `src/App.vue` 的消费点同一批落地）、导出/导入侧 `src/settingsTransfer.ts` + `native/settings_transfer.cpp`（`RoamingType.DISABLED` ⇒ 归档必须排除）。单独先动 native = **两份真相**（同一批键既在应用级 JSON 又在本机级文件，导入覆盖顺序没法自洽），所以我停手并把顺序写进接线请求 A2 交给主代理。
3. **`pf/openapi-ui` 的 `RelativeLineNumberConverter`/`HybridLineNumberConverter`**：需要 gutter 的行号格式化入口，唯一落点在禁改文件 `src/components/CodeEditor.vue`（本仓行号槽的实现文件）。判词维持「按被禁改文件挡住的缺」，未改档。
4. **`pf/platform-ide` 的 `Splash`/`SplashManager` 与 `AppExitCodes`**：首帧前闪屏与退出码都在宿主窗口生命周期里，`native/main.cpp` 本批禁改；本仓 `AppExitCodes` 那一层脚本侧没有 `System.exit` 对等物。
5. **`ic/dialogs` 缺 ① 的 `Messages`/`MessagesService` 统一宿主**：要一个全局消息面挂载点，宿主在 `src/App.vue`（保留文件，余量极小）。本仓现在是 `src/messageDialog.ts`（模型 + `DoNotAskOption` 规则）被 `TrustedProjectDialog.vue` 消费 —— 模型在、**服务门面没有**。已写进 A3。
6. **我没有新增任何控件/页面**：`src/components/SettingsDialog.vue` 现在 1176 行、登记上限 1182，剩 6 行余量 —— 挂不进新页；按规约「行数上限只能靠拆模块下调，不许上调」，我没有去调上限，也没塞假控件。

---

## 7. 给下一个人的一句话

`docs/inventory/verdict-find-diff.md` 的 §G 是**手写 + 清扫器产物**，`scripts/verdict_table.py` 的护栏（`:933-950`）只挡 `verdict_table.py` 自己；**任何按 `build/b7-sweep/verdict-original.md` 快照重写的动作都会把 `[ ]` 归零那 455 条判决冲掉**，并且**立刻**被 `本轮清扫后的四档计数已冻结` 抓到。要重放，就跑 `node build/b7-sweep/restore-rows.mjs --write`（它会先把产物与磁盘逐行对齐再落笔）。
