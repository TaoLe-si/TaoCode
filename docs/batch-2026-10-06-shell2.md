# 批次报告 · 2026-10-06 · shell2（外壳 + 文件类型两域收尾）

派单两件事：① 逐条复核 `docs/wiring-requests-2026-10-06-shell.md`（W-1…W-4）与
`docs/wiring-requests-2026-10-06-filetypes.md`（F1…F5）对**当前代码**的成立性；
② 在 filetypes **模块侧**闭环 2~3 条，每条配「会失败的判据 + 反向验证」。

上游基准树：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`（下面每条都自己打开核过）。

## 0. 实况 vs 派单（先说不符，留痕）

| 派单/别人的说法 | 磁盘实况 | 处置 |
|---|---|---|
| 派单：上游真源在 `platform/core-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java` | **该路径下没有这个文件**。`find` 只命中一处：`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java`（`platform/core-impl/src/com/intellij/openapi/fileTypes/` 下只有 `PlainTextFileType.java` 等）。本仓现有引用（`src/main.ts` 引 `:165`、`:1236-1238`）用的就是 platform-impl 那一份，**复核后成立**：`:165` = `new IgnoredPatternSet(DEFAULT_IGNORED)`、`:1238` = `ignoredPatterns.setIgnoreMasks(...)` | 按 platform-impl 的坐标写全部结论；派单给的路径不采用 |
| 派单：`src/fileType*.ts`、`src/fileTypesModel.ts`（先 ls 确认） | `src/fileTypesModel.ts` **不存在**。本域实际是 7 个模块：`fileTypeDetection.ts` 351 / `fileTypeIgnoredList.ts` 247→293 / `fileTypeOverrides.ts` 302 / `fileTypePluginBeans.ts` 216 / `fileTypeRegistry.ts` 819→859 / `fileTypeRemovedMappings.ts` 230 / `fileTypes.ts` 47 | 改动落在 `fileTypeIgnoredList.ts` + `fileTypeRegistry.ts` |
| 本仓两处注释把上游那份 `IgnoredPatternSet` 写成 `IgnoredPatternSet.java:43-49` | `FileTypeManagerImpl.java:47` 显式 `import com.intellij.openapi.fileTypes.impl.copy1.IgnoredPatternSet`；`setIgnoreMasks` 在 copy1 的 `:46-53`、遮蔽闸在 `:47-53`（闸口在 `:49`）。`jps/model-impl/.../IgnoredPatternSet.java` 另有一份同名的（`setIgnoreMasks` 在 `:38-45`），两份都到不了 43-49 | 注释按 copy1 改对，并在 `src/fileTypeIgnoredList.ts` 文件头留痕「原写 :43-49、实际 copy1:46-53」 |
| 本仓 `src/fileTypeRegistry.ts` 文件头写「通配模式：更具体的在前，同长时 `?` 先于 `*`」 | 注释对、**代码错**：原 `specificityScore` 把「长度」和「转义串」拼成一个键后整体降序比 ⇒ 同长时 `*` 抢在 `?` 前。上游 `jps/model-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeAssocTable.java:113-120` 第一级 `reverseOrder()`、第二级 `thenComparing(...)` 是**升序** | 本轮修（判据 + 反向验证见 §4） |

## 1. 判词表

### 1a. 外壳域（W-1…W-4）—— 结论落在 `docs/wiring-requests-2026-10-06-shell.md` §0

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话 |
|---|---|---|---|---|
| W-1 本机级三键 | `[ ]` 仍缺 | `platform/ide-core/src/com/intellij/ide/GeneralLocalSettings.kt:79-83`（三键）、`:81`/`:82` 默认值 | `src/settingsModel.ts` `GeneralSettingsState` / `defaultGeneralSettings`、`native/settings_schema.hpp:103-107`、`native/settings_schema.cpp:140`、`:190-192`、`native/settings_transfer.cpp:41-49` | 三处一处没动；请求里的 old/new 行号本轮逐条重数过，**仍然可照抄** |
| W-2 治理两条 | `[x]` 已闭环 | — | `git ls-files` 实测：`scripts/verdict_table.py`、`docs/inventory/verdict-platform_rest.md`、`verdict-find-diff.md` 均已跟踪 | 不再需要主代理动手；原文留作留痕 |
| W-3 折叠域 tsc 错 | `[x]`（前提变了） | — | `src/customFoldingProviders.ts` | 本轮 `vue-tsc -b --force` 全树 0 错，TS1002 早已被清；中途基线出现的 4 条 `RunConsole.vue` 错也已由别批复绿 |
| W-4 ① 消息宿主 | `[ ]` 仍缺 | `platform/core-api/src/com/intellij/openapi/ui/messages/MessageDialogBuilder.kt` 一族 | `src/messageDialog.ts`（生产侧只有 `TrustedProjectDialog.vue`） | 缺的还是 `src/App.vue` 那层门面宿主 |
| W-4 ⑤ 步骤式弹层 | `[~]`（前提变了） | `platform/core-ui/src/ui/popup/ListPopupStep.java` | `src/popupSteps.ts` + 生产消费方 `src/components/ContentComboLabel.vue`、`src/popupAnchor.ts` | 原句「零生产消费方」已过期；收窄成 5 个导出仍零 src 消费方：`isFinalStepValue`/`listSeparator`/`nextSelectableRow`/`chosenOutcome`/`autoSelectionFired` |

### 1b. 文件类型域（F1…F5）—— 结论落在 `docs/wiring-requests-2026-10-06-filetypes.md` §0

| 条 | 判定 | 证据（本仓，本轮实测） |
|---|---|---|
| F1 忽略清单进文件树/预览过滤链 | `[ ]` 仍缺（前提没变） | `src/bridge.ts`、`src/bridgePreview.ts` grep `isFileIgnored\|isPathIgnored\|ignored` **零命中**；`bridgePreview.ts:51`/`:85` 仍只看 `excludedDirs`。两个目标都是保留文件 |
| F2 忽略清单并进搜索 exclude | `[ ]` 仍缺 | `src/searchExclusions.ts` 的三个导出不看忽略清单；调用面实测在 `src/components/SearchPanel.vue:39`/`:53`/`:279`（原文写的 `:36,50` 已漂，本篇改正） |
| F3 右键「覆盖文件类型」 | `[ ]` 仍缺 | `src/components/EditorPopupMenu.vue`、`src/App.vue` grep `fileTypeOverride` **零命中**；模型侧一套仍齐 |
| F4 「文件信息」stat 通道 | `[ ]` 仍缺 | `src/bridge.ts:109` 的 `Method` 联合整条重翻，仍无 `file.info`、无任何 size/mtime 通道 |
| F5 忽略清单/覆盖集进宿主设置 | `[ ]` 仍缺（决策） | 两份仍在 localStorage；本轮**新增一条前提**要一起带走：忽略清单现在「等于默认表就不写键」，且落盘值是**遮蔽后**的那张表 |

本轮**新提**两条请求（都给了可照抄 old/new + 判据）：
**F6** = `FileTypesPage.vue:309-310` 在 apply 后要回读生效清单；
**F7** = `src/templates.ts` 的 `languageFor` 与注册表是两张真源，要并成一张
（上游：`platform/core-api/src/com/intellij/openapi/fileTypes/LanguageFileType.java:82` 是唯一语言档出口，
同文件 `:25` 明确「实现类与 `getLanguage()` 不一致就报注册错误」）。

### 1c. 模块侧本轮闭环的三条（派单第 2 项）

| 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话 |
|---|---|---|---|---|
| 忽略清单的**遮蔽闸** | `[x]` 已做 | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/copy1/IgnoredPatternSet.java:47-53`（闸在 `:49`）、`:34-36`、`:46-53`；`FileTypeManagerImpl.java:1142-1145`、`:1148-1152`、`:1434-1438`、`:1322-1329`；`jps/model-api/src/com/intellij/openapi/fileTypes/ExtensionFileNameMatcher.java:20-22`；`jps/model-impl/src/org/jetbrains/jps/model/fileTypes/impl/FileNameMatcherFactoryImpl.java:14-27` | `src/fileTypeRegistry.ts` 新增 `addIgnoreMask`（`:691`）、`setIgnoredFilesList` 改为逐词条走闸（`:698-702`）；`src/fileTypeIgnoredList.ts` 的 `applyIgnoredPatterns`（`:257-262`）落盘**生效后**的表 | `*.pyc` 在场时加 `build.pyc` 不再进清单（上游同样静默丢弃，不报错） |
| 默认表**逐字一致**的门禁 + 「等于默认表就不持久化」 | `[x]` 已做 | `FileTypeManagerImpl.java:139-144`（`// must be sorted` + 17 条）、`:1434-1438`（相等就不写 `ignoreFiles` 元素）、`:1494-1504`（排序后逐位 `equalsIgnoreCase`）；`platform/platform-tests/testSrc/com/intellij/openapi/fileTypes/impl/FileTypesTest.java:1127-1130` | `src/fileTypeIgnoredList.ts` 新增 `isEqualToDefaultIgnoreList`（`:151-159`）+ `writeStored`（`:226-236`）；判据直接**解析上游源码**（`tests/file-type-ignored-list.test.mjs` 末三条） | 原来那条门只拿「同一个 agent 手抄的第二份表」比 ⇒ 抄漏会两份一起错；现在钉到源码字面 |
| 通配关联表**同长时 `?` 先于 `*`** | `[x]` 已修（真 bug） | `jps/model-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeAssocTable.java:113-120`、`findAssociatedFileType` `:159-175` | `src/fileTypeRegistry.ts` 的 `specificityKey`（`:165-168`）+ `compareSpecificity`（`:171-176`）、`associate` 的排序（`:457-458`） | 原实现两级方向都降序 ⇒ 同长时 `*` 压住 `?`，与上游第二级升序相反、也与自己文件头的注释相反 |

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 改了什么 |
|---|---|---|---|
| `src/fileTypeRegistry.ts` | 819 | 859 | 新增 `addIgnoreMask` 遮蔽闸、`setIgnoredFilesList` 改走闸；`specificityScore` → `specificityKey` + `compareSpecificity`（两级方向拆开）；文件头补 4 条上游坐标并订正 2 处旧口径 |
| `src/fileTypeIgnoredList.ts` | 247 | 293 | 新增 `isEqualToDefaultIgnoreList`；`writeStored` 按上游「等于默认表就不写」剪键；`applyIgnoredPatterns` 落盘生效后的表；文件头 `IgnoredPatternSet` 坐标订正 + 3 条新纪律；「localStorage 一份 JSON 数组」这句错话改成「分号分隔的一串」 |
| `tests/file-type-registry.test.mjs` | 120 | 164 | +2 条判据（遮蔽闸、通配排序两级方向） |
| `tests/file-type-ignored-list.test.mjs` | 166 | 234 | +3 条判据（上游逐字表、`isEqualToDefaultIgnoreList`、生效清单落盘） |
| `docs/wiring-requests-2026-10-06-shell.md` | 104 | 119 | 加 §0 逐条判定表（W-1…W-4） |
| `docs/wiring-requests-2026-10-06-filetypes.md` | 99 | 213 | 加 §0 逐条判定表（F1…F5）+ 新提 F6/F7 + 把本域漂移的行号全部改对 |
| `docs/batch-2026-10-06-shell2.md` | 新建 | 141 | 本报告 |
| 保留文件 | — | — | **零改动**（`src/App.vue`、`src/bridge.ts`、`src/bridge*.ts`、`src/style.css`、`src/tokens.css`、`src/settingsModel.ts`、`CMakeLists.txt`、`scripts/verdict_table.py`、`docs/inventory/*` 都没碰；`native/` 一行没动 ⇒ 不跑 ctest）。收工 `git diff HEAD --stat` 里 `scripts/verdict_table.py`(+3/-3) 与 `docs/inventory/verdict-editor.md`(+6/-6) 确有改动，**那是别的批的在途内容**，本域一次都没写这两个路径 |

