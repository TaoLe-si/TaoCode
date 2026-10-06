# 接线请求 · 2026-10-06 · commit2 路（提交参数模型 / 提交前检查指纹）

本路的可改面是**模块侧**（`src/commitCheck.ts`、`src/commitChecks.ts`、`src/commitChecksResult.ts`、
`src/sourceControlCommitChecks.ts` + 各自判据测试）。下面三段都在**保留文件 / 他人面**里，一律只写请求、没有改动。
配套报告：`docs/batch-2026-10-06-commit2.md`。

| 编号 | 目标文件（保留 / 他人面） | 目标行号 | 模块侧状态 |
|---|---|---|---|
| C1 | `native/main.cpp` | 1169-1175 | 原生函数与校验都在位，只差这一处透传（与 vcs2 W1 同一条，本批重新核对过坐标） |
| C2 | `src/components/SourceControl.vue` | 88 / 336-343 / 461-467 | 三个新入参都做成可选，面板不传 = 本批之前的形状逐字一致 |
| C3 | `src/App.vue` + `src/toolViewContext.ts` + `src/components/ToolWindowView.vue` | 511、866、2147 / 34、87、114 / 37、173 | 文档修订号的宿主来源 |

**上游基准**（全部亲自打开过；相对 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
- `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:37-53`（`actionPerformed`
  把选中的路径交给 `pathsToCommit`）、同文件 `:74-78`（`isActionEnabled`：`status != NOT_CHANGED`（目录除外）
  **且** `status != IGNORED` —— 被忽略的文件根本不启用这个动作）。
- `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CheckinActionUtil.kt:104-106`（选中变更与
  **未版本管理文件**各取一份，再过 `DescindingFilesFilter`）、`:135-136`（`setCommitState(initialChangeList, included, …)`
  = 这一批成为唯一的提交范围）、`:159-167`（`getIncludedChanges()`：没有选中项时按 `pathsToCommit` 过滤全部变更；
  有选中项时把 `selectedUnversioned` 一并 `concat` 进去 ⇒ **未跟踪的被选项是纳入，不是拒绝**）。
- `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/DescindingFilesFilter.java:27-40`（后代路径只在
  `!vcs.allowsNestedRoots()` 时才并掉）+ `plugins/git4idea/backend/src/GitVcs.java:260-263`（git 答 **true**）
  ⇒ 对 git 仓库**一个路径都不并**。本仓只接 git，模块侧因此不做祖先折叠（vcs2 那批注释里把它当"集合语义"，实际不是 —— 已留痕）。
- `platform/vcs-impl/src/com/intellij/vcs/commit/AbstractCommitWorkflowHandler.kt:82`
  （`isCommitEmpty() = getIncludedChanges().isEmpty() && getIncludedUnversionedFiles().isEmpty()`）
  \+ `NonModalCommitWorkflowHandler.kt:177-185`（`checkCommit` 把它落到 `isEmptyChanges`）。
- `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:191-200`
  （`areFilesAffectsCommitChecksResult`：在 VCS 下 + 在内容里 + `!= FileStatus.IGNORED`）、
  `:202-213`（VFS 那一个 listener）、`:215-226`（文档那一个 listener：`addDocumentListener` / `documentChanged`，
  两个 listener 都在 `== UNKNOWN` 时早退）。
- `platform/core-api/src/com/intellij/openapi/editor/Document.java:25`（"Document is also a `ModificationTracker`
  whose stamp is incremented whenever the content changes"）与 `:184-192`（`getModificationStamp()`：
  "value changed by any modification of the content of the file… **not** related to the file modification time"）；
  换号的动作在 `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171`
  （每次文本替换领一个 `DocumentModStamp.next()`），该类见
  `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentModStamp.java:6-12`。
- 号当缓存键的写法先例：`java/execution/impl/src/com/intellij/execution/filters/ExceptionLineParserImpl.java:318-320`
  （取一次 `document.getModificationStamp()`，`expireWhen(… != stamp)`）。

---

## C1 `native/main.cpp:1169-1175` —— `git.commit` 把 `paths` 交回原生（R1 唯一缺的一环）

**已在位、无需再动**（本域 / vcs2 那批，全部重新打开核对）：
- `native/git.hpp:62-65`：`commit(repo, message, amend, signoff, author_name, author_email, paths = {})`
  —— `paths` 是带默认值的尾参，既有六参调用点一个字都不用改；
