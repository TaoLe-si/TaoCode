# 接线请求 2026-10-06 · lensgate（Code Vision 两层过滤的消费侧落完之后剩的那三行）

我是 `lensgate` 半区，文件面只有 `src/codeLensExtension.ts`（外加 `src/codeLensSettings.ts` 的
Code Vision 设置表 —— `docs/wiring-requests-2026-10-06-setkeys.md` 的 K-4 点名要那张表补字段）。
K-4 的两层规则**消费侧**本批已落：第一层（按档位的组闸）早就是纯判定 `shouldShowCodeVisionEntry`，
第二层（每行最多几条）本批补成同风格的纯判定 `codeVisionVisibleEntryLimit()`，渲染侧一次读齐两层。
派单里写的「实现成本仓的纯判定函数」按**两层各一个纯函数**落 —— 没有再造第三个把两层粘起来的函数，
因为唯一的消费点 `buildDecorations` 里本来就要分别问它们两次（过滤吃列表、上限吃一个数），
再加一层合成只会多一个只被自己的测试用过的出口（`.tools/find-orphan-modules.mjs --gate` 的口径）。
判据在 `tests/code-vision-anchor-limit.test.mjs`（10 条）与
`tests/code-lens-grouping.test.mjs`（12 条，含本轮按意图重写的那一条接线断言）。
下面三条都在别人名下，**不给这三行，`codeVisionVisibleEntries` 就是"存得下但没人从盘上读"的半截链路**
（写盘那一侧与读表那一侧都在，缺的只是把盘上的值灌进运行时表的那一句）。

上游基准树：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`。

---

## L-1 `src/workspaceLifecycle.ts`：启动读回（必须）

目标文件 `src/workspaceLifecycle.ts`，**目标行 147 之后**（那一行是编辑器设置的唯一读盘点：
`editorSettings.value = normalizeEditorSettings(state.settings)`）。

import 语句（加在该文件第 13 行那一组 import 之后，与它同一形状的相对 import，**值 import 必须带 `.ts`**）：

```ts
import { restoreCodeVisionSettings } from './codeLensSettings.ts'
```

old（`src/workspaceLifecycle.ts:145-149` 原文，逐字）：

```ts
  // 老版本把「不显示面包屑」编码进 breadcrumbsPlacement（三值），源码里位置只有上下两个值；
  // 在读盘这一处迁移回 showBreadcrumbs + placement，避免旧值在下次保存时被原生校验拒绝。
  editorSettings.value = normalizeEditorSettings(state.settings)
  // 与 editorSettings 同一处收口：旧版本留下的未知键、手改坏的类型不进内存（见 src/settingsInspector.ts）。
  generalSettings.value = normalizeSettingsShape(defaultGeneralSettings, state.general).value
```

new（只在 147 与 148 之间插一段）：

```ts
  // 老版本把「不显示面包屑」编码进 breadcrumbsPlacement（三值），源码里位置只有上下两个值；
  // 在读盘这一处迁移回 showBreadcrumbs + placement，避免旧值在下次保存时被原生校验拒绝。
  editorSettings.value = normalizeEditorSettings(state.settings)
  // Code Vision 的四把键灌进运行时真值表（`src/codeLensSettings.ts`）：上游那份是应用级
  // `PersistentStateComponent`（`platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt:14`
  // 的 `@State(name = "CodeVisionSettings", storages = [Storage("editor.xml")]…)`），读盘即生效；
  // 本仓的渲染侧只认那张运行时表（`src/codeLensExtension.ts` 的 `buildDecorations`）。
  // 旧存档缺键由原生侧补默认（`native/settings_schema.cpp:414-417`：`codeVisionEnabled=true`、
  // 两个组集合 = 空数组、`codeVisionVisibleEntries=5`），所以这里**不许**按字段数量判损坏。
  restoreCodeVisionSettings({
    codeVisionEnabled: editorSettings.value.codeVisionEnabled,
    disabledGroups: editorSettings.value.codeVisionDisabledGroups,
    enabledGroups: editorSettings.value.codeVisionEnabledGroups,
    codeVisionVisibleEntries: editorSettings.value.codeVisionVisibleEntries,
  })
  // 与 editorSettings 同一处收口：旧版本留下的未知键、手改坏的类型不进内存（见 src/settingsInspector.ts）。
  generalSettings.value = normalizeSettingsShape(defaultGeneralSettings, state.general).value
