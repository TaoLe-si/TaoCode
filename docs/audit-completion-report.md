# TaoCode 全量逻辑审计与补全报告（第一阶段：全量 IDE）

日期：2026-09-25
范围：`D:\TaoCode`（Windows C++20 宿主 + WebView2 + Vue3 前端，约 26k 行）
方法：先做只读审计找出"假逻辑"，再对每一处给真实实现，最后全量编译 + 17 项 ctest + 112 项前端测试 + 启动冒烟。

---

## 0. 结论摘要（全部为实际执行结果）

| 验证项 | 命令 | 结果 |
|---|---|---|
| 原生全量构建 | `scripts\build-native-locked.bat` | **RC 0，0 error，0 warning** |
| 原生测试 | `ctest --output-on-failure` | **17/17 通过**（172.8s） |
| 前端类型 | `npx vue-tsc --noEmit -p tsconfig.json` | **exit 0，0 错误** |
| 前端测试 | `npm test` | **112/112 通过** |
| 前端构建 | `npx vite build --emptyOutDir false` | **exit 0，6.07s** |
| 启动冒烟 | 直接运行 `build\TaoCode.exe` | **启动后稳定存活 10s（PID 30928，62.9 MB），可干净终止，无启动崩溃** |

基线对比：审计开始时 `git_clone_lifecycle` 401s 且 10 条断言失败、`projects_lifecycle` 1 条失败、
`terminal_conpty` 失败；现在全部通过（`git_clone_lifecycle` 7.5s）。
前端测试从 101 项增加到 112 项（新增 11 项断言新修的行为）。

---

## 一、缺口清单（模块 + 文件 + 问题 + 修复方案）

### 1. 原生 · 语言服务与调试（`lsp.cpp` / `lsp_host.cpp` / `lsp_session.cpp` / `dap.cpp`）

| # | 文件:行 | 问题 | 修复 |
|---|---|---|---|
| A | `lsp_session.cpp:1274` | `shutdown_all()` 持锁 join 读线程 → 死锁；同处还有锁顺序反转（读线程在 Host 锁内回调） | 锁内把 host 移进 `doomed` 并清空 maps，出锁后再 join；`lsp_host.cpp:130-153` 读线程先把一帧批解码进 `batch`，出 `io_mutex_` 后再 `client_.receive()` |
| B | `lsp.cpp:357` | `workspace/applyEdit` 只回 `applied:false`，快速修复/整理 import 永远落不了盘 | `answer_apply_edit()` 解析 `changes` 与 `documentChanges`、按文档归组倒序拼接；`lsp_session.cpp:1191` 真写盘（`Workspace::write` + 版本校验）、:1212 拒绝逃出 root、:665 由 Session 装好写入器 |
| C | `lsp.cpp:423` | `didChange` 一律发全文，与服务器声明的 `textDocumentSync` 不一致 | 仅 `incremental` 且有基线时发 Range diff；`lsp_session.cpp:687` 握手后按服务器能力 `set_sync_kind()` |
| D | `lsp_session.cpp:646` | 未声明能力就发请求 | initialize 声明 inlayHint/selectionRange/synchronization/applyEdit/workspaceEdit/didChangeConfiguration/workspaceFolders；`unsupported()`(:1139) + `provider_for()`(:189) 让未声明能力直接回 `LSP_UNSUPPORTED`，**不降级为空成功** |
| E | `lsp.cpp:266` / `dap.cpp:1118` | 请求无超时、无取消 | 每请求登记截止时间 + 看门狗 + `$/cancelRequest` + `fail_pending()` + 4096 上限。**修掉一个真实并发 bug**：`wait_until(deadline, pred)` 谓词只判 `!watching_`，`notify_all()` 只重跑谓词后睡回旧的绝对时刻，更早到期的新请求永远叫不醒看门狗——超时机制形同虚设。改用 wake ticket（`dap.cpp:530/972/1138`、`lsp.cpp:269/294-298`） |
| F | `lsp_host.cpp:81` | 裸 PATH 命令（`clangd`/`pyright`）起不来；子进程成孤儿 | 命令行改为逐参数 `quote_argument`，`CreateProcessW(nullptr, mutable_command…)`；`CREATE_SUSPENDED` + Job Object `KILL_ON_JOB_CLOSE` + `AssignProcessToJobObject` + `ResumeThread`（`dap.cpp:811` 同套） |
| G | `dap.cpp:1080` | 反向请求（`runInTerminal` / `startDebugging`）恒回 `success:false` | `run_in_terminal_default()`(:715) 真起进程回真 pid；`start_debugging_default()`(:763) 真起嵌套会话并存进 `state_.nested_`。宿主侧钩子接 ConPTY 终端与会话替换 |
| H | `dap.cpp:1454` | detach/destroy 期间 use-after-free | `Client` 只持 `shared_ptr<State>`；`shutdown()` 用 `tearing_` 幂等、**先 join 读线程后置 stopped_**、从读线程内调用则 detach 自己；`disconnect()`(:1343) 发 disconnect → `wait_for_exit(5s)` → `shutdown()` |
| I | `dap.cpp:263` | `exited`/`module`/`loadedSource`/`progress` 未整形 | `shape_event()` 四合一整形，路径统一 `relative_to()` 映射成工作区相对路径 |
| J | `lsp_fake_server.cpp:243` | 假服务器无补全能力，无法端到端断言 | 按光标前缀过滤 7 条词典项，声明 `completionProvider`；新增 `--incremental` / `--no-selection-range` / `--hang=<method>` 开关 |

