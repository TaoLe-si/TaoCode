# 批次报告 · 2026-10-06 · trust4（R4 落地 + R6/R7 判定）

代号 `trust4`。规则文件：`D:\TaoCode\.tools\agent-rules.md`（本仓无 AGENTS.md）。
上游唯一真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（未上网、未截图）。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话 |
|---|---|---|---|---|---|
| welcome / 信任 | R4 会话级信任两份并成一份 | `[x]` 已做 | `platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:66-71`、`:80-89`；`platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:25-28`；`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-74` | `src/workspaceLifecycle.ts:100-101`（读）、`:136`（写）、`src/trustedProjects.ts:343-366`（真源） | 宿主自留的 `ref<TrustedPathEntry[]>` 删掉，读写都走模块那一份 ⇒ 对话框答的「这次信任」出现在设置页那张表、设置页删的会话项立刻影响执行侧门禁 |
| welcome / 信任 | 判据：信任按**来源**（路径段 / URL 所属项目根）判 | `[x]` 已做并有失败边界 | `platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:46-49`、`platform/platform-impl/src/com/intellij/ide/impl/TrustedPathsSettings.kt:44-47`（`PrefixTreeMap` + `PathPrefixTree`）、`platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:69` | `src/trustedProjects.ts:44-48`（`isPathInside` 按段）、`:167-192`（`browseWithTrustCheck` 按项目根） | 新边界用例钉「`d:/work/pro` 被信任**不**放行 `d:/work/proj`」与「裸 `c:evil` 不算 `c:/` 之内」；URL 那一路钉「同串 URL、换项目根照样问」 |
| welcome / 信任 | 判据：「始终信任此来源」落库形状与上游一致 | `[x]` 已做 | `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:66-70`（`addTrustedPath(projectRoot.parent.toString())`）、`platform/platform-impl/src/com/intellij/ide/impl/TrustedPathsSettings.kt:34-48`（清单每条隐式 true） | `src/trustedProjects.ts:270-283`（`trustDecisionPaths`）、`tests/trusted-session-single-source.test.mjs` 第 7 条 | 勾了才多落**父目录**一条 `{path, trusted:true}`；配置目录里的来源不落父目录；同一来源下别的项目靠最近祖先直接放行 |
| welcome / 信任 | R4 的迁移证明（旧位置写入 ⇒ 新真源读得到） | `[x]` 已做 | 同上（上游只有一份 per 存储，不存在迁移） | `tests/trusted-session-single-source.test.mjs` 第 2、3 条 | 同一串答话按老写法（`rememberTrust` 于宿主数组）与新写法（`rememberSessionTrust`）各跑一遍 ⇒ 条目集合逐字相同；唯一差别是「就地覆盖 vs 挪到表尾」的顺序，判定按最近祖先故不受影响（用例把两种顺序都钉住并逐条比对判定） |
| welcome / 信任 | T2 第四个读点仍只看持久档 | `[ ]` 未做（交请求） | `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:56-73` | `src/semanticActions.ts:187` | 格式化门禁没并会话档 ⇒ 见 `docs/wiring-requests-2026-10-06-trust4.md` T2（属 formatting 域在途文件，不越界） |
| welcome / 信任 | T3 会话档进不了宿主硬边界 | `[-]` 本轮不做，**必须主代拍板** | `platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:19-22`（上游那一档是持久存储 `trusted-paths.xml`）、`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-74` | `native/main.cpp:357`、`:1107`、`:1365` + `native/trusted_paths.cpp:55-63` | 「这次信任」只在前端 ⇒ 前端放行、宿主仍回 `UNTRUSTED_PROJECT`；要 (a) 照上游一律落库，还是 (b) 把会话档递给 native |
| welcome / 选择器 | R6 左栏「收藏」上游是否存在 | `[-]` 不存在（结论 + 证据，不改代码） | `platform/platform-impl/src/com/intellij/openapi/fileChooser/universal/UniversalFileChooser.kt:304-305`、`:677-696`、`:698`；收藏视图在另一个模块 `platform/favoritesTreeView/src/com/intellij/ide/favoritesTreeView/FavoritesManager.java`（与 fileChooser 互不引用） | `src/components/FileChooserDialog.vue:309`、`src/fileChooserModel.ts:340`、`src/App.vue:1446`、`:2388` | `platform/platform-impl/src/com/intellij/openapi/fileChooser/` 全包大小写不敏感 grep `favorite` **0 命中**；左栏只有 Home / Desktop / Project 三个固定位置；本仓那一栏是早先编的，现 `v-if` + 空数组 = 不渲染（不是假控件）⇒ 建议整栏删，等主代拍板 |
| welcome / 选择器 | R7 多选 | `[-]` 不做（维持，触发条件写死） | `platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:452`、`:552` | `src/fileChooserDescriptor.ts:92-103`、`:122`；`native/dialogs.cpp:153-166`；`src/bridge.ts:109` | 多选描述件零生产调用点（唯一内部引用是同样没人调的 `createAllButJarContentsDescriptor`）；宿主通道本身单选（`IFileOpenDialog::GetResult` 单个 `IShellItem`，native 全目录 `ALLOWMULTISELECT` 0 命中，`Method` union 无 `dialog.pickFiles`）⇒ ①第一个真多选调用点 + ②native 多选通道到位，两条同时满足才动 |

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `src/workspaceLifecycle.ts` | 433 | 441 | 删宿主自留的 `sessionTrust` ref；读点改 `sessionTrustEntries()`、写点改 `rememberSessionTrust()`；import 补两个名字；注释记上游两份存储合并的口径 |
| `src/trustedProjects.ts` | 453 | 463 | 会话档登记为**唯一真源**（原先那句「见 `src/workspaceLifecycle.ts` 的 `sessionTrust`」指向已不存在的符号，留痕订正）；`rememberSessionTrust` 补覆盖口径注释 |
| `tests/welcome-trust-dialog.test.mjs` | 168 | 174 | 原来钉「未接线形状」的那条（`assert.match(lifecycle, /const sessionTrust = ref…/)`）按上一轮文件头约定**反转**成正向钉；App.vue 那两句（`canTrustAll` / `resolveLink`）原样保留 |
| `tests/trusted-session-single-source.test.mjs` | — | 168 | 新判据 7 条（含迁移等价、失败边界、来源落库形状） |
| `docs/wiring-requests-2026-10-06-trust4.md` | — | 128 | T1（`workspaceLifecycle.ts:439` 露 `trustEntries`/`saveTrustedPaths`）、T2、T3 + R6/R7 的证据与要拍的那一句 |
| `docs/batch-2026-10-06-trust4.md` | — | 本文件 | 交付报告 |

