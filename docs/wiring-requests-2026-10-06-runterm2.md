# 接线请求 · 运行/终端族第二轮（代号 `runterm2`，2026-10-06）

派单里让我交接的两条：**T1（App.vue 一行）主代理已记着**，**T2 阻塞在桥** ⇒ 本文把 T2 写成可直接照抄的请求，
并把本轮判词核对里撞到的另外三条卡点一并登记。所有目标行号都是本轮**实测打开文件**取的。

来源（留痕）：这两条原本登记在 `docs/wiring-requests-2026-10-06-terminal.md`（代号 `terminal` 名下、由 `terminal2` 补落盘）。
`docs/batch-2026-10-06-terminal2.md` §7 明确写了「代号 terminal2 名下无独立接线请求文件」，所以派单里那个文件名
`docs/wiring-requests-2026-10-06-terminal2.md` 在仓里**不存在** —— T1/T2 的真身在 `…-terminal.md`。本文只补 T2 的实现细节，
不重复 T1（T1 = 终端面板 `file:` 链接跳编辑器，`src/App.vue` 那一行 `@jump="jumpToIssue"`，主代理已认领）。

---

## R1 · `shell.openUrlWithBrowser`：逐浏览器的菜单行（= 旧 T2）

**用户可见的缺口**：控制台里右键一条 URL 命中，上游是**逐个活动浏览器**一行
（`platform/execution-impl/src/com/intellij/ide/browsers/OpenUrlHyperlinkInfo.java:44-67`，
文案 `platform/platform-api/resources/messages/IdeBundle.properties:1048` 的 `open.in.0=Open in {0}`）；
本仓只有「在浏览器中打开（系统默认）」与「复制 URL」两格（`src/consoleHyperlinks.ts` 的 `consoleLinkMenuItems`，
实测在 `src/consoleHyperlinks.ts:180-185`）。规则侧**已经做完**：
`src/browsers.ts` 的 `browserLaunchPayload(browser, url)`（实测 `src/browsers.ts:377-386`）产出
`{ path, args }`，折算规则逐条对着 `platform/platform-api/src/com/intellij/ide/BrowserUtil.java:92-133` 与
`platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:220` 写。
**只差宿主通道**，所以现在渲染那些行就是假控件 ⇒ 不渲染。

### 1) `src/bridge.ts`（保留文件）

第 109 行的 `export type Method = …` 里，在既有的 `'shell.openUrl'` **之后**插入一个成员（只加这一段，别动其余）：

```ts
  'shell.reveal' | 'shell.openUrl' | 'shell.openUrlWithBrowser' | 'file.readBinary' |
```

（现状那一段是 `… | 'shell.reveal' | 'shell.openUrl' | 'file.readBinary' | …`，实测在 `src/bridge.ts:109`。）

### 2) 宿主侧（三个文件，都不是终端/运行域的可改面）

**留痕（原写 X、实际 Y）**：`src/browsers.ts:341-347` 的注释说通道要动 `native/browser_launch.cpp` ——
**本仓没有那个文件**（`ls native | grep -i browser` 为空）。真实的 URL 出口是
`native/file_queries.cpp:236-239` 的 `shell.openUrl` case，实现是 `native/workspace.cpp:1223-1238` 的
`open_external`（声明在 `native/workspace.hpp:99`）。下面按真实落点写。

a) `native/workspace.hpp` —— 在 `Json open_external(const std::string& url);`（第 99 行）**之后**加一行声明：

```cpp
// 「用指定浏览器打开」：路径必须是磁盘上真实存在的可执行文件，参数原样追加（URL 在最后）。
// 上游折算见 BrowserUtil.java:92-133 与 BrowserLauncherAppless.kt:214-220；路径不存在时**报错**，
// 不悄悄退回系统默认浏览器。
Json launch_browser(const std::string& path, const std::vector<std::string>& args);
```

b) `native/workspace.cpp` —— 紧接 `open_external` 的实现（第 1238 行的 `}` 之后）加：

```cpp
Json launch_browser(const std::string& path, const std::vector<std::string>& args) {
    return boundary([&]() -> Json {
        for (const auto& part : args) {
            if (!valid_utf8(part) || part.find('\0') != std::string::npos)
                fail("INVALID_PATH", "浏览器参数必须是没有 NUL 字节的 UTF-8 文本。");
        }
        if (path.empty() || !valid_utf8(path) || path.find('\0') != std::string::npos)
            fail("INVALID_PATH", "浏览器路径必须是没有 NUL 字节的 UTF-8 文本。");
        std::error_code ec;
        // 上游 `BrowserUtil.java:124-130` 的分支条件就是「路径是不是真文件」；不是就走
        // `cmd /c start` 那一支。本仓不做那一支（要 shell 解析，安全边界同 `open_external`），
        // 直接按 `BrowserLauncherAppless.kt:214-218` 报错。
        const auto status = std::filesystem::status(utf8_path(path), ec);
        if (ec || !std::filesystem::is_regular_file(status)) fail("NOT_FOUND", "找不到该浏览器的可执行文件。");
        std::string line = '\"' + path + '\"';
        for (const auto& argument : args) line += " \"" + argument + '\"';
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        // 与 `open_external` 同一道闸：只吃**绝对路径**，不吃 shell 解析。
        if (!CreateProcessW(utf8_wide(path).c_str(), utf8_wide(line).c_str(), nullptr, nullptr, FALSE,
                            0, nullptr, nullptr, &startup, &process)) {
            fail("IO_ERROR", "无法用该浏览器打开链接。");
        }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        return {{"path", path}, {"opened", true}};
    });
}
```
（`valid_utf8` / `utf8_wide` / `utf8_path` / `boundary` / `fail` 都是该文件里既有的 helper；
`open_external` 自己就用前三个，见 `native/workspace.cpp:1223-1238`。）

