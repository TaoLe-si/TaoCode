# TaoCode UI 与 ZCode / IDEA 移植交接

日期：2026-10-08  
交接目标：GLM 5.3

## 目标与顺序

先完成 Agent 对话等现有界面的视觉重构，再继续 ZCode 功能全量移植和 IntelliJ IDEA 对标移植。功能含义以 .tools/ZCode、IDEA 上游源码和仓库现有判据为准。

用户明确要求：不要擅自添加产品解释文案；清理没有上游或真实状态依据的多余说明；不要编造逻辑。界面上的模型、推理档位、模式、状态或动作必须接入真实数据和执行链。外观取舍与产品行为分开记录，不把本地设计偏好写成上游要求。

## 接手先读

1. .agents/skills/taocode-ui-visual-tension/SKILL.md：本轮整理的 UI 视觉方向与 TaoCode 约束。
2. HANDOFF.md：此前交接和已完成批次，注意顶部日期为 2026-10-07。
3. docs/ui-parity-checklist.md、docs/source-todo.md：IDEA 对标记录和待办/不做判定。
4. .tools/ZCode：ZCode 实际源码；文案、设置模型和交互需回到对应源码确认。
5. src/tokens.css、src/uiIcons.ts：本仓颜色、几何与图标规则。

## 当前工作树状态

工作区有大量并行迁移改动，且多个当前组件是 Git 未跟踪文件；不能从 Git diff 还原这些新文件的初始版本。开始修改前先读完整文件、检查工作区状态并确认文件所有权。不要用 checkout、reset、stash、clean 或整文件覆盖来“整理”工作区。

### Agent 对话与设置