⚠ 工作区共享导致 `git status` 看不清自己的 diff：`git log -- src/fileTypeRegistry.ts` 显示本域
`src/fileTypeRegistry.ts` 的**当时版本**（859 行，含本轮全部改动）被 **11:57 的 `7220a76`**
「feat(parity): 判决簿三条升档 + 语言档/齿轮身份等 6 处宿主接线」那条 commit 连带收进 HEAD（同批还带走了
`src/fileTypeIgnoredList.ts` 的 59 行改动）；**本轮我自己没有执行任何 git 写操作**（无 commit/push，
也没有 `checkout`/`reset`/`stash`/`clean`）。核对请以「磁盘文件 + `git show 7220a76 -- src/fileTypeRegistry.ts`」为准，
前后行数按磁盘实测列在上表。

## 3. §5 自查命令的前后数字

| 命令 | 前（本轮开工时实测） | 后（收工） |
|---|---|---|
| `node --test tests/file-type-*.{test.mjs} tests/ext-*file-types*.test.mjs tests/ide-shell-create-target.test.mjs`（9 个文件） | 8 个文件 92 tests / 92 pass / 0 fail | **106 tests / 106 pass / 0 fail**（含本轮新增 5 条） |
| `npx vue-tsc -b --force` | 4 错（全在 `src/components/RunConsole.vue`，非本域；开工瞬间的基线） | 收工前跑了几次，**总数随别的批在途波动**：30 错（gradle/projectModels/runAnything/scratch…）→ 5 错（`TrustedProjectDialog.vue`/`vcsLogGraph.ts`/`workspaceLifecycle.ts`）→ 最后一次 4 错（全在 `src/lspNavigation.ts` 的语法错，`git status` 显示那是别的批在途改的）。**本域文件 0 错**：每一次输出里 grep `fileType\|templates` 均 **0 命中**；另单独跑 `npx tsc --noEmit --strict … src/fileTypeIgnoredList.ts src/fileTypeRegistry.ts` ⇒ **无任何输出**（干净）。中途还抓到过一次全树 **0 错** ——**这条要主代理收线**：全树绿不绿取决于并发批次，不由本域决定 |
| `node --test tests/module-size.test.mjs` | 5/5 绿 | **5/5 绿**（本域两个模块 859 / 293 行，远低于 900；未登记豁免、未抬上限）。中途抓到过一次 **4/5**：`src/components/CodeEditor.vue 1151 > 1147` —— 那是编辑器批的在途改动（`git diff HEAD` 出 11+/7-），我没有该文件归属、也没抬上限；复跑时他们自己降回去了 |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 8、已登记 8、新增 0 ⇒ 绿 | 本域改动落地时 **门禁绿**（已登记 7 / 基线 8 · **新增 0** · 清掉 1）。写报告期间**编辑器批**连着新建了 `src/editorSplitLine.ts`、`src/editorColumnMode.ts`（`git status` 都是 `??`，本轮没写过这两个路径）⇒ 最后一次快照 `已登记 6 / 基线 8 · 新增 2 · 清掉 2` 出红，**两条都不是本域文件**；本域没新增模块、也没往基线里塞东西 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 本轮**首次**实测（模块改动已落、文档改动未落）：11/11 绿，快照 3009 / 活引用 3054 / 未入快照 45 / 区间为空 0 | **11/11 绿**，快照 3009 / 活引用 3136 / 未入快照 127 / 区间为空 0 ⇒ 新增的都是**全文路径**引用、尚未入快照（门控只报数不拦，下次 `TAOCODE_CITATION_ANCHORS=update` 重算即收进去 —— **这条要主代理在合并线上跑一次**）；已入快照的 3009 条**一条没被改动**（否则第 ② 条断言会红） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净（1308 文件） | **干净** |

