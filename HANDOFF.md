# 交接说明（顶部状态更新于 2026-10-02 凌晨；下面「本轮」段是 2026-09-27 的历史存档）

## 当前状态：全绿

| 检查 | 结果 | 备注 |
|---|---|---|
| `npx vue-tsc --noEmit` | 0 错 | 2026-10-02 复跑 |
| `npm test` | **1371/1371** | 2026-10-02；最近一批新增 `quick-definition` 9 条、`choose-target` 11 条 |
| `npx vite build` | ✓（需**手动**跑，再 `build-native-locked.bat` 同步到 `build/ui`） | 构建脚本只做 `cmake --build` + 拷 `dist`，**不含 vite** |
| `scripts\build-native-locked.bat` | RC 0 / **0 warning** | main.cpp 已顶到 2000 行硬上限（新能力拆 `native/xxx.cpp`：近期拆出 `file_queries.cpp` / `library_sources.cpp`） |
| `ctest` | **36/36** | 2026-10-02；新增 `lsp_config_file`、`library_sources`。`ctest.exe` 不在 PATH，用 `scripts\run-ctest.bat` |
| 真机取证 | **同一时刻只能跑一个 TaoCode 实例**（WebView2 用户数据目录固定 `%LOCALAPPDATA%\TaoCode`）；探针的 `build/TaoCode.lsp.json` 用完立刻删，别留在用户正在用的 exe 旁边 | 姿势与脚本见 `scripts/_cdp_step.py` |

**最近这一段（第七十七～七十九批）的落点**：补全弹层的收尾（排序/分组更正/`filterText`/「选择声明」）、
`Ctrl+Alt+B`「选择实现」弹层、**「快速定义」Ctrl+Shift+I + 库类型源码**（`native/library_sources.cpp` +
桥接 `file.librarySource`）、以及两个真缺陷 —— ① `TaoCode.lsp.json` 因悬垂临时对象**从未被读到**；
② `lspReady` 写在非响应式对象上导致符号菜单/随处搜索长期不亮（Vue 代理陷阱）。
另外把 JDT 的 workspace folder 收窄成**已链接的子工程**（`ServerConfig::workspace_folders`），
AE2 那种布局上工程数 6 → 1、诊断 2100+ 批 → 5 批。逐条明细在 `docs/ui-parity-checklist.md` 的
第七十七～七十九批。

## 本轮（2026-09-27 晚）做了什么 —— 历史存档

1. **修掉一次没做完的改名**：`javaRun.*` 的产物目录从 `outputPath: string` 改成 `outputPaths: string[]`
   （`runtimeOutputPaths` 的设计，产物目录要跟着构建工具走），但只改了 `javaRun.ts` / `runTargets.ts`，
   留下 4 处旧调用点，其中 2 处是**真实运行期 bug**：
   - `src/runActions.ts` 运行路径传 `outputPath` → `outputPaths` 得 undefined → **运行 Java 文件抛 TypeError**；
   - 同文件调试路径传字符串 → 字符串可迭代 → classpath 被逐字符展开成 `o;u;t;/;p;r;o;d;u;c;…`（**静默损坏**）；
   - `src/runConfigurations.ts` 同样错键，但外面包着 `try/catch` → 异常被吞，`autoTargets` 恒为 `[]`
     （就是最初报的"打开项目没有运行配置"）。
   运行路径同时换成复用 `runtimeOutputPaths(plan_request)`，Gradle/Maven 才用上自己的产物目录。
2. **核实出清单不可信，并重枚举**（详见 `docs/class-parity-todo.md` §0'）：7 域 **5 051 → 10 400 类**，
   补回 Git Log 580 / editor 735 / projectView 163 / Search Everywhere 146 / folding 71；
   新增 `scripts/enumerate_inventory.py` 与 `scripts/inventory_gaps.py`（**有洞就 exit 1**）。
3. **查出两个待修缺陷**（尚未修，见下）。

## 本轮已修（原查实、已动手）

