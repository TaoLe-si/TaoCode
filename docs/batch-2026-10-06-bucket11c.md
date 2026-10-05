# 桶 11c · JUnit / 测试框架：5 条红 + `src/testLocator.ts` 接线（2026-10-06）

接手后的第一件事是把 5 条红各跑一遍拿原文 —— **实测在我名下 4 条已经是绿的**（上一任桶 11 代理把实现和判据都落盘了，被切断前没来得及写报告），
第 5 条根本不在本域。所以本轮做的事是：逐条把实现与**上游源码行号**复核一遍、逐条做**反向验证**（改坏 ⇒ 真的会红）、
把 `testLocator` 的消费链查到行号并把它模块头里**说过头的**「消费点」改准，最后把真正的最后一段缺口写成接线请求。

## 0. 结论先说

| 项 | 结论 |
|---|---|
| 红 1-4（`tests/junit-rules.test.mjs:53/:73/:156/:177`） | 接手即绿（17 pass / 0 fail）。**没有一条靠放松断言变绿**：四条都做了反向验证，改坏对应实现点各自红回来（见 §2） |
| 红 5「条件只认 regex/regexw，其余选项明说没有落点而不是静默忽略」 | **不在桶 11**。真实标题是 `条件认 regex/regexw/contains，其余选项明说没有落点或档位不对`，在 `tests/structural-search-constraints.test.mjs:105`，落点 `src/structuralSearchConstraints.ts:95-98`（`KNOWN_OPTIONS` / `SUPPORTED_OPTIONS`）与 `:256-265`，属桶 9a2/9b（任务书「别碰」清单里）。实测 **12 pass / 0 fail**。归属笔误的源头是 `docs/batch-2026-10-06-main.md:128`（把这条列进桶 11 的 5 条红） |
| 孤儿 `src/testLocator.ts` | 已有真实生产消费方（`src/components/TestRunnerPanel.vue:21`，唯一入口），孤儿门禁里**不再出现**（我收工前那一刻 `--gate` 报「新增 0 · 本轮清掉 11」，`testLocator` 在被清掉的 11 个里；最后一遍 `--gate` 的红点全是别人在途的三个模块，见 §2/§4）。**但跳转的最后一段在保留文件里没人接**：`src/App.vue:2254` 渲染面板时没挂 `@jump` ⇒ 已写请求 W-B11c-1 |

## 1. 五条红的逐条分诊

**病因分类**用任务书给的三档：真回归 / 断言钉的是实现前的缺位 / 桩键过期。

### 红 1 · `首选框架的算法照上游 :166-179（超类 TestCase ⇒ 3；否则按注解数量，打平归 5）`
- 判据：`tests/junit-rules.test.mjs:53-64`
- 病因分类：**真回归，已被上一任修掉**（我复核算法本身，不再改代码）。
- 上游证据：`plugins/junit/src/com/intellij/execution/junit/codeInspection/JUnitMixedFrameworkInspection.kt`
  `:166-179` = `getPreferedTestFramework`；`:173` `InheritanceUtil.isInheritor(clazz, JUNIT_FRAMEWORK_TEST_CASE) ⇒ V_3_X`；
  `:174-175` 两代方法各数一次；`:176` `junit4Methods.size > junit5Methods.size ⇒ V_4_X`（**严格大于**）；
  `:177` `junit5Methods.isNotEmpty() ⇒ V_5_X` ⇒ 打平（1:1）落 5，与断言 `tie ⇒ '5'` 一致。
  `V_3_X/V_4_X/V_5_X` 的定义在 `plugins/junit/src/com/intellij/execution/junit/junitLibrarySetup.kt:60-62`（`JUnitVersion("3"/"4"/"5")`），
  文案里 `{1}` 那个版本号就是它的 `asString` ⇒「JUnit 5」。
- 本仓落点：`src/junitRules.ts:187-197`（`:188` 超类判据、`:194` 严格大于、`:195` 打平归 5）。
- before→after：接手 17/0；反向验证（`:194` 的 `>` 改 `>=`）**15 pass / 2 fail**（红回来的正是「首选框架」与「混用两代 API 才报」两条）；复原 17/0。

