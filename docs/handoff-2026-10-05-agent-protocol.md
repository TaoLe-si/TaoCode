# 交接文档 · 2026-10-05 23:00

> **本文档写给下一位主代理。** 目标是让你在 10 分钟内接管并继续推进，不必重读这一天的全部过程。
>
> 分支 `parity/rebuild-inventory` · HEAD `63056b7 feat(parity): 批 98–116`（**未提交**）
> 工作区 **924 处改动**（269 已修改 + 655 未跟踪新增）· 543 个 `src/*.ts` · 118 个 `.vue` · 99 个 `native/*.cpp` · 461 个测试文件
> `App.vue` 2653/2737 · `CodeEditor.vue` 1138/1147

---

## 0. 三十秒版本：现在是什么状态

| 维度 | 状态 |
|---|---|
| `npx vue-tsc -b --force` | ✅ **0 错**（22:00 实测） |
| 前端全量测试 | ⚠️ **3711 用例 / 3695 通过 / 16 失败**（22:20 实测；**这 16 条已被拆给 3 个 worker，但 worker 被中断，未确认是否修完**） |
| `tests/module-size.test.mjs` | ✅ 5/5 |
| 三个检测器 | ✅ 全干净（`find-param-props` 0 / `find-ts-in-mjs` 干净 / `find-missing-ext` 干净） |
| 死模块门禁 | ✅ 绿（`node .tools/find-orphan-modules.mjs --gate`） |
| native `ctest` | ⚠️ **本轮最后一次全量 37/37 是 20:00 前的状态，之后 native 有改动，需重跑** |

**接手第一件事**：跑 `npm test`，看那 16 条还在不在。

---

## 1. 三条硬约束（违反即使功能做对也等于没做）

### 1.1 工作区是唯一现场，不许清理

924 处改动**绝大多数未提交**。
**禁止** `git checkout --` / `git reset` / `git stash` / `git clean` —— 会毁掉他人未提交的工作。
上一会话已经因此**丢过 630 行测试**（记录在 `docs/handoff-2026-09-28-ui-parity.md` §4.2）。

### 1.2 UI 对齐只认上游源码树

判定基准唯一：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
**每条结论必须给「文件相对路径 + 行号」**；指不到就写「无法核实」；**禁止图像/截图比对**、禁止「IDEA 一般是…」这类经验值。
安装目录 `D:\IntelliJ IDEA 2026.2` 只能读 `lib/` 里的**上游资源文本**（theme json / Scheme xml），不许反推像素。
中文文案可从 `plugins/localization-zh/lib/localization-zh.jar` 解出读**字符串**。

> ⚠️ **「按文件名搜不到」≠「功能不存在」。** 提交前后重写、模块搬迁都会让文件名变。
> **必须按包路径 / 语义 / XML 里的 `id` 三条路各搜一遍再下结论。**
> 这条不是理论风险：规约里曾写着「`platform/keymaps` 整个目录不存在」，被独立验收证伪 —— 它存在
> （`platform/platform-resources/src/keymaps/` 10 文件、`$default.xml` 1308 行、
> `platform-impl/.../keymap/impl/ui/` 27 文件、`plugins/keymaps/` 10 目录 26 XML）。
> 那条假规则**实际生产了假的「无法核实」判词**（`docs/ui-parity-checklist.md:3125`/`:3420`、`HANDOFF.md` 顶部），已全部修正。
> **教训：写"有 N 个文件/行"这类数字要亲自数，不要从别处抄。** 我第一版改写时把「47」写成文件数，而 47 其实是 `Default for GNOME.xml` 的行数。

### 1.3 行数上限只能靠拆模块下调

`tests/module-size.test.mjs` 是**唯一权威**（`DEFAULT_LIMIT=900` / `NATIVE_DEFAULT_LIMIT=1100` / `_test.cpp` 1300，含 `REGISTERED` 与 `NATIVE_REGISTERED`）。
**不许调高上限**。新文件超了就继续拆。

---

## 2. 本轮建的基础设施（务必先读，都是常驻规约）

