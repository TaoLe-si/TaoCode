# batch-2026-10-06-recentdirclose —— 把死 lane（recentdir）留下的半截「最近目录缓存」收口

上游参考树 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（唯一可用；
仓内 `third_party/intellij-community` 是坏树，未使用）。
**本批每一条坐标都是自己 `find` / `grep -n` / `awk NR` 开文件数的**；别人写的坐标（含死 lane 自己写的）逐条复核，
错的按上游订正并留痕（§5）。

## 0. 一句话结论

判据文件 `tests/run-anything-recent-dir-cache.test.mjs` 从 **7 tests / 0 pass / 7 fail** 变成 **8 tests / 8 pass / 0 fail**
（原有 7 条一条没放松、一条没注释、没改成 `includes`；本批**新增**第 8 条钉运行时那半截，见 §3）。
红的原因不是"功能没写"，是死 lane 在实现里留了一处**未还原的反向验证注入**：
`src/runAnythingRecentDirectories.ts` 的读出归一函数把「非数组」当损坏 `throw`，而它自己的文件头与本仓硬教训都要求
"缺键/坏形状补默认、不抛错、不判损坏"。

## 1. 主代理现场复核（三条都对，第二条的行文要补一句）

| 主代理给的现场 | 复核结果 |
| --- | --- |
| 7 tests / 0 pass / 7 fail | **成立**。7 条红的栈顶全在同一点：`normalizeRecentDirectories` 抛 `Error: 注入的违规：坏形状当成损坏（应当补默认而不是抛错）`，抛点在 `src/runAnythingRecentDirectories.ts:51`（改前），经 `importRunAnythingRecentDirectories` → 判据夹具的 `freshCache()`（每条测试第一件事就是清一次缓存）⇒ 一条测试都跑不下去 |
| 「实现把缺键/null/非数组/条目形状不对/条数超上限当损坏并抛错」 | **成立，且不止一处**：① `if (!Array.isArray(record)) throw …`（抛错）；② 同函数尾部还挂着 `.slice(0, 5)` —— 读出侧截断。②与"条数上限只管入栈、读出侧整份列"（`RunAnythingChooseContextAction.kt:238` 直接 `state.paths.map { RecentDirectoryContext(it) }`）相反，也被判据第 2 条钉着（存 7 条要读回 7 条） |
| 「入栈规则应复用 `pushRecentDirectory`」 | **早就是复用的**：`src/runAnythingContext.ts:210-219` 那份是唯一实现，消费点在 `src/runAnythingRecentDirectories.ts:106`（`pushRecentDirectory(stored.value, picked)`）⇒ 不是待办，只是"红着看不出来"。判据第 6 条钉它 |
| 「起始目录 = 项目根」 | 已落：`importRunAnythingRecentDirectories(record, root)` 记 `projectRoot`，`recentDirectoryChooserStart()` 回它；`src/workspaceLifecycle.ts:326` 传的第二个实参就是 `result.root`（`native/workspace.cpp:705` 的 `fs::absolute` ⇒ **绝对路径**，宿主 `native/dialogs.cpp:35-42` 拿它当起始目录，空/不存在时 best-effort 忽略） |
| 「缓存要灌进弹层看的那一份」 | 已落：`src/components/RunAnythingDialog.vue:87` `recentDirectories: recentDirectoryPaths.value`（同一个模块级单例，不是再装配一份） |
| 「选了最近目录后 `runCommand` 的 `cwd` 要是那条绝对路径」 | 已落：`contextPath` 的 `recentDirectory` 一支回 `context.value`（`src/runAnythingContext.ts:82`）→ `src/components/RunAnythingDialog.vue:153-154` 带 `cwd` 发出 → `src/App.vue:2667` → `src/runActions.ts:491`/`:515` → `native/run_host.cpp:258-261`（绝对路径原样当工作目录）。**真链路实测见 §7** |