### 2. 原生 · 运行 / 终端 / 文件监听（`runner.cpp` / `terminal.cpp` / `watcher.cpp`）

| # | 文件:行 | 问题 | 修复 |
|---|---|---|---|
| K | `runner.cpp` | 输出只给"尽力 UTF-8"，cl.exe 的 GBK 输出变成乱码 | `Chunk{bytes, dataB64, text}` 三态，`dataB64` 是无损传输；多字节跨 chunk 残留到下一块 |
| L | `main.cpp` `run.output` | 走 `text`，与上面同一问题 | 改发 `dataB64`，前端 `runDecoder` 流式解码 |
| M | `terminal.cpp` | shell 自己退出后槽位不释放，64 个会话最终全是死-but-held | `on_exit` 回调 + `reap_zombies()` + `term.exit` 事件 |
| N | `watcher.cpp:151-158` | **监听静默死亡**：`pump()` 三条 break 路径 + 空 `catch(...)` 后 `running_` 变 false，但 `running()` 全库零调用点。目录被外部删掉后文件树永久不刷新，UI 还以为在监听 | 新增 `on_stopped(StoppedCb)` / `stop_reason()`，四条原因：`监听已停止`（正常）/ `ReadDirectoryChangesW 失败` / `工作目录已不存在` / `监听线程异常退出`；宿主侧 `WM_APP+9` 封送后自动重启（60s 内健康则重置预算，上限 5 次，超上限发 `fs.watchStopped{restarting:false}`） |
| O | `watcher.hpp:32` | `to_json` 有声明有实现、零调用，`main.cpp:253` 手抄了一份等价逻辑（两份必然漂移） | 宿主侧改为 `changes.push_back(change)` 走 ADL，单一实现 |
| P | `watcher.cpp` | `pump()` 用 `HeapAlloc` 存 `OVERLAPPED`，分配失败是第 5 条无原因退出路径，抛异常时泄漏 | 改栈上 `OVERLAPPED overlapped{}`，删成员与 `HeapFree` |

### 3. 原生 · 核心模块（`git.cpp` / `search.cpp` / `workspace.cpp` / `session.cpp` / `plugins.cpp`）

