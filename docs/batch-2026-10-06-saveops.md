# 2026-10-06 保存时两条 pass：行尾空白清理 / 末行换行 —— 从「解析了没执行」变成执行体

对应缺口：`docs/inventory/verdict-editor.md` §C 第 ① 条（C-1 行）与 §G 的
`TrailingSpacesStripper` / `StripTrailingSpacesFilter` / `SmartStripTrailingSpacesFilter` /
`StripTrailingSpacesFilterFactory` 四条 `[ ]`；证据是 `src/editorConfig.ts` 原第 334 行的自陈
「需要在格式化后跑一遍纯文本 pass（本批未做）」。

## 0. 先纠偏：任务书给的三处上游坐标不成立（逐条开文件核过）

| 任务书坐标 | 实情 | 真坐标 |
|---|---|---|
| `platform/ide-impl/.../openapi/editor/impl/TrimUtil.kt`（任务书称其 126-131 行） | 该路径在本树**不存在**。同名文件只有 `platform/util/diff/src/com/intellij/diff/comparison/TrimUtil.kt`（diff 的上下文裁剪）与 `platform/diff-impl/tests/testSrc/com/intellij/diff/comparison/TrimUtilTest.kt` | 行尾空白语义在 `platform/core-impl/src/com/intellij/openapi/editor/impl/StripTrailingSpacesUtil.java:60-90` |
| `.../impl/ByWordRt.kt:610-630 / :880-895 / :939-963`（称含 `isTrailingSpace`） | 同名文件只有 `platform/util/diff/src/com/intellij/diff/comparison/ByWordRt.kt`，是 **diff 按词切分器**，与保存 pass 无关；`isTrailingSpace` 这个符号全树无命中（三条路各搜过：包路径、语义、XML 的 `id`） | 同上，判据是 `StripTrailingSpacesUtil.java:68-74`（只认 `' '` 与 `'\t'`） |
| `platform/ide-api/src/com/intellij/openapi/editor/EditorSettings.java`（称是设置项宿主） | 真身是 `platform/editor-ui-api/src/com/intellij/openapi/editor/EditorSettings.java`（275 行），里面**没有**任何行尾空白 / 末行换行设置项（`grep -n "TrailingSpace\|LINE_FEED\|LineFeedAtEOF"` 零命中） | 宿主是 `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java` |

结论按**核实过的**上游实现落地，没有沿用那三处坐标，也没有按「IDEA 一般是…」补逻辑。

## 1. 判词表（本仓落点 ↔ 上游逐条）

