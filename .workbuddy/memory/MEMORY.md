
# TaoCode 项目硬规则（桃制定，必须遵守）

1. **任务未完成禁止停止**。清单未全绿前，不得收尾、不得交接、不得停下等指示。
   每一轮回复里必须**继续做下一批**，不能写"下一批我继续做…"式收尾——那等于停止。
2. **没有 token 限制（桃 2026-09-27 明确，要求写进规则）**：不要因为"担心回复过长 / 成本 / 上下文会溢出"
   而**缩小批次、提前收尾、把剩余工作推给下一轮**。每个回复都要**尽量多做完**可验证的批次
   （一个回复里连续做多批是正常的、被期望的）；宁可长、不可停。只有当一个批次真的做完并验证全绿时，
   才进入下一批——**永远不停在"等指示"上**。超出单次回复容量时，下一轮**立刻**从断点继续，不重新规划。
   这条优先于任何"回复要简洁"的通用习惯；本项目的进度 > 输出长度。

3. **工程量大不是借口**：大就分步连续实现，每步真实编译/测试/冒烟验证。
4. **禁止虚假、编造、伪装完成、跳过**。缺口来源必须**读 IDEA 源码**（`D:/Backup/Downloads/intellij-community-master`）
   并给出文件与行号；未实现的项必须如实标注并说明原因。
5. **不放假控件/空壳**：没有真实消费链路的设置项不渲染（否则就是装饰性假设置）。
6. 验证口径固定：`vue-tsc --noEmit`、`npm test`、`vite build --emptyOutDir false`、
   `scripts\build-native-locked.bat`（RC 0 / 零告警）、`ctest`、**启动冒烟**（进程存活）。
7. **基准改为"源码类清单"（2026-09-26 桃二次明确）**：源码有什么类就移植什么类。总控文档 =
   `docs/class-parity-todo.md`，逐类清单 = `docs/inventory/*_scan.md`，机检脚本 = `scripts/parity_scan.py`。
   「移植」= 把类的**行为**搬进 TaoCode 架构（Vue3/DOM + C++20 宿主 + LSP/DAP），不是照抄 Java。
   判定四档 `[x]/[~]/[ ]/[-]`，`[-]` 不适用**必须附源码路径+行号理由**。
8. **动手前先查并发写入者**：`git status --short` + `find src native tests -newermt '-30 minutes' -type f`。
   本项目出现过多主体同时改同一棵树，导致构建直接编不过（详见 2026-09-26 日志第五十批）。
9. **C++ 坑**：`native/projects.cpp` 用的模式是「匿名 namespace 里前置声明 + 后面定义」。
   新增函数的**定义必须落在同一个匿名 namespace 内**（用 `namespace { ... }` 重开即可），
   否则匿名 namespace 的成员注入外层后会与 outer 定义构成同名同签名重载 → MSVC C2668。

10. **冒烟测试只在"可能影响启动"的改动后才跑**（桃 2026-09-26 明确）。
   必跑：原生代码（任何 `native/*.cpp|hpp`）、`src/main.ts`、`index.html`、
   `src/bridge.ts` 的启动/状态读取路径、任何改动**启动时会读的持久化状态格式/校验**的改动。
   不跑：纯文档、纯 CSS、只动菜单/对话框内部布局、只加测试、只改注释。
   其余五条（tsc / npm test / vite build / 原生构建 / ctest）照旧每批都跑。

11. **全量移植是硬要求**（桃 2026-09-26）：「不做 / 有意例外 / 无对应行不造空壳」这类说法**不允许出现在结论里**——
    只能写成「待办」并登记进 `docs/class-parity-todo.md`，注明缺的能力与排期。
    没有宿主能力的（全屏、gutter 图标、多窗口…）先补宿主能力，再做移植。

12. **不要盲信文档**（桃 2026-09-26）：文档里只允许写 **100% 经源码确认**的内容；没查证的必须显式标 `推断` 或 `待核`。
    任何移植以**源代码**为基准，不以文档/记忆/印象为基准。实例：曾因没查就写"背景图像不在设置页里"（实际 `SetBackgroundImage`
    就在 `AppearanceConfigurable.kt`），以及只 grep LSP 方法串就差点误判"前端没接跳转"（前端用的是 kind 名）。

    **强化（2026-09-27 实测）**：凡是「IDEA：`XxxClass`」「与 IDEA 一致」「IDEA 有…系列」这类断言，
    一律按**待核**处理 —— 落笔前先 `find`/`grep` 一次。当天核对 6 条这样的断言，**6 条全错**：
    `SemanticHighlightingPass` 不存在、`DocumentLinkProvider` 不存在、`platform/inline-completion/` 里没有 provider、
    `XDebuggerDisassembler` 不存在、`XDebuggerTree` 的 sources 组不存在、`$MethodDown` 根本没有默认快捷键。
    凭印象写 IDEA 依据的准确率实测 **0/6** —— 这类句子现在必须带**搜索命令与结果**，或标 `待核`。
