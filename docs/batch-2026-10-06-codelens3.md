# 批次报告 2026-10-06 · codelens3（接手被强制中断的 codelens2：Code Vision 渲染闸的判据收到"画出来几条"）

派单范围：① 渲染闸要有**真判据**（关掉一组 ⇒ 那一组装饰 0 条；换档 ⇒ 立刻重算；把钉"配置形状"的
断言改成同样精确地钉"渲染结果"）② 补齐 codelens2"改了断言没落实现 / 落了实现没改断言"的那一对
③ 只记 R5 的现状，本轮不做。
硬约束都守住了：**没有**动 `native/` 任何文件、`CMakeLists.txt`；**没有** checkout/reset/stash/clean/commit/push；
保留文件只读；`.ts` 值 import 全带扩展名。

---

## ① 现场审计：codelens2 到底落到哪一步

它最后一条输出是「Now reverse-verify the native test has teeth (revert the header whitelist temporarily)」
⇒ 停在**准备做反向验证**之前。逐个文件 `git diff` + `git show HEAD:<文件>` 对照的结论：

| 文件 | 结论 | 证据（文件:行号） |
| --- | --- | --- |
| `src/codeLensSettings.ts` | **已落**（实现 + 注释都改了） | 新增两个组 id `:76`/`:78`（`USAGES_CODE_VISION_GROUP_ID='references'`、`INHERITORS_CODE_VISION_GROUP_ID='inheritors'`）、白名单 `:98` 的 `CODE_VISION_GROUP_IDS`（四组一处列）、两条组名常量 `:91`/`:93` 与 `codeVisionGroupName` 的两行分支 `:230-231`。`shouldShowCodeVisionEntry`（`:170`）**没动** —— 闸本来就是 `总闸 && 组闸`，它不需要改 |
| `tests/code-lens-grouping.test.mjs` | **已落，且当场跑绿**（本批接手时 17/17 全绿，不是我修的） | 原来那两条 `readFileSync('src/codeLensExtension.ts')` + `includes` 的「接线：…」断言被整条删掉，换成渲染结果判据：`:93` 同锚点合成一条块装饰（比 `block`/`side`/`from`）、`:111` 命令非法一条都不画、`:127` 行号越界跳过、`:243` 右键隐藏后原地重画且 `queries===0`、`:321` **四组逐组关掉 ⇒ 被关那一组 0 条**（真控制器 + 真注册表 `createCodeVisionRegistry().compute(...)`，条目不是测试自己拼的 providerId）、`:367` 白名单与注册表同源 |
| `src/components/CodeVisionSettingsPage.vue` | **已落**（派单没列它，但它是 codelens2 现场的一部分） | `:51` `const GROUPS = CODE_VISION_GROUP_IDS`（原来自己列两组）、`:69-78` `syncRuntime()` 补刷第四把键 `codeVisionVisibleEntries`、`:80` 那条 watch 的取值串带上第四把键 |
| `src/previewSettings.ts` | **已落**（同上，派单也没列它） | `:87` 组集合校验从"逐字比两个 id"改成 `!CODE_VISION_GROUP_IDS.includes(id)` 且多一条 `typeof id !== 'string'` |
| `native/settings_editor_keys.hpp` | **已落四组**（本批只读复核，没动） | `:95` `if (id != "LspCodeVisionProvider" && id != "problems" && id != "references" && id != "inheritors")`。车道板 `docs/batch-2026-10-06-lane-board.md:11` 记着这条 lane 曾**停在注入态**（白名单 4→2），今天盘上是四组 ⇒ 那一步已被还原；配套原生测试 `native/settings_editor_keys_test.cpp:63`（`known_groups` 四组）与 `:105`（往 `codeVisionDisabledGroups` 塞 `references` 的用例）在盘上 |
| `src/cvLocalVision.ts` | **不是 codelens2 的现场**（派单的假设错了） | 它当前 M 的内容是**另一条 lane（hlfeat，逐文件能力表）**：`:46` `import { lspFileFeatures } from './lspPerFileCapabilities.ts'`（那个文件在 `git status` 里是 `??` 未跟踪）、`:227/:246/:259` 的 `plan(...).ask` 与 `:230/:251/:260/:277` 的 `ask(...)`。与 Code Vision 的渲染闸无关 ⇒ **本批一个字都没动它** |
| `src/components/OutlinePanel.vue` | **不是 codelens2 的现场** | M 的内容是 `:5/:105/:140` 的 `symbolPresentableName`（outline/符号显示名那条线，车道板 `:18`/`:41` 也已把这两个文件标成重叠现场）。与派单列给 codelens2 的四个文件里"渲染闸"无关 ⇒ **没动** |
| `src/workspaceLifecycle.ts` | **不是本域现场** | M 的内容是 `:65/:89/:298/:417` 的 `changePlaces`（nav/places 那条线）。本域只需要它的 `:224` 那个调用点（codelens2 的注释引用它，本批核对为真） |

