# 批次报告 · 2026-10-06 门控与工具加固（只碰了划给我的文件）

> 归属：工具/门控加固子代理。范围：`scripts/verdict_table.py`（只加 CLI 开关）、
> `scripts/check_verdict_tables.py`（新建）、`tests/source-citation-anchors.test.mjs`（新建）、
> `docs/inventory/citation-anchors.json`（新建）、`.tools/` 下的检测器（gitignore）。
> **没有动过**：`FAMILIES` / `PLATFORM_FAMILIES` / `MODULE_HEAP` 等六张判词表本身、
> `tests/source-citations.test.mjs`、任何 `src/` `native/` `docs/inventory/verdict-*.md`。
> 全程未 commit、未 push、未跑 `git checkout/reset/stash/clean`，未跑全量 `npm test`。

---

## 1. `scripts/verdict_table.py` 加 `--check` / `--dry-run`

**问题**：`main()` 一边算生成物一边就地重写 `docs/inventory/verdict-*.md`，
所以「复核计数」这个动作本身在改被复核的对象（`docs/handoff-2026-10-05-agent-protocol.md` §4.4 记的验收事故）。

**改法**：把「算」和「写」分岔——三种档位先算出同一份 `artifacts = [(绝对路径, 生成内容)]`，最后一步才分岔。

| 档位 | 行为 | 退出码 |
|---|---|---|
| 默认（不给开关） | 就地重写，**逐字节与改动前一致** | 0 |
| `--dry-run` | 生成 + 与磁盘按**字节**比对 + 打印差异，一个字节都不写 | 恒 0（只看，不判） |
| `--check` | 同上比对，不一致列差异 | 不一致 **1**，一致 0 |
| `--help` / `-h` | 用法 | 0 |
| 未知 `--xxx` | 打印用法 | **2**（不把拼错的开关当成域名） |

比对引擎独立成新文件 `scripts/check_verdict_tables.py`（119 行，纯标准库）：按字节比对、
`difflib` 出差异、**差异 ≤ 24 行且单行 ≤ 220 字**（族判词一行能到 1323 字，不截断会把 CI 日志冲掉）、
CRLF-only 单独成档（仍算不一致，但说清是行尾问题）、文件缺失算「磁盘上没有该文件」。

### 与 §G 手写逐类表护栏的共存（并行 agent 23:21 刚加的）

`scripts/verdict_table.py` 在我动手前约 1 分钟被并行 agent 加了「判决书里有手写
`## G. 逐条总表` 就拒绝生成」的护栏，**改的是同一个 `main()`**。三档语义这样接：

- **默认档**：护栏原样保留（拒绝写 / `--force` 才写），`"--force" in sys.argv[1:]` 那行一个字没动。
- **比对档**：根本不写盘 ⇒「覆盖手写 §G」的风险不成立，于是只把那份判决书**从比对里摘出去**，
  该域的 `_verdict_table.json` / `.md` 照常核。不做这层的话 `--check` 会因为「有人手写了 §G」而**假红**
  ——6 份手写判决书：`verdict-actions.md` / `-bookmarks.md` / `-find-diff.md` / `-folding.md`
  / `-toolwindow-openapi.md` / `-vcs-commit.md`。
- `--force` 现在才真的能用：旧版 `domains = sys.argv[1:]` 会把 `--force` 当域去找 `--force.txt`
  然后 return 1，等于加了 `--force` 反而必然失败。

### 验证：跑了什么、结果数字

1. **默认档没打断别人的用法（A/B 逐字节）**：改动前先复制一份脚本当基线，两份脚本各自在
   独立沙箱跑（沙箱 `REPO` 由 `__file__` 推导，写不到真树）：
   - `execution xdebugger daemon`：stdout `diff` **完全相同**；`diff -r` 两份沙箱产物 →
     **9 个产物逐字节一致**（3 份 `verdict-*.md` + 3 份 `_verdict_table.md` + 3 份 `.json`）。
   - `execution xdebugger`（走 B8 合并判决书那条分支）：stdout 相同，含
     `verdict-execution-debug.md` 在内**全部一致**。
