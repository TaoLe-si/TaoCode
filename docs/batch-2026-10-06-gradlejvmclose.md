# batch-2026-10-06-gradlejvmclose — `src/gradleJvmDiagnostics.ts` 收口

lane: **gradlejvmclose** · D:\TaoCode · 2026-10-06
名下：`src/gradleJvmDiagnostics.ts`、`src/gradleHost.ts`（净增必须 ≤ 0）、`native/gradle*`、对应 `tests/`。
硬规则：判据能失败（前缀 `GRADLEJVMCLOSE`，收口后 grep = 0）；不放松断言；不放假控件；禁 git 写操作（本轮一次 `git checkout/reset/stash/add` 都没用）。

---

## §0 接手实况与归属判定

**实况（全部读盘，非引用别人的结论）**：

| 项 | 磁盘实测 |
|---|---|
| `git status --porcelain` | `?? src/gradleJvmDiagnostics.ts`（未跟踪；本轮结束时仍是 `??`，本 lane 无权 `git add`） |
| 大小 / 行数 / mtime | 8901 字节、`split('\n').length = 125`（124 行 + 尾空行）、`Oct 6 14:43` |
| 接手时 sha1 | `2452c55af555dd73dff7485da92f805a23cd8856` |
| 收口后 sha1 / 行数 | `75779df5b635691d83d3b8742a6ae32bac9c3bbf` / 137 |

**它导出什么**（7 个运行时面 + 3 个类型面，`node -e import()` 实测）：
`GRADLE_USE_PROJECT_JDK`、`GRADLE_USE_JAVA_HOME`、`GradleJvmState`/`GradleJvmResolution`/`GradleJavaHomeIssue`（type）、
`gradleJvmResolutionOf`、`gradleEnvironment`、`gradleJavaHomeIssue`、`gradleJvmIssueText`、`GRADLE_JVM_OPEN_SETTINGS_ACTION`。

**谁在 import（`grep -rln "gradleJvmDiagnostics" src/ tests/` + 逐个符号 grep）**：

- `src/gradle.ts:172` import、`:173-175` **原路径再导出整面**、`:375-376` `gradleFailure()` 里真用它分类。
- `src/gradleHost.ts:10`（`GRADLE_JVM_OPEN_SETTINGS_ACTION`）、`:12`（`gradleEnvironment`、`gradleJavaHomeIssue`）、
  调用点 `:492`（同步/依赖加载叠 `JAVA_HOME`）、`:552`（失败分类）、`:554`（把最后一条动作换成「打开 Gradle 设置」）、`:694`（任务运行叠 `JAVA_HOME`）。
- `src/components/GradleSettingsPage.vue:16,68,69,71`（经 `../gradle.ts` 取 `GRADLE_USE_PROJECT_JDK`）。
- 判据侧（经 `src/gradle.ts`）：`tests/gradle.test.mjs:20,313`、`tests/project-build.test.mjs:26,168-171,180-181`、
  `tests/notice-actions.test.mjs:124,138`（钉的是 `gradleHost` 的**文本形状**，不是行为）。
- 自称引用的报告：文件头 `:39` 指向 `docs/wiring-requests-2026-10-06-roots3.md` 的 **A2**（`file.stat`）⇒ 该文件存在（10874 字节，12:22），A2 标题逐字是「给 `dispatch_file_query` 加 `file.stat`」⇒ 引用成立。
- 引用过它的批次文档：`docs/batch-2026-10-06-gradlehostfix.md:44,103,151`、`docs/batch-2026-10-06-progflow.md:69,99,103`、`docs/wiring-requests-2026-10-06-progflow.md:190,236,237`。

