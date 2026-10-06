# batch-2026-10-06 · `inlayred` —— 「三格是真设置」那条位置钉死的红

代号：**inlayred**。范围：只做一件事 —— 把 `tests/inlay-hints-settings.test.mjs` 里那条
「三格是真设置：模型 + native 键表/默认值 + 预览白名单都登记」从**钉数组位置**改成
**逐键定位（位置无关）**，并核掉它背后的假控件嫌疑。没有新增界面、没有动保留文件。

---

## 1. 判词表

| 族 | 项 | 判定 | 上游依据（相对路径:行号，已逐行打开核对） | 本仓落点（文件:行号） | 一句话 |
|---|---|---|---|---|---|
| 设置存储 | 设置键的**先后顺序不是契约**，读盘按名字取回 | `[x]` 已核实并落成断言理由 | `platform/util/src/com/intellij/util/xmlb/BeanBinding.kt:296`（`element.attributes.get(binding.name)?.let { binding.setValue(result, it) }`：遍历 binding 清单，每项按**键名**去已存 attributes 拿值）；`platform/util/src/com/intellij/openapi/util/registry/Registry.kt:239-248`（`val key = entry.getAttributeValue("key") ?: continue` ⇒ 逐条 `map.put(key, …)` 装进 `Map<String, ValueWithSource>`） | `tests/inlay-hints-settings.test.mjs:26-42`（注释里写死这两条依据：两条坐标分别在同文件 :28 与 :31） | 既然上游按名字取，断言就不该把键钉在源码相邻位置；钉位置=别的域合法加键就误红 |
| 内联提示 | 那一格是**复选框**（布尔），出厂为真 | `[x]` | `platform/lang-api/src/com/intellij/codeInsight/hints/settings/InlayProviderSettingsModel.kt:26`（`abstract class InlayProviderSettingsModel(var isEnabled: Boolean, …)`） | `src/settingsModel.ts:399`（三格声明 `boolean`）、`src/settingsModel.ts:223`（默认 `true`）、`native/settings_schema.cpp:331`（`{"show…", true}`） | 新断言逐键核对「类型=boolean / 默认=true」，两处默认（前端与 native）还互相比对 |
| 内联提示 | 页面挂在**编辑器**组下（分组归属） | `[x]` | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:935-941`（`id="inlay.hints" parentId="editor" groupWeight="1"`） | `src/settingsModel.ts:399`（属 `EditorSettings`）、`native/settings_schema.hpp:87`（属 `EDITOR_SETTING_KEYS`）、`src/previewSettings.ts:24`（属预览 accepted 链） | 新断言逐键核对「所属分组恰好等于那一个」，并禁止同名条目出现第二条（原来位置正则看不见重复） |
| 假控件排查 | 三格是否真有读写点与消费方 | `[x]` 全部有 ⇒ **不是假控件，无需接线请求**（见 §5） | 同上（`InlayProviderSettingsModel.isEnabled` 是逐 provider 的总开关，本仓 provider 只有 LSP 一个，故塌成三档） | 写：`src/components/InlayHintsSettingsPage.vue:38`；存：`src/components/SettingsDialog.vue:302` → `src/App.vue:659`；读：`src/components/CodeEditor.vue:221`、`src/components/CodeEditor.vue:1055`、`src/editorInlayHints.ts:128`、`src/inlayHintLayout.ts:71` | 三格都有「界面写 → 对话框发 `settings.update` → native/预览校验 → 编辑器按档过滤」的完整链路 |

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 改前 | 改后 | 说明 |
|---|---|---|---|
| `tests/inlay-hints-settings.test.mjs` | 84 | 333 | 唯一的改动文件。新增 9 个纯 JS 解析器（`stripComments` / `spanEnd` / `braceBody` / `readValue` / `topLevelPairs` / `literalType` / `modelFieldDecls` / `modelDefaultEntries` / `nativeKeyTables` / `nativeDefaultEntries` / `previewAcceptedKeys`），把那条红用例换成逐键定位；其余 4 条用例一字未动。 |

保留文件（`src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、`scripts/verdict_table.py`、`docs/inventory/*.md`）**一个字节都没改**。
`src/settingsModel.ts` / `native/settings_schema.hpp` / `native/settings_schema.cpp` / `src/previewSettings.ts` 只在 §4 反向验证里被**临时**改过又**逐字**复原（脚本里 `撤改后文件逐字复原=true`）。

本用例的断言数：**5 条（全是位置正则）→ 每键 19 条 × 3 键 = 57 条执行断言**（源码里 15 行 `assert.`，`only()` 那 5 次与循环体 14 次都在 `for` 里跑 3 遍）。没有一条被放松成 `includes`，没有删断言。

