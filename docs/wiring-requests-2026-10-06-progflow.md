# 接线请求 · 2026-10-06 · `progflow` 收口（含它名下四文件里的**无署名半截**）

出处报告：`docs/batch-2026-10-06-progflow.md`（归属、坐标、原始数字都在那儿）。
本文件由只读报告 lane 写：**没有**改任何 `src/`、`native/`、`tests/`、`docs/inventory/*`；没有 commit/push；没有跑 `TAOCODE_CITATION_ANCHORS=update`。

**保留文件余量（按门禁尺 `tests/module-size.test.mjs:157` 的 `split('\n').length` 重测，不是 `wc -l`）**：

| 文件 | 现值 / 上限 | 余量 |
|---|---|---|
| `src/App.vue` | 2707 / 2737（`:108`） | **30** 行（任务书写的 31 是 `wc -l` 口径，看板 §21 已自行更正） |
| `src/bridge.ts` | 905 / 905（`:127`） | **0** 行 ⇒ **已贴顶，加任何一行必须同批等额减行**（任务书写的 1 同样作废） |
| `src/gradleHost.ts` | 897 / 900（未登记 ⇒ `DEFAULT_LIMIT`，`:22`） | **3** 行 |
| `src/workspaceInspection.ts` / `src/backgroundTasks.ts` / `src/progressPanel.ts` | 161 / 424 / 167，均 900 | 739 / 476 / 733 行 |
| `src/externalSystemAutoImport.ts` / `src/externalSystemAutoLink.ts` | 605 / 83 | 295 / 817 行 |

⇒ 下面每条请求都自带行数账；**R1/R2/R4 三条都不动 `bridge.ts`、不占 `App.vue` 的行**。

---

## R1 · 必须 · `src/gradleHost.ts:880` 用了全仓不存在的常量 ⇒ 类型红 + 运行期静默抛

**现状（磁盘）**

- `grep -rn "UNLINKED_PROJECT_DISPLAY_ID" src tests native` ⇒ **只有 `src/gradleHost.ts:880` 这一处使用，零处定义**。
- 两条别的 lane 的 `vue-tsc` 落盘记录一致：`.tmp-intentw-tsc-final.txt`（15:20）与 `.tmp-vcsloge-tsc.txt`（15:19）都写
  `src/gradleHost.ts(880,74): error TS2304: Cannot find name 'UNLINKED_PROJECT_DISPLAY_ID'.`
- 运行期后果（我按块结构读过）：这一句在 `:857` 那个 `void (async () => { … })()` 里，走到这一支就整块以 **unhandled rejection** 结束
  ⇒ 通知**弹不出来**（不是崩屏，是"上游那条 UPN 通知在我们这里静默"），也就是 G7 那块想修的用户可见行为**实际一次都没发生过**。
  走到这一支的条件：`:874` 的 `autoLink && unlinkedProjects.shouldShowUnlinkedNotification(GRADLE_SYSTEM.id, true)` 为假
  （`src/externalSystemAutoImport.ts:466-468` = `autoLinkEnabled && awares.has(systemId)`，所以登记表里还没有 Gradle 就落进 else），
  且 `src/externalSystemAutoLink.ts:61-71` 判"没跳过过"（缺键默认 false，`:54` 那条留痕已核）。

**改法（两处同批，`gradleHost.ts` 净 0 行）**

1. `src/externalSystemAutoImport.ts` —— 在**已有**的未链接通知模型旁边定义（磁盘现状 `:507-529` 是 `UnlinkedProjectNotice` + `unlinkedProjectNotice()`）：

   new（插在 `:506` 与 `:507` 之间，即 `unlinkedProjectNotice` 那组导出的正上方；**+2 行**，该文件余 295 行）：
   ```ts
   /** 未链接工程通知的 `displayId`：同一条通知就地顶替（`src/notifications.ts:66,73` 的 `canShowNotice`/`displayId` 语义）。 */
   export const UNLINKED_PROJECT_DISPLAY_ID = 'external-system:unlinked'
   ```

2. `src/gradleHost.ts:46` —— 把常量并进**已有的**那条 import（净 0 行）：

   old（逐字）：
   ```ts
     projectIdOf, unlinkedProjectNotice,
   ```
   new（逐字，同一行改）：
   ```ts
     projectIdOf, unlinkedProjectNotice, UNLINKED_PROJECT_DISPLAY_ID,
   ```
   `src/gradleHost.ts:880` 那一行**一个字都不用动**。

