# 交付报告 · 2026-10-06 `fix-git-split`（`native/git.cpp` 超上限 → 按 git 子命令边界再拆一族）

代号：`fix-git-split`。派单原文：`native/git.cpp` 被上一个代理撑到 **954 行 > 登记上限 938**，
按职责域拆一族出去，**不许调上限、不许登记豁免**；手法照 2026-10-05 的
`native/git_worktree.cpp` + `native/git_detail.hpp`（只搬一次，实现留一份）。

---

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|---|
| native 模块化 | `git.cpp` 954 行 > 登记上限 938 ⇒ 拆一族 | `[x]` | 不适用（本仓自身架构纪律，判据 = `tests/module-size.test.mjs:88` 的登记上限 938） | `native/git_log.cpp:1-17`（新文件头）+ `:371-542`（搬来的那一族） | 按 **git 子命令边界** 把「提交历史 / 追溯」一族（`git log` / `git show` / `git blame`）整段搬进 `native/git_log.cpp`：`log` / `authors` / `blame` / `file_history` / `show_commit` 五支 + 文件局部 `split_fields`，**逐字未改**（第 4 节有逐字比对数字） |
| native 模块化 | 「声明只搬一次、实现只留一份」（照 worktree 那次的手法） | `[x]` | 同上 | `native/git_detail.hpp:47-54`（四条声明，段前注释 `:44-45`）+ `:10-15`（留痕的为什么） | `trim` / `checked_ref` / `checked_path` / `parse_records` 四条**声明**进 detail 头；实现仍只在 `native/git.cpp`（`run()` 带 job object 与看门狗，`checked_ref` 要跑 `run`，`parse_records` 要跑 `split_unit`，复制进第二个 TU 就是两条会各自漂移的实现） |
| native 模块化 | 新建 `.cpp` 要登记 `CMakeLists.txt`（保留文件） | `[x]`（不需要） | 不适用 | 无 | **本次没有新建 `.cpp`**：实现放进 `CMakeLists.txt:35` 已登记的 `native/git_log.cpp`。未登记的 TU 不进 `taocode_projects` ⇒ 链接期缺符号、ctest 直接红，所以"复用已登记文件"是唯一既能拆又不越界的走法 |
| native 模块化 | 不许调上限 / 不许登记豁免 | `[x]` | 不适用 | `tests/module-size.test.mjs` **未改**（主代理独占，只读） | 938 一字未动，`NATIVE_REGISTERED` 没加行；靠拆把 `git.cpp` 降到 792 |
| VCS 图形 | `src/vcsLogGraph.ts:92` 的引用订正（主代理把 `CollapseGraphAction.java` 改成 11-32） | `[x]` 核实并跟着订正第二条 | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseGraphAction.java:11-32`（真文件 33 行，`nl -ba` 实测：`final class` 在 11、`executeAction` 收尾 `}` 在 32、类闭括号 33） | `src/vcsLogGraph.ts:92` | 主代理那条**站得住**：11-32 在界内且正是 `CollapseGraphAction` 的类体 |
| VCS 图形 | 同一段里另一条 `ExpandGraphAction.java` 的区间 | `[x]` 订正 | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/ExpandGraphAction.java:11-32`（真文件同样 33 行，`nl -ba` 实测与 Collapse 逐行对称：`final class` 在 11、`performLongAction` 在 31、类闭括号 33） | `src/vcsLogGraph.ts:93` | **原写 13-38、实际越界**（上界 38 > 真文件 33 行，留痕写进注释）⇒ 订正成 11-32。这条是"裸文件名:行号"形状，引用门按 `只收完整路径带行号` 不收它，所以门是绿的但写法是错的 |
| VCS 图形 | 同段其余坐标（父类 + 动作体） | `[x]` 核实无误 | `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseOrExpandGraphAction.java:44-47`（真文件 97 行） | `src/vcsLogGraph.ts:94-96` | `:44-47` 落在父类 `actionPerformed`（43-48）内；`COLLAPSE_ALL:214-241` 与 DOTTED 边 `183-187` 也逐条开文件核过（`CollapsedActionManager.java` 真文件 317 行） |
| VCS 图形 | 「别的 vcs 引用指不到」普查 | `[-]` 没有 | 不适用 | `src/vcsLogGraph.ts`（本次唯一改动） | 把 `src/vcs*.ts` 里所有「文件名.(java\|kt):行[-行]」形状抓出来对参考树核：**45 条 / 文件找不到 0 条 / 行号越界 0 条**（订正前那 1 条越界就是 `ExpandGraphAction`）。引用门本身：`仓里每一条带路径的上游引用都指得到` 绿 |
| 门禁 | ctest（`npm run test:native`，看日志的 `tests passed` 那行） | `[~]` 36/37 | 不适用 | `native/git.cpp` / `native/git_log.cpp` / `native/git_detail.hpp` | 收工前那次**干净全量**（`cmake --build build` 到 `[36/36]` 全部链接成功 + `npm run test:native`）日志第 146 行：**`97% tests passed, 1 tests failed out of 37`** = **36/37**。唯一红 `#17 git_status_vcs` 的 `commit with a path subset commits only the selected files: 工作区重新干净` —— **别的代理在途的那一族**（`git commit` 路径子集，`native/git.hpp`/`git.cpp:commit()`/`git_test.cpp:+41` 三处 05:45-05:47 落地），不是本次搬动；根因见第 6 节 |
| 门禁 | `native/git*.cpp` 域内其余用例 | `[x]` | 不适用 | 同上 | 同一个二进制里 `log lists commits` / `blame annotates each committed line` / `git.authors lists each log user once` 等 26 条场景 **PASS** ⇒ 搬过去的五支函数行为未变（这三条正是被搬动的那一族） |
| 门禁 | `tests/vcs-*`（我的域） | `[x]` | 不适用 | `tests/vcs-file-util` / `vcs-log-filter-store` / `vcs-log-menu` / `vcs-log-presentation` | **41/41 pass**，含 `收起线性分支` 那条（`src/vcsLogGraph.ts` 的用例） |
| 接线 | `CMakeLists.txt` 登记 | `[-]` 不需要 | 不适用 | 无 | 没新建 `.cpp` ⇒ 没有登记请求。`docs/wiring-requests-2026-10-06-fix-git-split.md` 里只剩**登记说明刷新 / 上限下调 / 在途红路由**三类，都不是新链接线 |

