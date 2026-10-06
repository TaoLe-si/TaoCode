# batch merge3：三方合并模型的判据补全（2026-10-06）

域：`src/mergeConflicts.ts` / `src/mergeResolve.ts` / `src/mergeResolveHost.ts`（`src/` 下 merge 前缀的真实文件只有这三个 + `mergedMainMenu.ts`/`completionMerge.ts`/`formattingMerge.ts` 这三个不同族的东西，三方合并模型在前两个里）。

派单点名的三个上游文件 **`MergeDialogModel` / `MergeChangeList` / `LineSeparatorSplitStrategy` 在参考树里不存在**（全树 grep：前两个 0 命中，第三个 0 命中；`MergeChangeList` 只作为局部变量名出现在 `platform/diff-impl/src/com/intellij/diff/merge/LangSpecificMergeConflictResolverWrapper.kt:82-93`）。
**原写这三个名字、实际用的是**：`platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt`、
`platform/diff-impl/src/com/intellij/diff/merge/TextMergeChange.kt`（改动清单里每条改动的状态模型）、
`platform/util/base/multiplatform/src/com/intellij/openapi/util/text/LineTokenizer.kt`（行分割）。
下面每条上游行号都是本批自己打开文件数出来的。

---

## 1. 判词表

族 / 项 / 判定 / 上游依据（相对路径:行号）/ 本仓落点 / 一句话

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话 |
|---|---|---|---|---|---|
| A 模型 | A1 双方改同一行 ⇒ 冲突 | `[x]` | `platform/util/diff/src/com/intellij/diff/util/MergeRangeUtil.kt:64-71`；`platform/util/diff/src/com/intellij/diff/comparison/MergeResolveUtil.kt:132` | `src/mergeResolve.ts:147-149`；`tests/merge-resolve.test.mjs:247-262`（判据一）与 `:264-274`（判据一之二，两侧改成不同行数） | 对齐出一个同位片段 ⇒ `conflict`+`canBeResolved:false` ⇒ `tryResolveConflict` 返回 null ⇒ 两个动作逐字节不动文本 |
| A 模型 | A2 双方改不同行 ⇒ 自动合并 | `[x]` | `platform/diff-impl/src/com/intellij/diff/merge/MergeConflictModel.kt:211-233`（非冲突改动取"动的那一侧"）、`:365-381` | `src/mergeResolve.ts:329-365`；`tests/merge-resolve.test.mjs:276-292`（判据二） | 隔开两行的各自改动被切成两个片段，`['X','b','c','d','Y']` 逐行精确；只有一侧动时两个口径都合 |
| A 模型 | A3 一侧删、另一侧改 ⇒ 冲突 | `[x]` | `MergeRangeUtil.kt:59-62`（`unchangedLeft/Right` 只有在另一侧没动时才给 DELETED）、`MergeResolveUtil.kt:132` | `tests/merge-resolve.test.mjs:294-311`（判据三，正反两向 + "一侧删、另一侧没动 ⇒ 真的删掉"对照） | 删与改撞在同一段就是 conflict；一侧删、另一侧没动才是 `-=-`/`-==` 的可合档 |
| A 模型 | A4 基线缺失 | `[x]` | `MergeRangeUtil.kt:26-41`（`isBaseEmpty` 三档：`--=`/`=--` 插入、`=-=` 等则插入、不等给 `null` 策略）、`MergeConflictType.kt:12,14-15,17-18` | `tests/merge-resolve.test.mjs:313-339`（判据四，5 个形状） | 两路标记 / diff3 空基线段 ⇒ 两侧不同一律 conflict；两侧相同自动取那一份；一侧空取另一侧 |
| A 模型 | A5 行分割的字节回写 | `[~]` | `platform/util/base/multiplatform/src/com/intellij/openapi/util/text/LineTokenizer.kt:47-56`（认 `\r`、`\n`、`\r\n` 三种） | `src/mergeConflicts.ts:53`、`src/mergeResolve.ts:409`（都 `split('\n')`） | CRLF 逐字节原样回写（本批实测：可自动合的 CRLF 块解成 `top\r\nX\r\nb\r\nY\r\nend`）；**CR-only（老 Mac）行尾认不出标记**，见 §6 |
| A 模型 | A6 空片段不当改动段 | `[x]` | `MergeRangeUtil.kt:24`（`check(!isLeftEmpty \|\| !isBaseEmpty \|\| !isRightEmpty)`） | `src/mergeResolve.ts:214-217`；`tests/merge-resolve.test.mjs:343-372`（不变量一，500 组随机三侧） | 三侧同时空的段被 `add` 丢掉；随机输入下片段一律非空、不倒挂、不越界、三侧起点单调 |
| B 默认 | B1 **无冲突块不自动采纳** | `[x]` | `TextMergeChange.kt:25`（`private val resolved: BooleanArray = BooleanArray(2)` ⇒ 建出来就是未解决）、`MergeConflictModel.kt:102`（结果缓冲区先塞 **BASE**）、`MultipleFileMergeDialog.kt:297-299`（`if (model.resolveAllChangesAutomatically()) saveDocument(file)`） | `src/mergeResolve.ts:408-442`（纯函数）、`src/mergeResolveHost.ts:86-91`（一处都没合掉就 `return false`，不写盘）；`tests/merge-resolve.test.mjs:391-408` | 上游打开工具不会自己并掉任何东西，只有点动作才动；本仓同样只有两个动作入口（判据用 `readdirSync('src')` 钉住"没有第三个调用方"） |
| B 默认 | B2 **编号：模型 0 基、显示 1 基** | `[x]` | `MergeConflictModel.kt:550-552`（`mapIndexed` 发 index）、`:439-441`（`getByIndex = mergeChanges[index]` ⇒ 0 基数组下标）、`MultipleFileMergeDialog.kt:292`（给人看的那句用 `index + 1`）；旁证：`platform/diff-api/resources/messages/DiffBundle.properties:33` 的合并状态文案是"几个改动、几个冲突"两个**计数**，不是序号 | `src/mergeConflicts.ts:134`（0 基 `startLine`）、`:141`（`index + 1`）；`tests/merge-resolve.test.mjs:410-421` | 与上游同一处：内部 0 基、用户面前 1 基 ⇒ 本仓一致，未改 |
| C 差 | C1 `Diff.ApplyNonConflicts` 的粒度 | `[~]` | `MergeThreesideViewer.java:971-978`（`filter(change -> !change.isConflict())` 是**按片段**过）、`MergeConflictModel.kt:146-148` | `src/mergeResolve.ts:418-427`（`type.type !== 'conflict'` 是**按整个标记块**判）；`tests/merge-resolve.test.mjs:288-290`（钉住"隔开两行各改一处时 `true` 口径不合"） | 本仓少合不错合：半个块合掉后剩下的标记没法重新造出来（本仓的载体是工作区文本，不是结果缓冲区），故整块判；已在用例里写明钉的是"不合" |
| C 差 | C2 ApplyNonConflicts 的左/中/右三变体 | `[ ]` | `ApplyNonConflictsAction.kt:18`（`Diff.ApplyNonConflicts.Left` / `Diff.ApplyNonConflicts` / `.Right` 三个 id） | `src/mergeResolveHost.ts:43-45` 只有一个入口、`src/changesMenuActions.ts:67` 只有一行 | 上游"朝哪一侧应用不冲突更改"是分三条按钮的，本仓只移植了无后缀那条；另两条要做就得先有左右语义的落点（属新功能，不在本批改判据的范围） |
| C 差 | C3 两个动作的**启用条件** | `[~]` | `MagicResolvedConflictsAction.kt:17`（`hasAutoResolvableConflictedChanges()`）、`ApplyNonConflictsAction.kt:31`（`hasNonConflictedChanges(side)`） | `src/changesMenuActions.ts:64-67`（`available: c => Boolean(c.conflicted)`，按文件是否冲突粗判） | 上游是"内容里没有可自动合的就灰掉"，本仓现在永远可点、点完用一句话告诉用户为什么没动（`src/mergeResolveHost.ts:87-89`）⇒ 用户可见差；改它要动 `changesMenuActions.ts` 与 `SourceControl.vue`（不是 merge 前缀文件，本批没碰）→ `docs/wiring-requests-2026-10-06-merge3.md` |
| C 差 | C4 文件级 modify/delete 冲突 | `[-]` | `MergeConflictModel.kt:366`、`:383-386`（`MODIFIED_DELETED`/`DELETED_MODIFIED` 时一律不许自动解决） | — | 不适用：本仓没有读 VCS 三阶段内容的能力（只有工作区标记文本），文件级冲突类型这个输入根本拿不到 |

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `tests/merge-resolve.test.mjs` | 235 | 433 | 追加 9 条用例（四类判据 4 + 不变量 2 + 上游默认 2 + 同一行不同行数 1）；旧断言一条没删、没放松 |
| `src/mergeResolve.ts` | 450 | 450 | 三次变异注入后**全部撤回**，与开工时逐字节一致（`git diff` 里那 28+/4- 是前批 `NO_CONFLICT_PROBE` 的在途改动，不是本批） |
| `src/mergeConflicts.ts` | 151 | 151 | 同上（变异 3 已撤回） |
| `docs/batch-2026-10-06-merge3.md` | — | 新建 | 本报告 |
| `docs/wiring-requests-2026-10-06-merge3.md` | — | 新建 | C3 那条线的接线请求 |

