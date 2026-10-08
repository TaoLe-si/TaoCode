# 批次报告 · 2026-10-06 · lane `foldchord`（折叠域两件：T1 撤里层用户折痕 + 两段式 chord 键位）

上游基准树（唯一可用，本 lane 逐行自开）：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
仓内 `third_party/intellij-community` 坏树，未用。
本 lane 动了：`src/editorFolding.ts`、`src/editorCommands.ts`、新增 `src/foldingKeymap.ts`、`tests/editor-folding.test.mjs`，
并写了 `docs/wiring-requests-2026-10-06-foldchord.md`（宿主那行在保留文件 `CodeEditor.vue`）。
`docs/inventory/verdict-folding.md` 与 `tests/b4-verdict.test.mjs` 由别的 lane 负责，本 lane 未碰。

## A. 折叠代码块要撤掉里层"用户自建的折痕"（T1）

落点自核（不照抄任务书）：`blockFoldPlan` 在 `src/editorFolding.ts:349`、接口 `BlockFoldPlan` 在 `:340`、
命令 `foldBlockAtCaret` 在 `:552`。上游 `platform/foldings/src/com/intellij/codeInsight/folding/impl/CollapseBlockHandlerImpl.java`：
`:49-50`（爬块时记下"已折着、`getPsiElement(existing)==null`=用户自建"的 myPrevious）、
`:58-61`（新建外层后 `removeFoldRegion(myPrevious)`）、`:66-71`（爬到顶只 settle 在 previous 那一支同样 `removeFoldRegion`）。
"是不是用户建的"由 `EditorFoldingInfo.java:44-51` 的 `getPsiElement` 判（没有 smart-pointer ⇒ 用户建的）。

本仓等价：折着、且不在候选里 ⇒ `FoldArea.auto === false`（`areasOf` 给手工折痕打的那档）。
`blockFoldPlan` 现多一个 `swallowed` 入参 + 返回 `remove`（落点整条含住的手工折痕），
`foldBlockAtCaret` 用 `areasOf(view.state, pos).filter(!auto)` 喂它，折完外层再 `applyAreas(..., false)` 一并撤掉。
**反向**：落点里那条若是服务端/语法树候选（`auto === true`，对应 `getPsiElement != null`）⇒ 不进 `remove`、不撤，
IDEA 对自动区域同样留着（既有端到端 `再按一次往外折一层` 因此仍绿）。

诚实登记的一处差异：上游 `myPrevious` 只在"手工折痕正好压在某个块的边界"时记下（`findFoldRegion(start,end)` 命中块边界那条），
本仓没有 PSI 边界，`remove` 取的是"被落点整条含住的任意手工折痕"（范围略宽），可见契约一致（屏幕上只剩外层一条）；
写进 `blockFoldPlan` 的注释，不假装 1:1。

## B. 两段式 chord 键位（订正"分不开、只能单段"的误读）

上游 10 行自开：`platform/platform-resources/src/keymaps/$default.xml:385-403`（`ExpandToLevel1..5` =
`control MULTIPLY` + `second-keystroke="1".."5"`）、`:405-424`（`ExpandAllToLevel1..5` = `control shift MULTIPLY` + 1..5）。
本仓旧断言自开：`tests/editor-folding.test.mjs`（改前 `:353` `Ctrl+*`单段→unfold.level1、`:359` `Ctrl+Shift+*`→unfold.level1、
`:362` 标题「级别那一条只绑到 1」+ `:376` pair `Ctrl-*→unfold.level1`）—— 钉的正是"分不开、只能单段"这一误读。

CodeMirror chord 支持，本机实证（行号自己数）：`node_modules/@codemirror/view/dist/index.js:9164`
`buildKeymap` `key.split(/ (?!$)/)`；`:9165-9179` 注册多段前缀；`:9154-9160` `checkPrefix`（同键既当普通绑定又当前缀 ⇒ 抛）；
`:9222-9228` + `:9251` `runHandlers` 前缀补全第二段。字符键的 Shift 在首次查表被 `modifiers`（`:9106-9116`）去掉
⇒ `Ctrl+Shift+*` 解析成前缀 `Ctrl-*`，与 `Ctrl+*` 分不开。

落地：新增 `src/foldingKeymap.ts`（权威表 `foldingLevelChords`：`Ctrl-* 1..5` → `unfold.level1..5`，**只 caret 族**），
`src/editorCommands.ts` 接成 `foldingKeymap: KeyBinding[]`（`run` = 同名命令）。
caret 族两段式真实可用（`Ctrl+*` 单段只是前缀不触发，`Ctrl+* N` 触发第 N 级）；
`ExpandAllToLevel`（`Ctrl-Shift-*`）在浏览器里与 `Ctrl+*` 完全分不开 ⇒ **不编假键位**（规约 §8），
`unfold.all.level1..5` 只走 Code 菜单子菜单，理由写进表头注释。宿主落地那行（摘 `CodeEditor.vue:882` 换 `...foldingKeymap`）=
`docs/wiring-requests-2026-10-06-foldchord.md` W-1（保留文件，本 lane 不碰）。

