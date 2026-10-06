# batch: fix-macros（实时模板宏执行层 · 收尾批）

代号 `fix-macros`。上一路做这一族的代理在 150 次上限被切断（最后一句「现在写宏的执行层」），
本批的任务是**把现场收干净**：要么收尾成有消费链路的最小实现，要么按「死代码直接删」清掉。

## 0. 判决：收尾，不删

删的证据不成立，接线的证据成立。三条都当场核过：

1. `src/templates.ts:8` 已值 import `resolveTemplateSlotValues`，`render()`（`:153`）在 `:168` 真的调用它，
   `expand()`（`:220`）在 `:230` 把展开点的文件路径做成 `TemplateMacroContext` 传下去 —— 宏**参与正文求值**，
   不是只过自己测试的表。
2. 这条链的用户可见端点在编辑器里：`src/components/CodeEditor.vue:577`
   `expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates)`
   ⇒ 按 Tab 展开实时模板时宏真的算（`tests/template-macros.test.mjs` 的
   「macros reach the user through render and through a real expansion」钉着这条，注入 R4 时它红过）。
3. `src/components/TemplateSettingsPage.vue:5` 值 import 同一张表，`:89 slotRows` / `:106 unknownMacro` /
   `:114 macros` 三处消费，模板编辑区下方渲染的就是引擎正在用的那 21 条。

真正的**半成品**只有一处，本批补掉了：`src/templateMacros.ts` 头注释（接手时 `:14`、`:54`）
写着「门禁 `tests/template-macro-registry.test.mjs` 就是拿这 33 行对账」，而**那个文件根本不存在**；
`DEFERRED_TEMPLATE_MACROS`（12 条登记）也没有任何代码消费方 —— 正是「只过自己测试的清单」。
本批补出门禁 `tests/template-macro-registry.test.mjs`（6 条用例，150 行），把这两件事一起钉死。

## 1. 判词表

族 = 实时模板宏（上游 `com.intellij.liveTemplateMacro` 扩展点那一族）。
「本仓落点」= 文件:行号（收工时实测）。

