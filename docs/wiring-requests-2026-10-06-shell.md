# 接线请求 · 2026-10-06 · 桶 shell（平台外壳 / 生命周期 / 对话框 / 注册表 / 向导）

> 本篇只放**接不上、必须主代理或别的 lane 动手**的线。格式照 `docs/agent-playbook-parity.md` §「保留文件」。
> 上游基准树：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`（下面的路径/行号我都打开核过）。

---

## W-1（给主代理 · 保留文件独占者）—— A2 本机级设置（`RoamingType.DISABLED`）三处必须同批

**这是从 `docs/wiring-requests-2026-10-06-bucket7b.md` 的 A2 接手、并把模块侧做完后剩下的「保留文件那一行」。**

### 模块侧现状（本桶已做完，勿重做）
- `src/generalSettingsLocal.ts`（规则侧，82 行）把上游 `GeneralLocalSettings.kt` 的分类与默认值钉死：
  - `GENERAL_LOCAL_SETTING_KEYS = ['defaultProjectDirectory','useDefaultBrowser','browserPath']`（`:28`）
    —— 对齐上游 `platform/ide-core/src/com/intellij/ide/GeneralLocalSettings.kt:79-83`（三键，不多不少）；
  - `defaultGeneralLocalState()` = `{ defaultProjectDirectory:'', useDefaultBrowser:true, browserPath:null }`（`:57-59`）
    —— `useDefaultBrowser` **默认 true**（`:81`）、`browserPath` 默认 null（`:82`）；
  - `defaultAlternativeBrowserPath(os)` / `resolveBrowserPath()`（`:38-48`）
    —— 对齐 `:28-35`（Windows `C:\Program Files\Internet Explorer\IExplore.exe`、mac `open`、Unix `/usr/bin/firefox`）与 getter `:66-70`；
  - `splitGeneralSettingsByRoaming(general)`（`:65-82`）—— 把一份扁平 general 按本机级/可漫游拆开，导出/同步只带 `roaming` 那一半。
- 判据 `tests/general-settings-local.test.mjs`（6 条）全绿，逐条钉住三键集合、默认值、按平台回落、拆分、坏值兜底、现状登记。
- `RoamingType.DISABLED` 的上游出处：`GeneralLocalSettings.kt:18` 的 `Storage(value = "ide.general.local.xml", roamingType = RoamingType.DISABLED)`。

### 为什么本桶没自己接上（两份真相风险，与 bucket7b A2 同一结论）
本仓**只有一份**应用级 JSON（`general` 段，白名单在 `native/settings_schema.hpp:103` 的 `GENERAL_SETTING_KEYS`）。
把 `defaultProjectDirectory` 拆成本机级 + 补 `useDefaultBrowser`/`browserPath` 两键，**必须同时动下面三处**；
单动任何一处都会造成「同一键既在应用级 JSON 又在本机级文件、导入覆盖顺序无法自洽」：
1. `src/settingsModel.ts`（保留文件，只读）；
2. `native/settings_schema.cpp` / `.hpp`（**不在本 lane**，且当前有别的 agent 在途改动）；
3. 导出侧 `src/settingsTransfer.ts`（不在本 lane）+ `native/settings_transfer.cpp`（在本 lane，但见下方「本桶刻意没单独改」）。
所以本桶把模块侧做完、把下面三处写成可照抄的替换，交主代理同一批落。

### 可照抄改动 ①：`src/settingsModel.ts`
`GeneralSettingsState`（`:111-112`）当前：
```ts
export interface GeneralSettingsState {
  defaultProjectDirectory: string
  reopenLastProject: boolean
```
把 `defaultProjectDirectory` 标成本机级，并补上游另两键（`GeneralLocalSettings.kt:81`/`:82`）：
```ts
export interface GeneralSettingsState {
  /** 本机级（`GeneralLocalSettings.kt:60` 的 `@SystemDependent`）：`ide.general.local.xml`，`RoamingType.DISABLED`，不随设置同步走。 */
  defaultProjectDirectory: string
  /** 本机级（`GeneralLocalSettings.kt:81`）：用系统默认浏览器，**默认 true**。 */
  useDefaultBrowser: boolean
  /** 本机级（`GeneralLocalSettings.kt:82`）：备选浏览器路径，null 时按平台回落（`:66-70`）。 */
  browserPath: string | null
  reopenLastProject: boolean
```
`defaultGeneralSettings`（`:182-184`）当前：
```ts
export const defaultGeneralSettings: GeneralSettingsState = {
  defaultProjectDirectory: '',
  reopenLastProject: true,
```
改为（旧存档缺键补默认，不按字段数量判损坏 —— 见 agent-rules §3 的事故）：
```ts
export const defaultGeneralSettings: GeneralSettingsState = {
  defaultProjectDirectory: '',
  useDefaultBrowser: true,   // GeneralLocalSettings.kt:81 property(true)
  browserPath: null,         // GeneralLocalSettings.kt:82 string(null)，读出口用 src/generalSettingsLocal.ts 的 resolveBrowserPath 回落
  reopenLastProject: true,
```

### 可照抄改动 ②：`native/settings_schema.hpp` + `.cpp`
`GENERAL_SETTING_KEYS`（`.hpp:103-105`）当前首行是 `"defaultProjectDirectory", "reopenLastProject", ...`。
加两键（值校验同 `isShowWelcomeScreen` 那类布尔/串）：
```cpp
    "defaultProjectDirectory", "useDefaultBrowser", "browserPath", "reopenLastProject", "deleteToBin", "autoSyncFiles",
```
`general_defaults_impl`（`.cpp:140` 起，`return Json{{"defaultProjectDirectory", Json("")}, ...}`）补两条默认：
```cpp
        {"defaultProjectDirectory", Json("")},
        {"useDefaultBrowser", Json(true)},
        {"browserPath", Json()},          // null：读出口按平台回落
```
`validate_general_patch`（`.cpp:187-192` 一带，已有 `defaultProjectDirectory` 的 ≤512 串校验）为 `browserPath` 加「null 或 ≤512 串」校验、为 `useDefaultBrowser` 加布尔校验（口径照现有 `confirmExit` 等布尔项）。

### 可照抄改动 ③：导出/同步排除本机级键（`RoamingType.DISABLED` 的落点）
- `src/settingsTransfer.ts`：归档前对 `general` 段过一遍 `splitGeneralSettingsByRoaming(...).roaming`（`src/generalSettingsLocal.ts:65`），**只带 roaming 那一半**。
- `native/settings_transfer.cpp`：`exportable()`（`:41-49`）现把整段 `general` 原样带进归档；本机级三键应在导出时剪掉（`kMachineLocalGeneralKeys = {"defaultProjectDirectory","useDefaultBrowser","browserPath"}`）。

**本桶刻意没单独改 `native/settings_transfer.cpp`**：在①②落地之前，单独剪掉导出键会让导入端（`read_archive:118-133`）用默认值回填 `defaultProjectDirectory`，把目标安装的本机值冲成空 —— 正是「两份真相」。这一处必须与 ①② 同批，或由主代理先把本机级三键搬进独立存储（`ide.general.local.xml` 的等价文件）后再剪导出。

### 消费点（同批要一起改，否则编译不过）
- `SettingsDialog.vue` 已有 `v-model="general.defaultProjectDirectory"`（`tests/general-settings-local.test.mjs:81` 钉着）；新增的 `useDefaultBrowser`/`browserPath` 是「Web Browsers」设置页的字段（上游 `GeneralSettingsConfigurable` 的浏览器区），本仓该页尚无落点 → 若同批不便扩页，可先只在 `settingsModel`/`schema` 落键与默认，UI 行留待浏览器页落地时补（**不渲染假控件**：没有落点就不加行）。
- `src/workspaceLifecycle.ts` 的 `refreshAppState`（经 `settingsInspector.ts` 的 `normalizeSettingsShape`）对新增键会按默认形状回落，旧存档缺键不判损坏。

---

## W-2（给主代理 · 治理，接 bucket7b A5）

1. **不要按快照重写 `docs/inventory/verdict-find-diff.md`。** 本桶没有动它（只在 `scripts/verdict_table.py` 里改了 `platform_rest` 三条族级散文），`tests/b7-verdict.test.mjs` 收工前复跑仍 **10/10 绿**（含 `本轮清扫后的四档计数已冻结` 钉 `[31,352,0,247]` 那条）。按 `build/b7-sweep/verdict-original.md` 快照重写会立刻把 `[ ]` 归零的 455 条判决冲掉并被那条冻结断言抓红 —— 保持 bucket7b 的结论。
2. **判词真源的 git 跟踪：bucket7b A5.2 的前提已失效（订正）。** 原写「`scripts/verdict_table.py` 与 `docs/inventory/*_verdict_table.*`、`verdict-*.md` 目前都是 untracked（`?? scripts/verdict_table.py`）」。本桶实测：`git ls-files` 显示 `scripts/verdict_table.py`、`docs/inventory/verdict-platform_rest.md`、`docs/inventory/platform_rest_verdict_table.json`、`docs/inventory/verdict-find-diff.md`、`docs/inventory/verdict-actions.md` **现在都已跟踪**（本桶对前三者的改动 `git status` 出的是 `M` 而非 `??`）⇒ A5.2 已被纳入跟踪，这条治理请求可关闭；本桶改的三段散文**有 diff 可审**（`git diff scripts/verdict_table.py`）。证据 grep：`grep -c "2026-10-06 复算订正" scripts/verdict_table.py` → 本桶新增 2 处（general-settings、registry），`grep -c "当前 1181 行" scripts/verdict_table.py` → 1 处（platform-ide）。

## W-3（给折叠域属主 · 派单基线里的 tsc 错，非本桶文件）
bucket7b A5.3 记的是 `src/customFoldingProviders.ts(48,103): error TS1002: Unterminated string literal.`。
本桶 `npx vue-tsc -b --force` 收工时的实况见 `docs/batch-2026-10-06-shell.md` §3；若仍非 0 错且落点不在本桶文件面，请派给折叠域属主清（`src/customFoldingProviders.ts` 不在 shell lane 可改面）。

## W-4（给主代理 · ic/dialogs ① / ⑤ 的宿主，非本桶能收口）
- `ic/dialogs` 缺 ①：`Messages`/`MessagesService` 的**统一消息宿主**。模型侧 `src/messageDialog.ts`（本桶名下）齐（`MessageDialogBuilder` + `DoNotAskOption` + `MessageType` + `ExitActionType`，现被 `TrustedProjectDialog.vue` 逐处消费），缺的是 App 上的全局门面宿主（`src/App.vue`，保留文件）。= bucket7b A3，本桶维持登记、未自接。
- `ic/dialogs` 缺 ⑤：步骤式列表弹层（`src/popupSteps.ts` 的 `listStepRows`/`isClosableOnExecute`/`isFinalStepValue`/`shouldBeShowing`/`listSeparator`）仍是**零生产消费方**，宿主组件在桶 8（`AnchoredMenu.vue`/`EditorPopupMenu.vue`/`SearchEverywhereDialog.vue`）。= bucket7b A1，本桶维持登记、未自接。
