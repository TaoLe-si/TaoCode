# batch-2026-10-06-runctx —— Run Anything「执行上下文（工作目录）」那一格落进弹层

代号 `runctx`。范围：`src/components/RunAnythingDialog.vue`（弹层）+ `tests/vue-sfc-loader.mjs`（夹具，加一个导出）
+ 新增 `tests/run-anything-context-dialog.test.mjs`。**没动** `src/App.vue`（需要接的两条线在
`docs/wiring-requests-2026-10-06-runctx.md`），没动 `src/runAnythingContext.ts`（只消费）、`src/runActions.ts`（只消费）。

## 0. 上游真身：那一档到底是什么（我亲自打开的文件）

派单给的坐标 `platform/ide-impl/src/com/intellij/ide/runAnything/` **不存在**（`ls` 报 No such file or directory）；
b10audit 说的「上游 `platform/execution-impl/src/com/intellij/execution/runAnything/` 复核 find 命中 0」**成立**——
但结论「所以无法核实」是错的：真身在 **`platform/lang-impl/src/com/intellij/ide/actions/runAnything/`**
（与 `src/runAnythingContext.ts` 文件头已写的坐标一致）。留痕：**原写「无法核实」，实际是包路径找错，功能存在**。

| 上游文件（相对 `intellij-community-master/`） | 行号 | 这一档的语义 |
| --- | --- | --- |
| `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingExecutingContext.kt` | `16-33` | `sealed class RunAnythingContext(label, description, icon)` 四子类：Project/Module/BrowseRecentDirectory/RecentDirectory |
| 同上 `RunAnythingContextUtils.kt` | `14-21` | `getPath()`：Project→`guessProjectDir()?.path ?: basePath`、Module→`guessModuleDir()?.path`、RecentDirectory→路径本身、**Browse→null** |
| 同上 `RunAnythingChooseContextAction.kt` | `62-78` | `update()`：表空 ⇒ `isEnabledAndVisible=false`（整格隐藏）；选中的不在表里 ⇒ 作废；没选 ⇒ 取**第一个**；按钮文字=选中项 label、图标=选中项 icon |
| 同上 | `57-60` | tooltip = `run.anything.context.tooltip`（`presentation.description`） |
| 同上 | `109-118`、`156-168` | 每个上下文一行（label/description/icon 三件套），点了就 `selectedContext = context` |
| 同上 | `132-150` | 「浏览目录…」是**动作**：开目录选择器 → 写 `RunAnythingContextRecentDirectoryCache` → 选中该目录 |
| 同上 | `213-216` | 弹层标题 = `run.anything.context.title.working.directory`（= `Execution Context`） |
| 同上 | `218-226` | 分隔线：Browse 行上方 Directories、第一个 Module 行上方 Modules |
| 同上 | `235-249` | `allContexts` = 项目 +（**模块 >1 才列**）+ 浏览 + 最近目录 |
| 同上 | `804-847`（在 `RunAnythingPopupUI.java`） | **位置**：这一格在弹层 `createHeader()` 的 `RowBuilder` 里、输入框右边（`builder.addResizable(myTextFieldTitle)` 之后 `builder.add(toolbarComponent)`） |
| `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingPopupUI.java` | `470-484` | `updateContextCombobox()`：可用上下文由**当前匹配到的 provider** 给（`provider.getExecutionContexts(dataContext)`） |
| 同上 | `509-516` | 执行时把 `EXECUTING_CONTEXT` = 选中上下文放进 DataContext |
| `platform/lang-impl/src/com/intellij/ide/actions/runAnything/activity/RunAnythingProvider.java` | `154-163` | 注释 `:160`：**"The first context will be chosen as default context."** |
| `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingRunConfigurationProvider.java` | `56-58` | 选**运行配置**时 `getExecutionContexts()` 返回 `ContainerUtil.emptyList()` ⇒ 那一格隐藏、配置不吃这个目录 |
| `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingContextRecentDirectoryCache.kt` | `26-29` | 最近目录是项目级持久化状态（`.idea/workspace.xml`）——本仓无对应存储 |
| `plugins/gradle/src/org/jetbrains/plugins/gradle/execution/GradleRunAnythingProvider.kt` | `60`、`83` | 消费侧回落：`dataContext.getData(EXECUTING_CONTEXT) ?: ProjectContext(project)` ⇒ **没选=项目根** |
| `plugins/maven/src/main/java/org/jetbrains/idea/maven/execution/MavenRunAnythingProvider.kt` | `57`、`91` | 同上回落 |
| `platform/platform-api/resources/messages/IdeBundle.properties` | `1183-1189` | 本仓那 7 条文案常量的原文（逐条对过：browse/project/undefined/title/separator.directories/separator.modules/tooltip） |