**归属判定**：**不是死码，不删。** 消费链在盘上是活的、且已在生产路径上（`gradleHost.execute` → `gradleFailure` / `gradleEnvironment` / 动作替换）。
它之所以"无人认领"，是 `gradlehostfix` 在 §8.4 把 `src/gradleHost.ts:438` 那一族判给"**一条独立的 JDK 诊断 lane**"（逐字：`src/gradleJvmDiagnostics.ts`（124 行、未跟踪、不在 progflow 的四文件清单里）），
而那条 lane 并不存在 ⇒ 派单把这一族收归本 lane。**本轮起归属 = gradlejvmclose**，认领声明已写进文件头 `:4-8`（文件在 `src/`，靠注释认领之外还靠 §3 那条判据钉住：链一断就红）。

按派单第 3 档处置：**有消费链但缺判据 ⇒ 补能失败的判据**；补判据过程中撞出 1 处**实现缺陷**与 2 处**说明与实际不符**，一并补掉（§2）。

---

## §1 上游核对

真身 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（逐个 `Read` 开文件数行号，不是引用别人的行号）。
`third_party/intellij-community` 本轮打开确认：目录里**只有一个 `.git`**，工作树为空 ⇒ 禁用（派单说的"坏树"成立）。

| 模块头引的坐标 | 磁盘实际行号 | 内容 | 判定 |
|---|---|---|---|
| `ExternalSystemJdkUtil.java:49` | `:49` | `public static final String JAVA_HOME = "JAVA_HOME";` | ✔ |
| 同上 `:51-53` | `:51/:52/:53` | `USE_INTERNAL_JAVA="#JAVA_INTERNAL"` / `USE_PROJECT_JDK="#USE_PROJECT_JDK"` / `USE_JAVA_HOME="#JAVA_HOME"` | ✔ 逐字 |
| 同上（默认档） | `LocalGradleExecutionAware.kt:126` | `projectSettings.gradleJvm = originalGradleJvm ?: ExternalSystemJdkUtil.USE_PROJECT_JDK` | ✔ |
| `SdkLookupProvider.kt:22-27` | `:22-27` | `SdkInfo` sealed：`Undefined` / `Unresolved` / `Resolving(name,versionString,homePath)` / `Resolved(…)` | ✔ 四态 |
| `LocalGradleExecutionAware.kt:132-157` | `:132-157` | `checkGradleJvmInfo(...)` 本体 | ✔ |
| 同上 `:139-141` | `:139-141` | `sdkInfo !is SdkInfo.Resolved` ⇒ `jdkConfigurationException("gradle.jvm.is.invalid")` | ✔ |
| 同上 `:143-145` | `:143-145` | `homePath` 取不到 ⇒ 同一条 key | ✔ |
| 同上 `:148-150` | `:148-150` | `!JdkUtil.checkForJdk(homePath)` ⇒ 同一条 key | ✔（模块头写的行号区间对得上） |
| 同上 `:152-154` | `:152-154` | `!JdkUtil.checkForJre(homePath)` ⇒ `gradle.jvm.is.jre` | ✔ |
| 同上 `:193-198` | `:193-198` | `jdkConfigurationException`：`GradleBundle.message("gradle.open.gradle.settings")` 拼进 `<a href=…>` 后抛 `ExternalSystemJdkException` | ✔ 这一条正是 `gradleHost.ts:438` 那一族的上游依据 |
| `GradleBundle.properties:77/78/79/80/85` | 同行号 | `Please set the Gradle JVM option` / `Gradle JVM option is incorrect:\nPath:{0}` / `Please use JDK instead of JRE for Gradle importer.` / `Invalid Gradle JDK configuration found.` / `Open Gradle Settings` | ✔ 逐字 |
| `GradleBundle.properties:91-93` | 同行号 | `Unable to run Gradle` / `Unable to find SDK for Gradle execution` / `Set Project SDK` | ✔ |
| `NoJdkForToolingProxyBuildIssue.kt:13-35` | `:13-36`（类体 13-35，`:36` 是收尾 `}`） | `:15` 取标题、`:22-26` quick fix 开工程设置、`:32-34` 动作拼进描述 | ✔ |
| `gradlew:124`、`:126-130`、`:136-139` | 同行号 | `JAVACMD=$JAVA_HOME/bin/java`；`ERROR: JAVA_HOME is set to an invalid directory: $JAVA_HOME` + `Please set the JAVA_HOME variable …`；`ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.` + 同一段说明 | ✔ 逐字 |
| `gradlew.bat:56`、`:61-64`、`:47-50` | 同行号 | `set JAVA_EXE=%JAVA_HOME%/bin/java.exe`；两条 `echo ERROR: …` 与 POSIX 侧措辞逐字相同 | ✔ |
| `native/runner.cpp:28-40` / `runner.hpp:30-32` / `native/gradle.cpp:50-52` | 同 | `environment_block` 注释原文「the parent block is always the starting point」在 `runner.cpp:33`；`Spec.environment` 注释在 `runner.hpp:30-31`；`gradle.cpp:50-52` 把带 `=` 的条目 push 进 `spec.environment` | ✔ 本仓侧引用也对得上 |