**为什么是这个值、不是别的**
上游那条通知的收敛口径是"每个 `ExternalSystemProjectId` 只弹一次"：`UnlinkedProjectNotificationAware.kt:40`
（`notifiedNotifications` 那张按 projectId 的表）与 `:42-50`（`:43-46` 跳过过 ⇒ return、`:47-50` 已弹过 ⇒ return）；
`:54` 拿的是 notification **group** id，不是 displayId ⇒ 本仓的 displayId 只要承担"同一条别堆两份"，
按本仓既有写法取 `external-system:` 前缀（对照 `src/autoImportNotifications.ts:32` 的 `external-system:reload:${systemId}`
与 `src/notificationPowerSave.ts:56` 的 `'power.save.mode'`）。**上游没有这个字符串，本仓自取，登记为自造标识**（不是文案，不违反文案条）。

**判据（要同批落，缺一判 R1 未做完）**
1. `npx vue-tsc -b --force` 里这条 `TS2304` 消失（总数应从看板 §21 记的 6 条降到 5 条）。
2. 新判据 `tests/gradle-unlinked-notice.test.mjs`（**必须能红**：先注释掉常量 → `ReferenceError`/断言失败）：
   - 断言 `autoLink` 关掉时 `deps.notify` 被调用且第 5 参 === `UNLINKED_PROJECT_DISPLAY_ID`、第 1 参含「Gradle」；
   - 断言 `store` 里有 `unlinkedNoticeSkipKey(root)` ⇒ 第二次打开**不再**弹（对 `UnlinkedProjectNotificationAware.kt:47-50`）；
   - 反证一条：`grep src/gradleHost.ts` 里 `notify(...)` 的 displayId 位置不许再出现未在 `src/**` 定义过的标识符
     （用现成的 `src/notifications.ts` 常量清单比）。
3. `node --test tests/gradle* tests/background* tests/progress* tests/module-size` 仍 0 红（`gradleHost.ts` 门禁尺仍 ≤900）。

**归属提醒**：看板 §21（`docs/batch-2026-10-06-lane-board.md:332`）把这条记在 progflow 名下；
`docs/batch-2026-10-06-roots4.md:121` 又明确声明 roots4close 未读写 `gradleHost.ts`，而没有任何文档认领这块（详见报告 §3）。
⇒ **谁做都行，但别把它当成"progflow 已交付的功能"**；它是 G7 那块（未链接通知）的最后一根线，不是队列/取消域。

---

## R2 · 必须 · 用户主动取消整工程检查，现在被当**错误**弹一句红字（`App.vue` 净 0 行）

**现状**
- `src/workspaceInspection.ts:94-95` 取消时返回 `{ ok: false, message: '整工程检查已取消。', … }`；
- `src/App.vue:1586` 是 `notify(outcome.message, !outcome.ok)` ⇒ 取消 = **error 档**通知。
- 这条口径与 progflow 自己写的判据头注冲突：`tests/inspection-cancel.test.mjs:20-23` 明说
  "参考树里没有整工程检查'被取消'的通知串……上游取消就是进度行消失、不弹通知"。
- 参考树复核（我跑的）：`grep -in cancel platform/analysis-api/resources/messages/InspectionsBundle.properties` ⇒ **0 命中**；
  上游取消那一路 = `GlobalInspectionContextImpl.java:726-727`（吞掉 `ProcessCanceledException`）+ `:729-733`（finally 照走）⇒ 只有行消失。

**改法（三处同批，`App.vue` 净 0 行、`workspaceInspection.ts` +1 行）**

1. `src/workspaceInspection.ts:56` 之后插**一行**（该文件余 739 行）：

   new（插在 `:56` `ok: boolean` 与 `:57` `message: string` 之间；顺序按现有字段风格，带注释就 +2 行，不带就 +1 行）：
   ```ts
     /** 用户点掉的（不是失败）⇒ 宿主不该按 error 档弹它（上游取消只让进度行消失）。 */
     cancelled?: boolean
   ```

2. `src/workspaceInspection.ts:94-95` 的 `cancelledOutcome()` 里补一个字段（**同一行改，净 0**）：

   old（逐字，`:95`）：
   ```ts
     ({ ok: false, message: '整工程检查已取消。', scanned: 0, found: 0, skipped: 0, profile })
   ```
   new（逐字）：
   ```ts
     ({ ok: false, cancelled: true, message: '整工程检查已取消。', scanned: 0, found: 0, skipped: 0, profile })
   ```

3. `src/App.vue:1586` 同句加一个判据（**净 0 行**，30 行余量不动）：

   old（逐字）：
   ```ts
     notify(outcome.message, !outcome.ok)
   ```
   new（逐字）：
   ```ts
     if (!outcome.cancelled) notify(outcome.message, !outcome.ok)
   ```
   （如果桃要"取消也给一句灰字"，同一行改成 `notify(outcome.message, !outcome.ok && !outcome.cancelled)` —— 仍是净 0 行，二选一，别两处都写。）

