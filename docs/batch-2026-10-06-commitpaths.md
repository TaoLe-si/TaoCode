# batch-2026-10-06 · lane `commitpaths`

范围（只做两件事的**模块侧**）：
- **R1** 部分提交（partial commit）的 `paths` 通道：用户只提交选中文件/目录时，路径集合必须传到宿主并被真实应用。
- **R2** 提交前检查结果的**缓存指纹**改用**文档修订号**（上游 `Document.modificationStamp`），不再拿墙钟/内容长度当依据。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一事实来源；`third_party/intellij-community` 为坏树，禁用）。
本地化 zh 包不在本地树 ⇒ 所有中文措辞标注「无法核实」（仅按英文原文直译）。

---

## 0. 开工实况（盘上已有多少）

**结论：这两条确实"已经落了一半以上"，而且落法与前两条 lane 的登记一致。** 开工先跑实况，再逐文件开，不重做已落的东西。

- 域测试基线（改前）：`node --test tests/commit*.test.mjs tests/source-control*.test.mjs tests/scope-persistence.test.mjs tests/module-size.test.mjs`
  ⇒ **155 tests / 155 pass / 0 fail**。
- `git status --porcelain` 里属于本域、且**已带未提交改动**的文件：
  `native/git.cpp`、`native/git.hpp`、`native/git_detail.hpp`、`native/git_test.cpp`、
  `src/commitCheck.ts`、`src/commitChecks.ts`、`src/commitChecksResult.ts`、`src/commitNotification.ts`、
  `src/sourceControlCommitChecks.ts`、`CMakeLists.txt`；未跟踪新文件：`src/commitScope.ts`、
  `src/documentRevisions.ts`、`tests/commit-scope.test.mjs`。
- 先前 lane 的登记文件（都在盘上、内容自洽）：`docs/batch-2026-10-06-partialcommit.md`、
  `docs/batch-2026-10-06-commitfpclose.md`、`docs/batch-2026-10-06-preflight.md` +
  `docs/wiring-requests-2026-10-06-partialcommit.md`（W1–W5）、`docs/wiring-requests-2026-10-06-preflight.md`。
- **归属声明**：`src/commitChecksResult.ts` 是 `source-citation-anchors` 门 4 条 `moved` 红之一（派单点名）。
  本批**没有**为变绿重排它、**没有**跑 `TAOCODE_CITATION_ANCHORS=update` 重算快照 —— 那条红归主代理收口时处理。

### 盘上真实缺的那两块（逐文件开出来后定的位）

1. **R1 只剩 native 那一半**：`checked_pathspec()`（`native/git.cpp`）只挡控制字符/反斜杠/绝对路径/盘符，
   **不挡 git 的 pathspec 通配与魔术**（`*` `?` `[` / `:(` / 开头的 `:`）。前端
   `src/commitChecks.ts:503`（`PATHSPEC_MAGIC_RE`）+ `:516` 早就拒，`src/commitScope.ts` 文件头与
   `docs/wiring-requests-2026-10-06-partialcommit.md` **W3** 都写明"native 那一头要补同一道"，
   当时的约束是"本 lane 不许动 native" ⇒ 只落成请求。**⇒ 本批落地**（本派单明确允许改 `native/git.cpp`）。
2. **R1 的两条上限"有闸没判据"（W4）**：`native/git.cpp` 的 `path.size() > 512` 与 `paths.size() > 500`
   都在（前端镜像 `src/commitChecks.ts:477` `MAX_COMMIT_PATHS = 500`、`:480` `MAX_COMMIT_PATH_LENGTH = 512`，
   `tests/commit-scope.test.mjs` 钉了"同一个数"），但 `native/git_test.cpp` 四条 partial commit 用例
   **一条都没打到这两个数** ⇒ 只证明"前后端数字一样"，证明不了"native 真按这个数拒"。**⇒ 本批补判据**。