本批**没有修改任何实现行为**：把 4 类场景 + 2 条不变量 + 随机 300 份标记文本 ×2 口径全部跑过之后，实现给出的每个结果都与上游分支表对得上（`MergeRangeUtil.kt:26-71`），没有需要就地修的缺陷；唯一的形状性偏差 C1/C3 是粒度与入口数量问题，改动面超出本批判据范围（见 §6 与 §7）。

## 3. §5 每条自查命令的前后数字

| 命令 | 前 | 后 |
|---|---|---|
| `node --test tests/merge-resolve.test.mjs tests/merge-conflicts.test.mjs` | `tests 51 / pass 51 / fail 0` | **`tests 60 / pass 60 / fail 0`** |
| `npx vue-tsc -b --force` | 全仓有在途错（12 路并行） | 本域 4 个文件（`src/mergeConflicts.ts`、`src/mergeResolve.ts`、`src/mergeResolveHost.ts`、`src/editorMergeHost.ts`）**0 错**；仓内报错文件全是别人的在途域：`src/lspProgress.ts`、`src/lspServerMessages.ts`、`src/semanticHighlighting.ts`、`src/editorSemanticField.ts`、`src/refactorPreview.ts`、`src/usageViewGrouping.ts`、`src/vcsLogGraphOptions.ts`、`src/components/PluginDialog.vue`（条数在 12–23 之间浮动，两次全量跑差一个增量构建时序，本批不据别人的在途数下结论） |
| `node --test tests/module-size.test.mjs` | 5/5 绿 | **5/5 绿**（上限一字未动；`tests/merge-resolve.test.mjs` 433 行 < 单文件上限） |
| `node .tools/find-param-props.mjs` | — | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | — | **干净：tests/*.mjs 全部是纯 JavaScript** |
| `node .tools/find-missing-ext.mjs` | — | **干净**（扫描 1289 个文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 9 / 基线 9 | 门禁红 2 条：`src/lspServerMessages.ts`、`src/semanticHighlighting.ts` —— **都不是本批新增**；本批零新增模块 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 红（别人的 docs） | `tests 11 / pass 9 / fail 2`：14 条扑空引用全在 `docs/batch-2026-10-06-projecttree.md`、`-status2.md`、`-status2defect.md`、`-welcome2.md`、`docs/wiring-requests-2026-10-06-vcs2.md` 里（`PsiUtil.java`、`SuppressIntentionAction.java`、`StructureViewFactoryImpl.java`、`EditorSettingsExternalizable.java` 四个不存在的路径）⇒ **本域与本报告的引用不含它们** |
| ctest（`native/`） | — | 未跑：本批没有动 `native/` 任何文件 |

## 4. 反向验证记录（三步：注入 → 红 → 撤 → 绿）

**变异 1**：`src/mergeResolve.ts:349` `if (type.type === 'conflict') return null` → `if (false && type.type === 'conflict') return null`
（把"真冲突就交回用户"这道闸拆掉）。`node --test tests/merge-resolve.test.mjs` ⇒ **`tests 34 / pass 21 / fail 13`**，红的是：
两侧改得不一样 / 删除与修改撞在同一段 / 基线为空两侧各插一段 / 自动解决单侧三态 / 相邻两行 / 真冲突不再无限自问 / canAutoResolve / 混合文件 / **判据一 / 判据一之二 / 判据三 / 判据四 / 上游默认一**（后 5 条是本批新判据）。原始断言输出：

```
✖ 判据一：双方改同一行 ⇒ 对齐出一个同位片段、类型 conflict、两个动作都逐字节不动文本 (5.681ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
    [
      {
  +     canBeResolved: true,
  -     canBeResolved: false,
        leftChange: true,
        rightChange: true,
        type: 'conflict'
      }
    ]
      at TestContext.<anonymous> (file:///D:/TaoCode/tests/merge-resolve.test.mjs:250:10)
ℹ tests 1 / pass 0 / fail 1
```

**变异 2**：`src/mergeResolve.ts:198` `addUnchanged` 的推进方向 `? 'left' : 'right'` → `? 'right' : 'left'`（三方对齐里"两段未更改谁先走"的规则）⇒ **`tests 34 / pass 30 / fail 4`**：只有一侧改了 / 一侧删掉另一侧没动 / 两处互不相邻的改动 / 两个开关确实不是一回事。
如实记下覆盖缺口：这一条**由既有断言钉住，本批新判据在该输入下没有红**（判据二的输入恰好对推进方向不敏感）；不变量判据也没红，因为它只保证"形状合法"，不保证"片段切得对"。

**变异 3**：`src/mergeConflicts.ts:141` `${index + 1}/${conflicts.length}` → `${index}/...`（把给用户看的编号改成 0 基）⇒ `node --test tests/merge-resolve.test.mjs tests/merge-conflicts.test.mjs` **`tests 60 / pass 58 / fail 2`**：
`✖ the status reads as 第几条/共几条 and follows the caret`、`✖ 上游默认二：模型侧序号 0 基、给人看的计数 1 基（上游同一处 index 与 index + 1）`。

**撤回复绿**：三处逐一还原后 `node --test tests/merge-resolve.test.mjs tests/merge-conflicts.test.mjs` ⇒ **`tests 60 / pass 60 / fail 0`**；
`git status --short` 显示 `src/mergeConflicts.ts` 已回到干净（不再出现在改动列表里），`src/mergeResolve.ts` 的 diff 只剩前批 `NO_CONFLICT_PROBE` 那 28+/4-。
临时探针与 fuzz 脚本（`build/probe1-4.mjs`、`build/fuzz*.mjs`）已全部删除。

## 5. 零消费方自查

本批**没有新增 `src/` 模块，也没有新增任何导出符号**（`git diff -- src` 的 hunk 全部属于前批在途改动），因此不产生新的零消费方。
新判据消费的都是既有 API：`buildMergeRanges` / `mergeLineType` / `fragmentTypes`(用例内 helper) / `tryResolveConflict` / `canAutoResolve` / `conflictSides` / `isEmptyRange` / `rangeTexts` / `resolveConflictsInText` / `parseConflicts` / `unresolvedCount` / `conflictStatus` / `nextConflict`；这些的生产消费方本来就在 `src/mergeResolveHost.ts`（两个菜单动作）、`src/mergeConflicts.ts` + `src/editorMergeHost.ts` + `CodeEditor.vue`（编辑器里的 MergeBar 与导航）。`node .tools/find-orphan-modules.mjs --gate` 的红 2 条不含本批文件（见 §3）。

## 6. 做不到 / 无法核实

1. **派单点名的三个上游文件不存在**（本批用真实文件替代并在开头留痕）：全树 grep `MergeDialogModel` 0 命中、`LineSeparatorSplitStrategy` 0 命中、`MergeChangeList` 只在 `platform/diff-impl/src/com/intellij/diff/merge/LangSpecificMergeConflictResolverWrapper.kt:82-93` 作局部变量。
2. **前批注释里一处引用行号数偏**：`src/mergeResolve.ts:31` 写「`MergeRangeUtil.kt:104` 的第 4 个参数 `canResolveLineConflict`」，实际那个探路在第 **106** 行（`:104` 落在第 3 个参数 `trueEquality` 的换行里，`platform/util/diff/src/com/intellij/diff/util/MergeRangeUtil.kt:98-106` 自查过）。**原写 :104、实际 :106**，留痕不改建（改它会牵动别人在途的 hunk，且不影响任何行为/判据）。
3. **词级那一档合不掉**：`MergeRangeUtil.kt:158-168` 的 `getWordMergeType` 探路写死 `{ false }`，上游「外层行、内层词」能把本仓判成真冲突的相邻改动合掉（本批实测：一侧删 `b`、另一侧改 `c`⇒`C`，上游片段级可合，本仓 `tryResolveConflict` 返回 null）。这是 `src/mergeResolve.ts:26-28` 已写明的口径差，本批把它钉成断言而不是改实现——改成词级是新功能。
4. **`ApplyNonConflicts` 按块而非按片段**（C1）：要把一个标记块里"只有片段级不冲突"的那几段并进去，就得在纯文本里重新造出剩下的标记，本仓没有可重造的形状（上游靠结果缓冲区 + 高亮器，见 `MergeThreesideViewer.java:971-978`）。风险大于收益，保持 `[~]`。
5. **CR-only 行尾**：`LineTokenizer.kt:47-56` 认 `\r`/`\n`/`\r\n`，本仓 `split('\n')` 不认裸 `\r` ⇒ 老 Mac 行尾的冲突文件解析出 **0 条**（本批实测）。不改成 `split(/\r\n|\r|\n/)` 的理由：那会让 `\r` 被吃掉，而未改动的上下文字节就要被重写（现在 CRLF 文件是逐字节回写，实测 `top\r\nX\r\nb\r\nY\r\nend`）。git 在工作区不会写裸 `\r`，故记为已知偏差、不动实现。
6. **块级分类把 `trueEquality` 传成 `null`**（`src/mergeResolve.ts:424`，上游 `MergeRangeUtil.kt:52` 那里是 `checkNotNull`）：只在「两侧都只改了空白」这种 git 不会产出的无意义块上标签不同（`modified` vs `inserted`/`deleted`），`take` 判定不变；随机 300 份标记文本 ×2 口径未复现任何行为差。块级 `type` 目前不外暴给任何调用方 ⇒ 没有能失败的判据可写，也不该为此新增导出。
7. **无法核实**：`MergeConflictResolutionStrategy.SEMANTIC` 那一档要 PSI（`MergeConflictModel.kt:222-225`），本仓无 PSI；`isModifyDeleteFileConflict`（`:366`、`:383-386`）要的 file 级冲突状态本仓拿不到；中文文案取的是随 IDE 发货的 `localization-zh.jar`（不在本地树），本批只核了英文 key（`platform/diff-api/resources/messages/DiffBundle.properties`）与上游 action id（`ApplyNonConflictsAction.kt:18`、`MagicResolvedConflictsAction.kt:11`）。
8. 未跑 `npm test` 全量（并行 12 路，按规约只跑本域）；未跑 ctest（没动 `native/`）。