**为什么**：取消是用户动作，不是故障；把它弹成红字 = 把 A4/B3 那条"能取消"的收口变成"能取消且被骂一句"。
`src/progressPanel.ts:154-158` 那条 `'background'` 分支的写法就是同一个口径的正面例子：**真的**没收尾才弹红字（"后台任务没有响应取消，仍在运行。"）。

**判据**
- 新断言进 `tests/inspection-cancel.test.mjs`（钉意图不钉字面量）：
  `assert.match(app, /if \(!outcome\.cancelled\) notify\(outcome\.message, !outcome\.ok\)/)`，
  并加一条 `assert.equal(outcome.cancelled, true, …)` 在现有 `:65`（`outcome.ok === false`）旁边；
- 反向不许：`assert.doesNotMatch(app, /notify\(outcome\.message, !outcome\.ok\)\s*$/)`（旧句不许回来）；
- `node --test tests/inspection-cancel.test.mjs tests/workspace-diagnostics.test.mjs tests/analysis-scope.test.mjs` 0 红（现在这三份 = 见报告 §8 的 41/41/0）。

---

## R3 · 登记性 · 队列指示器的写入面**生产侧零调用**（建议本轮不做，理由随文）

**现状**：`src/backgroundTasks.ts:66-68`（`setText`/`setFraction`/`setIndeterminate`）与 `:78`（`runNonSuspendable`）在生产侧没有任何调用者
（唯一入队消费者 `src/gradleHost.ts:216-220` 只用 `awaitResumed()`/`checkCanceled()`；读 `text/fraction` 的只有测试）；
`queueRow.percent` 三档恒 `null`（`:391,404,413`）⇒ 队列那一行永远没有进度条。
这与"死出口"铁律擦边，但它与 `cancelCurrent` 那批不同：**它是上游接口的对应面**
（`ProgressIndicatorModel.kt:39-41` `setFraction` / `:47-49` `setText`，我核过），删了就没有"任务的写入面"这件东西了。

**唯一不重复的接法（要做就做这个，别做"给队列行加百分比"）**
在 `src/gradleHost.ts:455-458` 那个检查点**之后**，把"第 i/N 个目录"写进 `job.progress` 的 text：

- 前置腾位（`gradleHost.ts` 只有 **3 行**）：把 `:863-884` 那 22 行（G7 的未链接通知块）整体搬进新模块 `src/gradleUnlinkedNotice.ts`，
  `gradleHost.ts` 只留一次调用（2 行）⇒ **净腾约 18 行**；搬完再落这 2 行：
  ```ts
      if (job.progress) job.progress.setText(`${目录序号}/${总数} · ${job.directory}`)
  ```
- **不许**改 `queueRow` 去显示 `fraction`：那会与 `src/progressPanel.ts:64-71` 的 Gradle 行重复，
  正是 `tests/progress-queue-cancel-row.test.mjs:120-141` 钉死禁止的形状（"同一个操作画两遍 = 两个取消按钮指向同一件事"）。

**判据（若做）**：`tests/gradle-host.test.mjs` 加一条断"挂起期间那一行的 detail 带目录序号"；`module-size` 仍绿；orphan 门不许把新模块列成零消费方。
**建议**：本轮**不做**，在判决簿把 `pf/progress` 的这条写成"接口对齐上游、暂无生产写入者；第二个入队消费者出现时一并接"，
理由是现在唯一的 producer（Gradle 重载）**拿不到总量**（`src/progressPanel.ts:60-63` 已把这件事写死：CLI 通道没有 Tooling API 的 progress/total）。

---

## R4 · 必须 · `tests/notice-actions.test.mjs:107` 那条判据现在**红**（它钉的是 G6 之前的形状）

**现状（我跑过，原始输出见报告 §8）**：`ℹ fail 1`，红在 `:109` 与 `:117-119`，因为 `src/gradleHost.ts:438` 的
`notifyFailure` 多了第 4 参 `issueActions?`、`:553-554` 的调用句尾多了 `, jvmIssue ? […] : undefined)`。
**意图没变**（"每条命令的失败都经 notifyFailure、各带中文标签"），变的是形状 ⇒ 按纪律"改成仍精确"，**不许放松成 `includes`**。

**逐字改法（只动测试，不动生产码）**

