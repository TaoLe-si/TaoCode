# 接线请求 · 2026-10-06 · vcs2 路（VCS / 提交 / 日志面）

**本文件是上一路 vcs 代理（代号 `vcs`）那份从未落盘的 `docs/wiring-requests-2026-10-06-vcs.md` 的替代**：
它被切断时报告与请求文档都没写出来，但代码注释里已经引了两处（`src/commitChecksResult.ts:95`、
`src/components/SourceControl.vue:77`，原写 `...-vcs.md` W1/W2）。本批把这两处注释改指到这里并留痕，
W1/W2 的编号沿用它的说法，内容补齐成"可直接照抄"的粒度。

配套报告：`docs/batch-2026-10-06-vcs2.md`。

| 编号 | 目标文件（全部是**保留文件 / 他人面**） | 目标行号 | 状态 |
|---|---|---|---|
| W1 | `native/main.cpp` | 1169-1175 | 模块侧已就绪，只差这一处传参 |
| W1b | `src/App.vue` + 新组件 | 见下 | 用户入口（可延后，不接也不会出假控件） |
| W2 | `src/App.vue` → `src/toolViewContext.ts` → `src/components/ToolWindowView.vue` | 498/853/2123 · 87/114 · 37/173 | 模块侧已就绪，只差三段透传 |
| W3 | `src/settingsModel.ts`（或 `tests/inlay-hints-settings.test.mjs`） | 223 / 48 | **现网 2 红之一**，不在 vcs 面 |
| W4 | 他人名下四份文档 | 见下 | **现网 2 红之二**（引用门），已核实真路径 |

---

## W1 `git.commit` 把 `paths` 交回 native（`native/main.cpp:1169-1175`）

**已经就绪的部分**（本域，无需再动）：
- 原生函数已经有这个形参并带默认值：`native/git.hpp:62-65`
  （`commit(repo, message, amend, signoff, author_name, author_email, paths = {})`），
  实现与校验在 `native/git.cpp:448-483`：`paths.size() > 500` ⇒ `INVALID_REQUEST`、
  每个路径过 `checked_path`、未跟踪的被选项先 `git add -- <path>`、非空时加 `--only` 并把 pathspec 放在 `--` 之后。
  ctest 覆盖：`native/git_test.cpp:310-334`（只提交被选文件 / 未跟踪被选项 / 非法路径被挡）。
- 前端请求形状：`src/commitChecks.ts:392-431` 的 `commitRequestParams()`（空 ⇒ **连 `paths` 这个键都不发**），
  面板唯一的 `git.commit` 调用点在 `src/components/SourceControl.vue:333-340`。
- 判据测试：`tests/commit-checks.test.mjs:168-224`（本批新增 5 条，含"空 ⇒ 请求体逐字不变"与"上限与 native 同数"）。

**只差这一处**：宿主 `case "git.commit"_h` 没有把 `params` 里的 `paths` 传下去 ⇒ 前端就算发了这个键，
native 也只会按整份暂存区提交。**当前源码**（`native/main.cpp:1169-1175`）：

```cpp
            case "git.commit"_h: {
                taocode::git::commit(fs::path(wide(require_repo_root())), params.value("message", std::string()),
                                     params.value("amend", false), params.value("signoff", false),
                                     params.value("author", std::string()), params.value("authorEmail", std::string()));
                result = {{"ok", true}};
                break;
            }
```

**整段替换为**（多一个实参，取法与本文件 `git.applyHunks` 那一档 `params.at("hunks").get<std::vector<int>>()`
（`native/main.cpp:1232-1237`）同一个 nlohmann 习惯；缺键 ⇒ 空 vector ⇒ 与今天逐字同一条命令行）：

```cpp
            case "git.commit"_h: {
                // 「提交文件…」（CommonCheckinFilesAction.kt:26-78 → CheckinActionUtil.kt:100-160 的 pathsToCommit）：
                // 非空 = 只有这些路径进这次提交（git commit --only -- <paths>）。缺这个键就是整份暂存区。
                taocode::git::commit(fs::path(wide(require_repo_root())), params.value("message", std::string()),
                                     params.value("amend", false), params.value("signoff", false),
                                     params.value("author", std::string()), params.value("authorEmail", std::string()),
                                     params.value("paths", std::vector<std::string>()));
                result = {{"ok", true}};
                break;
            }
```