---

## 3. §5 自查命令的前后数字

| 命令 | 改前 | 改后 |
|---|---|---|
| `node --test tests/inlay-hints-settings.test.mjs` | tests 5 / pass 4 / **fail 1**（红在 45:1 那条，断言行 48） | tests 5 / pass 5 / **fail 0** |
| `node --test tests/settings-keys-parity.test.mjs`（同域键一致性） | 5 / 5 / 0 | 5 / 5 / 0 |
| `node --test tests/module-size.test.mjs` | 5 / 5 / 0 | 5 / 5 / 0 |
| `node .tools/find-param-props.mjs` | 0 处参数属性 | 中途 1 处（`src/semanticHighlighting.ts:210`，别人的在途文件，**不是本域**） |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净 |
| `node .tools/find-missing-ext.mjs` | 干净（1287 文件） | 干净 |
| `node .tools/find-orphan-modules.mjs --gate` | 门禁红 1（`src/pluginSearchSuggest.ts`，**不是本域**） | 收工时**门禁绿**（新增 0 / 基线 9），那条红被别人在途修掉了；本域零新增 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 3/2/**1**、8/7/**1**（同一条根因，见下） | 同数字，未新增 |
| `npx vue-tsc -b --force` | — | **0 错**（无输出、退出码 0）；**收工时最后一次**为 11 错，全在别人在途的文件里（见下） |
| `npm test`（全量，收工跑） | 推定 6 红 = 5 + 本条（本条修复前必红；没重跑改前全量，12 路并行会漂） | **5548 / 5537 / 11**（同一晚第三次跑到 **5560 / 5544 / 16**；红数在漂，本域那条一直是绿的） |

> 全量与 tsc 都是**并行现场的快照**：我这次只碰 `tests/inlay-hints-settings.test.mjs`（+ 这份文档），
> 两次全量相隔两分钟，红从 5 → 11 → 16，vue-tsc 从 0 → 11，全部落在别人的在途文件上。
> 最后一次的 11 条 tsc 错分布在 `src/components/ProblemsPanel.vue:189`、`src/editorSemanticField.ts:148`、
> `src/enterHandlers.ts:426/485/493/523`、`src/refactorPreview.ts:207`、`src/runInstances.ts:611` —— 没有一条指向我改的文件。

收工全量跑了两次（相隔两分钟，12 路并行在途），原始计数与红名单：

第一次（本域刚修完）：
```
ℹ tests 5530 ℹ pass 5525 ℹ fail 5 ℹ cancelled 0 ℹ skipped 0 ℹ duration_ms 44172
✖ 四档计数自洽：34 + 1035 + 210 + 1272 = 2551，且与文档头部的和数一致  → tests/b8-verdict.test.mjs:64
✖ 本域每一条裸文件名引用都登记过（新引用要先解析再引）                → tests/diff-citations.test.mjs:211
✖ brace.match 进了 editingCommands，编辑菜单用同一个名字              → tests/editor-match-brace.test.mjs:74
✖ 仓里每一条带路径的上游引用都指得到（参考树在时）×2                  → tests/source-citations.test.mjs:85
  （第 4、5 条是同一条根因：anchors 用 import 复用了 citations 的用例体，跑两遍）
```

第二次（同一套命令，别人的在途改动落地后）：
```
ℹ tests 5548 ℹ pass 5537 ℹ fail 11
✖ 四档计数自洽… / 接线：跳过与否、reset 时机、相位跳过都走状态机 / 非法的被选项在交给宿主之前就拒掉… /
  本域每一条裸文件名引用都登记过 / 折叠代码块… / fold.block 端到端 ×2 /
  brace.match 进了 editingCommands… / tests\run-startup-focus.test.mjs（整个文件加载失败）/
  仓里每一条带路径的上游引用都指得到 ×2
```

第三次（再隔两分钟，红又变 16）按文件归属：`tests/b8-verdict.test.mjs:64`、`tests/commit-checks-result.test.mjs:174`、
`tests/commit-checks.test.mjs:238`、`tests/diff-citations.test.mjs:211`、`tests/editor-code-block.test.mjs:150,164`、
`tests/editor-folding.test.mjs:217,260,270,431`、`tests/editor-match-brace.test.mjs:74`、`tests/problems-view.test.mjs:122,158`、
`tests/run-startup-focus.test.mjs:155`、`tests/source-citations.test.mjs:85`（被 anchors 复用跑两遍）。

**三条快照里都没有 `tests/inlay-hints-settings.test.mjs`** —— 它单独跑固定是 5/5 绿。

引用门那 7 条扑空的引用都在**别人域**的文档里，路径在参考树里不存在（按引用门的口径转述时**故意不带行号**，免得这份文档自己也变成一条待核引用）：
`platform/lang-api/src/com/intellij/psi/util/PsiUtil.java`（docs/batch-2026-10-06-projecttree.md）、
`platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java`（docs/batch-2026-10-06-status2.md、-welcome2.md、docs/wiring-requests-2026-10-06-vcs2.md）、
`platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java`（同上两处）、
`platform/editor-ui-api/src/com/intellij/openapi/editor/settings/EditorSettingsExternalizable.java`（docs/wiring-requests-2026-10-06-vcs2.md）
—— 我在参考树里按文件名找过这四个类的**真实所在目录**（只核到目录，没核它们各自该指到哪一行，别人文档的语义也不是我的文件面）：
`PsiUtil.java` 在 `java/java-psi-api/src/com/intellij/psi/util/`；
`SuppressIntentionAction.java` 在 `platform/analysis-api/src/com/intellij/codeInspection/`（文档写的是 `…/codeInsight/`，包名差一层）；
`StructureViewFactoryImpl.java` 在 `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/`（文档漏了结尾的 `impl`）；
`EditorSettingsExternalizable.java` 在 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/`（文档写的是 `platform/editor-ui-api/…`）。
⇒ 这 7 条红只需把**路径**改对，别照抄我这份目录清单去改行号。

---

## 4. 反向验证记录（注入 → 变红 → 撤掉 → 复绿，每步都有数字）

工具：临时脚本 `build/inlayred-revcheck.mjs`（收工已删），每次注入后跑一次
`node --test tests/inlay-hints-settings.test.mjs`，再按**逆替换**复原（不是整文件回写，避免踩别人的并行改动），复原后逐字比对 `=== 原文`。

| # | 注入的违规 | 注入后 | 首条报错原文（截断） | 撤改后 |
|---|---|---|---|---|
| B（任务点名那条） | `src/settingsModel.ts` 前端默认 `showParameterInlayHints: true` → `false` | fail **2** / pass 3 / 退出码 1 | `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:` | 逐字复原=true，fail **0** / pass **5** |
| A | `native/settings_schema.cpp` 的 `{"showParameterInlayHints", true}` → `false` | fail **1** / pass 4 | `AssertionError [ERR_ASSERTION]: showParameterInlayHints：native 默认值与前端默认漂了（false vs true）` | 逐字复原=true，fail 0 / pass 5 |
| C | `native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS` 里删掉 `"showOtherInlayHints"` | fail **1** / pass 4 | `AssertionError [ERR_ASSERTION]: showOtherInlayHints 在 native 键表白名单里应恰好登记一次，实得 0 条（一条都没有）` | 逐字复原=true，fail 0 / pass 5 |
| D | `src/previewSettings.ts` 预览 accepted 链里删掉 `key === 'showTypeInlayHints'` | fail **1** / pass 4 | `AssertionError [ERR_ASSERTION]: showTypeInlayHints 在 预览态 accepted 白名单里应恰好登记一次，实得 0 条（一条都没有）—— 两条就说不清它属于哪一组` | 逐字复原=true，fail 0 / pass 5 |

再加两条**成因验证**（证明新断言对「顺序/相邻」不再敏感，而旧断言正是这样误红的），同样注入后立刻逐字复原：
```
- 尾部加键（别的域合法新增，就是本次红的成因）
    旧位置锚命中=false（false ⇒ 旧断言必红）｜新断言：fail=0 pass=5｜撤后逐字复原=true
- 三格被拆开（中间插一格）
    旧位置锚命中=false（false ⇒ 旧断言必红）｜新断言：fail=0 pass=5｜撤后逐字复原=true
```

旧断言为什么必红（本次实测）：`defaultEditorSettings` 在 HEAD 里以 `… showOtherInlayHints: true }` 收尾，
工作区里别的域在它**后面**合法加了键（`stripTrailingSpaces` / Code Vision / 快速文档等），
于是 `/showTypeInlayHints: true, showParameterInlayHints: true, showOtherInlayHints: true \}/` 的收尾花括号锚不再命中 ——
`旧的位置锚 today: false`（实测打印），三格的值一个字都没变。

解析器不是空转（原始取证输出，逐键命中数必须恰好 1）：

```
modelFieldDecls        showTypeInlayHints     [{"name":"showTypeInlayHints","type":"boolean","group":"EditorSettings"}]
modelDefaultEntries    showTypeInlayHints     [{"name":"showTypeInlayHints","value":"true","group":"defaultEditorSettings"}]
nativeKeyTables        showTypeInlayHints     [{"name":"showTypeInlayHints","group":"EDITOR_SETTING_KEYS"}]
nativeDefaultEntries   showTypeInlayHints     [{"name":"showTypeInlayHints","value":"true","type":"boolean","group":"editor_defaults_impl"}]
previewAcceptedKeys    showTypeInlayHints     [{"name":"showTypeInlayHints","group":"previewSettingsError.accepted","type":"boolean"}]
（parameter / other 两把同形状，全部 n=1）
catalog sizes: modelFieldDecls=189 · modelDefaultEntries=133 · nativeKeyTables=112 · nativeDefaultEntries=112 · previewAcceptedKeys=80
```

---

## 5. 零消费方自查（三格是真控件，不是假控件）

三把键本身**没有**新增任何模块，因此 `find-orphan-modules` 对本域无新增。逐键的读写链路（grep 实测）：

- 定义：`src/inlayHints.ts:55-61`（`InlayHintSettingKey` + `INLAY_HINT_SETTING_KEYS` 三档映射）、`:71-75`（`inlayHintToggles`）、`:82-85`（`shouldShowInlayHint`）。
- **写口**：`src/components/InlayHintsSettingsPage.vue:38` `props.settings[key] = checked`；复选框绑定 `:52`、变更回调 `:53`；页面挂载 `src/components/SettingsDialog.vue:805`（`data-page="inlay.hints"` 在 `:804`）。
- **存盘**：`src/components/SettingsDialog.vue:302` `emit('save', { ...editor.value }, close)` → `src/App.vue:659` `request('settings.update', { settings: { ...editorSettings.value, ...patch } })` → 桌面侧 `native/settings_schema.hpp:87` 白名单 + `native/settings_schema.cpp:331` 默认；浏览器侧 `src/previewSettings.ts:24`。
- **读口/消费方**：`src/components/CodeEditor.vue:221`（`toggles: () => inlayHintToggles(props.settings)` 交给控制器）、`src/components/CodeEditor.vue:1055`（三档变化 ⇒ `inlayHints.schedule()` 重画）、`src/editorInlayHints.ts:128`（每一拍重取开关）、`src/inlayHintLayout.ts:71`（`shouldShowInlayHint` 过滤掉关掉那一档）。
- 新断言第 ⑥ 项还逐个验证「关掉这一格只有它自己掉，另两档照旧」，即三档之间不存在「一个开关管三格」的假分开。

结论：**没有假控件**，因此不写 `docs/wiring-requests-2026-10-06-inlayred.md`（本次无需主代理接线）。

---

## 6. 做不到 / 无法核实

- **改前全量红数没有实测**：12 路并行下重跑「改前全量」既慢又会把别人的在途红算进来。报告里的「改前 6 红」是按本域那条必然红（实测 fail=1）对同一次全量结果做的**算术外推**，不是实测。
- **`previewAcceptedKeys` 的 `type` 是推导值**：预览白名单本身不写类型，「布尔档」来自「该键在文件里只出现一次 ⇒ 落到收尾那条 `typeof value !== 'boolean'` 规则」。若日后给这三把键加专属校验分支，`type` 会变 `dedicated-branch` 并把这条用例弄红 —— 那是有意拦，不是脆弱锚。
- **native 默认值解析的边界**：`{"键", 值}` 用非嵌套正则取（值里带花括号的条目取不到）。三把键都是标量，实测命中；`editor_defaults_impl` 全量条目数 112 只用于「同名条目恰好一次」的判定，没被当成完备清单来断言。
- 别人域文档里那 5 条假上游路径的**真实位置**没有逐个复核（不是我的文件面），只在 §3 标了线索并注明「别照抄」。

---

## 7. 需要主代理接的线

无。本次交付只改测试文件，不动 `src/` 与 `native/`，不新增模块、不新增界面。

（给主代理的一条**核对项**：全量在途的红按快照分别是 5 → 11 → 16 条，归属见 §3 的第三份快照，
主要是 b8 判词计数、diff-citations 裸名登记、editor-match-brace、editor-folding / editor-code-block、
problems-view、run-startup-focus（整文件加载失败 ⇒ 多半是 `.ts` import 漏扩展名那类坑）、
以及 `tests/source-citations.test.mjs:85`（别人文档里的 5 条假上游路径，跑两遍）。
**没有一条来自本域**；`tests/inlay-hints-settings.test.mjs` 独立跑 5/5 绿。
最后一次的 `npx vue-tsc -b --force` 有 11 条错，也都在别人在途文件里（清单见 §3 的注）。）
