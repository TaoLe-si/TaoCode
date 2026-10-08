# 2026-10-06 原生 git 用例翻红 —— 定责与修复（代号 `native-git-red`）

派单：`ctest --test-dir build -R git_status_vcs` 红，原文
`FAIL commit with a path subset commits only the selected files: 工作区重新干净，还剩: a.txt(X YM)`。
本报告的每一条本仓行号都是**改完后重新 grep 过的**，上游行号都是**自己打开文件读过的**。

---

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| VCS / 提交 | R1「提交文件…」= 只把被选路径带进这次提交 | `[x]` 已做（本次确认语义**没变坏**） | `platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:37-53`；`platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CheckinActionUtil.kt:104-106`、`:135-136` | `native/git.cpp:460`（`scoped = !paths.empty()`）、`:465-469`（先 `git add -- <paths>`）、`:472`/`:481`（`--only` + pathspec） | 上游 `actionPerformed` 把 `selectedFilePaths` 当 `pathsToCommit`，`setCommitState(initialChangeList, included, …)` 只交**被纳入的那一份** |
| VCS / 提交 | 「没被选中的变更留在原处，不被这次提交带走」 | `[x]` 已做 | `.../commit/CheckinActionUtil.kt:153-168`（`initialChangeList.changes.intersect(changesToCommit)`） | `native/git.cpp:470-482` | `--only` 用工作区版本构造这一次提交，index 里其它暂存项不参与也不被清 ⇒ 与本仓实测一致（`scope-b.txt` 提交后仍是 `staged`） |
| VCS / 提交 | 空 `paths` 的那一发 `commit` = **只提交暂存区**（不吞未暂存改动） | `[x]` 语义与上游相符 ⇒ **不改 `git.cpp`** | 同上一行（上游没有"顺手把剩下的脏一起提交"这一步） | `native/git.cpp:460,470-482`；对照 `git diff dfbda4e -- native/git.cpp` 的 `commit` hunk | 该分支自 dfbda4e 起一字未动：新增的 `add`/`--only`/pathspec 三段全在 `if (scoped)` 里 ⇒ 红**不是** commit 语义造成的 |
| 测试夹具 | 「共享同一个临时仓库，用例之间不许留脏东西」（本文件既有约定，见 `native/git_test.cpp:128-129`、`:147-148` 的注释） | `[x]` 两处违反已补收尾 | —（本仓测试自己的约定） | `native/git_test.cpp:192-197`、`:243-244` | `unstage` 与 `stash-pop` 两条用例各把 `a.txt` 留在 `(X YM)`，那种形状**谁都提交不掉**（空 paths 只吃 index），只能回滚 |
| 测试夹具 | `rebase` 用例的"清场"提交在干净树上会自己抛 | `[x]` 已修（同一根因的第二处塌方） | —（本仓 `native/git_test.cpp:44-47` 的 `git()` 辅助函数：非零退出即 throw） | `native/git_test.cpp:479-489` | 注释原话 "no-op when clean" 其实不成立：干净树上 `git commit` 返回 1 ⇒ 之前一路靠上面漏下的 `a.txt` 蒙对；现在先查 `status` |
| VCS / 提交 | 一批 pathspec 的 500 条上限：超限必须在**调 git 之前**被拦下 | `[~]` 本仓已有实现，本次**补上判据** | 上游不用"条数门"而是 `--pathspec-from-file=- --pathspec-file-nul`（`plugins/git4idea/backend/src/util/GitFileUtils.kt:306-314`）或回退**分块**（`:315-321` `VcsFileUtil.chunkArguments`），版本档位见 `plugins/git4idea/backend/src/config/GitVersionSpecialty.kt:149-154`（git 2.26.0+） | 实现 `native/git.cpp:461`；判据 `native/git_test.cpp:350-364` | 「上游有没有等价的**条数**上限」**无法核实**；本仓 500 是自定防护，本次只测行为、不改行为 |
| 测试判据 | 收尾 `commit(root, "scoped: the rest")` 之前"确实还有没提交的东西" | `[x]` 已加回 | —（防假绿的自证判据） | `native/git_test.cpp:365-367` | 少了这句，`rest.empty()` 会在"收尾那一发其实什么也没提交"时假绿 |

## 2. 根因（谁把脏 `a.txt` 留在树上）

**结论：测试夹具的顺序假设被打破，不是 `commit()` 语义变了。**

按顺序走完 `native/git_test.cpp` 里对 `a.txt` 的每一次写入：

