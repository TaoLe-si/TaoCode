// 模块化是核心设计理念（桃 2026-09-27）：**一个文件 = 一个职责域，防止一堆代码堆砌在一个位置**。
//
// 这个测试把理念变成可执行的约束 —— 光写在文档里没人会看：
//   · 任何 `src/**/*.ts|vue` 超过 DEFAULT_LIMIT（900 行）就是失败信号：说明新功能又被塞进了
//     旧文件，该按职责拆一个新模块了（纯函数 → src/xxx.ts；状态 → src/xxx.ts 自持；
//     需要 ctx → src/menus/xxxMenu.ts 那种工厂）。
//   · 已经很大的文件必须**登记**在这里，并带上限。上限只能靠"顺手拆一次"来下调，
//     不许无声地往上抬 —— 抬数字就是堆砌，只是被记录下来了而已。
//
// 为什么用行数：它是个粗糙但**无法自我欺骗**的指标。复杂度、耦合度都能量化得更漂亮，
// 但只有行数能在 CI 里一句话判死。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 新文件的默认上限。超了就拆模块，而不是抬这个数字。 */
const DEFAULT_LIMIT = 900

/**
 * 原生侧的上限比前端宽松一档：一个分派表或协议整形函数天然会长，而且 `.cpp`/`.hpp` 的
 * 一对多拆分要改 `CMakeLists.txt`（成本比拆 `.ts` 高）。但**上限同样只能靠拆来下调**。
 */
const NATIVE_DEFAULT_LIMIT = 1100

/**
 * 已登记的 native 大文件。2026-09-27 的事故正是这一类文件造成的：
 * `lsp_fake_server.cpp` 762 行里塞了「helper + 能力声明 + 35 个请求分支 + 主循环」，
 * 改一处时锚点不唯一，一次误删了 11 个分支 —— 已按职责拆成 4 个文件（见下表第一行）。
 */