| # | 文件:行 | 问题 | 修复 |
|---|---|---|---|
| Q | `git.cpp:100` | **致命**：`WaitForSingleObject(..., INFINITE)`，且所有 `git.*` 在 WebView2 消息线程同步执行 → `git push` 卡凭据时整个 IDE 无响应且无法取消 | 三层修复：①宿主把所有 `git.*` 派发到专用工作线程（`git_thread` + `WM_APP+8` 封送）②`run()` 默认 10 分钟有界等待 + watchdog（**必须在读管道之前武装**，否则 `ReadFile` 阻塞永远走不到 Wait，超时就是摆设）③`taocode::git::request_cancel()` 用 Job Object 终止整棵进程树，非阻塞、线程安全 |
| R | `git.cpp:75` | 第二个 `CreatePipe` 失败时第一对句柄泄漏 | 拆两步，失败关闭已成功的一对 |
| S | `git.cpp` 6 处 + 2 处 | `checkout`/`create_branch`/`merge`/`cherry_pick`/`delete_branch`/`tag_create`（以及 `rebase`/`tag_delete`）只校验空串，不校验前导 `-` → `-f`、`--hard` 被 git 当选项解析（参数注入） | 统一走 `checked_ref` 或新增 `checked_new_name`（非空、≤200 字符、不以 `-` 开头、不含空格/控制字符、必须有效 UTF-8） |
| T | `search.cpp:340/375/421/471` | `const bool complete = walk(...)` **赋值后全文件零读取**；`max_scanned_files`(100000) 这条截断路径永不置位 `truncated`，违反 `search.hpp:33-35` 自述契约 | 四个入口统一 `if (!complete) truncated = true;` |
| U | `search.cpp:470` | 替换撞上限时未走到的文件不会被读，却仍返回 `{files:0, replacements:0, truncated:false}` —— "0 处替换"伪装成成功 | 统计 `skipped = |wanted \ visited|`，返回 `skippedFiles`，两条提前 return 也补 0 |
| V | `workspace.cpp:1158` | `copy_tree` 收尾解除只读不检查返回值，与 `workspace.hpp:56-58` "the copy is writable" 承诺不符 | 失败抛 `IO_ERROR`（带 Windows 错误码） |
| W | `workspace.cpp:1109/1225/1247` | 三处解除只读后直接删除，失败时给出误导性的"访问被拒绝" | 检查返回值，明确报"无法解除只读属性" |
| X | `workspace.cpp:1273` | 排除目录匹配用 `path(const char*)` 走本地代码页解码，非 ASCII 目录名失真 | 改 `fs::path(std::u8string(...))`，与 `projects.cpp:113-116` 一致 |
| Y | `workspace.cpp:1258` | `usages_of` 名为"用法查询"实为全工作区文本扫描，无大小上限、不跳二进制 | 保留全工作区（改限目录会漏跨目录引用，等于让"安全删除"变不安全），但返回体加 `scope:"workspace"` / `kind:"text"`，补 8MiB / 前 8KB 嗅探跳二进制 / 20000 文件上限与 `truncated` |
| Z | `session.cpp:136` | `clear` 恒回 `{cleared:true}`，文件被占用时前端显示"已清除"但草稿还在 | `cleared` 改为真实结果 + 错误码；新增"文件本就不存在算已清干净"的前置判断 |
| AA | `plugins.cpp:107-108` | `if (!exists) return;` 紧接 `create_directories(...)` —— 不可达语句 | 删掉，注释说明"目录不存在就是没装插件" |
| AB | `git_clone.cpp` | `same_path` 比较 8.3 短名（`ADMINI~1`）与内核长名（`Administrator`）→ 边界校验全失败、暂存目录泄漏（基线 10 条断言失败、401s） | 新增 `long_text()`（GetLongPathNameW）先比原文再比长名；`remove_children` 打开句柄带 `FILE_SHARE_READ|WRITE|DELETE` 并瞬时冲突重试；`open_directory(owned=true)` 补 `FILE_SHARE_WRITE|FILE_SHARE_DELETE` |
| AC | `projects.cpp` `~OwnedObject()` | `SetFileInformationByHandle(FileDispositionInfo)` 在只带 `FILE_SHARE_READ` 的句柄上返回 `ERROR_ACCESS_DENIED(5)` → 失败保存残留临时文件 | 失败时 `handle.reset()` 后 `DeleteFileW` 兜底 |

