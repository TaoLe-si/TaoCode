# 批次报告 2026-10-06 · lensgate（K-4：Code Vision 两层过滤与每行条数上限的消费侧）

派单：落 `docs/wiring-requests-2026-10-06-setkeys.md` 的 **K-4**。
上游唯一真源：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`，
下面每一条上游坐标都亲自打开过那一行（未上网、未凭记忆）。

## 1. 判词表（族 / 项 / 判定 / 上游 / 本仓落点 / 一句话）

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|---|
| K-4① | 第一层「档位闸」在渲染侧有调用点 | `[x]` **已闭环（并行 lane 先落，本批未重做）** | `platform/lang-impl/src/com/intellij/codeInsight/hints/codeVision/CodeVisionPass.kt:113-117`；`platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionHost.kt:341`、`:348-350` | `src/codeLensExtension.ts:260` | 请求原文写「`shouldShowCodeVisionEntry` 只有 import、没有调用点」——**实际工作区里那一行已经在了**（留痕：原写 X、实际 Y）。判据在 `tests/code-lens-grouping.test.mjs:148-169`（本轮 M5 反向验证确认它有牙）。 |
| K-4② | 运行表补 `visibleEntries`（出厂 5） | `[x]` 本批落 | `platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt:38-39` | `src/codeLensSettings.ts:83`、`:90` | 上游那两个 `visibleMetrics*Count = 5` 在本仓合成一档（条目只画在行上方）。 |
| K-4③ | 第二层的**纯判定** | `[x]` 本批落 | 同上 `:140-147`（`getAnchorLimit`）＋ `CodeVisionHost.kt:287-288`、`:85` | `src/codeLensSettings.ts:158-161` `codeVisionVisibleEntryLimit()` | 不碰 DOM、不碰 CodeMirror；坏值回出厂 5 的形状照 `?: defaultVisibleLenses`。 |
| K-4④ | 渲染侧吃设置里的上限（不再吃常量） | `[x]` 本批落 | `CodeVisionListData.kt:46`（`maxVisibleLensCount[anchor]`） | `src/codeLensExtension.ts:266` | `groupAnchoredLenses(visible, codeVisionVisibleEntryLimit())`；顺序仍是**闸在前、上限在后**。 |
| K-4⑤ | 截断形状与上游一致（前缀、不改序） | `[x]` 已闭环（`src/codeLens.ts:165` 的 `slice(0, cap)` 早就同形） | `CodeVisionListData.kt:45-57`（`subList(0, minOf(count, size))`） | `src/codeLens.ts:149-150`、`:165` | 本批没动 `codeLens.ts`（别人名下），只把**值**送进去；新判据逐字钉 `['a0','a1','a2']`。 |
| K-4⑥ | 进出口带上这一键 | `[x]` 本批落 | `CodeVisionSettings.kt:14`（`PersistentStateComponent`）、`:38-39` | `src/codeLensSettings.ts:210-219`（`restoreCodeVisionSettings`）、`:222-229`（`codeVisionSettingsPatch`） | 只认正整数；缺键/坏值不动表里的出厂 5（不按字段数量判损坏）。 |
| K-4⑦ | 改了设置立刻按新档重画 | `[x]` 本批落（请求没点名，上游有） | `CodeVisionSettings.kt:59`、`:120`；`CodeVisionHost.kt:298-300` | `src/codeLensExtension.ts:353`（`watch(codeVisionSettings, applyGateChange)`）、`:443`（`dispose()` 里停） | 没有这一拍，设置页改数字要等下一次刷新才见效。 |
| K-4⑧ | 启动读回（`restoreCodeVisionSettings` 的调用方） | `[ ]` **未闭环：在别人名下** | `CodeVisionSettings.kt:55-60`、`:69-81` | 目标行 `src/workspaceLifecycle.ts:147` 之后 | 见 `docs/wiring-requests-2026-10-06-lensgate.md` 的 L-1/L-2。**订正**：K-4 原文写的「`src/settingsPersistence.ts:86` 之后 = 启动读回」其实是保存/应用路径，真正的读盘点在 `workspaceLifecycle.ts:147`。 |
| K-4⑨ | 设置页把草稿值刷进运行时表 | `[ ]` **未闭环：在别人名下** | `CodeVisionGlobalSettingsProvider.kt:67`（`reset()` 灌回控件） | 目标行 `src/components/CodeVisionSettingsPage.vue:61-64`、`:66` | L-3 给可照抄的一行＋watch 取值串。 |
| K-4⑩ | 盘上那一份（键 + 界） | `[x]` 已闭环（setkeys 本批已落，非我） | `CodeVisionGlobalSettingsProvider.kt:43`（`spinner(1..10, 1)`） | `native/settings_schema.cpp:414-417`、`native/settings_editor_keys.hpp:56-62`、`src/settingsModel.ts:445-451` | 界 1..10 已在原生校验里钉死 ⇒ 我的读侧不必再夹一次。 |
| K-4⑪ | 右键隐藏写回盘 | `[-]` **登记不催**：调用方在 `src/App.vue`（appvue 独占） | `ProjectCodeVisionModelImpl.kt:49-66` | `src/codeLensSettings.ts:222-229`（出口已备好，零调用方） | L-4。 |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `src/codeLensExtension.ts` | 428 | 445 | 我名下：消费第二层 + 设置变更重画 |
| `src/codeLensSettings.ts` | 185 | 229 | 表字段 + 纯判定 + 进出口 |
| `tests/code-lens-grouping.test.mjs` | 177 | 185 | 只重写 1 条接线断言（§5 留痕），其余 11 条一字未动 |
| `tests/code-vision-anchor-limit.test.mjs` | — | 192 | 新建 10 条判据 |
| `docs/wiring-requests-2026-10-06-lensgate.md` | — | 134 | L-1 ~ L-4 |
| `docs/batch-2026-10-06-lensgate.md` | — | 本文件 | 报告 |

## 3. 上游两层规则的原文（自证，不是转述）

```
CodeVisionSettings.kt:38    var visibleMetricsAboveDeclarationCount: Int = 5
CodeVisionSettings.kt:39    var visibleMetricsNextToDeclarationCount: Int = 5
CodeVisionSettings.kt:96-101 fun isProviderEnabled(id) = disabled→false / enabled→true / 其余按出厂默认
CodeVisionSettings.kt:140-147 getAnchorLimit(position) → Top 档读 :38
CodeVisionHost.kt:287-288   viewService.setPerAnchorLimits(... (lifeSettingModel.getAnchorLimit(it) ?: defaultVisibleLenses))
CodeVisionListData.kt:46    val count = projectModel.maxVisibleLensCount[anchor]
CodeVisionListData.kt:55-56 val visibleCount = minOf(count, anchoredLens.size); visibleLens.addAll(anchoredLens.subList(0, visibleCount))
CodeVisionPass.kt:114/117   if (!settings.codeVisionEnabled) return … / .filter { settings.isProviderEnabled(it.groupId) }
CodeVisionHost.kt:298-300   visibleMetricsAboveDeclarationCount.advise { invalidateProviderSignal.fire(...) }
```

⇒ 本仓等价物：`src/codeLensExtension.ts:260`（第一层）＋ `:266`（第二层）＋ `src/codeLensSettings.ts:158-161`（解析）。

## 4. §5 每条自查命令的**前后数字**

| 命令 | 前（开工时） | 后（收工时） |
|---|---|---|
| `node --test tests/code-vision-anchor-limit.test.mjs` | 文件不存在 | **10/10 绿** |
| `node --test tests/code-lens-grouping.test.mjs` | 12 条（12 绿） | **12/12 绿**（含重写的那条接线断言） |
| 本域合跑（code-lens×5 + code-vision×3 + cv-local-vision + 新文件） | 77 条（改动前基线 77/77） | **77/77 绿** |
| `npx vue-tsc -b --force` | 全树 1 条错：`src/refactorPreview.ts(207,7)`（**别人的在途错**，未动） | 全树 **0 错**；我名下文件两次都是 0 错 |
| `node --test tests/module-size.test.mjs` | 4/5，红的是 `src/bridge.ts 911 行 > 上限 905`（**别人名下保留文件**，未动、未抬上限） | 5/5 绿（他人已修）。我名下的 `codeLensExtension.ts` 445 行，登记上限 600（`tests/module-size.test.mjs:215` 那一组）未动 |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（新 `.mjs` 里无 TS 语法） |
| `node .tools/find-missing-ext.mjs` | 1303 个文件干净 | **1303 个文件干净** |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 8 / 新增 0 | **基线 8 / 新增 0 / 本轮清掉 0 ⇒ 门禁绿** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11/11 | **11/11**（中途一次 8/11，红在别人的 `docs/batch-2026-10-06-tw3.md`，与本批无关，随后他人自行修好） |
| `npm test` | **没跑**（12 路并行，按规约只跑自己域） | — |

## 5. 断言重写与反向验证记录

**唯一一处动既有断言**（`tests/code-lens-grouping.test.mjs` 的「接线：CodeMirror 落点按锚点行渲染…」）：

- 留痕：原写 `extension.indexOf('groupAnchoredLenses(visible)')`（钉**不带上限**的字面形状），实际与上游冲突 ——
  上游那一步的上限来自设置（`CodeVisionListData.kt:46` → `CodeVisionHost.kt:287-288` → `CodeVisionSettings.kt:140-147`），
  把常量形状钉死就等于把设置页那一格钉成死旋钮。改后**变严**（`assert.ok` 由 2 条增至 3 条）：
  正则要求第二参必须是 `codeVisionVisibleEntryLimit()`，并新增一条禁止再出现 `groupAnchoredLenses(visible)`。
  `deepEqual` / 数字下限一条没松；同文件其余 11 条逐字未动。

反向验证（注入违规 → 红 → 撤回 → 绿）。每次跑
`node --test tests/code-vision-anchor-limit.test.mjs tests/code-lens-grouping.test.mjs`（22 条）：

| # | 注入 | 红数 | 红的用例 |
|---|---|---|---|
| M1 | `:266` 退回 `groupAnchoredLenses(visible)`（上限写死成常量） | **6** | 接线形状 + 同一锚点 8 条上限 3 + 上限 1/8/5 + 每锚点≠每行 + 上限 2 时族不占槽 + 改上限立刻重画 |
| M2 | 把闸挪到归并**之后**（`groupAnchoredLenses(lenses, …)`） | **5** | 接线形状 + 关掉某一组只少那一组 + 闸在归并之前 + 上限 2 时族不占槽 + 关掉一条都不画 |
| M3 | 删掉 `watch(codeVisionSettings, applyGateChange)` | **1** | 改小/改大上限都不必等下一次刷新 |
| M4 | 纯判定改成「永远返回出厂 5」但**保留调用点形状**（专打只改形状不改行为的软实现） | **6** | 上限读表里 3/1/10 + 同一锚点 8 条上限 3 + 上限 1/8/5 + 每锚点≠每行 + 上限 2 时族不占槽 + 改上限立刻重画 |
| M5 | 两层闸 `&&` → `||`（档位关仍渲染） | **6** | 总闸关掉整族不画 + 关掉某一组只少那一组 + 闸在归并之前 + 上限 2 时族不占槽 + 关掉一条都不画 + 改上限立刻重画 |

原始输出片段（M4，最能说明"不是只加不减"）：

```
✖ 上限读设置表里的值：3 就吐 3、1 就吐 1、10 就吐 10（设置页那一格真的在喂渲染侧） (0.999ms)
✖ 同一锚点 8 条、上限 3 ⇒ 只画前三条（上游 subList(0, minOf(count, size)) 的前缀形状） (6.5412ms)
✖ 上限 1 ⇒ 只剩第一条；上限 8 ⇒ 八条全画；上限 5（出厂）⇒ 前五条（不是只加不减的软断言） (1.1737ms)
✖ 上限是**每锚点**而不是每编辑器行：同一行两个锚点各 3 条、上限 2 ⇒ 两行各画 2 (1.4896ms)
✖ 上限调到 2 时关掉的族依旧不占槽位（闸在前、上限在后，新上限下顺序仍成立） (0.9915ms)
✖ 改小/改大上限都不必等下一次刷新：渲染通道按新档重建装饰集 (2.2887ms)
ℹ tests 22  ℹ pass 16  ℹ fail 6
```

M5 的原始输出（档位那一层的牙）：

```
✖ 总闸关掉 ⇒ 整族一条都不画（上游收集入口的 return emptyList） (2.0599ms)
✖ 关掉某一组只少那一组：服务端 lens 归并键是 LspCodeVisionProvider (0.9173ms)
✖ 闸在归并**之前**：关掉的组不占 defaultVisibleLenses=5 的槽位 (1.2914ms)
✖ 上限调到 2 时关掉的族依旧不占槽位（闸在前、上限在后，新上限下顺序仍成立） (1.6229ms)
✖ 关掉的族一条都不画：上限调到 10 也不会因为"还有空槽位"就漏出来 (0.9063ms)
✖ 改小/改大上限都不必等下一次刷新：渲染通道按新档重建装饰集 (2.4504ms)
ℹ tests 22  ℹ pass 16  ℹ fail 6
```

撤回全部注入后：`ℹ tests 77  ℹ pass 77  ℹ fail 0`（九文件合跑）。
临时文件：`build/lensgate-tsc.txt`（已 gitignore 目录内，收工删除）。

## 6. 零消费方自查结论

- 新增导出仅 `codeVisionVisibleEntryLimit`（`src/codeLensSettings.ts:158-161`）：生产消费点在
  `src/codeLensExtension.ts:266`，测试消费点在两个 lens 测试文件，第二个消费点已写进 L-3 ⇒ **不是死模块**。
- 新字段 `visibleEntries` 由同一个纯判定读，不单独出口。
- `codeVisionSettingsPatch()` 仍是零生产调用方（落单前就如此），本批只把第四把键带进返回值 ⇒ 登记 L-4。
- `node .tools/find-orphan-modules.mjs --gate`：基线 8 / 新增 0 / 本轮清掉 0，门禁绿。

## 7. 做不到 / 无法核实

1. **`CodeVisionAnchorKind.Right`（"旁边"那一档）无对应渲染**：本仓条目只有行上方块装饰
   （`src/codeLensExtension.ts:272` 的 `Decoration.widget({ block: true, side: -1 })`）。
   上游两把键（`CodeVisionSettings.kt:38-39`）在本仓合成一把 `codeVisionVisibleEntries`，不是漏做：
   造一把没有渲染吃得到的键就是假控件。
2. **「更多…」popup 没落**：上游要 `editor.codeVision.more.inlay` 为真才画那一条
   （`CodeVisionListData.kt:60`），registry 缺省 false（本仓登记在 `src/codeLens.ts:124-125`）⇒ 宁可不出现。
3. **无法核实**：派单里「按 inlay hints 档位过滤」若指「总闸 + 组闸之外还有第三层按 presentation 的渲染过滤」，
   我在本地树里没找到第三层 —— `CodeVisionInlaySettingProvider.kt:14-21` 只把组模型挂进设置页
   （`createModels`），渲染侧就是那两层（`CodeVisionPass.kt:114` 与 `:117`）。所以本仓只落两层，没编第三条。
4. **L-1 ~ L-3 的调用方都在别人名下**（`src/workspaceLifecycle.ts`、`src/settingsPersistence.ts`、
   `src/components/CodeVisionSettingsPage.vue`）⇒ 只给可照抄片段。后果写清楚：
   这三行不接，盘上的 `codeVisionVisibleEntries` 取不到运行时表 ⇒ 渲染永远吃出厂 5（与落单前行为一致，不是回归，但链路未闭环）。
5. `native/settings_editor_keys.hpp:56-62` 的界校验属于 ctest 域，本批没动 `native/` ⇒ **未跑 ctest**（没有需要跑的原生改动）。

## 8. 需要主代理接的线

全部单放在 `docs/wiring-requests-2026-10-06-lensgate.md`：L-1（启动读回，必须）、L-2（保存/应用后重灌）、
L-3（设置页 `syncRuntime()` 一行，setkeys 在 K-4 里自己承诺过）、L-4（右键隐藏写回盘，登记不催）。
L-1 与 L-3 **任缺其一**，本批落的第二层就只能取出厂值。