| # | 缺陷 | 位置 | 怎么修的 |
|---|---|---|---|
| 1 | 「布局」子菜单被插到**窗口菜单最顶上** | `src/menuUi.ts` | 锚点 id `window.searchEverywhere` **全仓不存在** → `findIndex` 得 −1、`+1` 变 0，"碰巧"插对。IDEA 的窗口菜单里本就没有 Search Everywhere（它在 `GoToMenu`，`PlatformActions.xml:604`）。按 `PlatformActions.xml:637-651` 的真实顺序改为**直接置顶**（`[...layoutMenuRows.value, ...windowMenuRows]`），删掉 findIndex + splice。顺带删掉 `windowMenu.ts` 顶部一条与已修正注释**并存**的旧注释 |
| 2 | Search Everywhere 是**空壳** | `src/menus/navigateMenu.ts`、`src/keymap.ts`、主工具栏 | 「随处搜索」(Shift+Shift) 与「查找操作」(Ctrl+Shift+A) **都调 `openActionSearch`**；仓库无任何 tab/贡献者结构（IDEA 侧 146 类）。已做成真对话框：纯逻辑 `src/searchEverywhere.ts`、装配 `src/searchEverywhereHost.ts`、UI `src/components/SearchEverywhereDialog.vue`；tab 取自 `IdeBundle.properties` 的 `searcheverywhere.*.tab.name`（旧那套 Classes/Symbols/… 所属的 `ContributorDefinedTabsCustomizationStrategy.kt` 已 `@Deprecated`），只渲染有真实供给者的 **All / Project / Commands / Run Configurations** |

**LSP 符号供给者已经接上（2026-10-01 第七十八批复核，上一条"仍未做"是过期的）**：`src/searchEverywhereHost.ts`
按查询词（≥2 字、120ms 防抖）发 `workspace/symbol`，`symbols` 供给者同时喂 All 与 Project tab，
结果带行/列预览；关闭/切工作区/文件变化分别作废在途请求（`tests/search-everywhere.test.mjs` 逐条锁住）。
**仍未做**：`IDE` / `Autocompletion` 两个 tab —— 二者在本仓都没有真实供给者：`IDE` 那个名字
（`searcheverywhere.ide.search.tab.name`）在参考源码树里**只有资源串、没有任何代码用它**（grep 全树 0 命中，
只有 grazie 的 i18n 测试数据），`Autocompletion` 是"搜索框里的查询命令补全"（`AutoCompletionProvider.java:40-100`
的 `AutoCompletionCommand`），本仓的搜索框没有查询语言，所以按"没有真实消费链路的项不渲染"不放假控件。

## 缺口清单现状

- **`docs/enum-lsp-dap.md` §C（LSP 缺口）：0 条** —— 37 个 LSP 请求全部实现。
- **§D（DAP 缺口）：3 条**，且**都是协议侧补齐**（`loadedSources` 按需重取 / `stepBack`+`reverseContinue` /
  `readMemory`+`disassemble`）—— 三条在 IDEA 源码里**都没有对应类**（文档里附了搜索命令与零命中结果）。
  它们排在 `docs/class-parity-todo.md` 的类清单之后。
- **`docs/class-parity-todo.md`（总控）**：`[x]` 30 / `[~]` 15 / `[ ]` 13 / `[-]` 6。
  ⚠️ 这里的 `[ ]`/`[~]` 标记**未经复核**（本轮只重枚举了类清单，没重判判决）；
  §9 里 5 个"工作量大"的项目（`ToggleFullScreen` / `EditorToggleShowGutterIcons` / `Macros` /
  `ExportImportGroup` / `EditorBidiTextDirection`）实际**都已落地**，代码在仓库里。
  **下一批的起点应该是 §0' 的 10 400 类逐类判决，不是这份旧标记。**

## 续做须知（今天新立的规矩）

1. **文档里的 IDEA 依据必须带搜索命令或标 `待核`** —— 今天核对 6 条「IDEA：`XxxClass`」「与 IDEA 一致」
   断言，**6 条全错**（详见 `.workbuddy/memory/2026-09-27.md`）。
2. **大文件上限只能靠拆来下调**，不许抬（`tests/module-size.test.mjs`）：今天把
   `lsp_fake_server.cpp`(762→4 文件)、`CodeEditor.vue`(1284→1211)、`lsp_session.cpp`(1973→1381) 都拆了。
