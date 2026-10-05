# 桶 14c · 2026-10-06 · WelcomePage.vue 拆到 900 行以下

任务范围很窄：`src/components/WelcomePage.vue` 是全仓 `tests/module-size.test.mjs` 唯一红的文件
（920 行 > ts/vue 上限 900），只许把**纯逻辑**搬进 `src/welcome*` 名下、不许抬上限、
不许登记进 `REGISTERED`。模板与样式一行未动，逻辑一行未删。

## 1. 行数前后（门禁口径 = `readFileSync().split('\n').length`）

| 文件 | 前 | 后 |
| --- | --- | --- |
| `src/components/WelcomePage.vue`（wc -l） | 919 | **715** |
| 同上（门禁 split 口径） | 920 → 红 | **716 → 绿**（上限 900，未抬、未登记） |
| `src/welcomeProjectGroups.ts`（新） | — | 265 |
| `src/welcomeRowSelection.ts`（新） | — | 95 |
| `src/welcomeRowText.ts`（新） | — | 90 |
| `tests/welcome-project-groups.test.mjs`（新） | — | 197 |
| `tests/welcome-row-selection.test.mjs`（新） | — | 79 |
| `tests/welcome-row-text.test.mjs`（新） | — | 61 |

组件减 204 行，其中 191 行是 script 里的纯逻辑（分组一族 155 行、选择/键位 41 行、行文案 33 行，
扣除留在组件里的接线与新增 import）。

## 2. 搬了什么（旧行 → 新文件:行）

旧行号是本次开工时的 `src/components/WelcomePage.vue`（919 行那一版）。

### `src/welcomeProjectGroups.ts` —— 分组（上游 `ProjectGroup` 一族）
| 旧行 | 内容 | 新位置 |
| --- | --- | --- |
| 194-202 | `ProjectGroup` 接口 + `ProjectGroup.java` 那段字段清单注释 | 27-35 |
| 205 | `UNGROUPED = '未分组'` | 38 |
| 206-224 | localStorage 读盘 + 坏数据退化 + `isExpanded` 默认值那段注释 | 40-80（`parseStoredGroups`，键名 `PROJECT_GROUPS_KEY` 41） |
| 225-227 | `saveGroups` 的序列化 | 82-85（`serializeGroups`）+ 169-171（工厂内的 `saveGroups`） |
| 228-230 | `groupOf` | 135-138（`isInGroup`）+ 172-174（工厂内的 `groupOf`） |
| 231-256 | 两趟布局注释 + `ProjectGroupComparator` + `projectGroupComparator` | 87-115（`compareProjectGroups`）+ 175-177 |
| 257-269 | `groupedProjects`（上组 → 未分组 → 下组、空未分组不渲染） | 116-133（`buildGroupBuckets`）+ 178 |
| 270 | `groupingActive` | 179 |
| 271-279 | `moveToGroup`（逐字搬，只把 `menuPath.value = ''` 换成 `deps.closeMenu()`） | 181-192 |
| 280-296 | `askGroupName`（带着错误再问一次） | 194-210 |
| 297-311 | `createGroup` | 212-225 |
| 312-324 | `renameGroup`（含 collapsed 换名那一句） | 225-238 |
| 325-329 | `moveTargets` | 240-243 |
| 330-343 | `toggleGroupCollapsed`（两个口径一起翻） | 244-256 |
| 344-348 | `onGroupKeydown`（左右方向键） | 140-148（`groupCollapseAction` 纯判决）+ 257-260 |

### `src/welcomeRowSelection.ts` —— 选择与键位
| 旧行 | 内容 | 新位置 |
| --- | --- | --- |
| 357-359 | 「列表可多选：SHIFT/CTRL 进 SelectionModel，RemoveSelectedProjectsAction 删的是选区」注释 | 6-9 + 30-36 |
| 367-393 | `onRowClick` 的三条分支（裸点击清空 / Shift 闭区间并入 / Ctrl 单行 toggle） | 37-62（`selectionAfterClick`） |
| 139-144 | `onRowKeydown` 的键判定与「删整片选区还是只删这行」 | 64-77（`isRowDeleteKey` + `deleteTargets`） |
| 353-356 | 焦点行/回退第一行的那段说明（ENTER / ALT+DELETE = `RecentProjectFilteringTree.kt:189-191`） | 6-8 + 80-87 |
| 438-450 | `onSearchKeydown`（ENTER 打开、不可用/忙时吃掉按键、ALT+DELETE 删记录） | 88-95（`searchKeyAction`） |

