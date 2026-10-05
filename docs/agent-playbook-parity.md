# 作业规约 · 全量 parity 移植批次

> 你是这个批次的一个子代理。**先读完这一页再动手。** 后面每条都是硬约束，违反了即使做对功能也等于没做。

---

## 0.5 当前树状态（2026-10-05 17:30，第二轮 · 8 桶）

上一轮用 32 个子代理并发推进，**中途被中断**。当前树：

- **842 处改动**（261 已修改 + 581 未跟踪新增），约 **150 个新文件**已经落地
- **58 个类型错误 / 19 个文件**（快照在 `docs/tsc-error-snapshot-2026-10-05.md`，每个文件已唯一归桶）
- 一批新模块**只有模型与测试、零生产消费方**（接线被中断）

### 你的三段工作，顺序不能换

**第 1 段 · 修本桶的破损（最高优先级，先做）**
打开 `docs/tsc-error-snapshot-2026-10-05.md`，找你桶名下那些文件的错误，**修到零**。
这些是上个 agent 写到一半被打断留下的（缺导出、类型不匹配、引用了不存在的符号）。
**修法优先"补齐/改齐"，不要删代码绕过**——被中断的逻辑大部分是对的。
不要动别的桶的文件。

**第 2 段 · 给你桶里的零消费方模块接线**
上一轮留了一堆"模型有了、没人用"的文件。找到它们（`grep` 一下自己桶里的新模块有没有被别的文件 import），
**接进你自己的组件**。接不上的写清卡点，**不要**留一堆只过自己测试的死模块。
判断标准：除了它自己的测试，全仓还有谁引用它？答案是"没有"就是没接上。

**第 3 段 · 继续本桶族判词里的剩余缺口**
按 `docs/inventory/verdict-*.md` 里你那些族的「缺：」逐条做。

### 保留文件（**只有桶 8 能改，其余七桶一律只读**）