| 文件 | 作用 |
|---|---|
| **`docs/agent-playbook-parity.md`** | ⭐ **子代理必读的作业规约**。取证口径 / 架构不等价怎么办 / 假控件铁律 / 共享工作区纪律 / 代码规范 / 验证纪律 / 报告格式 / 三条系统性禁令（参数属性、`.mjs` 纯 JS、嵌套注释） |
| **`docs/wiring-requests-2026-10-05.md`** | 22 条接线请求总清单（7 个桶交出来的，跨桶落地用） |
| **`docs/tsc-error-snapshot-2026-10-05.md`** | 树状态快照 + 已修/未修的发现。**持续追加，收尾前再读一次** |
| `.tools/find-param-props.mjs` | 查 TS 参数属性（会让整个测试文件加载失败） |
| `.tools/find-ts-in-mjs.mjs` | 查 `.mjs` 里混的 TS 语法（同上症状） |
| `.tools/find-missing-ext.mjs` | 查漏 `.ts` 扩展名的相对 import（同上症状） |
| `.tools/find-orphan-modules.mjs --gate` | **死模块门禁**：零生产消费方的模块 + 基线制 + 可反查 |
| `.tools/orphan-report.md` | 18 个死模块的逐条分类 |
| `scripts/verdict_table.py` | 判词生成器。⚠️ **它会就地重写 `docs/inventory/verdict-*.md`**，且只重写被点名的域。加 `--check` 是待办 |

**三个检测器都做过反向验证**（注入违规确认会红）。`.tools/` 已 gitignore。

---

## 3. 本轮做出来的东西（别重做）

### 3.1 真 bug（不是编译错，是行为错）

| 缺陷 | 落点 |
|---|---|
| **省电模式停不掉主题水纹** | `::view-transition-*` 不被 `*` 降级覆盖（`src/themeRipple.ts:43`） |
| **单模块工程 LSP 彻底失灵** | workspace folder 被派生成 `build/`，工程源码落在工作区外 |
| **工具窗口挪到底部切不回来** | 锚点搬运不带可见性（对照 `ToolWindowManagerImpl.kt:1700-1726`） |
| **网页链接注解器每跑必崩** | `WEB_URL` 缺 `g` 标志而 `webUrlsIn` 用 `matchAll` |
| **`fileTypeRegistry` bundled 规则反了** | 上游 `FileTypeBean.java:29-30` vs `:36-41`（对照） |
| **`.analysisignore` 换工程后从不重读** | `refreshProjectAnalysisIgnore()` 先置幂等标志再调加载函数，加载函数立刻短路返回 |
| **`editorConfig` 根目录那份永远匹配不到** | `relativeTo('')` 被 `if (from && …)` 挡掉；`makeEditorConfigReader` 拼出 `/.editorconfig` 越界路径 |
| **两处编造文案** | VCS 域的 TODO 失败数、主题超长提示 |
| **两处字形冒充图标** | `↑ ↓ ✕` → lucide（`CommonActionsPanel.java:67/79/85`） |
| **「设置」用滑块** | 应是齿轮（`SettingsEntryPointAction.java:108` / `AllIcons.java:581`） |
| **4 处「源码在骗人」几何** | CSS `width` 覆盖了模板 `:size` |
| **`TestRunnerPanel` 两个按钮无图标** | 模板写 `ChevronUpNav`/`ChevronDownNav`（不存在），应为 `ChevronUp`/`ChevronDown` |

### 3.2 新增的大块功能（都已带判据测试）

- **文件选择器**全套（树导航/最近/收藏/文件名输入/两种视图模式/大小写冲突检测/覆盖确认）—— 上游 `FileChooserDescriptor.java:296-337` + `FileSystemUtil.java:201-259`
- **键位表 UI** + 动态动作层 + 冲突三选一 + 恢复出厂（`KeymapPanel.java:529-537`/`576-582`、`KeymapSchemeManager.java:139-142`）
- **动作宏注册成动作**（`ActionMacroManager.kt:395-423`）—— 此前整族是死的，宏进不了 Find Action 也绑不了键
- **Live Template 引擎** 490 行（`#if`/`#elseif`/`#else`/`#end`/`#set`/`#parse`、单遍展开、`${DS}` 转义）+ 加载器 + 设置页
- **终端动作上下文层** 245 行（`TerminalActionUtil.java:36-78`）
- **外部工具结构化编辑器**（`Tool.java:57-76` 13 字段 + `ToolEditorDialog.java:137-138`）
- **弹层定位/尺寸**（`PopupPositionManager.java` 全族逐行）+ `PopupShowOptions` 九个角点公式
- **LSP 会话状态迁移闸**（`LspClientImpl.kt:80-90`）+ 语言服务状态面
- **通知声音**（上游 AWT `Toolkit.beep()` → 本仓 Web Audio 880Hz 两声，已注明是本仓选择）
- **项目颜色九宫格**（`ChangeProjectColorActionGroup.kt:33-44` 的 index 次序 + `RecentProjectIconHelper.kt:468-487`）
- **块注释智能选择器 + 扩展选区**（`BlockCommentSelectioner.java:26-37` / `ExtendWordSelectionHandlerBase.java:109-127`）
- **诊断码 → 检查项** 整链（`ProblemsViewState.kt:28` 的 `groupByToolId`）