⇒ 死 lane 的形态是 §「注入未还原 + 判据全红的半截实现」：功能骨架其实齐了，被一处抛错注入挡死，所以什么都看不出来。

## 2. 修了什么（唯一的实现改动）

`src/runAnythingRecentDirectories.ts` 的读出归一（现在 `:51-55`）：

```ts
export function normalizeRecentDirectories(record: unknown): string[] {
  if (!Array.isArray(record)) return []
  // 不 slice(0, 上限)：条数上限只管**入栈**那一步（`:139-144`），读出侧整份列（`:238`）。
  return record.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}
```

为什么"补默认而不是抛错"是唯一正确答案（逐条开过上游与本仓盘）：
- 上游那份状态是 `RunAnythingContextRecentDirectoryCache.kt:26-29` 的 `State.paths`（只有这一个字段），
  读侧 `RunAnythingChooseContextAction.kt:238` **不截断、不去重、不判形状**；上限只在入栈那一步
  （同文件 `:141-143` 的 `if (size >= Registry.intValue(...)) removeAt(0)`），注册表默认 5
  （`platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:170-171` `defaultValue="5"`）。
- 本仓落点是 `projects.json` → `perProject[项目根].runAnythingRecentPaths`：
  读 `native/projects.cpp:770-784`（`project_defaults()` + `fill_defaults` ⇒ **缺键补默认**），
  写 `:820-844`（`merge_patch` ⇒ 只交这一个键不动别家）。
  原生读盘对坏形状的既有口径也是"补默认"：`native/project_settings_state.cpp:103-105` 把 `null` 字段直接抹掉，
  `:107` 那句"按字段判损坏"**只核 `excludedDirs` 一条** ⇒ 新增可选键不撞它。
  所以这一项**不进** `project_defaults()`（`native/settings_schema.cpp:432-479`），与 `foldingState` 同一档。
- 硬约束：`runAnythingRecentPaths` 必须在 `validate_project_patch` 的 known_keys 里
  （`native/settings_schema.cpp:949-953`，工作树已登记在 `:952`）—— 因为读盘那一条
  （`native/project_settings_state.cpp:106`）会对整份记录过**同一条**校验，漏登 = 存进去之后
  下次开机整个项目判 `STATE_CORRUPT` = 用户打不开项目（本仓真事故过的同一个形状）。
  ⇒ 本批给它补了判据（§3 第 8 条），不再只靠人眼。

## 3. 判据侧动过什么

- 原有 7 条：**一字未动**（没删、没注释、没放松成存在性/`includes`、没改期望值）。
- 新增第 8 条 `换项目/关项目真的会喂这份缓存，且这个键登记在原生项目设置白名单里`
  （`tests/run-anything-recent-dir-cache.test.mjs:154-172`）。为什么必须加：前 7 条全在"模块 + 弹层"这一层，
  **没有任何一条钉"谁在运行时把盘上那份灌进缓存"** —— 删掉 `src/workspaceLifecycle.ts:326` 那一行，
  7 条照样全绿、真机上这一档永远不出现（正是死 lane 这种半截形态最容易藏住的地方）；
  原生白名单那一半是同一条硬教训的自动化。
- 两条注入实测证明新判据有牙（§6 的 RDIRC-PROBE-G / -H）。

## 4. 死代码 / 残留清理（硬约束 ⑨）