3. **脚本改代码**：优先 Edit（有唯一性校验）；必须用脚本时 `assert t.count(anchor) == 1`、每步一写、
   改前备份、改完跑行为基线。中文引号一律「」（半角 `"` 会让脚本 `SyntaxError` 且整体不写盘 —— 今天 5 次）。
4. **编译通过 ≠ 行为正确**：拆分后曾出现"零警告但服务器完全不响应"（漏了 `set_sender` 注入），只有测试抓到。
5. 新增的 skill：`~/.workbuddy/skills/scripted-refactor-safety/`（脚本化重构的安全规程）。

## 继续的起点

- 类清单：`docs/class-parity-todo.md` 的 `[ ]` 与 `[~]` 行（每行都标了缺什么）。
- 逐类明细：`docs/inventory/*_scan.md`（7 域 5051 行，每行一个源码类 + 机检状态）。
- 机检：`scripts/parity_scan.py` + `node --test tests/routing-parity.test.mjs tests/module-size.test.mjs`。

# HANDOFF · TaoCode IDEA UI 1:1 移植

> 交接件。未来只读这一份即可接续，不需回读对话。路径索引见文末。

---

# 以下为**上一次会话**的交接（存档）

> ⚠️ 里面的数字已过时（那时 `npm test` 是 138/138，现在是 **535/535**；验证口径里的
> `vite build --emptyOutDir false` 也已被 `build-native-locked.bat` 的 dist→build/ui 复制取代）。
> **最新状态以本文开头那几段为准。** 保留它是因为「踩过的坑」那张表仍然有效。

## 【主线状态】

**目标**：把 `D:\TaoCode`（C++20 宿主 + WebView2 + Vue3）的界面与交互按 IDEA 源码 1:1 移植补全，禁止虚假/占位/空壳。

**当前节点**：设置对话框（外观页）、主窗口（顶栏/工具窗口/状态栏/提交面板）、欢迎页三块区域的**有真实消费链路**项已全部落地并实测通过。
**第 25~27 批后新增**：状态栏工具窗口 widget、顶栏项目 widget、提交图例、提交前检查与拒绝原因；并把纯逻辑抽成 `src/toolWindows.ts` / `src/commitLegend.ts` / `src/projectWidget.ts` / `src/commitCheck.ts` 四个可单测模块（测试 112 → 138）。

**权威清单**：`D:\TaoCode\docs\ui-parity-checklist.md`（逐条勾选 + 未做项及理由 + 每批验证记录）。

**验证口径（每批必跑）**：
1. `npx vue-tsc --noEmit -p tsconfig.json` → 0 错误
2. `npm test` → 138/138
3. `npx vite build --emptyOutDir false` → exit 0（`--emptyOutDir false` 是因为沙箱禁止批量删除 dist）
4. `python -c "import subprocess;subprocess.run(['cmd','/c',r'D:\TaoCode\scripts\build-native-locked.bat'])"` → RC 0 且零告警
5. `ctest --output-on-failure`（17 项）→ 全绿
6. **启动冒烟**：先 `taskkill //IM TaoCode.exe //F`，再 `subprocess.run(['./TaoCode.exe'], timeout=15)`；`TimeoutExpired` 视为存活

**下一步候选**（按价值）：
1. 「图 X」截图条目核实——**等桃补图**（本会话模型看不到图片，此前"图 1/2/3 的内容"是我推断的，不可作为依据）
2. 剩余已判定为不做/有意偏差的项（透明度语义不符、抗锯齿浏览器不暴露、三个状态栏 widget 无对应机制、项目 widget 的 tooltip 不相对主目录、提交图例的 registry 强制紧凑开关不表面化）——如桃要求仍可逐项尝试
3. `CommitAuthorComponent`（vcs/commit/CommitAuthorComponent.kt:38-121）：需要新增原生 `git.user`（读 `user.name`/`user.email`）与 `git.commit --author`，属跨层改动，尚未开始

**第 24 批（todolist 一次性完成）**：欢迎页项目分组、主菜单位置三模式、屏幕阅读器支持、工具窗口条拖放换边重排——四项均已落地并实测。

## 【本session】