| 族 / 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点 | 一句话说明 |
|---|---|---|---|---|
| 注册表：33 条 `<liveTemplateMacro>` | `[x]` | `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1031-1063` | `src/templateMacros.ts:402-477`（装表 21 条）+ `:481-494`（登记 12 条） | 21 + 12 = 33，逐条对上 XML；门禁 T1 拿实现对账 |
| 查表契约 `Macro` | `[x]` | `platform/analysis-api/src/com/intellij/codeInsight/template/Macro.java:18-46` | `src/templateMacros.ts:80-94`（`TemplateMacro`）、`:499`（`templateMacroByName`） | `getName`/`getPresentableName`=名字+`()`/`getDefaultValue`=""、`calculateResult` 都按那份契约摆 |
| 表侧索引 / 工厂 | `[x]` | `platform/analysis-impl/src/com/intellij/codeInsight/template/macro/MacroService.java:38-51`；同目录 `MacroFactory.java:13-24` | `src/templateMacros.ts:496`（`macroIndex`）、`:499-501` | 按 `getName()` 建表、查不到就是 `undefined` |
| 表达式语法（词法 + 解析） | `[x]` | `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/MacroParser.java:53-148` | `src/templateMacros.ts:264`（词法，模块私有）、`:290-295`（四种节点）、`:323-362` | 标识符先查宏表（`:67-70`）、无 `(` 即零参宏（`:74-80`）、右括号缺失只记日志（`:84-86`）、`END` 只在独立成串时是空节点（`:133-138`） |
| 取值优先级（预定义表先命中） | `[x]` | `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/TemplateStateBase.java:72-97` | `src/templateMacros.ts:557-584` + `src/templates.ts:158-166` | `vars`（预定义）先命中的槽位不进宏表；`END` 恒空串；查不到的变量给 `null` |
| 定形迭代 + 轮数封顶 | `[x]` | `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/TemplateState.java:637-680`（`:660` 的 `(变量数+1)*3`） | `src/templateMacros.ts:599-624` | 宏互相引用靠封顶不靠递归检测；成环被切成 9 轮（用例钉长度） |
| 空结果 marker | `[x]` | 同文件 `:1122-1149`（`:1137-1141`：宏调用 ⇒ 该宏的 `getDefaultValue()`，否则 `"a"`） | `src/templateMacros.ts:618-621` | `decapitalize(NO_SUCH)` → `a`；`fileName`（无路径）→ 空串 |
| 表达式串的真正入口 | `[x]` | `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/Variable.java:62-88`（`:68` 表达式列、`:85` 默认值列）；`TemplateBuilderImpl.java` 全文只存字符串、不调 `MacroParser` | `src/templates.ts:153-176`（`render` 是唯一求值方） | 本仓把两列压进 `$NAME:那一段$`，认宏的判据与上游同一（首 token 命中宏表） |
| 设置页：变量表的 Expression / Default value 两列 | `[x]` | `platform/lang-impl/src/com/intellij/codeInsight/template/impl/EditVariableDialog.java:79-119`；列名文案 `platform/lang-api/resources/messages/CodeInsightBundle.properties:157-161` | `src/components/TemplateSettingsPage.vue:89-104`（`slotRows`）、`:246-251` | 每行报「这条宏的下拉文案」或「字面默认值」，读的是引擎那张表而不是另抄一份 |
| 设置页：可用宏清单（下拉那 21 条） | `[x]` | 同文件 `:103-111`（全量 → 按上下文过滤 → `getPresentableName()` → `sorted()` → 去重） | `src/components/TemplateSettingsPage.vue:114-115`、`:257-259` | 本仓无上下文表（`Macro.java:44-46` 默认恒真），只保留后三步；只读清单，不做没有后端的下拉 |
| 拼错的宏名要给提示 | `[x]` | `MacroParser.java:67-70`（查不到就当变量，不抛） | `src/templateMacros.ts:528-535`、页面 `:106-113`、`:245` | 上游不崩、本仓按字面文本插入，但那一格必须告诉用户不会求值 |
| 21 条宏的行为 | `[x]` | 各宏类：`MacroBase.java:37-67`、`SimpleMacro.java:22-29`、`CurrentDateMacro.java:16-42`、`FilePathMacroBase.java:34-85`、`EnumMacro.java:30-65`、`CommentMacro.java:21-27`（构造器口径）；文案 `CodeInsightBundle.properties:178-185` | `src/templateMacros.ts:402-477` | 逐条含 arity / 空串 / null 分档，判据在 `tests/template-macros.test.mjs` |
| 12 条接不上的宏 | `[-]` 具体理由逐条写在表里 | 同 XML 那 33 行 | `src/templateMacros.ts:481-494` | 见 §6；登记侧的消费方是门禁 T3（要理由、且宏表里查不到这个名字） |
| 头注释承诺的那条对账门禁 | 接手 `[ ]` → 本批 `[x]` | XML `:1031-1063` 全量 | `tests/template-macro-registry.test.mjs:77-150` | 本批新增；T5 还在参考树在位时把抄写和 XML 逐字核一遍 |
| `escapeStringCharacters` / `tokenizeTemplateExpression` 的导出面 | 接手 `[~]`（导出了但零外部消费方）→ 本批 `[x]` | — | `src/templateMacros.ts:177`、`:264`（都去掉 `export`，改模块私有） | 行为已由 `escapeString` 那条宏与解析用例钉住，不留没人用的公开 API |

## 2. 改动文件清单（`wc -l` 前后）

接手时现场 = 上一路代理留下的工作区状态（未 commit）。

