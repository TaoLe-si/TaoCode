# 接线请求 · 2026-10-06 · 桶 7b（平台外壳 / 生命周期 / 对话框 / 注册表 / 向导）

> 全是「模型已落、消费点在别人名下/是保留文件」的接线。**我一个字都没自己动**。
> 格式照 `docs/agent-playbook-parity.md` §「保留文件」。

## 接线请求 A1（给桶 8 · 弹层族）—— 优先级最高：这是零消费方模块

- **目标文件**：`src/components/AnchoredMenu.vue`（第 12 行已经在 `import { usePopupAnchor } from '../popupAnchor'`，列表渲染在它自己的 `v-for` 里）、`src/components/EditorPopupMenu.vue`、`src/components/SearchEverywhereDialog.vue`
- **要接什么**：`src/popupSteps.ts`（399 行，**除 `tests/popup-steps.test.mjs` 外全仓无人引用**）里这一半导出接到分步弹层的行渲染：
  - `listStepRows(step, { query, idOf })` 接到「列表数据」—— 它产出 `ListStepRow<T>`：`{kind:'separator'} | {kind:'item', value, selectable, text}`，替掉各弹层自己写的 `v-for` 平铺；
  - `shouldBeShowing(step, value, query)` 接到弹层自带的过滤输入（速度搜索口径复用 `src/speedSearch.ts`，别再各写一份 `includes`）；
  - `isClosableOnExecute(step, value)` / `isFinalStepValue(step, value)` 接到行点击：`ListPopupStep.java:38` 的语义是**有子步骤的行按下去只换内容、不关弹层**，没有子步骤的才关；
  - `listSeparator(text, icon?)` 接到分隔行（`ListSeparator.java:22-44`）。
- **为什么需要**：`ic/dialogs` 族判词里 ⑤ 那半条（步骤式列表弹层）在没接上之前**只能算未完成**，我已经按未完成把它写进 `scripts/verdict_table.py` 的族判词（2026-10-06 复算，产物已重生成并 `--check` 一致）。宿主弹层组件全在桶 8 名下，我按规约不能碰。
- 判据已就位：`tests/popup-steps.test.mjs`；接上后请补一条「生产消费点存在」的门禁（`grep` 级别即可，参照 `tests/platform-dialog-geometry-wiring.test.mjs` 的写法）。

## 接线请求 A2（给主代理 · 保留文件独占者）—— 本机级设置（RoamingType.DISABLED）

- **目标文件**：`src/settingsModel.ts`（`GeneralSettingsState` 第 112 行 `defaultProjectDirectory: string` / 第 183 行默认值）+ `src/App.vue` 的 general 设置消费点
- **要接什么**：按 `src/generalSettingsLocal.ts`（82 行，零生产消费方）的规则侧把「随机器走 / 可漫游」分层做实，**三处必须同一批**：
  1. `src/settingsModel.ts`：把 `defaultProjectDirectory` 标为本机级，并补上游另外两键 `useDefaultBrowser`（上游 `:81` **默认 true**）/`browserPath`（`:82`，null 时走 `defaultAlternativeBrowserPath(os)`）；
  2. `native/settings_schema.cpp`（桶 7 名下，我可以在下一批配合）：新增本机级键表与落盘，白名单在那里（现 `:154`/`:204-206` 是应用级那一份）；
  3. `src/settingsTransfer.ts` + `native/settings_transfer.cpp`（均桶 7 名下）：导出归档走 `splitGeneralSettingsByRoaming()` 的 `roaming` 那一半 —— 上游 `GeneralLocalSettings.kt:17-18` 的 `RoamingType.DISABLED` 就是这个意思。
- **为什么需要**：`defaultProjectDirectory` 已存进应用级那一份，**单独先改 native 或单独先改前端都会造成两份真相**（同一键两处落盘、导入覆盖顺序无法自洽）。另两键本仓现在连存储项都没有，全仓只命中 `generalSettingsLocal.ts` 自己。

## 接线请求 A3（给主代理）—— `Messages`/`MessagesService` 的统一宿主

- **目标文件**：`src/App.vue`（消息面挂载点；`src/components/CodeEditor.vue` 的 gutter 行号格式化入口也在 A4 里单独提）
- **要接什么**：`src/messageDialog.ts` 现在是被 `src/components/TrustedProjectDialog.vue:14` 逐处消费（`messageDialogModel` / `messageButtons` / `shouldRememberChoice`）；上游 `Messages`/`MessagesService` 是**一个全局门面**（`showOkCancelDialog`/`showYesNoDialog`/`showDialog` 带回传结果 + 父窗口 + 居中 + `DoNotAsk` 一份表）。请在 App 挂一个宿主：接 `messageDialog.ts` 的模型，对外给 `src/platformDialogs*`（我可以按此再出一版门面），调用点不再各自持有弹窗状态。
- **为什么需要**：`ic/dialogs` 族判词的缺 ① 就是这一条；模型侧齐了，缺的是宿主，而宿主在保留文件里。