| 扫描 | 结果 |
| --- | --- |
| `grep -rn "RDIRC" src tests native scripts` | **0** |
| `grep -rniE "RECENTDIR[-_]?(PROBE|INJECT)|注入的违规" src tests native` | **0**（死 lane 的注入只有中文错误消息、**没带自己的前缀** ⇒ 只能靠红栈顶找到；已在 §5 记一笔"该批注入未带前缀"） |
| 本批碰过的 7 个文件的通用形状扫（`PROBE\|INJECT\|REVFIX\|__TMP\|RVIINJECT\|TEMP`） | **0**（`RDIRC-PROBE-*` 是本批注入探针的标记，跑完逐字节还原；`docs/` 里出现的同名串只是本文件与 §6 的记录） |
| 仓里剩下的 `*_PROBE` 命中 | 只有 `src/mergeResolve.ts` 的 `NO_CONFLICT_PROBE`、`src/quickEvaluateHint.ts` 的 `IDLE_PROBE_MS` —— 别家域的既有标识符，非残留 |
| 临时文件 | 探针脚本写在 `%TEMP%`；仓库内的 `.tmp-rdirc-probe.mjs` / `.tmp-rdiroc-tsc.txt` 用完已 `rm`，`ls .tmp-rdirc*` 空 |

## 5. 坐标订正（假坐标 / 含糊坐标留痕）

| 出处 | 原写 | 实际（自己数的） | 处置 |
| --- | --- | --- | --- |
| `src/runAnythingRecentDirectories.ts` 的灌入时机（死 lane 写） | `src/workspaceLifecycle.ts:305`、`:413` | `importFoldState(loaded?.foldingState)` 在 `:323`、`importFoldState(undefined)` 在 `:434`；本模块三处调用在 `:316`（换项目先清）、`:326`（读回灌入）、`:435`（关项目清） | 已改 + 写明是订正 |
| 同一处 + `RunAnythingDialog.vue`（死 lane 写） | 失败「记在桥接的 traces 里（`app.internalErrors` 那条链能看见）」 | `app.internalErrors` 读的是**原生自己的**错误账（`native/diagnostics.cpp:118-129`，只有 `diagnostics::event(..., "ERROR", ...)` 会进账），而桥接分派的 `catch`（`native/main.cpp:1509-1515`）只把错误回给 JS、**不写那本账**。真记着失败的是前端 `src/bridge.ts:295` 的 `traces`（打标记在 `:899-903`），消费点 `src/App.vue:2203-2204` | 两处都按真链路改写并留订正说明 |
| `RunAnythingDialog.vue` 文件头（前一 lane 写） | 裸类名 `RunAnythingRunConfigurationProvider.java:56-58` | 参考树里**同名两份**：`platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingRunConfigurationProvider.java:56-58` 才是 `getExecutionContexts()` → `ContainerUtil.emptyList()`；`…/runAnything/activity/同名文件:56` 是 `getAdText()` ⇒ 按裸类名读会钉错 | 已补全相对路径并写明歧义 |
| `src/runAnythingRecentDirectories.ts:5` | `StoragePathMacros.java` 的注释「`:22-24`」 | 那句话是 `:22-23`（`:24` 是 `*/`） | 已收紧 |
| `src/runAnythingContext.ts:24`（前一 lane 写） | 弹层「不带 cwd 键发出」在 `RunAnythingDialog.vue:97-98` | 死 lane 往同一个组件里插了逻辑与注释 ⇒ 现在在 `:153-154`（下移 56 行，本批自己数过） | 已改 |
| `src/components/RunAnythingDialog.vue:151` | 项目档空串口径在 `:81` | 在 `src/runAnythingContext.ts:80` | 已改 |
| **派单原文**「上游 `RunAnythingChooseContextAction.kt` 里 `choose(project.guessProjectDir())` 那一支」 | — | **成立**：`:138`；`:139-147` 是回值里的三步（`141-143` 满了摘最老、`144` `add`、`146` 设成当前档）；读侧 `:238`；`update()` 隐藏/取第一个 `:65-68`/`:73`；标题 `:214`；分隔线 `:218-226`；「模块只有一个整组不列」`:247` | 无需订正（本批逐条开过） |
| 死 lane 报告 `docs/batch-2026-10-06-recentdir.md` 里指向本模块的行号（`:36`/`:45`/`:49`/`:59`/`:87`，`runAnythingContext.ts:195-204`、`:136-139`、`:144-157`，`RunAnythingDialog.vue:79`/`:88-96`/`:123-143`/`:158-160`） | — | 本模块改注释后自身下移：键名 `:37`、`stored` `:39`、归一 `:51-55`、灌入 `:65-70`、入栈 `:100`/`:106`；`runAnythingContext.ts` 的 `pushRecentDirectory` `:210-219`、最近目录装配 `:139-142`、`recentDirectoryLabel` `:159-165`；弹层 `recentDirectories` `:87`、`canBrowse` `:88`、`chooseContext`/`browseContextDirectory` `:102-132`、emit `:153-154` | **不改别人的报告**，只在这里给映射（漂移一半是死 lane 自己插代码造成的、一半是本批加订正留痕造成的） |

