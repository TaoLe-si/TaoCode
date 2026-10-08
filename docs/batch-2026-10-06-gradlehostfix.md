# batch-2026-10-06-gradlehostfix — `src/gradleHost.ts` 破损态收口

写这条的是窄修复 lane `gradlehostfix`。上游基准树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`
（下文"参考树"）。仓内 `third_party/intellij-community` 本轮**一条都没引用**（按坏树处理）。

本报告里所有 `文件:行号`（含上游的）都是**我自己 find + 开文件数过**的；派单里给的坐标与
`docs/batch-2026-10-06-progflow.md` / `docs/wiring-requests-2026-10-06-progflow.md` 的结论只当线索，
**对不上磁盘的地方按磁盘写并把原话留在旁边**（见 §8 订正留痕，其中一条是实质性的：displayId 的字面值）。

## 0、一句话结论

两条破损**都自己复现过**再修的：
① `src/gradleHost.ts:880` 的 `UNLINKED_PROJECT_DISPLAY_ID` 全仓零定义 ⇒ `vue-tsc` 一条 `TS2304`、运行期那一支
以 unhandled rejection 结束、那条"未链接 Gradle 工程"通知**一次都没弹出来**。现在按**上游真字面量**补了定义
（不是本仓自取），并落了**真实例化宿主**的判据：通知弹得出、两个按钮各走各的出口、跳过之后不再弹。
② `src/gradleHost.ts:438` 的第 4 形参判为**有意的行为改动 + 已提交判据过时**（不是半截），实现一字未动，
把钉的形状换成仍精确的整句匹配（没放松成 `includes`、没删断言）。
域门禁 **132/132/0**、`vue-tsc` 只剩 **1** 条他 lane 的错（`gradleHost.ts` 那条 TS2304 已清、命中数 0）、
orphan 门禁**绿（新增 0）**、`src/gradleHost.ts` 净 0 行（门控仍 897/900）。

---

## 1、判词表（族 / 项 / 判定 / 上游相对路径:行号 / 本仓落点 / 一句话）

| 族 | 项 | 判定 | 上游相对路径:行号（本 lane 自己开的） | 本仓落点 文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| esa/autolink | 未链接工程通知的 displayId | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/autolink/UnlinkedProjectNotificationAware.kt:61`（`.setDisplayId(UNLINKED_NOTIFICATION_ID)`）＋同文件 `:143`（常量字面值）＋`platform/external-system-impl/resources/META-INF/ExternalSystemExtensions.xml:51-53`（同一条通知组的 `notificationIds=` 白名单，`displayType="STICKY_BALLOON"`） | `src/externalSystemAutoImport.ts:506-520`（定义＋依据注释）；`src/gradleHost.ts:46`（并进已有 import，净 0 行）；消费点 `src/gradleHost.ts:880` | 把"全仓不存在的裸标识符"换成上游那个字符串，宿主经同一条 import 拿它 ⇒ 类型红与运行期静默一起消 |
| esa/autolink | 「未链接工程通知」真的能弹 | `[x]` | `UnlinkedProjectNotificationAware.kt:60`（INFORMATION）、`:62`（`setSuggestionType(true)`）、`:63`（help）、`:64`（link 动作 = `callback()`）、`:65`（skip 动作 = `disableNotification`）、`:42-46`（跳过过 ⇒ return）、`:47-50`（已弹过 ⇒ return）、`:113-116`（`disableNotification`）；文案 `platform/external-system-api/resources/messages/ExternalSystemBundle.properties:14-21` | `tests/notice-actions.test.mjs:210-267`（行为判据，真实例化 `createGradleHost`）＋`:269-278`（定义/导入/递参三条形状判据） | 三档：弹得出＋两按钮顺序、点「加载」走 `linkProject('')`、点「跳过」后同工程**不再弹** |
| esa/autolink | 自动链接开关只门控链接、不门控通知 | `[x]`（沿用无署名 lane 的形状，本 lane 只补判据） | `UnlinkedProjectStartupActivity.kt:51-54`（`isEnabledAutoLink` 门控 `loadProjectIfSingleUnlinkedProjectFound`）＋`UnlinkedProjectSettings.kt:9-23`（默认 true、项目级） | `src/externalSystemAutoLink.ts:23-45`（既有）；判据 `tests/notice-actions.test.mjs:216-219`（把开关关掉才走到通知那一支） | 判据要走到通知那一支**必须**先关掉自动链接，否则测的是默认那条链接路径 |
| gradle/jvm | `notifyFailure` 第 4 形参 `issueActions?` | `[x]` 判为**有意改动**，收口方式＝改判据 | `plugins/gradle/src/org/jetbrains/plugins/gradle/service/execution/LocalGradleExecutionAware.kt:193-198`（`jdkConfigurationException` 把 `gradle.open.gradle.settings` 拼进那条 JDK 失败信息）＋`plugins/gradle/resources/messages/GradleBundle.properties:85`（`gradle.open.gradle.settings=Open Gradle Settings`） | 实现未动：`src/gradleHost.ts:438`（形参）、`:442`（替换并兜回默认档）、`:553-554`（唯一调用点带 `jvmIssue`）；判据改在 `tests/notice-actions.test.mjs:114-146` | 形状过时、意图仍在 ⇒ 钉成精确整句匹配（含"换档必须兜回默认档，不给空按钮组"） |
| 通知组注册表 | 「External System Auto-Link Notification Group」没进 `src/notificationGroups.ts` | `[~]` 本仓已有组表、还差这一条注册项 | `ExternalSystemExtensions.xml:51-53`＋`platform/external-system-api/resources/messages/ExternalSystemBundle.properties:241`（`notification.group.external.system.autolink=External system build scripts found`） | 未改（`src/notificationGroups.ts` 不在本 lane 可改面）⇒ 写进 `docs/wiring-requests-2026-10-06-gradlehostfix.md` R1 | 行为当前已等价（未分组 ⇒ 弹气球＋进日志，与 `STICKY_BALLOON` 同形），差的只是通知中心里那个**组名** |