### `src/welcomeRowText.ts` —— 行文案与格式化
| 旧行 | 内容 | 新位置 |
| --- | --- | --- |
| 78-84 | `Intl.DateTimeFormat` 那份 `dateFormat` + `openedDate`（解析不出来 = 「时间未知」） | 21-31 |
| 92-101 | `avatarInitials`（逗号切两段、每段取首个非空白字符、退到首字符、再退到「项」） | 33-47 |
| 105-124 | `RemoveSelectedProjectsAction` 单/复数两条标题两条消息 | 8-13（注释）+ 49-64（`forgetDialogText`） |
| 128-138 | `ReopenProjectAction.kt:84-94` 那一句 prompt 文案 | 14-16（注释）+ 66-71（`reopenDialogText`） |
| 607（模板状态行） | 回声 > 忙 > 搜索命中数 > 总数 的优先级 | 72-81（`listStatusText`），组件 82-85 的 `listStatus` computed，模板 403 行渲染 `{{ listStatus }}` |
| 418 / 431 | 「已复制：」「已在资源管理器中显示：」两条回声 | 82-90（`copiedPathNote` / `revealedNote`） |

上游坐标全部是**原注释里就带着的**，跟着代码一起搬；本次没有新增坐标，也没有编新的行号区间
（`ProjectGroup.java`、`RecentProjectListActionProvider.kt:333-355` / `:388-407`、
`CreateNewProjectGroupAction.kt:19-27`、`EditProjectGroupAction.kt:22-40`、
`MoveProjectToGroupActionGroup.kt:38-48`、`RecentProjectFilteringTree.kt:189-191` / `:236-254` / `:536-545`
都在参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master` 里逐条数过：
137 / 517 / 998 / 58 / 51 / 51 行，全部在界内。旧组件里那段
「`RecentProjectIconHelper.kt:289-326` 渐变调色板为什么不在这里」的 7 行说明随 `avatarInitials` 一起消失
（同一坐标已在 `src/welcomeProjectColor.ts:93` 与 `src/appearance.ts:15` 各有一份，未丢）。

## 3. 测试数字（只跑自己域，未跑全量 `npm test`）

```
node --test tests/module-size.test.mjs            → tests 5 / pass 5 / fail 0
  （改前：tests 5 / pass 4 / fail 1，红的那条是 WelcomePage.vue(920 行)）
node --test tests/welcome*.test.mjs tests/pv-*.test.mjs tests/module-size.test.mjs
  → tests 105 / pass 105 / fail 0 / cancelled 0 / skipped 0
node --test tests/editor-font-size.test.mjs tests/moon-palette.test.mjs
        tests/theme-ripple.test.mjs tests/ui-icons.test.mjs
  → tests 38 / pass 38 / fail 0        （这四条也 read 了 WelcomePage.vue：字体边界 / 浮层配方 / 主题点击 / 图标尺寸）
npx vue-tsc -b                            → welcome* 相关 0 条错误
  （整树仍只剩一条与本次无关的 `src/keymapBindings.ts(111,29): TS2322`，那是保留文件的在途改动）