---

## 4. 主代理 / 子代理工作模式（你要用的）

### 4.1 切分原则

1. **先机械普查，别凭印象派活。** 用 `scripts/inventory_gaps.py` + `scripts/verdict_table.py` 复跑拿真数，**不要引用文档里的断言**（文档自己会腐烂，本轮已被独立验收抓出 4 处过期判词）。
2. **按「文件所有权」切，不按「功能概念」切。** 每桶必须有一份**互斥的文件清单**，并把争用文件（`App.vue` / `CodeEditor.vue` / `style.css` / `tokens.css` / `uiIcons.ts` / `settingsModel.ts` / `settingsTreeMeta.ts` / `bridge.ts` / `menus/*`）划给**唯一一个**桶。
3. **「规则层齐、只差挂载」的单独立一个接线桶。** 它必须单线串行（本轮就是 `App.vue` 余量不够，两个人同时接必炸）。
4. **纯诊断用只读 agent，修复另派 worker。** 避免诊断 agent 顺手改了东西。

### 4.2 每个子代理的提示词必须含（缺一条就会翻车）

- **指路两份文档**：`docs/agent-playbook-parity.md`（硬约束）+ 当批的判词文件/快照
- **上游源码根绝对路径**
- **文件所有权两栏**：「你拥有」逐个列全 / 「只读」逐个列全，**并写明为什么**（例：「`App.vue` 刚被 X 压到 2653/2737，余量只有 84 行 —— 绝对不要碰」）
- **行数预算表**（当前值 + 上限 + 余量）
- **三条系统性禁令**（参数属性 / `.mjs` 纯 JS / 嵌套注释）—— 这三个症状都是「整个文件加载失败」，极难定位
- **`npx vue-tsc -b --force` 必须带 `--force`**（不带是增量构建，会给假阴性）
- **验证纪律**：只跑自己域的测试，**不要跑全量**；新门禁必须**反向验证**（注入违规确认变红，再还原）
- **报告格式**：判词表（族/项/判定/**上游 相对路径:行号**/本仓落点 文件:行号）+ 改动文件 + 验证 + **做不到/无法核实**
- **「接线请求」一节**：需要动别人文件时交请求，**不许自己动**

### 4.3 监督纪律（本轮踩过的坑）

| 坑 | 教训 |
|---|---|
| **一个 agent 塞爆 `App.vue` 让全仓 `module-size` 红** | 交接件里必须写**行数预算表**并要求「逻辑进新文件、组件只做接线」；**每接一处就跑一次门禁**。本轮靠中途 steer 才没烂尾 |
| **派 32 个并发 → 上游 2066 超时雪崩** | 平台并发上限是**硬约束**（本会话实测 4）。要么降到 4 以内，要么排队「一空就派」。**别硬撑** |
| **`task_append` 对 failed 任务报 `TASK_APPEND_ACTIVE_TURN_UNMAPPED`** | 失败的任务**续不了**，只能重派并写详细交接摘要（本轮两份重派任务书都是几百行的完整上下文交接） |
| **失败任务的子会话仍占槽位** | 报 `SUBAGENT_CONCURRENCY_LIMIT` 但只有 2 个在跑时 → 归档那个失败会话（`session update --archived true`）才释放 |
| **虚构的测试钩子盖住真 bug** | 上一轮代理凭空发明了 `bridge.__setBridgeTransportForTests`（`bridge.ts` 里根本没有），5 条用例 0 通过。换成依赖注入后**底下露出真 bug**（`.analysisignore` 从不重读盘）。⇒ **测试用不存在的 API 是个信号，不是小事** |
| **子代理报告 ≠ 事实** | 本轮子代理**顶了我的错误前提**至少 4 次（上游 `platform/keymaps` 存在、提交列表分组上游没有、`code`/`tags` 其实透传、nav-toolbar 前提不成立）。⇒ 报告要**核**，不**信** |
| **我自己写的文档也会产假话** | 规约里一句「某目录不存在」→ 生产了 3 处假的「无法核实」判词。⇒ **常驻规约里的每条事实声称都要能被独立验收** |