| 文件 | 接手 | 收工 | 本批改了什么 |
|---|---|---|---|
| `src/templateMacros.ts` | 614 | **624** | 头注释：补 `MacroService`/`MacroFactory` 与宏类的**真实包路径**、登记那条假坐标（§7 留痕）、把消费链路与两个门禁文件写实（`:51-64`）；`escapeStringCharacters`/`tokenizeTemplateExpression` 降为模块私有并各写一行为什么 |
| `tests/template-macro-registry.test.mjs` | 不存在（头注释已承诺） | **150** | 新建：33 条注册对账 + 21 条名字/文案/marker + 12 条登记侧理由与「未实现」+ 下拉清单形状 + REF 在位时逐字核 XML + 消费链路源码锚点 |
| `tests/template-macros.test.mjs` | 172 | 172 | 一字未动（行为判据本来就在它里面，本批只核不写） |
| `src/templates.ts` | 269 | 269 | 本批未改（宏接缝是上一路接的，逐行核过，见 §0） |
| `src/components/TemplateSettingsPage.vue` | 313 | **312** | 只删掉 `-->` 与 `<div class="lt-macros">` 之间那行空行（别人留的悬挂空白），其余 hunks 全是上一路的、复核保留 |

`git diff --stat`（工作区累计，含上一路）：`TemplateSettingsPage.vue` +53、`templates.ts` +34/-7，
`src/templateMacros.ts` 与两个测试文件是新增未跟踪文件。

## 3. §5 每条自查命令的前后数字

| 检查 | 接手时 | 收工时 |
|---|---|---|
| `npx vue-tsc -b --force` | 3 错，**全在 `src/components/SearchPanel.vue`**（桶 9 在途），本域 0 错 | 全仓 7 错，**本域 0 条**（`src/components/ContentComboLabel.vue` 6 条 + `src/components/TestRunnerPanel.vue` 1 条，都是收工这段窗口里别的半区新落的，`git status` 里这两个文件的改动不是我这次的）。中间撤完注入、写完门禁那一次全量跑到过 **0 错** |
| `node --test tests/template-*.test.mjs tests/live-template-*.test.mjs tests/macro-*.test.mjs` | 31 / 31 绿 / 0 红 | **37 / 37 绿 / 0 红**（多的 6 条 = 新门禁） |
| 扩大自查：`templates` + `file-template-parser/registry/vars` + `template-create` + `find-replacement-template` + `surround-templates`（`render()` 签名被人改过，必须连老用例一起看） | 未跑 | **53 / 53 绿 / 0 红** |
| `node .tools/find-orphan-modules.mjs --gate` | 红 1：`src/structuralCodeBlock.ts`（桶 9 在途，在我只读面里） | **绿**：基线 9 / 已登记 9 / 新增 0。中途一度涨到 2（多的那条 `src/externalTaskSettings.ts` 是 Tools 半区落的），两条都由其 owner 自己接上，本域从头到尾**没有**新增零消费方模块（`templateMacros.ts` 有生产消费方 `src/templates.ts:8`，清单里查不到它） |
| `node --test tests/module-size.test.mjs` | 5 条里 1 红：`src/components/SearchPanel.vue(902 行)` 未登记 | **5 / 5 绿**（桶 9 自己拆了；`templateMacros.ts` 624 < 900，无需登记） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（新测试文件是纯 JS，正则里的 `/>` 已转义） |
| `node .tools/find-missing-ext.mjs` | 干净（扫 1244 文件） | **干净**（扫 1248 文件） |
| `node --test tests/source-citations.test.mjs` | 3 / 3 绿 | **3 / 3 绿**（`src/templateMacros.ts` 头注释里 52 条带行号的上游引用全部指得到） |
| `node --test tests/source-citation-anchors.test.mjs` | 8 / 8 绿 | **1 红**，锚点 id 是 `src/fileTypeDetection.ts` ⇒ 不是我改的文件，见 §4 取证 |
| native / ctest | 未涉及 | 未涉及（本批没碰 `native/`） |

## 4. 反向验证（注入违规 → 红 → 撤 → 绿）

每轮都跑 `node --test tests/template-macro-registry.test.mjs`（新门禁）+
`tests/template-macros.test.mjs`（行为）+（R4/R5）`tests/templates.test.mjs`（老契约）。
注入前把三个目标文件 `cp` 到 `build/`，撤完 `cp` 回去并 `diff -q` 逐字节复验（三文件均 `ALL RESTORED`，临时件已删）。

