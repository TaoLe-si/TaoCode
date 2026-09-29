# 交接：Java 支持链路上的未解决问题（2026-09-28）

> 这份文档**只列问题**，不写结论、不写推断出来的根因。每一条给出「现象 / 证据在哪 / 已经排除了什么 / 还没查明什么」。
> 接手的人请自己取证，不要采信本文里任何未标注证据来源的说法。

## 0. 工作区状态（接手前必读）

- 仓库 `D:\TaoCode`，分支 `parity/rebuild-inventory`，HEAD `dfc7d11`。
- **工作区有大量未提交改动**（tracked 修改 60+ 个文件，另有本次新增的未跟踪文件）。
  **不要清理、不要 checkout、不要 reset、不要 stash** —— 这些改动是唯一的现场。
- **受保护产物，不许覆盖**：`D:\TaoCode\build\TaoCode.exe`、`D:\TaoCode\build\ui`（用户测试快照）。
  独立验证一律用 `D:\TaoCode\build-validation`。
- 环境：Windows，**只能用 PowerShell**（`$ErrorActionPreference='Stop'` 起手，正则用单引号）；
  gradle 一律 `--offline`；不装软件。
- 用户流程要求：**先静态分析再动手**；不要做无意义测试；不要擅自扩大范围。

### 本次新增/改过的文件（未提交）

新增（未跟踪）：`native/lsp_config.hpp`、`native/lsp_config.cpp`
改过（tracked，见 `git status`）：`native/main.cpp`、`native/projects.cpp`、`native/projects_test.cpp`、
`native/jdtls.hpp/.cpp`、`native/jdtls_test.cpp`、`native/lsp_discovery.hpp/.cpp`、
`native/lsp_discovery_test.cpp`、`native/lsp_real_test.cpp`、`CMakeLists.txt`、`tests/module-size.test.mjs`、
`src/*` 若干。

---

## 1. Java 代码补全在真实 JDT LS 上不可用（最高优先级）—— **已定位、已修（2026-09-28）**

> **结论订正**：下面「`initialize` 没有到达」的推断是**错的**。字节级取证（见 §1.1）表明
> `initialize` 到达了服务器，但被 JDT LS 拒收：客户端能力里
> `workspace.fileOperations.*` 被写成了**过滤器数组**，而客户端能力要求**布尔值**
> （服务端能力才是带 filters 的对象）。JDT LS 的 Gson 反序列化抛
> `Expected a boolean but was BEGIN_ARRAY ... fileOperations.didCreate`，
> 整个 initialize 被回 `-32700 Message could not be parsed`，服务器因此**从未进入 handler**
> —— 这正是日志里只看得到 `>> shutdown` 看不到 `>> initialize` 的原因。
>
> 修复：`native/lsp_session.cpp:249-263` 四个键改成 `true`；
> 回归守卫：`native/lsp_fake_server_requests.cpp` 的 initialize 分支现在校验这四个键必须是布尔，
> 写回数组时 `lsp_session_test` 会红（已实测）。

**现象**：内置 JDT LS 能被拉起（`resolve_servers` 返回 `running=true`），但 `ready` 始终是 `false`；
因为从未就绪，客户端**从未发出 `didOpen`**，所以编辑器里没有任何诊断/补全。

### 1.1 字节级取证（本次新增的证据）

用 `native/jdtls_probe.cpp`（走生产路径 `resolve_servers`）并设
`TAOCODE_LSP_TRACE=<file>`（`native/lsp_host.cpp` 的写入/读取跟踪，默认关闭）得到：

```
WRITE method=initialize header=[Content-Length: 3758] bodybytes=3758
READ bytes=380 body=[...{"jsonrpc":"2.0","id":1,"error":{"code":-32700,
  "message":"Message could not be parsed.","data":{"message":
  "java.lang.IllegalStateException: Expected a boolean but was BEGIN_ARRAY
   at line 1 column 2675 path $.params.capabilities.workspace.fileOperations.didCreate"}}}]
```

形状依据（lsp4j 0.23.1 字节码，`javap` 核对）：

- 客户端能力 `org.eclipse.lsp4j.FileOperationsWorkspaceCapabilities.getDidCreate() -> java.lang.Boolean`
- 服务端能力 `org.eclipse.lsp4j.FileOperationsServerCapabilities.getDidCreate() -> FileOperationOptions`

修复后同一条探针：`initialize` 得到 `id:1 result.capabilities`，
随后 `initialized` → `workspace/didChangeConfiguration` → `textDocument/didOpen` 全部发出，
服务器回 `language/status: Started / Ready`（握手完整）。

**遗留问题也已解决（同日）**：握手修好后诊断仍为 0，逐层取证后是**三件事叠加**，全部闭合：