c) `native/file_queries.cpp` —— 在 `shell.openUrl` 那个 if（第 236-239 行）**之后**、`return false;` 之前加：

```cpp
    // 「用指定浏览器打开」：折算规则在渲染侧（src/browsers.ts 的 browserLaunchPayload），
    // 宿主只负责「这个可执行文件真的存在就把 URL 递过去」。
    if (method == "shell.openUrlWithBrowser") {
        std::vector<std::string> args;
        if (const auto* list = params.find("args"); list && list->is_array()) {
            for (const auto& item : *list) {
                if (!item.is_string()) fail("INVALID_PATH", "浏览器参数必须是字符串数组。");
                args.push_back(item.get<std::string>());
            }
        }
        result = launch_browser(text("path"), args);
        return true;
    }
```
（`text(...)` 与 `params`/`result`/`fail` 都是该 case 函数里既有的东西，`file_queries.cpp:236-239` 同一形状。）

d) `CMakeLists.txt`：**不用动** —— 这条不新建 `.cpp`，只在既有的 `workspace.cpp` / `file_queries.cpp` 里加。

e) `native/settings_schema.cpp`：本轮实测**没有** `browserList` / `defaultBrowserPolicy` 两个键
（`grep -n "browserList\|defaultBrowserPolicy" native/settings_schema.cpp` 无命中）。
读盘口径与「旧存档缺键补默认」的规则已经写在 `src/browsers.ts`（`normalizeBrowserSettings`），
设置页那半边（表 + 「设为默认」策略）已登记在 `docs/wiring-requests-2026-10-06-welcome.md`，
**R1 落在 welcome 那两条键之后**；键不在，表里就只有内置那几行，逐浏览器的菜单行仍无处可取。

### 3) 通道一通就要补的消费侧（我的面，不需要主代理动手）

`src/consoleHyperlinks.ts`：`consoleLinkMenuItems` 现在只发 `activate` + `copy` 两格（`:180-185`），
要加的是「每个活动浏览器一行」（`id: 'browser:<id>'`，label 走 `IdeBundle.properties:1048` 的 `Open in {0}` 直译）；
`src/components/RunConsole.vue`：`runLinkMenuItem`（实测在 `:184` 起）加一条派发，
`request('shell.openUrlWithBrowser', browserLaunchPayload(browser, link.href))`。
这两处的判据本轮就备好（`tests/console-hyperlinks.test.mjs` 里补一条「表里有活动浏览器时菜单多出那几行」）。

---

## R2 · 提权运行（`exec/run-instances` 缺 ③）

**判词**：`docs/inventory/verdict-execution.md:28` 的「③ 提权运行（`execution/process/elevation`）：仍缺 ——
要 `run.start` 的提权参数与 UAC 启动，`RunStartParams`/`src/bridge.ts` 本批冻结，没有入口」。
**核对结果：这条卡点是真的**，不是「判词说缺、其实早做过」——`RunStartParams` 定义在
`src/settingsModel.ts:51`（保留文件），字段里没有任何提权位，`native/run_host.cpp` 的 `run.start` 也只有
CreateProcess 那一条路。要落地需要三处：

1. `src/settingsModel.ts:51` 的 `RunStartParams` 末尾加一格：
```ts
/** 上游 `execution/process/elevation` 的等价物：以管理员身份启动（Windows 走 ShellExecuteW 的 "runas"）。 */
elevate?: boolean
```
2. `native/run_host.cpp` 的 `run.start`：`elevate` 为真时改用 `ShellExecuteW(nullptr, L"runas", …)`
   （用户拒绝 UAC 时 `ShellExecuteW` 返回 `SE_ERR_ACCESSDENIED`，要如实回一条错误而不是假装启动了）。
3. 消费入口（运行工具栏/运行菜单里那一行）——`src/menus/runMenu.ts` 与 `src/runActions.ts` 都是我的面，通道一通就能落。

**上游依据**：`platform/execution-impl/src/com/intellij/execution/process/elevation/` 那一族
（判词给的包名，本轮未逐个开文件核实行号 ⇒ **具体类与行号无法核实**，不写假坐标）。