**尾巴核对（派单让复跑的那条 grep）**：`grep -rn "REVFIX\|INJECT\|TEMP 反向验证\|TODO 本批" src tests`
⇒ 只有三行 `ANALYZE_INJECTED_CODE` / `myAnalyzeInjectedCode` 的**既有命中**（`src/analysisScope.ts:32,119`、
`src/components/ScopesSettingsPage.vue:360`，那是上游注入语言的 flag 名，不是注入标记）。
按词边界复跑 `grep -rn "REVFIX\|TEMP 反向验证\|TODO 本批" src tests` 与 `grep -rn "\bINJECT\b" src tests`
⇒ **0 命中**，与主代理的结果一致。

**审计结论一句话**：codelens2 的"实现 + 断言"这一对**是齐的、当场是绿的**（我接手第一件事就是跑它，17/17）；
它真正没做完的是三件事 —— ①没跑反向验证 ②没写批次报告 ③源码里引用了一份**从未落盘**的接线请求
`docs/wiring-requests-2026-10-06-codelens2.md`（`src/codeLensSettings.ts:56` 点名 C-2 ⇒ 悬空引用）。
另外它**改了自己的注释却没改另一处同样的假话**：`src/codeLensExtension.ts` 里仍写着"本仓没有 Code Vision 设置页"。

## ② 本批改动

**实现（一条真缺陷，判据先立后改）**

`src/codeLensSettings.ts:268` 的 `restoreCodeVisionSettings`：两个组集合原来是**只加不删**
（`for (const id of patch.disabledGroups ?? []) codeVisionSettings.disabledGroups[id] = true`）。
这张表是跨工程存活的模块级 reactive，而读盘点 `src/workspaceLifecycle.ts:224` 每次打开工程都调它 ⇒
工程 A 里关掉 `references`，打开盘上写着空数组的工程 B 时那一组**仍然一条都不画**，
而设置页按盘上那份把它显示成"勾着" —— 界面与画出来的东西相反。上游是替换：
`platform/lang-api/src/com/intellij/codeVision/…/CodeVisionSettings.kt:164-166`
（`override fun loadState(state: State) = … this.state = state`，本批 `sed -n '160,175p'` 逐字读到），
那两个集合是 `State` 上的 `var`（同文件 `:45`/`:50`，`sed -n '25,70p'` 读到）。
现在：`:247` 新增 `replaceGroupSet()`，`:279-280` 按**键在不在**决定"整份替换 / 保持现值"
（空数组 = 明确打开；缺键 = 旧存档没这一键，不许偷偷改动已关的那一组 —— 这条口径与
`codeVisionVisibleEntryLimit` 的坏值兜底同性质，`tests/code-vision-anchor-limit.test.mjs:110-123` 钉着）。

**判据（`tests/code-lens-grouping.test.mjs` 17 → 20 条，全部数"画出来几条"，没有放松成 includes）**