### 4.4 独立验收（**强烈建议保留这一步**）

派 `verifier`（只读）**专门证伪**子代理的报告，提示词里写死：
> **默认这些报告是错的，你的任务是找出哪条站不住。** 不确定就说不确定。

它要查的五类：
1. **上游坐标逐行核实**（不是"文件里有这个词"就算数）；行号漂移 >±15 行要报
2. **「无法核实」的声称是否诚实**（抽查 5 条，确认真的搜不到）
3. **测试数字是否吻合** + **有没有为了让门禁变绿而删测试/弱化断言**（`git diff --diff-filter=D -- tests/`、`.skip(`/`.only(`、`module-size` 上限有无**向上抬**）
4. **假控件扫描**（硬编码 `v-if="false"` / `:disabled="false"` / 无 handler 的按钮 / Unicode 字形冒充图标）
5. **越权**（有没有 agent 改了自己不该改的文件）

**它的产出真实有用**：本轮两轮验收共找出 12 处问题，其中 6 处是**我自己文档里的假话/假数字**，2 处是子代理的硬错（把文件行数当文件数、宣称修正了判词但一处没改），还有 2 处是新冒出来的真产品缺陷。

⚠️ 给验收员的约束：**别让它跑会写盘的东西。** 本轮 `python scripts/verdict_table.py` 被它当"复核计数"跑了，**那个脚本会就地重写判词书**——"复核"这个动作本身在改被复核对象。给 `verdict_table.py` 加 `--check` 是待办。

---

## 5. 已知未完成（接手就能干）

### 5.1 那 16 条红测试（22:20 快照，可能已被中断的 worker 改了一部分）

| 测试 | 症状 | 归属 |
|---|---|---|
| `tests/b7-verdict.test.mjs` | `AssertionError: 缺 §G 逐条总表`（整文件） | 判词表 |
| `tests/editor-custom-fold-regions.test.mjs` | 4 条断言（区域排序/落点/占位文字/上下一个） | 自定义折叠 |
| `tests/about.test.mjs` | 「关于」带构建号 | 平台外壳 |
| `tests/internal-errors.test.mjs` | 芯片组件自包含 | 平台外壳 |
| `tests/main-toolbar-render.test.mjs` | 整文件失败（2029ms） | 工具栏 |
| `tests/tool-view-activation.test.mjs` | 整文件失败（**11205ms，疑似真定时器变慢或死锁**） | 工具窗口 |
| 动效门禁 | `interactive 的 :hover 改了背景/颜色/透明度就必须有 transition` | 某个新加的 `:hover` 没跟令牌 |

**接手先跑 `npm test` 拿当前实况**，别直接信这张表。

### 5.2 死模块（`node .tools/find-orphan-modules.mjs --gate` 当前绿，但基线里还挂着 15 个）

`.tools/orphan-report.md` 有 18 条的逐条分类。**其中 1 个确定做不到**：`src/agent.ts`（无模型后端，面板属 ROADMAP phase 2）—— **别碰**。
另有 3 个已在本轮被接上（`aboutInfo.ts` / `statusBarLifecycle.ts` / `KeymapDialog.vue`），**基线该更新了**（门禁会提示「✔ 已接上」）。

### 5.3 跨桶接线（`docs/wiring-requests-2026-10-05.md` + 各桶交接件）

**性价比最高的一条**（平台外壳桶交的，一行接线激活整条链）：
> `src/lspCompletionStartup.ts:32` 的 `lsp.open` 回包之后加一行 `applyLspLanguageStatus(status)` ——
> `lspSessionStates` 目前**零生产写入方**，而 `lsSessionState` + `lsFeaturesWidget`（231 行）全都等着它。

其余高频挂点：`FileTree.vue`（文件拖放宿主）、`SearchEverywhereDialog.vue`（弹层实时更新宿主）、`runConfigEditors.ts` + `runConfigTree.ts`（加 `'jar'` 必须**一起**改，单改 `settingsModel.ts` 会 TS2741）。

### 5.4 待补的规约/工具改进

- `scripts/verdict_table.py` 加 `--check` / `--dry-run`（现在会就地重写判词书）
- `tests/source-citations.test.mjs` 的 `verifyCitations` **只校验「行号 ≤ 文件长度」** ⇒ 行号漂到别的方法上它抓不到。**建议加"断言该行内容含某关键词"**
- `docs/agent-playbook-parity.md` 里若还有别的"目录不存在"类声称，逐条自数一遍