| 上游 | 本仓落点 | 判词 |
|---|---|---|
| `TrailingSpacesStripper.java:46`（类本体是 `FileDocumentManagerListener`）、`:61-63`（`beforeDocumentSaving`） | `src/editorFileOps.ts:227-255` 的 `transformOnSave` + `src/App.vue:1134` 之后的调用（待接线，见接线请求） | `[~]` 触发时机与上游同一档（保存前、格式化后）；本仓没有消息总线，靠 `save()` 里的一行调用，故 `[~]` 而非 `[x]`（接线后即 `[x]`） |
| `TrailingSpacesStripper.java:65-110`（三段式：清行尾 → 删末段空行 → 补末行换行） | `src/editorSaveTransforms.ts:482-528` `applySaveTextTransforms` | `[x]` 两条点名行为按同一先后执行；第三段 `removeTrailingBlankLines`（`:76-78` + `:112-131`）**本批不做**（见 §4） |
| `TrailingSpacesStripper.java:295-322`（`getOptions` 四道门：`isWritable` / 无文件 / `isValid` / `DISABLE_FOR_FILE_KEY`） | `src/editorSaveTransforms.ts:436-440`（`SaveTransformSkip`）+ `:486-497`；门参数由 `editorFileOps.ts:252-253` 供给（`writable: !tab.readOnly`、`backedByFile: isDesktop`） | `[x]` 只读文档 / 浏览器示例缓冲（无磁盘文件）/ 文件失效 / 临时禁用四档都短路，且**不做任何**变换；测试「四道门」逐条钉 |
| `TrailingSpacesStripper.java:80-109`（末行换行，含「末行纯空白 ⇒ 删掉而不是补换行」这条上游怪癖、`:98-106` 的光标区间判断） | `src/editorSaveTransforms.ts:418-433` `ensureNewLineAtEnd` | `[x]` 两个分支都照抄（`last-line-cleared` / `added`），测试三钉：已有末行换行不动、纯空白末行删、光标在末行时改走补换行 |
| `TrailingSpacesStripper.java:324-399`（`MyTrailingSpacesOptions`：provider 有值用 provider，否则回落 IDE 设置；五个字段） | `src/editorSaveTransforms.ts:134-160`（`SaveTrimOptions` 五字段齐全）+ `:148-160`（回落式）+ `:200-215`（provider 覆盖） | `[x]` 五字段一个不缺；`removeTrailingBlankLines` 是契约字段但无执行体 |
| `StripTrailingSpacesUtil.java:21-110`（逐行扫描 + 倒序删除） | `src/editorSaveTransforms.ts:348-395` `stripTrailingSpaces` | `[x]` 扫描方向、字符集（空格/制表符）、`finalStart = whiteSpaceStart + maxSpacesToLeave`、倒序删除逐条对应；`:95-108` 的「撤销透明写 + `executeInBulk`」在纯文本层没有对应物（本仓 `setDraft` 整篇重挂），故不映射 |
| `StripTrailingSpacesUtil.java:19,92`（>1000 行走批量模式） | 不移植 | `[-]` 那是 JVM 文档模型的写事务优化；本仓是字符串重建，O(n) 一趟，没有对应的批量对象 |
| `StripTrailingSpacesUtil.java:46-54,78-84`（每行取最大光标偏移；被挡的行延后） | `src/editorSaveTransforms.ts:356-362` + `:379-383`（`deferredLines`） | `[x]` 语义一致；上游的延后队列 `TrailingSpacesStripper.java:52-58`（`beforeAllDocumentsSaving` 再清一遍）本仓**每次保存都重跑**这条 pass，等价承接，`deferredLines` 用于向用户交代 |
| `StripTrailingSpacesUtil.java:62`（`isLineModified` 逐行脏标记）+ `FileDocumentManagerImpl.java:502`（落盘后清脏） | `src/editorSaveTransforms.ts:303-312` `changedLinesAgainstSaved`（复用 `src/diffText.ts:103` 的 `computeLCS`） | `[~]` 本仓没有逐行脏标记，用「与上次落盘正文的行差异」承接。差异：改回原样的行在上游算脏、这里不算 ⇒ **少清不多清**，方向保守。拿不到基线时一行都不清（`:351-354`） |
| `StripTrailingSpacesFilter.java:29,40,50,61` + `SmartStripTrailingSpacesFilter.java:21-33` + `StripTrailingSpacesFilterFactory.java:12-30` | `src/editorSaveTransforms.ts:314-346` 的三个接缝：`trailingSpacesToLeave`（Smart：给数、`-1` 否决）、`strippingNotAllowed`（NOT_ALLOWED 整篇）、`enforcedRemoval`（ENFORCED_REMOVAL 作废 filter） | `[x]` 契约与四种短路语义都在（§G 那三条 `[ ]` 的行为面已落地）；EP 注册表本体是 JVM 扩展点，本仓用回调参数承接 ⇒ 类名层面 `[-]` |
| `KeepTrailingSpacesOnEmptyLinesFilterFactory.java:30-35,93-99,102-113`（注册在 `intellij.platform.lang.impl.xml:1546`；空白行按上下文缩进保留） | 不装这条 filter | `[x]` 等价于上游默认：装它的条件是 `IndentOptions.KEEP_INDENTS_ON_EMPTY_LINES`（`CommonCodeStyleSettings.java:1047` 默认 **false**），本仓 `IndentOptions`（`src/codeStyleSettings.ts:42-51`）没有这个字段 ⇒ 恒 false ⇒ 不装。**接缝留着**，键落下来即接一条实现 |
| `MarkdownStripTrailingSpacesFilterFactory.java:18-26`（按 `MarkdownSettings.isStripTrailingSpacesOnSave` 整篇 ALL_LINES/NOT_ALLOWED） | 不接 | `[ ]` 需要「按文件类型的一条设置」，本仓没有该设置项；行为面用 `strippingNotAllowed` 接缝承接，判据测试已钉这条接缝 |
| `JavaStripTrailingSpacesFilterFactory` / `Kotlin…` / `Groovy…` / `Yaml…` / `Properties…` | 不移植 | `[-]` 前四家过 `PsiBasedStripTrailingSpacesFilter`（PSI 词法档），本仓没有 PSI 引擎 ⇒ 无法核实其内部行为，保守地**不猜**（宁少清不误清） |
| `EditorConfigTrailingSpacesOptionsProvider.kt:13-23,27-45,48-56` | `src/editorSaveTransforms.ts:176-198` `editorConfigSaveOverrides` | `[x]` 只认 `true`/`false`（大小写不敏感）、两键都解不出 ⇒ 整份不生效、`:39-41` 的 `changedLinesOnly = !trim` 逐条照抄 |
| `EditorConfigTrailingSpacesFilterFactory.java:16-37` | `src/editorSaveTransforms.ts:182`（`enforcedRemoval: trim === true`）+ `:368` 的消费 | `[x]` `trim = true` ⇒ 语言 filter 全部作废 |
| `Utils.kt:240-241,243-247,249-253`（`.editorconfig` 前置门 + 配置文件对自己不生效） | `src/editorConfig.ts:343-351` 新增 `isEditorConfigPath`；`src/editorSaveTransforms.ts:223-247` 用 `codeStyleToggles.editorConfigEnabled` + 这一条把门 | `[x]` 「局部开关关掉 ⇒ 整层回落 IDE 设置」与「`.editorconfig` 自己不被覆盖」都判得住（测试两钉） |
| `EditorSettingsExternalizable.java:73,74,75,142,216-218,804-806,815-817,826-829,1144-1146` | `src/editorSaveTransforms.ts:97-146`（三档字面值 + `UPSTREAM_SAVE_TRIM_DEFAULTS` + 回落式） | `[x]` 默认档逐项取自上游字段初值；**读不到键就走默认**，不把旧存档判坏（本仓事故规矩） |
| `FileDocumentManagerImpl.java:1214-1245`（`multiCast`：消息总线 → listener → **最后** `myTrailingSpacesStripper`） | 顺序写死在 `src/editorFileOps.ts:226-233` 的注释与 `applySaveTextTransforms` 内部两段顺序；接线点在 `App.vue:1134` 之后 | `[x]` 与上游同为「Actions on Save 之后」；反向验证 M5 证明顺序不可换 |
| `FileDocumentManagerImpl.java:376-392`（`saveDocumentAsIs` 临时关掉这条 pass） | 本仓对应物：本地历史回滚 `App.vue:1109` 直接 `file.write`，不经 `save()` ⇒ 天然不跑这条 pass | `[x]` 行为等价，无需 `DISABLE_FOR_FILE_KEY` 的宿主（接缝 `strippingDisabledForFile` 保留） |