2. **`--check` 在真树（只读）**：`--check execution xdebugger daemon projectviews` →
   计数 `execution 1608 [~]978 · xdebugger 635 [~]338 · daemon 659 [x]1 [~]349 · projectviews 755 [~]574`，
   **一致 12 / 12 条产物，exit 0**（收尾时复跑仍 12/12）。
   `--check platform_rest` → `total=20574 [x]=22 [~]=5423 [-]=15129`（与交接文档 §8 的 5423 对得上），
   **一致 3 / 3，exit 0，实耗 2.9 s**（18.4 MB 的 json 也在比对范围内）。
3. **`--dry-run` 不写盘**：跑前跑后对真树 `docs/inventory/` 全部 **70 个文件**做 md5 快照 →
   `diff` 空，**70/70 逐字节未变**；`git status --porcelain` 计数跑前跑后都是 **940**。

### 反向验证（注入 → 变红 → 还原），逐条

| # | 注入 | 结果 | 还原证据 |
|---|---|---|---|
| R1 | 真树 `docs/inventory/verdict-daemon.md` 第 21 行 `| [~] | 349 |` 改成 `350` | `--check daemon` → **exit 1**，差异精确打到 `@@ -20,3 +20,3 @@`（`-349 / +350`），「不一致 1 / 3 条产物」 | 逐字替换回去，还原后 md5 = `e6394963316dca38a35e41bbbd44964b`（与注入前同值）；复跑 `--check daemon` → **一致 3 / 3，exit 0** |
| R2 | 沙箱脚本的 `FAMILIES` 表里给 `"exec/build"` 判词开头插 `【注入】`（needle 唯一命中 1 次，脚本 +12 字节） | `--dry-run` → **exit 0、沙箱 12 个产物 0 改动**；`--check` → **exit 1**（`execution_verdict_table.json` 生成 2883157 / 磁盘 2883145 字节）**且仍 0 改动** | 控制组：同一份注入脚本跑**默认档** → 沙箱 json 里出现 `【注入】`、md5 `6a9ad36b…` → `95d89ab3…` ⇒ 证明「写盘」只属于默认档 |
| R3 | 未注入，真树自身的陈旧漂移：`--check execution xdebugger` | **exit 1**，`verdict-execution-debug.md` 生成 38184 / 磁盘 33690 字节 | 没还原（别人的判词现场，见「真树现存问题 1」） |
| R4 | §G 护栏三档行为（沙箱喂 `actions` 域） | 默认档 **exit 1 拒绝写**、`verdict-actions.md` 与 `actions_verdict_table.json` md5 不变；`--check` 打印「判决书那条不参与比对」并仍核该域 2 条产物（**exit 1**，json 陈旧）；`--force` + 默认档 打印覆盖提示并**真的写盘** | 沙箱 `.tools/sb/guard/` 用完即弃，真树未动 |

---

## 2. 上游引用锚点门控 `tests/source-citation-anchors.test.mjs`

**问题**：`tests/source-citations.test.mjs` 的 `verifyCitations` 只核「文件存在 + 行号 ≤ 文件长度」，
所以 `Foo.java:120-133` 手滑改成 `Foo.java:300-313`（同文件别的方法）它**全绿**。

**改法**：新门控 `import` 复用它的 `citationsOf` / `refLineReader`（没复制一份；
`refLineReader` 只给行数，所以内容特征另写了 `refTextReader`，同一个缓存、同一套 `\n` 口径）。
快照 `docs/inventory/citation-anchors.json` 每条锚点 = `{f 本仓文件, p 上游路径, a 起行, b 止行,
h 区间正文 FNV-1a, t 关键标识符 ≤8}`，一行一条、稳定排序（本仓文件 → 上游路径 → 行号），
`git diff` 指得出漂了哪一条。断言三条：