### 红 2 · `混用两代 API 才报（上游 shouldInspect :59-65），且文案逐字取自 bundle :111`
- 判据：`tests/junit-rules.test.mjs:73-95`
- 病因分类：**真回归，已被上一任修掉**。
- 上游证据：同文件 `:59-65` `shouldInspect` —— 三代 scope 各加一，`frameworkCount > 1` 才建 visitor（`:68` 不满足就 `EMPTY_VISITOR`）；
  `:80` 类上有 `@RunWith`（`TestUtils.RUN_WITH`，查继承）整类跳过；`:82-101` 按首选那一代分别点名；
  `:122-125` `junitMessage(annotation, version)` 把**首选框架**当 `{1}` 传给 bundle key
  `jvm.inspections.junit.mixed.annotations.junit.descriptor`。
  文案：`plugins/junit/resources/messages/JUnitBundle.properties:111`
  `=Method <code>#ref()</code> annotated with ''@{0}'' inside class extending JUnit {1} TestCase`。
- 本仓落点：`src/junitRules.ts:200-241`（`:207` `kinds < 2` 对应 `frameworkCount > 1`；`:208` `@RunWith` 跳过；`:212-217` report；
  `:199-201` `mixedFrameworkMessage` 逐字按 `:111`，只把 `<code>#ref()</code>` 摊平成 `方法名()` —— **这一处摊平是本仓选择**，因为诊断文本进的是自己的问题面板，没有 `#ref` 模板引擎）。
- 断言强度：`assert.equal(mixedFrameworkMessage('newStyle','RepeatedTest','4'), "Method newStyle() annotated with '@RepeatedTest' inside class extending JUnit 4 TestCase")`
  是逐字相等，没有退化成 `includes`。
- before→after：接手 17/0；反向验证（`:207` 改 `kinds < 3`）与红 3 的改坏同时生效 ⇒ **15 pass / 2 fail**，红的正是「混用两代 API 才报」+「命名规范可配置」这两条；分别复原后 17/0。

### 红 3 · `命名规范可配置：改了正则就用改后的；长度判据仍按上游的 min/max（NamingConventionBean 的三个字段）`
- 判据：`tests/junit-rules.test.mjs:156-164`（任务书里的标题是它的简写）
- 病因分类：**断言钉的是实现前的缺位** —— 实现（`conventionOf` 的 `NamingOptions`）已按上游落地，断言本身是精确的（`assert.equal` 计数 + `assert.match` 文案），
  所以我**没有动断言**，只核对了实现与上游一致。
- 上游证据：
  - 三条默认值：`plugins/junit/src/com/intellij/execution/junit/codeInspection/naming/TestClassNamingConvention.java:31-37`
    （min 5 / max 255 / 正则 `[A-Z][A-Za-z\d]*Test(s|Case)?|Test[A-Z][A-Za-z\d]*|IT(.*)|(.*)IT(Case)?`）、
    `JUnit3MethodNamingConvention.java:22`（`test[A-Za-z_\d]*, 8, 64`）、
    `JUnit4MethodNamingConvention.java:33`（`[a-z][A-Za-z_\d]*, 4, 64`）。
  - 「可配置的只有正则」：`platform/lang-impl/src/com/intellij/codeInspection/naming/NamingConventionBean.java:24-37`
    三字段 `m_regex / m_minLength / m_maxLength`，本仓只开放 `m_regex`（`NamingOptions` 是 `{ 短名: 正则 }`），长度仍取上游常量。
  - 「too short 排在正则之前」：`NamingConventionBean.java:41-54` `isValid` 顺序 min → max → `matcher.matches()`；
    另有 `java/java-impl/src/com/siyeh/ig/naming/ConventionInspection.java:54-65` 同一顺序生成三条文案 key。
  - 文案形状：`java/java-analysis-impl/resources/messages/InspectionGadgetsBundle.properties:1116/1117/1118`
    （`... name <code>#ref</code> is too short ({1} < {2})` / `too long` / `doesn''t match regex ''{1}''`）；
    元素名 `:791` `Test class`、`:2041` `JUnit 4+ test method`、`:2042` `JUnit 3 test method`。
  - 只有测试类才查类名：`TestClassNamingConvention.java:46-55`（`isApplicable`，非 `JavaTestFramework` / 是 suite 类都不查）。
- 本仓落点：`src/junitRules.ts:339-345`（三条默认，逐字）、`:351-354`（`conventionOf` 只覆盖 `pattern`）、
  `:358-364`（`namingMessage`：min → max → 全匹配正则 `^(?:pattern)$`，对应 `matcher.matches()` 而不是 `find()`）。