`src/editorConfig.ts` 的 `EDITOR_CONFIG_KEYS_WITHOUT_CONSUMER`（原第 330-336 行）**去掉**了
`trim_trailing_whitespace` 与 `insert_final_newline` 两项，余下 `end_of_line` / `charset` / `max_line_length`
三条保持「本仓没有落点」的如实登记；模块头第 28-31 行的消费链路同步补上新执行体。

## 2. 与既有模型的对齐（不重算第二遍）

- `.editorconfig` 层级：只用 `src/editorConfig.ts` 的既有原语 `editorConfigDirsFor` / `mergeEditorConfigs` /
  `configValueForKey` / `parseEditorConfig`，reader 复用 `src/codeStyleSettings.ts:248-262` 的
  `makeEditorConfigReader`（同一份 `file.read` 通道）。
- 生效缩进那份模型：门用同一个 `codeStyleToggles.editorConfigEnabled`
  （上游 `EditorConfigSettings.java:12`），不建第二张开关表。
- 行差异：复用 `src/diffText.ts:103` 的 `computeLCS`（与保存冲突预览同一套 Myers 对齐）。
- 光标坐标：`src/editorSaveTransforms.ts:283-290` 的 `offsetInText` 负责「CodeMirror 行/列 → 序列化正文偏移」，
  CRLF 正文按分隔符长度累加（CodeMirror 内部只按 `\n` 计位，直接把 `selection.head` 传进来会整体偏 N）。

