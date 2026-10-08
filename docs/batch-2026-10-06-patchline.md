# batch 2026-10-06 — lane `patchline`

> 骨架说明：建骨架时的占位 §0 表（写作「待核」）已被下面的正式 §0 取代；
> 留痕：接手瞬间的实况数字在原占位行里写的是「判据测试实况已绿，性质待写」，正式结论见 §0/§1。

## §1 接手实况

判据真实文件名：`tests/patch-hunk-counts.test.mjs`（派单写 `tests/patch-hunk-counts.test.mjs`，一致）。

实况（接手时未改任何文件，`node --test tests/patch-hunk-counts.test.mjs`）：

```
tests 16 · pass 16 · fail 0 · cancelled 0 · skipped 0 · todo 0 · duration_ms 7852.74
```

⇒ **派单里说的「2 条真红」已经不存在了**（本项目「红名单过期」发生过多次，这次又是）。
其中正对着我这条 lane 的那一条 —— `应用侧核对：手构的块「声明行数 ≠ 正文行数」必须拒绝，
偏移搜索那条路也不许救（上游 PlainSimplePatchApplier:117-122）`（`tests/patch-hunk-counts.test.mjs:357-371`）——
当前是 **绿** 的，实现确实落了，不是断言被放松：

| 落点 | 本仓 `src/patchApply.ts` | 说明 |
| --- | --- | --- |
| 数正文两侧行数 | `:245-250` `countsOfSide()` | 上游 `PatchHunkUtil.getRange` 的数法（before 跳过 ADD、after 跳过 REMOVE） |
| 账目比对 + 文案 | `:252-267` `hunkCountsMismatch()` | 声明原文/新文行数 ≠ 正文实际 ⇒ 返回中文理由 |
| 精确应用侧的闸 | `:290-291`（`applyHunksToText` 循环体第一句） | 账目不对 ⇒ 整块失败，**不进入**后续上下文核对 |
| 偏移搜索侧的闸 | `:369-372`（`applyHunksFlexible` 进入两级应用**之前**先整批核账） | 「偏移只救行号偏了，不救行数对不上」 |

⇒ 本域主项**无工作可做**，按派单改做同一族里的另一个真缺口（见 §3）。

## §2 上游核对

派单给的坐标我亲自开文件核实过，**路径要订正**（留痕）：

- 原写 `PlainSimplePatchApplier.java:117-122`（未给目录）。
- 实际唯一存在的那份：`platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/PlainSimplePatchApplier.java`
  （参考树 `find -iname` 只命中这一个；仓内 `third_party/intellij-community` 那份是坏树，未使用）。
- **行号未漂**，`:114-115` 数、`:117-122` 比：

```java
114    int baseCount = ContainerUtil.count(hunk.getLines(), patchLine -> patchLine.getType() != PatchLine.Type.ADD);
115    int patchedCount = ContainerUtil.count(hunk.getLines(), patchLine -> patchLine.getType() != PatchLine.Type.REMOVE);
116
117    if (baseCount != baseEnd - baseStart) {
118      error(VcsBundle.message("patch.simple.apply.hunk.base.body.error", baseEnd - baseStart, baseCount));
119    }
120    if (patchedCount != patchedEnd - patchedStart) {
121      error(VcsBundle.message("patch.simple.apply.hunk.patched.body.error", patchedEnd - patchedStart, patchedCount));
122    }
```

- `error(...)` 抛 `PatchApplyException`（`:171-179`），`execute()` 在 `:61-64` catch 后 `return null` ⇒
  上游的语义确实是「**拒绝整份应用**」，不是「按正文继续」。本仓等价物返回 `{ ok: false, hunk, reason }`。
- 这道闸在上游的**位置**：`checkContextLines` 里排在「行号起点核对」（`:104-112`）之后、
  「逐行内容核对」（`:124-134`）之前 —— 本仓把它排在**最前面**（`:290`、`:369`），
  这样偏移搜索那条路也拿不到未经核账的块；对判定结果没有差别（任一条 `error` 都整块失败）。
- 文案键 `patch.simple.apply.hunk.base.body.error` / `.patched.body.error` 在
  `platform/vcs-api/vcs-api-core/resources/messages/VcsBundle.properties` —— **中文措辞无法核实**
  （本地参考树没有 zh 语言包），本仓给的中文是「块头声明原文 N 行，正文实际 M 行」的**直译**，见 §7。

