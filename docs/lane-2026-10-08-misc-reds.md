# lane `misc-reds` · 2026-10-08

9 个既有红文件 → 全绿（121 条断言）。逐条先跑 `node --test` 读真实断言消息；改后每条都反向验证
（破坏实现 ⇒ 必须红 ⇒ 按字节恢复）。未动任何禁改文件。
## 逐文件：根因 / 改动（文件:行）/ 条数

1. `tests/action-registry.test.mjs`（1 红 → 绿 8/8）根因：判据钉旧调用形 `effectiveKeyBindings()`，
   实现 `src/keymap.ts:427` 已是 `effectiveKeyBindings(undefined, KEY_BINDINGS)`（base 取分派表自己的
   出厂表；缺省 base 是 `KEYMAP_EDITABLE_BINDINGS`，会混进 agent 工具栏那几条空转键）⇒ 判据过时。
   改 `tests/action-registry.test.mjs:160`。
2. `tests/keymap-bindings.test.mjs`（2 红 → 绿 15/15）(a) 同上，改 `:102`；(b) `brace.match` 的
   `boundAt` 指空行：`src/keymapBindings.ts:258` 原 `src/editorKeymap.ts:181` → 盘上真在绑的是
   `src/editorKeymap.ts:186`，改为 `186`。
3. `tests/jar-run.test.mjs`（1 红 → 绿 17/17）根因：`runStartParams` 先 `expandRunConfigMacros` 得
   `launchConfig`，shell 判断与 JAR 折算都读它，判据仍按 `config`。改 `tests/jar-run.test.mjs:195-201`
   （两条正则跟上，另加 `doesNotMatch(/jarRunConfigParams\(config,/)` 禁两半读不同 config）。
4. `tests/console-hyperlinks.test.mjs`（1 红 → 绿 12/12）根因：`RunConsole.vue:661` 是
   `@contextmenu.prevent.stop=…`（行上有折叠菜单 `@contextmenu="openFoldMenu(...)"`，链接按钮必须掐泡）
   ⇒ 实现更强，判据过时。改 `:154-159`（跟上 `.stop` + 补钉行上折叠菜单仍在）。
5. `tests/debug-breakpoint-groups.test.mjs`（2 红 → 绿 20/20）(a) 两处「新建…」（逐条「所在组」/组节点
   「移至组」）已合成一个输入对话框 + 一个提交口（`openNewGroup({kind})`→`submitNewGroup()`），判据仍在
   数两处 `window.prompt`；改 `tests/debug-breakpoint-groups.test.mjs:250-277` 为「取消判据只许一处调用」
   「取消 return 早于任何写回」「两个 `NEW_GROUP` 分支 + 两条 select 各自 handler」+ 禁 `window.prompt`。
   (b) `BreakpointsDialog.vue` 缺上游引用；改 `src/components/BreakpointsDialog.vue:144-152` 补 `:547-549`
   与 `XBreakpointCustomGroupingRule.kt:24`，并写清三种输入=三种结果。
6. `tests/debug-watch-actions.test.mjs`（1 红 → 绿 7/7）根因：判据在面板找英文动作名，面板文案已中文，
   英文类名在规则层 `src/debugWatchActions.ts:1-14`。改 `:100-131`：上游名按规则层核，面板侧改钉四个按钮
   各自谓词 + 事件 + emit 声明（`canMoveWatchUp/Down`、`canRemoveAllWatches`、`canPauseWatch`）。
7. `tests/problem-code-grouping.test.mjs`（1 红 → 绿 13/13，**判据文件未动**）根因：真缺 —— 分组下拉没有
   带出处的 `title`。实现侧改 `src/components/ProblemsPanel.vue:559-566`（`<select>` 加 title，含
   `按诊断码（承接上游的 tool id）`+`ProblemsView.GroupByToolId`+`ActionsBundle.properties:2659`+`ui.xml:96-98`）；
   `<option value="code">` 逐字保留（`tests/problems-view.test.mjs:171` 钉着）。
