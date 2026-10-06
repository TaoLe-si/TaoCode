# 接线请求 · 2026-10-06 · problems / inspections / highlighting 域（桶 2 续）

> 只列**必须动保留文件**的部分。模型侧与面板侧已经做完并在 `docs/batch-2026-10-06-problems.md` 记了判据数字。
> 上游坐标全部是本机参考树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 里
> **实测存在**的路径；抓不到的类（见 §R1 末尾「无法核实」）我明确写了，没有编行号。

## R1 · 诊断的 `relatedInformation` 透传（宿主 + 桥类型）—— bucket2b R1 的同一件事，给了可照抄代码

**现状（已核实，不是猜）**
- `native/lsp_support.cpp:127-153` 的 `shape_diagnostics` 把每条诊断折成
  `{ line, character, message, severity, endLine?, endCharacter?, source?, code?, tags? }`
  （`:142` source、`:148` code、`:149` tags），**没有** `relatedInformation`；
- `src/bridge.ts:118` 的 `interface LspDiagnostic` 同样没有这一格；
- 前端这一侧已经全部做完：`src/problems.ts` 的 `ProblemRow.related`（`:81`）+
  `relatedFrom(item)`（`:40`，读 `item.relatedInformation ?? item.related`，两种形状都认）、
  `src/problemRelatedInformation.ts`（折叠规则：越界/非整数丢弃、去重、同文件优先、只有 file URI 没有路径映射的条目丢掉）、
  `src/components/ProblemsPanel.vue` 行菜单的「相关位置」一节（`:252-259` 取数与跳转、模板 `:738-743` 渲染）。
  ⇒ **宿主一旦透传，前端零改动即生效**；现在这一节恒不渲染（没数据不渲染，不是假控件）。

**要接什么（两处，可照抄）**

1) `native/lsp_support.cpp`：在 `:149`（`if (item.contains("tags")) entry["tags"] = item.at("tags");`）之后、
   `:150`（`diagnostics.push_back(std::move(entry));`）之前插入：

```cpp
        // `relatedInformation` 原样透传 —— 上游 LSP 宿主也是原样保留、不裁这一格：
        // platform/lsp-impl/src/impl/features/highlighting/LspDiagnosticAndLazyQuickFixes.kt:42
        // （`this.relatedInformation = diagnostic.relatedInformation`，同一个初始化块 `:35-43` 里
        //   `:39` 还保留了 `codeDescription`）。
        // 每项按本函数已有的折法出 { line, character, message }（`range_corner` / `int_at` / `string_at`）；
        // 指向别的文件时带 uri（前端认不出 uri→工作区相对路径就丢掉那条，不会画错位置，
        // 见 src/problemRelatedInformation.ts 的 `RelatedLocationInput.location` 注释）。
        if (item.contains("relatedInformation") && item.at("relatedInformation").is_array()) {
            Json related = Json::array();
            for (const auto& entry_json : item.at("relatedInformation")) {
                if (!entry_json.is_object() || !entry_json.contains("location")
                    || !entry_json.at("location").is_object()) continue;
                const auto& location = entry_json.at("location");
                if (!location.contains("range") || !location.at("range").is_object()) continue;
                const auto corner = range_corner(location.at("range"), "start");
                Json one{{"line", int_at(corner, "line")},
                         {"character", int_at(corner, "character")},
                         {"message", string_at(entry_json, "message")}};
                if (location.contains("uri")) one["uri"] = location.at("uri");
                related.push_back(std::move(one));
            }
            if (!related.empty()) entry["related"] = std::move(related);
        }
        // 诊断码的文档链接（同一个初始化块 `:39` 保留的那一格）：前端只在有 href 时才画下钻入口。
        if (item.contains("codeDescription") && item.at("codeDescription").is_object()) {
            const auto href = string_at(item.at("codeDescription"), "href");
            if (!href.empty()) entry["codeDescriptionHref"] = href;
        }
```

2) `src/bridge.ts:118`（整行替换，尾部加两格）：

```ts
export interface LspDiagnostic { line: number; character: number; endLine?: number; endCharacter?: number; severity: number; message: string; source?: string; code?: string | number; tags?: number[]; related?: Array<{ line: number; character: number; message: string; uri?: string }>; codeDescriptionHref?: string }
```

**改完需要跑的**：`.tools/nctest-all.bat`（`native/lsp_support.cpp` 已在 `CMakeLists.txt` 注册，不用加文件）。
若 `native/*_test.cpp` 里有 `shape_diagnostics` 的断言，请按日志的 `tests passed` 行给数字，别只看 npm 退出码。