---

## 2. 改动文件清单（行数前后，用门禁自己的口径 `内容.split('\n').length`）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `native/git.cpp` | **954** | **792** | −162：搬走 `log`(13) / `authors`(24) / `blame`(51) / `file_history`(46) / `show_commit`(10) / `split_fields`(11) = 155 行实现，加被删掉的两处 `namespace { }` 包裹与空行。同时删掉只服务这一族的 include：`<cctype>`(`isxdigit`/`tolower`)、`<set>`(`authors` 去重)、`time_format.hpp`(`blame` 的 author-time) |
| `native/git_log.cpp` | 349 | 552 | +203：文件头 25 行（为什么落这里 / 手法 / 不新建 `.cpp` 的原因）+ `using detail::…` 8 行 + 搬来的 155 行实现 + 分段注释 |
| `native/git_detail.hpp` | 38 | 57 | +19：四条声明（`trim` / `checked_ref` / `checked_path` / `parse_records`）+ `#include "workspace.hpp"`（`parse_records` 返回 `Json`）+ 留痕注释 |
| `src/vcsLogGraph.ts` | 170 | 171 | +1 行注释：`ExpandGraphAction` 区间订正并写明「原写 13-38、实际 33 行 ⇒ 越界」。**没动任何代码行** |
| `native/git.hpp` | 181 | 181 | 本次**未改**（工作区里它的 +8/-1 是 `commit(..., paths)` 那条在途改动，不是我） |
| `native/git_worktree.cpp` | 136 | 136 | 未动，只作为手法先例被读 |