1. `runtimes` 名称形式：`java_lsp_settings`（`native/projects.cpp`）里 `jdkName` 必须是
   `JavaSE-<x>`（8 写作 `JavaSE-1.8`）才能被 JDT LS 认作编译运行时；自动探测路径写入的
   显示名（`17`/`1.8`）会被设置校验整个拒绝。两侧已归一（`src/buildHost.ts` 的
   `javaDefaults` + 原生 `normalize_runtime_name`）。
2. source path：裸目录下 jdt.ls 只建隐形工程，文件不在 source root 上就只报语法错；
   产品路径 `javaDefaults` 默认填 `sourcePaths:['src']`（IDEA 纯 Java 约定），对齐即可。
3. 测试口径：隐形工程导入完成前服务器会先发一条**空**诊断；`lsp_real_test` 原来把第一条
   当结论，现在等**非空**诊断（`.metadata/.log` 里能看到 "1 problems reported" 晚于空发布）。

**端到端验证**（`build-validation`，捆绑 1.44.0 + 捆绑 JRE 21，项目 JDK 17 仅进 runtimes）：

```
PASS real server (java) published 1 diagnostic(s); first: Type mismatch: cannot convert from String to int
PASS hover answered: "RealLspCheck"
```

复跑命令：`TAOCODE_LSP_REAL=1 TAOCODE_LSP_AUTOCONFIG=build-validation TAOCODE_LSP_ROOT=<项目>
TAOCODE_LSP_LANG=java TAOCODE_LSP_FILE=src/X.java TAOCODE_LSP_JDK=<JDK17> ./lsp_real_test.exe`
（工作区换目录后记得删 `%LOCALAPPDATA%\TaoCode\jdtls-workspace\<hex>` 里的旧导入缓存。）

---

**以下为原始（已订正的）记录，保留以便对照**：

**证据 1 —— JDT LS 自己的日志**（`%LOCALAPPDATA%\TaoCode\jdtls-workspace\<hex-of-project-path>\.metadata\.log`）：
生产路径跑过的两份会话（`443a5c54616f436f64655c2e746d702d6a6176612d766572696679`，
即 `D:\TaoCode\.tmp-java-verify` 的十六进制）内容都只有：

```
java.version=21.0.12.1   java.vendor=Eclipse Adoptium
class org.eclipse.jdt.ls.core.internal.JavaLanguageServerPlugin is started
Started org.eclipse.buildship.core 31ms
Started org.eclipse.m2e.core 1ms
Main thread is waiting
ProjectRegistryRefreshJob finished 918ms
>> shutdown
```

**注意：没有 `>> initialize`。**

**证据 2 —— 同机同版本的反例**：`.metadata` 里的 `probe-raw` 会话（raw stdout 探针，非生产路径）有：

```
Main thread is waiting
>> initialize
Initializing Java Language Server 1.44.0.202501221502
Workspace initialized in 24ms
```

同一套 JDT LS 1.44、同一个自带 JRE 21。

**已经排除的**：先前记下的"`native/lsp.cpp::is_response()` 把 `window/workDoneProgress/create`
的 params 里的 `token` 当成子串 `result` 而误判成响应"——**不成立**。核对 `native/lsp.cpp:211-214`，
`is_response()` 用的是 `message.contains("result")`，这是**顶层键**判断，不是子串匹配；
并且 `native/lsp_test.cpp:153` 已有一条「服务器请求不是响应」的断言在通过。
另外 `git diff -- native/lsp.cpp` 为空，即该文件相对 HEAD 没有被改过。

**还没查明的**：写入通道看上去是通的（`>> shutdown` 到达并被服务器记录了），
**但 `initialize` 没有到达**。为什么同一个写通道里 `shutdown` 到得了而 `initialize` 到不了，尚未定位。

**建议的取证方向**（不预设结论）：
- 把 Host/Client 实际写进管道的**字节** dump 出来，与 raw 探针的字节逐字节对比
  （重点：`Content-Length` 头、CRLF、body 长度是否按字节算、首帧是否在服务器开始读之前写入）。
- 用**同一份参数**分别跑 raw 客户端与 `lsp_host`，对比两侧时序（`initialize` 相对进程启动的时间点）。
- 查 `Host::start()` 的线程/写入时序：`native/lsp_host.cpp:84-174`（`client_.start()` 在 169），
  reader 线程在 130-167。注意 reader 在遇到坏帧时会 `break` 并 `fail_pending("LSP_CLOSED")`。

**相关代码位置**：
- `native/lsp.cpp:211` `is_response` / `:216` `is_server_request` / `:220` `is_notification`
  / `:452` `Client::receive()` 的分派链（`is_response` → `is_notification` → `is_server_request`）。
