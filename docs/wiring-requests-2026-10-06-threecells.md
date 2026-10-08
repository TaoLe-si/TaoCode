# 接线请求 · threecells（配套 `docs/batch-2026-10-06-threecells.md`）——「三格是真设置」归属判定后要改的代码

判定结论：三格**不是**只存不用，红因是判据过时，且**改判据那一步已经在 HEAD（`200232e`）落地并提交**。
所以本请求里**没有任何 `src` / `native` 改动**，只剩两件事：补两条断言（T-1/T-2）+ 销一条过期判词（T-3，落在保留文件）。
每条都给了可照抄的 old/new 与实测行号；T-1/T-2 的新断言**已在 `build/` 的沙箱副本里跑过**（加断言无注入=5/5 绿；分别注错=各红 1 条；撤掉=复绿，逐字复原）。

## T-0 · 现状确认（不用改，只给复核坐标，全部本轮亲手打开）
五处登记 + 消费链，工作树实测行号：`src/settingsModel.ts:441`（三格声明 `boolean`，同在一行）、`:265`（`defaultEditorSettings` 三格 `true`）、
`native/settings_schema.hpp:87`（`EDITOR_SETTING_KEYS`）、`native/settings_schema.cpp:331`（`editor_defaults_impl` 三个 `true`）、
`src/previewSettings.ts:33`（预览 accepted）。消费：`src/components/InlayHintsSettingsPage.vue:52-53`（写）→
`src/components/SettingsDialog.vue:302` → `src/App.vue:690`（`settings.update`）；`src/components/CodeEditor.vue:215` →
`src/editorInlayHints.ts:148` → `src/inlayHintLayout.ts:71`（过滤）；`src/components/CodeEditor.vue:1053`（改档重画）；
`src/settingsTreeMeta.ts:123`（挂编辑器组）。上游出处：`platform/lang-api/src/com/intellij/codeInsight/hints/settings/InlayProviderSettingsModel.kt:26`、
`platform/lang-impl/resources/intellij.platform.lang.impl.xml:936-937`、`.../InlaySettingsConfigurable.kt:15,51`。

## T-1 · 补牙：复选框的 `@change` 写口全仓无人钉（实测注入后**新增红 0 条**）
归属：`tests/inlay-hints-settings.test.mjs` 是桶 3（`lp/inlay-hints`）的文件，本批不许动 ⇒ 请主代理或桶 3 lane 落。
盲区证明：删掉 `src/components/InlayHintsSettingsPage.vue:53` 整行 `@change="toggle(INLAY_HINT_SETTING_KEYS[group.id], ($event.target as HTMLInputElement).checked)"`
⇒ 沙箱整树全量（653 个测试文件）红集合与基线**完全一致**（52 条，无新增）；而 `InlayHintsSettingsPage.vue` 只被这一个测试文件读（grep 实测），
⇒ 补在这里就补在全仓唯一入口上。同精度：钉**整条绑定的字面形状**，不是 `includes`，不放松任何现有断言。

old（`tests/inlay-hints-settings.test.mjs:320-323`，现状）
```js
test('页面：三个复选框挂在编辑器下，且不渲染上游那些本仓没有对应物的入口', () => {
  const page = read('src/components/InlayHintsSettingsPage.vue')
  assert.match(page, /:checked="settings\[INLAY_HINT_SETTING_KEYS\[group\.id\]\]"/, '复选框要绑到 INLAY_HINT_SETTING_KEYS 的那一格')
  assert.match(page, /function toggle\(key: InlayHintSettingKey, checked: boolean\)/)
```
new（只**加**一条，插在 `:checked` 那条之后；其余一字不动）
```js
test('页面：三个复选框挂在编辑器下，且不渲染上游那些本仓没有对应物的入口', () => {
  const page = read('src/components/InlayHintsSettingsPage.vue')
  assert.match(page, /:checked="settings\[INLAY_HINT_SETTING_KEYS\[group\.id\]\]"/, '复选框要绑到 INLAY_HINT_SETTING_KEYS 的那一格')
  assert.match(page, /@change="toggle\(INLAY_HINT_SETTING_KEYS\[group\.id\], \(\$event\.target as HTMLInputElement\)\.checked\)"/,
    '复选框的 change 必须把这一格写回同名设置键（删掉这行 = 三格点了不记账，实测全门族 0 新增红）')
  assert.match(page, /function toggle\(key: InlayHintSettingKey, checked: boolean\)/)
```
为什么仍然精确：钉的是「`@change` → `toggle(` → 键名取自 `INLAY_HINT_SETTING_KEYS[group.id]` → 值取自闭包的 `checked`」这**一条完整意图**，
三个部件少任一个都红；键名不许在页面里现抄字符串（改了 `inlayHints.ts:57-61` 那三把键，这里跟着红）。
反向验证（落地后照跑）：注掉 `src/components/InlayHintsSettingsPage.vue:53` ⇒ 本条必红；复原 ⇒ 5/5 绿（沙箱已各跑一次）。