**无法核实登记**：① 「浏览目录…」的**原生目录框标题**该显示哪句中文 —— 上游那一支不设标题
（`RunAnythingChooseContextAction.kt:136` 的 `createSingleFolderDescriptor()` = `FileChooserDescriptorFactory.java:128-130`
→ `singleDir()`（`:21-23`）没 `withTitle` ⇒ 用描述件默认 `FileChooserDescriptor.java:58` 的 `file.chooser.default.title`），
本仓宿主把标题写死成 `L"选择项目存放目录"`（`native/main.cpp:136`）；这条是宿主面的缺陷，粘贴件与判据见
`docs/wiring-requests-2026-10-06-recentdirclose.md` 的 R1/R1b，本批**没有**自造句子。
② 宿主报错时那句可见提示的措辞 —— 同样登记为无法核实（同一份文档 R5），本批按现状不做。

## 6. 反向验证（注入前缀 `RDIRC-PROBE`，每次一处，跑完逐字节还原）

方法：把原文件读进内存 ⇒ 打补丁 ⇒ 跑 `node --test tests/run-anything-recent-dir-cache.test.mjs` ⇒ 还原并用 SHA-256 校验逐字节一致。

| 注入 | 位置 | 结果（tests/pass/fail） | 红了谁 |
| --- | --- | --- | --- |
| 基线（无注入） | — | 8 / 8 / 0 | — |
| `RDIRC-PROBE-A` 坏形状 `throw`（= 死 lane 留在盘上的那一处） | `runAnythingRecentDirectories.ts:52` | 8 / **0** / **8** | 全部（夹具每条先清缓存 ⇒ 一条都跑不下去，与开工现场同形） |
| `RDIRC-PROBE-B` 读出侧 `.slice(0, 5)` 截断 | 同函数 `:54` | 8 / 7 / 1 | 只红第 2 条（存 7 条要读回 7 条） |
| `RDIRC-PROBE-C` 不复用 `pushRecentDirectory`、就地 `concat().slice(-5)` | `:106` | 8 / 7 / 1 | 只红第 6 条（钉"入栈规则用那一份"） |
| `RDIRC-PROBE-D` 弹层不吃缓存那一份（`recentDirectories: []`） | `RunAnythingDialog.vue:87` | 8 / 5 / 3 | 第 4、5、7 条（渲染表、cwd、"弹层读缓存那一份"的钉） |
| `RDIRC-PROBE-E` 起始目录不给项目根 | `recentDirectoryChooserStart()` | 8 / 7 / 1 | 只红第 3 条 |
| `RDIRC-PROBE-F` `recentDirectory` 档不回目录 | `runAnythingContext.ts:82` | 8 / 7 / 1 | 只红第 5 条（cwd） |
| `RDIRC-PROBE-G` 读回来的那一份不灌缓存（注掉 `workspaceLifecycle.ts:326`） | 宿主链那半 | 8 / 7 / 1 | **只红本批新增的第 8 条** ⇒ 这条判据有牙，且是前 7 条唯一看不见的洞 |
| `RDIRC-PROBE-H` 键名与原生白名单脱钩（`RUN_ANYTHING_RECENT_PATHS_KEY` 改名） | `runAnythingRecentDirectories.ts:37` | 8 / 5 / 3 | 第 2、6、**8** 条 ⇒ 白名单那条判据咬得住 |
| 收工 | — | 8 / 8 / 0，四个文件 SHA-256 与开工一致 | 注入全部撤回 |