- `native/lsp_host.cpp:71-82` `write_frame`、`:130-167` reader 线程、`:176+` `stop()`。

---

## 2. `Main.java` 的运行链只在命令级/原生 spawn 级验证过 —— **两条怀疑均已排除（2026-09-28 二次取证）**

1. 「无标签编译任务收不到 `run.started`」**不成立**：`native/run_host.cpp:240` 无条件发送（`:239` 注释明确
   "Unnamed builds also need an active console"），专项回归 `native/java_run_host_regression_test.cpp:135-142`
   已钉死；前端 `src/runInstances.ts:75-77` 不看 label。
2. 「`cmd /s /c` 拆坏含空格 JDK 路径」**不成立**：`run_host.cpp:93-98` 对整条命令**外层再包一对引号**，
   `/S` 语义确定性只剥这一层；JDK exe 由前端先加引号（`src/javaRun.ts:191` / `projectBuild.ts:189`），
   回归 `:129,144-157` 用带空格 classpath 验过 argv 不散。
   （结论来自只读代理的源码级取证；WebView2 内的真实点击仍待做，见下。）

**现象**：从未在运行中的桌面 WebView2 里真正点过一次「运行」并看到输出。

**待核实的两条线索**（来自一个因额度不足中断的 worker 报告，**结论未被采信，请自行复现**）：
1. 无标签的编译任务不会收到 `run.started`，导致 `runToExit` 永远等不到当前实例退出；
2. 原生宿主把 Java/JDK 命令直接接在 `cmd /s /c` 之后，含空格的 JDK 路径会被拆坏。

**相关源码**：`src/javaRun.ts`、`src/runActions.ts`、`src/runConfigurations.ts`、
`src/runTargets.ts`、`src/buildHost.ts`、`src/projectBuild.ts`、原生侧命令拼装处。

---

## 3. 用户报告的三个症状 —— **已定位并修复（2026-09-28）**

1. **默认配置错误** → 四处与 IDEA 不一致，全部对齐（IDEA 引用均已亲验）：
   `mainMenuDisplayMode` 默认 **hamburger**（UISettingsState.kt:207；原生+前端两处）；`todoPatterns`
   只发 todo/fixme 两条且正则逐字（DefaultTodoDefaultPatternProvider）；`buildTools.autoReloadType`
   默认 **SELECTIVE**（AutoImportProjectTrackerSettings.kt:16-26）；`jdkName` 存 IDEA 显示名
   `17`/`1.8`（JdkUtil.suggestJdkName），jdt.ls 的 `JavaSE-<x>` 只在 `java_lsp_settings` 边界归一。
2. **工具窗口布局错误** → `search`(=Find) 移到**底部**（defaultToolWindowlayoutProvider.kt:246）；左栏
   V2 顺序 Project→Commit→Structure→Bookmarks（:257-267）。**严格对齐**追加：`history`/`tests` 从
   工具窗口除名 —— Local History 改为 **ShowHistoryAction 同款对话框**（Git/视图菜单「显示本地历史」，
   `src/menus/localHistory.ts` + App.vue 的 LocalHistoryDialog）；测试结果长在 **Run 控制台**
   （TestRunnerPanel 挂 run 标签，IDEA 无 Tests 磁贴）。
3. **主工具栏上方的长条** → 根因是 `#app` 首子节点 `<svg class="color-blind-defs">` 的行内空行盒；
   修复 CSS（`.color-blind-defs{position:absolute}`）在工作区里但**没进被打包的 build/ui**（受保护
   快照停留在旧 dist）。`dist/` 已重建；`build/ui` 刷新需用户确认后执行（交接约束：不许覆盖）。

均来自用户实测报告，**本轮没有定位到真实根因**，也没有做修改：

1. **默认配置文件错误**（新建/打开项目时产出的默认配置不对）。
2. **工具窗口布局错误**。
3. **主工具栏上方有一条无意义的矩形长条**。