3. **R2 模块侧盘上已经落完**（不是本批做的，本批逐条复核）：
   `src/commitChecksResult.ts:186-196` 的 `commitChecksFingerprint(rows, unsaved, revisions)` 第三段
   就是**每篇文档的修订号**（`DocumentRevision{path,revision}`，`:109-112`），
   生产者 `src/documentRevisions.ts`（`bumpDocumentRevision` / `documentRevisionList`）已由
   `src/lspNavigation.ts:255`（每次 `@change`）与 `src/editorFileOps.ts:172`（`setDraft` 不发 `@change`，另记一笔）记账，
   面板 `src/sourceControlCommitChecks.ts:80` 把它收成**必填**入参、`:150` 交进指纹，
   宿主 `src/components/SourceControl.vue:519` `documentRevisions: documentRevisionList` 真的递了。
   全局墙钟计数 `editorEpoch` 已整条删掉。**没有**任何地方拿 `Date.now()` / 内容长度当指纹
   （`grep -n "Date.now()"` 在本域六个文件里零命中）。
   `EditorState.seq` 这个假号源在本域**零命中**（它只在 codelens 那两个文件里以"订正留痕"的形式被叙述，
   即 `src/codeLensCache.ts:57-60`、`src/codeLensExtension.ts:47` —— 那是别人的域，本批不动）。

## 1. 判词表

上游相对路径都相对 `D:\Backup\Downloads\intellij-community-master`，**逐条自己打开文件核过**（先前 lane 的坐标只当候选）。

