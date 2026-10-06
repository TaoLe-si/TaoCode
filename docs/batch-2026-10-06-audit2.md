# batch-2026-10-06 · 代号 `audit2` · 动效 hover 过渡门 + 常驻文档审计

规则来源：`D:\TaoCode\.tools\agent-rules.md`（全文读完）。**`AGENTS.md` 在本仓不存在**（本次实测：
`find . -maxdepth 2 -iname "AGENTS*"` 零命中、`ls D:/TaoCode/AGENTS.md` 报 No such file；上游参考树根倒有一份 6168 字节的
`AGENTS.md`，那是 IntelliJ 自己的贡献者规约，与本仓派单无关）。
上游真源只用本地树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，未联网、未截图。
本批**不涉及上游行为判词**（两半都是本仓自身的门禁与文档核对），所以下表的「上游依据」列一律写「不适用（本仓自身门禁/文档一致性）」，
不编上游路径。

---

## 0. 一句话结论（先说与派单前提不符的地方）

1. **派单说的门禁入口不存在**：本仓没有 `.tools/ui-motion*`（`ls .tools/ui-motion*` ⇒ No such file；
   全仓 grep `.tools/ui-motion` 零命中，包括 package.json 与所有 md）。动效门的真身是
   **`tests/ui-motion.test.mjs`（11 条判据）**，其中「hover 缺 `transition`」是第 9 条
   `interactive 的 :hover 改了背景/颜色/透明度就必须有 transition`。所以「跑 `node .tools/ui-motion*`」这一步无法执行，
   我按实际入口 `node --test tests/ui-motion.test.mjs` 跑的。
2. **门禁的「红名单」在我接手时是空的**（11 tests / 11 pass / 0 fail，那条 hover 判据报 0 条 offending）。
   这与派单「把红名单逐条补上」的前提不符，也与 `docs/batch-2026-10-06-main.md:59` 记的「动效那 1 条红（4 处 `:hover` 缺底规则 transition）」不符。
   ⇒ 按规约 §1「判词、别人的报告、主代理给你的坐标都可能是编的」，我没有照着名单改，而是**另写一把更宽的扫**去核
   「门禁为什么绿」，并做了**反向验证**证明这条判据本身不是死的。
3. 结论：门禁确实漏判三类形状（分组底规则 / 底规则上方有注释 / 标签型底选择器），照这三类重扫全仓只抓到
   **1 处真缺**，已按铁律补上（只补那一条底规则的 `transition`，走 `--dur-1`/`--ease` 令牌，没加按压/淡入、没加全局元素选择器）。
   派单点名「4 处」里另外 3 处经打开代码核实**不是缺陷**（2 处是 `<button>`，由 `src/style.css:54` 的全局 `button` 过渡覆盖；
   1 处底规则本来就有过渡）。

---

## 1. 判词表

