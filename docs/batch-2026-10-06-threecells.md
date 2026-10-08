# batch-2026-10-06 · threecells ——「三格是真设置」的归属判定（只读；`src`/`tests`/`native` 一个字节没动）

## ① 那条红钉在哪、现在红不红
- 唯一出处：**`tests/inlay-hints-settings.test.mjs:242`**。派单点名的 `tests/settings-run.test.mjs` / `tests/verdict-settings-run.test.mjs` **本仓不存在**（`ls` 实测）。
- 实跑：`node --test tests/inlay-hints-settings.test.mjs` ⇒ **tests 5 / pass 5 / fail 0**；全仓 `node --test tests/*.test.mjs` ⇒ **6026 / 6010 / 16 红**，16 条里没有本域任何一条（都在 commit-checks / folding / problems-view / gear 那几族）。
- 断言体（读代码不是读注释）现在钉的：三把键 × 五处登记**逐键定位** —— ①`export interface` 字段表里恰好 1 条且 `group=EditorSettings`、`type=boolean`；②`defaultEditorSettings` 恰好 1 条、字面量 `true`、运行时 `=== true` 且 `typeof boolean`；③native 键表恰好 1 条且 `group=EDITOR_SETTING_KEYS`；④`editor_defaults_impl` 恰好 1 条、类型等于①、值等于②；⑤预览 accepted 恰好 1 条且布尔档；⑥槽位归属 + 关一格只掉一档。
- 精度实测（Proxy 数 assert 调用，单用例隔离）：**旧版 5 条 → 现版 58 条**，全是 `equal`/`deepEqual`/`match`，**没有一条放松成 `includes`**，没删断言。