- before→after：接手 17/0；反向验证（`:354` 改成 `return pattern ? base : base`，即忽略用户正则）⇒「命名规范可配置」红；复原 17/0。

### 红 4 · `接线：本地检查通道并上了这批规则`
- 判据：`tests/junit-rules.test.mjs:177-181`（读 `src/junitInspections.ts` 源码，钉 import 与调用点两处）
- 病因分类：**断言钉的是实现前的缺位**（规则模块写好了但本地检查通道没并第二批）—— 现在接上了，且接的是**真链路**不是样板：
  - `src/junitInspections.ts:24` `import { junitRuleProblems, type NamingOptions } from './junitRules.ts'`（带 `.ts`，Node 直跑能解析）
  - `src/junitInspections.ts:283` `...junitRuleProblems(path, code, junitNamingOptions)`
  - 下游真实消费：`src/lspNavigation.ts:37` import，`:148`（打开文件时刷）、`:237`（编辑内容变化时刷）；`src/problems.ts` 读 `localDiagnostics`；
    `src/highlightPasses.ts:21` 记录这条通道（`tests/highlight-passes.test.mjs`「本地检查消费：重复刷新短路，脏行留档」5/5 绿）。
  - 「修好即删」由 `tests/junit-inspections.test.mjs:131` 钉住（改回正序断言后 `localDiagnostics.has(...) === false`）。
- ⚠️ 桩键：本轮**没有**遇到「两边都收」那类桩键失配。这条判据读的是真实源码文本，不经过 import 桩。
- before→after：接手 17/0；反向验证（删掉 `:283` 那一行）⇒ **16 pass / 1 fail**，红的正是这条；复原 17/0。

### 红 5 · `条件只认 regex/regexw，其余选项明说没有落点而不是静默忽略`
- 归属：**桶 9a2/9b**，不是本域。真实判据 `tests/structural-search-constraints.test.mjs:105`
  `条件认 regex/regexw/contains，其余选项明说没有落点或档位不对`；实现 `src/structuralSearchConstraints.ts:95-98`（九个已知选项 vs 只支持三个）
  与 `:256-265`（`regexw` 置 `wholeWordsOnly`）。实测 **12 pass / 0 fail**（`node --experimental-strip-types --test tests/structural-search-constraints.test.mjs`）。
- 处置：我**没有碰** `src/structuralSearch*`（任务书列为「别碰」）。这条要么由桶 9 自己收，要么主代理把 `docs/batch-2026-10-06-main.md:128` 的归属改掉 —— 它现在记在桶 11 名下，
  是「桶 11 迟迟收不了尾」这个观感的来源之一。

## 2. `src/testLocator.ts` 的接线结论

**判据**（任务书给的）：除自己的测试外还有谁 import 它。答案：**`src/components/TestRunnerPanel.vue:21`**（全仓 grep `testLocator` 只有它一处 import，其余是注释与文档）。

消费链（逐行核过）：
- `src/components/TestRunnerPanel.vue:21` `import { firstTestLocation, testIndexOf } from '../testLocator'`
- `:246` `testIndex = computed(() => testIndexOf(tests.value.map(...)))` —— 索引由**发现结果**喂（正是模块头写的架构等价物：上游用索引把类名解析成 `PsiClass`，本仓用发现表）
- `:247-250` `sourceOf()` → `firstTestLocation(node.location, testIndex.value)`
- `:271-273` `jump(node)` 命中就 `emit('jump', target)`；模板 `:491` `@dblclick="jump(node)"`、`:496` 节点名按钮的 `title` 显示 `路径:行`、`:507` 列表行同样跳
- `:400-408` 运行中跟随（`autoScrollTarget(tree, scrollToSource, location => firstTestLocation(...))`）——「Navigate with Single Click」开着时把源码打开
- `src/testImport.ts:144` 只是把 metainfo 写成 hint 末尾的形状**交给**这里的 `resolveTestLocation` 认，**它本身不 import 本模块**（原模块头把它也算消费方，是说过头了，已改）

**唯一没接上的一段**：面板 `emit('jump', …)`，宿主 `src/App.vue:2254` 渲染 `<TestRunnerPanel … />` 时**没有 `@jump` 监听**（同一个 div 里 `RunConsole` 的 `@jump="jumpToIssue"` 在 `:2248`，面板这条漏了）。
`App.vue` 是保留文件 ⇒ 不自己改，写成 **W-B11c-1**（`docs/wiring-requests-2026-10-06-bucket11c.md`），行号口径也一并给了：`revealLocation` 是 0 基（`src/App.vue:1048-1049`），`firstTestLocation` 返回 1 基（`src/testLocator.ts:75`），必须 `-1`。

