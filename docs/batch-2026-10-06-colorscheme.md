# 交付报告 · colorscheme 桶 · 2026-10-06

任务：补 IDEA **Editor ▸ Color Scheme** 整页（`docs/inventory/verdict-editor.md` §C-4 / 缺口清单第 ③ 条：
「`colorScheme` 全仓 0 命中，同时卡住彩虹括号/文件颜色/内联档」）。

## 0. 留痕（动手前核实，改了派单/判词的两处坐标）

- 派单写 `platform/editor-ui-ui` ⇒ **参考树里没有这个目录**（`ls platform/` 核实）；实际挂载点族在
  `platform/platform-impl/src/com/intellij/application/options/colors/`（`ColorAndFontOptions.java`/
  `NewColorAndFontPanel.java`/`SchemesPanel.java`/`ColorOptionsTree.java`/`OptionsPanelImpl.java`/
  `ColorSchemeExporter.java`/`ColorAndFontDescriptionPanel.kt` 等），序列化在
  `platform/editor-ui-ex/src/com/intellij/openapi/editor/colors/impl/AbstractColorsScheme.java`，
  接口在 `platform/platform-api/src/com/intellij/openapi/options/colors/ColorSettingsPage.java`、
  `platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java`。原写 X、实际 Y。
- 判词 §C-4 行内把彩虹采集类归在 `platform/platform-impl/.../colors/highlighting/` —— 该目录确有
  `RainbowAttributeDescriptor.java` 等；另 `RainbowCollector.kt` 实为 FUS 统计收集器（22 行，与设置页呈现无关），
  彩虹档位在设置页的载体是 `RainbowAttributeDescriptor.java` + `RainbowDescriptionPanel.java`。

## 1. 判词表