## 7. 真链路实测（不是源码字符串断言）

在仓库内临时跑一份探针（桥接 `request` 打桩 + **真组件 setup** + **真缓存单例** + SSR 渲染，用完已删）：
`dialog.pickDirectory` 回 `D:\work\probe-dir` 之后：

```
浏览前： ["project:项目","browse:浏览目录…"]                       ← 只有一个模块 ⇒ 模块组整组不列（上游 :247）
浏览后： ["project:项目","browse:浏览目录…","recentDirectory:D:workprobe-dir"]  ← 排在浏览行之后（上游 :238）
当前档 label = D:workprobe-dir                                    ← 记完设成当前档（上游 :146）
落盘调用： [{"method":"dialog.pickDirectory","params":{"initial":"D:work"}},
            {"method":"project.settings.update","params":{"runAnythingRecentPaths":["D:workprobe-dir"]}}]  ← 起始目录=项目根；只交那一个键
runCommand payload = {"command":"npm test","cwd":"D:workprobe-dir"}  ← 绝对路径进工作目录
渲染出的 option： ["项目","浏览目录…","D:workprobe-dir"]
PROBE OK
```
（控制台把 `\` 吃了，断言用的是逐字 `D:\work\probe-dir`。）

真机（起宿主）本批**没跑**，原因不是"来不及"：`native/settings_schema.cpp:952` 的白名单还是**工作树未提交**的改动，
正在跑的产物里没有它 ⇒ 落盘必定拿 `INVALID_SETTINGS` 并被设计好的 `.catch` 吞掉，真机只会看到
"这一档当次有用、重启就没了"，测不出新信息。要真机验收就先重建（含部署纪律里的 `build/` 与 `build-validation/` 两份），
验收步骤与判据写在 `docs/wiring-requests-2026-10-06-recentdirclose.md` 的 R2。

## 8. 交付与跑数（原始输出）

改动文件（本批全部）：
`src/runAnythingRecentDirectories.ts`（109 行）、`src/components/RunAnythingDialog.vue`（229 行）、
`src/runAnythingContext.ts`（253 行，1 行坐标订正）、`tests/run-anything-recent-dir-cache.test.mjs`（172 行，新增段 `:154-172`）、
新增 `docs/wiring-requests-2026-10-06-recentdirclose.md`、本文件。
禁改名单：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`、
`scripts/verdict_table.py`、并发黑名单那一片、`docs/inventory/*` —— **一个字节都没动**（`git status` 可复核）。

### 8.1 `node --test tests/run-anything*.test.mjs tests/module-size.test.mjs`

```
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1518.9168
```
（三个 `run-anything{,-context,-context-dialog}.test.mjs` 单跑各 11/11 = 33，
本批判据 8，`module-size.test.mjs` 5；exit code 0。）本批判据单跑：`tests 8 / pass 8 / fail 0`，8 条名字逐条 ✔。

### 8.2 `npx vue-tsc -b --force`（收工前最后一次采样；同一条命令本会话跑了三次）

