# batch 2026-10-06 · 代号 `verdictbook`（判决文档编辑权这一轮归我）

任务：把三条**已核完**的判词请求（fold3 R-1…R-8 / patch2 A、B / status2defect W1）落到判决文档里。
铁律执行方式：每一条先自己打开**本仓 `文件:行号`** 与**上游 `文件:行号`** 两侧核对，过了才动档；
没过的不升，只在本报告里写「请求说的证据不成立 · 我实际看到什么」。
上游唯一真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（没搜网）。

## 1. 逐条「改前 → 改后」

### 1.1 fold3（折叠域）

| 条目 | 旧档 | 新档 | 我打开过的本仓坐标 | 我打开过的上游坐标 | 结论 |
|---|---|---|---|---|---|
| **R-1** `lp/custom-folding`（py 族，产物 `verdict-platform_rest.md:325`） | `[~]` | `[x]` | `src/customFoldingPopup.ts:1-152`（`regionNavigateSpec:42`、`createCustomRegionsPopup:54`、空列表提示 `:29`）、`src/customFoldingRegions.ts:111-119` 排序+层数 / `:128` `nextCustomRegion` / `:138` `regionIndent`、`src/customFoldingSurround.ts:57-112`（`snapToLines`+`surroundWithRegion`）/`:123-132`（三个 provider 各一条）、`src/customFoldingProviders.ts:139-155`（`markersPair`/`matchingStartIndex`）/`:172-189`（`placeholderOf`）/`:197-203`（`collapsedByDefaultMarker`）、`src/components/CodeEditor.vue:915-921`（Ctrl+Alt+. 真入口 + 无区域提示）、`:941`（弹层 extension 挂载）、`src/editorCommands.ts:48`+`:202`+`:231`（surround 命令有消费方）、`src/customFoldingProviders.ts:60/71/89`（provider 恰三条）；判据 4 份都在（144/120/105/69 行） | `platform/lang-impl/src/com/intellij/lang/customFolding/CustomFoldingRegionsPopup.java:23-41`/`:58`/`:62-78`/`:80-88`、`GotoCustomRegionAction.java:40-66`、`platform/lang-impl/src/com/intellij/lang/folding/CustomFoldingSurroundDescriptor.java`（332 行，存在）、`platform/core-api/src/com/intellij/lang/folding/CustomFoldingBuilder.java`+`CustomFoldingProvider.java`（全树 `find` 只这几份，**没有** `CustomFoldingOptionsProvider` ⇒ 配置面判 `[-]` 成立） | **升**（改 py:312 的 tuple，产物重算，不手改 md） |
| **R-2** `BaseFoldingHandler`（`verdict-folding.md:184`） | `[~]` | `[x]` | `src/editorFolding.ts:645` `selectionScoped`（逐条对上：空选区→null=全集、搭界 + 整条在内、空结果→全集）、`:659` `foldAllCommand`、`:676` `unfoldAllCommand`；判据 `tests/folding-selection-scope.test.mjs:66-70`（边界四档）、`:92-136`（端到端「只有选区里那条展开了」+ 命令表接线） | `platform/foldings/.../actions/BaseFoldingHandler.java:44-56`（`caret.hasSelection()` → `getRegionsOverlappingWith` + `selectionRange.contains(region)`，空则 `getAllFoldRegions()`）——**与 `selectionScoped` 逐条同形** | **升** |
| **R-2** `CollapseAllRegionsAction`（`:185`） | `[~]` | `[x]` | 同上（`:659` 先问 `:645`）；两段式退化的分析照请求原样保留 | 同上 + `FoldingBuilder.java:65-70`（默认 false，写在 `src/editorFolding.ts:640-642` 的注释里，本轮只复核该行未动） | **升** |
| **R-2** `ExpandAllRegionsAction`（`:191`） | `[~]` | `[x]` | `src/editorFolding.ts:676-679`（折着的集合再过 `selectionScoped`） | `BaseFoldingHandler.java:44-56` | **升** |
| **R-3** `UpdateFoldRegionsOperation`（`:180`，另订正 §C⑤ `:85-86` 那句「仍缺」） | `[~]` | `[x]` | `src/editorFoldingController.ts:82-95`（`applyDefaults`：重算轮次只展开关着的那一族、不再按默认折）、`:50` `builtFor`、`:169`（真拿到区间才打标记）、`:126`/`:145` `applyNavigation`、`src/editorFolding.ts:813` `unfoldIntersecting`；判据 `tests/folding-navigate-unfold.test.mjs:139-161`（第一次=EXCEPT_CARET_REGION、重算=NO）、`:163-178`（空回包不算建过）、`:180-184`（管道 ⑦ 接线） | `platform/foldings/.../FoldingUpdate.java:154-156`（**只在 NO 与 EXCEPT_CARET_REGION 之间二选一**）、`UpdateFoldRegionsOperation.java:47`（枚举定义）+ 全树 `grep -r "ApplyDefaultStateMode.YES"` **零命中** ⇒ `YES` 判 `[-]` 成立 | **升**（`YES` 附具体理由判 `[-]`，§C⑤ 那句划掉改「已落」） |
| **R-4** `CodeFoldingManager`（`:155`） | `[~]` | `[x]` | `src/editorFolding.ts:274` `areasContaining`、`:392` `enclosingAreas`、`:475` `foldedAreasOf`、`:480` `candidatesOf`、`:258` `isCollapsedIn`（生产消费方：`src/editorFoldingController.ts:58/101/109/162` + 同文件调用点，非零消费） | `platform/foldings/src/com/intellij/codeInsight/folding/CodeFoldingManager.java:31/33/35/38/40/42/44/29`（75 行，逐行打开：`:33` 就是 `getFoldRegionsAtOffset` ⇒ 那句「缺按偏移查询的公开面」**确实为假**）、`platform/platform-impl/.../FoldingUtil.java:46-58` | **升** |
| **R-4** `CodeFoldingManagerImpl`（`:156`） | `[~]` | `[x]` | `src/editorFoldingController.ts` 的 `schedule`/`run`/`capture`/`restore` + `:50`/`:169` 的标记面；`src/editorFolding.ts:700` `foldSelectionOutcome`（`markAsAutoCreated` 的等价档） | `platform/foldings/.../impl/CodeFoldingManagerImpl.java`（346 行；`isCollapsedByDefault:140`、`keepExpandedOnFirstCollapseAll:145`、`markAsAutoCreated:157` 等逐条打开过，都有本仓替身或已在别的行登记为缺） | **升** |
| **R-5** `FoldingUtil` 行（`:182`） | `[~]` | `[~]`（不动） | 同 R-4 那批 | `platform/platform-impl/.../FoldingUtil.java`（**实际 120 行**，非请求说的 121）：`isHighlighterFolded:60-67` ✓、`isTextRangeFolded` 是 **`:69-72`**（原文 `:69-76` 错）、`createFoldTreeIterator:77-119` | **订正措辞**：那两个重载改判 `[-]`（入参 `RangeHighlighterEx`/`PsiElement`）+ 行号订正；请求里「文件只有 121 行」这句我核到的是 120 行，故文档里写 120 |
| **R-6** `DocumentFoldingInfo`（`:166` + §C③ `:71-72`） | `[~]` | `[x]` | `src/editorFoldingState.ts:205-228` `restorePlan`（偏移 + 起点整行原文都对才放回，否则按签名认回，认不回就放弃）、`native/folding_state_schema.cpp`（存在） | `platform/foldings/.../DocumentFoldingInfo.java:314-341`：`date` 只在 **`MARKER_TAG`** 那一支才问（`:326-335`，`:333` 叠加 `isDocumentUnsaved`），`ELEMENT_TAG`（`:322-324`）不看日期 ⇒ 请求说的「那道闸只管手工区间那一半、本仓逐条更细」**成立** | **升**（真 mtime 属 W-3，本轮按请求结论：不做，只订正判词） |
| **R-7** `CodeFoldingSettings`/`CodeFoldingSettingsImpl`（`:153`/`:154`） | `[~]` | `[~]`（不动） | `src/editorFoldingSettings.ts`（`autoCollapseKinds` 只映射 imports/region，`tests/editor-folding-settings.test.mjs` 钉着） | `java/java-psi-impl/.../JavaCodeFoldingSettingsBase.java:67`（`COLLAPSE_METHODS`）、`:106`（`COLLAPSE_DOC_COMMENTS`）、`:116`（`COLLAPSE_FILE_HEADER`）——三行逐字打开、`platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt:41-46`（只有 Imports/Region，Comment 起手写 null）、`platform/core-api/.../CodeFoldingSettings.java:7-11`（五个键的默认值） | **订正措辞**：那三键从「缺」改判 `[-]`（消费者只有语言侧 builder，渲染出来是零消费方空壳 ⇒ 规约 §3）；档位不动 |
| **R-8** 控制台折叠那 6+3 行的证据句（`docs/inventory/verdict-settings-run.md:867`/`1579`/`1592`/`1597`/`1607`/`2515`/`298-300`） | — | **未动** | `src/consoleFold.ts` **存在**，且真被消费：`src/runIssues.ts:17` 引 `foldConsoleLines`、`src/components/RunConsole.vue:8`/`:84`/`:87`（连续重复行合并成 `×N`）、设置页 `src/components/ConsoleSettingsPage.vue:5` ⇒ 「`ConsoleFolding` 一族在本仓从未出现」这句**取证口径确实错了**（它扫的是类名） | 未查（本轮不需要：不改档） | **不落**：`docs/inventory/verdict-settings-run.md` 不在我这轮的编辑权清单里（只给了 folding/editor/find-diff/platform_rest/vcs + py + b4/b7 计数行）。请求的证据我已独立复核，改动留给主代理或 settings-run lane |