## 3. 落点行号（本轮改完的盘上状态）

| 文件 | 行数 | 关键锚点 |
|---|---:|---|
| `src/editorSaveTransforms.ts`（新建） | 547 | `:97-104` 三档字面值；`:110-146` 设置面 + 上游默认 + 五字段契约；`:148-160` 回落式；`:176-198` `.editorconfig` 覆盖；`:200-215` provider 覆盖 IDE；`:223-247` 层级 walk（近层赢、坏文件/`root` 收口）；`:254-312` 行模型 + 差异基线；`:348-395` 清行尾；`:418-433` 末行换行；`:482-528` 保存入口与四道门；`:534-547` 一次性入口 |
| `src/editorFileOps.ts` | 274（原 241） | `:19-20` 两条新 import；`:226-258` `transformOnSave`（出口在返回对象 `:262`） |
| `src/editorConfig.ts` | 351（原 336） | `:28-31` 消费链路补新执行体；`:331-341` 「无消费方」清单去掉两键；`:343-351` 新增 `isEditorConfigPath` |
| `tests/save-transforms.test.mjs`（新建） | 329 | 32 条判据 |

`src/settingsModel.ts` / `native/*`：**未动**（保留文件 + 键未落 ⇒ 不动 native，也不跑 ctest）。
设置页那一格：**未渲染**（刻意的，见 §5）。

## 4. 反向验证（注入违规 → 红 → 撤 → 绿）

基线 `node --test tests/save-transforms.test.mjs`：**pass=32 fail=0**。
注入 10 条，10 条都把对应判据打断（每条注入后只保留那一处改动，跑完立刻还原原文）：

| 注入 | 转红的判据（条数） |
|---|---|
| M1 行尾只认空格、漏掉制表符（违背 `StripTrailingSpacesUtil.java:70`） | 1：「整篇清 ⇒ 多处行尾空白倒序删除后互不串位」 |
| M2 去掉「光标挡路就延后」（违背 `:78-84`） | 1：「光标挡路的那一行留到下次，光标在行首不影响清理」 |
| M3 忽略「只清改动过的行」（违背 `:62`） | 1：「只清改动过的行：基线里没有变的那几行保持原样」 |
| M4 末行分支把 `stripTrailingSpaces` 取反（违背 `TrailingSpacesStripper.java:89`） | 2：「末行是纯空白 + 开了行尾清理 ⇒ 删掉末行」+「光标落在末行 ⇒ 改走补换行」 |
| M5 把清行尾那一段短路（等价于丢掉两段顺序） | 1：「执行顺序：先清行尾、再判末行」 |
| M6 `.editorconfig` 的 `changedLinesOnly` 不再取反（违背 provider `:39-41`） | 3：取值域 / `trim=true` 档 / provider 覆盖回落 |
| M7 取值域放宽成「非 false 都算 true」（违背 `:48-56`） | 1：「两键的取值域：只认真假字面值」 |
| M8 去掉「文档不可写」这道门（违背 `getOptions:296`） | 1：「四道门：不可写 / 没有文件 / 文件已失效 / 被临时禁用」 |
| M9 `.editorconfig` 层级改成远层赢（违背 `mergeEditorConfigs` 的 foldRight 语义） | 1：「editorconfig：离文件最近的赢」 |
| M10 删除区间改成正序执行（违背 `:100-106`） | 5：多行清理、改动行档、光标延后、顺序、语言 filter |

还原后再次 `node --test tests/save-transforms.test.mjs`：**pass=32 fail=0**（脚本自删，未留在仓库）。