搬动后 `native/` 里 git 一族的职责边界：
`git.cpp` = 进程边界（`run()` + job object + 看门狗 + `request_cancel`）与工作区/暂存/提交/分支/标签/远端/stash/回滚/重置这些**会改动仓库**的动作 + 差异整形；
`git_worktree.cpp` = `git worktree *` / `git submodule *`；
`git_log.cpp` = `git log` / `git show` / `git blame` / `git diff-tree` 这一条**只读历史与追溯**边界（原有 `log_full` / `commit_details` / `commit_changes` / `commit_file_diff` + 新搬来的五支）；
`git_clone.cpp` = 克隆流程。

---

## 3. §5 每条自查命令的前后数字

| 命令 | 前（基线） | 后 | 归属 |
|---|---|---|---|
| `node --test tests/module-size.test.mjs` | 5 条里 **4 pass / 1 fail**，红因：`native/git.cpp 现在 954 行 > 上限 938` | **5 pass / 0 fail** | 本次修的这条 ⇒ 绿。（中途 `src/components/SearchPanel.vue(902 行)` 红过一次，是该域代理在途，收工前它自己降下去了，不是我动的） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **11 pass / 0 fail**；计数行：`快照 1627 条 / 仓里活引用 1826 条 / 未入快照 199 条 / 区间为空 3 条` | **11 pass / 0 fail**；计数行：`快照 1627 条 / 仓里活引用 1905 条 / 未入快照 278 条 / 区间为空 3 条`（中途一次跑到 10 pass / 1 fail，是 R3 那条在途红，收工复跑它的代理已自己收掉）| 中途那条红不在我可改面（现场见 §6 R3，只报不改；收工复跑已由该域代理自己收掉） |
| `npx vue-tsc -b --force` | 未单独跑基线（别的代理在途） | **1 错**：`src/components/TestRunnerPanel.vue(238,59) TS7053` | 桶 11 在途文件，不在我可改面 ⇒ 只报不改。我改的 `src/vcsLogGraph.ts` 只增注释，无错 |
| `node .tools/find-param-props.mjs` | — | `共 0 处参数属性` | 干净 |
| `node .tools/find-ts-in-mjs.mjs` | — | `干净：tests/*.mjs 全部是纯 JavaScript` | 干净 |
| `node .tools/find-missing-ext.mjs` | — | `扫描 1250 个文件…干净` | 干净 |
| `node .tools/find-orphan-modules.mjs --gate` | — | `已登记孤儿 9 / 基线 9 · 新增 1`，红因 `src/structuralCodeBlock.ts` | 桶 9 在途（派单明令不许碰 `src/structural*`）⇒ 只报不改。**我域新增孤儿 0**（本次没新建模块，只搬位置） |
| `npm run test:native`（先 `call vcvars64.bat`，再 `cmake --build build --parallel`） | 派单给的历史基线 37/37 | 跑过 4 次，日志 `tests passed` 那行都是 **`97% tests passed, 1 tests failed out of 37`** = **36/37**（37 项全跑过；`Total Test time` 分别 96.71 / 97.07 / 97.58 / **97.91 sec**，最后一次是 `[36/36]` 干净全量构建之后的复跑） | 唯一红 `#17 git_status_vcs` 的一条新场景 = vcs 代理在途（第 6 节给根因，`ctest -R git_status_vcs` 单跑复现同一条、同一 label ⇒ **不是抖动**）。**npm 退出码是 8，不采信**，按规约看日志行 |

`ctest -R git_status_vcs` 单跑复现：`***Failed 6.51 sec / 26 passed, 1 failed` —— 同一条、同一 label，**确定性可复现**，不是抖动。