---

## R3 · `Runner.FocusOnStartup` 要改的是**别人钉的测试**，不是我的实现面

`docs/inventory/verdict-execution.md:31` 把 `FocusOnStartAction` 列为 `exec/ui` 的缺项。核对结果：

- 上游这条**不是**「打个标记没人消费」：`platform/execution-impl/src/com/intellij/execution/ui/layout/impl/RunnerContentUi.java:1828`
  在 UI 首次 `addNotify` 时调 `attractOnStartup()`，`:1860-1865` 里 `attractByCondition(LayoutViewOptions.STARTUP, false)`，
  `:1881` 用 `myLayoutSettings.getToFocus(condition)` 找出被标记的那个 Content 再聚焦。
  ⇒ `src/runToolWindowLayout.ts:171-181` 那条「本仓没有可切换视图格 ⇒ 落不了地」的理由**只对了一半**：
  格位（anchor/weight）确实落不了，但「Run 窗口显示时聚焦哪一个」在本仓有真实对应物（实例标签条的选中项）。
- 但这条动作在 `src/runToolWindowLayout.ts` 里被登记成**不渲染**常量
  `RUNNER_VIEW_ACTIONS_NOT_PORTED`（`src/runToolWindowLayout.ts:156-182`），
  而 `tests/runner-view-actions.test.mjs:105-113`（**不是我的测试面**，`tests/run-*` 不含 `tests/runner-*`）
  用 `deepEqual` 钉死了那张表恰好是三条、并钉死了 FocusOnStartup 的理由文案里必须出现
  `intellij.platform.lang.actions.xml:3`、`LayoutViewOptions.STARTUP`、`content.length == 1`。
  ⇒ 我不改那 4 条断言就没法把它从「不渲染」搬到「渲染」。
- 需要的动作（二选一，请主代理拍）：
  (a) 由 runcfg/桶 11c 那条 lane 把 `tests/runner-view-actions.test.mjs:105-106` 的表改成四条（或把 FocusOnStartup 那格换掉），
      我这边同批补 `Runner.FocusOnStartup` 的判定（可见性 `content.length == 1`，`AbstractFocusOnAction.java:20-26`；
      切换 `setToFocus(toFocus ? null : content[0], STARTUP)`，`:32-36`；状态按 `focusOnCondition` 存一份 condition→id，
      `RunnerLayout.java:248-253`）与「Run 窗口显示时聚焦被标记实例」的消费（`RunnerContentUi.java:1828` 的等价物）；
  (b) 判词与那份表都保留现状，但把理由文案订正成「上游确实消费（上面三个行号），本仓因测试归属未落」——
      别继续写「没有对象可标」。

---

## R4 · `lp/large-files` 剩下的三项都不在我的面

`docs/inventory/verdict-platform_rest.md:93` 的 ③④⑤（大文件模式的动作替换 / 按页加载的编辑器模型 /
「大文件里正则搜索不可用」提示）落点分别是 `src/editorCommands.ts` + `src/components/CodeEditor.vue`、
编辑器模型层、查找替换 UI。`src/components/CodeEditor.vue` 与 `src/App.vue` 都是保留/他人面 ⇒ 本轮只登记。
①②（按字节判定接进编辑器、打开即只读 + 隐藏/不再显示）**实测早做过**，见
`src/components/CodeEditor.vue:84-87`、`:126-136`、`:958-959`、`:1131-1134` 与 `src/largeFileNotice.ts` 头注 —— 判词该改。

---

## 另：两条**不是我造的**现网红

`node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` 里两条
「仓里每一条带路径的上游引用都指得到」红，7 条假路径全在**别人的文档**里（本轮实测清单）：

| 文档 | 假路径（参考树里没有那个文件） |
| --- | --- |
| `docs/batch-2026-10-06-projecttree.md` | `platform/lang-api/src/com/intellij/psi/util/PsiUtil.java` |
| `docs/batch-2026-10-06-status2.md`、`docs/batch-2026-10-06-welcome2.md`、`docs/wiring-requests-2026-10-06-vcs2.md` | `platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java` |
| 同上三份 | `platform/structure-view-impl/src/com/intellij/ide/structureView/StructureViewFactoryImpl.java` |
| `docs/wiring-requests-2026-10-06-vcs2.md` | `platform/editor-ui-api/src/com/intellij/openapi/editor/settings/EditorSettingsExternalizable.java` |

按规约 §6 不代改他人文档；本文**没有**再写一遍那些带行号的形状（引用门会把转述当真引用收进去）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（`shell.openUrlWithBrowser` 菜单行）** —— native + bridge，非本 lane。
- **R2（提权运行）** —— 不落（缺传输层）。
- **R3（`Runner.FocusOnStartup` 测试）** —— `tests/**`，非本 lane。
- **R4** —— 非本 lane 面。

结论：零接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
