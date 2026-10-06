# 常驻文档验收修订 · 2026-10-06（docs-only，不改任何 src/native/tests）

对 `docs/audit-2026-10-06-docs.md`（只读验收报告）逐条**独立复核**后的处置账。

- 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（直接读源码，未上网、未截图）。
- **每条都自己开到那一行数过**；验收员的坐标有 5 处不准，逐条列在第三节。
- 本仓侧数字全部**现测**（并行批次仍在改树，`src/App.vue` 在我这轮里从 2735 → 2719 行、`native/main.cpp` 从 1842 行继续动），
  所以凡是会漂的量一律写成「实测值 + 复算命令」，不再写死。
- 改动清单（`git diff --stat`）：**只碰 docs/ 的 8 个文件**，91 行增 / 50 行删。`src/App.vue` 在 `git status` 里是别的代理的 hunk，不是我改的。

| 文件 | 改了哪些行 |
|---|---|
| `docs/agent-playbook-parity.md` | §0.5 快照数、参数属性 7 处待清表、§1.5 例证、§1.6 scheme XML 数、§4 未提交改动数、§9 生成域范围 |
| `docs/ui-parity-checklist.md` | 入口表 :8/:9/:12/:13、:1037、:1069、:1123、:1543、:2302、:3125、:3420 |
| `docs/handoff-2026-10-05-parity-batch.md` | :140 的「47 个文件」 |
| `docs/inventory/verdict-vcs.md` | :230/:634/:828/:1770 的 `src/App.vue:1`、:1864 的 `src/vcsLogDetails.vue:1`（**四档档位一字未动**） |
| `docs/settings-parity.md` | :9 节点数、:20 状态分布、:127 的 `src/debugBreakpointMute.ts` |
| `docs/source-todo.md` | :11 Method 计数、:33 `App.vue:4152-4166` |
| `docs/ui-placement-audit.md` | :1255 宿主文件、:2874 的 `.impl` |
| `docs/class-parity-todo.md` | :48、:247、:428、:638 |

---

## 一、硬错 D1–D14 的独立核实与处置