const NATIVE_REGISTERED = new Map([
  ['native/main.cpp', {
    limit: 2000,
    note: 'WebView2 宿主 + 方法分派链（`Method` union 必须与 src/bridge.ts 一一对应，见 routing-parity）。'
      + '新能力请拆 native/xxx.cpp —— 上限跟着拆降（2026-09-27 从 2223 开始：'
      + 'base64 三份重复实现合并进 base64.hpp、utf8/wide 合并进 text.hpp、'
      + '文件夹选择器与图片读取拆到 dialogs.cpp；当天降到 2110；'
      + '接完 Gradle 通道后 2170，再把九个域逐字相同的事件队列收成 native/event_channel.cpp，降到 2091；'
      + '2026-09-27 接 JDK 探测时把 `app.info` 的实现搬进 diagnostics.cpp（净 -3）降到 1940，'
      + '再接 WebView2 环境选项时把 `app.writeExportFiles` 的 JSON 整形搬进 export_file.cpp、导航改用 `ui_url`（删掉不再用的 `app_url` 常量），降到 1938；'
      + '接内置 JDT LS 时把「用哪些语言服务器」合成表的三条来源（TaoCode.lsp.json / PATH 发现 / 内置 JDT LS）'
      + '拆进 native/lsp_config.cpp，降到 1923）；把 `lsp.request` 的两段纯整形（入参整体转发、回参包壳）搬进 lsp_capability_queries.cpp、请求边界追踪搬进 native/request_trace.cpp。2026-09-28 桃定死：**上限固定 2000 行**，新能力一律抽成 native/xxx.cpp，不再逐行抠上限。',
  }],
  ['native/lsp_session.cpp', {
    limit: 475,
    note: 'LSP 会话：门控 + 文档生命周期 + request()/semantic() 两个分派入口。工具与整形已拆到 lsp_support.hpp/.cpp，`Session::ensure()`（起服务器 + initialize + 三个回调 + 补发 didOpen，228 行）拆到 native/lsp_host_bootstrap.cpp。'
      + '能力判定拆到 lsp_capability_queries.cpp，代码操作一族拆到 lsp_code_actions.cpp。'
      + '2026-10-05 把 `semantic()` 门控之后的**每个 kind 怎么发、怎么整形**那整条 if 链'
      + '（`position` / `relative` 两个局部量 + 约 30 个 kind + 末尾的 LSP_BAD_KIND 兜底，594 行）'
      + '整段搬进 native/lsp_session_kinds.cpp（新的 `Session::dispatch_semantic_kind`，void 返回，'
      + 'host/uri/language_name 由门控算好后传入）—— 本文件原来把「门控」与「整形」两件事挤在一起，'
      + '这正是本条登记写的职责。链上每个分支的 `return;` 与全部注释逐字未改。上限 1075 降到 475。',
  }],
  ['native/dap.cpp', {
    limit: 1480,
    note: 'DAP 客户端：会话/管道/reader + 请求的构造与发信 + 回信怎么包（ok 壳 / allThreadsContinuation）。'
      + '2026-10-04 补协议侧三条缺口（loadedSources/modules 按需重取、stepBack/reverseContinue、'
      + 'readMemory/disassemble）时**按请求族拆出 native/dap_inspect.cpp**（请求 + 整形），'
      + 'dap.* 的桥接分派拆到 native/dap_routes.cpp，上限跟着拆降（1800 → 1790）。'
      + '2026-10-05 再把**响应整形族**（shape_event/frames/scopes/variables/exception_info/'
      + 'breakpoint_locations/completions/goto_targets + verified_lines/normalize_breakpoints/'
      + 'requested_lines/breakpoint_messages，317 行）整个搬进 native/dap_shaping.cpp —— '
      + '那一族只管"响应长什么样"，不碰 socket 也不碰状态，搬走后上限 1790 → 1480。'
      + '新请求族、新整形族一律进新文件。',
  }],
  ['native/workspace.cpp', {
    limit: 1385,
    note: '文件系统与工作区操作：读写、编码、新建/改名、回收站、文本引用扫描、'
      + '外部链接与「在资源管理器中显示」。helper 与新域应拆到 fsops/新文件。'
      + '2026-10-05 把「递归遍历一棵树并删除/复制它」（remove_tree / copy_tree，87 行）整个搬进 '
      + 'native/workspace_tree_ops.cpp —— 那一族只做 Win32 目录枚举 + 重解析点拒绝 + 条目预算，'
      + '不读文件内容、不管编码、不碰 Workspace 的状态机，与留在本文件的单文件操作不共一个职责域；'
      + 'fail / win_error / utf8_path / api_path 的**声明**随之搬进 native/workspace_detail.hpp'
      + '（实现仍只有本文件这一份：Win32 错误码映射复制一份就会漂移），上限 1480 降到 1385。',
  }],
  ['native/history.cpp', {
    limit: 910,
    note: '本地历史：快照落盘 / 版本索引 / 指纹 / 并排差异。'
      + '2026-10-05 把「行级 unified diff 脚本」（切行 → LCS 出脚本 → 渲染 @@ 块，117 行）'
      + '连同 diff_cell_budget / diff_context 两个常数搬进 native/history_diff.cpp —— '
      + '那一段不碰目录、句柄与索引，是一个独立的算法域，与留在本文件的并排词级标注'
      + '（tokenize / word_marks / side_rows）只共用 Row 与 split_lines，上限 1050 降到 910。',
  }],
  ['native/git.cpp', {
    limit: 938,
    note: 'Git 只读视图。时间格式化已去重到 native/time_format.hpp（2026-09-27，与 diagnostics 的三份重复实现合并）。'
      + '2026-10-05 把「工作树 + 子模块」一族（worktree list/add/remove + submodule status/update，83 行）'
      + '整段搬进 native/git_worktree.cpp —— 那一族只跑 `git worktree *` / `git submodule *` 并整形它们的 '
      + 'porcelain 输出，与留在本文件的分支/标签/暂存/追溯/文件历史不共一个职责域。'
      + 'run() / Result / require_ok / utf8_to_wide / split_lines / utf8_path 的**声明**随之搬进 '
      + 'native/git_detail.hpp（实现仍只有本文件这一份：job object 与看门狗不能复制到第二个 TU），'
      + '上限 1016 降到 938。',
  }],
  ['native/git_clone.cpp', { limit: 880, note: '克隆流程。' }],
  ['native/projects.cpp', { limit: 950, note: '项目列表与最近项目。' }],
])

/**
 * 已登记的大文件：每个都必须写明**为什么暂时这么大**，以及拆分方向。
 * 上限是"当前行数 + 少量余量"，不是"随便写个大数"。
 */