**`codeDescriptionHref` 这一侧我暂时没接**：本仓问题面板没有「检查项富文档」的下钻面
（`lp/inspections` 判词里那条 `InspectionDescriptionDocumentationProvider` 的缺口，需要的本地检查描述文件本仓没有）。
宿主顺手带出来不影响现有行为；前端接到哪一格由主代理决定，或等下一轮我把它并到「检查配置…」的条目详情里。

**无法核实（重要，别再照旧文档抄）**
- `dm/problems-view` 判词里点名的 Project Problems 成员级关联问题类 **`BrokenUsage` / `RelatedProblem` 在本机参考树里找不到**：
  `find . -name "RelatedProblemViewProvider.kt"` 与 `find . -name RelatedProblem*` 都没有命中；
  `platform/analysis-impl/src/com/intellij/codeInspection/ProblemDescriptorBase.java` **存在**，
  但整文件里 `grep -in related` **零命中**（本仓的 `ProblemDescriptorBase` 没有 related 字段可读）。
  ⇒ 上游这条链在本机基准里只有「LSP 宿主原样保留」（上面 `LspDiagnosticAndLazyQuickFixes.kt:42` 一处，
  `grep -rn relatedInformation platform/` 全树也只命中这一行），**没有 problems-view 侧的呈现坐标**。
  所以本仓的呈现形状（列在行菜单里 + 点一条走已有 reveal 通道）是按 LSP 字段语义 + 本仓既有通道做的，
  没有冒充上游文案。

## R2 · 状态栏的「按检查项」入口（`src/App.vue`）—— bucket2b R2 的可照抄版本

- 目标文件/行：`src/App.vue:2273` 状态栏那一行里，`showWidget('problems')` 那枚芯片
  （`<button v-if="showWidget('problems')" class="status-problems" title="打开问题面板" …>`）之后插一枚同族的芯片。
- 数据面**早就有**（本轮没有新增模型代码）：
  `src/inspectionIdentity.ts:59` `problemKindOf(tags)` 判「未使用 / 已废弃」两档、
  `:70-73` `KIND_INSPECTIONS` 的显示名逐字取自上游（`Unused declaration` / `Deprecated API usage`，
  坐标见那个文件的文件头）、`src/problemsView.ts:358` `problemCounts` 给严重度三格、
  `src/inspectionProfile.ts` 的 `inspectionItems(rows)` 给**逐检查项条数**（面板「检查配置…」在用）。
- 可照抄代码：

```ts
// 状态栏的「按检查项」入口（IDEA ProblemsView 的 Group by Inspection 那一维 + tags 折出来的
// `Unused declaration` 检查项）：数据 = 诊断 tags，见 src/inspectionIdentity.ts。
const unusedDeclarationCount = computed(() =>
  allProblems.value.filter(row => problemKindOf(row.tags) === 'unusedSymbol').length)
```

```html
<button v-if="showWidget('problems') && unusedDeclarationCount" class="status-problems status-problems-inspection"
        :title="`未使用声明 ${unusedDeclarationCount} 条（IDEA: Unused declaration 检查项，问题面板按检查项分组可逐条跳）`"
        aria-label="按检查项：未使用声明" @click="showOutput('problems')">未使用 {{ unusedDeclarationCount }}</button>
```

`import { problemKindOf } from './inspectionIdentity'` 加在 App.vue 的 import 段。
**不需要新设置键**（复用既有 `problems` 组件开关，`showWidget('problems')`），也不需要 `native/settings_schema.*` 改动。

## R3 · 面板选中行的「操作」菜单要能用 Alt+Enter 打开（`keymapBindings.ts` + `actionRegistry.ts` + `App.vue`）—— bucket2b2 R1

- 组件侧出口**本轮已经备好**：`src/components/ProblemsPanel.vue:274-289`
  （`@focusin` 记当前聚焦行 = 键盘用户的选中；`openMenuForSelected()` 已 `defineExpose`）。
  判据在 `tests/problem-related.test.mjs`（最后一条 test 钉住这三个锚点）。
- 要接的三处：
  1. `src/App.vue:2214` 的挂载点加 ref 与事件（见 R4 的整段）：
     `<ProblemsPanel ref="problemsPanelRef" … />`，并 `const problemsPanelRef = ref<InstanceType<typeof ProblemsPanel> | null>(null)`；
  2. `src/actionRegistry.ts` 注册 action（建议 id `problems.view.quickFixes`，标题「操作（选中问题）」）：
     handler = `problemsPanelRef.value?.openMenuForSelected()`，`enabled` = 底部面板当前 tab 是 `problems`；
  3. `src/keymapBindings.ts` 把它的快捷键取既有 `ShowIntentionActions`（Alt+Enter）的同一把
     （上游就是复用同一把：`platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103`
     `<action id="ProblemsView.QuickFixes" … use-shortcut-of="ShowIntentionActions" class="…ShowProblemsViewQuickFixesAction"/>`；
     动作对「选中的那个问题节点」生效：`ShowProblemsViewQuickFixesAction.kt:34` `event.getData(SELECTED_ITEM) as? ProblemNode`，
     弹层走 `:79` `IntentionListStep(…, IntentionSource.PROBLEMS_VIEW)` —— 这两个坐标本轮实测存在）。