| # | 我的独立核实（亲自数/开到那一行） | 判决 | 改了什么 |
|---|---|---|---|
| **D1** | `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml` **831 行**，`:444` = `<action id="RestoreFactoryDefaultLayout" class="com.intellij.ide.actions.RestoreFactoryDefaultLayoutAction"/>`；类体 `platform/platform-impl/src/com/intellij/ide/actions/RestoreFactoryDefaultLayoutAction.kt:13`；`platform/platform-impl/resources/idea/PlatformActions.xml:641` = `<group id="LayoutsGroup" popup="true">`、`:643` = `<reference ref="RestoreFactoryDefaultLayout"/>`；文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:1085` = `action.RestoreFactoryDefaultLayout.text=Default`。`idea/customization/min/resources/intellij.platform.customization.min.xml:53` = `<action id="WelcomeScreen.OpenProject" class="com.intellij.ide.actions.OpenFileAction$OnWelcomeScreen">`。`platform/editor-ui-api/src/com/intellij/ide/ui/UISettings.kt` **914 行**。`EditRecentProjects` 全树（不限 XML）**0 命中** | **同意，且是最该改的一条** | 把 §1.5 的三个假例证换成真坐标（上面 7 条全部写进文档），只留 `EditRecentProjectsAction` 当「三条路走完 ⇒ 真缺」的正样本；并明写「**本节例子里没有一个可以当『无法核实』的依据**，它们的用途是打假」。三个假例证各对应一种文件名腐烂：改名 / 内嵌类 / Java→Kotlin |
| **D2** | `ls plugins/keymaps` = 10 个插件目录 + 1 个 `OWNERSHIP`；全部 XML = 26；`-not -path "*META-INF*"` = **16**（逐条列过：Eclipse 2、NetBeans 1、QtCreator 2、ReSharper 2、Visual Assist 2、VS for Mac 1、VS 2、VS2022 1、VSCode 2、Xcode 1） | **同意** | playbook §1.6 改成「10 目录 / **16 个 scheme XML**」并附复算命令 |
| **D3** | 同上 | **同意** | `:3420` 改 16；`:3125` 的「10 目录 / 26 XML」补成「26 个 XML，其中 **16 个是 scheme 表**、10 份是 `plugin.xml`」 |
| **D4** | `ls platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/` = **27** 个文件（逐个列过）；`KeymapPanel.java` = **1138 行**；`Default for GNOME.xml` = **47 行** | **同意** | `handoff-2026-10-05-parity-batch.md:140` 的 47 → 27，并写明「47 是 GNOME 的行数」+ 两条复算命令 |
| **D5** | 见第三节逐条：**5 条里只有 3 条真是错的**（`IdeMenuBar.kt`、`Stripe.java` 包、`SettingsEditor.kt` 扩展名；`StripeButton.java` 的真身是 `toolWindow/StripeButton.kt` 而不是验收员说的没有）。`SettingsFilter.kt` **存在**于 `newEditor/`，文档那行本来就对 | **部分同意** | 入口表 :8 → `platform/platform-impl/src/com/intellij/platform/ide/menu/IdeJMenuBar.kt`、`IdeMenuBarHelper.kt`；:9 → `com/intellij/toolWindow/Stripe.java`、`StripeButton.kt`（并补 New UI 的 `SquareStripeButton.kt`）；:12 → `newEditor/SettingsEditor.java`（注明 `ide-core` 那个 189 行的是接口）；顺手给 :13 欢迎页那三个只有裸名的文件补上 `.../wm/impl/welcomeScreen/` 目录 |
| **D6** | §G 逐行数：**`[x]`13 / `[~]`39 / `[ ]`2 / `[-]`263 = 317**；头部 `:7` 现在印的正是 13 + 39 + 2 + 263。**已被并行批次改正**（验收员读到的 36/6 与「另一句 12/40」都已不在文件里，全文再搜不到第二套分解） | **同意问题成立、但已不存在** | **未改**。反向自查：`tests/b6-verdict.test.mjs` 61 扇门全绿，头部 == §G 实测 |
| **D7** | 我数：编号行 **52** 条、**52** 个不同 `id`，分布 `[x]`**16** / `[~]`8 / `[ ]`28 | **同意** | `settings-parity.md` 状态分布 15 → **16** |
| **D8** | `grep -c '^  { key:' src/settingsTreeMeta.ts` = **40**（39 个不同 key） | **同意** | 「12 个」改成实测 40/39 + 复算命令，并注明 12 是 2026-09-27 当时的值 |
| **D9** | `src/App.vue` 本轮 **2719 行**（同轮先测到 2735）；`config-chooser` 的 `v-if` 在 **`:2060`**、遮罩 **`:2074`**。旧写的 `:4152-4166` 确实越界约 1400 行 | **同意（结论真、坐标假）** | 换成「`config-chooser` 块 + 本轮实测 :2060/:2074 + 复算命令」，并**故意不写成可机械核对的完整形状**、在句子里说明原因（`App.vue` 按分钟漂，写死行号下一轮就变新假坐标） |
| **D10** | `src/debugBreakpointMute.ts` **不存在**；真落点 `src/debugBreakpointExtras.ts:62`（`shouldAutoUnmute`，注释写着「上游 `XDebuggerGeneralSettings.isUnmuteOnStop` 的唯一消费点」）与 `src/debugDataView.ts:38`（`unmuteOnStop` 字段）；`DebugEvaluateDialog.vue`/`DebuggerSettingsPage.vue` 均在 | **同意** | 路径改真。**另发现同一处假名活在源码注释里**：`src/settingsModel.ts:162` —— 属 `src/`，本次不许碰，报给桶 12 属主 |
| **D11** | `src/vcsLogDetails.vue` 不存在、真实 `src/components/VcsLogDetails.vue`；它的 **`:18`** = `<div v-if="details" class="message">{{ details.message }}</div>` —— 正是「提交消息纯文本显示」那一行，所以行号也换成了有内容的这一行而不是一行 `<script setup>`；`src/App.vue:1` 出现 **4 次**（:230/:634/:828/:1770，验收员只点了 1 处）；标签模型的真定义在 **`src/editorGroups.ts:8`** 的 `export interface SplitModel<T>` | **同意，且低估了** | 四行 `src/App.vue:1` → `src/editorGroups.ts:8`（稳定模块，不随 `App.vue` 漂）；`src/vcsLogDetails.vue:1` → `src/components/VcsLogDetails.vue:18`。**四档档位一字未动**，改完 b6–b12 61/61 绿 |
| **D12** | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ScopeChooserAction.java` = **214 行**且里面**没有** `canToggleEverywhere`；真坐标全中：接口 `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereToggleAction.java:7`、实现 `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/AbstractGotoSEContributor.kt:226`（`everywhereScope != projectScope`）与 `:250-251`、`platform/lang-impl/src/com/intellij/find/impl/TextSearchContributor.kt:268` | **同意** | 换成上面三处真坐标（旧写法故意保留为裸文件名 `ScopeChooserAction.java:264-266`，不加目录 ⇒ 引用门不会把它当引用收集） |
| **D13** | `platform/platform-api/resources/intellij.platform.ide.actions.xml` = **114 行**（`:479` 空）；`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:479` = `<group id="TW.ViewModeGroup" class="com.intellij.ide.actions.ToolWindowViewModeAction$Group" popup="true"/>` | **同意** | `ui-placement-audit.md:2874` 补 `.impl` 并写明「差的就是那一段 `.impl`，行号纯属巧合」。**验收员漏了一处同病**：`class-parity-todo.md:428` 也写着同一个假文件名，已一并改掉 |
| **D14** | `docs/inventory/ui.txt`：`/ui/tabs/` **63** 行、0 个 `package-info`；`/ui/popup/` **64** 行、**3** 个 `package-info` ⇒ **124 类**；判决文档口径也是 124 | **同意** | `class-parity-todo.md:48` 改成「63 + 64 = 127 **行**，扣 3 个 `package-info` 才是 124 类」+ 复算命令 |