### 4. 原生 · 宿主接线（`main.cpp`）

| # | 问题 | 修复 |
|---|---|---|
| AD | `workspace/applyEdit` 被错当成 DAP 能力，引用了不存在的 `dap->set_apply_edit_handler` / `workspace->apply_edits` / `lsp::TextEdit` | 删除该段；`applyEdit` 属 LSP（已由 `lsp_session.cpp` 实现），宿主只挂 `lsp->set_edit_sink()` 通知编辑器重载 |
| AE | `dap::Client::set_run_in_terminal_handler` / `set_start_debugging_handler` 被当成成员 + 双参数调用（实为 **static**、`Json(const Json&, std::string&)`） | 按真实签名注册；`runInTerminal` external 真起 `cmd /d /s /c start` 并回真 `processId`，integrated 真开 ConPTY 会话（尺寸沿用 UI 上次用的 cols/rows，不是常量），失败填 `error` |
| AF | `dap->join()` 不存在；`stop_dap()` 只 `reset()` → UAF | `disconnect({})` → `shutdown()` → `reset()`（`disconnect` 内部 5s 有界） |
| AG | `params_cols()/params_rows()` 硬编码 80×24 | `terminal_cols/rows` 由 `term.create`/`term.resize` 更新 |
| AH | `Runner::process_id()` 不存在 | 新增（`GetProcessId`），供 `runInTerminal` 回真 pid |
| AI | git 异步白名单用了编造的名字（`git.branches`/`git.tagList`/`git.stashPush`…），与真实分派的 `git.branch.create`/`git.tags`/`git.stash.save` 完全不符 → **异步化实际未生效** | 白名单改为 36 个真实方法名；已用脚本双向校验：白名单 \ 分派 = ∅，分派 \ 白名单 = ∅ |
| AJ | `git.amend` / `git.restore` / `git.remotes` / `git.stashDrop` 只出现在白名单、无任何分派分支 | 从白名单摘除（全库包括 `src/` 零命中，本就是幻影名字） |

### 5. 前端