`docs/wiring-requests-2026-10-06-fold3.md` 的 W-1/W-2/W-3 是宿主接线（`src/App.vue`、`src/components/CodeEditor.vue`、`native/`），不属判决文档，本轮**没动**；其中 W-1 的出口已复核真实存在（`src/editorFolding.ts:686`/`:700`/`:732`），`CollapseSelectionHandler` 那一行因此**保持 `[~]` 不动**。

### 1.2 patch2（A、B）

| 条目 | 旧档 | 新档 | 我打开过的本仓坐标 | 我打开过的上游坐标 | 结论 |
|---|---|---|---|---|---|
| **A-1** `vc/diff` 族判词里「三方合并编辑器…本仓只有 `src/mergeConflicts.ts` 的标记文本逐条接受」 | 族 `~`（文字过期） | 族 `~`（文字订正） | `src/mergeResolve.ts:45`/`:266`/`:318-319`/`:329`/`:387`/`:408`（+ 文件头 `:404-407` 的两档口径）/`:448`/`:450`、`src/mergeResolveHost.ts:38`/`:43`/`:54`、`src/changesMenuActions.ts:64-67`、`src/components/SourceControl.vue:224-227` | `platform/diff-impl/src/com/intellij/diff/merge/ApplyNonConflictsAction.kt:12-36`（`:18` 三档 id、`:31` `hasNonConflictedChanges(side)`、`:35` `applyNonConflictedChanges(side)`） | **订正措辞**（请求说的「已落」全部核到；三栏窗口本身仍缺 ⇒ 族档保持 `~`） |
| **A-2** 同族「GNU patch 的 fuzz/偏移搜索（`GenericPatchApplier`）」 | 同上 | 同上 | `src/patchFuzzy.ts:24`（`MAX_WALK=1000`）/`:57`/`:89`、`src/patchApply.ts:309-312`（两级合流；请求写 `:305-311`，**我核到的合流在 `:309-312`**，已按实际写） | `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/GenericPatchApplier.java:41`（`ourMaxWalk = 1000`）、`:209-223`（fuzz 循环，`:212` 调 `complementInsertAndDelete`）、函数体 `:312-322`（请求写 `:312-320`，实际到 `:322`）、`trySolveSomehow:363-393` | **订正措辞**：偏移搜索已落、只剩「吃掉上下文行」那一档 fuzz |
| **A-3** 同族追加「生成侧块头账目」 | — | — | `src/diffText.ts:127-145`（`:144` 按正文实际行数写 `@@ -a,b +c,d @@`）、判据 `tests/patch-hunk-counts.test.mjs` | `platform/vcs-impl/.../patch/UnifiedDiffWriter.java:220-225`（`writeHunkStart` 的 `String.format("@@ -%s,%s +%s,%s @@")`）、`platform/vcs-api/vcs-api-core/.../PatchHunkUtil.kt:10-30`（`getRange` 的三类行计数） | **已落**（请求给的行号与我看到的一致） |
| **B** `verdict-find-diff.md:507` `ApplyNonConflictsAction` | `[~]` | `[x]` | `src/mergeResolve.ts:408`+`:404-407`+`:450`、`src/mergeResolveHost.ts:43`、`src/changesMenuActions.ts:67`（谓词 `available: c => Boolean(c.conflicted)`）、`src/components/SourceControl.vue:227`、判据 `tests/merge-resolve.test.mjs`（跑过，见 §3） | 同 A-1 那条 `.kt:31`/`:35`/`:18` | **升**（残余差异「上游逐侧 / 本仓整文件一档」写进行里）；同步 `:72` 来路段、`:303` 计数冻结、`:941` 页脚 → `[x] 32 / [~] 351 / [ ] 0 / [-] 247`，并改 `tests/b7-verdict.test.mjs:102` 注释与 `:108` 的 `[31,352,0,247]` → `[32,351,0,247]` |
| C / D / E / 说明 F | — | **未动** | — | — | 不在本轮派单范围（任务只给 A、B）。**但请求 D 说的矛盾现在真的存在**：`verdict-find-diff.md:157` 仍写「没有 `ApplyNonConflicts`」、`:508`/`:509` 两行仍把 `ApplyNonConflicts` 列进「仍缺」——与我升上去的 `:507` 冲突，要主代理按 D 收（那是同一路径下的叙述，不是我改坏的）。请求 E（`verdict-vcs.md` 的 `native/git.cpp:*` 失效锚点）与 F 本轮都没碰 |

