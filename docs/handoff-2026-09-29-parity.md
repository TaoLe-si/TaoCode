# 交接文档（2026-09-29）

给下一位接手 TaoCode 移植的 agent。**先读这一页，再动手**。

- 仓库：https://github.com/TaoLe-si/TaoCode（public）
- 分支：`parity/rebuild-inventory`（**当前唯一在推的分支，推的是 `HEAD:main`**）
- HEAD：`28de9f5`（本机领先 `origin/main`：侧条拖宽+「更多」按钮、Find 窗口齿轮组、
  Git 日志窗口的「视图选项」齿轮、**工具窗口注册表**、**布局档案 + 项目级布局**、
  **主工具栏键盘焦点 + §C 无宿主条目的判决清理**、**每窗口可见性**、**B3 域判决**、
  **提交检查的入口/失败行/「仍然提交」**、**提交面板文案与 amend 形状（第五十二批）**、**面板那一行按 `VcsToolbarActions` 裁剪（第五十三批）**、**变更树头部那对动作 + 分支/比较两行归位（第五十四批）**、**日志窗口提交行右键菜单（第五十五批）**、**标签行的收尾（第五十六批）**、**面板通知接上宿主 + 失败通知的两个动作（第五十七批）**、**日志的转到子/父提交（第五十八批）**、**B4 起域：codeInsight/folding 69 类判决（第五十九批）**、**折叠动作族 15 条命令 + 键位 + Code 菜单落点（第六十批）**、**「代码折叠」设置页两条开关（第六十一批）**、**折叠状态存/取与重算（第六十二批）**、**B4 收尾两条（第六十三批）**、**折叠状态落盘（第六十四批）**、**B4 最后 5 条判掉、`[ ]` 归零（第六十五批）**、**B5 起域（第六十六批）**、**书签行文本锚与编辑后对账（第六十七批）**、**项目树偶发空白修复（第六十七批续）**、**大工程语言服务卡死的可恢复修复（第六十八批）**、**那句「语言服务没响应」的真根因：写 stdin 阻塞在语言服务线程上（第六十九批，专写线程 + 1MB 管道 + 弃养一代收进程）**、**每次内容变更都通知宿主（第七十批：撤销/第二次编辑被"变脏那一拍"吞掉）**、**书签自动描述 + 锚存不进去的白名单缺陷 + 选中文字成自定义描述（第七十一批）**，外加交接文档跟进）
- 工作树：干净（除 `.gitignore` 排除的产物/临时件）

---

## 0. 一句话现状

把 IntelliJ IDEA 的**类级**移植做到可验收：功能对标 IDEA，UI 位置/文案/键位一律引本地源码
`file:line`，禁止编造控件与假逻辑。已闭合 B1（`ui/tabs`+`ui/popup`）与 B2
（`toolwindow`+`openapi/wm`）两个域的判决，并按判决表逐条推进实现。

**当前验证状态（在本机实测，非推断）**：

| 项 | 值 |
|---|---|
| 前端测试 | `npm test` → **1290 passed / 0 failed**（2026-09-30 第六十批后实测） |
| 类型检查 | `npx vue-tsc --noEmit -p tsconfig.json` → 0 错 |
| 前端构建 | `npx vite build --emptyOutDir false` → 成功 |
| 原生构建 | `cmd //c scripts\build-native-locked.bat` → RC 0、0 error / 0 warning |
| 原生测试 | `cmd //c scripts\run-ctest.bat` → **32/32 passed** |
| 模块大小门禁 | `tests/module-size.test.mjs` 5/5 |

> 2026-09-30 第六十四批实测：前端四行 + 原生两行都是这一批重跑的（`build-native-locked.bat` 成功、
> `run-ctest.bat` 33/33）。

---

## 1. 硬规则（违反即返工）

