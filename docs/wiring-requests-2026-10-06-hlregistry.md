# wiring requests 2026-10-06 · lane `hlregistry`

每条都给：目标文件 + 目标行号 + import 语句 + 可照抄的整段替换 + 上游依据。
出口名本轮**都打开目标文件核对过**（核对时间：本轮改动后，工作区状态）。
本 lane 一条线都没自己接进别人的文件 —— 下面 6 条的目标文件全部不是本 lane 的可写面。

---

## R1（首选，2 行落数值）— `src/components/CodeEditor.vue` 两条静默窗口与上游不同源

派单标注该文件预算 2 行 ⇒ 先给**正好 2 行**的版本：只把两个写死的毫秒数对齐上游那一族。

| 目标 | 现状（本轮打开核对） | 改成 |
| --- | --- | --- |
| `src/components/CodeEditor.vue:309` | `semanticTimer = window.setTimeout(() => { semanticTimer = undefined; void semanticWarmup.start() }, 400)` | 末位 `400` → `300` |
| `src/components/CodeEditor.vue:357` | `pullTimer = window.setTimeout(() => { pullTimer = undefined; void diagnosticWarmup.start() }, 350)` | 末位 `350` → `250` |

上游依据（逐条开过）：
- `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:324-328` ——
  300ms 那一档点名的就是 "Semantic tokens, document links, folding, code lens, inlay hints, and colors"；
  语义着色（`:309` 这一条）在点名列表里 ⇒ 400 是本地自加的数。
- `platform/lsp-impl/src/impl/features/highlighting/LspPullDiagnosticsCache.kt:30`
  `override val quiescenceDelay: Duration get() = DIAGNOSTICS_QUIESCENCE_DELAY`，
  而 `LspHighlightingCache.kt:321` = `250.milliseconds` ⇒ pull 诊断（`:357` 这一条）是 250 不是 350。
  `:316-320` 给了理由（诊断是用户在等的东西，窗口仍要吃得下 100-200ms 的打字节奏）。
- 本仓的单一真源已经在 `src/lspHighlightingCache.ts:226-227`（`DIAGNOSTICS_QUIESCENCE_MS = 250` /
  `LOW_PRIORITY_QUIESCENCE_MS = 300`），`src/codeLens.ts:262` 与 `src/editorInlayHints.ts:189` 都是这么引的。

### R1 完整版（若能给 3 行：数值 + 首拍绕窗口，两件事一起做）

```ts
// 新增一行 import（本文件现在没有这一条，本轮 grep 过 src/components/*.vue 零命中）
import { DIAGNOSTICS_QUIESCENCE_MS, LOW_PRIORITY_QUIESCENCE_MS } from '../lspHighlightingCache'
```
```ts
// :309 —— 首拍（这个视图还没拿到过任何一份答案）不等窗口
semanticTimer = window.setTimeout(() => { semanticTimer = undefined; void semanticWarmup.start() },
  semanticResultId ? LOW_PRIORITY_QUIESCENCE_MS : 0)
```
```ts
// :357 —— 首拍（这个文件还没有 resultId）不等窗口
pullTimer = window.setTimeout(() => { pullTimer = undefined; void diagnosticWarmup.start() },
  diagnosticIds.has(props.path) ? DIAGNOSTICS_QUIESCENCE_MS : 0)
```

上游依据：`LspHighlightingCache.kt:140-155`（`settleRequestStamp`）——`:146` 的
`if (quiescence > Duration.ZERO && !isFirstPullFor(file))`，`isFirstPullFor` 在 `:161-163`
（`= snapshot == null && inFlight == null`）。`:48-50` 那段注释明写"首拍不等，所以文件打开延迟不受这两个数影响"。
本仓现状是**首拍也等** ⇒ 打开一个 Java 文件后，语义着色晚 400ms、诊断晚 350ms 才第一次出现。
`semanticResultId`（`:299`）/ `diagnosticIds`（`:352`）是这个文件里现成的"手里有没有答案"状态，
与上游 `isFirstPullFor` 的"没有快照"同一半件（在飞的那一半拿不到，代价 = 最多多发一拍，不会少发）。