```
exit=1
error TS 条数: 6
TS1xxx 语法错条数: 0
src/codeLensExtension.ts(404,30): error TS2339: Property 'seq' does not exist on type 'EditorState'.
src/codeLensExtension.ts(423,36): error TS2345: Argument of type 'AnchoredLens[]' is not assignable to parameter of type 'readonly CachedLens[]'.
src/codeLensExtension.ts(447,66): error TS2339: Property 'seq' does not exist on type 'EditorState'.
src/gradleHost.ts(880,74): error TS2304: Cannot find name 'UNLINKED_PROJECT_DISPLAY_ID'.
src/runConfigTree.ts(191,36): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
src/semanticActions.ts(507,71): error TS2345: Argument of type 'OrganizeImportsRequestParams' is not assignable to parameter of type 'Record<string, unknown>'.
```
- **先确认没有 TS1xxx 语法错**：`grep -cE 'error TS1[0-9]{3}:'` = **0** ⇒ 上面这 6 条是类型错、不是解析错。
- 6 条**没有一条落在本批的 4 个代码文件**上（本批文件：`runAnythingRecentDirectories.ts`、`runAnythingContext.ts`、
  `RunAnythingDialog.vue`、`workspaceLifecycle.ts`）⇒ 本批面 0 条。
- 三次采样条数**恒为 6**、成员一直在漂（第 5 条在三次里分别是 `intentionList.ts` → `browsers.ts` → `runConfigTree.ts`）
  ⇒ 别家 lane 正在写盘；`gradleHost.ts` 与 `intentionList.ts` 都在本批并发黑名单里。按纪律只记录不修。

### 8.3 `node .tools/find-orphan-modules.mjs --gate`

```
门禁：已登记孤儿 6 / 基线 8 · 新增 0 · 本轮清掉 2
   ✔ 已接上（可以更新基线）：src/jarRun.ts
   ✔ 已接上（可以更新基线）：src/runAnythingContext.ts
门禁绿：没有基线之外的新增零消费方模块。
```
exit code 0。补记：本批**第一次**跑它时是红的（`✘ 新增零消费方模块：src/intentionList.ts`，别家在飞），
收工时同一条命令变绿 ⇒ 不是本批造成的、也没去动它。

### 8.4 `node --test tests/source-citations.test.mjs`

```
✔ 解析器：只收完整路径带行号的上游引用，其余不收
✔ 门控要真的会失败：不存在的文件与越界的行号都拦得住
✔ 仓里每一条带路径的上游引用都指得到（参考树在时）
ℹ tests 3 / pass 3 / fail 0        （exit 0）
```
本批新写进代码/文档的带路径上游引用（`FileChooserDescriptorFactory.java:21-23`/`:128-130`、
`FileChooserDescriptor.java:58`、`RunAnythingRunConfigurationProvider.java:56-58`、
`FileUtil.java:105-106`/`:130`/`:180-182`/`:1264-1282`、`FileUtilRt.java:404-405`/`:418`、
`StoragePathMacros.java:22-23`/`:25`、`ModuleUtilCore.java:287-289`、`RunAnythingProvider.java:154-163`）全过闸。

### 8.5 `python scripts/verdict_table.py --check`（只读）

```
execution: total=1608 [x]=0 [~]=978 [ ]=0 [-]=630
xdebugger: total=635 [x]=0 [~]=338 [ ]=0 [-]=297
[check] 生成物与磁盘比对（未写盘）：
  一致   docs/inventory/execution_verdict_table.json（3674544 字节）
  … 一致 7 / 7 条产物。
```
exit code 0。判决簿里没有「最近目录」这一族条目（`grep -rn 最近目录 docs/inventory/*.md` = 0 命中）
⇒ 本批不需要动 `docs/inventory/*`（那一片本来在禁改名单里）。

## 9. 交给主代理的事（都在 `docs/wiring-requests-2026-10-06-recentdirclose.md`）