- `tests/notice-actions.test.mjs:109`
  old：
  ```js
    assert.match(gradleHost, /function notifyFailure\(directory: string, label: string, error: string\): void/, '失败要发一条带按钮的通知，不只是灰字')
  ```
  new：
  ```js
    assert.match(gradleHost, /function notifyFailure\(directory: string, label: string, error: string, issueActions\?: \{ label: string; run: \(\) => void \}\[\]\): void/, '失败要发一条带按钮的通知，不只是灰字')
  ```
- `:110-112` 那个 `for (const label of […])` 里，数组要按 G6 的真实档位补一条**可选**语义：
  `构建工具设置` 是兜底动作、`GRADLE_JVM_OPEN_SETTINGS_ACTION` 是 JDK 档的替换动作 ⇒ 把这三条中文保留，
  另加一条 `assert.ok(gradleHost.includes('issueActions?.length ? issueActions :'), '替换档必须兜回默认档，不能给空按钮组')`。
- `:117-119`
  old（第 118 行那条正则的结尾）：`…, error\)/,`
  new：`…, error,$/m` 之后另起一条匹配续行 `jvmIssue ? \`[{ label: GRADLE_JVM_OPEN_SETTINGS_ACTION…  ]\` : undefined)` —— 
  **落盘时按 `src/gradleHost.ts:553-554` 这两行原文取整句**（我逐字取过，粘贴即可）：
  ```js
    assert.match(gradleHost,
      /notifyFailure\(job\.directory, job\.kind === 'sync' \? 'Gradle 同步' : job\.kind === 'dependencies' \? '依赖加载' : '任务运行', error,\n\s+jvmIssue \? \[\{ label: GRADLE_JVM_OPEN_SETTINGS_ACTION, run: \(\) => \{ void deps\.openSettings\(GRADLE_CONFIGURABLE_ID\) \} \}\] : undefined\)/,
      '同步/依赖/任务运行三条命令的失败都要发出去，且各带自己的标签；JDK 档换「打开 Gradle 设置」')
  ```
- `:114` 那句注释里的坐标 `src/gradleHost.ts:519-521` 已经漂（本轮实测那三档三元现在在 **`:553`** 与 `:556-557`）⇒ 同批把注释里的行号改成磁盘现值。

**判据**：`node --test tests/notice-actions.test.mjs tests/progress-notices.test.mjs` 从 `fail 1` → **0 红**；
两条 `assert.match` 都仍是**整句精确匹配**（`/…/` 全句，不是 `includes`）。
**归属**：G6 那条无署名 lane（JVM 诊断族，`src/gradleJvmDiagnostics.ts` 未跟踪）；progflowdoc 只报不动。

---

## R5 · 维持"不做"归档 · 掐掉**在途**的 `workspace/diagnostic`（`bridge.ts` 余量 **0** ⇒ 必须自带等额腾位）

缺口与上一轮同一句：`src/workspaceInspection.ts:97-100` 只能保证"结果到手不写表"，掐不掉在途请求
（`docs/wiring-requests-2026-10-06-msgaudit.md:63-69` R4、`docs/batch-2026-10-06-msgaudit.md:77` C4）。
本轮复核仍然成立：`src/bridge.ts` 的 `Method` union 里没有"按请求 id 取消"，`lsp.cancelProgress` 只作用于服务器主动 begin 的 `$/progress`。

**为什么继续建议不做**：`src/bridge.ts` 是 **905/905，余量 0**（看板 §21 已把"1 行"更正为"0 行"，本轮复测一致）。
加一个方法名 = 加一行 ⇒ 必须先等额减行，而这条还要同时动 `native/`（分派表 + LSP 会话）与机检锚点（`Method` union）。
收益是"少等几秒"，`R1/R2/R4` 的收益是"通知能弹、取消不挨骂、判据回绿"。

**若桃点名要做，腾位办法（可数，且是仓里已成立的手法）**
1. `src/bridge.ts` 现在有 **34** 条 `export interface Lsp*`（`grep -c "^export interface Lsp" src/bridge.ts`）。
2. 先例在登记说明里就写着：`tests/module-size.test.mjs:128-133` —— 2026-10-05 把预览那组整体搬进 `src/bridgePreview.ts`、
   错误类型搬进 `src/bridgeError.ts`，`bridge.ts` **原样转出**，上限从 1208 降到 905。同一个手法可复用：
   新建 `src/bridgeLspTypes.ts` 收 `LspDiagnostic* / LspHover* / LspCompletion* / LspLocation / LspRange` 这一族，
   `bridge.ts` 只留 `export type { … } from './bridgeLspTypes.ts'`（1 行）⇒ 腾出的行数**按搬走的条数计**，
   再在其中花 1 行加 `lsp.request.cancel` 到 `Method` union ⇒ 门禁尺仍 ≤905。