判据建议（主代理接完后配一条）：`tests/` 里读 `src/components/CodeEditor.vue` 原文，
断言 `400` 与 `350` 两个数字不再出现在这两个 `setTimeout` 上，且 `LOW_PRIORITY_QUIESCENCE_MS`/
`DIAGNOSTICS_QUIESCENCE_MS` 各出现一次。

---

## R1b（1 行）— `src/editorFoldingController.ts:42` 折叠重算窗口 400 → 上游 300

现状：`const debounceMs = deps.debounceMs ?? 400`（`:42`），而 `src/components/CodeEditor.vue:336-348`
的 `createFoldingController({…})` **没有**传 `debounceMs` ⇒ 实跑 400。
改：`const debounceMs = deps.debounceMs ?? LOW_PRIORITY_QUIESCENCE_MS`，并在文件头加
`import { LOW_PRIORITY_QUIESCENCE_MS } from './lspHighlightingCache.ts'`（`.ts` → `.ts` 的**值** import 必须带扩展名）。
上游依据：`LspHighlightingCache.kt:324-328` 点名 "folding" 在 300 那一族；`folding/LspFoldingRangeCache.kt:20-38`
自己不 override `quiescenceDelay` ⇒ 吃的就是 `:52` 的缺省（同一个 300）。
注：本轮**没动**这个文件（不在名下，且 `docs/batch-2026-10-06-folding.md` 那条 lane 正在跑折叠族）。

---

## R2（3 处，同一形状）— `src/editorInlayHints.ts` 的 `acceptFailed` 要带上自己那一发的号

现状（本轮打开核对）：

| 行 | 现状 | 改成 |
| --- | --- | --- |
| `:246` | `if (!attempt.asked) { inlayHintCache.acceptFailed(path); clear(); return }` | `inlayHintCache.acceptFailed(path, revision)` |
| `:248` | `inlayHintCache.acceptFailed(path)` | `inlayHintCache.acceptFailed(path, revision)` |
| `:257` | `if (!target) { inlayHintCache.acceptFailed(path); return }` | `inlayHintCache.acceptFailed(path, revision)` |

`revision` 就是这个作用域里 `:230` 已经算好的那一个（`const revision = semanticRevisionOf(editor.state.doc)`），
不需要新变量、不改缩进 ⇒ 三处各 1 行。
上游依据：`LspHighlightingCache.kt:121-132` 的 `finally` —— 释放 `fileToStampWhenRequestSent` 之前先问
`fileToInFlightRequest[file] === job`，`:129` 用的是 `remove(file, docModStamp)` **双参**形态（键与值都对上才删）。
为什么这是真缺陷（不是洁癖）：本仓的 `acceptFull`/`acceptUnchanged`/`acceptFailed` 原先**无条件** `delete`，
于是「R1 在飞 → 文档变 R2 → 为 R2 又发一发 → R1 的迟到答复被闸门挡掉」这一拍会把 **R2 的在途标记**一起抹掉，
下一拍 `pullPlan(path, R2)` 又回 `request` ⇒ 同一个文档版本向服务器发第二遍（`:96-102` 注释要拦的正是这个）。
模块那一半本轮已经改好（`src/lspHighlightingCache.ts:327` + `:332-365`），`acceptFailed` 的 stamp 形参做成
**可选**，不传即维持旧行为 ⇒ R2 不做也不会红，做了才把最后那条路径补上。
判据已在：`tests/lsp-highlighting-cache.test.mjs` 本轮新增的「Unchanged / Failed 同样按值释放在途标记」。

---

## R3（各 1 行）— 把各族的缓存登记进按特性注册表（含 push 那一族声明 `supportsPull: false`）

