# 接线请求 · 桶 11c（JUnit / 测试框架 / 运行配置）2026-10-06

格式按 `docs/batches-2026-10-06-buckets.md` §4。三条，前两条是本轮 `src/testLocator.ts` 接线的最后一段与它暴露出来的陈旧 import，
第三条是桶 11 既有、还没做完的 JAR 配置类型（依赖三张表同改，本轮没有额度）。

## 接线请求 W-B11c-1（给主代理 / 桶 8）—— 测试树跳转的最后一段
- 目标文件：`src/App.vue` 第 2254 行（渲染 `<TestRunnerPanel … />` 的那个标签）
- 要接什么：给这个标签加一个属性，逐字可粘：
  `@jump="target => revealLocation({ path: target.path, line: Math.max(0, target.line - 1) })"`
  来源：`src/components/TestRunnerPanel.vue:32` 声明 `emit: { jump: [target: { path: string; line: number }] }`；
  发送点两处 —— `:271-273`（`jump(node)`，模板 `:491` 双击树节点、`:507` 点结果行）与 `:400-408`（运行中跟随，「Navigate with Single Click」开着时）。
- 为什么需要：`src/testLocator.ts` 的定位器链已经把 `java:suite://` / `java:test://` 与导入 XML 的 metainfo 解析成 `{path, line}` 并 emit 出去，
  宿主没监听 ⇒ 双击/跟随只走到面板为止（`:496` 的 tooltip 已经显示目标 `文件:行` 却点不动），测试树跳源在 UI 上不成立；
  这是 `testLocator` 从「孤儿」变成「端到端可用」的唯一缺口，而 `App.vue` 是保留文件，我不动。
- 行号口径（务必按这个来，否则会跳到上一行）：`revealLocation` 收 **0 基**行（`src/App.vue:1048-1049` 的注释与 `:1049` 的 `Math.max(0, action.line - 1)` 就是同一口径），
  `firstTestLocation` 返回 **1 基**（`src/testLocator.ts:75` `TestIndexEntry.line` 写明「1 基行号」）⇒ 必须 `-1`。
- 上游依据：`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestLocator.java:22-31`
  （`getLocation(protocol, path, project, scope)` 产出**可导航的 `Location` 列表**）；
  `java/execution/impl/src/com/intellij/execution/testframework/JavaTestLocator.java:96-125`
  （metainfo 的 `行:列` 最终变成 `new OpenFileDescriptor(project, file, line, col)`，具体在 `:112-117`）—— 解析完就要真的打开位置。
- 复核点：接完跑 `node --experimental-strip-types --test tests/test-locator.test.mjs`（12 条）与 `tests/test-tree-view.test.mjs`（8 条），两条都不该动。

## 接线请求 W-B11c-2（给主代理 / ToolWindowView 的属主桶）—— 陈旧 import
- 目标文件：`src/components/ToolWindowView.vue` 第 12 行
- 要接什么：`import TestRunnerPanel from './TestRunnerPanel.vue'` 被 import 但**全文件没有任何 `<TestRunnerPanel>` 渲染点**
  （`node .tools/find-orphan-modules.mjs --dead-imports` 实测报出 `src/components/ToolWindowView.vue:11  ./TestRunnerPanel.vue`）。
  二选一：删掉这条 import，或在 run 视图里真的渲染它（并挂 W-B11c-1 那个 `@jump`）。
- 为什么需要：这是「import 了但没用」的假接线形状，面板实际渲染点在 `App.vue:2254`，留着这条会让人以为工具窗口也有一份。
- 上游依据：这条**不是**上游行为，是本仓的「假接线」形状判定（任务书 §3 禁止假控件），所以不给上游坐标；
  判据就是 `node .tools/find-orphan-modules.mjs --dead-imports` 的输出，实测渲染归属只有一处：`src/App.vue:2254`。
- 备注：`ToolWindowView.vue` 不在桶 11 的文件清单里（我名下只有 `TestRunnerPanel.vue` / `RunConfigurationsDialog.vue`），所以只登记不擅改。

## 接线请求 W-B11c-3（给主代理，桶 11 既有欠账的转述）—— JAR 运行配置类型
- 目标文件：`src/settingsModel.ts`（`RunConfig['type']` 联合，第 25 行）+ `src/runConfigEditors.ts:90` + `src/runConfigTree.ts:16`
- 要接什么：**同一次**把 `'jar'` 加进 `RunConfig['type']` 联合、`RUN_CONFIG_EDITORS` 表、`RUN_CONFIG_TYPES` 表。
  表单字段与类型 id 已备好：`src/jarRun.ts:50`（`JAR_APPLICATION_TYPE_ID = 'JarApplication'`）、`:103`（`JAR_FORM_FIELDS`）。
- 为什么需要：`src/settingsModel.ts:19-25` 明确记着「这里故意不加 `'jar'`」，理由是 `RUN_CONFIG_EDITORS` 是
  `Record<NonNullable<RunConfig['type']>, …>`，只改联合会少一个键直接编译不过（2026-10-05 实测 `runConfigEditors.ts:90` TS2741）。
  单改保留文件必坏，所以要三表同改。
- 上游依据：`java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:19-22`
  （构造器 `super("JarApplication", …)` —— 类型 id 就是 `JarApplication`，与本仓 `src/jarRun.ts:50` 一致）；
  `docs/batches-2026-10-06-buckets.md` 桶 11 那行的「接线请求：`runConfigEditors.ts` + `runConfigTree.ts` 与 `settingsModel.ts` 的 `'jar'` 必须同一次改」。
- 本轮状态：没做（额度全花在 5 条红的复核/反向验证与 `testLocator` 上）。这是具体欠账，不是「下一轮再说」。