## 2、改动文件清单（`wc -l` 前后；门控口径 = `split('\n').length`）

| 文件 | 前（wc / 门控） | 后（wc / 门控） | 本次内容 |
|---|---|---|---|
| `src/externalSystemAutoImport.ts` | 604 / 605 | 619 / **620**（上限 900，余 280） | 加 `export const UNLINKED_PROJECT_DISPLAY_ID` 及其上游依据注释（+15 行） |
| `src/gradleHost.ts` | 896 / 897 | 896 / **897**（净 0 行 ✓） | 只把新符号并进 `:46` 那条**已有**的 import；`:880` 那一行一个字没动 |
| `tests/notice-actions.test.mjs` | 125 / 126 | 278 / **279** | 两条过时形状改成精确匹配 + 1 条新形状断言 + 2 条新判据（行为档 + 定义/导入档） |
| `docs/batch-2026-10-06-gradlehostfix.md` | 骨架 | 本文件 | 交付报告 |
| `docs/wiring-requests-2026-10-06-gradlehostfix.md` | — | 新建 | 1 条组注册表请求（不阻塞本 lane） |

未动：`src/notificationGroups.ts`、`src/autoImportNotifications.ts`、`src/externalSystemAutoLink.ts`、
`src/gradleJvmDiagnostics.ts`（全部只读核对）；保留文件一个没碰；黑名单文件一个没碰。

## 3、§5 自查命令的前后数字