**这一档是什么**：一个「命令在哪个目录里执行」的下拉/弹层，宿主在输入行右侧；候选=项目根 + 模块内容根 +
（浏览/最近目录）；默认档就是项目根；执行时把它折算成目录传给命令。**不选等价于项目根**。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| runAnything/context | 四个上下文子类与 `getPath()` | `[x]` 已做（原有模块） | `RunAnythingExecutingContext.kt:16-33`、`RunAnythingContextUtils.kt:14-21` | `src/runAnythingContext.ts:53-85` | 规则早就写好了，本轮**给它消费者**，未改一行 |
| runAnything/context | 弹层里那一格 UI | `[x]` 已做 | `RunAnythingPopupUI.java:796-847`、`RunAnythingChooseContextAction.kt:57-60`、`:213-216` | `src/components/RunAnythingDialog.vue:125-133`（模板）、`:44-76`（状态） | 输入行右侧 `.run-ctx`：标题/aria = `CONTEXT_POPUP_TITLE`、tooltip = `CONTEXT_TOOLTIP`、选项 = `allRunAnythingContexts` 的输出 |
| runAnything/context | 选择/隐藏规则 | `[x]` 已做 | `RunAnythingChooseContextAction.kt:62-78`、`RunAnythingProvider.java:154-163` | `src/components/RunAnythingDialog.vue:65-67`（`contextCell`/`cellVisible`） | 用 `resolveSelectedContext`，弹层不重写规则；没选时显示表里第一档（项目） |
| runAnything/context | 派发时带上工作目录 | `[x]` 已做 | `RunAnythingPopupUI.java:509-516`、`GradleRunAnythingProvider.kt:60` | `src/components/RunAnythingDialog.vue:97-98`（`pick()` 命令行支） | `contextPath(context, moduleRoots)`；**没选/项目档/算不出目录 ⇒ 不发 cwd 键**，收端回落工作区根 |
| runAnything/context | 「不选=工作区根」的收端 | `[x]` 已做（早于本轮） | 同上（ProjectContext 的 `getPath()` 就是项目根，`RunAnythingContextUtils.kt:15-17`） | `src/runActions.ts:462`、`:486` | `runExternalTool(command, name, cwd?)` + `cwd?.trim() || workspace.value.root`（只读引用，未改） |
| runAnything/context | emit 形状 | `[x]` 已做 | — | `src/components/RunAnythingDialog.vue:35` | `payload: { command: string; cwd?: string | null }` |
| runAnything/context | 模块候选的**数据来源** | `[~]` 部分：本仓已有 prop 口（`moduleRoots?: Record<string,string>`），还差宿主传值 | `RunAnythingChooseContextAction.kt:242-249`（`ModuleManager.getInstance(project).modules`） | 请求见 `docs/wiring-requests-2026-10-06-runctx.md` §1 | 本仓没有 `ModuleManager`；请求里用 Gradle 子项目（`src/gradle.ts:250-255` 的 `GradleProjectNode.path`）折算模块根表 |
| runAnything/context | 「浏览目录…」这一行 | `[-]` 不适用（具体理由） | `RunAnythingChooseContextAction.kt:132-150` | `src/components/RunAnythingDialog.vue:55-62`（`canBrowse: false`） | 它是**动作**（开原生目录选择器 + 写项目级缓存），从弹层这一侧接不出宿主选择器（`dialog.pickDirectory` 的调用在 App.vue/runActions 那侧，本 lane 无授权）⇒ 按 playbook §3 不渲染这一行，而不是画个点了没反应的行 |
| runAnything/context | 「最近目录」那一组 | `[-]` 不适用（具体理由） | `RunAnythingContextRecentDirectoryCache.kt:26-29` | 同上（`recentDirectories: []`） | 上游那份状态在 `.idea/workspace.xml`；本仓没有对应持久化键 ⇒ 给空表。加设置键超出本 lane |
| runAnything/context | 弹层分隔线 Directories/Modules | `[-]` 本轮不适用（具体理由） | `RunAnythingChooseContextAction.kt:218-226` | `src/runAnythingContext.ts:179-188`（`separatorAbove`，仍未被 UI 消费） | 本仓这一格是 `<select>`（原生控件不能插分隔行）；`separatorAbove` 只有单测消费，**仍留在孤儿门禁的已登记清单外的模块内**（模块整体已被弹层消费，门禁绿）。要真还原分隔线得换成自绘弹层，不在本 lane 范围 |
| runAnything/context | 配置行也吃上下文 | `[-]` 不适用 | `RunAnythingRunConfigurationProvider.java:56-58` | `src/components/RunAnythingDialog.vue:102` | 上游对运行配置 provider 给的是**空上下文表** ⇒ 配置那一支只发 name（判据 6 钉住） |

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
| --- | --- | --- | --- |
| `src/components/RunAnythingDialog.vue` | 100 | 172 | +72：文件头补上游坐标、执行上下文状态（`moduleRoots`/`context`/`availableContexts`/`contextCell`/`cellVisible`/`contextIndex`/`chooseContext`）、`pick()` 命令行支带目录、模板那一格 + 3 条 scoped 样式（全用 tokens，无裸 hex/时长） |
| `tests/vue-sfc-loader.mjs` | 97 | 126 | 只**新增**一个导出 `loadSetup(file, props)`：不内联模板编译后**真调** `setup()`，返回绑定表 + 捕获的 emit。`loadSfc` 一字未动（14 个在用的测试全绿，见 §3） |
| `tests/run-anything-context-dialog.test.mjs` | — | 171 | 新文件，9 条判据（≥4 要求） |