- 模型选择器与草稿/会话模型选择持久化在 `src/components/AgentPanel.vue`、`src/components/AgentModelSelectPop.vue`、`src/components/AgentSessionPop.vue`、`src/agentSessions.ts`。
- GLM 已补模型元数据的类型、归一化、设置编辑器、CEL 推理映射校验和 provider 请求格式转换；会话选择保存 `{ model, options.reasoningLevel }`，换模型时清理旧档位。
- `src/agentHost.ts` 冻结首轮模型和推理档位，工具续发沿用同一请求上下文；`src/agentHostProtocol.ts` 按模型声明的 reasoning map 编译 JSON patch。Agent 面板已渲染 `AgentThoughtLevelSelect.vue`，只在模型有非空档位和映射时显示；没有暗设默认值，单档且已选时按上游显示为静态项。
- 请求输出 token 取模型声明的 `maxOutputTokens` 上限；没声明时保留当前 32,000 默认值，与 ZCode `resolveNormalRequestMaxOutputTokens` 一致。`maxOutputTokens.map` 已接入模型字段归一化、保存前编译校验及请求期 JSON patch；有映射时要求有效正整数上限，实际请求前映射失败即拒绝发送。当前元数据表单没有该映射的编辑项，提交时保留已有映射，对应 ZCode `ProviderModelMetadata.ts:277-279`。`contextWindow` 已按 `resolveModelStepMaxOutputTokens` 为首轮和工具续发估算剩余预算，估算口径复用 `estimateMessageTokens` 的每条消息字符数除以 3、再预留 1,000 token；本仓没有真实 provider usage 时只用本地估算。
- 模型元数据链仍未全量：`outputFormat.supportsText` 已有可空字段类型、localStorage 归一化，完整性判定保留该字段；`ModelMetadataSection.vue` 没有编辑控件（上游也不提供）。`supportsToolCall`、`requiresMfjsToolSchema` 已本地建模并接到工具请求检查/schema 引用转换。ZCode 新建空模型草稿初值 `supportsToolCall: true`（`ProviderCardSections.tsx:330-344`），但用户输入模型 ID 后草稿会改用已解析的继承配置（`useProviderModelDraft.ts:60-66`），旧配置缺字段没有 true 的迁移默认：上游 complete schema 要求显式布尔值（`shared/src/model-config.ts:64-82`），运行时也按缺失即不支持拒绝带工具请求（`adapters/src/model/model.ts:156`）。本地归一化保留旧记录缺字段；请求带工具仅在 `supportsToolCall` 显式为 true 时发送，缺失或 false 均拒绝。`supportsJsonSchemaOutput`、`supportsNativeWebSearch`、`supportsMidConversationSystem` 等已保存能力尚未全部接入运行时；API key 仍随设置写入 localStorage。`validateAgentModelProviderTable` 已接入设置页现有保存问题列表与保存门禁；已有 provider 的名称、Base URL、API Key、API 格式可在设置页编辑，名称确认、连接字段失焦或格式变更只更新设置草稿，最终由页面“保存”持久化（ZCode 对应 InlineEditableProviderCard.tsx:405-444、572-612 会直接提交草稿）。编辑复用现有 provider draft resolver，写回只涉及四个供应商字段并保留 models。ZCode 校验路径见上游源码 `.tools/ZCode/packages/provider/src/config/provider-config.ts:463-466`、`facades.ts:258,295`，问题结构见 `config-overlay.ts:1-14`。
- `supportsNativeWebSearch` 尚无本地 Agent WebSearch 工具、权限执行与结果消费链；上游可确认的 provider-native 编码也只覆盖 Anthropic，不能仅凭 capability 注入工具。`supportsMidConversationSystem` 需要有来源的 reminder entry；本地历史只有普通 `AgentModelMessage`，不能从文本标签猜来源。`supportsJsonSchemaOutput` 没有本地结构化输出请求路径。
- 面板的当前视觉采用更明确的明暗面、左侧强调线和收窄消息阅读宽度。此轮修复了长计划文本的收缩、操作行换行、命令候选长路径和滚动，以及可能包含中文的状态/路径/参数/diff 小字号。文件当前 898 行，仍需保持模块大小门禁。
- `AgentSessionPop.vue` 修复了重命名时 Escape 被面板捕获而卸载弹层的问题；会话行动态计数提到 12px。`TabContextMenu.vue` 有右键子菜单的 → 展开并聚焦、← 收起并将焦点还给父项的键盘处理。
- `MemorySettingsSection.vue`、`SkillsSettingsSection.vue` 里本地新加的说明段落，以及未使用的 `modelConnectionNotice` 文案函数已移除；保留字段标签、校验错误和真实运行状态。
- src/components/AgentSettingsPage.vue、src/components/agent-settings/AutomationsSettingsSection.vue、src/components/AgentMessageContent.vue 也属于当前 Agent UI 工作面。任何文案清理都须确认不会删掉真实权限、错误或执行状态。

### IDEA 与弹层工作

- `src/components/TabEntryPoint.vue`、`src/components/ToolWindowAnchorMenu.vue` 已有弹层视口定位/键盘交互改动；逐项核对 IDEA 对应行为及 `docs/ui-parity-checklist.md`，不要扩大成没有依据的新交互。
- File > 文件属性 > 行分隔符已补 Classic Mac OS (CR)，复用现有原生转换通路。菜单上下文没有当前缓冲区分隔符，故目前没有“目标分隔符与当前值相同则禁用”的行为；不要伪造该判据。状态栏三档转换、IDEA `SPEEDSEARCH` 键入动作搜索及隐藏当前档已接入。
- IDEA 全量移植尚未完成。以仓库现有判决表和待办为准逐条推进；功能不存在于宿主时，先查证是否可实现，再记录差异，不做假控件。
- VCS log 已接入 IDEA `MERGE_COMMITS` 高亮器：菜单使用已核对的唯一上游资源原文 `Merge Commits`；缺省启用并随现有仓库根视图偏好持久化；只降低未选中且 `parents.length >= 2` 提交文字前景，选中行优先级不变。IDEA source tree 没有该 key 的 zh_CN 翻译；其他高亮器仍列在 `docs/source-todo.md` §11。

## 验证记录