## 5. 刻意的「不渲染」与接线请求

设置页两格（`Strip trailing spaces on save` 三档 + `Ensure every saved file ends with a line break`）
**本轮不渲染**：`src/settingsModel.ts` 里没有对应键 ⇒ 渲染出来就是没有消费链路的假控件。
执行体现在就走上游默认档（清改动行的行尾空白、不补末行换行），`.editorconfig` 也已经能真实压过默认档。
键与解锁的整段可照抄内容在 `docs/wiring-requests-2026-10-06-saveops.md`。
`tests/save-transforms.test.mjs` 末条判据钉着「不渲染」这件事，键落地并接上设置页时**同步改那一条**（不许顺手删）。

## 6. 验证数字（本机实测）

| 门禁 | 结果 |
|---|---|
| `node --test tests/save-transforms.test.mjs` | 32 tests / 32 pass / 0 fail |
| 本域相关既有测试（`actions-on-save`、`code-style`、`editor-config`、`editor-whitespace`、`editor-file-ops` 一族） | 全绿（含在全量里） |
| `npx vue-tsc -b --force` | 0 错 |
| `node --test tests/module-size.test.mjs` | 5 pass / 0 fail（新文件 547 行 < 900） |
| `node --test tests/source-citations.test.mjs` | 3 pass / 0 fail（本轮所有上游 `路径:行号` 都在树内可核） |
| `node .tools/find-missing-ext.mjs` | 干净（1215 文件） |
| `node .tools/find-param-props.mjs` | 0 处参数属性 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 |
| `node .tools/find-orphan-modules.mjs --gate` | 门禁绿：新增 0 孤儿（`editorSaveTransforms.ts` 有生产消费方 `editorFileOps.ts`） |
| 全量 `node --test tests/*.test.mjs` | **4915 tests / 4914 pass / 1 fail** |
| ctest（`npm run test:native`） | **未跑**：本轮没有改任何 `native/*`（键未落 ⇒ 不动 schema） |

那 1 条红**不在本域**：`tests/status-bar-widgets.test.mjs:84`「装配：App.vue 的勾选清单走注册表，
且工具栏/状态栏那四条不是工厂」，断言「真工厂应有 12 条，实为 13」。它只读 `src/App.vue` 与
`src/statusWidgets.ts`（本轮零接触，两者正被另一条 lane 改动中，`git status` 可见），与本批四份文件无关。

## 7. 做不到 / 无法核实

1. `removeTrailingBlankLines`（上游 `TrailingSpacesStripper.java:112-131`）——判词点名的是两条，
   这第三条有自己的设置项 `REMOVE_TRAILING_BLANK_LINES`（默认 false，`EditorSettingsExternalizable.java:75`）；
   没有键就写执行体 = 放假逻辑，所以只保留契约字段，**未执行**（测试「removeTrailingBlankLines 只有契约字段」钉着这个不作为）。
2. 五家 PSI 侧 filter「无法核实其内部行为」：`PsiBasedStripTrailingSpacesFilter` 依赖 PSI 词法档，本仓没有 PSI 引擎；
   宁可不 clean 也不猜哪些行不该动。
3. 上游 `POSTPONED`（`StripTrailingSpacesFilter.java:40`）这条「文档此刻不能改、稍后重试」的整文档级
   短路**没有对应物**：本仓的 pass 是纯函数、跑在落盘前的字符串上，不存在「此刻被锁」的状态；
   延后语义由「每次保存重跑 + `deferredLines` 上报」承接。
4. 上游 `document.insertString(end, "\n")`（`:94`）字面插入单个 `\n`；CRLF 文件的落盘分隔符由宿主
   `file.write` + `file.lineSeparators` 那条链决定（本仓既有行为），本轮**没有**为末行换行造第二套分隔符逻辑。
5. 上游 `getOptions()` 的第五道门（`EditorSettingsExternalizable.getInstance() == null`，`:300-301`）
   在本仓架构里没有对应对象（设置模型必然存在），因此 `SaveTransformSkip` 只有四条 —— 未编造第五条。