## R4 · 面板焦点态抛给状态栏（`src/App.vue`）—— bucket2b2 R2

- 组件侧本轮已做完：`ProblemsPanel.vue:85-90` 声明 `focusChange` 事件、`:124-127` 焦点变化即抛
  （形状 `{ grouping, key, label } | null`，`null` = 取消焦点）；面板内的在场标记照旧（`:489-492` 那块）。
- 要接的就一行挂载点（`src/App.vue:2214`）：

```html
<ProblemsPanel v-else-if="bottomTab === 'problems'" :problems="allProblems" :fixing="batchFixBusy"
               :fix-disabled="!lspReady" @reveal="revealLocation" @fix-all="fixAllInFile"
               @focus-change="problemsFocus = $event" ref="problemsPanelRef" />
```

```ts
// 「只看某一组」的焦点（会话内，不落存档；上游 ProblemsViewState.kt:20-33 也没有这个字段）。
const problemsFocus = ref<{ grouping: string; key: string; label: string } | null>(null)
```
状态栏文案（放在 R2 那枚芯片旁边即可）：
```html
<span v-if="problemsFocus" class="status-chip status-problems-focus" :title="`问题面板只看「${problemsFocus.label}」`">只看：{{ problemsFocus.label }}</span>
```

## R5 · `native/diagnostics.cpp` 与 `src/diagnosticsPanel.ts` 的上游路径要按实测改正（本轮取证）

判词/注释里这批「缺省 package = `com.intellij.codeInspection.impl`」的候选路径**在本机参考树里不存在**；
本轮逐条 `find` 得到真位置（`.java` 与 `.kt` 的区别也标出来了）：

| 探针里写的候选（不存在） | 实测存在的位置 |
|---|---|
| `…/codeInspection/impl/InspectionProfileImpl.java` | `platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionProfileImpl.java` |
| `…/codeInspection/impl/GlobalInspectionContextEx.java` | `platform/analysis-impl/src/com/intellij/codeInspection/ex/GlobalInspectionContextEx.java` |
| `…/codeInspection/impl/InspectionToolRegistrar.java` | `platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionToolRegistrar.**kt**`（同名 `.java` 不存在） |
| `…/codeInspection/impl/InspectionProfileConvertor.java` | `platform/analysis-impl/src/com/intellij/codeInsight/daemon/InspectionProfileConvertor.java` |
| `…/codeInsight/daemon/errors/HighlightInfoFilter.java` | `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightInfoFilter.java` |
| `…/codeInspection/psi/InspectionProfileEntry.java` 之类 | `platform/analysis-api/src/com/intellij/codeInspection/InspectionProfileEntry.java` |

⇒ 影响：`native/diagnostics.cpp` 的 `inspectionToolRegistrarProbe()` / `legacyProfileConverterProbe()` /
`highlightInfoFilterProbe()` / `globalInspectionContextProbe()` 四条（约 `:410-470` 那一段）与
`src/diagnosticsPanel.ts` 的同名条目会把「注册面 / 旧 profile 格式转换器 / 高亮过滤器」报成
「上游没有本地 inspection 引擎」—— 上游引擎在本地树里是**存在**的，缺的是本仓的本地检查引擎宿主。
这两文件里 `src/diagnosticsPanel.ts` 不在我的可改面（`native/diagnostics.cpp` 在，但只改一半会让
宿主探针与前端文案各说一套），请转给状态栏/诊断那片按上表改正路径与理由文案。

