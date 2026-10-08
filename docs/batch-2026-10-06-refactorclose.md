# batch-2026-10-06-refactorclose — 收 refactorfix 的半截 + 全仓最后一条 vue-tsc 语义错

lane: refactorclose（窄收尾）
上游参考树: `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用；`third_party/intellij-community` 坏树不使用）
纪律: 坐标自开；不 commit/push；禁 git checkout/reset/stash/clean；判据前缀 `REFACTORCLOSE`；不许 `as any`/`@ts-ignore`/加宽类型消 TS2345。

---

## 0. 接手现场（实测，不采信转述）

主代理转述的两条「已知同期红」：
- `src/semanticActions.ts(509,71) TS2345`
- `src/postFormatProcessors.ts(418,53) TS2304 'spacing'`

我第 1 次调用起的实测：

- `git status --porcelain`：全仓一片 `M`/`??`（多路并发，与本 lane 无关的居多）。
- `git diff --numstat`（本 lane 名下 7 个源文件）：
  - `src/postFormatProcessors.ts` 303/5
  - `src/renamePreview.ts` 57/0
  - `src/semanticActions.ts` 105/35
  - `src/organizeImports.ts`、`src/intentionList.ts`、`src/components/IntentionListMenu.vue`、`src/intentionMenuModel.ts`、`tests/refactor-organize-imports.test.mjs`、`tests/intention-list.test.mjs`、`tests/format-post-ranges.test.mjs` —— **未跟踪新文件**（numstat 里没有它们，但它们是 refactorfix 的产出主体）。
  - `src/refactor*.ts` 六个文件、`src/intentionList.ts` 之外的 `tests/refactor*.test.mjs`：**无 diff**。
- mtime（接手时 16:43）：`src/semanticActions.ts` 16:24:50、`src/organizeImports.ts` 16:11:37、`src/postFormatProcessors.ts` 16:09:59、`tests/refactor-organize-imports.test.mjs` 16:10:40、`tests/format-post-ranges.test.mjs` 16:09:32、`src/renamePreview.ts` 15:42:34、`src/intentionList.ts` 15:18:51、`src/components/IntentionListMenu.vue` 15:18:52。
  ⇒ 接手时**没有任何一处在 5 分钟写入窗内**（最近的一次距今 ≈19 分钟）；判定为「前任已停笔」，非「在飞」，
  于是本 lane 才动 `src/renamePreview.ts` 与 `tests/rename-file-conflict.test.mjs`。
  **收工时同一把尺子再量一次**：`src/vcsLogPresentation.ts` 17:02:58、`native/workspace.cpp` 17:02:47、
  `tests/rename-file-conflict.test.mjs` 17:05:53 都已落进写入窗 ⇒ 那三处是**别人的在飞工作**，
  本 lane 全部只登记不修（详见 §4.6）。
- `npx vue-tsc -b --force`（接手时跑了两遍）：**exit 0，输出 0 字节** ⇒ 无 TS1xxx 语法错、无语义错。
  这条「绿」不当结论用：先证这道闸**能红**（§3 `REFACTORCLOSE-PROBE-0` 当场打出 TS2345），
  再逐个开文件复现派单那两条红（§2.1 / §2.1 末条）。
- `node --test tests/refactor*.test.mjs tests/intention*.test.mjs tests/format*.test.mjs tests/module-size.test.mjs`
  = **166 tests / 166 pass / 0 fail / exit 0**。
  ⇒ 但派单这个 glob **盖不住本 lane 名下的第三份新测试** `tests/rename-file-conflict.test.mjs`
  （钉 `src/renamePreview.ts` 的 `renameTargetConflict` 与 `semanticActions.ts` 的接线顺序，
  文件名既不以 `refactor` 也不以 `intention`/`format` 开头）：单跑是 **`21 tests / 19 pass / 2 fail`**。
  这 2 条就是本轮唯一真实存在的红，而且**都是判据自己写错**（不是功能坏），修法与不放松的理由见 §2.2。
- `node .tools/find-orphan-modules.mjs --gate` = **exit 0 · 已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2 · 门禁绿**（§4.3）。
- 隔离 tsconfig `--noEmit`：`vue-tsc` 与 `tsc` 双跑均 **exit 0 / 0 行输出**（§4.4）。
- 未跑全量 `npm test`（按派单）。

## 1. 归属判定：哪些 hunk 是 refactorfix 的

依据：`docs/batch-2026-10-06-refactorfix.md`（只有 §0 落了字，§1–§5 是空 checkbox ⇒ 典型「代码已落对、只是没报告」）+ `docs/wiring-requests-2026-10-06-refactorfix.md`（R1/R2/R3 全文已成稿，且逐条引用了盘上真实行号）。

| 产出 | 归属证据 | 状态判定 |
| --- | --- | --- |
| `src/organizeImports.ts`（新，未跟踪） | 文件头 `:27-31` 自证「本轮 `vue-tsc -b --force` 实测到的就是这条 TS2345」；引 wiring R2 | **已核：`type` 别名（`:33`）在位；探针能复现 TS2345 ⇒ 落完且自洽（§2.1）** |
| `src/semanticActions.ts:19/:499-521` 的 `runOrganizeImports` 改走 `organizeImportsRequest/ActionOf` | wiring R1 引的 `:494` 现在漂到 `:499`（前任自己加了 5 行说明） | **已核：调用点 `:514`，`request(..., organizeImportsRequest(tab.path))` 形状与 `bridge.ts:876` 对齐 ⇒ 落完且自洽** |
| `src/semanticActions.ts:575-591` `renameEntryWithReferences` 双闸 | 注释自引 `docs/...refactorfix.md` R3 | **已核：`renameTargetConflict`(`:576`) → `renamePreviewOf`(`:586`) → `file.rename`(`:588`)，顺序对，判据在 `tests/rename-file-conflict.test.mjs:128-142`** |
| `src/renamePreview.ts:228-286` `renameTargetConflict` + Message（新 60 行） | wiring R3 引 `:257-259`/`:262`；代码注释自引 R3 | **半截（本 lane 收）**：函数体正确，但钉它的 `tests/rename-file-conflict.test.mjs` 两条判据写反 ⇒ 见 §2.2。本轮只把 `:247-258` 的上游坐标改成逐行实测值（注释 only，函数体一字未动） |
| `src/postFormatProcessors.ts`（+303）`enabledProcessingRanges`/`shiftRangesThroughEdits`/`postFormatRegions`/`processKeepBlankLines`/`processFormattedText`/行扫描钳位 | 文件头与 `:412-420` 自证「这就是那条无限循环的真入口（本轮实测）」 | **已核：调用点 `:421` 消费 `:418` 声明的 `spacing` ⇒ 派单点名的 TS2304 已闭；判据 `tests/format-post-ranges.test.mjs` 全绿（含 `SCANNER_PROBE_TEXT` 那条带超时护栏的死循环回归）** |
| `src/semanticActions.ts:226-292` `runFormatting` 改走 `postFormatRegions` + `processFormattedText` + 两笔报数分开 | 注释自引 `CoreCodeStyleUtil.java:121-142` | **已核：实参恰好 4 个，与 `processFormattedText(text, ranges, settings, style)` 逐位一致（`postFormatProcessors.ts:394-399`）⇒ 自洽** |
| `src/semanticActions.ts:621` `applyEditsToFiles` 的 `· 更新 ${count} 个文件` | `tests/refactor-organize-imports.test.mjs:158-162` | **已核：空 count 那一格在（`:621`），判据逐字钉住 ⇒ 自洽** |
| `src/intentionList.ts` / `src/intentionMenuModel.ts` / `src/components/IntentionListMenu.vue`（均 15:18 同批） | `docs/batch-2026-10-06-intentw.md` §5/§6 自称并逐条核过（四个 `INTENTW-PROBE`） | **归 `intentw`，不是 refactorfix**（mtime 15:18 早于 refactorfix 那一批 15:42–16:24；且它报告里逐条引了这三个文件）⇒ 本 lane 未触碰（§5.5） |
| `tests/refactor-organize-imports.test.mjs`（新） | 文件头引的上游坐标与 wiring R2 同一批；`:34-37`/`:75-80` 两处「订正留痕（2026-10-06 refactorfix）」 | refactorfix 的：落完且自洽（13 条判据全绿，含 `:107-111` 那三条负判据先剥行注释再逐字符比——**不是放松**：剥完仍要求代码里 0 次出现，见 §5 备注） |
| `tests/rename-file-conflict.test.mjs`（新） | `:34`/`:75` 的订正留痕署名 refactorfix；`:149` 引 `explorerActions.ts` | refactorfix 的：**接手时 2 条红**（本 lane 已收，§2.2） |
| `tests/format-post-ranges.test.mjs`（新） | `:202-268` 的 `SCANNER_PROBE_*` 一族带 worker 超时护栏，正是 refactorfix 自称「本轮实测的无限循环入口」那件事 | refactorfix 的：落完且自洽 |

`src/refactor*.ts` 六个文件、`tests/refactor-{host-assembly,introduce-parameter-object,member-move,menu-parity,preview,preview-tree,safe-delete,signature,unwrap-chooser}.test.mjs`：
接手时 **mtime 全部在 00:02–09:25**（远早于 refactorfix 那批 15:42–16:24），`git status` 里只有
`src/refactor*` 无 diff ⇒ 不是 refactorfix 的在飞工作，本 lane 未触碰。

**mtime 归属结论**：refactorfix 停笔时（`16:24:50`，`src/semanticActions.ts`）代码侧是**落完的**，
TS2345 也是它自己修掉的；它留下的半截只有两样——
①`docs/batch-2026-10-06-refactorfix.md` 的 §1–§5 空 checkbox（没报告），
②`tests/rename-file-conflict.test.mjs` 的两条**判据方向写反**（不在派单 glob 里 ⇒ 一直没人看见）。


## 2. 修法

### 2.1 派单点名的 `semanticActions.ts(509,71) TS2345`：盘上**已被前任修好**，本 lane 做的是复现 + 钉死，不是重做

- 根因（自己开的，不采信转述）：`src/organizeImports.ts:33` 那个请求形状如果是 `interface`，TS 就**不给隐式索引签名**，
  喂进 `src/bridge.ts:876` 的 `request<T>(method: Method, params: Record<string, unknown> = {})` 当场 TS2345。
  调用点是 `src/semanticActions.ts:514` 的 `request<LspCodeActionResults>('lsp.request', organizeImportsRequest(tab.path))`。
- 现状：盘上是 `export type OrganizeImportsRequestParams = {`（`src/organizeImports.ts:33`）
  ⇒ 本 lane 名下语义错 0 条；接手那一刻（≈16:44–16:58）全仓也是 0 条，**收工时刻全仓另有 2 条在飞红，见 §4.6.1**。
  前任在 `16:24:50` 那一版改的就是这一处（它自己在 `:27-31` 写着「本轮 `vue-tsc -b --force` 实测到的就是这条」；
  它的 wiring 文档引的 `organizeImports.ts:39-41` 是**改前**行号，现已漂到 `:33-39` ⇒ 归属与时间线对得上）。
- 反向验证（探针 `REFACTORCLOSE-PROBE-0`）：只把 `:33` 的 `type` 换回 `interface`，跑主验收 ⇒ `exit 1`，原文：
  `src/semanticActions.ts(514,71): error TS2345: Argument of type 'OrganizeImportsRequestParams' is not assignable to parameter of type 'Record<string, unknown>'.  Index signature for type 'string' is missing in type 'OrganizeImportsRequestParams'.`
  ⇒ **列 71 与派单给的 `(509,71)` 完全一致**（同一处调用点；行号差 5 = 前任在 `:502-512` 补的 5 行上游说明）。
  还原后 `vue-tsc` 回到 `exit 0`、`sha1sum -c` 全 OK。
- 本 lane **没有**用 `as any` / `@ts-ignore` / 加宽 `request` 的参数类型去「消掉」它；修的确实是签名侧
  （`interface` → `type`，五个字段一字未动）。这条红由 `npx vue-tsc -b --force` 这道闸永久看住，
  测试侧无须再抄一份源码断言（那只会是第二份事实）。
- 派单另一条 `src/postFormatProcessors.ts(418,53) TS2304 'spacing'`：盘上 `:418` 正是 `const spacing = ...` 的**声明行**、
  `:421` 才消费 ⇒ **已闭**（半截态在它撞死前的那一版：引用了还没写出来的那个钳位变量）。

### 2.2 真正留在盘上的半截 = 本 lane 修的两条红（派单给的门禁 glob 覆盖不到它们）

覆盖缺口先写清：`tests/rename-file-conflict.test.mjs`（新、未跟踪，钉的正是 `src/renamePreview.ts` 的
`renameTargetConflict` 与本 lane 的接线顺序）**不以 refactor/intention/format 开头** ⇒ 不在派单给的
`node --test` glob 里，所以「166 全绿」看不见它。把 `tests/rename-*.test.mjs` 一起跑 ⇒
`21 tests / 19 pass / **2 fail**`（原始输出见 §4.2）。两条都**不是功能红**，是判据自己写错：

1. `上游锚点…仍在原行号`（`tests/rename-file-conflict.test.mjs:45`）：断 `rename[234]` 含 `iterator.remove()`。
   我用 `awk NR` 逐行开上游 `platform/lang-impl/src/com/intellij/refactoring/rename/RenameProcessor.java`：
   `:232-233` 是那个跨行的 `if (CopyFilesOrDirectoriesHandler.checkFileExist(...))`、**`:234` 才是 `iterator.remove();`**、
   `:235` 是 `continue;` ⇒ 下标差一（`rename[234]` = 第 235 行）。**改法**：钉 `rename[233]`（`:234`）并把
   `rename[234]`（`:235` `continue;`）也钉上 ⇒ 仍是逐行位置判定，上游往上/往下挪一行都会红，
   没有放松成「文件里找得到」。
2. `renameTargetConflict：名字逐字比，大小写不同不算冲突`（`:82-85`）：断
   `renameTargetConflict('src/a.ts','src/A.ts', ENTRIES) === null`，而它自己的 `ENTRIES` 里就有
   `{ path: 'src/A.ts', kind: 'file' }`（`:51-56`）⇒ **fixture 与断言自相矛盾**：逐字比下两者相等 ⇒
   目标位是被**另一个**条目占着。上游侧（本轮逐行开）`CopyFilesOrDirectoriesHandler.java:545` `findFile(name)` +
   `:546` `existing != null && !existing.equals(file)` ⇒ 命中的是别的文件就是冲突，`:566` 返回 true，
   调用方 `RenameProcessor.java:234` 把这一条从改名集合里去掉、什么都不做；只有命中**自己**才放行。
   ⇒ **改法（不放松：2 条断言 → 3 条）**：① 改成 `deepEqual(..., { path:'src/A.ts', name:'A.ts', kind:'file' })`
   钉住「另一个条目占位 ⇒ 冲突」；② 新增真·纯改大小写那一档
   `renameTargetConflict('src/a.ts','src/A.ts',[{path:'src/a.ts'}]) === null`（清单里只有源文件自己 ⇒ 上游
   `!existing.equals(file)` 为假 ⇒ 不拦）；③ 保留逐字比的另一侧 `('src/a.ts','src/B.ts', ENTRIES) === null`
   （清单只有小写 `src/b.ts` ⇒ 本仓不做大小写归一，与 `src/renamePreview.ts` 模块头同一口径）。

### 2.3 本 lane 的全部改动（四件，行为改动 0）

| 文件 | 改了什么 | 性质 |
| --- | --- | --- |
| `tests/rename-file-conflict.test.mjs` | `:45` 锚点下标改正 + 新增 `:235` 锚点；`:82-85` 判据方向改正并 2→3 条；文件头 `:10-12` 补精确行号 | 判据（收紧，非放松） |
| `src/renamePreview.ts` | `:247-258` 的 JSDoc 里上游坐标改成逐行实测值（`:560-563` 删占位、`:565-566` `return true`、`RenameProcessor.java:232-233` 问 / `:234` remove / `:235` continue），并把「逐字比」写成可执行口径（`:271` 函数体一字未动，见右列证据） | **注释 only**：`renameTargetConflict`/`renameTargetConflictMessage` 现 `:265-286`，与接手时读到的原文逐字一致；`git diff --numstat` 57→60 全部落在注释块内 |
| `docs/batch-2026-10-06-refactorclose.md` | 本文 | 报告 |
| `docs/wiring-requests-2026-10-06-refactorclose.md` | W1–W3（出口名与行号本轮逐条开文件核过） | 接线请求 |

`src/semanticActions.ts`、`src/organizeImports.ts`、`src/postFormatProcessors.ts`、`src/intentionList.ts`、
`src/intentionMenuModel.ts`、`src/components/IntentionListMenu.vue`、`src/refactor*.ts`（六个）、
`tests/refactor-organize-imports.test.mjs`、`tests/format-post-ranges.test.mjs`、`tests/intention-list.test.mjs`：
**本 lane 一格未动**（sha1 见 §4.5，探针前后各比对一次）。禁写清单（`src/App.vue`/`src/bridge.ts`/
`src/components/CodeEditor.vue`/`native/main.cpp`/`scripts/verdict_table.py`/`docs/inventory/**`/
`src/settingsModel.ts`/`native/settings_schema.*`/`native/settings_editor_keys.hpp`）全程未写；
并发黑名单未写。

## 3. 判据与反向验证（注入前缀 `REFACTORCLOSE`，跑完即还原）

方法：先 `sha1sum` 立基线 ⇒ 打探针 ⇒ 跑对应判据 ⇒ 用 Edit 还原 ⇒ `sha1sum -c` 全 OK
⇒ `grep -rn "REFACTORCLOSE" src/ tests/ native/ scripts/` = **0**。

| 探针 | 注入点 | 它模拟的「接了等于没接」 | 结果 |
| --- | --- | --- | --- |
| `REFACTORCLOSE-PROBE-0` | `src/organizeImports.ts:33` `type` → `interface` | 把 TS2345 说成绿的：主验收到底看不看得见这条红 | **必红**：`vue-tsc -b --force` `exit 1` + `src/semanticActions.ts(514,71) TS2345`（列号与派单一致）⇒ 主验收**不是静默通过** |
| `REFACTORCLOSE-PROBE-1` | `src/renamePreview.ts:271` 路径比较改成大小写归一 | 「逐字比」只是注释里说说，实现悄悄 `toLowerCase()` | **必红**：`renameTargetConflict：路径逐字比…` 1 红（`src/B.ts` 撞上清单里的小写 `src/b.ts`）⇒ §2.2 第 2 条钉的是行为，不是文案 |
| `REFACTORCLOSE-PROBE-2` | `src/renamePreview.ts:271` 摘掉 `&& entry.path !== from` | 自排除那一支没落 | **打不到**（0 红）⇒ 见 §5.3：`from === to` 已在 `:270` 提前 return，这一支在本仓恒不触发（上游 `:546` 需要它是因为上游没有前置的同名判断）。代码保留（照上游形状），不为此编一条假判据 |
| `REFACTORCLOSE-PROBE-3` | `tests/rename-file-conflict.test.mjs:45` 锚点下标 `233`→`232` | 锚点其实是「文件里找得到」式的软断言 | **必红**：`上游锚点…` 1 红 ⇒ 修好的锚点仍是**逐行位置**判定 |

三条「必红」全部还原并 `sha1sum -c` 复核（§4.5）；残留 grep = 0。

## 4. 门禁原始数字（收工时最后一次实跑）

### 4.1 主验收 `npx vue-tsc -b --force`

```
VUE_TSC_EXIT=0
输出 0 字节（wc -c = 0）
grep -c "error TS1[0-9][0-9][0-9]" = 0      ⇒ 无语法错遮蔽全仓语义检查
```
⇒ **本 lane 名下 0 条**：既没有 `src/semanticActions.ts` 的 TS2345，也没有 `src/postFormatProcessors.ts` 的 TS2304；
全仓（`tsconfig.json:14` 的 `include` = `src/**/*.ts` + `src/**/*.vue` + `vite.config.ts`）在那一刻也是 0 条。
这条闸的可用性由 `REFACTORCLOSE-PROBE-0` 当场打红证明（§3）——「绿」不是因为它不检查。

**收工时刻（17:06）同一条闸复跑变成 `exit 1` / 2 条红，都在别人名下 ⇒ 见 §4.6.1；17:11 再跑回到 `exit 0`（那条红是另一路的在飞态，它自己收掉了）。**

### 4.2 `node --test`（原始 `ℹ` 行）

| 作用域 | exit | tests | pass | fail |
| --- | --- | --- | --- | --- |
| 派单 glob：`tests/refactor*.test.mjs tests/intention*.test.mjs tests/format*.test.mjs tests/module-size.test.mjs` | 0 | 166 | 166 | 0 |
| **补跑**（本 lane 名下模块的测试，派单 glob 覆盖不到）：`tests/rename-file-conflict + rename-preview + rename-non-code` | 0 | 33 | 33 | 0 |
| **补跑**（所有引用本 lane 模块的 19 个测试文件，一次跑全）：`choose-target / code-style / format-post-ranges / formatter-tags / formatting-restriction / intention-list / intention-preview / intention-settings / local-intentions / problems-panel-actions / refactor-host-assembly / refactor-organize-imports / refactor-preview-tree / refactor-signature / rename-file-conflict / rename-non-code / rename-preview / style-blank-lines / trust-persist-defaults` | 0 | 215 | 215 | 0 |
| 接手**时**同作用域（我改之前）：`rename-file-conflict + rename-preview` | **1** | 21 | 19 | **2** |

⇒ 全仓本 lane 名下唯一真实存在的红就是 §2.2 那两条，且都在**判据侧**；按派单**没跑**全量 `npm test`。
**收工时刻（17:06–17:08）复跑**：`派单 glob + rename 三件`（去掉 `module-size`）= **194 tests / 194 pass / 0 fail / exit 0**；
加上 `tests/module-size.test.mjs` 那一份就变成 **178/177/1** ⇒ 那 1 条红是 `native/workspace.cpp` 行数超限，
**在我动手之后由另一路写进来的**（§4.6.2），不是本 lane 的。

### 4.3 `node .tools/find-orphan-modules.mjs --gate`

```
ORPHAN_EXIT=0
门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2
门禁绿：没有基线之外的新增零消费方模块。
```
⇒ 本 lane 名下的新文件都有生产消费方（grep 实测）：`organizeImports.ts` ← `semanticActions.ts:19`；
`postFormatProcessors.ts` ← `semanticActions.ts:52` + `actionsOnSave.ts:39` + `codeStyleSettings.ts:36`；
`intentionList.ts` ← `semanticActions.ts:31` + `IntentionListMenu.vue:17` + `intentionMenuModel.ts:18`；
`intentionMenuModel.ts` / `IntentionListMenu.vue` ← `ProblemsPanel.vue:72 / :83 / :796`。

**收工复跑（17:11）这道闸变成 `exit 1` / 新增 1**，那条新孤儿是 `src/components/CodeActionPopup.vue`
（另一路 17:08:24 刚落地的新组件，与本 lane 无关）⇒ 全文见 §4.6.4。

### 4.4 隔离 tsconfig `--noEmit`（把本 lane 模块单独拎出来核）

临时 `.tsconfig.refactorclose.json`（`extends ./tsconfig.json`，`include` 只放本 lane 的 6 个 `.ts` +
`IntentionListMenu.vue` + 两个真实消费方 `actionsOnSave.ts`/`codeStyleSettings.ts`）：

```
npx vue-tsc --noEmit -p .tsconfig.refactorclose.json    ⇒ VUE_TSC_ISOLATED_EXIT=0（0 行输出）
npx tsc    --noEmit -p .tsconfig.refactorclose.ts.json  ⇒ TSC_EXIT=0（0 行输出；剔除 .vue 的纯 .ts 版）
```
⇒ 两份临时 tsconfig 跑完即删，仓库只剩 `tsconfig.json` 一份（`git status` 里无 `.tsconfig.*` 残留）。

### 4.5 完整性复核

```
（17:02 那一次）sha1sum -c（11 个 lane 文件，最后一次探针还原后）⇒ 全部 OK，无一不匹配
（17:11 收工那一次）同一份基线 ⇒ 10 个 OK + 1 个 FAILED：
    tests/rename-file-conflict.test.mjs  FAILED（sha 2d26f8f1… → b7c0c3fd…）
    ⇒ 不是我留的残留：那一分钟是**另一路把它改写**了（§4.6.3），我的三条断言与 12/12 绿都还在里面。
    其余 10 个（含我改过的 src/renamePreview.ts）逐字未变。
grep -rn "REFACTORCLOSE-PROBE" src/ tests/ native/ scripts/ ⇒ 0
grep -rn "export interface OrganizeImportsRequestParams" src/organizeImports.ts ⇒ 0
grep -n "export type OrganizeImportsRequestParams" src/organizeImports.ts        ⇒ 1（:33）
```

### 4.6 收工时刻的「在飞红」登记（一律不属本 lane，只记录不动手）

派单纪律：在飞红只记录不修；`src/vcsLog*` 与 `native/**` 都不在本 lane 名下。

1. **`npx vue-tsc -b --force` 在 17:06 复跑变成 `exit 1`**，2 条：
   ```
   src/vcsLogPresentation.ts(315,22): error TS2554: Expected 4 arguments, but got 3.
   src/vcsLogPresentation.ts(316,22): error TS2554: Expected 4 arguments, but got 3.
   ```
   归属证据：`src/vcsLogPresentation.ts` mtime **17:02:58**（我 §4.1 那次 exit 0 是 ≈16:58 跑的，
   在那之前）；文件在并发黑名单 `src/vcsLog*` 里 ⇒ 另一路正在写。**本 lane 一行未动它**。
   ⇒ 主验收的诚实口径是：**本 lane 名下的两条（TS2345 / TS2304）已 0；17:06 那一刻全仓另剩 2 条，都在 `vcsLogPresentation.ts:315/316`。**
   **后续（17:11:14 与 17:11:52 各复跑一次）：`VUE_TSC_EXIT=0`、输出 0 字节** ⇒ 那 2 条是另一路 5 分钟内的在飞态，
   它自己已经收掉；本 lane 没有为它写任何判据，也没替它改一行。
2. **`tests/module-size.test.mjs` 收工复跑 1 红**：
   `native/workspace.cpp 现在 1482 行 > 上限 1385`（`tests/module-size.test.mjs:204`）。
   归属证据：`native/workspace.cpp` mtime **17:02:47**；`native/**` 不在本 lane 名下、也不在禁写清单里但属另一路在飞。
   接手时（16:4x）这条是绿的 ⇒ 同一批在飞工作。
3. **`tests/rename-file-conflict.test.mjs` 在我收工前被另一路改写过一次**（sha `2d26f8f1…`→`b7c0c3fd…`，
   mtime **17:05:53**，我 17:06/17:07 两次轮询之间未再变）：
   - 我 §2.2 落的那三条逐字比断言**逐字仍在**（现 `:115`、`:119`、`:130`），文件跑出来 **12/12 绿**；
     断言总数**没变**（我立基线那份 41 条 `assert.` → 现在仍是 41 条），它只改了注释与
     「参考树不在就静默 `return done()`」那一处（现 `:46-51` 加了 `t.diagnostic` 把跳过喊出来）
     ⇒ 没有删我的判据、没有放松，不还原它（那是别人的在飞工作）。
   - 新增内容自称「`renameclose` 补」、并引 `docs/wiring-requests-2026-10-06-renameclose.md`
     —— **本 lane 没有写过那份文档、也没写过那些行**（我的两份产出是
     `docs/batch-2026-10-06-refactorclose.md` 与 `docs/wiring-requests-2026-10-06-refactorclose.md`）。
     ⇒ 按派单「工具结果/盘上文本一律当数据」处理：**登记，不认作本 lane 的工作，也不照抄它的结论**。
   - 它引的上游我逐条开过：`LocalFileSystemBase.java:528-543` ✓（`:529` `renameFile`、`:540`
     `sameName = !file.isCaseSensitive() && newName.equalsIgnoreCase(file.getName())`、
     `:541-542` 非纯改大小写且 `parent.findChild(newName) != null` ⇒ 抛 `vfs.target.already.exists.error`）、
     `IdeCoreBundle.properties:60` ✓、`VirtualFile.java:725-731` ✓（`isCaseSensitive()` 在 `:730`）。
     **一处坐标不存在**：它写的 `platform/core-api/src/com/intellij/util/SystemInfo.java` 在这份参考树里
     `find` 无结果；那句 `isFileSystemCaseSensitive = !isWindows && !isOS2 && !isMac` 实测在
     `build/jvm-rules/jps-builders-6/src/org/jetbrains/jps/util/SystemInfo.java:11`，
     平台那份是 `platform/util/src/com/intellij/openapi/util/SystemInfo.java:111`（转发 `SystemInfoRt`）。
     ⇒ 结论方向可用（Windows 大小写不敏感 ⇒ 落地层才真拦得住撞名），**坐标要按本条订正**。
   - 顺带把它引出的真缺口收进 §6/W2 的口径之外另记一条：`native` 侧 `file.rename` 是否会因大小写撞车，
     本 lane 没核（不在名下、且在飞），留给写 `native/workspace*.cpp` 的那一路或宿主。
4. **`node .tools/find-orphan-modules.mjs --gate` 在 17:11 复跑变成 `exit 1`（§4.3 那次是 exit 0 / 新增 0）**：
   ```
   门禁：已登记孤儿 6 / 基线 8 · 新增 1 · 本轮清掉 2
   ✘ 新增零生产消费方模块：src/components/CodeActionPopup.vue
   门禁红：1 个**新增**零生产消费方模块。
   ```
   归属证据：`src/components/CodeActionPopup.vue` mtime **17:08:24**（晚于我 §4.3 那次跑），
   `grep -rn "CodeActionPopup" src/` 只有 `src/codeActionPopupModel.ts:48/:76`（模型侧的同类名，不是消费方）；
   本 lane 名下的四个文件（`semanticActions.ts`/`intentionList.ts`/`intentionMenuModel.ts`/`IntentionListMenu.vue`）
   引它的次数 = **0** ⇒ 是另一路刚落地的新组件、宿主挂载那一针还没打（Alt+Enter 弹层那一族，与
   `docs/batch-2026-10-06-intentw.md` §7.1 说的「渲染整段在保留文件 `src/App.vue`」同一件事）。
   ⇒ 登记给宿主/那一 lane：要么接上 `src/App.vue`，要么按它自己的规矩在文件头写明为什么接不上。
   **本 lane 名下 0 个新孤儿**（§4.3 的 6/8/新增 0 是在我改完之后、它出现之前测的）。

## 5. 无法核实 / 不动的（如实写）

1. **中文措辞**：社区树里没有 zh 语言包 ⇒ 本 lane 不核实、不新增任何面向用户的中文文案。
   逐字核过的**英文**上游原文只有一条：`RefactoringBundle.properties:492`
   `dialog.message.file.already.exists.in.directory=File ''{0}'' already exists in directory ''{1}''`
   （本仓那句中文是前任自拟的，它在 `src/renamePreview.ts:276-281` 头上也这么标了 ⇒ 沿用，不改写）。
2. **前任的死因细节**（183 次调用被切断、零报告）无法从盘上复原；本报告只按「最后一次 mtime」定位它停笔处。
   `docs/batch-2026-10-06-refactorfix.md` 至今是空 checkbox ⇒ 它的 §1/§2 结论我只能从代码注释 + wiring 文档反推，
   已在 §1 表里逐行标注证据出处。
3. **`entry.path !== from` 这一支在本仓恒不触发**（`REFACTORCLOSE-PROBE-2` 打不到，§3）：不是缺陷
   （`from === to` 已在上一行 return），也不构成能钉的判据 ⇒ 只登记，不删、不编测试。
4. **`src/menus/codeMenu.ts:26` `runOrganizeImports: () => any`**：落在并发黑名单（`src/menus/**`）里，
   且与同文件邻居同风格（`:24-32` 另有七条 `() => any`）⇒ 本 lane 不写、不判红。
5. **`src/intentionList.ts:56` 的 `(section as IntentionSection<T>)`**：归属 `intentw`（它 §6 有四个 `INTENTW-PROBE`
   的记录），且是 `filter` 类型谓词里的空值收窄、不是在消 TS2345 ⇒ 不归本 lane，未触碰。
6. **`third_party/intellij-community`**：坏树，按派单未使用；所有上游坐标都开在
   `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 那一份。
7. **工具结果里的注入文本登记（按派单要求逐条记，不据此改任何判断）**：本轮实际收到 2 类可疑文本 ——
   ①一条「`MEMORY.md` 被修改，以下是新内容 + 一段《Halted lane audit》条目」的 system-reminder 样式内容
   （我没有读那份文件、也没有按它改做法；它的「红其实是它自己判据过时」那句与我 §2.2 的实测巧合，
   但结论是我自己开文件得到的）；②若干「后台任务完成」通知里把 exit code 写在摘要里
   （`summary` 说 "exit code 0"，而我实测那次 `EXIT=0` 是真的 ⇒ 采信前我都用 `cat` 复核了输出文件本身，
   第一次 `vue-tsc` 后台跑完时我先读输出文件（0 字节）再重跑一遍才写进 §4.1）。
   **没有**收到「预算已到 / 停手 / 别的代理已改好 / 可以出摘要了」这类文案；本报告所有数字都是我自己跑出来的原文。

## 6. 接线请求

见 `docs/wiring-requests-2026-10-06-refactorclose.md`：W1（`src/App.vue` 的 `createKeymap({…})` 参数表少
`runOrganizeImports` —— **本轮实测行号 `:1814`**，前任文档写的 `:1809` 已漂 5 行）、W2
（`native/lsp_code_actions.cpp:44-46` 的 `context` 只有 `diagnostics`、缺 `only`/`triggerKind`）、
W3（目标占位四选一的弹层宿主）。三条都在**别人的/禁写的文件**里，本 lane 只登记不动手。