上游 `LspHighlightingCacheRegistry.kt:26-35` 是九条**具名**缓存；本仓的表（`src/semanticHighlighting.ts:305-364`）
现在只有 `semanticTokens` 一条，所以 `invalidatePulledResults()` 的扇出只打到一条上
（`src/editorSemanticField.ts:143` 的注释自己就写着"今天注册表里只有 semanticTokens 一条，所以两种写法等价"）。
本轮已经把 `registerHighlightingFeature` 的参数换成结构类型、并给条目加了 `supportsPull` 与过滤，
所以登记动作现在**只差各持有方一行**：

| 目标 | 现状 | 改成 |
| --- | --- | --- |
| `src/editorInlayHints.ts:171` | `export const inlayHintCache = new HighlightingSnapshotCache<LspInlayHint>()` | `export const inlayHintCache = new HighlightingSnapshotCache<LspInlayHint>({ featureId: 'inlayHint', supportsPull: true })` |
| `src/lspNavigation.ts:217` | `new HighlightingSnapshotCache<LspDiagnostic>({ quiescenceDelayMs: DIAGNOSTICS_QUIESCENCE_MS })` | 同一行再加 `featureId: 'diagnostic', supportsPull: false` —— 上游 `LspPublishDiagnosticsCache.kt:31` 的 `override val supportsPull: Boolean get() = false`，本仓这一族的结果由 `bridge.ts:343` 的 `lsp.diagnostics` 推来，客户端从不为它发拉取 |

`featureId` 的取值口径 = `src/lspFeatureMatrix.ts` 的 `kind`（`registerHighlightingFeature` 会拿它去查
`lspFeatureRow`，查不到或 provider 为空就**拒绝登记** —— 上游同一条链的闸是 `isSupportedForFile`，
`LspHighlightingCache.kt:62-63`，`src/editorInlayHints.ts:235` 已经按这个形状写了）。

**执行前提（本 lane 刻意没有先建）**：`HighlightingSnapshotCache` 现在**还没有** `featureId` 这个构造入参 ——
上面表格里那两行要和本模块的同一批改动一起落，改动量 = `src/lspHighlightingCache.ts` 的构造器加
`featureId?: string` 并在给了值时调 `registerHighlightingFeature({ featureId, supportsPull, invalidate … })`
（约 8 行，含注释；`lspHighlightingCache.ts → semanticHighlighting.ts` 这条 import 边本轮核过**不成环**：
`src/semanticHighlighting.ts:49-52` 只 import `editorSemanticColors`/`lspFeatureMatrix`/`lspPerFileCache`/`semanticTokens`，
而这四个文件本轮 grep 过 **一条 import 都没有**）。
本轮不落这一格，是因为它今天**没有生产读者**：注册表里多一条 path 键的缓存，而现有唯一的生产扇出口
`invalidatePulledResults(document: object)`（`src/editorSemanticField.ts:145`）按文档对象作废，
打不到按 path 键的那几条 ⇒ 登记进来只是一张只有判据在调的表。下面两条出口要在 R3 落地的**同一批**加，
先加就是死 API：

主代理批准 R3 时**需要本模块同批加两个出口**（本轮没先建，建了就是"只有判据在调的死 API"）：
1. `invalidatePulledResultsForPath(path: string): number` —— 上游 `:54-56` 的扇出按 `VirtualFile`，
   本仓快照缓存按 path，现成的 `invalidatePulledResults(document: object)`（消费方
   `src/editorSemanticField.ts:145`）拿的是文档对象那一型，两型必须分开给。