`git diff --stat`（只含我这三个）：`src/components/RunAnythingDialog.vue | 82 +++++---`、`tests/vue-sfc-loader.mjs | 29 +++++`、新文件未跟踪。
`git status --porcelain` 里我这次落的就是 `M src/components/RunAnythingDialog.vue`、`M tests/vue-sfc-loader.mjs`、`?? tests/run-anything-context-dialog.test.mjs`——没有别人的 hunk。

## 3. §5 每条自查命令的前后数字

| 命令 | 动手前 | 动手后 |
| --- | --- | --- |
| `node --test tests/run-anything-context.test.mjs` | 11 pass / 0 fail | 11 pass / 0 fail（断言体未动） |
| `node --test tests/run-anything.test.mjs` | 11 pass / 0 fail | 11 pass / 0 fail |
| `node --test tests/run-anything-context-dialog.test.mjs`（新） | — | **9 pass / 0 fail**；收工再跑一次 `run-anything*.test.mjs` + 两个弹层/夹具消费方 = **52 tests / 52 pass / 0 fail** |
| 弹层/夹具相关回归（`run-anything*` + 全部 `vue-sfc-loader` 消费方，共 17 个文件） | — | **151 tests / 151 pass / 0 fail** |
| `npx vue-tsc -b --force` | 4 条错，全来自 `src/lspNavigation.ts:320`（别的 lane 在途，`git status` 显示 `M`）——那条**语法**错把全仓语义检查遮掉了 | 收工时该语法错已被那条 lane 修掉，全量 `-b` 于是开始报语义错：剩 `src/editorSplitLine.ts`（3 条）与 `src/components/CodeEditor.vue`（2 条，两次跑之间还在变）⇒ **都是别的 lane 在途文件**；`grep -c RunAnything` = **0**。⚠ 见 §4/M5：语法错期间「只剩 4 条」不等于干净 |
| `npx vue-tsc -p build/tsconfig.runctx.tmp.json`（隔离，只 include `RunAnythingDialog.vue`，临时文件已删） | — | **0 错**；阳性对照（故意注入 `const runctxTypeProbe: number = contextPath(...) ?? ''`）确实报 `src/components/RunAnythingDialog.vue(74,7): error TS2322` ⇒ 证明这一格真的在受检集合里 |
| `node --test tests/module-size.test.mjs` | 动手第一次跑：**fail 1**（`src/components/CodeEditor.vue 1152 行 > 上限 1147`，别的 lane 在途）；上限未动 | **5 pass / 0 fail**（该 lane 随后把 CodeEditor.vue 收回去了） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 「合计 1 个文件含真 TS 语法」（别人的） | 我新测试初稿被点名 `run-anything-context-dialog.test.mjs:43`（参数默认对象字面量被判成标注）⇒ 改成 `dialog(DEFAULT_PROPS)` 后：**干净：tests/*.mjs 全部是纯 JavaScript** |
| `node .tools/find-missing-ext.mjs` | 干净（1315 文件） | 干净（1316 文件，多的就是我那个新测试） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 7 / 基线 8 · 新增 0 | **已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2**，其中 `✔ 已接上：src/runAnythingContext.ts`；`--json` 里 `runAnythingContext` 命中 **0** 条 ⇒ 门禁绿且孤儿变少了 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 pass / 0 fail | **15 pass / 1 fail**，唯一红的是「已入快照的每条引用…与快照一致」，报的两条 `moved` 都在 `docs/wiring-requests-2026-10-06-fix-macros.md`（别的 lane 的文档），与本 lane 无关；本 lane 新增的引用落在「未入快照 61 条（不拦，下次重算收进去）」那一档。快照重算命令：`$env:TAOCODE_CITATION_ANCHORS='update'; node --test tests/source-citation-anchors.test.mjs`（本 lane 未跑，那是全局快照，归主代理） |

## 4. 反向验证记录（注入违规 → 变红 → 撤掉 → 复绿，原始数字）

先备份 `src/components/RunAnythingDialog.vue`（md5 `ca3e9dd1da2d0a1268a...` 见下），每次改完用备份还原并核对 md5 一致。
基线：`9 pass / 0 fail`。

| # | 注入的违规 | 变红 | 撤后 |
| --- | --- | --- | --- |
| M1 | 命令行支改成无条件发 cwd：`emit('runCommand', { command: row.name, cwd: cwd ?? undefined })` | **3 条**：`不选执行上下文时…payload 里没有 cwd 键`、`没选时那一格显示表里第一档…`、`runCommand 的 emit 形状…` | 9 pass / 0 fail，md5 复现 `ca3e9dd1da2d0a1268d927a33b0130ac` |
| M2 | 那一格文案改成硬字面量：`<span>执行上下文</span>` + `aria-label="执行上下文"`（丢掉常量绑定） | **1 条**：`那一格的标题/aria 都取 CONTEXT_POPUP_TITLE…`（pass 8 / fail 1） | 9 pass / 0 fail |
| M3 | 去掉 `moduleRoots` 闸门：`cellVisible = !contextCell.value.hidden`（空表也画控件） | **1 条**：`moduleRoots 为空/缺省/只有一条时那一格整个不渲染`（pass 8 / fail 1） | 9 pass / 0 fail |
| M4 | 配置那一支也吃上下文（加一条 `emit('runCommand', …)`） | **1 条**：`选运行配置那一支不带 cwd…`（pass 8 / fail 1） | 9 pass / 0 fail |
| M5 | （类型）在 `chooseContext` 前插一行 `const runctxTypeProbe: number = contextPath({...}) ?? ''` | 全仓 `-b` 输出里**看不到**（被 `src/lspNavigation.ts` 的语法错遮掉）⇒ 于是改用隔离 tsconfig：`src/components/RunAnythingDialog.vue(74,7): error TS2322: Type 'string' is not assignable to type 'number'` | 还原后隔离检查 0 错，md5 一致 |

M5 是本 lane 的一个**门禁事实**，值得主代理记：`.ts` 文件里的语法错会让 `vue-tsc -b` 只报语法错、不报任何语义错，
"仓库只有 4 条错"看起来干净其实什么都没查。别按 `-b` 的尾部条数判断自己的类型是否过关。

## 5. 零消费方自查结论

- `src/runAnythingContext.ts` 的四个出口现在都有**生产消费方**（同一个 .vue）：
  `CONTEXT_POPUP_TITLE:35` → 模板可见文案 + `aria-label`；`allRunAnythingContexts:119` → `availableContexts`；
  `resolveSelectedContext:160` → `contextCell`（`cellVisible`/`contextIndex` 都由它派生）；`contextPath:80` → `pick()`。
  另外顺带消费了 `CONTEXT_TOOLTIP:41`（tooltip）与类型 `RunAnythingContext:55`。
- 门禁：`find-orphan-modules.mjs --gate` 绿，且 `src/runAnythingContext.ts` 从登记清单里**掉出来**（`--json` 命中 0）。
- 未被 UI 消费的出口只剩 `separatorAbove`、`pushRecentDirectory`、`RUN_ANYTHING_RECENT_DIRECTORY_LIMIT`、
  `moduleDescription`、`recentDirectoryLabel`、两个分隔线常量与 `CONTEXT_DESCRIPTION_UNDEFINED`——原因见 §1 表里
  两条 `[-]`（`<select>` 放不下分隔行；最近目录/浏览没有宿主）。没有新增零消费方模块，也没有「import 了但不渲染」的假接线。

## 6. 做不到 / 无法核实

1. **`moduleRoots` 的真实取值**：本仓没有 `ModuleManager`/`.iml` 模型（`src/runAnythingContext.ts:50-51` 早就写明），
   也没有任何现成的「模块名 → 内容根」表可以直接用。具体卡点：候选数据只有三处，都不完整——
   `src/gradle.ts:250-255` 的 `GradleProjectNode`（只有 Gradle 项目有、且要 `gradleHost.projects`，见请求 §1）、
   `projectSettings.java.sourcePaths`（是**源根**不是模块根）、`git.submodules`（要用户先开「子模块」弹层才加载）。
   ⇒ 只写请求不猜实现；宿主未接线前 `moduleRoots` 是 undefined，那一格**整格不渲染**（判据 4 钉住），不会出现假控件。
2. **`.idea/workspace.xml` 那份最近目录缓存**：本仓没有对应持久化键（加设置键超出本 lane，且要动原生 schema）⇒ `recentDirectories: []`。
3. **弹层分隔线**：`separatorAbove` 的规则（Browse 上方 Directories、第一个 Module 上方 Modules）在原生 `<select>` 里表达不出来；
   换成自绘弹层需要键盘导航 + `usePopupLayer` 压栈，超出这一格的范围。已在 §1 标 `[-]` 并写理由。
4. **上游 `updateContextCombobox()`（`RunAnythingPopupUI.java:470-484`）的「随输入/选中重算可用表」**：
   本仓这一格的可见性只由 `moduleRoots`（有没有第二档）决定，不随 hover 的行类别闪动。
   理由：按行类别切换会让控件在键盘导航时抖动，且 SSR 判据无法稳定跑；配置行不吃目录已由判据 6 钉住。
   这条是**已知简化**，不是上游等价，记在这里。
5. **命令行行的 detail 文案**：`src/runAnything.ts:181` 写死 `'在项目根目录运行命令'`。选了模块档之后这句话不再准确。
   `src/runAnything.ts` 不在本 lane 的可改面（派单没写 ⇒ 只读），已写进请求 §3 供主代理决定。
6. **`vue-tsc -b` 的 0 错结论**：目前给不出（`src/lspNavigation.ts:320` 别的 lane 的语法错遮掉全仓语义检查），
   只能给出「隔离检查我这两个文件 0 错 + 阳性对照有效」。等那条语法错修掉后需要有人复跑一次全量。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-runctx.md`（`src/App.vue` 两处：`module-roots` prop 与 `payload.cwd` 透传，逐字 old/new；外加一条可选的 `runAnything.ts` detail 文案）。