| 族 | 项 | 判定 | 上游依据 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|---|
| 动效门 | 门禁入口 `.tools/ui-motion` | `[-]` | 不适用（本仓自身门禁） | — | 该入口在本仓不存在（`ls .tools/ui-motion*` 零命中、全仓 grep 零命中）；真入口 `tests/ui-motion.test.mjs` |
| 动效门 | 跑门禁、取红名单 | `[x]` | 不适用 | `tests/ui-motion.test.mjs`（11 条，收工 11/11 绿） | 接手时 0 红，收工时 0 红；红名单为空这件事本身登记为与派单/主台账的矛盾 |
| 动效 hover | `DependencyAnalyzerDialog.vue:134` `.analyzer-list li` | `[x]` 已修 | 不适用（门禁 §hover 判据） | `src/components/DependencyAnalyzerDialog.vue:134` | 组件:134 → 底规则补 `transition: background-color var(--dur-1) var(--ease);` → 宽扫从 1 条红转 0 条红；**门禁侧一直是绿**（它对这种形状漏判，见 §4） |
| 动效 hover | `main.md:59` 名单项 1 `DebugInspectWindow.vue` | `[-]` 不是缺陷 | 不适用 | `src/components/DebugInspectWindow.vue:156-157,186-187` | `.debug-btn:hover` 改 `background`/`color`，但 `.debug-btn` 挂在 `<button>` 上 ⇒ 由 `src/style.css:54` 全局 `button { transition: background-color …, color …, border-color … }` 覆盖（CSS 上确实会过渡），门禁按设计排除按钮类 |
| 动效 hover | `main.md:59` 名单项 2 `EventLogPanel.vue` | `[-]` 不是缺陷 | 不适用 | `src/components/EventLogPanel.vue:194,249-250` | `.eventlog-link:hover` 改 `color`，同类情形：`.eventlog-link` 用在 `<button>`（:194）⇒ 全局 button 过渡覆盖 |
| 动效 hover | `main.md:59` 名单项 3 `RefactorPreviewDialog.vue` | `[-]` 早做过 | 不适用 | `src/components/RefactorPreviewDialog.vue:145,157` | `:145` 底规则 `.refactor-preview-node, .refactor-preview-row` 已写 `transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease)`；`:157` 的 hover 有过渡。门禁看不见它是因为底规则是**分组选择器**（`selector === base` 全等匹配不上） |
| 动效 hover | `main.md:59/109` 名单项 4 `style.css` `.status-inspection-profile-select` | `[x]` 主代理已做 | 不适用 | `src/style.css:1311-1312` | `:1311` 已有 `transition: color var(--dur-1) var(--ease)`，与 `main.md:220`「已修」一致；`src/style.css` 按规约 §2 属主代理独占，我没动 |
| 动效 hover | 4 个在途组件（ProblemsPanel / TerminalPanel / DiffView / RunAnythingDialog） | `[-]` 无需动 | 不适用 | `ProblemsPanel.vue:844,846,882` · `TerminalPanel.vue:789,790,812` · `DiffView.vue:516,517,520` · `RunAnythingDialog.vue`（无 `:hover` 改可见属性） | 先看了 mtime（见 §6），再逐个开代码：`RunAnythingDialog` 没有这类规则；`TerminalPanel:789 .terminal-tab` 底规则自带三条 `--dur-1` 过渡；其余 hover 目标全是 `<button>`（`problem-ignore`、`problems-group`、`terminal-menu-row`、`diff-fold-toggle`、`diff-fold-row`）⇒ 全局 button 过渡覆盖。**结论是「不是缺陷」而不是「跳过」**，没有产生需要登记的冲突 |
| 动效门 | 令牌合规（我这次唯一新增的声明） | `[x]` | 不适用 | `src/components/DependencyAnalyzerDialog.vue:134` | 走 `var(--dur-1)` / `var(--ease)`；无裸毫秒、无裸 cubic-bezier、无裸十六进制；属性只列 hover 真正改的那一个（`background-color`），未用 `transition: all`（门禁第 5 条也管这个） |
| 文档 | `AGENTS.md` 不存在 | `[x]` 核实 | 不适用 | 仓库根 | 多轮 lane 报的这件事成立；`docs/batch-2026-10-06-status2defect.md:270` 已在请主代理补 |
| 文档 | `HANDOFF.md:445`「6 处真缺，全补上」与现状不符 | `[x]` 已改（留痕） | 不适用 | `HANDOFF.md:445-454` | 原文只覆盖门禁可见域；我补了一段留痕写清三类漏判形状 + 实测的 1 处新缺 + 反向验证三步数字 |
| 文档 | `main.md` 的动效红名单（:59/:109/:176/:201/:220/:248） | `[ ]` 未改，交主代理 | 不适用 | `docs/batch-2026-10-06-main.md:59` 等 | 该文件 12:03:46 还在被主代理写（本次会话期间），我改必然撞；核对结论与可照抄的替换文本在 `docs/wiring-requests-2026-10-06-audit2.md` |
| 文档 | `tests/ui-motion.test.mjs` 注释里两处错行号 | `[ ]` 未改，交主代理 | 不适用 | `tests/ui-motion.test.mjs:226`、`:261` | 不是 src 但也不在我的可改面（派单只授权「给底规则补过渡」）；实况：button 规则在 `src/style.css:54`（注释写 38）、`.row-menu-button` 在 `src/components/WelcomePage.vue:657`（注释写 `style.css:744`，那行实为 `.trace-detail p { display: flex; gap: var(--space-2); }`） |
| 文档 | `docs/inventory/*.md` 计数自相矛盾 | `[ ]` 无法改（禁改面） | 不适用 | `docs/inventory/actions_verdict_table.md`、`verdict-actions.md`、`docs/inventory/*_verdict_table.json` | 见 §2 第 5-8 条；docs/inventory 是保留文件，只登记 |