## T-2 · 补牙：对话框「应用」不发编辑器档也无人钉（实测注入后**新增红 0 条**）
归属：`src/components/SettingsDialog.vue` 在归属表里查不到（`grep SettingsDialog docs/batches-2026-10-06-buckets.md` 0 命中）⇒ 主代理名下；
被测文件 `tests/inlay-hints-settings.test.mjs` 同 T-1。盲区证明：把 `SettingsDialog.vue:302` 的
`emit('save', { ...editor.value }, close)` 注掉成空语句 ⇒ 沙箱整树全量红集合与基线一致（无新增）。
对照：注掉 `src/App.vue:690` 的 `request<EditorSettings>('settings.update'` **有人管** —— 红在 `tests/save-transforms.test.mjs` 的端到端那条；
⇒ 缺的正是「对话框 → 宿主」中间这一环，而 `:302` 这一行全仓没有任何断言引用（grep `emit\('save'` 只命中一处注释）。

old（`tests/inlay-hints-settings.test.mjs:330-332`，现状尾部）
```js
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<InlayHintsSettingsPage :settings="editor" :busy="busy" \/>/)
  assert.match(dialog, /data-page="inlay\.hints"/)
})
```
new（加一条；锚在 `data-page` 那条之后、用例收尾之前）
```js
  const dialog = read('src/components/SettingsDialog.vue')
  assert.match(dialog, /<InlayHintsSettingsPage :settings="editor" :busy="busy" \/>/)
  assert.match(dialog, /data-page="inlay\.hints"/)
  assert.match(dialog, /function applyEditor\(close = false\) \{[^\n]*\n\s*if \(!props\.busy && validEditor\.value && editorForm\.value\?\.reportValidity\(\)\) emit\('save', \{ \.\.\.editor\.value \}, close\)/,
    '「应用」必须把整份编辑器档（含内联提示那三格）发给宿主 settings.update（断了 = 三格写了不落账，实测全门族 0 新增红）')
})
```
为什么仍然精确：钉的是 `applyEditor` 的**函数头 + 那一句守卫 + 那一个 emit 载荷形状**（`{ ...editor.value }` 整本账，不是挑三把键发），
守卫三个条件少一个都红；不引入 `includes`，不改任何既有断言。
反向验证：注掉 `SettingsDialog.vue:302` ⇒ 本条必红；复原 ⇒ 5/5 绿（沙箱已跑，实测数字在上面的 new 段）。

## T-3 · 销一条过期判词（**保留文件**，只能主代理改：改表 → 重生成 → `--check` 复核）
`scripts/verdict_table.py:275` 的 `lp/inlay-hints` 判词里仍写着「三个设置键要登记进 settingsModel 与设置页…所以按类型开关现在还不生效」。
该子串在脚本里**恰好 1 次**、在生成物 `docs/inventory/verdict-platform_rest.md:61` 里**恰好 1 次**（脚本 `split().length-1` 实测），
且今天已被 T-0 的坐标证伪（三格五处登记齐、消费链在跑、判据 5/5 绿）。