13. **冒烟测试阶段性禁止**（桃 2026-09-26 晚）：拆分/移植任务进行中**禁止跑冒烟**，
    全部任务完成后再统一验证修复。ctest 等自动化测试不受限。

## 外部开发规范的采纳判定（2026-09-27）
桃装了两个外部技能（`vue3-admin`、`dev-expert`）。判定结论写在 **`docs/vue3-admin-spec-adoption.md`**：
- **采纳**：「单文件 ≤500 行、AI 主动拆分」（已做成机检 `tests/module-size.test.mjs`，
  新文件默认上限 900、4 个存量登记 + 上限，**上限只能靠拆一次来下调**）；
  「只有用户无法直接感知的操作才提示」（已删 5 处立即可见还弹提示）。
- **不适用**：后台管理系统那套（`baseColProps`/`useAdapt`/`useTable`/时间列 `width:165`/API 枚举）
  —— TaoCode 是桌面 IDE，没有 antdv、没有 HTTP API 层、不做移动端。
- **`dev-expert` 的六步闭环**与项目硬规则 5/11 方向一致（无证据=未完成、根因闭环、未验证项披露），
  按项目既有口径执行：验证固定为 `vue-tsc` + `npm test` + `vite build` + 原生构建（0 warning）+ `ctest`，
  记忆写 `.workbuddy/memory/`（**不是**技能的 `.ai-memory/`），批次大小由"持续执行到全量完成"决定
  （**不是**技能的"每轮 ≤3 改动点"）。

## 模块化：核心设计理念与已验证的拆分模式（桃 2026-09-27）

**理念**：一个文件 = 一个职责域；对照 IDEA 源码的类划分（一类一文件）拆；拆出的模块必须进入真实消费链路。

**四种拆分模式（都已在本仓验证）**：
1. **纯函数模块**：零状态依赖，直接 `import`（例：`src/editorText.ts` 的 wordAt/offsetOf/applyTextEdits）。
2. **数据+类型模块**：数据表与类型同处（例：`src/menus/types.ts`、`src/toolWindowMeta.ts`）。
   类型若原本是 `typeof xxx.value`（ref 推导），在模块内**显式写出同值域的字面量联合**，两边结构兼容。
3. **状态模块**：模块**自持** ref/computed + 持久化，App 只 import（例：`src/statusWidgets.ts`、
   `src/progressPanel.ts`、`src/sessionSnapshot.ts` 的 restorePrompt）。
   **判断依据**：状态只被本域逻辑读写 → 状态模块（最彻底）；被模板或多处使用 → 走 ctx 注入。
4. **ctx 注入/工厂模式**：依赖多或要被多处用时，导出 `createXxx(ctx)`，App 侧组装 ctx 并解构**同名变量**
   （模板零改动）。例：13 个 `src/menus/*Menu.ts`。

**拆分纪律（血泪教训）**：
- ctx 成员**惰性解析**：顶层立即求值的对象字面量若引用声明在后的变量会 TDZ 报错 → 用 `get x() { return x }`
  或箭头包装（`f: (...a) => f(...a)`）。
- 改造 ctx 成员要按**接口全量清单**核对，不能只看 tsc 报错名单（曾误删未报错的 active/toolMenu）。
- 拆前先 grep 目标块的**完整自由变量清单**再决定切多细（依赖 >20 的块先建上下文类型）。
- 先查依赖来源，别臆测同属一个模块（canClose* 在 toolTabs、nextContentIndex 在 activeToolWindow…）。
- 菜单在 `const menus = [...]` **数组字面量内**：const 块必须放数组**之前**，数组内只放组引用行，
  否则等于往数组里插语句（语法炸）。
- 每步带唯一性断言 + 失败即中止；大文件改动前先备份。
- 改样式前先 grep 该 class 的**全部定义**（重复定义会让改动"看起来没生效"）。

**原生模块化**：一域一对 `.cpp/.hpp`（settings_schema / fsops 已拆出）；头文件里的函数定义必须 `inline`；
`extern constexpr` 数组跨 TU 是不完整类型（用 `inline constexpr` 放头文件）；各模块自备 `fail`/`win_error`
与 `namespace fs` 别名；默认参数只能写在声明处。