- `npm run build` 在 Agent 推理档位、模型上限映射、`outputFormat` 往返、状态栏 speed search 和 `MERGE_COMMITS` 改动后通过。Vite 报告主 bundle 超过 500 kB，但构建成功。
- 本轮未运行测试；仅同步了 `vcs-log-presentation.test.mjs` 中随新增菜单项和默认值变化的既有期望。
- 当前 http://127.0.0.1:5173/ 预览只展示欢迎页，没有原生宿主里的 Agent 面板。因此 Agent 面板的真实宽度、弹层和完整消息流尚未通过该浏览器预览验收。

## 后续执行顺序

1. 在 TaoCode 原生宿主实际查看 Agent 对话，验收选择器、焦点、窄宽布局和弹层边界；当前浏览器预览仍只有欢迎页，不能当作 Agent 面板视觉验收。
2. 继续 ZCode 模型设置缺口：`outputFormat.supportsText` 已无损往返，上游没有请求消费点；有真实本地数据和执行落点时再接其余模型能力。`supportsNativeWebSearch` 仍需 Agent WebSearch 工具、权限、provider-native 编码和结果消费链；`supportsMidConversationSystem` 仍需本地可承载 reminder source/位置的会话 entry 类型。
3. 回到 `docs/ui-parity-checklist.md`、`docs/source-todo.md` 与 `.tools/ZCode`，继续逐项闭合 ZCode / IDEA 移植，并同步判据文档。
4. 继续审阅 `src/components/TabContextMenu.vue` 的角色、Escape、焦点恢复和方向键子菜单行为；此轮仅有差异键盘操作的静态代码审阅，未做运行时 UI 验收。

## 协作与会话

当前代理运行环境并发上限为 4（协调代理加最多 3 个子代理），无法同时维持用户期望的 30 个；任务拆分时尽量填满可用槽位，代理结束后有后续工作再补位。

用户提供的 TaoCode 会话 ID sess_b31760c5-8276-4a4f-b717-7916e33ba4b6 不是当前 Codex 线程 API 可读/可发消息的线程标识。此文档和 Skill 已放入仓库；需要由用户或 GLM 5.3 会话直接读取这些路径。

## 2026-10-08 当前暂停点（交给 GLM 5.3）

用户要求我停止工作并交接。三个仍在运行的子代理均已中断；不要假定它们会继续或已经验证结果。当前工作区保留全部并行中的未提交修改，严禁 `reset`、`checkout`、`stash`、`clean` 或整文件覆盖。此轮我只读核对，没有改代码；本节是续接说明。

### 中断代理留下的未验改动

`model_selector_ui` 原计划接 IDEA `StackTraceFolding` 的“单段占位栈帧展开”，被中断前已经改动：

- `src/components/RunConsole.vue`
- `src/exceptionFilter.ts`
- `tests/run-filters.test.mjs`（改的是既有断言）
- `docs/inventory/verdict-settings-run.md` 的 `StackTraceFolding` 判词

它尝试给占位行带 `foldedStartIndex`，记录已展开段，并将按钮点击映射到单段展开。请先从 IDEA `StackTraceFolding.kt` 重新复核索引、连续输出更新和复位语义，再决定如何续改。此代码没有构建或运行时验证。当前 `RunConsole.vue` 另有新增状态文字 `输出已暂停：视图冻结（缓冲继续累积，继续时补齐）。`，本地上游文案尚未核对；在用户“不私自添加文字说明”的约束下，不应未经上游确认保留。

`zcode_ui_review` 正在把 ZCode composer 草稿持久化差异落实到本地，但被中断前尚未产生这条功能的改动。当前本地 `AgentPanel.vue` 正文仍只有 `draft` ref；`agentSessions.ts` 只持久化 transcript 与模型选择。对照上游：`.tools/ZCode/packages/ui/src/v4/composer/composerDraftStore.ts`（scope 存储）和 `useDraftConfigControl.ts`（`:207`、`:281` 写入路径）。续做时要保持 workspace/session 草稿作用域，切换会话恢复对应正文，发送后只清空已发送会话草稿。