`"git.commit"` 已在方法白名单里（`native/main.cpp:1526`），**不需要**改那一份清单。
上游依据：`platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:26-78`
（把选中的路径交给 `pathsToCommit`）+ 同目录 `CheckinActionUtil.kt:100-160`（集合语义：并重复、只让这一批进提交）。
不接的后果：R1 这条通道只能到请求体为止，界面上也就**不会有**「提交文件…」那一行（不放假控件）。

## W1b 「提交文件…」的用户入口（`src/App.vue` + 一个新组件）

上游这一族不是面板上的复选框，而是一个**带勾选的变更清单弹层**：
`CommonCheckinFilesAction.kt:37-45`（`actionPerformed` 取 `VcsContextUtil.selectedFilePaths` →
`CheckinActionUtil.getInitiallySelectedChangeListFor`），本仓的等价物 = 一个"列出本仓全部变更、勾中的那些
成为 `commitPaths`"的弹层，选中结果经 W2 那条同样的 ctx 链交给 `SourceControl.vue:339` 的 `paths`。

**为什么写在这里而不是直接做掉**：新建组件文件不在本派单的可改面内（本批只允许
`src/components/{SourceControl,VcsLog*,BranchPopup}.vue`），且入口行要落在 `src/App.vue`（独占文件）。
建议落点：新 `src/components/CommitFilesDialog.vue` + `src/App.vue` 的一个 `openCommitFilesDialog()`，
勾中的路径写进一个 `commitPaths = ref<string[]>([])`，随 ctx 传下去；`SourceControl.vue` 那一侧一个字都不用改。
上游文案：动作标题 = `<动作名>…`（`CommonCheckinFilesAction.kt:31` 的 `Manager.getActionName(...) + ELLIPSIS`），
中文包那一份本仓已有等价串在 `src/commitPanelStrings.ts` / `commitChecks.ts` 的 `COMMIT_ACTION_TEXT`（提交），
**不要在弹层里另编一套文案**。

---

## W2 文档修订计数 `editorEpoch`（三段透传）

**已经就绪的部分**（本域）：
- 指纹的第三档：`src/commitChecksResult.ts:97-105` —— `editorEpoch === null` 时形状与本批之前**逐字一致**，
  给了就在末尾加 `@<修订号>`。
- 检查宿主：`src/sourceControlCommitChecks.ts:64`（`editorEpoch?: () => number`）与
  `:114`（`watch(() => commitChecksFingerprint(changes.value, dirtyPaths(), editorEpoch ? editorEpoch() : null), ...)`）。
- 面板 prop 与 deps：`src/components/SourceControl.vue:85`（可选 prop）、`:463`（没给就整个键都不进 deps）。
- 判据测试：`tests/commit-checks-result.test.mjs:82-121`（修订号变⇒指纹变、没编辑⇒不变、`null`⇒旧形状）
  与同文件"接线：宿主的修订号只在真的给了才进 deps"。

**上游依据**：`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:216-225` ——
`lastCommitChecks` 的作废由两个 listener 驱动，第二个是 `DocumentListener.documentChanged`
（"内容又变了"，与"哪些文件脏了"是两件事）。本仓现在只有 `dirtyPaths`（快照）⇒ 同一个文件第二次键入
清单不变 ⇒ 上一次的 PASSED 永远不作废，按钮还写着「仍然提交」。

**要接的三段**（都是保留文件 / 他人面）：

