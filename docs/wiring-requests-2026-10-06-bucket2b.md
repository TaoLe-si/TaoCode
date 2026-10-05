# 接线请求 · 桶 2b（检查与问题视图）· 2026-10-06

> 只需要动保留文件的部分才写在这里。本轮共 **1 条硬请求**（R1）+ **1 条可选请求**（R2）+ **1 条状态说明**（不需要动，列出来免得重复处理）。

## R1 · 诊断的 `relatedInformation` 透传（宿主 + 桥类型）

- 目标文件：`native/lsp_support.cpp` 的 `shape_diagnostics`（第 127-150 行那一段，紧跟着现有的 `:148-149` 两行 `code`/`tags` 透传）
- 要接什么：把 LSP `Diagnostic.relatedInformation` 数组原样带出来（每项 `{ line, character, endLine?, endCharacter?, message }`，坐标换算复用同一文件里已有的行列折法），并加 `codeDescription?.href`（诊断码的文档链接，一个字符串）。
  随后 `src/bridge.ts:118` 的 `interface LspDiagnostic` 加两个可选字段：
  ```ts
  relatedInformation?: Array<{ line: number; character: number; endLine?: number; endCharacter?: number; message: string }>
  codeDescriptionHref?: string
  ```
- 为什么需要：这是「诊断 → IDEA 检查项」这条链上**最后一个断点**。本轮已经把能做的都做完并验证了（`src/inspectionIdentity.ts` 把 `source`/`code`/`tags` 折成检查项身份，问题视图的分组标题、文本过滤、行芯片、profile 的启停粒度都吃它，判据 `tests/problem-identity.test.mjs` + `tests/inspection-item.test.mjs`）。剩下上游的「一条问题带几条关联位置」这一面：
  - 上游依据：`platform/lsp-impl/src/impl/features/highlighting/LspDiagnosticAndLazyQuickFixes.kt:42` —— LSP 宿主把 `relatedInformation` **原样保留**进它持有的注解数据（`this.relatedInformation = diagnostic.relatedInformation`），问题呈现层因此能列出「同一处错误的其它相关位置」；
  - `docs/inventory/verdict-daemon.md` 的 `dm/problems-view` 行里那条「Project Problems 的成员级关联问题（`BrokenUsage`/`RelatedProblem`）」缺口的**可移植子集**就是这个：不需要 PSI，只需要把服务器给的相关位置带过来，我这边立刻在 `src/problems.ts` 落成 `ProblemRow.related`、在 `ProblemsPanel.vue` 的行菜单里加「相关位置」一节（点开逐个可跳源），完全接得上现有的 reveal 通道；
  - 现在宿主在 `shape_diagnostics` 就把它丢了，前端拿不到，**做出来就是假控件**（列表永远是空的），所以按「不放假控件」的铁律我没做。
- 备注：`codeDescription.href` 顺带一起透传（同一个函数、同一份 JSON 遍历，几乎零成本），我这边接的是「按检查项」分组标题上的文档链接下钻；上游对应的富文档面（`InspectionDescriptionDocumentationProvider`，`docs/inventory/verdict-platform_rest.md` 的 `lp/inspections` 行的「缺」）在本仓没有本地检查描述文件可读，语言服务给的这条 href 是唯一能承接的来源。
- native 改完需要：`CMakeLists.txt` 不用动（改的是已注册的 `native/lsp_support.cpp`），跑 `.tools/nctest-all.bat` 给 ctest 结果。

## R2 ·（可选）状态栏/工具栏的「按检查项」入口

- 目标文件：`src/App.vue`（问题面板的挂载点，约 `:2307` 附近那一块）
- 要接什么：不需要新逻辑 —— 面板已经自带了「按检查项（IDEA 的 groupByToolId）」这一档下拉项（`src/components/ProblemsPanel.vue` 的 `<option value="inspection">`），持久化也在 `src/problemsPanelState.ts`（白名单现在直接取 `PROBLEM_GROUPINGS`）。**只要 App.vue 不改就没有额外要做的事**；列在这里是因为若主代理要把「检查项」做成状态栏的第二枚芯片（`Unused declaration` 计数），数据已经从 `src/problems.ts` 的 `ProblemRow.tags` 出来了，一行 `problemCounts` 的扩展即可，我可以在下一轮补。
- 上游依据：`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/HighlightingProblem.kt:85-89`（检查项显示名）+ `ProblemsViewState.kt:28`（`groupByToolId` 开关）。

## R3 · 不需要接线的一条（免得重复处理）

- 桶 2 判词里「状态栏的 profile 切换器」已经有落点：`src/components/InspectionProfileSwitcher.vue`（36 行，切根 profile），主代理复核说已挂在 `App.vue:2307` —— 本轮**没有**再交这条请求。
- 本轮新增的 `src/inspectionIdentity.ts` **零保留文件依赖**：它被 `src/problemsView.ts`、`src/inspectionProfile.ts`、`src/components/ProblemsPanel.vue`、`src/annotatorHighlights.ts` 四处消费，`node .tools/find-orphan-modules.mjs --gate` 里没有它。
