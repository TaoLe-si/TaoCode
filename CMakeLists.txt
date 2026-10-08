cmake_minimum_required(VERSION 3.24)
project(TaoCode VERSION 0.1.0 LANGUAGES CXX)

if(NOT WIN32 OR NOT MSVC)
  message(FATAL_ERROR "The initial native host requires Windows and MSVC.")
endif()
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_compile_options(/W4 /utf-8 /EHsc)
add_compile_definitions(UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)

include(FetchContent)
set(JSON_BuildTests OFF CACHE INTERNAL "")
if(EXISTS "${CMAKE_SOURCE_DIR}/.tools/json.tar.xz")
  set(JSON_SOURCE "${CMAKE_SOURCE_DIR}/.tools/json.tar.xz")
else()
  set(JSON_SOURCE "https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz")
endif()
FetchContent_Declare(json URL "${JSON_SOURCE}" URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(json)

set(WEBVIEW2_SDK "$ENV{USERPROFILE}/.nuget/packages/microsoft.web.webview2/1.0.4191.47" CACHE PATH "WebView2 NuGet package root")
if(NOT EXISTS "${WEBVIEW2_SDK}/build/native/include/WebView2.h")
  message(FATAL_ERROR "WebView2 SDK not found. Set -DWEBVIEW2_SDK to the extracted NuGet package.")
endif()

# window_state（全屏等窗口态）放在这个库里：它同样只依赖 Win32 + json，
# 而且 workspace_test 要能直接测它（加在可执行目标上就链接不到）。
add_library(taocode_workspace native/workspace.cpp native/workspace_tree_ops.cpp native/workspace_templates.cpp native/window_state.cpp native/dialogs.cpp native/export_file.cpp native/file_queries.cpp)
target_include_directories(taocode_workspace PUBLIC native)
target_link_libraries(taocode_workspace PUBLIC nlohmann_json::nlohmann_json bcrypt)

add_library(taocode_projects native/projects.cpp native/java_lsp_paths.cpp native/project_settings_state.cpp native/project_file_colors.cpp native/settings_schema.cpp native/settings_project_schema.cpp native/folding_state_schema.cpp native/trusted_paths.cpp native/git_clone.cpp native/git.cpp
                             native/settings_transfer.cpp native/git_log.cpp native/git_worktree.cpp native/git_hunks.cpp)
target_link_libraries(taocode_projects PUBLIC taocode_workspace taocode_history xmllite shlwapi ole32)

add_library(taocode_lsp native/lsp.cpp native/lsp_host.cpp native/lsp_session.cpp
                           native/lsp_support.cpp native/lsp_capability_queries.cpp native/lsp_discovery.cpp
                           native/lsp_code_actions.cpp native/jdtls.cpp native/lsp_config.cpp native/request_trace.cpp native/lsp_host_bootstrap.cpp native/lsp_worker.cpp native/lsp_session_progress.cpp native/lsp_recover.cpp native/lsp_children.cpp native/lsp_navigation.cpp native/lsp_session_kinds.cpp native/library_sources.cpp)
# lsp_config 要把项目的 `java` 设置喂给 Java 服务器（补全偏好、sourceLevel…），
# 那是 `java_lsp_settings`（native/projects.cpp）—— 依赖是单向的，不成环。
target_link_libraries(taocode_lsp PUBLIC taocode_workspace taocode_projects)

add_library(taocode_runner native/runner.cpp native/run_host.cpp)
# iphlpapi：run_host 的 `run.instances` 用 GetExtendedTcpTable 列出实例进程树的监听端口
# （上游 execution/portsWatcher 的可见等价物，前端在 Run 控制台「进程」区显示）。
target_link_libraries(taocode_runner PUBLIC taocode_workspace iphlpapi)

add_library(taocode_search native/search.cpp)
target_link_libraries(taocode_search PUBLIC taocode_workspace)

# 按职责拆文件（三个都是同一个道理：一个文件一个职责域，见 tests/module-size.test.mjs）：
#   dap.cpp          —— 会话 / 管道 / reader / 请求的构造与发信
#   dap_inspect.cpp  —— 「清单重取 / 反向调试 / 内存与反汇编」这一族请求
#   dap_values.cpp   —— 「取值 / 补全 / 断点位置 / 数据与函数断点 / source」这一族请求
#   dap_shaping.cpp  —— 响应整形（事件 / 栈帧 / 作用域 / 变量 / 异常 / 断点 / 补全 / 运行到光标处）
#   dap_routes.cpp   —— 桥接层的 `dap.*` 分派（从 main.cpp 抽出，那边有 2000 行硬上限）
add_library(taocode_dap native/dap.cpp native/dap_inspect.cpp native/dap_values.cpp native/dap_shaping.cpp native/dap_routes.cpp)
target_link_libraries(taocode_dap PUBLIC taocode_workspace)

add_library(taocode_terminal native/terminal.cpp native/terminal_bell.cpp)
target_link_libraries(taocode_terminal PUBLIC taocode_workspace)

# history.cpp 管本地历史的快照落盘/版本索引/指纹；history_diff.cpp 管「行级 unified diff 脚本」
# （切行 → 出脚本 → 渲染 @@ 块），它不碰目录、句柄与索引，是一个独立的算法域
# （2026-10-05 拆出，history.cpp 贴着 1050 行机检上限；见 tests/module-size.test.mjs）。
# history_sides.cpp 管「并排差异」（脚本 → 左右对齐行 + 词级标注），同样只吃 Row 与 split_lines
# （2026-10-06 拆出：history.cpp 加「按天过期」后回到 934 行，又贴着 910 上限）。
add_library(taocode_history native/history.cpp native/history_diff.cpp native/history_sides.cpp)
target_link_libraries(taocode_history PUBLIC taocode_workspace)

add_library(taocode_session native/session.cpp)
target_link_libraries(taocode_session PUBLIC taocode_workspace)

add_library(taocode_watcher native/watcher.cpp)
target_link_libraries(taocode_watcher PUBLIC taocode_workspace)

add_library(taocode_plugins native/plugins.cpp)
target_link_libraries(taocode_plugins PUBLIC taocode_workspace)

# jdk（机器上已安装的 JDK 探测）—— IDEA `JavaHomeFinderBasic` 的对应物。
# 「IDEA 打开 Java/Gradle 项目时默认就有 JDK」这件事的来源就是它。
add_library(taocode_jdk native/jdk.cpp)
target_link_libraries(taocode_jdk PUBLIC taocode_workspace)

# diagnostics（日志文件 / 特殊目录 / 排障信息 / 崩溃现场 / 线程转储）—— IDEA `com.intellij.diagnostic` 的对应物。
# thread_dump.cpp 是"进程活着时按需抓全部线程的栈"（StackWalk64），与 crash_log.cpp 的
# "崩溃那一刻的现场"（terminate/SEH 钩子 + minidump）触发时机与用途都不同，故分两个文件。
add_library(taocode_diagnostics native/diagnostics.cpp native/zipstore.cpp native/crash_log.cpp native/thread_dump.cpp)
target_include_directories(taocode_diagnostics PUBLIC native)
target_link_libraries(taocode_diagnostics PUBLIC taocode_workspace taocode_jdk shell32 ole32)
# settings_transfer（在 taocode_projects 里）要用 zipstore 打包设置归档。写在 diagnostics 定义**之后**：
# CMake 里 target_link_libraries 引用一个还没定义的目标名，会被当成 `-lxxx` 去找库文件。
target_link_libraries(taocode_projects PUBLIC taocode_diagnostics)

# event_channel（后台线程 → UI 线程的事件队列）—— 九个域里逐字相同的那段入队/换出逻辑收成一份。
add_library(taocode_events native/event_channel.cpp)
target_link_libraries(taocode_events PUBLIC taocode_workspace)

# gradle（宿主侧：识别项目 + 跑一条同步命令并把输出推回）—— IDEA Gradle 插件的对应物。
add_library(taocode_gradle native/gradle.cpp)
target_link_libraries(taocode_gradle PUBLIC taocode_workspace taocode_runner)

add_executable(TaoCode WIN32 native/main.cpp native/git_routes.cpp native/embedded_browser_profile.cpp native/agent_skills.cpp native/agent_memory.cpp native/mcp_client.cpp native/system_date_format.cpp native/app-icon.rc)
# 图标这一条**必须显式声明额外依赖**：`.rc` 里写的是 `ICON "app-icon.ico"`，
# 而生成器 `scripts/gen-app-icon.mjs` 写的是 `native/app-icon.ico`（它不在任何源文件列表里）。
# CMake 不知道这条隐式依赖 ⇒ 改了 `src/assets/app-icon.png` 重新生成 `.ico` 之后，
# ninja 看 `.rc` 没动就不重跑 rc.exe，链接出来的 exe **继续嵌旧图标**。
# 这不是假想：本仓 2026-10-07 出现过「设计好了花体 T，exe 上还是旧图标」，
# 当时的绕过办法是手工 `touch native/app-icon.rc` —— 那是治标，这里改成治本。
# OBJECT_DEPENDS 是 CMake 给「源文件依赖了一个它看不见的文件」的正规做法。
set_source_files_properties(native/app-icon.rc PROPERTIES OBJECT_DEPENDS "${CMAKE_SOURCE_DIR}/native/app-icon.ico")
target_include_directories(TaoCode PRIVATE "${WEBVIEW2_SDK}/build/native/include")
target_link_libraries(TaoCode PRIVATE taocode_projects taocode_lsp taocode_runner taocode_search taocode_dap taocode_terminal taocode_history taocode_session taocode_watcher taocode_plugins taocode_jdk taocode_diagnostics taocode_events taocode_gradle taocode_http "${WEBVIEW2_SDK}/build/native/x64/WebView2LoaderStatic.lib" ole32 oleaut32 user32 shell32 shlwapi version dwmapi)
target_link_options(TaoCode PRIVATE "/MANIFEST:EMBED" "/MANIFESTINPUT:${CMAKE_SOURCE_DIR}/native/app.manifest")
add_custom_target(taocode_ui ALL
  COMMAND ${CMAKE_COMMAND} -E remove_directory "$<TARGET_FILE_DIR:TaoCode>/ui"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_SOURCE_DIR}/dist" "$<TARGET_FILE_DIR:TaoCode>/ui")
add_dependencies(taocode_ui TaoCode)

add_library(taocode_http native/http_client.cpp)
# winhttp：系统自带的 HTTP 服务型 API（超时四档可分别设、不继承 IE 缓存）。
# 只依赖 workspace.hpp 的 Json/WorkspaceError，不碰 VFS 也不碰 git。
target_link_libraries(taocode_http PUBLIC taocode_workspace winhttp)

enable_testing()
add_executable(workspace_test native/workspace_test.cpp)
target_link_libraries(workspace_test PRIVATE taocode_workspace)
add_test(NAME workspace_safety COMMAND workspace_test)
# HTTP GET 通道的边界回归（协议白名单 / 参数校验 / 网络失败如实回 reason）。不联网：
# 见 native/http_client_test.cpp 的文件头。
add_executable(http_client_test native/http_client_test.cpp)
target_link_libraries(http_client_test PRIVATE taocode_http)
add_test(NAME http_client_contract COMMAND http_client_test)
add_executable(projects_test native/projects_test.cpp)
target_link_libraries(projects_test PRIVATE taocode_projects)
add_test(NAME projects_lifecycle COMMAND projects_test)
# 「解析外部」那条线（类路径 / 源根 / Eclipse 工程物化）单独一个目标：它在 projects.cpp 那条
# 项目层回归之外有自己的夹具形状（多子工程工作区 vs 单模块工程），判据见源文件头。
add_executable(java_lsp_paths_test native/java_lsp_paths_test.cpp)
target_link_libraries(java_lsp_paths_test PRIVATE taocode_projects)
add_test(NAME java_lsp_paths COMMAND java_lsp_paths_test)
# 文件颜色是独立模块（.idea 两层 XML + 自己的回滚/失败码），回归单独一个目标；
# 共用夹具在 native/project_test_support.hpp。
add_executable(project_file_colors_test native/project_file_colors_test.cpp)
target_link_libraries(project_file_colors_test PRIVATE taocode_projects)
add_test(NAME project_file_colors COMMAND project_file_colors_test)
add_executable(folding_state_test native/folding_state_test.cpp)
target_link_libraries(folding_state_test PRIVATE taocode_projects)
add_test(NAME folding_state COMMAND folding_state_test)
add_executable(git_clone_test native/git_clone_test.cpp)
target_link_libraries(git_clone_test PRIVATE taocode_projects)
add_test(NAME git_clone_lifecycle COMMAND git_clone_test)
add_executable(lsp_test native/lsp_test.cpp)
target_link_libraries(lsp_test PRIVATE taocode_lsp)
add_test(NAME lsp_codec COMMAND lsp_test)
# 假服务器按职责拆成三个源文件（主循环 / helper+状态 / 请求分派）—— 见 native/lsp_fake_server.hpp。
add_executable(lsp_fake_server
    native/lsp_fake_server.cpp
    native/lsp_fake_server_support.cpp
    native/lsp_fake_server_requests.cpp)
target_link_libraries(lsp_fake_server PRIVATE taocode_lsp)
add_executable(lsp_host_test native/lsp_host_test.cpp)
target_link_libraries(lsp_host_test PRIVATE taocode_lsp)
add_dependencies(lsp_host_test lsp_fake_server)
add_test(NAME lsp_host_e2e COMMAND lsp_host_test)
add_executable(lsp_session_test native/lsp_session_test.cpp)
target_link_libraries(lsp_session_test PRIVATE taocode_lsp)
add_dependencies(lsp_session_test lsp_fake_server)
add_test(NAME lsp_session_e2e COMMAND lsp_session_test)
add_executable(lsp_semantics_test native/lsp_semantics_test.cpp)
target_link_libraries(lsp_semantics_test PRIVATE taocode_lsp)
add_dependencies(lsp_semantics_test lsp_fake_server)
add_test(NAME lsp_semantics COMMAND lsp_semantics_test)
# 剩下每一族的整形与门控（foldingRange / moniker / codeLens / inlineCompletion /
# documentLink / semanticTokens 三条路 / completion→resolve / pull 诊断 full+unchanged /
# prepareRename / workspaceDiagnostic）。见 native/lsp_kinds_test.cpp 开头的来龙去脉。
add_executable(lsp_worker_test native/lsp_worker_test.cpp)
target_link_libraries(lsp_worker_test PRIVATE taocode_lsp)
add_test(NAME lsp_worker_thread COMMAND lsp_worker_test)

# 弃养一代会话时按代号回收它起的服务器进程（真机上漏一次就多留一台 1GB 的 JVM）。
add_executable(lsp_children_test native/lsp_children_test.cpp)
target_link_libraries(lsp_children_test PRIVATE taocode_lsp)
add_test(NAME lsp_children_generation COMMAND lsp_children_test)

add_executable(lsp_kinds_test native/lsp_kinds_test.cpp)
target_link_libraries(lsp_kinds_test PRIVATE taocode_lsp)
add_dependencies(lsp_kinds_test lsp_fake_server)
add_test(NAME lsp_kinds COMMAND lsp_kinds_test)
add_executable(lsp_coding_test native/lsp_coding_test.cpp)
target_link_libraries(lsp_coding_test PRIVATE taocode_lsp)
add_dependencies(lsp_coding_test lsp_fake_server)
add_test(NAME lsp_coding COMMAND lsp_coding_test)
add_executable(lsp_real_test native/lsp_real_test.cpp)
target_link_libraries(lsp_real_test PRIVATE taocode_lsp)
# 诊断探针（不进 ctest）：用生产 resolve_servers 拉起内置 JDT LS 并打印线上事实。
add_executable(jdtls_probe native/jdtls_probe.cpp)
target_link_libraries(jdtls_probe PRIVATE taocode_lsp)
add_test(NAME lsp_real_server COMMAND lsp_real_test)
set_tests_properties(lsp_real_server PROPERTIES ENVIRONMENT "TAOCODE_LSP_REAL=0")
add_executable(runner_test native/runner_test.cpp)
target_link_libraries(runner_test PRIVATE taocode_runner)
add_test(NAME runner_console COMMAND runner_test)
add_executable(git_test native/git_test.cpp)
target_link_libraries(git_test PRIVATE taocode_projects)
add_test(NAME git_status_vcs COMMAND git_test)
add_executable(search_test native/search_test.cpp)
target_link_libraries(search_test PRIVATE taocode_search)
add_test(NAME find_in_files COMMAND search_test)
add_executable(dap_fake_adapter native/dap_fake_adapter.cpp)
target_link_libraries(dap_fake_adapter PRIVATE taocode_workspace)
add_executable(dap_test native/dap_test.cpp)
target_link_libraries(dap_test PRIVATE taocode_dap)
add_dependencies(dap_test dap_fake_adapter)
add_test(NAME dap_client COMMAND dap_test)
# 取值族（分页/求值）与第二批协议请求族（数据断点/函数断点/source）的判据单独成文件：
# dap_test.cpp 贴着 tests/module-size.test.mjs 的 1300 行测试上限（2026-10-06 拆出）。
add_executable(dap_values_test native/dap_values_test.cpp)
target_link_libraries(dap_values_test PRIVATE taocode_dap)
add_dependencies(dap_values_test dap_fake_adapter)
add_test(NAME dap_values COMMAND dap_values_test)
add_executable(terminal_test native/terminal_test.cpp)
target_link_libraries(terminal_test PRIVATE taocode_terminal)
add_test(NAME terminal_conpty COMMAND terminal_test)
# 响铃扫描器是纯字节状态机，不碰 ConPTY，所以判据也不碰 shell（时间、机器、ConPTY
# 可用性都不该是"响铃有没有被认出来"的变量）。
add_executable(terminal_bell_test native/terminal_bell_test.cpp native/terminal_bell.cpp)
add_test(NAME terminal_bell_scan COMMAND terminal_bell_test)
add_executable(history_test native/history_test.cpp)
target_link_libraries(history_test PRIVATE taocode_history)
add_test(NAME local_history COMMAND history_test)
add_executable(session_test native/session_test.cpp)
target_link_libraries(session_test PRIVATE taocode_session)
add_test(NAME crash_recovery_session COMMAND session_test)
add_executable(watcher_test native/watcher_test.cpp)
target_link_libraries(watcher_test PRIVATE taocode_watcher)
add_test(NAME file_watcher COMMAND watcher_test)

add_executable(diagnostics_test native/diagnostics_test.cpp)
target_link_libraries(diagnostics_test PRIVATE taocode_diagnostics)
add_test(NAME diagnostics_support COMMAND diagnostics_test)

add_executable(zipstore_test native/zipstore_test.cpp)
target_link_libraries(zipstore_test PRIVATE taocode_diagnostics)
add_test(NAME zipstore_archive COMMAND zipstore_test)

add_executable(event_channel_test native/event_channel_test.cpp)
target_link_libraries(event_channel_test PRIVATE taocode_events)
add_test(NAME event_channel_queue COMMAND event_channel_test)

add_executable(gradle_test native/gradle_test.cpp)
target_link_libraries(gradle_test PRIVATE taocode_gradle)
add_test(NAME gradle_support COMMAND gradle_test)

add_executable(dialogs_test native/dialogs_test.cpp)
target_link_libraries(dialogs_test PRIVATE taocode_workspace)
add_test(NAME file_dialogs COMMAND dialogs_test)

add_executable(settings_transfer_test native/settings_transfer_test.cpp)
target_link_libraries(settings_transfer_test PRIVATE taocode_projects)
add_test(NAME settings_export_import COMMAND settings_transfer_test)

# 编辑器设置里**非布尔那几键**的校验分支（native/settings_editor_keys.hpp）：Code Vision 的两个组集合
# 与每锚点条数的界。桌面上真正的闸在这里（src/previewSettings.ts 只是预览态的第二道关卡），
# 而判据不能只留在 JS：右键「隐藏这一组」直接写运行时表、不查白名单，白名单少列一组会让整本
# 编辑器设置在读盘时被判 INVALID_SETTINGS。链接的库与上面那条同一份（settings_schema.cpp 在
# taocode_projects 里）。
add_executable(settings_editor_keys_test native/settings_editor_keys_test.cpp)
target_link_libraries(settings_editor_keys_test PRIVATE taocode_projects)
add_test(NAME settings_editor_key_bounds COMMAND settings_editor_keys_test)

add_executable(export_file_test native/export_file_test.cpp)
target_link_libraries(export_file_test PRIVATE taocode_workspace)
add_test(NAME export_file_write COMMAND export_file_test)

add_executable(run_host_test native/run_host_test.cpp)
target_link_libraries(run_host_test PRIVATE taocode_runner)
add_test(NAME run_host_instances COMMAND run_host_test)

add_executable(plugins_test native/plugins_test.cpp)
target_link_libraries(plugins_test PRIVATE taocode_plugins taocode_diagnostics)
add_test(NAME plugin_management COMMAND plugins_test)

add_executable(jdk_test native/jdk_test.cpp)
target_link_libraries(jdk_test PRIVATE taocode_jdk)
add_test(NAME jdk_detection COMMAND jdk_test)
# 语言服务器的自动发现：装了 clangd / jdtls 就该被找到，不必手写 TaoCode.lsp.json。
add_executable(lsp_discovery_test native/lsp_discovery_test.cpp)
target_link_libraries(lsp_discovery_test PRIVATE taocode_lsp)
add_test(NAME lsp_server_discovery COMMAND lsp_discovery_test)
# TaoCode.lsp.json 的读取契约（用户自定义服务器的唯一入口；真机取证时正是这里静默失效）。
add_executable(lsp_config_test native/lsp_config_test.cpp)
target_link_libraries(lsp_config_test PRIVATE taocode_lsp)
add_test(NAME lsp_config_file COMMAND lsp_config_test)
# 「库类型的源码」：全限定名 → *-sources.jar 里的 .java（JDT 对库类型不给 definition 位置的等价物）。
add_executable(library_sources_test native/library_sources_test.cpp)
target_link_libraries(library_sources_test PRIVATE taocode_lsp taocode_diagnostics)
add_test(NAME library_sources COMMAND library_sources_test)
# JDT LS 的启动规格（Equinox + IDE 自带 JRE，与项目 Java 版本无关）。
add_executable(jdtls_test native/jdtls_test.cpp)
target_link_libraries(jdtls_test PRIVATE taocode_lsp)
add_test(NAME jdtls_launch_spec COMMAND jdtls_test)

# ---- batch-2026-10-06-mcpserver：TaoCode MCP 服务端（追加段：本段只新增 target 与测试注册，未动任何既有项）----
# taocode_mcp.exe：stdio JSON-RPC 2.0 的 MCP 服务端，工具全部复用宿主能力
# （Workspace / git / ProjectStore / run_host / Runner —— 见 native/mcp_server.hpp 头注释）。
# 不开网络端口；默认权限档 = src/agent.ts 的 defaultAgentPermissions（write/run 需 --allow-* 显式升档）。
add_library(taocode_mcp_core native/mcp_server.cpp)
target_include_directories(taocode_mcp_core PUBLIC native)
target_link_libraries(taocode_mcp_core PUBLIC taocode_workspace taocode_projects taocode_runner shell32 ole32)
add_executable(taocode_mcp native/mcp_main.cpp)
target_link_libraries(taocode_mcp PRIVATE taocode_mcp_core)
# 离线自测（这是第 39 条测试注册）：管道喂 JSON-RPC 帧验握手→tools/list→只读→权限拒→路径闸→argv 数组化。
# 传 taocode_mcp.exe 的路径给测试：run.start 拿自身 --echo-argv 当 program，证明参数不被 shell 解释。
add_executable(mcp_server_test native/mcp_server_test.cpp)
target_link_libraries(mcp_server_test PRIVATE taocode_mcp_core)
add_dependencies(mcp_server_test taocode_mcp)
add_test(NAME mcp_server_stdio COMMAND mcp_server_test $<TARGET_FILE:taocode_mcp>)