### 1.3 status2defect（W1）

| 条目 | 旧档 | 新档 | 我打开过的本仓坐标 | 我打开过的上游坐标 | 结论 |
|---|---|---|---|---|---|
| **W1** `pf/progress` 判词那句「本仓任务不能暂停」（真源 `scripts/verdict_table.py:348`，产物 `verdict-platform_rest.md:171`） | 族 `~` + 假句 | 族 `~`（句子换成已落 + 还差） | `src/progressSuspender.ts:1-12`（文件头的逐条对照）、`:45-56`（接口）、`:73-131`（`createProgressSuspender`：`:86` 临时 reason 优先、`:89` 已挂起即空操作、`:129` 取消即 resume）、`:134-160`（`ProgressSuspenderTracker`）、`src/backgroundTasks.ts:184`（响应式挂起原因）、`:278-288`（`setSuspended`）、`:289`（`isSuspended`）、`:349`+`:364-370`（`queueRow` 的「已挂起：<原因>」）、`:272-273`（已删的零消费面注释）、唯一入队消费者 `src/gradleHost.ts:204-208`（**那条 run 不带 indicator**）、触发点 `src/notifications.ts:298`；判据 `tests/progress-queue-suspend.test.mjs` | `platform/platform-impl/src/com/intellij/openapi/progress/impl/ProgressSuspender.java:79-81`（`markSuspendable`）、`:106-110`（`getSuspendedText` 的临时优先）、`:121`（「displayed in the UI … until the progress is resumed」）、`:123-137`（`suspendProcess`，`:125` 早退）、`:139-152`（`resumeProcess`）、`:154`（`freezeIfNeeded`）；`platform/progress/shared/src/suspender/TaskSuspension.kt:24-25`；`platform/platform-impl/.../TaskInfoEntityCollector.kt:174`/`:177`；同目录 `TaskToProgressSuspenderSynchronizer.kt` 存在（⇒「还差双向同步」写得住） | **订正措辞**（请求写 `:121-137`，我核到的函数体是 `:123-137`，`:121` 单独作为那句 UI 显示的出处；档位不动，还差项照请求写明）。产物经 `python scripts/verdict_table.py platform_rest` 重算 |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 说明 |
|---|---:|---:|---|
| `docs/inventory/verdict-folding.md` | 207 | 209 | 7 行 `[~]`→`[x]`、2 行措辞订正、§C③/§C⑤ 两句订正、表尾四档 `3+37`→`10+30` + 本轮来路段 |
| `docs/inventory/verdict-editor.md` | 2833 | 2833 | 镜像同步：同样 7 行翻档 + 4 处措辞订正（`:960`/`:1229`/`:2097` 只改文字）+ 头部 `四档合计 **43 + 1044 + 225 + 1239**` → `**50 + 1037 + 225 + 1239**` + 表尾注释；`git diff` 12 增 12 删，无重排 |
| `docs/inventory/verdict-find-diff.md` | 941 | 942 | `:507` 升档 + 理由、`:72` 追加来路段、`:303` 计数冻结、`:941` 页脚 |
| `docs/inventory/verdict-platform_rest.md` | 390 | 390 | **脚本重算产物**（`:171` `pf/progress`、`:325` `lp/custom-folding`→`[x]`、合计行） |
| `docs/inventory/platform_rest_verdict_table.json` / `.md` | — | — | 同上，脚本重算（`.json` 154 行变动、`.md` 14 行）；族档 `[x] 22→27`、`[~] 5423→5418`（`lp/custom-folding` 族 5 个类翻档） |
| `scripts/verdict_table.py` | 1034 | 1034 | 4 处：`:312` 档位+句子、`:348` 句子（拆成「已落 / 其余缺」两段，避开「缺：…已落…」的病句）、`:408` 三处替换 |
| `tests/b4-verdict.test.mjs` | 105 | 109 | 只动钉死数字那几行：`count('[x]') 3→10`、`count('[~]') 37→30`、表尾正则 `3+37→10+30`，加 4 行来路注释；**没放松任何断言** |
| `tests/b7-verdict.test.mjs` | 152 | 157 | `[31,352,0,247]`→`[32,351,0,247]` + 注释来路 5 行；没动其它断言 |

