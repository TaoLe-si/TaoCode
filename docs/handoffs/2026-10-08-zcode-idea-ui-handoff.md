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

- Agent 面板现有模型选择器和会话/草稿模型选择持久化，涉及 src/components/AgentPanel.vue、src/components/AgentModelSelectPop.vue、src/components/AgentSessionPop.vue、src/agentSessions.ts。
- 已有纯模型选项映射模块 src/agentModelOptionMap.ts，但不能据此宣称 ZCode 的推理档位已接通。
- src/components/AgentPanel.vue 已采用更明确的明暗面、左侧强调线、收窄消息阅读宽度和不对称信息层级。该文件仍为未跟踪状态，无法用 Git 基线证明模板、文案和脚本均未改；如需声称本次仅视觉调整，须先从工作树实际内容核验。
- 只读窄面板审阅发现仍需处理：部分 CSS 度量绕过 token；.agent-plan-step 长词、.agent-edit-head 长路径、操作按钮行可能横向溢出；超长空状态文字可能裁切。审阅文件当前状态，不假设这些问题仍未修或已修。
- src/components/AgentSettingsPage.vue、src/components/agent-settings/AutomationsSettingsSection.vue、src/components/AgentMessageContent.vue 也属于当前 Agent UI 工作面。任何文案清理都须确认不会删掉真实权限、错误或执行状态。

### 推理档位端到端缺口（已完成只读审计）

ZCode 的参考位于 ProviderModelMetadata.ts、ProviderModelSettingsGroups.tsx、V4ComposerToolbar.tsx 和 useDraftConfigControl.ts。本地审计发现以下断点：

1. src/agentSettings.ts 的模型字段和 normalizeAgentSettings 只保留 id/name/enabled；provider 转换与归一化会剥掉 contextWindow、maxOutputTokens、inputFormat、capabilities、reasoningLevels、reasoningLevelMap 等元数据。src/agentModelProviders.ts 已有较丰富模型记录类型和归一化入口，需让类型、归一化和转换全程保留字段。
2. src/agentModelProviders.ts 的 reasoning 提交校验仍用旧的非空/首字符启发式；要接 src/agentModelOptionMap.ts 的 compileModelOptionMap(..., 'reasoningLevel') 完整校验，并提交 trim 后的档位。
3. src/components/AgentSettingsPage.vue 目前没有模型元数据编辑器。按 ZCode 已有字段做最小真实编辑入口；不要自创默认档位、映射或 provider 能力。
4. src/agentSessions.ts 和 AgentPanel.vue 当前按模型字符串保存/传递选择。扩展时保存 { model, options.reasoningLevel } 或同等最小字段；切模型清除旧 reasoning。只有模型声明有效 reasoning 配置时才显示档位控件，不设隐式默认。
5. src/agentHost.ts 的 send、初次请求以及工具续发 request snapshot 尚未消费 reasoning/max-output 映射。用冻结的会话选择构建请求，并通过现有 src/agentHostWire.ts 的 JSON 请求路径应用映射。无 reasoning 配置时保留当前请求路径。

映射边界要准确：当前模型元数据没有 ZCode compileModelOptionMaps 所需的 maxOutputTokens.map 及对应选项值来源。本地 maxOutputTokens 只是数值上限。不要捏造映射或值；推理档位首阶段可单独按真实 reasoningLevel map 做 patch，双映射行为要等本地有可追溯来源后再实现。Provider registry、OAuth 默认项、真实模型目录和模型侧真实用量也没有本地来源。

### IDEA 与弹层工作

- src/components/TabEntryPoint.vue、src/components/ToolWindowAnchorMenu.vue 已有弹层视口定位/键盘交互改动；逐项核对 IDEA 对应行为及 docs/ui-parity-checklist.md，不要扩大成没有依据的新交互。
- IDEA 全量移植尚未完成。以仓库现有判决表和待办为准逐条推进；功能不存在于宿主时，先查证是否可实现，再记录差异，不做假控件。

## 验证记录

- 本轮此前 npm run build 两次通过；Vite 报告主 bundle 超过 500 kB，但构建成功。
- 本轮未运行测试。
- 当前 http://127.0.0.1:5173/ 预览只展示欢迎页，没有原生宿主里的 Agent 面板。因此 Agent 面板的真实宽度、弹层和完整消息流尚未通过该浏览器预览验收。

## 后续执行顺序

1. 复核并修正 Agent 面板窄宽溢出及 token 使用，再在真实宿主验证目标界面；不为视觉留白增添文案。
2. 按上文闭合模型元数据 → 设置持久化 → 会话选择 → 首轮/工具续发请求的 reasoning 完整链路。只有真实链路完成后才呈现选择器。
3. 回到 docs/ui-parity-checklist.md 和 .tools/ZCode，继续未完成 ZCode / IDEA 移植；每项对照原实现和当前宿主，再改代码与状态记录。
4. 检查 src/components/TabContextMenu.vue 当前键盘与 ARIA 审阅结果，确认焦点、角色和方向键行为符合该菜单模型。

## 协作与会话

当前代理运行环境并发上限为 4（协调代理加最多 3 个子代理），无法同时维持用户期望的 30 个；任务拆分时尽量填满可用槽位，代理结束后有后续工作再补位。

用户提供的 TaoCode 会话 ID sess_b31760c5-8276-4a4f-b717-7916e33ba4b6 不是当前 Codex 线程 API 可读/可发消息的线程标识。此文档和 Skill 已放入仓库；需要由用户或 GLM 5.3 会话直接读取这些路径。