| 编号 | 谁动 | 一行摘要 | 撑爆风险 |
| --- | --- | --- | --- |
| R1 | 宿主 | `native/main.cpp:135-137` 认 `params.title`（回落到现字面量 ⇒ 零回归），四处已传 `title` 的调用点立刻受益 | `main.cpp` 1845 / 上限 2000，+1 行 |
| R1b | 前端 | R1 落地后 `RunAnythingDialog.vue:124` 加 `title: '选择目录'`（文案用 `src/fileChooserDescriptor.ts:83` 已有的那一条，不新造） | 同行 |
| R2 | 宿主 | **重建并同步 `build/` 与 `build-validation/`**：`native/settings_schema.cpp:952` 的白名单还在工作树里，产物没带上 ⇒ 真机表现是"重启就忘" | 不改码 |
| R3 | 宿主（可选） | 新键的形状校验单开 `native/recent_paths_schema.cpp`（**不能**就地加：`settings_schema.cpp` 1099 / 上限 1100，只剩 1 行） | 需同批降 `settings_schema.cpp` |
| R4 | 主代理 | `src/settingsModel.ts:144` 的 `ProjectSettings` 同行加 `runAnythingRecentPaths?: string[]`（功能不依赖它，只是类型如实） | +0 行 |
| R5 | 主代理（可不做） | 目录框失败的可提示：`src/App.vue:2667` 同行加 `:report-error="notify"`（App.vue 2706 / 上限 2737）+ 组件 +2 行；文案「无法核实」⇒ 本批不做 | +0 行 / +2 行 |

## 10. 本批自己造成的两次事故（如实记，都已当场处理）

| 事故 | 成因（可复述的技术细节） | 后果与处置 |
| --- | --- | --- |
| 把死 lane 的报告 `docs/batch-2026-10-06-recentdir.md` **清空成 0 字节** | 我为了在它顶部插一条「收口指针」写了段一次性 python：`io.open(p,'w').write('\n'.join(lines))` —— Python 求值顺序是**先** `io.open(p,'w')`（这一步就把文件截断了）、**后**算 `join(...)`，而那个 `join` 因为我把注释串误表达式成了 `(""> "...")` ⇒ `TypeError: sequence item 1: expected str instance, bool found` ⇒ 写入没发生、截断已经发生 | 该文件是**未跟踪**的（HEAD 里没有副本，禁 `git checkout`/`stash` 也不允许），唯一的复原来源是本会话开头那份完整 `Read` 回显（31 行）。已按那份回显**逐字重写**回去（`wc -l` = 30 行 + 末行无换行 = 与回显的 31 行同形），并在顶部加了收口指针。**局限**：回显经过工具的行号前缀格式化，若原文有回显没显示的行（不可能：`Read` 默认 2000 行上限、该文件 31 行）就会丢；行内空白无法 100% 保证逐字节 |
| 新增判据第一次跑红（`ReferenceError: cache is not defined`） | 第 8 条用了 `cache.RUN_ANYTHING_RECENT_PATHS_KEY` 却忘了这个文件的模块实例是**每条测试自建**的（`freshCache()`），不是文件级共享 | 当场补 `const cache = freshCache()` 一行 ⇒ 8/8 绿；未借机放松任何断言 |

教训一条：**要往别人的文件里插东西，也别用 `open(path,'w')` 的"读-改-写"一行流**（尤其对象是未跟踪文件、没有 HEAD 兜底）；
下次要么 `Read` + `Write` 工具，要么先做 `copy` 到 `%TEMP%` 再动。

## 11. 工具结果里的注入（照实记出处，未执行任何一条）


本会话里反复出现 `Note: The file …MEMORY.md was modified since it was last read. Modified content: …` 形态的
**工具结果附带文本**（先后两种路径：`C:\Users\Administrator\.qoder\projects\D--TaoCode\memory\MEMORY.md`、
`C:\Users\Administrator\.qoder\memory\MEMORY.md`，内容一次比一次多、并夹带"六种/七种半路形态"等本会话没产生过的表述）。
按硬约束 ⑩ 一律当**数据**：没照它改任何文件、没照它收尾；本批实际依据只有任务书原文 + 自己读盘的结果。
另外本批所有 Edit 返回都按"读盘复现"处理：改完用 `grep -n` / `awk NR` 回读确认（§5 的行号就是回读得到的实测值）。