1. 快照里每条引用**仍逐字存在于仓里** —— 行号被改 / 整条被删 / 搬进别的文件 ⇒ `moved` 红；
2. 被引区间**内容仍与快照一致** —— 上游那段变了、或引用悄悄指到同文件别处 ⇒ `drift` 红，
   诊断会点出「快照里的哪些词已经不在区间里」；
3. 新增引用不入快照 ⇒ **只报数不拦**（18 个 agent 同时补判词不会天天假红），
   但快照条数 `< 150` 视为扫描器坏了 ⇒ 拦（与老门控 `items.length >= 150` 同一反空转口径）。

参考树不在 ⇒ **跳过而不是失败**（与现有门控一致）。`npm test` 永远只读盘；
重算快照要显式点名：`$env:TAOCODE_CITATION_ANCHORS='update'; node --test tests/source-citation-anchors.test.mjs`
——重算发生在**加载阶段**，之后照常跑一遍门控，自证「写出来的快照读得回去」。

### 验证：跑了什么、结果数字

| 命令 / 场景 | 结果 |
|---|---|
| `node --test tests/source-citation-anchors.test.mjs` | **8 tests / 8 pass / 0 fail**（我自己 5 条 + 从 `source-citations.test.mjs` 带进来的 3 条），~1.0 s |
| `node --test tests/source-citations.test.mjs`（老门控回归，**没改它**） | **3 pass / 0 fail** |
| update 档重算（收尾终值） | `锚点快照已重算：861 条`；核对行 `快照 861 / 仓里活引用 861 / 未入快照 0 / 区间为空 2` |
| 快照文件 | `docs/inventory/citation-anchors.json` **866 行 / 861 条锚点**；512 条时的来源分布 `src/` 292 · `docs/`（非生成物）108 · `docs/inventory/verdict-*` 与 `*_verdict_table*` 91 · `native/` 21 |
| 参考树不在（沙箱把两份文件的 REF 都换成 `D:/__no_such_ref_tree__`） | **8 pass / 0 fail**，依赖树的那条 0.42 ms 直接返回（跳过，不是失败） |
| 纯 JS / 扩展名自查 | `node .tools/find-ts-in-mjs.mjs` 干净、`node .tools/find-missing-ext.mjs` 干净、`node --check` exit 0 |
| 现场 churn（顺带证明「新增不拦」这条设计必要） | 一次会话内活引用 512 → 653 → 655 → 816 → 855 → 861 条增长（别人在并发补判词）；未入快照最多时 141 条，只报数不红 |

### 反向验证（注入 → 变红 → 还原），逐条

| # | 注入 | 结果 | 还原证据 |
|---|---|---|---|
| R5 | 在**我自己独占的这份报告**里把一条已入快照的引用行号从 `PauseOutputAction.java:18-21` 改成 `:19-19` | **exit 1 / fail 1**：`moved :: docs/batch-2026-10-06-tooling.md\|…PauseOutputAction.java\|18-21 —— 快照里有这条引用，仓里已经指不到它了`，并把新行号 `19-19` 报成「未入快照 1 条」（看得见但不拦） | 同一 Edit 改回 `18-21` → **exit 0，8 pass，未入快照 0** |
| R6 | 把快照里另一条锚点（`BreadcrumbsConfigurable.java:23-26`）的 `h` 从 `a1a67eac` 改成 `deadbeef` —— 即「区间内容与快照不一致而快照没跟着更新」的那一侧 | **exit 1 / fail 1**：`drift :: … —— 区间内容变了：快照记 deadbeef／关键标识符 DialogPanel、Override、NotNull、private、String、public、getId、panel，现在读到 a1a67eac／同一串` | `TAOCODE_CITATION_ANCHORS=update` 重算 → `已重算：816 条`，复跑 **exit 0** |
| R7 | 未注入的真事：并行 agent 在 23:4x 整体重写 `docs/inventory/verdict-find-diff.md`（活引用 655 → 816） | 门控**自己变红**：6 条 `moved`，全在那一个文件（`DiffApplication.kt:7-7`、`FrontendDiffUserDataKeyDescriptor.kt:17-17`、`DiffHeaderToolbarPanel.kt:4-4`、`impl/ui/package-info.java:2-2`、`testSources/…/TestSearchTarget.kt:54-54`、`EelSearchTestFakes.kt:13-13`）⇒ 「悄悄改指到别处」在生产路径上真的会响 | 重算快照吸收 → **exit 0，8 pass**；并为此给失败信息加了「按文件归并」的摘要行（一份文档被整体重写时一眼看出是同一件事） |