---

## 2. 常驻文档审计：互相矛盾 / 与代码现状不符（每条带 文件:行号 + 打开代码看到的实况）

1. **`docs/batch-2026-10-06-main.md:59`**：「⏳ 动效那 1 条红（4 处 `:hover` 缺底规则 `transition`）：`DebugInspectWindow.vue`（桶 12）/`EventLogPanel.vue`（桶 6）/`RefactorPreviewDialog.vue`（桶 1）/`style.css`（我）」。
   实况：`node --test tests/ui-motion.test.mjs` ⇒ **11 pass / 0 fail**，那条判据报 0 条 offending；四处里 2 处是 `<button>`（全局过渡覆盖，非缺陷）、
   1 处底规则早有过渡（`RefactorPreviewDialog.vue:145`）、1 处主代理已修（`style.css:1311`）。同文件 `:176`、`:201`、`:220`、`:248` 重复了这份过期名单。
2. **`docs/batch-2026-10-06-main.md:105`**：「`node --test tests/status-widgets-registry.test.mjs tests/ui-motion.test.mjs` | **16 / 15 / 1 失败**」。
   实况（12:0x 复跑）：**18 / 18 / 0 失败**（两个文件合计 18 条）。数字与用例数都漂了（16→18），且那条「1 失败」正是上面第 1 条的同一件事。
3. **派单本身**：「本仓有 `.tools/ui-motion` 门禁」。实况：`.tools/` 下无任何 `ui-motion*`，全仓 grep `.tools/ui-motion` 零命中 ⇒ 门禁在 `tests/`。
   规约 `.tools/agent-rules.md:47-58`（§5 门禁与自查清单）也**没有把动效门列进自查**，所以按规约跑自查的代理不会跑到它 —— 这是「派单/规约/实际门禁」三处口径不一致。
4. **`tests/ui-motion.test.mjs:226`** 注释写「`src/style.css:38` 的全局 `button` 规则」；实况是 `src/style.css:54`，
   而 `src/style.css:38` 落在条纹按钮（`.activity-*`）那段注释的正文里（`:39` 才是 `.activity-name { display: none; }`）—— 照 38 去改会改到注释。
   **`tests/ui-motion.test.mjs:261`** 注释写「`.row-menu-button` 本来就有（`style.css:744`）」；实况：`src/components/WelcomePage.vue:657` `.row-menu-button { opacity: 0; transition: opacity var(--dur-1) var(--ease); }`，
   而 `src/style.css:744` 是 `.trace-detail p { display: flex; gap: var(--space-2); }` —— 文件和行号都不对。两处都在注释里，不影响判据，但正是「下一个代理照抄错坐标」的来源。
5. **`docs/inventory/actions_verdict_table.md:1-10`**（表头档位统计 `[x]` 0 / `[~]` 0 / `[ ]` 0 / `[-]` **317**，逐类表 317 行实测也全是 `[-]`）
   与 **`docs/inventory/verdict-actions.md:1-8`**（「四档合计 13 + 39 + 2 + 263 = 317」）对同一域给出**两套互斥判决**。
   `actions_verdict_table.json` 的 `counts` 同样是 `{total:317,x:0,~:0,blank:0,-:317}` ⇒ 不是 md 排版问题，是生成物与手写判决的实质分歧。