1. **不许编造**。每个 UI 声明都要引本地参考树的上游 `file:line`：
   `D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
   **不要搜网**，参考树就在本机。
2. **不留假控件**。看得见但点下去没反应的按钮/行，是缺陷。判断"该不该做"看**有没有真宿主**：
   没有就登记 `[-]` 并写理由，**不建空壳**（例：EP→Factory 注册机制、`tabInEditor` 整组、
   `FLOATING` 窗口形态 —— 本仓是 WebView2 单窗口，这些都没有宿主）。
3. **不许私自停止/请示**。每块做完立即开下一块；里程碑处小结。
4. **禁止用 subagent**（会后台卡死）。并行 = 同一条消息里发多个工具调用。
5. **不要消耗额度**、**不要启动他的 GUI**（mock / 假 key / 本地取证可以）。
6. 自己起的进程/产物自己清掉。

## 2. 共享工作树的 Git 纪律（重要）

这个工作树**可能有别的 agent 同时在动**。所以：

- **禁止** `git checkout --` / `git reset` / `git stash` / `git clean`。要临时回滚就手工改回来。
- 提交前先 `git status --porcelain` 量条数与体积；提交只加**自己那批**文件，
  别 `git add -A` 把别人的在途工作一起提交（除非他明确说"全部提交"）。
- 产物与临时件进 `.gitignore`，**不入库**：`build-validation/` `build-baseline/` `build-dbg/`
  `dist-validation/` `*.obj` `*.lib` `*.exe` `.tmp-*` `screenshots/` `nul` `*.bak*`。
- 混进垃圾且**尚未推送**时可以 `git commit --amend` 修掉（已推送就别改历史）。

### 2.1 必须先知道的坑：CRLF 会让机检假失败

`git checkout` 切分支会把工作树转成 CRLF（`core.autocrlf=true`），而本仓机检大量用
「切一段源码」的手法（`indexOf('function x')` → `indexOf('\n}\n')`）和 `split('\n').length`，
CRLF 下这些**永远匹配不到** ⇒ 断言假失败。已加 `.gitattributes`（`* text=auto eol=lf`）根治。
如果你看到"代码明明对、测试却挂"，先查行尾：

```bash
python -c "import io;d=io.open('src/xxx.ts','rb').read();print('CRLF' if b'\r\n' in d else 'LF')"
```

## 3. 验证口径（每批都要跑，缺一不可）

```bash
cd /d/TaoCode
npm test                                        # 前端 1150 全绿
npx vue-tsc --noEmit -p tsconfig.json           # 0 错
npx vite build --emptyOutDir false              # 构建成功
cmd //c "scripts\build-native-locked.bat"       # 原生 RC 0、0 error/warning（改了 native/ 才需要）
cmd //c "scripts\run-ctest.bat"                 # 32/32（改了 native/ 才需要）
```

**部署同步（两步都要）**：改完前端要 `rm -rf build/ui build-validation/ui && cp -r dist build/ui && cp -r dist build-validation/ui`。
（原生构建会自动拷 `dist` → `build/ui`，但 `build-validation/ui` 仍要手拷。）
跑产物前要**彻底退出 TaoCode 进程**；关于/日志界面自带构建指纹。

## 4. 模块大小门禁（会拦你的提交）

`tests/module-size.test.mjs` 按 `split('\n').length` 数行数，超限即失败。当前**都顶在上限**：

| 文件 | 上限 | 现在 |
|---|---:|---:|
| `native/main.cpp` | 2000 | 2000 |
| `src/App.vue` | 2737 | 2737 |
| `src/components/SettingsDialog.vue` | 1381 | 1381 |
| `src/bridge.ts` | 1208 | 1208 |
| 未登记文件 | 900（原生 1100） | — |

**所以：新逻辑一律拆 `src/xxx.ts`，宿主只留一行调用。** 宿主文件连一行都加不进去，
想加就得先把同文件里的其它逻辑搬出去（这是有意设计，别去抬上限）。

## 5. 判决表（这是"进度"的唯一基准）

| 域 | 类数 | 判决 | 门控 |
|---|---:|---|---|
| B1 `ui/tabs` + `ui/popup` | 127 | `docs/inventory/verdict-ui-tabs-popup.md` | — |
| B2 `toolwindow` + `openapi/wm` | 350 | `docs/inventory/verdict-toolwindow-openapi.md` | `tests/b2-verdict.test.mjs` |
| B3 `vcs/commit` | 78 | `docs/inventory/verdict-vcs-commit.md` | `tests/b3-verdict.test.mjs` |
| B4 `codeInsight/folding` | 69 | `docs/inventory/verdict-folding.md` | `tests/b4-verdict.test.mjs` |

判决表四档：`[x]` 已移植 / `[~]` 部分 / `[ ]` 未移植（TODO）/ `[-]` 不适用（附理由）。
**B2 的 §G 是 350 行逐条表**，每条 `[x]`/`[~]` 都指向**磁盘上真实存在**的 `src/`/`native/` 文件
（这条由门控强制，防"注释里提过就算移植"）。

**下一步优先级（B2 §C 剩下的，按用户可见度）**：

1. ~~`Stripe` 的拖条宽（`ResizeStripeManager`）与侧条溢出「更多」（`MoreSquareStripeButton`）~~
   —— **已落地**（第三十六批，`docs/ui-placement-audit.md` §AN：宽度 [40,100]/紧凑 33、名称开着才挂分隔线、
   按边持久化；「更多」= 没有侧条按钮的可用窗口，助记符序，停在 `getMoreButtonSide()` 那一侧）。
   判决表里这两条已改 `[x]`，`ToolWindowToolbar`/`LeftToolbar`/`RightToolbar` 三行从误判的"窗口内工具栏"改成 `[~]`
2. 标题栏 ⋮ 菜单 —— §14 已逐行核过，只剩两条没接：`TW.ViewModeGroup`（浮动/独立窗口没有宿主）与
   `HelpAction`（没有 helpId 映射），都如实登记、不建空壳
3. 其余窗口自己的 `additionalGearActions`：项目视图（§AA）+ **用法视图/Fɪɴᴅ 窗口（第三十七批，§AO）** +
   **Git 日志窗口的工具条齿轮（第三十八批，§AP：`标签名称` + `列` 的显示/隐藏）** 已接；
   下一批候选在 `docs/class-parity-todo.md` §17 里逐窗口列了 —— `git` 提交窗口的「双击时显示」
   要先把"diff 开进编辑器标签"这个形态定下来（本仓 `DiffView` 只活在面板里），否则只能接「源」那一条
4. `tabInEditor` 整组（20 类）——**先判断有没有宿主**，没有就如实记 `[-]`
5. ~~工具窗口的注册机制~~ —— **已落地**（第三十九批，§AQ：`src/toolWindowMeta.ts` 的
   `TOOL_WINDOW_REGISTRY`，一条记录 = 一个窗口，四张表由它派生）。
   ~~布局档案~~ —— **已落地**（第四十批，§AR：`src/toolLayoutProfiles.ts` 的 `SEED_ONLY`/`FORCE_ONCE`
   + 布局改成**项目级** `taocode.toolLayout:<root>`，旧三键一次性迁移）。
   ~~每窗口状态对象~~ —— 记录形状（第四十二批 §AT）+ **`isVisible`（第四十三批 §AU）** 都已落；
   还差 `weight`/`sideWeight`/`isSplit`（本仓的每窗口尺寸在 `panelResize.ts` 那条路上）与
   `ToolWindowPaneState`/`ToolWindowEntry` 两个运行期对象（`docs/source-todo.md` §15）。
   §C 这一族已经不再是"下一刀"的首选 —— 见下面第 6 条里那个更实在的前置机制（编辑器标签承载任意内容）。
   （第四十一批已把 §C 里**没有宿主**的 12 条判成 `[-]`，剩下 65 条 `[ ]` 每条都真有行为、都还没有；
   其中 13/14 那两族等的是"编辑器标签承载任意内容"这个机制，见 `docs/source-todo.md` §12。）
   §C 第 13/14 条（跨区拖放、`tabInEditor` 20 类）**共用同一个前置机制**：
   编辑器标签现在绑定文件（`Tab extends DocumentData`），"标签承载任意内容"这件事还没有，
   两条都排在它之后（登记在 `docs/source-todo.md` §12）

**B3 已起底并落了头两条**：`vcs/commit` 78 类逐条判决（`[x]` 13 / `[~]` 48 / `[ ]` 0 / `[-]` 17），
§E 的 ①「只运行检查」与 ③「提交期间保存」已实现（审计 §AV/§AW，真机取证走通；
`RunCommitChecksExecutor` 与 `SaveCommittingDocumentsVetoer` 两行已改 `[x]`）。
**§E 里还剩**：② 「改某一次具体提交」（`CommitToAmend.Resolved` 那条下拉）、
④ 三层执行器插槽（`CommitExecutor`，要有真消费者才建）。

**B4 已起域并落了 §C①②③④⑤**：`codeInsight/folding` 69 类逐条判决，动作族（收起/展开/递归/到级别/切换/选区/块/文档注释）
15 条命令全部接上（`src/editorFolding.ts`，挑目标的规则逐条照上游，见 `docs/ui-placement-audit.md` §BF），
四档变成 `[x]` 0 / `[~]` 31 / `[ ]` 12 / `[-]` 26。
**B4 已收口**（判决 69 类：`[x]`0 / `[~]`40 / `[ ]`0 / `[-]`29）：动作族、键位与菜单落点、设置页两条真开关、
状态存/取与重算、`caretInsideRange`、落盘（跨进程）全做完；剩下的 `[~]` 是"上游靠 PSI 元素身份/文件时间戳，
本仓用偏移+轻签名当替身"这类**引擎差异**，`[ ]` 5 条是 necromancy 磁盘缓存与 Java/XML 语言侧的东西。
B5 §C① 已做（审计 §BM）；下一批**先查两条待查**（① 项目视图偶发零行 —— 真缺陷；② 撤销是否触发内容变更事件 —— 未定论），
再做 §C 剩下的（书签描述 / 书签类型与文件书签 / 列表项富渲染），
之后按 `docs/class-parity-todo.md` §26.1 的规模表继续挑小组起域（`platform/welcomeScreen` 1、`lvcs` 35…）。

**B6.. 尚未开始**（B5 已起域：`ide/bookmarks` 5 类，判决 5/5 行；剩 4944-5 类）：`editor/actions`、`codeInsight/template`、
`settings-run`、`find`+`diff`、`execution`+`xdebugger`、`projectviews`、`actions`、
`codeInsight/daemon`。域清单在 `docs/inventory/*_scan.md`。

**一条写给下一位的教训（第五十一批付了学费）**：判决表里 `[~]` 的行**不要凭直觉补形状**。
「运行提交检查」当时被做成一个常显按钮（"看起来合理"），真机截图 + 上游复核才发现
上游根本没有这个控件（非模态面板的执行器挂在提交按钮下拉上，而那个组是空的），
用户能点到的只有**失败行**上那把刷新按钮。先找到「入口在哪个组件、什么条件下可见」，再动手。

---

## 6. 关键文件地图

**判据 / 测试工具**
- `tests/source-citations.test.mjs` —— **引用门禁**：解析 `src/native/docs` 里所有
  `file:line` 引用，要求真实存在。加引用前先过它。
- `tests/b2-verdict.test.mjs` —— B2 判决自身的门控（350 覆盖 / 引用真实 / 四档计数自洽）。
- `tests/vue-sfc-loader.mjs`、`tests/shell-source.mjs` —— SSR 渲真实组件 / 拼"整个外壳"的测试夹具。
- `tests/module-size.test.mjs` —— 模块大小门禁（见 §4）。

**生产代码的关键落点（近期新增）**
- `src/statusBarWidgets.ts` + `src/statusWidgets.ts` —— 状态栏组件**注册表**
  （IDEA `StatusBarWidgetFactory` + `StatusBarWidgetsManager` + `StatusBarWidgetSettings`）。
- `src/statusBarText.ts` + `src/processTerminated.ts` —— 状态栏**文字通道**
  （`StatusBar.Info` → `InfoAndProgressPanel.setText` → `StatusPanel.updateText`）
  与进程结束播报（`ProcessTerminatedListener` + Unix 信号表）。
- `src/editorFontSize.ts` —— 字号上下限单一来源（写入 `[4,40]`、菜单动作 `[8,40]`）。
- `src/activeToolWindow.ts` —— `ActiveStack` + 标签导航判据（`tabNavigationCount`）。
- `src/toolWindowActions.ts` —— 工具窗口隐藏/循环/关闭 + `focusedDock()`（七处调用它的地方都靠它判 dock）。

**文档**
- `docs/class-parity-todo.md` —— 总控与执行顺序（**每批完成后回来更新状态**）。
- `docs/ui-placement-audit.md` —— 每批的审计记录（§A…§BE，按批次追加）。
- `docs/source-todo.md` —— "假 UI / 假位置 / 假控件 / 假逻辑"清单，判定不做的逐条在此登记理由。
- `docs/enum-lsp-dap.md` —— LSP/DAP 承接层对照（协议侧，不按类对照）。

## 7. 最近的提交（知道上一批在干嘛）

```
767b052 feat(tool-windows): 每窗口可见性（WindowInfo.isVisible）—— 打开项目回到上次那些窗口
4d5142e refactor(tool-windows): 每窗口状态对象第一刀（WindowInfo）+ 内容条形态每内容一份
37bbe05 feat(toolbar,vcs-verdict): 主工具栏键盘焦点 + §C 里没有宿主的 12 条判 [-]
0fa43ef feat(tool-windows): 布局档案 + 布局改成项目级（B2 §C 第 10 条）
929b947 refactor(tool-windows): 工具窗口注册表 —— 一个窗口 = 一条记录
607cf14 feat(vcs-log): 日志窗口自己的「视图选项」齿轮（标签名称 + 列的显示/隐藏）
6044084 docs(handoff): 交接文档跟进（HEAD cd3622d）
cd3622d feat(tool-windows): 接住 Find 窗口自己的齿轮组（additionalGearActions 的第二个落点）
f21ad40 feat(tool-windows): 侧条可拖宽 + 「更多」按钮（B2 §C 的 ResizeStripeManager / MoreSquareStripeButton）
bc4560d docs(handoff): 交接文档（2026-09-29）—— 硬规则、Git 纪律、验证口径、判决表状态与下一步
c030f62 chore(repo): 加 .gitattributes 固定 LF —— CRLF 工作树会让切片式机检假失败
b49b11b fix(tool-windows): 关闭当前标签页也不再跨 dock（CloseActiveTab 的窗口取自同一上下文）
88cd8de fix(tool-windows): Alt+←/→ 不再跨 dock 切标签（侧栏单内容 ⇒ 无事可做）
8ae73b7 fix(tool-windows): 菜单里的「激活 XX 工具窗口」行加上可用性门禁（去掉假控件）
f7cf508 fix(editor-font-size): 字号上下限从 10–32 订正为上游的 [4,40] / 动作 [8,40]
7211254 feat(status-bar): 补上状态栏文字通道（StatusBar.Info）与进程结束播报
861ba98 chore: 入库全部在途源码 + B2 判决与状态栏组件注册表
```

**第三十六 / 三十七两批的共性**：都是"用户看得见的侧条与齿轮"，落点都在**新组件/宿主行**而不是改旧逻辑；
每批都做了真 exe 取证（用 `TAOCODE_DEBUG_PORT` + CDP），第三十六批靠它抓到两个**测试看不见**的真缺陷
（非 immediate `watch` 在创建时求值 ⇒ 读到声明更晚的设置域 ⇒ TDZ；按钮 `contextmenu` 冒泡 ⇒ 两个菜单同时开）。
**接手提示**：`src/` 里任何 `{ get value() { return 更晚声明的 ref } }` 的惰性注入，都不能在**建模块时或
非 immediate 的 watch 源里**读 —— 那是本仓这两批踩过的同一个坑。另一条同样有用：**ctx 对象要在
`computed(() => createXxxContext({...}))` 里建**（惰性），否则把声明在后面的函数写进对象字面量会当场撞 TDZ；
本仓既有代码就是这么写的，照抄。

**最近三批的共性**：都在修「**跨 dock 的假行为**」—— 焦点在侧栏时，Next/PreviousTab 与
CloseActiveTab 会去动**底部**面板。根因是同一个：上游按"当前聚焦那个 ContentManager"分派，
本仓写成了"不是编辑器就当底部"。**同一模式可能还有别的调用点**，接手时值得再扫一遍
`focusedDock() !== 'editor'` 这类写法。

## 8. 交接时的工作树状态

- 干净，无未提交改动。
- `.gitattributes` 本轮新增（唯一内容变更）。
- 工作树里的 `build/`、`build-validation/` 是产物（已 ignore），`build/ui` 与
  `build-validation/ui` 已同步到最新前端产物。
- 未清理的临时件都在 `.gitignore` 里（`.tmp-*`、`.java-launch-regression/` 等），
  它们不进版本库，可以留着也可以删。