## 3. 门禁原始输出

```
$ node --test tests/b4-verdict.test.mjs tests/b7-verdict.test.mjs
ℹ tests 16
ℹ pass 16
ℹ fail 0

$ node --test tests/b12-verdict.test.mjs          # 因为动了 verdict-editor.md 的档与头部计数
ℹ tests 9
ℹ pass 9
ℹ fail 0

$ node --test tests/verdict-generated.test.mjs    # 因为动了 platform_rest 生成物
ℹ tests 5
ℹ pass 5
ℹ fail 0

$ python scripts/check_verdict_tables.py
本文件是核对引擎，不单独跑。请用：
  python scripts/verdict_table.py --check  <域…>   # CI：不一致非零退出
  python scripts/verdict_table.py --dry-run <域…>  # 只看差异，不写盘
EXIT=0

$ python scripts/verdict_table.py platform_rest
platform_rest: total=20574 [x]=27 [~]=5418 [ ]=0 [-]=15129
判决书已写入 docs/inventory/verdict-platform_rest.md

$ python scripts/verdict_table.py platform_rest --check
  一致   docs/inventory/platform_rest_verdict_table.json（18732646 字节）
  一致   docs/inventory/platform_rest_verdict_table.md（1676876 字节）
  一致   docs/inventory/verdict-platform_rest.md（245319 字节）
一致 3 / 3 条产物。

$ node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs
锚点核对：快照 3000 条 / 仓里活引用 3000 条 / 未入快照 0 条 / 区间为空 1 条
ℹ tests 11
ℹ pass 11
ℹ fail 0

$ node --test tests/folding-selection-scope.test.mjs tests/folding-navigate-unfold.test.mjs \
    tests/merge-resolve.test.mjs tests/editor-custom-fold-regions.test.mjs \
    tests/folding-custom-region-providers.test.mjs tests/folding-custom-region-surround.test.mjs \
    tests/folding-region-navigate.test.mjs tests/patch-hunk-counts.test.mjs tests/progress-queue-suspend.test.mjs
ℹ tests 87
ℹ pass 87
ℹ fail 0

$ npx vue-tsc -b --force
（无输出）
VUE_TSC_EXIT=0

$ # 收工前的最终复跑（同一批六个测试文件一起点）
$ node --test tests/b4-verdict.test.mjs tests/b7-verdict.test.mjs tests/b12-verdict.test.mjs \
    tests/verdict-generated.test.mjs tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs
ℹ tests 41
ℹ pass 40
ℹ fail 1            ← 唯一一条红**不是本批改出来的**，明细见下
✖ 已入快照的每条引用，被引区间内容必须仍与快照一致
    'moved :: src/components/DebugConsolePane.vue|platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java|19-19
     —— 快照里有这条引用，仓里已经指不到它了'
（`git status` 里 `src/components/DebugConsolePane.vue` 是别的 lane 的在途文件：它把那条引用从 `:19` 改成了 `:18`，
 同批还新增了 `src/externalLinkLauncher.ts|BrowserLauncherAppless.kt:88-112`。我这轮的 9 个文件里没有这两份，
 判决文档/ py / b4 / b7 / b12 / verdict-generated 全绿；这条红的出口是**重算锚点快照**
 （`TAOCODE_CITATION_ANCHORS=update`，写的是 `docs/inventory/citation-anchors.json`，不在本轮编辑权里 ⇒ 交主代理）。）

$ # 我名下引用「新入仓、还没进快照」的那几条（门控只报数不拦）
锚点核对：快照 3000 条 / 仓里活引用 3008 条 / 未入快照 9 条 / 区间为空 0 条
    docs/batch-2026-10-06-verdictbook.md|…CustomFoldingRegionsPopup.java|23-41
    docs/batch-2026-10-06-verdictbook.md|…CodeFoldingManager.java|31-31
    docs/batch-2026-10-06-verdictbook.md|…LspFoldingBuilder.kt|41-46
    docs/batch-2026-10-06-verdictbook.md|…ApplyNonConflictsAction.kt|12-36
    docs/batch-2026-10-06-verdictbook.md|…GenericPatchApplier.java|41-41
    docs/batch-2026-10-06-verdictbook.md|…ProgressSuspender.java|79-81  …另有 1 条（都在本报告 §1 的表格里）
```

