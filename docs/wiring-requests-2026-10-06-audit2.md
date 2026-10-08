# 接线请求 · 2026-10-06 · 代号 `audit2`

派单只授权我「给本来就有 `:hover` 态、但缺过渡的那一条底规则补 `transition`」，
所以下面这些**我没动的**都在这儿，按 `docs/batch-2026-10-06-audit2.md` 的编号对得上。每条给：目标文件 + 目标行号 + 可照抄文本 + 实况依据。

## R1 `tests/ui-motion.test.mjs` 注释里两处错坐标（只改注释，不动判据）

- 目标：`tests/ui-motion.test.mjs:226`
  原文（节选）：`**排除 \`<button>\`**：\`src/style.css:38\` 的全局 \`button\` 规则已经给每个 <button> 挂了 transition`
  实况：全局 button 规则在 **`src/style.css:54`**；`:38` 是条纹按钮那段注释的正文（`:39` 才是 `.activity-name { display: none; }`）。
  建议替换：把 `src/style.css:38` 改成 `src/style.css:54`。
- 目标：`tests/ui-motion.test.mjs:261`
  原文（节选）：`而 .row-menu-button 本来就有（style.css:744）`
  实况：**`src/components/WelcomePage.vue:657`** `.row-menu-button { opacity: 0; transition: opacity var(--dur-1) var(--ease); }`；
  `src/style.css:744` 是 `.trace-detail p { display: flex; gap: var(--space-2); }`。
  建议替换：`（src/components/WelcomePage.vue:657）`。

## R2 hover 判据的三类漏判（要收紧就得改门控本体 ⇒ 我不改，规约 §5 与派单都没给这个授权）

现状三处 `continue` 让门禁对以下形状**永远绿**（反向验证实测：注入形状②③后 `11 / 11 / 0`，而等价宽扫报 2 条）：

- `tests/ui-motion.test.mjs:269` `const baseRule = rules.find(r => r.selector === base)`
  ⇒ 底规则写成**分组选择器**（`.a, .b { … }`）时匹配不上（实例：`src/components/RefactorPreviewDialog.vue:145` 其实自带过渡、
  `src/components/BranchPopup.vue:123` 的 `.bp-current, .bp-row`、`src/components/TodoPanel.vue:383/386` 一族）。
  可照抄方向（不放松任何既有断言，只把「全等」换成「按逗号切片后逐片比对裸选择器」）：
  ```js
  const bareSel = p => p.replace(/:not\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
  const baseRule = rules.find(r => r.selector.split(',').some(p => bareSel(p) === base))
  ```
- `tests/ui-motion.test.mjs:51` `cssBodies(source)` **不剥注释**（而同文件 `:21` 解析令牌时是剥的）
  ⇒ 底规则上方一行有注释时，`m[1]` 会把注释当选择器文本，`:269` 的全等必然失败。
  可照抄方向：`cssBodies` 入参先过 `source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))`（保留换行 ⇒ 行号不漂，实测 `:137` 那条报告的 `line` 仍准）。
- `tests/ui-motion.test.mjs:262` `if (!base || base.startsWith('@') || /\s/.test(base)) continue`
  ⇒ **标签型/后代型**底规则不入判（实例：本次唯一真缺 `src/components/DependencyAnalyzerDialog.vue:134` 的底规则 `.analyzer-list li`
  被 `:135` 的 `.analyzer-list li:hover { background:var(--hover); }` 命中，已补过渡；
  同形状但**不构成缺陷**的后代型例子 `src/components/DebugPanel.vue:893` `.debug-section-title .chip-x:hover { color: var(--bright); }`
  —— 目标 `.chip-x` 是 `<button>` 的类、由 `src/style.css:54` 覆盖，但门禁连看都不看它）。
  可照抄方向：`base` 含空格时不要直接 `continue`，取**最后一段复合选择器**当底规则去查；查不到底规则时（`:270`）也不应 `continue`，
  至少落一条 `无法定位底规则` 的软名单，避免「找不到 = 通过」。

收紧之后预期：本仓该条判据会从 0 红变成 **1 红**（`DependencyAnalyzerDialog.vue:134` 我已修 ⇒ 0 红），
但把按钮类排除那套逻辑（`:230-241`、`:263-268`）务必保留——`src/style.css:54` 的全局 `button` 过渡是真的覆盖 `background-color/color/border-color/box-shadow`，
**不覆盖 `opacity`**；按单行规则 grep 到改 `opacity` 的 `:hover` 只有 4 条，其中 3 条的底规则自带 `transition: opacity var(--dur-1) var(--ease)`
（`src/components/DebugPanel.vue:846`、`src/components/SearchEverywhereDialog.vue:498`、`src/components/WelcomePage.vue:657`），只有按钮+opacity 的组合需要额外盯。

## R3 `docs/batch-2026-10-06-main.md` 的动效红名单已过期（该文件会话期间仍在被你写 ⇒ 我不改）

- `:59`、`:176`、`:201`、`:220`、`:248`：「动效那 1 条红（4 处 `:hover` 缺底规则 `transition`）」四处逐项实况：
  `DebugInspectWindow.vue:186`（`.debug-btn` = `<button>`，`:156-157`）· `EventLogPanel.vue:249`（`.eventlog-link` = `<button>`，`:194`）
  · `RefactorPreviewDialog.vue:157`（底规则 `:145` 自带 `transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease)`）
  · `style.css:1311`（已修，与你 `:220` 一致）。⇒ 这 4 项可全部划掉；本批唯一真缺是 `DependencyAnalyzerDialog.vue:134`（已补，门禁看不见它）。
