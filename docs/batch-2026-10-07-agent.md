# 批次报告 · Agent 对话并入右栏（2026-10-07）

> 用户需求（2026-10-07，三轮原话合并）：
> ①「并入TaoCode的右侧边栏，添加一个按钮agent对话」「原有Zcode设置，并入TaoCode，单开一栏 Agent设置」
> 「原有项目分区取消，改为自动读取当前TaoCode项目」「对话内的文件改为左侧跳转到对应窗口」
> 「既能在对话窗口内观察到，也能在左侧写代码的窗口观察到红绿diff」「do是保留，undo是撤回，do all保留全部」；
> ②「不要简单复刻，而是移植全量Zcode功能作为保留，接线也是你手动接线，你可以派出子代理」；
> ③「你直接克隆整个源码，完整复刻所有实现」。
>
> 方向裁定（AskUserQuestion，用户选了推荐项）：不内嵌 ZCode 的 Electron/React（塞不进本仓 Vue3+WebView2 壳），
> 用本仓架构复刻同一套用户可见交互；diff/undo 用内存快照；文件跳转 = 编辑器标签页定位。

## 一、这一批落了什么

### 1. 右栏「Agent 对话」工具窗口（全链路已接）

**纯逻辑层（5 个新模块，各配判据）**

| 模块 | 行数 | 职责 | 判据 |
|---|---|---|---|
| `src/agentMessages.ts` | 184 | 回复→渲染分段（文本/代码/计划/**文件引用**），代码块内不误判文件 | `tests/agent-messages.test.mjs`（7） |
| `src/agentEdits.ts` | 209 | 待决改动台账：record 暂存**不写盘**、do 写 after、undo（待决=丢弃不写盘；已落盘=盘上仍是 after 才写回 before，否则 `conflict` 拒绝——**不覆盖用户独立修改**，ROADMAP S5 验收口径） | `tests/agent-edits.test.mjs`（14） |
| `src/agentSession.ts` | 192 | 会话状态机：消息/计划/审批门（走 `decidePermission` 单一真源）/transcript（含拒绝的 error 行） | `tests/agent-session.test.mjs`（13） |
| `src/agentSettings.ts` | 306 | 设置：权限四档 + 差异策略 + **ZCode 形状的 general 键与 providers 表**（见 §3） | `tests/agent-settings.test.mjs`（14） |
| `src/agentHost.ts` | 252 | 装配层：审批→暂存→台账→差异；`assertInsideWorkspace` 工作区边界守卫（拒绝对路径与 `..`） | `tests/agent-host.test.mjs`（21） |

**整条链 async**：宿主文件桥（`request('file.read'/'file.write')`）是 Promise，台账/装配层若假装同步就会在写完成前谎报成功——`AgentEditFiles`/`AgentHostBridge` 全异步化，写失败如实返回、状态保持待决。

**子代理交付（两个，各配判据，主代理逐条验收）**

| 模块 | 行数 | 职责 | 判据 |
|---|---|---|---|
| `src/agentSessions.ts` | 335 | 会话库：50 条上限（超限淘汰 `updatedAt` 最旧）、坏存档逐条救、拷贝语义、`exportActive`（`taocode-agent-transcript/1`） | 23 条全绿 |
| `src/agentCommands.ts` | 149 | 斜杠命令表：**只有 7 条真命令**（new/clear/export/review/keep-all/approvals/settings），冻结表、大小写不敏感、参数守卫 | 10 条全绿 |

**接线（主代理亲手做的四条）**

1. `src/toolWindowMeta.ts`：`TOOL_WINDOW_REGISTRY` 加 `{ id: 'agent', title: 'Agent 对话', icon: Bot(lucide), anchor: 'right', numbered: false, available: isDesktop && hasWorkspace }`——**排在表尾**（枚举序决定 Alt+数字，插中间会挪别人的编号）。上游无对应物（本仓自有窗口），注释写明。
2. `src/components/ToolWindowView.vue`：`v-else-if="view === 'agent'"` 挂 `AgentPanel`；ctx 加 4 个字段（`agentHost/agentProjectName/agentProjectRoot/onAgentOpenSettings/onAgentNotify`）。
3. `src/agentHostWire.ts`（新，150 行）+ `src/App.vue` **一行**调用：`wireAgentHost({ workspace, notify, revealLocation, refreshTree, findTab, editorFor, bumpDocumentRevision, generalSettings })`。写盘口径逐行对齐宿主 `revertHistory`（`expectedVersion`/`encoding`/`bom` + 开着的标签页 `setDraft` + `lsp.change` + 刷新树）——不这么做，写完盘编辑器还显示旧文，「左侧看到红绿」就是谎话。**项目分区**：无选择器，host 只认 `workspace().root`，越界路径一律拒（用户要求「自动读取当前项目」）。
4. 设置页接线：`src/settingsTreeMeta.ts` 加 PageKey `'agent'`（顶层页，排 keymap 后）+ `SettingsDialog.vue` 一行 section（挂 `AgentSettingsPage`，`@navigate` 跳本仓外观/键位页）+ `App.vue` 传 `:persist-agent="persistAgentSettings"`（保存 = 落 localStorage + 立刻 `updateSettings` 同步装配层权限档）。

**Do / Undo / Do All 的最终语义**（测试钉死）：
- `approve`（AG-04 权限门）= 允许执行；写改动此时**只暂存台账，不落盘**；
- **Do** = 写 `after` 落盘（此刻才动磁盘）；
- **Undo** = 待决的直接丢弃（**不写盘**，没有东西要还原）；已落盘的先读盘核对仍等于 `after`，被外部改过就 `conflict` 拒绝并说清原因；
- **Do All** = 批量保留，逐条串行（同文件两条并发写会互踩）。
- 红绿 diff 双出口读**同一份台账**：对话面板内联行 + 编辑器区 `DiffView`（`agentDiff` 三态，与剪贴板对比共用弹层）。

### 2. Agent 设置页 = ZCode 设置面板结构（源码级对齐）

**ZCode 已浅克隆到 `.tools/ZCode`**（`.tools/` 在 .gitignore，不进库）。本页的每一个结构决定都能指到源码：

- 节清单/顺序/图标 = `packages/ui/src/settings/settingsPageConfig.ts` 的 `BASE_SETTINGS_SECTIONS`（三组：基础设置 7 节 / Agent 能力 8 节 / 数据与统计 1 节，browser→computerUse→shortcuts→workspaceFileSearch 收尾）；
- 节标题 = `packages/ui/src/i18n/locales/zh-CN.ts` 原文（常规/外观/模型设置/浏览器控制/电脑控制/键盘快捷键/工作区搜索范围/记忆/子智能体/插件/MCP 服务器/技能/命令/自动化(Beta)/钩子/使用统计）；
- 常规节键名与出厂默认 = `settingsPageHelpers.tsx` 的 `GeneralSectionContent` 逐字照抄（`messageStreamShowReasoning: true`、`zcodeInteractionBehavior: 'queue'`、`TASK_AUTO_ARCHIVE_DAY_OPTIONS = [3,7,14,30]` 等）；
- 模型设置 = personal providers 那一支的形状（名称/BaseURL/APIKey/模型表增删启停）；预设供应商（ZAI/BigModel Coding Plan）要走 OAuth，**不预置假条目**。

**实装 vs 空态（不放假控件）**：
- 实装：常规（Agent 行为 + ZCode general 真实字段）、模型设置（供应商 CRUD + `modelConnectionNotice` 诚实提示）、命令（`AGENT_COMMANDS` 7 条真命令）、MCP（本仓 `taocode_mcp` 的真实事实：stdio/权限档/10 个工具）、使用统计（会话库实测数字）、外观/键盘快捷键（`@navigate` 跳本仓已有页，同一份设置不造两份）；
- 诚实空态（说清 ZCode 那边管什么、本仓缺哪块）：记忆/子智能体/技能/自动化/钩子/浏览器控制/电脑控制/工作区搜索范围/插件。

### 3. 顺手修掉的三个真 bug（用户点名两个）

1. **左下角设置图标错误**：源码已是 `IdeaSettingsIcon`，但运行中的 `dist` 停在 10-06 19:39（lucide CogIcon）——`vite build` 重建后真机复核 `class="idea-icon" viewBox="0 0 20 20"`（IDEA 20 格实心齿轮），`isLucideCog: false`。
2. **应用图标还是旧的**（两处根因）：
   - `native/main.cpp:1841` 窗口类用 `LoadIconW(nullptr, IDI_APPLICATION)`（Windows 默认）→ 改 `LoadIconW(instance, MAKEINTRESOURCEW(1))`，`hIconSm` 同步接上（16 格独立重采样档，缩放大图会糊）；
   - `build/.../app-icon.rc.res` 停在 10-06 22:21 而 `.ico` 是 10-07 00:12——**cmake 只盯 `.rc` 不盯它引用的 `.ico`**，`touch native/app-icon.rc` 强制重编；重编后 exe 内 ico 载荷采样 202/206 命中（重编前 0/206；4 个未命中是 rc 改写目录偏移字段与资源对齐的正常现象）。
3. **右 dock 渲染在左侧**（用户报「agent侧边栏现在是左侧」）：`.explorer-panel.right-dock` 无 `order`，而它在模板里位于左 dock **之前**，workbench 是 flex 按 DOM 序排 ⇒ 右停靠窗口全渲染在最左（Gradle/通知同样中招，Agent 让它显形）。`src/style.css` 补 `order: 98`（编辑器后、右条纹 99 前）。真机复核：dock x 从 31/946(3%) → 675/946(**71%**)。
4. （额外）**他人遗留的 9 条类型错误清零**：`completionSort.ts`（组号 0|1|2）、`completionUi.ts`（`EditorView.inputHandler.of`）、`lspCompletion.ts`（删自造的 `selectOnOpen`，预选落排序链档①）、`selectInTargets.ts`（逆变适配 `asProjectViewTargets`）、`statusBarListener.ts`（`dispatchStatusBarChange` 改收 `StatusBarSnapshot`）。

## 二、门禁数字（收工实测）

| 门禁 | 结果 |
|---|---|
| `npx vue-tsc -b --force` | **0 错** |
| Agent 域 7 份测试 | **102/102**（messages 7 · edits 14 · session 13 · settings 14 · host 21 · sessions 23 · commands 10） |
| `node --test tests/module-size.test.mjs` | **5/5** |
| `find-param-props` / `find-ts-in-mjs` | 0 处 / 干净 |
| `find-missing-ext` | 仅既有 `src/dapEventRelay.ts:19`（他人工作副本遗留，非本批） |
| 孤儿门 `--gate` | 本批 agent 系**全部有生产消费方**（`AgentPanel` 挂在 ToolWindowView）；门禁仍红 **8 个新增孤儿全是他人中止 lane 的遗留**（`statusBarListener`/`detachedEditorsHost`/`switcherHost`/`mavenModel`/`pluginMarketRemote`/`virtualFilePointer`/`documentationBrowser`/`icons/index.ts`），不在本批文件面内 |

**保留文件余量（口径 `split('\n').length`，注意门禁把末尾换行算一行）**：
`src/App.vue` **2679/2680 = 1** ｜ `src/components/SettingsDialog.vue` **1181/1182 = 1**（两处都贴顶：本批把 Agent 接线压成单行/并排 section 才挤回限内；**下一个要动这两个文件的人必须先拆再写**）。

## 三、真机取证（exe + CDP，端口 9341）

| 项 | 证据 |
|---|---|
| 左下角设置图标 | `settingsIcon: { isIdeaIcon: true, isLucideCog: false, viewBox: "0 0 20 20" }`（build/verify-1 截图） |
| Agent 条纹按钮 | 右侧工具栏，`disabled: false`，位于 通知 之前 |
| Agent 面板 dock | `onRightHalf: true, dockX 675/946`（修复前 31/946）；`inRightDock: "explorer-panel right-dock"` |
| 面板内容 | 标题栏=当前项目（**无项目选择器**）、状态行「本地假模型 · 空闲」、输入框/齿轮/空态齐 |
| 设置页 | Ctrl+Alt+S → Agent 节打开；三组标题与 16 节齐（`active: 常规`）；切「使用统计」显示真实数字（会话 0/50 · 消息 0 · 本地假模型） |
| exe 图标资源 | 内嵌 ico 载荷 202/206 窗口命中（重编前 0/206）；窗口类已接 `IDI_TAOCODE`（任务栏/标题栏生效需用户重启 exe 后看，本轮 exe 即新编） |

**取证方法注意（坑都踩过）**：条纹按钮的激活必须用 **CDP 真鼠标坐标点击**（`clickText` 时灵时不灵，合成 `el.click()` 推不动 Vue 事件链——`scripts/realdbg.py` 的 `{"click":[x,y]}`）；点击前要先 `getBoundingClientRect` 取本次会话的坐标（窗口重开坐标会变）；steps.json 里 **不能写 `\\s` 这类 JSON 转义**（python json 解析直接炸，用 `\\u0020` 或不用正则）。

## 四、遗留与下一步（按优先级，下个会话从这里接）

1. **对话流真机验证未完成**：在 untitled 示例项目上发消息后 `busy` 卡 true、`messages: 0`——怀疑真 exe 对 untitled 工作区的 `file.read` 挂起（`await` 链不返回）。**先换真实磁盘项目复验**（记忆口径：VCS/工作区类要在 `D:/TaoCode/.tools/ui-parity-proj` 上验；换工作区 = 改 `%LOCALAPPDATA%/TaoCode/projects.json` 的 lastProject 再启动）。若确认为 untitled 挂起，这是 `agentHostWire.readFile` 需要超时兜底的产品 bug。
2. **会话库/斜杠命令尚未接进 AgentPanel**（模块+判据已交付）：面板头部加会话下拉（`createAgentSessionStore` 的 summaries/open/create/remove）+ `send()` 里拦截 `/` 输入走 `parseAgentCommand` 派发到既有动作；`general.messageStream*`/`taskAutoArchive*` 开关同步接面板渲染与会话库淘汰。
3. **设置页空态逐节落地**（ZCode 源码就在 `.tools/ZCode`，逐节对着做）：记忆（工作区 MEMORY.md 视图）→ MCP（真正的服务器表单）→ 子智能体 → 技能 → 自动化 → 钩子 → 浏览器/电脑控制（依赖真模型授权）。
4. **真模型接入**（AG-01）：providers 表已有存储面；接通前 `modelConnectionNotice` 必须继续显示「尚未接入联网模型」——这是产品承诺，有判据钉着，别删。
5. `HANDOFF.md` 顶部状态段未更新（本文件即本批交接；合并时把 §四 的 1-2 条写进 HANDOFF 顶部的「下一个会话从这里接」）。
6. 两个贴顶文件的拆分预案：`SettingsDialog` 下一步优先把「外观」大节拆出组件；`App.vue` 再加接线一律走「新模块 + 一行调用」（本批 `wireAgentHost` 的样板）。

## 五、本批改动文件清单

新建（12）：`src/agentMessages.ts` `src/agentEdits.ts` `src/agentSession.ts` `src/agentSettings.ts` `src/agentHost.ts` `src/agentHostWire.ts` `src/agentSessions.ts`(子代理) `src/agentCommands.ts`(子代理) `src/components/AgentPanel.vue` `src/components/AgentSettingsPage.vue` + 7 份 `tests/agent-*.test.mjs`（含两份子代理的）。
修改（9）：`src/toolWindowMeta.ts`（注册表 +1 条）`src/components/ToolWindowView.vue`（ctx +5 字段 + 挂载）`src/toolViewContext.ts`（透传）`src/App.vue`（净 +1 行接线 + diff 弹层并轨）`src/settingsTreeMeta.ts`（PageKey + 节点 + PAGE_KEYS）`src/components/SettingsDialog.vue`（+1 行 section + persist prop）`src/style.css`（right-dock order:98）`native/main.cpp`（窗口图标 2 行）`src/settingsPersistence.ts`（section 联合类型 +1）。
他人遗留修复（5，见 §1.4）：`completionSort` `completionUi` `lspCompletion` `selectInTargets` `statusBarListener`。
资源：`native/app-icon.rc` 仅 touch（强制 rc.res 重编），ico/png 源未动（`tests/app-icon.test.mjs` 5/5 依旧全绿）。

## 六、做不到 / 无法核实

- ZCode 的 OAuth 登录、Coding Plan、浏览器/电脑控制、插件市场同步：依赖真实服务与授权，本仓未接，**不放假控件**（各节空态里写明缺什么）。
- 「功能全部相同」的完整覆盖是多批次工程：本批交付 = 结构 100% 对齐 + 5 节实装 + 9 节登记缺口；逐节落地路线在 §四.3。
- untitled 项目上 `file.read` 是否真挂起：本轮未定位到根因（§四.1 是复验步骤，不是结论）。
