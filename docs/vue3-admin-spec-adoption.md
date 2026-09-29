# `vue3-admin` 开发规范在 TaoCode 的采纳判定

> 桃 2026-09-27 装了技能 `vue3-admin`（`C:\Users\Administrator\.workbuddy\skills\vue3-admin__skillhub`）。
> 那个技能是给 **Vue3 + Ant Design Vue 的后台管理系统**写的，TaoCode 是**桌面 IDE**（Vue3 + CodeMirror +
> Win32 WebView2 + C++20 宿主，自绘界面）。所以必须**逐条判定**哪些适用，而不是整套套上来 ——
> 把后台管理的表单/表格规范套到 IDE 上会把界面改错。
>
> 本文记录判定结果与落地情况，避免以后重复讨论。

## 采纳（有可执行落点）

| 规范条目 | 落地 |
|---|---|
| **强制拆分，单文件不超过 500 行，AI 必须主动拆**（核心原则 9） | 新增机检 `tests/module-size.test.mjs`：新文件默认上限 **900 行**（超了就必须按职责拆新模块）；4 个存量文件**登记 + 上限**（`src/App.vue` 6250、`src/components/SettingsDialog.vue` 1450、`src/bridge.ts` 1450、`src/components/CodeEditor.vue` 1250），**上限只能靠"顺手拆一次"下调**，不许无声上调。目标值向 500 收敛（见"待办"）。 |
| **Message 提示规范：只有用户无法直接感知的操作才提示**（核心原则 6.1） | 删掉 5 处「立即可见还弹提示」：布局删除、模板展开（只留失败分支）、分支 checkout / create / delete。**保留** rebase / merge / push（历史被改写、远端状态不直观，属于"异步完成需明确反馈"）、编码切换（"保存时按该编码写入"用户不可见）、省电模式（"语言服务与后台轮询暂停"不可见）、书签编号（gutter 上看不到编号）。 |
| **显式导入组件，不用全局前缀**（核心原则 2） | 已符合：用的是 `lucide-vue-next` 具名导入，没有全局注册组件。 |
| **优先使用现成组件与工具库**（核心原则 3） | 部分采纳：复用仓库已有的工具模块（`src/editorText.ts`、`src/commitMessageInspection.ts` 等）。**不引入** `dayjs` / `lodash-es` —— TaoCode 目前没有这两个依赖，为几个日期格式和深拷贝引入依赖不划算。 |

## 不适用（说明理由，不是"没做"）

| 规范条目 | 为什么不适用 |
|---|---|
| 表单 `baseColProps` 响应式栅格 / `alwaysShowLines` | 那是 `vue3-admin` 对 antdv `Form` 的封装。TaoCode 的表单是自绘面板（`ProjectDialog.vue` 等），没有 antdv。 |
| 表单抽屉 `useAdapt` 自适应宽度 | 同上，依赖 `BasicDrawer`（antdv）。TaoCode 的对话框自己算尺寸。 |
| 表格 `useTable` / `isCardTable` / 移动端卡片模式 | TaoCode 的列表（Git 日志、问题、搜索结果）是自绘 `<div>` 布局，没有 antdv `Table`；而且**桌面 IDE 不做移动端适配**。 |
| 时间列 `width: 165` | 依赖 antdv 表格列定义。TaoCode 里时间列的宽度由 CSS 决定，"够宽不被截断"已经满足，但没有 `width:` 这个字段可设。 |
| `JDictSelectTag` 定宽穿透（`:deep()`） | 那是 vue3-admin 的字典下拉组件。 |
| 详情页 `Description` 组件 | 同上，vue3-admin 的封装。 |
| API 不定义枚举 / `import * as xxxApi` 命名空间导入 | TaoCode 没有 HTTP API 层 —— 前后端通过 `request(method, params)` 走 WebView2 桥，方法名是 `src/bridge.ts` 的 `Method` union，由 `tests/routing-parity.test.mjs` 机检。 |
| 路径别名 `/@`
 | TaoCode 用相对路径 + 少量 `./xxx.ts`（显式扩展名是 Node 直跑 .ts 的硬要求，见 `user MEMORY.md`）。 |

## 已符合（无需改动）

| 规范条目 | 现状 |
|---|---|
| **严禁 emoji 当图标**（核心原则 11） | 扫描 `src/**` 与 `native/**` 后 16 处命中**全部合规**：`native/history_test.cpp:232,242` 的 `🎉` 是**测试夹具故意放的 emoji 文本**（测含 emoji 的 diff）；`src/testRunner.ts:76-81` 的 `✔✖` 是 **node:test 的 TAP 输出符号**，代码必须匹配它们；`src/components/SourceControl.vue:684` 在注释里描述按钮。没有一处是"拿 emoji 当 UI 图标"。 |

## 待办（登记，不假装已完成）

1. **存量大文件向 500 行收敛**（核心原则 9 的目标值）：
   - `src/App.vue` 6164 行 —— 组装层。可行方向：把成组的动作转发（Git 弹窗动作、书签、模板、VCS 日志…）按域拆到 `src/appActions/*.ts`，App 只保留 ctx 组装。
   - `src/components/SettingsDialog.vue` 1405 行 —— 设置树宿主；页面本体已在 `*Page.vue`，继续把树数据拆到 `src/settingsTree.ts`。
   - `src/bridge.ts` 1397 行 —— union 与封装必须留在这里（是机检锚点），但各域的接口类型可以拆到 `src/bridge/*.ts` 再转出。
   - `src/components/CodeEditor.vue` 1177 行 —— CodeMirror 宿主；各 LSP 能力的解码/判定已拆出 5 个模块，继续把折叠/断点 gutter/提示拆出去。
   - **每拆一次就把 `tests/module-size.test.mjs` 里的上限下调到当前值** —— 否则上限会悄悄变成"合法堆砌"的许可。
2. **文件命名统一为 kebab-case**（核心原则 1）：TaoCode 存量是 camelCase `.ts`（110 个文件）+ PascalCase `.vue`。全量改名要同步所有 `import` 与测试里的锚点（`routing-parity` 读的是方法名、`semantic-tokens` 读的是源码路径），风险集中、收益是风格一致，**建议单独一批做**，不要混在功能开发里。
3. **字符图标换成图标组件**（核心原则 11 的严格解读）：`src/components/BranchPopup.vue:83` 的 `✓`、`src/components/SearchPanel.vue:205` 的 `⚠` 是**字符**而不是 emoji，技能禁止的是 emoji，所以不算违规；但按"必须使用图标组件"的精神，应换成 `lucide-vue-next` 的 `Check` / `AlertTriangle`。视觉回归风险低，但要逐个确认对齐与尺寸，登记为待办。