## 4. 反向验证记录（三步：注入 → 红 → 撤 → 绿）

注入脚本 `build/mutate-shell2.mjs`（临时，收工已删；备份在 `build/shell2-backup/`，同样已删）。
一次注 4 条，跑 `tests/file-type-ignored-list.test.mjs` + `tests/file-type-registry.test.mjs`：

| 注入 | 改动 | 结果 |
|---|---|---|
| M1 | `DEFAULT_IGNORED_FILES` 里 `*.rbc` → `*.rbcc` | 红 2 条：新的「与上游逐字一致」门 + 原有「17 条且已排序」门 |
| M2 | `addIgnoreMask` 的闸关掉（`if (!value) return false`） | 红 2 条：新「遮蔽闸」门 + 原有「分号掩码、去重」门（证明原门也确实在管重复） |
| M3 | `writeStored` 的剪键条件取反 | 红 1 条：新「落盘的是生效后的那张表」门 |
| M4 | `compareSpecificity` 第二级改成降序（回到本轮修之前的行为） | 红 1 条：新「通配表排序」门 |

合计：**24 tests / 18 pass / 6 fail**（红 6）⇒ 逐条还原后 **24 tests / 24 pass / 0 fail**（复绿）。
再跑整套 9 个域测试 **106/106 绿**。