| # | 文件 | 问题 | 修复 |
|---|---|---|---|
| AK | `SettingsDialog.vue` | `useTabCharacter`/`showWhitespaces`/`formatOnSave` 后端已接受并持久化，UI 没有控件 | 补齐三个控件 + 动态缩进宽度提示 + aria |
| AL | `App.vue` 保存路径 | `formatOnSave` 只存不用 | 保存前若开启且语言服务可用，先发 `lsp.request` kind='formatting'，取 edits 全文替换再写盘；失败 notify 后按原样保存（不吞、不掉保存） |
| AM | `App.vue:1800` | "移到回收站"是会话级 `ref(true)`，不持久化 | `deleteToTrash` 进 `EditorSettings` + `defaultEditorSettings` + bridge 白名单 + `projects.cpp` 的 `editor_defaults_impl()` 与 `validate_editor_patch` 的 `known_keys`（**两边必须成对**，否则原生端 `fail("INVALID_SETTINGS")` 会把整个 `settings.update` 打回）；换成走 `settings.update` 的 computed，失败回滚并 notify |
| AN | `VcsLog.vue:140` | `viewBox="0 0 {{...}} {{...}}"` —— Vue 3 不支持属性内插值，输出字面字符串 → 非法 viewBox → SVG 失去坐标系；跨行连线在行边界断开约 13px；泳道永不释放 | 改 `:viewBox` 正确绑定；边拆成 down/up/pass 三段贝塞尔；泳道分配加 `claimLane` 回收（线性历史恒定 1 条泳道）；copyHash 的 `catch{}` 换真兜底；提交行改 listbox + 键盘可达 |
| AO | `ProjectStructurePane.vue` | watcher `deep:true` 导致输入被冲掉；表单不记录所属 root，切项目后会写进另一个项目 | 去掉 deep，加 `formRoot`/`dirty`，过期保存直接拒绝并报错；`void kind` 补成真的测试根判定 |
| AP | `ProjectDialog.vue` | 名称校验漏 Windows 保留名；父目录无校验；路径可超 MAX_PATH | 补保留名 + 80 字符上限、父目录非法字符/绝对性/保留段校验、>240 告警，三处真实可见错误 |
| AQ | `TemplateSettingsPage.vue` | 内置模板行的按钮点了什么都不做；键名/长度/上限全靠浏览器气泡 | 内置行改 `<span>`（不伪装成按钮）；四类可见行内错误；列出会被真正替换的槽位与不会被替换的写法 |
| AR | `FileTree.vue` | `expandAll` 的 `catch{}` 静默吞不可读目录；切项目时在途响应会写进新项目；无空态 | epoch + stale 守卫；expandAll 汇总报错；reveal 返回真实"是否就位"；空态；role=tree 语义 |
| AS | `HistoryPanel.vue` | select/load 可重入，后到的响应覆盖先到的 | 双令牌 token 校验 + diffLoading 指示 |
| AT | `SourceControl.vue` | load 自相重入；三处 `catch{}` 静默吞误差；空提交信息静默 return | statusToken 令牌；extras/tags/hunk 误差可见化；空提交信息给明确报错 |
| AU | `DebugPanel.vue` | 变量树写死两级，孙子节点点不动；线程/堆栈/变量空态一律"停止时在此显示"；evaluate 只画字符串 | path-keyed 扁平化递归模型（12 层上限 + 循环引用保护）+ 键盘可达；三个提示按状态区分；evaluate 结果带 `variablesReference` 并渲染成可展开树 |
| AV | `MarkdownPreview.vue` + `markdown.ts` | `[x](javascript:alert(1))` 原样生成 href（XSS）；相对链接目标正则在第一个 `)` 截断；相对图片/链接必然是死的 | `basePath` 解析成工作区相对路径；非 http(s)/mailto 的 scheme 一律降级成纯文本；目标正则支持一层成对括号；图片走 `file.readBinary` 换成 `<img>`；相对链接 emit `open`。顺带修了组件用的 5 个 CSS 变量在 tokens.css 里根本不存在 |
| AW | `bridge.ts` `applyDapEvent` | `exited`/`progress`/`module`/`loadedSource`/`breakpoint`/`thread` 六类事件全被静默丢弃 | 六类全部接入；progress 的 start→update→end 全周期（含无 id 时的合成键/最新行策略）；module/loadedSource 按 reason 增删改与去重；`breakpoint` 覆盖 `dapBreakpoints`（编辑器 gutter 的数据源）；未知事件仍然什么都不做（有测试锁死） |
| AX | `DebugPanel.vue` | AW 进 state 但 UI 不渲染 | 进度条（percentage 为 null 时画不确定态，不画假的 0%/100%）、模块/已加载源文件可折叠列表、退出码徽标（0 与非 0 分色，与 `terminated` 区分） |
| AY | `SearchPanel.vue` | 替换撞上限时仍提示"已替换 N 处" | 新增 `incompleteNote()`，`skippedFiles>0` 或 `truncated` 时显示"⚠ 替换不完整：有 N 个勾选的文件因扫描上限未被处理" |
| AZ | `App.vue` 安全删除弹窗 | 把全工作区文本扫描渲染得像精确引用分析；空列表会让用户以为"没有引用=可安全删" | 加 `scope`/`kind` 说明条（含"这不代表没有引用"），`truncated` 时提示已截断 |
| BA | `App.vue` | 关闭标签页时草稿丢失风险（1.5s 防抖未取消） | 标签数减少时取消防抖并立刻写会话快照 |

---

## 二、改动清单（按文件）