**核对中没有一条坐标需要换**（无"坐标不符就换并留痕"的情况）；**没有登记不到就罢手的项**。
唯一与磁盘不符的是**本仓模块头自己对设置页与 env 通道的两句描述**（不是上游），见 §2 的 b/c。

**zh 措辞**：全上游树里 `*_zh.properties` 只有 2 个 —— `platform/platform-impl/resources/messages/AgreementsBundle_zh_CN.properties`、`updater/resources/messages/UpdaterBundle_zh_CN.properties`；
**Gradle 插件没有 zh 包** ⇒ 本仓那两句中文（`gradleJvmIssueText`、`GRADLE_JVM_OPEN_SETTINGS_ACTION`）**没有中文出处可核**，登记 §5。

---

## §2 处置（留 / 接 / 删，带证据）

**处置 = 留 + 接（补判据）+ 补实现缺陷；一条码都没删。** 删档不成立：`grep` 已证 4 个生产消费方（§0），删掉就会把 `src/gradle.ts:375-376`、`src/gradleHost.ts:492/552/554/694` 一起打断。

三处改动，全在名下文件 `src/gradleJvmDiagnostics.ts`（124 → 136 行正文，仍远低于 `DEFAULT_LIMIT` 900；`gradleHost.ts` **一字未动**，见 §4）：

1. **补实现缺陷（判据先写、当场红过）**：`gradleJavaHomeIssue` 取值的正则是 `/…invalid directory:\s*(.*)/i`。
   `\s` 含 `\n` ⇒ 包装器值为空时（`gradlew.bat:61` 的 `%JAVA_HOME%` 定义为空串就展开成"冒号+空格+换行"）会把**下一行的说明**抓成路径：
   实测 `home = 'Please set the JAVA_HOME variable in your environment to match the'`，用户可见句子变成「路径 Please set the JAVA_HOME variable… 里没有可用的 JDK」。
   改成只跳水平空白：`/…invalid directory:[ \t]*(.*)/i`（改动 1 行 + 2 行留痕注释）。这条红/绿过程原样留在 §3 的表里（不是事后编的注入）。
2. **改掉与磁盘不符的说明**（原 `:73-75`）：「本仓存的是 `#USE_PROJECT_JDK` / `#JAVA_HOME` / 一个直接写下的目录（**设置页那个下拉就这三类**，见 `src/components/GradleSettingsPage.vue`）」——
   磁盘现状：`GradleSettingsPage.vue:68-71` 的下拉只有「项目 JDK（默认）」+ `app.jdks` 扫到的目录 + 一条「已配置」回显，**没有 `#JAVA_HOME` 这一档** ⇒ 改成"`#JAVA_HOME` 这一档本模块认（⇒ `inherited`），但设置页当前不提供它；`inherited` 只能从已落盘/手工写下的值进来"，并把补下拉档的请求登记到 §6。
   可达性不是假设：`native/settings_schema.cpp:895-899` 对 `gradleJvm` 只校验「≤512 字节 UTF-8 字符串」，`#JAVA_HOME` 是能落盘的合法值。