---

## 二、可疑 D15–D27 与「无法判定」U1–U7 的逐条判决

| # | 我的判决 | 依据 / 为什么动或不动 |
|---|---|---|
| D15 | **已不存在**（不改） | 现测 §G = `[x]`34 / `[~]`1035 / `[ ]`210 / `[-]`1272 = 2551，而 `:14`、`:90`（§B 标题）、`:243`、`:2810` 四处印的是**同一套** 34+1035+210+1272 ⇒ 属主已重生成并统一。验收员读到的三套互异版本是并行批次中间态。改别人的判决文档的计数属越权，未动 |
| D16 | **真错，已改** | `node .tools/find-param-props.mjs` 现输出「共 0 处参数属性」。整张「7 处待清」表删除，改成「已清零 + 只认工具当前输出」，并逐文件说明那 7 行现在是什么（4 行是禁令注释、2 行是普通调用、1 行本来就是正确写法） |
| D17 | **真错（快照当规约），已改** | 本轮现测 `wc -l src/App.vue` = 2719（同轮先 2735）、`CodeEditor.vue` = 1146、`git status --porcelain` = **1 M + 10 ??**（上一轮已被整批提交，`git log` 见 `c2ce830`）⇒ 验收员读的「316 M + 857 ??」也过期了。已把 842/58/2702/1127/35 行余量/700+ 全部改成「快照值 + 复算命令」，上限 2737 保留并指明权威是 `tests/module-size.test.mjs`。「约 150 个新文件」按 U6 标成**口径不明、无法核实** |
| D18 | **真错，已改（验收员给的路径不完整）** | `src/speedSearchHost.ts` 确实不存在，但它的**直接后继是同目录改名的 `src/gearHostRows.ts`** —— 这一点 `ui-placement-audit.md:1287` 自己写着「由 `speedSearchHost.ts` 改名而来」，验收员没读到那半句就报了 `src/menus/toolWindowGear.ts`。两处都是事实：宿主行在 `gearHostRows.ts`，`ToolWindowGearEntry.fromHost` 的声明/条目/消费在 `src/menus/toolWindowGear.ts:45`/`:58`/`:85`。文档里两条都写上 |
| D19 | **真错，已改** | `src/components/ChooseTargetPopup.vue` 不存在，现役是 `src/components/TargetChooserPopup.vue`（`ls` 实测），已改名并注明腐烂原因 |
| D20 | **真错，已改（数也漂了）** | 本轮 `native/main.cpp` = **1842 行**（验收员测的 1843 也已过期），`CreateCoreWebView2EnvironmentWithOptions` 实际在 **`:1688`**。两处都改成 :1688 并附 `grep -n` 复算 |
| D21 | **站得住的半边保留；判词质量部分不改** | `src/components/DiffView.vue` = **369 行**，`:158` **指得到**（本轮读到的是词级高亮的说明注释，与验收员读到的 `watch(...)` 不同 ⇒ 也在漂）。它确实撑不起 8 行 `CombinedDiff*` 的「合成 diff 对应物」，但**改这个等于改 `[~]` 档位**，属 §G 判词域且有 `tests/b7-verdict.test.mjs` 钉数 ⇒ **不动**，报给 find-diff 域属主 |
| D22 | **不动**（同上，判词域） | 我独立确认了它给的那个具体反例：`src/mergeConflicts.ts`、`src/editorMergeHost.ts`、`src/components/MergeBar.vue` **三个文件都在** ⇒ 验收员说「有冲突解决却被模板判 `[-]`」这一条事实成立。但把 1356/29/8/126 条模板理由逐条展开 = 逐条改判词，不是「指不到的路径/行号」，超出本次授权 |
| D23 | **真错，已改一半、一半标无法核实** | `src/bridge.ts:109` 起的 `export type Method` 现测 **170** 个成员（验收员测的 162 也漂了）。「双向差集为空」我同样**无法核实**（`native/*.cpp` 里带点的字符串字面量粗 grep 有 402 条，但分派不止这一种写法），已在文档里明写成「别当现行结论」 |
| D24 | **真错，但未改（授权边界）** | 现测 `ls tests/*.mjs` = **573**、行锚定的 `test(`/`it(` = **4828**。**`HANDOFF.md` 在 docs/ 之外**，任务书要求「hunk 都在 docs/」⇒ 不动，把复算命令与实测值留在这里给属主 |
| D25 | **真错，但未改（同上）** | 同 D24，`HANDOFF.md:20`/`:161-165` 已被 `:9` 推翻这件事验收员自己已论证，我复核不了 `:9` 的 JSON 对齐（与它 §二那张表一致），只补一句：不在 docs/ 下 ⇒ 留给属主 |
| D26 | **真错，已改** | 表头「= 107 类」加「原判口径已废止，现 124 类」，并把那一格的 20/56/30/1 标成「第一版分布、别再抄，现行分布以判决文档为准」 |
| D27 | **真错，已改** | 我逐行数过 `verdict-folding.md` §G：**3 / 37 / 0 / 29 = 69**，与 `:207` 那句完全一致；`class-parity-todo.md:638` 的 0/38/5/26 是第六十五批前的旧版。改成**引用 `verdict-folding.md:207`** 而不是抄数，并点明「两套都凑得满 69 ⇒ 总数自洽型门禁抓不到」 |
| **U1** | **我判成了硬错并已改**（验收员没判） | `MoveToolWindowTabToEditorAction` 的类文件**在树里**：`platform/platform-impl/src/com/intellij/openapi/wm/impl/tabInEditor/ToolWindowEditorTabActions.kt:16` = `internal class MoveToolWindowTabToEditorAction : DumbAwareAction(), ActionRemoteBehaviorSpecification.Frontend`。⇒ `ui-parity-checklist.md:1037` 那句「本源码树里没有该类文件，只有 XML 注册」是假的，而且它是 **D1 那条假规约的产物**（按类名 find 永远搜不到，因为它和同族动作共用一个文件）。已订正事实；「不做」那半句**没替属主改判**，只写明「这一格的证据基础已失效，档位由属主按类体重判」 |
| U2 | 维持**无法核实**（见 D23） | 缺 native 路由表的逐条枚举 |
| U3 | 维持**可疑，待属主**（见 D22） | 规模 69/317/2551 不可能逐条开类体 |
| U4 | 维持**无法核实** | 无该刻的树快照；只能证明「现在是 573 / 4828」 |
| U5 | 维持**无法核实** | 我没有去读 `D:\IntelliJ IDEA 2026.2` 的 jar 清单（playbook §1.4 只允许读 `lib/` 资源文本，不允许反推），所以判不了那 5 条是照安装包写的还是编的。可判的是：**照本树**它们指不到，已按本树改对 |
| U6 | 维持**无法核实**，已把「口径不明」写进 playbook | 857 条未跟踪里混产物，本轮未按产物目录逐条分类（且现在已被提交轮清掉，更没法回溯） |
| **U7** | **我判成了可判定并已订正规约** | `tests/verdict-generated.test.mjs` 的 `DOMAINS` = `execution 1608 / xdebugger 635 / projectviews 755 / daemon 659 / platform_rest 20574` **只有 5 个**；`verdict-platform_rest.md:3` 自己写着「由 `scripts/verdict_table.py` 生成，不要手改」，而 `verdict-actions`/`verdict-editor`/`verdict-find-diff` 里搜不到「生成」字样 ⇒ 两套并存成立。playbook §9 原来一句「`verdict-*.md` 是 `verdict_table.py` 生成的」把 B 系列也圈进去了，按它执行会「没法改判词」，已改成只圈那 5 个生成域、B 系列走 `tests/b*-verdict.test.mjs` |