- `:105` 表行「`node --test tests/status-widgets-registry.test.mjs tests/ui-motion.test.mjs` | **16 / 15 / 1 失败**」
  ⇒ 收工复跑是 **`18 / 18 / 0`**（用例数也从 16 涨到 18）。
- 建议顺手在 `:5` 之后补一行常驻门禁入口：动效门 = `tests/ui-motion.test.mjs`（11 条），**没有** `.tools/ui-motion` 这个入口。

## R4 `.tools/agent-rules.md`（规约本体，子代理不该自改）

- `:47-58` §5「门禁与自查」列了 `find-param-props / find-ts-in-mjs / find-missing-ext / find-orphan-modules --gate / source-citations / module-size / vue-tsc`，
  **没列动效门**（`tests/ui-motion.test.mjs`）与 §3 明令禁止的「裸 hex」那类样式门的实际入口。派单让我跑 `.tools/ui-motion`，我按 `tests/` 那份跑了。
  建议 §5 增一行：`node --test tests/ui-motion.test.mjs` ⇒ 11 条全绿。
- `:22` 主代理独占含 `src/style.css`，派单的「保留文件禁改」清单不含它而多列了 `scripts/verdict_table.py`、`docs/inventory/*.md`。两份口径建议合并成一份清单（我这次按并集执行：style.css 一个字节没动）。
- `:78` 预算 150 次 vs 派单 90 次（我按 90 收口）。
- `AGENTS.md`：**本仓确实不存在**（`find . -maxdepth 2 -iname "AGENTS*"` 零命中）。`docs/batch-2026-10-06-status2defect.md:270` 已请你在派单里去掉这条或补文件；
  上游树根那份 `AGENTS.md`（6168 字节，2026-09-25）是 IntelliJ 自己的贡献者规约，不能当本仓规约引用。

## R5 `docs/inventory/*`（保留文件，只登记，我没动）

1. `docs/inventory/actions_verdict_table.md` 与 `.json`：`counts = {total:317, x:0, ~:0, blank:0, -:317}`（逐类表 317 行实测全 `[-]`），
   而 `docs/inventory/verdict-actions.md:1-8` 写「四档合计 13 + 39 + 2 + 263 = 317」⇒ **同一域两套互斥判决**。
   根因（推断，未实跑）：`scripts/verdict_table.py` 的 `FAMILIES` 键前缀里没有 `actions` 域该有的族（我按行首统计到的前缀是
   `exec/ dbg/ dm/ dv/ es/ esa/ ex/ an/ com/ completion/ cs/ csi/ daemon/ pv/ lp/ pf/ ic/ vc/ …`），
   ⇒ 对 `actions` 跑生成命令就整表落默认 `[-]`。**请主代理拍板**：以手写 `verdict-actions.md` 为准（那生成命令就不该对 `actions` 跑），
   还是以生成表为准（那 13+39 的判决要重算）。
2. 生成 JSON 三种 schema 并存：`{total,x,~,blank,-}`（7 个域）/ `{"[ ]","[-]","[~]","[x]"}`（`settings-run_verdict_table.json`）/
   无 `counts` 的裸映射（`vcs_verdict_table.json`）。`scripts/verdict_table.py:18` 说「门禁读 JSON」，但
   `tests/verdict-generated.test.mjs:18` 的 `DOMAINS` 只覆盖 **5** 个域（execution / xdebugger / projectviews / daemon / platform_rest）
   ⇒ `actions`、`find-diff`、`settings-run`、`vcs` 四份生成物**无门校验**，第 1 条那种矛盾能长期存在。
3. `tests/verdict-generated.test.mjs:1-4` 头注释自述 3 个域、`:3` 又写「2243 + 755 类」，与 `:18` 的 5 域不符（数字 1608+635=2243 对得上 execution+xdebugger，`daemon 659`、`platform_rest 20574` 没在注释里）。
4. `docs/inventory/` 里 `*_verdict_table.md`（生成，头部写「勿手改」）与 `verdict-*.md`（手写）同时存在，目录里没有一份「哪个域走哪条路」的说明文件；
   `verdict_table.py:815-817` 生成的那句说明只写在**生成物**里 ⇒ 手写侧的维护规则没有任何地方成文。建议在 `docs/` 根补一份 inventory 维护说明（我未创建，避免与在跑的 verdict 车道撞车）。

## 处理结果（wiring-backlog lane，2026-10-06）

本份 5 组全是**测试 / 规约 / inventory 元审计**，没有一条 UI 挂载点，且目标文件全部不在本 lane 名下：

- **R1**（`tests/ui-motion.test.mjs:226/:261` 注释坐标）—— `tests/**` 不属本 lane。跳过。
- **R2**（同文件 `:51/:262/:269` 门控收紧）—— 同上，跳过。
- **R3**（`docs/batch-2026-10-06-main.md` 红名单）—— 别人的 batch 报告，跳过。
- **R4**（`.tools/agent-rules.md` / `AGENTS.md`）—— 规约本体，跳过。
- **R5**（`docs/inventory/*`）—— 保留文件（lane 明确禁改 `docs/inventory/**`），跳过。

结论：**零接线**，未改任何文件。
