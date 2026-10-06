# 接线请求 2026-10-06 · diffview 域（`unified` 哑 prop → 复制补丁出口）

批次报告：`docs/batch-2026-10-06-diffview.md`。
**本批没有任何需要改 `src/App.vue` 的线**（取证见文末 §C），只有下面两条注释修正，落点文件不在本批可改面。

---

## R1 —— `src/changesMenuActions.ts:18-19`：过期的「补丁导出还没做」

- 目标文件：`src/changesMenuActions.ts`
- 目标行号：**18-19**（文件头那段"本仓只列真有的动作"清单里的第三条）
- 现状（逐字）：

  ```
  //   · `CreatePatch` / `CreatePatchToClipboard`：补丁导出还没做（`src/diffText.ts` 有 unified 文本，
  //     但"整批变更 → 补丁文件/剪贴板"这条链没有）；
  ```

- 为什么是过期：同一个文件 **23-25 行**自己就写了那两条已落（`patch` / `patchClipboard`），
  实现也在仓里：`src/patchExport.ts:37-46`（`createPatchFile`，落 `.patch`）与 `src/patchExport.ts:49-56`
  （`copyPatchToClipboard`，进剪贴板），入口 `src/components/SourceControl.vue` 的 `case 'patch'` / `case 'patchClipboard'`
  （判据 `tests/patch-export.test.mjs:56-61` 钉着这两行）。18-19 与 23-25 自相矛盾。
- 可照抄的整段替换（只换那两行，别的不许动）：

  ```
  //   · `CreatePatch` / `CreatePatchToClipboard`：已落（`src/patchExport.ts` 的两条动作 + `git.patch` 通道）；
  //     差异查看器里的那一支另见 `src/components/DiffView.vue` 的「作为补丁复制到剪贴板」；
  ```

- 不需要新增 import（改的是注释）。
- 上游依据（已亲自打开）：
  - `platform/vcs-impl/resources/META-INF/VcsActions.xml:212-214` —— `ChangesView.CreatePatch`（`:212`）与
    `ChangesView.CreatePatchToClipboard`（`:213-214`，class 是 `CreatePatchFromChangesAction$Clipboard`）；
  - `platform/platform-resources-en/src/messages/ActionsBundle.properties:1564`（`Create Patch from Local Changes…`）
    与 `:1583`（`Copy as Patch to Clipboard`）；
  - `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/actions/diff/DiffViewerCreatePatchActionProvider.java:55-59`
    —— 同一个动作在**差异查看器**里的那一支（本批的落点依据）。

## R2 —— `src/changesMenuActions.ts:23-25`：过期的「未跟踪的文件不在补丁里」

- 目标文件：`src/changesMenuActions.ts`
- 目标行号：**23-25**
- 现状（逐字）：

  ```
  //   · 补丁那两条本批（第一百一十四批）已落：`patch` = `git diff HEAD`（暂存 + 未暂存一起）落成 `.patch` 文件，
  //     `patchClipboard` = 同一份文本进剪贴板。**未跟踪的文件不在补丁里**（git 的 diff 不认它们，
  //     上游 `CreatePatchFromChangesAction` 会把它们当新文件加进去）—— 如实记作缺口；
  ```

- 为什么是过期：`src/patchExport.ts:31-34` 的 `localPatchText` 现在请求的是
  `git.patch` + `{ includeUntracked: true }`（`:10-12` 的模块头也写明未跟踪的文件按"新文件"接进补丁），
  判据 `tests/patch-export.test.mjs:24-31` 钉的就是这条形状，`:33-38` 还禁止模块头再出现「不在补丁里」那种写法 ——
  只有 `changesMenuActions.ts` 这行注释漏改。
- 可照抄的整段替换（三行换三行）：

  ```
  //   · 补丁那两条（第一百一十四批）已落：`patch` = `git.patch`（`git diff HEAD`，暂存 + 未暂存一起，
  //     再把未跟踪的文件按"新文件"接上，见 `src/patchExport.ts:10-12`）落成 `.patch` 文件，
  //     `patchClipboard` = 同一份文本进剪贴板 —— 与上游把未跟踪文件当新文件加进去同义；
  ```

- 不需要新增 import。
- 上游依据：`platform/vcs-impl/src/com/intellij/openapi/vcs/changes/actions/CreatePatchFromChangesAction.java:95-100`
  （`unversioned` 那些路径被逐条 `new Change(null, new CurrentContentRevision(path))` 加进 `allChanges`）。

---

## C —— 为什么本批**不需要**改 `src/App.vue`（留给主代理的取证，免得重复核）

1. `DiffView.vue:41` 的签名里 `unified: string` 本来就是**必填**，六个调用方逐个都传了真值：
   `src/App.vue:2355`（`conflictDiff.unified`）、`src/App.vue:2376`（`clipboardDiff.unified`）、
   `src/components/DebugClipboardCompare.vue:47`、`src/components/HistoryPanel.vue:253`、
   `src/components/SourceControl.vue:776`、`src/components/VcsLogDiff.vue:34` ⇒ 不需要新 prop、不需要改传参。
2. 新增的消费者（`patchText` / `canCopyPatch` / `copyPatch` + 模板按钮）全在组件内部，
   剪贴板出口取的是组件自持的 `src/clipboard.ts:35`（`copyToClipboard`），不经过宿主通道 ⇒ 不需要 ctx 注入。
3. 唯一"想要但需要改 App.vue"的是上游那句气泡通知
   （`platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/CreatePatchCommitExecutor.java:353-354`
   的 `VcsNotifier.notifySuccess(patch.copied.to.clipboard)`）：那要给 `DiffView` 加 `notify` prop 并改
   `src/App.vue:2355/:2376` 两处传参。本批**没提这条请求**，理由是收益只是一句提示换个位置，
   而代价是占用唯一那个 App.vue 代理的窗口；组件里已经用 `role="status"` 的实时提示替代（`DiffView.vue:420`），
   文案照上游 `platform/vcs-api/vcs-api-core/resources/messages/VcsBundle.properties:447`
   （`patch.copied.to.clipboard=Patch copied to clipboard`，本地树无中文包 ⇒ 英文原文直译）。
   主代理若要统一成全局通知，再单开一批。