`src/App.vue`（2702 行 / 上限 2737）、`src/components/CodeEditor.vue`（1127 行）、
`src/style.css`、`src/tokens.css`、`src/uiIcons.ts`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`

**为什么**：`App.vue` 只剩 35 行余量，`CodeEditor.vue` 是全仓争用最凶的文件。八个 agent 同时改必冲突。
所以这批的规矩是：**逻辑一律写进你自己的新文件，组件里只做接线**。
你确实需要上面某个保留文件接线时 —— **不要自己改**，在报告里写一行：

```
## 接线请求（给桶 8）
- 目标文件：src/App.vue 第 N 行附近
- 要接什么：<你导出的函数/组件> 接到 <哪个事件/插槽>
- 为什么需要：<一行>
```

我会把七份接线请求合并给桶 8 在最后一轮统一做。**这条比"自己动手"重要。**

例外：`src/components/CodeEditor.vue` 如果只是**你自己桶内**新增的扩展注册（editor extension），
可以改，但**必须在报告里逐行列出你动的那几行**，我要复核。

### ⚠️ 参数属性禁令（本仓硬约束，踩过很多次）

**永远不要写 TS 参数属性**（parameter property）：

```ts
constructor(private readonly storage: Foo) {}          // ❌ 加载失败
constructor(readonly view: EditorView) {}              // ❌ 加载失败
```

Node 22 直跑 `.ts` 用的是 **strip-only 类型擦除**，不支持参数属性这种类型扩展语法，
会抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
**症状特别有欺骗性**：不是某条断言失败，而是**整个测试文件加载失败**——
凡是 `import` 到该模块的用例**全红**，看起来像"测试坏了"，其实是模块根本 load 不了。

**正确写法**（显式字段）：

```ts
private readonly storage: Foo
constructor(storage: Foo) { this.storage = storage }
```

**自查工具**（父代理写的，精确到能剥注释，不会把说明注释误判）：

```
node .tools/find-param-props.mjs
```

**2026-10-05 17:50 全仓现状 —— 7 处待清**（各桶属主见括号）：

| 文件:行 | 属主桶 |
|---|---|
| `src/autoTest.ts:87` | 桶6 |
| `src/completionUi.ts:206` | 桶2 |
| `src/editorGutterIcons.ts:99` | 桶1 |
| `src/editorInlineValues.ts:18` | 桶2 |
| `src/editorWhitespace.ts:10` / `:44` | 桶1 |
| `src/libraryModel.ts:145` | 桶7 |

**不在你桶里的不用管，但如果你写的模块被 `import` 到上面任何一个，就顺手一起清掉。**
`src/breakpointLocations.ts:60-62` 有这条约束的说明注释，是正确写法的样板。

### ⚠️ 另一条：`.mjs` 测试文件必须是**纯 JavaScript**

`package.json` 的 `test` 脚本**不带** `--experimental-strip-types`，所以：

```js
// tests/xxx.test.mjs
import { Foo } from '../src/foo.ts'          // ✅ 可以（源码是 .ts，node 自己擦除）
const x: number = 1                            // ❌ 语法错误，整个文件加载失败
type Bar = { a: string }                      // ❌ 同上
import type { Baz } from '../src/baz.ts'      // ❌ named import 的 type 修饰符擦不掉
foo as Bar                                    // ❌ 同上
assert.ok(x satisfies number)                 // ❌ 同上
```

**症状同样是"整个文件加载失败"**，看起来像测试坏掉了，实际是解析错误。
需要类型时用 JSDoc（`/** @typedef {import('../src/foo.ts').Foo} Foo */`）——那是纯 JS 语法。
**断言体一个字都不要改**，只把类型标注换成 JSDoc。

2026-10-05 已发现上一轮有两个测试文件被写成 TS-in-`.mjs`（`tests/file-type-conflict.test.mjs` 等），已按仓库惯例改回。**你写新测试时直接写纯 JS。**

---

## 0. 你的任务形态

`docs/inventory/verdict-*.md` 里每个 `[~]` 族的判词已经写好了三件事：

1. **本仓现在有什么**（带真实文件路径）
2. **缺什么**（判词里 `缺：` 那一句就是你的待办清单）
3. **上游等价物是什么**

**你的活就是把「缺：」那一串变成真的代码**，或者**证明它做不到并写清理由**。
不是让你从头审计，也不是让你重写判词。

---

## 1. 取证口径（违反 = 作废）

1. **判定基准只有上游源码树**：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
2. **每条结论必须给「文件相对路径 + 行号」**。指不到就写「**无法核实**」。
3. **禁止图像/截图比对**。SVG 一律读源码文本。禁止「IDEA 一般是…」这类经验值。
4. 安装目录 `D:\IntelliJ IDEA 2026.2` **只能读 `lib/` 里的上游资源文本**（theme json / Scheme xml），
   **不许用它反推像素**。中文文案包可从 `plugins/localization-zh/lib/localization-zh.jar` 解出来读**字符串**。
5. 上游树**缺文件/缺模块**是常态（例：`OpenProjectAction` / `EditRecentProjectsAction` /
   `ResetLayoutAction` / `UISettings.java` 在本 checkout 里按文件名都搜不到 —— 只有 `ReopenProjectAction` 的子串命中）。
   遇到缺的就**先自己搜一遍确认**，再如实写「无法核实」，**不要用经验值补**。
   ⚠️ **「按文件名搜不到」不等于「功能不存在」** —— 提交前后重写、模块搬迁都会让文件名变。
   **必须按包路径 / 语义 / XML 里的 `id` 三条路各搜一遍再下结论。**
6. ❌ **不要照抄任何「某目录不存在」的说法，包括本文件里的。**
   这条曾经写着「`platform/keymaps` 整个目录不存在」，被两轮独立验收证伪：它**存在**于
   `platform/platform-resources/src/keymaps/`（**10 个文件**，`$default.xml` **1308 行**、含 `Mac OS X.xml` /
   `Emacs.xml` 等），另有 `platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/`
   （**27 个文件**：`KeymapPanel.java` 1138 行 / `KeyboardShortcutPanel.java` / `KeymapSchemeManager.java` …）
   与 `plugins/keymaps/`（**10 个插件目录 / 26 个 scheme XML**）。
   那条假规则已经**实际生产了假的「无法核实」判词**（`ui-parity-checklist.md:3125`/`:3420`、
   `handoff-2026-10-05-parity-batch.md:140`），而那些坐标本来就能引。

   ⚠️ **数字必须自己数，不要从别处抄。** 我第一版改写时把「47」写成了文件数 ——
   而 47 其实是 `Default for GNOME.xml` 的**行数**，被第二轮验收抓出来才改对。
   **凡是写"有 N 个文件/行"这类数字，亲自 `Get-ChildItem` / `Measure-Object` 数一遍。**
   ⇒ **任何「找不到」的声称，都要先把上面三个路径逐一打开确认。**

---

## 2. 架构不等价时怎么办（桃 2026-10-05 明确指示）

> 「如果是架构问题无法移植，就用我们的架构去还原功能。」

上游是 **Kotlin/Java + Swing + Compose Desktop + DI 容器**；本仓是 **Vue 3 + TypeScript 前端 + C++ 原生宿主**。

- **目标是功能等价，不是逐行复刻。** 找上游这个行为**对用户可见的那一面**是什么，
  然后在本仓的架构里把它做出来。
- 照抄**几何、字号、间距、键位、文案、快捷键顺序、默认档**——这些是跨架构的。
- **不要**照抄 Swing/Compose 的组件结构、服务容器、DI 注解。
- 交付时要写清：**本仓用什么等价物承接了上游的什么**。

---

## 3. 禁止做假控件（铁律）

- **没有后端 / 没有消费链路的项，一律不渲染**，在报告里登记为未完成并写明理由。
- 画一排点不动的按钮、用字形字符冒充图标、改个文案说"已实现"——都算**假控件**。
- 判定「做不到」的项要给出**具体**卡点（缺什么后端 / 哪个请求 LSP 不提供 / 哪层架构不成立），
  不是「太复杂」这种空话。

---

## 4. 共享工作区纪律（这条最容易出事）

工作区有 **700+ 处未提交改动**，所有 agent 共用同一棵树。

1. **绝对禁止** `git checkout --` / `git reset` / `git stash` / `git clean` / 任何丢弃工作区的命令。
   上一轮已经因此**丢过 630 行测试**，事故记录在 `docs/handoff-2026-09-28-ui-parity.md` §4.2。
2. **改任何文件前先重读当前内容**。你读到的可能是几分钟前的版本。
3. **改完立刻 `git diff -- <你的文件>` 自查**该 hunk 是你的。发现混进别人的改动，**不要覆盖**，如实报告。
4. **只碰你名下的文件。** 任务书里会列「你拥有」和「只读」两栏。

### 共享高争用文件（几乎所有族都会提到它们）

`src/bridge.ts` / `src/bridgePreview.ts`、`src/App.vue`、`src/components/CodeEditor.vue`、
`src/style.css`、`src/tokens.css`、`src/settingsTreeMeta.ts`、`src/settingsModel.ts`、
`src/menus/buildMenu.ts`、`src/keymap.ts`、`src/keymapBindings.ts`、`src/actionRegistry.ts`、
`tests/module-size.test.mjs`、`CMakeLists.txt`

**这些默认只读。** 确实必须改时：改动最小化 → 改完立刻重读确认没被覆盖 → 在报告里单列一节写「我改了共享文件 X 的第 N 行，因为…」。
`CMakeLists.txt` 只有在你要**新增** `native/*.cpp` 时才写，且必须注册，否则不参与构建。

---

## 5. 代码规范

1. **禁止裸 hex / 硬编码毫秒 / cubic-bezier**——一律走 `src/tokens.css` 的令牌。
   组件内写 `#c0392b`、`160ms`、`.16s cubic-bezier(...)` 都会被打回。
2. **图标走 `lucide-vue-next`**，尺寸从 `src/uiIcons.ts` 的 `iconSize.*` 阶梯取，
   **不许在模板里写 `:size="14"`**。禁止用 Unicode 字形（`↑ ✕ ● ▸`）冒充图标。
3. **纯图标按钮必须同时有 `title` 与 `aria-label`**，且 `padding: 0`、svg 规则带 `flex-shrink: 0`。
4. **行数上限只能靠拆模块下调，不许上调。** `tests/module-size.test.mjs` 是唯一权威
   （`DEFAULT_LIMIT=900` / `NATIVE_DEFAULT_LIMIT=1100` / `_test.cpp` 1300，含 `REGISTERED` 与 `NATIVE_REGISTERED` 两张表）。
   你的新文件超了上限就**继续拆**，别去调上限。
5. **新增 `native/*.cpp` 必须注册进 `CMakeLists.txt`。**
6. 组件超过上限但拆不动时，如实说明，**不要**为省事登记一个假上限。

---

## 6. 验证纪律

1. **改哪部分跑哪部分测试，不跑全量。** 父代理统一跑全量。
2. **取类型检查基线必须用 `npx vue-tsc -b --force`**。
   不带 `--force` 是增量构建，命中 `.tsbuildinfo` 缓存会**根本不重扫**，
   报出的 "exit 0" 是**假阴性**——上一轮有 4 个 agent 就这么被骗过。
   你改完文件后跑增量会真的重扫，但**判定基线**时必须 `--force`。
3. **native 构建必须先 `call vcvars64.bat`**，否则报「无法打开包括文件 "chrono"」——
   那是环境问题不是代码问题，别误判、别去改代码。
   vcvars：`C:\Program Files\Microsoft Visual Studio\18\Enterprise\VC\Auxiliary\Build\vcvars64.bat`
   ctest：`C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\`
   跑全量 ctest 用现成脚本 `.tools/nctest-all.bat`。
4. **新加的门禁必须做反向验证**：故意造一处违规，确认新测试真的会红，然后撤掉。
   反向验证不红 = 门禁是空转，重写。
5. **拆文件后必须 grep 被搬走的符号**（见下面第 7 条）。

---

## 7. 拆文件时的隐形依赖（上一轮踩了 6 次）

把实现从一个文件搬到新文件时：

- 测试里 `read('src/old.ts')` 的正则锚点，是指向被搬走代码的**隐式依赖**。
  拆完必须 `grep` 被搬走的符号名，把 read 路径改指新文件，
  **断言体一字不动**（仓库既有惯例）。
- 文档里的 `file:line` 引用同样会腐烂，重构后同步校正。
- 断言要守**意图**不要守**形状**。「修对了却变红」一律**改测试**，不许回退代码。

---

## 8. 报告格式（每条都要有上游坐标）

```
## 判词
| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|----|------|--------------------------|----------------------|------|

## 改动文件
（逐个列，注明新增/修改/删除）

## 验证
（跑了哪些测试、多少通过；native 改动必须给出 ctest 结果）

## 做不到 / 无法核实
（逐条写清**具体**卡点，不要写"太复杂"）
```

**"无法核实"和"有意不做"要如实保留，不要为了凑完成度而改。**

---

## 9. 禁止越权

- 不要改 `tests/module-size.test.mjs` 的**上限数字**（除非你就是靠拆分把它下调的）。
- 不要提交 git（父代理统一处理）。
- 不要动 `docs/inventory/verdict-*.md` 的**生成物内容**——那是 `scripts/verdict_table.py` 生成的。
  要改判词，去改 `scripts/verdict_table.py` 里的 `FAMILIES` / `PLATFORM_FAMILIES` 表，然后重新生成。
- 不要碰别的 agent 名下的文件。