**做了什么**（第 11~27 批 + 两次回归修复，全部实测）：
- 状态栏：内存指示器（原生 `app.memory`）、列选择模式指示器、进度指示器 + 取消按钮（原生 `git.progress` / `git.cancel`）、通知中心、SmartMode 指示（含误报修复）、位置 widget（选区/多光标/点击转到行）、**右键组件菜单**（15 widget 勾选 + 持久化）、省电模式、**工具窗口 widget（悬停列出窗口 + Alt+编号，点击切工具窗口条）**
- 外观页：缩放/紧凑/完整路径/树视图×2/平滑滚动/菜单图标/工具窗口组×3/并列布局×3/背景图像/演示模式/对比滚动条/色觉滤镜/界面字体
- 提交面板：IDEA 结构（信息框头部 + 修改(M) + 提交(N)/提交并推送(P)）、历史信息、回滚、重新格式化、提交选项（--signoff + TODO 预检）、**提交图例（暂存分类小计 + 宽度不足自动紧凑）**、**提交前检查与拒绝原因标签**
- 欢迎页：左栏 tab 语义 + 自定义页 + 插件计数 + ⋮ 菜单 + 分支行 + 空态快捷动作 + 删除确认 + 键盘删除
- 顶栏：**项目 widget（已打开/最近项目 + 搜索）**、Git 分支 widget、运行 widget

**踩过的坑（都已修，值得记住）**：
| 坑 | 现象 | 处置 |
|---|---|---|
| 递归加锁 | `queue_git_request`/`git_worker` 持 `git_mutex` 时调 `publish_git_progress()` → 启动即崩 `0xC0000409` | 发布移出锁外 |
| 伪实现（menuIcons） | 后一次编辑整块替换掉了 `dataset.menuIcons` 赋值，只剩死 CSS | 补回并扩到所有菜单面 |
| 伪实现（bracketMatching） | 控件+持久化都有，编辑器从未读它 | 加 `data-bracket-matching` + CSS 取消高亮 |
| 模板属性坑 | `:aria-label="运行"` 多冒号 → tsc 报 `Property '运行' not found`；三元+反引号嵌套也易歧义 | 字面量不加冒号；复杂 title 用 computed |
| 脚本改文件 | 用 python 字符串替换插块时重复插入、把 CSS 规则拆坏 | 改后必须 grep 计数确认，CSS 破坏要用行区间重建 |
| CSS 误插进媒体查询 | 顶栏 widget 规则同时存在于全局与 `@media (max-width:700px)` → 宽屏下 `.run-caret` 样式缺席 | 删媒体查询内重复块，规则归位全局 |
| 未声明标识符 | `DebugPanel.vue` 的 `consoleNote = …` → vue-tsc `TS2304`、运行时 ReferenceError | 与同文件其余 catch 统一为 `error.value = message(caught)` |
| 链接失败 | 残留 TaoCode.exe 占用导致 `LNK1104` | 构建前先 taskkill |
| 图片 | 本会话模型看不到截图 | **已如实告知桃；不可再假装看到** |

**未决 / 挂起**：
1. 「图 1/2/3」截图条目未核实（等桃补图或文字描述）
2. 有意偏差清单（每项都有 IDEA 源码行号，见清单对应条目）：项目 widget 的 tooltip 不相对主目录；提交图例的 registry 强制紧凑开关不表面化；amend 留空信息沿用原信息；透明度/抗锯齿/三个状态栏 widget 判定 N/A
3. 监督代理（`supervisor`）每轮结束会被框架回收，需重派；定时任务 `79edf316-456b-4856-af5a-d6eac40a38ab` 每 15 分钟自动拉起 main（`FREQ=HOURLY;INTERVAL=1;BYMINUTE=0,15,30,45`）

## 索引

- 硬规则：`.workbuddy/memory/MEMORY.md`（任务未完成禁止停止 / 禁止编造 / 缺口必须读源码 / 不放假控件 / 验证口径）
- 日志：`.workbuddy/memory/2026-09-26.md`（按批记录）
- 清单：`docs/ui-parity-checklist.md`
- 审计报告（第一阶段）：`docs/audit-completion-report.md`
- IDEA 源码：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
- 构建：`scripts\build-native-locked.bat`（含互斥锁；SDK 路径手抄，因 `reg.exe` 被沙箱拉黑）