| # | 注入了什么 | 红了几条 | 撤后 |
|---|---|---|---|
| 基线 | 无 | 18 条里 **0 红**（门禁 + 行为）；30 条里 **0 红**（再加 templates） | — |
| R1 | `LIVE_TEMPLATE_MACROS` 里加一条上游没注册过的宏（`fakeNow` / `upstream: 'NotRegisteredMacro'`） | 18 条里 **3 红**：T1 并集对账、T2「上游没注册过的表里不许有」、T4 下拉清单条数 | 18 / 18 绿 |
| R2 | `DEFERRED_TEMPLATE_MACROS` 里删掉 `clipboard` 这一条（= 悄悄不做又不登记） | 18 条里 **2 红**：T1（并集少一条）、T3（登记侧缺名字） | 18 / 18 绿 |
| R3 | `date()` 的下拉文案写成 `date`（抄错 `getPresentableName()`） | 18 条里 **3 红**：T2、T4，以及既有用例「the settings page reads the same table the engine evaluates」 | 18 / 18 绿 |
| R4 | `render()` 不再问宏表（`resolveTemplateSlotValues(...)` 换成空对象） | 30 条里 **4 红**：门禁 T6 消费锚点 + 行为侧 3 条（marker 回退、字面量默认值老契约、真展开） | 30 / 30 绿 |
| R5 | 设置页的宏清单不再读表，换成写死的一条 | 6 条里 **1 红**：门禁 T6（`LIVE_TEMPLATE_MACROS … presentableName` 锚点断掉） | 6 / 6 绿 |

**跨半区那条锚点红的取证**（`tests/source-citation-anchors.test.mjs`）：
快照 `docs/inventory/citation-anchors.json:1238` 记的是
`src/fileTypeDetection.ts → platform/ide-core/src/com/intellij/openapi/fileTypes/NativeFileType.java|48-51`，
而 `src/fileTypeDetection.ts:82/:185/:257` 现在写的是 `:49-51`（上游 48 行是 `@Override`、49-51 是方法体，两档都指得动）。
该文件 `git status` 是 `M`、不在本批可改面，本批一个字没碰；
要复绿需主代理重算快照：`$env:TAOCODE_CITATION_ANCHORS='update'; node --test tests/source-citation-anchors.test.mjs`。

## 5. 零消费方自查结论

- 模块级：`node .tools/find-orphan-modules.mjs --gate` 收工为**绿**（新增 0）。跑动期间见过的那两条
  （`src/structuralCodeBlock.ts` 属桶 9、`src/externalTaskSettings.ts` 属 Tools 半区）由其 owner 自己接上了，
  都在本代理只读面外，本域文件从头到尾不在清单里。
- 符号级（逐个 `grep` 过 `src/` + `tests/`）：
  - `resolveTemplateSlotValues` → `src/templates.ts:168`；
  - `LIVE_TEMPLATE_MACROS` / `templateMacroOfExpression` / `unknownMacroCall` → `TemplateSettingsPage.vue:5/:114/:108`；
  - `DEFERRED_TEMPLATE_MACROS`（接手时**零代码消费方**，只在注释里被提了一句）→ 本批由门禁 T1/T3 消费；
  - `templateMacroByName` / `isTemplateMacroExpression` / `nameToWordList` / `parseTemplateExpression` /
    `evaluateTemplateExpression` → 模块内部 + 行为用例；
  - `escapeStringCharacters`、`tokenizeTemplateExpression` → **零外部消费方**，已降为模块私有（不删实现，删的是公开 API）。
- 类型（`TemplateMacroContext`/`TemplateSlotDefinition`/`TemplateExpressionNode`/`MacroParameters`/
  `TemplateExpressionEnvironment`/`DeferredTemplateMacro`）都在公开签名的位置上被签名本身需要，保留。
- 界面侧没有新控件：本批只删了一行空白。宏清单是只读 `<code>`（对应上游下拉的**选项文案**），
  没有后端的那 12 条不渲染。

## 6. 做不到 / 无法核实