要求：按上游 IDEA 源码对照定位（只读参考
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`），
不允许按类名/按钮文字/注释猜测等价。

---

## 4. 已记录但未独立复核的验证结果

以下数字来自上一轮记录，**本轮没有复跑**，接手时请自行验证再采信：

- 前端 `npm test` 894/894；`vue-tsc -b` 0 错。
- 原生 CTest 30/30（含 `lsp_server_discovery`、`jdtls_launch_spec`）。
- `jdtls_test.exe` 5/5、`lsp_discovery_test.exe` 10/10、`projects_test.exe` 22/22。
- `build-validation` 内有最新 `TaoCode.exe`、`jdtls\`、`jre\`。

---

## 5. 行数上限现状（`tests/module-size.test.mjs` 是唯一权威）

上限**只能靠拆模块下调，不许上调**。当前实测行数 / 登记上限：

| 文件 | 当前 | 上限 |
|---|---|---|
| `native/main.cpp` | 1921 | 1923 |
| `native/lsp_session.cpp` | 1423 | 1440 |
| `native/projects.cpp` | 770 | 950 |
| `native/lsp.cpp` | 520 | 1100（默认） |
| `native/lsp_host.cpp` | 284 | 1100（默认） |
| `native/lsp_config.cpp` | 61 | 900/1100（默认） |

---

## 6. 需要清理的临时物（未经用户确认不要删）

目录：`.tmp-java-smoke/`、`.tmp-java-verify/`、`.tmp-jdtls-jar/`、`.tmp-jdtls-ws*/`（含
`-config/-config_linux/-config_linux_arm/-config_mac/-config_ss_win/-config_win`）、
`.tmp-jdtls-official-ws/`、`.tmp-jdtls-raw-config_ss_win/`、`.tmp-jdtls-wsarea/`、
`dist-validation/`、`.tools/`。

文件：`native/jdtls_probe.cpp`（**当前未被任何构建目标引用**，`CMakeLists.txt` 里已无 `jdtls_probe`）、
`.tmp-jdtls-probe.cpp`、`.tmp-jdtls-raw-stdout.mjs`、`.tmp-jdtls-config-probe.mjs`、`.tmp-jdtls-raw.mjs`、
`.tmp-jdtls-official.mjs`、`.tmp-jdtls-wsarea.mjs`、`.tmp-jdtls-handshake.mjs`、`.tmp-jdtls*.log`、
`.tmp-jdtls-raw-config_ss_win.log`，以及一批与本次无关的 `.tmp-*.log/.mjs/.ps1/.py`。

注意：`build-validation\jdtls\` 下已被探测写脏（`config\*.log`、`configuration\`、
各 `config_*/org.eclipse.osgi/...`），只影响验证目录，不影响 `build\`。

清理时 `Remove-Item` 会被安全策略拦下，用 `mavis-trash`。

---

## 7. 其他已知阻塞

- 内置 Browser（Electron 主进程）曾反复报 `Browser action failed`，导致 UI 实测受阻。
- 上一轮多个后台 worker 因 BYOK 额度不足失败，**其结论均未采信**。

---

## 8. 已经定下、不要重新推翻的设计决定

0. **LSP 服务完全内置，不按项目 JDK 下载其它版本**（2026-09-28 用户拍板，推翻当天早些
   「按 JDK 自动安装对应版本」的实验方向）。曾实现过一版「JDK≥21→1.47.0、17–20→1.43.0
   自动下载 + 缓存 + 换线」，用户明确「不用了，直接走原来的方案，用完全内置」后已全部
   回退。保留的只有两处真实修复：`src/buildHost.ts` 的 `javaDefaults` 把探测名（`21`/`1.8`）
   归一成 `JavaSE-<x>`（原样写回会被设置校验整个拒绝），以及 `native/projects.cpp` 的
   `normalize_runtime_name`（`java.configuration.runtimes[].name` 同样只认 `JavaSE-<x>`，8 写作
   `JavaSE-1.8`）。

（这些是上一轮踩坑后定下的，如果要有不同做法，请给出与下述实测相冲突的新证据。）

1. **内置 JDT LS**，与 IDEA 自带 Java 支持对齐；二进制不入库，改为构建期取件：
   `scripts/fetch-jdtls.ps1`（钉 1.44.0 + SHA-256）、`scripts/fetch-jre.ps1`（钉 Temurin JRE 21.0.12.1+1），
   由 `scripts/build-native.ps1` 在 configure 后、build 前调用。
2. **语言服务器运行时与项目 Java 版本解耦**：用 IDE 自带 JRE 21 跑 JDT LS，项目 JDK 只管编译/运行用户代码。
   因此项目 JDK 只是**回退项**，不作为「有没有 Java 支持」的前置条件
   （`native/lsp_config.cpp:48` 已去掉该前置条件）。
3. **配置目录按 config.ini 的「数据」打分选**，不按目录名猜（实测 Windows 上用 `config_linux` 也能握手成功）；
   判据见 `native/jdtls.cpp:72-113`。
4. **启动参数逐字照官方包自带 `bin/jdtls.py` 的 `exec_args`**（已逐条核对 `build-validation\jdtls\bin\jdtls.py`），
   额外显式给可写 `-Dosgi.configuration.area` 以免写入安装目录。见 `native/jdtls.cpp:141-182`。
5. `TaoCode.lsp.json` 是显式覆盖，优先级最高；`merge_discovered` 不为 Java 做决定
   （Java 一律走 `discover_java`：随发行 → 缓存 → PATH）。
6. **语言服务器不得用关键词回退冒充语义服务**；找不到服务器要如实报「无法提供补全」。