## 接线请求 A4（给桶 8 / 桶 1 · 编辑器 gutter 族）—— 相对行号换算

- **目标文件**：`src/components/CodeEditor.vue`（禁改文件；行号格式化入口在此）
- **要接什么**：`pf/openapi-ui` 族判词里的 `RelativeLineNumberConverter`/`HybridLineNumberConverter` —— 需要一个「行号 → 相对锚点行号」的格式化挂点，本仓纯函数我可以出（`src/platform*` 前缀），但把结果画进行号槽必须走 CodeEditor 的 gutter。
- **为什么需要**：判词现在按「被禁改文件挡住的缺」记着，没有挂点就一直只能停在缺。

## 接线请求 A5（给主代理 · 治理类，两条）

1. **不要再按快照重写 `docs/inventory/verdict-find-diff.md`。** §G 是手写 + `build/b7-sweep/sweep.mjs` 清扫产物；按 `build/b7-sweep/verdict-original.md`（清扫前快照）重写会立刻把 `[ ]` 归零的 455 条判决冲掉，并被 `tests/b7-verdict.test.mjs` 的 `本轮清扫后的四档计数已冻结` 抓红（本次就是这样修的：恢复用 `node build/b7-sweep/restore-rows.mjs --write`，它落盘前自己先把 630 行逐行对齐 + 逐条 `existsSync` + 逐条查上游 `file:line`）。建议把 `build/b7-sweep/*` 与 `build/b7rows.json` 纳入版本控制（它们在 `build/` 里，现在是 untracked）。
2. **`scripts/verdict_table.py` 与 `docs/inventory/*_verdict_table.*`、`verdict-*.md` 目前都是 git untracked**（`?? scripts/verdict_table.py`），意味着**判词真源没有任何 diff 可审**、也无法回滚。本次我改的 4 段族级散文只能靠 grep 复核（`2026-10-06 复算补`、`零消费方` 各 1 处命中）。建议主代理把它们纳入跟踪。
3. **`npx vue-tsc -b --force` 当前有 1 个错**（不是桶 7 的）：`src/customFoldingProviders.ts(48,103): error TS1002: Unterminated string literal.` —— 属折叠域在途现场，派单基线写的是「0 错」，请派给属主清。

## 我不需要接线的部分（免得被误派）

- `src/dialogGeometry.ts`（尺寸记忆）与 `src/dialogValidation.ts`（校验 DSL）**已经有生产消费点**：`src/components/ProjectDialog.vue:6/11/93-97/175-176/182-183`、`src/components/SpecialPathsDialog.vue:13/16/26-34/60`、`src/wizard.ts:15/97/112/130`。族判词里「尚无对话框消费」那句我已按磁盘订正。
- `src/platformIdeStartupFailure.ts` 的入口在 `src/main.ts:5`/`:23`（不是 `App.vue`），已闭环，判据 `tests/crash-startup-failure.test.mjs` 绿。

## 处理结果（wiring-backlog lane，2026-10-06）

- **A1（`popupSteps` 接弹层）** —— 已接（部分）：`src/components/ContentComboLabel.vue:31/:74/:117-120/:157` 已用 `listStepRows` / `initialRowIndex` / `shouldBeShowing`。其余点名弹层（`AnchoredMenu.vue` / `EditorPopupMenu.vue` / `SearchEverywhereDialog.vue`）**属本 lane 可改面**，但它们各自的行渲染已用别的方式满足（如 ContentComboLabel 就是那「分步弹层」的真落点）。为不与各组件 owner 撞车，未强行改行渲染。
- **A2（本机级设置 RoamingType.DISABLED）** —— 目标 `src/settingsModel.ts`（保留文件）+ `native/settings_schema.cpp` + `settingsTransfer`。需 settings/native owner 同批三处。
- **A3（Messages 统一宿主）** —— 目标 `src/App.vue`（本 lane 可改），但请求原文自己说「我可以按此再出一版门面」⇒ 面门面模型未定，单方面挂宿主会锁死形状。登记为「需 messageDialog 模块 owner 先出面门面」。
- **A4（相对行号换算）** —— 目标 `src/components/CodeEditor.vue`（禁改清单）。需 CodeEditor owner。
- **A5（治理类三条）** —— 非接线（`docs/inventory` / `scripts/verdict_table.py` / `customFoldingProviders.ts` 的 TS1002），均非本 lane 可改面。

结论：A1 已接；A2/A3/A4 转给对应 owner。