---

## 3. `.tools/` 三个检测器补强

先做经验探测：把 17 种植入形状（参数属性 13 种 + TS-in-`.mjs` 4 种）种进沙箱 `.tools/sb/probe/`
（`cd` 进沙箱再跑检测器——它们按 cwd 取仓根，真树一个字节没动），看现有检测器漏哪些。
**三个都真有空洞**，其中一个是**已经在咬人的**。

**共同真 bug（已修）**：两份复制粘贴的字面量剥离器把模板串插值 `${ … }` 整段当字符串吞掉，
插值里再出现反引号时解析器错位，**后面的真代码被抹成空格**。真树 **24 个** `src/*.ts`
（`src/backgroundTasks.ts:172`、`src/codeLens.ts:224`、`src/docSymbolTarget.ts:144` …）
和 2 个 `tests/*.mjs` 就是这个写法 ⇒ 检测器对这些文件的后半段是瞎的。
修法：新增 `.tools/strip-literals.mjs`（插值按代码解析、花括号深度找 `}`、支持嵌套模板、
单/双引号遇裸换行即结束、附「代码位图」），三个检测器都改成 import 它。
`node .tools/strip-literals.mjs --self-test` → **20 条全过**。

| 检测器 | 新加的漏网形状 | 旧版 → 新版（同一批种子） | 真树 |
|---|---|---|---|
| `find-param-props.mjs` | ① 插值里嵌反引号之后的参数属性（旧版整段吞掉）；② `override readonly` 修饰符；③ 括号深度感知的顶层参数切分（顺带修一个**假阳性**：`constructor(cb: (o: { readonly a: T }) => void)` 是合法 TS，旧版裸逗号切分会报它） | 种子 14 处：旧 **14**（漏 `src/tmpl.ts:3`，且对 `src/neg.ts:2` **误报** 1 处）→ 新 **14**（`src/tmpl.ts:3` 抓到、`neg.ts` **0 误报**） | 真树 **0 处**（与旧版一致）；`--self-test` **12 条全过**（6 正 6 负） |
| `find-ts-in-mjs.mjs` | ① `payload as Message` / `value as ns.TreeNode`（`as` + 自定义/限定类型名，旧版只认 const/unknown/never/string/number/boolean/any 七个词）；② 箭头函数参数标注 `(item: Note) => …`；③ 泛型 `<T,>(list: T[])`、`new Map<string, number>()`；④ 类成员修饰符 `class K { private readonly k = 1 }`；⑤ 行尾非空断言 `const tail = source!` | 种子 3 个文件：旧只报 **2**（`tmpl.mjs` 整个隐形、`as Message` 整个隐形）→ 新报 **3 个文件 4 处** | 真树 `tests/*.mjs` **干净**；`--self-test` **28 条全过**（15 正 13 负） |
| `find-missing-ext.mjs` | ① 副作用 import `import './x'`（没有 `from`，旧版整条看不见）；② 动态 import `import('./x')`（真树 **57 条**从来没被核过）；③ 范围从 `src/**/*.ts` 扩到 `src/**/*.ts + tests/*.mjs`（同一症状，测试文件也吃亏）；④ 靠代码位图不再把断言夹具里的 `from './a'` 当 import | 种子：旧 **1 处** → 新 **4 处 / 2 个文件**（`tests/b.test.mjs:1` 抓到，5 条夹具字符串**没误报**） | 真树 **1082 个文件干净**；`--self-test` **11 条全过** |