1. 12 条登记侧宏做不到，逐条理由在表里（`src/templateMacros.ts:481-494`），具体卡点：
   - `user`：上游 `SystemProperties.getUserName()`，本仓 Web 侧没有同步 OS 用户名通道。
   - `clipboard`：`src/clipboard.ts:52` 的 `readClipboardText()` 是 **async**，宏求值路径（`render()`）同步。
   - `lineNumber` / `fileRelativePath`：`TemplateMacroContext` 只有 `path`；上游要展开点偏移
     （`LineNumberMacro.java:17` 的 `offsetToLogicalPosition`）与项目/源根（`FilePathMacroBase.java:82-84`）。
   - `complete` / `completeSmart` / `showParameterInfo`：这三条的返回是 `InvokeActionResult`
     （`ShowParameterInfoMacro.java:30-33`），要「模板收尾后再在编辑器里拉起一个动作」；本仓展开是
     一次性 `view.dispatch`，没有那条二段式通道。
   - `lineCommentStart` / `blockCommentStart` / `blockCommentEnd` / `commentStart` / `commentEnd`：
     注释标记表在 `src/commentToggle.ts:147`（`style.line`），但该模块 value-import 了 `@codemirror/state`；
     拉进 `templates.ts` 的依赖图会破掉「模板规则不依赖 CodeMirror、可独立单测」的既有契约。
     → 这 5 条 + 上面 3 条的挂点都写进了 `docs/wiring-requests-2026-10-06-fix-macros.md`，**不由本批私自接线**。
2. Java/Kotlin/Python/Groovy 各自还注册了语言专属宏（
   `java/java-impl/resources/intellij.java.impl.xml` 另有 27 条，kotlin 11、python 5、groovy 1），
   它们要 PSI/类型推断，本仓没有 PSI ⇒ **一律不实现、不渲染**，也不进本批的 33 条对账口径（口径是平台 lang-impl 那 33 条）。
3. `underscoresToCamelCase("a__b")`：上游 `ConvertToCamelCaseMacro.java:59-68` 走 `split("_")` 会留空段，
   空段进 `StringUtil.capitalize` 取 `[0]` 会抛 `StringIndexOutOfBoundsException`；本仓按「非字母数字段跳过」处理
   （`:381-386` + 用例注明）。**无法核实上游是否真在别处兜住这个异常**（没跑过 IDEA，也不许上网查），
   所以这一档只在注释与用例里写明「上游在这里会抛」，不当作已证实的行为差异。
4. `date`/`time` 无参数那一条：上游走 `DateFormatUtil.formatDate/formatTime`，读**区域设置**；
   本地树没有区域设置页可对照 ⇒ 沿用本仓 `src/fileTemplateVars.ts:112-113` 已有的 `yyyy/M/d`、`H:mm` 档，
   并在注释里写明那是**本仓档**，不是上游档。
5. 上游 `EditVariableDialog` 的表达式列是**可编辑下拉**（`isComboboxEditable():114-116`），能改某个变量的表达式；
   本仓把表达式写在模板正文的 `$NAME:那一段$` 里，所以那一列只能**展示**不能改 —— 这是本仓词法与上游两列模型的结构差异，
   不是漏做（要改就改正文，页面上本来就能编辑正文）。

## 7. 留痕（订正别人给我的坐标）

派单让本族以 `platform/lang-impl/src/com/intellij/codeInsight/template/impl/Macros.java` 为判据。
**该文件在基准树里不存在**（那个 `template/impl/` 目录里是 `EditVariableDialog.java` 等界面件，已逐目录列过）。
宏族的真身是两处：查表侧在
`platform/analysis-impl/src/com/intellij/codeInsight/template/macro/`（`MacroFactory.java`、`MacroService.java`），
实现类在 `platform/lang-impl/src/com/intellij/codeInsight/template/macro/`（27 个文件，含 `MacroBase`/`SimpleMacro`）。
本批按这两处对齐，并把这条订正写进了 `src/templateMacros.ts:11-19` 的头注释，免得下一路再去找那个不存在的路径。
（上一路的头注释里两处「门禁/挂点文件」指向不存在的 `tests/template-macro-registry.test.mjs` 与
`docs/wiring-requests-2026-10-06-macros.md`：前者本批已建成，后者改指向本代号的 `docs/wiring-requests-2026-10-06-fix-macros.md`。）