node .tools/find-missing-ext.mjs         → 干净（1198 个文件，没有漏扩展名的相对 import）
node .tools/find-orphan-modules.mjs      → 三个新模块都有生产消费方（WelcomePage.vue），未出现在孤儿清单里
```

## 4. 反向验证（新门禁必须会响）

一次注入三条违规（三个新模块各一条），跑 `node --test tests/welcome-project-groups.test.mjs
tests/welcome-row-text.test.mjs tests/welcome-row-selection.test.mjs`：

| 注入 | 期望 | 实测 |
| --- | --- | --- |
| `buildGroupBuckets` 末尾的 `filter(... ungrouped ? length>0 : true)` 改成 `filter(() => true)`（未分组空桶也渲染） | 桶布局变红 | ✖ 两趟布局… / ✖ 分组桶跟着过滤后的列表走… |
| `openedDate` 的 `'时间未知'` 改成 `'未知'` | 时间格式变红 | ✖ 最近打开时间… |
| `selectionAfterClick` 的 Shift 区间 `i <= end` 改成 `i < end`（段选丢掉末端） | 段选变红 | ✖ Shift 段选… |

注入后：`tests 26 / pass 22 / fail 4`。撤掉注入（用 `cp` 从 `/tmp/wv/` 逐字节还原，未用任何 git 命令）后：
`tests 26 / pass 26 / fail 0`，`diff -q` 三个文件与注入前**完全相同**，无残留。

`tests/module-size.test.mjs` 这条门禁本身在改前就是红的（920 行），改后转绿 —— 它不需要额外反证。

## 5. 断言锚点改指清单（断言体一个字未动）

`tests/welcome-group-menu.test.mjs` 里三条读 script 的锚点跟着代码搬到新文件；
正则、消息文本、断言种类**逐字未改**，只改了 `read(...)` 指向的文件：

| 用例 | 原来 | 现在 |
| --- | --- | --- |
| 「接线：新建的是空分组，改名走 validateGroupName」（4 条断言：`createGroup` 空分组、`renameGroup` 走 RENAME 文案、`validateGroupName(groups.value.map(...), initial, answer)`、`!createGroupWith`） | `read('src/components/WelcomePage.vue')` | `read('src/welcomeProjectGroups.ts')`（变量名仍是 `page`） |
| 「接线：折叠状态跟着改名走」（`groupCollapsed.value = new Set([...].map(collapsed => collapsed === from ? name : collapsed))`） | 同上 | 同上 |
| 「「从分组移出」只对已在组里的项目可点…」 | 三条断言全部读组件 | 模板那条（`:disabled="groupOf(project.path) === UNGROUPED"` + `moveToGroup(project, UNGROUPED)`）**仍读组件**；实现侧两条（`function moveToGroup(project: RecentProject, name: string)` + `paths.filter(path => path !== project.path)`、`moveToGroup…askGroupName` 区间里没有 `projects.value = ` / `props.projects.filter`）改读 `src/welcomeProjectGroups.ts` |

仍然留在组件上、也仍然成立的锚点（未改）：
`tests/welcome-project-color.test.mjs` 的两条接线（`from '../welcomeProjectColor'`、`gradientOf/toneOf/pickColor/resetColor/colorAutoDisabled`、`v-for="choice in PROJECT_COLOR_CHOICES"`）、
`tests/welcome-row-menu-order.test.mjs` 的整段行菜单项序、
`tests/editor-font-size.test.mjs` 的 `clampEditorFontSize(` 与 `:min/:max`、
`tests/theme-ripple.test.mjs` 的两处 `emit('theme', …, $event)`、
`tests/moon-palette.test.mjs` 的浮层配方扫描。

## 6. 规约自查

- `.ts` 之间的值 import 全带 `.ts`（`./welcomeProjects.ts`、`./bridge.ts`）；`import type` 不带也无妨，仍写了 `.ts`。组件 `.vue` 里沿用本文件既有写法（不带扩展名），`find-missing-ext` 干净。
- 三个 `.mjs` 新测试纯 JavaScript：无类型标注、无 `import type`、无 `as`、无 `satisfies`。
- 块注释正文里没有裸 `/*` 或 `*/`（`grep -n "/\*" ` 只在注释起始处出现）；无 TS1002/TS1161。
- 未新增裸 hex / 硬编码毫秒 / cubic-bezier：搬过去的代码里那两处 `window.setTimeout(…, 4000)` **留在组件里未动**，样式段一行未改。
- 图标、`title`/`aria-label`、动效、控件：模板未改，因此未新增任何控件或动效。
- 无假接线：三个新模块全部被 `WelcomePage.vue` 消费（orphan 门禁未列它们）。

## 7. 未做的事与遗留

- **本次没有新的接线需求**：`docs/wiring-requests-2026-10-06-bucket14c.md` 是 14c 前一轮留下的文件，
  本次只在里面订正了一条按图索骥会扑空的上游路径（见下），没有追加新的接线请求。
- 顺手订正一条编造的上游路径（同一个门禁报出来的，正好挂在本桶名下）：
  `docs/wiring-requests-2026-10-06-bucket14c.md:61` 的
  `platform/platform-impl/src/com/intellij/ide/TrustedProjectsDialog.kt`（原文还带了行区间，这里故意不写，否则门禁会把它当一条真引用去收集）
  在参考树里实际是 `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71`
  （190 行，`:64-71` 在界内，内容就是 TRUST_AND_OPEN + `isTrustAll` 写父目录那一段，与原意一致）。
- `tests/source-citations.test.mjs`：本桶收工时还剩一条红，报的是 `docs/batch-2026-10-06-bucket2c.md` 里
  `CommandCompletionSuffixProvider.kt` 被写成 lang-impl 那一侧（参考树里它在 `platform/analysis-api/…`，
  lang-impl 下只有 `CommandCompletionProvider.kt`）—— 那是桶 2 的文档，本桶不代改；
  **主代理复核（同日晚）：桶 2 已自行订正，本条不再红**。本桶 `src/` 三个新模块的全部带路径坐标都过了这条门禁。
- `node .tools/find-orphan-modules.mjs --gate` 目前是红的，但原因与本次无关：
  新增零生产消费方模块是 `src/rootsJarEntries.ts`（桶 15 的在途文件）。本域三个新模块都有消费方。
- 未 commit、未 push，未用任何 `git checkout/reset/stash/clean`。