- `native/git.cpp:448-483`：`paths.size() > 500` ⇒ `INVALID_REQUEST`（`:461`）、每条过 `checked_path`（`:464`，
  闸门本体 `:259-265`）、非空先 `git add -- <被选路径>`（`:465-469`，未跟踪的才进得了 pathspec）、
  再加 `--only` 并把 pathspec 放在 `--` 之后（`:472`、`:481`）；
- `native/main.cpp:1506-1510`：`paths` 给的若是**非字符串数组**，`Json::exception` 已经被兜成
  `INVALID_REQUEST` ⇒ **原生侧不需要新增校验**，只差透传。

**当前源码**（`native/main.cpp:1169-1175`，2026-10-06 本批核对）：

```cpp
            case "git.commit"_h: {
                taocode::git::commit(fs::path(wide(require_repo_root())), params.value("message", std::string()),
                                     params.value("amend", false), params.value("signoff", false),
                                     params.value("author", std::string()), params.value("authorEmail", std::string()));
                result = {{"ok", true}};
                break;
            }
```

**整段替换为**：

```cpp
            case "git.commit"_h: {
                // 「提交文件…」（CommonCheckinFilesAction.kt:37-53 → CheckinActionUtil.kt:104-106、:135-136）：
                // 非空 = 只有这些路径进这次提交（git commit --only -- <paths>）；缺这个键就是整份暂存区。
                taocode::git::commit(fs::path(wide(require_repo_root())), params.value("message", std::string()),
                                     params.value("amend", false), params.value("signoff", false),
                                     params.value("author", std::string()), params.value("authorEmail", std::string()),
                                     params.value("paths", std::vector<std::string>()));
                result = {{"ok", true}};
                break;
            }
```

`"git.commit"` 已在 git 方法白名单里（`native/main.cpp:1526` 一带的 `is_git_method`），不用改清单。
不接的后果：前端 `commitRequestParams` 发得出 `paths`，宿主吃掉 ⇒ 界面选了子集也照样整份提交（用户可见行为错）。

## C2 `src/components/SourceControl.vue` —— 三个新入参（都可选）

1. **范围校验要吃变更列表**（`commitRequestParams` 新增的 `changes`，规则见 `src/commitChecks.ts:425-504`）。
   `:336-343` 当前：

   ```ts
       await request('git.commit', commitRequestParams({
         message: text, amend: amend.value, signoff: signoff.value,
         // An override only rides this commit; native refuses it without an e-mail
         // (git commit --author needs "Name <email>").
         author: authorOverride.value?.name ?? '', authorEmail: authorOverride.value?.email ?? '',
         // 「提交文件…」的范围（宿主没给 = 不带这个键，请求体与历史逐字一致）。
         paths: props.commitPaths,
       }))
   ```

   改为（只多一行，`changes` 是面板里已有的 computed）：

   ```ts
       await request('git.commit', commitRequestParams({
         message: text, amend: amend.value, signoff: signoff.value,
         // An override only rides this commit; native refuses it without an e-mail
         // (git commit --author needs "Name <email>").
         author: authorOverride.value?.name ?? '', authorEmail: authorOverride.value?.email ?? '',
         // 「提交文件…」的范围（宿主没给 = 不带这个键，请求体与历史逐字一致）。
         paths: props.commitPaths,
         // 被忽略的 / 对不上变更的被选项在这里就拒掉（CommonCheckinFilesAction.kt:74-78）。
         changes: changes.value,
       }))
   ```