6. **生成物形状漂移**：`*_verdict_table.json` 有三种 schema —— `actions/daemon/execution/find-diff/platform_rest/projectviews/xdebugger` 用 `{total,x,~,blank,-}`；
   `settings-run_verdict_table.json` 用 `{"[ ]","[-]","[~]","[x]"}`；`vcs_verdict_table.json` 根本没有 `counts`（是 path→tier 的裸映射）。
   而 `scripts/verdict_table.py:816-817`（生成物头部写死的说明）声称「门禁 `tests/verdict-generated.test.mjs` 读同名 `.json`」——
   实况 `tests/verdict-generated.test.mjs:18` 的 `DOMAINS` 只有 **5** 个域（execution / xdebugger / projectviews / daemon / platform_rest），
   `actions`、`find-diff`、`settings-run`、`vcs` 四份 JSON **没有任何门禁在读**（第 5 条那个矛盾因此能长期存在）。
7. **`tests/verdict-generated.test.mjs:1-4`** 头注释「`execution`（B8）、`xdebugger`（B8）、`projectviews`（B9）」三域；
   实况 `:18` 是 5 域（多了 `daemon`、`platform_rest`），`:3` 又说「这几个域太大（2243 + 755 类）」。同一文件里三种口径。
8. **`scripts/verdict_table.py:18`**「产出：`docs/inventory/<域>_verdict_table.md` + `.json`（门禁读 JSON，文档读 md）」+ `:815`「本文件由 `python scripts/verdict_table.py <域…>` 生成，不要手改」；
   实况 `docs/inventory/` 同时存在 `*_verdict_table.md`（生成）与 `verdict-*.md`（手写，38 个 md 里 17 个是 `verdict-*` 前缀），
   而 `verdict_table.py` 的 `FAMILIES` 族表键前缀是 `exec/ dbg/ dm/ dv/ es/ esa/ ex/ an/ com/ completion/ cs/ csi/ daemon/ pv/ lp/ pf/ ic/ vc/ …`（我按行首统计），
   **没有 `actions` 域该有的族** ⇒ 跑 `actions` 就得到「全 `[-]`」的默认降级表。这条能解释第 5 条，但两份文档谁都没写这件事。
9. **`.tools/agent-rules.md:22` vs 派单保留清单**：规约 §2 说主代理独占 **`src/style.css`**（我据此没动它，尽管派单的「保留文件禁改」清单里没有 style.css）；
   派单清单里又有规约没写的 `scripts/verdict_table.py`、`docs/inventory/*.md`。两份规约口径不同，我按**并集**执行（更保守），在此留痕。
10. **`.tools/agent-rules.md:78`（预算 150 次）vs 派单（约 90 次）**：按派单（更严）收口。
11. `.tools/agent-rules.md` 里**可核实的陈述我逐条开了代码**，这些是对的，不用改：§5 的四个上限数字 900/1100/1300/2000 与 `tests/module-size.test.mjs:22,28,37,190` 完全一致；
    §5 提到的 `.tools/find-param-props.mjs`、`find-ts-in-mjs.mjs`、`find-missing-ext.mjs`、`find-orphan-modules.mjs --gate`（脚本 `:27,:432` 确实支持 `--gate`）都在；
    §5 的 `npm run test:native` 在 `package.json:11`；§2 列的 `src/menus/types.ts`、`src/keymapBindings.ts`、`src/actionRegistry.ts`、`src/settingsTreeMeta.ts`、`src/uiIcons.ts` 都存在的文件；
    §5 点名的 `tests/source-citations.test.mjs`、`tests/source-citation-anchors.test.mjs` 都在。**唯一要动的只有 §5 没列动效门**（见第 3 条），而那是规约本体，我不自改。

---

## 3. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 性质 |
|---|---:|---:|---|
| `src/components/DependencyAnalyzerDialog.vue` | 146 | 146（±0，单行内追加一条声明） | src 样式，唯一一处功能改动 |
| `HANDOFF.md` | 673 | 681（+8 行留痕，原行未删未重排） | 文档 |
| `docs/batch-2026-10-06-audit2.md` | — | 本文件 | 交付 |
| `docs/wiring-requests-2026-10-06-audit2.md` | — | 见该文件 | 交付（§7 第 7 项） |