1. `src/App.vue`：计数器 + 挂到已有的编辑器 change 通道。
   在 `:498`（`const historyEpoch = ref(0)`）旁加：

   ```ts
   // 编辑器内容的修订计数（上游 DocumentListener.documentChanged，NonModalCommitWorkflowHandler.kt:216-225）：
   // 每敲一次都变 ⇒ 提交前检查的"上次结果"随之作废。本仓的 dirtyPaths 只是"哪些标签是脏的"的快照，
   // 覆盖不了第二次键入，所以另开这一档计数（接线请求 vcs2 W2）。
   const editorEpoch = ref(0)
   const bumpEditorEpoch = (tab: Tab) => { editorEpoch.value++; onEditorChange(tab) }
   ```

   `:2123` 那一行的事件由 `@change="onEditorChange(tab)"` 改成 `@change="bumpEditorEpoch(tab)"`
   （`onEditorChange` 仍照常收到 tab，`src/lspNavigation.ts:230` 那条链一个字不动）。
   `:853` 的 ctx 注入里，在 `historyEpoch,` 旁边加 `editorEpoch,`。

2. `src/toolViewContext.ts`：`:34` 的 `historyEpoch: any` 旁加 `editorEpoch: any`，
   `:87` 的解构里加 `editorEpoch`，`:114` 的 `historyEpoch: historyEpoch.value,` 旁加
   `editorEpoch: editorEpoch.value,`。

3. `src/components/ToolWindowView.vue`：`ToolWindowViewContext` 里 `historyEpoch: number`（`:37`）旁加
   `editorEpoch?: number`，并把 `:173` 那一行的 `<SourceControl ... />` 补一个
   `:editor-epoch="ctx.editorEpoch"`。

`SourceControl.vue` 那一侧已经写好了"没给就逐字旧行为"，所以这三段可以一起接、也可以只接第 1 段先试。

---

## W3 现网红（**不在 vcs 面**）：`三格是真设置：模型 + native 键表/默认值 + 预览白名单都登记`

派单让我"先分清是你面还是 `settingsModel.ts`"。**核实结果（原写 X、实际 Y）**：

- 这条红**不在** `tests/commit-checks*.test.mjs` / `tests/source-control*.test.mjs` 里 —— 后一个通配符在本仓
  **没有匹配文件**（`ls tests | grep source-control` 只命中 `source-citations*`）；前一个通配符的 4 个文件
  本域跑下来 **44/44 全绿**。同名断言的真实出处是
  **`tests/inlay-hints-settings.test.mjs:45`**（`tests/setkeys-batch.test.mjs` 里还有一条同名测试，绿的）。
- 五处登记点**全都已经在位**（逐条打开核过）：`src/settingsModel.ts:399`（类型三键）、
  `native/settings_schema.hpp:87`（键表白名单）、`native/settings_schema.cpp:331`（默认值三真）、
  `src/previewSettings.ts:24`（预览白名单）、界面 `src/components/InlayHintsSettingsPage.vue` + 设置树。
- 红的唯一原因：`tests/inlay-hints-settings.test.mjs:48` 把默认值钉成
  `/showTypeInlayHints: true, showParameterInlayHints: true, showOtherInlayHints: true \}/` ——
  要求这三键**必须是 `defaultEditorSettings` 对象的最后三项**。`src/settingsModel.ts:223` 里这三键是
  `true, true, true`（值对），但它们后面又被追加了
  `stripTrailingSpaces / ensureNewLineAtEof / keepTrailingSpacesOnCaretLine / autoInsertPairQuote /
  closeCommentOnEnter / insertBraceOnEnter / codeVision* / showQuickDocOnMouseHover / autoUpdateDocumentation`
  （保存键批 + 回车键批 + Code Vision 批），于是 `true \}` 这个形状再也匹配不到 ⇒ 断言"钉错了形状"。

**要谁改**：`src/settingsModel.ts` 是保留文件、`tests/inlay-hints-settings.test.mjs` 是内联提示域（桶 3）的文件，
**两者都不在 vcs2 的可改面**，所以本批一个字没动它们。两条可选做法，请主代理选一条：