族：`colorscheme`（§C-4 配色方案设置页，7 类 + 用户可见面逐条）。判定用规约口径：`[x]` 已做 · `[~]` 部分 · `[ ]` 未做 · `[-]` 不适用。

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|
| 页面注册（Editor 组下的 Color Scheme 页） | `[x]` | `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1749-1751` | `src/settingsTreeMeta.ts` 挂载 = 接线请求 W-1；页面 `src/components/ColorSchemeSettingsPage.vue:1-19` | 键名沿用上游 configurable id `reference.settingsdialog.IDE.editor.colors`（组内 groupWeight=180 ⇒ 排在「代码风格」前） |
| 面板结构（方案条 / 颜色项表 / 预览分栏） | `[x]` | `platform/platform-impl/src/com/intellij/application/options/colors/NewColorAndFontPanel.java:38-66` | `ColorSchemeSettingsPage.vue` 的 `scheme-bar` / `attribute-list` / `scheme-preview` 三段 | 预览在上游「页面带演示文本才出现」，本仓演示文本由页面自备（上游演示面 = `ColorSettingsPage.java:52`） |
| 方案列表 + 选中 + 继承显示 | `[x]` | `SchemesPanel.java:86-95,131-145`；`platform/editor-ui-ex/src/com/intellij/openapi/editor/colors/impl/AbstractColorsScheme.java:81,593`（`parent_scheme`） | `src/colorScheme.ts` `schemeChain/resolveOverrides/schemeThemeOf`；页面 combo + 「继承自」行 | 覆盖表沿链合并、后者胜；循环继承自动断链（本仓防御） |
| 方案注册中心（EditorColorsManager） | `[~]` | `platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsManager.java:28,32,44,50` | `src/colorSchemeStore.ts:30-107`（localStorage 方案表 + 选中项） | 磁盘 `.icls` 目录这一层本仓没有，落 localStorage；启动期全局应用 = 接线请求 W-3（现在**打开设置即回灌**） |
| 可编辑方案对象（EditorColorsScheme） | `[~]` | `platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColorsScheme.java:25,27`（get/setAttributes） | `src/colorScheme.ts` `ColorScheme.overrides` + `setAttributeOverride` | 字号/行距在上游也归方案对象，本仓已有独立通道（`src/settingsModel.ts`），**没**并进本页（避免双通道打架） |
| 编辑只读基座时派生可编辑副本 | `[x]` | `platform/platform-impl/src/com/intellij/application/options/colors/ColorAndFontOptions.java:386-388`；`platform/core-api/src/com/intellij/openapi/options/Scheme.java:9,27`；`platform/editor-ui-ex/src/com/intellij/openapi/editor/colors/impl/DefaultColorsScheme.java:104-106` | `src/colorScheme.ts` `ensureEditableScheme/editableCopyName/schemeDisplayName` | `_@user_` 前缀与「副本存在即复用」照抄；显示名剥前缀 |
| 颜色项列表（逐档一行） | `[x]` | `platform/core-api/src/com/intellij/openapi/editor/DefaultLanguageHighlighterColors.java:13,14,15,17,19,25,27,33,37,59`；`platform/editor-ui-api/src/com/intellij/openapi/editor/colors/EditorColors.java:18,19,21,34,36,59,62,68`；`EditorColorsScheme.java:32,34` | `src/colorScheme.ts` `COLOR_ATTRIBUTE_ITEMS`（19 项：通用 10 + 默认语言 9） | **每一行都有 var() 消费方**（逐项 `consumer` 字段，tests/color-scheme-rules.test.mjs 机检），走既有 `--syntax-*`/编辑器令牌，无新增裸 hex |
| 每项目色块 + 前景编辑 | `[x]` | `platform/platform-impl/src/com/intellij/application/options/colors/ColorOptionsTree.java`（列表本体）+ `ColorAndFontDescriptionPanel.kt:83-86`（前景 Revert） | 页面 `swatch` 按钮 → 复用 `src/components/ColorChooserDialog.vue` | 色块背景 = `var(item.cssVar)`；取色初值 = `getComputedStyle` 回读真实生效值 |
| 每项 粗体/斜体/背景/删除线/效果线 | `[ ]` | `ColorAndFontDescriptionPanel.kt:107-108,120-121`（`myCbBold/myCbItalic`） | 不画（假控件禁令） | 本仓字重/斜体是 `src/editorTheme.ts:17-19`、`src/editorSemanticColors.ts:26,31` 的硬编码字面量，没有 var 通道 ⇒ 接线请求 W-2；通道一补页面即长控件 |
| 覆盖写入 = 等继承值不落冗余 | `[x]` | `AbstractColorsScheme.java:680-687`（equals-parent 短路）、`:694` 起 `optimizeAttributeMap` | `src/colorScheme.ts` `setAttributeOverride/parentOverridesOf` | 写回与父链生效值相同的色 ⇒ 该条覆盖被删 |
| 搜索框 | `[x]` | `ColorOptionsTree.java:58`（`TreeSpeedSearch.installOn`，速度搜索面） | `src/colorScheme.ts` `attributeMatchesSearch/filterColorAttributeItems` + 页面 `scheme-search` | 命中标签/外部键/CSS 变量名，大小写不敏感；分组保持「常规→默认语言」 |
| 重置（单项 + 整方案） | `[x]` | `ColorAndFontDescriptionPanel.kt:83-86`（单项 Revert）；`ColorSchemeActions.java:182-186` → `ColorAndFontOptions.java:392-395` | `revertAttributeOverride/resetSchemeOverrides` + 页面按钮 | 上游 reset 从磁盘原样还原，本仓没有磁盘原样 ⇒ **reset = 清空覆盖回继承**（收窄已在代码注释声明） |
| 删除方案 | `[x]` | `ColorAndFontOptions.java:365-380` | `removeScheme` + 页面垃圾桶钮 | 只读基座不可删；孤儿子方案挂回被删者的父方案（本仓自定，未引用上游行号） |
| 导出形状（.icls 骨架） | `[~]` | `platform/platform-impl/src/com/intellij/application/options/colors/ColorSchemeExporter.java:9`；`AbstractColorsScheme.java:572-573,591-593,649-661,689-691`（`name/version/parent_scheme`、`<attributes>` 按键排序、`option/value`） | `src/colorScheme.ts` `schemeToXml`（测试钉形状）；页面「复制方案 XML」= 剪贴板（`src/clipboard.ts:35`） | 文件保存通道页面拿不到 ⇒ 降级为剪贴板；`<value>` 内 `FOREGROUND` 子键由飞权重写器落盘、本体不在参考树 ⇒ **字符串形状无法核实**，本仓写死并被测试钉住 |
| 导入方案 | `[ ]` | `ColorSchemeImporter`（目录内文件，未逐行核） | 不画（无文件打开通道） | W-4 |
| 彩虹括号逐档改色（§C-4 卡点族） | `[ ]` | `platform/platform-impl/src/com/intellij/application/options/colors/RainbowAttributeDescriptor.java:11,22-25` | 不画（本仓五档色是 `src/editorBrackets.ts:117-126` 硬编码 hex，无 var 通道） | 本批交付的方案表是它们缺的地基；档位行 = W-2 |
| `getAdditionalHighlightingTagToDescriptorMap`（页面自带附加键映射） | `[~]` | `platform/platform-api/src/com/intellij/openapi/options/colors/ColorSettingsPage.java:62`（另有 `:52` getDemoText） | 本仓等价物 = `COLOR_ATTRIBUTE_ITEMS` 静态表 + 页面预览 token 类 | 上游每语言一页的附加映射依赖 `ColorSettingsPage` 插件面，本仓只有一张全局表 |