const REGISTERED = new Map([
  ['src/App.vue', {
    limit: 2737,
    note: '组装层：模板 + 各 ctx 注入 + 事件转发。新增逻辑一律拆 src/xxx.ts，App 里只留一行调用。'
      + '上限跟着拆降（2026-09-27 从 6262 连续拆到 2895）：diff 纯函数、插件/工作树/子模块/文件历史、'
      + '层级视图、设置持久化、包围/模板选择器、书签、磁盘同步、文件树与标签上下文操作、外观动作、'
      + 'LSP 生命周期与导航（含符号搜索）、代码洞察语义动作（onSemantic 分发链）、主菜单栏模型与交互、'
      + '运行/构建/调试/外部工具、全局快捷键分派（keymap）、运行/调试配置、工作区/项目生命周期、'
      + '版本控制动作、编辑器文件级操作（冲突/文档/缩进/行尾/编码）、标签拖放、标签条单行布局、分栏与面板尺寸、生成/重构/文件移动、文件树操作、编辑区分栏与标签页开关、工具窗口命名布局、通知与状态栏键盘导航、编辑器侧视图与项目视图定位。',
  }],
  ['src/components/SettingsDialog.vue', {
    limit: 1182,
    note: '设置树的宿主 + 各页的挂载点。页面本体已在 src/components/*Page.vue（Scopes/TodoPatterns/FileTypes/BuildTools/Gradle…），'
      + '树本身（页面键/分组/节点/随项目保存的页）在 src/settingsTreeMeta.ts —— 上限跟着拆降'
      + '（2026-09-27 接 Gradle 页时从 1450 降到 1380；接标签条排法时把「编辑器标签页」页拆到'
      + 'EditorTabsSettingsPage.vue，降到 1356）。'
      + '2026-10-05 把「设置树搜索」整块（查询历史弹层、DOM 选项扫描、粘贴路径解析、命中过滤、'
      + 'spotlight、方向键顺序、onBeforeUnmount 的收摊）搬进 src/settingsSearchController.ts 的 '
      + 'createSettingsSearch 工厂（它只认「一个查询把树过滤成什么样」一件事），上限 1356 降到 1182。',
  }],
  ['src/bridge.ts', {
    limit: 905,
    note: '桥接的类型与封装（Method/LspRequestKind union 是机检锚点，必须留在这里）。纯逻辑应拆 src/xxx.ts —— '
      + 'base64 拆到 src/base64.ts、Gradle 同步通道拆到 src/gradleEvents.ts、终端订阅表拆到 src/terminalEvents.ts、'
      + '插件清单类型拆到 src/pluginGroups.ts（2026-09-27 从 1450 降到 1208）；'
      + '2026-10-05 把「浏览器预览的内存示例」（previewRequest + 三个内存 Map + 各条 INVALID_SETTINGS 校验）'
      + '整个搬进 src/bridgePreview.ts、错误类型搬进 src/bridgeError.ts（bridge.ts 原样转出），'
      + '上限 1208 降到 905。',
  }],
  ['src/components/CodeEditor.vue', {
    limit: 1147,
    note: 'CodeMirror 宿主。各 LSP 能力的解码/判定已拆 src/semanticTokens.ts、documentLinks.ts、inlineCompletionExtension.ts 等 —— '
      + '上限是拆一次降一次（2026-09-27 从 1250 降到 1220；再把语义着色的颜色表拆到 src/editorSemanticColors.ts、'
      + '追溯注解列的样式并进 src/editorBlameAnnotations.ts，降到 1195）。'
      + '接编辑器内查找栏时又拆两块：空白可视化 → src/editorWhitespace.ts、主题与词法着色 → src/editorTheme.ts，降到 1172；'
      + '接插入/覆盖模式时把轻量信息提示 → src/editorHint.ts（降到 1155）；接合并冲突导航条时把诊断标记与那几条状态扩展拆到 '
      + 'src/editorDiagnosticMarkers.ts / src/editorTheme.ts（降到 1148），后来真机抓到"计数停在旧值"，'
      + '冲突清单改取实时文档、清单与两个动作整个搬进 src/editorMergeHost.ts，降到 1147。',
  }],
])

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|vue|cpp|hpp)$/.test(entry)) out.push(path)
  }
  return out
}