> **订正（problems2 本轮实测，请主代理把 R5 从待办里撤掉）**：本节「⇒ 影响」那一段点名的两个对象**都不存在**。
> ① `src/diagnosticsPanel.ts` —— 全仓没有这个文件（本轮 `ls` 直接报 No such file；`src/` 下带 diag 的只有
> `workspaceDiagnostics.ts`）。
> ② `native/diagnostics.cpp:410-470` 的 `inspectionToolRegistrarProbe()` 等四条 —— 该文件实测**共 254 行**，
> 全文是 `idea.log` 等价物（`log_dir` / `rotate_if_needed` / `internal_errors` / `special_paths` /
> `troubleshooting` / `app_info`），`grep -c "codeInspection\|InspectionToolRegistrar\|HighlightInfoFilter\|`
> `GlobalInspectionContext\|InspectionProfileConvertor"` 在 `.cpp` 与 `.hpp` 里都是 **0**；
> 四个探针名全仓 `grep` 也只命中本节自己的文字。⇒ R5 的**代码改动量 = 0**，不是"做不到"而是"没有那个东西"。
>
> 表里 6 条「实测存在的位置」**是真的**（本轮逐条 `test -f` 命中：`InspectionProfileImpl.java`、
> `GlobalInspectionContextEx.java`、`InspectionToolRegistrar.kt`（同名 `.java` 确实不存在，文件 237 行、
> `:36` 是类声明）、`InspectionProfileConvertor.java`、`HighlightInfoFilter.java`（25 行）、
> `InspectionProfileEntry.java`），只是本仓没有引用它们的地方。
> 真正的缺口是「本仓没有本地检查引擎宿主」，与路径写法无关 —— 本轮的 `docs/batch-2026-10-06-problems2.md` §0
> 有同样三条实测，§7-3 记了宿主侧要补什么（refresh 一族的前端落地方）。
>
> 另：R5 表里那几行"候选（不存在）"的写法会被 `.tools` 的取证脚本按名字收进
> `build/missing-names.md`，建议保留但**别再加行号**（加了就变成引用门的一条红）。

---

## status3 复核（2026-10-06 桶 status3；报告见 `docs/batch-2026-10-06-status3.md`）

| 项 | 判定 | 本轮实测 |
| --- | --- | --- |
| R1 `relatedInformation` 透传 | **仍缺** | `native/lsp_support.cpp:148-149` 仍只带 `code`/`tags`，`:149` 之后没有 related；`src/bridge.ts:118` 的 interface 逐字仍是 `… code?: string \| number; tags?: number[] }`（没有 `related` / `codeDescriptionHref`）⇒ 上面那段可照抄 cpp 与整行替换**仍然有效**（插入锚 `:149`→`:150` 本轮复核一致）。前端消费链没动：`src/problems.ts` 的 `relatedFrom`、`src/problemRelatedInformation.ts`、面板行菜单那一节都在原地等数据 |
| R2 状态栏「按检查项」芯片 | **仍缺** | `src/App.vue:2297` 的 `status-right` 里本轮实测**只有**一枚 `status-problems`（没有第二枚未使用芯片、也没有 `unusedDeclarationCount`）。目标行按本轮订正为 `:2297`（原写 2273）。数据面仍然齐：`src/inspectionIdentity.ts` 的 `problemKindOf`、`src/problemsView.ts` 的 `problemCounts`、`src/inspectionProfile.ts` 的 `inspectionItems` ⇒ **不要再新写聚合函数** |
| R3 Alt+Enter 打开面板「操作」菜单 | **仍缺（组件侧已备好，行号订正）** | 组件侧本轮实测：`src/components/ProblemsPanel.vue:302` 是 `openMenuForSelected()`、`:310` 是 `defineExpose({ openMenuForSelected })`（原写 `:274-289`）。宿主侧三处都还缺：`src/App.vue:2239` 的挂载**没有** `ref`；`grep problems.view.quickFixes` 在 `src/actionRegistry.ts` 与 `src/keymapBindings.ts` ⇒ **0 命中** |
| R4 面板焦点态抛给状态栏 | **仍缺（组件侧已备好，行号订正）** | 组件侧本轮实测：`src/components/ProblemsPanel.vue:89` 的 `focusChange` 声明、`:131` 的抛出（原写 `:85-90`/`:124-127`）。宿主侧：`src/App.vue:2239`（原写 2214）没有 `@focus-change`，也没有 `problemsFocus` 那个 ref |
| R5 上游路径改正 | **前提变了 ⇒ 关闭** | 本轮复核：`src/diagnosticsPanel.ts` **不存在**（`ls` 无命中）⇒ 代码改动量 0；表里那 6 条"实测存在的位置"上一批已逐条命中，本仓没有引用点。真正缺口是"本仓没有本地检查引擎宿主"，与路径写法无关 |

> 提醒下一位：R1/R2/R3/R4 的落点本轮**都在别人名下或保留文件**，status3 一个字没动。
> 另登记一条同族的新观察（不在本请求里）：`src/inspectionReport.ts:29-30` 是本仓**第三份**严重度→名字/样式映射，
> 与 `src/highlightLevels.ts` 的 `levelForSeverity` 平行；建议改读那一份，理由与 `docs/wiring-requests-2026-10-06-prob3.md` 的 R1 同族。
