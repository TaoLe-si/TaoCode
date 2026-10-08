# 批 · 2026-10-06 · preflight（提交前检查的**结果指纹改用文档修订号**）

一句话：`commitChecksFingerprint` 里"内容又变了"那一维改成**每篇文档的修订号**（上游 `Document.getModificationStamp()`
的直接等价物），并把上一版那道"这篇必须在变更列表里"的筛**撤掉**——那不是上游的筛，正是它让"同一篇 git 侧干净的
文件在编辑器里改第二次"永远不作废上一轮 PASSED。判据两条：改一次 ⇒ 结果作废；不改 ⇒ 结果仍复用。

## 1. 上游坐标（本批 `sed -n` 逐行打开核过，相对 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）

| 项 | 判定 | 上游 | 本仓落点 | 一句话 |
|---|---|---|---|---|
| 作废机制 | `[x]` | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt:215-226`（`:218` 已 UNKNOWN 早退 / `:221` `getFile(event.document)` / `:222` 过筛 / `:223` `resetCommitChecksResult()`） | `src/sourceControlCommitChecks.ts:145-148` 的 watch + `commitChecksShouldReset` | 上游是**每篇文档每次文本变更**触发一次作废 |
| 那三道筛 | `[x]` | 同文件 `:190-200`：`:193` `getVcsFor(it) != null`、`:198` `isInContent(it) && getStatus(it) != FileStatus.IGNORED` | `src/commitChecksResult.ts` 的 `documentAffectsCommitChecksResult`（新出口） | **没有一道问"它在不在变更列表里"** ⇒ 上一版那道筛是自造的 |
| 修订号本体 | `[x]` | `platform/core-api/src/com/intellij/openapi/editor/Document.java:183-192`（声明 `:191-192`）+ 类注释 `:25`；换号 `platform/core-impl/.../DocumentImpl.java:171`；号源 `DocumentModStamp.java:6-12`（`next()` = `LocalTimeCounter.currentTime()`） | `src/commitChecksResult.ts` 的 `DocumentRevision` + 指纹第 3 段 | 改一次换一个、不必递增 1、与文件时间无关 |
| 号当缓存键的先例 | `[x]` | `java/execution/impl/src/com/intellij/execution/filters/ExceptionLineParserImpl.java:318`（记号）+ `:320`（`expireWhen(… != stamp)`） | 同上 | "结果依附在哪一号上、号一变就过期"上游确实这么写 |
| **`CommitCheckService` / `DocumentCommitCheckService`** | **无法核实** | `platform/vcs-impl`、`platform/dvcs-impl`、`platform/vcs-api` 下按文件名 `find` + 全文 `grep` **零命中**，两处 `api-dump.txt` 里也没有 | —— | 这两个名字在本参考树版本里不存在 ⇒ 不照它编 API，机制改按上面当场核过的坐标落 |

## 2. 改动（只动了派单许的三件；宿主面一律只写请求）

| 文件 | 批前 | 批后 | 进去的东西 |
|---|---|---|---|
| `src/commitChecksResult.ts` | 179 | 189 | 指纹签名 `(..., editorEpoch: number \| null, revisions)` → `(..., revisions)`；新增 `documentAffectsCommitChecksResult`（只实现算得出的那道非 IGNORED 筛）；修订段不再被"必须在变更列表里"限死；坐标/留痕注释重写 |
| `src/sourceControlCommitChecks.ts` | 355 | 366 | watch 改交三参（`documentRevisions` 没给 = `[]`）；`editorEpoch` 退出指纹（字段保留，删它会让不许动的 `SourceControl.vue:466` 那个 spread 编译断）；注释与坐标同步 |
| `tests/commit-checks-result.test.mjs` | 279 | 367 | 判据 5 条改写 + 新增 4 条（含跑真 `watch` 的行为判据）；旧的 `editorEpoch` 那条改成"快照不承担第二次键入" |
| `docs/wiring-requests-2026-10-06-preflight.md` | 0 | 76 | P1（`App.vue:554/888/2176` 按篇记号）/ P2（`toolViewContext.ts` + `ToolWindowView.vue:199` + `SourceControl.vue:88/466` 三段透传）/ P3（撤 `editorEpoch` 空转线）＋ 验收口径 |

禁区（`speedSearch.ts` / `symbolSearch.ts` / `vcsLog*.ts` / `patchApply.ts` …）一个字节没动；
`src/App.vue` 与 `native/` 零改动（`native/` 本批无需改动：修订号是编辑器内存事件，不是宿主进程的事实）。

## 3. 门禁（派单只许这一条命令，收工实跑）

`node --test tests/commit-checks*.test.mjs tests/module-size.test.mjs`

| 轮 | tests | pass | fail |
|---|---|---|---|
| 动手前（基线） | 65 | 65 | 0 |
| 改完（`commit-checks-result.test.mjs` 单跑 23 → 26） | **68** | **68** | **0** |

## 4. 反向验证：注入 `PREFLIGHT-PROBE-*` → 变红 → 撤回 → 复绿

每轮只注入一处、只跑上面那条命令。

| 轮 | 注入（都在 `src/commitChecksResult.ts`） | 红的判据 | pass / fail |
|---|---|---|---|
| A | `documentAffectsCommitChecksResult` 改回上一版那道"必须在变更列表里"的筛 | `修订号不过"在不在变更列表里"那道筛`、`只有被忽略（IGNORED）的那一篇不进修订段`、`documentAffectsCommitChecksResult：:191-199 那道筛的单独出口`、**`行为判据：改一次 ⇒ 上一轮结果作废；不改 ⇒ 结果仍复用`** | 64 / **4** |
| B | 修订段整体写死成空（第 3 档失效） | 上面 4 条 ＋ `每篇文档的修订号：同一篇改两次…`、`修订段挂在指纹末尾：没给时形状与本批之前逐字一致` | 63 / **5** |
| C | 指纹里不走 `documentAffectsCommitChecksResult`（IGNORED 那道筛失效） | `只有被忽略（IGNORED）的那一篇不进修订段` | 67 / **1** |

**A 轮第一次跑时行为判据没红**——是我自己的测试夹具错了（把 `clean.ts` 同时列进了变更列表，等于替那道筛补了通行证）；
改成 `changes = [row('a.ts')]`（`clean.ts` 只作为编辑器里的文档存在）后 A 轮才真的把它抓红。

撤回三轮注入后复跑：**68 / 68 / 0**。
残留复扫：`grep -rn "PREFLIGHT-PROBE" src/ tests/ native/` ⇒ **0**；
对本批三个文件再扫通用形状 `grep -ri -E "PROBE|注入用|INJECT"` ⇒ **0**。

## 5. 做不到 / 现状如实登记

1. **真界面上这条还没通**：`documentRevisions` 至今没人喂（`src/App.vue` 里没有按篇的号、`SourceControl.vue:88` 只有
   `editorEpoch` prop 且宿主也没传）⇒ 面板上"同一篇改两次"仍只靠 `dirtyPaths` 那份快照（第一次编辑）。
   模块侧判据已钉死，宿主一接 P1+P2 就生效——**不放假控件**：界面上没有一行依赖它才出现。
2. **上游那三道筛只落地了一道**。`getVcsFor != null`（`:193`）与 `isInContent`（`:198`）是宿主侧才知道的事实，
   本仓模块只拿得到变更列表 ⇒ 非 IGNORED 这道在模块侧算，另两道写进 P1 第 3 条要求宿主筛。
   后果：宿主若把项目外的文档也报进来，会多作废一次（宁缺毋滥的方向反过来，已在注释里写明）。
3. **`editorEpoch` 的删除是两步走**：本批先让它退出指纹、字段留着保面板编译；面板清干净后由 P3 删字段。
4. **没跑 `vue-tsc`**（派单只许那一条命令）⇒ 类型面只做了替代核查：`grep -rn commitChecksFingerprint src/ tests/`
   确认生产侧唯一调用点是 `src/sourceControlCommitChecks.ts:145`，签名改完没有第二个调用方；主代理合批后请补跑一次。