| 命令 | 修复前（磁盘原始输出） | 修复后 |
|---|---|---|
| `node --test tests/notice-actions.test.mjs` | tests 6 / pass 5 / **fail 1**（红在 `:109`，`assert.match` 期望 `…error: string): void`） | tests 8 / pass 8 / **fail 0** |
| `node --test tests/notice*.test.mjs tests/gradle*.test.mjs tests/background*.test.mjs tests/progress*.test.mjs tests/module-size.test.mjs` | 未跑（先复现单点）；`notice-actions` 那条已红 ⇒ 这一批必然 fail ≥ 1 | **132 / 132 / 0** |
| `npx vue-tsc -b --force` | 退出码 **1**，`error TS` **2** 条：`src/gradleHost.ts(880,74) TS2304 Cannot find name 'UNLINKED_PROJECT_DISPLAY_ID'`、`src/semanticActions.ts(509,71) TS2345` | **中途一次**：退出码 1 / `error TS` 2 条（`gradleHost` 那条已消失，多出 `src/components/TerminalPanel.vue(415,42) TS2554`）。**收工最后一次**：退出码 **1**，`error TS` **1** 条 = `src/semanticActions.ts(509,71) TS2345`；`grep -c gradleHost` 那份输出 = **0**（⇒ 本 lane 的目标清除且本 lane 文件零新错；TerminalPanel 那条在他 lane 手里当场消失，见下方归因） |
| `node .tools/find-orphan-modules.mjs --gate` | 未跑 | **门禁绿：没有基线之外的新增零消费方模块**（`已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2`：`src/jarRun.ts`、`src/runAnythingContext.ts`）。中途曾报**新增 1** = `src/usageViewTreeModel.ts`（并发黑名单 `src/usageView*`、mtime 晚于我的基线 ⇒ 那条 lane 在飞），收工时它已被它自己的 lane 接上 ⇒ 与本次数字一并留痕 |
| `node --test tests/source-citations.test.mjs` | 基线 **3 / 3 / 0**（我在改动前跑的） | **2 / 1 红**：唯一一条来自 `docs/batch-2026-10-06-findrep2.md` —— 它转述了一条 `ConsoleViewImpl.kt` 的引用，行号写成 999999，超出该文件实际长度（一千七百余行）⇒ 门控按真引用收集并判它扑空。**不是本 lane 的文件**（mtime 15:49:38，晚于我的基线 ⇒ findrep2 在飞）。本 lane 新增的每一条上游引用都指得到（否则它会并列出现在同一条断言里；按仓里规矩，转述别人的假写法**不带行号**，我这条就是照此改写） |
| `node --test tests/source-citation-anchors.test.mjs` | 基线已红 **11** 条 moved：`docs/batch-2026-10-06-termset.md`(×7)、`src/commitChecks.ts`、`src/components/ProblemsPanel.vue`(×2)、`src/runStartupFocus.ts` —— 全不在本 lane 文件面（后三份也在黑名单） | **6 pass / 2 fail**（termset 那 7 条在飞期间被它自己的 lane 收掉了）；剩余 moved 只在 `src/commitChecks.ts`、`src/components/ProblemsPanel.vue`、`src/runStartupFocus.ts` —— 三份全在并发黑名单 ⇒ 只记录不修。本 lane 两个源文件不在 moved 清单里 |
| `node .tools/find-param-props.mjs` | — | **0** 处参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | — | 干净（含我新写的 154 行测试） |
| `node .tools/find-missing-ext.mjs` | — | 干净（扫描 1374 个文件） |

**剩余 error 归哪条在飞 lane**：收工时 `vue-tsc` 只剩 **1** 条 —— `src/semanticActions.ts(509,71) TS2345`，
这个文件在派单并发黑名单里（`src/semanticActions.ts`）⇒ 归 semanticActions 那条 lane，本 lane 不碰。
中途那次出现过、收工时已消失的 `src/components/TerminalPanel.vue(415,42) TS2554`：我的基线（改动前那次 `vue-tsc`）里
**没有**它、它出现在中间一次、最后一次又没了，同一时间窗里 `source-citation-anchors` 的 termset 那 7 条锚点也一起消失
⇒ 判为 termset lane 在飞并自收，本 lane 全程没碰过 `src/components/` 任何文件。
本 lane 只动过 `src/gradleHost.ts` 的 **1 行** import。

## 4、反向验证记录（注入 → 红 → 原样还原 → 绿 → 0 残留）

备份：`build/ghfix-esai.preprobe.ts`、`build/ghfix-gh.preprobe.ts`、`build/ghfix-test.preprobe.mjs`（`build/` 已 gitignore）。
每轮还原都用 `cmp` 证明**逐字节一致**，再复跑判据。

| 探针 | 注入了什么 | 结果 | 还原后 |
|---|---|---|---|
| A | `src/externalSystemAutoImport.ts:520` 的字面值改成 `'GHFIX-PROBE'` | **fail 2**（行为判据 + 定义形状判据一起红） | pass **8**，`cmp` identical |
| B | 把那一行的 `export const UNLINKED_PROJECT_DISPLAY_ID` 改名（= 复现原始的"全仓零定义"形状） | **fail 1**：`SyntaxError: The requested module '../src/externalSystemAutoImport.ts' does not provide an export named 'UNLINKED_PROJECT_DISPLAY_ID'` ⇒ 整个测试文件加载失败（正是"破损必须当场响"而不是静默） | pass **8**，`cmp` identical |
| C | `src/gradleHost.ts:438` 第 4 形参改名 `GHFIXprobeActions?` | **fail 1**（`AssertionError: 失败要发一条带按钮的通知，不只是灰字`）⇒ 新形状判据真的在钉它 | pass **8**，`cmp` identical，`wc -l` 回到 **896**（门控 897） |