`zcode_ui_review` 还报告了一个未接入的推理档位快捷键：ZCode `toolbarShortcuts.ts:129,236` 的 `cycleThoughtLevel`；本地 `agentComposerControls.ts` 已有 `getNextThoughtLevelValue`，但 `AgentPanel.vue` 快捷键处理仅消费 `openModelMenu`（`keymapBindings.ts:166`、`AgentPanel.vue:326`）。尚未实现。它也报告本地推理控件显示门槛要求非空 reasoning map，而 ZCode `modelThoughtOption.ts:12` 只要求非空档位值；需先确认本地无 map 时选档能否被真实请求消费，再决定是否调整，不能只改显示。

`line_separator_speedsearch` 在中断前尚未完成新一轮 IDEA 待办筛选，没有新增文件修改。此前它已完成的 Line Separator Speed Search 和 `supportsMidConversationSystem` 只读审计仍有效；后者不能在缺少带来源/位置元数据的会话条目时安全接入。

### 复核中看到的文案约束

后续 GLM 修改后，settings sections 里又出现了此前已清理过的说明段和新加的实现解释。继续编辑这些组件前逐条对照 `.tools/ZCode`：

- `AutomationsSettingsSection.vue` 的“本节只保存配置……”和“没有预置假模板……”是本仓实现说明，不是上游产品文案；无模板提示应删掉。当前“没有符合条件的任务”只适用于有任务但被筛空。上游 `zh-CN.ts:6089,6186-6188` 有分别对应的状态筛选空态、无任务标题/说明和“手动创建”动作，可以照抄并接到真实 `addAutomation()` 动作。
- `BrowserControlSettingsSection.vue`、`ComputerUseSettingsSection.vue` 的“本仓没有插件/Helper，所以这里只登记缺口、不画开关”等段落是实现解释，应删除。现存 `availability.reason` / `missing` 文案也要核对是否来自真实探测和上游文案，不要把固定缺口伪装成动态状态。
- `SubagentsSettingsSection.vue` 显示“ZCode 那边可选的档位”只读工具清单，但 TaoCode 没有对应的子智能体工具选择执行链。不要用 `IdeaCheckedIcon` 把不可用配置画成已选能力；后续要么补真实持久化与执行链，要么先移除该清单，不再用说明文字解释缺口。
- `MemorySettingsSection.vue` / `SkillsSettingsSection.vue` 当前重新出现了 section description 常量，检查是否为上游原文；上轮确认过的实现说明应继续清理。
- 可直接对齐为上游原文的 section description 见 `.tools/ZCode/packages/ui/src/i18n/locales/zh-CN.ts`：MCP `settings.mcp.description`（`:2356`）、subagents `settings.subagents.description`（`:3611`）、plugins `settings.plugins.description`（`:3737-3738`）、hooks `settings.hooks.description`（`:4050`）。当前本地几项措辞与原文不完全相同，应逐字对齐或不显示。`automations`、Browser/Computer section description 没查到对应 description key，不要自造。

### 继续顺序与验收边界

1. 先复核并完成/撤回 `StackTraceFolding` 未验差异，清单与 inventory 同步，不运行测试。
2. 完成 composer 正文草稿的 workspace/session 持久化，再接 reasoning-level 循环快捷键；所有来源以 `.tools/ZCode` 为准。
3. 清理新增的实现说明文案、修正与上游不一致的说明；真实错误、保存状态、权限状态仍保留。
4. 再从 `docs/source-todo.md` / `docs/ui-parity-checklist.md` 选一个能由 IDEA 源码和本地真实数据/执行链闭合的窄项，继续全量移植。
5. 之前已通过的 `npm run build` 是这些中断代理修改之前的结果，不覆盖当前工作树状态。交接后先检查 `git status` / `git diff --check`；用户没有要求运行测试，本项目工作纪律也不允许自行加跑测试。只有重新构建成功才能报告当前改动通过生产构建。