## §0 结论表（本报告按派单要求**逐块追加**落盘，故正式 §0 排在 §2 之后；建骨架时的占位 §0 已删）

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点文件:行号 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| 补丁应用 | 块头声明行数 ≠ 正文实际行数 ⇒ **精确应用**必须拒绝 | `[x]` 已做（**接手时已绿，非本批所做**） | `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/PlainSimplePatchApplier.java:114-122` | `src/patchApply.ts:245-250`（数）、`:252-267`（比）、`:290-291`（闸） | 判据 `tests/patch-hunk-counts.test.mjs:357-371` 接手时 16/16 全绿；派单说的「2 条真红」是过期红名单 |
| 补丁应用 | 同一道账目闸 ⇒ **偏移搜索**不许救回来 | `[x]` 已做（接手时已绿） | 同上 `:117-122` + `apply/GenericPatchApplier.java:74-86`（偏移只在 `PlainSimplePatchApplier` 返回 null 之后才走） | `src/patchApply.ts:369-372`（两级合流前先整批核账） | 偏移只救「行号偏了」，不救「行数对不上」 |
| 补丁应用 | 同一道账目闸 ⇒ **「已应用」判定**也不许放行 | `[x]` **本批所做** | `apply/GenericPatchApplier.java:121-122`（FAILURE 排在 `:124`/`:134` 的 ALREADY_APPLIED **之前**）、`:186` + `:1241-1242`（`myNotExact` 的落位算的就是块头声明的两个数）、`:82`⇒`apply/ApplyTextFilePatch.java:55` FAILURE | `src/patchApply.ts:347`（`isAlreadyApplied` 第一句）、函数上方注 `:337-344` | 原实现只逐行比正文、不核账 ⇒ 半截补丁被判 `alreadyApplied` ⇒ `plan.ok = true` ⇒ 宿主那条「计划不 ok 一个字节都不写」（`src/patchApplyHost.ts:64`）被绕过；改名档更产出 `action:'rename'` + 没打过补丁的原文 |
| 补丁生成 | `generateUnifiedDiff` 的块头按正文实际行数写 | `[x]` 已做（接手时已绿） | `patch/UnifiedDiffWriter.java:220-225`、`patch/PatchHunkUtil.kt:10-30` | `src/diffText.ts`（`generateUnifiedDiff`） | 判据 `tests/patch-hunk-counts.test.mjs:50-74` |
| 补丁读取 | 块内容按 `@@` 声明的行数收（凑满就退回按表头判） | `[x]` 已做（接手时已绿） | `patch/PatchReader.java:335-392`（`:363-364` 声明跨度、`:375` 收满判定、`:376-379` 退回） | `src/patchApply.ts:163-176`（收满判定与退回） | 上游读取侧**不**因行数不符报错（`:389` 直接 return 短收的块），拒绝发生在应用侧 `PlainSimplePatchApplier:117-122` ⇒ 本仓同款分工，未额外收紧 |
| 补丁应用 | 新增文件（`kind:'add'`）的 create 内容 | `[-]` 不加账目闸：有具体理由 | `apply/ApplyTextFilePatch.java:84`（`myPatch.getSingleHunkPatchText()`） | `src/patchApply.ts:473`（`joinHunkLines(afterLines)`） | 上游新增档**不走** applier（`TriggerAdditionOrDeletion`/`applyCreate` 直接落文本），本来就按正文取、不比块头 ⇒ 本仓保持同形，硬加闸就是超出上游 |

## §3 落盘

改动文件清单（`wc -l` 前后）：

| 文件 | 前 | 后 | 本批净增 | 内容 |
| --- | --- | --- | --- | --- |
| `D:\TaoCode\src\patchApply.ts` | 512 | 525 | +13 | 1 行代码（`isAlreadyApplied` 的账目闸）+ 12 行注释（文件头那条 bullet 的 4 行补充 + 函数 docstring 的 8 行） |
| `D:\TaoCode\tests\patch-hunk-counts.test.mjs` | 474 | 529 | +55 | 2 条判据用例 + import 里加 `isAlreadyApplied`（**没有删改任何既有断言**） |

代码这一笔（全文，就这一行）：

```ts
export function isAlreadyApplied(text: string, hunks: readonly PatchHunk[]): boolean {
  for (const hunk of hunks) if (hunkCountsMismatch(hunk)) return false
```