---

## 三、验收员自己写错 / 写漏的地方（这轮的账要记在它那边）

1. **D5 误判 1 条、漏判 1 条**：`SettingsFilter.kt` 真实存在于 `platform/platform-impl/src/com/intellij/openapi/options/newEditor/`，入口表那行是同目录省略写法，**本来就指得到**；`StripeButton.java` 它说「不存在」并指向 `SquareStripeButton.kt`，其实同目录 `platform/platform-impl/src/com/intellij/toolWindow/StripeButton.kt` 才是直接后继。
2. **D5 给的替代路径不对**：`SettingsEditor` 它只找到 `platform/ide-core/.../options/SettingsEditor.java`（189 行，那是**接口**），而设置对话框的实现是同一行原来那个目录下的 `newEditor/SettingsEditor.java`（**863 行**）—— 文档错的只是扩展名 `.kt`。
3. **D6/D15 读的是中间态**：两处「头部与 §G 不符」在我复核时都已被并行批次改正（actions 13/39/2/263、editor 34/1035/210/1272）。结论方向对，处置不该是改。
4. **D11 低估**：`src/App.vue:1` 有 **4 处**不是 1 处；它建议「改指真的建标签的行」，正确落点是 `src/editorGroups.ts:8`（写 `App.vue` 的行号会继续漂）。
5. **D13 漏了一处同病**：`class-parity-todo.md:428` 与 `ui-placement-audit.md:2874` 是同一个假文件名。
6. **D18 的路径不如文档自己的线索准**：`ui-placement-audit.md:1287` 已写明宿主文件改名成了 `src/gearHostRows.ts`，验收员没引用它。
7. **D20 的行数也漂了**：`native/main.cpp` 现 1842 行不是 1843；真坐标 `:1688` 它没找到。
8. **D2/D4 的 `PlatformActions.xml` 路径不完整**：真路径是 `platform/platform-impl/resources/**idea/**PlatformActions.xml`（行号 641 对）。
9. **上游路径写成 `…/hippie/`**（任务书也沿用了这个说法）：`HippieWordCompletionHandler.java` 实测只有一处 —— `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/HippieWordCompletionHandler.java`；既不在 `hippie/`，也不在任务书说的「codeInsight/intellij/plugins/completion」。
10. **它自己的「抽验通过」一节基本站得住**：`$default.xml` 1308 行 / keymaps 10 文件 / 27 个文件 / `KeymapPanel.java` 1138 行 / GNOME 47 行 / `ActionsBundle.properties:1085`，我逐条重跑都对得上。