## 4. 反向验证（计数门禁还会咬人）

1. 注入违规 A：把 `verdict-folding.md` 表尾 `[x] 10` 改成 `9`（逐条表仍是 10）⇒ `b4` 红 **1**（`✖ 四档计数自洽，且与表尾那句一致`，5 pass / 1 fail）。
2. 注入违规 B：把 `verdict-find-diff.md` 页脚 `[x] 32` 改回 `31` ⇒ `b7` 红 **1**（`✖ 四档算术与页脚一致`，9 pass / 1 fail）。
3. 撤掉两处注入 ⇒ `node --test tests/b4-verdict.test.mjs tests/b7-verdict.test.mjs` 复绿 **16 / 16**。

## 5. 零消费方 / 断言纪律自查

- 本轮**没新增任何模块**，只改判决文字与 py tuple；`node .tools/find-orphan-modules.mjs --gate` 不适用（无新文件）。
- 唯一「只被文档引用」的风险由 `tests/verdict-generated.test.mjs` 第 4 条兜住：`[x]/[~]` 族判词里每个 `src/`/`native/` 路径都 `existsSync` 过（绿）；`b4` 第 2 条、`b7` 第 3 条、`b12` 第 4 条同理（都绿）。
- 我复核时特意确认了「公开面不是只过自己测试」：`candidatesOf`/`foldedAreasOf`/`unfoldIntersecting` 有 `src/editorFoldingController.ts:58/101/109/128/145/162` 的生产消费方；`areasContaining`/`enclosingAreas`/`isCollapsedIn`/`selectionScoped` 的消费点在同文件的生产命令里（`:661`/`:679`/`:283-293`/`:310-311`/`:444`/`:463`），`tests/editor-folding.test.mjs:295-300`、`:417` 还把这几条接线钉成了断言。
- **没有放松任何既有断言**：b4/b7 只按真实计数改数字（且反向验证证明仍然会红）；`b4` 的 `assert.equal(… , 69)`、`b7` 的 `630` 与 `[-] 带上游 文件:行号` 等断言一字未动。

