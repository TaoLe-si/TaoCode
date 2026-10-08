# lane lp-editor（2026-10-08）· platform_rest 域 `lp/editor-actions` / `lp/inlay-hints` / `lp/code-vision`

## 接续了什么

上一条同名 lane 的盘上遗留**逐件核实后全部接下**（没有回退任何东西）：

- `src/editorTyping.ts`：已在 HEAD（`6d6d17f`），消费方齐（`src/components/CodeEditor.vue:25` 的 `smartQuotes`/`insertedText`、`src/enterHandlers.ts:98`、`src/lspCompletion.ts:27`），无半成品。
- `src/lspCompletion.ts`（+67 行）/`src/completionAutoPopup.ts`（当时未跟踪）/`tests/completion-auto-popup.test.mjs`/`tests/editor-typed-handler-faces.test.mjs`：接续时 13+10 条全绿、接线是真的（自动档入口逐档消费）；**订正一处真缺陷**（见下）。任务书点名的 `tests/editor-typing.test.mjs` **不存在**，对等物是 `tests/editor-typed-handler-faces.test.mjs`（10 条，TypedHandler 委托面）。
- 另一条 lane/协调者在本 lane 进行中提交了 `545eb6b`，把上一条 lane 的遗留（含我修的 `src/lspCompletion.ts:555`）扫进 HEAD；我的新判据仍在工作树（未提交）。

## 本批做的两件事

**A. 订正真缺陷（自动弹出链）**：`EmptyAutoPopup` 的记录原先**显式档也会写** —— 一次 Ctrl+Space 的空结果会把它后面自动档的第一下敲键吞掉（`emptyAutoPopupAllowsSkipping` 只看文档/光标，分不出来源）；上游 `CompletionProgressIndicator.isAutopopupCompletion()` 把这两档分开。落点 `src/lspCompletion.ts:546-556`（`:555` 是那一行）。共享类型/规则在 `src/completionAutoPopup.ts`（未改）。

**B. 收口 `lp/inlay-hints` 的「排除清单键没落盘」缺口（六处）**：`src/settingsModel.ts`（类型 + 默认 `[]`）、`native/settings_schema.hpp`（白名单）、`native/settings_schema.cpp`（`Json::array()`）、`native/settings_editor_keys.hpp`（形状校验：数组/≤32 条/非空/≤200 字节；**坏 glob 放行** —— 上游对坏模式静默作废）、`src/previewSettings.ts`（白名单 + 专属分支）、`src/components/InlayHintsSettingsPage.vue`（清单编辑格：坏行标出并禁用应用、清空、写回同名键）。`src/inlayHints.ts` 的登记状态注释按实况改写。

## 判据与条数

- 新增 1 条：`tests/completion-auto-popup.test.mjs`（**14** 条）——「显式档空结果不进 EmptyAutoPopup，随后自动档第一下敲键照常重查」。反向验证：把 `:555` 改回 `options.length === 0` ⇒ **13 pass / 1 fail**（该条真红），恢复后 14/14。
- 新增 4 条 + 改写 1 条：`tests/inlay-hints-settings.test.mjs`（**9** 条）——五处登记逐键比对、native 分支在布尔兜底之前且与预览同一对上限、预览取值校验、旧存档缺键不造值；改写的是「页面」那条：原文写「排除清单不该被渲染成控件」，本批它成了真控件 ⇒ 改为「真控件 + 上游那两层（按 provider 的清单树 / 逐 case 明细）仍不渲染」，覆盖面只增不减。
- 新增 1 条 native：`native/settings_editor_keys_test.cpp`（ctest `settings_editor_key_bounds`）。
- 反向验证第二轮：同时打断三处（native 白名单键名、native 校验分支键名、页面写回改成 `split('\n')`）⇒ `tests/inlay-hints-settings.test.mjs`+`tests/settings-keys-parity.test.mjs` 共 **6 条红**且红点可逐条归因；恢复后 34/34。

## 门禁读数（实测）

| 门禁 | 读数 |
|---|---|
| 任务书点名两文件 | `tests/inlay-hints.test.mjs`+`tests/code-lens-grouping.test.mjs` = **26/26 pass** |
| 本 lane 三族全批（inlay-* + code-lens-* + code-vision-* + 两个新文件 + lsp-completion） | **160/160 pass** |
| 设置相邻批（18 文件：settings-keys-parity/setkeys-batch/inlay-hints-settings 等） | **154/154 pass** |
| `tests/module-size.test.mjs` + `tests/no-parameter-properties.test.mjs` | **7/7 pass**（无上限被抬；我改的文件都在 900/1100 以内） |
| `tests/verdict-generated.test.mjs` | **5/5 pass** |
| `npx vue-tsc --noEmit` | **exit 0，输出 0 行** |
| native 本 lane 目标 | `cmake --build build --target settings_editor_keys_test` 成功；`ctest -R settings_editor_key_bounds` **Passed**；全量 ctest **42/42 passed**（104.8s） |
| 整树 `scripts/build-native-locked.bat` | **红（不是本 lane）**：`native/run_host.cpp(482)` 编译错，见接线清单 ① |

## 族档位变化

三族**都留在 `~`**（没有升档，`platform_rest` 计数不变：total=20574、[x]=167、[~]=5305、[ ]=0、[-]=15102）。判词各追加一段 `2026-10-08 lane lp-editor：…`（只动这三族族键）：`lp/editor-actions` 记自动弹出触发条件 + 那处订正 + 输入链/多光标粘贴复判无缺；`lp/inlay-hints` 记排除清单六处落盘接通；`lp/code-vision` 记无新增缺项（命令 48 条、code-vision 30 条判据全绿）。

## 仍缺什么（如实）

- `lp/editor-actions`：重构式对话框与批处理、on-save 队列其余三段、`FixDocCommentAction` 一族、Emacs 一族（**都不变**）。
- `lp/inlay-hints`：declarative hints 的 presentation 树（`HintsBuffer`/`InlayTreeSinkImpl` 一族）、Swing/Compose 渲染器与 `InlaySettingsPanel` 本体。排除清单那一项**本批闭合**，但 `TaoCode.exe` 未重链（见 ①），真机点按尚未实测。
- `lp/code-vision`：更多弹层、占位/僵尸条目与 daemon 缓存、遥测上报、`change.signature`/`vcs` provider、Swing 绘制层（**都不变**）。

## 接线清单（需要协调代理做）

① `native/run_host.cpp:482`：`Instance& target = *found->second;` → `Impl::Instance& target = *found->second;`（`Instance` 是 `Manager::Impl` 的嵌套类型，同文件 `:411`/`:441` 用的就是 `Impl::Instance`）。该文件 HEAD==工作树（无未提交改动）⇒ 是已提交的编译红，挡住整树 native 构建与 `TaoCode.exe` 重链；本 lane 的 native 改动只能在 ctest 二进制里验证（已过）。
② 无其他接线：本 lane 的改动都自带消费方（`src/components/CodeEditor.vue:223/920` 从同一份草稿读 toggles，未改冻结文件）。