| 顺序 | 用例（现行号） | 对 `a.txt` 做了什么 | 结束时 `a.txt` |
|---|---|---|---|
| 6 | `stage then commit moves changes out of status`（`:174-183`） | stage + `commit(root, "update a and add b")` | 干净（HEAD 里是 `hello world\n`） |
| 7 | `unstage returns a staged file to the working tree`（`:185-198`） | `put "again\n"` → stage → unstage；判据**本身要的形状**就是 `!staged && work_status == "M"` | **`a.txt(X YM)` 留在树上**（本次补了 `revert` 收尾 `:197`） |
| 11 | `stash saves and restores uncommitted changes`（`:226-245`） | `put "stashed-content\n"` → `stash_save` → `stash_pop`；`git stash pop` 默认**不还原 index** | **又是一份 `a.txt(X YM)`**（本次补了 `:244`） |
| 12/13/14 | `create_branch/merge`、`compare`、`amend` | 都只 stage 自己的新文件，空 paths 的 commit 不吃未暂存改动 | 两份脏一路漂到 15 |
| 15 | `commit with a path subset…`（`:310-378`） | 收尾 `commit(root, "scoped: the rest")` 只提交了 index 里的 `scope-b.txt` | 树上仍剩 `a.txt(X YM)` ⇒ `check(rest.empty(), …)` 红 |

为什么 dfbda4e 是 37/37：`git diff dfbda4e -- native/git_test.cpp` 显示**整条 `commit with a path subset` 用例都是新增的**，那句 `check(rest.empty(), "工作区重新干净…")` 是全文件里**第一条**中途检查"整棵树"的判据（此前只有 `:182` 在 6 号用例里查，位置在两份脏产生之前）。⇒ 新增判据没写错，它只是第一次把早就存在的两份脏照出来了；`--only` 那一批只是把这条判据带了进来。

留痕（原写 X、实际 Y）：派单写"在那个测试末尾把它清干净"（单数）。实际是**两条**各留一份同形状的脏：只撤 `:197` 一条不会红 —— 11 号用例的 `stash_save` 会把那份脏一起收走、`stash_pop` 回来后又被 `:244` 清掉。所以反向验证 A 必须**两条一起撤**才等于回归现场。

## 3. 改动清单（只动了 1 个文件）

| 文件 | 行数 前 → 后 | 改动 |
|---|---|---|
| `native/git_test.cpp` | 579 → 612 | `+35 / -2`：两处用例收尾 `revert`（`:192-197`、`:243-244`）、两条新判据（`:350-364` 的 501 条上限、`:365-367` 的"还有没提交的东西"）、`rebase` 清场加 `status` 守卫（`:479-489`） |
| `native/git.cpp` | 790 → 790 | **净零改动**：反向验证 B 的注入（`:461` 的 `> 500` 改成 `> 501`）已逐字撤回，`git diff -- native/git.cpp` 输出为空 |

```
$ git diff --stat -- native/git_test.cpp
 native/git_test.cpp | 37 +++++++++++++++++++++++++++++++++++--
 1 file changed, 35 insertions(+), 2 deletions(-)
```
（留痕：收工前主代理在 12:33:24 落了 `200232e`「多域收工批量」，把共享工作树里的在途改动一起提交了，**包括我这一个文件** —— 所以之后再跑 `git diff --stat` 会是空的。同一份改动按"我接手时的 HEAD"复核过，数字一致：
`git diff --stat 1e2f7f7 -- native/git_test.cpp` ⇒ `1 file changed, 35 insertions(+), 2 deletions(-)`；`git show --stat 200232e -- native/git_test.cpp` ⇒ 同样的 `+35/-2`；`native/git.cpp` 未被提交、也未被改动（`git diff --exit-code -- native/git.cpp` = CLEAN）。）
（`git diff --stat -- native/` 里另有 `settings_editor_keys.hpp` / `settings_schema.{cpp,hpp}` 三条，**不是我的**，是别的代理在同一棵共享工作树上的在途改动。）

`native/main.cpp` 的 `git.commit` 第七参 `paths` 透传（HEAD `1e2f7f7`）：**未回退、未修改**。
本次**没有新增 `native/*.cpp`** ⇒ `CMakeLists.txt` 无需登记（`git_test` 的注册在既有 `CMakeLists.txt:185`：`add_test(NAME git_status_vcs COMMAND git_test)`）。

## 4. §5 自查：前后数字