上游依据（跳转这件事）：`platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestLocator.java:22-31`
（`getLocation` 产出的是**可导航 `Location` 列表**）、
`java/execution/impl/src/com/intellij/execution/testframework/JavaTestLocator.java:96-125`
（metainfo 的 `行:列` 最终变成 `new OpenFileDescriptor(project, file, line, col)`，`:112-117`）—— 解析完就是要真打开文件，不然定位器等于没接。

**反向验证**：把 `TestRunnerPanel.vue:21` 的 specifier 改成 `'../testLocatorX'` ⇒ `tests/test-locator.test.mjs` **11 pass / 1 fail**，红的正是「接线：面板用 resolveTestLocation 而不是只认 file:line」（`:88-91`）；复原 ⇒ 12/0。

**门禁自证**：`node .tools/find-orphan-modules.mjs --gate` —— 我收工前两次跑到的是 **门禁绿**（已登记孤儿 10 / 基线 21 · 新增 0 · 本轮清掉 11，`testLocator` 属于被清掉的那些）；
最后一次（写完本报告时）门禁红，红的是**别人在途的三个新模块**：`src/historySessions.ts`、`src/historyTimeline.ts`（桶 14）、`src/rootsModel.ts`（桶 15c），
`src/junit*`/`src/test*`/`src/build*`/`src/runConfig*` 一个都不在列。本域无孤儿。

## 3. 改动文件

| 文件 | 性质 | 内容 |
|---|---|---|
| `src/testLocator.ts` | 修改（只动注释） | 头 `:30-31` 那段「消费点」换成实测结果：面板的 4 个具体行号、`emit('jump')` 与 `App.vue:2254` 缺监听这个卡点、`testImport.ts` 不 import 本模块的事实。样板按 `src/agent.ts` 那种「接不上写具体理由」的写法 |
| `docs/batch-2026-10-06-bucket11c.md` | 新增 | 本报告 |
| `docs/wiring-requests-2026-10-06-bucket11c.md` | 新增 | 接线请求 |

反向验证期间**临时改过并已逐字复原**（复原后 grep 核对过原文，测试回到原通过数）：
`src/junitRules.ts`（`:194`、`:207`、`:354`）、`src/junitInspections.ts`（`:283`）、`src/components/TestRunnerPanel.vue`（`:21`）。
未 commit、未 `checkout`/`reset`/`stash`/`clean`。

## 4. 验证数字

域内测试（`node --experimental-strip-types --test <file>`，只跑自己域 + 改到的文件）：

| 文件 | pass / fail |
|---|---|
| `tests/junit-rules.test.mjs` | 17 / 0 |
| `tests/junit-inspections.test.mjs` | 8 / 0 |
| `tests/junit-patterns.test.mjs` | 9 / 0 |
| `tests/junit-scope.test.mjs` | 4 / 0 |
| `tests/test-locator.test.mjs` | 12 / 0 |
| `tests/test-runner.test.mjs` | 12 / 0 |
| `tests/test-import.test.mjs` | 13 / 0 |
| `tests/test-event-channel.test.mjs` | 8 / 0 |
| `tests/test-tree-view.test.mjs` | 8 / 0 |
| `tests/test-navigation.test.mjs` | 6 / 0 |
| `tests/test-result-filter.test.mjs` | 6 / 0 |
| `tests/highlight-passes.test.mjs`（改到的接线点） | 5 / 0 |
| `tests/module-size.test.mjs`（只读，确认新文件没超限） | 5 / 0 |

合计 **113 pass / 0 fail**（17+8+9+4+12+12+13+8+8+6+6+5+5）。其中「4 条红」相关的四个文件合跑一次是 **42 tests / 42 pass / 0 fail**
（`junit-rules` 17 + `junit-inspections` 8 + `test-locator` 12 + `highlight-passes` 5，一起跑与单跑数字一致，没有互相牵连）。
另：`tests/structural-search-constraints.test.mjs` 12 / 0（只为确认红 5 的状态，未改）。