---

## 四、反向自查（数字，不是形容词）

**引用门（收工条件）**

```
node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs
→ tests 11 / pass 11 / fail 0        锚点核对：快照 1627 条 / 仓里活引用 1637 条 / 未入快照 10 条 / 区间为空 3 条
```

- 10 条「未入快照」**全部是我这轮新写的上游坐标**（`impl.actions.xml|444`、`RestoreFactoryDefaultLayoutAction.kt|13`、`idea/PlatformActions.xml|641`、`ActionsBundle.properties|1085`、`impl.actions.xml|479`、`ToolWindowEditorTabActions.kt|16`、`SearchEverywhereToggleAction.java|7`、`AbstractGotoSEContributor.kt|226` + 其余 2 条同源），每一条都亲自开过那一行。
- **锚点快照故意没有重算**。理由：门现在 0 失败，而我新加的 10 条只是「未覆盖」不是「漂移」；此刻跑 `TAOCODE_CITATION_ANCHORS=update` 会把十几个并行代理**尚未复核**的引用一起吃成基线，正好废掉这一层「抓悄悄改指别处」的用途。等这批接线收口后由父代理统一重算。
- **批评假写法时一律不带目录、只留裸文件名**（`ScopeChooserAction.java:264-266`、`intellij.platform.ide.actions.xml`、`App.vue:4152-4166`、`ChooseTargetPopup.vue`、`debugBreakpointMute.ts`），并在句子里写了为什么这么排 —— 否则引用门会把它们当真引用收集，门自己变红。