`git diff --stat` 自查：`src/components/DependencyAnalyzerDialog.vue | 2 +-`（1 insertion, 1 deletion），
`git diff` 全文只有一个 hunk，内容就是 `.analyzer-list li` 那一行末尾多了 `transition: background-color var(--dur-1) var(--ease);`；
`src/components/BranchPopup.vue` 反向验证探针**已全部撤销**（`git diff --stat` 对该文件零输出）。别人的在途文件（`src/quickDocHost.ts`、`src/runConfigEditors.ts` 等）一个没碰。

---

## 4. 门禁 before/after 原始数字（派单 §3 要求的四条 + 规约 §5 相关）

> 收工这一刻的 `npx vue-tsc -b --force` 有 **12 条**错，全在别人的在途文件（`CodeEditor.vue` / `editorSplitLine.ts` / `lspNavigation.ts`），
> 与我的改动无关（我改的是 `<style>` 里一条 CSS 声明）。按规约 §5 末条「只跑自己域、别把别人的在途红算到自己头上」，
> 我**不去修、也不为此改任何别人的文件**，只把两份数字（接手时 0 错 / 收工时 12 错、0 条在我面）如实记在这儿供主代理归因。

| 命令 | before（接手时） | after（收工） |
|---|---|---|
| `node --test tests/ui-motion.test.mjs` | `tests 11 / pass 11 / fail 0`（hover 那条：0 offending） | `tests 11 / pass 11 / fail 0`（hover 那条：0 offending） |
| `node .tools/ui-motion*`（按实际入口） | **无法执行**：`.tools/ui-motion*` 不存在（`ls` 报 No such file；`node .tools/ui-motion.mjs` 报 `internal/modules/cjs/loader` MODULE_NOT_FOUND）；全仓 grep `.tools/ui-motion` 零命中 ⇒ 以上一行 `tests/ui-motion.test.mjs` 的数字就是它的实际入口结果 | 同左 |
| `node --test tests/source-citations.test.mjs` | `tests 3 / pass 3 / fail 0` | `tests 3 / pass 3 / fail 0`（写完两份文档 + HANDOFF 留痕后复跑仍 3/3；引用的都是本仓 `.vue/.css/.mjs` 坐标，门禁只收 `.kt/.java/.xml/...` 形状 ⇒ 不会把转述当断言） |
| `npx vue-tsc -b --force` | **0 错**（12:0x 那次，`.tmp-audit2-tsc.txt` 空、exit=0） | **12 错 / exit=1**，其中 **0 条在我改的文件里**：全部落在别人的在途面上——`src/components/CodeEditor.vue(116,44) TS2304 smartEnterLanguageForView`、`src/editorSplitLine.ts(146,61) TS2345`、`src/lspNavigation.ts(16/18) TS2300×3 + TS2305 jumpTargetPane`（其余重复行是同一批的续行）。⇒ **不是我这次改动引入**（我只在一个 `.vue` 的 `<style>` 里追加一条 CSS 声明，类型层不可能受影响），但收工这一刻全量 typecheck 是红的，须由主代理按在途车道归因 |
| 附带：`node --test tests/status-widgets-registry.test.mjs tests/ui-motion.test.mjs`（main.md:105 那一对） | main.md 记 `16 / 15 / 1 失败` | 实测 `18 / 18 / 0 失败` |
| 附带：`node --test tests/verdict-generated.test.mjs` | `5 / 5 / 0`（只覆盖 5 域，见 §2 第 6 条） | `5 / 5 / 0`（我没改 inventory 任何文件） |

**「组件:行 → 补了什么 → 门禁从红转绿」逐条（铁律要求的台账）**：

- `src/components/DependencyAnalyzerDialog.vue:134`（底规则 `.analyzer-list li`，触发点是 `:135` 的 `.analyzer-list li:hover { background:var(--hover); }`）
  → 底规则末尾补 `transition: background-color var(--dur-1) var(--ease);`
  → **宽扫（我自己那把能看见标签型底规则的门禁等价物）从「1 条红」转「0 条红」**；
  `tests/ui-motion.test.mjs` 那条 hover 判据**改前改后都是绿**（它按 `:hover` 前的 selector 全等找底规则，且 `:262` 遇到含空格的 base 直接 `continue`，
  `.analyzer-list li` 两个形状都落在它的盲区）⇒ 这一条我不能声称「门禁从红转绿」，只能说「缺陷从有到无，门禁看不见它」。