- `:435` **盘上写着关掉某一组 ⇒ 那一组在装饰集里 0 条；换回出厂空数组 ⇒ 立刻回来**。
  走的是真实链路：`diskDraft()`（`:404`，四把键 = `native/settings_schema.cpp:414-417` 的出厂形状）→
  `restoreCodeVisionSettings` → 真控制器 + 真注册表（`fourGroupChannel()`，`:409`）→
  `rowsOfState(state)` 数装饰。四组逐组各测"关"与"开"两半，并钉 `queries===1`（读回设置不许重问服务器）。
  第③段还钉了 `codeVisionSettingsPatch() → restoreCodeVisionSettings()` 的**往返渲染等价**
  （关两组 → 存盘出口 → 灌一份出厂 → 再灌回存的那份 ⇒ 画出来的必须一模一样）。
- `:483` **缺键 = 保持现值 / 空数组 = 明确打开**（两种"没写"分清；这一条正是"只加不删"那个缺陷的另一半）。
- `:515` **设置页 SSR 真渲染**：`loadSfc('src/components/CodeVisionSettingsPage.vue')` + `renderToString`
  （夹具 `tests/vue-sfc-loader.mjs`，同 `tests/problem-code-grouping.test.mjs:163` 那条路），
  从 HTML 里读**四个**分组复选框、勾掉那一组不带 `checked`、数字格 `value="3"` 与 `min="1" max="10"`。
  旧实现只列两组时「用法计数 / 继承者计数」两行根本不存在 ⇒ 红。

**注释/记账订正（都不改行为）**

- `src/codeLensSettings.ts:39-49`：把"只剩一个调用方 / `CodeVisionSettingsPage.vue:61-63` 只刷两组、
  第四把没刷"改成磁盘现状（L-1 在 `workspaceLifecycle.ts:224`、L-3 在页面 `:69-78`，未接的只剩 L-2），
  并留 codelens3 的整份替换订正。
- `src/codeLensSettings.ts:50-60` 与 `src/codeLensExtension.ts:74-90`：两处「Lens Settings…」是**编造文案** ——
  上游 `CodeVisionContextPopup.kt:24` 那一行的文案键是 `LensListPopup.tooltip.settings`，
  原文 `CodeVisionBundle.properties:10` = `&Configure…`（本批 `sed -n '8,12p'` 读到；
  同文件 `:11` 的 `"&Settings` 是 `CodeVisionListPopup.kt:23` 的 tooltip，不是这条菜单行）。已按原文改回，
  中文那一版**无法核实**（`find` 本地树里没有 `CodeVisionBundle_zh*` / `localization-zh*`）⇒ 不编中文。
- 新建 `docs/wiring-requests-2026-10-06-codelens2.md`：把 `src/codeLensSettings.ts:56` 点名引用却从未落盘的
  C-2（「`&Configure…`」那一行的宿主接线）补上，另登记 C-3（`src/bridge.ts:126` 的 `LspHoverResult` 没有 `range`
  那一格，保留文件 ⇒ 请求；与 `docs/wiring-requests-2026-10-06-lshl.md` 的 W3 同一件事，不重复催）。