**我自己引入又修掉的假阳性（如实记）**：新的 `as` 检查第一版按**单行**豁免别名语境，
在真树打到 `tests/junit-rules.test.mjs:14` —— 那是
`import {` / `    NAMING_CONVENTIONS, frameworksInScope as frameworksInScopeOf, …` 的**跨行命名 import**，
是合法 JS（该文件 `node --test` 17/17 通过，不是真违规）。
修法是 `importStatementFlags()`：按语句（含跨行、含说明符列表的花括号配平）标出 import/export 段，
并且把 `export const/function/class/default/type` 这类「导出本地声明」排除在语句起点之外
（否则 `export const view = payload as Message` 这条真断言会被豁免吞掉——自测里就是这么暴露的）。
回归夹具：4 条跨行别名负例 + 1 条「多行 import 结束后紧跟真断言」正例。

---

## 真树现存问题（如实报告，**我没改别人的文件**）

1. `docs/inventory/verdict-execution-debug.md` **陈旧**：磁盘 33690 字节 vs 当前表生成 38184 字节。
   成因是 `exec/run-instances`、`exec/junit-inspection`、`exec/run-toolbar`、`exec/testframework`、
   `exec/console` 几族判词在 22:27 之后改过，但 B8 合并判决书没跟着重生成
   （`verdict-execution.md` / `verdict-xdebugger.md` 已是 22:27 的新态，只有合并件停在 10:32）。
   交给主代理（我不跑会写盘的命令）：`python scripts/verdict_table.py execution xdebugger`
   → 再 `--check execution xdebugger` 复验。
2. 两条上游引用**指在空行上**（老门控抓不到，锚点层报 `区间为空`）：
   - `docs/settings-parity.md` 引 `platform/platform-impl/src/com/intellij/xml/breadcrumbs/BreadcrumbsConfigurable.java`
     的第 24 行 —— 那是空行；字段声明与 `getId()` 实际在 `platform/platform-impl/src/com/intellij/xml/breadcrumbs/BreadcrumbsConfigurable.java:23-26`。
   - `src/components/DebugConsolePane.vue` 引 `platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java`
     的第 19 行 —— 那是空行；类声明与构造实际在 `platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java:18-21`。
   属主不是我，没动；重算快照后它们会一直「看得见」（不拦）。
3. **锚点快照是瞬时现场**：这批还在 18 路并发写 `src/` 与 `docs/`，快照落后于活引用就会红
   （本会话真实发生过一次，见 R7）。**收尾/CI 前请重算一次快照**，这是设计的一部分，
   不是门控坏了；反过来，谁改了引用又没重算，门控就该红。

## 并发冲突记录

- 23:21 并行 agent 给 `main()` 加了 §G 护栏与 `--force`（与我同函数）。我在 23:25 之后落我的 4 个 hunk，
  并在改前保留了基线副本 `.tools/sb/old/scripts/verdict_table.py` 做 A/B。
- `scripts/verdict_table.py` 是**未跟踪文件**（`git status` = `??`），`git diff` 指不出我的 hunk，
  所以自查方式是「与动手前基线副本 `diff -u`」：**4 个 hunk / 121 行改动**，
  hunk 起点在 2 / 25 / 885 / 994 行 —— 全在 docstring、`import` 段和 `main()` 里；
  `FAMILIES` / `PLATFORM_FAMILIES` / `MODULE_HEAP` / `OVERRIDES` / `RULES` / `PLATFORM_RULES`
  六张表（约 23–763 行）**一行没动**；别人那段 §G 护栏仍在原位（`grep -c 逐条总表` = 3）。
  收尾复查：文件 mtime 仍是我最后一次编辑的 23:25:52，md5 `6e672d4f…`，没被覆盖。
- 我只往 `docs/inventory/` 写过两个新文件（`citation-anchors.json`），没改过任何 `verdict-*.md`
  （R1 的注入与还原在同一个文件上完成，最终 md5 与注入前一致）。