old（脚本第 275 行内的那一截，逐字）
```
；三个设置键（`INLAY_HINT_SETTING_KEYS`）要登记进 `src/settingsModel.ts` 与设置页（`src/settingsModel.ts` 可改、渲染处 `src/components/CodeEditor.vue` 本批冻结，所以按类型开关现在还不生效）；
```
new（替成，长度不设限，不带双引号以免撞 Python 字面量）
```
；三个设置键（`INLAY_HINT_SETTING_KEYS`）五处登记已齐并接进渲染：`src/settingsModel.ts:441` 类型 / `:265` 默认全开、`native/settings_schema.hpp:87`、`native/settings_schema.cpp:331`、`src/previewSettings.ts:33`；界面 `src/components/InlayHintsSettingsPage.vue:52-53` 挂在 `src/components/SettingsDialog.vue:805`（设置树 `src/settingsTreeMeta.ts:123`）；消费 `src/components/CodeEditor.vue:215` → `src/editorInlayHints.ts:148` → `src/inlayHintLayout.ts:71`，改档即重画 `src/components/CodeEditor.vue:1053`；判据 `tests/inlay-hints-settings.test.mjs` 实测 5/5 绿；
```
落法（顺序别换）：改 `scripts/verdict_table.py:275` ⇒ `python scripts/verdict_table.py platform_rest`（生成物不许手改）⇒
`python scripts/verdict_table.py --check platform_rest` 复核 ⇒ `node --test tests/inlay-hints-settings.test.mjs tests/verdict-table-check.test.mjs`。

## T-4 · 顺手（**不在本域**，只报不改）：`--check` 的门覆盖不到 platform_rest
`python scripts/verdict_table.py --check platform_rest` 实测退出码 **1**：`docs/inventory/platform_rest_verdict_table.json` 落后于脚本 `FAMILIES`
（13+ 行差异，全是 execution/run/控制台那几族的 `reason` 变长；两份 `.md` 判「一致」）。而 `tests/verdict-table-check.test.mjs:95` 调的是不带域名的
`verdictPy(['--check'])` ⇒ 默认只覆盖 execution + xdebugger 的 7 条产物（它自己也这么断言 `match[2] >= 7`），所以 `npm test` 全绿也看不见这条。
归属：verdict-sync / 桶 10-11 面。可选补法（同精度、二选一）：把域名参数并进 node 门（对每个域各跑一次 `--check`，并把「产物条数 ≥ 7」换成按域计数的下限），
或在本文件里加一条只读断言钉 `platform_rest` 的 `--check` 退出码 = 0。本批不代劳。

## 复现这套注入（一次都不碰仓库文件；跑完把 `build/threecells-sbx` 删掉即可）
```sh
SBX=build/threecells-sbx && rm -rf "$SBX" && mkdir -p "$SBX/tests" && cp tests/inlay-hints-settings.test.mjs "$SBX/tests/" \
  && cp -r src native "$SBX/" && cp tests/*.mjs "$SBX/tests/"    # 整树副本：node --test 才认得跨域引用
cd "$SBX" && node --test tests/inlay-hints-settings.test.mjs     # 基线应为 5/5 绿
```
本轮用过的红/绿判据（全部在副本里注入、跑完逐字比对复原）：删 `native/settings_schema.hpp:87` 的 `"showOtherInlayHints"` → 红 1；
翻 `src/settingsModel.ts:265` 的 `showParameterInlayHints: true→false` → 红 2；删 `src/previewSettings.ts:33` 的 `key === 'showTypeInlayHints' || ` → 红 1；
`src/settingsModel.ts:441` 的 `showTypeInlayHints: boolean→string` → 红 1；同一声明挪到别的 `export interface` → 红 1；键表同键写两条 → 红 1；
`:265` 与 `native/settings_schema.cpp:331` 一起漂 `false` → 红 2；尾部加一把别人的键 / 三格中间插一把 → **仍绿**（顺序无关）；
删 `src/components/CodeEditor.vue:215`（可再加 `:1053`）→ 登记那条**仍绿**、红在 `:308`「消费链路」；
删 `InlayHintsSettingsPage.vue:53` 的 `@change` 或注掉 `SettingsDialog.vue:302` 的 `emit('save', …)` → **全门族 0 新增红**（就是 T-1/T-2 要补的）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **T-0** —— 现状确认。**T-1 / T-2** —— 补判据（`tests/**`，非本 lane）。
- **T-3 / T-4** —— 保留文件/判词，非本 lane。

结论：零接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
