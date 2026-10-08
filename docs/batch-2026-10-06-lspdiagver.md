# batch-2026-10-06 lspdiagver

Lane: lspdiagver (D:	aoCode). Goal: make the host expose diagnostics `version` so the frontend version gate has data.

## 0. Status
- [ ] baseline tests run
- [ ] nature verdict (never landed / half landed)
- [ ] native passthrough
- [ ] gates raw numbers

## 1. Baseline (real filenames verified by ls/grep)

- Path corrections vs. the dispatch text: there is **no** `src/lspDiagnostics*` and **no** `src/editorDiagnostics*`.
  Real files in the area: `src/editorDiagnosticMarkers.ts`, `src/workspaceDiagnostics.ts`,
  `src/gradleJvmDiagnostics.ts`, `src/lspHighlightingCache.ts` (blacklisted, read-only).
- Native test glob `native/lsp*test.cpp` real members: lsp_test, lsp_host_test, lsp_session_test,
  lsp_kinds_test, lsp_coding_test, lsp_semantics_test, lsp_real_test, lsp_worker_test,
  lsp_config_test, lsp_children_test, lsp_discovery_test, java_lsp_paths_test.
- JS gate command ran green before any change:
  `node --test tests/*diagnostic*.test.mjs tests/lsp*.test.mjs tests/module-size.test.mjs`
  => `tests 168 / pass 168 / fail 0` (raw log kept at `.tmp-lspdiagver-baseline.txt`).

## 2. Nature verdict: 落了半截 (three separate half-steps, plus a wrong drop-site in the premise)

复核结论 —— 派单说的 `native/lsp_support.cpp:127-152` **不是** version 的丢失点：
`PublishDiagnosticsParams.version` 是 **params 层**的兄弟字段，不是每条 diagnostic 的字段
（LSP 3.17 `textDocument/publishDiagnostics`：`PublishDiagnosticsParams { uri, diagnostics[], version?: integer }`），
而 `shape_diagnostics(const Json& array)` 收到的已经是 `params.at("diagnostics")` 这一层，
结构上**不可能**搬得到 version。真正的丢失点在调用它的那一层：

1. `native/lsp.cpp:683-684` —— 读线程把整条 `params` 原样交给 `diagnostics_` 回调 ⇒ **version 到这里还在**。
2. `native/lsp_host_bootstrap.cpp:47-57` —— `Session` 侧的 lambda 只取 `uri` + `diagnostics`，
   `on_diagnostics_(path, std::move(diagnostics))` ⇒ **version 在这一行掉地**（第一个真丢失点）。
3. `native/lsp_session.hpp:41` —— `using DiagnosticsSink = std::function<void(std::string path, Json diagnostics)>`
   ⇒ 签名里没有 version 的位置（第二个丢失点：契约缺槽位）。
4. `native/main.cpp:585` —— `queue_lsp({{"event","lsp.diagnostics"},{"path",path},{"diagnostics",diagnostics}})`
   ⇒ 事件里也没有 version（第三个丢失点；该文件 **禁写**）。
5. `src/bridge.ts:343-348` —— `applyPushedDiagnostics(data.path, data.diagnostics)` ⇒ 没往下传 version
   （**禁写**，净余量 0）。
6. `src/lspHighlightingCache.ts:441` —— `acceptsPublishedVersion(...)` **函数本体已在**，
   但 `grep -rn acceptsPublishedVersion src/` 只有这一处定义、**零调用者** ⇒ 闸门是空的。
7. `native/lsp_host_bootstrap.cpp:171` —— 客户端能力声明 `publishDiagnostics.versionSupport = false`
   ⇒ 就算前面全通了，按规范服务器**有权不发 version**。这条是第四处「落了半截」。

所以性质是「落了半截」，而且是**四截**：闸门函数已就位（6）、通道缺槽（3）、宿主缺发射（4）、
能力声明自否（7）。

## 3. Native change

## 4. Edge cases

## 5. Frontend consumption chain

## 6. Gate raw numbers

## 7. Coordinates cited (upstream)

