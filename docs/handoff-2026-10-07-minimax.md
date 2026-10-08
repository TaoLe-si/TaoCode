# 交接工单 · 2026-10-07 · 剩余接线批次（执行者：minimax m3.1）

> 本文是**给下一个执行模型的完整工单**：只做下面列出的活，每条自带上游坐标、落点文件、验收命令。
> 协调人（上一会话）已完成全部高危件：emmet 全量端口、saveAsTemplate、配色方案页接线、两条门禁冲突修复。
> 树上当前状态：**npm test 9312/9312 全绿、vue-tsc 0 错、module-size 5/5、vite build ✓、build-native-locked.bat ✓**（2026-10-07 收工时）。

## 〇、硬规则（违反任何一条 = 返工）

1. **文本文件一律 LF**，绝不出现 NUL/控制字节。新建文件用 Write 工具；**禁止 heredoc+python 写源码**（会静默改坏中文/引号）。
2. **`tests/*.mjs` 是纯 JS**：不许类型注解、`import type`、`as`、参数属性。**`src/*.ts` 里不许 TS 参数属性**（`constructor(private x)`）—— node 类型剥离不认，测试全崩。
3. **块注释里不许出现 `*/` 子串**——包括文件路径里的通配符（`plugins/color-schemes/*/resources` 会提前终止 JSDoc）。写法：路径里的 `*` 用「星」代替。
4. **模块尺寸门禁**（`tests/module-size.test.mjs`，按 `split('\n').length` 计数，尾换行算一行）：默认 900；`src/App.vue` **2680（零余量）**、`src/components/SettingsDialog.vue` **1182（零余量）**。上限**只降不抬**。往零余量文件加行前必须先腾行（合并注释/把页拆到 `*Page.vue`）。
5. **保留文件清单**（子代理/执行模型不许改，需要改的条目在下文标了「⚠ 需协调人」）：`src/App.vue`、`src/bridge*.ts`、`src/style.css`、`src/tokens.css`、`src/uiIcons.ts`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`src/keymap*.ts`、`src/actionRegistry.ts`、`src/menus/types.ts`、`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`、`CMakeLists.txt`、`package.json`、`tsconfig.json`、`native/main.cpp`。
6. **上游参考树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 绝对只读**——连 `sed -i` 写回等值内容也禁止（会重置 Birth/mtime）。
7. **git 纪律**：禁 `checkout --` / `reset` / `stash` / `clean`（工作树有大量未提交改动，`checkout --` 会抹掉整份文件）；禁 commit / push（等用户批）。
8. **上游引文必须逐行核过**：写任何「上游 `文件:行号`」之前先打开那行确认内容；拿不准就读文件，**不许凭记忆编坐标**（本批刚修过一批编造坐标）。功能语义同理：ZCode 侧参考 `D:\TaoCode\.tools\ZCode`（gitignored 浅克隆），IDEA 侧参考上游树。
9. 每完成一条：跑 `node --test tests/<对应>.test.mjs`；全部完成后跑 `npm test`（须 9312+ 全绿）+ `npx vue-tsc -b`（0 错）。
10. **部署链**（改了 `src/**` 之后要让真 exe 用上）：先 `npx vite build`，再 `cmd //c "scripts\\build-native-locked.bat"`（它只拷 dist 不编译）。

## 一、工单清单（按优先级；均为「简单/机械」件）

### A1. 接线 `emmetHtml.ts` → 编辑器 Tab 展开（非保留文件）
- 物料已备齐：`src/emmetHtml.ts`（658 行，纯函数，12/12 判据绿）、入口签名 `expandEmmetHtml(abbreviation, { surroundedText?, insertSurroundedTextAtEnd? })`，失败抛 `EmmetHtmlError{reason:'lex'|'parse'|'filter'}`。
- 落点：编辑器按键处理（`src/CodeEditor.vue` 或 `src/editorCommands.ts`，先 `grep -rn "Tab\|indentMore\|insertTab" src/` 找现成键位分发表）。语义（上游 `ZenCodingTemplate.java` / `EmmetPreviewTypedHandler.java`）：**光标左侧同一行的文本若能被 `expandEmmetHtml` 成功解析且当前文件语言是 HTML 族**（`languageFor(path)` 已有，见 `src/templates.ts:44`；HTML 判定可用扩展名 `.html/.htm/.vue`），Tab 展开为片段插入；解析失败回落到原有缩进。不做预览气泡（上游 `EmmetPreviewHint` 未移植，登记差异即可，写在接线处注释里）。
- 验收：新增 `tests/emmet-editor-wiring.test.mjs`（纯逻辑层：给定语言+光标前缀，判定「展开 or 回落」+ 展开文本），并真机按 A4 验。