8. `tests/source-citation-anchors.test.mjs`（1 红 → 绿 8/8）根因：10 条锚点 `moved` —— `BookmarkType.kt:24-45`
   搬到 `native/settings_project_schema.cpp:226`、Gradle 两条落到 `src/gradle.ts:33` 等；另有 5 条
   （`src/vcsLogDisplay.ts`）与 3 条（`src/settingsTreeMeta.ts`）退化成**裸文件名**（扫描器只收完整路径）。
   先按参考树逐条复核区间（`DateFormatUtil.java:130-168` 非空、`:138` 闸门、`:157` 61 分钟窗、
   `DateTimeFormatManager.java:25`=true、`UtilBundle.properties:2`=ChoiceFormat、`VcsLogDefaultColumn.kt:172-177`、
   `ExternalSystemExtensions.xml:24`=build.tools、`diff.impl.xml:78`=diff.base、`vcs.log.impl.xml:86`=vcs.log 全对上），
   再恢复完整路径（`src/vcsLogDisplay.ts:6,8,20,33-34`；`src/settingsTreeMeta.ts:158-159,165-166,169`），
   最后走唯一写盘口重算：`TAOCODE_CITATION_ANCHORS=update node --test tests/source-citation-anchors.test.mjs`
   ⇒ 锚点 **4443 → 4841 条**（覆盖面升高，不是删判据），`未入快照 0 条`。
9. `tests/code-lens-grouping.test.mjs`（1 红 → **别 lane 修绿** 21/21）开工时是红的；动手前复读发现
   `src/components/CodeVisionSettingsPage.vue:58-69,105-109` 已被 `verdict-editor-reds` 补上 `GROUP_HINTS` +
   `aria-describedby` + `cv-group-<id>-hint` ⇒ 本 lane **没改该文件**，只反向验证（hint id 换前缀 ⇒ fail=1，已恢复）。

## 门禁读数（实跑）

```
9 文件：action-registry 8/0 · keymap-bindings 15/0 · jar-run 17/0 · console-hyperlinks 12/0 ·
debug-breakpoint-groups 20/0 · debug-watch-actions 7/0 · problem-code-grouping 13/0 ·
source-citation-anchors 8/0 · code-lens-grouping 21/0          （node --test，ℹ pass/ℹ fail）
node --test tests/module-size.test.mjs ⇒ 5/0 ； 顺手 tests/verdict-generated.test.mjs ⇒ 5/0（未碰判决表）
npx vue-tsc --noEmit ⇒ 3 错，全在别人名下、与本 lane 无关：src/agentModelToolSchema.ts(37,39)(44,5)
（未跟踪新文件）+ src/runInstances.ts(567,13)（`stopping` 不存在）；我改过的 5 个源文件 0 错。
```
## 反向验证（破坏 ⇒ 红 ⇒ 恢复后字节一致）
```
keymap-bindings: boundAt 181 → fail=1 ✔ | debug-breakpoint-groups: 删 :547-549 → fail=1 ✔
problem-code-grouping: 删 title 出处 → fail=1 ✔ | source-citation-anchors: 退回裸名 → fail=1 ✔
debug-watch-actions: 上移改接全清谓词 → fail=1 ✔ | console-hyperlinks: 摘 .stop → fail=1 ✔
code-lens-grouping: hint id 换前缀 → fail=1 ✔ | 全部「恢复一致=true」
keymap 分派基准（非破坏性，src/keymap.ts 属 pf-actions）：不命中 effectiveKeyBindings() / KEY_BINDINGS /
effectiveKeyBindings(currentOverrides()) 三种回归形
```

## 交线清单（协调代理）

- 本轮无需接线：只改判据与各 lane 自有模块，禁改文件 0 触碰。上面 3 条 vue-tsc 错归
  `ui-reason`（`src/agentModelToolSchema.ts`）与 `src/runInstances.ts` 的 owner。反向验证临时改过一处的
  `src/components/DebugWatchesPane.vue`（dbg-all 名下，现带其新加的 `title`）已按字节恢复，复跑 7/7 绿。
- `docs/inventory/citation-anchors.json` 由本 lane **用生成器重算**（该文件 meta 明写「由 update 档生成，
  勿手改」，红判据 README 只给这一条出路）——若要统一收口生成物改动，请复核这次重算。
- `src/settingsTreeMeta.ts` 我加的 3 处行号注释与 `verdict-editor-reds`/`vc-nav` 的面有交叉，若并发改了同名文件以逐行 diff 为准。

## 仍缺什么（如实）

- 重算后有 1 条**区间为空**锚点：`docs/batch-2026-10-06-edact3.md` 引 `PauseOutputAction.java:19-19`（参考树该行是空行）；
  只报数不拦，属别人文档，未改。
- `DateTimeFormatConfigurable.kt:82-84` 仅以裸文件名出现在 `src/vcsLogPresentation.ts:22`（文档侧有完整路径锚点兜着），未动该文件。
- 重算把其他 lane 在飞的引用一并收录（净增 398 条）：他们再改区间时锚点门控会按 `moved` 正常报红，是该门控的设计循环。
