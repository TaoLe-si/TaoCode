# HANDOFF · TaoCode IDEA UI 1:1 移植

> 交接件。未来只读这一份即可接续，不需回读对话。路径索引见文末。

## 【主线状态】

**目标**：把 `D:\TaoCode`（C++20 宿主 + WebView2 + Vue3）的界面与交互按 IDEA 源码 1:1 移植补全，禁止虚假/占位/空壳。

**当前节点**：设置对话框（外观页）、主窗口（顶栏/工具窗口/状态栏/提交面板）、欢迎页三块区域的**有真实消费链路**项已全部落地并实测通过。
**第 25~27 批后新增**：状态栏工具窗口 widget、顶栏项目 widget、提交图例、提交前检查与拒绝原因；并把纯逻辑抽成 `src/toolWindows.ts` / `src/commitLegend.ts` / `src/projectWidget.ts` / `src/commitCheck.ts` 四个可单测模块（测试 112 → 138）。

**权威清单**：`D:\TaoCode\docs\ui-parity-checklist.md`（逐条勾选 + 未做项及理由 + 每批验证记录）。

**验证口径（每批必跑）**：
1. `npx vue-tsc --noEmit -p tsconfig.json` → 0 错误
2. `npm test` → 138/138
3. `npx vite build --emptyOutDir false` → exit 0（`--emptyOutDir false` 是因为沙箱禁止批量删除 dist）
4. `python -c "import subprocess;subprocess.run(['cmd','/c',r'D:\TaoCode\scripts\build-native-locked.bat'])"` → RC 0 且零告警
5. `ctest --output-on-failure`（17 项）→ 全绿
6. **启动冒烟**：先 `taskkill //IM TaoCode.exe //F`，再 `subprocess.run(['./TaoCode.exe'], timeout=15)`；`TimeoutExpired` 视为存活

**下一步候选**（按价值）：
1. 「图 X」截图条目核实——**等桃补图**（本会话模型看不到图片，此前"图 1/2/3 的内容"是我推断的，不可作为依据）
2. 剩余已判定为不做/有意偏差的项（透明度语义不符、抗锯齿浏览器不暴露、三个状态栏 widget 无对应机制、项目 widget 的 tooltip 不相对主目录、提交图例的 registry 强制紧凑开关不表面化）——如桃要求仍可逐项尝试
3. `CommitAuthorComponent`（vcs/commit/CommitAuthorComponent.kt:38-121）：需要新增原生 `git.user`（读 `user.name`/`user.email`）与 `git.commit --author`，属跨层改动，尚未开始

**第 24 批（todolist 一次性完成）**：欢迎页项目分组、主菜单位置三模式、屏幕阅读器支持、工具窗口条拖放换边重排——四项均已落地并实测。

## 【本session】

**做了什么**（第 11~27 批 + 两次回归修复，全部实测）：
- 状态栏：内存指示器（原生 `app.memory`）、列选择模式指示器、进度指示器 + 取消按钮（原生 `git.progress` / `git.cancel`）、通知中心、SmartMode 指示（含误报修复）、位置 widget（选区/多光标/点击转到行）、**右键组件菜单**（15 widget 勾选 + 持久化）、省电模式、**工具窗口 widget（悬停列出窗口 + Alt+编号，点击切工具窗口条）**
- 外观页：缩放/紧凑/完整路径/树视图×2/平滑滚动/菜单图标/工具窗口组×3/并列布局×3/背景图像/演示模式/对比滚动条/色觉滤镜/界面字体
- 提交面板：IDEA 结构（信息框头部 + 修改(M) + 提交(N)/提交并推送(P)）、历史信息、回滚、重新格式化、提交选项（--signoff + TODO 预检）、**提交图例（暂存分类小计 + 宽度不足自动紧凑）**、**提交前检查与拒绝原因标签**
- 欢迎页：左栏 tab 语义 + 自定义页 + 插件计数 + ⋮ 菜单 + 分支行 + 空态快捷动作 + 删除确认 + 键盘删除
- 顶栏：**项目 widget（已打开/最近项目 + 搜索）**、Git 分支 widget、运行 widget

**踩过的坑（都已修，值得记住）**：
| 坑 | 现象 | 处置 |
|---|---|---|
| 递归加锁 | `queue_git_request`/`git_worker` 持 `git_mutex` 时调 `publish_git_progress()` → 启动即崩 `0xC0000409` | 发布移出锁外 |
| 伪实现（menuIcons） | 后一次编辑整块替换掉了 `dataset.menuIcons` 赋值，只剩死 CSS | 补回并扩到所有菜单面 |
| 伪实现（bracketMatching） | 控件+持久化都有，编辑器从未读它 | 加 `data-bracket-matching` + CSS 取消高亮 |
| 模板属性坑 | `:aria-label="运行"` 多冒号 → tsc 报 `Property '运行' not found`；三元+反引号嵌套也易歧义 | 字面量不加冒号；复杂 title 用 computed |
| 脚本改文件 | 用 python 字符串替换插块时重复插入、把 CSS 规则拆坏 | 改后必须 grep 计数确认，CSS 破坏要用行区间重建 |
| CSS 误插进媒体查询 | 顶栏 widget 规则同时存在于全局与 `@media (max-width:700px)` → 宽屏下 `.run-caret` 样式缺席 | 删媒体查询内重复块，规则归位全局 |
| 未声明标识符 | `DebugPanel.vue` 的 `consoleNote = …` → vue-tsc `TS2304`、运行时 ReferenceError | 与同文件其余 catch 统一为 `error.value = message(caught)` |
| 链接失败 | 残留 TaoCode.exe 占用导致 `LNK1104` | 构建前先 taskkill |
| 图片 | 本会话模型看不到截图 | **已如实告知桃；不可再假装看到** |

**未决 / 挂起**：
1. 「图 1/2/3」截图条目未核实（等桃补图或文字描述）
2. 有意偏差清单（每项都有 IDEA 源码行号，见清单对应条目）：项目 widget 的 tooltip 不相对主目录；提交图例的 registry 强制紧凑开关不表面化；amend 留空信息沿用原信息；透明度/抗锯齿/三个状态栏 widget 判定 N/A
3. 监督代理（`supervisor`）每轮结束会被框架回收，需重派；定时任务 `79edf316-456b-4856-af5a-d6eac40a38ab` 每 15 分钟自动拉起 main（`FREQ=HOURLY;INTERVAL=1;BYMINUTE=0,15,30,45`）

## 索引

- 硬规则：`.workbuddy/memory/MEMORY.md`（任务未完成禁止停止 / 禁止编造 / 缺口必须读源码 / 不放假控件 / 验证口径）
- 日志：`.workbuddy/memory/2026-09-26.md`（按批记录）
- 清单：`docs/ui-parity-checklist.md`
- 审计报告（第一阶段）：`docs/audit-completion-report.md`
- IDEA 源码：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
- 构建：`scripts\build-native-locked.bat`（含互斥锁；SDK 路径手抄，因 `reg.exe` 被沙箱拉黑）