const lineCount = path => readFileSync(path, 'utf8').split('\n').length

test('没有未登记的巨型源文件（超上限就该拆模块）', () => {
  const offenders = []
  for (const path of sourceFiles(join(root, 'src'))) {
    const relative_path = relative(root, path).replace(/\\/g, '/')
    if (REGISTERED.has(relative_path)) continue
    const lines = lineCount(path)
    if (lines > DEFAULT_LIMIT) offenders.push(`${relative_path}(${lines} 行)`)
  }
  assert.deepEqual(offenders, [],
    `这些文件超过 ${DEFAULT_LIMIT} 行且没有登记：${offenders.join('、')}\n` +
    '按职责拆一个新模块（纯逻辑 → src/xxx.ts），不要继续往里堆；确实拆不动就登记进 REGISTERED 并写明原因。')
})

test('已登记的大文件不许继续变大', () => {
  const grown = []
  for (const [path, { limit, note }] of REGISTERED) {
    const lines = lineCount(join(root, path))
    if (lines > limit) grown.push(`${path} 现在 ${lines} 行 > 上限 ${limit}（${note}）`)
  }
  assert.deepEqual(grown, [], grown.join('\n'))
})

test('原生源文件也没有未登记的巨型文件（一个文件一个职责域）', () => {
  // 2026-09-27 的事故就是这一类文件造成的：`lsp_fake_server.cpp` 762 行里塞了四件事，
  // 改一处时锚点不唯一，一次误删了 11 个请求分支。这条检查让"再堆一个巨型文件"进不来。
  const offenders = []
  for (const path of sourceFiles(join(root, 'native'))) {
    const relative_path = relative(root, path).replace(/\\/g, '/')
    if (NATIVE_REGISTERED.has(relative_path)) continue
    const lines = lineCount(path)
    // 测试文件是"一个场景集合"，上限宽松一档（拆测试的收益低于拆实现）。
    const limit = /_test\.cpp$/.test(relative_path) ? 1300 : NATIVE_DEFAULT_LIMIT
    if (lines > limit) offenders.push(`${relative_path}(${lines} 行 > ${limit})`)
  }
  assert.deepEqual(offenders, [],
    `这些原生文件超上限且没有登记：${offenders.join('、')}\n` +
    '按职责拆到新的 .cpp/.hpp（记得同时更新 CMakeLists.txt），或者登记进 NATIVE_REGISTERED 并写清拆分方向。')
})

test('已登记的 native 大文件不许继续变大', () => {
  const grown = []
  for (const [path, { limit, note }] of NATIVE_REGISTERED) {
    const lines = lineCount(join(root, path))
    if (lines > limit) grown.push(`${path} 现在 ${lines} 行 > 上限 ${limit}（${note}）`)
  }
  assert.deepEqual(grown, [], grown.join('\n'))
})

test('新模块本身也要够聚焦（单个新模块不该长成第二个大文件）', () => {
  // 这条是给"拆出来的模块"准备的：拆出去的东西如果又长成 900 行，等于没拆。
  // 已知的几个纯数据/纯逻辑模块（作用域语言、桥接封装）是例外，它们本身就是单一职责。
  const focused = [
    'src/semanticTokens.ts', 'src/documentLinks.ts', 'src/breakpointLocations.ts',
    'src/exceptionInfo.ts', 'src/workspaceDiagnostics.ts', 'src/workspaceInspection.ts',
    'src/bookmarksView.ts', 'src/branchPopup.ts', 'src/runConfigTree.ts',
    'src/inlineCompletion.ts', 'src/inlineCompletionExtension.ts', 'src/debugCompletions.ts',
    'src/codeLens.ts', 'src/codeLensExtension.ts', 'src/documentLinksExtension.ts',
    'src/distractionFreeMode.ts', 'src/distractionFreeSession.ts', 'src/navigateInFile.ts',
    'src/diffText.ts', 'src/projectExtras.ts', 'src/hierarchyView.ts',
    'src/workspaceInspection.ts',
  ]
  for (const path of focused) {
    const lines = lineCount(join(root, path))
    assert.ok(lines > 0 && lines <= 600, `${path} 有 ${lines} 行，超出单个职责模块的合理规模`)
  }
})