## 6. 没做 / 做不到 / 无法核实

1. **R-8 没落**：`docs/inventory/verdict-settings-run.md` 不在本轮编辑权清单（清单只有 folding/editor/find-diff/platform_rest/vcs + `scripts/verdict_table.py` + b4/b7 计数行）。证据我独立复核过（见 §1.1 的 R-8 行），要改的是 6+3 行的**证据句**（档位不动），请派给 settings-run lane 或主代理。
2. **`vc/diff` 族的生成物没重算**（`docs/inventory/vcs_verdict_table.json`/`.md`）：`verdict-vcs.md` 里有**手写** §G（`docs/inventory/verdict-vcs.md:140`），`scripts/verdict_table.py:940` 的护栏在默认档直接拒绝生成，而 `--force` 会把那张 1783 行的手写表**整个盖掉** ⇒ 不能用。现状：`python scripts/verdict_table.py vcs --check` **在我改 py 之前就是红的**（我留了原始判断：它报「不一致 2 / 2 条产物」，且 `docs/inventory/vcs_verdict_table.md` 磁盘上根本不存在），全仓没有任何测试读这两个产物，`docs/inventory/verdict-vcs.md` 里也**不含**族判词文本（grep「三方合并编辑器」零命中）⇒ 族判词唯一真源仍是 py，已改。
3. **`verdict-find-diff.md` 的叙述与 §G 现在矛盾**（请求 D 的范围，本轮未授权）：`:157` 那句「没有 `ApplyNonConflicts`」、`:508`/`:509` 两行的「仍缺 ApplyNonConflicts」。我没有顺手改，因为派单只给了 A、B；主代理按 D 落即可，档位与四档计数都不受影响（`MergeThreesideViewerActions`/`BinaryMergeTool`/`ChangeReferenceProcessor` 保持 `[~]`）。
4. **请求里三处行号与我核到的不同**，文档里按我核到的写：`GenericPatchApplier.complementInsertAndDelete` 函数体是 `:312-322`（不是 `:312-320`）、偏移两级合流在 `src/patchApply.ts:309-312`（不是 `:305-311`）、`suspendProcess` 函数体是 `ProgressSuspender.java:123-137`（不是 `:121-137`，`:121` 是那句 UI 显示的 javadoc）；另 `FoldingUtil.java` 实际 120 行（不是 121）。
5. **git 纪律事故（不是我做的，但要说）**：另一路并行代理 11:38 提交的 `11a736e`（"fix(parity): 真机 CDP…"）把我**在途**的判决编辑一起卷了进去——`git show --stat 11a736e` 里能看到 `docs/inventory/verdict-folding.md`（32 行）、`tests/b4-verdict.test.mjs`（10 行）、`docs/inventory/verdict-find-diff.md`（7 行）、`docs/inventory/verdict-editor.md`（257 行，含别人的活）、`scripts/verdict_table.py`（6 行）。我本轮**没有 commit、没有 push、没跑任何 checkout/reset/stash/clean**；因此 §2 的「前」行数取的是 `c2ce830`（那次 commit 之前）的快照，`git diff` 现在只剩后半截。要按文件回看我的 hunk：`git diff c2ce830 -- <文件>`。