> **收工前最后一次全部门复跑**：`module-size 5 pass / 0 fail` · `source-citations + source-citation-anchors 11 pass / 0 fail`
> （计数行 `快照 1627 条 / 仓里活引用 1949 条 / 未入快照 322 条 / 区间为空 3 条`，其中新增的活引用含本两份文档里我核过的真引用）·
> `tests/vcs-*.test.mjs 41 pass / 0 fail` · `ctest 36/37`（唯一红 = R1，别人的在途场景）。

---

## 4. 「实现只留一份 / 逐字未改」的机检证据

临时脚本 `build/git-split-verify.mjs`（已删）：从 `git show HEAD:native/git.cpp` 与新 `native/git_log.cpp`
各自按函数名取整段函数体，逐字符比对：

```
IDENTICAL log（13 行逐字相同）
IDENTICAL authors（24 行逐字相同）
IDENTICAL blame（51 行逐字相同）
IDENTICAL file_history（46 行逐字相同）
IDENTICAL show_commit（10 行逐字相同）
IDENTICAL split_fields（11 行逐字相同）
逐字相同 6 段 / 有问题 0 段
```

并且脚本的反向检查（`native/git.cpp` 里是否还残留这六支的定义）**一条都没打印** ⇒ 没有"两边都留一份"。
`git diff -U0 -- native/git.cpp` 的删除行里 `only|paths|scoped|add|signoff|format_author|author`
**零命中** ⇒ 没删掉别人 `commit(..., paths)` 那一条在途 hunk 的任何一行。

---

## 5. 反向验证（三道门各自的「注入 → 红 → 撤 → 复绿」）

1. **module-size native 上限门**（本次的违规主体）
   · 注入 = 拆之前的现场：`native/git.cpp` 954 行 > 938 ⇒ `已登记的 native 大文件不许继续变大` **1 红**（`✖ …`，`tests 5 / pass 4 / fail 1`）；
   · 撤 = 把「提交历史 / 追溯」一族搬走（954 → 792，**没动 938、没加登记、没加豁免**）；
   · 复绿：`tests 5 / pass 5 / fail 0`。
2. **引用门 live check（`仓里每一条带路径的上游引用都指得到`）**
   · 注入：把 `src/vcsLogGraph.ts:92` 的 `CollapseGraphAction.java` 区间上界从 32 改成 **99**（真文件 33 行）；
   · 红：`tests 11 / pass 8 / fail 3`，逐条：门报 `src\vcsLogGraph.ts` 里 `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/CollapseGraphAction.java` 的区间上界「行号超出文件长度（99 > 34）」 **两条**（两个测试文件各收集一次）+ `已入快照的每条引用…` **1 条**（这条与注入无关，是 `src/fileTypeDetection.ts` 06:16 的在途改动，撤注入后它仍红）；
   · 撤：恢复 `11-32` ⇒ 该 live 测试与快照形状测试复绿，`tests 11 / pass 10 / fail 1`，剩那 1 红就是别人的（`src/fileTypeDetection.ts`）；收工前最后一次复跑：`tests 11 / pass 11 / fail 0`（该域代理已自己收掉）。
3. **链接/消费链门（搬动最容易出事的地方）**
   · 注入 = 故意把 `parse_records` 的声明只放头里、不搬实现？不必假设：真实验证是**第一次全量构建**（vcvars64 + `cmake --build build`）`[30/30]` 成功 ⇒ `git_log.cpp` 里 `log`/`authors`/`blame`/`file_history`/`show_commit` 对 `detail::run/require_ok/trim/checked_ref/checked_path/split_lines/utf8_to_wide/parse_records` 的调用全部解析到 `git.cpp` 那一份实现，**没有重复符号、没有 LNK2001**；
   · 反向再确认：搬走后 `git.cpp` 里对 `split_lines` 的 `using` 变成零调用点 ⇒ 我把那条 `using detail::split_lines;` 删掉（定义仍留在 `git.cpp`，因为 `git_worktree.cpp` 与新 TU 要的那一份实现就在这里），重新构建 + ctest 仍 36/37（无新红）。