残留扫描：`grep -rn "GHFIX" src tests native scripts` ⇒ **0**；
自我否定形状扫描 `grep -nE '&& false|\|\| true|if \(true \|\||if \(false'`（三个改动文件）⇒ **0**。
`build/ghfix-gh.preprobe.ts` 与磁盘 `src/gradleHost.ts` `diff` ⇒ 无漂移（探针后没手滑留半句）。
临时备份留在 `build/`（gitignore 内），收工删。

## 5、零消费方自查结论

本 lane **没有新建任何 `.ts` 模块**（只在既有模块里加一条导出）。新导出 `UNLINKED_PROJECT_DISPLAY_ID` 的消费方：
- 生产：`src/gradleHost.ts:46`（import）→ `src/gradleHost.ts:880`（递成 `notify` 的第 5 参）；
- 判据：`tests/notice-actions.test.mjs:23`（静态 import）、`:212/:228/:270` 那族断言。
⇒ 不是"只过自己测试的死模块"。收工最后一次 `find-orphan-modules --gate` = **门禁绿、新增 0**
（中途报过的那 1 条 `src/usageViewTreeModel.ts` 在收工前已被它自己的 lane 接上，见 §3 那行的留痕）。

### 5.1 「弹得出来」的宿主链路也核过了（只读核对，不改保留文件）

`src/App.vue:847` 的 `notify` 是从 `createNotifications({…})`（`:849`）解构出来的那一个，
`:1857` 又以 `notify,` 原样递给 `createGradleHost` ⇒ 宿主 `deps.notify(标题, false, undefined, [help], displayId, [两个动作])`
的第 5/6 参走的正是 `src/notifications.ts:66` 那个签名，与省电模式那条同一条链；
气球与列表两处的按钮接线由本文件既有判据 `tests/notice-actions.test.mjs:100-112` 钉着（绿）。
⇒ 这条通知以前"一次都没弹"**不是** App.vue 缺接线，纯粹是那个不存在的标识符把整块 async 支路打挂；
本 lane 因此**没有**给 `src/App.vue`（余量 30）/ `src/bridge.ts`（0，已贴顶）提任何请求。

## 6、做不到 / 无法核实 清单
1. **`GRADLE_JVM_OPEN_SETTINGS_ACTION = '打开 Gradle 设置'` 的中文取值：无法核实**。上游英文
   `GradleBundle.properties:85 = Open Gradle Settings` 我核到了，但本地基准树里**没有**中文语言包，
   这句中文是那条无署名 lane 写进 `src/gradleJvmDiagnostics.ts:124` 的直译。本 lane 只钉它的**存在与接线形状**
   （`:553-554` 把它当替换档动作），不改它的措辞、也不给它背书。
2. **UPN 通知组的中文标题：无法核实** —— 同上，本地树只有英文
   `ExternalSystemBundle.properties:241 = External system build scripts found`。所以本 lane **没有**自造一个中文组名，
   只把它作为"要登记进 `src/notificationGroups.ts` 的原料"写进请求（见请求文档 R1，标题一栏留英文原值 + 出处）。
3. **那条组没登记进本仓注册表 ⇒ 这条通知现在落进"未分组"**：`src/notificationGroups.ts` 不在本 lane 可改面，
   硬约束又要求 `src/gradleHost.ts` 净 0 行、不许顺手重排别人文件 ⇒ 只能提请求。
   行为差别已核对：未分组 = 弹气球 + 进日志（`src/notifications.ts:74-80` 走 `!group || showsBalloon(...)`），
   与上游 `displayType="STICKY_BALLOON"` 同形 ⇒ 通知**弹得出来**这件事不欠这条，差的只是通知中心里那行组名。