## 5. 零消费方自查

`grep -rn` 全仓（`src` + `tests` + `docs`，剥掉 batch/wiring 类文档后逐条看）：

- 新增 `FileTypeManager.addIgnoreMask` —— 生产侧被同类 `setIgnoredFilesList` 调（唯一入口就是清单装载/应用），测试侧 2 处；
- 新增 `isEqualToDefaultIgnoreList` —— 生产侧被 `writeStored` 调，测试侧 1 处；
- 新增 `specificityKey` / `compareSpecificity` —— **未导出**（模块私有），只由 `associate` 消费，避免造只过自己测试的出口；
- 被换掉的老私有函数 `specificityScore` 随替换一起删除，全仓 grep 只剩本报告的叙述（`src`/`tests` 零命中），
  也没有任何测试用 `read('src/fileTypeRegistry.ts')` 拿它当锚点；
- 本域**没新增任何只过自己测试的 export**。仍在基线里的相关孤儿只有 `src/generalSettingsLocal.ts`
  （`.tools/orphan-baseline.txt:25`，理由「缺 settingsModel.ts 三个键」= W-1），本轮未动、不新增。
- 提醒：`isPathIgnored` / `isIgnoredName`（`src/fileTypeIgnoredList.ts:287`/`:279`）目前只有测试与
  `FileTypesPage.vue` 用，生产侧的文件树/预览仍不查它 —— 那就是 F1，**不是**「死代码直接删」的对象：
  删了就等于把 F1 的模型侧出口拆掉。它是「接不上宿主」，已在文件头与 F1 写清。