**原生（C++）**
- `native/main.cpp` — git.* 工作线程化（`run_request` 拆出 + `is_git_method()` 36 项白名单 + `git_thread`/`queue_git_request`/`git_worker`/`queue_git_reply`/`drain_git`/`stop_git` + `WM_APP+8`）；watcher 自动重启（`on_stopped` + `WM_APP+9` + `handle_watch_stopped`）；DAP 反向请求钩子；`stop_dap()`；`run_in_terminal`/`start_nested_debug`；`lsp->set_edit_sink`；`terminal_cols/rows`；插件分派；运行配置 beforeLaunch 链；`run.output` 改 `dataB64`
- `native/git.cpp` / `git.hpp` — 有界等待 + watchdog + Job Object + `request_cancel()`；CreatePipe 泄漏；`checked_new_name` 与 8 处参数注入校验
- `native/search.cpp` / `search.hpp` — 取消机制（`Options::cancelled`）、4 处 `complete` 读取、`skippedFiles`
- `native/workspace.cpp` / `workspace.hpp` — 只读位四处、u8string、`usages_of` 范围标注与上限
- `native/session.cpp` — `clear` 真实结果
- `native/plugins.cpp` — 删不可达语句
- `native/watcher.cpp` / `watcher.hpp` — `on_stopped`/`stop_reason`、四条原因、栈上 OVERLAPPED、`to_json` 保留为单一实现
- `native/runner.cpp` / `runner.hpp` — `Chunk{bytes,dataB64,text}`、`process_id()`
- `native/terminal.cpp` / `terminal.hpp` — `on_exit`/`reap_zombies`
- `native/lsp.cpp` `lsp_host.cpp` `lsp_session.cpp` `dap.cpp` — A–J 十项
- `native/git_clone.cpp` — `long_text()`、句柄共享标志与重试
- `native/projects.cpp` — 临时文件兜底删除、`deleteToTrash` 进默认值与校验白名单、导出 `editor_defaults()`
- `CMakeLists.txt` — 新增 `taocode_plugins`

**前端**
- `src/bridge.ts` — DAP 六类事件、`SearchReplaceResult.skippedFiles`、`UsageResult.scope/kind`、`runDecoder` + `dataB64` 流式解码、`term.exit`/`lsp.edited`/`fs.watchStopped` 事件、`runStartParams`、`remaining`/`aborted`
- `src/App.vue` — 运行配置全量编辑器（program/args/cwd/env/beforeLaunch）、构建输出可跳转（三种编译器格式）、安全删除引用列表 + 扫描范围说明、`formatOnSave` 真实格式化、`deleteToTrash` 持久化、`openBinary`、插件/worktree/submodule/文件历史四个对话框、关闭标签页快照
- `src/components/` — `BinaryViewer.vue`（新建）、`TerminalPanel.vue`（重写，xterm 搜索 + term.exit + 回收）、`DebugPanel.vue`（变量树 + 进度/模块/源文件/退出码）、`CodeEditor.vue`、`SearchPanel.vue`、`TodoPanel.vue`、`DiffView.vue`、`VcsLog.vue`、`SettingsDialog.vue`、`ProjectStructurePane.vue`、`ProjectDialog.vue`、`TemplateSettingsPage.vue`、`WelcomePage.vue`、`FileTree.vue`、`HistoryPanel.vue`、`OutlinePanel.vue`、`BookmarksPanel.vue`、`SourceControl.vue`、`MarkdownPreview.vue`
- `src/markdown.ts` — basePath 解析 + scheme 白名单 + 目标正则
- `src/style.css` — 上述新 UI 的样式
- `tests/` — 前端 101 → 112 项

---

## 三、编译与冒烟验证

### 命令（可直接复现）