缺口③原文的「`colorScheme` 全仓 0 命中」：现在 `src/colorScheme*.ts` 2 个模块 + 1 个页面 + 2 个测试文件；
`grep -ril colorScheme src | wc -l` = **3**（改前 0）。文件颜色族（B-14）本就有独立存储，真正被这张表解锁的是
「方案合并/覆盖/导出」地基——彩虹与内联档的**页面级改色**仍等 W-2 的 var 通道，不是等这张表。

## 2. 改动文件清单（行数前后）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `src/colorScheme.ts` | 不存在 | 417 | 纯规则：19 个颜色项、继承/合并/diff/还原/重置/复制/删除、搜索、XML 形状 |
| `src/colorSchemeStore.ts` | 不存在 | 153 | localStorage 读写（容错补默认）+ `:root[data-theme=…]` 注入样式 |
| `src/components/ColorSchemeSettingsPage.vue` | 不存在 | 306 | 设置页：方案条/继承行/工具条/搜索框/颜色项列表/预览；当场消费上面两个模块 |
| `tests/color-scheme-rules.test.mjs` | 不存在 | 200（18 用例） | 判据测试 |
| `tests/color-scheme-store.test.mjs` | 不存在 | 165（13 用例） | 判据测试 |
| `.tools/orphan-baseline.txt` | 39 行 | 44 行 | 登记未挂载的页面一行 + 理由（先例：桶1/桶12b 段落；该文件为工作区基线、git-ignore） |
| `docs/wiring-requests-2026-10-06-colorscheme.md` | 不存在 | 新建 | W-1 挂载整段（可照抄）/W-2 变量化/W-3 启动应用/W-4 导入导出 |
| `docs/batch-2026-10-06-colorscheme.md` | 不存在 | 本文件 | 交付报告 |
| 其余一切文件 | — | 未动 | 保留文件（tokens.css/settingsTreeMeta/SettingsDialog/App.vue/editorTheme 等）全部只读 |

## 3. 规约 §5 自查（前后数字）

| 门禁 | 接单时 | 收工 | 归属判定 |
|---|---|---|---|
| `npx vue-tsc -b --force` | 0 错（当晚基线） | 3 错，全部在 `src/components/SearchPanel.vue`（bucket9 在途文件，中途轮跑还见过 TerminalPanel 2 错/templateMacros 1 错，均他域且已被各自 owner 处理） | **本域 0 错**（`colorScheme*` 与页面不在错误清单里） |
| `node --test tests/module-size.test.mjs` | 5 测全绿 | 5 测 3 过 2 红：`SearchPanel.vue` 902 行、`native/git.cpp` 954>938 —— 均为他域在途文件 | 本域三文件 417/153/306，全在 900 内、零登记 |
| `node .tools/find-param-props.mjs` | 0 | **0** | 干净 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** | 两个新 .mjs 无 TS 语法 |
| `node .tools/find-missing-ext.mjs` | 干净 | **干净**（1239 文件） | .ts 值 import 全带扩展名 |
| `node .tools/find-orphan-modules.mjs --gate` | 登记 8/基线 8 · 新增 0（绿） | 登记 9/基线 9 · **本域新增 0**；当前唯一「新增」= `src/structuralCodeBlock.ts`（他域代理在本次交付期间落盘，非本桶文件） | 两个模块被页面当场消费，不进孤儿清单；页面未挂载已登记基线并写理由（W-1 挂上后该行可删） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 测全绿 | 11 测 9 过 2 红，唯一失败项 = `src/vcsLogGraph.ts` 的 `CollapseGraphAction.java:13-38`（38>34，他域在途引用） | **本域引用全部被门核准通过**（我写进 src/文档 的每条「路径:行号」都在参考树里指得到） |
| 本域测试 `color-scheme-*.test.mjs` | 不存在 | **31 测 31 过 0 红** | — |
| ctest | 未跑 | 未跑 | 本桶没碰 `native/` |