- 其余 30 条候选（`fs-*`、`chooser-*`、`hist-*`、`bp-*`、`debug-btn`、`chip-x`、`gradle-task`、`todo-row`、`keymap-row`、`plugin-*`、`market-*`、`settings-tab`、`group-edit`、`errors-cluster`、`deps-edge`、`ps-side-item`、`endpoints-row`、`eventlog-link`、`tools-macro`、`run-dashboard-*`、`outline-*`、`refactor-preview-row`、`analyzer-*`… ）
  逐条开模板核实元素标签：除 `icon-button.is-on`（`src/style.css:254` `.icon-button` 自带 `transition: background-color … , color …`）外，
  全部是 `<button>` 上的类 ⇒ `src/style.css:54` 的全局 `button` 过渡覆盖 `background-color/color/border-color/box-shadow`，**不是缺陷，未改**（按规约 §3「不许自加动效」，也不该给它们再叠一条）。

---

## 5. 反向验证记录（规约 §3/§5 要求的三步，数字）

在 `src/components/BranchPopup.vue`（mtime 2026-10-02 18:47，无人认领、非四个在途文件）的 `</style>` 前注入探针，跑三次：

| 步骤 | 注入内容 | `node --test tests/ui-motion.test.mjs` | 我的宽扫 |
|---|---|---|---|
| ① 基线 | 无 | `11 / 11 / 0` | `真缺陷 0 条 / 0 个文件` |
| ② 注入违规（门禁**看得见**的形状） | `.probe-hover { background: var(--panel); color: var(--text); }` + `.probe-hover:hover { background: var(--hover); }` | `11 / 10 / 1` 红，断言原文：`这些 :hover 改了可见属性但底规则没有 transition：src/components/BranchPopup.vue:137  .probe-hover:hover（底规则 .probe-hover）` | 1 条 |
| ③ 换成门禁**看不见**的两种形状 | `.probe-group-a, .probe-group-b { background: var(--panel); … }` + `.probe-group-a:hover {…}`；`/* 探针注释 */` + `.probe-comment {…}` + `.probe-comment:hover {…}` | **`11 / 11 / 0`（仍全绿）** | **2 条**（`BranchPopup.vue:137`、`:140`）⇒ 两条真缺在门禁眼里不存在 |
| ④ 撤探针 | 删净 | `11 / 11 / 0` 复绿，`git diff --stat -- src/components/BranchPopup.vue` 空 | 0 条 |

结论：hover 判据**不是死的**（②能红），但在③的两种形状上**确实漏判**，加上 §4 里 `.analyzer-list li` 的第三种（标签型 base 含空格直接 `continue`），
就是「门禁全绿 vs 主台账记 1 条红/4 处」两套口径能长期并存的根因。

---

## 6. 在途文件（mtime 实测）与跳过登记

派单点名的四个文件，动之前都看了 mtime（对照当时系统时间 12:01）：

| 文件 | mtime | 距今 | 处置 |
|---|---|---:|---|
| `src/components/ProblemsPanel.vue` | 2026-10-06 11:08:49 | ~52 min | 只读核对：`:844/:846 .problem-ignore`、`:882 .problems-group:hover` 的目标都在 `<button>` 上（`:745`、`:759`）⇒ 无缺陷需要补，**没碰文件** |
| `src/components/TerminalPanel.vue` | 2026-10-06 11:51:10 | ~10 min（**在跑**） | 只读核对：`:789 .terminal-tab` 底规则自带 `background-color/color/border-color` 三条 `--dur-1` 过渡；`:790`、`:796`、`:812` 的目标（`.icon-button`、`.terminal-menu-row`）分别由 `style.css:254` 与全局 button 覆盖 ⇒ **没碰文件** |
| `src/components/DiffView.vue` | 2026-10-06 11:23:02 | ~38 min | 只读核对：`:516/:519` 底规则的目标 `.diff-fold-toggle`、`.diff-fold-row` 都是 `<button>`（`:430`、`:442`、`:461`）⇒ **没碰文件** |
| `src/components/RunAnythingDialog.vue` | 2026-10-05 01:49:56 | ~34 h（旧） | 该文件里**没有**任何 `:hover` 改 `background/color/opacity/border-color` 的规则 ⇒ 无条目可补，**没碰文件** |