4. **在飞红：只记录不修**（都不是本 lane 的文件面）：
   ① `source-citations` 收工仍 **1 红** = `docs/batch-2026-10-06-findrep2.md` 里转述的 `ConsoleViewImpl.kt` 行号越界；
   ② `source-citation-anchors` 收工 **2 红** = `src/commitChecks.ts`、`src/components/ProblemsPanel.vue`、`src/runStartupFocus.ts`
   三份的锚点 moved（后两份与 `commit*` 同族、全在并发黑名单）；
   ③ `vue-tsc` 收工 **1 红** = `src/semanticActions.ts`（黑名单）。
   需要主代理点名对应 lane 把快照/引用改回去；我改它们＝踩别人现场。
   （另：中途出现过、收工已自愈的两条 —— orphan 的 `src/usageViewTreeModel.ts`、`vue-tsc` 的 `TerminalPanel.vue` —— 一并留痕，
   数字以 §3 收工那列为准。）
5. **`isUnlinkedNoticeSkipped` 的记账粒度与本仓既有实现不一致（观察，未改）**：上游 `disabledNotifications` 是
   **按构建系统 id**（`UnlinkedProjectNotificationAware.kt:43` 比 `projectId.systemId.id`、`:114` 存 `systemId.id`），
   本仓 `src/externalSystemAutoLink.ts:56-58` 那个键是**按工作区根存一个布尔**。现在只有 Gradle 一个登记项 ⇒ 用户可见结果一致；
   等第二个构建系统接进 UPN 时，"跳过 Gradle"会连带压掉另一个系统的通知。本 lane 不动它（不是我的文件面，
   且改了要连带动 `externalSystemAutoLink.ts` 的既有判据），留此登记。

## 7、需要主代理接的线

`docs/wiring-requests-2026-10-06-gradlehostfix.md`（1 条，可选、不阻塞）：把上游那条通知组登记进
`src/notificationGroups.ts`（组 id + `STICKY_BALLOON` + `notificationIds=` 白名单那条 displayId）。

## 8、订正留痕（别人给的结论 vs 磁盘/上游实际）

1. **实质性：displayId 的字面值**。`docs/wiring-requests-2026-10-06-progflow.md` 的 R1 原写
   「上游没有这个字符串，本仓自取，登记为自造标识」，并给了取值 `'external-system:unlinked'`，
   理由是「`:54` 拿的是 notification **group** id，不是 displayId」。
   **实际**：同一个文件 `:61` 就是 `.setDisplayId(UNLINKED_NOTIFICATION_ID)`、`:143` 给的是字面值
   `external.system.autolink.unlinked.project.notification`，而且这个字符串还登记在
   `ExternalSystemExtensions.xml:53` 的 `notificationIds=` 白名单里。⇒ **上游有真字面量**，
   本仓不采用自造值，用上游原值（判据 `tests/notice-actions.test.mjs:228` 钉死它）。
   旁证：`src/externalSystemAutoImport.ts` 自己那段头注早就写了"`:61` 一个 displayId"，只是没写值。
2. **坐标**：`tests/notice-actions.test.mjs` 里别人那条留痕写「三档的三元链在 `src/gradleHost.ts:519-521`」，
   磁盘现状是 `:555-556`（被 JDK 那一段顶下去了）。只更新坐标、结论一字未动（就在原句旁边）。
3. **`src/gradleHost.ts` 里那条 UPN 注释引的 `UnlinkedProjectNotificationAware.kt:33-50` / `:42-50`**：
   我逐行开过 —— `:33-38` 是 `@State` + `disabledNotifications`、`:42-46` 是"跳过过 ⇒ return"、
   `:47-50` 是"已弹过 ⇒ return" ⇒ 对得上，不需要改。