3. 同批必须：`native/lsp*` 与 `native/main.cpp` 的分派、`docs/inventory/citation-anchors.json` 的机检（`Method` union 是锚点）
   ⇒ **`TAOCODE_CITATION_ANCHORS=update` 由主代理收口时跑，本 lane 没跑**。

**判据（若做）**：`node --test tests/module-size.test.mjs tests/source-citations.test.mjs` 绿；
`node --test tests/lsp*.test.mjs` 新增一条"取消在途请求后 `workspace/diagnostic` 的响应不写诊断表"（这条要在**没实现**时红）。

---

## R6 · 文档口径（不改码）· status2 那两份要把 W3 划掉

- `docs/wiring-requests-2026-10-06-status2.md:132` 现在写 W3「**仍缺**」并引 old 文本 `run: async () => { await sync() },` ——
  磁盘上该句**已不存在**（现在是 `src/gradleHost.ts:216-220` 的三行任务体）⇒ 改「已做（2026-10-06 progflow）」，并把 `:54-72` 的 old/new 块标成历史。
- `docs/batch-2026-10-06-status2.md:53` 那张表写 `src/backgroundTasks.ts` 361 → 382 行 —— 本轮之后是 **423**（`wc`）/ 424（门禁尺）；
  它给的 `queueSuspendReason`、`queueRow` 行号（`:344-356`、`:364-367`）也漂了 ⇒ 现值 `:196`、`:369-415`（取消档 `:386-393`、挂起档 `:399-406`、排队档 `:407-414`）。
- `docs/wiring-requests-2026-10-06-status2defect.md:45,99` 那条"兜底文案二选一"——本轮选了**"不接"**（删参数），
  落点 `src/progressSuspender.ts:96-101`（工厂签名两参）与 `src/backgroundTasks.ts:246-258`（调用不带文案）⇒ 该请求关闭，别再有人去"接回兜底"。

**判据**：纯文档，人查一遍引用链（`grep -rn "wiring-requests-2026-10-06-status2.md" docs src tests`）里不再出现"仍缺"。

---

## R7 · 归属请示（信息项，不要动码）

`docs/batch-2026-10-06-lane-board.md:215-217` 说 progflow 只欠归属文档 ⇒ 本报告与 R1/R2/R4 补齐后成立。
但同一看板 `:332` 把 `gradleHost.ts:880` 记成 progflow 名下，而磁盘证据三条互相矛盾：
① 没有任何文档认领 G5/G6/G7（`grep -rln "gradleJvmDiagnostics\|skipUnlinkedNotice\|unlinkedProjectNotice" docs HANDOFF.md` = 0）；
② `docs/batch-2026-10-06-roots4.md:121` 明确 disclaim `gradleHost.ts`；③ mtime 窗口撞车（`gradleJvmDiagnostics.ts` 14:43 / `gradle.ts` 14:44 / `externalSystemAutoLink.ts` 14:45 vs progflow 的 `workspaceInspection.ts` 14:43、`backgroundTasks.ts` 14:39、`gradleHost.ts` 14:59）。

⇒ 请主代理只做一件事：**在收口前把 G5/G6/G7 的归属写成"某 lane 名下"或"未归属在飞"**，
别让它挂在一个已死、且无法再答辩的 lane 上；R1 的执行者按那条归属派单即可。

---

## 收口顺序建议（价值/风险比）

1. **R1**（一行 import + 一行常量；不修它，G7 那块的全部用户可见收益 = 0，且 `vue-tsc` 永远有 1 条）。
2. **R4**（只动测试；不修它，`tests/notice-actions.test.mjs` 在全量回归里一直红）。
3. **R2**（三处、净 0 行；不修它，"能取消"这条刚交付的能力附带一句骂人的红字）。
4. **R6**（文档同步，防下一轮又照旧文本"补做"一遍 W3）。
5. **R3 / R5**（登记性；除非桃点名，别占并发位）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1** —— `src/gradleHost.ts`（本 lane 可改面，但属 gradle 域）。登记为待办（全仓不存在常量 ⇒ 类型红）。
- **R2（取消整工程检查被当错误弹红字）** —— 目标 `src/App.vue:1586` 附近（本 lane）+ `src/workspaceInspection.ts`（本 lane）。登记为待办（三处同批：`cancelled?` 字段 + `cancelledOutcome` 置位 + App.vue 判据）。
- **R3 / R4 / R5 / R6 / R7** —— 登记/文档口径项。

结论：零接线（R1/R2 登记，R4 判据红需对应 owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R1/R2 登记，R4 判据红需对应 owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