`hunkCountsMismatch` 是既有函数（`:252-267`），没有新符号、没有新文件、没有新设置键 ⇒ 不涉及「旧存档缺键」那条。

> `git diff --stat` 对这两个文件报的是 +89 / +335，因为工作区里这两个文件**本批开工前就已被别的批改过且未提交**
> （`src/patchApply.ts` mtime 13:50、测试文件 13:36，开工时 16:10）；上面「本批净增」是按前后 `wc -l` 实算，
> 我的两次编辑只碰了 `isAlreadyApplied` 与文件头 bullet，没重排任何别人的代码。

## §4 判据与反向验证

新增判据（`tests/patch-hunk-counts.test.mjs` 末尾两条）：

1. `已应用判定：账目不符的块不许被判成「已经应用」（上游 GenericPatchApplier:121-122 的 FAILURE 优先）`
   —— 原文侧不符 / 新文侧不符 ⇒ `false`；**反向对照**：账目对且内容已是新文 ⇒ 仍 `true`（钉的是账目，不是这条功能）。
2. `执行计划：半截补丁（块头声明 3 行 / 正文 1 行）⇒ 整批不许落盘，改名那一档不许写出未打补丁的内容`
   —— 走真实输入路径（`parseUnifiedPatch` 吃截断补丁文本，不是手构块），要求
   `status:'failure'` + `plan.ok === false` + 理由含「块头声明原文 3 行，正文实际 1 行」；
   改名档额外要求 `action:'none'` 且 `content === null`（**不许把没打补丁的原文写去新路径**）；
   **反向对照**：账目对的补丁 × 文件已是新文 ⇒ 仍 `alreadyApplied` 且 `plan.ok === true`。

三步记录（前缀 = 派单指定的本 lane 代号大写形式，即文件名里那个 `patchline`；为避免全仓 grep 误报，
本文件里**不**把这个大写记号原样写出来，注入的注释行写作 `<前缀>-INJECT …`）：

| 步骤 | 动作 | 结果 |
| --- | --- | --- |
| ① 判据先行 | 只加测试、不动实现 | `tests 18 · pass 16 · fail 2` —— 正是那两条新用例（另 16 条仍绿） |
| ② 落实现 | 加那 1 行闸 | `tests 18 · pass 18 · fail 0`；`tests/patch-apply.test.mjs + tests/patch-export.test.mjs`：`tests 26 · pass 26 · fail 0` |
| ③ 反向验证注入 | 把闸换成一行 `<前缀>-INJECT …` 注释 + `if (hunks.length < 0) return false` | `tests 18 · pass 16 · fail 2`（**摘掉闸就红 ⇒ 这两条判据有牙**）；同一次注入下 `tests/patch-apply.test.mjs` 仍 `21/21` 绿 ⇒ 红的确实只是本批新增的账目判据 |
| ④ 还原核验 | `cp build/patchline-after-fix.tmp src/patchApply.ts` | `cmp` ⇒ **identical**；`sha1sum` 双向都是 `9eed437ef6c6a9e6ac20b1d66f85c8806dfd761f`（与「落实现后」的快照同一个值）；复跑 `tests 18 · pass 18 · fail 0` |
| ⑤ 前缀清零 | 全仓 `grep -rn`（大写前缀记号，排除 `node_modules`；临时文件当时已删） | **代码与测试里 0 命中**；本报告原本写过 3 处该记号（叙述注入用），已改写作 `<前缀>-INJECT` 形式 ⇒ 现在**全仓 0 命中**（连文档也不算在内） |

临时件 `build/patchline-after-fix.tmp`、`build/patchline-baseline.sha1`、`build/tsconfig.patchline.json` 收工全部删除。