```

口径说明（为什么这一句是安全的）：`restoreCodeVisionSettings`
（`src/codeLensSettings.ts:210-219`）对每个入参都自己判类型 —— `codeVisionVisibleEntries` 只认**正整数**，
`undefined`/`null`/0/负数/小数一律不写、表里留出厂 5；这与
`CodeVisionHost.kt:287-288` 的 `(lifeSettingModel.getAnchorLimit(it) ?: defaultVisibleLenses)`
（`defaultVisibleLenses = 5`，`CodeVisionHost.kt:85`）同形。判据：
`tests/code-vision-anchor-limit.test.mjs` 的「restoreCodeVisionSettings 只认正整数」那条。

## L-2 `src/settingsPersistence.ts`：对话框「应用/保存」之后按新档重算（建议，与 L-1 同一形状）

`saveSettings` 在 `src/settingsPersistence.ts:86` 拿到回包（`editorSettings.value = await request<EditorSettings>('settings.update', { settings })`），
`saveAll` 那一支在 `:313-315` 是同一件事。两处之后各补一句与 L-1 **逐字相同**的
`restoreCodeVisionSettings({ … })`（import 同样带 `.ts`）。
上游依据：`CodeVisionSettings.kt:57-60` 与 `:106-121` 的 setter 直接广播
（`globalEnabledChanged` / `providerAvailabilityChanged`），本仓的等价物是 L-3 那一句 `syncRuntime()`
—— 如果只接 L-3，那么"保存但未点应用"的那一次编辑态改动已经生效，**保存回包后不重灌**这一路就只靠
设置页那一句；接上 L-2 才是"盘上是什么，渲染就是什么"。
（K-4 原文把这一条写成"启动读回"，实际 `:86` 是保存路径；真正的读盘点在 `src/workspaceLifecycle.ts:147` ⇒
本文件把它拆成 L-1/L-2 两条。**原写「settingsPersistence.ts:86 之后 = 启动读回」、实际那是保存路径**，留痕。）

## L-3 `src/components/CodeVisionSettingsPage.vue`：`syncRuntime()` 补一行（K-4 里 setkeys 自己承诺的那一行）

目标文件 `src/components/CodeVisionSettingsPage.vue`，**目标行 61-64**（`syncRuntime` 的函数体）与 `:66`（那条 watch 的取值串）。

old（`:60-66` 原文，逐字）：

```ts
/** 运行时表按草稿对象刷一遍（打开页面时、以及三把键任何一个变了之后）。 */
function syncRuntime() {
  codeVisionSettings.enabled = props.settings.codeVisionEnabled
  for (const id of GROUPS) setCodeVisionGroupEnabled(id, groupOn(id))
}
onMounted(syncRuntime)
watch(() => `${props.settings.codeVisionEnabled}|${props.settings.codeVisionDisabledGroups.join(',')}|${props.settings.codeVisionEnabledGroups.join(',')}`, syncRuntime)
```

new：

```ts
/** 运行时表按草稿对象刷一遍（打开页面时、以及四把键任何一个变了之后）。 */
function syncRuntime() {
  codeVisionSettings.enabled = props.settings.codeVisionEnabled
  for (const id of GROUPS) setCodeVisionGroupEnabled(id, groupOn(id))
  // 每锚点条数：界 1..10 = 上游那一格自己的范围（`CodeVisionGlobalSettingsProvider.kt:43` 的 `spinner(1..10, 1)`），
  // 出厂 5 = `CodeVisionSettings.kt:38-39`。夹一次再进表，坏值（清空输入框 = 0 / NaN）不许顶掉出厂值。
  codeVisionSettings.visibleEntries = codeVisionVisibleEntryLimit(
    { ...codeVisionSettings, visibleEntries: props.settings.codeVisionVisibleEntries })
}
onMounted(syncRuntime)
watch(() => `${props.settings.codeVisionEnabled}|${props.settings.codeVisionDisabledGroups.join(',')}|${props.settings.codeVisionEnabledGroups.join(',')}|${props.settings.codeVisionVisibleEntries}`, syncRuntime)
```

import 那一行（`:33-36`）把 `codeVisionVisibleEntryLimit` 加进现有那组：

```ts
import {
  LSP_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID,
  codeVisionGroupName, codeVisionSettings, codeVisionVisibleEntryLimit, setCodeVisionGroupEnabled,
} from '../codeLensSettings.ts'
```

说明：`codeVisionVisibleEntryLimit` 是本轮新落的**纯判定**（`src/codeLensSettings.ts:158-161`），
非正整数回出厂 5，所以这一行不发明第二条兜底口径。页面自己不做 1..10 的夹紧：
原生侧已经在写盘时钉了界（`native/settings_editor_keys.hpp:56-62`），
渲染侧对坏值也有牙（`tests/code-vision-anchor-limit.test.mjs` 的「坏值回出厂 5」）。

## L-4 右键「隐藏这一组 / 全部隐藏」写回盘上那一份（**登记，不催**）

`codeVisionSettingsPatch()`（`src/codeLensSettings.ts:222-229`）本批补上了 `codeVisionVisibleEntries`，
但今天**全仓零调用方**：右键那两条动作只改运行时表（`src/codeLensExtension.ts:135-138`），
下次启动就按盘上的旧值画。上游的 `!Hide` 走的是同一份 `PersistentStateComponent`
（`ProjectCodeVisionModelImpl.kt:52` → `CodeVisionSettings.setProviderEnabled` → 存进 `editor.xml`），
所以"重启后还记得"是上游行为。接法是在 `src/App.vue` 的 `patchEditorSettings`（`src/App.vue:668`）那一处，
把 `codeVisionSettingsPatch()` 的四个键并进 patch —— **App.vue 只有 appvue 半区能改**，本批不动，仅登记。