3. **改掉与磁盘不符的说明**（原 `:50-51`）：「宿主**没有读环境变量的通道**（`native/main.cpp` 的 Method 清单里只有 `app.jdks`，没有 env 读取）」——
   前半句（Method 清单没有 env）核对成立（`native/main.cpp` 里 `app.*` 一族 `:1455-1503` 无 env 读取；`src/bridge.ts:109` 的 `Method` union 同样没有）；
   但 `native/jdk.cpp:248-256` 的 `find_all()` 内部**确实读** `JAVA_HOME`/`JDK_HOME` 当扫描根（`:255-256` 的 `environment(L"JAVA_HOME")`）⇒ 措辞改成"前端没有读环境变量的通道；宿主 finder 内部读它当扫描根，但那个值不往外给"。
   `UndefinedJavaHomeException` 那一档仍判**无法核实**（前端拿不到值，判不了"没设"）。
4. **认领留痕**：文件头 `:4-8` 写明归属、消费链坐标、判据文件名。

另：`docs/inventory/**` 是 `ledgerfix` 特批名下，本 lane 没碰（未跟踪文件在台账里的登记请求见 §6.1）。

---

## §3 判据与反向验证

**新增判据文件：`tests/gradle-jvm-diagnostics.test.mjs`（196 行，10 条 test，跑 `tests/gradle*.test.mjs` 这条 glob 内）**。
它补的是**行为**（此前全仓零行为断言）：`grep -rn "JAVA_HOME is set to an invalid\|JAVA_HOME is not set and no\|invalid-directory\|no-java-found" tests/` 在补之前 = **0 命中**（本轮亲手跑）。
文件**直接 import 那份未跟踪模块本体**（不是只走 `src/gradle.ts`），它一旦被移动/改名 ⇒ 当场 `ERR_MODULE_NOT_FOUND`。

覆盖：① 两个哨兵值与上游逐字；② `gradleJvmResolutionOf` 三档（含"`#JAVA_HOME` 时不得把项目 JDK 顶上去"、"落空只报 unset 不判无效"）；③ `gradleEnvironment` 只产 `JAVA_HOME=…` 且形状是 `native/gradle.cpp:51` 认的 `KEY=VALUE`；④ 认输出四种包装器文本（POSIX/Windows、CRLF）+ **三条反向 null**（普通 `FAILURE:` / `BUILD FAILED` / 只是提到 `JAVA_HOME=` 的正常日志不得被判成 JDK 失败）；⑤ 值为空时不得跨行抓路径；⑥ 文案必须带出那个路径、动作标签不得为空串（空标签=点不动的按钮）；⑦ `src/gradle.ts` 再导出面齐全；⑧ 生产出口 `gradleFailure` 真走这一族 + 反向不劫持；⑨ `gradleHost.ts` 两个 `gradleEnvironment` 调用点（`assert.equal(count, 2)`）与 `jvmIssue` → 动作替换成对；⑩ `native/gradle.cpp` 仍把覆盖叠进 `Spec.environment`。
没有放松任何既有断言：`tests/notice-actions.test.mjs:126-141` 的形状钉与 `tests/project-build.test.mjs:168-181` 一字未改。

**反向验证（注入 → 红 → 还原 → `cmp`/sha1 → 标记 grep）**：8 个注入全部判红，还原后 4 个文件 `cmp OK` 且 sha1 与注入前逐字节一致；`grep -rn "GRADLEJVMCLOSE" src/ tests/ native/` = **0**。

