# 接线请求 · 2026-10-06 · msgaudit（消息窗口 / 错误树 / 后台任务：只差宿主的那一半）

来源：`docs/batch-2026-10-06-msgaudit.md` §3（C 段）。本文件**只要宿主行**，不描述前端改动——前端那一半逐条给了已在盘上的证据，接上即生效。

宿主余量（13:45 实测，`tests/module-size.test.mjs` 登记上限 vs 当前行数）：

| 文件 | 当前 | 上限 | 余量 | 登记处 |
|---|---:|---:|---:|---|
| `src/bridge.ts` | 904 | 905 | **1 行** | `tests/module-size.test.mjs:126-127` |
| `src/App.vue` | 2706 | 2737 | **31 行** | `:107-108` |
| `src/components/CodeEditor.vue` | 1144 | 1147 | 3 行 | `:135-136` |
| `native/main.cpp` | 1845 | 2000 | 155 行 | `:36-37` —— **本批四条都不需要它** |

---

## R1 · 诊断 `relatedInformation` 透传（**这条是重复登记，去读旧文件**）

**已存在，别重写**：`docs/wiring-requests-2026-10-06-problems.md:7`（标题「R1 · 诊断的 `relatedInformation` 透传（宿主 + 桥类型）」，文件 mtime 10-06 12:23）。该文件 `:189` 的状态复核行写明「仍缺 ⇒ 上面那段可照抄 cpp 与整行替换仍然有效（插入锚 `:149`→`:150` 本轮复核一致）」。

我在 13:45 重新打开确认，那份复核成立：

- `native/lsp_support.cpp:127-153` `Json shape_diagnostics(const Json& array)`：现在带 `line`/`character`/`message`/`severity`（`:134-135`）、`endLine`/`endCharacter`（`:137-141`）、`source`（`:142`）、`code`（`:148`）、`tags`（`:149`），**没有 `relatedInformation`**。
- `src/bridge.ts:118` `export interface LspDiagnostic { …; code?: string | number; tags?: number[] }` —— 逐字仍未加 related。注意**判词写的 `src/bridge.ts:109` 是错的**（`:109` 是 `Method` union），接线要动 `:118` 那一行。
- 前端半边全在原地等数据：`src/problems.ts:40-42` `relatedFrom(item)` 读 `item.relatedInformation ?? item.related`、`:81` `related?: RelatedLocationInput[]`、`:107` 带进 `ProblemRow`；`src/problemRelatedInformation.ts`（115 行折叠规则）；`src/components/ProblemsPanel.vue:50`、`:266-268`、`:770` 行菜单「相关位置」那一节。

**约束（宿主 lane 必读）**：`src/bridge.ts` 只剩 **1 行**余量 ⇒ `:118` 必须**原地改那一行**（加 `related?: …` 或 `relatedInformation?: …`），不许新增行；若要注释，`native/lsp_support.cpp` 那边写（该文件 376 行，默认上限 1100，不在保留名单）。

判据：`tests/problem-related.test.mjs`（147 行，前端半边）接上后应**一条都不用改**；宿主侧补 `native/` 的整形断言即可。上游依据（我已核过）：`platform/lsp-impl/src/impl/features/highlighting/LspDiagnosticAndLazyQuickFixes.kt:35-43`（`:42` `this.relatedInformation = diagnostic.relatedInformation`，上游不裁）。

---

## R2 · Alt+Enter 弹层的预览位（`dm/quickfix` 的缺）

**判词坐标要先订正**：`scripts/verdict_table.py:84`（→ `docs/inventory/verdict-daemon.md:29`）写「本仓弹层渲染在禁改文件 `src/App.vue:2704-2705`」——**错**。实测：

- `src/App.vue:2674` `<div v-if="actionPrompt" class="modal-backdrop" …>`、`:2675` 那一行里是 `<button v-for="(action, index) in codeActions" …><span>{{ action.title }}</span><span v-if="action.kind" class="small-muted">{{ action.kind }}</span>…` ⇒ 判词「行里只有标题与 kind 两列」**实质成立**（外加两个状态注 `由语言服务执行`/`需解析`）。
- `src/App.vue:2704` 是「关于 TaoCode」对话框、`:2705` 是 `</div>`、`:2706` 是 `</template>`。整文件只有 2706 行。

