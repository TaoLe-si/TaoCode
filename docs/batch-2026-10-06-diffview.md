# 批次报告 2026-10-06 · diffview 域（`DiffView.vue` 的 `unified` 哑 prop → 真消费者）

开工先读 `D:\TaoCode\.tools\agent-rules.md`（全量读完）。本仓没有 `AGENTS.md`（派单已说明），规约以那份为准。
上游唯一真源 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，**没有上网搜**，
下面每一条上游坐标都是亲自打开过的。没有 commit / push / checkout / reset / stash / clean。
保留文件一个字节没动（`src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`src/settingsModel.ts`、
`CMakeLists.txt`、`scripts/verdict_table.py`、`docs/inventory/*`）。

---

## 0. 结论复核（派单第 1 项：先自己验这条缺陷）

### 0.1 `unified` 的全部读写点（逐条 grep，不是转述）

**写侧（6 个调用方，全部传了 `unified`）**

| 调用方 | 传进去的那份文本 | 出处 |
| --- | --- | --- |
| `src/App.vue:2355` | `conflictDiff.unified` | 由 `src/editorFileOps.ts:62` 的 `generateUnifiedDiff(diskLines, bufferLines)` 生成 |
| `src/App.vue:2376` | `clipboardDiff.unified` | 由 `src/vcsActions.ts:146`（与文件比较）/ `src/vcsActions.ts:169`（与剪贴板比较）的 `generateUnifiedDiff(...)` 生成 |
| `src/components/DebugClipboardCompare.vue:46-48` | 本组件的 `unified` computed | `src/components/DebugClipboardCompare.vue:36` 的 `generateUnifiedDiff(...)` |
| `src/components/HistoryPanel.vue:253` | `diff`（宿主 `history.diff` 的文本） | 宿主侧 |
| `src/components/SourceControl.vue:776` | `diff.text`（宿主 `git diff` 文本） | 宿主侧 |
| `src/components/VcsLogDiff.vue:32-34` | `result.patch` | 宿主侧 |

**读侧（`src/components/DiffView.vue`，改前只有 1 处）**

- 脚本区：`grep -n "props\.unified" src/components/DiffView.vue` ⇒ **改前 0 命中**（`props.rows` 在 `:68`、
  `props.leftText/rightText` 在 `:60/:69-70` 都有人读，只有 `unified` 没有）。
- 模板区：改前唯一一处是那块 `pre`（`{{ unified || '（无差异）' }}`，改前 `:428`；本批后在 `:477`）。
- 「统一」档那个切换按钮（`:370`）渲染的是 `unifiedItems` = `buildUnifiedRows(effectiveRows)`（`:136-139`），
  **不是** `props.unified`。既有判据 `tests/diff-unified.test.mjs:181` 把这件事钉得很死：
  `assert.match(view, /<div v-else-if="effectiveRows\.length" class="diff-unified">/, '有行表就渲染行，不再吐 pre')`。

### 0.2 那条结论要收窄成什么样（原写「全文不读 props.unified」，实际「只在一个永远进不去的分支里读」）

`pre` 那一支的前提是 `effectiveRows.length === 0`。而三个**前端生成补丁**的调用方都给的是
`buildDiffRows(a.split('\n'), b.split('\n'))`，`String.prototype.split` 对任何字符串（含空串）都返回**至少 1 个元素**，
实测（`node --input-type=module`，真函数调用）：

```
[["a"],["a"]]  rows= 1  unifiedLen= 35     ← 两侧一模一样也仍有 1 行 equal
[[""],[""]]    rows= 1  unifiedLen= 34     ← 两侧都是空串也仍有 1 行
[[],[]]        rows= 0  unifiedLen= 32     ← 只有"两个空数组"才进 pre
[[],["x"]]     rows= 1  unifiedLen= 35
[["x"],[]]     rows= 1  unifiedLen= 35
```

⇒ 除 `DebugClipboardCompare` 那一个极端形状（剪贴板空 **且** 值空 → 两侧都传 `[]`）之外，
`props.unified` 在**任何**一次真机渲染里都不会被画出来。宿主侧那三家（HistoryPanel / SourceControl / VcsLogDiff）
`rows` 也可能为空（宿主只给文本不给行），所以那句「没有**任何**可见消费者」精确地说应当是：

> **`src/diffText.ts` 的 `generateUnifiedDiff` 那一份文本没有任何可见消费者**（三个生产点行表恒非空）；
> `props.unified` 这个槽位只被「行表为空的 `pre` 兜底」消费，而那一档是宿主侧才可能走到的。

派单的定性成立，缺陷是真的：块头写错（`@@ -1 +1 @@`，上一批 `docs/batch-2026-10-06-patch2.md` §1 首行修的正是它）
在真机上看不见 —— 因为那份文本从来不露面。

---

## 1. 判词表（族 / 项 / 判定 / 上游相对路径:行号 / 本仓落点 / 一句话）

| 族 | 项 | 判定 | 上游相对路径:行号（亲自打开） | 本仓落点 文件:行号 | 一句话 |
| --- | --- | --- | --- | --- | --- |
| diff/补丁文本消费 | 差异查看器里那份补丁文本要有真出口 | `[x]` 本批做 | `platform/vcs-impl/resources/META-INF/VcsActions.xml:213-214`（`<action id="ChangesView.CreatePatchToClipboard" class="…CreatePatchFromChangesAction$Clipboard"/>`）+ `platform/platform-resources-en/src/messages/ActionsBundle.properties:1583`（`action.ChangesView.CreatePatchToClipboard.text=Copy as Patch to Clipboard`） | `src/components/DiffView.vue:331-360`（`patchText` / `canCopyPatch` / `copyPatch` / `watch`）+ 模板 `:418-420`（按钮 + 状态句） | 「作为补丁复制到剪贴板」把 `props.unified` 整份喂给 `src/clipboard.ts:35` 的 `copyToClipboard` |
| diff/补丁文本消费 | 这一档**挂在差异查看器上**（不是只在变更视图右键里） | `[x]` 本批按上游挂 | `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/actions/diff/DiffViewerCreatePatchActionProvider.java:55-59`（`$Clipboard` 那一支）、`:67-69`（`isActive` 要求 `DiffDataKeys.DIFF_VIEWER != null`）、`:71-83`（`update` + `actionPerformed` 走同一个 `createPatch(…, mySilentClipboard)`） | `src/components/DiffView.vue:418-419`（按钮就在 diff-head 工具带上，与并排/统一档同排） | 上游那一项本来就出现在差异查看器的动作里，所以本仓挂在这里**不是自加控件** |
| diff/补丁文本消费 | 不弹对话框、直接进剪贴板 | `[x]` 本批按上游走 | `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/actions/CreatePatchFromChangesAction.java:158-165`（`silentClipboard` 分流）+ `:182-200`（`createIntoClipboard`）→ `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/CreatePatchCommitExecutor.java:343-355`（`writePatchToClipboard`） | `src/components/DiffView.vue:352-358`（`copyPatch`：无中间对话框，点了就复制） | 本仓同样没有对话框 |
| diff/补丁文本消费 | 剪贴板出口 = 补丁**全文**一次写入 | `[x]` 本批按上游写 | `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/PatchWriter.java:104-111`（`StringWriter` 收全文 → `CopyPasteManager.getInstance().setContents(new StringSelection(writer.toString()))`，`:111`） | `src/components/DiffView.vue:356` `await copyToClipboard(text)`（`text = props.unified`，一行不裁） | 判据 `tests/diff-patch-copy.test.mjs` 第「真函数调用」条钉逐字相等 |
| diff/补丁文本消费 | 成功提示 | `[~]` 部分 | `CreatePatchCommitExecutor.java:353-354`（`VcsNotifier.notifySuccess(PATCH_COPIED_TO_CLIPBOARD, "", VcsBundle.message("patch.copied.to.clipboard"))`）+ `platform/vcs-api/vcs-api-core/resources/messages/VcsBundle.properties:447`（`patch.copied.to.clipboard=Patch copied to clipboard`） | `src/components/DiffView.vue:346`（`PATCH_COPIED_TEXT`）+ 模板 `:420` 的 `role="status"` | 本仓差异视图**没有通知通道**（`notify` 不在 props 里，加它要改 `App.vue`）⇒ 退化成工具带上一句 `role=status` 的实时提示，不做气泡通知 |
| diff/补丁文本消费 | 可见性谓词（不放假控件） | `[x]` 本批按上游 | `DiffViewerCreatePatchActionProvider.java:71-76`（`e.getPresentation().setEnabledAndVisible(isEnabled)` —— 不支持就**连可见都撤掉**） | `src/components/DiffView.vue:348-350`（`patchText` 判空白 ⇒ `canCopyPatch`）+ 模板 `:418` 的 `v-if="canCopyPatch"` | 没有补丁文本时那颗按钮整件不渲染（判据有真渲染反向条） |
| diff/呈现档 | 在并排视图里再加一档「显示补丁正文」 | `[-]` **不做（具体理由）** | 上游差异查看器没有这一档：`platform/vcs-impl/.../changes/patch/tool/DiffPatchFileEditorProvider.kt:70-103` 是把 `.patch` **文件**当差异来渲染（`:137-139` `PatchReader(patchText)` → 每块 `PatchDiffRequestProducer`），`:118-120` 的 `switchToEditableView` 走系统文本编辑器；`platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/ApplyTextFilePatch.java:84-85` 是把补丁**灌进文档**做 apply，都不是"差异视图里看原始补丁正文" | `src/components/DiffView.vue:457-475`（统一档 = 行表，`tests/diff-unified.test.mjs:181` 钉着「有行表就渲染行，不再吐 pre」） | 派单给的两条路里选了第二条（复制补丁）。第一条若要做，就得把 `v-else-if="effectiveRows.length"` 改成带档位的三条件 —— 那是**放松既有断言**，且上游没有这一档 |
| vc/变更视图那两条补丁动作 | `CreatePatch` / `CreatePatchToClipboard` | `[-]` 不适用（**早做过**） | `VcsActions.xml:212`（`ChangesView.CreatePatch`）+ `:213-214` | `src/patchExport.ts:21`（`PATCH_TO_CLIPBOARD_TEXT`）+ `:49-56`（`copyPatchToClipboard`）→ `src/components/SourceControl.vue`（判据 `tests/patch-export.test.mjs:56-61`） | 本批**复用**它的文案常量，不另抄一份中文；`src/changesMenuActions.ts:18-19` 那句「补丁导出还没做」是过期注释（见请求 R1） |

**为什么选「复制补丁」而不是「再加一档」**：上游差异查看器对补丁文本的消费**就是**这一条动作
（`DiffViewerCreatePatchActionProvider$Clipboard`），本仓再加一档纯文本既没有上游依据，又要改掉
`tests/diff-unified.test.mjs:181` 那条既有断言（规约 §3 禁止）。

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 改了什么 |
| --- | --- | --- | --- |
| `src/components/DiffView.vue` | 482 | 535（+53） | ① 文件头补「`unified` 的真消费者是谁 + 上游四条坐标」注释（`:6-14`）；② 值 import 加 `Copy`（lucide）、`copyToClipboard`（`../clipboard`，`:23`）、`PATCH_TO_CLIPBOARD_TEXT`（`../patchExport`，`:26`）；③ 新增 §补丁文本 一节：`patchText` / `canCopyPatch` / `patchCopied` / `copyPatch` / `watch`（`:331-360`）；④ 工具带按钮 + `role=status` 提示（`:415-420`）；⑤ 样式 `.diff-copy-state`（`:501-504`，只走 `--success`/`--font-ui` 令牌）。**别人的在途代码一行没重排**（见下） |
| `tests/diff-patch-copy.test.mjs` | —— | 149（新增） | 本批判据：9 条（3 条 readFileSync 精确接线 + 3 条真 SSR 渲染 + 2 条真函数调用 + 1 条会失败的用例与反向对照） |
| `docs/batch-2026-10-06-diffview.md` | —— | 174（新增） | 交付报告 |
| `docs/wiring-requests-2026-10-06-diffview.md` | —— | 84（新增） | 两条真请求（R1/R2 都是 `src/changesMenuActions.ts` 文件头的过期注释，逐行可照抄）+ §C「本批不需要动 `src/App.vue`」的取证 |

`git diff -- src/components/DiffView.vue` 自查：hunk 里除了上面这五处，其余（`buildUnifiedRows` 一族、
`toggleAllSides` 改名、`.diff-unified-*` 样式）都是**同域另一路代理的在途改动**（`git status` 显示该文件在我开工前
就已是 `M` 状态；开工时 `wc -l` = 482 就是带着它们的）。我这次的 5 处全部是新增行，没有删掉别人任何一行。
反证：改完后 `tests/diff-unified.test.mjs`（那一批的判据）仍 **全绿**（见 §3 合跑数字）。

---

## 3. §5 每条自查命令的前后数字

| 门禁 | 改前基线 | 改后 | 归属 |
| --- | --- | --- | --- |
| `node --test tests/diff-patch-copy.test.mjs` | 文件不存在（0 条） | **9 tests / 9 pass / 0 fail** | 本批新增 |
| 本域合跑（`diff-align` `diff-unified` `diff-fold` `diff-nav` `diff-search` `diff-policy-combo` `diff-words` `diff-chunks` `diff-smart-lines` `diff-patch-copy` + `patch-hunk-counts` `patch-apply` `patch-export`） | 10 个 diff 文件单独合跑 **158 / 158 绿**（不含本批新文件） | 13 个文件 **193 pass / 0 fail** | 既有 184 条断言**一条没放松**（`deepEqual` / `match` 原样，`tests/diff-unified.test.mjs:181` 那条一字未动） |
| 派单点名的 `node --test tests/diff-text.test.mjs` | —— | **该文件不存在**（`ls tests/diff-text.test.mjs` ⇒ No such file）；`generateUnifiedDiff` 的既有判据在 `tests/diff-align.test.mjs:138-143` 与 `tests/patch-hunk-counts.test.mjs`，两者都在上面那 193 条里全绿 | 派单坐标有误，如实记 |
| `npx vue-tsc -b --force` | 中途第一次跑：**3 处错，零处在我文件里**（`src/refactorPreview.ts:207`、`src/referenceContents.ts:149`、`src/referenceContents.ts:184`） | 收工最后一次跑：**EXIT=0，0 错**（`npx vue-tsc -b --force` 退出码 0）（那三处随后被各自所属的在途代理修掉了；`grep DiffView\|diffText\|clipboard` 在两次输出里都 0 命中） | 别的 lane 在途 → 收工已全绿 |
| `node --test tests/module-size.test.mjs` | —— | 中途一次 **5 tests / 4 pass / 1 fail**（唯一 offender：`src/bridge.ts 现在 911 行 > 上限 905`，`git diff -U0 -- src/bridge.ts` 显示那是另一路 run console 的在途注释，`bridge.ts` 是保留文件、本批一字节没碰）；**收工最后一次 5 tests / 5 pass / 0 fail**（那一路线上自己收干净了）。上限一个没抬、豁免一条没登记；`src/components/DiffView.vue` 535 行 < 900（未登记，也不需要） | 别的 lane（本批无新增巨型文件） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** | 本批 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（新 `.mjs` 无 TS 语法） | 本批 |
| `node .tools/find-missing-ext.mjs` | 干净（1288 文件） | 扫描 **1303** 个文件、**干净**（新测试的 `.ts` 值 import 全带扩展名：`../src/diffText.ts` / `../src/clipboard.ts` / `../src/patchExport.ts`） | 本批 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 改前单跑 citations 3/3 绿；anchors 第一次跑 **红 2 条**（`docs/batch-2026-10-06-vcslog2.md`、`src/trustedProjects.ts` 两条"快照里有、仓里指不到"，都是别人在途） | **11 tests / 11 pass / 0 fail**（citations 3 + anchors 8；anchors 那两条被对应代理修好了）。本批写进源码/测试/文档的 9 条上游 `路径:行号` **全部进得了快照** | 本批零 offender |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 8 / 已登记 8 | **门禁绿：新增 0**（本批没新增 `src/` 模块，只在既有 `.vue` 里加消费者 + 加一个测试文件） | 本批 |
| ctest（`npm run test:native`） | —— | **没跑**：本批一个字节都没改 `native/`（见 §6） | —— |

---

## 4. 反向验证记录（新判据的三步数字）

新判据（`tests/diff-patch-copy.test.mjs`，9 条）**全部**做过"注入违规 → 变红 → 撤掉 → 复绿"：

| 注入 | 注入了什么 | 红了哪几条 | 数字 |
| --- | --- | --- | --- |
| A | `src/components/DiffView.vue:356` 的 `await copyToClipboard(text)` 改成 `await copyToClipboard('')`（= 复制的不是 `props.unified`） | 「复制补丁走剪贴板中央入口，复制的就是 props.unified 那份全文」 | **8 tests / 7 pass / 1 fail** |
| B | 模板按钮的 `v-if="canCopyPatch"` 改成 `v-if="true"`（= 没有补丁文本也摆一颗按钮，假控件） | 「工具带那颗按钮的形状…」+「真渲染：没有补丁文本时那颗按钮不出现（不放假控件）」 | **8 tests / 6 pass / 2 fail** |
| C | 把整颗按钮删掉（= 回到本批开工前的**哑 prop 原状**） | 「工具带那颗按钮的形状…」+「真渲染：行表非空时…按钮带 title 与 aria-label 出现」 | **8 tests / 6 pass / 2 fail** |
| 撤掉 | 三处注入逐个复原（`copyToClipboard(text)` / `v-if="canCopyPatch"` / 按钮整件复原），其间补了第 9 条判据（`pre` 那一档的真渲染 + 反向） | —— | **9 tests / 9 pass / 0 fail**；本域 13 文件合跑 **193 / 193 绿** |

判据里**自带**一条"会失败的用例 + 反向对照"（不依赖注入就能证明它不是糊的）：
最后一条 `会失败的用例：块头改回旧写法 @@ -1 +1 @@ ⇒ 声明的行数与实际不符`：

- 正向：`assert.deepEqual(declared, actual)` —— 真生成的那份必须自洽。
- 反向：同一份补丁把块头**手动**改回 `@@ -1 +1 @@`，`assert.notDeepEqual(lie.declared, lie.actual)` ——
  旧写法必须让这笔账**不平**。也就是说：如果 `src/diffText.ts` 哪天退回旧块头，复制出去的补丁就是"声明 1 行、实际 N 行"，
  这条判据立刻红；`includes` 糊不出这个结果。
- 另外「真渲染：行表非空时…」这条正是原缺陷的反面断言：**行表非空**（= 原来 `pre` 进不去的那一档）时
  补丁文本仍必须有一个可见出口（按钮真渲染出来），这是 SSR 真跑组件得到的，不是源码字符串。

---

## 5. 零消费方自查结论

- 本批**没有新增 `src/` 模块**，只：① 在 `src/components/DiffView.vue` 里新增 5 个绑定（`patchText`、
  `canCopyPatch`、`patchCopied`、`copyPatch`、`PATCH_COPIED_TEXT`）；② 新增 1 个测试文件。
- 五个绑定逐个都有消费者：`patchText` → `canCopyPatch`（模板 `v-if`）与 `copyPatch`（`@click`）；
  `patchCopied` → 模板 `:420` 的 `role=status` + `copyPatch` 的写入 + `watch(() => props.unified)` 的清零；
  `PATCH_COPIED_TEXT` → 模板 `:420`；`copyPatch` → 模板 `:419` 的 `@click`。**没有只过自己测试的死模块**（`.tools/find-orphan-modules.mjs --gate` 新增 0）。
- 反向自查：`props.unified` 现在被读**两次**（脚本 `patchText` 的 `props.unified.trim()` + 模板 `pre` 的 `unified`），
  且两处都在"行表非空"与"行表为空"两条分支上各占一处 ⇒ 六个调用方给的那份文本无论有没有行表都有出口。
- 引入的两个 import 都真用到：`copyToClipboard`（`:354`）、`PATCH_TO_CLIPBOARD_TEXT`（模板 `:418-419`）、`Copy`（模板 `:419`）。

---

## 6. 做不到 / 无法核实

1. **上游没有「差异视图里显示原始补丁正文」这一档**（无法核实到能支撑"再加一档"的真源码）：
   `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/tool/DiffPatchFileEditorProvider.kt:70-103` 是把 `.patch`
   **文件**解析成差异来渲染（`:137-139` 用 `PatchReader`），`:118-120` 的"切换成可编辑视图"是打开系统文本编辑器；
   `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/ApplyTextFilePatch.java:84-85` 是 apply 时把
   `getSingleHunkPatchText()` 灌进 Document。三者都不是"差异查看器里的一块补丁正文"。所以派单的两条路里选了第二条。
2. **气泡通知做不到**：上游复制成功走 `VcsNotifier.notifySuccess`（`CreatePatchCommitExecutor.java:353-354`），
   本仓 `DiffView.vue` 的 props 里没有 `notify` 通道（`src/App.vue:2355/:2376` 也没传），加通道要改保留文件 `src/App.vue`
   ⇒ 本批退化成工具带上的 `role="status"` 实时提示。**没写请求**要求改 `App.vue`：那条线一接就要同时改两个调用点的
   props 与组件签名，收益只是把一句本地提示换成全局气泡，不值得占用唯一那个 App.vue 代理的窗口。
3. **真机剪贴板没验**：规约 §6 禁启动图形界面。改做的是"真函数调用"级取证 ——
   `copyToClipboard(patch)` 在测试里真的把 `patch` 压进了 `src/clipboard.ts:17` 的 `clipboardRing`
   （`clipboardRing.value[0].text === patch`，逐字相等），`navigator.clipboard.writeText` 那一跳在 Node 里被
   `src/clipboard.ts:23` 的 `try/catch` 吞掉（WebView2 里可用与否不归本批判）。
4. **`native/` 没碰**，所以 ctest 没跑（见 §3 末行）。
5. **`.vue` 的 `unified` 属性在 `App.vue` 里没被改成可选**：`DiffView.vue:41` 的签名里 `unified: string` 是必填，
   六个调用方都传了，本批不需要动签名（也就不需要动 `App.vue`）。

---

## 7. 需要主代理接的线

单放在 `docs/wiring-requests-2026-10-06-diffview.md`：只有 **R1** 一条（`src/changesMenuActions.ts:18-19` 的过期注释，
那个文件不在本批可改面）。**没有需要改 `src/App.vue` 的线** —— 本批的消费者完全长在组件里。

---

## 8. 收工前最后一次全量复跑（本报告数字的出处）

```
node --test tests/diff-patch-copy.test.mjs                                    → 9 / 9 绿
node --test <13 个本域文件>                                                    → 193 / 193 绿
npx vue-tsc -b --force                                                         → EXIT=0，0 错
node --test tests/module-size.test.mjs                                         → 5 / 5 绿
node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs → 11 / 11 绿
node .tools/find-param-props.mjs / find-ts-in-mjs.mjs / find-missing-ext.mjs    → 0 处 / 干净 / 1303 文件干净
node .tools/find-orphan-modules.mjs --gate                                      → 新增 0（绿）
git status --porcelain <本批四个文件>                                            → M src/components/DiffView.vue + 3 个 ?? 新文件
```
临时文件：`build/tmp-ssr-diffview.mjs`、`build/tmp-tsc.txt`（本批建的）已删；`build/` 里其余 `*.tmp` 是别人的，没动。