### A2. 接线 `saveAsTemplate.ts` → 编辑菜单（⚠ 含保留文件，只许做非保留那一半）
- 物料：`src/saveAsTemplate.ts`（88 行，5/5 判据绿）。`saveAsTemplateAvailable({selection})` → `buildTemplateDraft(selection, language, suggestedAbbreviation)`。
- 落点：先 `grep -rn "编辑器菜单\|editMenu\|menuRegistry\|Edit 菜单" src/` 找菜单项定义处。若菜单内容在保留文件（`src/actionRegistry.ts` / `src/menus/types.ts` / `src/keymapBindings.ts`）里，**停手标「⚠ 需协调人」**；若在非保留的 `src/editMenu.ts`（或同名）里，加一项「另存为实时模板」（enabled = `available.available`），点击后把草稿写进 `src/templates.ts` 的 customs 通道（写盘函数已存在，`grep -n "customs" src/settingsPersistence.ts src/templates.ts`）并跳到 `editing.templates` 设置页。
- 验收：对应 `.mjs` 用例 + 真机：选中代码 → 菜单项可点 → customs 里出现新模板。

### A3. 其余五条独立小接线（全在非保留文件）
每条的物料模块与上游坐标都已在各自文件头注释里写好，照注释接：
1. `src/trailingSpacesStrip.ts` → `src/editorFileOps.ts`（保存时剥行尾空白；上游「保存动作」链）。
2. `src/richCopy.ts` → `src/CodeEditor.vue` 剪贴板通道（复制带语法高亮富文本；上游 `CopyReferenceAction`/HTML transfer）。
3. `src/editorTextCommands.ts` → `src/editorCommands.ts` + `src/editMenu.ts`（**键位表 `src/keymapBindings.ts` 是保留文件 → 那一半标 ⚠**）。
4. `src/pathMacros.ts` → `src/runActions.ts`（运行配置路径宏展开）。
5. `src/gitUpdateSettings.ts` 对话框 → `src/vcsActions.ts`（更新选项对话框；VCS 真机要在 `D:/TaoCode/.tools/ui-parity-proj` 上验）。

### A4. 真机复验（改完 A1–A3 之后一次做完）
- 方法（全部已验证可用）：`TAOCODE_DEBUG_PORT=9341` 起 exe，`scripts/realdbg.py` 真键鼠驱动 + CDP `el.click()`。要点：视口外元素先 `scrollIntoView`；合成 click 不算用户手势（复制类要真点击）；原生模态对话框 CDP 看不见，要发 WM_CLOSE；`Page.reload` 后 evaluate 不应声就重启 exe。
- 必验清单：①设置 → 编辑器 → 配色方案页能打开（本批新接，树里在「编辑器」分组直属，标签「配色方案」）；②右 dock Agent 面板与左侧栏同开、拖宽互不联动（上一批已验，回归即可）；③A1 的 Tab 展开在 `.html` 文件里出片段；④A2 菜单项灰/亮随选区变化。

### A5. 文档回填
- `docs/batch-2026-10-07-agent.md` 追加本批（协调人已写的部分 + 你做的接线）；
- `HANDOFF.md` 顶部状态行更新日期与测试数；
- 若接线让某个判决表条目从 `[ ]` 变 `[x]`：回填 `docs/inventory/*.json` 对应条目（口径见 `docs/inventory/` 现有文件）。

### B0. ✅ **已完成（2026-10-07 晚，协调人亲做，真机五项验证）** —— 原工单保留作对账

**落地内容**：`src/outlineSupertypes.ts`（138 行：三跳取数 + **按需补开** + `toInheritedMembers` 映射，`tests/outline-supertypes.test.mjs` 8/8）；接线 `ToolWindowView.vue`（ctx 字段 + `:supertypes` + jump 带 `path`）、`toolViewContext.ts`（透传）、`App.vue`（两行同行追加，2679/2680）、`OutlinePanel.vue`（336 行：「显示继承的成员」开关 + 类子树后插继承行 + muted 令牌 + 跨文件跳转）。