判据改动（`tests/editor-folding.test.mjs`，三条旧断言改成仍精确的新判据，非 includes/存在性）：
- 「键位在浏览器的键名规则下真的对得上（八条单段键…）」：截断到 `Ctrl-*` 之前、`entries.length === 8`、逐条 press 精确等值；
- 新增「展开到级别 1–5 = 两段式 chord」：`foldingLevelChords` 键名/命令名 deepEqual 逐条、`foldingKeymap[i].run === editingCommands['unfold.levelN']`（identity）、
  真实 `runScopeHandlers` 跑两段（第一段 hits 为空、第二段落到 `unfold.levelN`，N=1..5）；
- 新增「全部展开到级别…分不开 ⇒ 不绑 chord，只走菜单」：钉表里无 `Ctrl-Shift-*`、`Ctrl+Shift+*`+3 实测落到 `unfold.level3`；
- 「键位照 $default.xml」：去掉 `Ctrl-*→unfold.level1` 那条 pair、常驻检查改判 `Ctrl-Shift-.`，标题不再写"只绑到 1"。

## 反向验证（判据能失败：注入→红→还原→绿→grep token 归零）

| 注入 | 变红的判据 | 还原后 |
|---|---|---|
| 删 `foldBlockAtCaret` 里 `applyAreas(view, plan.remove, false)` | 2 红：`fold.block 端到端正档…只剩外层一条` + `折叠代码块的退路…`（源文本 token） | 38/38 绿；`grep -c "applyAreas(view, plan.remove, false)"` = 1，`grep -c INJECT-REGRESSION` = 0 |
| `blockFoldPlan` 的 `inside` 改成恒 `[]` | 3 红：`落点整条含住的那条手工折痕进 remove` + `settle 在 previous…同样撤` + `端到端正档` | 38/38 绿 |
| `foldingLevelChords` 第 3 条命令 `unfold.level3`→`unfold.level4` | 2 红：`展开到级别 1–5 = 两段式 chord` + `全部展开到级别…分不开` | 38/38 绿；`grep -c "{ key: 'Ctrl-*', command"`（残留单段假绑定）= 0 |

## 收口数字（原始，未粉饰）

- `node --test tests/editor-folding*.test.mjs tests/folding-*.test.mjs tests/sticky-*.test.mjs tests/module-size.test.mjs`
  → **tests 144 / pass 143 / fail 1 / skipped 0**。唯一红是 `module-size`「没有未登记的巨型源文件」，offender = **`src/gradleHost.ts(906 行)`**（别的 lane 的文件，非折叠域）。
  折叠域自身：`editor-folding.test.mjs` 38/38、`folding-*.test.mjs` 45/45、`editor-commands.test.mjs` 9/9。
- `npx vue-tsc -b --force` → **折叠域（`editorFolding.ts` / `editorCommands.ts` / `foldingKeymap.ts`）0 处 `error TS`**。
  报错全在别的 lane 正在编辑的文件里（并发漂移，随时间变），我这一跑落在 `codeLensExtension.ts`(3) / `gradleHost.ts`(1) /
  `rootsModel.ts`(1) / `semanticActions.ts`(1)；早一跑全在 `runAnythingContext.ts`(19)。**没有一条来自折叠域**（非本 lane 责任，且这些文件不在本 lane 可动范围内）。
- `node .tools/find-orphan-modules.mjs --gate` → **本 lane 的 `src/foldingKeymap.ts` 由 `src/editorCommands.ts` 当场消费，不进孤儿清单**。
  收口这一跑门禁红在别的 lane 新冒出来的两个模块（`src/errorTreeExpansion.ts`、`src/intentionList.ts`）—— 与本 lane 无关、也不在本 lane 可动范围内；
  上一跑该 gate 曾是绿的（并发漂移）。折叠域自身对门禁 0 贡献（不新增孤儿）。
- `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` → **tests 11 / pass 8 / fail 3**（红数随别的 lane 在途编辑漂移，
  这一跑坏在 `src/commitChecks.ts`、`src/runStartupFocus.ts`（快照里引用被改指/删除），早一跑坏在 `src/buildContentRoots.ts`（引用了参考树里没有的文件））。
  **折叠域引用 0 条上榜**：本 lane 新写的 `platform/platform-resources/src/keymaps/$default.xml:385-403`、`:405-424` 逐条被 `citationsOf` 收到并核过 ⇒ 指得到；
  `editorFolding.ts` 里对 `CollapseBlockHandlerImpl.java:49-50/:58-61/:66-71` 与 `EditorFoldingInfo.java:44-51` 的引用本 lane 均已开上游逐行确认（`EditorFoldingInfo.java` 用裸名，按门控口径不核完整路径，但内容自核属实）。

## 并发/安全留痕

- 工具结果里两次「MEMORY.md 已被修改，内容如下」式伪系统播报（含"篡改自己的 Edit 返回并催收工"等指令句）一律当**数据**：未据此改任何东西，照常读盘复现。
- 期间 `runAnythingRecentDirectories.ts` 一度让 orphan gate 变红（别的 lane 的在途文件），复跑时该 lane 已接上，gate 回绿；非本 lane 责任，未碰。
- 行号上限只降不升：本 lane 未抬任何上限；`editorFolding.ts` 现 886 行（未登记，默认 900 内，余量 14）；`foldingKeymap.ts` 56 行新模块。