**判决门（改过 `verdict-vcs.md` 5 行之后）**

```
node --test tests/b{6,7,8,9,10,11,12}-verdict.test.mjs
→ 改前 61/61 pass、改后 61/61 pass（0 失败）
```

- `verdict-vcs.md` 的四档计数与 §G 行数**一字未改**（只换了 5 个单元格里的路径/行号），所以我另跑了一遍逐行数：§G 1783 行 = `[x]`42 / `[~]`502 / `[ ]`17 / `[-]`1222，与该文档头部一致，未受影响。
- 顺手把这批文档的**其它读者**也跑了：`b3`、`tool-window-gear`（读 `class-parity-todo.md`）、`vcs-log-presentation`（读 `source-todo.md`）等 13 扇门 **105/105 pass**，没有因为我删表/改数而红。

**工作区纪律**

- `git diff --stat` 的 hunk 只在 `docs/` 的 8 个文件；`src/App.vue` 那 91 行是并行代理的，我没碰。
- 没跑 `git checkout/reset/stash/clean`，没 commit、没 push。
- 没写任何 `.ts`/`.mjs`，所以「块注释里裸 `*/`」「TS-in-`.mjs`」两个坑没有触发面；引用的上游文件都是 `.kt/.java/.xml/.properties`。

---

## 五、留给属主的三条（本次授权不许动）

1. `src/settingsModel.ts:162` 的注释里写着 `src/debugBreakpointMute.ts`（不存在，真身 `src/debugBreakpointExtras.ts:62`）—— 属 `src/`，本轮「只动 docs/」。
2. `HANDOFF.md:4`（459 / 3891）与 `:20`、`:161-165`（已被 `:9` 推翻的四档旧数）—— 在 `docs/` 之外。现测 573 / 4828。
3. `verdict-find-diff.md` 8 行共用 `src/components/DiffView.vue:158`（D21）与四份判决文档里 1356/29/8/126 条模板化 `[-]` 理由（D22）—— 都是档位判词，不是坐标。