| 命令 | 改前 | 改后 |
|---|---|---|
| `powershell -File build/_native-only.ps1`（configure/build + 全量 ctest） | `97% tests passed, 1 tests failed out of 37`；`The following tests FAILED: 17 - git_status_vcs (Failed)`；`CTEST_EXIT=8`；用例内 `26 passed, 1 failed` | `100% tests passed, 0 tests failed out of 37`；`CTEST_EXIT=0`；用例内 `27 passed, 0 failed` |
| `npm run test:native`（= `scripts/build-native.ps1 -TestOnly` → 全量 ctest） | 同上一列的 36/37 | `100% tests passed, 0 tests failed out of 37`，`Total Test time (real) = 95.74 sec`（判成败读的是 `tests passed` 那行，不是 npm 退出码；本次退出码恰好也是 0） |
| `ctest --test-dir build -R git_status_vcs` | `0% tests passed, 1 tests failed out of 1` | `100% tests passed, 0 tests failed out of 1`（原始行：`1/1 Test #17: git_status_vcs ... Passed 9.41 sec`） |
| `node --test tests/module-size.test.mjs` | 5 tests / 5 pass / 0 fail | 5 tests / 5 pass / 0 fail（`git_test.cpp` 612 行，`_test.cpp` 上限 1300，未登记任何豁免） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | pass 10 / **fail 1** | pass 10 / **fail 1**（**同一条、非本域**：`已入快照的每条引用，被引区间内容必须仍与快照一致`，两条越界引用都指向 `docs/wiring-requests-2026-10-06-fix-macros.md`（别人的在途文件，`git status` 显示 ` M`）里的 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1058-1062` 与 `.../codeInsight/template/macro/ClipboardMacro.java:15`） |
| `npx vue-tsc -b --force` / `find-param-props` / `find-ts-in-mjs` / `find-missing-ext` / `find-orphan-modules --gate` | 未跑 | 未跑 —— 本次改动**零前端文件**（只 `native/git_test.cpp`），按 §5 最后一条"只跑自己域的测试，别把别人的在途红算到自己头上"；`find-orphan-modules` 的增量必然为零（见 §6） |

## 5. 反向验证记录（三步数字，全部原始行）

**A. 撤掉两处夹具收尾（＝复现回归现场）**
注入：把 `native/git_test.cpp:197` 与 `:244` 两句 `taocode::git::revert(root, "a.txt");` 同时注释掉。
```
FAIL commit with a path subset commits only the selected files: 工作区重新干净，还剩: a.txt(X YM)
26 passed, 1 failed
0% tests passed, 1 tests failed out of 1
```
⇒ 与主代理实测的原文一字不差。撤掉注入后复绿：`27 passed, 0 failed` + `100% tests passed, 0 tests failed out of 37`。
（附带事实：只撤 `:197` 一条 → 全绿，因为 11 号用例的 stash 链会把那份脏一起收走再清掉。）

**B. 新判据「501 条路径」有牙**
注入：`native/git.cpp:461` 的 `if (paths.size() > 500)` 改成 `> 501`（让 501 条真的走到 `git add`）。
```
FAIL commit with a path subset commits only the selected files: 一次最多 500 个所选文件（超限必须在调 git 之前就被拦下）
26 passed, 1 failed
0% tests passed, 1 tests failed out of 1
```
（走到 git 那一层后错误码变成 `GIT_FAILED` 而非 `INVALID_REQUEST` ⇒ 断言按预期失败，同时反证"断言 `INVALID_REQUEST` == 证明 git 没被调用"这条推理成立。）
撤回：`git diff -- native/git.cpp` 为空 ⇒ 复绿 `27 passed, 0 failed`。

**C. 新判据「收尾前确实还有没提交的东西」有牙**
注入：把 `native/git_test.cpp:367` 取反成 `check(taocode::git::status(root).empty(), "REVERSE-VERIFY: …")`。
```
FAIL commit with a path subset commits only the selected files: REVERSE-VERIFY: 这一发之前应该还有没提交的东西（故意取反）
26 passed, 1 failed
0% tests passed, 1 tests failed out of 1
```
撤回原句 ⇒ 复绿。

**D. `rebase` 清场守卫的红是修复过程中"免费"给的**
只加两处 `revert`、还没给 `rebase` 加守卫那一次运行（`build/_fix1.log`）：
```
FAIL rebase replays commits on top of another branch: git commit -q -m pre-rebase 2>NUL failed
26 passed, 1 failed
97% tests passed, 1 tests failed out of 37
```
⇒ 树上干净时那个未守卫的提交必炸（`git()` 非零即抛），守卫是承重的，不是装饰。

## 6. 零消费方自查

没有新增文件、没有新增导出、没有新增任何被外部消费的符号：改动全在 `native/git_test.cpp` 的**用例体内部**（两处收尾 + 三条判据 + 一个 `if` 守卫）。新增的局部符号 `tip_before_limit` / `too_many` / `over_limit` / `limit_reason` 都在 lambda 里就地产生就地消费 ⇒ `find-orphan-modules` 无增量。

## 7. 做不到 / 无法核实

1. **「上游有 500 条 pathspec 上限」无法核实**：在本地真源里只找到"路径太多放不下命令行"的**另外两种**解法（`plugins/git4idea/backend/src/util/GitFileUtils.kt:306-314` 走 `--pathspec-from-file=- --pathspec-file-nul`，pathspec 从 stdin 喂进去；`:315-321` 回退 `VcsFileUtil.chunkArguments` **分块**），没有按**条数**拒绝的门。所以 `native/git.cpp:461` 的 500 只能当本仓自定防护，我没有给它编上游依据。
2. **500 条这个数字本身挡不住命令行长度**（未修，属新语义不是回归）：`checked_path`（`native/git.cpp:259-260`）允许每条路径 512 字符 ⇒ 500 条最坏 ≈ 256,000 字符，仍会顶爆单条 `CreateProcess` 命令行（32,767 字符）。要贴上游就得上面第 1 条那两路之一。
3. **留痕（原写 X、实际 Y）**：本节初稿写「`chunkArguments` 的定义行指不到，`VcsFileUtil.kt` 里按 `fun chunkArguments` 搜不到」。实际是**它不在 `.kt` 而在 `.java`**：`platform/vcs-impl/src/com/intellij/vcsUtil/VcsFileUtil.java:74-76` 是公开入口（`groupSize = 1`），`:85-116` 是实现，切块判定用的是 `:97` 的 `FILE_PATH_LIMIT`，值在 `:45` = **7600 字符一块**（同目录确实另有一个 `VcsFileUtil.kt` ⇒ "按文件名搜不到 ≠ 功能不存在"这条又应验一次）。上面这些行号是补搜之后自己打开文件核对过的。
4. **`source-citation-anchors` 那条红修不了**： offending 文档是别的代理的在途文件（§4 表格里已给全名与两条越界引用），我不碰别人的文件、也不改快照。
5. **并构建的噪声**：最后一次 `-R git_status_vcs` 那趟，`cmake --build` 步骤报 `LINK : fatal error LNK1104: 无法打开文件 CMakeFiles\taocode_projects.dir\native\projects.cpp.obj`（`BUILD_EXIT=1104`）—— 同一时刻别的代理在写同一个 `build/` 目录，与本次改动无关；被计数的 `git_test.exe`（时间戳 12:29:02）**新于** `native/git_test.cpp`（12:28:42），且 37/37 那次全量（`npm run test:native`）跑的就是这个二进制。

## 8. 要主代理接的线

- **无需**保留文件（`CMakeLists.txt` / `native/main.cpp` / `package.json` 等）改动：没建新 `native/*.cpp`，`main.cpp` 的 `paths` 透传保持你落的原样 ⇒ 不开 `docs/wiring-requests-*` 单子。
- 若要把 §7.2 那条长度问题按上游做掉（`--pathspec-from-file=-` 或按 7600 字符一块，替掉/叠加 `native/git.cpp:461` 的条数门），说一声我接：改动面在 `commit()` 的 `if (scoped)` 两处拼参数，判据已就位（501 条 ⇒ `INVALID_REQUEST`）需要跟着改成"分块后能提交成功"。
- `docs/wiring-requests-2026-10-06-fix-macros.md` 的两条快照锚点已失效（不是我这条链，但会一直挂着全量 citation 门）。

## 9. 原始输出留档（临时日志已删，故把尾段抄在这里）

`npm run test:native`（= `scripts/build-native.ps1 -TestOnly` → 全量 ctest），本次收工前最后一次：
```
      Start 17: git_status_vcs
17/37 Test #17: git_status_vcs ...................   Passed    6.17 sec
...
      Start 36: library_sources
36/37 Test #36: library_sources ..................   Passed    0.11 sec
      Start 37: jdtls_launch_spec
37/37 Test #37: jdtls_launch_spec ................   Passed    0.02 sec

100% tests passed, 0 tests failed out of 37

Total Test time (real) =  95.74 sec
```
用例内部计数（直接跑 `build/git_test.exe`，二进制时间戳 12:32:55 新于源码 12:28:42）：
```
PASS hunks split, stage partially and unstage partially
27 passed, 0 failed
```
改前的同一处（`git_status_vcs` 那一发，原文一字未改）：
```
FAIL commit with a path subset commits only the selected files: 工作区重新干净，还剩: a.txt(X YM)
26 passed, 1 failed
97% tests passed, 1 tests failed out of 37
The following tests FAILED:
	 17 - git_status_vcs (Failed)
```