## 6. 做不到 / 无法核实

1. **F1/F2/F4 接不上**：目标分别是 `src/bridge.ts`、`src/bridgePreview.ts`、`src/searchExclusions.ts`、`native/main.cpp`。
   前两个是保留文件、后两个不在本 lane；本域改不了 ⇒ 只能留请求（卡点是「文件归属」，不是技术）。
2. **上游 `VirtualFileInfoAction` 仍指不到行号**：本地树 `find -name 'VirtualFileInfoAction*'` 零命中（沿用 F4 原文的诚实登记）。
3. **JS `toLowerCase()` ≠ Java `equalsIgnoreCase`**（`isEqualToDefaultIgnoreList`）：后者逐码元、不折叠全字符大小写映射，
   `İ`/`K`（Kelvin）一类在上游与本仓结论会不同。上游那份表 17 条全是 ASCII ⇒ 实际不引差异；
   要绝对一致得逐码元比，本仓没有那种字符能进这条清单（`isValidIgnorePattern` 已禁控制字符与 `<>:"|?*`），故不为此加代码。
4. **上游 `StringTokenizer` 不 trim，本仓 trim**（`ignorePatternsFromList` / `setIgnoredFilesList`）：
   `'a; b'` 上游得 `['a',' b']`，本仓得 `['a','b']`。这条被既有断言钉住（`tests/file-type-ignored-list.test.mjs` 的
   「tokenizer 跳空词条」那条），且面板输入本身已被 `isValidIgnorePattern` 拒掉空白变体 ⇒ 本轮**不动断言**、只做登记。
5. **`migrateFromOldVersion` 的按版本增量迁移**（`FileTypeManagerImpl.java:1256` 那个方法，`:1259-1318` 一串
   `addIgnore`/`unignoreMask`，其中 `:1315-1318` 是 `savedVersion < 19 ⇒ addIgnore(".mypy_cache"/".ruff_cache"/".pytest_cache")`）
   本仓**没有对应物**：本仓清单没有版本号存储，等价物就是「没存过 ⇒ 用 `DEFAULT_IGNORED_FILES`（17 条已含这三条）」。
   判 `[-]` 不适用，理由即此。
6. **无法核实**：派单给的 `platform/core-impl/.../FileTypeManagerImpl.java` 路径不存在（见 §0 第 1 行）；
   其余论断全部换成我打开过的 platform-impl 那份坐标。
7. **全树 tsc 数字不由本域决定**：见 §3 那一行 —— 并发批次在途，收工时全树 5 错（都不在本域文件），
   本域两个模块单独 `tsc --noEmit --strict` 干净。**这条要主代理在合并线上复跑**，不要按本报告当成「全树绿」。
8. **本域改动被别的批连带 commit 了**（§2 那条 ⚠）：本轮没执行任何 git 写操作，
   但 `src/fileTypeRegistry.ts` / `src/fileTypeIgnoredList.ts` 的**中途快照**已进 HEAD ⇒ 主代理核对 diff 时
   请以「磁盘 vs `git show HEAD~N`」或直接读文件为准，不要只看 `git status`。

## 7. 需要主代理接的线

见两份请求文档的新 §0（判定表）+ 新提条目：
- `docs/wiring-requests-2026-10-06-shell.md` §0：W-1 三处同批（代码可直接照抄，行号已复核）、W-2/W-3 可关闭、W-4 收窄；
- `docs/wiring-requests-2026-10-06-filetypes.md` §0 + F6 + F7：F6 给 `FileTypesPage.vue` 属主、F7 给 `src/templates.ts` 属主，
  两条都带可照抄 old/new 与「一条判据 + 反向验证」；F1/F2/F4/F5 维持原请求（行号已订正到现树）。