检测器与门禁：
- `tests/module-size.test.mjs` 5/0；`src/testLocator.ts` 收工 **213 行**（上限 900，没动任何上限）
- `tests/source-citations.test.mjs`：**红 1 条**（「仓里每一条带路径的上游引用都指得到」），4 个扑空的引用**都不是我的**：
  `src/components/RefactorMemberChooserDialog.vue`（桶 1）、`docs/batch-2026-10-06-bucket12b.md` 两条（桶 12）、`docs/wiring-requests-2026-10-06-bucket3b.md`（桶 3）。
  本报告的 `docs/batch-2026-10-06-bucket11c.md` 与请求 `docs/wiring-requests-2026-10-06-bucket11c.md` 里的每条上游路径都过了这个检测器
  （它会扫 `docs/*.md`，所以我是拿它自证的：`JUnitMixedFrameworkInspection.kt`、`JUnitBundle.properties`、`InspectionGadgetsBundle.properties`、
  `NamingConventionBean.java`、`ConventionInspection.java`、`TestClassNamingConvention.java`、`JUnit3/4MethodNamingConvention.java`、
  `SMTestLocator.java`、`JavaTestLocator.java`、`junitLibrarySetup.kt`、`JarApplicationConfigurationType.java` 在参考树里都逐字存在）
- `node .tools/find-param-props.mjs` ⇒ 共 0 处参数属性
- `node .tools/find-ts-in-mjs.mjs` ⇒ 干净：`tests/*.mjs` 全部是纯 JavaScript
- `node .tools/find-missing-ext.mjs` ⇒ 干净（扫 1148 个文件，无漏扩展名且解析不到的相对 import）
- `node .tools/find-orphan-modules.mjs --gate` ⇒ **本域 0 孤儿**（`testLocator` 已被计为接上）；收工那一刻门禁整体为红，红点是别人在途的 `src/historySessions.ts`/`src/historyTimeline.ts`/`src/rootsModel.ts`（见 §2）
- `npx vue-tsc -b --force` 跑了两遍：**第一遍**剩 2 个不是我的错（`src/customFoldingProviders.ts:48` 任务书预告的在途语法错、`src/components/StructuralSearchFilters.vue:238` 桶 9 在途）；
  **收工前最后一遍**只剩 `src/customFoldingProviders.ts(48,103): error TS1002: Unterminated string literal.`（桶 9 那条已被属主修掉）。
  本域（`src/junit*`/`src/test*`/`src/build*`/`src/runConfig*`/`TestRunnerPanel.vue`/`RunConfigurationsDialog.vue`/`menus/buildMenu.ts`）**0 错**。

## 5. 做不到的 / 遗留（都是具体卡点，不是「下一轮」）

1. **测试树跳转的最后一段**：必须动保留文件 `src/App.vue:2254` 加 `@jump` ⇒ 请求 W-B11c-1（含逐字可粘的属性表达式与 0/1 基行号口径）。
2. **`TestRunnerPanel` 在 `src/components/ToolWindowView.vue:12` 被 import 但从未渲染**（`node .tools/find-orphan-modules.mjs --dead-imports` 报出这一条）。
   那个文件不是我名下（桶 11 只拥有 `TestRunnerPanel.vue` / `RunConfigurationsDialog.vue`），我不动它 ⇒ 请求 W-B11c-2。
3. **JAR 运行配置类型仍未落地**（桶 11 的既有请求，没做完）：`src/settingsModel.ts:19-25` 明确记着「故意不加 `'jar'`」，
   因为 `RunConfig['type']`（保留文件）、`src/runConfigEditors.ts:90`、`src/runConfigTree.ts:16` 三张表必须同一次改，单改联合就 TS2741。
   本轮范围里没有这条的额度 ⇒ 请求 W-B11c-3（把三表依赖关系原样传下去，`src/jarRun.ts:50/:103` 已备好类型 id 与表单字段）。
4. **诊断文案尾巴带内部出处**（观察，未改）：`src/junitRules.ts` 9 处、`src/junitInspections.ts` 14 处在 `message` 末尾追加了「（上游 …）」，
   会进问题面板逐字显示。它不是编造 IDEA 文案（写的真是上游类名），但属于内部出处泄漏到 UI。
   现有判据只用 `assert.match` 钉上游那半句（`tests/junit-rules.test.mjs:89/109/115/122/130/163`），删尾巴不会让任何判据变红或变绿。
   本轮范围极窄，改它属于扩范围 ⇒ 登记给主代理定夺（要删我可以下一轮单独做，一次 23 处 Edit）。