### 5.5 明确**不要做**的（有上游依据，别翻案）

- **提交列表按天/作者/提交者/仓库分组** —— 上游 vcs-log 树**不存在**（全树 `VcsLogGroupBy` 零命中）
- **Git Log 过滤器历史** —— 检索只命中 file history（另一功能）
- **`settings.sync` / SSH 部署 / UAC 提权 / 密码保险箱 / GDPR 同意** —— 依赖 IDEA 专有后端或本仓不做遥测
- **IDEA「已导入的模型」里的依赖 jar** —— 没有解析器；扫 `~/.gradle/caches` 会把整个缓存挂上类路径 = 假实现
- **「改某一次具体提交」下拉** —— 落点是内存内 autosquash rebase，只做下拉而 `--amend` 仍打 HEAD = 假控件
- **`OpenProjectAction` / `EditRecentProjectsAction` / `ResetLayoutAction` / `UISettings.java`** —— 这四个按文件名在本 checkout **确实搜不到**（已两轮验收核实），写「无法核实」是对的

---

## 6. 环境与工具链

- **PowerShell only**。正则 pattern 用单引号。
- ⚠️ **禁止用 `Get-Content | Set-Content` 改文件**（PS 5.1 默认编码有损，会把中文写成乱码）。用 `edit` 工具或 `write`。本轮已有 agent 踩中。
- **native 构建必须先 `call vcvars64.bat`**，否则报「无法打开包括文件 "chrono"」—— 那是环境问题不是代码问题。
  vcvars：`C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat`
  cmake/ctest：`C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\`
  **跑全量 ctest 用现成脚本 `.tools/nctest-all.bat`**（已含 vcvars + 正确路径）
- **新增 `native/*.cpp` 必须注册进 `CMakeLists.txt`**，否则不参与构建
- 图标走 `lucide-vue-next`，尺寸从 `src/uiIcons.ts` 的 `iconSize.*` 取，**不许模板里写 `:size="14"`**；纯图标按钮要 `title` + `aria-label` + `padding: 0` + svg 带 `flex-shrink: 0`
- 浮层用 `--popup-border` / `--popup-shadow` / `--popup-radius` / `--popup-foreground`（有门禁）
- 动效走 `--dur-*` 令牌，**不许硬编码毫秒 / cubic-bezier**

---

## 7. 三个"症状相同、病因不同"的坑（最容易浪费一整天）

这三种都表现为 **「某个测试文件整体加载失败」**，而不是某条断言红：

| 病因 | 检测 |
|---|---|
| **TS 参数属性** `constructor(private x: T)` —— Node strip-only 不支持 | `node .tools/find-param-props.mjs` |
| **`.mjs` 里混了 TS 语法**（`npm test` **不带** `--experimental-strip-types`） | `node .tools/find-ts-in-mjs.mjs` |
| **相对 import 漏 `.ts` 扩展名** —— Node ESM 解析不到 | `node .tools/find-missing-ext.mjs` |
| **块注释里写裸 `/*`** —— TS 块注释**会嵌套**，Node strip-only 直接吞掉后续代码 | `grep '^\s*\*.*/\*'` |

**先跑三个检测器，再看测试失败。** 本轮全仓从这四类里清掉 7+1+1+若干。

---

## 8. 这个项目的判词（决策记录）体系

`docs/inventory/verdict-*.md` 每族一行，写着「本仓落点 + 缺什么 + 上游依据」，由 `scripts/verdict_table.py` 从脚本里的 `FAMILIES` / `PLATFORM_FAMILIES` 表**生成**。

- **判词真源在 `.py` 里，不在 `.md` 里。** 改判词要改 `.py` 然后重新生成，**不要手改 `.md`**。
- 当前四档计数（22:35 重算）：`platform_rest [~] 5423 · execution [~] 978 · xdebugger [~] 338 · projectviews [~] 574 · daemon [~] 349`，`[ ]` 全域归零。
- **本轮教训：判词会过期。** 两轮验收查出 4 处「判词说缺、实际早已落地」和 3 处「判词说 17、实际 16」。**判词不是事实，是待核实的断言。**

---

*生成时间：2026-10-05 23:00 · 生成者：Mavis 会话 `mvs_716fe88d80984389be1f5eb37b9bc645`*
*本文档只写「已验证」与「已核实」的结论；未核实的一律标了「无法核实」或「待核实」。*