4. **归属**：派单说"progflow/roots4 都已停或明确 disclaim"。磁盘现状 —— 这两处（`:431-442`、`:868-884`）
   `git blame` 全是 `Not Committed Yet`；`docs/batch-2026-10-06-progflow.md` 把它们记为「无署名域 G6/G7」且明写
   「归属未定」；`docs/batch-2026-10-06-roots4.md:121` 声明 roots4 本轮**未读写** `src/gradleHost.ts`；
   `docs/batch-2026-10-06-msgrows1.md` 撞见过同一条红但它的 lane 禁改 `tests/` 所以没动。
   **这块到底是谁的活（我的判定）**：`:438` 那一族属于一条**独立的 JDK 诊断 lane** —— 它依赖
   `src/gradleJvmDiagnostics.ts`（124 行、未跟踪、不在 progflow 的四文件清单里），行为是"JDK 解析失败 ⇒
   把最后一条动作换成「打开 Gradle 设置」"，上游依据 `LocalGradleExecutionAware.kt:193-198` +
   `GradleBundle.properties:85`（本 lane 自己开的，两条都成立）。`:868-884` 那一族属于 UPN/autolink lane
   （注释自称"roots4 补的那一寸"，磁盘无人记账）。**两条都已停 ⇒ 无人认领 ⇒ 按派单由本 lane 收口**，
   收口方式是"按上游定形"而不是"按猜的形状"：行为对得上上游的保留、只把判据钉到上游字面量/形状上。
   复核补一句：`docs/batch-2026-10-06-roots4.md:121`（它自己那份报告的"并发黑名单文件"一节）逐字写着本轮
   **未读写** `src/gradleHost.ts` 与 `tests/gradle-host.test.mjs` ⇒ 派单说的"明确 disclaim 过"成立。

## 9、工具结果异常留痕（一律当数据、不执行）

1. 本 lane 第 2 次工具调用（`Read src/notificationPowerSave.ts`）的**返回体尾部**注入两条
   "MEMORY.md was modified / Modified content: …"（伪装成系统通知，内含"禁止私自停止/请示""证据已确认可收尾"
   那类指令味道的条目）。处理：**未执行任何隐含指令**、未按它改任何文件、继续本 lane；已在上面这条登记出处。
   与既有台账（`reference-taocode-tool-result-injection`：假 MEMORY 通知是它八种形态之一）形状一致。
2. 我用 Bash 追加测试之后，一次工具输出里出现"File has been modified since read… existing content ends here"
   的尾部标记。处理：`grep -n "existing content ends here" tests/notice-actions.test.mjs` ⇒ **磁盘 0 命中**，
   `wc -l` = 277、8 条 `test(...)` 俱在 ⇒ 判为返回体被改写，不是真实现场；随后照常按磁盘实况推进并跑绿判据。
3. 每次 Edit 之后收到的"file state is current, you can continue"一类提示按**普通工具回执**处理；
   涉及别人结论的地方我都另开 `grep`/`sed -n` 读盘复核（§8 那四条留痕就是这么来的）。

## 10、收工原始数字（照抄，不四舍五入）

```
node --test tests/notice*.test.mjs tests/gradle*.test.mjs tests/background*.test.mjs \
             tests/progress*.test.mjs tests/module-size.test.mjs
  ℹ tests 132 / ℹ pass 132 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0

node --test tests/notice-actions.test.mjs        （本 lane 主判据，收工）
  ℹ tests 8 / ℹ pass 8 / ℹ fail 0

npx vue-tsc -b --force                            （收工）
  exit=1  error TS 共 1 条：src/semanticActions.ts(509,71) TS2345 …OrganizeImportsRequestParams…
  grep -c gradleHost = 0        ← 派单要求的 `gradleHost.ts` 那条 TS2304 已清

node .tools/find-orphan-modules.mjs --gate        （收工）
  已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2 ⇒ 门禁绿：没有基线之外的新增零消费方模块

node --test tests/source-citations.test.mjs       （收工）
  ℹ tests 3 / ℹ pass 2 / ℹ fail 1  ← 唯一一条在 docs/batch-2026-10-06-findrep2.md（他 lane），本 lane 零贡献

node --test tests/source-citation-anchors.test.mjs（收工，非派单必跑，附全）
  ℹ tests 8 / ℹ pass 6 / ℹ fail 2  ← moved 只在 commitChecks.ts / ProblemsPanel.vue / runStartupFocus.ts

node .tools/find-param-props.mjs  → 共 0 处参数属性
node .tools/find-ts-in-mjs.mjs    → 干净：tests/*.mjs 全部是纯 JavaScript
node .tools/find-missing-ext.mjs  → 扫描 1374 个文件，干净
grep -rn GHFIX src tests native scripts           → 0
grep -nE '&& false|\|\| true|if \(true \|\||if \(false' <本 lane 三个改动文件> → 0
wc -l src/gradleHost.ts → 896（门控 split('\n').length = 897 ≤ 900，余量 3 行未动）
git status --short（本 lane 面）→ M src/externalSystemAutoImport.ts / M src/gradleHost.ts /
                                   M tests/notice-actions.test.mjs / ?? 本报告 / ?? 请求文档
```