**没做的事**：`src/cvLocalVision.ts`、`src/components/OutlinePanel.vue`（别人的在途现场）、
`native/**`、`CMakeLists.txt`、`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、
`tests/module-size.test.mjs`；`tests/setkeys-batch.test.mjs:188-192` 那两条读设置页源码文本的断言
（`assert.match(page, /codeVisionSettings\.enabled = props\.settings\.codeVisionEnabled/)` 等）
在别人名下 ⇒ 只在本文档登记，不改：**它们钉的是"页面里有这一句"，勾错组、少刷一把键都测不出**，
本批的 `:515` 那条 SSR 判据是同一件事的行为版替代（等值数复选框），可以在收口时把那两条摘掉。

## ③ 跑测数字与反向验证

跑测（还原注入之后的最终状态，原始输出）：

| 命令 | 结果 |
| --- | --- |
| `node --test tests/code-lens-grouping.test.mjs tests/code-vision-anchor-limit.test.mjs tests/code-vision-local-channel.test.mjs tests/code-vision-providers.test.mjs tests/code-lens.test.mjs tests/code-lens-codicon.test.mjs tests/code-lens-command.test.mjs tests/code-lens-refresh.test.mjs tests/cv-local-vision.test.mjs` | **85 / 85**（0 红，900ms）；本批动的那一份单跑 **20 / 20** |
| 同上再并 `tests/setkeys-batch.test.mjs`（读回链路的另一个消费方） | **105 / 105** |
| `node --test tests/module-size.test.mjs` | **5 / 5**（`codeLensSettings.ts` 293 行、`codeLensExtension.ts` 449 行，界 900） |
| `node .tools/find-missing-ext.mjs` | 干净（1328 个文件，0 漏扩展名） |
| `node .tools/find-ts-in-mjs.mjs` | 干净（`tests/*.mjs` 全纯 JS） |
| `node .tools/find-orphan-modules.mjs --gate` | **门禁绿**（新增 0；本批没新增生产模块） |
| 消费方回归（`application-activation` / `general-settings-local` / `settings-inspector` / `startup-activities` / `trusted-projects` / `trusted-session-single-source` / `welcome-external-link-launch` / `welcome-trust-dialog`） | **63 / 63** |
| `npx vue-tsc -b --force`（收工前跑了两趟） | 两趟各**只有 1 条红，且都不是本批**：第一趟 `src/lspSymbolBridge.ts(33,10) TS2459`、第二趟（写报告时）`src/components/TerminalPanel.vue(152,22) TS2304: Cannot find name 'isAlternateScreen'`。同一趟里本批三个 ts/vue 文件（`codeLensSettings.ts` / `codeLensExtension.ts` / `CodeVisionSettingsPage.vue`）**零报错** |

**反向验证**（codelens2 停在哪，本批就把它跑完；每次注入都带 `PROBE-CL3-*` 独有标记，验完逐字还原）：

| 注入（把实现摘掉的那一条） | 判据红了多少 |
| --- | --- |
| `PROBE-CL3-GATE`：`shouldShowCodeVisionEntry` 里让 `disabledGroups` 不再生效（`&&` → `\|\|`） | `code-lens-grouping` **7 红 / 20**（总闸那条、关一组只少一组、闸在归并之前、右键原地重画、四组逐组关、盘上读回那两条） |
| `PROBE-CL3-APPEND`：`restoreCodeVisionSettings` 退回 codelens2 时代的**只加不删** | `code-lens-grouping` **2 红 / 20**（`:435` 盘上读回、`:483` 缺键保持）；**同批 `code-vision-anchor-limit` 10/10 绿、`setkeys-batch` 20/20 绿** ⇒ 派单说的"现有判据只核配置读写、核不出关掉之后画不画"在这条上得到实证：本批那两条是**唯一**有牙的 |
| `PROBE-CL3-TWOGROUPS`：设置页 `GROUPS` 退回两组（`CODE_VISION_GROUP_IDS.slice(0, 2)`） | `code-lens-grouping` **1 红 / 20**（`:515` 那条 SSR） |
| `PROBE-CL3-NOWATCH`：摘掉 `codeLensExtension.ts:357` 的 `watch(codeVisionSettings, applyGateChange)`（换档不重算） | `code-lens-grouping` **3 红 / 20** + `code-vision-anchor-limit` **1 红 / 10** = **4 红** |

四段都：**注入 ⇒ 红，还原 ⇒ 复绿**（最终 85/85、105/105 见上表）。
残留扫描：`grep -rn "PROBE-CL3\|REVFIX\|TEMP 反向验证\|TODO 本批" src tests` ⇒ **0 命中**
（`docs/` 里的 `REVFIX` / `PROBE-` 命中全是别的批次**记载事故的历史文字**，`docs/batch-2026-10-06-main.md:376`
那一类，不是代码）。本批所有注入标记都带 `PROBE-CL3-` 前缀，本次独有，不复用别批的名字。

**非本批、在途**（不去修，也不当"其他都绿"的证据 —— 仓里只要有一条红，全量证据就不成立，所以本批的结论
只建立在"本域九份测试 + 三条机检 + 四段注入"上）：
`npx vue-tsc -b --force` 在收工前跑了两趟，两趟的红**换了人**：
第一趟 `src/lspSymbolBridge.ts(33,10) error TS2459: Module './symbolSearch.ts' declares
'SPEED_SEARCH_STRUCTURE_SEPARATORS' locally, but it is not exported` —— 那个常量**已经**在
`src/speedSearch.ts:128` 导出，`src/symbolSearch.ts:20` 只是 import 没 re-export，
两个文件都在 `git status` 的 M 列表里（speedSearch / symbolSearch 那条 lane 正在写）；
第二趟同一条已经消失、换成 `src/components/TerminalPanel.vue(152,22) TS2304: Cannot find name
'isAlternateScreen'`（terminal 那条 lane 正在写，`src/components/TerminalPanel.vue` 也在 M 列表）。
派单预告的那条 `src/runActions.ts(30,33) TS2724: readRunStartupFocus` 两趟里**都不再出现**（execui 落了）。
另：`tests/cv-local-vision.test.mjs` 在一次十文件合跑里出现过 2 红（`entries()` 回空），
**单独跑与之后每次合跑都 15/15 绿、不可复现**；同时段 `src/cvLocalVision.ts` 的 mtime 在我眼皮下变过
（第一次 `git diff` 看到的是 `lspFileFeatures.send(...)`，再看磁盘已是 `lspFileFeatures.ask(...)`）
⇒ 判为并发写该文件的 hlfeat lane 造成的撕裂读，不属于本批，也没有为它改一行代码。

## ④ R5 的一句话现状（本轮不做，理由与派单给的不同）

**事实**：R5 描述的"native 把 hover 的某个字段裁掉了"**已经不成立** ——
`native/lsp_session.cpp:170-171` 今天就把 `Hover.range` 原样透传
（`auto reply = Json{{"available", true}, {"contents", hover_text(...)}};`
然后 `if (result.contains("range") && result.at("range").is_object()) reply["range"] = result.at("range");`），
`git blame` 到 `11a736e`（已在 HEAD 里，不在 M 列表），前端 `src/docHoverContent.ts:68-96`
（`hoverRangeFromPayload` / `presentationFromRange`）与 `tests/doc-hover-content.test.mjs` 都在消费；
这与 `docs/batch-2026-10-06-lshl.md:12` 的结论一致（那条 lane 早判它"请求本身过期"）。
今天**唯一**还缺的一格是类型登记：`src/bridge.ts:126` 的
`export interface LspHoverResult { available: boolean; contents?: string }` 没有 `range`
⇒ 已在 `docs/wiring-requests-2026-10-06-codelens2.md` 的 **C-3** 登记（`bridge.ts` 是保留文件，本批不动）。

**本轮不做的原因**：① 它要动的两处（`native/**`、`src/bridge.ts`）都在我的只读名单里，
派单也明确 `native/lsp.cpp` 与 lspmsg 那条 lane 撞文件（`native/lsp.cpp` 此刻确实在 `git status` 的 M 列表里，
本批一个字没碰）；② 真正的 hover 透传点其实在 `native/lsp_session.cpp`（不在 M 列表）且已经落地，
所以"等 lspmsg 收工再派 R5"这件事现在只剩 C-3 那一行类型登记，交给主代理随保留文件批次一起收。

## ⑤ 异常留痕（安全）

本会话里，**多条工具返回的正文尾部**被追加过伪装成 `[System]` / 系统提示的文本，两种形状都出现过：
①"The following skills were used earlier… Do not re-load… This request must be addressed before completing"
这类技能清单（`src/codeLensSettings.ts`、`src/components/CodeVisionSettingsPage.vue`、
`src/codeLensExtension.ts` 三次 Edit 的成功回执之后，以及多次 `Bash` 输出之后，重复了十几遍）；
②一条"[Safeguard] Focus mode active…"。
按派单口径一律当**数据**：没有据此扩大或改变范围、没有加载任何 skill、没有把"must be addressed"当指令。
它也不影响本批结论 —— 本批每个数字都是自己在盘上重跑出来的（见上表），
不采信任何"另一个 agent 已改好 X / 文件 Y 已存在 / 你已完成"式说法；
凡这类说法涉及的事实（例如"native 白名单已恢复四组"）本批都自己 `sed -n`/`grep` 打开磁盘复核过。