---

## 6. 别人的在途红（**按令未改**，只报现场）

| # | 现场 | 证据 | 我为什么判定不是本次搬动 |
|---|---|---|---|
| R1 | `#17 git_status_vcs` 唯一红：`FAIL commit with a path subset commits only the selected files: 工作区重新干净`（`native/git_test.cpp:310-343`，红在 `:342` 的 `check(status(root).empty(), …)`） | 这三处 hunk 都是 05:45-05:47 落地（`native/git.hpp` 的 `commit(...,paths)` 声明 +8/-1、`git.cpp` 的 `--only` 实现、`git_test.cpp` +41 行），我开工（06:05）之前 | ① 我没动 `commit()`/`status()`/`stage()`/`checked_path()` 任何一行（第 4 节的删除行筛查零命中）；② 我在 `build/tmp-git-repro` 里**照它的命令行逐条**跑了一遍 shell：`add -- a` → `commit --only -m … -- a` → `add -- c` → `commit --only -m … -- c` → `commit -m "scoped: the rest"`，三步后 `git status --porcelain` 为空 ⇒ `--only` 那条链路本身是对的；③ 红的那条检查要求**整个仓库零变更**，而它前面的场景 `stash saves and restores uncommitted changes`（`native/git_test.cpp:224-236`）`put(root/"a.txt","stashed-content")` → `stash_save` → `stash_pop` 后**没有收尾清理**，`a.txt` 从此一直是「已修改未暂存」；同一场景里它前面的 `check(a == nullptr, …)` 只看 `scope-a.txt` 所以不报，直到这条"全局干净"断言才第一次撞上；④ 该场景内 `log()`（我搬走的）两条断言 `:322-324`/`:329-331` 在红之前 **PASS**。⇒ 归 vcs 代理（要么给 `stash` 场景补收尾，要么把这条断言改成"除 a.txt 外"的具体形状；**改断言由归属代理做**，不许我改成 `includes`） |
| R2 | 全量重建撞编译错：`native/zipstore_test.cpp(43-44): error C3493 无法隐式捕获 "put16" / C2326`（文件 mtime **06:19**） | ninja 在 `[2/30]` 停住 ⇒ 我最后一次 `npm run test:native` 是对**上一次成功构建的产物**跑的（我的 `native/git*` 改动那时已进产物，之后我没再动 native） | 不在我可改面（`native/zipstore_test.cpp` 不匹配 `native/git*`），按派单只报不改。影响：主代理合并时若看到"构建红"，根因在这四条 `put16` lambda 捕获（`[&]`/`[=]` 缺一个），与 git 拆分无关。**06:3x 复跑时该域已自己修好 ⇒ 全量构建 `[36/36]` 成功，最终 ctest 是在干净产物上跑的** |
| R3 | `tests/source-citation-anchors.test.mjs` 1 红：`moved :: src/fileTypeDetection.ts \| platform/ide-core/src/com/intellij/openapi/fileTypes/NativeFileType.java \| 48-51` | 该文件 mtime **06:16**（我开工后）；我开工时同一门是 11/11 全绿 | 不在我可改面（只许改 `src/vcs*` 与自己名下）。⇒ 归 fileTypeDetection 的代理：要么把快照重算，要么把那条引用指回真位置。**收工复跑该域已自己收掉 ⇒ 引用门 11 pass / 0 fail**，此条只作过程留痕 |
| R4 | `node .tools/find-orphan-modules.mjs --gate` 新增 1：`src/structuralCodeBlock.ts` | 派单明令不许碰 `src/structural*` | 桶 9 在途 |
| R5 | `npx vue-tsc -b --force` 1 错：`src/components/TestRunnerPanel.vue(238,59) TS7053`（`'declaration'` 不在排序对象上） | 不在我可改面 | 桶 11 在途 |

