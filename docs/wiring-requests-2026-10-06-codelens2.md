# 接线请求 2026-10-06 · codelens2（Code Vision 右键菜单与 hover 类型登记的剩下一半）

这份文件本来由 `codelens2` 那一批写：`src/codeLensSettings.ts:56` 与（本批补的）
`src/codeLensExtension.ts:86` 都点名引用它的 C-2，但那条 lane 在"准备做反向验证"时撞上轮次上限被停，
**报告与这份请求都没落盘** ⇒ 引用悬空。codelens3 接手时代为补齐，出处逐条注明是谁核的。

上游基准树（只读）：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`。
下面每条上游坐标都由本批 `sed -n` 亲自打开核过；核不动的一律标「无法核实」，不猜。

---

## C-2 右键菜单缺第三项「Lens Settings…」（**登记，需要宿主给一只手**）

上游那一条：`platform/lang-impl/src/com/intellij/codeInsight/codeVision/ui/popup/CodeVisionContextPopup.kt:24`
读 `CodeVisionHost.settingsLensProviderId` 决定是否渲染第三行，点了跳到设置页。
那一行的**文案键**是 `LensListPopup.tooltip.settings`，原文
`platform/lang-impl/resources/messages/CodeVisionBundle.properties:10` = `&Configure…`
（本批 `sed -n '8,12p'` 逐字读到）。
**订正**：`src/codeLensSettings.ts` 与 `src/codeLensExtension.ts` 的注释原来把这一行写成「Lens Settings…」——
那不是上游的文案（同文件 `:11` 另有一键 `LensListPopup.tooltip.settings.settings` = `"&Settings`，
被 `CodeVisionListPopup.kt:23` 当 tooltip 用，不是这条菜单行），两处已按读到的原文改回。

本仓现状（两处注释已经改口，但**动作仍然没有**）：

- 页已经有了：`src/components/CodeVisionSettingsPage.vue`，挂在 `src/components/SettingsDialog.vue:808`
  的 `section === 'code.vision'` 那一节（本批打开 `SettingsDialog.vue:808` 逐字核到）。
- 缺的是"打开它"的那只手：渲染通道 `src/codeLensExtension.ts` 的 `openCodeVisionContext`（`:141`）
  手里只有 `codeVisionSettings` 与 `onGateApplied`，没有任何 `openSettings`；
  那一个是宿主 `src/components/CodeEditor.vue`（**保留文件**）经由 `createCodeLens(deps)` 才能给进来的东西。

请求（给 CodeEditor.vue / App.vue 的宿主接线者，两条都行，取其一）：

1. `CodeLensDeps`（`src/codeLensExtension.ts:281` 那一段）加一个可选 `onOpenSettings?: () => void`；
2. 宿主在组装 `createCodeLens({...})` 时把它指向"打开设置对话框并选中 `code.vision` 那一节"的现有动作
   （设置页的 section id 是 `'code.vision'`，见 `SettingsDialog.vue:808` 的 `:id` 拼接）；
3. 渲染侧拿到 `onOpenSettings` 之后才**多渲染那一行**（`codeVisionContextActions()` 加第三项，
   文案用上面逐字读到的英文原文 `&Configure…`；**中文**那一版在本地树里核不到 ——
   `find . -iname "CodeVisionBundle_zh*"` 与 `-iname "*localization-zh*"` 都是 0 命中，
   所以**无法核实**官方中文，不许自己编一条中文）。

没有 `onOpenSettings` 时保持今天的行为（只有 `!Hide` / `!HideAll` 两行）——
这就是"宁可不渲染，也不放一枚点了没反应的条目"。
判据落点建议：`tests/code-lens-codicon.test.mjs` 或新开一条，数**菜单 DOM 里实际有几行**
（`openCodeVisionMenu` 在 `src/codeLensExtension.ts:105`），不要再读源码文本。

## C-3 `src/bridge.ts` 的 hover 回包类型没有 `range` 那一格（保留文件；与 lshl 的 W3 同一件事）

事实（本批自己打开两处核的）：

- 原生侧**已经**透传：`native/lsp_session.cpp:170-171`
  （`auto reply = Json{{"available", true}, {"contents", hover_text(…)}};`
  → `if (result.contains("range") && result.at("range").is_object()) reply["range"] = result.at("range");`），
  随 HEAD `11a736e` 就在盘上，`git blame` 核到；
- 前端也**已经**在消费：`src/docHoverContent.ts:69-81` 的 `hoverRangeFromPayload`、`:88-96` 的
  `presentationFromRange`（判据 `tests/doc-hover-content.test.mjs`）；
- 仍缺的只有**类型登记**：`src/bridge.ts:126` 是
  `export interface LspHoverResult { available: boolean; contents?: string }` —— 没有 `range`。
  所以 `src/docHoverContent.ts:36-43` 自己声明了一份 `LspHoverPayload`（注释在 `:31-32`）。

请求：把 `range?: { start: LspLocation; end: LspLocation }` 一类的形状加进 `LspHoverResult`
（`src/bridge.ts` 是保留文件，本批不动），然后 `docHoverContent.ts` 改用它、删掉自己那份重复声明。
同时把 `src/docHoverContent.ts:31-33` 那句「**没有** range 那一格」改成中性描述 ——
它写的是 `bridge.ts` 的类型、今天仍然字面成立，但容易被下一个代理读成"native 在裁掉 range"
而重复提一条 R5（`docs/wiring-requests-2026-10-06-lshl.md` 的 W3 就是这条，归属在那边，本批不重复登记）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **C-2（右键菜单第三项「&Configure…」）** —— 目标 `src/components/CodeEditor.vue`（禁改清单）+ `src/codeLensExtension.ts`（本 lane 可改面）。因 CodeEditor 侧无法加 `onOpenSettings`，渲染侧单加第三项 = 假控件。**需 CodeEditor owner**。
- **C-3（`LspHoverResult` 加 `range`）** —— 目标 `src/bridge.ts`（前端接线 lane 独占）。复核 native 侧已透传（`native/lsp_session.cpp:171`）、前端已消费（`src/docHoverContent.ts`），只差类型登记。**需 bridge owner**。

结论：零接线（两条都卡在别人文件上）。