**真机 root cause（已修）**：语言服务对**没 open 过的文件**的 `documentSymbol` 回 `available:false` ⇒ 三跳链拿不到父类型成员。修法：第一次问不到时 `file.read` → `lsp.open {path,text}` 补开 → 重问（`membersOfParent`/`documentSymbolsOf`；问完**不** `lsp.close`）。真机证据：Base.java 不手动打开，开关一点继承行就出。

**真机五项证据**：①开开关即出 4 条继承行（自动补开）；②muted 样式 8 段、色值 = `--muted`；③关 3 行 → 开 7 行（往返复原）；④双击继承行跳到 Base.java（`.tab-select`）；⑤同签名/构造器剔除与 private 档位过滤走 `outlineInheritedMembers` 原判据。

**已知保真度注记（如实）**：jdtls 的 `documentSymbol.detail` 不带修饰符（是类型/签名），所以 `isAccessibleFromSubclass` 判不出档位按 `unknown` **放行** —— 真机上 `hiddenField`/`hiddenMethod`（private）也显示了。这是 `outlineInheritedMembers.ts:222-230` 注释里写明的取舍（挡掉会漏），不是 bug；要收紧需要宿主先给「修饰符」这一位的数据源。

---

### B0'.（原工单存档，供对账）（最高优先，已勘误）接线 `outlineInheritedMembers` → OutlinePanel「继承成员」

**勘误**：上一版工单写「宿主侧没有 LSP typeHierarchy 通道」——**查错了**。native 早已全通：
- `native/lsp_session_kinds.cpp:196-206`：`prepareTypeHierarchy` 转发，回包 `items` 每项带 `raw`（服务器原对象）+ `path`（工作区相对路径）；
- `:210-240`：`typeHierarchySupertypes` / `typeHierarchySubtypes` 转发，接受 shaped 条目（读 `.raw`）或裸 item；
- 前端 kind 联合已含三个 kind（`src/bridge.ts:176`）；`src/lspFeatureMatrix.ts:74-75` 说「未接」已过时（顺手把那条 surface 改成真话）。
- **同链路现成参考**：`src/navGotoSuper.ts` 的 `runGotoSuper` —— prepare（类符号行列）→ 取 `items[0]` → supertypes → 逐父 `documentSymbol`。请求形状照抄它。

数据链（全部已验证存在）：
1. `lsp.request {kind:'prepareTypeHierarchy', path, line: classSymbol.startLine, character: classSymbol.startChar ?? 0}` → `items[0]` = root（含 `raw`）；
2. `lsp.request {kind:'typeHierarchySupertypes', path, item: root}` → `items[]`（父类型，父类在前接口在后，**照抄不重排**）；
3. 对每个有 `path` 的父类型：`lsp.request {kind:'documentSymbol', path}` → `symbols[]`；
4. 组 `SuperTypeMembers[]`（`src/outlineInheritedMembers.ts:91`：name = 父类型符号名、detail = 父类型符号 detail、members = 其子成员按 `InheritedMember` 形状 `:72`）；
5. `mergeInheritedMembers({own, superTypes})` → `{own, inherited, all}`（去重/构造器剔除/private 挡掉/同签名留最派生，全在模块里）；
6. 渲染：继承行 = `memberTextSegments`（名字 + `→来源类`，`tone:'muted'` → CSS `var(--muted)`，令牌常量 `INHERITED_TEXT_TOKEN`）。

