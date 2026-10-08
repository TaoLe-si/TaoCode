# 接线请求 · 桶 13c（提交 + 书签）· 2026-10-06

两栏都指到具体行；两条都不需要新组件、不改样式令牌。

## 接线请求（给主代理 / 桶 8）

- **R1 · 目标文件**：`native/main.cpp` 第 1169 行附近（`case "git.commit"_h:`）＋ 我名下的 `native/git.cpp` 第 438 行（`void commit(...)`）
  - **要接什么**：`git.commit` 增加一个可选入参 `paths`（字符串数组），native 侧拼成 `git commit --only -m <消息> -- <路径…>`（给了 `paths` 就走 `--only`，为空时与现在逐字一致）。我这半边（`commit()` 加形参 + 校验：路径非空、不含控制字符、走既有的 `checked_ref`/工作区根约束）可以照做，但**入参解析那 30 行在 `main.cpp`，不在我名下** ⇒ 请求同一次改。
  - **为什么需要**：这是「提交文件…」（选中文件右键 / Git 菜单里那条按选中项改名的动作）唯一的下游。没有它就只能做入口，属于假控件；本轮因此没落（见报告「做不到」第 1 条）。
  - **上游依据**：`platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:26-78`（动作名 = `VcsBundle` 的 `action.name.checkin.file` / `action.name.checkin.directory` ＋ `StringUtil.ELLIPSIS`，中文包 = 「提交文件…」/「提交3文件…」）、`platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CheckinActionUtil.kt:100-160`（`pathsToCommit` → `getIncludedChanges` → `workflowHandler.setCommitState(...)`）
  - 附带：native 改动要给 ctest（`.tools/nctest-all.bat`，先 `call vcvars64.bat`）＋ 用例建议打在系统临时目录 `git init` 的新仓库上，别碰本仓工作区。

- **R2 · 目标文件**：`src/toolViewContext.ts` 第 62 行附近（`dirtyPaths: () => string[]` 那一组编辑器侧通道）＋ 其宿主 `src/App.vue`（`dirtyPaths: () => allTabs.value.filter(tab => tab.dirty)` 那一条）
  - **要接什么**：一个**响应式**的文档修订计数（例如 `editorEpoch: () => number`，App 侧每次编辑器内容变化 / 保存就 `++`，`ToolWindowView.vue` 第 175 行已有的 `SourceControl` 绑定处再传一个 prop）。我这半边已经把它接进 reset 判据的入口（`src/sourceControlCommitChecks.ts:107` 的 `watch(() => commitChecksFingerprint(changes.value, dirtyPaths()), …)`），把第二个参数换成这个计数即可，纯逻辑不用动。
  - **为什么需要**：上游的第二个 reset 触发器是 `DocumentListener.documentChanged`（编辑器里一改动就把上次检查结果作废）。本仓面板现在只拿得到"未保存清单"这个**非响应式快照**：文件第一次被编辑会进清单（能作废），之后继续编辑清单不变 ⇒ 只覆盖一半（报告「做不到」第 2 条）。
  - **上游依据**：`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:216-225`（`addDocumentListener` → `areFilesAffectsCommitChecksResult` → `resetCommitChecksResult()`），配合 `:191-199`（只认在内容里、状态不是 IGNORED 的文件）

## 不需要接线的（说明一下，免得重复劳动）

- 本轮新增的 `commitAndPushLabel` / `commitButtonLabel` / `checksProgress` / `checksProgressShown` 全部走 `SourceControl.vue` 已有的 props 与既有的 `createCommitChecks` 依赖，**没有新 prop、没有新挂载点**。
- 书签族本轮零改动：剩余两条（`BookmarkBundle.messagePointer`、`BookmarksListener`）判词里就是"没有消费者 ⇒ 不造空壳"，接线也接不出用户可见的行为。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（`git.commit` 可选 `paths`）跳过** —— 目标 `native/main.cpp`（禁改）+ `native/git.cpp`（vcs 半区）。需 native/vcs owner 同批处理。
- **R2（编辑器修订计数 → reset 判据）已接线（形状升级）**：请求要的 `editorEpoch` 全局计数**已被更正确的实现取代** —— `src/documentRevisions.ts` 的每篇文档修订号账本，生产侧 `src/App.vue:74` / `src/diskSync.ts:15` / `src/editorFileOps.ts:20` 的 `bumpDocumentRevision` 已接，消费侧 `src/sourceControlCommitChecks.ts:150` 的 `commitChecksFingerprint(changes.value, dirtyPaths(), documentRevisions())` 已吃第三个参数。`editorEpoch` 被显式删除并留痕（`src/commitChecksResult.ts:148-163`、`src/sourceControlCommitChecks.ts:72/:149`）。整条链已通，**无需再接**。

结论：零待接（R2 由更优形状闭环），未改任何文件。