未修改（只读遵守）：`src/App.vue`、`src/bridge.ts`、`src/settingsModel.ts`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、`native/*`、`docs/inventory/*`、`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`。
本轮**没有**改过设置键，也没有新增键 ⇒ 「旧存档缺键补默认」那一条不适用（真源改动只在内存，`generalSettings.trustedPaths` 的读写形状、`native/settings_schema.cpp:182-232` 的校验与默认都没动）。

## 3. §5 每条自查命令的前后数字

| 命令 | 改前 | 改后 | 结论 |
|---|---|---|---|
| `node --test tests/trusted-{projects,locations,locations-union,trust-all,external-link}.test.mjs tests/welcome-trust-dialog.test.mjs` | tests 50 / pass 50 / fail 0 | tests 50 / pass 50 / fail 0（其中 `welcome-trust-dialog` 内部条数不变、断言已反转） | 域内不回归 |
| 上一条 + `tests/trusted-session-single-source.test.mjs` | — | tests 57 / pass 57 / fail 0 | 新判据 +7 |
| 上面 6 个 + `tests/welcome-projects.test.mjs`、`tests/application-activation.test.mjs`、`tests/startup-activities.test.mjs`（都会读 `src/workspaceLifecycle.ts` 源码） | — | tests 76 / pass 76 / fail 0 | 换项目生命周期那批源码锚点没被我改断 |
| `npx vue-tsc -b --force` | 并发工作区，没有改前基线可取（见 §6 第 4 条） | 中途两次跑分别剩 **3 条**、**1 条**错（`src/refactorPreview.ts(207,7): error TS2322: Type '"file" \| "class" \| "method" \| "directory"' is not assignable to type '"file" \| "directory"'、`src/referenceContents.ts:149 shallowRef`），**收工最后一跑 = 0 错**；全程 `grep -cE "workspaceLifecycle\|trustedProjects\|TrustedLocations"` = **0** | 本域 0 错；那几条是 usage-view / structure 在途（`src/usageViewGrouping.ts:178` 把 kind 拓宽、`src/refactorPreview.ts:155` 还是 `'directory' \| 'file'`；`refactorPreview.ts` 的 `git status` 当时是干净的 ⇒ 别人正在改），几分钟后被别人改掉 |
| `node --test tests/module-size.test.mjs` | 本轮早段：tests 5 / pass 5 / fail 0 | 中途一次 **fail 1**：`src/bridge.ts 现在 911 行 > 上限 905`（保留文件、我没打开过）；**收工最后一跑 tests 5 / pass 5 / fail 0** | 我改的两个文件 441 / 463 行，远低于 900 ⇒ 与本次改动无关，只在报告里留个「有人把 bridge.ts 顶过上限又收回」的现场记录 |
| `node .tools/find-param-props.mjs` | — | 共 0 处参数属性 | 干净 |
| `node .tools/find-ts-in-mjs.mjs` | — | 干净：`tests/*.mjs` 全部是纯 JavaScript | 干净 |
| `node .tools/find-missing-ext.mjs` | — | 扫描 1303 个文件，干净：没有漏扩展名 | 干净 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 8 / 基线 8 | 已登记孤儿 8 / 基线 8 · **新增 0** · 本轮清掉 0 ⇒ 门禁绿 | 见 §5 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 首跑 fail 3（其中 2 条在别人名下、1 条是我把 `TrustedHostsConfigurable.kt:61-69` 改成 `:66-71` 触发的 `moved`） | 末跑 tests 11 / pass 11 / **fail 0**；锚点核对：快照 2881 条 / 仓里活引用 2882 条 / 未入快照 1 条 / 区间为空 1 条 | 我没重算 `docs/inventory/citation-anchors.json`（并行代理本轮期内重算过它，mtime 11:17）；改用在同一处**同时**留 `:66-71`（函数本体）与 `:61-69`（那段 "One list over both trust stores" 注释）两种写法，使任一新旧快照都能逐字命中 ⇒ 门控自洽、不改别人的派生产物 |

## 4. 反向验证记录（注入 ⇒ 变红 ⇒ 撤掉 ⇒ 复绿）

1. **注入「第二份会话存储」**（把 R4 的两行还原成合并前的形状：`trustEntries()` 读局部 `hostSession.value`、写点 `hostSession.value = rememberTrust(hostSession.value, …)`，并补上 `const hostSession = ref<TrustedPathEntry[]>([])`）
   ⇒ `node --test tests/trusted-session-single-source.test.mjs tests/welcome-trust-dialog.test.mjs`：**tests 19 / pass 17 / fail 2**
   （✖ 宿主那份已经并进模块那份：读写点各只剩一条，旧的 ref 不在盘上；✖ App.vue 那两行还没接；会话级那份已并进模块真源）。
   撤（`cp build/rv-workspaceLifecycle.ts.bak`）⇒ `grep -c hostSession` = 0 ⇒ 复绿。
2. **注入「整串字面量前缀判定」**（`isPathInside` 去掉补尾斜杠那步：`return child.startsWith(ancestor)`）
   ⇒ `node --test tests/trusted-session-single-source.test.mjs tests/trusted-projects.test.mjs`：**tests 16 / pass 14 / fail 2**
   （✖ 落在里面按路径段判：/a/bc 不在 /a/b 里，相等算自身〔既有用例〕；✖ 会失败的边界：按段判来源，不是整串字面量的前缀〔新用例〕）—— 正是「`d:/work/pro` 误放行 `d:/work/proj`」。
   撤 ⇒ 第 47 行回到 `child.startsWith(ancestor.endsWith('/') ? ancestor : ancestor + '/')` ⇒ 复绿。
3. **注入「会话档不做就地覆盖」**（`rememberSessionTrust` 的 `if (at >= 0) splice` 那一支废掉，改成一律 `push`）
   ⇒ `node --test tests/trusted-session-single-source.test.mjs`：**tests 7 / pass 6 / fail 1**（✖ 迁移不丢东西）—— 同一路径出现两条、后答的赢不了。
   撤 ⇒ 三处注入全部还原（`diff build/rv-trustedProjects.ts.bak src/trustedProjects.ts` = IDENTICAL、`grep -c "at >= 0 && false"` = 0）
   ⇒ 复绿：**tests 57 / pass 57 / fail 0**。临时备份 `build/rv-*.bak` 收工删除。

## 5. 零消费方自查结论

- `src/` 侧本轮**没有新增任何模块或导出**：改动是把宿主的读/写接到既有导出 `sessionTrustEntries` / `rememberSessionTrust`（此前已被设置页与 `tests/trusted-locations-union.test.mjs` 消费），并删掉一个内部 `ref`。
- 新文件只有测试（`tests/trusted-session-single-source.test.mjs`）与文档，不产生模块依赖。
- `node .tools/find-orphan-modules.mjs --gate` ⇒ 已登记孤儿 8 / 基线 8 · 新增 0 · 清掉 0，门禁绿。
- 未做的事也如实登记为零消费方风险的成因：T1 之所以不把 `trustEntries`/`saveTrustedPaths` 加进 `src/workspaceLifecycle.ts:439` 的 return 表，就是因为唯一消费者在保留文件 `src/App.vue`（R2/R3）里 —— 先接导出再接消费者会留下没人用的导出，故交请求。

## 6. 做不到 / 无法核实

1. **T3（会话档 vs 宿主硬边界）做不到等价**：上游「答一次」写的是**持久**存储
   `platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:19-22`（`trusted-paths.xml`）与 `:60-66`，
   且上游确认框**没有**「以后不再询问」这一档（只有 `:66-70` 的 trust-all）⇒ 本仓的「只活本次会话」是既有偏离。
   要收成上游形状必须动 `native/main.cpp`（保留文件）与设置落库语义，具体卡点是：会话态在前端内存，宿主的 `require_trusted` 只拿到 `general_settings()`。
2. **T2 不改**：`src/semanticActions.ts` 属 formatting 域在途文件（不是保留文件，但我不是它的 owner），改动会让「这次信任」突然允许格式化 = 行为变更，超出 R4 判据范围 ⇒ 交请求带 paste-ready 两行。
3. **R2/R3 的宿主那半无法自证落地**：`src/App.vue` 是保留文件（`appvue` 独占），本轮只重数行号（挂载点现为 `src/App.vue:2646`，选择器那两行 `:1446`/`:2388`）。
4. **改前 tsc 基线取不到**：12 路并行的工作区里 `npx vue-tsc -b --force` 两次跑相隔几分钟就从 3 条错变 1 条错（别人在改自己文件），任何「改前数字」都不可复现 ⇒ 只给「本域文件 0 错」这条可核的事实。
5. **`src/trustedProjects.ts` 曾被我用 `build/*.bak` 整体还原过 3 次**（反向验证需要）：还原窗口 11:09→11:12；
   已核对还原后的文件与备份逐字一致、且与我 11:05 读到的内容一致（除我自己的两处编辑）。
   若那 3 分钟里有别的代理改这个文件，改动会被我覆盖 —— 从现在的 `git diff` hunk 看，该文件除我 326-366 段以外仍带着 external-link 那几段在途改动（hunk 在 109/144/155/169），没有丢失迹象。
6. **无法核实**：`platform/favoritesTreeView/…/FavoritesManager.java` 与文件选择器的关系我只能证明「fileChooser 包里 0 命中 favorite」；上游若通过别的 EP 往选择器塞自定义栏位，我在 `UniversalFileChooser.kt:677-696` 里没找到，也没有搜到 `TrustedHostsConfigurableProvider` 那样的 provider 形接口 —— 这条留作 R6 拍板前的最后一个疑问。
