# 交接文档 · 2026-10-05

> 分支 `parity/rebuild-inventory` · HEAD `63056b7 feat(parity): 批 98–116` · 工作区 **707 处改动**（242 已修改 + 465 未跟踪新增）
>
> 规模：401 个测试文件 · 99 个组件 · 429 个 src ts · 99 个 native cpp
>
> **本文件是交接记录，不是完成声明。** 每条都标了「已验证 / 未验证 / 未完成」。

---

## 0. 给接手的人：三条硬约束

1. **工作区是唯一现场，不许清理。** 707 处改动绝大多数未提交。`git checkout --` / `git reset` / `git stash` / `git clean` 会毁掉别人的未提交工作。
   上一会话已经因此酿成事故并丢了 630 行测试，见 `docs/handoff-2026-09-28-ui-parity.md` §4.2。
2. **UI 对齐只认上游源码，不认图像。** 判定基准只有
   `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，
   每条结论必须给**文件相对路径 + 行号**。禁止截图比对、禁止「IDEA 一般是…」这类经验值。
   安装目录 `D:\IntelliJ IDEA 2026.2` 只能读 `lib/` 里的上游资源文本，不许用它反推像素。
3. **行数上限只能靠拆模块下调，不许上调。** `tests/module-size.test.mjs` 是唯一权威。

---

## 1. 收尾状态：全绿 ✅ 已验证

并发写入停止后，本会话**亲自**跑的三套回归（不是引用子代理的报告）：

| 项目 | 命令 | 结果 |
|---|---|---|
| **类型检查（全量扫描）** | `npx vue-tsc -b --force` | ✅ **exit 0，0 错** |
| **前端全量测试** | `npm test` | ✅ **3153 / 3153 通过，0 失败** |
| **原生全量回归** | `ctest`（`build/`，37 个） | ✅ **37 / 37 通过**（102.88s） |

> ⚠️ **基线口径更正（重要）**：`npx vue-tsc -b`（不带 `--force`）是**增量构建**，命中 `.tsbuildinfo` 缓存会直接跳过，
> 报出的 "exit 0" 是**假阴性**。本会话里多个子代理都踩了这个坑，看到「基线 0 错」实际是根本没重扫。
> **以后取基线一律用 `npx vue-tsc -b --force`。**

### 1.1 本会话亲手修掉的 6 处问题（全量回归暴露的）

前序批次的文件拆分把**实现**搬走了，但**机器门禁里指向被搬走代码的锚点**没跟着搬。
这类问题只有全量回归才暴露 —— 定向测试全绿时它们是隐形的。

| 文件:行 | 锚点指向 | 改为 | 暴露原因 |
|---|---|---|---|
| `tests/debug-data-view.test.mjs:80` | `src/bridge.ts` 的 general 白名单 | `src/bridgePreview.ts` | `bridge.ts` 拆分漏了 |
| `tests/trusted-projects.test.mjs:77` | `src/bridge.ts` 的 `trustedPaths` 白名单 | `src/bridgePreview.ts` | 同上 |
| `tests/lsp-completion.test.mjs:79` | `native/lsp_session.cpp` 的 `completionItem/resolve` | `native/lsp_session_kinds.cpp:591` | native 拆分 |
| `tests/routing-parity.test.mjs` | 三张 kind 表 | 加第四张：`sessionKinds` | native 拆分 |
| `tests/routing-parity.test.mjs:120` | 转交行在 `session` | 在 `sessionKinds` | 同上 |
| `tests/lsp-thread.test.mjs:84` | 捕获列表钉死 `[this, java, build_tools]` | 放宽为 `[this, … java …]` | 见下 |

最后一条值得单独说：LSP 子代理为修**跨线程读 `current_root` 的数据竞争**，把捕获列表改成了 `[this, root, java, build_tools]`（根目录按值带走）。
这是**正确的加固**，但测试把捕获列表的形状钉死了，于是变红。
断言已改成守「配置变更必须投递到语言服务线程」这个**意图**，而不是「捕获了哪几个变量」——
**这类"修对了却变红"要改测试，不许回退代码。**

**写给后来人的一条教训**：拆分文件时，机器门禁（`tests/*.test.mjs` 里 `read('src/xxx.ts')` 的锚点）
和文档里的**行号引用**都是**隐式依赖**。拆完必须 `grep` 一遍被搬走的符号名，
本会话前六处里有三处就是这么漏的。

---

## 2. 本会话派发的 15 个子代理：做了什么

主代理职责 = 规划 + 派发 + 验证 + 冲突处理。**纯诊断一律用只读 explore，修复另派 worker**，避免写冲突。

### 2.1 已验证的（14 个）

| 域 | 关键产出 | 验证 |
|---|---|---|
| **编辑体验** | 核实 `COMPLEX_CHARS` 与上游 `TypedCharImpl.java:23` **逐字一致**；删除上游不存在的控制字符守卫 | `editor-overwrite` 15/15 |
| **状态栏弹层动效** | 修**真缺陷**：省电模式停不掉主题水纹（`::view-transition-*` 不被 `*` 降级覆盖，`themeRipple.ts:43`） | 107/107 |
| **UI 审核 + 图标** | 3 处字形冒充图标 → lucide；**堵住门禁漏洞**（黑名单只有 `×` U+00D7 没有 `✕` U+2715） | `icon-glyph-role` 5/5 |
| **图标专项审计 + 修复** | 4 处「模板写一个数、CSS 渲染另一个数」的真冲突；「设置」滑块 → 齿轮 `Cog` | 101/101（我复跑） |
| **工具窗口与主菜单** | 修**真缺陷**：锚点搬运不带可见性（`ToolWindowManagerImpl.kt:1700-1726`） | 68/68 |
| **补全弹层与搜索域** | 14 条几何/键位引用逐条核实**全部仍准确**；Search Everywhere 补 `Symbols` 档 | 118/118 + 46/46 |
| **项目结构与重构** | `NavigateInFileGroup` / `IntroduceActionsGroup` 子菜单化；重构菜单成员**重排**（原先与 `LangActions.xml:355-395` 相反）；删误挂的 `ReformatCode` | 新增 6 条全绿 |
| **LSP 外部类路径** | 修**会让单模块工程彻底失灵**的 workspace folder bug（根目录被派生成 `build/`）；两条路合成唯一入口 | ctest 37/37 |
| **模块化体检** | 4 处拆分：`dap` / `history` / `bridge` / `SettingsDialog` | 见 §3 |
| **native 行数治理** | 3 处拆分：`git` / `lsp_session` / `workspace` | ctest 8/8 |
| **VCS 提交域** | 修**两处编造文案**（TODO 失败数、主题超长）；失败行详情链接 `CommitProblemWithDetails`；`SourceControl.vue` 920→898 | 129/129 |
| **运行调试域** | 4 条 Runner 视图动作补上；`×` 从"只停实例"改成"停实例 + 摘标签" | 52/52（我复跑） |
| **设置页 39 项** | 2 项**新做**（`ide.audiocues` / `inlay.hints`）、9 项补登、28 项写明不做理由 | 78/78 |
| **基线 12 条失败** | 7 个根因全部修完 | 33/33 |

### 2.2 代理自查出的**我的交底错误**（一律以源码为准改正）

按项目规则，代理报告里的「无法核实」和「有意不改」**如实保留，不强行修正**。
但代理**指出我的交底写错了**时，一律改正：

- 补全/搜索代理：代码里**并没有**"颜色取自 expUI"的注释，四个色值也**不是**上游原值 → 已改正注释，**未改色**
- 12 条失败诊断代理：推翻了我派单里的 **3 处文件映射错误**
- 诊断代理判定：12 条塌缩为 **7 个根因**；a 源码错 5 / b 测试过期 6 / c 测试写错 1

---

## 3. 行数余量（`tests/module-size.test.mjs` 是唯一权威）

本会话共拆了 **9 处**，全部**下调**上限，**没有一处上调**，也没有为省事而登记。

| 文件 | 拆前 → 拆后 | 上限 | 拆出 |
|---|---|---|---|
| `src/App.vue` | 2735 | 2737（登记） | 已是纯组装层，**无可搬的整块** |
| `src/components/SourceControl.vue` | **899 → 763** | 900（未登记，余量 137） | `src/sourceControlCommitChecks.ts`（201） |
| `src/components/SettingsDialog.vue` | 1350 → 1174 | 1182 | `src/settingsSearchController.ts` |
| `src/bridge.ts` | 1199 → 900 | 905 | `src/bridgePreview.ts` + `bridgeError.ts` |
| `native/git.cpp` | 1000 → 929 | 938 | `git_worktree.cpp` + `git_detail.hpp` |
| `native/lsp_session.cpp` | 1050 → 458 | 475 | `lsp_session_kinds.cpp`（634） |
| `native/workspace.cpp` | 1436 → 1369 | 1385 | `workspace_tree_ops.cpp` + `workspace_detail.hpp` |
| `native/dap.cpp` | 1787 → 1480 | 1480 | `dap_shaping.cpp` |
| `native/history.cpp` | 1020 → 910 | 910 | `history_diff.cpp` |

**当前未登记文件的最小余量**：`SearchPanel.vue` 874 / `DebugPanel.vue` 872（上限 900）—— 都有真实余量了。

拆分**逐字性是机器校验的**，不是靠肉眼：多个代理用脚本断言搬走的代码块在新文件里 byte-for-byte 连续出现；
`workspace` 那次用只读的 `git show HEAD:` 取原块比对（**未做任何 checkout/reset**）。

---

## 4. 明确**不做**的项（附理由，不是忘了）

铁律：**没有后端 / 没有消费链路的项不渲染**，按"不放假控件"登记理由，而不是画一排空控件。

| 项 | 理由 |
|---|---|
| `Runner.RestoreLayout` / `MinimizeViewAction` | 本仓标签条扁平、无可移动视图格，无可恢复的状态；运行视图都可关 ⇒ 那个分支不可达。理由已导出成 `RUNNER_VIEW_ACTIONS_NOT_PORTED` 并被测试断言 |
| 「改某一次具体提交」下拉 | 落点是**内存内 autosquash rebase**（`GitAmendSpecificCommitSquasher.kt:36-76`）。只做下拉而 `--amend` 仍打 HEAD = 假控件 |
| IDEA「已导入的模型」里的**依赖 jar** | 我们没有解析器；扫 `~/.gradle/caches` 会把整个缓存挂上类路径（版本全错、JDT 索引拖死）= 假实现 |
| 设置页 15 项（SSH 部署 / UAC 提权 / 密码保险箱 / GDPR / 代理 / 更新通道 / 设置同步 …） | 依赖 IDEA 专有后端或前置缺失，逐条理由在 `docs/settings-parity.md` |
| 调试器侧 `dbg/*` 缺口 | 卡在 `App.vue` 与 `src/bridge.ts` 两处冻结面 + 缺 DAP 请求 |
| 「Store as project file」 | 要推翻 `projects_test.cpp` 两条设计断言（`.idea` 只写颜色补丁） |

---

## 5. 未验证 / 待接手 ⚠️

| 项 | 状态 |
|---|---|
| **真实桌面运行** | ❌ **本会话一次都没跑过。** 所有像素/几何修正都只是**静态改的**，必须在真实窗口里核对后才算数 |
| **`MERGED_WITH_MAIN_TOOLBAR` 档的真实形态** | ⚠️ **仍未从源码确证**（`ShowMode.kt`→`MenuFrameHeader.kt`→`CustomHeader.kt` 追不到定论）。**未改动**，标为待核实。注：2026-09-28 那批曾登记过结论，但本轮复核认为证据链不足 |
| ~~上游树缺 `platform/keymaps` 目录 ⇒ INSERT/F6 等键位无法核实~~ | ❌ **这条是错的，已撤销。** 独立验收证伪：目录**存在**于 `platform/platform-resources/src/keymaps/`（10 个文件、`$default.xml` 1308 行）+ `platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/`（**27 个文件**，含 `KeymapPanel.java` 1138 行）。
   ⚠️ 这一格原先写「47 个文件」，是 playbook §1.6 已宣布改正过两次的老错数：**47 是 `Default for GNOME.xml` 的行数，不是任何文件数**
   （复算 `ls platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui | wc -l` = 27；`wc -l 'platform/platform-resources/src/keymaps/Default for GNOME.xml'` = 47）。`$default.xml` 里 8 处行号逐行核实全中。动作系统那一批据此把本该写「无法核实」的键位活**全做了**（键位表 UI / 只看冲突 / 按下即录 / 冲突三选一 / 恢复出厂）。危害：这条假规约已生产了假的判词，见 `ui-parity-checklist.md:3125` 的旧版本（已同步修正） |
| 运行仪表盘图标 | 上游是六边形+播放三角（`RunDashboardUiManagerImpl.java:145`），lucide-vue-next **无对应字形** ⇒ 保留 `SlidersHorizontal` 并在 `MainToolbar.vue:196-200` 登记为无法核实 |
| LSP 单模块工程的真机行为 | 只到 `.classpath` 内容级判据；"关导入 → hover 外部类型"需要一次人工探针 |
| 设置页 native 侧 | `settings_schema` 已由 native 代理**编译验证通过**（零 error 零 warning），但**未跑** `projects_test` |
| `App.vue` 2702/2737 | 已无可搬的整块，但只剩 35 行余量。**新逻辑一律拆 `src/xxx.ts`**，硬拆会伤组装层本身 |
| Agent / ACP 接入 | **按约定不接**，等 IDE 完成 |

---

## 6. 工具链备注

- **PowerShell only**。正则 pattern 用单引号。
- **native 构建必须先 `call vcvars64.bat`**，否则报「无法打开包括文件 "chrono"」——**这不是代码问题**，别误判。
  vcvars：`C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat`
- cmake/ctest：`C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\`
  （注意是 `CMake\CMake\bin\` 两层）
- 跑全量 ctest 用现成脚本 **`.tools/nctest-all.bat`**（已含 vcvars + 正确路径）。
- 改哪部分跑哪部分测试，**不跑全量** —— 但**每次拆分后必须 grep 被搬走的符号**（见 §1.1）。

---

## 7. 权威文档

| 文档 | 内容 |
|---|---|
| `docs/ui-parity-checklist.md` | 逐条 UI 对齐清单（最大） |
| `docs/ui-placement-audit.md` | 布局/位置审计，含每条的源码坐标 |
| `docs/class-parity-todo.md` | 类级 parity 待办 |
| `docs/settings-parity.md` | 52 个设置节点逐条判定（本会话从 39 个 `[ ]` 收到 28 个，附不做理由） |
| `docs/inventory/verdict-*.md` | 各域判决表（机器生成，`scripts/verdict_table.py`） |
| `docs/handoff-2026-09-28-ui-parity.md` | 上一轮交接，**§4.2 是那次事故的完整记录，必读** |

---

*文档生成时间：2026-10-05 · 生成者：Mavis 会话 `mvs_0a58b7be-b59b-4d8e-9a86-6d1e4c86bd9b`*