## 新引入 / 修改的文件

| 文件 | 行数 | 新增或修改 |
|---|---:|---|
| `scripts/check_verdict_tables.py` | 119 | 新增：判决表生成物比对引擎（`--dry-run` / `--check` 用；直接跑给用法并 exit 2） |
| `docs/inventory/citation-anchors.json` | 866 | 新增：上游引用锚点快照，861 条；只有 update 档会重写 |
| `tests/source-citation-anchors.test.mjs` | 295 | 新增：锚点门控（`npm test` 的 `node --test tests/*.test.mjs` 会自动带上） |
| `.tools/strip-literals.mjs` | 154 | 新增：共享字面量/注释剥离器 + 代码位图 + `--self-test`（`.tools/` 已 gitignore） |
| `docs/batch-2026-10-06-tooling.md` | 本文 | 新增：本报告（归我独占） |
| `scripts/verdict_table.py` | 972 → 1034 | 修改：4 个 hunk，只加 CLI 开关与产物分岔，判词表未动 |
| `.tools/find-param-props.mjs` | 105 → 160 | 修改：共享剥离器 + 深度感知参数切分 + `override` + `--self-test` |
| `.tools/find-ts-in-mjs.mjs` | 109 → 175 | 修改：共享剥离器 + 5 类新形状 + 跨行 import 别名豁免 + 逐行报告 + `--self-test` |
| `.tools/find-missing-ext.mjs` | 59 → 119 | 修改：三种 import 形态 + `tests/` 覆盖 + 代码位图去假阳性 + `--self-test` |

`.py` 不在 `tests/module-size.test.mjs` 的门禁范围内（它扫 `src/` 与 `native/`）；
新建的两个仓内文件都低于 900 惯例（119 / 295 行）。`node --test tests/module-size.test.mjs` 收尾复跑 **5 pass / 0 fail**。

## 收尾状态与已知代价

- 收尾时的最后一次全绿复跑：`--check execution xdebugger daemon projectviews` **12/12 exit 0**、
  `--check platform_rest` **3/3 exit 0**、锚点门控 **8 pass / 861 条 / 未入快照 0**（收尾终值，见上表）、
  老引用门控 **3 pass**、`module-size` **5 pass**、三个检测器 + 剥离器自测 **12 / 28 / 11 / 20 条全过**、
  三检测器真树 **0 参数属性 / tests 干净 / 1082 文件干净**。
- `docs/inventory/` 相对我 23:22 的 md5 快照，只多了 `citation-anchors.json` 这一个我名下的文件；
  `verdict-daemon.md`（R1 注入点）**不在差异列表里** ⇒ 注入确实逐字节还原了。
  其余差异（`settings-run_signals.json` / `.md`、`verdict-editor.md`、`verdict-find-diff.md`）
  是并行 agent 在我跑的过程中写的，不是我改的。
- **已知代价 1**：锚点门控 `import` 了 `tests/source-citations.test.mjs`（按要求复用 `citationsOf` /
  `refLineReader`，不复制），所以全量 `npm test` 时那 3 条用例会在我这个文件里再跑一遍，
  多花约 0.5–1.7 s。换来的是两份口径不会各走各的。
- **证据目录**：全部沙箱与基线副本留在 `.tools/sb/`（gitignore）——
  `sb/old`（我动手前的脚本基线，A/B 用）、`sb/new`+`sb/merged_*`（默认档逐字节比对）、
  `sb/guard`（§G 护栏三档）、`sb/probe` 与 `sb/probe2`（植入形状种子）、
  `sb/anchors`（参考树不在的模拟）、`sb/real-inv-*.md5`（真树 docs/inventory 的 md5 快照）。
- **已知代价 2**：快照是**瞬时现场**。18 路并发还在写 `src/` 与 `docs/`，别人改了引用没重算就会红
  （本会话已经真红过一次，见 R7）。失败信息第一句就给重算命令；主代理统一收尾时重算一次即可对齐。