| # | 注入（文件 · 缺陷） | 判据反应 | 还原 |
|---|---|---|---|
| 1 | `gradleJvmDiagnostics.ts` 哨兵值写成 `#JAVA_HOME_GRADLEJVMCLOSE` | ✖「两个哨兵值…」1 红（pass 9 / fail 1） | cmp OK |
| 2 | 正则还原成 `\s*`（跨行抓值） | ✖ 认输出 / ✖ 空值不跨行 / ✖ `gradleFailure` 三条红（pass 7 / fail 3） | cmp OK |
| 3 | `${issue.home}` 换成注入的标记串（句子丢路径） | ✖ 空值 / ✖「两种死法各给一句」2 红（pass 8 / fail 2） | cmp OK |
| 4 | 删掉 `inherited` 分支（`#JAVA_HOME` 落到 resolved） | ✖ 解析三档 / ✖ env 覆盖 2 红（pass 8 / fail 2） | cmp OK |
| 5 | `src/gradle.ts` 再导出面砍掉 4 个名字 | ✖「再导出面齐全」1 红（pass 9 / fail 1） | cmp OK |
| 6 | `src/gradleHost.ts` `jvmIssue = null`（分类器不接） | ✖「两个出口都接着」1 红（pass 9 / fail 1） | cmp OK |
| 7 | `src/gradleHost.ts` 砍掉一个 `gradleEnvironment(...)` 实参形状（两出口只剩一个） | ✖「两个出口都接着」1 红（pass 9 / fail 1） | cmp OK |
| 8 | `native/gradle.cpp` 丢掉 `spec.environment.push_back` | ✖「native 仍叠覆盖」1 红（pass 9 / fail 1） | cmp OK |

还原后复跑：**10 / 10 pass**。#7 第一次注入时 python 写盘报 `OSError: [Errno 22]`（未落盘，脚本没跑到判据），换 `open(...,'wb')` + `flush()` 重做后如上表所示真红 —— 这一条留痕是为了不让人误以为"八条一次过"。

---

## §4 门禁原始数字

1. `ls` 核实 glob：`tests/notice-actions.test.mjs`、`tests/notices.test.mjs`、`tests/gradle-events.test.mjs`、`tests/gradle-host.test.mjs`、`tests/gradle-jvm-diagnostics.test.mjs`、`tests/gradle.test.mjs`、`tests/background-tasks.test.mjs`、`tests/module-size.test.mjs`（8 个文件）。
   `node --test tests/notice*.test.mjs tests/gradle*.test.mjs tests/background*.test.mjs tests/module-size.test.mjs`
   ⇒ **tests 107 / pass 106 / fail 1 / cancelled 0**。
   唯一红：`已登记的 native 大文件不许继续变大` ⇒ `native/workspace.cpp 现在 1482 行 > 上限 1385`。
   **不是本 lane 的**（`native/workspace.cpp` 不在我名下、本轮一次没打开过）。归因留痕：`git show HEAD:native/workspace.cpp` = **1369 行**、`git status --porcelain native/workspace.cpp` = ` M`、`tests/module-size.test.mjs` = 未修改 ⇒ 是并发 lane 正在往 `workspace.cpp` 里加代码撞穿的在飞红。**按纪律只记录不修。**
   收口前后本 lane 的两次复跑（补判据前 `tests 107 / pass 106 / fail 1`，收口后同一数字）⇒ 本 lane 没有把任何一条判据改红。
2. `node .tools/find-orphan-modules.mjs --gate` ⇒ **门禁绿：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2（`src/jarRun.ts`、`src/runAnythingContext.ts`）· 词法自检 0 异常**；`gradleJvmDiagnostics` 在孤儿报告里 **0 命中**（`node .tools/find-orphan-modules.mjs | grep -c gradleJvmDiagnostics` = 0；逐个未跟踪 `src/*.ts` 的生产消费方计数里 `gradleJvmDiagnostics.ts` = 1 个（`src/gradle.ts`）⇒ 不是孤儿）。
   本轮**两次**看到同一条命令报红，两次都由**并发 lane 刚落盘、还没接线**的新文件造成，与本 lane 无关（按纪律只记录不修，也一个字节没碰它们）：
   - 第 1 次 `新增 1`：那一刻 `src/usageViewExport.ts`（mtime 17:05，未跟踪，在黑名单 `src/usageView*` 名下）零消费方；复跑时它已被 `src/referenceContents.ts` import ⇒ 连续 3 次 `新增 0 / 门禁绿`。
   - 收口末尾最后一次复跑 `新增 1`：门自己点名 `✘ 新增零生产消费方模块：src/components/CodeActionPopup.vue`（未跟踪的新组件，落盘晚于本 lane 接手，属 intention/codeAction 一族 lane）⇒ 归该 lane，不属本 lane 名下。
