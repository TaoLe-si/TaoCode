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
add_library(taocode_workspace native/workspace.cpp native/window_state.cpp native/dialogs.cpp native/export_file.cpp)
target_include_directories(taocode_workspace PUBLIC native)
target_link_libraries(taocode_workspace PUBLIC nlohmann_json::nlohmann_json bcrypt)

add_library(taocode_projects native/projects.cpp native/project_settings_state.cpp native/project_file_colors.cpp native/settings_schema.cpp native/folding_state_schema.cpp native/git_clone.cpp native/git.cpp
                             native/settings_transfer.cpp native/git_log.cpp)
target_link_libraries(taocode_projects PUBLIC taocode_workspace taocode_history xmllite shlwapi ole32)

add_library(taocode_lsp native/lsp.cpp native/lsp_host.cpp native/lsp_session.cpp
                           native/lsp_support.cpp native/lsp_capability_queries.cpp native/lsp_discovery.cpp
                           native/lsp_code_actions.cpp native/jdtls.cpp native/lsp_config.cpp native/request_trace.cpp native/lsp_host_bootstrap.cpp native/lsp_worker.cpp native/lsp_session_progress.cpp native/lsp_recover.cpp)
# lsp_config 要把项目的 `java` 设置喂给 Java 服务器（补全偏好、sourceLevel…），
# 那是 `java_lsp_settings`（native/projects.cpp）—— 依赖是单向的，不成环。
target_link_libraries(taocode_lsp PUBLIC taocode_workspace taocode_projects)

add_library(taocode_runner native/runner.cpp native/run_host.cpp)
target_link_libraries(taocode_runner PUBLIC taocode_workspace)

add_library(taocode_search native/search.cpp)
target_link_libraries(taocode_search PUBLIC taocode_workspace)

add_library(taocode_dap native/dap.cpp)
target_link_libraries(taocode_dap PUBLIC taocode_workspace)

add_library(taocode_terminal native/terminal.cpp)
target_link_libraries(taocode_terminal PUBLIC taocode_workspace)

add_library(taocode_history native/history.cpp)
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

# diagnostics（日志文件 / 特殊目录 / 排障信息）—— IDEA `com.intellij.diagnostic` 的对应物。
add_library(taocode_diagnostics native/diagnostics.cpp native/zipstore.cpp)
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

add_executable(TaoCode WIN32 native/main.cpp)
target_include_directories(TaoCode PRIVATE "${WEBVIEW2_SDK}/build/native/include")
target_link_libraries(TaoCode PRIVATE taocode_projects taocode_lsp taocode_runner taocode_search taocode_dap taocode_terminal taocode_history taocode_session taocode_watcher taocode_plugins taocode_jdk taocode_diagnostics taocode_events taocode_gradle "${WEBVIEW2_SDK}/build/native/x64/WebView2LoaderStatic.lib" ole32 oleaut32 user32 shell32 shlwapi version dwmapi)
target_link_options(TaoCode PRIVATE "/MANIFEST:EMBED" "/MANIFESTINPUT:${CMAKE_SOURCE_DIR}/native/app.manifest")
add_custom_target(taocode_ui ALL
  COMMAND ${CMAKE_COMMAND} -E remove_directory "$<TARGET_FILE_DIR:TaoCode>/ui"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_SOURCE_DIR}/dist" "$<TARGET_FILE_DIR:TaoCode>/ui")
add_dependencies(taocode_ui TaoCode)

enable_testing()
add_executable(workspace_test native/workspace_test.cpp)
target_link_libraries(workspace_test PRIVATE taocode_workspace)
add_test(NAME workspace_safety COMMAND workspace_test)
add_executable(projects_test native/projects_test.cpp)
target_link_libraries(projects_test PRIVATE taocode_projects)
add_test(NAME projects_lifecycle COMMAND projects_test)
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
add_executable(terminal_test native/terminal_test.cpp)
target_link_libraries(terminal_test PRIVATE taocode_terminal)
add_test(NAME terminal_conpty COMMAND terminal_test)
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
# JDT LS 的启动规格（Equinox + IDE 自带 JRE，与项目 Java 版本无关）。
add_executable(jdtls_test native/jdtls_test.cpp)
target_link_libraries(jdtls_test PRIVATE taocode_lsp)
add_test(NAME jdtls_launch_spec COMMAND jdtls_test)
