# lane exec-runs（2026-10-08）—— exec/run-instances(320) + exec/filters(47)

## 1. 做了什么（两条真缺口，都先红后绿）
1. **exec/filters：控制台过滤器链真正接进运行面板。** 旧判词把 `ConsoleInputFilterProvider`/`CompositeFilter`
   记在「缺」里，**不成立**：`src/consoleFilterRegistry.ts` 已实现完整 `CompositeFilter` 语义（命中并起来 /
   偏移校验 / 相交按 registry 键丢弃 / 最终回缺省 EXIT / 坏 filter 上抛 `ConsoleApplyFilterError`）、provider
   三分支分派、内建默认链三条、输入过滤器族与悬停行 EP —— 但它**只被测试 import**，
   `node .tools/find-orphan-modules.mjs --gate` 把它列进「新增零生产消费方」⇒ 判词的「已接」当时是假的。
   本轮补真接线：新增 `builtinConsoleFilterHits`（内建链 → 文件位置落点），`src/runIssues.ts` 每行落点由三档
   变四档（内置问题 → `file:line` → **内建链** → 插件 EP）。可见效果：`UrlFilter` 的 `file:` 分支
   （`UrlFilter.java:89-92`）可跳，`file:///D:/a/B.java:12` 原本落空（`findRunHyperlinks` 的路径字符类不含
   `:`，`file:///` 整条被拒）。容错依据：控制台 filter 跑在 `AsyncFilterRunner.java:300` 的异步任务里、终端侧
   只记日志（`JediTermHyperlinkFilterAdapter.kt:103-105`）⇒ 该行过滤丢了、控制台照常。
2. **exec/run-instances：合入宿主快照的 `stopping`。** `native/run_host.cpp:546-548` 明写这一位是给「重取
   快照后仍能把图标换成 kill」用的，而 `applyRunInstanceSnapshot` 只合 pid/children/tree/ports/exitCode/
   aborted，**读都没读** ⇒ 宿主已进入优雅结束、前端没在请求那一刻记过的实例永远显示「在跑」。现按「只置位
   不清位」合入（迟到的快照不能把「正在结束」翻回去；清它的是 `run.exit`）。
## 2. 落点（`wc -l` 前→后）
`src/consoleFilterRegistry.ts` 746→782、`src/runIssues.ts` 81→98、`src/runInstances.ts` 865→871、
`tests/run-filters.test.mjs` 128→163、`tests/run-instances.test.mjs` 283→303。未动：`src/consoleFilterProviders.ts`
（插件 EP 面与容错口径原样，插件 filter 仍只被叫一遍）、`src/bridge.ts` / `src/App.vue` / `native/*`、
`docs/inventory/*.json` 的手写内容（只经生成器刷新）。
## 3. 判据与条数
新增 3 条，全部先红后绿：`run-filters` +2（`file:///D:/a/B.java:12` 成为可跳转行；`runIssues` 的
import/调用锚点）、`run-instances` +1（宿主 `stopping` 换 kill 图标 + 迟到快照不清位）。反向验证：改前
`node --test tests/run-filters.test.mjs tests/run-instances.test.mjs` = **26 例 / 23 过 / 3 红**（三条红就是新
判据），改后域内 379 条全绿。既有断言一条未删、未放宽、未改形状。
## 4. 门禁读数（原始）
- 三件套（`run-instances` / `run-filters` / `run-output-pause`）⇒ **tests 29 / pass 29 / fail 0**。
- 域内批量（`run-*.mjs` + `console-*.mjs` + `execution-*.mjs` + `process-tree.test.mjs`）⇒ **379 / 379 / 0**。
- `tests/module-size.test.mjs` ⇒ **5 / 5 / 0**（未抬任何上限；`runInstances.ts` 871 < 900）。
- `tests/verdict-generated.test.mjs` ⇒ **5 / 5 / 0**；`source-citations` + `-anchors` ⇒ **21 / 21 / 0**。
- `node .tools/find-orphan-modules.mjs --gate` ⇒ 零消费方 **44 → 43**（`consoleFilterRegistry.ts` 出列）；
  `find-ts-in-mjs.mjs` / `find-param-props.mjs` ⇒ 干净（0 处）。
- `npx vue-tsc --noEmit` ⇒ **我改的 5 个文件 0 错**；全仓残红全在别的 lane 在途文件上（连跑两次 15 → 9：
  `src/virtualFilePointer.ts`(6) / `src/pluginMarketSearch.ts`(2) / `src/pluginMarketRemote.ts`(1)），无交集。
## 5. 族档位变化
两族仍为 `~`（没有整族 `[x]`）：`exec/filters` 的「缺」清单缩短（`CompositeFilter`/
`ConsoleInputFilterProvider` 移出缺栏，改记「已落且**本轮才真接上**」）；`exec/run-instances` 补一条生命周期
缺口（快照 `stopping`），并把 ③ 提权订正为「**规则层已落、通道仍缺**」（旧判词只写仍缺，没提
`src/runProcessPorts.ts` 的 `elevation*` 规则层）。两条判词尾部追加 `2026-10-08 lane exec-runs` 段，已跑
`python scripts/verdict_table.py execution` 刷新（只写 execution 两个文件；projectviews 那两个是本批 19:57
别的 lane 的改动，mtime 早于本次生成）。
## 6. 仍缺什么（依据）
- **远程 / 进程中介 / 守护进程**：宿主只有本机 CreateProcess；`native/run_host.cpp:416-417` 的 `run.start`
  参数面只有 `label`/`allowParallel` 与命令/env 那几格，没有目标端地址 ⇒ 无入口。
- **提权运行**：规则层在 `src/runProcessPorts.ts`（quota/文案/`elevationWrappedCommand`），**通道**仍缺 ——
  要 `run.start` 的提权参数与 UAC 启动，`src/runActions.ts:174` 的 `runStartParams` 没有这一位且
  `src/bridge.ts` 本批冻结。
- **PSI 两件**（`ExceptionLineRefiner` 表达式核验、`NavigateToExceptionClassFilter`/「导航到异常类」）：本仓
  没有类索引 ⇒ `ExceptionBaseFilterFactory` 的类名命中只能是纯高亮，建不出 hyperlink。
- **插件侧 `consoleFilterProvider` 12 条**（Gradle/Kotlin/Maven/Python/devkit…）：`repoModule: null`，属各自
  插件域，不在本 lane 文件面。
- 顺带（非本 lane、HEAD 已有）：`find-missing-ext.mjs` 报 `src/dapEventRelay.ts:19` 的 `import './bridge'` 缺
  `.ts` 扩展名 —— dap lane 的文件，未动。
## 7. 接线清单
无新增接线请求，改动全部在本 lane 文件面内闭合：`src/runIssues.ts` 多一行 import（`./consoleFilterRegistry.ts`）、
`src/runInstances.ts` 的快照合入多读一个宿主字段；不需要 `src/bridge.ts` / `src/App.vue` / `native/` 配合。