3. 隔离 tsconfig：`C:\Users\Administrator\AppData\Local\Temp\gjvmclose\tsconfig.check.json`（`extends D:/TaoCode/tsconfig.json`、`types: []`、`files` 只有 `src/gradleJvmDiagnostics.ts`、`src/gradle.ts`、`src/gradleHost.ts`）
   ⇒ `node_modules/.bin/tsc -p …` **零输出、退出码 0**。没有动仓库里的 `tsconfig.json`（临时配置写在库外）。
4. 加载自证：`node -e "import('./src/gradleJvmDiagnostics.ts')"` ⇒ `OK exports= 7`：
   `GRADLE_JVM_OPEN_SETTINGS_ACTION, GRADLE_USE_JAVA_HOME, GRADLE_USE_PROJECT_JDK, gradleEnvironment, gradleJavaHomeIssue, gradleJvmIssueText, gradleJvmResolutionOf`。
5. **未跑全量 `npm test`**（按派单）。
6. 行数账：`src/gradleJvmDiagnostics.ts` 125 → **137**（名下、离 900 上限尚余 763）；`src/gradleHost.ts` **897 → 897，净增 0**（余量 3 保持原样，没腾位也没占位）；`tests/gradle-jvm-diagnostics.test.mjs` 新增 196 行；`native/*` 与 `src/gradle.ts` **一个字节没改**（sha1 与本轮第一次读取时一致：`native/gradle.cpp c0a3636c…`、`src/gradle.ts 3aa2f9e5…`）。

---

## §5 无法核实（登记，不当已闭）

1. **中文措辞没有出处**：上游 Gradle 插件没有 zh 包（全树只有 `AgreementsBundle_zh_CN` / `UpdaterBundle_zh_CN` 两个 `_zh_CN.properties`）⇒
   `gradleJvmIssueText` 的两句中文与 `GRADLE_JVM_OPEN_SETTINGS_ACTION` =「打开 Gradle 设置」是**本仓自译**，
   判据只钉"句子里必须带出包装器打出的那个路径 / 必须说清 JAVA_HOME 未设置 / 标签不得为空"，不假装中文有上游行号。
   英文原文 key 与行号（`:77/:78/:85`）在模块头与本文件 §1。
2. **`UndefinedJavaHomeException`（`#JAVA_HOME` 但宿主没设 `JAVA_HOME`）那一档本仓判不了**：前端没有 env 读取通道
   （`native/main.cpp` 的 `app.*` 清单 `:1455-1503` 无 env 项、`src/bridge.ts:109` 的 `Method` union 同样没有；
   `native/jdk.cpp:255-256` 的 finder 内部读 `JAVA_HOME`/`JDK_HOME` 但值不外给）⇒ `inherited` 只能"什么都不覆盖"，
   到底继承到的是不是一个可用 JDK，本仓零可知。
3. **「设置里写下的 home 目录此刻还在不在磁盘上」仍判不了**（模块头 `:35-39` 那一半，本轮没有变）：
   上游三行检查（`checkForJdk` / `checkForJre` / homePath 空）问的是任意绝对路径，本仓只有 `app.jdks`（扫描根之内）那份清单 ⇒
   "不在清单里"推不出"不存在"，所以这里从不因为清单没有就判配置无效，只在包装器真打出那两行时给结论。补这一半要 `file.stat`（`docs/wiring-requests-2026-10-06-roots3.md` A2，本轮核对该请求确实存在且主题一致）。