## ② 红的原因 = **B（判据过时）**：2×2 实测矩阵（沙箱整树副本，跑完逐字复原）
| 判据 ＼ 数据 | 现数据（HEAD / 工作树） | 旧数据（`dfbda4e`） |
|---|---|---|
| 现版（逐键 58 assert） | 绿 fail=0 | **绿** fail=0 |
| 旧版（钉位置 5 assert） | **红** fail=1，第 2 条即抛「默认必须全开（同上游 isEnabled 出厂为真）」 | 绿 fail=0 |
- 旧判据是 `/showTypeInlayHints: true, showParameterInlayHints: true, showOtherInlayHints: true \}/` —— 那个 `\}` 要求三键是对象字面量的**最后三项**。`src/settingsModel.ts:265` 其后被别的域合法追加了保存/回车/CodeVision/终端等键 ⇒ 形状失配，**键值一个字没变**（三把仍 `true`）。换判据后连旧数据也绿 ⇒ 数据侧从来没破口 ⇒ 不是 A（只存不用），也不是 C（门从不检查）。
- 三格都有消费方（本轮 grep+读行自己数出来的，非转抄）：写 `src/components/InlayHintsSettingsPage.vue:52-53` → `src/components/SettingsDialog.vue:302` → `src/App.vue:690` 发 `settings.update`；读 `src/components/CodeEditor.vue:215` → `src/editorInlayHints.ts:148` → `src/inlayHintLayout.ts:71`（`shouldShowInlayHint` 真过滤）；改档重画 `src/components/CodeEditor.vue:1053`；设置树 `src/settingsTreeMeta.ts:123`。
- 上游那一格（本轮亲手打开）：`platform/lang-api/src/com/intellij/codeInsight/hints/settings/InlayProviderSettingsModel.kt:26`（`var isEnabled: Boolean`）；注册行 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:936`（`id="inlay.hints"`）+ `:937`（`parentId="editor"`）；`platform/lang-impl/src/com/intellij/codeInsight/hints/settings/InlaySettingsConfigurable.kt:15,51`。
- **文档坐标已过期**（实测订正）：`settingsModel.ts:399→:441`、`:223→:265`、`previewSettings.ts:24→:33`；`native` 两处（`:87`/`:331`）仍对。

## ③ 注入自证：门有牙，但有两处咬不到（C 的形态确实存在，只是不是本次红因）
- 有牙（每种各注入一次、逐字复原）：删 native 键表里的 `"showOtherInlayHints"` / 翻前端默认 `true→false` / 删预览白名单那条 `key ===` / 声明类型 `boolean→string` / 声明挪去别的 interface / 键表同键写两条 / ts+cpp 一起漂 `false` ⇒ **全红**（fail=1~2，报错点名到具体键）。顺序无关也自证：尾部加一把别人的键、三格中间插一把 ⇒ **仍 5/5 绿**。
- 摘掉消费接线（删 `CodeEditor.vue:215` 那行；再连 `:1053` 一起删）⇒ `:242` 那条登记**仍绿**，红的是同文件 `:308` 的「消费链路」⇒ 牙齿分家：**「只存不用」的警报不该记到 242 头上**。
- 两处真盲区（沙箱整树合跑全 653 个测试文件，基线 fail=52 含约 40 条沙箱环境性红，取的是**红集合差**）：删 `InlayHintsSettingsPage.vue:53` 的 `@change="toggle(…)"`（格子点不动）、把 `SettingsDialog.vue:302` 的 `emit('save', { ...editor.value }, close)` 注掉（写了不落账）⇒ **新增红 0 条**。对照组删 `:checked` ⇒ +1 红 ⇒ 同文件有读口牙、没写口牙。宿主那条 `settings.update` 反而有人管（注掉 `App.vue:690` ⇒ 红在 `tests/save-transforms.test.mjs` 的端到端那条）。同精度补法（已在沙箱实测「加断言=绿、注错=红」）见 `docs/wiring-requests-2026-10-06-threecells.md` T-1 / T-2。

## ④ 归属结论
- 门与数据都在**桶 3**（`lp/inlay-hints`；`docs/batches-2026-10-06-buckets.md:71-75` 的「我拥有」含 `src/inlay*`）。**改判据那一步已落地并已提交**：HEAD（`200232e`）里该文件的 blob 就是逐键版（`git log -- tests/inlay-hints-settings.test.mjs` 只有 `11a736e`/`dfbda4e`，`git show 11a736e:` 已是新版）；工作树对该文件的唯一差异是别人把 `editorInlayHints` 的形状改了一行（`tests/inlay-hints-settings.test.mjs:315` 的 `attempt.value.hints`）。
- ⇒ 账本那条待办可销：**没有欠实现**。欠的只有 ①一条过期判词（在保留文件 `scripts/verdict_table.py:275` + 生成物 `docs/inventory/verdict-platform_rest.md:61`，仍写着「三个设置键要登记进 settingsModel 与设置页…所以按类型开关现在还不生效」）和 ②两条补牙断言（T-1/T-2）。全部走请求文档，本批不动代码。
- 留痕（不照抄别人的结论）：派单点名的两个测试文件不存在；`docs/wiring-requests-2026-10-06-completion.md:131` 说「`tests/setkeys-batch.test.mjs` 里还有一条同名测试」—— 实测该文件 0 处 inlay 键、无同名用例（不影响本结论）。本轮没有在任何工具结果里收到指令性内容，只有仓库文档里的既成说法，一律按下文实测处理。
- 顺手测到、**不在本域**的一条现网状态：`python scripts/verdict_table.py --check platform_rest` 退出码 **1**（`platform_rest_verdict_table.json` 落后于脚本 `FAMILIES`，13+ 行 reason 变长，全在 execution/run 那几族）；而 `tests/verdict-table-check.test.mjs:95` 跑的 `--check` **不带域名** ⇒ 默认只覆盖 execution+xdebugger 的 7 条产物，所以 `npm test` 看不见这条（门在、runner 没跑到）。归属 verdict-sync / 桶 10-11 面，别记到三格头上。