接线落点（四个文件，App.vue 只许一行）：
- **新文件 `src/outlineSupertypes.ts`**：宿主侧三跳请求封装 `fetchSuperTypeMembers(request, path, classSymbol): Promise<SuperTypeMembers[]>`（逐跳 try/catch，任一跳空/败 ⇒ 跳过该父类型；**不编数据**）。写好 `.mjs` 判据（mock request 序列断言形状与「跳过」语义）。
- `src/components/ToolWindowView.vue:27` 的 `ToolWindowViewContext` 加可选字段 `outlineSupertypes?`（风格同 `provideUsageSymbols`：面板吃数据，宿主管请求）。
- `src/toolViewContext.ts:96` 透传一行。
- `src/App.vue:899` toolViewCtx 里传实现（App 2679/2680，只许一行：`outlineSupertypes: (path, sym) => fetchSuperTypeMembers(request, path, sym)`）。
- `src/components/OutlinePanel.vue`（220 行，余量足）：新开关按钮，文案 `INHERITED_MEMBERS_LABEL`、**默认关**（`inheritedMembersDefaultOn()`，上游两条依据在模块头）；**开了才发请求**（懒加载，按 `path+类符号` 缓存）；own 成员取 outline 树里该类节点的子成员（`treeOf` 已有嵌套），类符号判定用 `CLASS_LIKE_SYMBOL_KINDS`（`src/lspSymbolBridge.ts`）；行序 = `all`（自己的在前、继承的在后，上游 `NodeProvider.java:14-22` 口径）。可选做分组渲染（`groupInheritedBySuperType` + `withSuperTypeAccess`），不做也不算缺。

验收：新 `.mjs` 判据全绿 + 真机（ui-parity-proj 有 jdtls）：打开一个 `extends` 的 `.java` → 结构视图开「继承成员」→ 父类成员出现、灰显、`→父类名`；关掉开关恢复原样。`src/outlineInheritedMembers.ts` 文件头的「本仓能做到哪一档（如实）」不得顺手补齐。

### A4'（补充，右 dock 已由协调人验过）

上一版 A4 的 ②（右 dock 同开/拖宽不联动）**协调人已真机四项验证**（两栏同开、弦按侧、互不串扰、重启归位），你只需回归。另记真机新坑：**CDP 菜单跨 run 会丢**（终端抢焦点 → `toolMenu` 关闭）——开菜单→点行必须在**同一个 realdbg run**；行定位优先 `clickText`（精确行名，如「移动到右侧」）；eval 里嵌套引号易炸，用 `String.fromCharCode(…)` 拼字符串最稳；eval 突然全 null = 页面已导航/重启 exe。取证环境：`projects.json` 在 `C:/Users/Administrator/AppData/Local/TaoCode/projects.json`（`lastProject` + `recentProjects`），验完把 `lastProject` 改回 `E:/Applied Energistics 2 Acceleration` 并从 recentProjects 摘掉 ui-parity-proj。

## 二、明确**不做**（要么高危要么未决策，留给协调人）

- ~~右 dock 三处遗留耦合~~ —— **协调人已于 2026-10-07 完成并真机四项验证**（齿轮行按侧各自算 `rightToolWindowGearRows`；`setToolAnchor`/`restoreVisibility`/`showAfterTypeChange` 经 `showAtAnchor` 按锚点路由、`currentVisibleIds` 记账右栏；`resizeTarget` 用 `sideDockOf` 返回 `rightDock` 面板）。改动面：`menuUi.ts`、`toolWindowStripes.ts`、`toolWindowDockSide.ts`（deps 惰性化）、`toolWindowDocks.ts`（+`sideDockOf`）、`panelResize.ts`、`App.vue`（零新增行）。
- ~~`outlineInheritedMembers.ts` 接 `OutlinePanel.vue`~~ —— **此前写「宿主侧没有 typeHierarchy 通道」是错的，已勘误**：native 通道早已全通（见下面 §B0），这条升级为最高优先接线任务。
- Agent 面板 UI 风格统一化的 11 个 Section 收尾：涉及 ZCode 对照（`.tools/ZCode/packages/ui/src`），量大且判据在 ZCode 侧，留给协调人排批。
- 任何 `keymapBindings.ts` / `actionRegistry.ts` / `App.vue` / `SettingsDialog.vue` 的进一步改动（后两个这批已被协调人填满）。

## 三、本批（协调人）完成清单 —— 供对账