2. **提交范围进空判 + 文档修订号进指纹**：`:461-467` 当前结尾是

   ```ts
     ...(props.editorEpoch === undefined ? {} : { editorEpoch: () => props.editorEpoch ?? 0 }),
   })
   ```

   在其**后**加两行（`commitScope` / `documentRevisions` 都做成"没给就整个键都不进 deps"，与 `editorEpoch` 同一条规矩）：

   ```ts
     ...(props.commitPaths === undefined || props.commitPaths.length === 0 ? {} : { commitScope: () => props.commitPaths ?? [] }),
     ...(props.documentRevisions === undefined ? {} : { documentRevisions: () => Object.entries(props.documentRevisions)
       .map(([path, revision]) => ({ path, revision })) }),
   ```

   并在 `:88`（`editorEpoch?: number`）之后、`:89` 的 `}>()` 之前加这个 prop：

   ```ts
     /**
      * 每篇文档各自的**修订号**（上游 `Document.getModificationStamp()`，`Document.java:184-192`）：
      * 宿主每收到一次编辑器 change 就给那一篇换一个新号，没编辑的文档号不动。
      * 没接 = 指纹里没有修订段（与 C3 之前逐字一致）。接线请求：本文件 `wiring-requests-2026-10-06-commit2.md` C3。
      */
     documentRevisions?: Record<string, number>
   ```

   `commitScope` 的判据（`includedCount`）与 `documentRevisions` 的判据都已在本域测试里钉住；
   面板不传时 `src/sourceControlCommitChecks.ts` 交给指纹的是 `[]`、交给空判的是 `null` ⇒ 行为不变。

## C3 宿主链：`documentRevisions`（文档修订号）三段透传

vcs2 W2 要的是**一个全局计数**（`editorEpoch`）；R2 这一批改问的是**每篇文档的号**——上游 `documentChanged`
每触发一次，那一篇 `Document` 的 stamp 就换一个（`DocumentImpl.java:171`），而"别的文档动了"不该作废
**这批**变更的检查结果（`NonModalCommitWorkflowHandler.kt:222` 先问的是这篇文件影不影响结果）。
`editorEpoch` 那一档保留（接了也不亏），但真正补上"同一篇改两次"漏判的是下面这一段。

1. `src/App.vue` —— 号的记账。在 `:511`（`const historyEpoch = ref(0)`）旁加：

   ```ts
   // 每篇文档的修订号（上游 Document.getModificationStamp()，Document.java:184-192 + DocumentImpl.java:171）：
   // 同一次编辑只给"被改的那一篇"换新号；号是全局单调的，但只写进这一篇 ⇒ 别的文档动了不影响这批变更的检查结果。
   const documentRevisions = ref<Record<string, number>>({})
   let documentRevisionSeq = 0
   const bumpDocumentRevision = (tab: Tab) => { documentRevisionSeq += 1; documentRevisions.value = { ...documentRevisions.value, [tab.path]: documentRevisionSeq } }
   ```

   `:2147` 编辑器那一条事件由 `@change="onEditorChange(tab)"` 改成
   `@change="bumpDocumentRevision(tab); onEditorChange(tab)"`（`onEditorChange` 收到的东西一个字不变）。
   `:866` 的 ctx 注入里，在 `historyEpoch,` 旁加 `documentRevisions,`。

2. `src/toolViewContext.ts`：`:34` 的 `historyEpoch: any` 旁加 `documentRevisions: any`；`:87` 的解构里加
   `documentRevisions`；`:114` 的 `historyEpoch: historyEpoch.value,` 旁加 `documentRevisions: documentRevisions.value,`。

3. `src/components/ToolWindowView.vue`：`:37` 的 `historyEpoch: number` 旁加 `documentRevisions?: Record<string, number>`；
   `:173` 那一行 `<SourceControl … />` 补一个 `:document-revisions="ctx.documentRevisions"`。

**为什么不能只接一半**：`documentRevisions` 是 C2 里那个可选 prop，不接就恒为 `undefined` ⇒ 模块里交 `[]`，
指纹形状与今天逐字相同（这是刻意的"没接不改行为"，不是假控件：界面上没有任何一行依赖它）。

---

## 备注：vcs2 W1 / W2 与本批的关系

- W1（`native/main.cpp` 透传 `paths`）＝本批 C1，坐标与内容复核后一致，主代理接一次即可，两条请求不是两件事。
- W2（`editorEpoch` 三段透传）与 C3 是同一处宿主事件的两种记法：**建议一次接成 C3 的按篇号**，
  再顺带 `editorEpoch.value++`（两档共存，模块侧指纹已经是"全局段在前、按篇段在后"的形状，互不遮挡）。
- W1b（「提交文件…」的用户入口 / 勾清单弹层）本批没有新增要求：C1 通了之后 `commitPaths` 才有意义，
  入口那一段仍按 vcs2 W1b 的建议落（新组件 + `src/App.vue`），不重复登记。