| 族 | 项 | 判定 | 上游 相对路径:行号 | 本仓落点 文件:行号 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| R1 部分提交 | 入口「提交文件…」（挂在 ChangesViewPopupMenu 第一行） | `[x]` 先前 lane 已做，本批复核 | `platform/vcs-impl/resources/META-INF/VcsActions.xml:18`、`:187`；`platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:37-53` | `src/commitScope.ts:82`（`COMMIT_SCOPE_LABEL`）、`src/changesMenuActions.ts` 的 `commitFile` 行 | 动作与菜单那一行都在，本批没动 |
| R1 | 范围层：被选路径 → 这次包含的变更（含未跟踪那一份） | `[x]` 先前 lane 已做 | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CheckinActionUtil.kt:104-106`、`:153-167` | `src/commitScope.ts:98-117`（`expandCommitSelection`）、`:128-130`（`commitScopeCovers`） | 目录 pathspec 算得中它下面的变更行，且**不做祖先折叠**（git 答 `allowsNestedRoots=true`，`platform/git4idea/.../GitVcs.java:260-263` 那一支） |
| R1 | 重命名成对（一条变更两朵路径） | `[x]` 先前 lane 已做 | `plugins/git4idea/backend/src/checkin/GitCheckinEnvironment.kt:403-404` | `src/commitScope.ts:98-117`；`native/git.cpp` 的 `has_new`/`has_old` 那一段 | 单边提交实测写出坏历史（只给新路径 ⇒ `A`、HEAD 里旧路径还在），所以两侧都补 |
| R1 | 请求体构造 + 校验（前端八道闸） | `[x]` 先前 lane 已做 | 见上一行 + `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:75-78`（`NOT_CHANGED`/`IGNORED` 不启用） | `src/commitChecks.ts:508-518`（`commitPathProblem`）、`:477`/`:480`（两条上限） | 空选择不静默降级成全量；被忽略的被选项拒；未跟踪的留 |
| R1 | paths **透传**到宿主并真的进命令行 | `[x]` 先前 lane 已做 | `plugins/git4idea/backend/src/checkin/GitCheckinEnvironment.kt:329-366` | `src/components/SourceControl.vue:373`（`request('git.commit', commitRequestParams({…paths…}))`）→ `native/main.cpp:1175`（`params.value("paths", …)`）→ `native/git.cpp` 的 `commit(..., paths)` ⇒ `git commit --only -- <paths>` | 本批把这条链**逐跳打开核过**：不是假控件 |
| R1 | native 侧 pathspec **校验**缺"通配/魔术"那一道（partialcommit W3） | `[x]` **本批落地** | 上游不发 pathspec（改 index）：`plugins/git4idea/backend/src/checkin/GitCheckinEnvironment.kt:393-434` + `plugins/git4idea/backend/src/util/GitFileUtils.kt:156-179` ⇒ 这一档风险是本仓短路方案带来的，上游**没有对应坐标可引**（不是"无法核实"，是"上游无需此闸"） | `native/git.cpp` 的 `checked_pathspec()`（四个条件：`find_first_of("*?[")` / `front()==':'` / `find(":(")`），契约写进 `native/git.hpp` 的 `commit` 注释 | `*` `?` `[` 与 `:` 魔术在 git 的 pathspec 里不是字面量 ⇒ "只提交选中的"会提交得比选中的多；前端那道挡不住**宿主直接递进来**的形状 |
| R1 | 两条上限（512 字节 / 500 条）**有闸没判据**（W4） | `[x]` **本批补判据** | 无上游对应（本仓自定防护）⇒ 上游那条**无法核实**；参照实现 `plugins/git4idea/backend/src/util/GitFileUtils.kt:306-321` 走的是 pathspec-from-file / 分块，**不是条数门** | `native/git_test.cpp` 的 `partial commit: pathspec must be a repo-relative POSIX path`：513 字节 ASCII、171 个汉字=513 字节、501 条 vs 500 条两侧边界 | 边界用**消息**分辨是哪一道闸拒的（见 §4，这里踩过一次假绿） |
| R1 | 项目视图多选 → 提交范围（W1，宿主） | `[x]` 先前 lane 已落（**不归本批**） | `CommonCheckinFilesAction.kt:37-53` 的 `VcsContextUtil.selectedFilePaths(...)` | `src/components/SourceControl.vue:266-267`（`commitPathsToCommit`）、`:513`（`commitScope`） | 只读引坐标，本批没碰宿主文件 |
| R1 | 计数口径：数变更不数 pathspec；被排除的暂存项不算成功 | `[x]` 先前 lane 已做 | `platform/vcs-impl/src/com/intellij/vcs/commit/ShowNotificationCommitResultHandler.kt:42-43`、`:128` | `src/commitScope.ts:148-152`（`committedChangeCount`）、`:166-168`（`leftBehindStagedCount`） | 两个计数都滤 `ignored`（先前 lane 的收尾订正） |
| R2 | 结果缓存指纹的第 3 段 = **每篇文档的修订号** | `[x]` 先前 lane 已做，本批复核 | `platform/core-api/src/com/intellij/openapi/editor/Document.java:25`、`:184-192`；`platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171`；`platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentModStamp.java:6-12` | `src/commitChecksResult.ts:109-112`（`DocumentRevision`）、`:186-196`（`commitChecksFingerprint`） | 号变⇒指纹变⇒作废；号不变⇒逐字不变⇒复用 |
| R2 | 不再拿墙钟/内容长度当依据 | `[x]` 本批 grep 复核 | 上游 `Document.java:185`（"not related to the file modification time"） | 本域 6 个文件 `grep "Date.now()"` **零命中**；`editorEpoch` 那条全局计数整条删掉（`src/sourceControlCommitChecks.ts`） | `tests/commit-checks-result.test.mjs` 钉着 `doesNotMatch(… /editorEpoch/)` |
| R2 | 假号源 `EditorState.seq` 未被采用 | `[x]` 本域零命中 | —（这是本仓依赖侧的事实：@codemirror/state 6.7.6 的 `EditorState` 上没有 `seq`） | `src/documentRevisions.ts` 用**每篇自己的计数**，不是 `state.seq` | 派单点名两次证实它是假号源；本域没有一处引用它 |
| R2 | 键入那一半的生产方 | `[x]` 先前 lane 已做 | `NonModalCommitWorkflowHandler.kt:215-226`（`documentChanged` 每次作废） | `src/lspNavigation.ts:255`（`onEditorChange` → `bumpDocumentRevision`）、`src/editorFileOps.ts` 的缩进转换 | 号属于文档，不由组装层代记 |
| R2 | **程序性改写**那一半的生产方（`src/*.ts` 七处：重新载入磁盘版本 / 换编码 / LSP 改文 / 批量替换 / 意图与重构落地） | `[x]` **本批落地**（原先**一处都不记号**） | `platform/core-impl/src/com/intellij/openapi/editor/impl/DocumentImpl.java:171`（每次 `replaceString` 领新号，不问谁发起）；作废侧 `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:203-213`（VFS 那一半）与 `:216-225`（文档那一半） | `src/diskSync.ts` 两处、`src/editorFileOps.ts` 两处、`src/lspNavigation.ts` 一处、`src/semanticActions.ts` 两处（各带 `bumpDocumentRevision`） | 保存过 / git 侧干净时 `dirtyPaths` 与变更列表都不变 ⇒ 不记号就是"正文变了而指纹一个字没变"，上一轮 PASSED 被无限复用 |
| R2 | 同一维度的**不变量判据**（扫源码，不靠点名） | `[x]` **本批新增** | 同上 | `tests/commit-checks-result.test.mjs` 末两条：`src/*.ts` 里每处 `.setDraft(` 六行内必须跟一次 `bumpDocumentRevision(`；App.vue 未记号的三行**登记在案** | 新增一个改写入口而忘了记号就会红（本批第一版有"注释里带着调用"的绕过，已修，见 §4） |
| R2 | `src/App.vue` 那三处 `setDraft`（本地历史回滚 / Actions on Save / 保存前 pass） | `[~]` 本批**没做**：`src/App.vue` 是本 lane 禁写文件（30 行余量） | 同上一行 | 实测未记号的行：`src/App.vue:1094`、`:1118`、`:1124`（本批零改动） | 还差：一行 import + 三处 `bumpDocumentRevision`，可照抄的整段替换代码与"同批要改的那条登记断言"都在 `docs/wiring-requests-2026-10-06-commitpaths.md` C1 |
| R2 | 会话恢复时灌草稿（`src/sessionSnapshot.ts:132`） | `[-]` **有意不记号** | 上游**建文档**不发 `documentChanged`（新文档自带初始号） | `src/sessionSnapshot.ts:132`（豁免，写在测试的 `EXEMPT` 里并给了理由） | 打开项目把上次未保存的草稿灌进新建的编辑器是同一种"创建"，不是一次"正文变过一版" |

## 2. 改动文件清单（`wc -l` 前后）

`native/*` 的"前"是本 lane 开工时实测（它们当时已带先前 lane 的在途改动）；四个 `.ts` 同样是"开工时已带别人的改动"，
所以那里给的是**本批净增**（我这次插入的行数），不是对 HEAD 的 diff。

| 文件 | 前 | 后 | 本批净增 | 归属 |
| --- | --- | --- | --- | --- |
| `native/git.cpp` | **860**（开工实测） | **883** | +23（W3 那一道闸 +18；`git::status` 限定名那处 +5） | 本 lane 可改（派单点名允许） |
| `native/git.hpp` | **193**（开工实测） | **197** | +4（`commit` 的 paths 契约：只接受字面量） | 同上 |
| `native/git_test.cpp` | **763**（开工实测） | **834** | +71（通配/魔术 5 档 + 两条上限的两侧边界 + 反假绿的那段说明） | 同上 |
| `src/diskSync.ts` | 262（按净增反推，开工未单独记录） | **270** | +8（2 处记号 + import） | 非黑名单，本批改 |
| `src/editorFileOps.ts` | 294（同上） | **299** | +5（2 处记号） | 同上 |
| `src/lspNavigation.ts` | 689（同上） | **692** | +3（1 处记号） | 同上 |
| `src/semanticActions.ts` | 800（同上） | **810** | +10（2 处记号 + import） | 同上 |
| `tests/commit-scope.test.mjs` | 未跟踪文件，开工时的值没单独记录 | **235** | 用例条数不变（10 条），改的是断言形状与两处钉法 | 本 lane 域内 |
| `tests/commit-checks-result.test.mjs` | **469**（本次动手前实测） | **522** | +53（两条新判据 + 擦注释的锚点工具） | 本 lane 域内 |
| `CMakeLists.txt` | **未动** | **未动** | 0（`grep -c add_test` 前后都是 **39**） | 主代理独占，只读 |
| `docs/batch-2026-10-06-commitpaths.md` | — | 本文件 | 新建 | 本 lane |
| `docs/wiring-requests-2026-10-06-commitpaths.md` | — | 新建 | 本 lane |

**没有改**：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`src/components/SourceControl.vue`、
`native/main.cpp`、`src/settingsModel.ts`、`docs/inventory/**`、并发黑名单里的任何文件（`git status` 可核）。
`src/commitChecksResult.ts` 与 `src/commitChecks.ts` 本批**一字未动**（§0 的归属声明）。

## 3. §5 自查命令前后数字

| 命令 | 前（开工） | 后（收工） |
| --- | --- | --- |
| `node --test tests/commit*.test.mjs tests/source-control*.test.mjs tests/scope-persistence.test.mjs tests/module-size.test.mjs` | **155 / 155 pass / 0 fail** | **157 / 157 pass / 0 fail**（+2 = 本批两条 R2 判据） |
| `node --test tests/commit-scope.test.mjs` | 10 / 10 | **10 / 10**（用例内断言变多变强，条数不变） |
| `node --test tests/commit-checks-result.test.mjs` | 30 / 30 | **32 / 32** |
| `node --test tests/module-size.test.mjs` | 绿 | **绿**（上限只降不升；`native/git.cpp` 登记 938，现 883） |
| `node .tools/find-orphan-modules.mjs --gate` | 无新增零消费方 | **同样绿**（本批没建新模块；净增消费方 0，见 §5） |
| `.tools/find-missing-ext.mjs` | 1375 个文件，干净 | **1378 个文件，干净** |
| `.tools/find-param-props.mjs` | 0 处 | **0 处** |
| `.tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| 隔离 tsconfig `tsc --noEmit`（本域 7 个 `.ts`，`build/tsconfig-commitpaths.json`，收工已删） | 0 错 | **0 错** |
| 隔离 `tsc --noEmit` 本批新改的 4 个 `.ts` | — | **0 错**（`tsc-exit=0`） |
| `ctest --test-dir build -R git_status_vcs`（改前基线，带旧用例） | Passed（1/1） | **Passed（1/1）** |
| `ctest --test-dir build`（全量，先 `cmake --build build --parallel`） | **39 / 39 passed** | **39 / 39 passed** |
| `grep -c add_test CMakeLists.txt` | **39** | **39**（没新增：复用了 `CMakeLists.txt:185` 的 `add_test(NAME git_status_vcs COMMAND git_test)`，所以派单说的"39→40"这一档**没发生**） |
| `node --test tests/source-citations.test.mjs` | 3 tests / 2 pass / **1 fail** | **3 / 2 / 1 fail（同一条，不是本批的）**：三条假引用都在别人的文档里（`batch-2026-10-06-findrep2.md`、`-hlregistry.md`、`-stickyfold.md` 各一条 `ConsoleViewImpl.kt:999999-999999`） |
| `node --test tests/source-citation-anchors.test.mjs` | 8 / 6 pass / **2 fail** | **8 / 6 / 2 fail（那 4 条 `moved` 原样在，本批没碰、没重算快照）**，明细见 §6 |

全量 `npm test` **没跑**（12 路并行，按规约只跑本域）。`vue-tsc -b` 全量**没跑**（并发期 0 错不可信，改用上面的隔离 tsconfig）。

## 4. 反向验证记录（三步数字：注入 → 红 → 还原 → cmp/sha1 → grep 0 残留）

### A. R1 native 闸（前缀 `COMMITPATHS-INJECT`）

**这一节里先暴露了一个假绿，必须留痕：**

1. 第一版判据（照 W3/W4 请求原文写的"只查 `refused` + 错误码 + HEAD 不变"）注入后：
   把 `checked_pathspec()` 的通配/魔术那三行整段注掉 ⇒ 重编译 ⇒ `ctest -R git_status_vcs` = **1/1 Passed（0 红）**。
   **⇒ 那批断言是假绿。** 根因（实测抓出来的）：`commit()` 后面还有一道"这个路径没有可提交的变更"，
   它拿 pathspec 与变更行**按字面**比，`*.ts` 比不中任何一行 ⇒ 摘掉新闸照样抛 `INVALID_REQUEST`、照样不动 HEAD。
   同一次注入下 JS 侧的源码锚点确实红了（10 tests / 9 pass / **1 fail**），所以只有 native 那半在骗人。
2. 于是把判据改成钉**是哪一道闸拒的**（消息里要有新闸的标记 `pathspec`，且不许漂到兜底那句
   `这个路径没有可提交的变更`；条数那一档用 `500` 分辨，500 条那一发则**必须**漂到兜底那句才算"上限内放过"）。
   再次注入同一处（摘闸）⇒ `ctest -R git_status_vcs` = **`***Failed`，0% tests passed, 1 tests failed out of 1**，
   原文：`FAIL partial commit: pathspec must be a repo-relative POSIX path: 拒它的是 checked_pathspec 的**通配/魔术**那一道：通配星号，got: 这个路径没有可提交的变更：*.ts`
   ⇒ **红得对，且红在那条真风险上**。
3. 还原：`sha1sum native/git.cpp` = `9a8472e2f38086ec18b738a687beed089094f65e`，与注入前快照**一字不差**，
   `cmp build/git.cpp.commitpaths.tmp native/git.cpp` = identical；`grep -rn COMMITPATHS native src tests` = **0 处**；
   重编译 ⇒ `ctest -R git_status_vcs` **Passed**、`node --test tests/commit-scope.test.mjs` **10/10**；
   最后 `cmake --build build --parallel` + 全量 `ctest` ⇒ **39 / 39 passed**。

### B. R2 记号（同前缀）

1. 第一次注入**是无效的**（我误把 live 调用留着、只加了一行注掉的副本）⇒ 32/32 全绿。留痕：这不算"验过"。
2. 第二次把那一行真注掉 ⇒ 第一版不变量**仍然 32/32 全绿** ⇒ 又一个假绿：源码锚点在原文里找
   `bumpDocumentRevision(`，而"注释里带着这个调用"照样命中。⇒ 判据改成先擦行注释（`codeOnly`）再找。
3. 擦注释后再注入同一处 ⇒ **31 pass / 1 fail**，失败消息点名那一行：
   `src/editorFileOps.ts:78 把整篇正文换掉了却没给那一篇换修订号 —— …`
   ⇒ **红得对**（这条不变量现在拦得住"新增改写入口忘了记号"，也拦得住"把记号注掉交差"）。
4. 还原：`sha1sum src/editorFileOps.ts` = `d2c449d1912d52c7ff3aa2a867c77d535db3d173` = 注入前快照，
   `cmp` identical；`grep -rn COMMITPATHS native src tests` = **0 处**；`node --test tests/commit-checks-result.test.mjs` **32/32**。

### C. 顺带查实并修掉的一处**编译不过**（不是本批造成的）

`native/git.cpp` 在本批开工时**编译失败**：`error C2668: taocode::git::status 对重载函数的调用不明确`
（`repo` 是 `std::filesystem::path` ⇒ ADL 把 `std::filesystem::status` 一起摆进候选集）。
先前 lane 加了那一发未限定的 `status(repo)` 但从未编译过 native（其文档自陈"本 lane 没跑 ctest"）。
本批改成 `taocode::git::status(repo)` 并写了原因注释；**没有**顺手改别人的其它在途内容（hunk 只有这一处）。

## 5. 零消费方自查结论

本批**没有新建任何模块文件**（只新建了两份文档）。改动都落在既有模块的既有出口上：
- `native/git.cpp` 的 `checked_pathspec` 早被 `commit()` 消费（全仓仅 `native/git.cpp` 一处调用点，grep 核实），
  新增条件不产生新出口 ⇒ 无孤儿风险。
- `src/documentRevisions.ts` 的 `bumpDocumentRevision` 消费方由本批从 **3 个** 增到 **7 个文件**
  （`diskSync.ts`、`editorFileOps.ts`、`lspNavigation.ts`、`semanticActions.ts` 里共 7 处调用）⇒ 消费方只增不减。
- 测试侧新增的两条判据消费的是既有模块，不引入新源文件。
`node .tools/find-orphan-modules.mjs --gate` 前后都绿（已登记孤儿 6 / 基线 8 · 新增 **0** · 本轮清掉 2，那两条不是本域的）。

## 6. 做不到 / 无法核实 清单

1. **`src/App.vue` 三处记号做不到**（具体卡在哪一环）：`src/App.vue` 在派单禁写名单与 `.tools/agent-rules.md` §2 的
   主代理独占名单里，且它只有 30 行余量。位置已实测钉死（`:1094`、`:1118`、`:1124`），
   import 语句与可照抄的整段替换代码在 `docs/wiring-requests-2026-10-06-commitpaths.md` C1。
   附带条件也写清了：C1 落地时**必须同批改**那条登记断言（`assert.deepEqual(unbumped, [1094, 1118, 1124])` → `[]`），
   否则接完就是红。
2. **上游"条数上限 500 / 单条 512 字节"没有对应坐标**：`plugins/git4idea/backend/src/util/GitFileUtils.kt:306-321`
   走的是 `--pathspec-from-file` 与分块，**不是**"条数门"⇒ 这两个数字是**本仓自定防护**，
   上游有没有等价的条数上限**无法核实**。本批只测行为、没有据上游改数值。
3. **中文措辞一律"无法核实"**：本地树里没有 zh 本地化包 ⇒ 本批新写的用户可见文案只有一条，
   即 `native/git.cpp` 那句 `提交路径只能是字面量，不能含 git 的 pathspec 通配或魔术前缀。`
   它是 native 错误消息（不是上游 bundle 键），**没有**上游原句可比对，按英文语义直译写成；
   上游侧对应概念只能引到"git 的 pathspec 语法"本身，引不到具体 `*.properties:行号`。
4. **`source-citations` / `source-citation-anchors` 两条红不归本批**（明细）：
   - citations：三条假引用全在 `docs/batch-2026-10-06-findrep2.md`、`-hlregistry.md`、`-stickyfold.md`
     （`ConsoleViewImpl.kt:999999-999999`，行号超出文件长度 1730）——像是别人**故意**留的反例，本批没动。
   - anchors 的 4 条 `moved`：`src/commitChecks.ts`（`CommonCheckinFilesAction.kt:26-78`）、
     `src/components/ProblemsPanel.vue` ×2、`src/runStartupFocus.ts` ×1。
     **派单写的是 `src/commitChecksResult.ts`，实际是 `src/commitChecks.ts`**（留痕：原写 X、实际 Y）。
     那一条的成因是先前 lane 的在途 diff 把 `:26-78` 订正成 `:37-53`（`git diff` 的 `-` 行就是快照认得的那句），
     本批**没有**重排该文件、**没有**跑 `TAOCODE_CITATION_ANCHORS=update`（会把别人在途文件冻进快照，归主代理收口）。
5. **没有跑全量 `npm test` 与全仓 `vue-tsc -b`**：12 路并行下按规约只跑本域 + 隔离 tsconfig（数字见 §3）。
6. **`git add` / commit / push 一概没做**；`scripts/__pycache__/*.pyc` 本批没跑 python，未新增脏项
   （开工时它已在 `git status` 里，是别人的）。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-commitpaths.md`：
- **C1**（要动手）：`src/App.vue` 三处 `bumpDocumentRevision` + 同批改那条登记断言。
- **C2**（登记）：`docs/wiring-requests-2026-10-06-partialcommit.md` 的 **W3 / W4 已由本批落地**，
  可以按"已接"关闭；`CMakeLists.txt` 未动 ⇒ ctest 条目 **39 → 39**。
- **C3**（订正留痕）：anchors 那条红的文件名（派单写 `commitChecksResult.ts`、实际 `commitChecks.ts`），
  收口重算快照时一并处理。
- 另外 §4-C 那处 `git::status` 限定名修复请留意：它落在 `native/git.cpp`，先前 lane 的文档
  （`docs/batch-2026-10-06-native-git-red.md`、`docs/batch-2026-10-06-partialcommit.md`）里的行号因为本批插了 23 行而**整体后移**，
  它们引用的 `native/git.cpp:460`/`:461`/`:465` 一类坐标现在要读 `+23` 之后的位置。