```bash
# 原生（MSVC + ninja，脚本内含 SDK 路径与互斥锁）
python -c "import subprocess;print(subprocess.run(['cmd','/c',r'D:\TaoCode\scripts\build-native-locked.bat'],capture_output=True,text=True).returncode)"

# 原生测试
cd /d/TaoCode/build && "C:/Program Files/Microsoft Visual Studio/18/Enterprise/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/ctest.exe" --output-on-failure

# 前端
cd /d/TaoCode && npx vue-tsc --noEmit -p tsconfig.json
cd /d/TaoCode && npm test
cd /d/TaoCode && npx vite build --emptyOutDir false

# 启动冒烟
cd /d/TaoCode/build && (./TaoCode.exe &); sleep 10; tasklist | grep -i taocode; taskkill //IM TaoCode.exe //F
```

### ctest 17 项（最终一轮，172.78s，100% passed）

`workspace_safety` 51.6s · `projects_lifecycle` 52.9s · `git_clone_lifecycle` 7.5s · `lsp_codec` · `lsp_host_e2e` ·
`lsp_session_e2e` · `lsp_semantics` · `lsp_coding` · `lsp_real_server` · `runner_console` · `git_status_vcs` ·
`find_in_files` · `dap_client` · `terminal_conpty` · `local_history` · `crash_recovery_session` · `file_watcher`

### 每条核心链路的验证方式

| 链路 | 怎么验证它真的通了 |
|---|---|
| 项目打开 / 文件树 | `workspace_safety` + `projects_lifecycle`；UI 打开项目后 `fs.changed` 刷新 |
| 文件读写 / 原子保存 | `workspace_safety`；`projects_lifecycle` 中"失败保存必须清掉自己的临时文件" |
| Git 状态 / 提交 / 分支 | `git_status_vcs`（含 checkout/create_branch/merge/cherry_pick/tag 的参数注入断言） |
| 克隆 | `git_clone_lifecycle`（基线 401s/10 失败 → 现在 7.5s 通过） |
| LSP 握手 / 语义 / 编码辅助 | `lsp_codec` + `lsp_host_e2e` + `lsp_session_e2e` + `lsp_semantics` + `lsp_coding` + `lsp_real_server`；超时场景由新增的"服务器永不回答必须超时"断言覆盖 |
| DAP 会话 | `dap_client`（新增超时、事件整形、反向请求三个场景） |
| 运行 / 构建 | `runner_console`；UI 上构建输出可点击跳转到 `file:line:col` |
| 终端 | `terminal_conpty`；`term.exit` 事件与槽位回收 |
| 文件监听 | `file_watcher`；删掉被监听目录会触发 `fs.watchStopped{restarting:true}` |
| 搜索 / 替换 | `find_in_files`；勾选替换撞上限时 UI 显示 `skippedFiles` |
| 本地历史 / 崩溃恢复 | `local_history` + `crash_recovery_session` |
| 端到端（桌面） | 运行 `build\TaoCode.exe`，进程稳定存活、可干净终止 |

---

## 四、遗留与环境限制（如实说明）

1. **IDEA 源码参照程度**：本轮以"消灭假逻辑 + 让每条链路端到端真实可用"为目标，逐条对齐 IDEA 的行为细节（PSI、索引、重构语义）属于更大规模改造，未在本轮完成。
2. **Zcode 集成**：按约定属于第二阶段，未开始。
3. **环境限制（不是代码问题）**：
   - `reg.exe` 被沙箱拉黑 → `vcvarsall.bat` 读不到 Windows SDK，构建脚本手工追加了 `10.0.26100.0` 的 Include/Lib 路径。
   - `vite build` 清空 `dist/` 会触发沙箱批量删除保护（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 50/轮），需改用 `--emptyOutDir false`。
   - 启动冒烟只验证"能启动、稳定存活、可干净终止"，未做 UI 自动化点击（需要 WebView2 自动化驱动，本轮未引入）。
4. **未做的一项**：`git.amend` / `git.restore` / `git.remotes` / `git.stashDrop` 这四个名字历史上只存在于文档/设想中，全库（含 `src/`）零命中，已从宿主白名单摘除而非新增实现——避免为了"看起来完整"造一层空壳。