2. `fileEditedHighlightingCaches(path: string, edit: PendingEdit): void` —— 上游
   `LspHighlightingCacheRegistry.kt:42-44` + `LspClientImpl.kt:213-221`（注释 `:217-219` 明写不做的后果：
   "highlightings applied before the edit keep their pre-edit offsets until the next daemon pass"）。
   挂点现成：`src/lspNavigation.ts:243` 已经在每次编辑时算好 `textEditBetween(previous, text)` 并只喂给了
   `diagnosticRanges` 这一条；改成喂注册表，inlayHint 那一族的旧提示就不会在编辑后停在改前偏移。
   这条是本轮判词里**唯一带用户可见后果**的缺项（A11），且必须走注册表 —— 逐族 `fileEdited` 的写法
   要改 `src/editorInlayHints.ts` 的 `run()`，那个文件在并发黑名单里。

---

## R4（1 处）— `src/lspServerMessages.ts:596-597` 的 refresh 作废按特性而不是整族

现状：`function handleRefresh(message: LspServerMessageEnvelope): void { const cleared = clearAllLspCaches() … }`
—— 任何一句 `workspace/…/refresh` 都清整族。
上游是**逐族**的：`LspClientImpl.kt:235-240`（`refreshSemanticTokens` 只清 `semanticTokensCache`）、
`:242-252`（`refreshInlayHints` 只对每个打开的文件 `inlayHintsCache.invalidate(file)`）、
`:260-265`（`refreshDiagnostics` 只 `pullDiagnosticsCache.forceFullRepull(file)`）。
可见后果：`invalidate` 那一族**保留屏上的旧结果**直到新答案落地（`:284-291` 注释写着 "no flicker"），
而本仓的 `clearCache` 是连内容一起丢 ⇒ 内联提示/行上方提示会**先消失再出现**。
差异本仓已经在 `src/lspPerFileCache.ts:36-40` 如实记过一笔（"上游按单个缓存清，这里一次清整族"），
R4 就是把这一笔记账收掉：按 `message.method` 选族、`invalidate` 与 `clearCache` 分道。
需要 R3 的两个出口先落地才能写（否则没有"按 path 作废一族"的口）。

---

## R5（宿主 1 行 + 前端 1 处）— push 诊断的 `version` 闸门缺数据

上游 `LspPublishDiagnosticsCache.kt:78-88`：已打开文件的推送带 `version`，与当前文档版本不符 ⇒ **整条丢弃**，
等服务端重发（旧版本的诊断不显示）。本仓的规则已经写好了（`src/lspHighlightingCache.ts:435` 的
`acceptsPublishedVersion(declaredVersion, currentVersion, fileOpen)`，判据
`tests/lsp-highlighting-cache.test.mjs:140-149`），**但没有数据可喂**：
`native/lsp_support.cpp:127-152` 的 `shape_diagnostics` 逐条只搬 `range/severity/message/source/code/tags`，
`PublishDiagnosticsParams.version`（LSP 规范里 params 级的那个字段）在宿主这一层就被丢掉了 ⇒
`src/bridge.ts:343` 的 `case 'lsp.diagnostics'` 拿到的是"没有版本的推送"。
要落这一条：① 宿主在 `lsp.diagnostics` 事件里带上 `params.version`（`native/lsp_support.cpp` 一处 +
`native/lsp_session*.cpp` 的派发点，本 lane 不动 `native/`，且改了要跑 ctest）；
② `src/bridge.ts` 的推送处理里用 `acceptsPublishedVersion(version, 当前文档号, 是否打开)` 过一道
（`src/bridge.ts` 是 **0 预算**的保留文件）。
在此之前，本仓的文件头 `src/lspHighlightingCache.ts:48-52` 那条"没有版本闸门"的差异必须留着，不要改成"已对齐"。

## 处理结果（wiring-backlog lane，2026-10-06）

- 目标 `src/components/CodeEditor.vue`（禁改）+ `src/lspHighlightingCache.ts` / `lspNavigation.ts` 等（本 lane）。需 CodeEditor owner 提供扩展挂点，登记。

结论：零接线（转 CodeEditor owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（转 CodeEditor owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