4. **`SdkInfo.Resolving` 那一态本仓没有对应物**（没有异步 SDK 查找器）：模块头 `:55` 明写"不装"，本轮维持，不算已闭的等价实现。
5. **JRE-vs-JDK 那一档（`gradle.jvm.is.jre`，`LocalGradleExecutionAware.kt:152-154`）本仓没有实现**，也没有判据：
   本仓不检查 `bin/javac` 在不在 ⇒ 用户选了 JRE 时上游会给「Please use JDK instead of JRE」，本仓只会等包装器/Gradle 自己失败。
   这一条是**已知缺口**，不是本轮收口范围（要补得先有"目录里有没有 javac"的通道，同 §5.3 的 `file.stat`）。

---

## §6 留给主代理的请求

1. **台账**：`src/gradleJvmDiagnostics.ts`（137 行）与 `tests/gradle-jvm-diagnostics.test.mjs`（196 行）在 `docs/inventory/**` 里没有任何条目（本 lane 禁写该目录，特批给 `ledgerfix`）⇒ 请登记归属 **gradlejvmclose**，并把 `gradlehostfix` 报告 §8.4 与 `progflow` 的「G6 归属未定 / 独立 JDK 诊断 lane」两处结论改成"已收口 = gradlejvmclose，判据 `tests/gradle-jvm-diagnostics.test.mjs`"。本 lane 无 `git add` 权限，文件至今仍是 `??`。
2. **设置页缺 `#JAVA_HOME` 档**：`src/components/GradleSettingsPage.vue:68-71` 的下拉没有「`#JAVA_HOME`（沿用宿主环境变量）」这一项，而 `gradleJvmResolutionOf` 认它、`native/settings_schema.cpp:895-899` 也放它落盘 ⇒ 要么补这个 option（对齐上游 `ExternalSystemJdkUtil.java:53` 的四档），要么删掉 `inherited` 分支。该文件不在本 lane 名下，未动。
3. **同一规则有第二/第三份实现，口径不一致**（本 lane 名下文件之外，只报不动）：
   - `native/projects.cpp:145-149` 的 `gradle_java_home()` 只认 `#USE_PROJECT_JDK` 和"非空即用"，**不认 `#JAVA_HOME`** ⇒ 若设置里真落了 `#JAVA_HOME`，它会把字面量 `#JAVA_HOME` 当 JDK 主目录交给 LSP（调用点 `:194`）。与本仓 TS 侧（`inherited` ⇒ 不覆盖）不同口径。
   - `src/externalSystemTask.ts:160-187` 的 `resolveExternalSystemJdk()` 是**第三份**四档解析（还带 `PROJECT_JDK_NOT_FOUND` / `UNDEFINED_JAVA_HOME` / `INVALID_JAVA_HOME` / `UNKNOWN_JDK` 四类错误），但 `src/gradleHost.ts:24` 只 import 了它的 `generateExternalSystemTaskName` ⇒ 这个解析器目前**没有生产消费方**（只有 `tests/external-system-task.test.mjs`）。要么接线、要么按死码处理，请裁决归属（不在本 lane 名下）。
4. **在飞红两条（别当成我弄坏的，本 lane 一个字节没碰）**：
   - `tests/module-size.test.mjs` 的「已登记的 native 大文件不许继续变大」—— `native/workspace.cpp` 1482 > 上限 1385（HEAD 是 1369，正在被并发 lane 写）。§4.1 有证据链。
   - `.tools/find-orphan-modules.mjs --gate` 的「新增 1」两次，门点的分别是 `src/usageViewExport.ts`（后自愈）与 `src/components/CodeActionPopup.vue`（收口末尾那次）⇒ 请催 `usageView*` / intention-codeAction 两族把消费链接上或按死码删，别让它落成"代码落了、没人接"。
5. **工具结果异常留痕（一律当数据、未执行）**：本轮在两次**普通工具输出之后**收到"MEMORY.md 被修改 / Modified content: …"的正文（第 1 次紧跟首个 Bash 结果，第 2 次紧跟 §3 的孤儿门复跑结果）。
   处理：未据此改任何文件、未据此停手或提前收尾；判据与门禁全部按磁盘实况重跑复核。与本仓既有台账（`gradlehostfix` §9 记的同一种伪装）形状一致。
