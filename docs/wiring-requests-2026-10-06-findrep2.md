# wiring-requests-2026-10-06-findrep2 — 需要保留文件配合的那一半

来源 lane：`docs/batch-2026-10-06-findrep2.md`（三档表在它的 C 段）。
本 lane **没有**动这些文件，因为它们在保留名单里；也**没有**先把面板开关画出来（规则⑧：没有消费链路就不渲染控件），所以下面这一档现在是**缺**的状态，不是"假装有"。

## 需求：工程内替换的「保留大小写」（upstream 真有，本仓真缺）

上游证据（本轮自己开树逐条数过）：

- `platform/lang-impl/src/com/intellij/find/impl/FindPopupPanel.java:787-791` —— 工程内查找对话框把这一档挂在**替换输入框**上：
  `new MySwitchStateToggleAction("find.options.replace.preserve.case", ToggleOptionName.PreserveCase, AllIcons.Actions.PreserveCase, PreserveCaseHover, PreserveCaseSelected, myPreserveCaseState)` → `myReplaceTextArea.setExtraActions(...)`；
  `:1213` 从 `FindModel` 读回、`:1590` 写回；`:1777` 的枚举 `ToggleOptionName {CaseSensitive, PreserveCase, WholeWords, Regex, FileFilter}`。
- `platform/analysis-impl/resources/messages/FindBundle.properties:85` —— `find.options.replace.preserve.case=Pr&eserve case`（**只有英文**；zh 措辞无法核实，见登记）。
- `platform/lang-impl/src/com/intellij/find/impl/FindManagerBase.java:288-296` —— 生效点：正则展开**之后**再
  `Registry.is("ide.find.word.based.preserve.case") ? applyCase(foundString, replacement) : replaceWithCaseRespect(replacement, foundString)`。
- `platform/util/resources/misc/registry.properties:1414` —— 该注册表项 `=true` ⇒ **默认档 = 逐词 `applyCase`**（这条已用于本 lane 的编辑器侧还原）。
- `platform/indexing-api/src/com/intellij/find/FindModel.kt:409-411` —— `var isPreserveCase: Boolean = false`（默认**关**，用户手动开）。
- `platform/lang-impl/src/com/intellij/find/impl/FindUIHelper.java:125`、`.../FindInProjectUtil.java:451` —— 同一档在设置与 usageView presentation 之间的两处搬运。

本仓现状：`src/components/SearchPanel.vue:641-643` 只有 `caseSensitive` / `regex` / `wholeWord` 三个 `fs-toggle`，无 preserve；替换文本由原生生成。

## 需要动的保留文件（按依赖顺序）

1. **`native/main.cpp`**（保留）—— 查找/替换入参的 JSON→`Options` 只在这一处：`:1300-1311` 那个 `case "search.run"_h: … "search.replaceSelected"_h` 分支里，`:1303-1310` 逐字段 `params.value(...)`。
   需要加一行：`options.preserve_case = params.value("preserveCase", false);`（默认 `false` = 与上游 `FindModel.kt:411` 的默认一致）。
2. **`native/search.hpp`**（非保留，但结构体紧挨着上面那一跳）—— `struct Options` 在 `:15-22`（`replacement :17`、`regex :18`、`case_sensitive :19`、`whole_word :20`）；加 `bool preserve_case = false;`。
3. **`native/search.cpp`**（非保留）—— 两个生效点，都在**正则展开之后**：
   - `:750` `replace()` 内联：`result += build_replacement(...)`；
   - `:778-787` `substitution_text()`（`:782` 那一行）—— `preview()` 的 `after` 与 `replace_selected()` 共用它，所以预览里那一行「→ 替换后」也会跟着正确。
   需要一处 `apply_preserve_case(options.preserve_case, found, text)`，算法照 `src/preserveCase.ts:applyCase`（已按上游 `PreserveCaseUtil.java` 移植并有逐条用例）；`found` = 命中文本（正则档是整段匹配，非正则档是 `query` 本身）。
4. **`src/bridge.ts`**（保留，余量 **0**）—— `SearchOptions` 在 `:192` 是一行式 interface，就地加 `preserveCase: boolean` 即可（净增 0 行；若需要占新行则必须先等额减行）。
5. **`src/components/SearchPanel.vue`**（非保留，上限 900）—— 现在是 **898 行**（`split('\n').length` 口径），加"一个 `ref` + 一个 `fs-toggle`"正好 **+2 = 900**：贴上限、给并发 lane 留 0 余量。⇒ **本 lane 没做**；做的时候先在面板里腾 2 行（或把整条 toggles 行抽进子组件），别把上限推高。
   开关文案：图标 `AllIcons.Actions.PreserveCase` 在本仓没有对应物 ⇒ 按本仓既有做法用 `lucide-vue-next` 的现成图标 + `iconSize.control`，或沿用编辑器栏那颗 `Aa`（`src/components/EditorFindBar.vue:212` 的写法）——**不要**为它新造图标键。
6. 记录/持久化：若要"下次打开还记住这一档"，新键必须**缺键补默认**（规则⑥）；本仓同类先例是 `src/editorFindController.ts:143` 写 `taocode.findOptions`（读回 `:29-30` 用 `Boolean(parsed.preserveCase)`，缺键即 `false`）。

## 验收（做的时候必须一起给）

- 判据要能失败：至少钉「面板把 `preserveCase` 发给 `search.preview` / `search.replace` / `search.replaceSelected` 三条通道」+「非正则与正则两支的 `applyCase` 结果与 `tests/preserve-case.test.mjs` 同源」。
- 上游用例同源：`java/java-tests/testSrc/com/intellij/find/impl/PreserveCaseUtilTest.java`（本轮实测该文件在，逐条已被 `tests/preserve-case.test.mjs` 覆盖）。
- native 侧改动记得同步 `ctest`（本 lane 未跑 native，因为没动它）。

## 处理结果（wiring-backlog lane，2026-10-06）

- 目标 `src/components/SearchPanel.vue`（本 lane 可改面）+ `src/components/EditorFindBar.vue`（VCS lane 独占）+ `src/bridge.ts`（保留）。因 EditorFindBar 与 bridge 非本 lane，未单方面接（保留大小写链路需两处同批）。需对应 owner。

结论：零接线（跨 VCS lane 与 bridge）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（跨 VCS lane 与 bridge）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