（`src/components/SearchPanel.vue(902 行)` 那次红在我跑第二遍时自己消失，说明该域代理已收，不计入。）

---

## 7. 零消费方自查结论

本次**没有新增模块**，只是把 6 段已有实现换 TU，所以不存在"只过自己测试的死模块"：
· 被搬走的五支仍由 `native/git.hpp:81`（`log`）、`:141`（`blame`）、`:146`（`file_history`）、`:151`（`show_commit`）、`:74`（`authors`）公开声明，宿主分派链一行未改；
· 消费证据 = 链接成功 + `git_test` 里 `log lists commits`、`blame annotates each committed line`、`git.authors lists each log user once` 三条 PASS；
· `native/git_detail.hpp` 新增的四条声明各自有 ≥2 个 TU 使用（`trim`：`git.cpp` 9 处 + `git_log.cpp` 的 `authors`；`checked_ref`：`git.cpp` 8 处 + `git_log.cpp` 的 `show_commit`；`checked_path`：`git.cpp` 的 `commit` + `git_log.cpp` 的 `file_history`；`parse_records`：`git.cpp` 的 `stash_list` + `git_log.cpp` 的 `log`/`authors`）⇒ 不是"为拆而拆"的空壳声明。
· 一处**登记说明**变得不准（`module-size.test.mjs` 里 `native/git.cpp` 的 note 写着「追溯/文件历史留在本文件」），那是主代理独占文件 ⇒ 已写进 `docs/wiring-requests-2026-10-06-fix-git-split.md` W1。

---

## 8. 做不到 / 无法核实

1. **拿到 ctest = 37/37**：做不到（不是我没构建成功）。中途一次全量重建确实被 `native/zipstore_test.cpp` 06:19 起的四条编译错挡在 `[2/30]`（R2，该域随后自己收掉，最后一次 `[36/36]` 链接成功）；但即便产物干净，`#17 git_status_vcs` 仍稳定红一条 —— 卡点在别人在途的 `commit(..., paths)` 夹具（R1），修它越界。⇒ 交付数字 **36/37**，且这 1 条与本次搬动的六段实现无关（同一二进制里 `log`/`blame`/`authors` 三条场景 PASS）。
2. **把那条红改成绿**：做不到且不该做。红因在 `native/git_test.cpp` 的共享夹具（R1 ③），改它 = 改别人在途的判据（要么补夹具清理、要么重排断言），两条都归 vcs 代理；规约禁止我放松既有断言。
3. **降 `native/git.cpp` 的上限 938 → 800**：做不到，`tests/module-size.test.mjs` 主代理独占 ⇒ 写进 W1，附可直接照抄的替换代码。
4. **`ExpandGraphAction.java` 那条为什么没被门拦住**：已核实原因（引用门 `只收完整路径带行号的上游引用`，裸文件名不收），不是"门坏了"；但**能否把裸文件名形状也纳入门**不归我判 ⇒ 写进 W4 供主代理决定。
5. **上游中文文案**（`action.title.collapse.linear.branches` 的本地化串）：本地参考树里没有随 IDE 发货的 zh 包，`无法核实` 中文原文 —— 这一段是既有注释里写的（`src/vcsLogGraph.ts:104-105`），本次未改动、也未采信它做新结论。

---

## 9. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-fix-git-split.md`：
W1 降 `native/git.cpp` 上限并改写登记说明（给可照抄整段）；
W2 给 `native/git_log.cpp` 设一条硬上限（它现在吃 `NATIVE_DEFAULT_LIMIT` 1100 的默认档）；
W3 声明"本次无 `CMakeLists.txt` 请求"（没新建 `.cpp`）；
W4 路由 R1/R2/R3/R5 四条在途红到各自归属代理；
W5 `.tools/family-ownership.csv` 三行 `native/git.cpp` 落点补一句 `native/git_log.cpp`。
