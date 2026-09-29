# IDEA 源码全量迁移清单

> 源码根：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`
> 统计口径：`.java` + `.kt` 文件（不含 .git/build/out）
> 用途：桃 2026-09-27 要求「不以小目标完成为结束指标，直到源码内所有文件迁移完成」——本清单是进度与对照的唯一依据。

## 总览：27 个顶层模块 / 170,703 个源码文件

| 模块 | 文件数 | TaoCode 对标方式 | 状态 |
|---|---:|---|---|
| `plugins` | 80,327 | 各语言/框架第三方插件（Kotlin/Android/JS…）—— TaoCode 不加载第三方可执行代码（插件只贡献入口），按需对照其平台扩展点 | `[ ]` |
| `java` | 47,671 | Java 语言支持（PSI/重构/检查）—— TaoCode 用 LSP 提供等价能力，按能力对照 | `[ ]` |
| `platform` | 31,755 | IDE 平台核心（编辑器/工具窗口/设置/运行/构建/插件）——**对标主体** | `[ ]` |
| `python` | 5,015 | Python 语言插件 —— 走 LSP | `[ ]` |
| `xml` | 1,512 | XML 支持 —— 走 LSP | `[ ]` |
| `jps` | 821 | 构建进程（增量编译）—— 对应 build/运行链路 | `[ ]` |
| `grid` | 559 | 测试网格基础设施 —— 不适用（TaoCode 无分布式测试） | `[ ]` |
| `fleet` | 556 | Fleet IDE —— 不适用（另一套 IDE） | `[ ]` |
| `tools` | 554 | 开发工具 —— 按需 | `[ ]` |
| `jvm` | 515 | JVM 抽象 —— 不适用（TaoCode 宿主是 C++） | `[ ]` |
| `json` | 418 | JSON 支持 —— 走 LSP | `[ ]` |
| `uast` | 336 | 统一 AST —— 走 LSP 语义 | `[ ]` |
| `notebooks` | 153 | Notebook —— 待评估 | `[ ]` |
| `RegExpSupport` | 143 | 正则支持 —— 已完成（用 JS RegExp） | `[ ]` |
| `images` | 102 | 图像处理 —— 待评估 | `[ ]` |
| `spellchecker` | 84 | 拼写检查 —— 待评估 | `[ ]` |
| `updater` | 55 | 更新器 —— 待评估 | `[ ]` |
| `commandInterface` | 48 | 远程命令接口 —— 待评估 | `[ ]` |
| `libraries` | 31 | 依赖库元数据 —— 按需 | `[ ]` |
| `aether-dependency-resolver` | 11 | Maven 依赖解析 —— 待评估 | `[ ]` |
| `.idea` | 10 | 待评估 | `[ ]` |
| `.idea.bazel` | 10 | 待评估 | `[ ]` |
| `jupyter` | 10 | 待评估 | `[ ]` |
| `.ownership` | 2 | 待评估 | `[ ]` |
| `native` | 2 | 待评估 | `[ ]` |
| `tests` | 2 | 待评估 | `[ ]` |
| `idea` | 1 | 待评估 | `[ ]` |

## platform 子模块（173 个 / 31,755 文件）—— 核心对标

### 关键子模块

| 子模块 | 文件数 | TaoCode 对标 | 状态 |
|---|---:|---|---|
| `platform-impl` | 4,635 | IDE 外壳/工具窗口/编辑器宿主/状态栏/欢迎页 —— 逐类对照中 | `[ ]` |
| `lang-impl` | 4,334 | 语言基础设施（词法/增量/引用/文档）—— TaoCode 用 LSP 承接，按能力对照 | `[ ]` |
| `util` | 1,741 | 通用工具类（集合/文本/并发/IO）—— 按需对照，仅移植有行为的部分 | `[ ]` |
| `platform-api` | 1,127 | 平台公开 API（扩展点/服务）—— 对应 TaoCode 的 bridge 方法表 | `[ ]` |
| `workspace` | 907 | 工作区/文件系统/文档模型 —— 对应 native/workspace.cpp + src/bridge.ts | `[ ]` |
| `core-api` | 883 | 核心 API（应用/组件/进度）—— 对应 App 生命周期 + progressPanel | `[ ]` |
| `vcs-impl` | 1,230 | Git 集成（提交/历史/工作树/子模块）—— 已大量迁移（见 src/components/SourceControl.vue、native/git*.cpp） | `[ ]` |
| `xdebugger-impl` | 692 | 调试器 UI/模型 —— 对应 native/dap.cpp + DebugPanel.vue | `[ ]` |
| `execution-impl` | 401 | 运行配置/执行 —— §10 #5 待补的核心逻辑 | `[ ]` |
| `editor-ui-api` | 302 | 编辑器 UI 扩展（行内元素/gutter/字体）—— gutter 图标层为已知缺口 | `[ ]` |
| `analysis-impl` | 497 | 检查/意图/快速修复 —— 对应 LSP codeAction 链路 | `[ ]` |
| `diff-impl` | 400 | 差异视图 —— 已迁移（DiffView.vue） | `[ ]` |
| `testFramework` | 612 | 测试框架集成 —— 已迁移 ctest/node:test/JUnit 发现与运行 | `[ ]` |
| `vcs-log` | 574 | VCS 日志图 —— 已迁移（vcslog 视图） | `[ ]` |
| `external-system-impl` | 414 | 外部进程/终端 —— 对应 terminal.cpp + ConPTY | `[ ]` |
| `core-impl` | 658 | 按能力对照 | `[ ]` |
| `analysis-api` | 458 | 按能力对照 | `[ ]` |
| `lang-api` | 640 | 按能力对照 | `[ ]` |
| `vcs-api` | 288 | 按能力对照 | `[ ]` |
| `platform-tests` | 1,364 | 平台测试 —— 不移植（TaoCode 有自己的 tests/） | `[ ]` |
| `jewel` | 669 | 新 UI（Compose 桌面框架）—— TaoCode 用 Vue 重实现，不逐类移植 | `[ ]` |

### 其余 152 个子模块（合计 8,929 文件）

按文件数降序（每项都需对照源码判定对标方式，不允许写"不做"）：

```
   354  collaboration-tools
   290  statistics
   289  build-scripts
   277  remote-driver
   239  polySymbols
   233  ide-core
   226  projectModel-impl
   199  remote-servers
   197  lsp-impl
   195  execution
   187  searchEverywhere
   180  structuralsearch
   179  lvcs-impl
   174  external-system-api
   174  polySymbols-web
   161  indexing-impl
   158  syntax
   150  code-style-api
   143  projectModel-api
   119  feedback
   118  code-style-impl
   118  dvcs-impl
   116  script-debugger
   114  eel
   109  xdebugger-api
   106  smRunner
   103  indexing-api
   102  settings-sync-core
   100  configuration-store-impl
   100  icons-impl
    98  ijent
    96  structure-view-impl
    90  problemsView
    88  bookmarks
    88  remoteDev-util
    88  usageView
    83  projectView
    79  execution.dashboard
    77  diagnostic
    77  diff-api
    75  refactoring
    74  ide-core-impl
    74  usageView-impl
    73  todo
    72  execution-process-mediator
    71  built-in-server
    67  vcs-tests
    66  platform-util-io
    65  navbar
    64  editor-ui-ex
    63  lsp
    63  util-ex
    62  macro
    62  testRunner
    60  core-ui
    60  ml-impl
    59  lang-core
    58  completion
    57  ui.jcef
    55  execution.serviceView
    54  util-rt
    51  foldings
    49  runtime
    46  compose
    46  credential-store-impl
    46  extensions
    46  non-modal-welcome-screen
    45  icons-api
    43  pluginSystem
    41  duplicates-analysis
    41  kernel
    40  recentFiles
    39  ml-api
    39  object-serializer
    38  observable
    36  instanceContainer
    32  wsl-impl
    30  eel-impl
    30  remote-core
    26  core-nio-fs
    25  inspect
    25  new-ui-onboarding
    24  service-container
    23  dvcs-api
    23  tasks-platform-impl
    22  backend
    22  external-process-auth-helper
    22  progress
    21  external-system-rt
    20  eel-nioFs
    20  sqlite
    20  tasks-platform-api
    19  util-class-loader
    18  eel-impl-base
    18  warmup
    18  whatsNew
    17  bootstrap
    17  eel-nioFs-impl
    17  pluginManager
    17  remote-topics
    16  inline-completion
    13  buildView
    13  markdown-utils
    13  platform-util-netty
    12  pratt
    12  project
    12  settings-local
    11  forms_rt
    11  new-users-onboarding
    10  eel-tcp
    10  experiment
    10  welcome-screen-impl
     9  platform-util-io-native
     9  rd-platform-community
     9  smart-update
     8  credential-store
     8  execution-process-elevation
     8  jps-bootstrap
     8  lvcs-api
     7  boot
     7  find
     7  scopes
     7  settings
     7  tracing-ide
     7  xdebugger-testFramework
     6  eel-provider
     6  libraries
     6  project-frame
     6  threadDumpParser
     5  built-in-server-api
     5  locking-impl
     5  managed-cache
     4  discoverability
     4  distribution-content
     4  favoritesTreeView
     4  jbr
     3  bazel-runfiles
     3  buildData
     3  ml-logs
     3  welcome-screen
     2  credential-store-ui
     2  editor
     2  indexing-tests
     2  testIntegration
     2  testIntegration-ui
     2  tracing
     1  devIdeConfig
     1  icons
     1  multiplatformSupport
     1  platform-frontend
     1  platform-util-io-impl
     1  starter
```

## 进度记法

- `[x]` 已迁移（有落点文件与行为一致）；`[~]` 部分迁移；`[ ]` 未开始；`[-]` 不适用（**必须附源码路径+行号理由**）
- 逐类清单见 `docs/inventory/*_scan.md`；本文件是模块级总清单，两者配套使用。
- 每完成一批，同步更新本文件与 `docs/class-parity-todo.md`。