要请求的宿主行：在 `:2675` 那条 `<button>` 里给 `src/intentionPreview.ts`（118 行，`before/after` + 「±N 行」摘要，已在问题面板行菜单被消费）留一个呈现位（一行 `<span>` 足够，摘要文字由模块给，**不在 App.vue 里算**）。

预算：App.vue 余量 **31 行**，本条吃 1 行。若同批还有别的 App.vue 请求，这 31 行要显式分账。

上游依据：`platform/analysis-api/src/com/intellij/codeInsight/intention/IntentionPreviewInfoDiff`（本仓对照写在 `src/intentionPreview.ts`）；差异照判词如实记——上游把 before/after 画进**编辑器**，本仓只能画进**弹层那一行**。

---

## R3 · 错误树多视图的 ctx（`pf/error-tree` 缺③ 的后一半）

现状（我确认过的「只有一份」）：

- `src/components/ToolWindowView.vue:217` `<EventLogPanel v-else-if="view === 'notifications'" :entries="(ctx.noticeLog ?? []) as any" …/>`、`:44` `noticeLog?: any[]` —— `view` 联合与 ctx 字段都是单份。
- `src/problemsPanelState.ts:45` `const STORAGE_KEY = 'taocode.problemsPanel'` —— 一份全局存档，没有按树/按任务的键。
- `src/App.vue:847`/`:885`/`:1644` 是现有 `noticeLog` 的三处装配点（第二实例要走同一条链）。

要请求的宿主行：把第二份面板实例的 props/事件接进 `src/App.vue` 的 ctx（**装配一层，不含逻辑**）。

**先做不需要宿主的纯规则那半**：`src/problemsPanelState.ts` 存档按 `viewKey` 分桶（`:65-81` 的逐字段回默认形态照旧，**新键必须给旧存档补默认**——该文件 `:43-49` 就是这条事故留痕），判据 `tests/problems-panel-state.test.mjs` 扩一条「两把键互不串」。这一步做完，R3 的宿主行只是把已有第二份状态透出来，可**延后**，优先级低于 R1/R2。

预算：App.vue 余量 31 行（与 R2 同池）。

---

## R4 · 按请求 id 取消 LSP 请求（**建议不做，登记理由**）

缺口：`src/workspaceInspection.ts:81` `deps.query(...)` 在途时无法中止。`src/bridge.ts:109` 的 `Method` union 只有 `lsp.request`/`lsp.cancelProgress`/`lsp.stop`——`lsp.cancelProgress` 取消的是**服务器主动 begin 的 `$/progress`**（`native/lsp_session_progress.cpp`，50 行），不是任意一条在途请求。

为什么不建议：加一个方法名要同时吃 `src/bridge.ts` **仅剩的 1 行**余量与 `native/main.cpp`（余 155 行，但要动分派表）的配额，而 `docs/batch-2026-10-06-msgaudit.md` 的 **B3**（`src/workspaceInspection.ts:79` 补 `onCancel` + `:95-112` 合并循环查旗）已经能给出用户可观察的停止语义：**结果不再写入问题表**，代价为零宿主行。

除非桃点名要「能掐掉正在返回的 `workspace/diagnostic`」，否则按「不做」归档，把 bridge.ts 那一行留给 R1。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（`relatedInformation` 透传）** —— 与 bucket2b R1 同一条：前端已接（`src/problems.ts` + `ProblemsPanel.vue`），native/bridge 侧未透传。需 native/bridge owner。
- **R2（Alt+Enter 弹层预览位）** —— 目标 `src/App.vue`（本 lane，CodeActionPopup 已挂）+ `CodeEditor.vue`（禁改）。登记。
- **R3（错误树多视图 ctx）** —— 目标 `src/components/ToolWindowView.vue`（本 lane 可改面）+ `ProblemsPanel.vue`。登记为待办。
- **R4** —— 建议不做。

结论：零接线（R1 前端已接，其余登记/转 owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R1 前端已接，其余登记/转 owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