⚠ 全仓口径说明：并行工作区里 module-size/orphan/citations/vue-tsc 的在途红都来自**别的桶代理的现场文件**
（SearchPanel、structuralCodeBlock、vcsLogGraph、git.cpp），本桶未动它们、也不按规约 §5 跑全量 `npm test`。

## 4. 反向验证（新判据门禁三步）

| 探针 | 注入内容 | 结果 | 撤掉后 |
|---|---|---|---|
| P1 假控件行 | 往 `COLOR_ATTRIBUTE_ITEMS` 塞一项 `--probe-no-consumer`（无消费方、不在 tokens.css） | rules 测试 **2 红**（「假控件禁令的机检面」+「tokens.css 同名」，18 测 16 过） | 移除探针 → 复绿 |
| P2 主题限定丢失 | `schemeCssText` 的选择器改成无主题的 `:root { … }` | store 测试 **2 红**（「按基座主题限定 data-theme」+「深色基座不借光」，13 测 11 过） | 恢复原选择器 → 复绿 |
| 收工复核 | 两个探针全部撤除、grep 无残留（`probe residue: none above`） | **31/31 绿** | — |

## 5. 零消费方自查结论

- `src/colorScheme.ts` ← 被 `ColorSchemeSettingsPage.vue` + 两个测试消费（生产消费方 ✓）。
- `src/colorSchemeStore.ts` ← 被 `ColorSchemeSettingsPage.vue` + store 测试消费（生产消费方 ✓）。
- `src/components/ColorSchemeSettingsPage.vue` ← 挂载点在保留文件（`SettingsDialog.vue`/`settingsTreeMeta.ts`，
  别的代理在改），按派单交 W-1；未挂载期间登记 `.tools/orphan-baseline.txt` 一行并写明理由（文件头同步自述，
  规约 §5 的「接不上就写清为什么」通道）。**不是假控件**：页面未渲染 ⇒ 界面上那一行根本不出现。
- 门禁输出里没有本桶模块的新增红。

## 6. 做不到 / 无法核实

1. **每行 粗体/斜体/删除线/效果线、项背景**：本仓无 var 通道（字面量在 `src/editorTheme.ts:17-19`、
   `src/editorSemanticColors.ts:26,31`，保留文件）⇒ 不画；W-2 给出逐行改法。
2. **彩虹括号五档 / 内联档在配色页逐档改色**（§C-4 卡点族）：`src/editorBrackets.ts:117-126` 硬编码 ⇒ 不画；W-2。
3. **启动期全局应用**：`App.vue`（appvue 独占）没接 ⇒ 打开设置前编辑器仍显示基座色；页面 mount 即回灌，
   改动即时生效+持久，W-3 一行可补齐。
4. **导入 / 文件导出**：页面拿不到文件打开/保存通道 ⇒ 导入不画、导出降级剪贴板（W-4）。
5. **`.icls` 内层子键字符串**（`FOREGROUND`/`fonttype` 由 `TextAttributes.writeExternal`
   `platform/core-api/src/com/intellij/openapi/editor/markup/TextAttributes.java:255` 委托的属性飞重写出）：
   飞重本体不在本地参考树 ⇒ **字符串形状无法核实**；本仓导出骨架只钉可核实的
   `scheme/attributes/option/value` 层级与排序（`AbstractColorsScheme.java:572-593,649-661,689-691`）。
6. **「重置到磁盘原样」**：上游 `resetSchemeToOriginal` 重读配置文件，本仓没有那份文件 ⇒ 重置=回继承，已收窄声明。
7. **方案改名 / 按语言分页 / “Show only modified” 开关**：上游有（`SchemesPanel.java:147-152` rename、
   `AbstractColorsScheme.java:108` partialSave），派单可见面未点名且本仓无按语言方案表 ⇒ 本批不做。
8. **中文文案**：上游 bundle 不在本地树，标签取英文原义直译（规约 §3），注释已注明。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-colorscheme.md`：W-1 挂载（照抄段，目标行已钉）、
W-2 字体样式/彩虹变量化（决定页面能否长出缺的控件行）、W-3 App.vue 启动应用、W-4 文件导入导出通道。
