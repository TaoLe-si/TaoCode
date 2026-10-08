# 接线请求 2026-10-06 — lspdiagver（诊断整批 version 的传输段）

发起 lane：`lspdiagver`。报告：`docs/batch-2026-10-06-lspdiagver.md`。
本 lane 已把 native 侧做完（整形 + 契约槽位 + 能力声明 + ctest 判据），
**剩下两段在禁写文件里**，故提请求，不自己动手。所有出口名/行号都是本轮打开文件核对过的。

---

## R1 `native/main.cpp`（禁写：本轮未触碰）

**目标**：把整批 `PublishDiagnosticsParams.version` 放进 `lsp.diagnostics` 事件。

现状（`native/main.cpp:583-586`，在 `configure_lsp()` 里）：

```cpp
lsp = std::make_unique<taocode::lsp::Session>([this](std::string path, Json diagnostics) {
    queue_lsp({{"event", "lsp.diagnostics"}, {"path", path}, {"diagnostics", diagnostics}});
});
```

请求改成（**注册本 lane 新增的那一条 sink**，`native/lsp_session.hpp` 里已就位）：

```cpp
lsp = std::make_unique<taocode::lsp::Session>([](std::string, Json) {});
// 带版本的那条：Session 每条推送只走一条 sink（见 native/lsp_host_bootstrap.cpp 的分派），
// 所以旧的两参那条留一个空壳即可，不会重复发事件。
lsp->set_versioned_diagnostics_sink([this](std::string path, Json diagnostics, Json version) {
    Json event{{"event", "lsp.diagnostics"}, {"path", std::move(path)}, {"diagnostics", std::move(diagnostics)}};
    if (!version.is_null()) event["version"] = std::move(version);  // 服务器没声明就别写这个键：前端按「照收」处置
    queue_lsp(std::move(event));
});
```

依据与约束：
- 出口名核对：`taocode::lsp::Session::set_versioned_diagnostics_sink(VersionedDiagnosticsSink)`
  （声明在 `native/lsp_session.hpp`，`VersionedDiagnosticsSink = void(std::string, Json, Json)`）。
- **为什么不改 `DiagnosticsSink` 的元数**：`native/main.cpp` 注册的是两参 lambda，且它是
  `TaoCode` 目标的一部分（`CMakeLists.txt:100`），改元数会当场把宿主编坏 —— 本轮用"新增一条可选
  sink + 退回分支"的做法，`TaoCode.exe` 在**不改 main.cpp 的情况下**编译链接通过（已实测）。
- 线程：sink 在读线程上被调用（`Host::io_mutex_` 持有时），与旧那条同一条纪律 —— 不许取
  `Session::mutex_`、不许抛。`uri_to_relative` 用创建时快照的 root（`lsp_host_bootstrap.cpp:46`）。
- 判据（本轮已注入验证会红）：`native/lsp_session_test.cpp` 的
  「version 从真的帧里走到宿主手上…」与「整批 version 的整形…」。main.cpp 接线后建议补一条
  `tests/bridge.test.mjs` 级别的断言：事件里 `version` 缺席 ⇒ `lspDiagnostics` 照写。

## R2 `src/bridge.ts`（禁写：净余量 0 ⇒ 本请求自带等量腾位方案）

**目标**：让版本闸门 `acceptsPublishedVersion()` 拿到 `(declaredVersion, currentVersion, fileOpen)`。

出口名核对（都真的存在）：
- `src/bridge.ts:297` `export const lspDiagnostics = reactive(new Map<string, LspDiagnostic[]>())`
- `src/bridge.ts:118` `export interface LspDiagnostic { line; character; endLine?; endCharacter?; severity; message; source?; code?; tags? }`
- `src/bridge.ts:343-348` `case 'lsp.diagnostics'` → `applyPushedDiagnostics(data.path, data.diagnostics)`
- `src/bridge.ts:471-475` `export function applyPushedDiagnostics(path: string, list: unknown): boolean`
- `src/bridge.ts:458` `pullManagedFiles` / `:461 setPullDiagnostics` / `:466 isPullDiagnostics` / `:478 clearPullDiagnostics`
- `src/bridge.ts:486 setLspDiagnostics` / `:490 clearLspDiagnostics`
- 闸门在 `src/lspHighlightingCache.ts:441 acceptsPublishedVersion(declaredVersion, currentVersion, fileOpen)`（并发黑名单，本轮只读）
- 号源核对：前端**已经有**当前文档版本 —— `src/lspNavigation.ts:511` `tab.version = doc.version`
  （native 侧同一号在 `native/lsp_session.hpp:147 Document::version`，open 时置 1、每次 `lsp.change` 自增：
  `native/lsp_session.cpp:87/104/424`）。所以 `currentVersion` 不需要新造数据源。

