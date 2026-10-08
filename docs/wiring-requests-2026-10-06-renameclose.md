# wiring requests — 2026-10-06 renameclose

派单：判清 `tests/rename-file-conflict.test.mjs` 那 2 条红的归属并修对的一侧。
实况与裁定全文见 `docs/batch-2026-10-06-renameclose.md`。

**一句话**：那 2 条红在本 lane 接手前**已经不在盘上了** —— 两侧都是"判据过时/写反"，
`refactorclose` 已把判据改对（红的是判据，不是实现）。本 lane 的工作是**独立复核它的裁定**
（开参考树逐行核实，全部成立）+ 修自己名下文件里三处判据卫生问题。
`src/renamePreview.ts` 与 `native/main.cpp` 本 lane **一个字都没写**（mtime 自查见 batch §2.2），
下面三条是把"需要别人决定 / 别人文件"的部分交出来。

---

## R1（低风险，纯注释）`src/renamePreview.ts:248` 的「逐字比」要说清是随宿主档位的

现文 `:248` 已经把交接说的那句自相矛盾修掉了（「逐字比」+「不做大小写归一」是同一件事，不再互斥，
`:251` 也已是实话）。残留的不精确只有一寸：它把上游说成**无条件**逐字比，而上游是按宿主档位比。

证据（参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`，全部 `awk NR` 逐行核）：

- `platform/platform-impl/src/com/intellij/openapi/vfs/impl/local/LocalFileSystemBase.java:431-433`
  `public boolean isCaseSensitive() { return SystemInfo.isFileSystemCaseSensitive; }`
- `build/jvm-rules/jps-builders-6/src/org/jetbrains/jps/util/SystemInfo.java:11`
  `isFileSystemCaseSensitive = !isWindows && !isOS2 && !isMac` ⇒ **Windows 为假**
- `platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java:725-731`（注释：NTFS 要
  `fsutil.exe file setCaseSensitiveInfo` 才大小写敏感）
- `platform/core-impl/src/com/intellij/psi/impl/file/PsiDirectoryImpl.java:532-534`
  `checkAdd` 里比名字时显式把宿主档位传进 `Comparing.strEqual(item.getName(), name, caseSensitive)`

逐字 old（`src/renamePreview.ts:248-249`）：

```
 *   · `:545` `targetDirectory.findFile(name)` —— **按名字逐字比**（不做大小写归一，本仓同口径：
 *     路径原样相等才算「同一个条目」）；
```

逐字 new：

```
 *   · `:545` `targetDirectory.findFile(name)` —— 按名字比，**比法随宿主的大小写档位**
 *     （`LocalFileSystemBase.java:431-433` `isCaseSensitive() = SystemInfo.isFileSystemCaseSensitive`，
 *     Windows 为假）；本仓清单这一层取其中「逐字」那一档：路径原样相等才算「同一个条目」；
```

并建议在 `:251` 之后补一条上游落地改名自己的放行档（现文档只引到 `checkFileExist` 那一层）：

```
 *   · 真正落地改名那一层另有两道：`LocalFileSystemBase.java:540`
 *     `sameName = !file.isCaseSensitive() && newName.equalsIgnoreCase(file.getName())`
 *     ⇒ 「纯改自己名字的大小写」是**放行**的一档；`:541-542` 不是纯改大小写而
 *     `parent.findChild(newName) != null` ⇒ 抛 `vfs.target.already.exists.error`
 *     （`platform/ide-core/resources/messages/IdeCoreBundle.properties:60`）。
```

## R2（**要主代理裁定**：牵着禁写的 `native/main.cpp`）大小写不敏感宿主上那一档要不要拦

现状与上游的分歧点，实测（变异跑在临时副本上，live 文件未动）：

| 输入 | 本仓 `renameTargetConflict` | 上游 Windows 默认档 |
|---|---|---|
| `src/a.ts` → `src/A.ts`，清单**另有** `src/A.ts` | 冲突（`{path:'src/A.ts'}`） | 冲突（`Handler:545-546`）一致 |
| `src/a.ts` → `src/A.ts`，清单**只有** `src/a.ts` | `null`（放行） | 放行（`LocalFileSystemBase:540` `sameName`）一致 |
| `src/a.ts` → `src/B.ts`，清单**只有小写** `src/b.ts` | **`null`（放行）** | **抛 `already exists`（`LocalFileSystemBase:541-542`）** |

⇒ 第三档本仓放行、上游拦。要做成上游那样，需要给 `renameTargetConflict` 加一个宿主档位入参
（`caseSensitive`，从 bridge/native 取），大小写不敏感时按 `equalsIgnoreCase` 比、但保留 `sameName` 那一档放行。
`native/main.cpp` 的 `file.rename`（`:998`）是本 lane **禁写**项，`renamePreview.ts` 归 refactorclose 收口，
所以本 lane **没有**动它，也没有顺手把 `tests/…` 里那条 `= null` 改成别的 —— 那条断言是当前契约的证人，
反向验证（batch §3 的 V4）已证明它钉得住这一变异（把实现改成忽略大小写就会红）。
决定要做时请**新增**断言而不是改这条。

## R3（小，非阻塞）`src/renamePreview.ts:271` 的 `&& entry.path !== from` 不可达

`if (!from || !to || from === to) return null`（`:270`）在前 ⇒ `entry.path === to && entry.path !== from`
里那半句永不单独起作用（要 `entry.path === to === from` 才不同，那时已 return）。
实测：在临时副本里删掉那半句，`tests/rename-file-conflict.test.mjs` 12 条**全绿不变** ⇒ 没有断言能吃得到它。

上游同位置那一半（`Handler:546` `!existing.equals(file)`）**不是**死的 —— 因为大小写不敏感的宿主上
`findFile("A.ts")` 会回头命中 `a.ts` 自己。⇒ 这条与 R2 是同一个根因的两个症状（宿主档位没建模）。
留删由 refactorclose 定：留着当"照抄上游形状"的证人可以，但要清楚它在本仓当前口径下不咬合。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1 / R3** —— 目标 `src/renamePreview.ts`（本 lane 可改面，纯注释/不可达清理）。登记为待办。
- **R2** —— 牵 `native/main.cpp`（禁改），非本 lane。

结论：零接线（R1/R3 登记，R2 转 native owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R1/R3 登记，R2 转 native owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