| 件 | 证据 |
|---|---|
| `src/emmetHtml.ts`（658 行）：词法/递归下降/四操作节点/编号占位/Lorem 全上游直译 | `tests/emmet-html.test.mjs` 12/12（含上游行文钉死断言） |
| `src/saveAsTemplate.ts`（88 行）：`SaveAsTemplateAction.java:56/:124/:167-171` 直译，两只隐式手不搬 | `tests/save-as-template.test.mjs` 5/5 |
| `src/colorSchemeSettingsRegistration.ts` + 配色方案页接线（`settingsTreeMeta.ts` groupId 直属修正 + `SettingsDialog.vue` 一行挂载 1182/1182） | `tests/color-scheme-settings-registration.test.mjs` 4/4、`settings-tree-parity` 全绿 |
| 修遗留红 ×2：`AgentPanel.vue:703` 补 `aria-selected`；`trustedPathRules.ts` 删上游两只「隐式放行」的手（改名 `isUnderWelcomeScreenDir` 保留合法助手） | `toggle-aria-state` 6/6、`trust-persist-defaults` + `trusted-path-rules` 58/58 |
| 全量回归 + 构建链 | `npm test` 9312→**9320**/9320、`vue-tsc` 0 错、`vite build` ✓、`build-native-locked.bat` ✓ |
| **B0 继承成员全链接通**（见上方 B0 节） | `tests/outline-supertypes.test.mjs` 8/8、真机五项（出 4 行/样式/往返/跳转/判据） |
| **UI 全量重构 · 第一批**（按 vuejs-ai 系列技能审计后改）：`SettingsDialog.vue` 两处模板内联 `.filter` → script 派生（`directSettingNodes`/`orphanSettingNodes`） | `npm test` 9320/9320、`vue-tsc` 0 错、尺寸 1182/1182、`vite build` ✓ |

## 三'、UI 全量重构 · 审计结果（vuejs-ai 系列技能 · 2026-10-07）

用户要求「根据加载的 SKILL 全量重构 UI」。8 个 vue 系列技能（vue-best-practices/debug-guides/testing/router/pinia/jsx/options-api/create-adaptable-composable）已装到 `~/.agents/skills/` 并全部载入。审计结论：

**合规，无需改**：
- v-if + v-for 同元素：0 处；模板排序/过滤派生基本都进 computed；watch 异步清理无缺失；
- `v-html` 仅 `MarkdownPreview.vue` 一处 —— `renderMarkdown`（`src/markdown.ts:110`）**全量先 escapeHtml** 再内联渲染、`javascript:` 等 scheme 被块掉、WebView 有 CSP ⇒ 合规（技能禁的是「未转义的不可信内容」）；
- `defineModel` 已在用（`ProjectDialog.vue`）；props/emits 契约均有类型。

**已修（第一批）**：`SettingsDialog.vue:473/:486` 两处 `v-for="… in visibleNodes.filter(…)"` 模板内联过滤 → script 派生。宿主 1182/1182 压线（imports 两组各并一行腾出）。

**记录不改（各有理由，不要「顺手改」）**：
- `:key="index"` 8 处（EventLog/BinaryViewer/ProjectDialog/AgentPanel/DebugConsolePane/ShelfPane/TestRunner/DeleteConfirm）—— 全是**只追加或静态**清单，index 是稳定 primitive 键（技能允许），改成内容键反而让行重挂；
- `useTemplateRef`（Vue 3.5.43 适用）：仓库多个测试用**源码 regex** 钉住 `ref(` 模式（如 `tests/toggle-aria-state.test.mjs`、`structure-follow.test.mjs`），整体迁移风险 > 收益，暂不迁。

**下一批（未做，机械件）**：scoped CSS 里的**元素选择器**（技能：类选择器优先，性能）—— 12 个文件：`FileColorsSettingsPage.vue`(8)、`VcsLogDetails.vue`(6)、`VcsLogFilters.vue`(5)、`VcsLogTextFilterSettings.vue`(3)、`VcsLogGraphOptions.vue`(3)、`SearchEverywherePreview.vue`(3)、`VcsLogDiff.vue`(2)、`VcsLogChangeTree.vue`(2)、`DependencyAnalyzerDialog.vue`(2)、`VcsLogGoToRef.vue`(1)、`VcsLogChanges.vue`(1)、`GradlePanel.vue`(1)。改法：给对应元素加类名、选择器改成 `.类 后代` —— **逐文件核 specificity 不变**（`th, td {}` → `.x-table th, .x-table td` 这类），每文件改完跑 `npx vue-tsc -b` + `npx vite build`，全批后真机截图对比（这些面板的截图基线在 `build/ui` 部署后的真 exe 里取）。

emmet 的 6 条登记差异（无 live-template 注册表、`X+` 只支持映射表、Lorem 确定性 LCG、单行输出无 `$END$`、`|filter` 抛错、无 schema 属性补全）写在 `src/emmetHtml.ts` 头部，接线与对账时如实引用，不要「顺手补齐」。