## §5 门禁原始数字

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 本域测试全量（落实现后首跑） | `node --test tests/patch*.test.mjs tests/diff*.test.mjs tests/module-size.test.mjs` | `tests 223 · pass 223 · fail 0 · skipped 0`（含 `tests/patch-hunk-counts.test.mjs` 18/18） |
| 同上（**注入还原后复跑**，收工前最后一次） | 同上 | `tests 223 · pass 223 · fail 0 · skipped 0` —— 与前一次同数 |
| 模块行数 | `node --test tests/module-size.test.mjs` | 绿（上限未动）；`src/patchApply.ts` 525 行 < 900 |
| 孤儿模块 | `node .tools/find-orphan-modules.mjs --gate` | 门禁绿：已登记孤儿 6 / 基线 8 · **新增 0** · 本轮清掉 2（`src/jarRun.ts`、`src/runAnythingContext.ts`，**不是本域**）⇒ 本批没造新出口，`isAlreadyApplied` 早已被 `planPatchApplication` 两处消费（`:460`、`:507`） |
| 漏扩展名 | `node .tools/find-missing-ext.mjs` | 扫描 1375 个文件 ⇒ 干净 |
| 参数属性 | `node .tools/find-param-props.mjs` | 共 0 处 |
| mjs 里的 TS 语法 | `node .tools/find-ts-in-mjs.mjs` | 干净（新增用例只用行注释、无非空断言） |
| 隔离类型检查 | `npx tsc -p build/tsconfig.patchline.json --noEmit`（files 只含 `src/patchApply.ts`/`src/patchFuzzy.ts`/`src/patchExport.ts`/`src/diffText.ts`，`strict` + `verbatimModuleSyntax` + `allowImportingTsExtensions`） | `grep -c "error TS"` = **0**，EXIT=0；临时 tsconfig 跑完已删。**没拿并发期全仓 `vue-tsc -b` 的 0 错当证据** |
| 引用门 | `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | `tests 11 · pass 8 · fail 3` —— **三条红都不在本域**，逐条列名：`docs/batch-2026-10-06-findrep2.md :: …ConsoleViewImpl.kt:999999-999999`（别批的占位行号）、`src/commitChecks.ts`、`src/components/ProblemsPanel.vue` ×2、`src/runStartupFocus.ts` 四条 `moved`。本批两份文件 0 命中 ⇒ 属别的 lane 名下（`src/commit*`、`src/run*` 在我的并发黑名单里），本批不动、只如实登记 |
| native | 未跑 ctest：本批**没有改 `native/`** 一个字 |

## §6 接线请求

见 `docs/wiring-requests-2026-10-06-patchline.md`：本批**不需要**新接线（`isAlreadyApplied` 早已在既有消费链里，
→ `planPatchApplication` → `src/patchApplyHost.ts:64` → `SourceControl.vue`）。
文件里只剩一条**账本订正请求**（`docs/inventory/**` 是保留文件，本批只读）。

## §7 无法核实

1. **上游中文文案**：`patch.simple.apply.hunk.base.body.error` / `patch.simple.apply.hunk.patched.body.error`
   的中文措辞**无法核实** —— 参考树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master` 里
   只有英文 `VcsBundle.properties`，没有 zh 语言包。本仓给的「块头声明原文 N 行，正文实际 M 行」
   是按英文键名 + 参数顺序（先声明数、后实际数）的**直译**，沿用同域既有写法，不是上游原文。
2. **派单给的上游目录**：`PlainSimplePatchApplier.java` 派单只写了文件名。参考树 `find -iname` 只命中
   `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/apply/` 这一份；仓内
   `third_party/intellij-community` 是坏树（派单已声明禁用），未使用。行号 `:117-122` **未漂**。
3. **`GenericPatchApplier` 的 ALREADY_APPLIED 精确判定式**：`apply/GenericPatchApplier.java:633`
   `list.size() == (range.getLength() + 1)` 里的 `list` 与 `range` 我读到了构造点（`:1020-1023`
   `putCutIntoTransformations(new TextRange(idx, idx + cnt - 1), originalHunk, new MyAppliedData(splitHunk.getAfterAll(), …))`），
   但「声明跨度 vs 正文」在那条路上是**间接**约束（经 `SplitHunk.read` 的落位算术）；
   本批据以下游链条下结论：`myNotExact` 非空 ⇒ `getStatus()` 先给 FAILURE（`:121-122`）⇒ `execute()` false（`:225`/`:235`）
   ⇒ `apply()` null（`:82`）⇒ `ApplyTextFilePatch` FAILURE（`:55`）。
   这条链是本批改动的**充分**依据，但「上游对 ALREADY_APPLIED 是否还另有别的直接核账点」我**没有逐行穷尽**（该文件 1300+ 行）。
4. **判据测试的 git 侧**：`SHAPES` 那批用例依赖本机 `git.exe`（实测 2.55.0）；无 git 时它们 `skip` 而非红，
   本批两条新用例**不依赖 git**（纯账目逻辑），所以「18/18」这个数在任何机器上都应成立。