## 7. 要主代理接的线（本轮没动的、需要人拍的）

- R-8 的 6+3 行证据句订正（`docs/inventory/verdict-settings-run.md`）。
- patch2 的 C（`verdict-find-diff.md:525`）、D（`:155-159`）——D 落下去才能消掉 §6.3 那条自相矛盾。
- patch2 的 E（`docs/inventory/verdict-vcs.md` 里 8 处 `native/git.cpp:*` 失效锚点）与 F（`split_hunks` 是否按声明行数收块）。
- status2defect 的 **W2/W3**（`src/progressSuspender.ts` 的 `text()`/`suspendedText`/tracker 三条批量方法是零消费面）——那是 src lane 的活，本轮判决文档里 `pf/progress` 的「还差」只写了「任务体协作检查点 + 双向同步」，**没有**替 W2/W3 表态。
- fold3 的 W-1/W-2/W-3（编辑器内 hint、重叠确认框、`preparePlaceholder` → `{...}`）。
- **重算锚点快照**（`docs/inventory/citation-anchors.json`，不在本轮编辑权）：别的 lane 把 `src/components/DebugConsolePane.vue` 那条 `PauseOutputAction.java` 引用从 `:19` 挪到 `:18`，`tests/source-citation-anchors.test.mjs` 因此红 1 条（明细在 §3 末尾）。本轮新增的 7 条带路径引用（全在 `docs/batch-2026-10-06-verdictbook.md` 与判决文档里）门控只报数不拦，一起收进快照即可。