1. **改测试的形状（推荐）**：`tests/inlay-hints-settings.test.mjs:48` 那条 `assert.match` 的
   `/…showOtherInlayHints: true \}/` 去掉结尾的 ` \}`，保留"三键默认全开"这条语义。
   理由（规约 §3 要求"证明它钉错了形状"）：断言的**注释自己写的意图**是
   `'默认必须全开（同上游 isEnabled 出厂为真）'`，` \}` 那段与该意图无关，只是把"这三键恰好是对象末尾三项"
   这一实现顺序钉死了；而 `defaultEditorSettings` 的字面量顺序在本仓一直是"新键追加在末尾"的约定
   （`src/settingsModel.ts:223` 的历史：`stripTrailingSpaces` 等四批都是这么加进去的）。
   上游依据不变：`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:76`
   （**2026-10-06 citefix 订正**：原写 `platform/editor-ui-api/src/com/intellij/openapi/editor/settings/…:76` 参考树里没有该路径 ——
   该文件真身在 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/`，1270 行；第 76 行逐字为
   `public boolean SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true;`，行号与「快速文档默认开」这条论断都对得上）
   （快速文档默认）与 `CodeVisionSettings.kt:50`、内联提示 provider 的 `isEnabled` 出厂为真。
2. 或者反过来：把 `src/settingsModel.ts:223` 里那三键挪到字面量末尾 —— 值不变，但每次有人追加新键都会再红一次，
   所以不推荐。

**vcs 面能改的**：无。这条红的五个判据对象没有一个落在 `src/vcs*.ts` / `src/commit*.ts` /
`src/changes*.ts` / `src/components/{SourceControl,VcsLog*,BranchPopup}.vue` / `native/git*.*` 上。

## W4 现网红（**不在 vcs 面**）：引用门里四条假路径（他人名下文档）

`node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` 现在是
**11 条里 9 绿 2 红**，两条红同一个原因：文档里写了参考树中不存在的包路径。
本批新写的每条 `路径:行号` 都过了这条门（红的清单里没有 vcs2 的文件）。已核实真路径：

| 文档 | 里面写的（不存在） | 参考树里的真路径（已开文件核对） |
|---|---|---|
| `docs/batch-2026-10-06-completion2.md`、`docs/batch-2026-10-06-refactor.md`、`docs/batch-2026-10-06-welcome2.md`、`docs/wiring-requests-2026-10-06-completion.md` | `platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19` | `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19`（98 行文件；`:19` 正是 `public abstract class SuppressIntentionAction implements Iconable, IntentionAction {`） |
| `docs/batch-2026-10-06-refactor.md` | `platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java :49-50` | `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49-50`（186 行文件；`:49-50` 正是 `AUTOSCROLL_MODE` / `AUTOSCROLL_FROM_SOURCE`） |

即：**只是包名少了一层**（`codeInsight`→`codeInspection`、`structureView`→`structureView.impl`），
行号与内容都是对的。这四份文档归 completion / refactor / welcome 三路，本批没改它们。

> **2026-10-06 citefix 追记**：上表「里面写的（不存在）」那一列**在 `.java` 与行号之间留了一个空格** ——
> 引用门（`tests/source-citations.test.mjs`）会把文档里**转述**的「路径:行号」也按一条真引用收集，
> 原样抄假坐标等于自己再造一条红（规约 §5 同一条）。去掉那个空格就是门禁原文，其余一字未动。
> 本表点名的四份文档与 `docs/batch-2026-10-06-projecttree.md`、`…status2.md`、`…status2defect.md`、
> 以及本文件里那条 `EditorSettingsExternalizable` 的假路径，都已由 citefix 一轮按真源码订正并复跑双门，
> 逐条「原文 → 新文 → 打开过的那一行」见 `docs/batch-2026-10-06-citefix.md`。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1（`git.commit` `paths`）已接线**：`native/main.cpp:1169-1175` 已透传。
- **W1b（「提交文件…」入口）** —— 需新组件 `src/components/CommitFilesDialog.vue`（本 lane 可建）+ App.vue 挂载。复核该组件**不存在**。因 `commitPaths` 的 ctx 链末端在 `SourceControl.vue`（VCS lane 独占），本 lane 未单方面建组件（建了无挂载链 = 零消费）。登记为「需 VCS lane 与 App.vue 同批」。
- **W2（`editorEpoch`）** —— 已被 `src/documentRevisions.ts` 的按篇号取代（见 commit2 C3）。

结论：W1 已接线；W1b 转 VCS lane，W2 由更优形状闭环。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「W1 已接线；W1b 转 VCS lane，W2 由更优形状闭环。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