另外三个我没被禁止、但**这一小时内在被别人写**的文件，我也一律没动（避免踩现场）：
`src/components/RunConsole.vue`（11:53:55）、`src/components/DebugConsolePane.vue`（<25 min）、`src/components/VcsLogTable.vue`（<25 min）；
`docs/batch-2026-10-06-main.md`（12:03:46，会话进行中）⇒ 它的错只登记、不改（§2 第 1-2 条 + 接线请求）。
**冲突跳过清单：空**（四个点名文件都不需要改，所以没有「该改但被跳过」的欠账）。

---

## 7. 零消费方自查

本批**没有新增任何模块/文件到 `src/` 或 `native/`**：改动是既有 `.vue` 里一行 CSS 声明 + 两份 docs/ 文档。
扫临时件都放在 gitignore 的 `build/`（`tmp-hover-scan*.mjs`、`tmp-hover-evidence.mjs`）与 `.tmp-audit2-tsc.txt`，收工已删净
（`git status --short` 里我的临时件不出现，`build/`、`.tmp-*` 均在 `.gitignore`）。因此不存在新增零消费方；
`node .tools/find-orphan-modules.mjs --gate` 的结果与本次改动无关（我没跑全量，规约 §5 末条要求只跑自己域的测试）。

---

## 8. 做不到 / 无法核实

1. **`node .tools/ui-motion*` 跑不了**：不是权限或超时，是**该入口在本仓不存在**（§0 第 1 条给了两种实测方式）。按实际入口跑并记数。
2. **门禁「红名单逐条补」这一动作本身没有对象**：接手时 0 红。我没有为了让报告好看而自造红名单，也没有按规约 §3 去改门控本体来制造红。
   如果主代理手上另有一份「红名单」（例如某次改动前跑的旧结果），请给出处；本次会话窗口内它一直是绿的。
3. **`HANDOFF.md:445`「6 处真缺」无法逐条复现**：那 6 处的坐标没写进 HANDOFF，工作区 925 处未提交改动里没有可对照的历史
   （规约 §6 禁 commit/checkout/reset ⇒ 不能靠 git 找回）。我只把「现状」写成留痕，不猜那 6 处是哪 6 处。
4. **`.tools/agent-rules.md` 与 `docs/batch-2026-10-06-main.md` 我都没改**：前者是派单规约本体（子代理自改规则=越权，按系统约束需显式授权），
   后者在会话期间被主代理持续写。两份都只登记 + 给可照抄文本。
5. **`docs/inventory/*.md`/`.json` 与 `scripts/verdict_table.py` 是保留文件**：§2 第 5-8 条的矛盾只登记，未动一个字节。
   「`actions` 域跑生成表会得到全 `[-]`」这一条是我从 `verdict_table.py` 的 `FAMILIES` 键前缀统计推出来的（该域没有族判词表），
   **没有实跑 `python scripts/verdict_table.py actions`** —— 那个脚本 5 分钟前刚被别的 lane 改过、默认模式会覆写 docs/inventory 保留文件，所以停在推断这一步，标「无法核实（未执行，避免覆写保留文件）」。
6. **上游真源**：本批两半都是本仓自身的门禁/文档一致性，没有需要上游行号支撑的结论，故未引用上游树；
   唯一与上游有关的核实是「上游树根确实有一份 `AGENTS.md`」（`D:\Backup\Downloads\intellij-community-master\intellij-community-master\AGENTS.md`，6168 字节，2026-09-25），
   这条支持 `docs/batch-2026-10-06-runinst.md:163` 与 `docs/batch-2026-10-06-vcslog2.md:114` 的说法，不据此改任何行为。