### 等量腾位方案（必须先做，否则 904/905 一行都加不进去）

`tests/module-size.test.mjs:126-127` 登记 `src/bridge.ts` 上限 **905**，现在 **904** 行。

- **腾位（−38 行）**：把 `bridge.ts` 的诊断进表那一段（`pullManagedFiles` + `setPullDiagnostics` +
  `isPullDiagnostics` + `applyPushedDiagnostics` + `clearPullDiagnostics`，约 :452-482，含注释 44 行）
  整体搬进 **`src/lspDiagnosticsIngest.ts`**（本 lane 名下 `src/lspDiagnostics*`，可由我实现），
  `bridge.ts` 只留 `export { ... } from './lspDiagnosticsIngest.ts'` 4 行 re-export
  （`tests/bridge.test.mjs:402-440` 是从 `preview`（bridge 模块）上取 `applyPushedDiagnostics` 的，
  re-export 保住它，不用改测试）。净变化 **−40 行**。
- **用法（+6 行）**：腾出来之后加
  ```ts
  /** 陈旧的推送整批丢弃：`LspPublishDiagnosticsCache.kt:56-66`，闸门是 acceptsPublishedVersion()。 */
  let documentVersionProbe: ((path: string) => { version: number | null; open: boolean } | null) | null = null
  export function setDocumentVersionProbe(probe: typeof documentVersionProbe) { documentVersionProbe = probe }
  ```
  并把 `applyPushedDiagnostics(path, list)` 改成 `applyPushedDiagnostics(path, list, declaredVersion?: number | null)`，
  体内先问闸门：
  ```ts
  const probe = documentVersionProbe?.(path) ?? null
  if (!acceptsPublishedVersion(declaredVersion ?? null, probe?.version ?? null, probe?.open ?? false)) return false
  ```
  （`case 'lsp.diagnostics'` 那行补第三参 `data.version`，同一行改完，不加行数。）
- 为什么用 probe 注入而不是在 bridge 里存版本：版本的真身在编辑器（`src/lspNavigation.ts`）与
  `native` 两侧都有，bridge 再造一份就是第三个号源（会漂）。probe 由 App 侧注册一次即可。

### 不许顺手做的事
- 不许把 `version` 塞进每条 `LspDiagnostic`（`LspDiagnostic` 里没有这个字段，条目层也拿不到整批的号：
  LSP 的 `version` 是 `PublishDiagnosticsParams` 的兄弟字段）。
- 不许在 bridge 里"没有版本就当第 0 版"：`acceptsPublishedVersion(null, …)` 的语义是**照收**
  （上游 `:57` 的 `declaredVersion != null` 才比），塌成 0 会把所有不声明版本的服务器变成"永远拒收"。

## R3（可选，同一批接线）`docs/inventory/citation-anchors.json` / 旧坐标订正

仓里把上游版本闸门引成 `LspPublishDiagnosticsCache.kt:78-88`（`src/lspHighlightingCache.ts:21-22,52`、
`tests/lsp-highlighting-cache.test.mjs:11`）。本轮开参考树逐行核对：
`platform/lsp-impl/src/impl/features/**highlighting**/LspPublishDiagnosticsCache.kt`（**不是**
`highlightingCommon/`）的版本闸门在 **:56-66**，按 documentUri 分桶合并在 **:74-81**；
`:78-88` 落的是分桶+`buildHighlightings` 那一段。`docs/inventory/**` 是特批 `ledgerfix` 名下，
本 lane 不动，只登记。新写的引用一律用 `:56-66` / `:74-81`。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1** —— `native/main.cpp`（禁改），非本 lane。
- **R2** —— `src/bridge.ts`（前端接线 lane 独占），非本 lane。
- **R3** —— `docs/inventory/*`，非本 lane。

结论：零接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
